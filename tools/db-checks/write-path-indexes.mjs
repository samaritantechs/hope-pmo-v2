/* THE TABLES THE UPLOAD AND THE CALL APP WRITE, AND THE INDEXES THEY CARRY -- db/RUN-ME-084, run for real on a PostgreSQL.

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026

   The file reads Postgres's own statistics views and the catalogue and is pasted by hand into the SQL editor of the live book. It passes only when:
     1. THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, then the indexes the live book added by hand, taken out of the files that
        add them (the two trigram indexes of RUN-ME-054, the (team, ref) index of RUN-ME-055, the partial index of RUN-ME-076), so the list is the live list.
     2. IT RUNS WHOLE AS ONE TEXT and prints one row for each of the four tables and one row for EVERY index of them (the catalogue's own list is the yardstick),
        and nothing of any other table.
     3. THE COUNTERS ARE THE TRUTH: the inserts of a table are the inserts made; an index nothing has read says scans 0 and one a query used says more; a size is the
        catalogue's page count; the primary key, a unique index and an INVALID one (the leftover of a failed CREATE INDEX CONCURRENTLY) say so.
     4. NO VALUE IS PRINTED: a customer with a distinctive name, loan number and phone is in the book and appears nowhere in the answer.
     5. IT NEVER WAITS BEHIND A LOCK held on a table of the book (a second session holds ACCESS EXCLUSIVE on the biggest table), and the same probe sees a size function wait.
     6. IT CHANGES NOTHING: the rows and the catalogue are the same after two runs.
     7. EVERY ONE of a list of deliberate breaks of the file changes the answer or makes it fail.

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/write-path-indexes.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rd = p => fs.readFileSync(ROOT + '/' + p, 'utf8');
const FILE = rd('db/RUN-ME-084-write-path-tables-and-indexes-read-only.sql');
const DB = 'hope_writepath';
const env = process.env;
const sh = (sql, db, args = []) => execFileSync('psql', ['-X', '-q', '-At', '-F', ' | ', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'pipe'] });
let failed = 0;
const check = (ok, what) => { if (!ok) { failed++; console.log('FAIL  ' + what); } else console.log('ok    ' + what); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lines = out => out.trim().split('\n').filter(Boolean);
const cells = l => l.split(' | ');
const TABLES = ['call_logs', 'defaulter_snapshots', 'followup_status', 'repayment_snapshots'];

// the indexes the live book added by hand, out of the files that add them
const grab = (text, re, what) => { const m = text.match(re); if (!m) throw new Error('no ' + what + ' in its file'); return m[0].replace(/create index concurrently/i, 'create index'); };
const F054 = rd('db/RUN-ME-054-legal-find-trigram-index.sql'), F055 = rd('db/RUN-ME-055-defaulter-ghosts.sql'), F076 = rd('db/RUN-ME-076-defaulter-snapshots-current-last-index.sql');
const HAND_INDEXES = [
  grab(F054, /create index concurrently if not exists idx_def_snap_fullname_trgm[^;]*;/i, 'full_name trigram index'),
  grab(F054, /create index concurrently if not exists idx_def_snap_ref_trgm[^;]*;/i, 'ref trigram index'),
  grab(F055, /create index concurrently if not exists idx_def_snap_team_ref[^;]*;/i, '(team, ref) index'),
  grab(F076, /create index concurrently if not exists idx_def_snap_current_last[^;]*;/i, 'partial index'),
];

sh('drop database if exists ' + DB, 'postgres'); sh('create database ' + DB, 'postgres');
try {
  sh(rd('db/schema.sql'), DB);
  sh('create extension if not exists pg_trgm;\n' + HAND_INDEXES.join('\n'), DB);
  // the book: a few thousand deck rows (one of them a customer whose name, loan number and phone must never be printed), some Expected rows, nothing in the others
  sh(`insert into teams(team) select 'T' || g from generate_series(1, 6) g on conflict do nothing;
insert into defaulter_snapshots(ref, full_name, contact, team, snapshot_type, snapshot_date)
select (4000000000 + g)::text, 'NAME ' || g, '0712' || lpad(g::text, 6, '0'), 'T' || (1 + g % 6), case when g % 2 = 0 then 'initial' else 'current' end, date '2026-11-01' + (g % 10) from generate_series(1, 6000) g;
insert into defaulter_snapshots(ref, full_name, contact, team, snapshot_type, snapshot_date) values ('9988776655', 'ZZYZX SECRETNAME', '0799888777', 'T1', 'current', '2026-11-20');
insert into repayment_snapshots(ref, full_name, team, snapshot_type, snapshot_date) select (4000000000 + g)::text, 'EXP ' || g, 'T1', 'today', date '2026-11-20' from generate_series(1, 300) g;
analyze;`, DB);
  // a query that uses idx_def_snap_ref, so its counter moves; and a failed concurrent unique build, which leaves an INVALID index behind
  sh("select count(*) from defaulter_snapshots where ref = '4000000100' and snapshot_date >= '2026-11-01';", DB);
  try { sh('create unique index concurrently idx_def_bad_unique on defaulter_snapshots (snapshot_type)', DB); } catch (e) { /* the point: duplicates make it fail and leave it INVALID */ }
  await sleep(2500);                                                    // the statistics of this session reach the shared view
  const run = text => lines(sh(text, DB));
  const a = run(FILE);
  const rows = a.map(cells);
  const col = (r, n) => r[n];                                           // tbl, kind, name, size, asked, from_memory, detail
  // 2. the rows
  check(rows.every(r => r.length === 7), 'seven columns in every row');
  const tableRows = rows.filter(r => r[1] === 'TABLE'), indexRows = rows.filter(r => r[1] === 'index');
  check(JSON.stringify(tableRows.map(r => r[0])) === JSON.stringify(TABLES), 'one TABLE row for each of the four tables, in name order: ' + tableRows.map(r => r[0]).join(','));
  const catalogue = lines(sh(`select tablename || ' | ' || indexname from pg_indexes where schemaname = 'public' and tablename in (${TABLES.map(t => "'" + t + "'").join(', ')}) order by 1`, DB));
  const got = indexRows.map(r => r[0] + ' | ' + r[2]).sort();
  check(JSON.stringify(got) === JSON.stringify(catalogue.slice().sort()), 'one row for EVERY index of the four tables, and no other: ' + got.length + ' of ' + catalogue.length);
  check(catalogue.length >= 15, 'and the book really has the live indexes (' + catalogue.length + ' of them, the trigram ones and the partial one among them)');
  check(rows.every(r => TABLES.includes(r[0])), 'nothing of any other table');
  // order: by table, the table's own row first, then its indexes biggest first
  const order = rows.map(r => r[0]);
  check(JSON.stringify(order) === JSON.stringify(order.slice().sort()), 'grouped by table, tables in name order');
  for (const t of TABLES) { const mine = rows.filter(r => r[0] === t); check(mine[0][1] === 'TABLE', t + ': the table row comes first'); }
  const sizesOf = t => lines(sh(`select i.relname || ' | ' || pg_size_pretty(i.relpages::bigint * 8192) || ' | ' || i.relpages from pg_class i join pg_index x on x.indexrelid = i.oid join pg_class tb on tb.oid = x.indrelid where tb.relname = '${t}' order by i.relpages desc, i.relname`, DB)).map(cells);
  const idxOrder = rows.filter(r => r[0] === 'defaulter_snapshots' && r[1] === 'index').map(r => r[2]);
  check(JSON.stringify(idxOrder) === JSON.stringify(sizesOf('defaulter_snapshots').map(r => r[0])), 'a table\'s indexes come biggest first');
  // 3. the counters are the truth
  const dsT = tableRows.find(r => r[0] === 'defaulter_snapshots');
  check(/^inserts 6001, updates 0, deletes 0, whole-table reads \d+ \(\d+ rows\), by index \d+$/.test(dsT[4]), 'the table row says the inserts made: ' + dsT[4]);
  check(/^live about \d+, dead about \d+ \(\d+(\.\d)?%\), last vacuum \S+( \S+)?, last analyze \d{4}-\d\d-\d\d \d\d:\d\d$/.test(dsT[6]), 'and live and dead rows, the last vacuum and the last analyze: ' + dsT[6]);
  const pageBytes = lines(sh("select (c.relpages + coalesce(t.relpages, 0))::bigint * 8192 from pg_class c left join pg_class t on t.oid = c.reltoastrelid where c.relname = 'defaulter_snapshots'", DB))[0];
  check(dsT[3] === lines(sh(`select pg_size_pretty(${pageBytes}::bigint)`, DB))[0], 'a size is the catalogue\'s own page count of the table and its TOAST: ' + dsT[3]);
  const ix = n => indexRows.find(r => r[2] === n);
  check(/^scans [1-9]\d*, rows read [1-9]\d*$/.test(ix('idx_def_snap_ref')[4]), 'an index a query used says scans: ' + ix('idx_def_snap_ref')[4]);
  check(ix('idx_def_snap_lookup')[4] === 'scans 0, rows read 0', 'an index nothing has read says scans 0');
  check(/^PRIMARY KEY btree \(id\)$/.test(ix('defaulter_snapshots_pkey')[6]), 'the primary key says so');
  check(ix('idx_def_snap_current_last')[6] === 'btree (team, ref, snapshot_date, created_at) partial (only some rows)', 'the partial index says its kind, its columns in order and that it covers only some rows: ' + ix('idx_def_snap_current_last')[6]);
  check(ix('idx_def_snap_fullname_trgm')[6] === 'gin (full_name)' && ix('idx_def_snap_ref_trgm')[6] === 'gin (ref)', 'and the two trigram indexes are named as what they are');
  check(ix('idx_def_snap_lookup')[6] === 'btree (snapshot_type, weekday, snapshot_date, team)', 'a plain index says its columns in the order the index has them');
  check(ix('idx_def_bad_unique')[6] === 'INVALID (writes pay for it, nothing reads it) btree (snapshot_type)', 'the leftover of a failed CREATE INDEX CONCURRENTLY says INVALID: ' + ix('idx_def_bad_unique')[6]);
  check(rows.filter(r => /INVALID/.test(r[6])).length === 1, 'and it is the only one');
  check(rows.every(r => r[5] === 'n/a' || /^\d+(\.\d)?%$/.test(r[5])), 'how much came from memory is a percentage or n/a');
  // 4. no value is printed
  check(!/ZZYZX|SECRETNAME|9988776655|0799888777/.test(a.join('\n')), 'the customer\'s name, loan number and phone appear nowhere in the answer');
  check(!/NAME \d|0712\d{6}|400000\d{4}/.test(a.join('\n')), 'and no other row\'s value either');
  // 5. never waits behind a lock
  const waitsBehindALock = async text => {
    const holder = spawn('psql', ['-X', '-q', '-At', '-d', DB], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    holder.stdin.end('begin; lock table public.defaulter_snapshots in access exclusive mode; select pg_sleep(6); rollback;');
    await sleep(1200);
    let waited = false;
    try { sh("set lock_timeout = '1500ms';\n" + text, DB); } catch (e) { waited = /lock timeout|canceling statement/i.test(String(e.stderr || e.message)); }
    holder.kill('SIGKILL'); await sleep(300);
    return waited;
  };
  check(!(await waitsBehindALock(FILE)), 'the reading does not wait behind a lock held on the biggest table of the book');
  check(await waitsBehindALock(FILE.replace("pg_size_pretty(ic.relpages::bigint * 8192)", "pg_size_pretty(pg_relation_size(si.relid))")), 'the same probe sees a size function wait (the deliberate break)');
  check(await waitsBehindALock(FILE.replace("|| am.amname || ' (' ||", "|| regexp_replace(pg_get_indexdef(si.indexrelid), '^.* USING ', '') || ' (' ||")), 'and pg_get_indexdef wait (the first form of this file used it, and the probe found it)');
  check(await waitsBehindALock(FILE.replace("' partial (only some rows)'", "' WHERE ' || pg_get_expr(ix.indpred, ix.indrelid)")), 'and pg_get_expr');
  // 6. it changes nothing
  const snap = () => sh(`select (select md5(string_agg(ref || full_name, ',' order by id)) from public.defaulter_snapshots) || ' ' || (select count(*) from pg_class) || ' ' || (select count(*) from pg_index) || ' ' || (select count(*) from pg_namespace)`, DB).trim();
  const before = snap(); run(FILE); run(FILE);
  check(snap() === before, 'the rows and the catalogue are the same after two runs');
  // 7. breaks
  const BREAKS = [
    ['a table of the four left out', FILE.replace("'call_logs', 'followup_status')\nunion all", "'followup_status')\nunion all")],
    ['no indexes at all', FILE.replace("where si.schemaname = 'public'", "where si.schemaname = 'nope'")],
    ['no tables', FILE.replace("where st.schemaname = 'public'", "where st.schemaname = 'nope'")],
    ['the biggest indexes last', FILE.replace('bytes desc, name', 'bytes asc, name')],
    ['the table row not first', FILE.replace('order by tbl, k, bytes desc', 'order by tbl, bytes desc, k')],
    ['an invalid index not said', FILE.replace("case when not ix.indisvalid then 'INVALID (writes pay for it, nothing reads it) ' when ix.indisprimary", "case when ix.indisprimary")],
    ['the primary key not said', FILE.replace("when ix.indisprimary then 'PRIMARY KEY ' ", '')],
    ['scans read from the wrong counter', FILE.replace("'scans ' || si.idx_scan", "'scans ' || si.idx_tup_fetch")],
    ['the size of the wrong table', FILE.replace('pg_size_pretty(ic.relpages::bigint * 8192)', 'pg_size_pretty(0::bigint)')],
    ['the dead weight not said', FILE.replace("', dead about ' || st.n_dead_tup", "', dead about ' || 0")],
    ['the memory share of the wrong view', FILE.replace('io.idx_blks_hit + io.idx_blks_read', 'io.idx_blks_hit + io.idx_blks_hit')],
    ['the columns of an index left out', FILE.replace("(select string_agg(coalesce(a.attname, '(expression)'), ', ' order by k.n) from unnest(ix.indkey::int2[]) with ordinality as k(attnum, n) left join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum)", "''")],
    ['the columns taken from any table, not the index\'s own', FILE.replace('a.attrelid = ix.indrelid and a.attnum = k.attnum', 'a.attnum = k.attnum')],
    ['the columns in no order', FILE.replace("order by k.n)", "order by a.attname)")],
    ['a partial index not said', FILE.replace("|| case when ix.indpred is not null then ' partial (only some rows)' else '' end\n", "\n")],
    ['the kind of index not said', FILE.replace("|| am.amname || ' (' ||", "|| ' (' ||")],
    ['a value printed', FILE.replace("'live about ' ||", "(select min(full_name) from public.defaulter_snapshots) || 'live about ' ||")],
  ];
  const baseline = JSON.stringify(a);
  for (const [name, text] of BREAKS) {
    if (text === FILE) { failed++; console.log('FAIL  the break "' + name + '" did not change the file'); continue; }
    let caught = false;
    try { const c = run(text); caught = JSON.stringify(c) !== baseline; } catch (e) { caught = true; }
    check(caught, 'a deliberate break is caught: ' + name);
  }
  const leak = BREAKS.find(b => b[0] === 'a value printed');
  check(/ZZYZX|NAME \d/.test((() => { try { return run(leak[1]).join('\n'); } catch (e) { return ''; } })()), 'the "value printed" break really prints a name (so check 4 can see one)');
} finally {
  sh('drop database if exists ' + DB, 'postgres');
}
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
