'use strict';

const path = require('node:path');

module.exports = function register(app, { db, clock, session, audit, errors, codes }) {
  const requireAdmin = session.requireRole('admin');
  const { ApiError } = errors;
  const services = db.prepare(`
    SELECT id, name, fee_type AS feeType, fee, fee_per_sqm AS feePerSqm, sla
    FROM services ORDER BY sort_order, id
  `);
  const serviceById = db.prepare('SELECT * FROM services WHERE id = ?');
  const saveService = db.prepare(`
    UPDATE services SET fee = ?, fee_per_sqm = ?, sla = ?, updated_at = ? WHERE id = ?
  `);
  const holidays = db.prepare('SELECT date, name FROM holidays ORDER BY date');
  const insertHoliday = db.prepare(`
    INSERT INTO holidays (date, name, created_at) VALUES (?, ?, ?) ON CONFLICT(date) DO NOTHING
  `);
  const removeHoliday = db.prepare('DELETE FROM holidays WHERE date = ?');
  const users = db.prepare('SELECT username, name, role, dept FROM users ORDER BY username');
  const userByUsername = db.prepare('SELECT role, dept FROM users WHERE username = ?');
  const saveUser = db.prepare('UPDATE users SET role = ?, dept = ?, updated_at = ? WHERE username = ?');

  function logChange(user, detail) {
    audit.logAudit({ user, event: 'ADMIN_CHANGE', detail });
  }

  function integerInRange(value, min, max, code) {
    if (!Number.isInteger(value) || value < min || value > max) throw new ApiError(code);
    return value;
  }

  const changeService = db.transaction((user, id, body) => {
    const current = serviceById.get(id);
    if (!current) throw new ApiError('ROUTE_NOT_FOUND');

    const areaBased = current.fee_type === 'area';
    const fee = integerInRange(areaBased ? body.feeBase : body.fee, 0, 100_000, 'INVALID_FEE');
    const feePerSqm = areaBased ? integerInRange(body.feePerSqm, 0, 100_000, 'INVALID_FEE') : null;
    const sla = integerInRange(body.sla, 1, 60, 'INVALID_SLA');
    const changes = [
      ['fee', current.fee, fee],
      ['feePerSqm', current.fee_per_sqm, feePerSqm],
      ['sla', current.sla, sla],
    ].filter(([, before, after]) => before !== after);

    if (changes.length) {
      saveService.run(fee, feePerSqm, sla, clock.nowIso(), id);
      for (const [field, before, after] of changes) logChange(user, `${id} ${field} ${before} → ${after}`);
    }
    return { id, fee, feePerSqm, sla };
  });

  function checkHolidayDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !clock.parseIso(`${date}T00:00:00+07:00`)) {
      throw new ApiError('BAD_REQUEST');
    }
  }

  const addHoliday = db.transaction((user, date, name) => {
    if (!insertHoliday.run(date, name, clock.nowIso()).changes) throw new ApiError('DUPLICATE_HOLIDAY');
    logChange(user, `holiday add ${date}`);
    return { date, name };
  });

  const deleteHoliday = db.transaction((user, date) => {
    if (!removeHoliday.run(date).changes) throw new ApiError('ROUTE_NOT_FOUND');
    logChange(user, `holiday delete ${date}`);
  });

  const changeUser = db.transaction((user, username, { role, dept = '' }) => {
    if (username === user.username) throw new ApiError('SELF_ROLE_CHANGE');
    const current = userByUsername.get(username);
    if (!current) throw new ApiError('ROUTE_NOT_FOUND');

    // Citizen identities are managed via ThaiD and have no staff username.
    if (typeof role !== 'string' || !Object.hasOwn(codes.ROLE, role) || role === 'citizen') {
      throw new ApiError('BAD_REQUEST');
    }
    const validDept = role === 'officer'
      ? typeof dept === 'string' && Object.hasOwn(codes.DEPT, dept)
      : dept === '' || dept === null;
    if (!validDept) {
      throw new ApiError('BAD_REQUEST');
    }
    dept = dept || null;

    if (current.role !== role || current.dept !== dept) {
      saveUser.run(role, dept, clock.nowIso(), username);
      const changes = [];
      if (current.role !== role) changes.push(`${username} role ${current.role} → ${role}`);
      if (current.dept !== dept) changes.push(`${username} dept ${current.dept ?? '–'} → ${dept ?? '–'}`);
      logChange(user, changes.join(' · '));
    }
    return { username, role, dept };
  });

  function page(res, name, title, locals) {
    res.set('Cache-Control', 'no-store').page(path.join(__dirname, 'views', `${name}.ejs`), {
      title, scripts: ['/static/admin/forms.js'], ...locals,
    });
  }

  app.get('/admin/services', requireAdmin, (req, res) => {
    page(res, 'services', 'ค่าธรรมเนียมและ SLA', { services: services.all() });
  });
  app.get('/admin/holidays', requireAdmin, (req, res) => {
    page(res, 'holidays', 'จัดการวันหยุด', { holidays: holidays.all() });
  });
  app.get('/admin/users', requireAdmin, (req, res) => {
    page(res, 'users', 'ผู้ใช้และบทบาท', { users: users.all() });
  });

  app.use('/api/admin', requireAdmin);
  app.get('/api/admin/services', (req, res) => {
    const items = services.all().map(({ id, fee, feePerSqm, sla }) => ({ id, fee, feePerSqm, sla }));
    res.set('Cache-Control', 'no-store').json({ items });
  });
  app.put('/api/admin/services/:id', (req, res) => {
    res.json(changeService.immediate(req.user, req.params.id, req.body ?? {}));
  });
  app.get('/api/admin/holidays', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ items: holidays.all() });
  });
  app.post('/api/admin/holidays', (req, res) => {
    const { date, name } = req.body ?? {};
    checkHolidayDate(date);
    if (typeof name !== 'string' || !name.trim()) throw new ApiError('BAD_REQUEST');
    res.status(201).json(addHoliday.immediate(req.user, date, name.trim()));
  });
  app.delete('/api/admin/holidays/:date', (req, res) => {
    checkHolidayDate(req.params.date);
    deleteHoliday.immediate(req.user, req.params.date);
    res.json({ ok: true });
  });
  app.get('/api/admin/users', (req, res) => {
    res.set('Cache-Control', 'no-store').json({ items: users.all() });
  });
  app.put('/api/admin/users/:username', (req, res) => {
    res.json(changeUser.immediate(req.user, req.params.username, req.body ?? {}));
  });
};
