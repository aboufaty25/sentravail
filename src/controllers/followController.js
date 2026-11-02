const { User } = require('../models');
const { hxTrigger } = require('../utils/hx');
const follows = require('../services/follows');

const VARIANTS = new Set(['button', 'link', 'card']);

function parseId(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

async function renderButton(req, res, targetId, { changed = false } = {}) {
  const following = await follows.isFollowing(req.user.id, targetId);
  const variant = VARIANTS.has(req.query.v || req.body?.v) ? req.query.v || req.body.v : 'button';
  if (changed) {
    const target = await User.findByPk(targetId, { attributes: ['followersCount'] });
    // Other buttons for the same account refresh themselves; counters update.
    hxTrigger(res, { [`follow-changed-${targetId}`]: { followersCount: target.followersCount } });
  }
  return res.render('partials/followButton', { layout: false, targetId, following, variant });
}

async function toggle(req, res) {
  const targetId = parseId(req.params.id);
  if (!targetId) {
    const err = new Error('Compte introuvable.');
    err.status = 404;
    throw err;
  }
  if (await follows.isFollowing(req.user.id, targetId)) await follows.unfollow(req.user, targetId);
  else await follows.follow(req.user, targetId);
  return renderButton(req, res, targetId, { changed: true });
}

async function button(req, res) {
  const targetId = parseId(req.params.id);
  if (!targetId) return res.status(404).end();
  return renderButton(req, res, targetId);
}

// Onglet Réseau: suggestions + my counts.
async function network(req, res) {
  const list = await follows.suggestions(req.user, 18);
  res.render('pages/network/index', { title: 'Réseau', activeTab: 'network', suggestions: list });
}

async function sidebarSuggestions(req, res) {
  if (!req.user) return res.send('');
  const list = await follows.suggestions(req.user, 4);
  res.set('Cache-Control', 'private, max-age=60');
  return res.render('partials/suggestionsSidebar', { layout: false, suggestions: list });
}

async function lists(req, res, next) {
  const user = await User.findOne({ where: { username: req.params.username, isBanned: false } });
  if (!user) {
    const err = new Error("Ce profil n'existe pas.");
    err.status = 404;
    return next(err);
  }
  const which = req.params.list === 'abonnes' ? 'followers' : 'following';
  const people = which === 'followers' ? await follows.listFollowers(user.id, req.user) : await follows.listFollowing(user.id, req.user);
  return res.render('pages/network/list', {
    title: `${which === 'followers' ? 'Abonnés' : 'Abonnements'} de ${user.firstName} ${user.lastName}`,
    profileUser: user,
    which,
    people,
  });
}

module.exports = { toggle, button, network, sidebarSuggestions, lists };
