/* EXPECTED DEFAULTERS RECOVERY ON THE DASHBOARD -- one rule, written twice, checked against itself.

     "recovered amounts of full cant equal of owed expected defs" -- the owner, 15 Nov 2026

   The dashboard's "Expected Defaulters recovery" cards are read by a database function,
   expdf_cycle_recovery_totals (db/RUN-ME-057). Node cannot run SQL in `npm test`, so the tests
   read the same rule through a JavaScript mirror, EXPDF_RECOVERY_RPC in
   test/snapshot-totals-rpc.mjs. A mirror that drifts from the function makes every test of the
   card a test of something the live book does not do: #697's review found exactly that (a mock
   looser than the real function, hiding a fabricated figure). This is the check that can see
   it: it draws random weeks of defaulter decks, reads each one through the real function on a
   PostgreSQL and through the mirror, and fails on the first difference.

   What it draws on purpose, and refuses to pass without: customers who are in a day's file and
   are not that day's (the fault the first version of the card had); customers on the initial
   deck only, and on the current deck only; customers with no disbursement date (counted once,
   on the last day that carried them) and ones that gain a date during the week; a date carried
   by the current row alone; a day's deck uploaded twice (the later upload wins, the earlier is
   not read); a deck stamped with another weekday; a team-day with a file and nobody on cycle
   (zeros, not a missing row); the same customer under two teams; arrears left empty; a team
   filter.

   It needs a PostgreSQL it can reach with psql and NO defaulter_snapshots table in the
   database it is pointed at: it creates a small one, and everything it does is rolled back.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=parity_test \
         node tools/db-checks/expdf-cycle-recovery-parity.mjs        # CASES=300 by default

   NEVER point it at the live book: it has no reason to be there, and a chat has no way in.
   Exit code 0 = every week read alike.

   BREAK THE RULE AND SEE IT FAIL before trusting a change to either side. In the mirror: count
   a customer whatever their cycle day, count an undated customer on every day, take Day 2 as
   two days later, read a missing current row as "nothing recovered", or let the earlier upload
   of a day win. Each must come back DIFFERENT. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { EXPDF_RECOVERY_RPC } = await import(path.join(ROOT, 'test/snapshot-totals-rpc.mjs'));
const mirror = EXPDF_RECOVERY_RPC.expdf_cycle_recovery_totals;
const CASES = Number(process.env.CASES || 300);

const file = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-057-expdf-cycle-recovery-totals.sql'), 'utf8');
const from = file.indexOf('create or replace function public.expdf_cycle_recovery_totals');
const to = file.indexOf('$$;', from);
if (from < 0 || to < 0) throw new Error('db/RUN-ME-057 no longer has the function this check reads by name');
const FUNCTION = file.slice(from, to + 3);
const TABLE = 'create table public.defaulter_snapshots (ref text, team text, arrears numeric(14,2), disb_date date, '
  + 'snapshot_type text, weekday text, snapshot_date date, upload_batch uuid, created_at timestamptz);';
const SEP = '\x1f';
const psql = sql => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-c', sql], { encoding: 'utf8', maxBuffer: 1 << 26 });

// mulberry32: every draw uses all 32 bits (a plain `seed * 1103515245` loses its low bits in
// JavaScript's doubles, and a check whose random numbers are nearly always even never draws
// half of its cases).
let seed = Number(process.env.SEED || 20261115);
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;

const WD = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const WEEK = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
const addDays = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const isodow = key => { const d = new Date(Date.parse(key + 'T00:00:00Z')).getUTCDay(); return d === 0 ? 7 : d; };
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const lit = v => (v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");

const drawn = { cases: 0, notTheirDay: 0, initialOnly: 0, currentOnly: 0, undatedCounted: 0, undatedThenDated: 0,
  dateFromCurrent: 0, losingBatch: 0, wrongWeekday: 0, zeroDay: 0, twoTeams: 0, emptyArrears: 0, teamFilter: 0 };

function drawCase() {
  const teams = ['T1', 'T2', 'T3', 'T4'].slice(0, 2 + Math.floor(rnd() * 3));
  const days = WEEK.slice(0, 3 + Math.floor(rnd() * 5));
  const customers = [];
  for (let i = 0, n = 6 + Math.floor(rnd() * 9); i < n; i++) {
    customers.push({ ref: 'C' + i, team: pick(teams),
      disb: chance(0.22) ? null : addDays('2026-06-01', Math.floor(rnd() * 21)),   // three weeks: every weekday comes up
      gainsDateOn: chance(0.3) ? 1 + Math.floor(rnd() * days.length) : 99 });       // an undated one may gain a date mid-week
  }
  const rows = [];
  let batchNo = 0, stamp = 0;
  const batch = () => ({ id: uuid(++batchNo), at: '2026-07-01T00:' + String(Math.floor(++stamp / 60)).padStart(2, '0') + ':' + String(stamp % 60).padStart(2, '0') + 'Z' });
  days.forEach((date, di) => {
    const wd = WD[isodow(date) - 1];
    for (const type of ['initial', 'current']) {
      for (const team of teams) {
        if (chance(0.08)) continue;                                   // this team filed nothing of this type today
        const mine = customers.filter(c => c.team === team);
        const fill = (b, weekday, tag) => {
          for (const c of mine) {
            if (!chance(type === 'initial' ? 0.8 : 0.7)) continue;
            let disb = c.disb;
            if (c.disb == null && di >= c.gainsDateOn) disb = addDays('2026-06-01', (c.ref.length * 7 + Number(c.ref.slice(1)) * 3) % 21);
            if (disb != null && type === 'initial' && chance(0.12)) disb = null;      // the initial row lost the date: the current row may carry it
            rows.push({ ref: c.ref, team, arrears: chance(0.03) ? null : Math.floor(rnd() * 200) * 500, disb_date: disb,
              snapshot_type: type, weekday, snapshot_date: date, upload_batch: b.id, created_at: b.at, tag });
          }
        };
        if (chance(0.25)) { fill(batch(), wd, 'loser'); drawn.losingBatch++; }        // an earlier upload of the same deck: must not be read
        fill(batch(), wd, 'winner');
        if (chance(0.1)) { fill(batch(), pick(WD.filter(x => x !== wd)), 'wrongwd'); drawn.wrongWeekday++; }
      }
    }
    // The same customer under a second team on the same day (a transfer filed twice).
    if (chance(0.2) && teams.length > 1) {
      const c = pick(customers), other = pick(teams.filter(x => x !== c.team));
      const b = batch();
      rows.push({ ref: c.ref, team: other, arrears: Math.floor(rnd() * 200) * 500, disb_date: c.disb, snapshot_type: 'initial',
        weekday: wd, snapshot_date: date, upload_batch: b.id, created_at: b.at, tag: 'twoteams' });
      drawn.twoTeams++;
    }
  });
  const asked = chance(0.7) ? WEEK.slice() : WEEK.filter(() => chance(0.7));
  const p_teams = chance(0.5) ? null : teams.filter(() => chance(0.6));
  if (p_teams) drawn.teamFilter++;
  return { rows, p_dates: asked, p_weekdays: asked.map(d => WD[isodow(d) - 1]), p_teams };
}

function readSql({ rows, p_dates, p_weekdays, p_teams }) {
  const values = rows.map(r => '(' + [lit(r.ref), lit(r.team), r.arrears == null ? 'null' : r.arrears, lit(r.disb_date), lit(r.snapshot_type),
    lit(r.weekday), lit(r.snapshot_date), lit(r.upload_batch), lit(r.created_at)].join(',') + ')').join(',\n');
  const sql = 'begin;\n' + TABLE + '\n' + FUNCTION + '\n'
    + (rows.length ? 'insert into public.defaulter_snapshots values\n' + values + ';\n' : '')
    + 'select snapshot_date, team, initial, current, recovered, customers, undated from public.expdf_cycle_recovery_totals('
    + 'array[' + p_dates.map(lit).join(',') + ']::date[], array[' + p_weekdays.map(lit).join(',') + ']::text[], '
    + (p_teams ? 'array[' + p_teams.map(lit).join(',') + ']::text[]' : 'null') + ');\nrollback;';
  return psql(sql).trim().split('\n').filter(Boolean).map(l => { const f = l.split(SEP);
    return { snapshot_date: f[0], team: f[1], initial: Number(f[2]), current: Number(f[3]), recovered: Number(f[4]), customers: Number(f[5]), undated: Number(f[6]) }; });
}
const readMirror = ({ rows, p_dates, p_weekdays, p_teams }) => mirror({ defaulter_snapshots: { rows } }, { p_dates, p_weekdays, p_teams })
  .map(r => ({ snapshot_date: String(r.snapshot_date), team: String(r.team), initial: Number(r.initial), current: Number(r.current),
    recovered: Number(r.recovered), customers: Number(r.customers), undated: Number(r.undated) }));
const canon = list => list.slice().sort((a, b) => (a.snapshot_date + '|' + a.team).localeCompare(b.snapshot_date + '|' + b.team))
  .map(r => [r.snapshot_date, r.team, r.initial, r.current, r.recovered, r.customers, r.undated].join(' '));

// What a case exercised, read off the rows by the rule's own words (not off either reading).
function tally(c, answer) {
  const win = new Map();
  for (const r of c.rows) { if (r.tag === 'wrongwd') continue;
    const k = r.snapshot_type + '|' + r.snapshot_date + '|' + r.team, e = win.get(k);
    if (!e || r.created_at > e) win.set(k, r.created_at); }
  const live = c.rows.filter(r => r.tag !== 'wrongwd' && win.get(r.snapshot_type + '|' + r.snapshot_date + '|' + r.team) === r.created_at
    && c.p_dates.includes(r.snapshot_date) && (!c.p_teams || c.p_teams.includes(r.team)));
  const ini = live.filter(r => r.snapshot_type === 'initial'), cur = live.filter(r => r.snapshot_type === 'current');
  const curKey = new Map(cur.map(r => [r.snapshot_date + '|' + r.ref, r])), iniKey = new Set(ini.map(r => r.snapshot_date + '|' + r.ref));
  for (const r of ini) {
    const c2 = curKey.get(r.snapshot_date + '|' + r.ref);
    const disb = r.disb_date != null ? r.disb_date : (c2 ? c2.disb_date : null);
    if (!c2) drawn.initialOnly++;
    if (r.disb_date == null && c2 && c2.disb_date != null) drawn.dateFromCurrent++;
    if (r.arrears == null) drawn.emptyArrears++;
    if (disb != null) { const d1 = isodow(disb), dow = isodow(r.snapshot_date);
      if (!(d1 === dow || ((d1 - 1 + 3) % 7) + 1 === dow)) drawn.notTheirDay++; }
  }
  for (const r of cur) if (!iniKey.has(r.snapshot_date + '|' + r.ref)) drawn.currentOnly++;
  const undatedRefs = new Set(ini.filter(r => { const c2 = curKey.get(r.snapshot_date + '|' + r.ref); return r.disb_date == null && !(c2 && c2.disb_date != null); }).map(r => r.ref));
  for (const ref of undatedRefs) if (ini.some(r => r.ref === ref && r.disb_date != null)) drawn.undatedThenDated++;
  for (const a of answer) { if (a.undated > 0) drawn.undatedCounted++; if (a.customers === 0) drawn.zeroDay++; }
}

for (let n = 1; n <= CASES; n++) {
  const c = drawCase();
  const a = readSql(c), b = readMirror(c);
  const x = canon(a), y = canon(b);
  if (x.join('\n') !== y.join('\n')) {
    console.error('DIFFERENT on case ' + n + ' (SEED=' + (process.env.SEED || 20261115) + ')\n');
    console.error('asked: ' + c.p_dates.join(',') + ' teams ' + JSON.stringify(c.p_teams) + '\n');
    console.error('the function (db/RUN-ME-057):\n  ' + x.join('\n  ') + '\n\nthe mirror (test/snapshot-totals-rpc.mjs):\n  ' + y.join('\n  ') + '\n');
    console.error('rows:\n' + c.rows.map(r => '  ' + [r.snapshot_date, r.weekday, r.snapshot_type, r.team, r.ref, r.arrears, r.disb_date, r.upload_batch.slice(-4), r.created_at, r.tag].join(' ')).join('\n'));
    process.exit(1);
  }
  drawn.cases++; tally(c, a);
}
// Too few of the hard cases is a pass that proves nothing.
const need = { notTheirDay: CASES, initialOnly: CASES / 2, currentOnly: CASES / 2, undatedCounted: CASES / 4, undatedThenDated: CASES / 10,
  dateFromCurrent: CASES / 10, losingBatch: CASES / 2, wrongWeekday: CASES / 10, zeroDay: CASES / 10, twoTeams: CASES / 10, emptyArrears: CASES / 10, teamFilter: CASES / 4 };
const thin = Object.entries(need).filter(([k, v]) => drawn[k] < v);
console.log(JSON.stringify(drawn));
if (thin.length) { console.error('NOT ENOUGH of: ' + thin.map(([k, v]) => k + ' (' + drawn[k] + ' < ' + v + ')').join(', ') + ' -- a pass on these draws proves too little'); process.exit(2); }
console.log('every one of ' + drawn.cases + ' weeks read alike by db/RUN-ME-057 and its mirror');
