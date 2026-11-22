'use strict';

const path = require('node:path');

const SIMULATED_OTP = '123456';
const MAX_OTP_FAILURES = 3;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const LANDING = {
  citizen: '/citizen',
  officer: '/officer/queue',
  head: '/head/approvals',
  executive: '/dashboard',
  auditor: '/audit',
  admin: '/admin/services',
};

function landingFor(user) {
  if (!user) return '/login';
  if (user.kind === 'citizen' && !user.registered) return '/register';
  return LANDING[user.role];
}

module.exports = function register(app, { db, clock, crypto, format, session, audit, errors }) {
  const { ApiError } = errors;
  const findCitizen = db.prepare('SELECT id, registered FROM citizens WHERE id_hash = ?');
  const findLock = db.prepare('SELECT fail_count, locked_until FROM otp_locks WHERE id_hash = ?');
  const clearLock = db.prepare('DELETE FROM otp_locks WHERE id_hash = ?');
  const saveLock = db.prepare(`
    INSERT INTO otp_locks (id_hash, fail_count, last_fail_at, locked_until) VALUES (?, ?, ?, ?)
    ON CONFLICT (id_hash) DO UPDATE SET fail_count = excluded.fail_count,
      last_fail_at = excluded.last_fail_at, locked_until = excluded.locked_until
  `);
  const updateCitizen = db.prepare(`
    UPDATE citizens SET mobile_enc = ?, email = ?, consent_at = ?, registered_at = ?, registered = 1
    WHERE id = ? AND registered = 0
  `);
  const findStaff = db.prepare(`
    SELECT id, username, password_hash, role, dept FROM users WHERE username = ? AND active = 1
  `);
  const unusedPasswordHash = crypto.hashPassword(crypto.randomToken());

  function idHashFor(idNo) {
    if (typeof idNo !== 'string' || idNo.length !== 13 || !format.isValidThaiId(idNo)) {
      throw new ApiError('INVALID_ID');
    }
    return crypto.blindIndex(idNo);
  }

  function activeLockError(lock, now) {
    if (lock?.locked_until && now < clock.toMs(lock.locked_until)) {
      return new ApiError('LOCKED', { lockedUntil: lock.locked_until });
    }
  }

  const verifyOtp = db.transaction((idHash, otp) => {
    const now = clock.nowMs();
    const lock = findLock.get(idHash);
    const locked = activeLockError(lock, now);
    if (locked) return locked;

    if (otp !== SIMULATED_OTP) {
      const priorFailures = lock && !lock.locked_until ? lock.fail_count : 0;
      const failCount = priorFailures + 1;
      const lockedUntil = failCount >= MAX_OTP_FAILURES ? clock.toIso(now + LOCK_DURATION_MS) : null;
      saveLock.run(idHash, failCount, clock.toIso(now), lockedUntil);
      if (lockedUntil) return new ApiError('LOCKED', { lockedUntil });
      return new ApiError('OTP_INVALID', { attemptsLeft: MAX_OTP_FAILURES - failCount });
    }

    clearLock.run(idHash);
    return findCitizen.get(idHash);
  });

  const completeRegistration = db.transaction((req, mobile, email) => {
    const now = clock.nowIso();
    const updated = updateCitizen.run(crypto.encrypt(mobile), email, now, now, req.user.citizenId);
    if (!updated.changes) throw new ApiError('INVALID_STATE');
    session.markRegistered(req);
  });

  const signInStaff = db.transaction((req, res, staff) => {
    audit.logAudit({ username: staff.username, role: staff.role, event: 'STAFF_LOGIN' });
    session.createSession(res, { kind: 'staff', userId: staff.id, role: staff.role, dept: staff.dept }, req);
  });

  function renderAuth(res, view, title) {
    res.set('Cache-Control', 'no-store');
    res.page(path.join(__dirname, 'views', view), {
      title,
      scripts: ['/static/auth/forms.js'],
      styles: ['/static/auth/auth.css'],
    });
  }

  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store').redirect(302, landingFor(req.user));
  });

  app.get('/login', (req, res) => renderAuth(res, 'login.ejs', 'เข้าสู่ระบบ'));

  app.get('/register', (req, res) => {
    const landing = landingFor(req.user);
    if (landing !== '/register') return res.set('Cache-Control', 'no-store').redirect(302, landing);
    renderAuth(res, 'register.ejs', 'ลงทะเบียนประชาชน');
  });

  app.post('/api/auth/thaid/start', (req, res) => {
    const idHash = idHashFor(req.body?.idNo);
    const locked = activeLockError(findLock.get(idHash), clock.nowMs());
    if (locked) throw locked;
    res.json({ status: 'OTP_SENT' });
  });

  app.post('/api/auth/thaid/verify', (req, res) => {
    const citizen = verifyOtp.immediate(idHashFor(req.body?.idNo), req.body?.otp);
    if (citizen instanceof ApiError) throw citizen;
    // The local ThaiD directory contains the seeded identities and their display names.
    if (!citizen) throw new ApiError('INVALID_ID');

    const registered = Boolean(citizen.registered);
    session.createSession(res, { kind: 'citizen', citizenId: citizen.id, registerOnly: !registered }, req);
    res.json({ registered });
  });

  app.post('/api/auth/register', session.requireRegistering(), (req, res) => {
    if (req.user.registered) throw new ApiError('INVALID_STATE');
    const { mobile, email, consent } = req.body || {};
    if (typeof mobile !== 'string' || mobile.length !== 10 || !format.isValidMobile(mobile)) {
      throw new ApiError('INVALID_MOBILE');
    }
    if (consent !== true) throw new ApiError('CONSENT_REQUIRED');

    completeRegistration.immediate(req, mobile, typeof email === 'string' ? email.trim() : '');
    res.status(201).end();
  });

  app.post('/api/auth/staff/login', (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new ApiError('INVALID_CREDENTIALS');
    }
    const staff = findStaff.get(username);
    const passwordMatches = crypto.verifyPassword(password, staff?.password_hash ?? unusedPasswordHash);
    if (!staff || !passwordMatches) throw new ApiError('INVALID_CREDENTIALS');

    signInStaff.immediate(req, res, staff);
    res.json({ role: staff.role, dept: staff.dept, landing: LANDING[staff.role] });
  });

  app.post('/api/auth/logout', (req, res) => {
    session.destroySession(req, res);
    res.status(204).end();
  });

  app.get('/api/me', session.requireLogin(), (req, res) => {
    const { username, name, role, dept } = req.user;
    res.set('Cache-Control', 'no-store').json({ username, name, role, dept });
  });
};
