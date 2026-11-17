/* db/RUN-ME-072 (who the Advance report prints with no account), db/RUN-ME-073 (the call-agents roster against the registry) and db/TEMPLATE-link-advance-requests-to-staff.sql: the lines that
   make them safe and true, pinned (docs/HANDOFF.md Part 109).

     "the missing account numbers at advance salary tabs automatically fill themselves? ... finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026

   Node cannot run SQL: the check that does (tools/db-checks/advance-blanks.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql: every answer against a model written again, row by row, and a list
   of deliberate breaks of each file that must each change an answer) is the proof. This file is the guard that a later edit does not part company with the code these files imitate: the report's rule for
   "a blank account" and its join to the registry (api/_lib/portal-core.js `advReport`, `advAccountOf_`), the request tab's rule for "this roster name has a registry row" (`advRequestPage`), the one definition
   of "an account" (api/_lib/parse.js `hasAccount`), and the columns the tables really have (db/schema.sql). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const A = rd('db/RUN-ME-072-advance-report-blank-accounts-read-only.sql');
const B = rd('db/RUN-ME-073-call-agents-roster-vs-registry-read-only.sql');
const C = rd('db/TEMPLATE-link-advance-requests-to-staff.sql');
const CHECK = rd('tools/db-checks/advance-blanks.mjs');
const SCHEMA = rd('db/schema.sql');
const PORTAL = rd('api/_lib/portal-core.js');
const PARSE = rd('api/_lib/parse.js');
const CHAT = rd('CHAT.md');
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const squash = s => s.replace(/\s+/g, ' ');
const jsCode = f => { let out = '', i = 0, q = null;
  while (i < f.length) {
    const c = f[i], n = f[i + 1];
    if (q) { out += c; if (c === '\\') { out += n; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < f.length && f[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = f.indexOf('*/', i + 2); i = e < 0 ? f.length : e + 2; continue; }
    out += c; i++;
  }
  return out; };
const CA = code(A), CB = code(B), CC = code(C), CK = jsCode(CHECK);
const ddl = name => { const i = SCHEMA.indexOf('create table if not exists ' + name + ' ('); return SCHEMA.slice(i, SCHEMA.indexOf('\n);', i)); };
const cols = t => [...ddl(t).matchAll(/(?:^|[\s,(])([a-z_0-9]+)\s+(?:text|uuid|date|timestamptz|numeric|integer|boolean|bigint)\b/g)].map(m => m[1]);
const tablesOf = s => [...new Set([...noStrings(s).matchAll(/\b(?:from|join)\s+public\.([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].sort();

test('RUN-ME-072 and RUN-ME-073 are read-only: no statement that writes, the two settings, and only the tables they name', () => {
  for (const [name, c] of [['072', CA], ['073', CB]]) {
    assert.doesNotMatch(noStrings(c), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|vacuum|copy|call|do)\b/i, name + ' changes nothing');
    assert.match(c, /^\s*set local statement_timeout = '20s';/m, name + ' has a ceiling');
    assert.match(c, /^\s*set local jit = off;/m, name + ' does not compile');
  }
  assert.deepEqual(tablesOf(CA), ['advance_requests', 'staff_registry']);
  assert.deepEqual(tablesOf(CB), ['advance_requests', 'call_agents', 'staff_registry']);
});

test('072 is the report\'s own rule for a blank: the request\'s copy is not an account AND the registry\'s is not, "not an account" being parse.js hasAccount, and the registry is joined by the staff ID as the report joins it', () => {
  assert.match(PARSE, /export function hasAccount\(v\) \{ return \/\[1-9\]\/\.test\(String\(v == null \? '' : v\)\); \}/, 'the one definition of "an account" is a digit other than zero');
  assert.equal([...CA.matchAll(/!~ '\[1-9\]'/g)].length, 2, 'both the request copy and the registry account are read by it');
  assert.match(squash(CA), /where coalesce\(q\.copy_, ''\) !~ '\[1-9\]' and coalesce\(r\.account, ''\) !~ '\[1-9\]'/);
  // the report: the request's own copy first when it is an account, else the registry's: so blank only when neither is
  assert.match(PORTAL, /const advAccountOf_ = \(r, s\) => \(hasAccount\(r\.account\) \? r\.account : hasAccount\(s\.account\) \? s\.account : \(r\.account \|\| s\.account \|\| null\)\);/);
  // the report reads the registry by K(staff_id) (trimmed, upper-cased); 072 joins the same way
  assert.match(PORTAL, /const regBy = new Map\(reg\.map\(r => \[K\(r\.id\), r\]\)\);/);
  assert.match(PORTAL, /const s = regBy\.get\(K\(r\.staff_id\)\) \|\| \{\}; return \{ \.\.\.r, bank: s\.bank \|\| null, account: advAccountOf_\(r, s\)/);
  assert.match(squash(CA), /left join public\.staff_registry r on upper\(btrim\(r\.id\)\) = upper\(btrim\(q\.staff_id\)\)/);
});

test('072 reads the report\'s window and states: the days a request was SUBMITTED, as UTC days to the last millisecond, Approved by default, ALL or one state compared trimmed and upper-cased', () => {
  assert.match(squash(PORTAL), /const winQ = \(\) => \{ const q = db\.from\('advance_requests'\)\.select\('\*'\)\.gte\('submitted_at', fromKey\)\.lte\('submitted_at', toKey \+ 'T23:59:59\.999Z'\)/, 'the report\'s window is in the code 072 imitates');
  assert.match(squash(CA), /\(current_setting\('hope\.from_day'\) \|\| 'T00:00:00Z'\)::timestamptz as t1, \(current_setting\('hope\.to_day'\) \|\| 'T23:59:59\.999Z'\)::timestamptz as t2/);
  assert.match(squash(CA), /where a\.submitted_at >= cfg\.t1 and a\.submitted_at <= cfg\.t2 and \(cfg\.ap = 'ALL' or upper\(btrim\(a\.approval\)\) = cfg\.ap\)/);
  assert.match(A, /^set local hope\.from_day = '2026-11-01';\s+-- CHANGE/m);
  assert.match(A, /^set local hope\.to_day = '2026-11-30';\s+-- CHANGE/m);
  assert.match(A, /^set local hope\.approval = 'Approved';\s+-- CHANGE/m, 'the report\'s default state');
});

test('072 prints a demand list and nothing private: ZONE, TEAM, STAFF NAME as RUN-ME-069 prints them, then REQUESTS, TZS and WHY; no account, no phone, no bank, no NIDA; a sort that cannot tie and does not depend on the database\'s collation', () => {
  const out = squash(CA.slice(CA.lastIndexOf('select case when p.rid is not null')));
  assert.deepEqual([...out.matchAll(/ as "([A-Z ]+)"/g)].map(m => m[1]), ['ZONE', 'TEAM', 'STAFF NAME', 'REQUESTS', 'TZS', 'WHY']);
  assert.doesNotMatch(noStrings(out), /\b(account|phone|nida|bank|copy_)\b/i, 'no column of the registry or the request that holds a private number is printed');
  assert.match(out, /order by \(p\.rid is null\), p\.zone0 = '', p\.zone0 collate "C", p\.pkey like 'N:%', \(p\.team0 = ''\), p\.team0 collate "C", p\.name0 collate "C", p\.pkey collate "C";/);
  // the team is what follows the role, as 069 reads it
  const r69 = rd('db/RUN-ME-069-staff-without-bank-account-read-only.sql');
  assert.ok(r69.includes("substring(r.role from '\\s+-\\s+(.*)$')") && A.includes("substring(b.rrole from '\\s+-\\s+(.*)$')"), 'the same team rule as RUN-ME-069');
  assert.match(out, /'NO STAFF ID ON THE REQUEST'/);
  assert.match(out, /'STAFF ID NOT IN THE REGISTRY'/);
  assert.match(out, /and the registry says INACTIVE/);
});

test('072 and 073 name only columns that exist: staff_registry and advance_requests as db/schema.sql creates them; call_agents as the portal reads and writes it (no SQL file of the repository creates it)', () => {
  const req = cols('advance_requests'), reg = cols('staff_registry');
  for (const c of ['submitted_at', 'staff_id', 'staff_name', 'account', 'amount', 'approval']) assert.ok(req.includes(c), 'advance_requests.' + c);
  for (const c of ['id', 'name', 'role', 'zone', 'status', 'account', 'bank']) assert.ok(reg.includes(c), 'staff_registry.' + c);
  for (const c of [...new Set([...CA.matchAll(/\ba\.([a-z_]+)/g)].map(m => m[1]))]) assert.ok(req.includes(c), '072 reads advance_requests.' + c);
  for (const c of [...new Set([...CA.matchAll(/\br\.([a-z_]+)/g)].map(m => m[1]))]) assert.ok(reg.includes(c), '072 reads staff_registry.' + c);
  for (const c of [...new Set([...CB.matchAll(/\br\.([a-z_]+)/g)].map(m => m[1]))]) assert.ok(reg.includes(c), '073 reads staff_registry.' + c);
  for (const c of [...new Set([...CB.matchAll(/\ba\.([a-z_]+)/g)].map(m => m[1]))]) assert.ok(req.includes(c), '073 reads advance_requests.' + c);
  assert.deepEqual([...new Set([...CB.matchAll(/\bc\.([a-z_]+)/g)].map(m => m[1]))], ['names'], '073 reads call_agents.names');
  assert.ok(!/create table (?:if not exists )?(?:public\.)?call_agents/i.test(SCHEMA), 'schema.sql still does not create call_agents: the check declares it by hand, and says why');
  assert.match(PORTAL, /cs \? advRead_\(\(\) => db\.from\('call_agents'\)\.select\('user_id, names'\)\) : \[\],/, 'the Advance request tab reads user_id and names');
  assert.match(PORTAL, /const agents = await advRead_\(\(\) => db\.from\('call_agents'\)\.select\('names'\)\);/, 'and so does the request that picks a name');
  assert.match(PORTAL, /\{ user_id: id, names: String\(\(p && p\.names\) \|\| ''\)\.trim\(\) \|\| null, updated_at: new Date\(\)\.toISOString\(\) \}/, 'the portal saves names as one text');
});

test('073 is the request tab\'s own test: a roster name has a registry row only when K(name) is the same, K being trim and upper-case and nothing else; the roster is split on commas and semicolons; Inactive records do not count', () => {
  assert.match(PORTAL, /const K = s => String\(s == null \? '' : s\)\.trim\(\)\.toUpperCase\(\);/);
  assert.match(PORTAL, /const advAgentNames_ = agentRows => \[\.\.\.new Set\(\(agentRows \|\| \[\]\)\.flatMap\(a => String\(a\.names \|\| ''\)\.split\(\/\[,;\]\/\)\.map\(s => s\.trim\(\)\)\.filter\(Boolean\)\)\)\]/);
  assert.equal([...PORTAL.matchAll(/const regBy = new Map\(zoneStaff\.map\(r => \[K\(r\.name\), r\]\)\);/g)].length, 2, 'the Advance request tab and the Leave request tab both match a roster name this way');
  assert.equal([...PORTAL.matchAll(/zoneStaff = \(staff0 \|\| \[\]\)\.concat\(deptStaff0 \|\| \[\]\)\.filter\(r => K\(r\.status\) !== 'INACTIVE'/g)].length, 2, 'an Inactive record is not offered, on the Advance tab and on the Leave tab');
  assert.match(squash(CB), /upper\(btrim\(r\.name, E' \\t\\r\\n'\)\) as k/, 'the registry side: trimmed and upper-cased, the blanks inside kept');
  assert.match(squash(CB), /select ro\.raw, upper\(ro\.raw\) as k,/, 'the roster side: the same');
  assert.match(squash(CB), /select distinct upper\(btrim\(n, E' \\t\\r\\n'\)\) as raw from public\.call_agents c, regexp_split_to_table\(coalesce\(c\.names, ''\), '\[,;\]'\) n where btrim\(n, E' \\t\\r\\n'\) <> ''/);
  assert.match(squash(CB), /where upper\(btrim\(coalesce\(r\.status, ''\)\)\) <> 'INACTIVE'/);
  assert.match(squash(CB), /hit as \( select x\.raw, g\.id, g\.has_acc, g\.has_bank from x join reg g on g\.k = x\.k \)/);
});

test('073 prints who the tab does not find first, with the records that carry every word and the department\'s that share one, and chooses nobody', () => {
  const out = squash(CB.slice(CB.lastIndexOf('select x.nm')));
  assert.deepEqual([...out.matchAll(/ as ([a-z_]+)\b/g)].map(m => m[1]).filter(a => ['roster_name', 'the_tab', 'requests_with_no_staff_id', 'registry'].includes(a)), ['roster_name', 'the_tab', 'requests_with_no_staff_id', 'registry']);
  assert.match(out, /order by \(h\.raw is not null\), x\.nm collate "C", x\.raw collate "C";/, 'not found first, in an order that does not depend on the database');
  assert.match(squash(CB), /every as \( select x\.raw, g\.id, g\.nm, g\.role, g\.zone, g\.has_acc, \(g\.nm = x\.nm\) as same_words from x join reg g on not exists \(select 1 from unnest\(x\.w\) y where strpos\(g\.nm, y\) = 0\)/);
  assert.match(squash(CB), /on upper\(coalesce\(g\.zone, ''\)\) like '%CUSTOMER%' and exists \(select 1 from unnest\(g\.w\) a join unnest\(x\.w\) b on a = b\)/);
  assert.doesNotMatch(out, /\b(nida|phone)\b/i);
  assert.match(CB, /\(the same words: only the blanks differ\)/);
  assert.match(squash(CB), /from public\.advance_requests a where a\.staff_id is null and upper\(btrim\(regexp_replace\(a\.staff_name/, 'the requests counted are those filed with no staff ID, and only those');
});

test('the link template writes the staff ID of a request and nothing else, and only when all four conditions hold; it logs, it keeps the old value for the undo, and it names nobody', () => {
  const c = noStrings(CC);
  assert.deepEqual([...c.matchAll(/\b(insert\s+into|update|delete\s+from|drop|alter|truncate|create)\s+(?:table\s+(?:if\s+not\s+exists\s+)?)?(public\.[a-z_]+)/gi)].map(m => (m[1] + ' ' + m[2]).toLowerCase().replace(/\s+/g, ' ')).sort(),
    ['alter public.advance_requests_link_log', 'create public.advance_requests_link_log', 'insert into public.advance_requests_link_log', 'update public.advance_requests']);
  assert.deepEqual([...squash(CC).matchAll(/update public\.advance_requests a set ([a-z_]+) = /g)].map(m => m[1]), ['staff_id'], 'the update sets the staff ID and no other column');
  assert.doesNotMatch(squash(CC), /\bset staff_id = [a-z_.]+\s*,/i, 'nothing else is set beside it');
  // the four conditions: (1) no staff ID, in the select and again in the update; (2) the name; (3) an Active record carrying every word; (4) the only one
  assert.equal([...squash(CC).matchAll(/a\.staff_id is null or btrim\(a\.staff_id\) = ''/g)].length, 2, 'the "no staff ID" guard is in the choice of rows and in the write');
  assert.match(squash(CC), /join w on upper\(btrim\(regexp_replace\(a\.staff_name, '\\s\+', ' ', 'g'\)\)\) = w\.key/);
  assert.match(squash(CC), /join public\.staff_registry r on upper\(btrim\(coalesce\(r\.status, ''\)\)\) <> 'INACTIVE' and not exists \(select 1 from unnest\(w\.words\) x where strpos\(upper\(r\.name\), x\) = 0\)/);
  assert.match(squash(CC), /ok as \(select n, staff_id from chk where n_carrying = 1 and is_it = 1\)/);
  assert.match(squash(CC), /upper\(btrim\(staff_id\)\) as staff_id/, 'the ID the owner types is read trimmed and upper-cased, as a staff ID is stored');
  // the log keeps the first line of a request and its old value; the undo reads it; the log is private
  assert.match(squash(CC), /insert into public\.advance_requests_link_log \(id, staff_name, staff_id_before, staff_id_new\) select t\.id, t\.staff_name, t\.staff_id_was, t\.staff_id from todo t on conflict \(id\) do nothing/);
  assert.match(CC, /alter table public\.advance_requests_link_log enable row level security;/);
  assert.match(C, /^-- update public\.advance_requests a set staff_id = l\.staff_id_before from public\.advance_requests_link_log l where a\.id = l\.id and a\.staff_id = l\.staff_id_new;$/m, 'the undo puts the old value back');
  // its answer says what it did, and what it refused and why
  for (const w of ["'LINKED '", "'NOTHING TO LINK: no request of this name is without a staff ID'", "'NOT LINKED: no Active record carries every word of this name (nothing changed)'", "'NOT LINKED: that staff ID is not an Active record carrying every word of the name (nothing changed)'", 'the script never chooses (nothing changed)']) assert.ok(C.includes(w.replace(/^'|'$/g, '')), w);
  // a template: two sample rows that name nobody; no staff name and no staff ID written in it
  assert.match(C, /\(1, 'FIRST SURNAME', 'AAA\/0000\/2026'\)/);
  assert.match(C, /\(2, 'SECOND SURNAME', 'AAA\/0001\/2026'\)/);
  assert.equal([...C.matchAll(/'[A-Z]{2,4}\/\d{1,5}\/20\d\d'/g)].length, 2, 'no staff ID but the two samples');
});

test('the files name the owner\'s words and the Part, and the three say what a blank account is the same way', () => {
  for (const f of [A, B, C]) assert.match(f, /the missing account numbers at advance salary tabs automatically fill themselves\?/);
  assert.match(A, /docs\/HANDOFF\.md Part 102/);
  assert.match(C, /docs\/HANDOFF\.md Part 109/);
  assert.match(A, /RUN-ME-073 shows/, '072 points at the roster check');
  assert.match(B, /ONLY WHEN\s*\n-- THE ROSTER'S NAME AND AN ACTIVE REGISTRY NAME ARE THE SAME LETTERS AND BLANKS/);
});

test('the kept check: it runs the three files from the repository, on the whole schema, with a made-up roster; every file has its deliberate breaks and a model; and no real name is in it', () => {
  assert.match(CK, /const SCHEMA = rd\('db\/schema\.sql'\);/);
  assert.match(CK, /psql\(SCHEMA\);/, 'the whole schema, not three tables written by hand');
  assert.match(CK, /rd\('db\/RUN-ME-072-advance-report-blank-accounts-read-only\.sql'\)/);
  assert.match(CK, /rd\('db\/RUN-ME-073-call-agents-roster-vs-registry-read-only\.sql'\)/);
  assert.match(CK, /rd\('db\/TEMPLATE-link-advance-requests-to-staff\.sql'\)/);
  assert.match(CK, /create table public\.call_agents \(user_id text primary key, names text, updated_at timestamptz\)/);
  const breaks = s => (CK.match(new RegExp('const breaks' + s + ' = \\[([\\s\\S]*?)\\n\\];')) || [, ''])[1].split('\n').filter(l => /^\s*\['/.test(l)).length;
  assert.ok(breaks('A') >= 15, 'at least fifteen breaks of 072: ' + breaks('A'));
  assert.ok(breaks('B') >= 11, 'at least eleven breaks of 073: ' + breaks('B'));
  assert.ok(breaks('C') >= 11, 'at least eleven breaks of the template: ' + breaks('C'));
  for (const lbl of ['the registry join is exact-case', 'the window ends a day early', 'only the request copy is read', 'only the registry account is read', 'a copy of zeros counts as an account']) assert.ok(CK.includes(lbl), lbl);
  for (const lbl of ['the tab is read case-sensitively', 'an Inactive record counts', 'the same name on two rows is two lines', 'the department test is dropped']) assert.ok(CK.includes(lbl), lbl);
  for (const lbl of ['an ID already on a request is overwritten', 'two records may carry the words', 'the named ID need not carry the words', 'an Inactive record is linked', 'the old ID is not kept']) assert.ok(CK.includes(lbl), lbl);
  assert.match(CK, /need\(strip\(colsHash\(\)\) === strip\(before\), `C \$\{label\}: another column of a request changed`\);/, 'it checks that nothing but the staff ID changed');
  assert.match(CK, /the undo restores every staff ID/);
  assert.match(CK, /a second run changed something/);
  assert.ok(CK.includes('the files list who prints blank'), 'it ends on a line that says what passed');
  // CK is the check with its comments stripped: the pins above read code, not the header
  assert.ok(CK.length < CHECK.length);
});

test('CHAT.md says where the three files are and what they are for', () => {
  for (const w of ['RUN-ME-072', 'RUN-ME-073', 'TEMPLATE-link-advance-requests-to-staff.sql']) assert.ok(CHAT.includes(w), 'CHAT.md names ' + w);
});
