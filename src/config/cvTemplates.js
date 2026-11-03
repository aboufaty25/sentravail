// CV templates offered by the builder (rendering: src/services/cv/templates/*).
const TEMPLATES = {
  rubis: { label: 'Rubis', description: 'Colonne colorée à droite, nom en grand', color: '#A52A2A', font: 'sans', photo: false },
  terracotta: { label: 'Terracotta', description: 'Élégant, photo ronde et frise chronologique', color: '#8B3A2E', font: 'mixed', photo: true },
  classique: { label: 'Classique', description: 'Sobre, une colonne, idéal pour tous les métiers', color: '#1F2A6B', font: 'serif', photo: true },
  emeraude: { label: 'Émeraude', description: 'Moderne, colonne claire avec barres de niveau', color: '#1F5C4A', font: 'sans', photo: true },
  encadre: { label: 'Encadré', description: 'Rubriques encadrées, très lisible', color: '#3A7863', font: 'sans', photo: true },
  prune: { label: 'Prune', description: 'Titres en étiquettes, grand nom', color: '#56267A', font: 'sans', photo: true },
  horizon: { label: 'Horizon', description: 'Bandeaux colorés, colonne avec photo', color: '#34489B', font: 'sans', photo: true },
};

// Colors offered for every template (the template's own color is suggested first).
const COLORS = ['#A52A2A', '#8B3A2E', '#C2410C', '#B45309', '#1F5C4A', '#3A7863', '#0F766E', '#0E7490', '#34489B', '#1F2A6B', '#56267A', '#9D174D', '#374151', '#111827'];

const FONTS = { sans: 'Moderne (Inter)', serif: 'Élégante (Lora)', mixed: 'Mixte (titres Lora)' };

// Sections a person can fill, in default order.
const SECTIONS = ['summary', 'experiences', 'educations', 'skills', 'languages', 'certificates', 'qualities', 'interests', 'custom'];
const SECTION_LABELS = {
  summary: 'Profil', experiences: 'Expérience professionnelle', educations: 'Formation', skills: 'Compétences', languages: 'Langues',
  certificates: 'Certificats', qualities: 'Qualités', interests: "Centres d'intérêt", custom: 'Informations complémentaires',
};

const LANGUAGE_LEVELS = ['Langue maternelle', 'Bilingue', 'Courant', 'Intermédiaire', 'Notions'];
const LANGUAGE_SCORE = { 'Langue maternelle': 5, Bilingue: 5, Courant: 4, Intermédiaire: 3, Notions: 2 };
const SKILL_LEVELS = ['', 'Notions', 'Intermédiaire', 'Bien', 'Très bien', 'Expert']; // index = level 0..5

module.exports = { TEMPLATES, COLORS, FONTS, SECTIONS, SECTION_LABELS, LANGUAGE_LEVELS, LANGUAGE_SCORE, SKILL_LEVELS };
