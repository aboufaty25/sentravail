// The publication types of SenTravail (no free-form posts). Each type has its own
// form, validation (validators/post.js) and card (views/partials/cards).

const EVENT_KINDS = {
  salon: 'Salon de recrutement',
  concours: 'Concours',
  portes_ouvertes: 'Journée portes ouvertes',
  formation: 'Formation',
};

const AVAILABILITIES = ['Immédiatement', 'Sous 1 mois', 'Sous 3 mois', "En poste, à l'écoute"];

// slug = URL segment of /publier/:slug
const TYPES = {
  job: {
    slug: 'offre', label: "Offre d'emploi", description: 'Publier un poste à pourvoir',
    icon: 'briefcase', color: 'text-brand-600 bg-brand-50', verb: 'a publié une offre',
  },
  job_search: {
    slug: 'recherche-emploi', label: 'Je cherche un emploi', description: 'Présentez-vous aux recruteurs',
    icon: 'search', color: 'text-emerald-700 bg-emerald-50', verb: 'cherche un emploi', maxText: 600,
  },
  event: {
    slug: 'evenement', label: 'Événement emploi', description: 'Salon, concours, portes ouvertes, formation',
    icon: 'calendar', color: 'text-orange-700 bg-orange-50', verb: 'a publié un événement', maxText: 1500, image: true,
  },
  hired: {
    slug: 'recrute', label: "J'ai été recruté !", description: 'Partagez votre réussite',
    icon: 'star', color: 'text-amber-700 bg-amber-50', verb: 'a décroché un poste 🎉', maxText: 300,
  },
  advice: {
    slug: 'conseil', label: 'Conseil carrière', description: 'Réservé aux comptes vérifiés',
    icon: 'document', color: 'text-violet-700 bg-violet-50', verb: 'partage un conseil carrière', maxText: 2000,
  },
};

const SHARE_MAX_TEXT = 280;
const COMMENT_MAX_TEXT = 500;

// Types shown in feeds and profiles (legacy free posts "text"/"photo" are hidden).
const FEED_TYPES = ['job', 'job_search', 'event', 'hired', 'advice', 'share'];

function typeBySlug(slug) {
  const key = Object.keys(TYPES).find((k) => TYPES[k].slug === slug);
  return key ? { key, ...TYPES[key] } : null;
}

// Server-side permission per type; returns null when allowed, else the reason.
function cannotCreate(type, user) {
  if (!user) return 'Connectez-vous pour publier.';
  if (type === 'job' && !['recruiter', 'admin'].includes(user.role)) return 'Les offres d’emploi sont réservées aux recruteurs.';
  if (type === 'job_search' && user.role !== 'candidate') return 'Réservé aux candidats.';
  if (type === 'advice' && !(user.isVerified || user.role === 'admin')) return 'Les conseils carrière sont réservés aux comptes vérifiés.';
  return null;
}

module.exports = { TYPES, EVENT_KINDS, AVAILABILITIES, FEED_TYPES, SHARE_MAX_TEXT, COMMENT_MAX_TEXT, typeBySlug, cannotCreate };
