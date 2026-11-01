const { engagement, baseScore, personalize, FOLLOW_BONUS, MATCH_BONUS } = require('../src/services/feedRanking');

const now = new Date('2026-11-01T12:00:00Z');
const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000);

describe('engagement', () => {
  test('applies the weights likes×1 + comments×3 + shares×5 + saves×2 + views×0.05', () => {
    expect(engagement({ likesCount: 10, commentsCount: 2, sharesCount: 1, savesCount: 3, viewsCount: 100 })).toBe(10 + 6 + 5 + 6 + 5);
  });
  test('treats missing counters as 0', () => {
    expect(engagement({})).toBe(0);
  });
});

describe('baseScore', () => {
  test('matches the formula (engagement + 1) / (hours + 2)^1.5', () => {
    const post = { likesCount: 5, createdAt: hoursAgo(2) };
    expect(baseScore(post, now)).toBeCloseTo(6 / 4 ** 1.5, 10);
  });

  test('a brand new post with no engagement scores 1 / 2^1.5', () => {
    expect(baseScore({ createdAt: now }, now)).toBeCloseTo(1 / 2 ** 1.5, 10);
  });

  test('decays with time', () => {
    const p = (h) => baseScore({ likesCount: 10, createdAt: hoursAgo(h) }, now);
    expect(p(1)).toBeGreaterThan(p(5));
    expect(p(5)).toBeGreaterThan(p(48));
  });

  test('more engagement ranks higher at equal age', () => {
    const a = baseScore({ likesCount: 1, createdAt: hoursAgo(3) }, now);
    const b = baseScore({ commentsCount: 1, createdAt: hoursAgo(3) }, now);
    const c = baseScore({ sharesCount: 1, createdAt: hoursAgo(3) }, now);
    expect(c).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(a);
  });

  test('a very engaging older post can beat a fresh empty one', () => {
    const old = baseScore({ likesCount: 50, commentsCount: 10, createdAt: hoursAgo(24) }, now);
    const fresh = baseScore({ createdAt: hoursAgo(0) }, now);
    expect(old).toBeGreaterThan(fresh);
  });

  test('future dates are clamped (no negative hours)', () => {
    expect(baseScore({ createdAt: new Date(now.getTime() + 3_600_000) }, now)).toBeCloseTo(1 / 2 ** 1.5, 10);
  });
});

describe('personalize', () => {
  const viewer = { id: 1, city: 'Dakar', sector: 'Santé' };

  test('×1.5 when the reader follows the author', () => {
    expect(personalize(1, { authorId: 9 }, viewer, { followedIds: new Set([9]) })).toBeCloseTo(FOLLOW_BONUS);
  });

  test('×1.3 for a job matching the reader city or sector', () => {
    expect(personalize(1, { authorId: 9, job: { location: 'Dakar' } }, viewer)).toBeCloseTo(MATCH_BONUS);
    expect(personalize(1, { authorId: 9, job: { location: 'Thiès', sector: 'Santé' } }, viewer)).toBeCloseTo(MATCH_BONUS);
    expect(personalize(1, { authorId: 9, job: { location: 'Thiès', sector: 'BTP' } }, viewer)).toBe(1);
  });

  test('bonuses stack', () => {
    const s = personalize(2, { authorId: 9, job: { location: 'Dakar' } }, viewer, { followedIds: new Set([9]) });
    expect(s).toBeCloseTo(2 * FOLLOW_BONUS * MATCH_BONUS);
  });

  test('no bonus for guests', () => {
    expect(personalize(1, { authorId: 9, job: { location: 'Dakar' } }, null)).toBe(1);
  });
});
