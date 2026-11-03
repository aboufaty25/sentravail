const { Post } = require('../models');
const { feedPage, hydrate, postInclude } = require('../services/posts');

async function home(req, res) {
  // Open to everyone (indexable): guests see the public feed.
  const since = new Date();
  // Admin offers and featured offers come first inside the feed itself (services/posts).
  const { posts, hasMore } = await feedPage({ viewer: req.user, page: 1, since });
  // Just-published post: pin it on top for its author, once.
  const freshId = Number.parseInt(req.query.nouveau, 10);
  let fresh = null;
  if (freshId && req.user) {
    fresh = await Post.findOne({ where: { id: freshId, authorId: req.user.id }, include: postInclude() });
    if (fresh) await hydrate([fresh], req.user);
  }
  const feedPosts = fresh ? posts.filter((p) => p.id !== fresh.id) : posts;
  return res.render('pages/home', {
    title: req.user ? 'Accueil' : "SenTravail — Le réseau social de l'emploi au Sénégal",
    metaDescription: "Offres d'emploi, candidats disponibles, salons de recrutement et conseils carrière au Sénégal. Postulez gratuitement, même sans compte.",
    canonical: `${require('../config/env').APP_URL}/`,
    activeTab: 'home', fresh, posts: feedPosts, hasMore, page: 1, since: since.getTime(),
  });
}

function menu(req, res) {
  res.render('pages/menu', { title: 'Menu', activeTab: 'menu', noAds: true });
}

const STATIC_PAGES = {
  about: 'À propos',
  contact: 'Contact',
  privacy: 'Politique de confidentialité',
  terms: "Conditions d'utilisation",
};

function staticPage(key) {
  return (req, res) => res.render(`pages/static/${key}`, { title: STATIC_PAGES[key] });
}

module.exports = { home, menu, staticPage };
