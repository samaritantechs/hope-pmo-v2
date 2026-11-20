// db/RUN-ME-081 (the recorder), RUN-ME-082 and RUN-ME-083 (the two reads of it), pinned.
//
// "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026. A statement cancelled at the
// role's 8-second limit is in none of pg_stat_statements' figures, and the owner works in the SQL editor, not in the Logs Explorer. So the
// database is asked to write down, by itself, what runs long and how many requests fail: pg_cron every 5 seconds and every minute, into two small
// tables of a schema the API does not expose. It runs on the live book, on the owner's paste, and records what the app sends: so what it writes,
// what it may record (never a customer's name, number or amount), what it costs, and how it is undone are held here. What it DOES, run on a real
// PostgreSQL with pg_cron, is tools/db-checks/recorder.mjs (by hand; it needs one).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F81 = read('db/RUN-ME-081-recorder-of-slow-statements-and-failures.sql');
const F82 = read('db/RUN-ME-082-recorder-failures-by-hour-read-only.sql');
const F83 = read('db/RUN-ME-083-recorder-slow-statements-read-only.sql');
const code = f => f.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const norm = s => s.replace(/\s+/g, ' ').trim();
const block = (name, f) => {
  assert.ok(f.length < 10000, name + ' is under 10,000 characters: ' + f.length);
  assert.ok(!f.split('\n').some(l => /^\s/.test(l)), name + ': no line starts with a blank: nothing for an editor\'s indentation to pile up on');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(f), name + ': plain ASCII');
};

test('RUN-ME-081 is a block the owner can paste: small, flush-left, plain text, with the lines that say it ended', () => {
  block('RUN-ME-081', F81);
  assert.match(F81.split('\n').filter(Boolean).pop(), /^-- END OF THE SCRIPT: /, 'it ends with the line the owner looks for');
  assert.match(F81, /^-- UNDO, alone: select cron\.unschedule\('ops-health-sample'\); select cron\.unschedule\('ops-slow-sample'\); select cron\.unschedule\('ops-retention'\); drop schema ops cascade;$/m, 'the undo is written, commented, and names every job and the schema');
  assert.match(F81, /If it says it may not create the extension pg_cron, turn it on once in the dashboard/, 'what to do when the extension is refused');
});

test('RUN-ME-081 writes only in its own schema and its own jobs, and nothing of the book', () => {
  const c = norm(code(F81));
  assert.ok(!/\b(insert into|update(?! set\b)|delete from|truncate|alter table|drop table)\s+(public\.|"public"\.)?(?!ops\.|cron\.)/i.test(c), 'no write to a table that is not ops or cron (an upsert\'s "do update set" is on ops.db_slow_samples)');
  assert.deepEqual([...c.matchAll(/create (?:table|index|schema|extension)(?: if not exists)? ([a-z_.]+)/gi)].map(m => m[1]),
    ['pg_cron', 'ops', 'ops.db_health_samples', 'ops.db_slow_samples', 'db_slow_samples_seen'], 'it creates the extension, the schema, two tables and one index and nothing else');
  assert.ok(!/\bpublic\b[^']*\bto (anon|authenticated|service_role)/i.test(c), 'it grants nothing to the API roles');
  assert.match(c, /create schema if not exists ops;/, 'a schema of its own, which pgrst.db_schemas (public, hopeloan) does not expose');
  assert.deepEqual([...c.matchAll(/cron\.schedule\('([a-z-]+)', '([^']+)'/g)].map(m => m[1] + ' ' + m[2]),
    ['ops-health-sample * * * * *', 'ops-slow-sample 5 seconds', 'ops-retention 17 3 * * *'], 'three jobs: the minute, the five seconds, the nightly cleanup');
});

test('RUN-ME-081 records only what the app sent, as Postgres holds it, never what a person typed, and one row for each run', () => {
  const c = norm(code(F81));
  assert.match(c, /a\.query ~\* '\^\\s\*with pgrst_source as'/, 'only statements PostgREST built (their values are $1, $2): the owner\'s own scripts in the SQL editor are never recorded');
  assert.match(c, /a\.state = 'active' and a\.pid <> pg_backend_pid\(\) and a\.query_start < now\(\) - interval '3 seconds'/, 'running now, not itself, for more than three seconds');
  assert.match(c, /order by a\.query_start limit 50/, 'at most fifty a time: a burst cannot flood the table');
  assert.match(c, /primary key \(pid, query_start\)/, 'one row for each run, so the table grows with the runs and not with the samples');
  assert.match(c, /on conflict \(pid, query_start\) do update set last_seen = excluded\.last_seen, running_for = excluded\.running_for/, 'kept up to date while it runs');
  assert.match(c, /left\(regexp_replace\(a\.query, '\\s\+', ' ', 'g'\), 1500\)/, 'cut at 1,500 characters');
  for (const k of ['LATERAL "public"', 'INTO "public"', 'FROM "public"']) assert.ok(F81.includes(k), 'the target is named from ' + k);
  assert.match(c, /delete from ops\.db_health_samples where at < now\(\) - interval '14 days'; delete from ops\.db_slow_samples where first_seen < now\(\) - interval '14 days'; delete from cron\.job_run_details where end_time < now\(\) - interval '2 days'/, 'fourteen days, and the scheduler\'s own log two days');
  assert.match(F81, /customer name, number or amount/);
});

test('RUN-ME-081 says what it writes, what it records, what it costs and what to do if it fails', () => {
  for (const w of ['WHAT IT WRITES:', 'WHAT IT RECORDS:', 'WHAT IT COSTS:', 'IF IT FAILS:', 'UNDO, alone']) assert.ok(F81.includes(w), 'it has ' + w);
  assert.match(F81, /nothing is added to \/api\/upload or \/api\/call/, 'CLAUDE.md section 1');
  assert.match(F81, /a statement cancelled at the role's 8-second limit is in none of pg_stat_statements' figures/);
});

test('RUN-ME-082 and RUN-ME-083 are blocks the owner can paste, read only the recorder, and change nothing', () => {
  for (const [n, f] of [['RUN-ME-082', F82], ['RUN-ME-083', F83]]) {
    block(n, f);
    assert.match(F81.length ? f.split('\n').filter(Boolean).pop() : '', /^-- END OF THE READ$/, n + ' ends with the line the owner looks for');
    assert.ok(!/\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|vacuum|copy|lock|refresh)\b/i.test(code(f).replace(/'[^']*'/g, "''")), n + ': no word that writes or locks');
    assert.equal((code(f).match(/;/g) || []).length, 1, n + ': one statement');
    const from = new Set([...code(f).replace(/'[^']*'/g, "''").matchAll(/\bfrom\s+([a-z_.]+)/gi)].map(m => m[1].toLowerCase()));
    assert.ok([...from].every(t => t.startsWith('ops.') || t === 's' || t === 'running_for'), n + ' reads only the recorder (running_for is extract(epoch from ...)): ' + [...from].join(','));
  }
  assert.match(norm(code(F82)), /from ops\.db_health_samples window w as \(order by at\)/);
  assert.match(norm(code(F82)), /'Africa\/Dar_es_Salaam'/, 'the hours are the owner\'s own (East Africa time)');
  assert.match(norm(code(F82)), /greatest\(xact_rollback - lag\(xact_rollback\) over w, 0\)/, 'a counter that went back (a restart) is not a negative hour');
  assert.match(norm(code(F83)), /group by target, md5\(query\) order by long_runs desc, longest_s desc limit 20/, 'one row for each statement shape, most often first');
  assert.match(F83, /a shape with many runs past 7 seconds is a statement that is being cancelled/i);
});

test('the handbook and CHAT.md record the recorder and the owner\'s answers to RUN-ME-080', () => {
  const doc = read('docs/HANDOFF.md'), chat = read('CHAT.md');
  for (const w of ['RUN-ME-081', 'RUN-ME-082', 'RUN-ME-083', '768 GB']) { assert.ok(doc.includes(w), 'the handbook says ' + w); assert.ok(w === '768 GB' || chat.includes(w), 'CHAT.md says ' + w); }
  assert.match(chat, /768 GB/);
});
