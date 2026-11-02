const { Op } = require('sequelize');
const { Notification, User, Follow } = require('../models');
const env = require('../config/env');
const { emitToUser } = require('../config/socket');
const { sendMail } = require('./mail');

// Likes, comments and shares on the same post are grouped while unread ("Awa et 3 autres…").
const GROUPED = new Set(['like', 'comment', 'share']);
const ACTOR_ATTRS = ['id', 'username', 'firstName', 'lastName', 'avatarUrl', 'role', 'companyName'];

// ---------- Background work (emails never slow down a request) ----------
const pending = new Set();
function background(fn) {
  const p = Promise.resolve()
    .then(fn)
    .catch((err) => console.error('[notifications]', err.message))
    .finally(() => pending.delete(p));
  pending.add(p);
  return p;
}
// Tests: wait for queued emails/emits.
async function flush() {
  while (pending.size) await Promise.all([...pending]);
}

// ---------- Text & links ----------
const quote = (s, n = 60) => (s ? `« ${String(s).replace(/\s+/g, ' ').slice(0, n)}${String(s).length > n ? '…' : ''} »` : '');

function actorName(n) {
  if (n.actor) return `${n.actor.firstName} ${n.actor.lastName}`;
  return n.data?.actorName || "Quelqu'un";
}

function describe(n) {
  const who = actorName(n);
  const others = n.count > 1 ? ` et ${n.count - 1} autre${n.count > 2 ? 's' : ''} personne${n.count > 2 ? 's' : ''}` : '';
  const verb = (one, many) => (n.count > 1 ? many : one);
  const d = n.data || {};
  switch (n.type) {
    case 'like': return `${who}${others} ${verb('a réagi', 'ont réagi')} à votre publication ${quote(d.snippet, 40)}`.trim();
    case 'comment': return `${who}${others} ${verb('a commenté', 'ont commenté')} votre publication ${quote(d.snippet, 40)}`.trim();
    case 'share': return `${who}${others} ${verb('a partagé', 'ont partagé')} votre publication`;
    case 'reply': return `${who} a répondu à votre commentaire : ${quote(d.snippet)}`;
    case 'follow': return `${who} s'est abonné(e) à vous`;
    case 'application': return `${who} a postulé à votre offre ${quote(d.jobTitle)}`;
    case 'application_status': return `Votre candidature ${quote(d.jobTitle)} : ${d.statusLabel}`;
    case 'job_approved': return `Votre offre ${quote(d.jobTitle)} est à la une jusqu'au ${d.until}`;
    case 'job_rejected': return `Mise à la une refusée pour ${quote(d.jobTitle)}${d.reason ? ` : ${d.reason}` : ''}`;
    case 'new_job_from_followed': return `${who} a publié une offre : ${quote(d.jobTitle)}`;
    case 'post_approved': return `Votre publication ${quote(d.snippet)} a été validée : elle est visible par tous.`;
    case 'post_rejected': return `Votre publication ${quote(d.snippet)} a été refusée${d.reason ? ` : ${d.reason}` : '.'}`;
    case 'verification_approved': return 'Votre compte est vérifié ✓ Le badge apparaît sur votre profil et vos publications.';
    case 'verification_rejected': return `Votre demande de badge vérifié a été refusée${d.reason ? ` : ${d.reason}` : '.'}`;
    default: return 'Nouvelle notification';
  }
}

function linkFor(n) {
  const d = n.data || {};
  switch (n.type) {
    case 'follow': return n.actor ? `/profil/${n.actor.username}` : '/reseau';
    case 'application': return n.applicationId ? `/candidatures/${n.applicationId}` : '/mes-offres';
    case 'application_status': return '/mes-candidatures';
    case 'job_approved':
    case 'job_rejected':
    case 'new_job_from_followed': return d.url || '/offres';
    case 'verification_approved':
    case 'verification_rejected': return '/parametres/verification';
    default: return n.postId ? `/publications/${n.postId}` : '/';
  }
}

const ICONS = { post_approved: '✅', post_rejected: '⛔', verification_approved: '✔️', verification_rejected: '⚠️', like: '👍', comment: '💬', reply: '💬', share: '↗️', follow: '👤', application: '📄', application_status: '📬', job_approved: '⭐', job_rejected: '⚠️', new_job_from_followed: '💼' };

// ---------- Email ----------
function emailHtml(title, lines, cta) {
  const body = lines.map((l) => `<p style="margin:0 0 12px">${l}</p>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#111827">
  <p style="font-size:22px;font-weight:bold;color:#1668e3;margin:0 0 16px">sentravail</p>
  <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>${body}
  ${cta ? `<p style="margin:20px 0"><a href="${cta.url}" style="background:#1668e3;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${cta.label}</a></p>` : ''}
  <p style="font-size:12px;color:#6b7280;margin-top:24px">Vous recevez cet email car vous avez un compte ou une candidature sur SenTravail.
  Gérer les emails : ${env.APP_URL}/parametres/notifications</p></div>`;
}

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function sendEmail({ to, subject, title, lines, cta }) {
  const text = [title, '', ...lines, '', cta ? `${cta.label} : ${cta.url}` : ''].join('\n');
  await sendMail({ to, subject, text, html: emailHtml(escape(title), lines.map(escape), cta) });
}

// ---------- Core ----------
async function unseenCount(userId) {
  return Notification.count({ where: { userId, seen: false } });
}

async function push(userId, n) {
  const full = await Notification.findByPk(n.id, { include: [{ model: User, as: 'actor', attributes: ACTOR_ATTRS }] });
  emitToUser(userId, 'notification', { unseen: await unseenCount(userId), text: describe(full), url: linkFor(full) });
}

/**
 * Creates (or groups) an in-app notification, pushes it in real time and optionally emails it.
 * Never notifies the actor themself or a banned recipient.
 */
async function notify({ userId, actorId = null, type, postId = null, applicationId = null, data = {}, email = null }) {
  if (!userId || (actorId && userId === actorId)) return null;
  const recipient = await User.findByPk(userId, { attributes: ['id', 'email', 'isBanned', 'emailNotifications', 'firstName'] });
  if (!recipient || recipient.isBanned) return null;

  let n = null;
  if (GROUPED.has(type) && postId) {
    n = await Notification.findOne({ where: { userId, type, postId, read: false }, order: [['updatedAt', 'DESC']] });
    if (n) {
      const sameActor = n.actorId === actorId;
      await n.update({ actorId, count: sameActor ? n.count : n.count + 1, seen: false, data: { ...n.data, ...data } });
    }
  }
  if (!n) n = await Notification.create({ userId, actorId, type, postId, applicationId, data });

  background(() => push(userId, n));
  if (email && recipient.emailNotifications) background(() => sendEmail({ to: recipient.email, ...email(recipient) }));
  return n;
}

// Email to an address that may not be a member (guest candidates).
function emailAddress(to, content) {
  return background(() => sendEmail({ to, ...content }));
}

// "Nouvelle offre" for every follower of the recruiter (in-app only).
async function notifyFollowersOfJob(author, post, job) {
  const followers = await Follow.findAll({ where: { followingId: author.id }, attributes: ['followerId'], raw: true });
  if (!followers.length) return;
  const banned = new Set(
    (await User.findAll({ where: { id: followers.map((f) => f.followerId), isBanned: true }, attributes: ['id'], raw: true })).map((u) => u.id)
  );
  const rows = followers
    .filter((f) => !banned.has(f.followerId))
    .map((f) => ({ userId: f.followerId, actorId: author.id, type: 'new_job_from_followed', postId: post.id, data: { jobTitle: job.title, url: `/offres/${job.slug}` } }));
  const created = await Notification.bulkCreate(rows);
  for (const n of created) background(() => push(n.userId, n));
}

async function list(userId, limit = 50) {
  return Notification.findAll({
    where: { userId },
    include: [{ model: User, as: 'actor', attributes: ACTOR_ATTRS }],
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit,
  });
}

async function markAllSeen(userId) {
  await Notification.update({ seen: true }, { where: { userId, seen: false }, silent: true });
  emitToUser(userId, 'notification:count', { unseen: 0 });
}

async function markAllRead(userId) {
  await Notification.update({ seen: true, read: true }, { where: { userId, [Op.or]: [{ seen: false }, { read: false }] }, silent: true });
  emitToUser(userId, 'notification:count', { unseen: 0 });
}

module.exports = { notify, notifyFollowersOfJob, emailAddress, sendEmail, list, describe, linkFor, ICONS, unseenCount, markAllSeen, markAllRead, flush };
