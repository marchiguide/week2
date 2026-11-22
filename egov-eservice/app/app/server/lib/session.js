'use strict';
/**
 * Cookie sessions stored in table `sessions` (wiped by POST /api/test/reset → everybody must log in again).
 *
 * server/index.js mounts loadSession for every request, which sets:
 *   req.session  row (or null)
 *   req.user     null | {
 *                  kind: 'staff'|'citizen', role, dept, name,
 *                  username,            // staff username ('off.reg1'); citizen → null
 *                  userId,              // staff users.id
 *                  citizenId,           // citizens.id
 *                  registered,          // citizen: false while only /register is allowed
 *                }
 *
 * Login (B04):   createSession(res, { kind:'staff', userId, role, dept })
 *                createSession(res, { kind:'citizen', citizenId, registerOnly: true|false })
 * Logout:        destroySession(req, res)
 *
 * Guards (work for pages and APIs; API = path starts with /api/):
 *   requireLogin()                    page → 302 /login        · API → 401 UNAUTHENTICATED
 *   requireRole('officer','head')     + wrong role: page → 403 forbidden-msg · API → 403 FORBIDDEN
 *                                     citizen with register-only session: page → 302 /register · API → 403
 *   requireRegistering()              only a citizen session (register-only or registered) — for /register
 * Helpers:
 *   forbidden(req,res)  notFound(req,res)  (403/404 page with forbidden-msg / not-found-msg, or JSON)
 */
const { db } = require('./db');
const clock = require('./clock');
const crypto = require('./crypto');
const { sendError } = require('./errors');

const COOKIE = 'sid';

function isApi(req) {
  return (req.originalUrl || req.url || '').startsWith('/api/');
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch (_) { out[k] = v; }
  }
  return out;
}

function setCookie(res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec != null) parts.push(`Max-Age=${maxAgeSec}`);
  res.append('Set-Cookie', parts.join('; '));
}

function buildUser(s) {
  if (!s) return null;
  if (s.kind === 'staff') {
    const u = db.prepare('SELECT id, username, name, active FROM users WHERE id = ?').get(s.user_id);
    if (!u || !u.active) return null;
    return {
      kind: 'staff', role: s.role, dept: s.dept || null, name: u.name,
      username: u.username, userId: u.id, citizenId: null, registered: true,
    };
  }
  const c = db.prepare('SELECT id, name, registered FROM citizens WHERE id = ?').get(s.citizen_id);
  if (!c) return null;
  const registered = !!c.registered && !s.register_only;
  return {
    kind: 'citizen', role: 'citizen', dept: null, name: c.name,
    username: null, userId: null, citizenId: c.id, registered,
  };
}

/** Express middleware: resolves the session cookie into req.session / req.user. */
function loadSession(req, res, next) {
  req.session = null;
  req.user = null;
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) {
    const s = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid);
    if (s) {
      const user = buildUser(s);
      if (user) { req.session = s; req.user = user; }
    }
  }
  res.locals.user = req.user;
  next();
}

/**
 * Create a session row + Set-Cookie. Replaces any current session of this request.
 * @param {object} o {kind:'staff', userId, role, dept} | {kind:'citizen', citizenId, registerOnly}
 * @returns {string} sid
 */
function createSession(res, o, req) {
  if (req) destroySession(req, res, { keepCookie: true });
  const sid = crypto.randomToken();
  const role = o.kind === 'citizen' ? 'citizen' : o.role;
  db.prepare(
    `INSERT INTO sessions (sid, kind, user_id, citizen_id, role, dept, register_only, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sid, o.kind, o.userId || null, o.citizenId || null, role, o.dept || null,
    o.registerOnly ? 1 : 0, o.data ? JSON.stringify(o.data) : null, clock.nowIso());
  setCookie(res, sid);
  return sid;
}

/** Mark the current citizen session as fully registered (after POST /api/auth/register). */
function markRegistered(req) {
  if (req.session) db.prepare('UPDATE sessions SET register_only = 0 WHERE sid = ?').run(req.session.sid);
}

function destroySession(req, res, opts = {}) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
  if (!opts.keepCookie) setCookie(res, '', 0);
  req.session = null;
  req.user = null;
}

function clearAllSessions() {
  db.prepare('DELETE FROM sessions').run();
}

// ---------------------------------------------------------------- error responses (page or JSON)

function renderStatusPage(req, res, status, kind) {
  // lazy require to avoid a cycle (view.js uses session helpers indirectly)
  const view = require('./view');
  return view.renderErrorPage(req, res, status, kind);
}

/** 403: page with forbidden-msg 'ไม่มีสิทธิ์เข้าถึงหน้านี้' / API {code:'FORBIDDEN'} */
function forbidden(req, res) {
  if (isApi(req)) return sendError(res, 'FORBIDDEN');
  return renderStatusPage(req, res, 403, 'forbidden');
}
/** 404 of a case: page with not-found-msg 'ไม่พบคำขอ' / API {code:'NOT_FOUND'} (same for "other's" and "missing") */
function notFound(req, res) {
  if (isApi(req)) return sendError(res, 'NOT_FOUND');
  return renderStatusPage(req, res, 404, 'not-found');
}
function unauthenticated(req, res) {
  if (isApi(req)) return sendError(res, 'UNAUTHENTICATED');
  return res.redirect(302, '/login');
}

// ---------------------------------------------------------------- guards

function requireLogin() {
  return function requireLoginMw(req, res, next) {
    if (!req.user) return unauthenticated(req, res);
    if (req.user.kind === 'citizen' && !req.user.registered) {
      if (isApi(req)) return sendError(res, 'FORBIDDEN');
      return res.redirect(302, '/register');
    }
    next();
  };
}

/** requireRole('citizen') · requireRole('officer','head') · requireRole(['admin']) */
function requireRole(...roles) {
  const allowed = new Set(roles.flat());
  const login = requireLogin();
  return function requireRoleMw(req, res, next) {
    login(req, res, (err) => {
      if (err) return next(err);
      if (!allowed.has(req.user.role)) return forbidden(req, res);
      next();
    });
  };
}

/** For /register and POST /api/auth/register: a citizen session (register-only or registered). */
function requireRegistering() {
  return function requireRegisteringMw(req, res, next) {
    if (!req.user) return unauthenticated(req, res);
    if (req.user.kind !== 'citizen') return forbidden(req, res);
    next();
  };
}

module.exports = {
  COOKIE, isApi, parseCookies,
  loadSession, createSession, destroySession, clearAllSessions, markRegistered,
  requireLogin, requireRole, requireRegistering,
  forbidden, notFound, unauthenticated,
};
