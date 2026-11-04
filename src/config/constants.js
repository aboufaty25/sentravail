// Reference lists used by forms (admin-editable in Phase 8).
// Default reference lists. The live CITIES / SECTORS arrays below are refreshed in place
// from the database (admin-editable, see services/refs.js).
const DEFAULT_CITIES = Object.freeze([
  'Dakar', 'Pikine', 'Guédiawaye', 'Rufisque', 'Thiès', 'Mbour', 'Saint-Louis', 'Kaolack',
  'Ziguinchor', 'Touba', 'Diourbel', 'Louga', 'Tambacounda', 'Kolda', 'Fatick', 'Matam',
  'Kaffrine', 'Kédougou', 'Sédhiou', 'Diamniadio',
]);

const DEFAULT_SECTORS = Object.freeze([
  'Administration', 'Agriculture', 'Banque & Finance', 'BTP & Construction', 'Commerce & Vente',
  'Comptabilité', 'Éducation', 'Énergie & Mines', 'Hôtellerie & Restauration', 'Informatique & Télécoms',
  'Industrie', 'Juridique', 'Logistique & Transport', 'Marketing & Communication', 'ONG & Humanitaire',
  'Pêche', 'Ressources humaines', 'Santé', 'Sécurité', 'Services à la personne', 'Tourisme',
]);

const CITIES = [...DEFAULT_CITIES];
const SECTORS = [...DEFAULT_SECTORS];

const CONTRACT_TYPES = ['CDI', 'CDD', 'Stage', 'Freelance', 'Temps partiel', 'Journalier'];

// Public name of every administrator account: what visitors see on admin posts and profiles.
const TEAM_NAME = 'Équipe SenTravail';

const ROLE_LABELS = { candidate: 'Candidat', recruiter: 'Recruteur', admin: 'Administrateur' };

const REACTIONS = {
  like: { emoji: '👍', label: "J'aime", color: 'text-brand-600' },
  love: { emoji: '❤️', label: "J'adore", color: 'text-rose-600' },
  bravo: { emoji: '👏', label: 'Bravo', color: 'text-amber-600' },
  support: { emoji: '🤝', label: 'Soutien', color: 'text-senegal-green' },
};

module.exports = {
  TEAM_NAME, DEFAULT_CITIES, DEFAULT_SECTORS, CITIES, SECTORS, CONTRACT_TYPES, ROLE_LABELS, REACTIONS };
