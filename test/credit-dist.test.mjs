// The credits distribution: the deal stays fair (round-robin, piles within one of each
// other), but the ARRANGEMENT the pile is dealt from rotates with the deck date -- A-Z by
// name, by amount, by days, officers taking turns A-Z -- so the same credit officer no longer
// catches the same slice of the book every single day.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DIST_STRATEGIES, distStrategyFor, distributeToCredits } from '../api/_lib/credit-dist.js';

const OFFICERS = [
  { user_id: 'U3', name: 'CHARLIE' },
  { user_id: 'U1', name: 'ALICE' },
  { user_id: 'U2', name: 'BOB' },
];

const CUSTOMERS = [
  { ref: 'R1', full_name: 'ZUHURA', arrears: 100, days_elapsed: 9 },
  { ref: 'R2', full_name: 'ANNA', arrears: 900, days_elapsed: 7 },
  { ref: 'R3', full_name: 'MARIA', arrears: 500, days_elapsed: 12 },
  { ref: 'R4', full_name: 'BARAKA', arrears: 300, days_elapsed: 8 },
  { ref: 'R5', full_name: 'NEEMA', arrears: 700, days_elapsed: 10 },
];

test('consecutive deck days walk the whole cycle in order, then repeat', () => {
  // Four consecutive dates cover all four arrangements, in cycle order, then wrap.
  const days = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'];
  const keys = days.map(d => distStrategyFor(d).key);
  assert.equal(new Set(keys.slice(0, 4)).size, 4, 'four days, four different arrangements: ' + keys.join(', '));
  assert.equal(keys[4], keys[0], 'day five wraps back to day one\'s arrangement');
  // And the order is the cycle's own order, just offset by where the date lands in it.
  const start = DIST_STRATEGIES.findIndex(s => s.key === keys[0]);
  for (let i = 0; i < 4; i++) {
    assert.equal(keys[i], DIST_STRATEGIES[(start + i) % 4].key, 'day ' + i + ' follows the cycle');
  }
});

test('the same deck date always answers the same -- a re-upload cannot reshuffle mid-morning', () => {
  const a = distStrategyFor('2026-07-24');
  const b = distStrategyFor('2026-07-24');
  assert.equal(a.key, b.key);
  const d1 = distributeToCredits(CUSTOMERS, OFFICERS, '2026-07-24');
  const d2 = distributeToCredits(CUSTOMERS, OFFICERS, '2026-07-24');
  for (const [k, pile] of d1.assigned) {
    assert.deepEqual(pile.map(c => c.ref), d2.assigned.get(k).map(c => c.ref), k);
  }
});

test('every arrangement stays fair: piles within one of each other, nobody dropped', () => {
  for (const day of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23']) {
    const { assigned } = distributeToCredits(CUSTOMERS, OFFICERS, day);
    const sizes = [...assigned.values()].map(p => p.length);
    assert.equal(sizes.reduce((s, n) => s + n, 0), CUSTOMERS.length, day + ': all dealt');
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, day + ': piles within one -- ' + sizes.join(','));
  }
});

test('different arrangements genuinely deal different piles', () => {
  // The point of the feature: across the four arrangements, at least one officer's pile
  // changes -- the same officer does not catch the same customers under every deck.
  const perDay = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23'].map(day => {
    const { assigned } = distributeToCredits(CUSTOMERS, OFFICERS, day);
    return [...assigned.entries()].map(([k, pile]) => k + ':' + pile.map(c => c.ref).join('+')).sort().join('|');
  });
  assert.ok(new Set(perDay).size >= 2, 'at least two of the four days deal differently: ' + perDay.join('\n'));
});

test('each arrangement orders the pile by its own rule', () => {
  // One officer receives the whole pile in dealt order, exposing the arrangement directly.
  const one = [{ user_id: 'U1', name: 'ALICE' }];
  const byKey = {};
  for (const day of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23']) {
    const { assigned, strategy } = distributeToCredits(CUSTOMERS, one, day);
    byKey[strategy.key] = assigned.get('U1').map(c => c.ref);
  }
  assert.deepEqual(byKey.name, ['R2', 'R4', 'R3', 'R5', 'R1'], 'A-Z by customer name');
  assert.deepEqual(byKey.amount, ['R2', 'R5', 'R3', 'R4', 'R1'], 'largest arrears first');
  assert.deepEqual(byKey.days, ['R3', 'R5', 'R1', 'R4', 'R2'], 'longest days elapsed first');
  assert.deepEqual(byKey.officer, ['R1', 'R2', 'R3', 'R4', 'R5'], 'pile by ref when the deal order rotates instead');
});

test('under the officer arrangement, the deal order is the officers A-Z by name', () => {
  // Find the date whose arrangement is 'officer' within any 4-day window.
  let day = '2026-07-20';
  while (distStrategyFor(day).key !== 'officer') {
    day = new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  }
  const { assigned } = distributeToCredits(CUSTOMERS, OFFICERS, day);
  // Customers dealt in ref order R1..R5; officers A-Z = ALICE(U1), BOB(U2), CHARLIE(U3).
  assert.deepEqual(assigned.get('U1').map(c => c.ref), ['R1', 'R4']);
  assert.deepEqual(assigned.get('U2').map(c => c.ref), ['R2', 'R5']);
  assert.deepEqual(assigned.get('U3').map(c => c.ref), ['R3']);
});

test('no officers -> empty deal, junk date -> still a valid arrangement', () => {
  const { assigned } = distributeToCredits(CUSTOMERS, [], '2026-07-24');
  assert.equal(assigned.size, 0);
  assert.ok(DIST_STRATEGIES.some(s => s.key === distStrategyFor('not-a-date').key));
  assert.ok(DIST_STRATEGIES.some(s => s.key === distStrategyFor(null).key));
});
