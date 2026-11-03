// Recruitment (ATS) figures for the admin: whole platform, every recruiter.
const { Op, fn, col, literal } = require('sequelize');
const { Application } = require('../models');

const RECEIVED = { status: { [Op.ne]: 'opened_mail' } }; // applications actually sent
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

async function platformStats() {
  const [byStageRows, received7, received30, byModeRows, upcoming, hired30, older, olderAnswered, topJobs, recent, pendingEmail] = await Promise.all([
    Application.count({ where: RECEIVED, group: ['status'] }),
    Application.count({ where: { ...RECEIVED, createdAt: { [Op.gte]: daysAgo(7) } } }),
    Application.count({ where: { ...RECEIVED, createdAt: { [Op.gte]: daysAgo(30) } } }),
    Application.count({ where: RECEIVED, group: ['sentVia'] }),
    Application.findAll({ where: { status: 'interview', interviewAt: { [Op.gte]: new Date() } }, order: [['interviewAt', 'ASC']], limit: 5 }),
    Application.count({ where: { status: 'hired', stageAt: { [Op.gte]: daysAgo(30) } } }),
    // Response rate: applications older than 7 days that a recruiter has looked at or moved.
    Application.count({ where: { ...RECEIVED, createdAt: { [Op.lt]: daysAgo(7) } } }),
    Application.count({ where: { status: { [Op.notIn]: ['opened_mail', 'confirmed_sent'] }, createdAt: { [Op.lt]: daysAgo(7) } } }),
    Application.findAll({
      attributes: ['jobPostId', 'jobTitle', 'companyName', 'jobSlug', [fn('COUNT', col('id')), 'n']],
      where: { ...RECEIVED, jobPostId: { [Op.ne]: null } },
      group: ['jobPostId', 'jobTitle', 'companyName', 'jobSlug'],
      order: [[literal('n'), 'DESC']],
      limit: 5,
      raw: true,
    }),
    Application.findAll({ where: RECEIVED, order: [['createdAt', 'DESC']], limit: 6 }),
    Application.count({ where: { status: 'opened_mail' } }),
  ]);
  const byStage = Object.fromEntries(byStageRows.map((r) => [r.status, Number(r.count)]));
  const byMode = Object.fromEntries(byModeRows.map((r) => [r.sentVia || 'mailto', Number(r.count)]));
  const total = Object.values(byStage).reduce((a, b) => a + b, 0);
  return {
    total,
    received7,
    received30,
    byStage,
    byMode: { platform: byMode.platform || 0, email: (byMode.mailto || 0) + (byMode.server || 0) },
    pendingEmail,
    upcoming,
    interviews: byStage.interview || 0,
    hired: byStage.hired || 0,
    hired30,
    responseRate: older ? Math.round((olderAnswered / older) * 100) : null,
    topJobs: topJobs.map((r) => ({ ...r, n: Number(r.n) })),
    recent,
  };
}

const PAGE_SIZE = 40;

// All applications, filtered (admin list).
async function search({ status, mode, q, page = 1 }) {
  const where = { ...RECEIVED };
  if (status === 'opened_mail') where.status = 'opened_mail';
  else if (Application.STATUSES.includes(status)) where.status = status;
  if (mode === 'platform') where.sentVia = 'platform';
  if (mode === 'email') where.sentVia = { [Op.in]: ['mailto', 'server'] };
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where[Op.or] = ['firstName', 'lastName', 'email', 'jobTitle', 'companyName'].map((f) => ({ [f]: { [Op.like]: like } }));
  }
  const { rows, count } = await Application.findAndCountAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return { rows, total: count, pages: Math.max(1, Math.ceil(count / PAGE_SIZE)) };
}

module.exports = { platformStats, search, PAGE_SIZE };
