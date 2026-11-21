/* WHAT EACH INDEX OF THE DECK TABLE COSTS AN UPLOAD CHUNK -- a measurement, not a pass-or-fail check (handbook Part 127, addendum 4; 21 Nov 2026).

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026; CLAUDE.md section 1: the upload never slows down.

   The upload writes the deck table (defaulter_snapshots) in chunks of up to 1,000 rows (WRITE_CHUNK_MAX, api/upload.js), and every index of the table is written for every row. The second
   RUN-ME-080 table of 21 Nov showed that statement at 1.3 s each against 0.45 s over its life. This counts, for one chunk of 1,000 rows, the pages the INSERT had to read from outside
   shared memory ("Shared Read Blocks"), the pages it touched in all, the write-ahead log it wrote, and the same per index (pg_statio_user_indexes before and after each chunk), on a scratch
   copy of the table with the live book's nine indexes, at about the live ratio of memory to data (400 MB of buffers, 975 MB of table and indexes; live: 512 MB, 1.98 GB).
   A configuration is the book with some indexes dropped (or the id's default changed): the cost of an index is the difference between two configurations.

   NEEDS A CLUSTER OF ITS OWN (the default scratch cluster has far more memory than the book): as root,
       pg_createcluster 16 upidx -p 5433 -- --auth-local=trust --auth-host=trust
       cat >> /etc/postgresql/16/upidx/postgresql.conf <<'EOF'
       shared_buffers = 400MB
       work_mem = 5MB
       maintenance_work_mem = 1GB
       max_wal_size = 8GB
       checkpoint_timeout = 30min
       fsync = off
       synchronous_commit = off
       autovacuum = off
       track_io_timing = on
       jit = off
       EOF
       pg_ctlcluster 16 upidx start
       tools/db-checks/upload-index-cost/build.sh                   # about two minutes
       node tools/db-checks/upload-index-cost/measure.mjs            # every configuration, about ten minutes; or a list of their numbers: node measure.mjs 0,9
       pg_dropcluster --stop 16 upidx                                # when done
   Each configuration is a copy of the base database (CREATE DATABASE ... TEMPLATE), the cluster is RESTARTED (shared buffers empty: chunk 1 is cold), then ten chunks of an initial deck and
   ten of a current deck are inserted as EXPLAIN (ANALYZE, BUFFERS, WAL) of an INSERT ... SELECT from the staging table. It prints chunk 1 and the median of the others, and writes results.json.

   RESULT OF 21 NOV (pages read from outside memory, summed over the ten chunks of a deck; one day = an initial and a current deck): as now 14,323 + 8,665 = 22,988; time-ordered id
   8,198 + 6,273 = 14,471 (-37%); no partial index (RUN-ME-076) 19,997; no trigram indexes (RUN-ME-054) 20,162; both new indexes gone (the book before 12 Nov) 17,163; time-ordered id and neither
   new index 8,563; the primary key alone 9,325. The primary key (a random uuid) is about half of a chunk's reads once the cache is warm; (ref, snapshot_date) is most of the rest for an initial deck,
   the partial index and the trigram flush for a current deck; sorting a deck by team and ref before writing it gains nothing (-9%).
   WHAT IT DOES NOT SHOW: disk latency (this machine's operating-system cache holds the whole book, so reads are counted, never timed: the live cost of a read is the disk's), the fragmentation of an
   index grown by years of inserts (these are built in one go, compact), and any other load on the live machine. The shape, not the seconds, carries over. NEVER point it at the live book. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const env = { ...process.env, PGHOST: '/var/run/postgresql', PGPORT: '5433', PGUSER: 'postgres' };
const psql = (sql, db, input = true) => execFileSync('psql', ['-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-d', db, ...(input ? ['-f', '-'] : ['-c', sql])], { input: input ? sql : undefined, env, encoding: 'utf8', maxBuffer: 1 << 28 });
const restart = () => { execFileSync('pg_ctlcluster', ['16', 'upidx', 'restart'], { env }); };
const COLS = 'ref, full_name, contact, guarantor_name, guarantor_contact, disb_date, expire_date, chronic_date, due_date, last_trans_date, status, ds, dc, days_elapsed, initial_inst, other_inst, payment_exp, t_payment, arrears, balance, branch, team, zone, nearest_landmark, snapshot_type, weekday, snapshot_date, upload_batch, created_at';
const CONFIGS = [
  ['ALL (the live set)', []],
  ['no partial index (076)', ['idx_def_snap_current_last']],
  ['no trigram indexes (054)', ['idx_def_snap_fullname_trgm', 'idx_def_snap_ref_trgm']],
  ['no full_name trigram', ['idx_def_snap_fullname_trgm']],
  ['no ref trigram', ['idx_def_snap_ref_trgm']],
  ['no (team, ref) index (055)', ['idx_def_snap_team_ref']],
  ['no (ref, date) index', ['idx_def_snap_ref']],
  ['no date-keyed three', ['idx_def_snap_lookup', 'idx_def_snap_batch', 'idx_def_snap_date']],
  ['before 12 Nov (no 054, no 076)', ['idx_def_snap_fullname_trgm', 'idx_def_snap_ref_trgm', 'idx_def_snap_current_last']],
  ['time-ordered id (uuid v7 default)', [], 'V7'],
  ['rows sorted by team, ref inside the deck', [], '', 'stage_sorted'],
  ['time-ordered id + rows sorted by team, ref', [], 'V7', 'stage_sorted'],
  ['primary key only', ['idx_def_snap_fullname_trgm', 'idx_def_snap_ref_trgm', 'idx_def_snap_current_last', 'idx_def_snap_team_ref', 'idx_def_snap_ref', 'idx_def_snap_lookup', 'idx_def_snap_batch', 'idx_def_snap_date']],
  ['time-ordered id + no trigram (keep 076)', ['idx_def_snap_fullname_trgm', 'idx_def_snap_ref_trgm'], 'V7'],
  ['time-ordered id + no trigram + no 076', ['idx_def_snap_fullname_trgm', 'idx_def_snap_ref_trgm', 'idx_def_snap_current_last'], 'V7'],
  ['time-ordered id + no 076 (keep trigram)', ['idx_def_snap_current_last'], 'V7'],
];
const V7 = `create or replace function uuid_generate_v7() returns uuid language sql volatile as $$
select encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid
$$`;
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : CONFIGS.map((_, i) => i);
const chunksPerDeck = Number(process.env.CHUNKS || 10);
const results = fs.existsSync('results.json') ? JSON.parse(fs.readFileSync('results.json', 'utf8')) : {};
for (const i of only) {
  const [name, drops, pre, stageTable] = CONFIGS[i];
  const db = 'hope_cfg_' + i;
  console.log('== ' + name);
  psql('drop database if exists ' + db, 'postgres', false);
  psql('create database ' + db + ' template hope_upidx_base', 'postgres', false);
  if (drops.length) psql('drop index ' + drops.join(', '), db, false);
  if (pre === 'V7') psql(V7 + "; alter table defaulter_snapshots alter column id set default uuid_generate_v7();", db);
  psql('checkpoint', db, false);
  restart();                                                                  // shared buffers empty: the first chunk is cold
  let script = '\\set ON_ERROR_STOP on\n\\pset tuples_only on\n\\pset format unaligned\n';
  const plan = [];
  for (const type of ['initial', 'current']) for (let c = 0; c < chunksPerDeck; c++) plan.push([type, c]);
  for (const [type, c] of plan) {
    const a = c * 1000, b = a + 1000;
    script += `select 'CHUNK|${type}|${c}';\nselect pg_stat_force_next_flush();\n`;
    script += `select 'B|' || indexrelname || '|' || idx_blks_read || '|' || idx_blks_hit from pg_statio_user_indexes where relname = 'defaulter_snapshots';\n`;
    script += `select 'BH|' || heap_blks_read || '|' || heap_blks_hit from pg_statio_user_tables where relname = 'defaulter_snapshots';\n`;
    script += `select 'EXPLAIN_BEGIN';\nexplain (analyze, buffers, wal, timing off, format json) insert into defaulter_snapshots (${COLS}) select ${COLS} from ${stageTable || 'stage'} where snapshot_type = '${type}' and n > ${a} and n <= ${b};\nselect 'EXPLAIN_END';\n`;
    script += `select pg_stat_force_next_flush();\n`;
    script += `select 'A|' || indexrelname || '|' || idx_blks_read || '|' || idx_blks_hit from pg_statio_user_indexes where relname = 'defaulter_snapshots';\n`;
    script += `select 'AH|' || heap_blks_read || '|' || heap_blks_hit from pg_statio_user_tables where relname = 'defaulter_snapshots';\n`;
  }
  const out = psql(script, db).split('\n');
  const chunks = [];
  let cur = null, inEx = false, ex = [];
  for (const line of out) {
    if (line.startsWith('CHUNK|')) { const [, type, c] = line.split('|'); cur = { type, c: Number(c), before: {}, after: {} }; chunks.push(cur); continue; }
    if (!cur) continue;
    if (line === 'EXPLAIN_BEGIN') { inEx = true; ex = []; continue; }
    if (line === 'EXPLAIN_END') { inEx = false; const j = JSON.parse(ex.join('\n')); cur.plan = j[0].Plan; cur.exec = j[0]['Execution Time']; cur.triggers = j[0].Triggers || []; continue; }
    if (inEx) { ex.push(line); continue; }
    const p = line.split('|');
    if (p[0] === 'B' || p[0] === 'A') cur[p[0] === 'B' ? 'before' : 'after'][p[1]] = [Number(p[2]), Number(p[3])];
    if (p[0] === 'BH' || p[0] === 'AH') cur[p[0] === 'BH' ? 'before' : 'after']['(heap)'] = [Number(p[1]), Number(p[2])];
  }
  const rows = chunks.map(ch => {
    const pl = ch.plan;
    const perIndex = {};
    for (const k of Object.keys(ch.after)) perIndex[k] = [ch.after[k][0] - (ch.before[k] || [0, 0])[0], ch.after[k][1] - (ch.before[k] || [0, 0])[1]];
    return { type: ch.type, c: ch.c, ms: ch.exec, hit: pl['Shared Hit Blocks'], read: pl['Shared Read Blocks'], dirtied: pl['Shared Dirtied Blocks'], written: pl['Shared Written Blocks'], wal: pl['WAL Bytes'], perIndex };
  });
  results[name] = rows;
  fs.writeFileSync('results.json', JSON.stringify(results));
  const f = (arr, k) => arr.map(r => r[k]);
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  for (const type of ['initial', 'current']) {
    const r = rows.filter(x => x.type === type);
    console.log(`  ${type.padEnd(8)} chunk1 ms ${r[0].ms.toFixed(0).padStart(5)} read ${String(r[0].read).padStart(6)} hit ${String(r[0].hit).padStart(7)} wal ${(r[0].wal / 1e6).toFixed(1)}MB | later chunks median: ms ${med(f(r.slice(1), 'ms')).toFixed(0).padStart(5)} read ${String(med(f(r.slice(1), 'read'))).padStart(6)} hit ${String(med(f(r.slice(1), 'hit'))).padStart(7)} wal ${(med(f(r.slice(1), 'wal')) / 1e6).toFixed(1)}MB | max ms ${Math.max(...f(r, 'ms')).toFixed(0)}`);
  }
  psql('drop database if exists ' + db, 'postgres', false);
}
