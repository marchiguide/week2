'use strict';

const path = require('node:path');

module.exports = function register(app, { db, session }) {
  const requireNotificationsRole = session.requireRole('officer', 'head');
  const listNotifications = db.prepare(`
    SELECT id, case_no AS caseNo, level, text, created_at AS createdAt
    FROM notifications
    WHERE recipient = ?
    ORDER BY created_at DESC, id DESC
  `);

  app.get('/notifications', requireNotificationsRole, (req, res) => {
    res.page(path.join(__dirname, 'views', 'notifications.ejs'), {
      title: 'แจ้งเตือน',
      items: listNotifications.all(req.user.username),
    });
  });

  app.get('/api/notifications', requireNotificationsRole, (req, res) => {
    res.json({ items: listNotifications.all(req.user.username) });
  });
};
