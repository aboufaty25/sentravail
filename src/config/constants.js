// Reference lists used by forms (admin-editable in Phase 8).
const CITIES = [
  'Dakar', 'Pikine', 'Guédiawaye', 'Rufisque', 'Thiès', 'Mbour', 'Saint-Louis', 'Kaolack',
  'Ziguinchor', 'Touba', 'Diourbel', 'Louga', 'Tambacounda', 'Kolda', 'Fatick', 'Matam',
  'Kaffrine', 'Kédougou', 'Sédhiou', 'Diamniadio',
];

const SECTORS = [
  'Administration', 'Agriculture', 'Banque & Finance', 'BTP & Construction', 'Commerce & Vente',
  'Comptabilité', 'Éducation', 'Énergie & Mines', 'Hôtellerie & Restauration', 'Informatique & Télécoms',
  'Industrie', 'Juridique', 'Logistique & Transport', 'Marketing & Communication', 'ONG & Humanitaire',
  'Pêche', 'Ressources humaines', 'Santé', 'Sécurité', 'Services à la personne', 'Tourisme',
];

const ROLE_LABELS = { candidate: 'Candidat', recruiter: 'Recruteur', admin: 'Administrateur' };

const REACTIONS = {
  like: { emoji: '👍', label: "J'aime", color: 'text-brand-600' },
  love: { emoji: '❤️', label: "J'adore", color: 'text-rose-600' },
  bravo: { emoji: '👏', label: 'Bravo', color: 'text-amber-600' },
  support: { emoji: '🤝', label: 'Soutien', color: 'text-senegal-green' },
};

module.exports = { CITIES, SECTORS, ROLE_LABELS, REACTIONS };
