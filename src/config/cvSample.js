// Fictional example used for template thumbnails and the "voir un exemple" preview.
module.exports = {
  personal: { firstName: 'Aïssatou', lastName: 'Diallo', email: 'aissatou.diallo@exemple.sn', phone: '+221 77 000 00 00', address: 'Médina, Dakar', nationality: 'Sénégalaise', website: '', license: 'B', photoUrl: '' },
  title: 'Conseillère de vente',
  summary: "Conseillère de vente dynamique et orientée résultats, avec 5 ans d'expérience en boutique et en grande distribution. Maîtrise de la caisse, de la gestion des stocks et de la relation client. Motivée pour atteindre et dépasser les objectifs.",
  experiences: [
    { title: 'Conseillère de vente', company: 'Sahel Distribution', city: 'Dakar', start: '2021-01', end: '', current: true, description: "Développement d'un portefeuille de 40 clients fidèles\nDépassement des objectifs de 8 % grâce à la formation de l'équipe\nGestion des commandes fournisseurs et des inventaires" },
    { title: 'Vendeuse', company: 'Boutique Teranga Mode', city: 'Dakar', start: '2018-09', end: '2020-12', current: false, description: 'Accueil, conseil et fidélisation de la clientèle\nMise en rayon et réassortiment des produits\nTenue de la caisse et inventaires mensuels' },
  ],
  educations: [
    { degree: 'BTS Commerce international', school: 'Institut Supérieur de Gestion', city: 'Dakar', start: '2016-10', end: '2018-07', current: false, description: '' },
    { degree: 'Baccalauréat série L', school: 'Lycée Lamine Guèye', city: 'Dakar', start: '2015-10', end: '2016-07', current: false, description: '' },
  ],
  skills: [{ name: 'Techniques de vente', level: 5 }, { name: 'Tenue de caisse', level: 4 }, { name: 'Gestion des stocks', level: 4 }, { name: 'Excel', level: 3 }, { name: 'Relation client', level: 5 }],
  languages: [{ name: 'Français', level: 'Courant' }, { name: 'Wolof', level: 'Langue maternelle' }, { name: 'Anglais', level: 'Intermédiaire' }],
  qualities: ['Sens du contact', 'Dynamisme', "Esprit d'équipe", 'Rigueur'],
  interests: ['Couture', 'Football féminin', 'Cuisine'],
  certificates: [{ name: 'Formation « Techniques de vente et service client »', year: '2019' }],
  custom: { title: '', text: '' },
};
