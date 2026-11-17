/* EVERY DATE IN THE BOOK -- db/RUN-ME-064, run for real on a PostgreSQL.

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026

   db/RUN-ME-064-every-date-in-the-book-read-only.sql finds every date and timestamp column of every table from the database's own catalogue,
   reads each table once through dynamically built queries (query_to_xml) and prints, for every column, its rows, how many are filled, the
   earliest and latest value, how many are later than today and how many are before 2020, flagging the columns where a later date is not normal.
   Dynamic SQL taken out of XML is exactly the kind of plumbing that is wrong in one column and right in the rest, so it is not believed on a reading.

   THE BOOK IS THE REAL ONE: this check runs the WHOLE of db/schema.sql (thirty tables, eighty-two date and timestamp columns, the enum, the indexes) on an
   empty PostgreSQL inside one transaction, and fills nine tables with rows that carry every kind of value the file has to tell apart: a date later than today
   and one on today, a date before 2020 and one on 2020, a column where a later date is normal (an expiry, a promise, a due date, tomorrow's sheet), a birth date
   from 1975, a timestamp a minute from now, a timestamp two days from now, rows with nothing in them, and a VIEW with a date column (a view is not a table of the book).

   It passes only when: for EVERY date column of the book (all of them, not a sample) the line the file prints equals a count made by a direct query on that column
   (rows, filled, earliest, latest, later than today, before 2020) and carries the flag the rule says; the flagged lines come first; the tables are byte-for-byte unchanged
   afterwards (it is read-only); the file as pasted (its own East Africa expression) prints the East Africa date; and EVERY one of a list of deliberate breaks of the file
   (a boundary moved, an exemption dropped or widened, a view counted, the column order mixed up, the answers taken from the wrong column) changes the answer or makes it fail --
   a check that cannot fail when the file is broken proves nothing, and says so.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/every-date-audit.mjs
       (SCALE=1 builds a book of the live book's size with generate_series inside the transaction, times the file on it and stops)

   NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-064-every-date-in-the-book-read-only.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const SEP = '\x1f';
const psql = sql => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); }
};
const TODAY = (psql("select (now() at time zone 'Africa/Dar_es_Salaam')::date;").trim());      // the file's own clock, asked of the same server

// ---- rows that carry every kind of value the file has to tell apart (plain SQL, against the real tables)
const T = `date '${TODAY}'`;
const DATA = `
insert into public.teams (team) values ('T1');
insert into public.received_payments (paid_at, team, created_at) values
  (${T} + 20, 'T1', now()), (${T}, 'T1', now()), (${T} - 3, 'T1', now()), (date '1999-12-31', 'T1', now()), (null, 'T1', now());
insert into public.defaulter_snapshots (ref, team, snapshot_type, snapshot_date, disb_date, expire_date, chronic_date, due_date, last_trans_date, created_at) values
  ('A1', 'T1', 'initial', ${T}, ${T} + 40, ${T} + 91, ${T} + 105, ${T} + 7, ${T} + 1, now()),
  ('A2', 'T1', 'current', ${T} - 1, ${T}, ${T} + 30, ${T} + 44, null, ${T}, now()),
  ('A3', 'T1', 'current', ${T} - 2, date '2019-12-31', date '2020-01-01', ${T} - 400, ${T}, date '2019-01-01', now() - interval '2 days'),
  ('A4', 'T1', 'initial', ${T} - 3, null, null, null, null, null, now() + interval '2 days');
insert into public.repayment_snapshots (ref, team, snapshot_type, snapshot_date, disb_date, due_date, first_schedule_date, last_schedule_date, last_trans_date) values
  ('B1', 'T1', 'tomorrow', ${T} + 1, ${T} - 90, ${T} + 5, ${T} - 83, ${T} + 1, ${T} + 3),
  ('B2', 'T1', 'today', ${T}, ${T} + 2, null, null, null, date '2001-02-03');
insert into public.followup_status (ref, team, disb_date, last_trans, promise_date, comment_at, updated_at) values
  ('F1', 'T1', ${T} + 9, ${T} - 9, ${T} + 14, now() + interval '3 days', now()),
  ('F2', 'T1', date '2015-05-05', null, ${T} - 2, null, now() + interval '1 minute');
insert into public.followup_comments (ref, promise_date, created_at) values ('F1', ${T} + 6, now()), ('F2', null, now() + interval '2 days');
insert into public.loans (full_name, disb_date, approved_date) values ('L1', ${T} + 1, ${T}), ('L2', null, date '2010-01-01');
insert into public.staff_registry (id, name, birth_date, reg_date) values ('S1', 'STAFF ONE', date '1975-06-15', ${T}), ('S2', 'STAFF TWO', date '1960-01-01', ${T} + 30);
create view public.zz_a_view as select paid_at as view_date from public.received_payments;
`;
const BOOK = `${SCHEMA}\n${DATA}\n`;

const run = (file, extra = '') => {
  const STAMP = `select 'T' || chr(31) || extract(epoch from clock_timestamp());\n`;
  const SUM = `select md5(coalesce((select string_agg(x.t, '|' order by x.t) from (${
    ['received_payments', 'defaulter_snapshots', 'repayment_snapshots', 'followup_status', 'followup_comments', 'loans', 'staff_registry', 'teams'].map(t => `select to_jsonb(a)::text as t from public.${t} a`).join(' union all ')}) x), ''));`;
  const out = psql('begin;\n' + BOOK + extra + SUM + '\n' + STAMP + file + '\n' + STAMP + SUM + '\nrollback;\n').trim().split('\n');
  const stamps = out.filter(l => l.startsWith('T' + SEP)).map(l => Number(l.split(SEP)[1]));
  const sums = out.filter(l => /^[0-9a-f]{32}$/.test(l));
  const grid = out.filter(l => !l.startsWith('T' + SEP) && !/^[0-9a-f]{32}$/.test(l) && l.includes(SEP)).map(l => { const i = l.indexOf(SEP); return [l.slice(0, i), l.slice(i + 1)]; });
  return { grid, ms: Math.round((stamps[1] - stamps[0]) * 1000), same: sums.length === 2 && sums[0] === sums[1] };
};
const withToday = f => f.replace(/\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date/g, '(now() at time zone \'Africa/Dar_es_Salaam\')::date');     // the file's own clock is used as pasted: the data are relative to it
const nums = s => (s.match(/\d[\d,]*/g) || []).map(x => Number(x.replace(/,/g, '')));
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };

// ---- SCALE=1: a book of the live book's size
if (process.env.SCALE) {
  const N = Number(process.env.DECKS || 2300000), E = Number(process.env.EXPECTED || 900000);
  const sql = `begin;
${SCHEMA}
insert into public.teams select 'TEAM ' || g from generate_series(1, 42) g;
insert into public.defaulter_snapshots (ref, team, snapshot_type, snapshot_date, disb_date, expire_date, chronic_date, last_trans_date, status, ds, full_name, contact, arrears, created_at)
select 'C' || (g % 25000), 'TEAM ' || (1 + (g % 25000) % 42), case when g % 3 = 0 then 'initial' else 'current' end, date '2026-08-01' + (g % 109),
       date '2024-04-01' + ((g * 7) % 950), date '2024-07-01' + ((g * 7) % 950), date '2024-07-15' + ((g * 7) % 950), date '2026-06-01' + (g % 170), 'CHRONIC', '7-12', 'NAME ' || g, '0755' || g, 1000 + g % 90000,
       timestamptz '2026-08-01 19:40+00' + ((g % 109) || ' days')::interval
from generate_series(1, ${N}) g;
insert into public.repayment_snapshots (ref, team, snapshot_type, snapshot_date, disb_date, due_date, first_schedule_date, last_schedule_date, last_trans_date, full_name, contact)
select 'C' || (g % 40000), 'TEAM ' || (1 + g % 42), (array['today','tomorrow','yesterday','initial'])[1 + g % 4], date '2026-10-01' + (g % 48), date '2024-04-01' + ((g * 7) % 950), date '2026-10-01' + (g % 48), date '2026-09-01' + (g % 30), date '2026-12-01' + (g % 30), date '2026-10-01' + (g % 48), 'NAME ' || g, '0755' || g
from generate_series(1, ${E}) g;
analyze;
select 'rows', (select count(*) from public.defaulter_snapshots), pg_size_pretty(pg_total_relation_size('public.defaulter_snapshots'));
select 'T' || chr(31) || extract(epoch from clock_timestamp());
${FILE}
select 'T' || chr(31) || extract(epoch from clock_timestamp());
rollback;`;
  const out = psql(sql).trim().split('\n');
  const t = out.filter(l => l.startsWith('T' + SEP)).map(l => Number(l.split(SEP)[1]));
  console.log(out.find(l => l.startsWith('rows')).replace(/\x1f/g, ' '));
  console.log('the file took ' + Math.round((t[1] - t[0]) * 1000) + ' ms');
  process.exit(0);
}

// ---- 1. the file on the real book, compared column by column with direct queries
const A = run(FILE);
const lines = A.grid.filter(([w]) => /\.[a-z_]+ \(/.test(w));
{
  check('the file left the book exactly as it was (read-only)', A.same);
  // the catalogue, asked directly
  const cat = psql(`begin;\n${BOOK}select c.table_name || ',' || c.column_name || ',' || c.data_type from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE' where c.table_schema = 'public' and c.data_type in ('date', 'timestamp with time zone', 'timestamp without time zone') order by 1;\nrollback;\n`).trim().split('\n').map(l => l.split(','));
  check('the catalogue has the eighty-two date and timestamp columns of the real schema (and not the view)', cat.length === 82 && !cat.some(([t]) => t === 'zz_a_view'), 'got ' + cat.length);
  check('one line per column of the book, and not one for the view', lines.length === cat.length && !lines.some(([w]) => w.includes('zz_a_view')), lines.length + ' lines');
  // each column's own numbers, by a direct query
  const direct = {};
  const qs = cat.map(([t, c, ty]) => {
    const thr = ty === 'date' ? `(now() at time zone 'Africa/Dar_es_Salaam')::date` : `(now() + interval '1 day')`;
    return `select '${t}.${c}', count(*), count("${c}"), coalesce(left(min("${c}")::text, 16), ''), coalesce(left(max("${c}")::text, 16), ''), count(*) filter (where "${c}" > ${thr}), count(*) filter (where "${c}" < date '2020-01-01') from public."${t}";`;
  }).join('\n');
  for (const l of psql(`begin;\n${BOOK}${qs}\nrollback;\n`).trim().split('\n')) { const p = l.split(SEP); direct[p[0]] = p.slice(1); }
  let bad = 0, shown = 0;
  for (const [w, a] of lines) {
    const key = w.replace(/^\S*\s*/, '').replace(/ \(.*$/, ''), d = direct[key];
    if (!d) { bad++; if (shown++ < 3) console.log('   no direct answer for ' + key); continue; }
    const rows = a.match(/rows ([\d,]+)/), filled = a.match(/filled ([\d,]+)/), mn = a.match(/earliest ([^\s,]+(?: \d\d:\d\d)?)/), mx = a.match(/latest ([^\s,]+(?: \d\d:\d\d)?)/), fut = a.match(/later than today ([\d,]+)/), old = a.match(/before 2020 ([\d,]+)/);
    const got = [rows && rows[1].replace(/,/g, ''), filled && filled[1].replace(/,/g, ''), mn ? mn[1] : '', mx ? mx[1] : '', fut && fut[1].replace(/,/g, ''), old && old[1].replace(/,/g, '')];
    const want = [d[0], d[1], d[2].trim(), d[3].trim(), d[4], d[5]];
    // a timestamp is shown to the minute: the direct answer is cut to the same width
    const norm = v => String(v).replace('T', ' ').slice(0, 16).trim();
    if (got.map(norm).join('|') !== want.map(norm).join('|')) { bad++; if (shown++ < 3) console.log('   ' + key + ' got ' + got.join(',') + ' want ' + want.join(',')); }
  }
  check('every one of the eighty-two lines equals a direct query on its own column (rows, filled, earliest, latest, later than today, before 2020)', bad === 0, bad + ' lines differ');
  // the flags, by the rule written out here
  const FUTURE_OK = /(expire|chronic|due|promise|schedule|start|end|until|next|deadline|valid|retire|snapshot_date)/i, BIRTH = /(birth|dob)/i;
  let wrong = 0, flagged = 0;
  for (const [w, a] of lines) {
    const flag = w.slice(0, 8).trim(), col = w.slice(8).replace(/ \(.*$/, '').split('.')[1];
    const fut = Number((a.match(/later than today ([\d,]+)/) || [0, '0'])[1].replace(/,/g, '')), old = Number((a.match(/before 2020 ([\d,]+)/) || [0, '0'])[1].replace(/,/g, ''));
    const want = (fut > 0 && !FUTURE_OK.test(col)) ? 'FUTURE?' : (old > 0 && !BIRTH.test(col)) ? 'OLD?' : '';
    if (flag !== want) wrong++; if (want) flagged++;
  }
  check('every line carries the flag the rule says (a later date is a flag only where it is not normal; a birth date from the past is not a flag)', wrong === 0 && flagged >= 5, wrong + ' wrong, ' + flagged + ' flagged');
  const order = lines.map(([w]) => w.slice(0, 8).trim());
  const firstPlain = order.findIndex(f => f === ''), lastFlag = order.map((f, i) => f ? i : -1).filter(i => i >= 0).pop();
  check('the flagged lines come first', firstPlain === -1 || lastFlag < firstPlain, order.join(',').slice(0, 60));
  const ans = (A.grid.find(([w]) => w === 'ANSWER') || [])[1] || '';
  const nF = lines.filter(([w]) => w.startsWith('FUTURE?')).length, nO = lines.filter(([w]) => w.startsWith('OLD?')).length;
  check('the ANSWER line counts the columns, the tables and the flags', nums(ans)[0] === lines.length && nums(ans)[1] === new Set(lines.map(([w]) => w.slice(8).split('.')[0])).size && ans.includes(nF + ' with a date later than today') && ans.includes(nO + ' with a date before 2020'), ans);
  check('the planted rows are all there to be found (a later payment, an old payment, a later expiry that is normal, a birth date that is normal)',
    lines.some(([w, a]) => w.startsWith('FUTURE?') && w.includes('received_payments.paid_at')) && lines.some(([w, a]) => w.includes('defaulter_snapshots.expire_date') && !w.startsWith('FUTURE?') && /a later date is normal/.test(a))
    && lines.some(([w, a]) => w.includes('staff_registry.birth_date') && !w.startsWith('OLD?')), '');
  console.log('      the file itself took ' + A.ms + ' ms on a book of ' + lines.length + ' date columns');
}
// ---- 2. the file's own East Africa clock is the one the portal reads
{
  const r = psql(`select to_char((now() at time zone 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD Dy');`).trim();
  check('the file as pasted prints the East Africa date', ((A.grid.find(([w]) => w.startsWith('today')) || [])[1]) === r, '');
}
// ---- 3. broken on purpose
{
  const show = g => g.map(x => x.join('|')).join('\n');
  const base = show(A.grid);
  const all = (re, to) => src => src.replace(re, to);
  const breaks = [
    ['a date TODAY counts as later than today (dates)',              all(/'\(now\(\) at time zone ''Africa\/Dar_es_Salaam''\)::date'/, "'(now() at time zone ''Africa/Dar_es_Salaam'')::date - 1'")],
    ['a timestamp up to a day ahead counts as later than now',       all(/'\(now\(\) \+ interval ''1 day''\)'/, "'now()'")],
    ['a date on 2020-01-01 counts as before 2020',                   all(/< date ''2020-01-01''/, "<= date ''2020-01-01''")],
    ['the old line is 2019',                                         all(/< date ''2020-01-01''/, "< date ''2019-01-01''")],
    ['an expiry is flagged when it is later than today',             all(/\(expire\|chronic\|/, '(chronic|')],
    ['a promise is flagged when it is later than today',             all(/\|promise\|/, '|')],
    ['tomorrow\'s sheet is flagged',                                 all(/\|retire\|snapshot_date\)/, '|retire)')],
    ['a birth date from the past is flagged OLD?',                   all(/\(cols\.column_name ~\* '\(birth\|dob\)'\)/, '(false)')],
    ['a later date is normal everywhere',                            all(/\(cols\.column_name ~\* '\([a-z|_]+\)'\) as future_ok/, "(true) as future_ok")],
    ['a view counts as a table of the book',                         all(/ and t\.table_type = 'BASE TABLE'/, '')],
    ['the earliest is taken from the latest column',                 all(/xpath\('\/row\/c' \|\| cols\.k \|\| '_min\/text\(\)'/, "xpath('/row/c' || cols.k || '_max/text()'")],
    ['the filled count is the row count',                            all(/xpath\('\/row\/c' \|\| cols\.k \|\| '_n\/text\(\)'/, "xpath('/row/n/text()'")],
    ['the columns of a table are numbered in no order',              all(/order by c\.ordinal_position\) as k/, 'order by c.column_name) as k')],
    ['only the public tables whose name starts with a letter before m', all(/where c\.table_schema = 'public' and /, "where c.table_schema = 'public' and c.table_name < 'm' and ")],
    ['an old date hides a later one (one flag only, the wrong way round)', all(/case when n_fut > 0 and not future_ok then 'FUTURE\?' when n_old > 0 and not birth then 'OLD\?'/, "case when n_old > 0 and not birth then 'OLD?' when n_fut > 0 and not future_ok then 'FUTURE?'")],
    ['the flagged lines are not first',                               all(/order by case g\.flag when 'FUTURE\?' then 0 when 'OLD\?' then 1 else 2 end, g\.table_name, g\.k/, 'order by g.table_name, g.k')],
    ['the ANSWER counts the wrong flag',                             all(/where flag = 'OLD\?'\)/, "where flag = 'FUTURE?')")],
  ];
  for (const [name, fn] of breaks) {
    const broken = fn(FILE);
    if (broken === FILE) { check('(break "' + name + '" was applied)', false, 'the pattern is not in the file any more'); continue; }
    let differs = false;
    try { differs = show(run(broken).grid) !== base; } catch (err) { differs = true; }                      // a break that makes the file fail is caught too
    check('BROKEN ON PURPOSE, the answer changes: ' + name, differs);
  }
}
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
