const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { sequelize, User } = require('../src/models');

async function resetDb() {
  await sequelize.sync({ force: true });
  const { BannedTerm } = require('../src/models');
  await BannedTerm.bulkCreate(BannedTerm.DEFAULTS.map((term) => ({ term })));
  require('../src/services/moderation').invalidateTerms();
}

async function closeDb() {
  await sequelize.close();
}

// Returns a cookie-keeping agent and the CSRF token from a GET page.
async function agentWithCsrf(path = '/connexion') {
  const agent = request.agent(app);
  const res = await agent.get(path);
  const match = res.text.match(/name="_csrf" value="([a-f0-9]+)"/);
  if (!match) throw new Error(`No CSRF token on ${path} (status ${res.status})`);
  return { agent, csrf: match[1] };
}

async function createUser(overrides = {}) {
  const n = Math.random().toString(36).slice(2, 8);
  return User.create({
    username: `user-${n}`,
    firstName: 'Test',
    lastName: 'User',
    email: `user-${n}@example.com`,
    passwordHash: await bcrypt.hash(overrides.password || 'password123', 4),
    role: 'candidate',
    ...overrides,
  });
}

async function loginAs(user, password = 'password123') {
  const { agent, csrf } = await agentWithCsrf('/connexion');
  const res = await agent.post('/connexion').type('form').send({ _csrf: csrf, identifier: user.email, password });
  if (res.status !== 302) throw new Error(`Login failed for ${user.email}: ${res.status}`);
  const page = await agent.get('/menu');
  const token = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  return { agent, csrf: token };
}

module.exports = { app, request, resetDb, closeDb, agentWithCsrf, createUser, loginAs, User };
