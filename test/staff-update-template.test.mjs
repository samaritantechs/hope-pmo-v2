/* db/TEMPLATE-staff-update-by-id.sql -- THE STAFF UPDATE FROM A FORM, WHERE THE DETAILS SENT ARE THE LATEST (docs/HANDOFF.md Part 101).

     "some info should be filled into their columns if missing or replace if existing since the provided is latest" -- the owner, 17 Nov 2026

   Every other staff script only FILLS what is empty and never re-spells a name. This one REPLACES, so what makes it safe is pinned: it names nobody (the repository is public), it finds a person only by
   staff ID AND the name they carry, it writes only the boxes a row gives and only where they differ, it never empties a box, never touches the role, the zone or the status, never writes a NIDA that is not
   twenty digits, copies each row before it changes it, undoes from that copy, and prints no value. Node cannot run SQL: the check that does (tools/db-checks/staff-update.mjs, run by hand on a PostgreSQL
   over the WHOLE of db/schema.sql, the file run as it is written, every column of every staff against a model written again, the undo byte for byte, and a list of deliberate breaks) is the proof; this
   is the guard that a later edit does not part company with it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F = 'db/TEMPLATE-staff-update-by-id.sql';
const FILE = rd(F), MAIN = rd('db/TEMPLATE-staff-changes-from-gmo.sql'), SCHEMA = rd('db/schema.sql'), CHECK = rd('tools/db-checks/staff-update.mjs');
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const CODE = code(FILE);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const squash = s => s.replace(/\s+/g, ' ');
const HOW = '. The repository is public: hand the filled copy to the owner and commit the template as it was (docs/HANDOFF.md Part 48).';
const ddl = name => { const i = SCHEMA.indexOf('create table if not exists ' + name + ' ('); return SCHEMA.slice(i, SCHEMA.indexOf('\n);', i)); };
const typeOf = (t, c) => ((ddl(t).match(new RegExp('(?:^|[\\s,(])' + c + '\\s+([a-z]+)')) || [])[1]);
const listBlock = () => { const at = CODE.indexOf('want(n, id, cur_name'), from = CODE.indexOf('(values', at); return CODE.slice(from, CODE.indexOf('\n),\na as (', from)); };

test('the template names nobody: one example row of placeholders, and a placeholder label on the CHANGE line and in the undo', () => {
  const values = [...listBlock().matchAll(/'([^']*)'/g)].map(m => m[1]);
  assert.deepEqual(values, ['ABC/0001/2026', 'FIRST MIDDLE LAST', 'FIRST MIDDLE LAST', '0700000000', 'BANK', '0000000000'], F + ' carries something that could be a person, an account or a phone in its list' + HOW);
  assert.equal((listBlock().match(/^\s*\(\d+,/gm) || []).length, 1, 'one example row');
  const cfg = CODE.slice(CODE.indexOf('with cfg as ('), CODE.indexOf('want(n, id'));
  assert.deepEqual([...cfg.matchAll(/'([^']*)'/g)].map(m => m[1]), ['GMO ZONE NAME UPDATE (SQL)'], F + ' was committed with a real label' + HOW);
  assert.deepEqual([...FILE.matchAll(/b\.label = '([^']*)'/g)].map(m => m[1]), ['GMO ZONE NAME UPDATE (SQL)'], 'the undo carries the placeholder label too');
  assert.match(FILE, /NO STAFF NAME, NUMBER OR ACCOUNT IS EVER\s*--\s*COMMITTED/);
});

test('it writes to the staff registry and to its own before-images, and nothing else: it deletes, drops and grants nothing', () => {
  const c = noStrings(CODE);
  assert.deepEqual([...new Set([...c.matchAll(/\bupdate\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))], ['staff_registry']);
  assert.deepEqual([...new Set([...c.matchAll(/\binsert\s+into\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))], ['staff_registry_update_before']);
  assert.deepEqual([...new Set([...c.matchAll(/\bcreate\s+table\s+if\s+not\s+exists\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))], ['staff_registry_update_before']);
  assert.match(c, /alter table public\.staff_registry_update_before enable row level security;/, 'the copies are never readable through the public API');
  assert.doesNotMatch(c, /\b(delete|drop|truncate|grant|revoke|vacuum|copy|call)\b/i);
  assert.deepEqual([...new Set([...c.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].filter(t => !['want', 'a', 'a2', 'b', 'c', 'cols', 'per', 'todo', 'cl', 'p', 'd', 'v', 'x', 'z', 'cfg', 'nm', 'lateral', 'make_date'].includes(t)).sort(), ['staff_registry', 'staff_registry_update_before']);
  assert.match(CODE, /^\s*set local lock_timeout = '5s';/m);
  assert.match(CODE, /^\s*set local statement_timeout = '60s';/m);
  assert.match(CODE, /^\s*set local jit = off;/m);
});

test('it writes the fifteen boxes a form can give and the label, and never the role, the zone, the status or the staff ID', () => {
  const set = squash(CODE.slice(CODE.indexOf('update staff_registry s'), CODE.indexOf('from todo t')));
  const cols = [...set.matchAll(/(?:^|, | set )([a-z_0-9]+)\s+= /g)].map(m => m[1]).filter(x => x !== 'set');
  assert.deepEqual(cols, ['name', 'phone', 'phone2', 'bank', 'account', 'nida', 'tin', 'nssf', 'birth_date', 'residence', 'reg_date', 'guarantor1', 'guarantor1_phone', 'guarantor2', 'guarantor2_phone', 'updated_by', 'updated_at']);
  for (const c of ['phone', 'phone2', 'bank', 'account', 'nida', 'tin', 'nssf', 'birth_date', 'residence', 'reg_date', 'guarantor1', 'guarantor1_phone', 'guarantor2', 'guarantor2_phone', 'name'])
    assert.equal(typeOf('staff_registry', c) || (c === 'birth_date' || c === 'reg_date' ? 'date' : ''), c === 'birth_date' || c === 'reg_date' ? 'date' : 'text', 'the real registry column ' + c);
  assert.match(set, /updated_by = \(select label from cfg\), updated_at = now\(\)/);
  // every box is written ONLY through its kind: a box that is not filled or replaced (cleared too, for a number beside a replaced guarantor) keeps what the registry holds
  for (const box of ['name', 'phone', 'second phone', 'bank', 'account', 'NIDA', 'TIN', 'NSSF', 'birth date', 'residence', 'start date', 'guarantor 1', 'guarantor 2'])
    assert.match(set, new RegExp("when t\\.k->>'" + box + "' in \\('filled', 'replaced'\\) then"), 'the box ' + box);
  for (const box of ['guarantor 1 phone', 'guarantor 2 phone']) assert.match(set, new RegExp("when t\\.k->>'" + box + "' in \\('filled', 'replaced', 'cleared'\\) then"), 'the box ' + box);
  assert.doesNotMatch(set, /\b(role|zone|status)\b\s*=/, 'the role, the zone and the status are the MOVE and PLACE scripts\' work');
});

test('a person is found by staff ID AND the name the registry carries (before or after the rename); a box the row gives is filled, replaced or the same, and one it leaves null is never touched or emptied', () => {
  const c = squash(CODE);
  assert.match(c, /\(b\.sid is not null and b\.s_key in \(b\.cur_key, coalesce\(b\.new_key, b\.cur_key\)\)\) as ok/);
  assert.match(c, /from a2 a left join staff_registry s on s\.id = a\.id/);
  assert.match(c, /case when not c\.ok then 'skip' when v\.given is false then 'none' when v\.old is null and v\.new is not null then 'filled' when v\.old is not null and v\.new is null then 'cleared' when v\.old is distinct from v\.new then 'replaced' else 'same' end as kind/);
  assert.match(c, /todo as \(select c\.\*, p\.k from c join per p on p\.n = c\.n and p\.id = c\.id where c\.ok and p\.changed > 0\)/, 'only a person whose guard holds and who has something to change is written');
  assert.match(c, /count\(\*\) filter \(where cl\.kind in \('filled', 'replaced', 'cleared'\)\) as changed/);
  assert.equal((c.match(/'cleared'\)/g) || []).length >= 3, true);
  // the fifteen boxes, each with what the registry holds, what the row gives and whether the row gave it: the block is pinned whole, so no box can be compared another way without this test saying so
  const BOXES = [
    ['name', 'c.s_key', 'c.new_key', 'c.new_key is not null'],
    ['phone', 'c.o_phone', 'c.phone9', 'c.phone9 is not null'],
    ['second phone', 'c.o_phone2', 'c.phone2_9', 'c.phone2_9 is not null'],
    ['bank', 'c.o_bank', "upper(nullif(btrim(c.bank), ''))", "nullif(btrim(c.bank), '') is not null"],
    ['account', 'c.o_account', 'upper(c.account_w)', 'c.account_w is not null'],
    ['NIDA', 'c.o_nida', 'c.nida_d', 'c.nida_d is not null'],
    ['TIN', 'c.o_tin', 'c.tin_d', 'c.tin_d is not null'],
    ['NSSF', 'c.o_nssf', 'c.nssf_d', 'c.nssf_d is not null'],
    ['birth date', 'c.o_birth::text', 'c.birth_w::text', 'c.birth_w is not null and (c.nida_d is not null or c.o_birth_nida is null or c.o_birth_nida = c.birth_w)'],
    ['residence', 'c.o_res', "nullif(regexp_replace(upper(btrim(c.residence)), '\\s+', ' ', 'g'), '')", "nullif(btrim(c.residence), '') is not null"],
    ['start date', 'c.o_start::text', 'c.started::text', 'c.started is not null'],
    ['guarantor 1', 'c.o_g1', 'c.kin1_key', 'c.kin1_key is not null'],
    ['guarantor 1 phone', 'c.o_g1p', 'c.g1p_new', 'c.kin1_key is not null'],
    ['guarantor 2', 'c.o_g2', 'c.kin2_key', 'c.kin2_key is not null'],
    ['guarantor 2 phone', 'c.o_g2p', 'c.g2p_new', 'c.kin2_key is not null'],
  ];
  const block = squash(CODE.slice(CODE.indexOf('lateral (values') + 'lateral (values'.length, CODE.indexOf(') v(ord, label, old, new, given)'))).trim();
  assert.equal(block, BOXES.map((b, i) => '(' + (i + 1) + ", '" + b[0] + "', " + b[1] + ', ' + b[2] + ', ' + b[3] + ')').join(', '), 'the fifteen boxes, as the registry holds them and as the row gives them');
  // and how the registry's own boxes, and the row's names and numbers, are read before they are compared
  for (const frag of [
    "regexp_replace(upper(btrim(w.cur_name)), '\\s+', ' ', 'g') as cur_key",
    "nullif(regexp_replace(upper(btrim(w.new_name)), '\\s+', ' ', 'g'), '') as new_key",
    "nullif(regexp_replace(coalesce(w.nida, ''), '\\D', '', 'g'), '') as nida_raw",
    "nullif(regexp_replace(upper(btrim(w.kin1)), '\\s+', ' ', 'g'), '') as kin1_key",
    "nullif(regexp_replace(upper(btrim(w.kin2)), '\\s+', ' ', 'g'), '') as kin2_key",
    "regexp_replace(upper(btrim(s.name)), '\\s+', ' ', 'g') as s_key",
    "upper(nullif(btrim(s.bank), '')) as o_bank, upper(nullif(btrim(s.account), '')) as o_account",
    "nullif(regexp_replace(coalesce(s.nida, ''), '\\D', '', 'g'), '') as o_nida, nullif(regexp_replace(coalesce(s.tin, ''), '\\D', '', 'g'), '') as o_tin, nullif(regexp_replace(coalesce(s.nssf, ''), '\\D', '', 'g'), '') as o_nssf",
    "s.birth_date as o_birth, nullif(regexp_replace(upper(btrim(s.residence)), '\\s+', ' ', 'g'), '') as o_res, s.reg_date as o_start",
    "nullif(regexp_replace(upper(btrim(s.guarantor1)), '\\s+', ' ', 'g'), '') as o_g1, nullif(regexp_replace(upper(btrim(s.guarantor2)), '\\s+', ' ', 'g'), '') as o_g2",
  ]) assert.ok(c.includes(frag), 'read as written: ' + frag);
});

test('a NIDA that is not twenty digits is never written; a birth date is never set beside a NIDA it was not read from; a guarantor\'s number is cleared only when ANOTHER person replaces the name and no number comes', () => {
  const c = squash(CODE);
  assert.match(c, /case when length\(a\.nida_raw\) = 20 then a\.nida_raw end as nida_d/);
  assert.match(c, /coalesce\(a\.birth_nida, a\.birth\) as birth_w/);
  assert.match(c, /\(9, 'birth date', c\.o_birth::text, c\.birth_w::text, c\.birth_w is not null and \(c\.nida_d is not null or c\.o_birth_nida is null or c\.o_birth_nida = c\.birth_w\)\)/);
  assert.match(c, /case when b\.kin1_key is null then null when b\.kin1_phone9 is not null then b\.kin1_phone9 when b\.kin1_key is not distinct from b\.o_g1 then b\.o_g1p end as g1p_new/);
  assert.match(c, /case when b\.kin2_key is null then null when b\.kin2_phone9 is not null then b\.kin2_phone9 when b\.kin2_key is not distinct from b\.o_g2 then b\.o_g2p end as g2p_new/);
  // the date a NIDA gives is read the same way for the row's NIDA and the registry's (and as the staff template reads it)
  assert.match(MAIN, /a\.nida_d ~ '\^\(19\|20\)\\d\\d\(0\[1-9\]\|1\[0-2\]\)\(0\[1-9\]\|\[12\]\\d\|3\[01\]\)'/);
  assert.equal((FILE.match(/\^\(19\|20\)\\d\\d\(0\[1-9\]\|1\[0-2\]\)\(0\[1-9\]\|\[12\]\\d\|3\[01\]\)/g) || []).length, 2, 'once for the row\'s NIDA, once for the registry\'s');
});

test('every row is copied BEFORE it is changed, once for each label, with the very columns the update can change; the undo puts exactly those back, and the copies stay', () => {
  const c = squash(CODE);
  const copyCols = (c.match(/insert into public\.staff_registry_update_before \(id, label, ([^)]+)\)/) || [])[1].split(', ');
  const tableCols = squash(FILE.slice(FILE.indexOf('create table if not exists public.staff_registry_update_before'), FILE.indexOf('alter table public.staff_registry_update_before'))).match(/saved_at timestamptz not null default now\(\), (.+)\);/)[1].split(', ').map(x => x.split(' ')[0]);
  assert.deepEqual(copyCols, tableCols, 'the copy fills every column of its table');
  assert.deepEqual(copyCols, ['name', 'phone', 'phone2', 'bank', 'account', 'nida', 'tin', 'nssf', 'birth_date', 'residence', 'reg_date', 'guarantor1', 'guarantor1_phone', 'guarantor2', 'guarantor2_phone', 'updated_by', 'updated_at']);
  assert.match(c, /from staff_registry s join todo t on t\.sid = s\.id where not exists \(select 1 from public\.staff_registry_update_before z where z\.id = s\.id and z\.label = \(select label from cfg\)\)/);
  const undo = squash(FILE.split('\n').filter(l => /^-- /.test(l)).map(l => '-- ' + l.replace(/^--\s*/, '')).join(' ').replace(/ -- (?=guarantor1 =| *from public)/g, ' ')).match(/-- update public\.staff_registry s set (name = b\.name.*?updated_at = b\.updated_at) from public\.staff_registry_update_before b where b\.id = s\.id and b\.label = '[^']*';/);
  assert.ok(undo, 'the undo is there');
  assert.deepEqual([...undo[1].matchAll(/([a-z_0-9]+) = b\.([a-z_0-9]+)/g)].map(m => m[1] + ':' + m[2]), copyCols.map(x => x + ':' + x), 'the undo restores exactly the columns the copy took');
  assert.match(FILE, /The copies stay, so this can be run again/);
});

test('it prints no value: ten columns, the boxes by their NAME, never a phone, an account, a NIDA, a TIN, an NSSF or an address', () => {
  const out = squash(CODE.slice(CODE.lastIndexOf('select c.n as "#"')));
  assert.deepEqual([...out.matchAll(/\bas ("?[#a-z_]+"?)/g)].map(m => m[1].replace(/"/g, '')).filter(x => ['#', 'staff_id', 'done', 'name_was', 'name_now', 'filled', 'replaced', 'cleared', 'same_already', 'note'].includes(x)), ['#', 'staff_id', 'done', 'name_was', 'name_now', 'filled', 'replaced', 'cleared', 'same_already', 'note']);
  // the only dates the answer prints are birth dates (a form's, a NIDA's): to_char is used for nothing else
  assert.deepEqual([...new Set([...noStrings(out).matchAll(/to_char\(c\.([a-z_]+)/g)].map(m => m[1]))].sort(), ['birth', 'birth_nida', 'birth_w', 'o_birth_nida']);
  // the only digits it prints are how many a NIDA has
  assert.deepEqual([...new Set([...noStrings(out).matchAll(/length\(c\.([a-z_]+)\)/g)].map(m => m[1]))], ['nida_raw']);
  assert.doesNotMatch(noStrings(out), /\|\|\s*c\.(phone|phone2|phone9|phone2_9|bank|account|account_w|nida|nida_raw|nida_d|tin|tin_d|nssf|nssf_d|residence|kin1|kin2|kin1_phone|kin2_phone|o_[a-z0-9_]+)\b/);
  assert.match(FILE, /NO PHONE, ACCOUNT, NIDA OR OTHER VALUE IS PRINTED/);
});

test('a phone, an account, a TIN and an NSSF are read exactly as the staff template reads them (one definition), and the registry\'s boxes are compared the same way', () => {
  // a phone is read in EIGHT places here (the four a row gives, the four the registry holds): every one of them is read exactly as the staff template reads it, not only the first
  const nines = f => [...squash(f).matchAll(/\(select case when length\(d\.x\) = 9 then d\.x end from \(select right\(regexp_replace\(regexp_replace\(regexp_replace\(coalesce\([\w.]+, ''\), '[^']*', '', 'g'\), '[^']*', ''\), '[^']*', ''\), 9\) as x\) d\)/g)].map(m => m[0].replace(/coalesce\([\w.]+, ''\)/, "coalesce(X, '')"));
  assert.equal(nines(FILE).length, 8, 'a phone is read in eight places: the four a row gives and the four the registry holds');
  assert.ok(nines(MAIN).length >= 4, 'the staff template reads a phone in the same shape');
  assert.equal(new Set([...nines(FILE), ...nines(MAIN)]).size, 1, 'the nine digits of a phone: every place reads it exactly as the staff template does');
  assert.deepEqual([...squash(FILE).matchAll(/coalesce\(([\w.]+), ''\), '\\D', '', 'g'\), '\^255'/g)].map(m => m[1]), ['w.phone', 'w.phone2', 'w.kin1_phone', 'w.kin2_phone', 's.phone', 's.phone2', 's.guarantor1_phone', 's.guarantor2_phone'], 'which eight');
  const acc = f => ((squash(f).match(/case when coalesce\(\w+\.account, ''\) ~ '\^\[\\d\.\\s-\]\+\$' then nullif\(regexp_replace\(\w+\.account, '\\D', '', 'g'\), ''\) else nullif\(btrim\(\w+\.account\), ''\) end/) || [''])[0]).replace(/\w+\.account/g, 'X.account');
  assert.ok(acc(FILE) && acc(FILE) === acc(MAIN), 'the account as the staff form saves it: digits, or the text as it is when a bank writes letters');
  assert.match(FILE, /nullif\(regexp_replace\(coalesce\(w\.tin, ''\), '\\D', '', 'g'\), ''\) as tin_d/);
  assert.match(FILE, /nullif\(regexp_replace\(coalesce\(w\.nssf, ''\), '\\D', '', 'g'\), ''\) as nssf_d/);
  assert.match(MAIN, /nullif\(regexp_replace\(coalesce\(k\.tin, ''\), '\\D', '', 'g'\), ''\) as tin_d/);
});

test('the notes say what the file did not do: a NIDA refused, a birth date not written, a name somebody else carries, a number cleared, a phone refused', () => {
  const c = squash(CODE);
  for (const note of ['NIDA NOT written: it has', 'is not the one in the NIDA number the registry holds', 'is not the one in the NIDA number (', 'LOOK: another staff already carries the name sent: ', 'a guarantor\'\'s old number was cleared', 'the account has no bank name on the row or in the registry', 'a phone sent is not a nine-digit number'])
    assert.ok(c.includes(note), 'the note "' + note + '"');
  assert.match(c, /when c\.sid is null then 'NO STAFF WITH THAT ID: nothing changed' when not c\.ok then 'THAT ID CARRIES ANOTHER NAME \(' \|\| c\.s_name \|\| '\): nothing changed' when p\.changed > 0 then 'UPDATED' else 'NOTHING TO CHANGE: the registry already holds all of it' end as done/);
});

test('the kept check runs the whole real schema, runs the template AS WRITTEN with its list replaced, compares every column of every staff with a model, tests a second run and the undo, times a registry ten times the live one, and breaks the file on purpose', () => {
  // what the check DOES is pinned, never what its header says it does (a header comment can go on promising what the code stopped doing)
  const CC = CHECK.replace(/\/\*[\s\S]*?\*\//, '');
  assert.match(CC, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.match(CC, /const FILE = fs\.readFileSync\(path\.join\(ROOT, 'db\/TEMPLATE-staff-update-by-id\.sql'\)/);
  assert.doesNotMatch(CC, /create table[^\n]*staff_registry\b[^_]/i, 'the table is the real one, never declared by hand (RUN-ME-061)');
  for (const label of [
    "every line the file prints equals the model",
    "no printed line holds a phone, an account, a NIDA",
    "EVERY column of EVERY staff is what the model says after the run",
    "the staff nobody named are byte-identical",
    "the before-images hold exactly the staff changed",
    "a second run changes nothing",
    "the undo at the foot puts the whole registry back byte for byte",
    "a registry of about 50,000 staff",
  ]) assert.ok(CC.includes("check('" + label), 'the check still runs: ' + label);
  assert.match(CC, /generate_series\(1, 50000\)/);
  assert.match(CC, /check\('BROKEN ON PURPOSE/);
  assert.ok((CC.match(/^\s+\['[^\n]+',\s+(?:rep\(|src =>)/gm) || []).length >= 40, 'forty deliberate breaks or more, each of which must change the outcome');
});
