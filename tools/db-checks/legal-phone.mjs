/* LEGAL RECOVERY BY PHONE -- db/RUN-ME-089-legal-recovery-by-phone.sql, run for real on a PostgreSQL.

     "Legal officers should be added another card of legal recovery by phone" ... "stamp all recovery by phone, remember capturing phone
      calls is 2 weeks temporary" ... "having that number called and recorded in legal officer phone at minimum duration of 5 seconds, if
      such defaulter has recovered amount after current arrea, then adds-up to recovery by phone of legal" -- the owner, 23 Nov 2026

   The book is the real one (the whole of db/schema.sql in a scratch database); the people are made up. It passes only when:
     1. THE FILE runs whole as one text, twice, and answers its four lines.
     2. A STAMP of a day equals a model written again in JavaScript, in every column: only phones whose role reads legal (the access
        code of that name when exactly one carries it, else the role the phone registered with; the word LEGAL, or the LEGAL_ROLE
        setting's own name); only a call longer than the minimum seconds that was not missed, rejected or blocked; only a customer on
        that day's INITIAL file; the upload that counts for each team (the newest row's); the day's recovery (initial less current;
        off the current file = all of it; no current file = nothing, and it says so); ONE ROW FOR EACH OFFICER who spoke to the
        customer (the portal names the one who spoke longest, after it has decided who is a lawyer: a phone that only looks legal can
        never hide a real one), with that officer's own calls, seconds and longest call's number; a day stamped again is the same rows.
     3. THE CLOCK: today again after the age it is given, the three days before it after eight hours and no more than it is allowed,
        one older day a tick while it was never stamped and the call logs still hold it, AND A DAY OLDER THAN THREE DAYS THAT WAS
        STAMPED IS NEVER STAMPED AGAIN, so its rows outlive the call logs. Two ticks at once: one of them stands back.
     4. THE READ answers one value (no row cap), the rows of the range and of the teams asked for, and still answers when a stamp fails.
     5. PRIVACY: the API's roles can neither read the two tables nor call the three functions; the service role can.
     6. THE COST on two million deck rows laid in the worst order: a day with no legal call reads no deck; a day with calls reads that
        day's two files and no more.
     7. pg_cron, where this server has it: the job is there once, with its schedule, after one run and after two.
     8. EVERY ONE of a list of deliberate breaks of the file makes a check fail.

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/legal-phone.mjs       (NOBIG=1 skips the two million rows, NOBREAKS=1)

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = it did what it says, and failed when broken. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(ROOT + '/db/RUN-ME-089-legal-recovery-by-phone.sql', 'utf8');
const DB = 'hope_legal_phone';
const admin = process.env.PGDATABASE || 'postgres';
const psqlTo = (sql, db = DB) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env: process.env, encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['pipe', 'pipe', 'pipe'] });
const errLine = e => String(e.stderr || e.message).split('\n').find(l => /ERROR/.test(l)) || String(e.stderr || e.message).split('\n')[0];
const q = s => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");
const json = sql => JSON.parse('[' + psqlTo(`select coalesce(string_agg(row_to_json(t)::text, ','), '') from (${sql}) t`) + ']');
const one = (sql, db = DB) => psqlTo(sql, db).trim();
const TODAY = one("select (now() at time zone 'Africa/Dar_es_Salaam')::date", admin);
const day = n => one(`select (date '${TODAY}' - ${n})::date`, admin);
const D = [0, 1, 2, 3, 4, 5, 6].map(day);                       // D[0] today ... D[6] six days ago
const wd = d => one(`select upper(to_char(date '${d}', 'DY'))`, admin);

/* ---- the made-up book ------------------------------------------------------------------------------------------------------- */
const CODES = [   // name, role
  ['WAKILI ONE', 'LEGAL'], ['WAKILI TWO', 'Legal Officer'], ['RECO ONE', 'PMO RECOVERY'], ['EX WAKILI', 'MANAGER'],
  ['TWIN NAME', 'LEGAL'], ['TWIN NAME', 'MANAGER'], ['ADV ONE', 'Advocate - HQ'], ['PARALEGALS', 'PARALEGAL'],
];
const USERS = [   // user_id, name, role the phone registered with
  ['U1', 'WAKILI ONE', 'LEGAL'],            // its code says LEGAL
  ['U2', ' wakili two ', 'OFFICER'],        // registered before the code was made legal: THE CODE DECIDES (the name any case, blanks at its ends)
  ['U3', 'RECO ONE', 'PMO RECOVERY'],       // holds the Legal tab, is not a lawyer
  ['U4', 'EX WAKILI', 'LEGAL'],             // registered as legal, the code is a manager's now: THE CODE DECIDES
  ['U5', 'TWIN NAME', 'LEGAL'],             // two codes of one name: nobody can say which, so the registered role stands
  ['U6', 'ADV ONE', 'OFFICER'],             // legal only when the LEGAL_ROLE setting names its role
  ['U7', 'NO CODE', 'Legal'],               // no code of that name: the registered role stands
  ['U8', 'PARALEGALS', 'PARALEGAL'],        // the letters LEGAL inside another word: the database keeps it (a superset), the portal decides
  ['U9', 'FIELD GUY', 'OFFICER'],
];
// One customer: ref, team, dc, ds, initial arrears by day (null = not on that day's initial file), current arrears by day ('gone' = off the file)
const CUST = [
  { ref: '9000000001', team: 'TEAM ONE', dc: 3, ds: '5-12', ini: 100000, cur: 60000 },          // paid 40,000
  { ref: '9000000002', team: 'TEAM ONE', dc: 2, ds: '6-12', ini: 80000, cur: 'gone' },          // off the current file: all of it
  { ref: '9000000003', team: 'TEAM TWO', dc: 2, ds: '7-12', ini: 50000, cur: 70000 },           // owes more now: nothing recovered
  { ref: '9000000004', team: 'TEAM TWO', dc: 1, ds: '11-12', ini: 30000, cur: 10000 },          // DC 1: stamped (the portal decides), with its D.C
  { ref: '9000000005', team: '', dc: 4, ds: '2-12', ini: 90000, cur: 90000 },                   // a row that names no team
  { ref: '9000000006', team: 'TEAM ONE', dc: 5, ds: '1-12', ini: 20000, cur: 5000 },            // spoken to by a phone that is not legal
  { ref: '9000000007', team: 'TEAM TWO', dc: 2, ds: '3-12', ini: null, cur: 15000 },            // on the current file only: not on the day's list
  { ref: '9000000008', team: 'TEAM ONE', dc: 2, ds: '4-12', ini: 60000, cur: 20000 },           // rung, never spoken to
  { ref: '9000000009', team: 'TEAM TWO', dc: 6, ds: '0-12', ini: 45000, cur: 0 },               // two officers
  { ref: '9000000010', team: 'TEAM ONE', dc: 2, ds: '9-12', ini: 70000, cur: 30000 },           // the losing upload says otherwise
  { ref: '9000000011', team: 'TEAM TWO', dc: 3, ds: '8-12', ini: 0, cur: 0 },                   // owed nothing in the morning
];
// A call: user, ref, phone, match, seconds, outcome, [day index]
const CALLS = [
  ['U1', '9000000001', '712000001', 'CUSTOMER', 40, 'CONNECTED'], ['U1', '9000000001', '755000001', 'GUARANTOR', 90, 'CONNECTED'], ['U1', '9000000001', '712000001', 'CUSTOMER', 3, 'CONNECTED'],
  ['U2', '9000000002', '712000002', 'CUSTOMER', 6, 'CONNECTED'],
  ['U1', '9000000003', '712000003', 'CUSTOMER', 25, null],
  ['U7', '9000000004', '712000004', 'CUSTOMER', 60, 'CONNECTED'],
  ['U5', '9000000005', '712000005', 'CUSTOMER', 15, 'CONNECTED'],
  ['U3', '9000000006', '712000006', 'CUSTOMER', 300, 'CONNECTED'], ['U4', '9000000006', '712000006', 'CUSTOMER', 300, 'CONNECTED'], ['U9', '9000000006', '712000006', 'CUSTOMER', 300, 'CONNECTED'],
  ['U1', '9000000007', '712000007', 'CUSTOMER', 50, 'CONNECTED'],
  ['U1', '9000000008', '712000008', 'CUSTOMER', 5, 'CONNECTED'], ['U1', '9000000008', '712000008', 'CUSTOMER', 200, 'MISSED'], ['U2', '9000000008', '712000008', 'CUSTOMER', 200, ' rejected '], ['U2', '9000000008', '712000008', 'CUSTOMER', 200, 'BLOCKED'],
  ['U1', '9000000009', '712000009', 'CUSTOMER', 30, 'CONNECTED'], ['U2', '9000000009', '755000009', 'GUARANTOR', 20, 'CONNECTED'], ['U2', '9000000009', '755000009', 'GUARANTOR', 25, 'CONNECTED'],
  ['U1', '9000000010', '712000010', 'CUSTOMER', 12, 'CONNECTED'],
  ['U2', '9000000011', '712000011', 'CUSTOMER', 12, 'CONNECTED'],
  ['U1', null, '799999999', null, 500, 'CONNECTED'], ['U1', '', '799999998', null, 500, 'CONNECTED'],          // a number the call app tied to nobody
  ['U1', '9999999999', '799999997', 'CUSTOMER', 500, 'CONNECTED'],                                              // a customer on no file of the day
  ['U6', '9000000010', '712000010', 'CUSTOMER', 400, 'CONNECTED'], ['U8', '9000000011', '712000011', 'CUSTOMER', 400, 'CONNECTED'],
];
const MIN = 5;
function seed({ legalRole = null, days = [0, 1, 2, 3, 5], noCurrent = [], extra = '' } = {}) {
  const rows = [];
  let id = 0;
  for (const di of days) {
    const d = D[di], w = wd(d);
    for (const c of CUST) {
      // TEAM ONE's initial file was uploaded twice: the first upload (batch A, older) says other figures and must lose
      if (c.ini !== null) {
        if (c.team === 'TEAM ONE') rows.push(`(${q(c.ref)}, ${q(c.team)}, 'OLD ' || ${q(c.ref)}, '0700000000', '0700000001', 9, '0-0', ${c.ini + 7777}, 'initial', ${q(w)}, ${q(d)}, 'aaaaaaaa-0000-0000-0000-00000000000${di}', ${q(d + 'T03:00:00Z')})`);
        rows.push(`(${q(c.ref)}, ${c.team ? q(c.team) : 'null'}, 'CUSTOMER ' || ${q(c.ref.slice(-2))}, ${q('0' + (712000000 + Number(c.ref.slice(-2))))}, ${q('0' + (755000000 + Number(c.ref.slice(-2))))}, ${c.dc}, ${q(c.ds)}, ${c.ini}, 'initial', ${q(w)}, ${q(d)}, 'bbbbbbbb-0000-0000-0000-00000000000${di}', ${q(d + 'T05:00:00Z')})`);
      }
      if (!noCurrent.includes(di) && c.cur !== 'gone') {
        // the current file twice as well, for every team: the first one must lose (it says everybody still owes everything)
        rows.push(`(${q(c.ref)}, ${c.team ? q(c.team) : 'null'}, 'X', null, null, ${c.dc}, ${q(c.ds)}, ${(c.ini || 0) + 1}, 'current', ${q(w)}, ${q(d)}, 'cccccccc-0000-0000-0000-00000000000${di}', ${q(d + 'T09:00:00Z')})`);
        rows.push(`(${q(c.ref)}, ${c.team ? q(c.team) : 'null'}, 'X', null, null, ${c.dc}, ${q(c.ds)}, ${c.cur}, 'current', ${q(w)}, ${q(d)}, 'dddddddd-0000-0000-0000-00000000000${di}', ${q(d + 'T13:00:00Z')})`);
      }
      // the customer who is gone from the winning current file WAS on the losing one
      if (!noCurrent.includes(di) && c.cur === 'gone') rows.push(`(${q(c.ref)}, ${q(c.team)}, 'X', null, null, ${c.dc}, ${q(c.ds)}, ${c.ini}, 'current', ${q(w)}, ${q(d)}, 'cccccccc-0000-0000-0000-00000000000${di}', ${q(d + 'T09:00:00Z')})`);
    }
  }
  const calls = [];
  for (const di of days) for (const [u, ref, phone, mt, secs, out] of CALLS) calls.push(`(${q('C' + (++id))}, ${q(u)}, 'AS LOGGED', 'TEAM ONE', ${q(phone)}, 'OUT', ${q(D[di])}, '10:00', ${secs}, true, ${q(mt)}, ${q(ref)}, 'X', ${out === null ? 'null' : q(out.trim().toUpperCase() === 'REJECTED' ? 'REJECTED' : out)}, null)`);
  psqlTo(`truncate call_logs, call_users, access_codes, defaulter_snapshots, settings, teams cascade;
truncate legal_phone_recovery, legal_phone_days;
insert into teams (team) values ('TEAM ONE'), ('TEAM TWO');
insert into access_codes (code, name, role) values ${CODES.map(([n, r], i) => `(${q('K' + i)}, ${q(n)}, ${q(r)})`).join(', ')};
insert into call_users (user_id, name, role, is_leader, phone) values ${USERS.map(([u, n, r], i) => `(${q(u)}, ${q(n)}, ${q(r)}, true, ${q('07' + i)})`).join(', ')};
${legalRole === null ? '' : `insert into settings (key, value) values ('LEGAL_ROLE', ${q(legalRole)});`}
insert into defaulter_snapshots (ref, team, full_name, contact, guarantor_contact, dc, ds, arrears, snapshot_type, weekday, snapshot_date, upload_batch, created_at) values
${rows.join(',\n')};
insert into call_logs (id, user_id, officer, team, phone, direction, call_date, call_time, duration, portfolio, match_type, ref, customer, outcome, category) values
${calls.join(',\n')};
${extra}`);
}
/* ---- the model, written again: what a stamp of one day must hold ---------------------------------------------------------------- */
const normRole = v => String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
function model(di, { legalRole = null, noCurrent = [], min = MIN } = {}) {
  const K = s => String(s == null ? '' : s).trim().toUpperCase();
  const roleOf = (name, reg) => { const mine = CODES.filter(c => K(c[0]) === K(name)); return mine.length === 1 ? mine[0][1] : (reg || ''); };
  const looks = role => role.toUpperCase().includes('LEGAL') || (normRole(legalRole) !== '' && normRole(role) === normRole(legalRole));
  const phones = new Map(USERS.map(([u, n, r]) => [u, { name: n, role: roleOf(n, r) }]).filter(([, p]) => looks(p.role)));
  const talk = CALLS.map((c, i) => ({ u: c[0], ref: c[1], phone: c[2], mt: c[3], secs: c[4], out: c[5] == null ? '' : c[5].trim().toUpperCase(), i }))
    .filter(c => phones.has(c.u) && c.ref && !['MISSED', 'REJECTED', 'BLOCKED'].includes(c.out) && c.secs > min);
  const out = [];
  for (const ref of [...new Set(talk.map(c => c.ref))].sort()) {
    const cust = CUST.find(c => c.ref === ref);
    if (!cust || cust.ini === null) continue;
    for (const u of [...new Set(talk.filter(c => c.ref === ref).map(c => c.u))].sort()) {
      const mine = talk.filter(c => c.ref === ref && c.u === u);
      const best = mine.slice().sort((a, b) => b.secs - a.secs || a.i - b.i)[0];
      const paired = !noCurrent.includes(di);
      const cur = !paired || cust.cur === 'gone' ? null : cust.cur;
      const n = Number(ref.slice(-2));
      out.push({ day: D[di], ref, team: cust.team, full_name: 'CUSTOMER ' + ref.slice(-2), contact: '0' + (712000000 + n), guarantor_contact: '0' + (755000000 + n), dc: cust.dc, ds: cust.ds,
        user_id: u, officer: phones.get(u).name, role: phones.get(u).role, phone: best.phone, match_type: best.mt,
        calls: mine.length, secs: mine.reduce((s, c) => s + c.secs, 0), initial_arrears: cust.ini, current_arrears: cur,
        recovered: !paired ? 0 : cur === null ? Math.max(cust.ini, 0) : Math.max(cust.ini - cur, 0), paired });
    }
  }
  return out;
}
const COLS = 'day, ref, team, full_name, contact, guarantor_contact, dc, ds, user_id, officer, role, phone, match_type, calls, secs, initial_arrears::float8 as initial_arrears, current_arrears::float8 as current_arrears, recovered::float8 as recovered, paired';
const stamped = d => json(`select ${COLS} from legal_phone_recovery where day = '${d}' order by ref, user_id`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b.map(r => Object.fromEntries(Object.keys(a[0] || r).map(k => [k, r[k]]))));
const firstDiff = (a, b) => { const i = a.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(b[j] && Object.fromEntries(Object.keys(x).map(k => [k, b[j][k]])))); return i < 0 ? `${a.length} rows against ${b.length}` : JSON.stringify(a[i]) + ' against ' + JSON.stringify(b[i]); };
const daysNow = () => Object.fromEntries(psqlTo('select day, n from legal_phone_days order by day').trim().split('\n').filter(Boolean).map(l => l.split('\t')));
const tick = (age, extra) => JSON.parse(one(`select public.legal_phone_tick(interval '${age}', ${extra})`));
const sumOf = d => one(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from (select ${COLS} from legal_phone_recovery where day = '${d}') t`);

function run(fails, { text = FILE, label = '' } = {}) {
  const note = m => { if (fails.length < 25) fails.push(label + m); };
  psqlTo('drop function if exists public.legal_phone_week(date, date, text[]), public.legal_phone_tick(interval, integer), public.legal_phone_stamp(date), public.call_min_secs() cascade; drop table if exists public.legal_phone_recovery, public.legal_phone_days cascade;');
  // 1. the file, as one text, twice
  let ans;
  try { psqlTo(text); ans = psqlTo(text).trim().split('\n').map(l => l.split('\t')); } catch (e) { note('the file does not run: ' + errLine(e)); return; }
  seed();
  if (ans.length !== 4 || ans[0][1] !== 'legal_phone_recovery' || ans[1][1] !== String(MIN) || !/^NO pg_cron: /.test(ans[3][1])) note('the file does not answer its four lines: ' + JSON.stringify(ans));
  // (the count of phones is asked on the seeded book, by the file's own line)
  const phonesLine = text.split('\n').find(l => l.startsWith("union all select 3, 'phones whose role reads legal'"));
  if (!phonesLine) note('the line that counts the legal phones is gone');
  else { const n = one('select answer from (select 3 as k, null::text as what, null::text as answer ' + phonesLine + ') x where k = 3 and answer is not null'); if (n !== '5') note('the file counts ' + n + ' phones whose role reads legal; the book has 5 (U1, U2, U5, U7, and PARALEGAL U8)'); }
  // 2. a stamp of a day, against the model: today, with both files
  for (const [di, opt, what] of [[0, {}, 'today'], [2, {}, 'two days ago']]) {
    try { psqlTo(`select public.legal_phone_stamp('${D[di]}')`); } catch (e) { note('the stamp of ' + what + ' failed: ' + errLine(e)); return; }
    const got = stamped(D[di]), want = model(di, opt);
    if (!same(got, want)) note('the stamp of ' + what + ' is not the model: ' + firstDiff(got, want));
    if (daysNow()[D[di]] !== String(want.length)) note('the day\'s line does not say ' + want.length + ' rows: ' + daysNow()[D[di]]);
    const before = sumOf(D[di]); psqlTo(`select public.legal_phone_stamp('${D[di]}')`); if (sumOf(D[di]) !== before) note('a second stamp of ' + what + ' changed its rows');
  }
  // the LEGAL_ROLE setting names another word: that role is legal too (and the word LEGAL still is)
  seed({ legalRole: ' advocate - hq ' });
  psqlTo(`select public.legal_phone_stamp('${D[0]}')`);
  { const got = stamped(D[0]), want = model(0, { legalRole: ' advocate - hq ' }); if (!same(got, want)) note('with LEGAL_ROLE set to another name the stamp is not the model: ' + firstDiff(got, want));
    if (!got.some(r => r.user_id === 'U6')) note('the phone whose role is the LEGAL_ROLE setting\'s name is not counted'); }
  // a day with no current file: stamped, nothing recovered, and it says it is not a pair; then the file arrives
  seed({ noCurrent: [1] });
  psqlTo(`select public.legal_phone_stamp('${D[1]}')`);
  { const got = stamped(D[1]), want = model(1, { noCurrent: [1] }); if (!same(got, want)) note('a day with no current file is not the model: ' + firstDiff(got, want));
    if (got.some(r => r.paired || r.recovered !== 0)) note('a day with no current file shows a recovery'); }
  // the minimum is the setting: 12 seconds makes shorter talks no talk at all; a customer no longer spoken to leaves the day
  seed({ extra: "insert into settings (key, value) values ('CALL_MIN_SECS', '12');" });
  psqlTo(`select public.legal_phone_stamp('${D[0]}')`);
  psqlTo("update settings set value = '5' where key = 'CALL_MIN_SECS'"); psqlTo(`select public.legal_phone_stamp('${D[0]}')`);
  psqlTo("update settings set value = '12' where key = 'CALL_MIN_SECS'"); psqlTo(`select public.legal_phone_stamp('${D[0]}')`);
  { const got = stamped(D[0]), want = model(0, { min: 12 }); if (!same(got, want)) note('with the minimum at 12 seconds the stamp is not the model (a row that no longer counts must leave): ' + firstDiff(got, want)); }

  // 3. the clock
  seed();
  psqlTo('truncate legal_phone_recovery, legal_phone_days');
  const monLast = one(`select (date_trunc('week', date '${TODAY}')::date - 7)::date`);
  const older = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(day).filter(d => d >= monLast);   // what the call logs still hold, older than three days
  try {
    let t = tick('10 minutes', 4);
    const want1 = [D[0], D[1], D[2], D[3]].concat(older.length ? [older[0]] : []);
    if (JSON.stringify(t.stamped) !== JSON.stringify(want1)) note('the first tick stamped ' + JSON.stringify(t.stamped) + ', not ' + JSON.stringify(want1));
    for (let i = 1; i < older.length; i++) { t = tick('10 minutes', 4); if (JSON.stringify(t.stamped) !== JSON.stringify([older[i]])) note('a later tick did not stamp the next older day alone: ' + JSON.stringify(t.stamped) + ' for ' + older[i]); }
    t = tick('10 minutes', 4); if (t.stamped.length) note('with everything stamped a tick stamped again: ' + JSON.stringify(t.stamped));
    psqlTo(`update legal_phone_days set stamped_at = now() - interval '11 minutes' where day = '${D[0]}'`);
    t = tick('10 minutes', 4); if (JSON.stringify(t.stamped) !== JSON.stringify([D[0]])) note('today, eleven minutes old, was not stamped alone: ' + JSON.stringify(t.stamped));
    psqlTo(`update legal_phone_days set stamped_at = now() - interval '11 minutes' where day = '${D[0]}'`);
    t = tick('25 minutes', 1); if (t.stamped.length) note('the reader\'s tick (25 minutes) stamped a today that is eleven minutes old');
    psqlTo(`update legal_phone_days set stamped_at = now() - interval '9 hours' where day in ('${D[1]}', '${D[2]}', '${D[3]}')`);
    t = tick('25 minutes', 1); if (JSON.stringify(t.stamped) !== JSON.stringify([D[1]])) note('allowed one more day, the tick stamped ' + JSON.stringify(t.stamped) + ', not yesterday alone');
    t = tick('25 minutes', 0); if (t.stamped.length) note('allowed no more day, the tick stamped ' + JSON.stringify(t.stamped));
    t = tick('25 minutes', 4); if (JSON.stringify(t.stamped) !== JSON.stringify([D[2], D[3]])) note('the two days still eight hours old were not stamped: ' + JSON.stringify(t.stamped));
    psqlTo(`update legal_phone_days set stamped_at = now() - interval '7 hours' where day = '${D[1]}'`);
    t = tick('25 minutes', 4); if (t.stamped.length) note('a day seven hours old was stamped again: ' + JSON.stringify(t.stamped));
    // THE POINT OF THE TABLE: a day older than three days, once stamped, is never touched again, whatever happens to the call logs
    const old = D[5], keep = sumOf(old);
    if (!stamped(old).length) note('the day five days ago was never stamped (the fixture has calls on it)');
    psqlTo(`delete from call_logs where call_date = '${old}'; update legal_phone_days set stamped_at = now() - interval '30 days' where day = '${old}';`);
    for (let i = 0; i < 3; i++) tick('0 minutes', 4);
    if (sumOf(old) !== keep) note('a day older than three days was stamped again after its call logs were cleared: its rows are lost');
    // two ticks at once: one stands back
    const busy = psqlTo(`begin; select pg_advisory_xact_lock(7302611); \\! PGDATABASE=${DB} psql -X -q -At -c "select public.legal_phone_tick(interval '0 minutes', 4)"\ncommit;`).trim().split('\n').pop();
    if (busy !== '{"busy": true}') note('a tick did not stand back while another held the lock: ' + busy);
  } catch (e) { note('the clock failed: ' + errLine(e)); return; }

  // 4. the read: one value, the range, the teams; and it answers when the stamp fails
  try {
    seed(); psqlTo('truncate legal_phone_recovery, legal_phone_days'); tick('0 minutes', 4);
    const w = JSON.parse(one(`select public.legal_phone_week('${D[3]}', '${D[0]}', null)`));
    const want = [3, 2, 1, 0].flatMap(di => model(di));
    if (w.v !== 1 || !Array.isArray(w.rows) || w.rows.length !== want.length) note('the read does not hold the range\'s rows: ' + (w.rows || []).length + ' against ' + want.length);
    if (w.first !== D[5] && w.first !== D[3] && !(w.first <= D[3])) note('the read does not say the first day stamped: ' + w.first);
    if (!Array.isArray(w.days) || w.days.length !== 4 || !w.days.every(x => x.day && x.at)) note('the read does not say when each day was stamped: ' + JSON.stringify(w.days));
    const w1 = JSON.parse(one(`select public.legal_phone_week('${D[0]}', '${D[0]}', array['TEAM TWO'])`));
    if (JSON.stringify(w1.rows.map(r => r.ref + r.user_id)) !== JSON.stringify(model(0).filter(r => r.team === 'TEAM TWO').map(r => r.ref + r.user_id))) note('the read for one team holds ' + JSON.stringify(w1.rows.map(r => r.ref + r.user_id)));
    if (one(`select jsonb_typeof(public.legal_phone_week('${D[0]}', '${D[0]}', array[]::text[]) -> 'rows') || ' ' || jsonb_array_length(public.legal_phone_week('${D[0]}', '${D[0]}', array[]::text[]) -> 'rows')`) !== 'array 0') note('the read for no team at all is not an empty list');
    // a stamp that fails must not fail the read: the rows already stamped still come, and the answer says the tick failed
    psqlTo(`update legal_phone_days set stamped_at = now() - interval '2 hours' where day = '${D[0]}'; alter function public.call_min_secs() rename to call_min_secs_gone;`);
    let w2; try { w2 = JSON.parse(one(`select public.legal_phone_week('${D[0]}', '${D[0]}', null)`)); } catch (e) { note('the read failed because the stamp failed: ' + errLine(e)); }
    if (w2 && (!w2.tick || !w2.tick.error || w2.rows.length !== model(0).length)) note('with a failing stamp the read does not say so, or lost its rows: ' + JSON.stringify(w2.tick) + ' ' + w2.rows.length);
    psqlTo('alter function public.call_min_secs_gone() rename to call_min_secs;');
  } catch (e) { note('the read failed: ' + errLine(e)); return; }

  // 5. privacy
  try {
    const p = one(`select has_table_privilege('anon', 'public.legal_phone_recovery', 'select')::int + has_table_privilege('authenticated', 'public.legal_phone_recovery', 'select')::int
      + has_table_privilege('anon', 'public.legal_phone_days', 'select')::int + has_table_privilege('authenticated', 'public.legal_phone_days', 'select')::int,
      (select count(*) from pg_class where oid in ('public.legal_phone_recovery'::regclass, 'public.legal_phone_days'::regclass) and relrowsecurity),
      (select count(*) from (values ('public.legal_phone_stamp(date)'), ('public.legal_phone_tick(interval, integer)'), ('public.legal_phone_week(date, date, text[])')) f(n), (values ('anon'), ('authenticated'), ('public')) r(n) where has_function_privilege(r.n, f.n, 'execute')),
      (select count(*) from (values ('public.legal_phone_stamp(date)'), ('public.legal_phone_tick(interval, integer)'), ('public.legal_phone_week(date, date, text[])')) f(n) where has_function_privilege('service_role', f.n, 'execute'))`);
    if (p !== '0\t2\t0\t3') note('privacy (API roles that read the tables, tables with row-level security, API roles that may call a function, functions the service role may call): ' + p);
    const asService = one(`set role service_role; select jsonb_array_length(public.legal_phone_week('${D[0]}', '${D[0]}', null) -> 'rows');`);
    if (asService !== String(model(0).length)) note('the service role does not get the rows: ' + asService);
  } catch (e) { note('the privacy check failed: ' + errLine(e)); }
}

/* ---- 6. the cost, on two million deck rows in the worst order ------------------------------------------------------------------- */
function big(fails, report) {
  const note = m => { if (fails.length < 25) fails.push(m); };
  seed({ days: [0, 1] });
  psqlTo(`insert into teams (team) select 'TEAM ' || i from generate_series(0, 83) i on conflict do nothing;
create table deck_fill as select (5000000000 + (i % 10400))::text as ref, 'TEAM ' || (i % 84) as team, 'C ' || i as full_name, (i % 7) as dc, 1000 + i % 500 as arrears,
  case when (i / 10400) % 2 = 0 then 'initial' else 'current' end as snapshot_type, (date '${TODAY}' - ((i / 20800)::int))::date as snapshot_date, 'ffffffff-0000-0000-0000-000000000000'::uuid as upload_batch
  from generate_series(0, 1999999) i;
insert into defaulter_snapshots (ref, team, full_name, dc, arrears, snapshot_type, weekday, snapshot_date, upload_batch)
  select ref, team, full_name, dc, arrears, snapshot_type, upper(to_char(snapshot_date, 'DY')), snapshot_date, upload_batch from deck_fill order by md5(ref || snapshot_type || snapshot_date::text);
drop table deck_fill;
insert into call_logs (id, user_id, officer, team, phone, direction, call_date, call_time, duration, portfolio, match_type, ref, customer, outcome)
  select 'B' || i, 'U' || (1 + i % 2), 'X', 'TEAM ONE', (700000000 + i)::text, 'OUT', date '${TODAY}', '11:00', 30 + i % 50, true, 'CUSTOMER', (5000000000 + (i * 17) % 10400)::text, 'X', 'CONNECTED' from generate_series(1, 600) i;
insert into call_logs (id, user_id, officer, team, phone, direction, call_date, call_time, duration, portfolio, match_type, ref, customer, outcome)
  select 'N' || i, 'U9', 'X', 'TEAM ONE', (600000000 + i)::text, 'OUT', (date '${TODAY}' - (i % 12))::date, '11:00', 30 + i % 50, true, 'CUSTOMER', (5000000000 + (i * 13) % 10400)::text, 'X', 'CONNECTED' from generate_series(1, 400000) i;
vacuum analyze defaulter_snapshots; vacuum analyze call_logs;`);
  const pages = +one("select pg_relation_size('defaulter_snapshots') / 8192");
  const measure = d => { const t0 = Date.now();
    const out = psqlTo(`begin; select public.legal_phone_stamp('${d}'); select 'HEAP', pg_stat_get_xact_blocks_fetched('public.defaulter_snapshots'::regclass); select 'N', count(*) from legal_phone_recovery where day = '${d}'; commit;`).split('\n');
    return { secs: (Date.now() - t0) / 1000, heap: +out.find(l => l.startsWith('HEAP')).split('\t')[1], n: +out.find(l => l.startsWith('N')).split('\t')[1] }; };
  const dayRows = +one(`select count(*) from defaulter_snapshots where snapshot_date = '${TODAY}'`);
  const withCalls = measure(TODAY), noCalls = measure(day(30));
  report.push(`two million deck rows in a random order (${pages} pages), ${dayRows} rows on the day, 600 legal conversations: the stamp took ${withCalls.secs.toFixed(1)} s, asked for ${withCalls.heap} pages of the deck table and kept ${withCalls.n} rows; a day with no legal call asked for ${noCalls.heap} pages`);
  if (!(withCalls.n > 300)) note('the big book\'s stamp kept ' + withCalls.n + ' rows: the fixture is not what it says');
  if (!(withCalls.heap <= dayRows * 1.2 + 200)) note('the stamp asked for ' + withCalls.heap + ' pages of the deck table for a day of ' + dayRows + ' rows: it reads more than the day');
  if (!(noCalls.heap < 50)) note('a day with no legal call asked for ' + noCalls.heap + ' pages of the deck table');
  if (!(withCalls.secs < 20)) note('the stamp took ' + withCalls.secs.toFixed(1) + ' s on the big book');
}

/* ---- 7. pg_cron, where this server has it ------------------------------------------------------------------------------------------ */
function cron(fails, report, text = FILE) {
  const note = m => { if (fails.length < 25) fails.push(m); };
  let cdb; try { cdb = one("select current_setting('cron.database_name', true)", admin); } catch { cdb = ''; }
  if (!cdb || one(`select count(*) from pg_database where datname = ${q(cdb)}`, admin) !== '1') { report.push('this server has no pg_cron database: the job itself was not tried (the file answers "NO pg_cron" here, which is checked)'); return; }
  const a = text.indexOf('do $$'), b = text.indexOf('end $$;', a);
  if (a < 0 || b < 0) { note('the block that schedules the job is gone'); return; }
  const block = text.slice(a, b + 7);
  try {
    psqlTo('create extension if not exists pg_cron;', cdb);
    psqlTo(block, cdb); psqlTo(block, cdb);
    const jobs = psqlTo("select schedule, command from cron.job where jobname = 'legal-phone-tick'", cdb).trim().split('\n').filter(Boolean);
    if (jobs.length !== 1 || jobs[0] !== "*/10 * * * *\tset statement_timeout = '20s'; select public.legal_phone_tick(interval '9 minutes', 4);") note('after two runs the job is not there once with its schedule and its command: ' + JSON.stringify(jobs));
    report.push('pg_cron (database ' + cdb + '): the job is there once after two runs');
  } catch (e) { note('scheduling failed on a server that has pg_cron: ' + errLine(e)); }
  finally { try { psqlTo("select cron.unschedule(jobid) from cron.job where jobname = 'legal-phone-tick'", cdb); } catch {} }
}

const once = (text, from, to) => { const n = text.split(from).length - 1; if (n !== 1) return null; return text.replace(from, () => to); };
const BREAKS = [
  ['a call of exactly the minimum counts', 'and coalesce(c.duration, 0) > m.min', 'and coalesce(c.duration, 0) >= m.min'],
  ['the minimum is five whatever the setting says', 'and coalesce(c.duration, 0) > m.min', 'and coalesce(c.duration, 0) > 5'],
  ['a missed, rejected or blocked call counts', "and upper(btrim(coalesce(c.outcome, ''))) not in ('MISSED', 'REJECTED', 'BLOCKED') ", ''],
  ['a call tied to no customer counts', "where coalesce(c.ref, '') <> '' and ", 'where '],
  ['every phone is a legal phone', "where upper(r.role) like '%LEGAL%' or (m.want <> ''", "where true or (m.want <> ''"],
  ['the role the phone registered with decides, not its code', "select coalesce((select min(c.role) from public.access_codes c where upper(btrim(c.name)) = upper(btrim(u.name)) having count(*) = 1), u.role, '') as role) r\ncross join m", "select coalesce(u.role, '') as role) r\ncross join m"],
  ['a name two codes carry takes one of their roles', 'upper(btrim(c.name)) = upper(btrim(u.name)) having count(*) = 1), u.role, \'\') as role) r\ncross join m', 'upper(btrim(c.name)) = upper(btrim(u.name))), u.role, \'\') as role) r\ncross join m'],
  ['the code is found only when the names are typed alike', "where upper(btrim(c.name)) = upper(btrim(u.name)) having count(*) = 1), u.role, '') as role) r\ncross join m", "where c.name = u.name having count(*) = 1), u.role, '') as role) r\ncross join m"],
  ['the LEGAL_ROLE setting is not read', "or (m.want <> '' and btrim(regexp_replace(upper(r.role), '[^A-Z0-9]+', ' ', 'g')) = m.want)", ''],
  ['the calls of another day count', 'on c.user_id = ph.user_id and c.call_date = p_day cross join m', 'on c.user_id = ph.user_id cross join m'],
  ['two officers on one customer are one row', 'select distinct on (t.ref, t.user_id) t.ref,', 'select distinct on (t.ref) t.ref,'],
  ['the shortest call gives the number', 'from talk t order by t.ref, t.user_id, t.dur desc, t.id', 'from talk t order by t.ref, t.user_id, t.dur asc, t.id'],
  ['an officer\'s calls to every customer are counted on each', 'count(*) over (partition by t.ref, t.user_id) as calls', 'count(*) over (partition by t.user_id) as calls'],
  ['the seconds of every officer are given to each', 'sum(t.dur) over (partition by t.ref, t.user_id) as secs', 'sum(t.dur) over (partition by t.ref) as secs'],
  ['the older upload of a team wins', 'order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win', 'order by s.created_at asc nulls last, s.upload_batch desc nulls last) as win'],
  ['every upload of the day counts', 'where y.upload_batch is not distinct from y.win\n', 'where true\n'],
  ['the files of every day are read', 'where s.snapshot_date = p_day and exists (select 1 from per)) y', 'where exists (select 1 from per)) y'],
  ['a customer on the current file only is listed', "ini as materialized (select distinct on (ref) * from dk where kind = 'initial' order by", "ini as materialized (select distinct on (ref) * from dk order by"],
  ['the initial file is read as the current one', "cur as materialized (select distinct on (ref) ref, arrears from dk where kind = 'current' order by", "cur as materialized (select distinct on (ref) ref, arrears from dk where kind = 'initial' order by"],
  ['off the current file recovers nothing', 'when c.ref is null then greatest(coalesce(i.arrears, 0), 0) else', 'when c.ref is null then 0 else'],
  ['a customer who owes more now recovered a negative amount', 'else greatest(coalesce(i.arrears, 0) - coalesce(c.arrears, 0), 0) end', 'else coalesce(i.arrears, 0) - coalesce(c.arrears, 0) end'],
  ['with no current file everything is recovered', 'case when not hc.ok then 0 when', 'case when not hc.ok then greatest(coalesce(i.arrears, 0), 0) when'],
  ['a day with no current file says it is a pair', "hc as materialized (select exists (select 1 from dk where kind = 'current') as ok)", 'hc as materialized (select true as ok)'],
  ['a customer no longer spoken to stays on the day', 'delete from public.legal_phone_recovery where day = p_day;\n', ''],
  ['the stamp clears every day', 'delete from public.legal_phone_recovery where day = p_day;\n', 'delete from public.legal_phone_recovery;\n'],
  ['the day\'s line is not written', 'on conflict (day) do update set stamped_at = excluded.stamped_at, n = excluded.n returning n;', 'on conflict (day) do nothing returning n;'],
  ['today is stamped at every tick', "if seen is null or seen <= now() - coalesce(p_max_age, interval '10 minutes') then", 'if true then'],
  ['the days before are stamped at every tick', "if seen is null or seen <= now() - interval '8 hours' then", 'if true then'],
  ['the days before are never stamped again', "if seen is null or seen <= now() - interval '8 hours' then", 'if seen is null then'],
  ['a tick takes more days than it is allowed', 'exit when more <= 0;\n', ''],
  ['A STAMPED DAY OLDER THAN THREE DAYS IS STAMPED AGAIN', 'for d in select today - g from generate_series(1, 3) g loop', 'for d in select today - g from generate_series(1, 13) g loop'],
  ['an older day is never caught up', 'if more > 0 then\nselect g::date into d', 'if false then\nselect g::date into d'],
  ['the older days are caught up oldest first', 'order by g desc limit 1;', 'order by g asc limit 1;'],
  ['a day the call logs no longer hold is stamped as empty', "(date_trunc('week', today::timestamp)::date - 7)::timestamp", "(date_trunc('week', today::timestamp)::date - 70)::timestamp"],
  ['two ticks run at once', "if not pg_try_advisory_xact_lock(7302611) then return jsonb_build_object('busy', true); end if;\n", ''],
  ['a failing stamp fails the read', "begin t := public.legal_phone_tick(interval '25 minutes', 1); exception when others then t := jsonb_build_object('error', sqlerrm); end;", "t := public.legal_phone_tick(interval '25 minutes', 1);"],
  ['the reader stamps as often as the clock', "begin t := public.legal_phone_tick(interval '25 minutes', 1);", "begin t := public.legal_phone_tick(interval '10 minutes', 1);"],
  ['the read holds every team', 'where r.day between p_from and p_to and (p_teams is null or r.team = any (p_teams))));', 'where r.day between p_from and p_to));'],
  ['the read holds every day', 'where r.day between p_from and p_to and (p_teams is null', 'where (p_teams is null'],
  ['the API roles can read the rows', 'revoke all on public.legal_phone_recovery, public.legal_phone_days from anon, authenticated;\n', ''],
  ['the rows have no row-level security', 'alter table public.legal_phone_recovery enable row level security;\n', ''],
  ['anybody can call the functions', 'revoke execute on function public.legal_phone_stamp(date), public.legal_phone_tick(interval, integer), public.legal_phone_week(date, date, text[]) from public, anon, authenticated;\n', ''],
  ['the service role cannot call them', 'grant execute on function public.legal_phone_stamp(date), public.legal_phone_tick(interval, integer), public.legal_phone_week(date, date, text[]) to service_role;\n', ''],
];

const t0 = Date.now(); const report = [], fails = [];
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlTo('alter default privileges in schema public grant all on tables to anon, authenticated, service_role;');   // as the live book: a new table is the API's unless it is taken back
// as the live book: the service role (the app's own key) passes row-level security; the other two never do. Put back as it was at the end.
const HAD_BYPASS = one("select rolbypassrls::int from pg_roles where rolname = 'service_role'", admin);
psqlTo('alter role service_role bypassrls', admin);
psqlTo(fs.readFileSync(ROOT + '/db/schema.sql', 'utf8'));
run(fails);
if (!fails.length) cron(fails, report);
if (!process.env.NOBIG && !fails.length) big(fails, report);
console.log(report.join('\n'));
console.log(fails.length ? 'FAIL on the file as it is:\n  ' + fails.join('\n  ') : 'the file does what it says: the stamp, the clock, the read, privacy, the cost.');
let bad = fails.length ? 1 : 0;
if (!process.env.NOBREAKS && !fails.length) {
  const res = []; const only = process.env.ONLY || '';
  for (const [name, a, b] of BREAKS) {
    if (only && !name.includes(only)) continue;
    const text = once(FILE, a, b);
    if (text === null) { res.push([name, 'BAD BREAK: its text is not in the file exactly once']); bad = 1; continue; }
    const f = [];
    try { run(f, { text }); } catch (e) { f.push('the broken copy could not be run: ' + String(e.message).slice(0, 80)); }
    const own = f.length && /could not be run/.test(f[0]);
    res.push([name, own ? 'BAD BREAK: the check could not run it (' + f[0].slice(0, 70) + ')' : f.length ? (/does not run|failed: /.test(f[0]) && !/model|stamped|rows|says/.test(f[0]) ? 'caught (it does not run: ' + f[0].slice(0, 70) + ')' : 'caught') : 'NOT CAUGHT']);
    if (!f.length || own) bad = 1;
  }
  for (const [name, r] of res) console.log('  break: ' + name.padEnd(64) + ' ' + r);
  console.log(`${res.filter(r => /^caught/.test(r[1])).length} of ${res.length} deliberate breaks caught`);
}
try { psqlTo('drop database if exists ' + DB, admin); if (HAD_BYPASS === '0') psqlTo('alter role service_role nobypassrls', admin); } catch {}
console.log('took ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(bad);
