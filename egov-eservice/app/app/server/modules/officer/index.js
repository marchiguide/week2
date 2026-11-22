'use strict';
/**
 * Block B06 — officer / head workflow pages + APIs (CONTRACT §1 §2.6–2.8 §6.3).
 *
 * Pages:  GET /officer/queue (officer · head read-only) · GET /officer/cases/:caseNo (officer · head)
 *         GET /head/approvals (head)
 * APIs:   GET  /api/officer/queue?filter=all|unclaimed|mine
 *         POST /api/officer/cases/:caseNo/{claim,return,forward,unmask}
 *         POST /api/cases/:caseNo/{approve,reject}
 *         (POST /api/officer/cases/:caseNo/issue belongs to documents/ — B07)
 * Staff fallbacks (only reached if an earlier module passes them on): GET /api/cases/:caseNo,
 *         GET /api/cases/:caseNo/files, GET /api/files/:fileId for officer/head (masked, scoped).
 * All business rules live in ./service.js.
 */
const path = require('path');
const svc = require('./service');

const VIEWS = path.join(__dirname, 'views');
const SCRIPTS = ['/static/officer/officer.js'];
const STYLES = ['/static/officer/officer.css'];

function verificationUrl(req, code) {
  try {
    const docs = require('../documents/documents');
    if (docs && typeof docs.verificationUrl === 'function') return docs.verificationUrl(req, code);
  } catch (_) { /* documents module not present */ }
  const origin = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return new URL(`/verify/${encodeURIComponent(code)}`, origin).href;
}

async function qrSvg(url) {
  try {
    const QRCode = require('qrcode');
    return await QRCode.toString(url, { type: 'svg', margin: 1, width: 160 });
  } catch (_) {
    return '';
  }
}

module.exports = function register(app, ctx) {
  const { session } = ctx;
  const officerOrHead = session.requireRole('officer', 'head');
  const officerOnly = session.requireRole('officer');
  const headOnly = session.requireRole('head');

  // ------------------------------------------------------------ pages

  app.get('/officer/queue', officerOrHead, (req, res) => {
    const filter = ['all', 'unclaimed', 'mine'].includes(req.query.filter) ? req.query.filter : 'all';
    const rows = svc.queueRows(req.user, filter);
    res.page(path.join(VIEWS, 'queue.ejs'), {
      title: 'คิวงาน',
      filter,
      rows,
      workload: req.user.role === 'officer' ? svc.workload(req.user.username) : null,
      scripts: SCRIPTS,
      styles: STYLES,
    });
  });

  app.get('/officer/cases/:caseNo', officerOrHead, async (req, res) => {
    let v;
    try {
      v = svc.caseView(req.params.caseNo, req.user);
    } catch (e) {
      if (e && e.code === 'NOT_FOUND') return session.notFound(req, res);
      throw e;
    }
    let qr = null;
    if (v.doc) {
      const url = verificationUrl(req, v.doc.verify_code);
      qr = { url, svg: await qrSvg(url) };
    }
    res.page(path.join(VIEWS, 'case.ejs'), {
      title: `คำขอ ${v.caseNo}`,
      hideTitle: true,
      v,
      qr,
      scripts: SCRIPTS,
      styles: STYLES,
    });
  });

  app.get('/head/approvals', headOnly, (req, res) => {
    res.page(path.join(VIEWS, 'approvals.ejs'), {
      title: 'รายการรออนุมัติ',
      rows: svc.approvalRows(),
      styles: STYLES,
    });
  });

  // ------------------------------------------------------------ APIs

  app.get('/api/officer/queue', officerOrHead, (req, res) => {
    res.json({ items: svc.queueApiItems(req.user, req.query.filter) });
  });

  app.post('/api/officer/cases/:caseNo/claim', officerOnly, (req, res) => {
    res.json(svc.claim(req.params.caseNo, req.user));
  });

  app.post('/api/officer/cases/:caseNo/return', officerOnly, (req, res) => {
    res.json(svc.returnCase(req.params.caseNo, req.user, req.body || {}));
  });

  app.post('/api/officer/cases/:caseNo/forward', officerOnly, (req, res) => {
    res.json(svc.forward(req.params.caseNo, req.user, req.body || {}));
  });

  app.post('/api/cases/:caseNo/approve', officerOrHead, (req, res) => {
    res.json(svc.approve(req.params.caseNo, req.user));
  });

  app.post('/api/cases/:caseNo/reject', officerOrHead, (req, res) => {
    res.json(svc.reject(req.params.caseNo, req.user, req.body || {}));
  });

  app.post('/api/officer/cases/:caseNo/unmask', officerOrHead, (req, res) => {
    res.json(svc.unmask(req.params.caseNo, req.user, req.body || {}));
  });

  // ------------------------------------------------------------ staff fallbacks (citizen → next module)

  function staffOnly(req, res, next) {
    if (req.user && req.user.role === 'citizen') return next('route');
    return officerOrHead(req, res, next);
  }

  app.get('/api/cases/:caseNo', staffOnly, (req, res) => {
    res.json(svc.staffCaseJson(req.params.caseNo));
  });

  app.get('/api/cases/:caseNo/files', staffOnly, (req, res) => {
    res.json({ items: svc.staffFiles(req.params.caseNo, req.user) });
  });

  app.get('/api/files/:fileId', staffOnly, (req, res) => {
    const f = svc.staffFile(req.params.fileId, req.user);
    res.set('Content-Type', f.mime || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(f.data);
  });
};
