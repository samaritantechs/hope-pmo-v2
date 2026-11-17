/* THE ADVANCE REPORT'S ACCOUNT COLUMN (docs/HANDOFF.md Part 102).
 *
 *   "So updating these bank details, the missing account numbers at advance salary tabs automatically fill themselves? This was one of my
 *    objective since finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026
 *
 * A request carries a COPY of the staff's account as it was when they asked (advRequest). The report printed that copy first and the
 * registry's account only when the copy was empty, so:
 *   - a copy that was junk ("N/A", "ON PROCESS", zeros) went on hiding the real number the registry now holds, for ever;
 *   - and once a report named more than 400 different staff (a whole month's, the finance manager's) the registry was not read at all:
 *     every bank, phone and registry account on it came back empty, without a word.
 * Now an account is what hasAccount says it is (the owner's own definition, RUN-ME-069), the request's copy wins when it is one, the
 * registry's real number fills what is not, and the registry is read in chunks of 400. A REAL copy is never replaced by another number:
 * whether the registry's latest should win over an older real copy is the owner's to say (CHAT.md section 8), and this pins that it does not.
 *
 * Reads: up to 400 staff the report makes the one registry read it always made (test/speed.test.mjs holds its budget); beyond that, one
 * more for each 400. Nothing on /api/upload or /api/call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { hasAccount } = await import('../api/_lib/parse.js');

const NOW = Date.parse('2026-11-17T09:00:00Z');
const ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload', 'advrep'] };      // an admin: the whole window, no routing to read
const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

/** A database with a book of Approved requests this month; each entry is [request's copy, registry's account, registry's bank]. */
function book(entries) {
  const registry = [], requests = [];
  entries.forEach(([copy, reg, bank], i) => {
    const id = 'S' + i + '/' + String(100 + i) + '/2026';
    registry.push({ id, name: 'STAFF ' + i, role: 'Field Officer - KONGOWE', zone: 'DAR EAST', status: 'Active', account: reg, bank: bank === undefined ? 'CRDB' : bank, phone: '7' + String(10000000 + i) });
    requests.push({ id: 'r' + i, submitted_at: '2026-11-10T08:00:00.000Z', staff_id: id, staff_name: 'STAFF ' + i, staff_role: 'Field Officer - KONGOWE', app_date: '2026-11-10',
      amount: 50000, approval: 'Approved', comment: null, zone: 'DAR EAST', code: 'KONGOWE', account: copy, decided_by: 'GMO D', decided_at: '2026-11-11T08:00:00.000Z', created_by: 'X', created_at: '2026-11-10T08:00:00.000Z' });
  });
  return fakeDb({ teams: [{ team: 'KONGOWE', zone: 'DAR EAST', gmo: 'GMO D' }], settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }], roles: [], access_codes: [], staff_registry: registry, advance_requests: requests });
}
const report = async (db) => (await portalApi(db, ADMIN, 'advReport', {}, NOW));
const counted = db => { let n = 0; return { n: () => n, db: { ...db, from(name) { if (name === 'staff_registry') n++; return db.from(name); } } }; };

test('a request with no account of its own prints the registry\'s account, bank and phone: what the update puts there fills the report with no other step', async () => {
  const rep = await report(book([[null, '0152000111', 'NMB']]));
  assert.equal(rep.rows[0].account, '0152000111'); assert.equal(rep.rows[0].bank, 'NMB'); assert.equal(rep.rows[0].phone, '710000000');
});

test('a copy that is not an account (N/A, ON PROCESS, a dash, zeros, blanks) no longer hides the registry\'s real number', async () => {
  const junk = ['N/A', 'ON PROCESS', 'NONE', '-', 'HAINA', '0000000000', '   ', ''];
  const rep = await report(book(junk.map(j => [j, '0152000999'])));
  assert.deepEqual(rep.rows.map(r => r.account), junk.map(() => '0152000999'), 'every junk copy gives way to the registry\'s real account');
});

test('a copy that is an account is NEVER replaced by another number here (the older real copy stays: the owner has not said otherwise)', async () => {
  const rep = await report(book([['0152000111', '0152000999'], ['10583333333', null], ['0152000ABCD00', '0152000999']]));
  assert.deepEqual(rep.rows.map(r => r.account), ['0152000111', '10583333333', '0152000ABCD00']);
});

test('when neither is an account, what was there prints as before: the copy first, else the registry\'s text, else nothing', async () => {
  const rep = await report(book([['N/A', 'ON PROCESS'], [null, 'HAINA'], [null, null], ['', '']]));
  assert.deepEqual(rep.rows.map(r => r.account), ['N/A', 'HAINA', null, null]);
});

test('a report that names more than 400 different staff still reads the registry, 400 at a time; up to 400 it is the one read it always was', async () => {
  const big = book(Array.from({ length: 1000 }, (_, i) => [i % 2 ? 'N/A' : null, '01520' + String(100000 + i)]));
  const c = counted(big);
  const rep = await report(c.db);
  assert.equal(rep.rows.length, 1000);
  assert.equal(rep.rows.filter(r => r.account && r.account.startsWith('01520') && r.bank === 'CRDB' && r.phone).length, 1000, 'every row of a thousand has its registry account, bank and phone');
  assert.equal(c.n(), 3, 'a thousand staff are three reads of 400, 400 and 200');
  for (const [n, reads] of [[1, 1], [399, 1], [400, 1], [401, 2], [800, 2], [801, 3]]) {
    const cc = counted(book(Array.from({ length: n }, (_, i) => [null, '01520' + String(100000 + i)])));
    const r = await report(cc.db);
    assert.equal(r.rows.length, n); assert.equal(cc.n(), reads, n + ' staff: ' + reads + ' read(s)');
    assert.equal(r.rows.filter(x => x.account).length, n, n + ' staff all filled');
  }
  assert.equal(counted(book([])).n(), 0); const none = counted(book([])); await report(none.db); assert.equal(none.n(), 0, 'an empty report reads no registry');
});

test('a request with no registry row (a call-agents roster name: no staff ID) prints its own copy and nothing else, as before', async () => {
  const db = book([['0152000555', '0152000999']]);
  db._dump('advance_requests').push({ id: 'cs1', submitted_at: '2026-11-10T08:00:00.000Z', staff_id: null, staff_name: 'ROSTER NAME', staff_role: 'CUSTOMER SERVICE', app_date: '2026-11-10', amount: 50000, approval: 'Approved', zone: null, account: 'N/A', decided_by: 'X', decided_at: '2026-11-11T08:00:00.000Z', created_at: '2026-11-10T08:00:00.000Z' });
  const rep = await report(db);
  const cs = rep.rows.find(r => r.id === 'cs1');
  assert.equal(cs.account, 'N/A'); assert.equal(cs.bank, null);
  assert.equal(rep.rows.find(r => r.id === 'r0').account, '0152000555');
});

test('hasAccount is the owner\'s own definition of "an account number" (RUN-ME-069): the same answer as the SQL, on every kind of cell', () => {
  const yes = ['0152000111', '10583333333', '0152000ABCD00', '1', '0000000001', 'A1', 'ACC 12345', '152 000 111', 12345, '0.5'];
  const no = ['', '  ', null, undefined, 'N/A', 'NONE', 'ON PROCESS', '-', 'HAINA', '0', '0000000000', '00 00', '0.0', 'NIL', 0];
  for (const v of yes) assert.equal(hasAccount(v), true, JSON.stringify(v));
  for (const v of no) assert.equal(hasAccount(v), false, JSON.stringify(v));
  // the SQL of RUN-ME-069 says: no account = the digits of the cell are empty or all zeros. Written again here from that sentence and compared on 20,000 cells.
  const sql = rd('db/RUN-ME-069-staff-without-bank-account-read-only.sql');
  assert.ok(/regexp_replace\(coalesce\(r\.account, ''\), '\\D', '', 'g'\) ~ '\^0\*\$'/.test(sql), 'RUN-ME-069 still says it that way: change one and change the other');
  const noAccountSql = v => /^0*$/.test(String(v == null ? '' : v).replace(/\D/g, ''));
  const alphabet = ['0', '0', '0', '1', '5', '9', ' ', '-', '.', 'N', '/', 'A', 'U', 'J'];
  let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 20000; i++) {
    const len = rnd(9); let s = ''; for (let k = 0; k < len; k++) s += alphabet[rnd(alphabet.length)];
    assert.equal(hasAccount(s), !noAccountSql(s), JSON.stringify(s));
  }
});

test('the report reads its accounts through the two helpers and nothing else decides the column', () => {
  const src = rd('api/_lib/portal-core.js');
  assert.match(src, /const advAccountOf_ = \(r, s\) => \(hasAccount\(r\.account\) \? r\.account : hasAccount\(s\.account\) \? s\.account : \(r\.account \|\| s\.account \|\| null\)\);/);
  assert.match(src, /const reg = await advRegistryOf_\(db, ids\);/);
  assert.match(src, /account: advAccountOf_\(r, s\), phone: s\.phone \|\| null/);
  assert.match(src, /const ADV_REG_CHUNK = 400;/);
  assert.doesNotMatch(src, /ids\.length <= 400/, 'the cliff at 400 staff is gone');
});
