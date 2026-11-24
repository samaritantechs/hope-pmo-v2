/* ONE ROLE MERGED INTO ANOTHER -- db/TEMPLATE-merge-one-role-into-another.sql, run for real on a PostgreSQL.

     "Then I got roles "PMO COLLECTION" and "COLLECTION" for the same collection unit. I need to delete the second since the 1st one is
      the one they use to login. But am afraid, deleting the 2nd one shouldn't distruct calls, commissions and any other tables the role
      is assossiated to." -- the owner, 24 Nov 2026 (handbook Part 144)

   The script renames a role on the owner's live book (access codes, the phones' registered role, the staff registry, other roles'
   approver, requests still Pending) and deletes a row of Roles & access, so it is not believed on a reading. With the word COUNT it
   must change NOTHING and say what a move would do; with MOVE it must change exactly what a MODEL written again in JavaScript says,
   keep every old value, change nothing on a second run, and be undone by its own last line.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, and the real RUN-ME-051 (leave requests). The fixture
   knows the truth: the role written three ways on codes and phones (blanks, case), the registry's "ROLE - TEAM" forms, a role that
   only CONTAINS the word (EARLY COLLECTION, COLLECTIONS: never touched), other roles approved by it, Pending and decided requests,
   an imprest rate, daily tasks, settings that name it.

   It passes only when: COUNT leaves seven tables byte for byte and its answer equals the model's; MOVE leaves them exactly as the
   model says, the log holds one row for each change and the deleted row whole; a second MOVE writes nothing; the undo puts every
   table back byte for byte and clears the log; a change made by hand after the move is NOT undone; a second role with no row, the
   two names the same, ADMIN, and a word that is neither COUNT nor MOVE change nothing and say why; a first role that has no row
   still moves its codes; the text cut at every line either fails whole or finishes whole; the same text indented answers the same;
   and EVERY deliberate break of the file makes a check fail (an SQL error alone does not count as caught).

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/role-merge.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says, and
   failed when broken. MUT='{"from":"...","to":"..."}' runs it on a broken copy (the break run does that for every break below). */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(ROOT + '/db/TEMPLATE-merge-one-role-into-another.sql', 'utf8');
const DB = process.env.ROLE_DB || 'hope_rolemerge';
const admin = process.env.PGDATABASE || 'postgres';
const env = process.env;
const PIPES = ['pipe', 'pipe', 'pipe'];
const psqlTo = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES });
// the SQL editor sends a script as ONE transaction: so does every run here (-1)
const asEditor = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-1', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES });
const one = sql => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-c', sql], { env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES }).replace(/\n$/, '');

const BREAKS = [
  ['COUNT writes', "ok as (select (select m = 'MOVE' and a <> b", "ok as (select (select m in ('MOVE', 'COUNT') and a <> b"],
  ['any word writes', "ok as (select (select m = 'MOVE' and a <> b", "ok as (select (select m <> '' and a <> b"],
  ['it moves to a role that has no row', "and exists (select 1 from rb) as go)", "as go)"],
  ['ADMIN can be removed', "a not in ('', 'ADMIN') from p)", "a not in ('') from p)"],
  ['a role can be merged into itself', "(select m = 'MOVE' and a <> b and", "(select m = 'MOVE' and"],
  ['codes are matched in their own case', "from public.access_codes c, p where upper(btrim(c.role)) = p.a", "from public.access_codes c, p where btrim(c.role) = p.a"],
  ['codes are matched with their blanks', "from public.access_codes c, p where upper(btrim(c.role)) = p.a", "from public.access_codes c, p where upper(c.role) = p.a"],
  ['codes that only CONTAIN the name are moved', "from public.access_codes c, p where upper(btrim(c.role)) = p.a", "from public.access_codes c, p where upper(c.role) like '%' || p.a || '%'"],
  ['the codes are not moved', "c1 as (update public.access_codes c set role = lb.nb from c0, lb where c.code = c0.k and (select go from ok) returning 1)", "c1 as (select 1 where false)"],
  ['every code is moved', "from c0, lb where c.code = c0.k and (select go from ok) returning 1)", "from c0, lb where (select go from ok) returning 1)"],
  ['the phones are not moved', "u1 as (update public.call_users u set role = lb.nb from u0, lb where u.user_id = u0.k and (select go from ok) returning 1)", "u1 as (select 1 where false)"],
  ['phones are matched in their own case', "from public.call_users u, p where upper(btrim(u.role)) = p.a", "from public.call_users u, p where btrim(u.role) = p.a"],
  ['a registry role that only contains the word is renamed', "|| '(?![A-Za-z0-9])' as re from p)", "|| '' as re from p)"],
  ['a registry role is matched anywhere, not at its start', "'^[^A-Za-z0-9]*' || regexp_replace(a,", "'' || regexp_replace(a,"],
  ['the registry keeps the old role (not renamed)', "s1 as (update public.staff_registry s set role = s0.new from s0 where s.id = s0.k and (select go from ok) returning 1)", "s1 as (select 1 where false)"],
  ['the registry loses the team after the role', "regexp_replace(s.role, lb.re, lb.nb, 'i') as new", "lb.nb as new"],
  ['the registry is matched in its own case', "where s.role ~* lb.re)", "where s.role ~ lb.re)"],
  ['other roles keep the removed role as their approver', "r1 as (update public.roles r set approver_role = lb.nb from r0, lb where r.role = r0.k and (select go from ok) returning 1)", "r1 as (select 1 where false)"],
  ['the approver is matched in its own case', "where upper(btrim(r.approver_role)) = p.a and upper(btrim(r.role)) <> p.a)", "where btrim(r.approver_role) = p.a and upper(btrim(r.role)) <> p.a)"],
  ['decided advance requests are rewritten too', "where upper(btrim(q.req_role)) = p.a and q.approval = 'Pending'),\nl0", "where upper(btrim(q.req_role)) = p.a),\nl0"],
  ['Pending advance requests are left on the removed role', "a1 as (update public.advance_requests q set req_role = lb.nb from a0, lb where q.id::text = a0.k and (select go from ok) returning 1)", "a1 as (select 1 where false)"],
  ['decided leave requests are rewritten too', "where upper(btrim(q.req_role)) = p.a and q.approval = 'Pending'),\nc1", "where upper(btrim(q.req_role)) = p.a),\nc1"],
  ['Pending leave requests are left on the removed role', "l1 as (update public.leave_requests q set req_role = lb.nb from l0, lb where q.id::text = l0.k and (select go from ok) returning 1)", "l1 as (select 1 where false)"],
  ['the role row is not deleted', "d1 as (delete from public.roles r using ra where r.role = ra.role and (select go from ok) returning 1)", "d1 as (select 1 where false)"],
  ['the role that stays is deleted', "d1 as (delete from public.roles r using ra where r.role = ra.role", "d1 as (delete from public.roles r using rb where r.role = rb.role"],
  ['nothing is logged', ") x where (select go from ok) returning 1),", ") x where false returning 1),"],
  ['the log keeps the new value as the old one', "select 'access_codes' as tbl, k, old, (select nb from lb) as new from c0", "select 'access_codes' as tbl, k, (select nb from lb) as old, (select nb from lb) as new from c0"],
  ['the deleted row is not kept', "union all select 'roles.row', role, to_jsonb(ra)::text, null from ra) x", ") x"],
  ['the log carries another label than the undo asks for', "lb as (select 'ROLE MERGE: ' || a || ' > ' || b as label,", "lb as (select 'MERGE: ' || a || ' > ' || b as label,"],
  ['the undo puts back a value changed since', "t.code = l.k and t.role = l.new returning 1)", "t.code = l.k returning 1)"],
  ['the undo forgets the role row', "g as (insert into public.roles select (jsonb_populate_record(null::public.roles, l.old::jsonb)).* from l where l.tbl = 'roles.row' on conflict (role) do nothing returning 1)", "g as (select 1 where false)"],
  ['the undo leaves the log', "z as (delete from public.role_merge_log where label = 'ROLE MERGE: COLLECTION > PMO COLLECTION' returning 1)", "z as (select 1 where false)"],
  ['the answer counts every code', "(select count(*) || coalesce(': ' || string_agg(name, ', ' order by name), '') from c0)", "(select count(*) || '' from public.access_codes)"],
  ['the answer counts every registry row', "(select count(*) filter (where status = 'Active') || ' / ' || count(*) from s0)", "(select count(*) filter (where status = 'Active') || ' / ' || count(*) from public.staff_registry)"],
  ['the answer says tabs both roles have', "except select unnest(coalesce((select tabs from rb), '{}'))) q)", ") q)"],
  ['the answer swaps the two roles\' daily tasks', "(select na || ' / ' || nb from tasks)", "(select nb || ' / ' || na from tasks)"],
  ['a setting that names only the role that stays is listed', "position(p.a in replace(upper(s.value), p.b, '')) > 0)", "position(p.a in upper(s.value)) > 0)"],
  ['the log can be read through the API', "revoke all on public.role_merge_log from anon, authenticated;", ""],
];
const MUT = process.env.MUT ? JSON.parse(process.env.MUT) : null;
if (MUT && FILE.split(MUT.from).length !== 2) { console.log('BAD BREAK: not found once: ' + MUT.from.slice(0, 80)); process.exit(3); }
const TEXT = MUT ? FILE.replace(MUT.from, () => MUT.to) : FILE;
const withWords = (t, a, b, m) => {
  const o = t.replace("upper(btrim('COLLECTION')) as a,", () => "upper(btrim(" + q(a) + ")) as a,").replace("upper(btrim('PMO COLLECTION')) as b,", () => "upper(btrim(" + q(b) + ")) as b,")
    .replace("upper(btrim('COUNT')) as m)", () => "upper(btrim(" + q(m) + ")) as m)");
  return o;
};
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const undoOf = t => t.split('\n').filter(l => /^-- with l as \(select \* from public\.role_merge_log/.test(l)).map(l => l.replace(/^-- /, '')).join('\n');

// ---- the book
const TABLES = { access_codes: 'code', call_users: 'user_id', staff_registry: 'id', roles: 'role', advance_requests: 'id', leave_requests: 'id', settings: 'key', imprest_roles: 'role' };
const FIX = {
  teams: [{ team: 'KONGOWE' }, { team: 'MBAGALA' }],
  roles: [
    { role: 'COLLECTION', tabs: ['dashboard', 'calls', 'legal', 'advreq'], approver_role: 'GMO', approver_code: null },
    { role: 'PMO COLLECTION', tabs: ['dashboard', 'calls', 'advreq'], approver_role: 'OPM', approver_code: null },
    { role: 'FIELD OFFICER', tabs: ['advreq'], approver_role: 'COLLECTION', approver_code: null },
    { role: 'BIKE', tabs: ['advreq'], approver_role: 'collection', approver_code: null },
    { role: 'GMO', tabs: ['dashboard'], approver_role: 'OPM', approver_code: null },
    { role: 'EARLY COLLECTION', tabs: ['calls'], approver_role: 'PMO COLLECTION', approver_code: null },
    { role: 'ADMIN', tabs: [], approver_role: null, approver_code: null },
  ],
  access_codes: [
    { code: 'c1', name: 'ASHA ONE', role: 'COLLECTION', teams: ['KONGOWE'], tabs: null },
    { code: 'c2', name: 'BARAKA TWO', role: ' Collection ', teams: ['MBAGALA'], tabs: ['legal'] },
    { code: 'c3', name: 'CATHERINE THREE', role: 'PMO COLLECTION', teams: ['KONGOWE', 'MBAGALA'], tabs: null },
    { code: 'c4', name: 'DAUDI FOUR', role: 'EARLY COLLECTION', teams: null, tabs: null },
    { code: 'c5', name: 'ESTER FIVE', role: 'RECOVERY', teams: null, tabs: null },
    { code: 'c6', name: 'FATUMA SIX', role: 'COLLECTIONS', teams: null, tabs: null },
    { code: 'c7', name: 'GODFREY SEVEN', role: 'COLLECTION OFFICER', teams: null, tabs: null },
    { code: 'adm', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: null },
  ],
  call_users: [
    { user_id: 'U1', name: 'ASHA ONE', team: 'KONGOWE', role: 'COLLECTION', is_leader: true, phone: '0711000001' },
    { user_id: 'U2', name: 'BARAKA', team: 'MBAGALA', role: 'collection', is_leader: true, phone: '0711000002' },
    { user_id: 'U3', name: 'CATHERINE THREE', team: 'KONGOWE', role: 'PMO COLLECTION', is_leader: true, phone: '0711000003' },
    { user_id: 'U4', name: 'OFISA', team: 'KONGOWE', role: 'OFFICER', is_leader: false, phone: '0711000004' },
    { user_id: 'U5', name: 'DAUDI FOUR', team: null, role: 'EARLY COLLECTION', is_leader: true, phone: '0711000005' },
    { user_id: 'U6', name: 'NO ROLE', team: null, role: null, is_leader: false, phone: '0711000006' },
  ],
  staff_registry: [
    { id: 'S1', name: 'ASHA ONE', role: 'COLLECTION - KONGOWE', zone: 'DAR', status: 'Active' },
    { id: 'S2', name: 'BARAKA TWO', role: 'Collection', zone: 'DAR', status: 'Active' },
    { id: 'S3', name: 'ZAMANI', role: 'COLLECTION OFFICER - MBAGALA', zone: 'DAR', status: 'Inactive' },
    { id: 'S4', name: 'CATHERINE THREE', role: 'PMO COLLECTION - KONGOWE', zone: 'DAR', status: 'Active' },
    { id: 'S5', name: 'DAUDI FOUR', role: 'EARLY COLLECTION - KONGOWE', zone: 'DAR', status: 'Active' },
    { id: 'S6', name: 'FATUMA SIX', role: 'COLLECTIONS', zone: 'DAR', status: 'Active' },
    { id: 'S7', name: 'GODFREY', role: 'Field Officer - KONGOWE', zone: 'DAR', status: 'Active' },
    { id: 'S8', name: 'HAWA', role: '  collection-MBAGALA', zone: 'DAR', status: 'Active' },
    { id: 'S9', name: 'NULL ROLE', role: null, zone: 'DAR', status: 'Active' },
    { id: 'S10', name: 'RECOLLECTION', role: 'RECOLLECTION - X', zone: 'DAR', status: 'Active' },
  ],
  advance_requests: [
    { id: '00000000-0000-0000-0000-0000000000a1', staff_name: 'ASHA ONE', amount: 100, approval: 'Pending', req_role: 'COLLECTION', req_code: 'c1' },
    { id: '00000000-0000-0000-0000-0000000000a2', staff_name: 'ASHA ONE', amount: 100, approval: 'Approved', req_role: 'COLLECTION', req_code: 'c1' },
    { id: '00000000-0000-0000-0000-0000000000a3', staff_name: 'CATHERINE THREE', amount: 100, approval: 'Pending', req_role: 'PMO COLLECTION', req_code: 'c3' },
    { id: '00000000-0000-0000-0000-0000000000a4', staff_name: 'OLD', amount: 100, approval: 'Pending', req_role: null, req_code: null },
    { id: '00000000-0000-0000-0000-0000000000a5', staff_name: 'BARAKA TWO', amount: 100, approval: 'Pending', req_role: ' collection ', req_code: 'c2' },
  ],
  leave_requests: [
    { id: '00000000-0000-0000-0000-0000000000b1', staff_name: 'BARAKA TWO', start_date: '2026-12-01', end_date: '2026-12-03', days: 3, reason: 'r', approval: 'Pending', req_role: 'COLLECTION', req_code: 'c2' },
    { id: '00000000-0000-0000-0000-0000000000b2', staff_name: 'BARAKA TWO', start_date: '2026-10-01', end_date: '2026-10-03', days: 3, reason: 'r', approval: 'Disapproved', req_role: 'COLLECTION', req_code: 'c2' },
    { id: '00000000-0000-0000-0000-0000000000b3', staff_name: 'DAUDI FOUR', start_date: '2026-12-05', end_date: '2026-12-06', days: 2, reason: 'r', approval: 'Pending', req_role: 'EARLY COLLECTION', req_code: 'c4' },
  ],
  imprest_roles: [{ role: 'COLLECTION', accommodation_per_day: 30000 }, { role: 'GMO', accommodation_per_day: 50000 }],
  settings: [
    { key: 'PMO_ROLE', value: 'PMO COLLECTION' },
    { key: 'IMPREST_ROUTES', value: '[{"from":["GMO","COLLECTION"],"via":"OPM"}]' },
    { key: 'ONLY_THE_SECOND', value: 'PMO COLLECTION only' },
    { key: 'DAILY_CHECKLIST', value: JSON.stringify({ roles: { 'COLLECTION': { MON: [{ id: 'a', activity: 'x', cutoff: '09:00' }, { id: 'b', activity: 'y', cutoff: '10:00' }], TUE: [{ id: 'c', activity: 'z', cutoff: '09:00' }] },
      'PMO COLLECTION': { MON: [{ id: 'd', activity: 'w', cutoff: '09:00' }] } } }) },
  ],
};
const lit = v => v === null || v === undefined ? 'null' : Array.isArray(v) ? (v.length ? 'array[' + v.map(q).join(',') + ']::text[]' : "'{}'::text[]") : typeof v === 'number' || typeof v === 'boolean' ? String(v) : q(v);
const insertOf = (t, rows) => rows.length ? 'insert into public.' + t + ' (' + Object.keys(rows[0]).join(', ') + ') values\n' + rows.map(r => '(' + Object.values(r).map(lit).join(', ') + ')').join(',\n') + ';\n' : '';
const load = (fix = FIX) => {
  psqlTo('truncate public.leave_requests, public.advance_requests, public.staff_registry, public.call_logs, public.call_users, public.access_codes, public.roles, public.imprest_roles, public.settings, public.teams cascade;'
    + ' drop table if exists public.role_merge_log;', DB);
  psqlTo(['teams', 'roles', 'access_codes', 'call_users', 'staff_registry', 'advance_requests', 'leave_requests', 'imprest_roles', 'settings'].map(t => insertOf(t, fix[t] || [])).join(''), DB);
};
const dumpOf = t => one("select coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by x." + TABLES[t] + "::text)), 'empty') from public." + t + ' x');
const dumpAll = () => Object.keys(TABLES).map(dumpOf).join(' ');
const col = (t, k, c) => Object.fromEntries(one('select ' + k + "::text, coalesce(" + c + ", '<null>') from public." + t + ' order by 1').split('\n').filter(Boolean).map(l => l.split('\t')));
const logRows = () => { try { return one("select tbl, k, coalesce(old, '<null>'), coalesce(new, '<null>'), label from public.role_merge_log order by id").split('\n').filter(Boolean).map(l => l.split('\t')); } catch (e) { return null; } };

// ---- the model, written again from the script's own header
const K = s => String(s == null ? '' : s).trim().toUpperCase();
const model = (fix, a, b) => {
  const A = K(a), B = K(b);
  const rb = fix.roles.find(r => K(r.role) === B), ra = fix.roles.filter(r => K(r.role) === A);
  const can = A !== B && A !== '' && A !== 'ADMIN' && !!rb;
  const nb = rb ? rb.role : null;
  const re = new RegExp('^[^A-Za-z0-9]*' + A.split(/[^A-Z0-9]+/).filter(Boolean).join('[^A-Za-z0-9]+') + '(?![A-Za-z0-9])', 'i');
  const out = { can, nb, codes: {}, phones: {}, registry: {}, approver: {}, adv: {}, leave: {}, log: [], rowsDeleted: ra.length };
  for (const c of fix.access_codes) if (K(c.role) === A) { out.codes[c.code] = nb; out.log.push(['access_codes', c.code, c.role, nb]); }
  for (const u of fix.call_users) if (K(u.role) === A) { out.phones[u.user_id] = nb; out.log.push(['call_users', u.user_id, u.role, nb]); }
  for (const s of fix.staff_registry) if (s.role != null && re.test(s.role)) { const n = s.role.replace(re, nb); out.registry[s.id] = n; out.log.push(['staff_registry', s.id, s.role, n]); }
  for (const r of fix.roles) if (K(r.approver_role) === A && K(r.role) !== A) { out.approver[r.role] = nb; out.log.push(['roles.approver_role', r.role, r.approver_role, nb]); }
  for (const r of fix.advance_requests) if (K(r.req_role) === A && r.approval === 'Pending') { out.adv[r.id] = nb; out.log.push(['advance_requests', r.id, r.req_role, nb]); }
  for (const r of fix.leave_requests) if (K(r.req_role) === A && r.approval === 'Pending') { out.leave[r.id] = nb; out.log.push(['leave_requests', r.id, r.req_role, nb]); }
  out.changed = out.log.length;
  out.activeReg = fix.staff_registry.filter(s => out.registry[s.id] !== undefined && s.status === 'Active').length;
  return out;
};
const expectState = (fix, m, moved) => ({
  codes: Object.fromEntries(fix.access_codes.map(c => [c.code, moved && m.codes[c.code] !== undefined ? m.codes[c.code] : c.role])),
  phones: Object.fromEntries(fix.call_users.map(u => [u.user_id, moved && m.phones[u.user_id] !== undefined ? m.phones[u.user_id] : (u.role == null ? '<null>' : u.role)])),
  registry: Object.fromEntries(fix.staff_registry.map(s => [s.id, moved && m.registry[s.id] !== undefined ? m.registry[s.id] : (s.role == null ? '<null>' : s.role)])),
  roles: Object.fromEntries(fix.roles.filter(r => !(moved && K(r.role) === K('COLLECTION') && false)).map(r => [r.role, moved && m.approver[r.role] !== undefined ? m.approver[r.role] : (r.approver_role == null ? '<null>' : r.approver_role)])),
  adv: Object.fromEntries(fix.advance_requests.map(r => [r.id, moved && m.adv[r.id] !== undefined ? m.adv[r.id] : (r.req_role == null ? '<null>' : r.req_role)])),
  leave: Object.fromEntries(fix.leave_requests.map(r => [r.id, moved && m.leave[r.id] !== undefined ? m.leave[r.id] : (r.req_role == null ? '<null>' : r.req_role)])),
});
const stateNow = () => ({ codes: col('access_codes', 'code', 'role'), phones: col('call_users', 'user_id', 'role'), registry: col('staff_registry', 'id', 'role'),
  roles: col('roles', 'role', 'approver_role'), adv: col('advance_requests', 'id', 'req_role'), leave: col('leave_requests', 'id', 'req_role') });
const same = (x, y) => JSON.stringify(Object.entries(x).sort()) === JSON.stringify(Object.entries(y).sort());

let fails = 0; const need = (ok, msg) => { if (!ok) { fails++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg); };
// a text that fails with an SQL error is a FAILED check, never a crash of the harness
const run = sql => { try { return asEditor(sql, DB).replace(/\n$/, '').split('\n').filter(Boolean).map(l => l.split('\t')); } catch (e) { fails++; console.log('  FAIL: the script ran with an SQL error: ' + String(e.stderr || e.message).split('\n')[0]); return []; } };
const line = (o, n) => { const r = o.find(x => x[0] === String(n)); return r ? r[2] : null; };

try { psqlTo('drop database if exists ' + DB, admin); } catch {}
psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlTo(fs.readFileSync(ROOT + '/db/schema.sql', 'utf8'), DB);
psqlTo(fs.readFileSync(ROOT + '/db/RUN-ME-051-leave-requests.sql', 'utf8'), DB);
// the live book hands every new table to the API's roles: the script's own revoke must take the log away from them
psqlTo("do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if; if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if; end $$;"
  + ' alter default privileges in schema public grant all on tables to anon, authenticated;', DB);

const FAST = !!process.env.FAST;
console.log('=== shape');
need(FILE.length < 10000, 'the script is ' + FILE.length + ' characters (under 10,000)');
need(!/^[ \t]/m.test(FILE), 'no line starts with a blank');
need(/^[\x09\x0a\x20-\x7e]*$/.test(FILE), 'plain ASCII');
need(FILE.trimEnd().split('\n').pop() === '-- END OF THE ROLE MERGE', 'ends with its END line');
need(FILE.includes("upper(btrim('COUNT')) as m), -- CHANGE: COUNT changes nothing; MOVE writes"), 'as it comes, the word is COUNT');
need(undoOf(FILE).length > 500 && undoOf(FILE).trim().endsWith(';'), 'the undo is one statement on the last comment line');

const A = 'COLLECTION', B = 'PMO COLLECTION';
const M = model(FIX, A, B);
console.log('=== COUNT (as it comes)');
{
  load(); const before = dumpAll();
  const o = run(withWords(TEXT, A, B, 'COUNT'));
  need(dumpAll() === before, 'COUNT changes nothing: eight tables byte for byte');
  need((logRows() || []).length === 0, 'and writes no log row');
  need(/^COUNT: nothing was changed/.test(line(o, 1) || ''), 'line 1 says nothing was changed: ' + line(o, 1));
  need(line(o, 2) === 'COLLECTION: has a row / PMO COLLECTION: has a row', 'line 2: both roles have a row: ' + line(o, 2));
  need(line(o, 3) === Object.keys(M.codes).length + ': ASHA ONE, BARAKA TWO', 'line 3: the codes on the first role, by name: ' + line(o, 3));
  need(line(o, 4) === String(Object.keys(M.phones).length), 'line 4: the phones: ' + line(o, 4));
  need(line(o, 5) === M.activeReg + ' / ' + Object.keys(M.registry).length, 'line 5: the registry rows (Active / all): ' + line(o, 5));
  need(line(o, 6) === Object.keys(M.approver).length + ': ' + Object.keys(M.approver).sort().join(', '), 'line 6: the roles it approves: ' + line(o, 6));
  need(line(o, 7) === Object.keys(M.adv).length + ' / ' + Object.keys(M.leave).length, 'line 7: Pending requests: ' + line(o, 7));
  need(line(o, 8) === 'yes', 'line 8: its row would be deleted');
  need(line(o, 9) === 'legal', 'line 9: the one tab only the first role has: ' + line(o, 9));
  need(line(o, 10) === 'GMO / OPM', 'line 10: the two approvers: ' + line(o, 10));
  need(line(o, 11) === '3 / 1', 'line 11: daily tasks, first / second: ' + line(o, 11));
  need(line(o, 12) === '30000 / no rate', 'line 12: imprest rates: ' + line(o, 12));
  need(line(o, 13) === 'IMPREST_ROUTES', 'line 13: the setting that names the first role, not the one that names only the second: ' + line(o, 13));
  need(line(o, 14) === 'COLLECTION: 2, COLLECTION OFFICER: 1, EARLY COLLECTION: 1, PMO COLLECTION: 1', 'line 14: role names read as collection officers: ' + line(o, 14));
  need(line(o, 15) === '0 / 0 (log rows: 0)', 'line 15: nothing written: ' + line(o, 15));
  need(o.length === 15, 'fifteen lines');
}
console.log('=== MOVE');
let afterMove, sigMoved;
// what the script may change, without the columns a fresh load stamps with the time (created_at and the like)
const sig = () => JSON.stringify(Object.entries(stateNow()).map(([k, v]) => [k, Object.entries(v).sort()])) + ' log:' + (logRows() || []).length;
{
  load(); const before = dumpAll();
  const o = run(withWords(TEXT, A, B, 'MOVE'));
  const now = stateNow(), want = expectState(FIX, M, true);
  delete want.roles['COLLECTION'];
  need(same(now.codes, want.codes), 'access codes are exactly the model\'s: ' + JSON.stringify(now.codes));
  need(same(now.phones, want.phones), 'phones are exactly the model\'s');
  need(same(now.registry, want.registry), 'the staff registry is exactly the model\'s: ' + JSON.stringify(now.registry));
  need(same(now.roles, want.roles), 'the roles: the first one gone, its approvals pointed at the second: ' + JSON.stringify(now.roles));
  need(same(now.adv, want.adv) && same(now.leave, want.leave), 'Pending requests moved, decided ones as they were');
  need(dumpOf('settings') === before.split(' ')[6] && dumpOf('imprest_roles') === before.split(' ')[7], 'settings and imprest rates are not touched');
  const lg = logRows() || [];
  const wantLog = M.log.map(r => r.join('|')).sort();
  need(JSON.stringify(lg.filter(r => r[0] !== 'roles.row').map(r => r.slice(0, 4).join('|')).sort()) === JSON.stringify(wantLog), 'the log holds one row for each change, old and new: ' + lg.length + ' rows');
  const rowLog = lg.filter(r => r[0] === 'roles.row');
  need(rowLog.length === 1 && rowLog[0][1] === 'COLLECTION' && JSON.parse(rowLog[0][2]).approver_role === 'GMO' && JSON.stringify(JSON.parse(rowLog[0][2]).tabs) === JSON.stringify(FIX.roles[0].tabs), 'and the deleted role row whole');
  need(lg.every(r => r[4] === 'ROLE MERGE: COLLECTION > PMO COLLECTION'), 'under the label the undo asks for');
  need(/^MOVE: MOVED/.test(line(o, 1) || '') && line(o, 15) === M.changed + ' / 1 (log rows: ' + (M.changed + 1) + ')', 'the answer says what was written: ' + line(o, 15));
  need(one("select count(*) from information_schema.role_table_grants where table_name = 'role_merge_log' and grantee in ('anon', 'authenticated')") === '0'
    && one("select relrowsecurity from pg_class where oid = 'public.role_merge_log'::regclass") === 't', 'the log cannot be read through the API (no grant, row security on)');
  afterMove = dumpAll(); sigMoved = sig();
  console.log('=== a second MOVE');
  const o2 = run(withWords(TEXT, A, B, 'MOVE'));
  need(dumpAll() === afterMove && (logRows() || []).length === lg.length, 'changes nothing and logs nothing');
  need(line(o2, 15) === '0 / 0 (log rows: 0)' && /HAS NO ROW \(nothing to delete\)/.test(line(o2, 2) || ''), 'and says so: ' + line(o2, 2));
  console.log('=== the undo');
  // a change made by hand after the move must survive the undo
  psqlTo("update public.access_codes set role = 'RECOVERY' where code = 'c2';", DB);
  const u = run(undoOf(withWords(TEXT, A, B, 'MOVE')));
  const st = stateNow(), orig = expectState(FIX, M, false);
  need(st.codes.c2 === 'RECOVERY', 'a code changed by hand since the move is left as it is');
  need(st.codes.c1 === 'COLLECTION' && same({ ...st.codes, c2: ' Collection ' }, orig.codes), 'every other code is back on its old role, as it was written');
  need(same(st.phones, orig.phones) && same(st.registry, orig.registry) && same(st.roles, orig.roles) && same(st.adv, orig.adv) && same(st.leave, orig.leave), 'phones, registry, roles and requests are back');
  psqlTo("update public.access_codes set role = ' Collection ' where code = 'c2';", DB);
  need(dumpAll() === before, 'the book is byte for byte what it was (the one hand change put back by the check)');
  need((logRows() || []).length === 0, 'and the log is cleared');
  need(u.length === 1 && u[0][0] === String(M.changed - 1) && u[0][1] === '1' && u[0][2] === String(M.changed + 1), 'the undo says what it put back: ' + JSON.stringify(u[0]));
}
console.log('=== refusals');
for (const [name, a, b, m, re2, re1] of [
  ['the second role has no row', 'COLLECTION', 'NO SUCH ROLE', 'MOVE', /NO SUCH ROLE: HAS NO ROW, so nothing can be moved to it/, /^MOVE: NOT MOVED/],
  ['the two names are the same', 'COLLECTION', ' collection ', 'MOVE', /THIS ROLE IS NEVER REMOVED/, /^MOVE: NOT MOVED/],
  ['ADMIN', 'ADMIN', 'PMO COLLECTION', 'MOVE', /THIS ROLE IS NEVER REMOVED/, /^MOVE: NOT MOVED/],
  ['a word that is neither', 'COLLECTION', 'PMO COLLECTION', 'DELETE', /has a row/, /^DELETE: not COUNT or MOVE, nothing was changed/],
  ['an empty word', 'COLLECTION', 'PMO COLLECTION', '', /has a row/, /not COUNT or MOVE, nothing was changed/],
]) {
  load(); const before = dumpAll();
  const o = run(withWords(TEXT, a, b, m));
  need(dumpAll() === before && (logRows() || []).length === 0, name + ': nothing is changed and nothing logged');
  need(re2.test(line(o, 2) || '') && re1.test(line(o, 1) || '') && line(o, 15) === '0 / 0 (log rows: 0)', name + ': and the answer says why: ' + line(o, 1) + ' | ' + line(o, 2));
}
console.log('=== a first role that has no row of its own (only codes carry it)');
{
  const fix = { ...FIX, roles: FIX.roles.filter(r => r.role !== 'COLLECTION') };
  load(fix); const m = model(fix, A, B);
  const o = run(withWords(TEXT, A, B, 'MOVE'));
  const now = stateNow();
  need(same(now.codes, expectState(fix, m, true).codes) && same(now.registry, expectState(fix, m, true).registry), 'its codes and registry rows are moved all the same');
  need(line(o, 8) === 'there is none' && line(o, 15) === m.changed + ' / 0 (log rows: ' + m.changed + ')', 'and no row is deleted: ' + line(o, 15));
}
console.log('=== another pair of names (a role of two words into one of one)');
{
  const fix = JSON.parse(JSON.stringify(FIX));
  load(fix); const m = model(fix, 'early collection', 'gmo');
  const o = run(withWords(TEXT, 'early collection', 'gmo', 'MOVE'));
  const now = stateNow(), want = expectState(fix, m, true); delete want.roles['EARLY COLLECTION'];
  need(same(now.codes, want.codes) && same(now.phones, want.phones) && same(now.registry, want.registry) && same(now.roles, want.roles) && same(now.leave, want.leave), 'every table is the model\'s: ' + JSON.stringify(now.registry.S5));
  need(now.registry.S5 === 'GMO - KONGOWE' && now.codes.c4 === 'GMO' && now.codes.c1 === 'COLLECTION', 'EARLY COLLECTION - KONGOWE became GMO - KONGOWE; COLLECTION was not touched');
  need(line(o, 15) === m.changed + ' / 1 (log rows: ' + (m.changed + 1) + ')', 'and the answer agrees: ' + line(o, 15));
}
if (!FAST && !MUT) {
  console.log('=== the text cut at every line: all of it or none of it');
  const full = withWords(TEXT, A, B, 'MOVE'), lines = full.split('\n');
  let part = 0, errs = 0, whole = 0, none = 0;
  for (let i = 1; i < lines.length; i++) {
    load(); const before = dumpAll(), sig0 = sig();
    try { asEditor(lines.slice(0, i).join('\n'), DB); } catch (e) { errs++; }
    const d = dumpAll(), g = sig();
    if (d === before && g === sig0) none++; else if (g === sigMoved) whole++; else part++;
  }
  need(part === 0 && whole >= 1 && none >= lines.length - 8, lines.length - 1 + ' cut points: ' + none + ' changed nothing (' + errs + ' with an error), ' + whole + ' finished whole, ' + part + ' partial');
  console.log('=== the same text with every line indented');
  load(); run(full.split('\n').map((l, i) => ' '.repeat(i % 7) + l).join('\n'));
  need(sig() === sigMoved, 'answers and moves the same');
}
if (!MUT && !FAST) {
  console.log('=== deliberate breaks: each must make a check fail');
  let caught = 0;
  for (const [name, from, to] of BREAKS) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, MUT: JSON.stringify({ from, to }), FAST: '1', ROLE_DB: DB + '_mut' }, encoding: 'utf8', maxBuffer: 1 << 28 });
    const out = r.stdout || '';
    const realFail = /  FAIL: (?!the script ran with an SQL error)/.test(out);
    if (r.status === 3) { fails++; console.log('  FAIL: a break the check cannot build: ' + name); continue; }
    if (r.status !== 0 && realFail) caught++; else { fails++; console.log('  FAIL: NOT CAUGHT: ' + name + (r.status !== 0 ? ' (it only made the SQL fail)' : '')); }
  }
  need(caught === BREAKS.length, caught + ' of ' + BREAKS.length + ' deliberate breaks each make a check fail');
  try { psqlTo('drop database if exists ' + DB + '_mut', admin); } catch {}
}
if (!MUT) { try { psqlTo('drop database if exists ' + DB, admin); } catch {} }
console.log(fails ? fails + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
