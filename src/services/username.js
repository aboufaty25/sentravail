const crypto = require('crypto');
const { User } = require('../models');
const { slugify } = require('../utils/text');

// Builds a unique, URL-friendly username: "aissatou-ndiaye", then "aissatou-ndiaye-4f2a".
async function generateUsername(firstName, lastName) {
  const base = slugify(`${firstName} ${lastName}`) || 'membre';
  if (!(await User.findOne({ where: { username: base }, attributes: ['id'] }))) return base;
  for (let i = 0; i < 10; i += 1) {
    const candidate = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    if (!(await User.findOne({ where: { username: candidate }, attributes: ['id'] }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

module.exports = { generateUsername };
