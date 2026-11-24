/* db/TEMPLATE-merge-one-role-into-another.sql -- the lines that make it safe and true, pinned, and the facts of the CODE its
   answer to the owner rests on, RUN (docs/HANDOFF.md Part 144).

     "Then I got roles "PMO COLLECTION" and "COLLECTION" for the same collection unit. I need to delete the second since the 1st one
      is the one they use to login. But am afraid, deleting the 2nd one shouldn't distruct calls, commissions and any other tables
      the role is assossiated to." -- the owner, 24 Nov 2026

   Node cannot run SQL: the check that does (tools/db-checks/role-merge.mjs, on a PostgreSQL made from the whole of db/schema.sql,
   against a model written again, a second run, the undo, five refusals, the text cut at every line, and thirty-eight deliberate
   breaks) is the proof. This file is the guard that a later edit does not make the script write with the word COUNT, touch a table
   it does not name here, lose its log or its undo, or stop being a text that can be pasted whole -- and that the code still does
   what the owner was told it does: both names are one collection unit to the call app and to commissions, the screen's own Delete
   refuses while a code carries the role, and a code left on a role with no row has no tabs from it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FILE = rd('db/TEMPLATE-merge-one-role-into-another.sql');
const CHECK = rd('tools/db-checks/role-merge.mjs');
const code = f => f.split('\n').map(l => (/^\s*--/.test(l) ? '' : l)).join('\n');
const CODE = code(FILE);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const names = (re, s) => [...new Set([...noStrings(s).matchAll(re)].map(m => m[1].toLowerCase()))].sort();

test('it is a text that can be pasted whole: under 10,000 characters, flush-left, plain ASCII, ending with its END line (CHAT.md section 7)', () => {
  assert.ok(FILE.length < 10000, 'under 10,000 characters (' + FILE.length + ')');
  assert.ok(!/^[ \t]/m.test(FILE), 'no line starts with a blank');
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(FILE), 'plain ASCII');
  assert.equal(FILE.trimEnd().split('\n').pop(), '-- END OF THE ROLE MERGE', 'the last line is the one the owner looks for in the editor');
});

test('as it comes it changes nothing: the word is COUNT, and only the word MOVE, with two different names and a second role that has a row, writes', () => {
  assert.ok(CODE.includes("upper(btrim('COUNT')) as m), -- CHANGE: COUNT changes nothing; MOVE writes"), 'the word on the CHANGE line is COUNT');
  assert.ok(CODE.includes("upper(btrim('COLLECTION')) as a, -- THE ROLE TO REMOVE") && CODE.includes("upper(btrim('PMO COLLECTION')) as b, -- THE ROLE THAT STAYS"), 'the owner\'s two roles, the one that goes first');
  assert.ok(CODE.includes("ok as (select (select m = 'MOVE' and a <> b and a not in ('', 'ADMIN') from p) and exists (select 1 from rb) as go),"), 'the one gate');
  // every statement that writes is behind the gate
  const writes = CODE.split('\n').filter(l => /^(?:[a-z0-9]+ as \()?\s*(update|delete from|insert into) /.test(l) || /\) x where \(select go from ok\) returning 1\),/.test(l));
  const gated = CODE.split('\n').filter(l => /^[a-z]\d as \((update|delete from) public\./.test(l));
  assert.equal(gated.length, 7, 'six updates and one delete');
  for (const l of gated) assert.ok(l.includes('and (select go from ok) returning 1)'), 'gated: ' + l.slice(0, 60));
  assert.ok(CODE.includes(') x where (select go from ok) returning 1),'), 'and so is the log');
  assert.ok(writes.length >= 7);
});

test('it writes only the six places a role NAME lives and deletes only a row of roles; settings, imprest rates and daily tasks are read, never written', () => {
  assert.deepEqual(names(/\bupdate\s+public\.([a-z_]+)/gi, CODE), ['access_codes', 'advance_requests', 'call_users', 'leave_requests', 'roles', 'staff_registry']);
  assert.deepEqual(names(/\bdelete\s+from\s+public\.([a-z_]+)/gi, CODE), ['roles']);
  assert.deepEqual(names(/\binsert\s+into\s+public\.([a-z_]+)/gi, CODE), ['role_merge_log']);
  assert.deepEqual(names(/\bcreate\s+table\s+if\s+not\s+exists\s+public\.([a-z_]+)/gi, CODE), ['role_merge_log']);
  for (const t of ['settings', 'imprest_roles', 'call_logs', 'teams', 'defaulter_snapshots', 'repayment_snapshots', 'followup_status'])
    assert.ok(!new RegExp('\\b(update|delete from|insert into)\\s+public\\.' + t + '\\b', 'i').test(CODE), t + ' is never written');
  assert.ok(!/\bcall_logs\b/.test(CODE), 'the call logs are not even read: a call carries the officer\'s name and team, never a role');
  assert.ok(!/\b(drop|truncate|alter table public\.(?!role_merge_log))/i.test(CODE), 'nothing is dropped, truncated or altered but its own log');
});

test('a role is matched by its whole name, capitals and outer blanks aside; the registry by the role in front of the team; requests only while Pending', () => {
  for (const s of [
    'from public.access_codes c, p where upper(btrim(c.role)) = p.a),',
    'from public.call_users u, p where upper(btrim(u.role)) = p.a),',
    'from public.roles r, p where upper(btrim(r.approver_role)) = p.a and upper(btrim(r.role)) <> p.a),',
    "from public.advance_requests q, p where upper(btrim(q.req_role)) = p.a and q.approval = 'Pending'),",
    "from public.leave_requests q, p where upper(btrim(q.req_role)) = p.a and q.approval = 'Pending'),",
    "'^[^A-Za-z0-9]*' || regexp_replace(a, '[^A-Z0-9]+', '[^A-Za-z0-9]+', 'g') || '(?![A-Za-z0-9])' as re from p),",
    "regexp_replace(s.role, lb.re, lb.nb, 'i') as new, s.status from public.staff_registry s, lb where s.role ~* lb.re),",
  ]) assert.equal(CODE.split(s).length - 1, 1, 'once: ' + s);
});

test('every change keeps its old value, the deleted row whole, in a log the API cannot read, and the undo asks for the label the script writes', () => {
  assert.ok(CODE.includes("union all select 'roles.row', role, to_jsonb(ra)::text, null from ra) x where (select go from ok) returning 1),"), 'the deleted row, whole');
  assert.ok(CODE.includes('alter table public.role_merge_log enable row level security;') && CODE.includes('revoke all on public.role_merge_log from anon, authenticated;'), 'private');
  assert.ok(CODE.includes("lb as (select 'ROLE MERGE: ' || a || ' > ' || b as label,"), 'the label is made of the two names');
  const undo = FILE.split('\n').filter(l => l.startsWith('-- with l as (select * from public.role_merge_log'));
  assert.equal(undo.length, 1, 'one undo line');
  assert.equal(undo[0].split("label = 'ROLE MERGE: COLLECTION > PMO COLLECTION'").length - 1, 2, 'which reads and clears the label of the two names the script comes with');
  for (const t of ['access_codes', 'call_users', 'staff_registry', 'roles.approver_role', 'advance_requests', 'leave_requests', 'roles.row']) assert.ok(undo[0].includes("l.tbl = '" + t + "'"), 'the undo puts back ' + t);
  assert.equal((undo[0].match(/ = l\.new returning 1\)/g) || []).length, 6, 'and only what is still as the script left it');
  assert.ok(undo[0].trimEnd().endsWith(';'));
});

test('the kept check runs the template itself on the real schema and breaks it on purpose', () => {
  assert.ok(CHECK.includes("FILE = fs.readFileSync(ROOT + '/db/TEMPLATE-merge-one-role-into-another.sql', 'utf8')"));
  assert.ok(CHECK.includes("fs.readFileSync(ROOT + '/db/schema.sql', 'utf8')") && CHECK.includes("fs.readFileSync(ROOT + '/db/RUN-ME-051-leave-requests.sql', 'utf8')"), 'the whole real schema, and the real leave requests table');
  const breaks = CHECK.slice(CHECK.indexOf('const BREAKS = ['), CHECK.indexOf('];\nconst MUT'));
  const n = (breaks.match(/^  \['/gm) || []).length;
  assert.ok(n >= 38, n + ' deliberate breaks');
  for (const [, from] of breaks.matchAll(/^  \['[^\n]*?', "((?:[^"\\]|\\.)*)", /gm)) {
    const text = JSON.parse('"' + from + '"');
    assert.equal(FILE.split(text).length - 1, 1, 'each break\'s text is in the template exactly once: ' + text.slice(0, 50));
  }
  assert.ok(/SQL error alone does not count as caught/.test(CHECK));
});

/* ---- THE FACTS OF THE CODE THE OWNER WAS TOLD, RUN ------------------------------------------------------------------------- */
test('both names are one collection unit to the call app and to commissions: the WORD decides, not the row on Roles & access', async () => {
  const { isPmoRole, hasCollectionWord, PMO_ROLE_DEFAULT } = await import('../api/_lib/pmo.js');
  const { callRoleKind } = await import('../api/_lib/call-core.js');
  assert.equal(PMO_ROLE_DEFAULT, 'PMO COLLECTION');
  for (const role of ['COLLECTION', 'PMO COLLECTION', ' collection ', 'Pmo-Collection']) {
    assert.equal(isPmoRole(role, PMO_ROLE_DEFAULT), true, role + ' is a collection officer to the commission board, the staff roster and the SMS lists');
    assert.equal(hasCollectionWord(role), true);
    // no database is asked: a role that carries the word is decided before the settings read
    const db = { from() { throw new Error('the database must not be asked for a role that carries the word'); } };
    assert.equal(await callRoleKind(db, { role }), 'COLLECTION', role + ' is the collection kind on a handset: the same lists, the same narrowing');
  }
  assert.equal(isPmoRole('RECOVERY', PMO_ROLE_DEFAULT), false);
});

test('the screen\'s own Delete refuses while an access code carries the role, and deletes once none does', async () => {
  const { fakeDb } = await import('./fake-db.mjs');
  const { portalApi } = await import('../api/_lib/portal-core.js');
  const ADMIN = { code: 'adm', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings'] };
  const t = { roles: [{ role: 'COLLECTION', tabs: ['calls'] }, { role: 'PMO COLLECTION', tabs: ['calls'] }],
    access_codes: [{ code: 'c1', name: 'ASHA ONE', role: 'Collection', teams: ['KONGOWE'], tabs: [] }, { code: 'adm', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: [] }],
    settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }], audit_log: [], teams: [] };
  const db = fakeDb(t);
  await assert.rejects(() => portalApi(db, ADMIN, 'deleteRole', { role: 'collection' }, Date.now()), /1 access code\(s\) still use the COLLECTION role\. Move them to another role first\./);
  assert.equal(db._dump('roles').length, 2, 'nothing deleted');
  db._dump('access_codes')[0].role = 'PMO COLLECTION';                            // moved, as the script moves it
  const out = await portalApi(db, ADMIN, 'deleteRole', { role: 'COLLECTION' }, Date.now());
  assert.equal(out.role, 'COLLECTION');
  assert.deepEqual(db._dump('roles').map(r => r.role), ['PMO COLLECTION']);
  await assert.rejects(() => portalApi(db, ADMIN, 'deleteRole', { role: 'ADMIN' }, Date.now()), /ADMIN role cannot be deleted/);
});

test('a code left on a role that has no row gets no tabs from it, which is why the script moves the codes before it deletes the row', async () => {
  const { pickRoleTabs, resolveTabs } = await import('../api/_lib/auth.js');
  const rows = [{ role: 'PMO COLLECTION', tabs: ['calls', 'dashboard'] }];
  assert.equal(pickRoleTabs(rows, 'COLLECTION'), null, 'no such role: not even an empty list');
  assert.deepEqual(pickRoleTabs(rows, ' pmo collection '), ['calls', 'dashboard'], 'the role that stays is found however it is typed on the code');
  const u = { code: 'c1', role: 'COLLECTION', tabs: [] };
  assert.deepEqual(resolveTabs(u, pickRoleTabs(rows, u.role)), [], 'left behind: nothing');
  assert.deepEqual(resolveTabs({ ...u, role: 'PMO COLLECTION' }, pickRoleTabs(rows, 'PMO COLLECTION')).sort(), ['calls', 'dashboard'], 'moved: the tabs of the role that stays');
});

test('the handbook and CHAT.md record it, in the owner\'s words', () => {
  const h = rd('docs/HANDOFF.md'), c = rd('CHAT.md');
  assert.match(h, /## Part 144 /);
  assert.match(h, /deleting the 2nd one shouldn't distruct calls, commissions/);
  assert.match(c, /Part 144/);
  assert.match(c, /TEMPLATE-merge-one-role-into-another\.sql/);
});
