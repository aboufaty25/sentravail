const { z } = require('zod');
const { Op, where, fn, col } = require('sequelize');
const { User } = require('../models');
const jobs = require('../services/jobs');
const follows = require('../services/follows');
const { CITIES, SECTORS, CONTRACT_TYPES } = require('../config/constants');

const TYPES = ['tout', 'personnes', 'entreprises', 'offres'];
const PAGE = 20;

const schema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  type: z.string().optional().default('tout').transform((v) => (TYPES.includes(v) ? v : 'tout')),
  ville: z.string().optional().default('').transform((v) => (CITIES.includes(v) ? v : '')),
  secteur: z.string().optional().default('').transform((v) => (SECTORS.includes(v) ? v : '')),
  contrat: z.string().optional().default('').transform((v) => (CONTRACT_TYPES.includes(v) ? v : '')),
});

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// People (candidates/admins) or companies (recruiters) matching name, headline or company.
async function searchUsers({ q, ville, secteur }, kind, viewer, limit) {
  const cond = { isBanned: false, role: kind === 'entreprises' ? 'recruiter' : { [Op.in]: ['candidate', 'admin'] } };
  if (ville) cond.city = ville;
  if (secteur) cond.sector = secteur;
  if (q) {
    const like = `%${escapeLike(q)}%`;
    cond[Op.or] = [
      where(fn('CONCAT', col('firstName'), ' ', col('lastName')), { [Op.like]: like }),
      { headline: { [Op.like]: like } },
      { companyName: { [Op.like]: like } },
    ];
  }
  const list = await User.findAll({ where: cond, attributes: follows.CARD_ATTRS, order: [['followersCount', 'DESC'], ['id', 'DESC']], limit });
  return follows.withFollowState(list, viewer);
}

async function index(req, res) {
  const f = schema.parse(req.query);
  // The job filters live on /offres: keep a single job search experience.
  if (f.type === 'offres') {
    const qs = new URLSearchParams(Object.entries({ q: f.q, ville: f.ville, secteur: f.secteur, contrat: f.contrat }).filter(([, v]) => v));
    return res.redirect(`/offres${qs.toString() ? `?${qs}` : ''}`);
  }
  const all = f.type === 'tout';
  const [people, companies, jobResult] = await Promise.all([
    all || f.type === 'personnes' ? searchUsers(f, 'personnes', req.user, all ? 4 : PAGE) : [],
    all || f.type === 'entreprises' ? searchUsers(f, 'entreprises', req.user, all ? 4 : PAGE) : [],
    all && f.q ? jobs.search({ q: f.q, ville: f.ville, secteur: f.secteur, contrat: '', page: 1 }, req.user) : { posts: [], total: 0 },
  ]);
  res.render('pages/search', {
    title: f.q ? `Recherche : ${f.q}` : 'Recherche',
    activeTab: null,
    f,
    people,
    companies,
    jobs: jobResult.posts.slice(0, 3),
    jobsTotal: jobResult.total,
    CITIES,
    SECTORS,
  });
}

module.exports = { index, searchUsers };
