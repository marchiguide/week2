'use strict';
/**
 * Block B05 · citizen pages + APIs (CONTRACT §1 §2.4 §2.5 §2.6 §6.2 §6.7 §8 · DECISIONS §3–§7 §9 §11 §18).
 *
 * Pages   GET /citizen · /citizen/new/:service[?draft=DR-xxxx] · /citizen/cases/:caseNo
 * Drafts  POST/GET /api/drafts · GET/PATCH/DELETE /api/drafts/:id · POST /api/drafts/:id/files
 *         DELETE /api/drafts/:id/files/:fileId · POST /api/drafts/:id/payment
 * Pay     GET /api/payments/:ref (+ /qr.svg) · POST /api/test/payments/:ref/pay (TEST_MODE only, no login)
 * Cases   GET /api/cases · GET /api/cases/:caseNo · POST /api/cases/:caseNo/cancel · POST …/resubmit
 * Files   GET /api/cases/:caseNo/files · GET /api/files/:fileId
 * (GET /api/documents/:docNo/pdf lives in modules/documents — block B07.)
 */
const path = require('path');
const QRCode = require('qrcode');
const svc = require('./service');

const VIEWS = path.join(__dirname, 'views');
const STYLES = ['/static/citizen/citizen.css'];

let verificationUrl;
try {
  ({ verificationUrl } = require('../documents/documents'));
} catch (_) { /* documents module missing → local fallback below */ }
function verifyUrl(req, code) {
  if (typeof verificationUrl === 'function') return verificationUrl(req, code);
  const origin = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return new URL(`/verify/${encodeURIComponent(code)}`, origin).href;
}

/** JSON for an inline <script type="application/json"> (no "</script>" breakout). */
function inlineJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function contentDisposition(name) {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

module.exports = function register(app, ctx) {
  const { session, errors, config, format: fmt, codes, view } = ctx;
  const citizenOnly = session.requireRole('citizen');
  const caseReaders = session.requireRole('citizen', 'officer', 'head');

  // ================================================================ pages

  app.get('/citizen', citizenOnly, (req, res) => {
    const services = codes.SERVICE_IDS.map((id) => {
      const row = svc.serviceRow(id);
      return { id, name: fmt.serviceName(id), fee: row.fee, feePerSqm: row.fee_per_sqm, sla: row.sla, feeType: row.fee_type };
    });
    res.page(path.join(VIEWS, 'home.ejs'), {
      title: 'คำขอของฉัน',
      styles: STYLES,
      scripts: ['/static/citizen/home.js'],
      services,
      cases: svc.listMyCases(req.user.citizenId),
      drafts: svc.listDrafts(req.user.citizenId),
    });
  });

  app.get('/citizen/new/:service', citizenOnly, (req, res) => {
    const serviceId = String(req.params.service || '').toUpperCase();
    const def = svc.serviceDef(serviceId);
    if (!def || req.params.service !== serviceId) return view.renderErrorPage(req, res, 404, 'page-not-found');

    let draft = null;
    if (req.query.draft) {
      let row;
      try { row = svc.getOwnDraft(req.user.citizenId, String(req.query.draft)); } catch (_) { return session.notFound(req, res); }
      if (row.service_id !== serviceId) {
        return res.redirect(302, `/citizen/new/${row.service_id}?draft=${encodeURIComponent(row.draft_id)}`);
      }
      draft = svc.draftJson(row);
    }

    const table = svc.feeTable(serviceId);
    const input = serviceId === 'SV-01' ? (draft ? draft.qty : 1) : serviceId === 'SV-03' ? (draft ? draft.areaSqm : null) : null;
    let initialFee = null;
    if (serviceId === 'SV-02') initialFee = table.flat;
    else if (input != null && table.valid[input] !== undefined) initialFee = table.valid[input];
    if (draft && draft.feeLocked) initialFee = draft.fee;

    const state = {
      serviceId,
      serviceName: def.name,
      docs: def.docs.map((d) => ({ key: d.key, name: d.name, required: !!d.required, pdfOnly: !!d.pdfOnly })),
      extraKey: svc.EXTRA_KEY,
      feeTable: table,
      draft,
      step: svc.wizardStep(draft),
      maxFiles: codes.MAX_FILES_PER_CASE,
      maxBytes: codes.MAX_FILE_BYTES,
    };
    res.page(path.join(VIEWS, 'wizard.ejs'), {
      title: 'ยื่นคำขอ',
      styles: STYLES,
      scripts: ['/static/citizen/wizard.js'],
      def,
      serviceId,
      draft,
      step: state.step,
      inputValue: input == null ? '' : String(input),
      initialFee,
      table,
      stateJson: inlineJson(state),
    });
  });

  app.get('/citizen/cases/:caseNo', citizenOnly, async (req, res) => {
    const c = svc.loadCase(req.params.caseNo);
    if (!svc.citizenCanView(req.user, c)) return session.notFound(req, res);
    const v = svc.caseView(c, req.user);
    let qrSvg = '';
    let docUrl = '';
    if (v.doc) {
      docUrl = verifyUrl(req, v.doc.verify_code);
      try { qrSvg = await QRCode.toString(docUrl, { type: 'svg', margin: 1, width: 160 }); } catch (_) { qrSvg = ''; }
    }
    res.page(path.join(VIEWS, 'case.ejs'), {
      title: `คำขอ ${c.case_no}`,
      styles: STYLES,
      scripts: ['/static/citizen/case.js'],
      v,
      qrSvg,
      docUrl,
    });
  });

  // ================================================================ drafts API

  app.post('/api/drafts', citizenOnly, (req, res) => {
    res.status(201).json(svc.createDraft(req.user.citizenId, req.body || {}));
  });

  app.get('/api/drafts', citizenOnly, (req, res) => {
    res.json({ items: svc.listDrafts(req.user.citizenId) });
  });

  app.get('/api/drafts/:id', citizenOnly, (req, res) => {
    const d = svc.draftJson(svc.getOwnDraft(req.user.citizenId, req.params.id));
    // CONTRACT §6.2 shows {items:[…]}; the draft itself is also given at top level (files, missing, payment).
    res.json({ ...d, items: [d] });
  });

  const patchDraft = (req, res) => {
    res.json(svc.updateDraft(req.user.citizenId, req.params.id, req.body || {}));
  };
  app.patch('/api/drafts/:id', citizenOnly, patchDraft);
  app.put('/api/drafts/:id', citizenOnly, patchDraft);

  app.delete('/api/drafts/:id', citizenOnly, (req, res) => {
    svc.deleteDraft(req.user.citizenId, req.params.id);
    res.status(204).end();
  });

  app.post('/api/drafts/:id/files', citizenOnly, ctx.upload.single('file'), (req, res) => {
    const docKey = req.body && req.body.docKey;
    res.status(201).json(svc.addDraftFile(req.user.citizenId, req.params.id, req.file, docKey));
  });

  app.delete('/api/drafts/:id/files/:fileId', citizenOnly, (req, res) => {
    svc.removeDraftFile(req.user.citizenId, req.params.id, req.params.fileId);
    res.status(204).end();
  });

  app.post('/api/drafts/:id/payment', citizenOnly, (req, res) => {
    res.status(201).json(svc.createPayment(req.user.citizenId, req.params.id));
  });

  // ================================================================ payments

  app.get('/api/payments/:ref', citizenOnly, (req, res) => {
    res.set('Cache-Control', 'no-store').json(svc.getPayment(req.user.citizenId, req.params.ref));
  });

  app.get('/api/payments/:ref/qr.svg', citizenOnly, async (req, res) => {
    const p = svc.getOwnPaymentRow(req.user.citizenId, req.params.ref);
    if (!p) return errors.sendError(res, 'NOT_FOUND', {}, 'ไม่พบรายการชำระเงิน');
    // Simulated PromptPay payload (not a real EMVCo QR): biller + ref + amount.
    const payload = `SIMULATED-PROMPTPAY|SUKJAI-MUNICIPALITY|${p.ref}|${Number(p.amount).toFixed(2)}`;
    const svg = await QRCode.toString(payload, { type: 'svg', margin: 1, width: 200 });
    res.set('Cache-Control', 'private, no-store').type('image/svg+xml').send(svg);
  });

  if (config.testMode) {
    // Simulated bank callback (CONTRACT §8). No login: the "bank" calls it.
    app.post('/api/test/payments/:ref/pay', (req, res) => {
      res.json(svc.payByRef(req.params.ref, req.body ? req.body.amount : undefined));
    });
  }

  // ================================================================ cases

  app.get('/api/cases', citizenOnly, (req, res) => {
    res.json({ items: svc.listMyCases(req.user.citizenId) });
  });

  app.get('/api/cases/:caseNo', caseReaders, (req, res) => {
    const c = svc.loadCase(req.params.caseNo);
    if (!c) return session.notFound(req, res);
    if (req.user.kind === 'citizen' && !svc.citizenCanView(req.user, c)) return session.notFound(req, res);
    res.set('Cache-Control', 'private, no-store').json(svc.caseJson(c, req.user));
  });

  app.post('/api/cases/:caseNo/cancel', citizenOnly, (req, res) => {
    res.json(svc.cancelCase(req.user, req.params.caseNo));
  });

  app.post('/api/cases/:caseNo/resubmit', citizenOnly, ctx.upload.any(), (req, res) => {
    res.json(svc.resubmit(req.user, req.params.caseNo, req.files || [], req.body || {}));
  });

  // ================================================================ attachments (DECISIONS §18)

  function denyFiles(req, res, access) {
    if (access === 'notfound') return session.notFound(req, res);
    return session.forbidden(req, res);
  }

  app.get('/api/cases/:caseNo/files', caseReaders, (req, res) => {
    const c = svc.loadCase(req.params.caseNo);
    if (!c) return session.notFound(req, res);
    const access = svc.fileAccess(req.user, c);
    if (access !== 'ok') return denyFiles(req, res, access);
    res.set('Cache-Control', 'private, no-store').json({ items: svc.caseFiles(c.case_no) });
  });

  app.get('/api/files/:fileId', caseReaders, (req, res) => {
    const f = svc.fileRow(req.params.fileId);
    if (!f) return errors.sendError(res, 'NOT_FOUND', {}, 'ไม่พบไฟล์');
    const access = svc.fileRowAccess(req.user, f);
    if (access !== 'ok') return denyFiles(req, res, access);
    res.set({
      'Content-Type': f.mime,
      'Content-Length': String(f.data ? f.data.length : 0),
      'Content-Disposition': contentDisposition(f.name),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(f.data);
  });
};
