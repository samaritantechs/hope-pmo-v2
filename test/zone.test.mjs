/* WHOSE ZONE -- the zone a signed-in person sees beside their name (api/_lib/zone.js).
 *
 *   "GMOs must see ther zone names infront of their name in login e.g
 *      MARK II - "LAKE ZONE"
 *      GMO · All teams · 2026-11-10-a"
 *   "in short after switching in system everyone must see their zone"
 *   "so team name with zone infront of it, manager gmo opm etc as such too"
 *   "If an officer has team - zone is automatic of the GMO's" ... "to the respective team's gmo"
 *   "So even manager - must have gmo of one of his team and auto match gmo and zone"
 *
 * Three things are held here: the rule itself, what it costs (one read, and only when the
 * sign-in asks), and that the page draws it on the name line without touching the version
 * checks that call the same route every few minutes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { zonesOfTeams, zonesOfUser, zoneLabel, zoneAnswer, zoneOfSignIn, teamsZoned, ZONE_ROLE_COLS, ZONE_SHOWN, ZONE_BUDGET_MS } = await import('../api/_lib/zone.js');
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
  // (the window grew from 260 with the comment that says why the teams are read through teamsZoned)
  assert.ok(/function advZones_\(user, teamRows\) \{[\s\S]{0,620}zonesOfTeams\(mine\)/.test(core),
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

/* A TEAM'S ZONE IS ITS GMO'S.
     "If an officer has team - zone is automatic of the GMO's" ... "to the respective team's gmo"
     "So even manager - must have gmo of one of his team and auto match gmo and zone"
   Three officers were moved to teams whose ZONE cell on Teams & Staff was empty, and stayed filed under the zone
   they had left until somebody filled a cell. The owner's answer was the rule: nobody fills anything, the team is
   in its GMO's zone. */
const GMO_TEAMS = TEAMS.concat([
  { team: 'SENGEREMA', zone: '', gmo: ' mark   ii ', manager: 'NEEMA' },   // Mark II's other teams are LAKE ZONE
  { team: 'NEWALA', zone: null, gmo: 'Juma', manager: 'NEEMA' },           // JUMA's carry SOUTHERN HIGHLANDS and SOUTH: one each
  { team: 'LINDI', zone: '  ', gmo: 'NEW GMO', manager: 'OMAR' },          // a GMO none of whose teams has a zone
  { team: 'RUANGWA', zone: '', gmo: 'New Gmo' },
  { team: 'MASASI', zone: 'South', gmo: 'PILI' },                          // PILI: two teams in SOUTH, one in COAST
  { team: 'MTWARA', zone: 'SOUTH', gmo: 'PILI' },
  { team: 'KILWA', zone: 'Coast', gmo: 'PILI' },
  { team: 'NACHINGWEA', gmo: 'pili' },                                     // no zone key at all
]);
// The rows are the memoised read every screen shares: a write into one must fail whichever test runs first. (GMO_TEAMS is
// TEAMS and more, so those are frozen too; a test file is a module, so a write into a frozen row throws.)
GMO_TEAMS.forEach(Object.freeze);
const zonedTeam = (rows, name) => teamsZoned(rows).find(t => t.team === name);

test('a team\'s zone is its GMO\'s: an empty ZONE cell takes the zone most of that GMO\'s other teams carry', () => {
  const sengerema = zonedTeam(GMO_TEAMS, 'SENGEREMA');
  assert.equal(sengerema.zone, 'LAKE ZONE', 'the GMO is matched trimmed, in capitals, with runs of spaces as one');
  assert.equal(sengerema.zoneFromGmo, true);
  assert.equal(zonedTeam(GMO_TEAMS, 'NACHINGWEA').zone, 'SOUTH', 'the zone MOST of the GMO\'s teams carry, not the first met');
  assert.equal(zonedTeam(GMO_TEAMS.slice().reverse(), 'NACHINGWEA').zone, 'SOUTH');
  assert.equal(zonedTeam(GMO_TEAMS, 'NEWALA').zone, 'SOUTH', 'a tie goes to the first in A-to-Z order');
  assert.equal(zonedTeam(GMO_TEAMS.slice().reverse(), 'NEWALA').zone, 'SOUTH', '... whatever the order of the rows');
  // nothing is invented: no GMO, or a GMO with no team that carries a zone, is still no zone
  for (const name of ['HQ', 'LINDI', 'RUANGWA']) {
    const t = zonedTeam(GMO_TEAMS, name);
    assert.equal(String(t.zone == null ? '' : t.zone).trim(), '', name + ' was given a zone nobody typed and no GMO carries');
    assert.ok(!t.zoneFromGmo);
  }
});

test('what is typed in a team\'s own ZONE cell always stands, and the rows given are not changed', () => {
  // A FRESH copy, frozen through and through. The first form of this test took its "before" picture of the shared fixture
  // after an earlier test had already passed it through teamsZoned, so a teamsZoned that wrote into its rows had done its
  // writing before the picture was taken, and the test passed. A frozen row cannot be written into at all: it throws.
  const fresh = Object.freeze(JSON.parse(JSON.stringify(GMO_TEAMS)).map(Object.freeze));
  const before = JSON.stringify(fresh);
  assert.doesNotThrow(() => teamsZoned(fresh), 'teamsZoned wrote into the rows it was given: they are the memoised read every screen shares');
  assert.equal(JSON.stringify(fresh), before);
  for (const t of teamsZoned(fresh)) if (t.zoneFromGmo) assert.ok(!fresh.includes(t), t.team + ' took its GMO\'s zone in the very row it was given, not in a copy');
  const zoned = teamsZoned(GMO_TEAMS);
  assert.equal(zoned.length, GMO_TEAMS.length);
  for (let i = 0; i < GMO_TEAMS.length; i++) {
    const was = GMO_TEAMS[i], is = zoned[i];
    assert.equal(is.team, was.team, 'the rows come back in the order they were given');
    if (String(was.zone == null ? '' : was.zone).trim()) assert.equal(is, was, was.team + ' has its own ZONE and must come back untouched, the very row');
  }
  // KILWA is typed Coast although most of its GMO's teams are SOUTH: the cell wins
  assert.equal(zonedTeam(GMO_TEAMS, 'KILWA').zone, 'Coast');
  assert.deepEqual(teamsZoned(null), []);
  assert.deepEqual(teamsZoned([]), []);
  assert.deepEqual(teamsZoned([null, { team: 'X' }]), [null, { team: 'X' }], 'a hole in the rows is passed over');
});

/* A DASH IS NOT A PERSON, AND NOT A ZONE. The repository has one definition of "nobody named" (nameOrNull in parse.js).
   A GMO cell that holds a dash was read as a GMO called "-", so every team with a dash there was "one GMO's teams" and a
   team with no zone took a stranger's: its code then listed that zone's staff on the advance desk. Found by review. */
test('a dash is not a person, and not a zone: a cell that names nobody gives and takes no zone', () => {
  const rows = [
    { team: 'D1', zone: 'LAKE ZONE', gmo: '-' }, { team: 'D2', zone: '', gmo: '-' },                 // the same dash: not one GMO's teams
    { team: 'W1', zone: 'RZ W', gmo: 'NO GMO' }, { team: 'W2', zone: null, gmo: 'no gmo' },          // nor the same words
    { team: 'N1', zone: 'COAST', gmo: 'N/A' }, { team: 'N2', zone: '', gmo: 'n/a' },
    { team: 'U1', zone: 'COAST', gmo: '(unassigned)' }, { team: 'U2', zone: '', gmo: '(Unassigned)' },
    { team: 'Z1', zone: '\u2014', gmo: 'PILI' }, { team: 'Z2', zone: 'South', gmo: 'pili' },          // a dash in ZONE is an empty cell: it takes PILI's
    { team: 'Z3', zone: 'N/A', gmo: 'ALONE' },                                                       // ... and with no GMO's zone it is handed on empty
    { team: 'Z4', zone: 'None', gmo: 'PILI' },                                                       // "None" is not a zone PILI's teams carry
    { team: 'R1', zone: 'NORTH WEST', gmo: 'NOEL NOBODY' }, { team: 'R2', zone: '', gmo: 'noel  nobody' },   // real names that only begin like one
    { team: 'R3', zone: 'NONE SUCH', gmo: 'NORA' }, { team: 'R4', zone: ' ', gmo: 'Nora' },
  ];
  const before = JSON.stringify(rows);
  const z = name => teamsZoned(rows).find(t => t.team === name);
  for (const name of ['D2', 'W2', 'N2', 'U2']) {
    assert.equal(z(name).zone || '', '', name + ' took a zone from a team that merely has the same placeholder in its GMO cell');
    assert.ok(!z(name).zoneFromGmo);
  }
  assert.equal(z('Z1').zone, 'SOUTH'); assert.equal(z('Z1').zoneFromGmo, true);
  assert.equal(z('Z4').zone, 'SOUTH', 'a placeholder in a ZONE cell is not counted among the zones a GMO\'s teams carry');
  assert.equal(z('Z3').zone, '', 'a ZONE cell that names no zone is handed on as the empty cell it is');
  assert.equal(z('R2').zone, 'NORTH WEST'); assert.equal(z('R4').zone, 'NONE SUCH', 'a real name or zone that begins like a placeholder is a name');
  assert.equal(JSON.stringify(rows), before, 'the rows given are not changed');
  // what a person then sees: said, never a zone called "-" or "N/A", and never a stranger's
  assert.deepEqual(zoneAnswer({ name: 'D2 \u00b7 F.O', role: 'FIELD OFFICER', teams: ['D2'], teamCode: true }, rows), { zone: '', zones: [], zoneUnset: true });
  assert.deepEqual(zoneAnswer({ name: 'Z3 \u00b7 F.O', role: 'FIELD OFFICER', teams: ['Z3'], teamCode: true }, rows), { zone: '', zones: [], zoneUnset: true });
  assert.deepEqual(zoneAnswer({ name: 'Z1 \u00b7 F.O', role: 'FIELD OFFICER', teams: ['Z1'], teamCode: true }, rows), { zone: 'SOUTH', zones: ['SOUTH'] });
  // the definition is the repository's, not a second one: the same cells the importer stores as NULL
  const zone = read('api/_lib/zone.js');
  assert.ok(/import \{ nameOrNull \} from '\.\/parse\.js';/.test(zone) && /const cell = v => \{ const s = nameOrNull\(v\);/.test(zone),
    'zone.js no longer asks nameOrNull who is nobody: it tests a cell for emptiness again');
});

test('a cell pasted from Excel or WhatsApp: a no-break space, a tab or a line break is a blank', () => {
  const rows = [
    { team: 'P1', zone: 'RZ A\n', gmo: 'GMO\u00A0ONE' },         // a no-break space inside the GMO's name
    { team: 'P2', zone: '\t', gmo: ' gmo   one\u00A0' },          // a ZONE cell holding only a tab is empty
    { team: 'P3', zone: '\u00A0', gmo: 'GMO\tONE' },
  ];
  const zoned = teamsZoned(rows);
  assert.equal(zoned[1].zone, 'RZ A'); assert.equal(zoned[2].zone, 'RZ A');
  assert.equal(zoned[0], rows[0], 'the team with its own zone is the very row');
});

test('the name line follows it: the team\'s officers, its manager and its GMO see the GMO\'s zone, not NO ZONE SET', () => {
  // a team code: "If an officer has team - zone is automatic of the GMO's"
  assert.deepEqual(zoneAnswer({ name: 'SENGEREMA · F.O', role: 'FIELD OFFICER', teams: ['SENGEREMA'], teamCode: true }, GMO_TEAMS),
    { zone: 'LAKE ZONE', zones: ['LAKE ZONE'] }, 'the GMO\'s other teams lie outside the code\'s own team and still decide its zone');
  // "So even manager - must have gmo of one of his team": NEEMA manages SENGEREMA and NEWALA, neither with a ZONE of its own
  assert.equal(zoneLabel(zonesOfUser({ name: 'NEEMA', role: 'MANAGER', teams: null }, GMO_TEAMS)), 'LAKE ZONE, SOUTH');
  assert.equal(zoneLabel(zonesOfUser({ name: 'NEEMA', role: 'MANAGER', teams: ['SENGEREMA'] }, GMO_TEAMS)), 'LAKE ZONE');
  // a code that only holds the team
  assert.equal(zoneLabel(zonesOfUser({ name: 'NOBODY', role: 'OPM', teams: ['NACHINGWEA', 'HQ'] }, GMO_TEAMS)), 'SOUTH');
  // the GMO himself is unchanged by it: his zones were already his teams'
  assert.deepEqual(zoneAnswer({ name: 'MARK II', role: 'GMO', teams: null }, GMO_TEAMS), { zone: 'LAKE ZONE', zones: ['LAKE ZONE'] });
  // and where the GMO has no zone either, it is still said, not left blank
  assert.deepEqual(zoneAnswer({ name: 'LINDI · F.O', role: 'FIELD OFFICER', teams: ['LINDI'], teamCode: true }, GMO_TEAMS), { zone: '', zones: [], zoneUnset: true });
  assert.deepEqual(zoneAnswer({ name: 'OMAR', role: 'MANAGER', teams: null }, GMO_TEAMS), { zone: '', zones: [], zoneUnset: true });
});

test('the advance desk reads the teams through the same rule, before it filters by team, and it costs no read', async () => {
  const core = read('api/_lib/portal-core.js');
  assert.ok(/import \{ zonesOfTeams, teamsZoned \} from '\.\/zone\.js';/.test(core));
  assert.ok(/function advZones_\(user, teamRows\) \{[\s\S]{0,560}const mine = teamsZoned\(teamRows\)\.filter\(t => teamAllowed\(user, t\.team\)\);\s*\n\s*const zones = zonesOfTeams\(mine\);/.test(core),
    'advZones_ no longer reads the teams through teamsZoned BEFORE filtering by team: a team with an empty ZONE cell would hold no zone on the '
    + 'advance desk while the name line shows its GMO\'s, and its officers could not find their own names');
  // the sign-in still makes ONE read, of the same eleven columns: the GMO column was already among them
  const db0 = fakeDb({ teams: GMO_TEAMS });
  const asked = [];
  const db = { from(n) { const q = db0.from(n); return { select(cols) { asked.push(n + ': ' + cols); return q.select(cols); } }; } };
  assert.deepEqual(await zoneOfSignIn(db, { name: 'SENGEREMA · F.O', role: 'FIELD OFFICER', teams: ['SENGEREMA'], teamCode: true }), { zone: 'LAKE ZONE', zones: ['LAKE ZONE'] });
  assert.deepEqual(asked, ['teams: team, zone, ' + ZONE_ROLE_COLS.join(', ')], 'the zone of a team\'s GMO is worked out from the rows already read');
  assert.ok(ZONE_ROLE_COLS.includes('gmo'));
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
