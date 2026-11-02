const { Post } = require('../models');
const { feedPage, hydrate, postInclude } = require('../services/posts');
const { featuredJobs } = require('../services/jobs');

async function home(req, res) {
  if (!req.user) {
    return res.render('pages/landing', { title: "SenTravail — Le réseau social de l'emploi au Sénégal", layout: 'layouts/auth', noAds: true, wide: true });
  }
  const since = new Date();
  const [{ posts, hasMore }, featured] = await Promise.all([feedPage({ viewer: req.user, page: 1, since }), featuredJobs(req.user)]);
  // Just-published post: pin it on top for its author, once.
  const freshId = Number.parseInt(req.query.nouveau, 10);
  let fresh = null;
  if (freshId) {
    fresh = await Post.findOne({ where: { id: freshId, authorId: req.user.id }, include: postInclude() });
    if (fresh) await hydrate([fresh], req.user);
  }
  const feedPosts = fresh ? posts.filter((p) => p.id !== fresh.id) : posts;
  const pinned = fresh ? featured.filter((p) => p.id !== fresh.id) : featured;
  return res.render('pages/home', {
    title: 'Accueil', activeTab: 'home', fresh, featured: pinned, posts: feedPosts, hasMore, page: 1, since: since.getTime(),
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
