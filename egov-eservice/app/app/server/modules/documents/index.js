'use strict';

const path = require('node:path');
const { issue, verify, findForDownload, verificationUrl } = require('./documents');
const { makePdf } = require('./pdf');

const VERIFY_VIEW = path.join(__dirname, 'views', 'verify.ejs');

module.exports = function register(app, { config, db, errors, session }) {
  app.post('/api/officer/cases/:caseNo/issue', session.requireRole('officer'), (req, res) => {
    res.json(issue(req.params.caseNo, req.user));
  });

  app.get('/api/documents/:docNo/pdf', async (req, res) => {
    const user = req.user;
    const isStaff = user?.role === 'officer' || user?.role === 'head';
    const isCitizen = user?.kind === 'citizen' && user.registered;
    if (!isStaff && !isCitizen) return session.notFound(req, res);

    const document = findForDownload(req.params.docNo);
    if (!document || (isCitizen && user.citizenId !== document.citizenId)) return session.notFound(req, res);

    const pdf = await makePdf(document, verificationUrl(req, document.verifyCode));
    return res.set('Cache-Control', 'private, no-store').attachment(`${document.docNo}.pdf`).send(pdf);
  });

  app.get('/api/verify/:code', (req, res) => {
    const document = verify(req.params.code);
    res.set('Cache-Control', 'no-store').status(document.result === 'NOT_FOUND' ? 404 : 200).json(document);
  });

  app.get('/verify/:code', (req, res) => {
    const document = verify(req.params.code);
    res.set('Cache-Control', 'no-store');
    res.page(VERIFY_VIEW, { title: 'ตรวจสอบเอกสาร', document }, document.result === 'NOT_FOUND' ? 404 : 200);
  });

  if (config.testMode) {
    app.post('/api/test/documents/:docNo/tamper', (req, res) => {
      const info = db.prepare(`
        UPDATE documents SET applicant = applicant || ' (แก้ไข)' WHERE doc_no = ?
      `).run(req.params.docNo);
      if (!info.changes) return errors.sendError(res, 'NOT_FOUND', {}, 'ไม่พบเอกสาร');
      return res.json({ ok: true });
    });
  }
};
