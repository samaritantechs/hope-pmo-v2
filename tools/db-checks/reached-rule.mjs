/* REACHED MEANS SPOKEN TO -- db/RUN-ME-088, run for real on a PostgreSQL.

     "At calls slide in presentation "REACHED %" Should be percentage of connected calls against calls not just dialled b/se some ring
      but dont get connected" -- the owner, 23 Nov 2026 (handbook Part 137)

   The file replaces call_report_rollup (db/RUN-ME-042: Ripoti, the Calls tab, the phone's report) and call_board_rollup (db/RUN-ME-078: the
   Presentation's calls slide) IN PLACE and adds call_min_secs(). People are judged on these figures, so the SQL is not believed on a reading:
   it is held to the ONE definition in JavaScript (outcomeOf, callRollupRows, boardRowsFromLogs and callMinSecsOf in api/_lib/call-core.js) on
   random books, in a scratch database made from the WHOLE of db/schema.sql, with RUN-ME-042 and RUN-ME-078 run first as the live book has
   them and the file run exactly as the owner runs it. It passes only when:
     0. BEFORE THE FILE the two functions answer with NO mark (no "min" on the board, no 'MIN:n' on a number row), which is how the app
        tells that Reached must not be shown (reachOf_).
     1. THE SETTING. call_min_secs() equals callMinSecsOf for every way the cell can be written (missing, empty, words, digits with
        letters, a decimal point, a minus, leading noughts, a number too long for an integer).
     2. THE BOARD. On random books under every such setting, call_board_rollup's two lists equal boardRowsFromLogs(rows, from, to, min),
        exactly and in order, for the admin, a team list and an empty window, and "min" is the setting's number.
     3. THE REPORT. call_report_rollup's rows equal callRollupRows(rows, by user, min) as a set, each number row marked 'MIN:<min>', and
        reachOf_ reads the mark back.
     4. THE FILE AS A FILE. It runs twice as one text; only service_role may call the board; its answer is seven lines, the first the
        minimum and the last not MISSING; it ends with its END line; it is plain text under 10,000 characters, flush-left; running
        RUN-ME-042 and RUN-ME-078 again (the undo) puts the old answers back; and run ALONE on a book that never had those two files it
        answers the same and keeps anon out by its own revoke.
     5. THE COST. On a book of 800,000 call-log rows the two functions touch no more pages after the file than before it (a handful for
        the settings cell), and take about the same time, measured on a connection that has made the call before (as the API's pooled
        connections have); what the first call of a new connection adds is printed beside it. The numbers are printed.
     6. EVERY ONE of a list of deliberate breaks of the file makes a check fail.

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/reached-rule.mjs        (FAST=1 for fewer books, NOCOST=1, NOBREAKS=1,
                                                                                                  ONLY='words' for the breaks whose name holds them)

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { boardRowsFromLogs, callRollupRows, callMinSecsOf, reachOf_, reachMark, NO_ANSWER } = await import('../../api/_lib/call-core.js');
const { teamMatchList } = await import('../../api/_lib/snapshots.js');
const FILE = fs.readFileSync(ROOT + '/db/RUN-ME-088-reached-is-a-conversation.sql', 'utf8');
const F042 = fs.readFileSync(ROOT + '/db/RUN-ME-042-call-counting-rule.sql', 'utf8');
const F078 = fs.readFileSync(ROOT + '/db/RUN-ME-078-call-board-rollup.sql', 'utf8');
const DB = 'hope_reached';
const admin = process.env.PGDATABASE || 'postgres';
const env = process.env;
const psqlTo = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['pipe', 'pipe', 'pipe'] });
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const FAST = !!process.env.FAST;
const errLine = e => String(e.stderr || e.message).split('\n').find(l => /ERROR/.test(l)) || String(e.stderr || e.message).split('\n')[0];

const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const D0 = '2026-11-16';                                    // a Monday: the window is D0 .. D0 + 6
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/* Every way the setting's cell can be written, and what must be read from it (undefined = no row at all). Each book is counted under one of them. */
const SETTINGS = [undefined, '5', '0', '10', ' 7s', 'abc', '', '3.5', '-4', '007', '60', '99999999999999999999999', '1', '4', '6', null];
const USERS = ['U1', 'U2', 'U3', 'U4', null];
const OFFICERS = ['Juma G', ' Juma G', 'juma g', 'Amina K', 'Steve', '', null, '(unknown)'];
const TEAMS = [null, 'T1', 'T2', 't1', 'T1 ', 'Tunduru'];   // null or a name, never both null and '': callRollupRows joins those two and RUN-ME-042 never did (not this file's matter)
const PHONES = [null, '', '0712000001', '0712 000 001', '0712000002', '0788000003', '0788000004', 'x'];
const REFS = [null, '', 'R1', 'R2', 'R3'];
/* The lengths that decide the rule sit on both sides of every minimum the settings above give (0, 1, 4, 5, 6, 7, 10, 35, 60), with null,
   nought and a negative one; so a ">" written ">=" or a minimum off by one changes an answer. */
const DURS = [null, 0, 0, 1, 2, 4, 5, 5, 6, 7, 8, 10, 11, 30, 35, 36, 60, 61, 600, -3];
const PORTS = [null, true, true, false];
const OUTS = [null, '', 'CONNECTED', 'CONNECTED', 'connected', 'MISSED', 'missed', ' blocked ', 'REJECTED', 'junk', 'BLOCKED'];
const CATS = [null, 'EXPECTED', 'DEFAULTER', 'expected', ' defaulter ', 'JUNK', ''];
const ID_CHARS = 'aAbBcC09_-zZ';
const makeBook = seed => {
  const rnd = mulberry32(seed); const int = (a, b) => a + Math.floor(rnd() * (b - a + 1)); const pick = a => a[int(0, a.length - 1)];
  const rows = []; const n = int(10, 90); const phones = Array.from({ length: int(2, 5) }, () => pick(PHONES));
  for (let i = 0; i < n; i++) {
    const id = ID_CHARS[int(0, ID_CHARS.length - 1)] + ID_CHARS[int(0, ID_CHARS.length - 1)] + i.toString(36);
    const u = pick(USERS);
    rows.push({ id, user_id: u, officer: pick(OFFICERS), team: pick(TEAMS), phone: pick(phones), ref: pick(REFS), duration: pick(DURS), portfolio: pick(PORTS),
      outcome: pick(OUTS), category: pick(CATS), call_date: addDays(D0, int(-1, 7)) });
  }
  return rows;
};
const insertSql = rows => 'truncate call_logs;\n' + (rows.length ? 'insert into call_logs (id, user_id, officer, team, phone, ref, duration, portfolio, outcome, category, call_date, direction) values\n'
  + rows.map(r => '(' + [q(r.id), q(r.user_id), q(r.officer), q(r.team), q(r.phone), q(r.ref), r.duration == null ? 'null' : r.duration, r.portfolio == null ? 'null' : r.portfolio,
    q(r.outcome), q(r.category), q(r.call_date), "'OUT'"].join(', ') + ')').join(',\n') + ';\n' : '');
const setSetting = v => "delete from settings where key = 'CALL_MIN_SECS';\n" + (v === undefined ? '' : `insert into settings (key, value) values ('CALL_MIN_SECS', ${q(v)});\n`);
const arr = a => a === null ? 'null' : 'array[' + a.map(q).join(', ') + ']::text[]';
const jsonOf = sql => JSON.parse('[' + psqlTo(`select coalesce(string_agg(row_to_json(t)::text, ','), '') from (${sql}) t`, DB) + ']');
const norm = rows => JSON.stringify(rows.map(r => Object.fromEntries(Object.keys(r).sort().map(k => [k, r[k]]))));
// the eight columns the board's own query selects, in id order, the team list matched exactly (the .in() the board sends)
const boardRef = teams => jsonOf(`select officer, team, duration, portfolio, ref, phone, outcome, call_date from call_logs${teams ? ' where team = any (' + arr(teams) + ')' : ''} order by id`);
// the ten columns the report's row road selects, the window and the team list as the function reads them (any case)
const reportRef = (from, to, teams) => jsonOf(`select user_id, team, officer, call_date, duration, portfolio, category, outcome, ref, phone from call_logs where call_date >= '${from}' and call_date <= '${to}'${teams ? ' and upper(team) = any (select upper(t) from unnest(' + arr(teams) + ') t)' : ''} order by id`);
const boardSql = (from, to, day, teams) => JSON.parse(psqlTo(`select call_board_rollup('${from}', '${to}', '${day}', ${arr(teams)})::text;`, DB).trim());
const reportSql = (from, to, teams) => jsonOf(`select * from call_report_rollup('${from}', '${to}', ${arr(teams)})`);
const rowKey = r => JSON.stringify(['kind', 'day', 'user_id', 'team', 'category', 'outcome', 'portfolio', 'calls', 'dur', 'uniq'].map(k => (r[k] === undefined ? null : r[k])));
const asSet = rows => rows.map(rowKey).sort().join('\n');

/* ---- 1. the setting ---- */
const settingCheck = fails => {
  const note = m => { if (fails.length < 14) fails.push(m); };
  for (const v of SETTINGS.concat(['  12  ', 'sekunde 8', '0005', '2000000001', '2000000000', '1999999999', '9'.repeat(400), '\uFF15', 'five'])) {
    let got; try { got = psqlTo(setSetting(v) + 'select call_min_secs();', DB).trim(); } catch (e) { note('setting ' + JSON.stringify(v) + ': call_min_secs() raised: ' + errLine(e)); continue; }
    const want = String(callMinSecsOf(v === undefined ? null : v));
    if (got !== want) note('setting ' + JSON.stringify(v === undefined ? '(no row)' : String(v).slice(0, 30)) + ': the database reads ' + got + ', JavaScript ' + want);
  }
};

/* ---- 2 and 3. the board and the report ---- */
const answers = (seeds, fails, seen) => {
  const note = m => { if (fails.length < 14) fails.push(m); };
  for (const seed of seeds) {
    const rows = makeBook(seed), setting = SETTINGS[seed % SETTINGS.length], min = callMinSecsOf(setting === undefined ? null : setting);
    try { psqlTo(setSetting(setting) + insertSql(rows), DB); } catch (e) { note('seed ' + seed + ': the book would not load: ' + errLine(e)); continue; }
    const to = addDays(D0, 6);
    for (const [label, from, toD, day, teams] of [['admin', D0, to, addDays(D0, seed % 7), null], ['teams T1', D0, to, addDays(D0, (seed + 3) % 7), teamMatchList(['T1'])],
      ['empty window', '2030-01-01', '2030-01-07', '2030-01-02', null]]) {
      const tag = 'seed ' + seed + ' (minimum ' + min + ') ' + label;
      let b; try { b = boardSql(from, toD, day, teams); } catch (e) { note(tag + ': the board raised: ' + errLine(e)); continue; }
      if (!b || typeof b !== 'object' || JSON.stringify(Object.keys(b).sort()) !== '["min","t","w"]') { note(tag + ': the board\'s value is not {"w", "t", "min"}: ' + JSON.stringify(Object.keys(b || {}))); continue; }
      if (b.min !== min) note(tag + ': the board says its minimum is ' + JSON.stringify(b.min) + ', the setting reads ' + min);
      const ref = boardRef(teams), js = { w: boardRowsFromLogs(ref, from, toD, min), t: boardRowsFromLogs(ref, day, day, min) };
      for (const k of ['w', 't']) if (norm(b[k]) !== norm(js[k])) {
        const i = b[k].findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(js[k][j]));
        note(tag + ' board list ' + k + ': differs from boardRowsFromLogs (first difference at ' + i + ': ' + JSON.stringify(b[k][i]) + ' against ' + JSON.stringify(js[k][i]) + ')');
      }
      if (seen) { seen.reachedLess += js.w.some(x => x.connected < boardRowsFromLogs(ref, from, toD, -Infinity).find(y => y.name === x.name).connected) ? 1 : 0; seen.boards++; }
      let r; try { r = reportSql(from, toD, teams); } catch (e) { note(tag + ': the report raised: ' + errLine(e)); continue; }
      const jr = callRollupRows(reportRef(from, toD, teams), undefined, min);
      if (asSet(r) !== asSet(jr)) {
        const A = new Set(r.map(rowKey)), B = new Set(jr.map(rowKey));
        note(tag + ' report: differs from callRollupRows (' + r.length + ' rows against ' + jr.length + '; only in the database: ' + ([...A].find(x => !B.has(x)) || 'none') + '; only in JavaScript: ' + ([...B].find(x => !A.has(x)) || 'none') + ')');
      }
      const d = r.filter(x => x.kind === 'd');
      if (d.some(x => x.outcome !== reachMark(min))) note(tag + ' report: a number row is not marked ' + reachMark(min) + ': ' + JSON.stringify((d.find(x => x.outcome !== reachMark(min)) || {}).outcome));
      const rc = reachOf_(r);
      if (!rc.known || (d.length && rc.min !== min)) note(tag + ' report: reachOf_ reads ' + JSON.stringify(rc) + ' from the rows');
      if (seen && r.some(x => x.kind === 'g' && x.outcome === NO_ANSWER)) seen.noAnswer++;
    }
  }
};

/* ---- 4. the file as a file ---- */
const canCall = r => psqlTo(`select has_function_privilege('${r}', 'call_board_rollup(date, date, date, text[])', 'execute')`, DB).trim();
/* A BOOK THAT NEVER HAD THE TWO EARLIER FILES: the three functions are dropped and the text is run alone, so the grants it ends with are
   the ones IT gives. (On the live book RUN-ME-078 already took anon off the board, and "create or replace" keeps a function's grants: run
   after RUN-ME-078, a copy of this file with its revoke taken out would still look safe. The first form of this check did exactly that and
   let that break through.) */
const DROP3 = 'drop function if exists call_board_rollup(date, date, date, text[]); drop function if exists call_report_rollup(date, date, text[]); drop function if exists call_min_secs();';
const installFresh = text => { psqlTo(DROP3, DB); psqlTo(text, DB); };
const asFile = fails => {
  const note = m => { if (fails.length < 14) fails.push(m); };
  if (!(FILE.length < 10000)) note('the file is ' + FILE.length + ' characters: over what one paste is trusted with');
  if (FILE.split('\n').some(l => /^\s/.test(l))) note('a line of the file starts with a blank');
  if (/[^\x09\x0A\x20-\x7E]/.test(FILE)) note('the file holds a character that is not plain text');
  if (!/^-- END OF RUN-ME-088$/.test(FILE.split('\n').filter(Boolean).pop())) note('the file does not end with its END line');
  let out; try { psqlTo(FILE, DB); out = psqlTo(FILE, DB).trim().split('\n'); } catch (e) { note('the file did not run twice as one text: ' + errLine(e)); return; }
  if (out.length !== 7) note('the answer is not seven lines: ' + out.length);
  if (!/^minimum seconds \(the setting\)\t\d+$/.test(out[0] || '')) note('the first line of the answer is not the minimum: ' + out[0]);
  if (!/^the calls slide answers with its minimum\t\d+$/.test(out[6] || '')) note('the last line of the answer does not carry the board\'s minimum: ' + out[6]);
  if (canCall('service_role') !== 't') note('service_role cannot call the board');
  for (const r of ['anon', 'authenticated', 'public']) if (canCall(r) !== 'f') note(r + ' can call the board');
  // the undo: the two earlier files again put the old answers back (no mark), and the file again puts the rule back
  try {
    psqlTo(setSetting('5') + insertSql(makeBook(7)), DB);
    psqlTo(F042, DB); psqlTo(F078, DB);
    const b = boardSql(D0, addDays(D0, 6), D0, null), r = reportSql(D0, addDays(D0, 6), null);
    if ('min' in b) note('after the undo the board still carries "min"');
    if (reachOf_(r).known && r.some(x => x.kind === 'd')) note('after the undo the report\'s number rows still read as marked');
    psqlTo(FILE, DB);
    if (!('min' in boardSql(D0, addDays(D0, 6), D0, null))) note('the file run after the undo did not put the rule back');
  } catch (e) { note('the undo, or the file after it, failed: ' + errLine(e)); }
  // and on a book that never had the two earlier files, the file alone answers and keeps anon out
  try {
    installFresh(FILE);
    if (!('min' in boardSql(D0, addDays(D0, 6), D0, null))) note('run alone on a fresh book the file does not answer with its minimum');
    if (canCall('service_role') !== 't') note('on a fresh book service_role cannot call the board');
    for (const r of ['anon', 'authenticated', 'public']) if (canCall(r) !== 'f') note('on a fresh book ' + r + ' can call the board');
  } catch (e) { note('the file did not run alone on a fresh book: ' + errLine(e)); }
};

/* ---- 5. the cost ---- */
const buffersOf = text => { const m = text.match(/Buffers: shared ([^\n]*)/); if (!m) return null; const g = k => { const x = m[1].match(new RegExp(k + '=(\\d+)')); return x ? Number(x[1]) : 0; }; return g('hit') + g('read'); };
const timeOf = text => { const m = text.match(/Execution Time: ([0-9.]+) ms/); return m ? Number(m[1]) : null; };
const cost = (fails, report) => {
  const note = m => { if (fails.length < 14) fails.push(m); };
  psqlTo(`set jit = off;
truncate call_logs;
${setSetting('5')}
insert into call_logs (id, officer, team, phone, ref, duration, portfolio, outcome, category, call_date, call_time, direction)
select 'B' || d || '-' || i, 'Officer ' || (i % 300), 'TEAM' || (i % 40), '0' || (700000000 + (i * 37 + d) % 30000)::text, 'R' || (i % 5000),
       case when i % 3 = 0 then 0 when i % 3 = 1 then 3 else 20 + i % 200 end, i % 2 = 0,
       case when i % 7 = 0 then 'MISSED' else 'CONNECTED' end, case when i % 4 = 0 then 'EXPECTED' else 'DEFAULTER' end,
       date '2026-10-12' + d, time '06:00' + (i % 600) * interval '1 minute', 'OUT'
from generate_series(0, 39) d cross join generate_series(1, 20000) i
order by d, i;
vacuum analyze call_logs;`, DB);
  const from = '2026-11-14', to = '2026-11-20';
  /* Measured on a connection that has ALREADY made the call once, as the API's pooled connections have: the first call of a session
     reads the catalogue to plan the statements inside the function (about a hundred pages, once for each connection, whatever the
     function), which says nothing about what a call costs. `fresh` is that first call, printed so the one-time cost is seen too. */
  const one = sql => {
    const fresh = buffersOf(psqlTo('set jit = off;\nexplain (analyze, buffers, costs off, timing on) ' + sql + ';', DB));
    const runs = [1, 2, 3].map(() => psqlTo('set jit = off;\n' + sql + ';\nexplain (analyze, buffers, costs off, timing on) ' + sql + ';', DB));
    return { pages: buffersOf(runs[2]), ms: Math.min(...runs.map(timeOf)), fresh };
  };
  const B = `select call_board_rollup('${from}', '${to}', '${to}', null)`, R = `select count(*) from call_report_rollup('${from}', '${to}', null)`;
  psqlTo(F042, DB); psqlTo(F078, DB);
  const b0 = one(B), r0 = one(R), old = boardSql(from, to, to, null);
  psqlTo(FILE, DB);
  const b1 = one(B), r1 = one(R), now = boardSql(from, to, to, null);
  const sum = (v, k) => v.w.reduce((s, x) => s + x[k], 0);
  report.push(`the week of 140,000 calls on a book of 800,000: the board ${b0.pages} pages, ${b0.ms.toFixed(0)} ms before; ${b1.pages} pages, ${b1.ms.toFixed(0)} ms after | the report ${r0.pages} pages, ${r0.ms.toFixed(0)} ms before; ${r1.pages} pages, ${r1.ms.toFixed(0)} ms after`);
  report.push(`the first call of a new connection (the catalogue is read once to plan it): the board ${b0.fresh} pages before, ${b1.fresh} after | the report ${r0.fresh} before, ${r1.fresh} after`);
  report.push(`on that book: ${sum(now, 'calls')} numbers rung; reached ${sum(old, 'connected')} by the rule as it was (${(100 * sum(old, 'connected') / sum(old, 'calls')).toFixed(1)}%), ${sum(now, 'connected')} by the rule now (${(100 * sum(now, 'connected') / sum(now, 'calls')).toFixed(1)}%)`);
  if (!(b1.pages <= b0.pages + 20)) note('the board touches more pages after the file: ' + b1.pages + ' against ' + b0.pages);
  if (!(r1.pages <= r0.pages + 20)) note('the report touches more pages after the file: ' + r1.pages + ' against ' + r0.pages);
  if (!(b1.ms <= b0.ms * 1.5 + 50)) note('the board is slower after the file: ' + b1.ms + ' against ' + b0.ms + ' ms');
  if (!(r1.ms <= r0.ms * 1.5 + 50)) note('the report is slower after the file: ' + r1.ms + ' against ' + r0.ms + ' ms');
  if (!(sum(now, 'connected') < sum(old, 'connected'))) note('on the big book the rule reaches no fewer numbers than the old one: the book does not show the difference');
};

/* ---- 6. deliberate breaks: every one must make a check fail ---- */
const once = (text, from, to) => { const n = text.split(from).length - 1; if (n !== 1) return null; return text.replace(from, () => to); };
const BREAKS = [
  ['the board: a call of exactly the minimum has reached its number', 'and coalesce(c.duration, 0) > m.min as connected', 'and coalesce(c.duration, 0) >= m.min as connected'],
  ['the report: a dial of exactly the minimum is CONNECTED', "when coalesce(duration, 0) > m.min then 'CONNECTED'", "when coalesce(duration, 0) >= m.min then 'CONNECTED'"],
  ['the board keeps the rule as it was (every dial not missed has reached)', ' and coalesce(c.duration, 0) > m.min as connected', ' as connected'],
  ['the report keeps the rule as it was (no NO ANSWER)', "else 'NO ANSWER' end as outcome", "else 'CONNECTED' end as outcome"],
  ['the report spells the new outcome another way', "else 'NO ANSWER' end as outcome", "else 'NOANSWER' end as outcome"],
  ['the report\'s number rows carry no mark', "'MIN:' || (select min from m), portfolio,", 'null, portfolio,'],
  ['the report\'s mark is not the minimum it counted by', "'MIN:' || (select min from m), portfolio,", "'MIN:5', portfolio,"],
  ['the board does not say its minimum', ",\n'min', (select min from m));", ');'],
  ['the board says a minimum it did not count by', "'min', (select min from m));", "'min', 5);"],
  ['no setting reads six seconds', "::numeric, 5), 2000000000)::integer;", "::numeric, 6), 2000000000)::integer;"],
  ['no setting reads the ceiling (least() skips an empty value: the first form of this file did exactly this)', s => {
    const t = once(s, "select least(coalesce(nullif(", "select coalesce(least(nullif("); if (t === null) return null;
    return once(t, "::numeric, 5), 2000000000)::integer;", "::numeric, 2000000000), 5)::integer;");
  }],
  ['a decimal point is kept when the setting is read', "'[^0-9]', '', 'g'", "'[^0-9.]', '', 'g'"],
  ['a setting too long for an integer is not held down', "::numeric, 5), 2000000000)::integer;", "::numeric, 5), 99999999999999999999999999)::integer;"],
  ['another setting is read', "where s.key = 'CALL_MIN_SECS'", "where s.key = 'CALL_SYNC_SECONDS'"],
  ['the report: a number is reached once for every connected dial', "(count(distinct phone) filter (where outcome = 'CONNECTED'))::bigint", "(count(*) filter (where outcome = 'CONNECTED'))::bigint"],
  ['the board: a number is reached only if every dial to it was a conversation', 'bool_or(connected)', 'bool_and(connected)'],
  ['the report: a MISSED call that lasted is CONNECTED', "in ('MISSED', 'REJECTED', 'BLOCKED') then upper(btrim(outcome))", "in ('REJECTED', 'BLOCKED') then upper(btrim(outcome))"],
  ['the board: a MISSED call that lasted has reached', "not in ('MISSED', 'REJECTED', 'BLOCKED') and", "not in ('REJECTED', 'BLOCKED') and"],
  ['the report: a number is reached by its dials\' talk time together', s => {
    const t = once(s, "when coalesce(duration, 0) > m.min then 'CONNECTED'", "when sum(coalesce(duration, 0)) over (partition by call_date, user_id, team, phone) > m.min then 'CONNECTED'");
    return t;
  }],
  ['anon may call the board', 'from public, anon, authenticated;', 'from public;'],
  ['service_role may not call the board', 'grant execute on function call_board_rollup(date, date, date, text[]) to service_role;', 'revoke execute on function call_board_rollup(date, date, date, text[]) from service_role;'],
];

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
create index if not exists idx_call_logs_date on call_logs(call_date); create index if not exists idx_call_logs_user on call_logs(user_id);
insert into call_users (user_id, name) values ('U1', 'One'), ('U2', 'Two'), ('U3', 'Three'), ('U4', 'Four');
-- the real table's two checks allow only what the phone's sync writes; the app reads the cells without regard to case or blanks, so the books
-- also hold the variants a table without those checks could: the two checks are dropped here on purpose, and nothing else is changed
alter table call_logs drop constraint if exists call_logs_outcome_check, drop constraint if exists call_logs_category_check;`, DB);
psqlTo(F042, DB); psqlTo(F078, DB);

/* ---- 0. before the file: no mark, which is how the app tells ---- */
{
  psqlTo(setSetting('5') + insertSql(makeBook(3)), DB);
  const b = boardSql(D0, addDays(D0, 6), D0, null), r = reportSql(D0, addDays(D0, 6), null);
  if ('min' in b) fails.push('before the file the board already carries "min": the app could not tell the old answer from the new');
  if (!r.some(x => x.kind === 'd')) fails.push('the book of seed 3 has no number row: the check of the old answer saw nothing');
  if (reachOf_(r).known) fails.push('before the file reachOf_ reads the old number rows as marked');
  if (r.some(x => x.kind === 'g' && x.outcome === NO_ANSWER)) fails.push('before the file an outcome already reads NO ANSWER');
}
psqlTo(FILE, DB);
const seen = { noAnswer: 0, reachedLess: 0, boards: 0 };
settingCheck(fails);
answers(Array.from({ length: FAST ? 32 : 160 }, (_, i) => 1 + i), fails, seen);
if (!(seen.noAnswer > 20 && seen.reachedLess > 20)) fails.push('the books do not show the rule at work: NO ANSWER seen in ' + seen.noAnswer + ' reports, fewer numbers reached than by the old rule on ' + seen.reachedLess + ' of ' + seen.boards + ' boards');
asFile(fails);
if (!process.env.NOCOST) cost(fails, report);
console.log(report.join('\n'));
console.log('the rule at work on the random books: NO ANSWER in ' + seen.noAnswer + ' reports; fewer numbers reached than by the old rule on ' + seen.reachedLess + ' of ' + seen.boards + ' boards');
console.log(fails.length ? 'FAIL on the file as it is:\n  ' + fails.join('\n  ') : 'the file does what it says: the setting, the board, the report, the file as a file, the cost.');
let bad = fails.length ? 1 : 0;

if (!process.env.NOBREAKS && !fails.length) {
  const broken = [];
  const install = installFresh;                                              // each broken copy is run alone on a fresh book: its own grants, its own bodies
  for (const [name, a, b] of BREAKS.filter(x => !process.env.ONLY || x[0].includes(process.env.ONLY))) {
    let mutated; try { mutated = typeof a === 'function' ? a(FILE) : once(FILE, a, b); } catch { mutated = null; }
    if (mutated === null || mutated === FILE) { broken.push([name, 'BAD BREAK: its text is not in the file exactly once']); bad = 1; continue; }
    const f = [];
    try { install(mutated); } catch (e) { broken.push([name, 'NOT A BREAK: it does not run (' + errLine(e) + ')']); bad = 1; install(FILE); continue; }
    settingCheck(f);
    answers(Array.from({ length: 64 }, (_, i) => 1 + i), f, null);
    if (canCall('service_role') !== 't') f.push('service_role cannot call the board');
    if (canCall('anon') !== 'f' || canCall('authenticated') !== 'f') f.push('anon or authenticated can call the board');
    install(FILE);
    broken.push([name, f.length ? 'caught' : 'NOT CAUGHT']); if (!f.length) bad = 1;
  }
  for (const [name, res] of broken) console.log('  break: ' + name.padEnd(78) + ' ' + res);
  console.log(`${broken.filter(b => b[1] === 'caught').length} of ${broken.length} deliberate breaks caught`);
}
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
console.log('took ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(bad);
