const env = require('../src/config/env');
const { User } = require('../src/models');
const { promoteConfiguredAdmins } = require('../src/services/admins');
const { resetDb, closeDb, createUser } = require('./helpers');

beforeAll(resetDb);
afterAll(async () => { env.ADMIN_EMAILS = ''; await closeDb(); });

test('ADMIN_EMAILS promotes existing accounts only, case-insensitively', async () => {
  const owner = await createUser({ email: 'owner@example.com', role: 'candidate' });
  const other = await createUser({ email: 'other@example.com', role: 'candidate' });
  env.ADMIN_EMAILS = ' Owner@Example.com , missing@example.com';
  expect(await promoteConfiguredAdmins()).toEqual(['owner@example.com']);
  await owner.reload(); await other.reload();
  expect(owner.role).toBe('admin');
  expect(owner.isVerified).toBe(true);
  expect(other.role).toBe('candidate');
  expect(await User.count({ where: { email: 'missing@example.com' } })).toBe(0);
  expect(await promoteConfiguredAdmins()).toEqual([]);
});

test('empty ADMIN_EMAILS does nothing', async () => {
  env.ADMIN_EMAILS = '';
  expect(await promoteConfiguredAdmins()).toEqual([]);
});
