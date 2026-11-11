/* THE STAFF-CHANGE TEMPLATES CARRY NO STAFF (docs/HANDOFF.md Part 48).
 *
 *   "Ill be comming with staff db updates simce GMOs comfirm of changes in my whatsapp group"
 *   "dont correct names using the gmo data i bring unless its new staff"
 *
 * A GMO's list is answered with a FILLED COPY of db/TEMPLATE-staff-changes-from-gmo.sql, handed
 * to the owner. The repository is public: the day a filled copy is committed, the names of the
 * people who left and joined a team are on the internet. So that is written down here as
 * something that fails, along with the three promises the scripts make to the live book: they
 * delete nothing, they never re-spell a name, and their time limits end with the script.
 *
 * It reads two files and no database. The scripts themselves were run on a PostgreSQL holding
 * this repository's schema; node cannot do that here, and this test does not pretend to. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const LIST = 'db/TEMPLATE-staff-changes-from-gmo.sql', BY_ID = 'db/TEMPLATE-staff-changes-by-id.sql';
/** The script without its comments: what the database is actually sent. */
const code = f => read(f).split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
/** Every quoted value of the VALUES block that follows `opener`. */
function listed(f, opener) {
  const s = code(f), at = s.indexOf(opener);
  assert.ok(at >= 0, f + ' has no "' + opener + '" block any more');
  const block = s.slice(at, s.indexOf('\n),', at));
  return [...block.matchAll(/'([^']*)'/g)].map(m => m[1]);
}
const HOW = '. The repository is public: hand the filled copy to the owner and commit the template as it was (docs/HANDOFF.md Part 48).';

test('the list template names nobody: placeholders only', () => {
  const values = listed(LIST, 'ask(n, team, act, name) as (values');
  assert.ok(values.length >= 6, 'the example list is gone');
  for (const v of values) {
    assert.ok(/^(REMOVE|ADD|TEAM (ONE|TWO)|(FIRST|ANOTHER|THIRD) MIDDLE LAST)$/.test(v),
      LIST + ' carries "' + v + '" in its list' + HOW);
  }
  const cfg = code(LIST).slice(code(LIST).indexOf('with cfg as ('), code(LIST).indexOf('ask(n, team, act, name)'));
  assert.deepEqual([...cfg.matchAll(/'([^']*)'/g)].map(m => m[1]), ['ZONE NAME', 'GMO ZONE NAME (SQL)'],
    LIST + ' was committed with a real zone on its CHANGE lines' + HOW);
});

test('the by-ID template names nobody: placeholders only', () => {
  const values = listed(BY_ID, 'with want(id, name) as (values');
  assert.ok(values.length >= 2);
  for (const v of values) {
    assert.ok(/^([A-Z]{3}\/000[0-9]\/2026|FIRST MIDDLE LAST)$/.test(v), BY_ID + ' carries "' + v + '" in its list' + HOW);
  }
  assert.ok(code(BY_ID).includes("'GMO ZONE NAME (SQL)'"), BY_ID + ' was committed with a real zone' + HOW);
});

test('neither script deletes anything, and neither ever writes a name onto a staff who is already there', () => {
  for (const f of [LIST, BY_ID]) {
    const s = code(f).toLowerCase();
    assert.ok(!/\b(delete\s+from|truncate|drop\s+|alter\s+)/.test(s), f + ' now deletes or alters: a staff who leaves is switched to Inactive and keeps their history');
    // every UPDATE of the registry: its SET list must not touch `name`
    const sets = [...s.matchAll(/update\s+staff_registry\s+s\s+set([\s\S]*?)\bfrom\b/g)].map(m => m[1]);
    assert.ok(sets.length >= 1, f + ' no longer updates the registry the way this test reads it');
    for (const set of sets) {
      assert.ok(!/(^|,|\s)name\s*=/.test(set), f + ' re-spells a name that is already in the registry: "dont correct names using the gmo data i bring unless its new staff"');
    }
  }
  assert.equal([...code(LIST).toLowerCase().matchAll(/insert\s+into\s+staff_registry/g)].length, 1, 'one insert: a staff the registry does not hold');
  assert.equal([...code(BY_ID).toLowerCase().matchAll(/insert\s+into/g)].length, 0, 'the by-ID script adds nobody');
});

test('a staff is switched off or moved only when exactly one carries the name; the by-ID script checks the name on the ID', () => {
  const s = code(LIST);
  assert.ok(/a\.act = 'REMOVE' and a\.add_n is null and a\.nth = 1 and h\.live_n = 1 and s\.id = h\.live_id/.test(s),
    'REMOVE no longer needs exactly one live staff of that name');
  assert.ok(/a\.act = 'ADD' and a\.nth = 1 and h\.all_n = 1 and s\.id = h\.any_id/.test(s), 'a move no longer needs exactly one staff of that name');
  assert.ok(/where a\.act = 'ADD' and a\.nth = 1 and h\.all_n = 0/.test(s), 'a new staff is added although the registry holds that name');
  assert.ok(/where s\.id = was\.id and was\.same_name and upper\(btrim\(was\.status\)\) <> 'INACTIVE'/.test(code(BY_ID)),
    'the by-ID script no longer checks that the ID still carries the name: a mistyped ID would switch off somebody else');
});

test('the time limits end with the script, and both say what was done for every row', () => {
  for (const f of [LIST, BY_ID]) {
    const s = code(f);
    assert.ok(/set local lock_timeout = '5s';/.test(s) && /set local statement_timeout = '30s';/.test(s), f + ' no longer limits itself');
    // a statement of its own (at the margin), not the SET list of an UPDATE (indented)
    assert.ok(!/^set\s+(?!local)/im.test(s), f + ' leaves a setting behind on the editor\'s session');
    assert.ok(/\) as done\b|end as done\b/.test(s), f + ' no longer answers with what was done: silence reads as success');
  }
  assert.ok(/from a\s*\njoin hit h on h\.n = a\.n/.test(code(LIST)), 'the answer is no longer one row for each name asked');
});
