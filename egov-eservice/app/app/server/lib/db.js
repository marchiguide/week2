'use strict';
/**
 * SQLite (better-sqlite3, synchronous) singleton.
 *
 *   const { db } = require('../../lib/db');
 *   db.prepare('SELECT * FROM cases WHERE case_no = ?').get(caseNo);
 *   db.transaction(() => { ... })();          // atomic (also nests via savepoints)
 *
 * Startup (init):
 *   1. TEST_MODE=1 → the DB file at DB_PATH is deleted and recreated (disposable test DB)
 *   2. server/db/schema.sql is executed (idempotent: CREATE ... IF NOT EXISTS)
 *   3. server/db/migrations/*.sql are applied once each, in file-name order, tracked in _migrations.
 *      Blocks add their own file (citizen.sql, officer.sql, …) — typically ALTER TABLE … ADD COLUMN /
 *      CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. "duplicate column" / "already exists"
 *      errors are tolerated so two blocks adding the same column do not break startup.
 *
 * wipeAll() deletes every row of every table (used by POST /api/test/reset) — tables added by
 * migrations are included automatically.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

const SCHEMA_FILE = path.join(config.serverRoot, 'db', 'schema.sql');
const MIGRATIONS_DIR = path.join(config.serverRoot, 'db', 'migrations');

let db = null;

function open() {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  if (config.testMode) {
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try { fs.unlinkSync(config.dbPath + suffix); } catch (_) { /* not there */ }
    }
  }
  db = new Database(config.dbPath);
  // Single-file rollback journal: everything lives in DB_PATH (simple for TC-NFR-04 inspection).
  db.pragma('journal_mode = DELETE');
  db.pragma(config.testMode ? 'synchronous = OFF' : 'synchronous = FULL');
  db.pragma('foreign_keys = OFF'); // REFERENCES are documentation only; seed may insert in any order
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Split SQL text into statements (handles quotes, comments and CREATE TRIGGER … BEGIN … END;).
 */
function splitSql(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  let inS = false, inD = false, inLine = false, inBlock = false;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (inLine) { cur += c; if (c === '\n') inLine = false; i++; continue; }
    if (inBlock) { cur += c; if (c === '*' && n === '/') { cur += n; i += 2; inBlock = false; continue; } i++; continue; }
    if (inS) { cur += c; if (c === "'") inS = false; i++; continue; }
    if (inD) { cur += c; if (c === '"') inD = false; i++; continue; }
    if (c === '-' && n === '-') { inLine = true; cur += c; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; cur += c; i++; continue; }
    if (c === "'") { inS = true; cur += c; i++; continue; }
    if (c === '"') { inD = true; cur += c; i++; continue; }
    if (c === ';') {
      const stripped = cur.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (/\bCREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(stripped) && !/\bEND$/i.test(stripped)) {
        cur += c; i++; continue; // inside trigger body
      }
      if (stripped) out.push(stripped + ';');
      cur = ''; i++; continue;
    }
    cur += c; i++;
  }
  const rest = cur.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (rest) out.push(rest);
  return out;
}

const TOLERATED = /duplicate column name|already exists/i;

/** Run SQL statement by statement; tolerated errors are warnings. Returns number of hard errors. */
function execTolerant(sql, label) {
  let hard = 0;
  for (const stmt of splitSql(sql)) {
    try {
      db.exec(stmt);
    } catch (e) {
      if (TOLERATED.test(e.message)) {
        console.warn(`[db] ${label}: skipped (${e.message})`);
      } else {
        hard++;
        console.error(`[db] ERROR in ${label}: ${e.message}\n      statement: ${stmt.slice(0, 200)}`);
      }
    }
  }
  return hard;
}

function applySchema() {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const hard = execTolerant(sql, 'schema.sql');
  if (hard) throw new Error(`schema.sql has ${hard} error(s)`);
}

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

function applyMigrations() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  const applied = [];
  for (const f of migrationFiles()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const hard = execTolerant(sql, `migrations/${f}`);
    if (hard === 0) {
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
      applied.push(f);
    }
  }
  return applied;
}

function init() {
  if (!db) open();
  applySchema();
  const applied = applyMigrations();
  return { db, applied };
}

/** User tables (excludes sqlite internals and _migrations). */
function tableNames() {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_migrations' ORDER BY name"
  ).all().map((r) => r.name);
}

/**
 * Delete all rows of all tables and reset AUTOINCREMENT counters. The append-only triggers on
 * `audit` are dropped for the wipe and recreated from schema.sql right after.
 * Must be called inside a transaction by the caller (lib/reset.js does).
 */
function wipeAll() {
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'audit'").all();
  for (const t of triggers) db.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
  for (const t of tableNames()) db.exec(`DELETE FROM "${t}"`);
  const hasSeq = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").get();
  if (hasSeq) db.exec('DELETE FROM sqlite_sequence');
  applySchema(); // recreates triggers (everything else already exists)
}

module.exports = {
  get db() { if (!db) open(); return db; },
  init, wipeAll, tableNames, splitSql, applySchema, applyMigrations,
  SCHEMA_FILE, MIGRATIONS_DIR,
};
