/* WHOSE ZONE -- the zone a signed-in person sees beside their name (api/_lib/zone.js).
 *
 *   "GMOs must see ther zone names infront of their name in login e.g
 *      MARK II - "LAKE ZONE"
 *      GMO · All teams · 2026-11-10-a"
 *   "in short after switching in system everyone must see their zone"
 *   "so team name with zone infront of it, manager gmo opm etc as such too"
 *
 * Three things are held here: the rule itself, what it costs (one read, and only when the
 * sign-in asks), and that the page draws it on the name line without touching the version
 * checks that call the same route every few minutes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { zonesOfTeams, zonesOfUser, zoneLabel, zoneAnswer, zoneOfSignIn, ZONE_ROLE_COLS, ZONE_SHOWN, ZONE_BUDGET_MS } = await import('../api/_lib/zone.js');
const { fakeDb } = await import('./fake-db.mjs');
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const TEAMS = [
  { team: 'MWANZA', zone: 'Lake Zone', gmo: 'Mark II', manager: 'ANNA', opm: 'OTTO', bike: 'BAKARI' },
  { team: 'GEITA', zone: 'LAKE ZONE ', gmo: 'MARK II', manager: 'BEN', opm: 'OTTO', collection: 'CHAUSIKU' },
  { team: 'VWAWA', zone: 'Southern Highlands', gmo: 'JUMA', manager: 'ANNA', legal: 'LEAH' },
  { team: 'TUNDURU', zone: 'South', gmo: 'JUMA', manager: 'DAUDI', credit: 'CAROL' },
  { team: 'KIGOMA', zone: 'West', gmo: 'WEMA', manager: 'DAUDI', credit: 'CAROL' },
  { team: 'HQ', zone: '', gmo: null, manager: 'HQ ONLY' },
];
const label = u => zoneLabel(zonesOfUser(u, TEAMS));

test('the owner\'s example: a GMO who holds ALL teams still sees the one zone they run', () => {
  assert.equal(label({ name: 'MARK II', role: 'GMO', teams: null }), 'LAKE ZONE');
});

test('a name is matched the way the portal matches a leader: trimmed, in capitals, in any role column', () => {
  assert.equal(label({ name: '  mark ii ', role: 'GMO', teams: null }), 'LAKE ZONE', 'case and spaces do not matter');
  for (const [name, col, want] of [['OTTO', 'opm', 'LAKE ZONE'], ['BAKARI', 'bike', 'LAKE ZONE'], ['CHAUSIKU', 'collection', 'LAKE ZONE'],
    ['LEAH', 'legal', 'SOUTHERN HIGHLANDS'], ['CAROL', 'credit', 'SOUTH, WEST']]) {
    assert.ok(ZONE_ROLE_COLS.includes(col));
    assert.equal(label({ name, role: 'X', teams: null }), want, name + ' is named under ' + col);
  }
  assert.equal(label({ name: 'MARK', role: 'GMO', teams: null }), '', 'half a name is somebody else');
});

test('a manager over two zones sees both, in order; past ' + ZONE_SHOWN + ' the rest are counted', () => {
  assert.equal(label({ name: 'ANNA', role: 'MANAGER', teams: null }), 'LAKE ZONE, SOUTHERN HIGHLANDS');
  assert.equal(zoneLabel(['A', 'B', 'C', 'D']), 'A, B +2');
  assert.equal(zoneLabel(['A', 'B']), 'A, B');
  assert.equal(zoneLabel([]), '');
  assert.equal(zoneLabel(null), '');
});

test('a team code is the team: it shows the team\'s zone and is never matched as a name', () => {
  assert.equal(label({ name: 'VWAWA · F.O', role: 'FIELD OFFICER', teams: ['VWAWA'], teamCode: true }), 'SOUTHERN HIGHLANDS');
  // a team whose name is also somebody's name on another team must not borrow that person's zone
  const rows = TEAMS.concat([{ team: 'ANNA', zone: 'Coast', gmo: 'X' }]);
  assert.equal(zoneLabel(zonesOfUser({ name: 'ANNA', role: 'FIELD OFFICER', teams: ['ANNA'], teamCode: true }, rows)), 'COAST');
});

test('named nowhere: the zones of the teams the code holds, exactly as the advance desk reads them', () => {
  assert.equal(label({ name: 'NOBODY', role: 'OPM', teams: ['geita', 'HQ'] }), 'LAKE ZONE', 'team names match whatever the case');
  assert.equal(label({ name: 'NOBODY', role: 'OPM', teams: ['TUNDURU', 'KIGOMA', 'VWAWA'] }), 'SOUTH, SOUTHERN HIGHLANDS +1');
  assert.equal(label({ name: 'NOBODY', role: 'OPM', teams: ['HQ'] }), '', 'a team with no zone gives none');
  assert.deepEqual(zonesOfTeams(TEAMS), ['LAKE ZONE', 'SOUTH', 'SOUTHERN HIGHLANDS', 'WEST'], 'one spelling a zone, in capitals, in order');
  const core = read('api/_lib/portal-core.js');
  assert.ok(/function advZones_\(user, teamRows\) \{[\s\S]{0,260}zonesOfTeams\(mine\)/.test(core),
    'advZones_ no longer reads zonesOfTeams: the advance desk and the name line are two definitions of a zone again');
});

test('a code with a team list is looked for among its own teams and nowhere else', () => {
  // CAROL is the credit analyst of TUNDURU (South) and KIGOMA (West) on Teams & Staff.
  assert.equal(label({ name: 'CAROL', role: 'CREDIT', teams: null }), 'SOUTH, WEST', 'holding every team: wherever she is named');
  assert.equal(label({ name: 'CAROL', role: 'CREDIT', teams: ['TUNDURU', 'MWANZA'] }), 'SOUTH',
    'named on one of her two teams: that team\'s zone, not both');
  assert.equal(label({ name: 'CAROL', role: 'CREDIT', teams: ['MWANZA'] }), 'LAKE ZONE',
    'a namesake on a team outside the code\'s own must not lend its zone: every screen she opens is MWANZA\'s');
  // never a zone the advance desk would not give the same code
  for (const u of [{ name: 'CAROL', teams: ['MWANZA'] }, { name: 'ANNA', teams: ['GEITA', 'KIGOMA'] }, { name: 'MARK II', teams: ['VWAWA'] }]) {
    const held = zonesOfTeams(TEAMS.filter(t => u.teams.includes(t.team)));
    for (const z of zonesOfUser(u, TEAMS)) assert.ok(held.includes(z), u.name + ' is shown ' + z + ', which is not a zone of the teams the code holds');
  }
});

test('named on teams that have no zone: the code\'s own teams answer instead', () => {
  assert.equal(label({ name: 'HQ ONLY', role: 'MANAGER', teams: ['KIGOMA'] }), 'WEST');
  assert.equal(label({ name: 'HQ ONLY', role: 'MANAGER', teams: null }), '');
});

test('an admin, or anybody holding every team and named nowhere, has no zone and none is invented', () => {
  assert.equal(label({ name: 'ADMIN', role: 'ADMIN', teams: null }), '');
  assert.deepEqual(zonesOfUser(null, TEAMS), []);
  assert.deepEqual(zonesOfUser({ name: '', role: 'X', teams: null }, TEAMS), [], 'a blank name matches no blank cell');
  assert.deepEqual(zonesOfUser({ name: 'MARK II', teams: null }, null), []);
});

test('no zone is said, not left blank: ALL ZONES for a code over every team, NO ZONE SET for teams without one', () => {
  // "am not seeing my zone yet" -- an ADMIN over all teams, named on no team
  assert.deepEqual(zoneAnswer({ name: 'MARK II', role: 'ADMIN', teams: null }, TEAMS.map(t => ({ ...t, gmo: 'SOMEBODY ELSE' }))),
    { zone: '', zones: [], zoneAll: true }, 'holds every team and is named nowhere: every zone, as the advance desk reads it');
  assert.deepEqual(zoneAnswer({ name: 'ADMIN', role: 'ADMIN', teams: null }, []), { zone: '', zones: [], zoneAll: true }, 'an empty Teams & Staff');
  // named, and the teams that name them have an empty ZONE cell: that is a gap on Teams & Staff, not "every zone"
  assert.deepEqual(zoneAnswer({ name: 'HQ ONLY', role: 'MANAGER', teams: null }, TEAMS), { zone: '', zones: [], zoneUnset: true });
  assert.deepEqual(zoneAnswer({ name: 'NOBODY', role: 'OPM', teams: ['HQ'] }, TEAMS), { zone: '', zones: [], zoneUnset: true }, 'a team list whose teams have no zone');
  assert.deepEqual(zoneAnswer({ name: 'HQ · F.O', role: 'FIELD OFFICER', teams: ['HQ'], teamCode: true }, TEAMS), { zone: '', zones: [], zoneUnset: true }, 'a team code on such a team');
  assert.deepEqual(zoneAnswer({ name: 'NOBODY', role: 'OPM', teams: ['NOT A TEAM'] }, TEAMS), { zone: '', zones: [], zoneUnset: true }, 'a team list naming no team of Teams & Staff');
  // a zone that IS known is never dressed as one of the two
  assert.deepEqual(zoneAnswer({ name: 'MARK II', role: 'GMO', teams: null }, TEAMS), { zone: 'LAKE ZONE', zones: ['LAKE ZONE'] });
  assert.deepEqual(zoneAnswer({ name: 'VWAWA · F.O', role: 'FIELD OFFICER', teams: ['VWAWA'], teamCode: true }, TEAMS), { zone: 'SOUTHERN HIGHLANDS', zones: ['SOUTHERN HIGHLANDS'] });
  assert.deepEqual(zoneAnswer(null, TEAMS), { zone: '', zones: [] }, 'nobody signed in: neither');
});

test('a zone that could not be read is neither: the name stays bare rather than say ALL ZONES of a book that did not answer', async () => {
  const errors = { from() { return { select: async () => ({ data: null, error: { message: 'timeout' } }) }; } };
  const got = await zoneOfSignIn(errors, { name: 'ADMIN', role: 'ADMIN', teams: null });
  assert.deepEqual(got, { zone: '', zones: [] });
  assert.ok(!('zoneAll' in got) && !('zoneUnset' in got));
  const ok = await zoneOfSignIn(fakeDb({ teams: TEAMS }), { name: 'ADMIN', role: 'ADMIN', teams: null });
  assert.deepEqual(ok, { zone: '', zones: [], zoneAll: true }, 'read, and it is every zone');
});

test('the sign-in\'s answer costs ONE read of the teams table', async () => {
  const db0 = fakeDb({ teams: TEAMS });
  let trips = 0; const tables = [];
  // the counter test/speed.test.mjs uses: a request is counted where it is answered, however it was chained
  const wrap = q => new Proxy(q, { get(o, p) {
    if (p === 'then') return (res, rej) => o.then(r => { trips++; return res(r); }, rej);
    const v = o[p];
    return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? wrap(o) : out; } : v;
  } });
  const db = { from(n) { tables.push(n); return wrap(db0.from(n)); } };
  const out = await zoneOfSignIn(db, { name: 'MARK II', role: 'GMO', teams: null });
  assert.deepEqual(out, { zone: 'LAKE ZONE', zones: ['LAKE ZONE'] });
  assert.equal(trips, 1, 'one round trip');
  assert.deepEqual(tables, ['teams'], 'and nothing but the teams table');
});

test('a database without the zone column, or a read that fails, is "no zone" and never a failed sign-in', async () => {
  const none = { zone: '', zones: [] };
  // The rows still carry a zone: only a refused read, honoured, can make this "no zone".
  const noColumn = fakeDb({ teams: TEAMS }, { missingColumns: { teams: ['zone', 'legal', 'collection'] } });
  assert.deepEqual(await zoneOfSignIn(noColumn, { name: 'MARK II', teams: null }), none, 'the migration has not been run');
  const errorWithRows = { from() { return { select: async () => ({ data: TEAMS, error: { code: '42703', message: 'column teams.zone does not exist' } }) }; } };
  assert.deepEqual(await zoneOfSignIn(errorWithRows, { name: 'MARK II', teams: null }), none, 'an error is an error, whatever came with it');
  const rejects = { from() { return { select: () => Promise.reject(new Error('socket hang up')) }; } };
  assert.deepEqual(await zoneOfSignIn(rejects, { name: 'MARK II', teams: null }), none);
  const throws = { from() { throw new Error('the database is not answering'); } };
  assert.deepEqual(await zoneOfSignIn(throws, { name: 'MARK II', teams: null }), none);
  const errors = { from() { return { select: async () => ({ data: null, error: { message: 'timeout' } }) }; } };
  assert.deepEqual(await zoneOfSignIn(errors, { name: 'MARK II', teams: null }), none);
  assert.deepEqual(await zoneOfSignIn(fakeDb({ teams: [] }), { name: 'MARK II', teams: null }), { zone: '', zones: [], zoneAll: true },
    'an empty teams table was READ: a code over every team holds every zone of it');
});

test('a slow teams table does not hold the sign-in: past the budget the answer is "no zone"', async () => {
  const none = { zone: '', zones: [] };
  assert.ok(ZONE_BUDGET_MS > 0 && ZONE_BUDGET_MS <= 2000, 'the budget is a ceiling on a decoration, not a wait: ' + ZONE_BUDGET_MS);
  const after = ms => ({ from() { return { select: () => new Promise(r => setTimeout(() => r({ data: TEAMS, error: null }), ms)) }; } });
  let t0 = Date.now();
  assert.deepEqual(await zoneOfSignIn(after(400), { name: 'MARK II', teams: null }, 25), none, 'the read was still out when the budget ended');
  assert.ok(Date.now() - t0 < 300, 'and the sign-in was not kept for the read: ' + (Date.now() - t0) + ' ms');
  const never = { from() { return { select: () => new Promise(() => {}) }; } };
  t0 = Date.now();
  assert.deepEqual(await zoneOfSignIn(never, { name: 'MARK II', teams: null }, 25), none, 'a read that never answers');
  assert.ok(Date.now() - t0 < 300);
  assert.deepEqual(await zoneOfSignIn(after(5), { name: 'MARK II', teams: null }, 500), { zone: 'LAKE ZONE', zones: ['LAKE ZONE'] }, 'inside the budget it is read');
});

test('/api/me reads the zone only when the sign-in asks, and beside its other reads', () => {
  const me = read('api/me.js');
  // Declared WITHOUT an await: the read is started here and collected at the end, beside the others.
  const decl = "const zoneAsked = String(req.query.zone || '') === '1' ? zoneOfSignIn(supabase, user) : null;";
  assert.ok(me.includes(decl),
    'the zone is no longer started by ?zone=1 alone and left running: either every version check pays a read for it, or the sign-in waits on it');
  assert.ok(/\.\.\.\(zoneAsked \? await zoneAsked : \{\}\)/.test(me), 'the answer is not on the reply');
  const at = me.indexOf(decl), firstOther = me.indexOf('withoutIdleApprovalTab(supabase, user, user.tabs)');
  assert.ok(at >= 0 && firstOther >= 0 && at < firstOther,
    'the zone read is started after the other reads: the sign-in is a round trip slower for it');
  assert.ok(me.indexOf('await zoneAsked') > me.indexOf('await isSystemOpen(supabase)'), 'and collected after them');
});

test('the page asks for the zone at sign-in only, and writes it beside the name as text', () => {
  const app = read('public/app.html');
  const asks = app.match(/fetch\('\/api\/me\?code='[^)]*\)[^)]*\)/g) || [];
  const withZone = asks.filter(a => a.includes("'&zone=1'"));
  assert.equal(withZone.length, 2, 'the typed sign-in and the stored-code sign-in ask for the zone: ' + JSON.stringify(asks));
  assert.ok(withZone.some(a => a.includes('encodeURIComponent(code)')) && withZone.some(a => a.includes('encodeURIComponent(saved)')));
  // the version checks (every fifteen minutes; every deck refetch) and the HOPE LOAN switch ask for the build alone
  const plain = asks.filter(a => a.includes('encodeURIComponent(S.code)'));
  assert.ok(plain.length >= 3 && plain.every(a => !a.includes('zone')), 'a version check now pays for the zone read: ' + JSON.stringify(plain));
  assert.ok(app.includes(`var zoneText = me.zone || (me.zoneAll ? 'ALL ZONES' : (me.zoneUnset ? 'NO ZONE SET' : ''));`),
    'no zone is no longer said: a name with nothing beside it cannot be told from a fault');
  assert.ok(app.includes(`$('#meName').textContent = me.name + (zoneText ? ' - "' + zoneText + '"' : '');`),
    'the name line is not  NAME - "ZONE"  any more, or it stopped being written as text');
  assert.ok(!/#meName'\)\.innerHTML/.test(app), 'a name or a zone typed on Teams & Staff must never be drawn as markup');
  // the HOPE LOAN switch asks /api/me again without the zone and replaces S.me: the zone already held is kept
  assert.ok(/if \(S\.me && x\.body\.zone === undefined\) \{ x\.body\.zone = S\.me\.zone; x\.body\.zones = S\.me\.zones; x\.body\.zoneAll = S\.me\.zoneAll; x\.body\.zoneUnset = S\.me\.zoneUnset; \}\s*\n\s*S\.me = x\.body;/.test(app),
    'replacing S.me drops the zone the sign-in paid for');
});

test('neither the upload nor the call app reads a zone for anybody\'s name', () => {
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) {
    assert.ok(!/zone\.js|zoneOfSignIn/.test(read(f)), f + ' now reads the sign-in zone: count the read (CLAUDE.md section 1)');
  }
});
