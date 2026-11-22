'use strict';

const path = require('node:path');

const CSV_COLUMNS = ['time', 'username', 'role', 'event', 'caseNo', 'fromStatus', 'toStatus', 'detail'];

function csvField(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

module.exports = function register(app, { db, clock, session, audit, errors }) {
  const requireAuditor = session.requireRole('auditor');
  const { AUDIT_EVENTS, toApi } = audit;
  const { ApiError, sendError } = errors;
  const selectAudit = db.prepare(`
    SELECT id, time, username, role, event, case_no, from_status, to_status, detail
    FROM audit
    WHERE (@actor = '' OR username = @actor)
      AND (@event = '' OR event = @event)
      AND (@start IS NULL OR time >= @start)
      AND (@end IS NULL OR time <= @end)
    ORDER BY time DESC, id DESC
  `);

  function readFilters({ actor = '', event = '', from = '', to = '' }) {
    if (typeof actor !== 'string' || (event !== '' && !AUDIT_EVENTS.includes(event))) {
      throw new ApiError('BAD_REQUEST');
    }
    for (const date of [from, to]) {
      if (date === '') continue;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !clock.parseIso(`${date}T00:00:00+07:00`)) {
        throw new ApiError('BAD_REQUEST');
      }
    }
    return { actor: actor.trim(), event, from, to };
  }

  function findItems({ actor, event, from, to }) {
    // Stored timestamps share Bangkok's offset and use second precision.
    const start = from ? `${from}T00:00:00+07:00` : null;
    const end = to ? `${to}T23:59:59+07:00` : null;
    return selectAudit.all({ actor, event, start, end }).map(toApi);
  }

  app.all(['/api/audit', '/api/audit/:id'], (req, res, next) => {
    if (!['PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const readable = !req.params.id || req.params.id.toLowerCase() === 'export.csv';
    res.set('Allow', readable ? 'GET, HEAD' : '');
    return sendError(res, 'METHOD_NOT_ALLOWED');
  });

  app.get('/audit', requireAuditor, (req, res) => {
    const filters = readFilters(req.query);
    const query = new URLSearchParams(filters);
    res.set('Cache-Control', 'no-store').page(path.join(__dirname, 'views', 'audit.ejs'), {
      title: 'ประวัติการทำรายการ (Audit Trail)', filters, items: findItems(filters),
      events: AUDIT_EVENTS, exportUrl: `/api/audit/export.csv?${query}`,
    });
  });

  app.get('/api/audit', requireAuditor, (req, res) => {
    const items = findItems(readFilters(req.query));
    res.set('Cache-Control', 'no-store').json({ count: items.length, items });
  });

  app.get('/api/audit/export.csv', requireAuditor, (req, res) => {
    const lines = findItems(readFilters(req.query))
      .map(item => CSV_COLUMNS.map(key => csvField(item[key])).join(','));
    const csv = [CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n';
    if (req.method === 'GET') audit.logAudit({ user: req.user, event: 'EXPORT', detail: 'audit-csv' });
    res.set('Cache-Control', 'no-store').attachment('audit.csv').type('text/csv').send(csv);
  });
};
