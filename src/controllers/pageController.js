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

// Tabs whose features arrive in later phases.
const UPCOMING = {
  reels: { title: 'Réels', icon: 'play', text: 'Les vidéos de 30 secondes des candidats et recruteurs arrivent bientôt.' },
  jobs: { title: 'Offres', icon: 'briefcase', text: "Les offres d'emploi et la recherche par ville, secteur et contrat arrivent bientôt." },
  network: { title: 'Réseau', icon: 'users', text: "Les suggestions d'abonnements arrivent bientôt." },
  notifications: { title: 'Notifications', icon: 'bell', text: 'Vos notifications en temps réel arrivent bientôt.' },
  search: { title: 'Recherche', icon: 'search', text: 'La recherche de personnes, entreprises et offres arrive bientôt.' },
  publish: { title: 'Publier', icon: 'pencil', text: 'La publication de textes, photos, réels et offres arrive bientôt.' },
  cv: { title: 'Mon CV', icon: 'document', text: 'Le créateur de CV avec export PDF arrive bientôt.' },
  applications: { title: 'Mes candidatures', icon: 'inbox', text: 'Le suivi de vos candidatures arrive bientôt.' },
  saved: { title: 'Enregistrements', icon: 'bookmark', text: 'Vos offres et publications enregistrées arriveront ici.' },
  myJobs: { title: 'Mes offres', icon: 'briefcase', text: 'La gestion de vos offres et des candidatures reçues arrive bientôt.' },
  admin: { title: 'Administration', icon: 'shield', text: "Le tableau de bord d'administration arrive bientôt." },
};

const STATIC_PAGES = {
  about: 'À propos',
  contact: 'Contact',
  privacy: 'Politique de confidentialité',
  terms: "Conditions d'utilisation",
};

function staticPage(key) {
  return (req, res) => res.render(`pages/static/${key}`, { title: STATIC_PAGES[key] });
}

function upcoming(key) {
  const { icon: icon_, ...rest } = UPCOMING[key];
  const tab = ['reels', 'jobs', 'network', 'notifications'].includes(key) ? key : null;
  return (req, res) => res.render('pages/upcoming', { ...rest, icon_, activeTab: tab });
}

module.exports = { home, menu, upcoming, staticPage };
