// The docket key -- the one number a customer keeps across every loan (api/_lib/docket.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { docketKeyOf, refFor, docketFromRef } from '../api/_lib/docket.js';

test('docketKeyOf: a reference decodes to its docket digits for tracks 1-10; a known docket wins; dashes never matter', () => {
  assert.equal(docketKeyOf('22171109841'), '2217110984', 'track 1');
  assert.equal(docketKeyOf('221711098410'), '2217110984', 'track 10: a ref ending in 0 carries a two-digit track');
  assert.equal(docketKeyOf('22171109842'), '2217110984', 'track 2 of the same customer: the same key');
  assert.equal(docketKeyOf('22171109841', '2-217-110984'), '2217110984', 'the report\'s own docket, dashes and all, is the same key');
  assert.equal(docketKeyOf('99999999', '3-001-000001'), '3001000001', 'and a known docket wins over the reference');
  assert.equal(docketKeyOf('221711098411'), '22171109841', 'track 11 (ref = docket + 11) decodes one digit long -- never another customer\'s key, only an unmerged one');
  assert.equal(docketKeyOf(''), ''); assert.equal(docketKeyOf('X'), ''); assert.equal(docketKeyOf(null, null), '');
  assert.equal(docketKeyOf('22171109841', 'na'), '2217110984', 'a docket with no digits is no docket');
});

test('refFor and docketFromRef still round-trip, as loan-core always promised', () => {
  for (const t of [1, 2, 9, 10]) {
    const ref = refFor('2-217-110984', t);
    assert.deepEqual(docketFromRef(ref), { docket: '2-217-110984', track: t });
    assert.equal(docketKeyOf(ref), '2217110984');
  }
});
