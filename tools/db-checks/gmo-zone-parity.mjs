/* A TEAM'S ZONE IS ITS GMO'S -- one rule, written twice, checked against itself.

     "If an officer has team - zone is automatic of the GMO's" ... "to the respective team's gmo"
     "So even manager - must have gmo of one of his team and auto match gmo and zone"

   The portal reads a team's zone with teamsZoned (api/_lib/zone.js). The staff-change scripts
   the owner runs in the SQL editor read it with the tm / gz / tz steps of
   db/TEMPLATE-staff-changes-from-gmo.sql. They are the same rule in two languages, and a drift
   between them files a staff under one zone while the portal lists their team under another.
   Node cannot run SQL in `npm test`, so this is the check that can: it draws random Teams &
   Staff tables (GMO cells in mixed case and with stray spaces, empty ZONE cells, GMOs whose
   teams sit in two zones and so give none), reads each one both ways, and fails on the first
   difference.
   It also draws what a cell holds when it names nobody (a dash, N/A, "NO GMO") and the blanks a
   cell pasted from Excel or WhatsApp carries (a no-break space, a tab, a line break): a review
   found both read differently by the two, while this check, which drew neither, passed.

   It needs a PostgreSQL it can reach with psql and NOTHING in it: the table is temporary and
   the whole case is rolled back. psql's own variables say which one:

       PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres PGDATABASE=postgres \
         node tools/db-checks/gmo-zone-parity.mjs            # CASES=300 by default

   NEVER point it at the live book: it has no reason to be there, and a chat has no way in.
   Exit code 0 = every table read alike. It refuses to pass when too few of the hard cases were
   drawn: its first form passed with the rule broken, because its random numbers were nearly
   always even and half of its cases never came up.

   BREAK THE RULE AND SEE IT FAIL before trusting a change to this file. In api/_lib/zone.js:
   let a GMO named on teams of two zones give one of them, stop reading a dash as nobody, stop
   treating runs of blanks in a GMO's name as one, or let the GMO's zone beat a typed cell.
   Each must come back DIFFERENT. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { teamsZoned } = await import(path.join(ROOT, 'api/_lib/zone.js'));
const CASES = Number(process.env.CASES || 300);

const tpl = fs.readFileSync(path.join(ROOT, 'db/TEMPLATE-staff-changes-from-gmo.sql'), 'utf8');
function cut(from, to) {
  const a = tpl.indexOf(from), b = tpl.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('the template no longer has "' + from + '" before "' + to + '": this check reads those steps by name');
  return tpl.slice(a, b);
}
// the rule, exactly as the template has it: Teams & Staff as it stands, each GMO's zone, each team's zone. It reads the
// teams table and nothing else (the registry is not read for a GMO's zone), so one temporary table is all it needs.
const RULE = 'with ' + cut('tm as (', 'z as (   -- the zone for a row').replace(/,\s*$/, '')
  + "\nselect team, coalesce(zone, ''), coalesce(how, '') from tz order by team;";
const TABLES = 'create temp table teams (team text, zone text, gmo text) on commit drop; ';
const SEP = '\x1f';
const psql = sql => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-c', sql], { encoding: 'utf8', maxBuffer: 1 << 26 });

// mulberry32: every draw uses all 32 bits. (A plain `seed * 1103515245` loses its low bits in JavaScript's
// doubles, and a check whose random numbers are nearly always even never draws half of its cases.)
let seed = 20261111;
const rnd = n => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) % n;
};
const pick = a => a[rnd(a.length)];
const ZONES = ['ZONE A', 'ZONE B', 'ZONE C-D', 'Zone E', 'zone f', 'ZONE AA', 'NORTH WEST', 'NONE SUCH'];
const GMOS = ['GMO ONE', 'GMO  TWO', 'Gmo Three', 'G. FOUR', 'GMO ÉLISE', 'NOEL NOBODY'];
// what a cell can hold instead of a name: these name nobody (nameOrNull in api/_lib/parse.js, and the words a sheet uses)
const NOBODY = ['-', '--', '\u2014', '_', '.', 'N/A', 'na', 'None', 'NIL', 'null', 'hakuna', '0', 'NO GMO', 'no-one', '(unassigned)', '(Unassigned) yet'];
// the blanks a cell pasted from Excel or WhatsApp carries: a no-break space, a tab, a line break
const BLANKS = [' ', '  ', '\u00A0', '\t', '\n', ' \u00A0 ', '\u2009', '\u3000'];
const dressGmo = s => {
  const k = rnd(9);
  return k === 0 ? pick(BLANKS) + s : k === 1 ? s + pick(BLANKS) : k === 2 ? s.toLowerCase() : k === 3 ? s.replace(/ /g, '   ')
    : k === 4 ? s.replace(/ /g, pick(BLANKS)) : s;
};
const dressZone = s => { const k = rnd(7); return k === 0 ? pick(BLANKS) + s : k === 1 ? s + pick(BLANKS) : k === 2 ? s.toLowerCase() : s; };
const q = v => (v === null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");
const K = s => String(s == null ? '' : s).trim().toUpperCase();
const byTeam = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

let bad = 0, fromGmo = 0, split = 0, spaced = 0, dashed = 0, pasted = 0;
for (let c = 0; c < CASES; c++) {
  const nGmo = 1 + rnd(4), nZone = 1 + rnd(5), n = 2 + rnd(14), teams = [];
  for (let i = 0; i < n; i++) {
    teams.push({ team: 'TEAM ' + String(i).padStart(2, '0'),
      zone: rnd(3) === 0 ? pick([null, '', ' ', '\t', '\u00A0'].concat(NOBODY)) : dressZone(ZONES[rnd(nZone)]),
      gmo: rnd(4) === 0 ? pick([null, '', '  ', '\u00A0'].concat(NOBODY)) : dressGmo(GMOS[rnd(nGmo)]) });
  }
  const sql = 'begin; ' + TABLES + 'insert into teams (team, zone, gmo) values '
    + teams.map(t => `(${q(t.team)}, ${q(t.zone)}, ${q(t.gmo)})`).join(', ') + '; ' + RULE + ' rollback;';
  const fromSql = psql(sql).trim().split('\n').filter(Boolean).map(l => l.split(SEP)).sort(byTeam);
  const fromJs = teamsZoned(teams).map(t => [t.team, K(t.zone), t.zoneFromGmo ? 'gmo' : (K(t.zone) ? 'team' : '')]).sort(byTeam);
  fromGmo += fromJs.filter(r => r[2] === 'gmo').length;
  if (JSON.stringify(fromJs) !== JSON.stringify(fromSql)) {
    bad++;
    if (bad <= 3) console.log('DIFFERENT, table ' + c + '\n  Teams & Staff: ' + JSON.stringify(teams) + '\n  the portal:    ' + JSON.stringify(fromJs) + '\n  the script:    ' + JSON.stringify(fromSql));
  }
  const zonesOfGmo = new Map();
  const isNobody = v => NOBODY.some(x => K(v) === K(x));
  for (const t of teams) {
    const g = K(t.gmo).replace(/\s+/g, ' ');
    if (g && !isNobody(t.gmo) && K(t.zone) && !isNobody(t.zone)) zonesOfGmo.set(g, (zonesOfGmo.get(g) || new Set()).add(K(t.zone)));
  }
  if ([...zonesOfGmo.values()].some(s => s.size > 1)) split++;
  if (teams.some(t => /\S {2,}\S/.test(String(t.gmo || '')))) spaced++;
  if (teams.some(t => isNobody(t.gmo) || isNobody(t.zone))) dashed++;
  if (teams.some(t => /[\u00A0\t\n\u2009\u3000]/.test(String(t.gmo || '') + String(t.zone || '')))) pasted++;
}
console.log(`${CASES} random Teams & Staff tables (${split} with a GMO over two zones, ${spaced} with a GMO's name typed with extra spaces, `
  + `${dashed} with a dash or N/A in a cell, ${pasted} with a no-break space, tab or line break): `
  + `${fromGmo} teams took their GMO's zone, ${bad} read differently`);
if ([split, spaced, dashed, pasted].some(n => n < CASES / 10)) { console.log('THE DRAW IS LOPSIDED: too few of the hard cases were drawn for this to mean anything'); process.exit(1); }
console.log(bad ? `\n${bad} DIFFERENT` : '\nTHE PORTAL AND THE SCRIPT READ EVERY TABLE ALIKE');
process.exit(bad ? 1 : 0);
