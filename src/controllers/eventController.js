const { Op } = require('sequelize');
const { Post } = require('../models');
const posts = require('../services/posts');
const { followedIds } = require('../services/follows');
const { CITIES } = require('../config/constants');
const { EVENT_KINDS } = require('../config/postTypes');
const env = require('../config/env');

// Upcoming job events (salons, concours, portes ouvertes, formations), soonest first.
async function index(req, res) {
  const ville = CITIES.includes(req.query.ville) ? req.query.ville : '';
  const type = Object.keys(EVENT_KINDS).includes(req.query.type) ? req.query.type : '';
  const followed = await followedIds(req.user?.id);
  const startOfToday = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const rows = await Post.findAll({
    where: {
      [Op.and]: [
        posts.feedWhere(req.user, followed),
        { type: 'event', eventDate: { [Op.gte]: startOfToday } },
        ville ? { city: ville } : {},
      ],
    },
    include: posts.postInclude(),
    order: [['eventDate', 'ASC'], ['id', 'ASC']],
    limit: 100,
  });
  const list = rows.filter((p) => !p.author.isBanned && (!type || p.details?.eventKind === type));
  res.render('pages/events/index', {
    title: ville ? `Événements emploi à ${ville}` : 'Événements emploi au Sénégal',
    metaDescription: 'Salons de recrutement, concours, journées portes ouvertes et formations au Sénégal.',
    canonical: `${env.APP_URL}/evenements`,
    activeTab: 'events',
    posts: await posts.hydrate(list, req.user),
    ville,
    type,
    CITIES,
  });
}

// schema.org Event for an event post page (Google event results).
function eventJsonLd(post) {
  const d = post.details || {};
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: post.title,
    description: post.text || '',
    startDate: d.hasTime ? new Date(post.eventDate).toISOString() : new Date(post.eventDate).toISOString().slice(0, 10),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: d.place, address: { '@type': 'PostalAddress', addressLocality: post.city, addressCountry: 'SN' } },
    organizer: { '@type': 'Person', name: `${post.author.firstName} ${post.author.lastName}`, url: `${env.APP_URL}/profil/${post.author.username}` },
    url: `${env.APP_URL}/publications/${post.id}`,
  };
  if (post.mediaUrls?.[0]) data.image = /^https?:/.test(post.mediaUrls[0]) ? post.mediaUrls[0] : `${env.APP_URL}${post.mediaUrls[0]}`;
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

module.exports = { index, eventJsonLd };
