'use strict';

const path = require('node:path');
const { kpiRows, createWorkbook, createPdf } = require('./report');

const PERIOD = /^[1-9]\d{3}(?:-(?:0[1-9]|1[0-2]))?$/;
const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

module.exports = function register(app, { db, clock, session, audit, codes, errors, bugs, format }) {
  const requireExecutive = session.requireRole('executive');
  const services = [{ id: 'ALL', name: 'ทุกบริการ' }, ...Object.values(codes.SERVICES)];
  const serviceIds = new Set(services.map(({ id }) => id));
  const backlogStatuses = codes.BACKLOG_STATUSES.map(status => `'${status}'`).join(', ');

  // Time columns use the same Bangkok ISO format, including seconds.
  const countCases = db.prepare(`
    WITH filtered AS (
      SELECT paid_at, due_at, status,
             CASE WHEN status IN ('COMPLETED', 'REJECTED') THEN closed_at END AS finished_at,
             status IN (${backlogStatuses}) AS is_backlog
      FROM cases
      WHERE @service = 'ALL' OR service_id = @service
    )
    SELECT COUNT(*) FILTER (WHERE paid_at GLOB @periodPrefix) AS received,
           COUNT(*) FILTER (WHERE finished_at GLOB @periodPrefix) AS closed,
           COUNT(*) FILTER (WHERE finished_at GLOB @periodPrefix AND finished_at <= due_at) AS onTime,
           COUNT(*) FILTER (WHERE is_backlog) AS backlog,
           COUNT(*) FILTER (WHERE is_backlog AND status <> 'NEED_FIX' AND due_at < @now) AS overdue
    FROM filtered
  `);

  // The workload represents every officer's current assignments, across all services.
  const countWorkload = db.prepare(`
    SELECT users.username, COUNT(cases.case_no) AS count
    FROM users
    LEFT JOIN cases ON cases.owner = users.username AND cases.status = 'IN_REVIEW'
    WHERE users.role = 'officer'
    GROUP BY users.username
    ORDER BY users.username
  `);

  const reportYears = db.prepare(`
    SELECT substr(paid_at, 1, 4) AS year FROM cases
    UNION SELECT substr(closed_at, 1, 4) FROM cases WHERE closed_at IS NOT NULL
  `).pluck();

  function readFilters({ period, service }, now) {
    period ??= now.slice(0, 7);
    service ??= 'ALL';
    if (typeof period !== 'string' || !PERIOD.test(period) || !serviceIds.has(service)) {
      throw new errors.ApiError('BAD_REQUEST');
    }
    return { period, service };
  }

  function summarize({ period, service }, now) {
    const totals = countCases.get({ periodPrefix: `${period}-*`, service, now });
    const denominator = bugs.bug('B10') ? totals.received : totals.closed;
    return { ...totals, ontimePct: format.pct(totals.onTime, denominator) };
  }

  app.get('/dashboard', requireExecutive, (req, res) => {
    const now = clock.nowIso();
    const filters = readFilters(req.query, now);
    const stats = summarize(filters, now);
    const years = [...new Set([...reportYears.all(), now.slice(0, 4), filters.period.slice(0, 4)])]
      .sort((a, b) => b - a);

    res.set('Cache-Control', 'no-store').page(path.join(__dirname, 'views', 'dashboard.ejs'), {
      title: 'Dashboard',
      styles: ['/static/dashboard/dashboard.css'],
      scripts: ['/static/dashboard/filters.js'],
      filters,
      years,
      services,
      rows: kpiRows(stats),
      workload: countWorkload.all(),
      exportQuery: new URLSearchParams(filters).toString(),
    });
  });

  app.get('/api/dashboard', requireExecutive, (req, res) => {
    const now = clock.nowIso();
    const stats = summarize(readFilters(req.query, now), now);
    res.set('Cache-Control', 'no-store').json({ ...stats, workload: countWorkload.all() });
  });

  app.get('/api/dashboard/export', requireExecutive, async (req, res) => {
    const { format } = req.query;
    if (format !== 'xlsx' && format !== 'pdf') throw new errors.ApiError('BAD_REQUEST');

    const generatedAt = clock.now();
    const now = clock.toIso(generatedAt);
    const filters = readFilters(req.query, now);
    const rows = kpiRows(summarize(filters, now));
    const file = format === 'xlsx'
      ? await createWorkbook(rows, generatedAt)
      : await createPdf(rows, filters, generatedAt);

    const { period, service } = filters;
    if (req.method === 'GET') {
      audit.logAudit({ user: req.user, event: 'EXPORT', detail: `${format} ${period} ${service}` });
    }
    res.set('Cache-Control', 'no-store')
      .attachment(`dashboard-${period}-${service}.${format}`)
      .type(CONTENT_TYPES[format])
      .send(file);
  });
};
