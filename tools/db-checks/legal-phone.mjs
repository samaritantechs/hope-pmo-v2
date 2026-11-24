/* LEGAL RECOVERY BY PHONE -- db/RUN-ME-089-legal-recovery-by-phone.sql, run for real on a PostgreSQL.

     "Legal officers should be added another card of legal recovery by phone" ... "stamp all recovery by phone, remember capturing phone
      calls is 2 weeks temporary" ... "having that number called and recorded in legal officer phone at minimum duration of 5 seconds, if
      such defaulter has recovered amount after current arrea, then adds-up to recovery by phone of legal" -- the owner, 23 Nov 2026

   The book is the real one (the whole of db/schema.sql in a scratch database); the people are made up. It passes only when:
     1. THE FILE runs whole as ONE text (as the SQL editor sends it), twice, and answers its three lines.
     2. A STAMP of a day equals a model written again in JavaScript, in every column: only phones whose role reads legal (the access
        code of that name when exactly one carries it, else the role the phone registered with; the word LEGAL, or the LEGAL_ROLE
        setting's own name); only a call longer than the minimum seconds that was not missed, rejected or blocked; only a customer on
        that day's INITIAL file; the upload that counts for each team (the newest row's); the day's recovery (initial less current;
        off the current file = all of it; no current file = nothing, and it says so); ONE ROW FOR EACH OFFICER who spoke to the
        customer (the portal names the one who spoke longest, after it has decided who is a lawyer: a phone that only looks legal can
        never hide a real one), with that officer's own calls, seconds and longest call's number; a day stamped again is the same rows;
        A DAY WITH NO LEGAL CALL READS NO PAGE OF THE DECK TABLE.
     3. THE CLOCK: a day is looked at again after its age (today the age it is given, the three days before it eight hours) AND READ
        AGAIN ONLY WHEN SOMETHING CHANGED (a legal officer's call of that day, an upload, the minimum seconds, who is legal): a day
        nothing changed on costs one small look and is not read; no more days than the tick is allowed, today never counted among
        them; one older day a tick while it was never stamped and the call logs still hold it; AND A DAY OLDER THAN THREE DAYS THAT
        WAS STAMPED IS NEVER LOOKED AT AGAIN, and a stamp asked for by hand on a day whose call logs are gone keeps its rows: they
        outlive the call logs. Two ticks at once: one of them stands back.
     4. THE READ answers one value (no row cap), the rows of the range and of the teams asked for, stamps no more often than every
        twenty-five minutes and one more day at most, and still answers when a stamp fails.
     5. PRIVACY: the API's roles can neither read the two tables nor call the five functions; the service role can.
     6. THE COST on two million deck rows laid in the worst order: a day with no legal call reads no deck; a day with calls reads that
        day's two files and no more; a day nothing changed on reads no deck at the next tick.
     7. pg_cron, where this server has it: the job is there once, with its schedule and its command, after one run and after two,
        and RUN BY pg_cron the command calls the tick under its twenty-second limit (two statements in one command).
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
// the file as the SQL editor sends it: the whole text in ONE message, so one transaction (all of it or none)
const asOne = (text, db = DB) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', text], { env: process.env, encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['pipe', 'pipe', 'pipe'] });
const TODAY = one("select (now() at time zone 'Africa/Dar_es_Salaam')::date", admin);
const dayMemo = new Map();
const day = n => { if (!dayMemo.has(n)) dayMemo.set(n, one(`select (date '${TODAY}' - ${n})::date`, admin)); return dayMemo.get(n); };
const D = [0, 1, 2, 3, 4, 5, 6].map(day);                       // D[0] today ... D[6] six days ago
const wd = d => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(d + 'T12:00:00Z').getUTCDay()];   // the label an upload stamps: the date's own weekday

/* ---- the made-up book ------------------------------------------------------------------------------------------------------- */
const CODES = [   // name, role
  ['WAKILI ONE', 'LEGAL'], ['WAKILI TWO', 'Legal Officer'], ['RECO ONE', 'PMO RECOVERY'], ['EX WAKILI', 'MANAGER'],
  ['TWIN NAME', 'MANAGER'], ['TWIN NAME', 'AUDITOR'], ['ADV ONE', 'Advocate - HQ'], ['PARALEGALS', 'PARALEGAL'],
];
const USERS = [   // user_id, name, role the phone registered with
  ['U1', 'WAKILI ONE', 'LEGAL'],            // its code says LEGAL
  ['U2', ' wakili two ', 'OFFICER'],        // registered before the code was made legal: THE CODE DECIDES (the name any case, blanks at its ends)
  ['U3', 'RECO ONE', 'PMO RECOVERY'],       // holds the Legal tab, is not a lawyer
  ['U4', 'EX WAKILI', 'LEGAL'],             // registered as legal, the code is a manager's now: THE CODE DECIDES
  ['U5', 'TWIN NAME', 'LEGAL'],             // two codes of one name (a manager's and an auditor's): nobody can say which, so the registered role stands
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
  { ref: '', team: 'TEAM ONE', dc: 9, ds: '0-12', ini: 12345, cur: 2345 },                      // a deck row with NO loan number: a call tied to nobody is never its
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
      // "Monday's baseline re-uploaded today": rows filed on this DATE under ANOTHER day's weekday, newer than everything, saying other
      // figures. A day's own files are the date's own weekday's (as every screen reads them): these must be read by nobody.
      if (c.ini !== null && c.team === 'TEAM ONE') rows.push(`(${q(c.ref)}, ${q(c.team)}, 'OTHER WEEKDAY', '0700000002', '0700000003', 8, '1-1', ${c.ini + 5555}, 'initial', ${q(wd(D[di + 1] || day(di + 1)))}, ${q(d)}, 'eeeeeeee-0000-0000-0000-00000000000${di}', ${q(d + 'T15:00:00Z')})`);
      if (c.team === 'TEAM ONE' && !noCurrent.includes(di)) rows.push(`(${q(c.ref)}, ${q(c.team)}, 'OTHER WEEKDAY', null, null, 8, '1-1', 1, 'current', ${q(wd(D[di + 1] || day(di + 1)))}, ${q(d)}, 'eeeeeeee-1111-0000-0000-00000000000${di}', ${q(d + 'T16:00:00Z')})`);
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
  psqlTo('drop function if exists public.legal_phone_week(date, date, text[]), public.legal_phone_tick(interval, integer), public.legal_phone_stamp(date), public.legal_phone_sig(date), public.legal_phones(), public.call_min_secs() cascade; drop table if exists public.legal_phone_recovery, public.legal_phone_days cascade;');
  // 1. the file, as one text, twice: the second time on the made-up book, where its answer counts the phones
  let ans;
  try { asOne(text); seed(); ans = asOne(text).trim().split('\n').map(l => l.split('\t')); } catch (e) { note('the file does not run: ' + errLine(e)); return; }
  if (ans.length !== 3 || ans[0][1] !== 'legal_phone_recovery' || ans[1][0] !== 'phones whose role reads legal' || ans[1][1] !== '5' || !/^NO pg_cron: /.test(ans[2][1]))
    note('the file does not answer its three lines (the table; 5 phones whose role reads legal: U1, U2, U5, U7 and PARALEGAL U8; no pg_cron in this database): ' + JSON.stringify(ans));
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
  // a day with no current file: stamped, nothing recovered, and it says it is not a pair
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
  // a day that has calls and deck rows but NO call of a legal phone: nothing kept, and not one page of the deck table is asked for
  seed(); psqlTo(`delete from call_logs where call_date = '${D[3]}' and user_id <> 'U9'`);
  // (asked twice: as the planner pleases, and with only the merge join allowed, a plan that reads both sides whatever they hold:
  //  what keeps the deck unread must be the file's own test, not the luck of a plan)
  try {
    for (const plan of ['', 'set local enable_hashjoin = off; set local enable_nestloop = off; ']) {
      const out = psqlTo(`begin; ${plan}select public.legal_phone_stamp('${D[3]}'); select 'HEAP', pg_stat_get_xact_blocks_fetched('public.defaulter_snapshots'::regclass); commit;`).split('\n');
      const heap = +out.find(l => l.startsWith('HEAP')).split('\t')[1];
      if (heap !== 0 || stamped(D[3]).length) note('a day with no call of a legal phone asked for ' + heap + ' pages of the deck table and kept ' + stamped(D[3]).length + ' rows (both must be none)' + (plan ? ', with only the merge join allowed' : ''));
    }
  } catch (e) { note('the stamp of a day with no legal call failed: ' + errLine(e)); return; }

  // 3. the clock
  seed();
  psqlTo('truncate legal_phone_recovery, legal_phone_days');
  const monLast = one(`select (date_trunc('week', date '${TODAY}')::date - 7)::date`);
  const older = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(day).filter(d => d >= monLast);   // what the call logs still hold, older than three days
  const J = x => JSON.stringify(x);
  const age = (days, by) => psqlTo(`update legal_phone_days set stamped_at = now() - interval '${by}' where day in (${[].concat(days).map(q).join(', ')})`);
  const fresh = d => one(`select (stamped_at > now() - interval '1 minute')::int from legal_phone_days where day = '${d}'`) === '1';
  let zid = 0;
  const call = (u, ref, secs, d) => psqlTo(`insert into call_logs (id, user_id, officer, team, phone, direction, call_date, call_time, duration, portfolio, match_type, ref, customer, outcome) values (${q('Z' + (++zid) + '-' + process.hrtime.bigint())}, ${q(u)}, 'AS LOGGED', 'TEAM ONE', '712000008', 'OUT', ${q(d)}, '12:00', ${secs}, true, 'CUSTOMER', ${q(ref)}, 'X', 'CONNECTED')`);
  const setting = (k, v) => psqlTo(`insert into settings (key, value) values (${q(k)}, ${q(v)}) on conflict (key) do update set value = excluded.value`);
  try {
    let t = tick('10 minutes', 4);
    const want1 = [D[0], D[1], D[2], D[3]].concat(older.length ? [older[0]] : []);
    if (J(t.stamped) !== J(want1)) note('the first tick stamped ' + J(t.stamped) + ', not ' + J(want1));
    for (let i = 1; i < older.length; i++) { t = tick('10 minutes', 4); if (J(t.stamped) !== J([older[i]])) note('a later tick did not stamp the next older day alone: ' + J(t.stamped) + ' for ' + older[i]); }
    t = tick('10 minutes', 4); if (t.stamped.length) note('with everything stamped a tick stamped again: ' + J(t.stamped));
    // (a) today is old enough to be looked at and NOTHING changed: it is not read again, and its line is made fresh
    age(D[0], '11 minutes'); const before = sumOf(D[0]);
    t = tick('10 minutes', 4); if (t.stamped.length) note('a today nothing changed on was read again: ' + J(t.stamped));
    if (!fresh(D[0])) note('a day that was looked at and found unchanged is not marked as looked at: it would be looked at again at every tick');
    if (sumOf(D[0]) !== before) note('a look that found nothing changed altered the rows');
    // (b) a legal officer spoke to one more customer today: read again, and the customer is there
    call('U1', '9000000008', 77, D[0]); age(D[0], '11 minutes');
    t = tick('10 minutes', 4); if (J(t.stamped) !== J([D[0]])) note('today, eleven minutes old with a new legal call, was not stamped alone: ' + J(t.stamped));
    if (!stamped(D[0]).some(r => r.ref === '9000000008' && r.user_id === 'U1' && r.secs === 77)) note('the customer a legal officer has just spoken to is not on the day after the tick');
    // (c) old enough again and nothing changed since that stamp: not read (the stamp kept the signature it was made under)
    age(D[0], '11 minutes'); t = tick('10 minutes', 4); if (t.stamped.length) note('a day stamped a moment ago, with nothing changed since, was read again: ' + J(t.stamped));
    // (i) the three days before, nine hours old and unchanged: looked at, not read
    age([D[1], D[2], D[3]], '9 hours'); t = tick('25 minutes', 1);
    if (t.stamped.length) note('days nothing changed on were read again after eight hours: ' + J(t.stamped));
    if (![D[1], D[2], D[3]].every(fresh)) note('the three days before, looked at and unchanged, are not all marked as looked at');
    // (d) a call from a phone that is not legal, and a legal call of ANOTHER day: today is not read
    call('U9', '9000000008', 80, D[0]); call('U1', '9000000008', 80, D[1]); age(D[0], '11 minutes');
    t = tick('10 minutes', 4); if (t.stamped.length) note('today was read again for a call from a phone that is not legal, or for a call of another day: ' + J(t.stamped));
    // (e) an upload (the data stamp moves): read again
    setting('DATA_VERSION', '1700000000001'); age(D[0], '11 minutes');
    t = tick('10 minutes', 4); if (J(t.stamped) !== J([D[0]])) note('after an upload today was not stamped: ' + J(t.stamped));
    // (f) the minimum seconds changed: read again
    setting('CALL_MIN_SECS', '6'); age(D[0], '11 minutes');
    t = tick('10 minutes', 4); if (J(t.stamped) !== J([D[0]])) note('after the minimum seconds changed today was not stamped: ' + J(t.stamped));
    // (g) a legal code's role is written another way (still legal): read again, and the rows say the new role
    psqlTo("update access_codes set role = 'LEGAL OFFICER' where name = 'WAKILI TWO'"); age(D[0], '11 minutes');
    t = tick('10 minutes', 4); if (J(t.stamped) !== J([D[0]])) note('after a legal code\'s role was rewritten today was not stamped: ' + J(t.stamped));
    if (!stamped(D[0]).filter(r => r.user_id === 'U2').every(r => r.role === 'LEGAL OFFICER') || !stamped(D[0]).some(r => r.user_id === 'U2')) note('the rows do not carry the role the code has now');
    // (h) the age comes first: eleven minutes old and changed, the reader's tick (25 minutes) leaves it; the clock's own takes it, with no other day allowed
    call('U1', '9000000008', 81, D[0]); age(D[0], '11 minutes');
    t = tick('25 minutes', 1); if (t.stamped.length) note('the reader\'s tick (25 minutes) stamped a today that is eleven minutes old: ' + J(t.stamped));
    t = tick('10 minutes', 0); if (J(t.stamped) !== J([D[0]])) note('allowed no other day, the tick did not stamp today alone: ' + J(t.stamped));
    // (j) the days before, nine hours old and CHANGED (the upload of (e) is news to them): one more day allowed is yesterday alone
    age([D[1], D[2], D[3]], '9 hours');
    t = tick('25 minutes', 1); if (J(t.stamped) !== J([D[1]])) note('allowed one more day, the tick stamped ' + J(t.stamped) + ', not yesterday alone');
    t = tick('25 minutes', 0); if (t.stamped.length) note('allowed no more day, the tick stamped ' + J(t.stamped));
    // (k) today and a day before both wait: today does not use up the allowance
    call('U1', '9000000008', 82, D[0]); age(D[0], '26 minutes');
    t = tick('25 minutes', 1); if (J(t.stamped) !== J([D[0], D[2]])) note('with today and two days ago waiting and one more day allowed, the tick stamped ' + J(t.stamped) + ', not today and two days ago');
    t = tick('25 minutes', 4); if (J(t.stamped) !== J([D[3]])) note('the day still waiting was not stamped alone: ' + J(t.stamped));
    // (l) a day before that changed but is only seven hours old: not yet
    call('U1', '9000000008', 83, D[1]); age(D[1], '7 hours');
    t = tick('25 minutes', 4); if (t.stamped.length) note('a day seven hours old was stamped again: ' + J(t.stamped));
    // (m) THE POINT OF THE TABLE: a day older than three days, once stamped, is never looked at again, whatever happens to the call logs
    const old = D[5], keep = sumOf(old);
    if (!stamped(old).length) note('the day five days ago was never stamped (the fixture has calls on it)');
    psqlTo(`delete from call_logs where call_date = '${old}'; update legal_phone_days set stamped_at = now() - interval '30 days' where day = '${old}';`);
    const at = one(`select stamped_at from legal_phone_days where day = '${old}'`);
    for (let i = 0; i < 3; i++) tick('0 minutes', 4);
    if (sumOf(old) !== keep) note('a day older than three days was stamped again after its call logs were cleared: its rows are lost');
    if (one(`select stamped_at from legal_phone_days where day = '${old}'`) !== at) note('a stamped day older than three days was looked at again by a tick');
    // (n) and a stamp asked for by hand on a day whose call logs are gone keeps what was stamped
    psqlTo(`select public.legal_phone_stamp('${old}')`);
    if (sumOf(old) !== keep) note('a stamp of a day whose call logs are gone wiped the day: its rows are lost');
    if (daysNow()[old] !== String(stamped(old).length)) note('after that stamp the day\'s line does not count the rows that were kept');
    // (o) two ticks at once: one stands back
    const busy = psqlTo(`begin; select pg_advisory_xact_lock(7302611); \\! PGDATABASE=${DB} psql -X -q -At -c "select public.legal_phone_tick(interval '0 minutes', 4)"\ncommit;`).trim().split('\n').pop();
    if (busy !== '{"busy": true}') note('a tick did not stand back while another held the lock: ' + busy);
  } catch (e) { note('the clock failed: ' + errLine(e)); return; }

  // 4. the read: one value, the range, the teams; how often it stamps; and it answers when the stamp fails
  try {
    seed(); psqlTo('truncate legal_phone_recovery, legal_phone_days'); tick('0 minutes', 4);
    const week = (a, b, teams) => JSON.parse(one(`select public.legal_phone_week('${a}', '${b}', ${teams})`));
    const w = week(D[3], D[0], 'null');
    const want = [3, 2, 1, 0].flatMap(di => model(di));
    if (w.v !== 1 || !Array.isArray(w.rows) || w.rows.length !== want.length) note('the read does not hold the range\'s rows: ' + (w.rows || []).length + ' against ' + want.length);
    if (J((w.rows || []).map(r => r.day + r.ref + r.user_id + Number(r.recovered))) !== J(want.map(r => r.day + r.ref + r.user_id + r.recovered))) note('the read\'s rows are not the model\'s, in order of day, customer and phone');
    if (!w.tick || J(w.tick.stamped) !== J([D[5]])) note('the read\'s own tick did not catch up one older day (five days ago): ' + J(w.tick));
    if (w.first !== D[5]) note('the read does not say the first day that holds a row (five days ago): ' + w.first);
    if (!Array.isArray(w.days) || w.days.length !== 4 || !w.days.every(x => x.day && x.at)) note('the read does not say when each day was stamped: ' + J(w.days));
    const w1 = week(D[0], D[0], "array['TEAM TWO']");
    if (J(w1.rows.map(r => r.ref + r.user_id)) !== J(model(0).filter(r => r.team === 'TEAM TWO').map(r => r.ref + r.user_id))) note('the read for one team holds ' + J(w1.rows.map(r => r.ref + r.user_id)));
    if (week(D[0], D[0], 'array[]::text[]').rows.length !== 0) note('the read for no team at all is not an empty list');
    // the reader leaves a today that is eleven minutes old, new call or not
    call('U1', '9000000008', 77, D[0]); age(D[0], '11 minutes');
    const w3 = week(D[0], D[0], 'null'); if (!w3.tick || !Array.isArray(w3.tick.stamped) || w3.tick.stamped.includes(D[0])) note('the read stamped a today that is eleven minutes old: ' + J(w3.tick));
    // the three days before wait, changed: the reader takes ONE of them and no older day
    for (const d of [D[1], D[2], D[3]]) call('U1', '9000000008', 78, d);
    age([D[1], D[2], D[3]], '9 hours');
    const w4 = week(D[3], D[0], 'null'); if (!w4.tick || J(w4.tick.stamped) !== J([D[1]])) note('the read\'s tick took ' + J(w4.tick) + ', not yesterday alone');
    if (!w4.rows.some(r => r.day === D[1] && r.ref === '9000000008')) note('what the read\'s own tick has just stamped is not in its answer');
    // a stamp that fails must not fail the read: the rows already stamped still come, and the answer says the tick failed
    const held = +one(`select count(*) from legal_phone_recovery where day = '${D[0]}'`);
    psqlTo(`update legal_phone_days set stamped_at = now() - interval '2 hours' where day = '${D[0]}'; alter function public.call_min_secs() rename to call_min_secs_gone;`);
    let w2; try { w2 = week(D[0], D[0], 'null'); } catch (e) { note('the read failed because the stamp failed: ' + errLine(e)); }
    if (w2 && (!w2.tick || !w2.tick.error || w2.rows.length !== held || !held)) note('with a failing stamp the read does not say so, or lost its rows: ' + J(w2.tick) + ' ' + w2.rows.length + ' of ' + held);
    psqlTo('alter function public.call_min_secs_gone() rename to call_min_secs;');
  } catch (e) { note('the read failed: ' + errLine(e)); try { psqlTo('alter function public.call_min_secs_gone() rename to call_min_secs;'); } catch {} return; }

  // 5. privacy
  try {
    const FN = "(values ('public.legal_phones()'), ('public.legal_phone_sig(date)'), ('public.legal_phone_stamp(date)'), ('public.legal_phone_tick(interval, integer)'), ('public.legal_phone_week(date, date, text[])')) f(n)";
    const p = one(`select has_table_privilege('anon', 'public.legal_phone_recovery', 'select')::int + has_table_privilege('authenticated', 'public.legal_phone_recovery', 'select')::int
      + has_table_privilege('anon', 'public.legal_phone_days', 'select')::int + has_table_privilege('authenticated', 'public.legal_phone_days', 'select')::int,
      (select count(*) from pg_class where oid in ('public.legal_phone_recovery'::regclass, 'public.legal_phone_days'::regclass) and relrowsecurity),
      (select count(*) from ${FN}, (values ('anon'), ('authenticated'), ('public')) r(n) where has_function_privilege(r.n, f.n, 'execute')),
      (select count(*) from ${FN} where has_function_privilege('service_role', f.n, 'execute'))`);
    if (p !== '0\t2\t0\t5') note('privacy (API roles that read the tables, tables with row-level security, API roles that may call a function, functions the service role may call): ' + p + ', not 0, 2, 0, 5');
    const asService = one(`set role service_role; select jsonb_array_length(public.legal_phone_week('${D[0]}', '${D[0]}', null) -> 'rows');`);
    if (asService !== one(`select count(*) from legal_phone_recovery where day = '${D[0]}'`) || asService === '0') note('the service role does not get the rows: ' + asService);
  } catch (e) { note('the privacy check failed: ' + errLine(e)); }
}

/* ---- 6. the cost, on two million deck rows in the worst order ------------------------------------------------------------------- */
function big(fails, report) {
  const note = m => { if (fails.length < 25) fails.push(m); };
  seed({ days: [0, 1] });
  psqlTo(`truncate legal_phone_recovery, legal_phone_days;
insert into teams (team) select 'TEAM ' || i from generate_series(0, 83) i on conflict do nothing;
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
  const cl = "(select coalesce(sum(pg_stat_get_xact_blocks_fetched(c.oid)), 0) from pg_class c where c.oid = 'public.call_logs'::regclass or c.oid in (select indexrelid from pg_index where indrelid = 'public.call_logs'::regclass))";
  const measure = sql => { const t0 = Date.now();
    const out = psqlTo(`begin; ${sql}; select 'HEAP', pg_stat_get_xact_blocks_fetched('public.defaulter_snapshots'::regclass); select 'CALLS', ${cl}; commit;`).split('\n');
    return { secs: (Date.now() - t0) / 1000, heap: +out.find(l => l.startsWith('HEAP')).split('\t')[1], calls: +out.find(l => l.startsWith('CALLS')).split('\t')[1], out }; };
  const dayRows = +one(`select count(*) from defaulter_snapshots where snapshot_date = '${TODAY}'`);
  const callsDay = +one(`select count(*) from call_logs where call_date = '${TODAY}'`), legalDay = +one(`select count(*) from call_logs where call_date = '${TODAY}' and user_id in (select user_id from public.legal_phones())`);
  const withCalls = measure(`select public.legal_phone_stamp('${TODAY}')`), kept = +one(`select count(*) from legal_phone_recovery where day = '${TODAY}'`);
  const noCalls = measure(`select public.legal_phone_stamp('${day(30)}')`);
  // the next tick, nothing changed: one small look at the legal phones' calls of the day, and not one page of the deck
  psqlTo(`update legal_phone_days set stamped_at = now() - interval '1 hour' where day = '${TODAY}'`);
  const look = measure(`select 'TICK', public.legal_phone_tick(interval '10 minutes', 0)`), lookDid = JSON.parse(look.out.find(l => l.startsWith('TICK')).split('\t')[1]).stamped;
  // and after one more legal call the day is read again
  psqlTo(`insert into call_logs (id, user_id, officer, team, phone, direction, call_date, call_time, duration, portfolio, match_type, ref, customer, outcome) values ('BX', 'U1', 'X', 'TEAM ONE', '700999999', 'OUT', date '${TODAY}', '12:00', 99, true, 'CUSTOMER', '5000000003', 'X', 'CONNECTED');
update legal_phone_days set stamped_at = now() - interval '1 hour' where day = '${TODAY}'`);
  const again = measure(`select 'TICK', public.legal_phone_tick(interval '10 minutes', 0)`), againDid = JSON.parse(again.out.find(l => l.startsWith('TICK')).split('\t')[1]).stamped;
  report.push(`two million deck rows in a random order (${pages} pages), ${dayRows} rows on the day, ${callsDay} calls on the day of which ${legalDay} are a legal phone's: the stamp took ${withCalls.secs.toFixed(1)} s, asked for ${withCalls.heap} pages of the deck table and ${withCalls.calls} of the call logs and their indexes, and kept ${kept} rows; a day with no legal call asked for ${noCalls.heap} pages of the deck; the next tick with nothing changed asked for ${look.heap} pages of the deck and ${look.calls} of the call logs (${look.secs.toFixed(2)} s); after one more legal call the tick read the day again (${again.heap} pages, ${again.secs.toFixed(1)} s)`);
  if (!(kept > 300)) note('the big book\'s stamp kept ' + kept + ' rows: the fixture is not what it says');
  if (!(withCalls.heap <= dayRows * 1.2 + 200)) note('the stamp asked for ' + withCalls.heap + ' pages of the deck table for a day of ' + dayRows + ' rows: it reads more than the day');
  if (!(noCalls.heap < 50)) note('a day with no legal call asked for ' + noCalls.heap + ' pages of the deck table');
  if (!(withCalls.secs < 20)) note('the stamp took ' + withCalls.secs.toFixed(1) + ' s on the big book');
  if (lookDid.length || look.heap !== 0) note('a tick on a day nothing changed on read the deck (' + look.heap + ' pages) or stamped ' + JSON.stringify(lookDid));
  if (!(look.calls < 2500)) note('the look at a day nothing changed on asked for ' + look.calls + ' pages of the call logs: more than the legal phones\' own calls of the day');
  if (JSON.stringify(againDid) !== JSON.stringify([TODAY]) || !(again.heap > 0)) note('after one more legal call the tick did not read the day again: ' + JSON.stringify(againDid));
}

/* ---- 7. pg_cron, where this server has it ------------------------------------------------------------------------------------------ */
function cron(fails, report, text = FILE) {
  const note = m => { if (fails.length < 25) fails.push(m); };
  let cdb; try { cdb = one("select current_setting('cron.database_name', true)", admin); } catch { cdb = ''; }
  if (!cdb || one(`select count(*) from pg_database where datname = ${q(cdb)}`, admin) !== '1') { report.push('this server has no pg_cron database: the job itself was not tried (the file answers "NO pg_cron" here, which is checked)'); return false; }
  // the three lines of the file that schedule the job, as they are, run where pg_cron lives (the functions the job calls are not needed to schedule it)
  const L = text.split('\n'), i = L.findIndex(l => l.startsWith("perform cron.schedule('legal-phone-tick'"));
  if (i < 1 || !/^if .* then$/.test(L[i - 1]) || L[i + 1] !== 'end if;') { note('the lines that schedule the job are gone'); return true; }
  const block = 'do $$\nbegin\n' + L.slice(i - 1, i + 2).join('\n') + '\nend $$;';
  const says = L.find(l => l.startsWith("union all select 3, 'stamped by itself every ten minutes', "));
  try {
    psqlTo('create extension if not exists pg_cron;', cdb);
    psqlTo(block, cdb); psqlTo(block, cdb);
    const jobs = psqlTo("select schedule, command from cron.job where jobname = 'legal-phone-tick'", cdb).trim().split('\n').filter(Boolean);
    if (jobs.length !== 1 || jobs[0] !== "*/10 * * * *\tset statement_timeout = '20s'; select public.legal_phone_tick(interval '9 minutes', 1);") note('after two runs the job is not there once with its schedule and its command: ' + JSON.stringify(jobs));
    if (!says || one('select answer from (select 0 as k, null::text as what, null::text as answer ' + says + ') x where k = 3', cdb) !== 'yes (pg_cron)') note('where pg_cron is, the file\'s answer does not say so');
    /* AND THE JOB'S COMMAND RUNS AS WRITTEN: two statements in one command, the first of which must hold for the second. The command
       is taken back out of cron.job (the file's own words) and given to pg_cron on a two-second schedule, against a stand-in of the
       tick that writes down the statement timeout it runs under and what it was asked. Nothing of the real book is needed for this. */
    psqlTo(`create table if not exists public.legal_phone_cron_try (at timestamptz default now(), timeout text, age text, extra integer);
truncate public.legal_phone_cron_try;
create or replace function public.legal_phone_tick(p_max_age interval, p_extra integer) returns jsonb language plpgsql as $f$
begin insert into public.legal_phone_cron_try (timeout, age, extra) values (current_setting('statement_timeout'), p_max_age::text, p_extra); return '{}'::jsonb; end $f$;
select cron.schedule('legal-phone-tick-try', '2 seconds', (select command from cron.job where jobname = 'legal-phone-tick'));`, cdb);
    let ran = '';
    for (let i = 0; i < 40 && !ran; i++) { execFileSync('sleep', ['0.5']); ran = one('select timeout, age, extra from public.legal_phone_cron_try order by at limit 1', cdb); }
    if (ran !== '20s\t00:09:00\t1') note('run by pg_cron, the job\'s command did not call the tick under a twenty-second limit with nine minutes and one more day: ' + JSON.stringify(ran));
    report.push('pg_cron (database ' + cdb + '): the job is there once after two runs, every ten minutes; run by pg_cron, its command calls the tick under a twenty-second limit');
  } catch (e) { note('scheduling failed on a server that has pg_cron: ' + errLine(e)); }
  finally { try { psqlTo("select cron.unschedule(jobid) from cron.job where jobname in ('legal-phone-tick', 'legal-phone-tick-try'); drop function if exists public.legal_phone_tick(interval, integer); drop table if exists public.legal_phone_cron_try;", cdb); } catch {} }
  return true;
}

/* NOT IN THE LIST, AND WHY: taking "and exists (select 1 from per)" out of the deck read (so that a day nobody was spoken to on
   could read the deck) changes nothing this check can see. PostgreSQL 16 stops a join as soon as one side is known to be empty, and
   it did so in every plan the check could force (as it pleases; merge joins only; hash joins only): 0 pages either way. The test
   stays in the file as a written guarantee that does not depend on the plan (it puts a one-time filter above the scan), and the
   0 pages are asserted on the file as it is, under two plans, on the small book and on the two million rows. */
const once = (text, from, to) => { const n = text.split(from).length - 1; if (n !== 1) return null; return text.replace(from, () => to); };
// A break: [what would be wrong, the file's own words, what they are changed to, 'cron' when only the scheduling can show it]
const BREAKS = [
  ['a call of exactly the minimum counts', 'and coalesce(c.duration, 0) > m.min', 'and coalesce(c.duration, 0) >= m.min'],
  ['the minimum is five whatever the setting says', 'and coalesce(c.duration, 0) > m.min', 'and coalesce(c.duration, 0) > 5'],
  ['a missed, rejected or blocked call counts', "and upper(btrim(coalesce(c.outcome, ''))) not in ('MISSED', 'REJECTED', 'BLOCKED') ", ''],
  ['a call tied to no customer counts', "where coalesce(c.ref, '') <> '' and ", 'where '],
  ['every phone is a legal phone', "where upper(r.role) like '%LEGAL%' or (m.want", 'where true or (m.want'],
  ['the role the phone registered with decides, not its code', "select coalesce((select min(c.role) from public.access_codes c where upper(btrim(c.name)) = upper(btrim(u.name)) having count(*) = 1), u.role, '') as role) r", "select coalesce(u.role, '') as role) r"],
  ['a name two codes carry takes one of their roles', ' having count(*) = 1), u.role', '), u.role'],
  ['the code is found only when the names are typed alike', 'where upper(btrim(c.name)) = upper(btrim(u.name)) having', 'where c.name = u.name having'],
  ['the LEGAL_ROLE setting is not read', " or (m.want <> '' and btrim(regexp_replace(upper(r.role), '[^A-Z0-9]+', ' ', 'g')) = m.want)", ''],
  ['the calls of another day count', 'on c.user_id = ph.user_id and c.call_date = p_day cross join m', 'on c.user_id = ph.user_id cross join m'],
  ['two officers on one customer are one row', 'select distinct on (t.ref, t.user_id) t.ref,', 'select distinct on (t.ref) t.ref,'],
  ['the shortest call gives the number', 'from talk t order by t.ref, t.user_id, t.dur desc, t.id', 'from talk t order by t.ref, t.user_id, t.dur asc, t.id'],
  ['an officer\'s calls to every customer are counted on each', 'count(*) over (partition by t.ref, t.user_id) as calls', 'count(*) over (partition by t.user_id) as calls'],
  ['the seconds of every officer are given to each', 'sum(t.dur) over (partition by t.ref, t.user_id) as secs', 'sum(t.dur) over (partition by t.ref) as secs'],
  ['the older upload of a team wins', 'order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win', 'order by s.created_at asc nulls last, s.upload_batch desc nulls last) as win'],
  ['every upload of the day counts', 'where y.upload_batch is not distinct from y.win\n', 'where true\n'],
  ['a file of that date filed under another weekday is read', " and s.weekday = to_char(p_day, 'DY')", ''],
  ['the files of every day are read', "where s.snapshot_date = p_day and s.weekday = to_char(p_day, 'DY') and exists", "where s.weekday = to_char(p_day, 'DY') and exists"],
  ['a customer on the current file only is listed', "ini as materialized (select distinct on (ref) * from dk where kind = 'initial' order by", 'ini as materialized (select distinct on (ref) * from dk order by'],
  ['the initial file is read as the current one', "cur as materialized (select distinct on (ref) ref, arrears from dk where kind = 'current' order by", "cur as materialized (select distinct on (ref) ref, arrears from dk where kind = 'initial' order by"],
  ['off the current file recovers nothing', 'when c.ref is null then greatest(coalesce(i.arrears, 0), 0) else', 'when c.ref is null then 0 else'],
  ['a customer who owes more now recovered a negative amount', 'else greatest(coalesce(i.arrears, 0) - coalesce(c.arrears, 0), 0) end', 'else coalesce(i.arrears, 0) - coalesce(c.arrears, 0) end'],
  ['with no current file everything is recovered', 'case when not hc.ok then 0 when', 'case when not hc.ok then greatest(coalesce(i.arrears, 0), 0) when'],
  ['a day with no current file says it is a pair', "hc as materialized (select exists (select 1 from dk where kind = 'current') as ok)", 'hc as materialized (select true as ok)'],
  ['a customer no longer spoken to stays on the day', 'delete from public.legal_phone_recovery where day = p_day and exists (select 1 from public.call_logs c where c.call_date = p_day);\n', ''],
  ['the stamp clears every day', 'delete from public.legal_phone_recovery where day = p_day and exists', 'delete from public.legal_phone_recovery where exists'],
  ['A STAMP OF A DAY WHOSE CALL LOGS ARE GONE WIPES IT', 'where day = p_day and exists (select 1 from public.call_logs c where c.call_date = p_day);\n', 'where day = p_day;\n'],
  ['the day\'s line is written once and never again', 'on conflict (day) do update set stamped_at = excluded.stamped_at, n = excluded.n, sig = excluded.sig returning n;', 'on conflict (day) do nothing returning n;'],
  ['a stamp does not keep what it was made under', 'n = excluded.n, sig = excluded.sig returning n;', 'n = excluded.n returning n;'],
  ['an upload does not make a day news', "select md5(concat_ws('|', (select s.value from public.settings s where s.key = 'DATA_VERSION'), public.call_min_secs(),", "select md5(concat_ws('|', public.call_min_secs(),"],
  ['a new minimum does not make a day news', "where s.key = 'DATA_VERSION'), public.call_min_secs(),", "where s.key = 'DATA_VERSION'),"],
  ['a legal code rewritten does not make a day news', "(select string_agg(p.user_id || '=' || p.role, ',' order by p.user_id) from public.legal_phones() p),\n", ''],
  ['a new legal call does not make a day news', "(select concat_ws('|', count(*), sum(c.duration), max(c.synced_at)) from public.call_logs c", "(select concat_ws('|', count(*) * 0) from public.call_logs c"],
  ['the calls of every phone make a day news', 'where c.call_date = p_day and c.user_id in (select p.user_id from public.legal_phones() p))));', 'where c.call_date = p_day)));'],
  ['the calls of every day make a day news', 'from public.call_logs c where c.call_date = p_day and c.user_id in', 'from public.call_logs c where c.user_id in'],
  ['a day is read again whatever its age, as soon as something changed', "if not found or x.stamped_at <= now() - (case when d = today then coalesce(p_max_age, interval '10 minutes') else interval '8 hours' end) then", 'if true then'],
  ['the days before are looked at as often as today', "else interval '8 hours' end) then", "else coalesce(p_max_age, interval '10 minutes') end) then"],
  ['today waits eight hours like the days before', "(case when d = today then coalesce(p_max_age, interval '10 minutes') else interval '8 hours' end)", "interval '8 hours'"],
  ['A DAY NOTHING CHANGED ON IS READ AGAIN', 'if found and x.sig = public.legal_phone_sig(d) then update public.legal_phone_days set stamped_at = now() where day = d;\nelsif d = today or more > 0 then', 'if d = today or more > 0 then'],
  ['a day found unchanged is looked at again at every tick', 'then update public.legal_phone_days set stamped_at = now() where day = d;', 'then null;'],
  ['a tick takes more days than it is allowed', 'elsif d = today or more > 0 then', 'elsif true then'],
  ['the allowance is never used up', ' if d <> today then more := more - 1; end if;', ''],
  ['today uses up the allowance', 'if d <> today then more := more - 1; end if;', 'more := more - 1;'],
  ['today waits for the allowance like any other day', 'elsif d = today or more > 0 then', 'elsif more > 0 then'],
  ['A STAMPED DAY OLDER THAN THREE DAYS IS LOOKED AT AGAIN', 'for d in select today - g from generate_series(0, 3) g loop', 'for d in select today - g from generate_series(0, 13) g loop'],
  ['an older day is never caught up', 'if more > 0 then\nselect g::date into d', 'if false then\nselect g::date into d'],
  ['the older days are caught up oldest first', 'order by g desc limit 1;', 'order by g asc limit 1;'],
  ['a day the call logs no longer hold is stamped as empty', "(date_trunc('week', today::timestamp)::date - 7)::timestamp", "(date_trunc('week', today::timestamp)::date - 70)::timestamp"],
  ['two ticks run at once', "if not pg_try_advisory_xact_lock(7302611) then return jsonb_build_object('busy', true); end if;\n", ''],
  ['a failing stamp fails the read', "begin t := public.legal_phone_tick(interval '25 minutes', 1); exception when others then t := jsonb_build_object('error', sqlerrm); end;", "t := public.legal_phone_tick(interval '25 minutes', 1);"],
  ['the reader stamps as often as the clock', "begin t := public.legal_phone_tick(interval '25 minutes', 1);", "begin t := public.legal_phone_tick(interval '10 minutes', 1);"],
  ['the reader takes every day that waits', "begin t := public.legal_phone_tick(interval '25 minutes', 1);", "begin t := public.legal_phone_tick(interval '25 minutes', 4);"],
  ['the reader never stamps', "begin t := public.legal_phone_tick(interval '25 minutes', 1);", "begin t := jsonb_build_object('stamped', '[]'::jsonb);"],
  ['the read holds every team', 'where r.day between p_from and p_to and (p_teams is null or r.team = any (p_teams))));', 'where r.day between p_from and p_to));'],
  ['the read holds every day', 'where r.day between p_from and p_to and (p_teams is null', 'where (p_teams is null'],
  ['the read comes in no order', "jsonb_agg(to_jsonb(r) order by r.day, r.ref, r.user_id)", "jsonb_agg(to_jsonb(r) order by r.recovered, r.ref desc, r.user_id desc)"],
  ['the API roles can read the rows', 'revoke all on public.legal_phone_recovery, public.legal_phone_days from anon, authenticated;\n', ''],
  ['the rows have no row-level security', 'alter table public.legal_phone_recovery enable row level security;\n', ''],
  ['the days have no row-level security', 'alter table public.legal_phone_days enable row level security;\n', ''],
  ['anybody can call the functions', "execute format('revoke execute on function public.%s from public, anon, authenticated; grant execute on function public.%s to service_role', f, f);", "execute format('grant execute on function public.%s to service_role', f);"],
  ['the service role cannot call them', "execute format('revoke execute on function public.%s from public, anon, authenticated; grant execute on function public.%s to service_role', f, f);", "execute format('revoke execute on function public.%s from public, anon, authenticated', f);"],
  ['anybody can ask for a stamp', "'legal_phone_sig(date)', 'legal_phone_stamp(date)', 'legal_phone_tick(interval, integer)'", "'legal_phone_sig(date)', 'legal_phone_tick(interval, integer)'"],
  ['the answer says pg_cron where there is none', "case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'yes (pg_cron)'", "case when true then 'yes (pg_cron)'"],
  ['the job runs every minute', "perform cron.schedule('legal-phone-tick', '*/10 * * * *',", "perform cron.schedule('legal-phone-tick', '* * * * *',", 'cron'],
  ['the job has no time limit', "$job$set statement_timeout = '20s'; select public.legal_phone_tick", '$job$select public.legal_phone_tick', 'cron'],
  ['the job is not scheduled where pg_cron is', "if exists (select 1 from pg_extension where extname = 'pg_cron') then\nperform cron.schedule", 'if false then\nperform cron.schedule', 'cron'],
  ['the job looks at today as rarely as the reader', "select public.legal_phone_tick(interval '9 minutes', 1);$job$", "select public.legal_phone_tick(interval '25 minutes', 1);$job$", 'cron'],
];

const t0 = Date.now(); const report = [], fails = [];
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
// As the live book: a new TABLE is the API's unless it is taken back, and so is a new FUNCTION for the two roles a browser can hold.
// The service role is given nothing here, so that the file's own grant to it is what lets it call (stricter than the live book, on purpose).
psqlTo('alter default privileges in schema public grant all on tables to anon, authenticated, service_role; alter default privileges in schema public grant execute on functions to anon, authenticated;');
// as the live book: the service role (the app's own key) passes row-level security; the other two never do. Put back as it was at the end.
const HAD_BYPASS = one("select rolbypassrls::int from pg_roles where rolname = 'service_role'", admin);
psqlTo('alter role service_role bypassrls', admin);
psqlTo(fs.readFileSync(ROOT + '/db/schema.sql', 'utf8'));
run(fails);
let hasCron = false;
if (!fails.length) hasCron = cron(fails, report);
if (!process.env.NOBIG && !fails.length) big(fails, report);
console.log(report.join('\n'));
console.log(fails.length ? 'FAIL on the file as it is:\n  ' + fails.join('\n  ') : 'the file does what it says: the stamp, the clock, the read, privacy, the cost.');
let bad = fails.length ? 1 : 0;
if (!process.env.NOBREAKS && !fails.length) {
  const res = []; const only = process.env.ONLY || '';
  for (const [name, a, b, kind] of BREAKS) {
    if (only && !name.includes(only)) continue;
    const text = once(FILE, a, b);
    if (text === null) { res.push([name, 'BAD BREAK: its text is not in the file exactly once']); bad = 1; continue; }
    if (kind === 'cron' && !hasCron) { res.push([name, 'not tried: this server has no pg_cron']); continue; }
    const f = [];
    try { if (kind === 'cron') cron(f, [], text); else run(f, { text }); }
    catch (e) { f.push(e && typeof e.stderr === 'string' && /ERROR/.test(e.stderr) ? 'a statement failed: ' + errLine(e) : 'the broken copy could not be run: ' + String(e.message).slice(0, 80)); }
    const own = f.length && /could not be run/.test(f[0]);
    res.push([name, own ? 'BAD BREAK: the check could not run it (' + f[0].slice(0, 70) + ')' : f.length ? 'caught: ' + f[0].slice(0, 110) : 'NOT CAUGHT']);
    if (!f.length || own) bad = 1;
  }
  for (const [name, r] of res) console.log('  break: ' + name.padEnd(66) + ' ' + r);
  const tried = res.filter(r => !/^not tried/.test(r[1]));
  console.log(`${tried.filter(r => /^caught/.test(r[1])).length} of ${tried.length} deliberate breaks caught` + (tried.length < res.length ? ` (${res.length - tried.length} not tried: no pg_cron here)` : ''));
}
try { psqlTo('drop database if exists ' + DB, admin); if (HAD_BYPASS === '0') psqlTo('alter role service_role nobypassrls', admin); } catch {}
console.log('took ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(bad);
