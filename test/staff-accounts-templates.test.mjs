/* db/TEMPLATE-staff-accounts-by-name.sql, db/TEMPLATE-link-advance-requests-by-registry-name.sql and db/TEMPLATE-call-agents-roster-to-registry.sql: the lines that make them safe and true, pinned
   (docs/HANDOFF.md Part 110).

     "Customer service staff accounts" -- the owner, 17 Nov 2026 (twelve people with their bank and account)
     "the missing account numbers at advance salary tabs automatically fill themselves? ... finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026
     "some info should be filled into their columns if missing or replace if existing since the provided is latest" -- the owner, 17 Nov 2026

   Node cannot run SQL: the two checks that do (tools/db-checks/staff-accounts-by-name.mjs and tools/db-checks/staff-accounts-link-and-roster.mjs, run by hand on a PostgreSQL over the WHOLE of
   db/schema.sql: every answer and every row against a model written again, a second run, the undo from the file's own comment lines, and a list of deliberate breaks that must each change an answer) are
   the proof. This file is the guard that a later edit does not part company with them: what each template may write, the guards in front of every write, the engine it shares with
   db/TEMPLATE-staff-update-by-id.sql (one definition of "filled, replaced, same"), the rule the request tab matches a roster name by (api/_lib/portal-core.js), the copy kept before a change and the
   undo that reads it, and that no real person is written in any of them: this repository is public. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const D = rd('db/TEMPLATE-staff-accounts-by-name.sql');
const U = rd('db/TEMPLATE-staff-update-by-id.sql');
const L = rd('db/TEMPLATE-link-advance-requests-by-registry-name.sql');
const L0 = rd('db/TEMPLATE-link-advance-requests-to-staff.sql');
const R = rd('db/TEMPLATE-call-agents-roster-to-registry.sql');
const CHECK_D = rd('tools/db-checks/staff-accounts-by-name.mjs');
const CHECK_L = rd('tools/db-checks/staff-accounts-link-and-roster.mjs');
const PORTAL = rd('api/_lib/portal-core.js');
const CHAT = rd('CHAT.md');
const HANDBOOK = rd('docs/HANDOFF.md');
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const squash = s => s.replace(/\s+/g, ' ').trim();
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
const CD = code(D), CL = code(L), CR = code(R), SD = squash(CD), SU = squash(code(U)), SL = squash(CL), SR = squash(CR);
const KD = jsCode(CHECK_D), KL = jsCode(CHECK_L);
const has = (s, frag, msg) => assert.ok(s.includes(frag), (msg || 'the file says') + ': ' + frag.slice(0, 160));
const writesOf = c => [...noStrings(c).matchAll(/\b(insert\s+into|update|delete\s+from|drop|alter|truncate|create)\s+(?:table\s+(?:if\s+not\s+exists\s+)?)?(?:public\.)?([a-z_]+)/gi)]
  .map(m => (m[1] + ' ' + m[2]).toLowerCase().replace(/\s+/g, ' ')).sort();
const blk = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, 'found ' + a); const j = s.indexOf(b, i + a.length); assert.ok(j > i, 'found ' + b + ' after ' + a); return s.slice(i, j); };
const labelOf = s => (s.match(/select '([^']+)'::text as label/) || [])[1];
const undoOf = s => squash(s.split('\n').filter(l => /^-- (update|  from|  where|  guarantor1|delete)/.test(l)).map(l => l.replace(/^-- /, '')).join('\n'));
const breaksOf = (src, name) => (src.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\n\\];')) || [, ''])[1].split('\n').filter(l => /^\s*\['/.test(l)).length;

test('the accounts template writes the staff registry and its own copy table and nothing else, and never the role, the zone, the status or the ID of a staff it finds', () => {
  assert.deepEqual(writesOf(CD), ['alter staff_registry_update_before', 'create staff_registry_update_before', 'insert into staff_registry', 'insert into staff_registry_update_before', 'update staff_registry']);
  assert.doesNotMatch(noStrings(CD), /\b(delete|drop|truncate)\b/i, 'the undo is a comment: the code deletes nothing');
  const i = SD.indexOf('update staff_registry s set');
  assert.ok(i >= 0);
  const set = SD.slice(i, SD.indexOf(' from todo t', i));
  const columns = [...set.matchAll(/(?:\bset|,)\s+([a-z_0-9]+)\s*=/g)].map(m => m[1]);
  assert.deepEqual(columns, ['name', 'phone', 'phone2', 'bank', 'account', 'nida', 'tin', 'nssf', 'birth_date', 'residence', 'reg_date', 'guarantor1', 'guarantor1_phone', 'guarantor2', 'guarantor2_phone', 'updated_by', 'updated_at'],
    'the update sets the fifteen boxes of a form and who and when, and no role, zone, status or ID');
  // each box is written only where the row GAVE it and it was filled or replaced: the same, or a box the row leaves null, is not touched; it falls back to itself
  const guarded = [...set.matchAll(/([a-z_0-9]+) = case when t\.k->>'([^']+)' in \('filled', 'replaced'(?:, 'cleared')?\) then [^,]+? else s\.\1 end/g)].map(m => m[1]);
  assert.deepEqual(guarded, columns.slice(0, 15), 'every box is written only when it was filled or replaced (a guarantor\'s phone, also when cleared), else it keeps itself');
  assert.equal([...set.matchAll(/'cleared'/g)].length, 2, 'only the two guarantor phones can be cleared (a name replaced by another person)');
  has(set, "updated_by = (select label from cfg), updated_at = now()", 'who changed it is the label, and when');
});

test('the accounts template finds a person by staff ID AND the name the registry carries, or by the EXACT name of one ACTIVE record; nobody else is written', () => {
  has(SD, 'res as ( select a.n, count(*) filter (where r.live) as live_n, count(r.id) as all_n, min(r.id) filter (where r.live) as live_id,');
  has(SD, 'from ak a left join rg r on a.id is null and r.k = a.k group by a.n', 'a row with no ID is matched by the whole name, never a part of it');
  has(SD, "upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE' as live", 'a record is Active unless the registry says INACTIVE');
  has(SD, 'select a.n, case when a.nth > 1 then null else coalesce(upper(btrim(a.id)), case when r.live_n = 1 then r.live_id end) end as id', 'the ID typed (trimmed, upper-cased), else the only Active record of the name; a name listed twice is applied once');
  has(SD, 'row_number() over (partition by coalesce(upper(btrim(s.id)), s.k) order by s.n) as nth');
  has(SD, "(b.sid is not null and b.s_k in (b.cur_k, coalesce(b.new_k, b.cur_k))) as ok", 'the ID guard: the staff carries the name written, before or after the rename');
  has(SD, 'todo as (select c.*, p.k from c join per p on p.n = c.n and p.id = c.id where c.ok and p.changed > 0)', 'only a person who passed the guard and has something to change');
  has(SD, 'from todo t where s.id = t.sid returning s.id', 'the write is by the staff ID the guard passed');
  for (const w of ["'NO STAFF WITH THAT ID: nothing changed'", "'THAT ID CARRIES ANOTHER NAME ('", "' ACTIVE RECORDS CARRY THIS NAME ('", "'NOT CHANGED: THE ONLY RECORD WITH THIS NAME IS INACTIVE ('", "'LISTED TWICE: this row repeats an earlier one: nothing changed'", "'NOTHING TO CHANGE: the registry already holds all of it'"]) has(SD, w, 'the answer says what it refused and why');
  has(SD, "when r.live_n >= 2 then 'NOT CHANGED: ' || r.live_n ||", 'two Active records of one name are never touched');
});

test('the accounts template adds a person only when nobody is close and the department\'s zone is filed; somebody close is LISTED, never merged; the role is the line marked CHANGE', () => {
  has(SD, "where a.id is null and a.nth = 1 and r.all_n = 0 and length(x.w) >= 3", 'the words of a person nobody was found for: no ID, the first row, no record of the exact name at all (not even an Inactive one)');
  has(SD, "where a.id is null and a.nth = 1 and rs.all_n = 0) x", 'the same account on another record is read only for such a row');
  has(SD, "join rg r on length(ltrim(regexp_replace(upper(coalesce(a.account, '')), '[^A-Z0-9]', '', 'g'), '0')) >= 8 and r.akey = ltrim(regexp_replace(upper(coalesce(a.account, '')), '[^A-Z0-9]', '', 'g'), '0')", 'a close record: the same account of eight characters or more, leading zeros aside');
  has(SD, 'from nw where nw.near_n >= 2', 'two words of the name the same or one letter apart');
  has(SD, 'abs(length(aw.w) - length(rw.w)) <= 1 and (left(aw.w, 1) = left(rw.w, 1) or right(aw.w, 1) = right(rw.w, 1))');
  has(SD, ">= greatest(length(aw.w), length(rw.w)) - 1)", 'one letter apart: the common beginning and end cover all but one letter');
  has(SD, 'where k.id is null and k.nth = 1 and r.all_n = 0 and not exists (select 1 from cands cd where cd.n = a.n)', 'added only when no record of the name and nobody close');
  has(SD, 'from newrows n where n.zone is not null', 'added only when the department\'s zone is already filed');
  has(SD, "(select z.zone from zones z where z.key = regexp_replace(upper((select new_zone from cfg)), '[^A-Z0-9]', '', 'g')) as zone");
  has(SD, "n.nida_d, n.birth, n.kin1, n.kin1_phone9, n.kin2, n.kin2_phone9, n.tin_d, n.nssf_d, 'Active', (select label from cfg), (select label from cfg), now()", 'an added staff is Active and carries the label as the one who created it: the undo finds them by it');
  has(SD, "(select new_role from cfg)", 'the role of an added staff is the line marked CHANGE');
  has(D, "'CALL AGENT'::text as new_role,", 'the role and the department are the Customer Service ones the owner asked for');
  has(D, "'HQ - CUSTOMER SERVICE'::text as new_zone");
  has(SD, "when l.cnt > 0 then 'NOT CHANGED: NOT FOUND UNDER THIS NAME; THE CLOSE RECORDS ARE LISTED'");
  has(SD, "when ni.id is not null then 'ADDED' else 'NOT ADDED: no zone named '");
  // the next staff ID: initials of up to three words / a number past every number in use and past the count of rows / the year in East Africa
  has(SD, "select greatest(count(*), coalesce(max(case when split_part(id, '/', 2) ~ '^\\d{1,6}$' then split_part(id, '/', 2)::int end), 0)) as top from staff_registry");
  has(SD, "to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY') as id");
  has(SD, 'order by x.pos limit 3) w) as initials');
});

test('the accounts template never guesses a bank from an account number: a bank is written only from the bank the row gives, and a row with an account and no bank says so', () => {
  assert.doesNotMatch(CD, /\b(CRDB|NMB|NBC|DTB|EXIM|AMANA|ECOBANK|STANBIC|AZANIA|ABSA|EQUITY|TPB|KCB|ACCESS)\b/i, 'no bank is named in the code');
  assert.doesNotMatch(noStrings(CD), /\bcase when [^,]*account[^,]* (?:like|~|similar to)/i, 'no test of an account number decides a bank');
  has(SD, "bank = case when t.k->>'bank' in ('filled', 'replaced') then btrim(t.bank) else s.bank end");
  has(SD, "(4, 'bank', c.o_bank, upper(nullif(btrim(c.bank), '')), nullif(btrim(c.bank), '') is not null)", 'a bank is a box like another: only when the row gives it');
  has(SD, "btrim(n.bank), n.account, n.zone", 'an added staff gets the row\'s own bank');
  has(SD, "'the account has no bank name on the row or in the registry'");
  has(SD, "'the account has no bank name on the row'");
  has(SD, "'NIDA NOT written: it has '", 'and a NIDA that is not twenty digits is not written (the by-ID rule)');
});

test('the accounts template shares the update engine of TEMPLATE-staff-update-by-id.sql, word for word: the same boxes, the same filled / replaced / same, the same copy table and the same write', () => {
  for (const [a, b] of [['a2 as (', 'b as ('], ['cols as (', 'per as ('], ['per as (', 'todo as ('], ['todo as (', 'snap as ('], ['snap as (', 'upd as (']])
    assert.equal(blk(SD, a, b), blk(SU, a, b), 'the block ' + a + ' is the by-ID template\'s');
  const upd = s => { const i = s.indexOf('upd as ('); return s.slice(i, s.indexOf('returning s.id', i) + 14); };
  assert.equal(upd(SD), upd(SU), 'the write is the by-ID template\'s');
  const table = s => { const i = s.indexOf('create table if not exists public.staff_registry_update_before'); return s.slice(i, s.indexOf('enable row level security;', i) + 26); };
  assert.equal(table(SD), table(SU), 'the copy table has the by-ID template\'s columns: the undo of either reads the other\'s copies');
  assert.ok(table(SD).includes('updated_by text, updated_at timestamptz'));
});

test('the accounts template copies a staff before it changes, once for each label, and the undo at the foot puts back what was copied and removes what was added, under the same label', () => {
  has(SD, "insert into public.staff_registry_update_before (id, label, name, phone, phone2, bank, account, nida, tin, nssf, birth_date, residence, reg_date, guarantor1, guarantor1_phone, guarantor2, guarantor2_phone, updated_by, updated_at) select s.id, (select label from cfg),");
  has(SD, "from staff_registry s join todo t on t.sid = s.id where not exists (select 1 from public.staff_registry_update_before z where z.id = s.id and z.label = (select label from cfg)) returning id", 'a second run never copies the changed row over the first copy');
  const lbl = labelOf(D);
  assert.ok(lbl && /\(SQL\)$/.test(lbl), 'the label is on one line marked CHANGE: ' + lbl);
  assert.equal([...D.matchAll(new RegExp("'" + lbl.replace(/[()]/g, '\\$&') + "'", 'g'))].length, 3, 'the label is on its line and in each of the two undo statements, and nowhere else');
  const undo = undoOf(D);
  has(undo, "delete from public.staff_registry where created_by = '" + lbl + "';", 'the undo removes the staff this run added');
  has(undo, "from public.staff_registry_update_before b where b.id = s.id and b.label = '" + lbl + "';", 'the undo puts back the copies of this label');
  has(undo, 'update public.staff_registry s set name = b.name, phone = b.phone, phone2 = b.phone2, bank = b.bank, account = b.account, nida = b.nida, tin = b.tin, nssf = b.nssf, birth_date = b.birth_date, residence = b.residence, reg_date = b.reg_date, guarantor1 = b.guarantor1, guarantor1_phone = b.guarantor1_phone, guarantor2 = b.guarantor2, guarantor2_phone = b.guarantor2_phone, updated_by = b.updated_by, updated_at = b.updated_at');
  const undoU = undoOf(U).replace(/'[^']*'/g, "'L'");
  assert.equal(undo.replace(/delete from public\.staff_registry where created_by = '[^']*';/, '').replace(/'[^']*'/g, "'L'").replace(/\s+/g, ' ').trim(), undoU.replace(/\s+/g, ' ').trim(), 'the undo of the update is the by-ID template\'s');
});

test('the accounts template is a template: three sample rows that name nobody, no staff ID or number but the samples, plain ASCII, the three settings and the owner\'s words', () => {
  const ask = D.slice(D.indexOf('ask(n, id, cur_name'), D.indexOf('ak0 as ('));
  assert.equal((ask.match(/^\s+\(\d+,/gm) || []).length, 3, 'three sample rows');
  has(ask, "'FIRST MIDDLE LAST'");
  has(ask, "'SECOND MIDDLE LAST'");
  has(ask, "'OLD NAME AS FILED', 'NAME AS SENT'");
  assert.deepEqual([...D.matchAll(/'[A-Z]{2,4}\/\d{1,5}\/20\d\d'/g)].map(m => m[0]), ["'ABC/0001/2026'", "'ABC/0002/2026'"], 'no staff ID but the two samples');
  assert.deepEqual([...D.matchAll(/'(\d{8,})'/g)].map(m => m[1]).sort(), ['0000000000', '0000000001', '0000000002', '0700000000'], 'no account or phone but the samples');
  for (const [name, f] of [['accounts template', D], ['link template', L], ['roster template', R], ['accounts check', CHECK_D], ['link and roster check', CHECK_L]]) assert.doesNotMatch(f, /[^\x00-\x7F]/, name + ' is plain ASCII: a pasted curly quote or dash is an invisible fault');
  for (const [name, f] of [['accounts template', D], ['link template', L], ['roster template', R]]) {
    assert.match(f, /^set local lock_timeout = '5s';$/m, name + ' waits for no lock longer than 5 seconds');
    assert.match(f, /^set local statement_timeout = '(?:30|60)s';$/m, name + ' has a ceiling');
    assert.match(f, /^set local jit = off;$/m, name + ' does not compile');
  }
  for (const f of [D, L, R]) assert.match(f, /docs\/HANDOFF\.md Parts? (?:\d+ and )?110\b/, 'the file names its Part');
  assert.match(D, /"Customer service staff accounts" -- the owner, 17 Nov 2026/);
  assert.match(D, /"some info should be filled into their columns if missing or replace if existing since the provided is latest"/);
  assert.match(L, /"the missing account numbers at advance salary tabs automatically fill themselves\?/);
  assert.match(R, /"the missing account numbers at advance salary tabs automatically fill themselves\?/);
  assert.match(D, /NO STAFF NAME, NUMBER OR ACCOUNT IS EVER COMMITTED/);
});

test('the link template writes the staff ID of a request and nothing else, only on a request with none, only to the ONLY Active record that carries the name exactly and has a word in common; it logs the old value and the undo reads it', () => {
  assert.deepEqual(writesOf(CL), ['alter advance_requests_link_log', 'create advance_requests_link_log', 'insert into advance_requests_link_log', 'update advance_requests']);
  assert.deepEqual([...SL.matchAll(/update public\.advance_requests a set ([a-z_]+) = /g)].map(m => m[1]), ['staff_id'], 'the update sets the staff ID and no other column');
  has(SL, 'update public.advance_requests a set staff_id = t.rid from todo t where a.id = t.id and (a.staff_id is null or btrim(a.staff_id) = \'\')');
  assert.equal([...SL.matchAll(/a\.staff_id is null or btrim\(a\.staff_id\) = ''/g)].length, 2, 'the "no staff ID" guard is in the choice of rows and again in the write');
  has(SL, "join w on upper(btrim(regexp_replace(a.staff_name, '\\s+', ' ', 'g'))) = w.rkey join ok on ok.n = w.n", 'the request\'s name is the whole name, blanks collapsed, capitals aside');
  has(SL, 'from w left join reg r on r.k = w.gk group by w.n', 'the person is the record whose name is exactly the one written (marks aside)');
  has(SL, "select s.id, s.name, upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE' as live,", 'Active or not');
  has(SL, 'count(*) filter (where r.live) as live_n, min(r.id) filter (where r.live) as rid');
  has(SL, 'ok as (select n, rid from pick where live_n = 1 and word_ok)', 'exactly one Active record, and a word of the request\'s name in it');
  has(SL, 'where length(x) >= 3 and length(y) >= 3 and abs(length(x) - length(y)) <= 1');
  has(SL, '>= greatest(length(x), length(y)) - 1)) as word_ok', 'a word of the name the same or one letter apart');
  for (const w of ["'LINKED '", "'NOTHING TO LINK: no request of this name is without a staff ID'", "'NOT LINKED: no Active record is named exactly so (add the person first, or write the name as the registry spells it)'", "the script never chooses", "'NOT LINKED: no word of the request''s name is in the registry name (nothing changed)'"]) assert.ok(CL.includes(w), 'the answer says ' + w);
  // the log keeps the first line of a request and its old value; it is the log of the other link template: one shape, one undo
  has(SL, 'insert into public.advance_requests_link_log (id, staff_name, staff_id_before, staff_id_new) select t.id, t.staff_name, t.staff_id_was, t.rid from todo t on conflict (id) do nothing');
  const table = s => { const i = s.indexOf('create table if not exists public.advance_requests_link_log'); return s.slice(i, s.indexOf('enable row level security;', i) + 26); };
  assert.equal(squash(table(CL)), squash(table(code(L0))), 'the log table is the other link template\'s');
  const undo = f => f.split('\n').filter(l => /^-- update public\.advance_requests a set staff_id = l\.staff_id_before/.test(l))[0];
  assert.ok(undo(L) && undo(L) === undo(L0), 'the undo is the other link template\'s, and it only touches a request still carrying the ID this script wrote');
  has(undo(L), 'a.staff_id = l.staff_id_new;');
  const sample = L.slice(L.indexOf('with want('), L.indexOf('w as ('));
  assert.equal((sample.match(/^\s+\(\d+,/gm) || []).length, 2, 'two sample rows');
  assert.doesNotMatch(L, /'[A-Z]{2,4}\/\d{1,5}\/20\d\d'/, 'no staff ID is written in it: the person is found by the name');
  assert.deepEqual([...L.matchAll(/'(\d{8,})'/g)], [], 'no number in it');
});

test('the roster template changes only a name that is exactly the one given, only to the spelling of the ONLY Active registry record of the new name, keeps the other names and the order, copies first and undoes from the copy', () => {
  assert.deepEqual(writesOf(CR), ['alter call_agents_names_before', 'create call_agents_names_before', 'insert into call_agents_names_before', 'update call_agents']);
  has(SR, 'update public.call_agents c set names = t.new_names, updated_at = now() from todo t where c.user_id = t.user_id and c.names is not distinct from t.old_names', 'the names and the date, and no other column; only a row still as it was read');
  has(SR, "from public.staff_registry s where upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE'", 'an Inactive record is not the registry name');
  has(SR, 'select w.n, w.old_name, count(r.id) as cnt, min(btrim(r.name)) as spelled from w left join reg r on r.k = w.nk group by w.n, w.old_name', 'the registry\'s own spelling, trimmed only: the tab matches a name by trim and capitals alone');
  has(SR, "regexp_split_to_table(coalesce(c.names, ''), '[,;]') with ordinality as p(part, ord)", 'the roster is split on commas and semicolons, in order, like the portal reads it');
  has(SR, "where regexp_replace(upper(pa.part), '\\s+', ' ', 'g') = w.ok_ and t.cnt = 1 limit 1), pa.part) as new_part", 'a name is replaced only when it is the one given (blanks collapsed, capitals aside) and the registry has exactly one record of the new name');
  has(SR, "string_agg(m.new_part, ', ' order by m.ord) as new_names, bool_or(m.new_part <> m.part) as changes");
  has(SR, 'todo as (select r.* from rows_ r where r.changes)', 'a row none of whose names was replaced is not rewritten');
  has(SR, 'insert into public.call_agents_names_before (user_id, label, names, updated_at) select c.user_id, (select label from cfg), c.names, c.updated_at from public.call_agents c join todo t on t.user_id = c.user_id where not exists (select 1 from public.call_agents_names_before z where z.user_id = c.user_id and z.label = (select label from cfg))');
  for (const w of ["'NOT CHANGED: no Active record is named exactly so'", "' Active records are named exactly so'", "'REPLACED on '", "'NOT ON THE ROSTER (or already written as the registry spells it)'"]) assert.ok(CR.includes(w), 'the answer says ' + w);
  const lbl = labelOf(R);
  assert.ok(lbl && /\(SQL\)$/.test(lbl), 'the label is on one line marked CHANGE: ' + lbl);
  assert.equal([...R.matchAll(new RegExp("'" + lbl.replace(/[()]/g, '\\$&') + "'", 'g'))].length, 2, 'the label is on its line and in the undo');
  has(undoOf(R), "update public.call_agents c set names = b.names, updated_at = b.updated_at from public.call_agents_names_before b where b.user_id = c.user_id and b.label = '" + lbl + "';", 'the undo puts the copies of this label back');
  const sample = R.slice(R.indexOf('want(n, old_name'), R.indexOf('w as ('));
  assert.equal((sample.match(/^\s+\(\d+,/gm) || []).length, 2, 'two sample rows');
  assert.doesNotMatch(R, /'[A-Z]{2,4}\/\d{1,5}\/20\d\d'/, 'no staff ID in it');
  assert.deepEqual([...R.matchAll(/'(\d{8,})'/g)], [], 'no number in it');
});

test('the premise of both: the request tab matches a roster name to a registry row by trim and capitals alone, the roster is a list split on commas and semicolons, and the portal saves the three columns the roster template touches', () => {
  assert.match(PORTAL, /const K = s => String\(s == null \? '' : s\)\.trim\(\)\.toUpperCase\(\);/);
  assert.match(PORTAL, /const advAgentNames_ = agentRows => \[\.\.\.new Set\(\(agentRows \|\| \[\]\)\.flatMap\(a => String\(a\.names \|\| ''\)\.split\(\/\[,;\]\/\)\.map\(s => s\.trim\(\)\)\.filter\(Boolean\)\)\)\]/);
  assert.equal([...PORTAL.matchAll(/const regBy = new Map\(zoneStaff\.map\(r => \[K\(r\.name\), r\]\)\);/g)].length, 2, 'the Advance request tab and the Leave request tab both match a roster name this way');
  assert.match(PORTAL, /\{ user_id: id, names: String\(\(p && p\.names\) \|\| ''\)\.trim\(\) \|\| null, updated_at: new Date\(\)\.toISOString\(\) \}/, 'the portal saves user_id, names and updated_at, and nothing else');
  assert.match(PORTAL, /cs \? advRead_\(\(\) => db\.from\('call_agents'\)\.select\('user_id, names'\)\) : \[\],/);
  // a request that finds no registry row is filed with no staff ID: the reason for the link template
  assert.match(PORTAL, /staff_id:/);
});

test('the kept checks: the whole schema, the templates read from the repository, every answer against a model, a second run, the undo, and the deliberate breaks of each file', () => {
  for (const [name, k] of [['accounts', KD], ['link and roster', KL]]) {
    assert.match(k, /const SCHEMA = rd\('db\/schema\.sql'\);/, name + ': the whole schema, not tables written by hand');
    assert.match(k, /psqlIn\(SCHEMA\);/, name + ': the schema is run');
    assert.match(k, /finally \{ try \{ psqlTo\('drop database if exists ' \+ DB, admin\); \}/, name + ': it makes and drops its own scratch database');
  }
  assert.match(KD, /rd\('db\/TEMPLATE-staff-accounts-by-name\.sql'\)/);
  assert.match(KD, /rd\('db\/TEMPLATE-staff-update-by-id\.sql'\)/, 'the by-ID template is run on the same rows: the same registry must come out');
  assert.match(KD, /alter table public\.teams add column if not exists zone text/, 'teams.zone is on the live book and in no SQL file: declared, and said');
  assert.match(KL, /rd\('db\/TEMPLATE-link-advance-requests-by-registry-name\.sql'\)/);
  assert.match(KL, /rd\('db\/TEMPLATE-call-agents-roster-to-registry\.sql'\)/);
  assert.match(KL, /create table public\.call_agents \(user_id text primary key, names text, updated_at timestamptz\)/, 'call_agents is in no SQL file of the repository: declared by hand, the way the portal reads and writes it');
  assert.ok(breaksOf(KD, 'breaks') >= 23, 'at least 23 breaks of the accounts template: ' + breaksOf(KD, 'breaks'));
  assert.ok(breaksOf(KL, 'breaksC2') >= 9, 'at least nine breaks of the link template: ' + breaksOf(KL, 'breaksC2'));
  assert.ok(breaksOf(KL, 'breaksE') >= 11, 'at least eleven breaks of the roster template: ' + breaksOf(KL, 'breaksE'));
  for (const lbl of ['a name with no ID is found by a part of a longer name', 'the ID guard ignores the name', 'somebody close is added anyway', 'somebody is added with no zone filed', 'the role is rewritten on an update', 'the copy before the change is not taken', 'the undo forgets the staff added', 'a bank is never replaced']) assert.ok(KD.includes(lbl), 'a break of the accounts template: ' + lbl);
  for (const lbl of ['an ID already on a request is overwritten', 'two records may carry the name', 'another column is written', 'the old ID is not kept', 'the undo sets null']) assert.ok(KL.includes(lbl), 'a break of the link template: ' + lbl);
  for (const lbl of ['the registry name is typed, not the registry spelling', 'the user_id is touched', 'an unchanged row is rewritten', 'a second name of a row is dropped', 'the roster is rebuilt in another order', 'the roster is split on commas only']) assert.ok(KL.includes(lbl), 'a break of the roster template: ' + lbl);
  assert.match(KD, /a break "?[^\n]*did not change the file|did not change the file/, 'a break that changes nothing is a failure of the check');
  assert.match(KD, /does not run \(a malformed break is a failure of the check, not a caught break\)/);
  assert.match(KD, /a second run changed the registry/);
  assert.match(KD, /the undo puts every staff back as it was/);
  assert.match(KD, /the update engine writes what the by-ID template writes \(full boxes\)/);
  assert.match(KD, /a registry of 5,000/);
  assert.match(KL, /need\(!undoE|undo/, 'the roster undo is run from the file\'s own comment lines');
  // the pins above read the checks' code, not their headers
  assert.ok(KD.length < CHECK_D.length && KL.length < CHECK_L.length);
});

test('CHAT.md and the handbook name the three templates and the two checks, and say the scripts were run and what they answered', () => {
  for (const w of ['TEMPLATE-staff-accounts-by-name.sql', 'TEMPLATE-link-advance-requests-by-registry-name.sql', 'TEMPLATE-call-agents-roster-to-registry.sql', 'staff-accounts-by-name.mjs', 'staff-accounts-link-and-roster.mjs']) {
    assert.ok(CHAT.includes(w), 'CHAT.md names ' + w);
    assert.ok(HANDBOOK.includes(w), 'the handbook names ' + w);
  }
  assert.ok(HANDBOOK.includes('Part 110'), 'the Part exists');
});
