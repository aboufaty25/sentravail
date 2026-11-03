// Imports job offers prepared as JSON files (data/imports/*.json) under an admin account.
// Each file is imported once (marker in site_settings); offers already present
// (same title and company) or already closed are skipped.
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { Post, Job, User, SiteSetting } = require('../models');
const { jobSchema } = require('../validators/job');
const jobs = require('./jobs');
const { baseScore } = require('./feedRanking');

const IMPORT_DIR = path.join(__dirname, '..', '..', 'data', 'imports');

async function findAdmin(email) {
  const wanted = email ? [email] : env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const e of wanted) {
    const u = await User.findOne({ where: { email: e, role: 'admin', isBanned: false } });
    if (u) return u;
  }
  if (email) return null;
  return User.findOne({ where: { role: 'admin', isBanned: false }, order: [['id', 'ASC']] });
}

async function importJobs(list, author) {
  const report = { created: [], skipped: [] };
  for (const raw of list) {
    const label = `${raw.title} — ${raw.companyName}`;
    const parsed = jobSchema.safeParse({ ...raw, deadline: raw.deadline || '' });
    if (!parsed.success) {
      report.skipped.push(`${label} (${parsed.error.issues[0].message})`);
      continue;
    }
    const d = parsed.data;
    if (await Job.findOne({ where: { title: d.title, companyName: d.companyName } })) {
      report.skipped.push(`${label} (déjà publiée)`);
      continue;
    }
    const now = new Date();
    // Approved by the admin: shown in everyone's feed and search, without being pinned "À la une".
    const post = await Post.create({
      authorId: author.id, type: 'job', text: null, visibility: 'public', status: 'published',
      featureStatus: 'approved', isFeatured: false, score: baseScore({ createdAt: now }),
    });
    await Job.create({
      postId: post.id,
      slug: jobs.buildSlug(d.title, d.location),
      title: d.title, companyName: d.companyName, location: d.location, contractType: d.contractType, sector: d.sector,
      salary: d.salary || null, description: d.description, requirements: null, benefits: null,
      applyMode: d.applyMode,
      applyEmail: d.applyMode === 'email' ? d.applyEmail : null,
      applyUrl: d.applyMode === 'link' ? d.applyUrl : null,
      deadline: d.deadline || null,
      companyLogo: null, image: null, isOfficial: false,
    });
    report.created.push(label);
  }
  return report;
}

async function importFile(file, author) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return importJobs(data.jobs || [], author);
}

// At startup: imports the files of data/imports not imported yet.
async function importPending() {
  if (!fs.existsSync(IMPORT_DIR)) return;
  const files = fs.readdirSync(IMPORT_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const name of files) {
    const key = `import:${name}`.slice(0, 60);
    if (await SiteSetting.findByPk(key)) continue;
    const author = await findAdmin();
    if (!author) {
      console.warn(`[import] ${name}: no administrator account yet, import postponed.`);
      return;
    }
    const report = await importFile(path.join(IMPORT_DIR, name), author);
    await SiteSetting.upsert({ key, value: JSON.stringify({ at: new Date(), by: author.email, created: report.created.length }) });
    console.log(`[import] ${name}: ${report.created.length} offer(s) published as ${author.email}, ${report.skipped.length} skipped.`);
    for (const s of report.skipped) console.log(`[import]   skipped: ${s}`);
  }
}

module.exports = { IMPORT_DIR, findAdmin, importJobs, importFile, importPending };
