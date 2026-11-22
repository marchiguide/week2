'use strict';
/**
 * Server-side pages with EJS + one shared layout (views/layout.ejs → header testids of CONTRACT §2.1).
 *
 * In a module:
 *   const path = require('path');
 *   router.get('/officer/queue', requireRole('officer','head'), (req, res) => {
 *     res.page(path.join(__dirname, 'views', 'queue.ejs'), { title: 'คิวงาน', rows });
 *   });
 *
 *   res.page(file, locals, status=200)   file: absolute path, or name relative to server/views
 *
 * Locals available in every template (body and layout):
 *   user (req.user|null) · fmt (lib/format) · codes (lib/codes) · clock (lib/clock) · nowIso
 *   testMode · title · currentPath · viewsDir · bellCount (officer/head)
 * Layout options (pass in locals):
 *   title        <title> + default <h1> text
 *   hideTitle    true → layout does not print <h1> (the body prints its own)
 *   bare         true → no app header (e.g. /login, /verify); anonymous visitors get a plain header anyway
 *   scripts      ['/static/x.js'] extra <script defer> tags · styles: ['/static/x.css']
 *
 * Client helpers (always loaded): /static/app.js → window.egov.api(method,url,body) ·
 *   egov.showError(msg) / egov.showSuccess(msg) (renders the single action-error / action-success element)
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const config = require('./config');
const clock = require('./clock');
const format = require('./format');
const codes = require('./codes');

const VIEWS_DIR = path.join(config.serverRoot, 'views');
const LAYOUT = path.join(VIEWS_DIR, 'layout.ejs');
const ERROR_VIEW = path.join(VIEWS_DIR, 'layout-error.ejs');

const ejsOpts = { cache: config.isProd, rmWhitespace: false };

function bellCountFor(user) {
  if (!user || (user.role !== 'officer' && user.role !== 'head')) return null;
  try {
    const hook = require('./notify-hook');
    if (hook && typeof hook.bellCount === 'function') return hook.bellCount(user);
  } catch (e) { console.error('[view] bellCount hook failed:', e.message); }
  const { db } = require('./db');
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE recipient = ?').get(user.username).n;
}

function baseLocals(req) {
  return {
    user: req.user || null,
    fmt: format,
    codes,
    clock,
    nowIso: clock.nowIso(),
    testMode: config.testMode,
    currentPath: req.path,
    viewsDir: VIEWS_DIR,
    title: 'e-Service เทศบาลในฝัน',
    hideTitle: false,
    bare: false,
    scripts: [],
    styles: [],
  };
}

function resolveView(file) {
  if (path.isAbsolute(file)) return file;
  const f = file.endsWith('.ejs') ? file : file + '.ejs';
  return path.join(VIEWS_DIR, f);
}

/** Synchronous EJS render of a template file (includes resolve relative to the file). */
function renderFile(file, data) {
  return ejs.render(fs.readFileSync(file, 'utf8'), data, { ...ejsOpts, filename: file });
}

/** Render body template inside the layout and send. */
function renderPage(req, res, file, locals = {}, status = 200) {
  const data = { ...baseLocals(req), ...res.locals, ...locals };
  data.user = req.user || null;
  data.bellCount = bellCountFor(data.user);
  const body = renderFile(resolveView(file), data);
  const html = renderFile(LAYOUT, { ...data, body });
  res.status(status).type('html').send(html);
}

const ERROR_TEXT = {
  forbidden: { testid: 'forbidden-msg', text: 'ไม่มีสิทธิ์เข้าถึงหน้านี้', title: 'ไม่มีสิทธิ์เข้าถึง' },
  'not-found': { testid: 'not-found-msg', text: 'ไม่พบคำขอ', title: 'ไม่พบคำขอ' },
  'page-not-found': { testid: null, text: 'ไม่พบหน้าที่ต้องการ', title: 'ไม่พบหน้า' },
  error: { testid: null, text: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง', title: 'เกิดข้อผิดพลาด' },
};

/** 403 / 404 / 500 page. kind: 'forbidden' | 'not-found' | 'page-not-found' | 'error' */
function renderErrorPage(req, res, status, kind) {
  const e = ERROR_TEXT[kind] || ERROR_TEXT.error;
  return renderPage(req, res, ERROR_VIEW, { title: e.title, hideTitle: true, err: e, status }, status);
}

/** Middleware: adds res.page(file, locals, status). */
function attach(req, res, next) {
  res.page = (file, locals, status) => renderPage(req, res, file, locals, status);
  next();
}

module.exports = { VIEWS_DIR, renderPage, renderErrorPage, renderFile, attach, baseLocals };
