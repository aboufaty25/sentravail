const { slugify, normalizePhone } = require('../src/utils/text');

test('slugify strips accents and symbols', () => {
  expect(slugify('Aïssatou  Ndiaye-Sène!')).toBe('aissatou-ndiaye-sene');
});

test.each([
  ['77 123 45 67', '+221771234567'],
  ['771234567', '+221771234567'],
  ['221771234567', '+221771234567'],
  ['+221 77 123 45 67', '+221771234567'],
  ['00221771234567', '+221771234567'],
  ['33 821 00 00', '+221338210000'],
  ['+33612345678', '+33612345678'],
  ['12', null],
  ['', null],
])('normalizePhone(%p) = %p', (input, expected) => {
  expect(normalizePhone(input)).toBe(expected);
});
