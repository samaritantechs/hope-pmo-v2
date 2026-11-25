/* CLAUDIAN-PMO'S CHAT LOG -- db/RUN-ME-090, run for real on a PostgreSQL.

     "Have a new tab called Hope Ai in the system with rows of user chats that I could open and see what the user is chatting.. like reports of
      Claudian-PMO chats per user roles, teams and dates" -- the owner, 25 Nov 2026 (handbook Part 155)

   db/RUN-ME-090 makes the one table Claudian-PMO writes its chats to (api/_lib/claudian.js: logChat) and counts its daily limits from. It is pasted by hand into
   the live book's SQL editor, as ONE transaction. It passes only when:
     1. THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, and a plain role standing for the public API's own (hope_app: no BYPASSRLS), granted
        SELECT and INSERT on every table as a Supabase book grants them to its API roles.
     2. THE FILE RUNS as one transaction (psql -1, as the editor does) and answers ONE row: no chat yet, and the table is there.
     3. IT CAN BE RUN AGAIN: nothing is lost (a row written between the two runs is still there), nothing fails.
     4. THE ROWS THE APP WRITES ARE ACCEPTED: one of each mode (ai, faq, canned, limit, busy, match, nomatch), inserted the way PostgREST inserts (json_populate_record from a JSON
        object), with the exact keys logChat sends; and what the table needs is NOT NULL (day, source, user_key, mode): a row without one is refused.
     5. THE COUNTS THE APP ASKS FOR ARE ANSWERED, and by an index: a person's questions today (user_key, day, mode) and everybody's (day, mode).
     6. NOBODY BUT THE SERVER READS IT: row security is on, no policy exists, and the plain API role sees no row although it holds SELECT.
     7. THE UNDO LINE removes it.
     8. EVERY ONE of a list of deliberate breaks of the file makes a check fail.

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/claudian-chats.mjs

   It makes, uses and drops its own scratch databases and its role. NEVER point it at the live book. Exit code 0 = the file did what it says. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rd = p => fs.readFileSync(ROOT + '/' + p, 'utf8');
const FILE = rd('db/RUN-ME-090-claudian-chats.sql');
const SCHEMA = rd('db/schema.sql');
const env = process.env;
const run = (sql, db, one = false) => execFileSync('psql', ['-X', '-q', '-At', '-F', ' | ', '-v', 'ON_ERROR_STOP=1', ...(one ? ['-1'] : []), '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const tryRun = (sql, db, one = true) => { try { return { out: run(sql, db, one) }; } catch (e) { return { err: String(e.stderr || e.message) }; } };
const had = run("select count(*) from pg_roles where rolname = 'hope_app'", 'postgres').trim() === '1';
if (!had) run('create role hope_app nologin', 'postgres');

/** The row logChat writes, for each kind of answer: the keys of api/_lib/claudian.js, as JSON. */
const base = { day: '2026-11-25', source: 'portal', user_key: 'p:0123456789abcdef', user_name: 'JUMA G', role: 'MANAGER', teams: 'KONGOWE, MBAGALA', zone: 'DAR CENTER', lang: 'sw', thread: 'p:0123456789abcdef:2026-11-25' };
const ROWS = [
  { ...base, mode: 'ai', question: 'Simu ya portfolio ni nini?', answer: 'Ni simu kwa mteja.', tokens_in: 2700, tokens_out: 40, cache_read: 1200, ms: 900, behind: true, note: null },
  { ...base, mode: 'ai', question: 'q', answer: 'a', tokens_in: 10, tokens_out: 5, cache_read: 0, ms: 5, behind: null, note: 'max_tokens' },
  { ...base, mode: 'faq', faq_id: 'targets', question: 'Malengo ya kampuni ni yapi?', answer: null },
  { ...base, source: 'call', user_key: 'c:fedcba9876543210', mode: 'canned', question: 'asante', answer: 'Karibu.', tokens_in: 0, tokens_out: 0 },
  { ...base, mode: 'limit', question: 'q', answer: null, note: 'person limit' },
  { ...base, mode: 'busy', question: 'q', answer: null, ms: 25000, note: 'the provider did not answer' },
  // the two kinds a typed question leaves when the AI is off (handbook Part 163): the nearest ready answer, and none
  { ...base, mode: 'match', faq_id: 'targets', question: 'target za timu', answer: 'Malengo ni ...', tokens_in: 0, tokens_out: 0, note: 'keys: target, timu \u00b7 score 3.2' },
  { ...base, mode: 'nomatch', question: 'mshahara unaingia lini', answer: null, tokens_in: 0, tokens_out: 0, note: 'no ready answer fits' },
];
/** One row, as PostgREST inserts it: the columns named are the keys of the JSON object, every other column takes its default. */
const insertOne = row => { const cols = Object.keys(row).join(', ');
  return 'insert into public.claudian_chats (' + cols + ") select " + cols + " from json_populate_record(null::public.claudian_chats, '" + JSON.stringify(row).replace(/'/g, "''") + "'::json);"; };
const insertAll = rows => rows.map(insertOne).join('\n');

/** Runs every check against a book where `file` has been run; returns the names of the checks that FAILED. */
function checks(file, DB, say) {
  const failed = [];
  const check = (ok, what) => { if (!ok) failed.push(what); if (say) console.log((ok ? 'ok    ' : 'FAIL  ') + what); };
  run('drop database if exists ' + DB, 'postgres'); run('create database ' + DB, 'postgres');
  try {
    run(SCHEMA, DB);
    run('grant usage on schema public to hope_app;', DB);
    // 2. one transaction, one row
    const first = tryRun(file, DB);
    check(!first.err && first.out.trim() === '0 | t', 'run as one transaction the file answers one row: no chat yet, the table is there' + (first.err ? ' [' + first.err.slice(0, 160).replace(/\s+/g, ' ') + ']' : ' [' + (first.out || '').trim() + ']'));
    if (first.err) return failed;
    // the API's own role holds SELECT and INSERT on it, as a Supabase book grants them (default privileges)
    const g = tryRun('grant select, insert on public.claudian_chats to hope_app;', DB);
    check(!g.err, 'the table the app writes (public.claudian_chats) exists after the file');
    if (g.err) return failed;
    // 4. the rows the app writes
    const ins = tryRun(insertAll(ROWS), DB, false);
    check(!ins.err, 'the eight rows the app writes (ai twice, faq, canned, limit, busy, match, nomatch) are accepted, inserted as PostgREST inserts' + (ins.err ? ' [' + ins.err.slice(0, 160).replace(/\s+/g, ' ') + ']' : ''));
    check(run('select count(*) from public.claudian_chats', DB).trim() === '8', 'and they are eight rows');
    for (const col of ['day', 'source', 'user_key', 'mode']) {
      const bad = tryRun(insertOne({ ...ROWS[0], [col]: null }), DB, false);
      check(!!bad.err && /null value|not-null/i.test(bad.err), 'a row without ' + col + ' is refused');
    }
    check(run("select count(*) from public.claudian_chats where id is not null and created_at is not null", DB).trim() === '8', 'every row has its own id and its time');
    // 3. again
    const between = tryRun("insert into public.claudian_chats (day, source, user_key, mode) values ('2026-11-25', 'portal', 'p:between', 'ai');", DB, false);
    check(!between.err, 'a row that names only what it must (day, source, user_key, mode) is accepted: the id and the time come from the table');
    const again = tryRun(file, DB);
    check(!again.err && again.out.trim() === '9 | t', 'run again it fails nothing and loses nothing: nine rows, one of them written between the two runs' + (again.err ? ' [' + again.err.slice(0, 120).replace(/\s+/g, ' ') + ']' : ' [' + (again.out || '').trim() + ']'));
    // 5. the counts the app asks for, and an index for each
    const mine = run("select count(*) from public.claudian_chats where day = '2026-11-25' and mode = 'ai' and user_key = 'p:0123456789abcdef'", DB).trim();
    const all = run("select count(*) from public.claudian_chats where day = '2026-11-25' and mode = 'ai'", DB).trim();
    check(mine === '2' && all === '3', 'a person\'s questions today and everybody\'s are counted: 2 and 3, got ' + mine + ' and ' + all);
    const plan = q => run("set enable_seqscan = off; explain (costs off) " + q, DB);
    check(/idx_claudian_chats_user/.test(plan("select count(*) from public.claudian_chats where day = '2026-11-25' and mode = 'ai' and user_key = 'p:x'")), 'a person\'s count is answered by idx_claudian_chats_user');
    check(/idx_claudian_chats_day/.test(plan("select count(*) from public.claudian_chats where day = '2026-11-25' and mode = 'ai'")), 'everybody\'s count by idx_claudian_chats_day');
    check(/idx_claudian_chats_day/.test(plan("select * from public.claudian_chats where day >= '2026-11-01' order by day desc, created_at desc limit 50")), 'and the tab\'s list (newest first) by the same index');
    check(run("select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid where i.indrelid = 'public.claudian_chats'::regclass and i.indisvalid and c.relname in ('idx_claudian_chats_day', 'idx_claudian_chats_user')", DB).trim() === '2', 'both indexes are valid');
    // 6. nobody but the server
    check(run("select relrowsecurity from pg_class where oid = 'public.claudian_chats'::regclass", DB).trim() === 't', 'row security is on');
    check(run("select count(*) from pg_policies where tablename = 'claudian_chats'", DB).trim() === '0', 'and no policy exists');
    check(run('set role hope_app; select count(*) from public.claudian_chats;', DB).trim().split('\n').pop() === '0', 'the API\'s own role holds SELECT and sees no row');
    check(run('select count(*) from public.claudian_chats', DB).trim() === '9', 'while the server (the owner of the table) sees all nine');
    // 7. the undo
    run('drop table public.claudian_chats;', DB);
    check(run("select to_regclass('public.claudian_chats') is null", DB).trim() === 't', 'the undo line removes it');
  } finally {
    run('drop database if exists ' + DB, 'postgres');
  }
  return failed;
}

const real = checks(FILE, 'hope_claudian', true);
let broken = 0, missed = 0;
const BREAKS = [
  ['row security off', f => f.replace('alter table public.claudian_chats enable row level security;\n', '')],
  ['a policy that lets everybody read', f => f.replace('alter table public.claudian_chats enable row level security;\n', 'alter table public.claudian_chats enable row level security;\ncreate policy open_read on public.claudian_chats for select using (true);\n')],
  ['mode may be empty', f => f.replace('mode text not null,', 'mode text,')],
  ['mode is limited to the five older kinds (a typed question would then fail to be logged)', f => f.replace('mode text not null,', "mode text not null check (mode in ('ai', 'faq', 'canned', 'limit', 'busy')),")],
  ['day may be empty', f => f.replace('day date not null,', 'day date,')],
  ['user_key may be empty', f => f.replace('user_key text not null,', 'user_key text,')],
  ['no index for a person\'s count', f => f.replace(/create index if not exists idx_claudian_chats_user[^\n]*\n/, '')],
  ['no index by day', f => f.replace(/create index if not exists idx_claudian_chats_day[^\n]*\n/, '')],
  ['not safe to run again', f => f.replace('create table if not exists', 'create table')],
  ['a column the app writes is missing', f => f.replace('cache_read integer,\n', '')],
  ['the table is named otherwise', f => f.replace(/public\.claudian_chats/g, 'public.claudian_logs')],
  ['the proof answers nothing', f => f.replace(/select count\(\*\) as chats_now[\s\S]*?from public\.claudian_chats;\n/, '')],
  ['the id is not generated', f => f.replace('id uuid primary key default gen_random_uuid(),', 'id uuid primary key,')],
  ['the table is made for the wrong people to write', f => f.replace('alter table public.claudian_chats enable row level security;\n', 'alter table public.claudian_chats enable row level security;\ngrant all on public.claudian_chats to public;\ncreate policy w on public.claudian_chats for all using (true) with check (true);\n')],
];
for (const [name, edit] of BREAKS) {
  const text = edit(FILE);
  if (text === FILE) { console.log('FAIL  the break "' + name + '" changed nothing'); missed++; continue; }
  const failed = checks(text, 'hope_claudian_b', false);
  broken++;
  if (failed.length) console.log('ok    break caught: ' + name + ' (' + failed.length + ' check' + (failed.length > 1 ? 's' : '') + ')');
  else { console.log('FAIL  break NOT caught: ' + name); missed++; }
}
if (!had) run('drop role if exists hope_app', 'postgres');
console.log(real.length + ' checks failed on the real file; ' + broken + ' breaks run, ' + missed + ' missed');
process.exit(real.length || missed ? 1 : 0);
