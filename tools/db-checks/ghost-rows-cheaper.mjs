/* THE GHOST-ROWS FUNCTION AND ITS INDEX -- db/RUN-ME-075 and db/RUN-ME-076, run for real on a PostgreSQL.

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026

   db/RUN-ME-075 replaces defaulter_ghost_rows (RUN-ME-055), the function every Exp.Def list, the phone's Exp.Def list and Expected Defaulters
   ask for the customers who left the book. db/RUN-ME-076 adds an index on the current rows. Both run on the owner's live book by hand, so neither is believed on a reading.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, the index of RUN-ME-055 section 2, and the FIRST text of the function (RUN-ME-055 section 3) installed
   beside the new one as ghost_orig. The fixture knows the truth and is built to hit the edges: the same customer in two teams, customers with initial rows only, a customer whose newest row
   overall is an initial one, a day uploaded twice, quoting in a team name, known refs the book does not hold.

   It passes only when:
     1. THE ANSWERS. On random books (a seeded generator, 250 of them) and on hand-made ones, the new function, the first text and a MODEL written again in JavaScript return the same rows (team, ref, day and
        arrears of each, and the whole row from the two functions), for the team lists and known-ref lists a caller sends (all teams, a subset with a duplicate, one team, the real deck of the latest day).
        Where a team lists twice both return its rows twice. Two rows with the very same day and time: exactly one comes back, one of the two. The two inputs the app never sends (a NULL known list, a NULL
        inside it) are PINNED to what they do, so that a change is seen: the first text returns nothing, the new one every candidate.
     2. THE PAGES (buffers touched, hits and reads together: the number a cold disk is paid in). On a book laid out the worst way (every row in a random place; sixty teams, none more than about 2% of the table as on the live
        book; four teams with 30 days of history for each customer, four with 110), the lookup of a departed customer's newest current row costs pages in proportion to how long the customer stood on the decks WITHOUT the
        index (110 days against 30: at least twice) and does NOT with it (at most 1.4 times), and with the index the same call reads at least four times fewer pages. The first text's pages are printed and not asserted: they
        depend on the plan the planner picks for it, which depends on how much of the table the team list covers (RUN-ME-075 saves CPU, not pages: handbook Part 114).
     3. THE INDEX FILE. Its first statement runs alone as ONE statement (CONCURRENTLY is refused in a transaction block), builds a valid partial index of exactly the definition the file says, is harmless when run
        again, the planner names it for the lookup with no Sort node, its section 2 says valid, and its undo drops it.
     4. THE COST TO THE UPLOAD. Inserting a deck day (20,000 rows, half of them current) with and without the index, median of five interleaved runs, is printed, and must not be more than twice.
     5. EVERY ONE of a list of deliberate breaks of the two files makes a check fail (an SQL error alone does not count as caught).

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/ghost-rows-cheaper.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the files did what they say, and failed when broken. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = p => fs.readFileSync(ROOT + '/' + p, 'utf8');
const F075 = read('db/RUN-ME-075-defaulter-ghost-rows-cheaper.sql');
const F055 = read('db/RUN-ME-055-defaulter-ghosts.sql');
const F076 = read('db/RUN-ME-076-defaulter-snapshots-current-last-index.sql');
const DB = 'hope_ghostrows';
const admin = process.env.PGDATABASE || 'postgres';
const env = process.env;
const PIPES = ['pipe', 'pipe', 'pipe'];
const psqlTo = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES });
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const arr = list => list === null ? 'null::text[]' : list.length ? 'array[' + list.map(q).join(', ') + ']::text[]' : "'{}'::text[]";
const FAST = !!process.env.FAST;

/* ---- the two files' own statements, taken out of the files ---- */
const section3Of055 = () => {
  const i = F055.indexOf('create or replace function defaulter_ghost_rows(');
  const j = F055.indexOf('$$;', F055.indexOf('$$', i + 200)) + 3;
  return F055.slice(i, j).replace('create or replace function defaulter_ghost_rows(', 'create or replace function ghost_orig(');
};
const TEAM_REF_INDEX = (F055.match(/create index concurrently if not exists idx_def_snap_team_ref[^;]*;/) || [''])[0];
const sectionOf076 = (text, n) => { const m = text.match(new RegExp('-- SECTION ' + n + '[^\\n]*\\n((?:-- [^\\n]*\\n)*)(?:--[^\\n]*\\n)*?([^\\n-][^\\n]*;)\\n')); return m ? m[2] : ''; };
const INDEX_NAME = 'idx_def_snap_current_last';
const INDEX_DEF = "CREATE INDEX idx_def_snap_current_last ON public.defaulter_snapshots USING btree (team, ref, snapshot_date DESC, created_at DESC) WHERE (snapshot_type = 'current'::text)";

/* ---- a seeded generator and the model ---- */
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const COLS = 'ref, full_name, contact, guarantor_name, guarantor_contact, team, arrears, balance, status, ds, dc, days_elapsed, disb_date, chronic_date, expire_date, other_inst, snapshot_type, snapshot_date, created_at';
const rowSql = r => '(' + [q(r.ref), q(r.full_name), q(r.contact), q(r.guarantor_name), q(r.guarantor_contact), q(r.team), r.arrears, r.balance, q(r.status), q(r.ds), r.dc, r.days_elapsed,
  q(r.disb_date), q(r.chronic_date), q(r.expire_date), r.other_inst, q(r.snapshot_type), q(r.snapshot_date), q(r.created_at)].join(', ') + ')';
const insertSql = (teams, rows) => 'truncate defaulter_snapshots, teams cascade;\ninsert into teams (team) values ' + teams.map(t => '(' + q(t) + ')').join(', ') + ';\n'
  + (rows.length ? 'insert into defaulter_snapshots (' + COLS + ') values\n' + rows.map(rowSql).join(',\n') + ';\n' : '');
const DAY = n => '2026-11-' + String(1 + n).padStart(2, '0');
let counter = 0;
const mkRow = (team, ref, n, type, sec = 0) => {
  counter++;
  const t = Date.UTC(2026, 10, 1 + n, type === 'initial' ? 3 : 15, 0, 0) + (counter * 7 + sec) * 1000;
  return { ref, full_name: 'N' + counter, contact: counter % 5 ? '07' + counter : null, guarantor_name: counter % 3 ? 'G' + counter : null, guarantor_contact: null, team, arrears: counter * 10 + 1, balance: counter * 3,
    status: ['Chronic', 'Expired', 'Defaulter'][counter % 3], ds: '3/6', dc: counter % 4, days_elapsed: counter % 200, disb_date: '2026-06-01', chronic_date: counter % 2 ? '2026-10-01' : null, expire_date: '2026-09-01',
    other_inst: counter, snapshot_type: type, snapshot_date: DAY(n), created_at: new Date(t).toISOString() };
};
const keyOf = r => [r.team, r.ref, String(r.snapshot_date).slice(0, 10), Number(r.arrears)].join('|');
const model = (rows, teams, known) => {
  const k = new Set(known || []); const out = [];
  for (const t of teams) {
    const mine = rows.filter(r => r.team === t);
    for (const ref of [...new Set(mine.map(r => r.ref))]) {
      if (k.has(ref)) continue;
      const cur = mine.filter(r => r.ref === ref && r.snapshot_type === 'current');
      if (!cur.length) continue;
      cur.sort((a, b) => a.snapshot_date !== b.snapshot_date ? (a.snapshot_date < b.snapshot_date ? 1 : -1) : (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      out.push(keyOf(cur[0]));
    }
  }
  return out.sort();
};
const makeBook = seed => {
  const rnd = mulberry32(seed); const int = (a, b) => a + Math.floor(rnd() * (b - a + 1)); counter = seed * 1000;
  const TEAMS = ['TEAM A', 'TEAM B', "TEAM O'NEIL", 'TEAM  C', 'TEAM D'];
  const teams = TEAMS.slice(0, int(2, 5)); const rows = []; const refsOf = {};
  teams.forEach((t, ti) => {
    refsOf[t] = [];
    for (let i = 0; i < int(4, 12); i++) refsOf[t].push(rnd() < 0.5 ? 'R' + int(1, 99) + 'X' + ti : '42' + String(int(0, 99999999)).padStart(8, '0'));
    if (ti > 0 && rnd() < 0.7) refsOf[t].push(refsOf[teams[ti - 1]][0]);          // the same customer in two teams
    refsOf[t] = [...new Set(refsOf[t])];
    for (const ref of refsOf[t]) {
      const s = int(0, 7), e = int(s, 7);
      for (let n = s; n <= e; n++) {
        if (rnd() < 0.15) continue;
        const kind = rnd();
        if (kind < 0.6) { rows.push(mkRow(t, ref, n, 'initial'), mkRow(t, ref, n, 'current')); }
        else if (kind < 0.75) rows.push(mkRow(t, ref, n, 'current'));
        else if (kind < 0.85) rows.push(mkRow(t, ref, n, 'initial'));
        else { rows.push(mkRow(t, ref, n, 'current'), mkRow(t, ref, n, 'current', 400 + int(0, 50))); }      // a day uploaded twice
      }
    }
  });
  for (let i = rows.length - 1; i > 0; i--) { const j = int(0, i); [rows[i], rows[j]] = [rows[j], rows[i]]; }      // in no order: a tie must not be won by where the row was written
  const allRefs = [...new Set(rows.map(r => r.ref))];
  const teamOrder = [...teams].sort(() => rnd() - 0.5);
  const subset = teamOrder.slice(0, int(1, teamOrder.length)); if (rnd() < 0.4) subset.push(subset[0]);
  const someKnown = allRefs.filter(() => rnd() < 0.4).concat(['NOT IN THE BOOK'], allRefs.length ? [allRefs[0].toLowerCase() === allRefs[0] ? allRefs[0] + ' ' : allRefs[0].toLowerCase()] : []);
  const deck = ts => [...new Set(rows.filter(r => ts.includes(r.team) && r.snapshot_type === 'current' && r.snapshot_date === DAY(7)).map(r => r.ref))];
  const cases = [
    { teams: teams, known: [] }, { teams: subset, known: someKnown }, { teams: [teams[0]], known: deck([teams[0]]) }, { teams: teams, known: deck(teams) },
  ];
  return { teams, rows, cases };
};
const selectOf = (k, fn, c) => "select 'k" + k + "', '" + fn + "', t.team || '|' || t.ref || '|' || t.snapshot_date || '|' || t.arrears::bigint, row_to_json(t)::text from "
  + fn + '(' + arr(c.teams) + ', ' + arr(c.known) + ') t;\n';
const runBook = (book, fns) => {
  let sql = insertSql(book.teams, book.rows);
  book.cases.forEach((c, k) => { for (const fn of fns) sql += selectOf(k, fn, c); });
  const out = psqlTo(sql, DB).split('\n').filter(Boolean).map(l => l.split('\t'));
  const by = {};
  for (const [k, fn, key, json] of out) { const id = k.slice(1) + '|' + fn; (by[id] = by[id] || []).push({ key, json }); }
  return by;
};

/* ---- 1. the answers ---- */
const answers = (seeds, fails) => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  let withRows = 0;
  for (const seed of seeds) {
    const book = makeBook(seed); let by;
    try { by = runBook(book, ['ghost_orig', 'defaulter_ghost_rows']); } catch (e) { note('seed ' + seed + ': the function raised an error: ' + String(e.stderr || e.message).split('\n')[0]); continue; }
    book.cases.forEach((c, k) => {
      const want = model(book.rows, c.teams, c.known);
      const o = (by[k + '|ghost_orig'] || []).map(x => x.key).sort(), n = (by[k + '|defaulter_ghost_rows'] || []).map(x => x.key).sort();
      if (want.length) withRows++;
      if (JSON.stringify(o) !== JSON.stringify(want)) note('seed ' + seed + ' case ' + k + ': the FIRST text and the model differ (the check or the model is wrong)');
      if (JSON.stringify(n) !== JSON.stringify(want)) note('seed ' + seed + ' case ' + k + ': the new function answers ' + n.length + ' rows, the model ' + want.length);
      const oj = (by[k + '|ghost_orig'] || []).map(x => x.json).sort(), nj = (by[k + '|defaulter_ghost_rows'] || []).map(x => x.json).sort();
      if (JSON.stringify(oj) !== JSON.stringify(nj)) note('seed ' + seed + ' case ' + k + ': the whole rows of the two functions differ');
    });
  }
  if (withRows < seeds.length) note('the generator drew too few books with rows to answer: ' + withRows + ' of ' + seeds.length * 4);
};
const edges = fails => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  const one = (name, teams, rows, args, expectFn) => {
    counter = 777000;
    const built = rows(); const sql = insertSql(teams, built) + selectOf(0, 'ghost_orig', args) + selectOf(0, 'defaulter_ghost_rows', args);
    let out; try { out = psqlTo(sql, DB).split('\n').filter(Boolean).map(l => l.split('\t')); } catch (e) { note(name + ': error ' + String(e.stderr || e.message).split('\n')[0]); return; }
    const of = fn => out.filter(l => l[1] === fn).map(l => l[2]).sort();
    expectFn(of('ghost_orig'), of('defaulter_ghost_rows'), built, name);
  };
  const same = (want, name) => (o, n) => { if (JSON.stringify(o) !== JSON.stringify(want.slice().sort())) note(name + ': the first text answers ' + JSON.stringify(o)); if (JSON.stringify(n) !== JSON.stringify(want.slice().sort())) note(name + ': the new function answers ' + JSON.stringify(n) + ', wanted ' + JSON.stringify(want)); };
  const R = (t, ref, n, type, sec) => mkRow(t, ref, n, type, sec);
  // the same customer in two teams: each team's own newest row
  one('a customer in two teams', ['TEAM A', 'TEAM B'], () => [R('TEAM A', 'X1', 5, 'current'), R('TEAM B', 'X1', 3, 'current'), R('TEAM B', 'X1', 2, 'current')], { teams: ['TEAM B'], known: [] },
    (o, n, rows, name) => same([keyOf(rows[1])], name)(o, n));
  // initial rows only: nothing
  one('a customer with initial rows only', ['TEAM A'], () => [R('TEAM A', 'X2', 4, 'initial'), R('TEAM A', 'X2', 5, 'initial')], { teams: ['TEAM A'], known: [] }, (o, n, r, name) => same([], name)(o, n));
  // newest row overall is an initial one: the newest CURRENT one comes back
  one('newest row is an initial one', ['TEAM A'], () => [R('TEAM A', 'X3', 4, 'current'), R('TEAM A', 'X3', 6, 'initial'), R('TEAM A', 'X3', 6, 'initial', 5)], { teams: ['TEAM A'], known: [] }, (o, n, rows, name) => same([keyOf(rows[0])], name)(o, n));
  // a day uploaded twice: the later upload
  one('a day uploaded twice', ['TEAM A'], () => [R('TEAM A', 'X4', 5, 'current', 300), R('TEAM A', 'X4', 5, 'current', 10)], { teams: ['TEAM A'], known: [] }, (o, n, rows, name) => same([keyOf(rows[0])], name)(o, n));
  // an exact tie: one row, one of the two
  one('two rows with the same day and time', ['TEAM A'], () => { const a = R('TEAM A', 'X5', 5, 'current'); const b = { ...R('TEAM A', 'X5', 5, 'current'), created_at: a.created_at }; return [a, b]; }, { teams: ['TEAM A'], known: [] },
    (o, n, rows, name) => { const ok = r => r.length === 1 && rows.some(x => keyOf(x) === r[0]); if (!ok(o)) note(name + ': the first text answers ' + o.length + ' rows'); if (!ok(n)) note(name + ': the new function answers ' + n.length + ' rows, not exactly one of the two'); });
  // empty team list, a team with no rows
  one('an empty team list', ['TEAM A'], () => [R('TEAM A', 'X6', 5, 'current')], { teams: [], known: [] }, (o, n, r, name) => same([], name)(o, n));
  one('a team with no rows', ['TEAM A', 'TEAM B'], () => [R('TEAM A', 'X6', 5, 'current')], { teams: ['TEAM B'], known: [] }, (o, n, r, name) => same([], name)(o, n));
  // a known ref is matched exactly: another case or a trailing blank is not it (the app normalises before it asks)
  one('known refs are matched exactly', ['TEAM A'], () => [R('TEAM A', 'abc', 5, 'current'), R('TEAM A', 'DEF', 5, 'current')], { teams: ['TEAM A'], known: ['ABC', 'DEF '] },
    (o, n, rows, name) => same(rows.map(keyOf), name)(o, n));
  // a team asked twice answers twice
  one('a team asked twice', ['TEAM A'], () => [R('TEAM A', 'X7', 5, 'current')], { teams: ['TEAM A', 'TEAM A'], known: [] }, (o, n, rows, name) => same([keyOf(rows[0]), keyOf(rows[0])], name)(o, n));
  // the two inputs the app never sends: pinned to what they do
  one('a NULL known list', ['TEAM A'], () => [R('TEAM A', 'X8', 5, 'current'), R('TEAM A', 'X9', 5, 'current')], { teams: ['TEAM A'], known: null },
    (o, n, rows, name) => { if (o.length !== 0) note(name + ': the first text was meant to answer nothing, it answers ' + o.length); if (JSON.stringify(n) !== JSON.stringify(rows.map(keyOf).sort())) note(name + ': the new function was meant to answer every candidate, it answers ' + n.length); });
  one('a NULL inside the known list', ['TEAM A'], () => [R('TEAM A', 'X8', 5, 'current'), R('TEAM A', 'X9', 5, 'current')], { teams: ['TEAM A'], known: ['X8', null] },
    (o, n, rows, name) => { if (o.length !== 0) note(name + ': the first text was meant to answer nothing, it answers ' + o.length); if (JSON.stringify(n) !== JSON.stringify([keyOf(rows[1])])) note(name + ': the new function was meant to answer the one candidate that is not named, it answers ' + JSON.stringify(n)); });
};

/* ---- 2. the pages ---- */
const buildBigBook = () => {
  // 60 teams of 100 customers: four with 30 days of history for each customer (S), four with 110 (L), fifty-two more with 110 (F), so that a team is under 2% of the table, as on the live book (about 90 teams).
  // A book with a handful of teams makes the planner read the whole table for one team, which no live call does.
  psqlTo(`set jit = off;
truncate defaulter_snapshots, teams cascade;
insert into teams(team)
select 'S' || lpad(i::text, 2, '0') from generate_series(1,4) i
union all select 'L' || lpad(i::text, 2, '0') from generate_series(1,4) i
union all select 'F' || lpad(i::text, 2, '0') from generate_series(1,52) i;
create temp table life as
select t.team, r, s.s, case when t.team like 'S%' then least(109, s.s + 4 + floor(random()*20)::int) else least(109, s.s + 19 + floor(random()*72)::int) end as e
from (select team from teams) t cross join generate_series(1,100) r
cross join lateral (select case when t.team like 'S%' then 80 + floor(random()*30)::int else floor(random()*110)::int end as s) s;
insert into defaulter_snapshots (ref, full_name, contact, team, arrears, balance, status, ds, dc, days_elapsed, disb_date, snapshot_type, snapshot_date, created_at)
select '42' || lpad((ascii(substr(l.team, 1, 1)) * 100000 + substr(l.team, 2)::int * 1000 + l.r)::text, 8, '0'), 'N', '07', l.team,
       d.n, 1000, 'Chronic', '3/6', 2, 30, date '2026-06-01', ty.ty, date '2026-08-03' + d.n,
       (date '2026-08-03' + d.n)::timestamptz + case when ty.ty = 'initial' then interval '6 hours' else interval '18 hours' end + (random()*600)::int * interval '1 second'
from life l cross join lateral generate_series(l.s, l.e) d(n) cross join (values ('initial'),('current')) ty(ty)
order by random();
vacuum analyze defaulter_snapshots;`, DB);
};
const buffers = text => { const m = text.match(/Buffers: shared ([^\n]*)/); if (!m) return null; const g = k => { const x = m[1].match(new RegExp(k + '=(\\d+)')); return x ? Number(x[1]) : 0; }; return g('hit') + g('read'); };
const measure = (fn, group, mode) => {       // mode 'walk': every ref known (the walk alone); 'all': nothing known (every departed customer is asked for)
  const teams = ['01', '02', '03', '04'].map(n => group + n);
  const out = psqlTo(`set jit = off;
select coalesce(array_agg(distinct ref), '{}')::text as allrefs from defaulter_snapshots where team = any(${arr(teams)}) \\gset
select count(*) as n from ${fn}(${arr(teams)}, '{}'::text[]) \\gset
\\echo N=:n
explain (analyze, buffers, costs off, timing off) select count(*) from ${fn}(${arr(teams)}, ${mode === 'walk' ? ":'allrefs'::text[]" : "'{}'::text[]"});`, DB);
  const n = Number((out.match(/N=(\d+)/) || [])[1]);
  return { n, pages: buffers(out.slice(out.indexOf('QUERY') >= 0 ? out.indexOf('QUERY') : 0)) || buffers(out) };
};
const lookupPages = (fn, group) => { const w = measure(fn, group, 'walk'), a = measure(fn, group, 'all'); return { n: a.n, walk: w.pages, all: a.pages, perCandidate: (a.pages - w.pages) / Math.max(1, a.n) }; };
const lookupPlan = () => {
  const ref = psqlTo("select ref from defaulter_snapshots where team = 'L01' limit 1", DB).trim();
  return psqlTo("set enable_bitmapscan = off;\nexplain (costs off) select d.ref, d.snapshot_date from defaulter_snapshots d where d.team = 'L01' and d.ref = " + q(ref) + " and d.snapshot_type = 'current' order by d.snapshot_date desc, d.created_at desc limit 1;", DB);
};
const dropIndex = () => psqlTo('drop index if exists ' + INDEX_NAME, DB);
const createIndexFrom = text => psqlTo(sectionOf076(text, 1), DB);
const indexState = () => psqlTo("select pg_get_indexdef(indexrelid) || '|' || indisvalid from pg_index where indexrelid::regclass::text = '" + INDEX_NAME + "'", DB).trim();
const pages = (fails, report) => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  dropIndex(); psqlTo('analyze defaulter_snapshots', DB);
  const oS = lookupPages('ghost_orig', 'S'), oL = lookupPages('ghost_orig', 'L'), nS = lookupPages('defaulter_ghost_rows', 'S'), nL = lookupPages('defaulter_ghost_rows', 'L');
  // What the lookup of a departed customer's newest current row costs WITHOUT the index grows with how long the customer stood on the decks.
  const ratioWithout = nL.perCandidate / Math.max(0.01, nS.perCandidate);
  if (ratioWithout < 2) note('without the index the lookup should cost pages in proportion to the history (110 days against 30): ' + ratioWithout.toFixed(2) + 'x');
  try { createIndexFrom(F076); } catch (e) { note('the index statement did not run: ' + String(e.stderr || e.message).split('\n')[0]); }
  psqlTo('vacuum analyze defaulter_snapshots', DB);
  const state = indexState();
  if (state !== INDEX_DEF + '|true') note('the index is not the definition the file says, valid: ' + state);
  const wS = lookupPages('defaulter_ghost_rows', 'S'), wL = lookupPages('defaulter_ghost_rows', 'L'), oW = lookupPages('ghost_orig', 'L');
  // WITH it the lookup does not.
  const ratioWith = wL.perCandidate / Math.max(0.01, wS.perCandidate);
  if (ratioWith > 1.4) note('with the index the lookup still grows with the history: ' + ratioWith.toFixed(2) + 'x (110 days against 30)');
  if (wL.all * 4 > nL.all) note('with the index the new function should read at least four times fewer pages than without it for the 110-day teams: ' + wL.all + ' against ' + nL.all);
  const plan = lookupPlan();
  if (!plan.includes(INDEX_NAME)) note('the planner does not take the index for the lookup:\n' + plan);
  if (/Sort/.test(plan)) note('the lookup has a Sort node with the index:\n' + plan);
  if (!/concurrently/i.test(sectionOf076(F076, 1))) note('the index statement is not CONCURRENTLY');
  report.push(`pages (hits+reads) for four teams, ${oL.n} departed customers asked for in the 110-day group, ${oS.n} in the 30-day one (the first text's figures depend on the plan the planner picks for it and are printed, not asserted):`);
  report.push(`   first text, no index:   110 days ${oL.all}  30 days ${oS.all}   (lookup per customer ${oL.perCandidate.toFixed(1)} / ${oS.perCandidate.toFixed(1)})`);
  report.push(`   new text,   no index:   110 days ${nL.all}  30 days ${nS.all}   (lookup per customer ${nL.perCandidate.toFixed(1)} / ${nS.perCandidate.toFixed(1)}; ${(nL.all / oL.all).toFixed(2)} times the first text)`);
  report.push(`   first text, with index: 110 days ${oW.all}`);
  report.push(`   new text,   with index: 110 days ${wL.all}  30 days ${wS.all}   (lookup per customer ${wL.perCandidate.toFixed(1)} / ${wS.perCandidate.toFixed(1)}; ${(nL.all / wL.all).toFixed(1)} times fewer than the new text without it)`);
};

/* ---- 3. the index file, as a file ---- */
const indexFile = fails => {
  const note = m => { if (fails.length < 12) fails.push(m); };
  dropIndex();
  try {
    createIndexFrom(F076); createIndexFrom(F076);
    const n = psqlTo("select count(*) from pg_indexes where indexname = '" + INDEX_NAME + "'", DB).trim();
    if (n !== '1') note('run twice, the index is there ' + n + ' times, not once');
  } catch (e) { note('the index statement failed when run twice: ' + String(e.stderr || e.message).split('\n')[0]); }
  const v = sectionOf076(F076, 2);
  let valid = ''; try { valid = psqlTo(v, DB).trim(); } catch (e) { note('section 2 did not run: ' + String(e.stderr || e.message).split('\n')[0]); }
  if (!/\|t\|/.test(valid.replace(/\t/g, '|') + '|') || !valid.startsWith(INDEX_NAME)) note('section 2 does not say valid: ' + valid);
  const undo = (F076.match(/-- (drop index concurrently if exists [^;]*;)/) || [])[1];
  if (!undo) note('the undo line is not in the file');
  else { try { psqlTo(undo, DB); } catch (e) { note('the undo failed: ' + String(e.stderr || e.message).split('\n')[0]); } if (indexState() !== '') note('the undo left the index behind'); }
  if (!/END OF THE FILE/.test(F076.split('\n').filter(Boolean).pop())) note('the file does not end with its END line');
  try { createIndexFrom(F076); } catch (e) { note('the index could not be made again after the undo'); }
};

/* ---- 4. what it costs the upload ---- */
const insertCost = (fails, report) => {
  const ms = () => { const out = execFileSync('psql', ['-X', '-q', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: `\\timing on
begin;
insert into defaulter_snapshots (ref, full_name, contact, team, arrears, balance, status, ds, dc, days_elapsed, disb_date, snapshot_type, snapshot_date, created_at)
select '77' || lpad(r::text, 8, '0'), 'N', '07', 'S0' || (1 + r % 4), 1, 1000, 'Chronic', '3/6', 2, 30, date '2026-06-01', ty.ty, date '2026-12-01', now()
from generate_series(1,10000) r cross join (values ('initial'),('current')) ty(ty);
rollback;`, env, encoding: 'utf8', stdio: PIPES }); return Math.max(...[...out.matchAll(/Time: ([0-9.]+) ms/g)].map(m => Number(m[1]))); };
  const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const w = [], wo = [];
  for (let i = 0; i < 5; i++) { dropIndex(); wo.push(ms()); createIndexFrom(F076); w.push(ms()); }
  psqlTo('vacuum analyze defaulter_snapshots', DB);
  report.push(`inserting a deck day (20,000 rows, half current), median of five: ${med(wo).toFixed(0)} ms without the index, ${med(w).toFixed(0)} ms with it (+${(100 * (med(w) / med(wo) - 1)).toFixed(0)}%)`);
  if (med(w) > med(wo) * 2) fails.push('the index more than doubles the insert of a deck day: ' + med(w) + ' against ' + med(wo));
};

/* ---- the whole run ---- */
const install = (f075, f076) => {
  psqlTo('drop function if exists defaulter_ghost_rows(text[], text[])', DB);
  psqlTo(f075, DB);
};
const setup = () => {
  try { psqlTo('drop database if exists ' + DB, admin); } catch {}
  psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
  psqlTo(read('db/schema.sql'), DB);
  psqlTo(TEAM_REF_INDEX.replace('concurrently ', ''), DB);
  psqlTo(section3Of055(), DB);
  psqlTo(F075, DB);
};

const BREAKS_075 = [
  ['the known refs are ignored', 'and not exists (select 1 from unnest(p_known_refs) k(r) where k.r = wk.ref)', 'and true'],
  ['the known refs are inverted', 'and not exists (select 1 from unnest(p_known_refs) k(r) where k.r = wk.ref)', 'and exists (select 1 from unnest(p_known_refs) k(r) where k.r = wk.ref)'],
  ['the old comparison against the array (NULL known list)', 'and not exists (select 1 from unnest(p_known_refs) k(r) where k.r = wk.ref)', 'and wk.ref <> all (p_known_refs)'],
  ['initial rows can be the answer', "and d.snapshot_type = 'current'", ''],
  ['another team\'s row can be the answer', "where d.ref = c.ref and d.team = v_team and d.snapshot_type = 'current'", "where d.ref = c.ref and d.snapshot_type = 'current'"],
  ['the oldest row is the answer', 'order by d.snapshot_date desc, d.created_at desc', 'order by d.snapshot_date asc, d.created_at desc'],
  ['the later upload of a day does not win', 'order by d.snapshot_date desc, d.created_at desc', 'order by d.snapshot_date desc, d.created_at asc'],
  ['two rows a customer', 'limit 1) l;', 'limit 2) l;'],
  ['only the first team is read', 'foreach v_team in array p_teams loop', 'foreach v_team in array p_teams[1:1] loop'],
  ['the walk starts at the last ref', 'order by d.ref limit 1)\nunion all', 'order by d.ref desc limit 1)\nunion all'],
  ['the answer carries the day of today', 'l.other_inst, l.snapshot_date\nfrom candidates c', 'l.other_inst, current_date\nfrom candidates c'],
  ['the balance is not carried', 'l.arrears, l.balance,', 'l.arrears, null::numeric,'],
  ['status and ds swapped', 'l.status, l.ds,', 'l.ds, l.status,'],
  ['the lookup is not tied to the candidate', 'where d.ref = c.ref and d.team = v_team', 'where d.team = v_team'],
];
const BREAKS_076 = [
  ['the index is not partial', "where snapshot_type = 'current';", ';'],
  ['the index is for initial rows', "where snapshot_type = 'current';", "where snapshot_type = 'initial';"],
  ['the index lacks created_at', "snapshot_date desc, created_at desc) where snapshot_type = 'current';", "snapshot_date desc) where snapshot_type = 'current';"],
  ['the index starts with the ref, not the team', 'on defaulter_snapshots (team, ref, snapshot_date desc', 'on defaulter_snapshots (ref, team, snapshot_date desc'],
  ['the index does not say desc', 'on defaulter_snapshots (team, ref, snapshot_date desc, created_at desc) where', 'on defaulter_snapshots (team, ref, snapshot_date, created_at) where'],
  ['the index has another name', 'idx_def_snap_current_last on', 'idx_def_snap_other on'],
  ['run twice it fails', 'create index concurrently if not exists', 'create index concurrently'],
];
const once = (text, from, to) => { const n = text.split(from).length - 1; if (n !== 1) return null; return text.replace(from, () => to); };

const t0 = Date.now(); const report = []; const fails = [];
setup();
const seeds = Array.from({ length: FAST ? 40 : 250 }, (_, i) => 1 + i);
answers(seeds, fails); edges(fails);
buildBigBook(); pages(fails, report); indexFile(fails); insertCost(fails, report);
console.log(report.join('\n'));
console.log(fails.length ? 'FAIL on the files as they are:\n  ' + fails.join('\n  ') : 'the files do what they say: answers, pages, index, cost.');
let bad = fails.length ? 1 : 0;

/* ---- 5. deliberate breaks: every one must make a check fail ---- */
if (!process.env.NOBREAKS && !fails.length) {
  const broken = [];
  for (const [name, from, to] of BREAKS_075) {
    const mutated = once(F075, from, to);
    if (mutated === null) { broken.push([name, 'BAD BREAK: its text is not in the file exactly once']); bad = 1; continue; }
    const f = [];
    try { install(mutated); } catch (e) { broken.push([name, 'NOT A BREAK: it does not run (' + String(e.stderr || e.message).split('\n')[0] + ')']); bad = 1; install(F075); continue; }
    answers(seeds.slice(0, 60), f); edges(f);
    install(F075);
    broken.push([name, f.length ? 'caught' : 'NOT CAUGHT']); if (!f.length) bad = 1;
  }
  install(F075);
  for (const [name, from, to] of BREAKS_076) {
    const mutated = once(F076, from, to);
    if (mutated === null) { broken.push([name, 'BAD BREAK: its text is not in the file exactly once']); bad = 1; continue; }
    const f = [];
    const saved = F076;
    try {
      dropIndex();
      const stmt = sectionOf076(mutated, 1);
      try { psqlTo(stmt, DB); } catch (e) { /* an index that cannot be made is a failure of the check below */ }
      const state = indexState();
      if (state !== INDEX_DEF + '|true') f.push('the index is not the definition the file says: ' + state);
      let twice = true; try { psqlTo(stmt, DB); } catch { twice = false; }
      if (!twice) f.push('run twice, the statement fails');
      const plan = lookupPlan();
      if (!plan.includes(INDEX_NAME) || /Sort/.test(plan)) f.push('the planner does not take the index without a Sort');
    } finally { dropIndex(); try { createIndexFrom(saved); } catch {} }
    broken.push([name, f.length ? 'caught' : 'NOT CAUGHT']); if (!f.length) bad = 1;
  }
  for (const [name, res] of broken) console.log('  break: ' + name.padEnd(58) + ' ' + res);
  console.log(`${broken.filter(b => b[1] === 'caught').length} of ${broken.length} deliberate breaks caught`);
}
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
console.log('took ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(bad);
