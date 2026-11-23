/* THE CALL BOARD AS ONE SMALL ANSWER -- db/RUN-ME-078, run for real on a PostgreSQL.

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026

   The owner's pg_stat_statements put the dashboard's and the Presentation's read of the whole week of call logs second in the book
   (121,746 calls, 70,285 seconds). officerBoardsUncached (api/_lib/portal-core.js) now asks call_board_rollup(p_from, p_to, p_day, p_teams)
   first. The board is a set of figures people are paid and judged on, so the function is not believed on a reading: it is held equal to the
   production definition, boardRowsFromLogs (api/_lib/call-core.js, which the board falls back to), on random books.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database (call_logs with its real types, constraints and indexes), the
   file run exactly as the owner runs it, with Supabase's default grants on the API roles. It passes only when:
     1. THE ANSWER. On 150 random books (officer names padded with spaces, tabs and no-break spaces, in other cases, empty and null; the same
        officer under a team that is null, empty, another case, with a trailing space; numbers written several ways, null and empty; refs;
        durations either side of zero; portfolio true, false and null; outcomes and categories written every way; ids of mixed case, digits and
        punctuation so that the collation matters; calls on days outside the window) the function's two lists, 'w' (the window) and 't' (the
        day), equal boardRowsFromLogs over the same rows, EXACTLY and in the same ORDER, for the admin (no team list), for a viewer with a team
        list (teamMatchList, the production function), for a day outside the window, for an empty window and for an empty team list. The rows
        the reference reads are the eight columns the board's query selects, in id order: NO category column, as the board has always been.
     2. THE COST, on a book of 800,000 call-log rows (forty days of 20,000, 300 officers, 40 teams) and a week of 140,000: in the layout calls
        really have (a day together) and the worst a table can have (every row in a random place) the function reads fewer pages, takes less time
        and sends a fraction of the bytes of the page-by-page read the app used (ten thousand rows a page, the table's key as ORDER BY, each page
        running the query again), and the week is read through an index. The numbers are printed.
     3. THE FILE AS A FILE. It runs twice as one text, only service_role may call it, the landing line answers two numbers, the undo drops it.
     4. EVERY ONE of a list of deliberate breaks of the file makes a check fail (an SQL error alone does not count as caught).

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/call-board-rollup.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { boardRowsFromLogs } = await import('../../api/_lib/call-core.js');
const { teamMatchList } = await import('../../api/_lib/snapshots.js');
const FILE = fs.readFileSync(ROOT + '/db/RUN-ME-078-call-board-rollup.sql', 'utf8');
const DB = 'hope_callboard';
const admin = process.env.PGDATABASE || 'postgres';
const env = process.env;
const PIPES = ['pipe', 'pipe', 'pipe'];
const psqlTo = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 29, stdio: PIPES });
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const FAST = !!process.env.FAST;

const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const D0 = '2026-11-16';                                    // a Monday: the window is D0 .. D0 + 6
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const OFFICERS = ['Juma G', ' Juma G', 'Juma G ', 'juma g', 'JUMA G', '\tAmina K\n', '\u00a0Amina K', 'Amina K\u00a0', 'Steve', 'steve ', 'Vivian', 'Nathan\t', 'Mary  M', '', null, '   ', '(unknown)', 'Tt', 'Vv', '7', 'Neema\u3000', '\ufeffOmari', 'Zed\u2003', '\u202fZara', 'Yusuf\u1680', 'Wema\u200a', '\u205fXavier'];
const TEAMS = [null, '', 'T1', 'T2', 'T3', 't1', 'T1 ', 'Tunduru'];
const PHONES = [null, '', '0712000001', '0712 000 001', '0712000002', '255712000002', '0788000003', '0788000004', 'x', '0000'];
const REFS = [null, '', 'R1', 'R2', 'R3', 'R4'];
const DURS = [null, 0, 0, 3, 5, 30, 61, 600, -3];
const PORTS = [null, true, true, false, false, false];
const OUTS = [null, '', 'CONNECTED', 'MISSED', 'missed', ' blocked ', 'REJECTED', 'junk', 'NO ANSWER', 'BLOCKED'];
const CATS = [null, 'EXPECTED', 'DEFAULTER', 'expected', ' defaulter ', 'JUNK', ''];
const ID_CHARS = 'aAbBcC09_-zZ';
const makeBook = seed => {
  const rnd = mulberry32(seed); const int = (a, b) => a + Math.floor(rnd() * (b - a + 1)); const pick = a => a[int(0, a.length - 1)];
  const rows = []; const nOff = int(2, 6); const offs = Array.from({ length: nOff }, () => pick(OFFICERS));
  const n = int(8, 90);
  for (let i = 0; i < n; i++) {
    const id = ID_CHARS[int(0, ID_CHARS.length - 1)] + ID_CHARS[int(0, ID_CHARS.length - 1)] + i.toString(36);
    rows.push({ id, officer: pick(offs), team: pick(TEAMS), phone: pick(PHONES), ref: pick(REFS), duration: pick(DURS), portfolio: pick(PORTS),
      outcome: pick(OUTS), category: pick(CATS), call_date: addDays(D0, int(-2, 8)) });
  }
  return rows;
};
const insertSql = rows => 'truncate call_logs;\n' + (rows.length ? 'insert into call_logs (id, officer, team, phone, ref, duration, portfolio, outcome, category, call_date, direction) values\n'
  + rows.map(r => '(' + [q(r.id), q(r.officer), q(r.team), q(r.phone), q(r.ref), r.duration == null ? 'null' : r.duration, r.portfolio == null ? 'null' : r.portfolio,
    q(r.outcome), q(r.category), q(r.call_date), "'OUT'"].join(', ') + ')').join(',\n') + ';\n' : '');
const arr = a => a === null ? 'null' : 'array[' + a.map(q).join(', ') + ']::text[]';
const call = (from, to, day, teams) => `select call_board_rollup('${from}', '${to}', '${day}', ${arr(teams)})::text;`;
// what the app's query returns: the eight columns the board selects, no category, in id order, the team list as the DB filter (.in)
const refRows = teams => JSON.parse('[' + psqlTo(`select coalesce(string_agg(row_to_json(t)::text, ','), '') from (select officer, team, duration, portfolio, ref, phone, outcome, call_date from call_logs${teams ? ' where team = any (' + arr(teams) + ')' : ''} order by id) t;`, DB).trim() + ']');
const norm = rows => JSON.stringify(rows.map(r => Object.fromEntries(Object.keys(r).sort().map(k => [k, r[k]]))));
const both = (from, to, day, teams) => {
  const v = JSON.parse(psqlTo(call(from, to, day, teams), DB).trim());
  const rows = refRows(teams);
  // -Infinity: no minimum at all, which is the rule this file was written to (every dial that was not missed has reached its number).
  // Since 23 Nov 2026 the live function is db/RUN-ME-088's, held to the rule with the setting's minimum by tools/db-checks/reached-rule.mjs.
  return { sql: v, js: { w: boardRowsFromLogs(rows, from, to, -Infinity), t: boardRowsFromLogs(rows, day, day, -Infinity) } };
};

/* ---- 1. the answer ---- */
const answers = (seeds, fails) => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  for (const seed of seeds) {
    const rows = makeBook(seed);
    try { psqlTo(insertSql(rows), DB); } catch (e) { note('seed ' + seed + ': the book would not load: ' + String(e.stderr || e.message).split('\n')[0]); continue; }
    const to = addDays(D0, 6);
    const sets = [['admin', D0, to, addDays(D0, seed % 7), null], ['admin, day past the window', D0, to, addDays(D0, 9), null],
      ['teams T1', D0, to, addDays(D0, (seed + 3) % 7), teamMatchList(['T1'])], ['teams t1 + T2 ', D0, to, addDays(D0, (seed + 5) % 7), teamMatchList(['t1', 'T2 '])],
      ['empty team list', D0, to, D0, []], ['empty window', '2030-01-01', '2030-01-07', '2030-01-02', null]];
    for (const [label, from, toD, day, teams] of sets) {
      let r; try { r = both(from, toD, day, teams); } catch (e) { note('seed ' + seed + ' ' + label + ': the function raised an error: ' + String(e.stderr || e.message).split('\n')[0]); continue; }
      const tag = 'seed ' + seed + ' ' + label;
      if (!r.sql || typeof r.sql !== 'object' || Array.isArray(r.sql) || JSON.stringify(Object.keys(r.sql).sort()) !== '["t","w"]') { note(tag + ': the value is not {"w": [...], "t": [...]}'); continue; }
      if (!Array.isArray(r.sql.w) || !Array.isArray(r.sql.t)) { note(tag + ': a list is not an array (a quiet window must be [], never null)'); continue; }
      for (const k of ['w', 't']) if (norm(r.sql[k]) !== norm(r.js[k])) {
        const a = r.sql[k], b = r.js[k]; const i = a.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(b[j]));
        note(tag + ' list ' + k + ': differs from boardRowsFromLogs (' + a.length + ' officers against ' + b.length + '; first difference at ' + i + ': ' + JSON.stringify(a[i]) + ' against ' + JSON.stringify(b[i]) + ')');
      }
    }
  }
};

/* ---- 2. the cost ---- */
const buffersOf = text => { const m = text.match(/Buffers: shared ([^\n]*)/); if (!m) return null; const g = k => { const x = m[1].match(new RegExp(k + '=(\\d+)')); return x ? Number(x[1]) : 0; }; return g('hit') + g('read'); };
const timeOf = text => { const m = text.match(/Execution Time: ([0-9.]+) ms/); return m ? Number(m[1]) : null; };
const buildBigBook = layout => {
  psqlTo(`set jit = off;
truncate call_logs;
insert into call_logs (id, officer, team, phone, ref, duration, portfolio, outcome, category, call_date, call_time, direction)
select 'B' || d || '-' || i, 'Officer ' || (i % 300), 'TEAM' || (i % 40), '0' || (700000000 + (i * 37 + d) % 30000)::text, 'R' || (i % 5000),
       case when i % 3 = 0 then 0 when i % 3 = 1 then 3 else 20 + i % 200 end, i % 2 = 0,
       case when i % 7 = 0 then 'MISSED' else 'CONNECTED' end, case when i % 4 = 0 then 'EXPECTED' else 'DEFAULTER' end,
       date '2026-10-12' + d, time '06:00' + (i % 600) * interval '1 minute', 'OUT'
from generate_series(0, 39) d cross join generate_series(1, 20000) i
${layout === 'random' ? 'order by random()' : 'order by d, i'};
vacuum analyze call_logs;`, DB);
};
const measure = () => {
  const from = '2026-11-14', to = '2026-11-20';           // the last seven days of the book (days 33..39)
  const one = sql => { const o = psqlTo('set jit = off;\nexplain (analyze, buffers, costs off, timing on) ' + sql + ';', DB); return { pages: buffersOf(o), ms: timeOf(o) }; };
  const bytes = sql => Number(psqlTo('select length((' + sql + ')::text)', DB).trim());
  // what the app sent before: fetchAll adds the table's key as the last ORDER BY (pageKeyFor: call_logs -> id), ten thousand rows a page, until a page is short
  const page = k => `select json_agg(t) from (select officer, team, duration, portfolio, ref, phone, outcome, call_date from call_logs where call_date >= '${from}' and call_date <= '${to}' order by id asc limit 10000 offset ${k}) t`;
  let pages = 0, ms = 0, by = 0, n = 0;
  for (let k = 0; ; k += 10000) { const r = one(page(k)); pages += r.pages; ms += r.ms; by += bytes(page(k)) || 0; n++; if (k >= 140000) break; }
  const fnSql = `select call_board_rollup('${from}', '${to}', '${to}', null)`;
  const f = one(fnSql); const fb = bytes(fnSql);
  const plan = psqlTo(`explain (costs off) select count(*) from call_logs where call_date >= '${from}' and call_date <= '${to}'`, DB);
  return { read: { pages, ms, bytes: by, statements: n }, fn: { pages: f.pages, ms: f.ms, bytes: fb }, plan };
};
const cost = (fails, report) => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  for (const layout of ['by day', 'random']) {
    buildBigBook(layout === 'random' ? 'random' : 'day');
    const m = measure();
    report.push(`${layout.padEnd(7)} page-by-page read (${m.read.statements} statements): ${m.read.pages} pages, ${m.read.ms.toFixed(0)} ms, ${(m.read.bytes / 1024 / 1024).toFixed(1)} MB | the function (one statement): ${m.fn.pages} pages, ${m.fn.ms.toFixed(0)} ms, ${(m.fn.bytes / 1024).toFixed(0)} KB`);
    if (!(m.fn.pages < m.read.pages)) note(layout + ': the function reads no fewer pages than the page-by-page read: ' + m.fn.pages + ' against ' + m.read.pages);
    if (!(m.fn.ms < m.read.ms)) note(layout + ': the function is not quicker than the page-by-page read: ' + m.fn.ms + ' against ' + m.read.ms + ' ms');
    if (!(m.fn.bytes * 20 <= m.read.bytes)) note(layout + ': the answer is not a twentieth of the bytes of the page-by-page read: ' + m.fn.bytes + ' against ' + m.read.bytes);
    if (!/Index|Bitmap/.test(m.plan)) note(layout + ': the week is not read through an index:\n' + m.plan);
  }
  // the big book also answers: 300 officers in the week, and the week's list agrees with the reference on the same rows
  const r = both('2026-11-14', '2026-11-20', '2026-11-20', null);
  if (norm(r.sql.w) !== norm(r.js.w) || norm(r.sql.t) !== norm(r.js.t)) note('on the big book the function and boardRowsFromLogs differ');
  report.push(`the big book: ${r.sql.w.length} officers in the week, ${r.sql.t.length} today, equal to boardRowsFromLogs`);
};

/* ---- 3. the file as a file ---- */
const asFile = fails => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  try { psqlTo(FILE, DB); psqlTo(FILE, DB); } catch (e) { note('the file did not run twice as one text: ' + String(e.stderr || e.message).split('\n')[0]); return; }
  const can = r => psqlTo(`select has_function_privilege('${r}', 'call_board_rollup(date, date, date, text[])', 'execute')`, DB).trim();
  if (can('service_role') !== 't') note('service_role cannot call the function');
  for (const r of ['anon', 'authenticated', 'public']) if (can(r) !== 'f') note(r + ' can call the function');
  const landed = psqlTo(FILE, DB).trim().split('\n').pop();
  if (!/^\d+\t\d+$/.test(landed)) note('the "did it land" line does not answer two numbers: ' + landed);
  if (!/END OF THE SCRIPT/.test(FILE.split('\n').filter(Boolean).pop())) note('the file does not end with its END line');
  const undo = (FILE.match(/-- UNDO, alone: (drop function if exists [^\n]*;)/) || [])[1];
  if (!undo) note('the undo line is not in the file');
  else {
    try { psqlTo(undo, DB); } catch (e) { note('the undo failed: ' + String(e.stderr || e.message).split('\n')[0]); }
    if (psqlTo("select count(*) from pg_proc where proname = 'call_board_rollup'", DB).trim() !== '0') note('the undo left the function behind');
    psqlTo(FILE, DB);
  }
};

const all = (s, from, to) => s.split(from).join(to);
const BREAKS = [
  ['category counts (portfolio calls split by it)', s => {
    let t = once(s, "c.team as raw_team, coalesce(c.team, '') as team,", "c.category as category, c.team as raw_team, coalesce(c.team, '') as team,"); if (t === null) return null;
    t = once(t, "select officer, call_date, team, portfolio, phone, sum(duration) as dur", "select officer, call_date, team, portfolio, category, phone, sum(duration) as dur"); if (t === null) return null;
    t = once(t, "group by officer, call_date, team, portfolio, phone\n)", "group by officer, call_date, team, portfolio, category, phone\n)"); if (t === null) return null;
    t = once(t, "select officer, call_date, team, portfolio, count(*) as n", "select officer, call_date, team, portfolio, category, count(*) as n"); if (t === null) return null;
    return once(t, "from byphone\ngroup by officer, call_date, team, portfolio\n)", "from byphone\ngroup by officer, call_date, team, portfolio, category\n)");
  }],
  ['a team that is null and one that is empty are two groups', "coalesce(c.team, '') as team,", 'c.team as team,'],
  ['officer is not trimmed', "coalesce(nullif(btrim(c.officer, p.ws), ''), '(unknown)')", "coalesce(nullif(c.officer, ''), '(unknown)')"],
  ['officer is trimmed of spaces only', 'btrim(c.officer, p.ws)', 'btrim(c.officer)'],
  ['the vertical tab is written as the letter v', '\\x0b', '\\v'],
  ['a blank officer is a line of its own', "coalesce(nullif(btrim(c.officer, p.ws), ''), '(unknown)')", 'btrim(c.officer, p.ws)'],
  ['dials count numbers, not calls', 'count(*)::bigint as dials', 'count(distinct phone)::bigint as dials'],
  ['calls count rows (every redial)', "group by officer, call_date, team, portfolio, phone\n)", "group by officer, call_date, team, portfolio, phone, id\n)"],
  ['a number is one call for the whole window, not one a day', s => {
    const t = once(s, "select officer, call_date, team, portfolio, phone, sum(duration) as dur", "select officer, min(call_date) as call_date, team, portfolio, phone, sum(duration) as dur"); if (t === null) return null;
    return once(t, "group by officer, call_date, team, portfolio, phone\n)", "group by officer, team, portfolio, phone\n)");
  }],
  ['a number is reached only if EVERY call to it connected', 'bool_or(connected)', 'bool_and(connected)'],
  ['talk time is the longest call, not the sum', 'count(*) as n, sum(dur) as dur', 'count(*) as n, max(dur) as dur'],
  ['portfolio and other talk time swapped', s => {
    const t = once(s, "coalesce(sum(dur) filter (where portfolio), 0)::bigint as duration", 'coalesce(sum(dur) filter (where not portfolio), 0)::bigint as duration'); if (t === null) return null;
    return once(t, "coalesce(sum(dur) filter (where not portfolio), 0)::bigint as other_duration", 'coalesce(sum(dur) filter (where portfolio), 0)::bigint as other_duration');
  }],
  ['every call is a connected one', 'count(*) filter (where connected) as reached', 'count(*) as reached'],
  ['an outcome is matched in its own case', "upper(btrim(coalesce(c.outcome, ''), p.ws))", "btrim(coalesce(c.outcome, ''), p.ws)"],
  ['a customer is the phone only', s => all(s, "count(distinct coalesce(nullif(ref, ''), phone))", 'count(distinct phone)')],
  ['customers are counted over every call, not the portfolio', s => all(s, "filter (where portfolio))::bigint", ")::bigint")],
  ['the team is the last non-empty one', s => all(s, 'array_agg(raw_team order by id)', 'array_agg(raw_team order by id desc)')],
  ['officers are listed by name, not as they first appear', s => all(s, 'jsonb_agg(j order by first_id)', "jsonb_agg(j order by j->>'name')")],
  ['today\'s figures are the whole window\'s', "from dg\nwhere call_date = p_day\ngroup by officer", "from dg\ngroup by officer"],
  ['today\'s customers and dials are the whole window\'s', "from base\nwhere call_date = p_day\ngroup by officer\n)", "from base\ngroup by officer\n)"],
  ['the team list is ignored', 'and (p_teams is null or c.team = any (p_teams))', ''],
  ['the team list is matched in any case', 'c.team = any (p_teams)', 'upper(c.team) = any (select upper(t) from unnest(p_teams) t)'],
  ['a quiet window answers null', "coalesce((select jsonb_agg(j order by first_id) from rowsj where scope = 'w'), '[]'::jsonb)", "(select jsonb_agg(j order by first_id) from rowsj where scope = 'w')"],
  ['the last day of the window is left out', 'c.call_date <= p_to', 'c.call_date < p_to'],
  ['a null phone is no number at all', "coalesce(c.phone, '') as phone", 'c.phone as phone'],
  ['a null portfolio flag is a portfolio call', "coalesce(c.portfolio, false) as portfolio", "coalesce(c.portfolio, true) as portfolio"],
  ['anon may call it', 'from public, anon, authenticated;', 'from public;'],
  ['service_role may not call it', 'grant execute on function call_board_rollup(date, date, date, text[]) to service_role;', 'revoke execute on function call_board_rollup(date, date, date, text[]) from service_role;'],
];
const once = (text, from, to) => { const n = text.split(from).length - 1; if (n !== 1) return null; return text.replace(from, () => to); };
const reinstall = text => { psqlTo('drop function if exists call_board_rollup(date, date, date, text[])', DB); psqlTo(text, DB); };

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
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
-- the other call_logs indexes the repository's migrations make (idx_call_logs_date: 2026-08-01-storage-counts, idx_call_logs_user: RUN-ME-011)
create index if not exists idx_call_logs_date on call_logs(call_date); create index if not exists idx_call_logs_user on call_logs(user_id);`, DB);
// The real table's checks allow only the four outcomes and the two categories, written exactly. The app reads them without regard to case or
// blanks (K() in call-core.js), so the generator also writes the variants a book WITHOUT those checks could hold: the two checks are dropped here
// on purpose, and nothing else about the table is changed.
psqlTo('alter table call_logs drop constraint if exists call_logs_outcome_check, drop constraint if exists call_logs_category_check;', DB);
psqlTo(FILE, DB);
answers(Array.from({ length: FAST ? 25 : 150 }, (_, i) => 1 + i), fails);
asFile(fails);
if (!process.env.NOCOST) cost(fails, report);
console.log(report.join('\n'));
console.log(fails.length ? 'FAIL on the file as it is:\n  ' + fails.join('\n  ') : 'the file does what it says: the answer, the cost, the file as a file.');
let bad = fails.length ? 1 : 0;

/* ---- 4. deliberate breaks: every one must make a check fail ---- */
if (!process.env.NOBREAKS && !fails.length) {
  const broken = [];
  for (const [name, a, b] of BREAKS) {
    let mutated; try { mutated = typeof a === 'function' ? a(FILE) : once(FILE, a, b); } catch { mutated = null; }
    if (mutated === null || mutated === FILE) { broken.push([name, 'BAD BREAK: its text is not in the file exactly once']); bad = 1; continue; }
    const f = [];
    try { reinstall(mutated); } catch (e) { broken.push([name, 'NOT A BREAK: it does not run (' + String(e.stderr || e.message).split('\n')[0] + ')']); bad = 1; reinstall(FILE); continue; }
    // the small books cannot see a column that only a big book shows; the answers use 60 of them, the file-level checks run too
    answers(Array.from({ length: 60 }, (_, i) => 1 + i), f);
    const can = r => psqlTo(`select has_function_privilege('${r}', 'call_board_rollup(date, date, date, text[])', 'execute')`, DB).trim();
    if (can('service_role') !== 't') f.push('service_role cannot call it');
    if (can('anon') !== 'f' || can('authenticated') !== 'f') f.push('anon or authenticated can call it');
    reinstall(FILE);
    broken.push([name, f.length ? 'caught' : 'NOT CAUGHT']); if (!f.length) bad = 1;
  }
  for (const [name, res] of broken) console.log('  break: ' + name.padEnd(62) + ' ' + res);
  console.log(`${broken.filter(b => b[1] === 'caught').length} of ${broken.length} deliberate breaks caught`);
}
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
console.log('took ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(bad);
