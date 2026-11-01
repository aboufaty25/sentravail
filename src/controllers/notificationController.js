const { Notification } = require('../models');
const notifications = require('../services/notifications');

async function index(req, res) {
  const list = await notifications.list(req.user.id);
  // Opening the tab clears the badge; items stay highlighted until opened.
  await notifications.markAllSeen(req.user.id);
  res.locals.unseenNotifications = 0;
  res.render('pages/notifications/index', {
    title: 'Notifications',
    activeTab: 'notifications',
    noAds: true,
    items: list.map((n) => ({ n, text: notifications.describe(n), icon: notifications.ICONS[n.type] })),
  });
}

async function open(req, res) {
  const n = await Notification.findOne({ where: { id: req.params.id, userId: req.user.id } });
  if (!n) return res.redirect('/notifications');
  await n.update({ read: true, seen: true }, { silent: true });
  const full = await Notification.findByPk(n.id, { include: ['actor'] });
  return res.redirect(notifications.linkFor(full));
}

async function readAll(req, res) {
  await notifications.markAllRead(req.user.id);
  if (req.get('HX-Request')) {
    res.set('HX-Refresh', 'true');
    return res.send('');
  }
  return res.redirect('/notifications');
}

function settings(req, res) {
  res.render('pages/notifications/settings', { title: 'Notifications par email', noAds: true });
}

async function saveSettings(req, res) {
  await req.user.update({ emailNotifications: req.body?.emailNotifications === 'on' });
  req.flash('success', req.user.emailNotifications ? 'Emails de notification activés.' : 'Emails de notification désactivés.');
  return res.redirect('/parametres/notifications');
}

module.exports = { index, open, readAll, settings, saveSettings };
