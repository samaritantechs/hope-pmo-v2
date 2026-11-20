/* THE DAY'S CALLED NUMBERS AS ONE SMALL ANSWER -- db/RUN-ME-077, run for real on a PostgreSQL.

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026

   The owner's pg_stat_statements put `select phone, duration from call_logs where call_date = today` at the top of the whole book (272,573 page
   reads, 87,148 seconds). calledTodaySet (api/_lib/call-core.js) now asks called_phones_today(p_day, p_min) first. The file runs on the owner's live
   book by hand and the app trusts its answer to tick customers on three hundred officers' lists, so neither is believed on a reading.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database (call_logs with its real types, its check constraints and its indexes),
   and the file run exactly as the owner runs it. It passes only when:
     1. THE ANSWER. On 200 random books (a seeded generator: the same number written six ways, junk numbers, null and empty phones, durations on both
        sides of every threshold, three days) the function returns, for every day and threshold asked, EXACTLY the numbers the mock the tests read
        returns (test/snapshot-totals-rpc.mjs, written out separately), as one jsonb value {"phones": [...]} with no duplicate, no null and no empty
        string in it, an empty array (never null) for a quiet day, and, once the numbers are put through pnorm, EXACTLY the set the old page-by-page read
        built (rows of the day with a duration over the threshold).
     2. THE COST, on a book the size of the live one (800,000 call-log rows over forty days, 20,000 of them today), in the layout calls really have (a day
        written in a block) and the worst a table can have (every row in a random place): the function reads fewer pages than the page-by-page read the
        app used (ten thousand rows a page, PostgREST's shape: a json_agg over limit/offset), answers in less time and in a fraction of the bytes, and
        the plan reads the day through an index. The numbers are printed.
     3. THE FILE AS A FILE. It runs whole as one text, a second run is harmless, only service_role may call the function (anon, authenticated and
        public may not), the "did it land" line answers a number, and the undo drops the function.
     4. EVERY ONE of a list of deliberate breaks of the file makes a check fail (an SQL error alone does not count as caught).

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/called-phones.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { pnorm } = await import('../../api/_lib/call-core.js');
const { CALLED_PHONES_RPC } = await import('../../test/snapshot-totals-rpc.mjs');
const FILE = fs.readFileSync(ROOT + '/db/RUN-ME-077-called-phones-today.sql', 'utf8');
const DB = 'hope_calledphones';
const admin = process.env.PGDATABASE || 'postgres';
const env = process.env;
const PIPES = ['pipe', 'pipe', 'pipe'];
const psqlTo = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES });
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const FAST = !!process.env.FAST;

const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const DAYS = ['2026-11-19', '2026-11-20', '2026-11-21'];
const DURS = [null, 0, 1, 4, 5, 6, 19, 20, 21, 59, 60, 61, 300];
const MINS = [0, 5, 20, 59];
const writtenSixWays = n => {                      // the same customer's number, as six handsets and a v1 import have written it
  const core = '7' + String(10000000 + n).slice(0, 8);               // nine digits starting 7
  return [`0${core}`, `+255${core}`, `255${core}`, `0${core.slice(0, 3)} ${core.slice(3, 6)} ${core.slice(6)}`, core, `(0${core.slice(0, 3)}) ${core.slice(3, 6)}-${core.slice(6)}`];
};
const makeBook = seed => {
  const rnd = mulberry32(seed); const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const rows = []; let id = seed * 100000;
  const n = int(10, 70);
  for (let i = 0; i < n; i++) {
    const r = rnd(); let phone;
    if (r < 0.04) phone = null; else if (r < 0.08) phone = ''; else if (r < 0.12) phone = ['abc', ' ', '0000', '+'][int(0, 3)];
    else phone = writtenSixWays(int(1, 18))[int(0, 5)];
    rows.push({ id: 'C' + (++id), phone, call_date: DAYS[int(0, 2)], duration: DURS[int(0, DURS.length - 1)], officer: 'O' + int(1, 4), team: 'T' + int(1, 3) });
  }
  for (let i = rows.length - 1; i > 0; i--) { const j = int(0, i); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  return rows;
};
const insertSql = rows => 'truncate call_logs;\n' + (rows.length ? 'insert into call_logs (id, phone, call_date, duration, officer, team, direction, portfolio) values\n'
  + rows.map(r => '(' + [q(r.id), q(r.phone), q(r.call_date), r.duration == null ? 'null' : r.duration, q(r.officer), q(r.team), "'OUT'", 'true'].join(', ') + ')').join(',\n') + ';\n' : '');
const setOf = a => new Set(a);
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
// what the page-by-page read the app used to make gave: rows of the day longer than the threshold, put through pnorm
const oldRead = (rows, day, min) => { const s = new Set(); for (const r of rows) { if (String(r.call_date) !== day) continue; if ((Number(r.duration) || 0) <= min) continue; const d = pnorm(r.phone); if (d) s.add(d); } return s; };

/* ---- 1. the answer ---- */
const answers = (seeds, fails) => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  for (const seed of seeds) {
    const rows = makeBook(seed);
    let sql = insertSql(rows);
    const asks = [];
    for (const day of DAYS) for (const min of MINS) { asks.push([day, min]); sql += `select '${day}', ${min}, called_phones_today('${day}', ${min})::text;\n`; }
    sql += "select 'nobody', 0, called_phones_today('2030-01-01', 0)::text;\n";
    let out; try { out = psqlTo(sql, DB).split('\n').filter(Boolean).map(l => l.split('\t')); } catch (e) { note('seed ' + seed + ': the function raised an error: ' + String(e.stderr || e.message).split('\n')[0]); continue; }
    const store = { call_logs: { rows } };
    for (const [day, min, text] of out) {
      let v; try { v = JSON.parse(text); } catch { note('seed ' + seed + ' ' + day + ' ' + min + ': not JSON: ' + text.slice(0, 60)); continue; }
      const tag = 'seed ' + seed + ' ' + day + ' >' + min;
      if (!v || typeof v !== 'object' || Array.isArray(v) || JSON.stringify(Object.keys(v)) !== '["phones"]') { note(tag + ': the value is not {"phones": [...]}: ' + text.slice(0, 80)); continue; }
      if (!Array.isArray(v.phones)) { note(tag + ': phones is not an array (an empty day must be [], never null): ' + text.slice(0, 80)); continue; }
      if (v.phones.some(p => p === null)) note(tag + ': a null number is in the answer');
      if (v.phones.some(p => p === '')) note(tag + ': an empty number is in the answer');
      if (new Set(v.phones).size !== v.phones.length) note(tag + ': a number is in the answer twice');
      if (day === 'nobody') { if (v.phones.length) note('an unknown day answered numbers'); continue; }
      const want = setOf(CALLED_PHONES_RPC.called_phones_today(store, { p_day: day, p_min: min }).phones);
      if (!sameSet(setOf(v.phones), want)) note(tag + ': the numbers differ from the mock the tests read (' + v.phones.length + ' against ' + want.size + ')');
      if (!sameSet(setOf(v.phones.map(pnorm).filter(Boolean)), oldRead(rows, day, min))) note(tag + ': after pnorm the set differs from what the page-by-page read built');
    }
  }
};

/* ---- 2. the cost ---- */
const buffersOf = text => { const m = text.match(/Buffers: shared ([^\n]*)/); if (!m) return null; const g = k => { const x = m[1].match(new RegExp(k + '=(\\d+)')); return x ? Number(x[1]) : 0; }; return g('hit') + g('read'); };
const timeOf = text => { const m = text.match(/Execution Time: ([0-9.]+) ms/); return m ? Number(m[1]) : null; };
const buildBigBook = layout => {
  // 40 days of 20,000 calls (the live book's day, by the owner's own count of 300 officers); the last day is 'today'.
  psqlTo(`set jit = off;
truncate call_logs;
insert into call_logs (id, phone, call_date, call_time, duration, officer, team, direction, portfolio)
select 'B' || d || '-' || i, '0' || (700000000 + (i * 37 + d) % 30000)::text, date '2026-10-12' + d, time '06:00' + (i % 600) * interval '1 minute',
       case when i % 3 = 0 then 0 when i % 3 = 1 then 3 else 20 + i % 200 end, 'O' || (i % 300), 'T' || (i % 40), 'OUT', i % 2 = 0
from generate_series(0, 39) d cross join generate_series(1, 20000) i
${layout === 'random' ? 'order by random()' : 'order by d, i'};
vacuum analyze call_logs;`, DB);
};
const measure = () => {
  const day = '2026-11-20';
  // what the app sent before: fetchAll adds the table's unique key as the last ORDER BY (api/_lib/supabase.js, pageKeyFor: call_logs -> id), ten thousand rows a page
  const page = k => `select json_agg(t) from (select phone, duration from call_logs where call_date = '${day}' order by id asc limit 10000 offset ${k}) t`;
  const one = sql => { const o = psqlTo('set jit = off;\nexplain (analyze, buffers, costs off, timing on) ' + sql + ';', DB); return { pages: buffersOf(o), ms: timeOf(o), plan: o }; };
  const bytes = sql => Number(psqlTo('select length((' + sql + ')::text)', DB).trim());
  let pagesRead = 0, msRead = 0, bytesRead = 0, n = 0;
  for (let k = 0; k < 40000; k += 10000) {
    const r = one(page(k)); pagesRead += r.pages; msRead += r.ms; bytesRead += bytes(page(k)) || 0; n++;
    if (k >= 20000) break;
  }
  const f = one(`select called_phones_today('${day}', 5)`);
  const fb = bytes(`select called_phones_today('${day}', 5)`);
  return { read: { pages: pagesRead, ms: msRead, bytes: bytesRead, statements: n }, fn: { pages: f.pages, ms: f.ms, bytes: fb }, plan: psqlTo("explain (costs off) select distinct phone from call_logs where call_date = '" + day + "' and duration > 5", DB) };
};
const cost = (fails, report) => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  for (const layout of ['by day', 'random']) {
    buildBigBook(layout === 'random' ? 'random' : 'day');
    const m = measure();
    report.push(`${layout.padEnd(7)} page-by-page read (${m.read.statements} statements): ${m.read.pages} pages, ${m.read.ms.toFixed(0)} ms, ${(m.read.bytes / 1024).toFixed(0)} KB | the function (one statement): ${m.fn.pages} pages, ${m.fn.ms.toFixed(0)} ms, ${(m.fn.bytes / 1024).toFixed(0)} KB`);
    if (!(m.fn.pages < m.read.pages)) note(layout + ': the function reads no fewer pages than the page-by-page read: ' + m.fn.pages + ' against ' + m.read.pages);
    if (!(m.fn.ms < m.read.ms)) note(layout + ': the function is not quicker than the page-by-page read: ' + m.fn.ms + ' against ' + m.read.ms + ' ms');
    if (!(m.fn.bytes * 3 <= m.read.bytes)) note(layout + ': the answer is not a third of the bytes of the page-by-page read: ' + m.fn.bytes + ' against ' + m.read.bytes);
    if (!/Index|Bitmap/.test(m.plan)) note(layout + ': the day is not read through an index:\n' + m.plan);
  }
};

/* ---- 3. the file as a file ---- */
const roleOk = (role, sql) => psqlTo(sql.replace('$ROLE', role), DB).trim();
const asFile = fails => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  try { psqlTo(FILE, DB); psqlTo(FILE, DB); } catch (e) { note('the file did not run twice as one text: ' + String(e.stderr || e.message).split('\n')[0]); return; }
  const can = r => psqlTo(`select has_function_privilege('${r}', 'called_phones_today(date, integer)', 'execute')`, DB).trim();
  if (can('service_role') !== 't') note('service_role cannot call the function');
  for (const r of ['anon', 'authenticated']) if (can(r) !== 'f') note(r + ' can call the function (it answers customers\' phones)');
  if (psqlTo("select has_function_privilege('public', 'called_phones_today(date, integer)', 'execute')", DB).trim() !== 'f') note('PUBLIC can call the function');
  const landed = psqlTo(FILE, DB).trim().split('\n').pop();
  if (!/^\d+$/.test(landed)) note('the "did it land" line does not answer a number: ' + landed);
  if (!/END OF THE SCRIPT/.test(FILE.split('\n').filter(Boolean).pop())) note('the file does not end with its END line');
  const undo = (FILE.match(/-- UNDO, alone: (drop function if exists [^\n]*;)/) || [])[1];
  if (!undo) note('the undo line is not in the file');
  else {
    try { psqlTo(undo, DB); } catch (e) { note('the undo failed: ' + String(e.stderr || e.message).split('\n')[0]); }
    if (psqlTo("select count(*) from pg_proc where proname = 'called_phones_today'", DB).trim() !== '0') note('the undo left the function behind');
    psqlTo(FILE, DB);
  }
};

const BREAKS = [
  ['another day\'s calls are counted', 'where c.call_date = p_day\n', 'where true\n'],
  ['exactly the threshold counts as a call', 'and c.duration > p_min\n', 'and c.duration >= p_min\n'],
  ['the threshold is ignored', 'and c.duration > p_min\n', ''],
  ['a number is listed once for every call (no distinct)', 'jsonb_agg(distinct c.phone)', 'jsonb_agg(c.phone)'],
  ['null and empty numbers are listed', "and c.phone <> '';", ';'],
  ['empty numbers are listed (only a null is left out)', "and c.phone <> '';", 'and c.phone is not null;'],
  ['a quiet day answers null, not an empty list', "coalesce(jsonb_agg(distinct c.phone), '[]'::jsonb)", 'jsonb_agg(distinct c.phone)'],
  ['the value is not called phones', "jsonb_build_object('phones',", "jsonb_build_object('numbers',"],
  ['anon may call it', 'from public, anon, authenticated;', 'from public;'],
  ['service_role may not call it', 'grant execute on function called_phones_today(date, integer) to service_role;', 'revoke execute on function called_phones_today(date, integer) from service_role;'],
  ['the answer is a bare list', "select jsonb_build_object('phones', coalesce(jsonb_agg(distinct c.phone), '[]'::jsonb))", "select coalesce(jsonb_agg(distinct c.phone), '[]'::jsonb)"],
];
const once = (text, from, to) => { const n = text.split(from).length - 1; if (n !== 1) return null; return text.replace(from, () => to); };
const reinstall = text => { psqlTo('drop function if exists called_phones_today(date, integer)', DB); psqlTo(text, DB); };

const t0 = Date.now(); const report = []; const fails = [];
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlTo(fs.readFileSync(ROOT + '/db/schema.sql', 'utf8'), DB);
psqlTo(`do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
-- as Supabase sets up every project: a function made in public is granted to the three API roles by default, so the file's own revoke is what keeps anon out
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`, DB);
// the two other call_logs indexes the repository's migrations create (idx_call_logs_date: 2026-08-01-storage-counts, idx_call_logs_user: RUN-ME-011), so the planner sees the index set the live book is documented to have
psqlTo('create index if not exists idx_call_logs_date on call_logs(call_date); create index if not exists idx_call_logs_user on call_logs(user_id);', DB);
psqlTo(FILE, DB);
answers(Array.from({ length: FAST ? 30 : 200 }, (_, i) => 1 + i), fails);
asFile(fails);
if (!fails.length || true) cost(fails, report);
console.log(report.join('\n'));
console.log(fails.length ? 'FAIL on the file as it is:\n  ' + fails.join('\n  ') : 'the file does what it says: the answer, the cost, the file as a file.');
let bad = fails.length ? 1 : 0;

/* ---- 4. deliberate breaks: every one must make a check fail ---- */
if (!process.env.NOBREAKS && !fails.length) {
  const broken = [];
  for (const [name, from, to] of BREAKS) {
    const mutated = once(FILE, from, to);
    if (mutated === null) { broken.push([name, 'BAD BREAK: its text is not in the file exactly once']); bad = 1; continue; }
    const f = [];
    try { reinstall(mutated); } catch (e) { broken.push([name, 'NOT A BREAK: it does not run (' + String(e.stderr || e.message).split('\n')[0] + ')']); bad = 1; reinstall(FILE); continue; }
    answers(Array.from({ length: 40 }, (_, i) => 1 + i), f);
    const can = r => psqlTo(`select has_function_privilege('${r}', 'called_phones_today(date, integer)', 'execute')`, DB).trim();
    if (can('service_role') !== 't') f.push('service_role cannot call it');
    if (can('anon') !== 'f' || can('authenticated') !== 'f') f.push('anon or authenticated can call it');
    reinstall(FILE);
    broken.push([name, f.length ? 'caught' : 'NOT CAUGHT']); if (!f.length) bad = 1;
  }
  for (const [name, res] of broken) console.log('  break: ' + name.padEnd(58) + ' ' + res);
  console.log(`${broken.filter(b => b[1] === 'caught').length} of ${broken.length} deliberate breaks caught`);
}
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
console.log('took ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(bad);
