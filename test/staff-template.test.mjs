/* THE STAFF-CHANGE TEMPLATES CARRY NO STAFF (docs/HANDOFF.md Parts 48 to 53).
 *
 *   "Ill be comming with staff db updates simce GMOs comfirm of changes in my whatsapp group"
 *   "dont correct names using the gmo data i bring unless its new staff"
 *   "If an officer has team - zone is automatic of the GMO's" ... "to the respective team's gmo"
 *
 * A GMO's list is answered with a FILLED COPY of db/TEMPLATE-staff-changes-from-gmo.sql, handed
 * to the owner. The repository is public: the day a filled copy is committed, the names of the
 * people who left and joined a team are on the internet. So that is written down here as
 * something that fails, along with the three promises the scripts make to the live book: they
 * delete nothing, they never re-spell a name, and their time limits end with the script.
 *
 * It reads two files and no database. The scripts themselves were run on a PostgreSQL holding
 * this repository's schema; node cannot do that here, and this test does not pretend to. The one
 * rule the script shares with the portal (a team's zone is its GMO's) is held here by its text,
 * and checked for real, on a PostgreSQL, by tools/db-checks/gmo-zone-parity.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const LIST = 'db/TEMPLATE-staff-changes-from-gmo.sql', BY_ID = 'db/TEMPLATE-staff-changes-by-id.sql';
/** The script without its comments: what the database is actually sent. */
const code = f => read(f).split('\n').map(l => l.replace(/--.*$/, '')).join('\n');
/** Every quoted value of the VALUES block that follows `opener`. */
function listed(f, opener) {
  const s = code(f), at = s.indexOf(opener);
  assert.ok(at >= 0, f + ' has no "' + opener + '" block any more');
  const block = s.slice(at, s.indexOf('\n),', at));
  return [...block.matchAll(/'([^']*)'/g)].map(m => m[1]);
}
const HOW = '. The repository is public: hand the filled copy to the owner and commit the template as it was (docs/HANDOFF.md Part 48).';

test('the list template names nobody: placeholders only', () => {
  const values = listed(LIST, 'ask(n, grp, act, name, role_word, team_text, zone_teams, zone_else, zone_like, account, phone, bank, nida, tin, nssf, why) as (values');
  assert.ok(values.length >= 10, 'the example list is gone');
  // one example row of each thing that can be asked, and nothing that could be a person, a team, a zone or an account
  const PLACEHOLDER = /^(OFF|MOVE|NEW|PLACE|ASK|ZONE NAME|TEAM (ONE|TWO)|Team (One|Two)|Manager|Field Officer|(FIRST|ANOTHER|THIRD|FOURTH|FIFTH) MIDDLE LAST|0000000000|0700000000|BANK|what is missing)$/;
  for (const v of values) assert.ok(PLACEHOLDER.test(v), LIST + ' carries "' + v + '" in its list' + HOW);
  for (const act of ['OFF', 'MOVE', 'NEW', 'PLACE', 'ASK']) assert.ok(values.includes(act), 'the example list no longer shows ' + act);
  const cfg = code(LIST).slice(code(LIST).indexOf('with cfg as ('), code(LIST).indexOf('ask(n, grp, act, name'));
  assert.deepEqual([...cfg.matchAll(/'([^']*)'/g)].map(m => m[1]), ['GMO ZONE NAME (SQL)'],
    LIST + ' was committed with a real zone on its CHANGE line' + HOW);
});

test('the by-ID template names nobody: placeholders only', () => {
  const values = listed(BY_ID, 'with want(id, name) as (values');
  assert.ok(values.length >= 2);
  for (const v of values) {
    assert.ok(/^([A-Z]{3}\/000[0-9]\/2026|FIRST MIDDLE LAST)$/.test(v), BY_ID + ' carries "' + v + '" in its list' + HOW);
  }
  assert.ok(code(BY_ID).includes("'GMO ZONE NAME (SQL)'"), BY_ID + ' was committed with a real zone' + HOW);
});

test('neither script deletes anything, and neither ever writes a name onto a staff who is already there', () => {
  for (const f of [LIST, BY_ID]) {
    const s = code(f).toLowerCase();
    assert.ok(!/\b(delete\s+from|truncate|drop\s+|alter\s+)/.test(s), f + ' now deletes or alters: a staff who leaves is switched to Inactive and keeps their history');
    // every UPDATE of the registry: its SET list must not touch `name`
    const sets = [...s.matchAll(/update\s+staff_registry\s+s\s+set([\s\S]*?)\bfrom\b/g)].map(m => m[1]);
    assert.ok(sets.length >= 1, f + ' no longer updates the registry the way this test reads it');
    for (const set of sets) {
      assert.ok(!/(^|,|\s)name\s*=/.test(set), f + ' re-spells a name that is already in the registry: "dont correct names using the gmo data i bring unless its new staff"');
    }
  }
  assert.equal([...code(LIST).toLowerCase().matchAll(/insert\s+into\s+staff_registry/g)].length, 1, 'one insert: a staff the registry does not hold');
  assert.equal([...code(BY_ID).toLowerCase().matchAll(/insert\s+into/g)].length, 0, 'the by-ID script adds nobody');
});

test('a staff is switched off or moved only when exactly ONE fits; nobody is added whom the registry could already hold', () => {
  const s = code(LIST);
  assert.ok(/case when p\.live_n = 1 then p\.live_id when p\.live_n = 0 and p\.all_n = 1 then p\.any_id end as id/.test(s),
    'a row no longer needs exactly one staff to fit (the only live one, else the only one)');
  assert.ok(/where t\.use_nth = 1 and a\.nth = 1 and a\.act in \('OFF', 'MOVE', 'PLACE'\)/.test(s),
    'one staff can now be changed by two rows of the list, or a name listed twice acts twice');
  assert.ok(/where a\.nth = 1 and a\.act in \('NEW', 'PLACE'\) and t\.all_n is null/.test(s),
    'a new staff is added although somebody in the registry could be them');
  assert.ok(/and coalesce\(z\.z_team, z\.z_else, z\.z_like\) is not null/.test(s), 'a new staff is added with no zone: they would be on nobody\'s list');
  // the looser ways of finding somebody are for people the registry already holds, never for a NEW one
  assert.equal([...s.matchAll(/where a\.act in \('OFF', 'MOVE', 'PLACE'\) and a\.n not in \(select n from exact\)/g)].length, 3,
    'finding by one letter apart or by a shorter name is no longer kept to OFF, MOVE and PLACE, and to names the registry does not have as written');
  // a phone finds somebody only together with a word of their name: a line can pass to another person
  assert.ok(/r\.phone9 = a\.phone9 and r\.nkey <> a\.nkey\s*\n\s*-- [^\n]*\n\s*and exists \(select 1 from unnest\(a\.w\) x, unnest\(r\.w\) y/.test(read(LIST)),
    'a phone number alone now decides who is meant');
  assert.ok(/where s\.id = was\.id and was\.same_name and upper\(btrim\(was\.status\)\) <> 'INACTIVE'/.test(code(BY_ID)),
    'the by-ID script no longer checks that the ID still carries the name: a mistyped ID would switch off somebody else');
});

test('the time limits end with the script, and both say what was done for every row', () => {
  for (const f of [LIST, BY_ID]) {
    const s = code(f);
    assert.ok(/set local lock_timeout = '5s';/.test(s) && /set local statement_timeout = '(30|60)s';/.test(s), f + ' no longer limits itself');
    // a statement of its own (at the margin), not the SET list of an UPDATE (indented)
    assert.ok(!/^set\s+(?!local)/im.test(s), f + ' leaves a setting behind on the editor\'s session');
    assert.ok(/\) as done\b|end as done\b/.test(s), f + ' no longer answers with what was done: silence reads as success');
  }
  assert.ok(/from a2 a\s*\njoin tgt t\s+on t\.n = a\.n\s*\njoin z\s+on z\.n = a\.n/.test(code(LIST)) && /order by a\.n;\s*$/.test(code(LIST)),
    'the answer is no longer one row for each person asked, in the order of the list');
  // The list script is one long statement. A PostgreSQL that compiles long queries (JIT) spent eight seconds compiling
  // it and a fifth of a second running it; the SQL editor has an upstream time limit of its own. `set local` ends with
  // the script, like the two limits above.
  assert.ok(/^set local jit = off;/m.test(code(LIST)), LIST + ' no longer switches the query compiler off for itself: seconds of compiling before it runs');
});

/* A TEAM'S ZONE IS ITS GMO'S (docs/HANDOFF.md Parts 50 and 52) -- the same rule the portal reads a team by (teamsZoned in
   api/_lib/zone.js), written here in SQL. Two spellings of one rule can drift, and this one drifting files a staff under
   one zone while their team's code lists another. The text is held here; that the two READ ALIKE is checked on a real
   PostgreSQL by tools/db-checks/gmo-zone-parity.mjs, which cuts these steps out of the template by name. */
test('a team\'s zone is its GMO\'s, in the script as in the portal, and the row says where a zone came from', () => {
  const s = code(LIST), whole = read(LIST);
  for (const step of ['tm as (', 'gz as (', 'tz as (', 'z as (']) {
    assert.ok(s.includes('\n' + step), LIST + ' no longer has the step "' + step + '": the parity check reads the rule by these names');
  }
  assert.ok(s.includes('coalesce(m.own, gz.zone) as zone'), 'the order is gone: the team\'s own ZONE cell, else the zone its GMO\'s teams carry');
  // Teams & Staff is the ONLY place a GMO's zone is read from. The script once went on to the zone on the GMO's own row in
  // the registry: a GMO moved by the same list (or by an earlier one) then took with him every officer sent to the teams
  // that still named him, and the second run of the script did not agree with the first. Found by review; the step is gone.
  assert.ok(!/\bgr\b|gmorow/.test(s), LIST + ' reads a GMO\'s zone off the registry again: "the second run changes nothing" no longer holds');
  const rule = whole.slice(whole.indexOf('\ntm as ('), whole.indexOf('\nz as (   -- the zone for a row'));
  assert.ok(rule.length > 500 && !/staff_registry|\breg\b/.test(rule.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')),
    'the steps tm / gz / tz read the staff registry: the portal does not, and the two would part');
  // THE RULE DOES NOT GUESS (docs/HANDOFF.md Part 52): a GMO's zone is read only when ALL their teams that carry a zone
  // carry the SAME one. Its first form took the zone most teams carried, a tie going A to Z, and the live Teams & Staff had
  // a GMO named on teams of four zones: an officer was filed by alphabet.
  assert.ok(s.includes('select g.gkey, case when count(*) = 1 then min(g.zone) end as zone, count(*) as zones_n,'),
    'a GMO named on teams of more than one zone gives one of them again: that is a choice, and the rule makes none');
  assert.ok(!/array_agg\(g\.zone order by/.test(s), LIST + ' still picks among a GMO\'s zones');
  assert.ok(s.includes("case when c.g_named then upper(regexp_replace(c.g, sp.blank || '+', ' ', 'g')) end as gkey"),
    'a GMO is no longer one person however the name was typed (capitals, runs of blanks)');
  // A DASH IS NOT A PERSON, AND NOT A ZONE: the cells are read by the repository's one definition of "nobody named". The
  // list is parse.js's, with the two ways a sheet says it in words: if parse.js changes its list, this says where the copy is.
  assert.ok(s.includes(String.raw`'^([-\u2010-\u2015_.\u00B7]+|n/?a|none|nil|null|hakuna|0|no[ -].*|\(unassigned\).*)$'::text as nobody`),
    LIST + ' no longer reads a dash, N/A, NONE or "NO GMO" as nobody: teams with the same placeholder in the GMO cell become one GMO\'s teams');
  assert.ok(read('api/_lib/parse.js').includes(String.raw`const NOBODY = /^(?:[-\u2010-\u2015_.\u00B7]+|n\/?a|none|nil|null|hakuna|0)$/i;`),
    'nameOrNull\'s list of what names nobody has changed: carry the change into the `nobody` pattern of ' + LIST + ' and into this test');
  assert.ok(s.includes("c0.g <> '' and c0.g !~* sp.nobody as g_named, c0.z <> '' and c0.z !~* sp.nobody as z_named"));
  // a cell pasted from Excel or WhatsApp: the blanks JavaScript's trim() drops, spelt out, because btrim() drops spaces only
  assert.ok(s.includes(String.raw`'[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'::text as blank`),
    LIST + ' no longer drops a no-break space or a tab the way the portal does: the same table would give a team two zones');
  // a manager over several teams: the first of them that has a zone ("must have gmo of one of his team"). Two teams whose
  // names differ only by a mark or by capitals: the one written, then the one with its ZONE typed, then A to Z -- never
  // whichever the database happened to meet first.
  assert.ok(s.includes('order by (t.zone is null), zt.pos, (upper(btrim(t.team)) <> upper(btrim(zt.name))), (t.how is distinct from \'team\'), t.team collate "C"'),
    'the team a row means is no longer settled the same way every time');
  // a cell with no letter or digit in it is not a zone's name: it once answered for every row that gave no word for its zone
  assert.ok(s.includes("where regexp_replace(upper(coalesce(q.zone, '')), '[^A-Z0-9]', '', 'g') <> ''")
    && s.includes("where zz.key = nullif(regexp_replace(upper(coalesce(a.zone_else, '')), '[^A-Z0-9]', '', 'g'), '')) as z_else"),
    'a zone cell holding only a dash or a tab is handed to every row of the list that names no zone');
  // THE STAFF ALREADY ON THE TEAM ARE NOT ASKED FOR ITS ZONE. They once were (the mode of their zones). A staff moved to a
  // team with no zone keeps the zone they came from, so the next person sent there was filed under that left-over zone: for
  // the team whose GMO is over several zones, under the very zone the old tie had picked. Found by review. What is left when
  // Teams & Staff cannot say is what the ROW says: the sender's word for a filed zone, or the one zone of the colleagues it
  // names; and nothing in the script takes "the most common" of anything.
  assert.ok(!/z_peers|mode\(\)/.test(s), LIST + ' asks the staff already on a team for its zone again, or picks the most common of several zones');
  assert.ok(s.includes("when a.act = 'MOVE' then coalesce(z.z_team, z.z_else, r.zone)") && s.includes('else coalesce(z.z_team, z.z_else, z.z_like, r.zone) end as new_zone'),
    'the order a zone is looked for has changed: Teams & Staff, then the row\'s own word, then (not for a MOVE) the colleagues it names, else as it was');
  assert.ok(s.includes('having count(distinct upper(btrim(r.zone))) = 1) as z_like'), 'the colleagues a row names decide even when they carry different zones');
  // one zone however its cells were spaced: compared exactly as a GMO's name is
  assert.ok(s.includes("case when c.z_named then upper(regexp_replace(c.z, sp.blank || '+', ' ', 'g')) end as own"),
    'a doubled blank inside one ZONE cell makes its GMO "a GMO over two zones" again');
  // the note says what happened, not what usually happens: a PLACE that found its person and took no zone from anybody once
  // said the zone was "taken from colleagues on the same list"
  assert.ok(s.includes("when a.act <> 'MOVE' and z.z_like is not null then ': zone taken from the colleagues the row names'")
    && s.includes("else ': zone left as it was. To file them: ' || z.z_fix end end,"),
    'the note no longer tests where the zone really came from');
  // said, never silent: a zone that is not the team's own cell is explained on the row, and so is a zone that could not be
  // found, with what settles it (not the same thing for every reason); somebody who is not found is answered name by name
  for (const said of ["zone is its GMO''s", 'is named on teams of more than one zone (', 'so none is taken', 'no GMO is named on it',
    'has no team with a zone', 'no team of that name on Teams & Staff', 'no team was given', 'who carries a name like each of these', "'nobody')",
    'type the ZONE on the team (or name its GMO) on Teams & Staff and run the script again',
    'type the ZONE on the team on Teams & Staff and run the script again',
    'write the team as Teams & Staff names it, or add it there with its ZONE, and run the script again',
    "give the team on the row (zone_teams), or the sender''s word for a filed zone (zone_else), and run the script again"]) {
    assert.ok(s.includes(said), LIST + ' no longer says "' + said + '" on the row');
  }
  // the portal's side of the rule is where the template says it is: no choosing among a GMO's zones, the same nobody, and a
  // zone compared with runs of blanks as one
  const zone = read('api/_lib/zone.js');
  assert.ok(/export function teamsZoned\(teamRows\)/.test(zone) && zone.includes('if (of && of.size === 1) return { ...t, zone: of.values().next().value, zoneFromGmo: true };'),
    'teamsZoned in api/_lib/zone.js is gone, or takes a zone from a GMO whose teams carry more than one: the template names it as the same rule');
  assert.ok(zone.includes(String.raw`const Z = s => cell(s).toUpperCase().replace(/\s+/g, ' ');`), 'zone.js compares a zone without treating runs of blanks as one: the script does');
  assert.ok(zone.includes(String.raw`const NO_ONE = /^(?:NO[ -]|\(UNASSIGNED\))/i;`) && zone.includes('const s = nameOrNull(v);'),
    'zone.js no longer reads a cell through nameOrNull and the two words: the script\'s `nobody` pattern is the same list');
  assert.ok(whole.includes('teamsZoned in api/_lib/zone.js'), LIST + ' no longer points at the portal\'s side of the rule');
  assert.ok(fs.existsSync(new URL('../tools/db-checks/gmo-zone-parity.mjs', import.meta.url)), 'the check that reads a table both ways is gone');
  const parity = read('tools/db-checks/gmo-zone-parity.mjs');
  assert.ok(parity.includes("cut('tm as (', 'z as (   -- the zone for a row')"), 'the parity check no longer cuts the rule out of the template itself');
  assert.ok(whole.includes('z as (   -- the zone for a row'), LIST + ' renamed the step the parity check cuts up to: it would stop with an error rather than check');
  assert.ok(/const NOBODY = \[/.test(parity) && /const BLANKS = \[/.test(parity) && parity.includes('THE DRAW IS LOPSIDED'),
    'the parity check no longer draws the cells that name nobody and the pasted blanks, or no longer refuses a lopsided draw');
});

/* THE REST OF A STAFF FORM, AND HEAD-OFFICE PEOPLE (docs/HANDOFF.md Part 53) -- "Zone pmo hq", with three forms that each
   carried a parent, a next of kin, a start date, an address and a second phone. The registry has a box for every one of
   those (the staff form in public/mod/advance.js), and the script wrote six of the form's fields and dropped the rest.
   They travel in a SECOND list (`more`), so a list with no forms is written exactly as before. What is held here: a new
   staff is added with the whole form; a staff the registry already holds has only their EMPTY boxes filled; a moved
   staff is never touched by it; and three things a form can say wrongly are said on the row, not acted on. */
test('the rest of a staff form: stored for a new staff, only what is empty on one already there, nothing on a moved one', () => {
  const s = code(LIST), n = (text) => s.split(text).length - 1;
  assert.deepEqual(listed(LIST, 'more(n, phone2, residence, started, birth, kin1, kin1_phone, kin2, kin2_phone) as (values'), [],
    LIST + ' carries somebody in its details list' + HOW);
  assert.ok(s.includes('(0, null::text, null::text, null::date, null::date, null::text, null::text, null::text, null::text)'),
    'the details list no longer starts as one row of nulls under a number nobody has');
  assert.ok(/from more d\s*\n\s*where d\.n = k\.n\s*\n\s*limit 1/.test(s) && s.includes('(select count(*) from more c where c.n = k.n) as more_n'),
    'a number written twice in the details list would answer with two rows for one person');
  // A NEW STAFF carries the whole form, and the day they started is the REG-DATE.
  assert.ok(s.includes('insert into staff_registry (id, reg_date, name, phone, phone2, role, residence, bank, account, zone, nida, birth_date,')
    && s.includes('guarantor1, guarantor1_phone, guarantor2, guarantor2_phone, tin, nssf, status, created_by, updated_by, updated_at)'),
    'a new staff is added without the rest of their form');
  assert.ok(s.includes("select n.id, coalesce(n.started, (now() at time zone 'Africa/Dar_es_Salaam')::date), n.name, n.phone9, n.phone2_9, n.role, n.residence,"),
    'the day a staff started is no longer their REG-DATE');
  // A STAFF ALREADY THERE: only under PLACE, and only into a box that is empty.
  for (const col of ['phone2', 'residence', 'reg_date', 'guarantor1', 'guarantor2']) {
    assert.ok(new RegExp('\\n\\s+' + col + "\\s+= case when p\\.act = 'PLACE' then coalesce\\((nullif\\(btrim\\(s\\." + col + "\\), ''\\)|s\\." + col + '), p\\.').test(s),
      col + ' is written on a staff already in the registry other than under PLACE, or over what is there');
  }
  for (const k of ['1', '2']) {
    assert.ok(s.includes('guarantor' + k + "_phone = case when p.act = 'PLACE' and coalesce(btrim(s.guarantor" + k + "), '') = ''"),
      'the number of one person can be written beside the name of another (guarantor ' + k + ')');
  }
  // every box the SET can fill is also a reason to run the update, or a second run would never say "nothing changed"
  for (const why of ["(coalesce(btrim(s.phone2), '') = '' and p.phone2_9 is not null)", "(coalesce(btrim(s.residence), '') = '' and p.residence is not null)",
    '(s.reg_date is null and p.started is not null)', "(coalesce(btrim(s.guarantor1), '') = '' and (p.kin1 is not null or",
    "(coalesce(btrim(s.guarantor2), '') = '' and (p.kin2 is not null or"]) {
    assert.ok(s.includes('or ' + why), 'a PLACE that only brings ' + why + ' no longer fills it');
  }
  // THE BIRTH DATE is the NIDA's, as the staff form reads it; never beside a NIDA it was not read from; and a NIDA
  // that says 31 February gives no date instead of stopping the whole script.
  assert.ok(!/to_date\(/.test(s), 'to_date is back: a NIDA whose first digits are no day of the calendar stops the script with an error');
  assert.ok(s.includes('then make_date(substr(a.nida_d, 1, 4)::int, substr(a.nida_d, 5, 2)::int, substr(a.nida_d, 7, 2)::int) end')
    && s.includes('coalesce(a0.birth_nida, a0.birth_typed) as birth'), 'the date written on a form is read before the NIDA number');
  assert.equal(n("(coalesce(btrim(s.nida), '') = '' or regexp_replace(s.nida, '\\D', '', 'g') = p.nida_d)"), 2,
    'a birth date is set beside a NIDA number it was not read from, or the SET and the WHERE no longer agree');
  assert.ok(read('api/_lib/portal-core.js').includes('const birth = nidaBirth(nida) || advDate_(p.birthDate);'),
    'the staff form no longer reads the birth date off the NIDA first: the script says it does');
  // AN ACCOUNT is stored as the staff form stores one (accountCell): its digits when it is digits and marks.
  assert.ok(s.includes(String.raw`case when coalesce(k.account, '') ~ '^[\d.\s-]+$' then nullif(regexp_replace(k.account, '\D', '', 'g'), '')`)
    && n('a.account_w as account') === 2 && !/\ba\.account\b(?!_w)/.test(s.slice(s.indexOf('\nplan as ('))),
    'an account is written to the registry as it was typed in a message ("307 100 70344"), not as the staff form saves it');
  // WHAT THE ROW SAYS and does not act on.
  for (const said of ["'the NIDA number sent has ' || length(a.nida_d) || ' digits and a NIDA has 20: kept as it was sent'",
    "): the NIDA''s is kept, as the staff form does'", "' times: the first was read'"]) {
    assert.ok(s.includes(said), LIST + ' no longer says ' + said + ' on the row');
  }
});

test('head-office people: a word that is no filed zone adds nobody, and the row names the zones it may mean', () => {
  const s = code(LIST), whole = read(LIST);
  // The zone itself is decided exactly as before: the sender's word counts only as the name of a zone already filed.
  assert.ok(s.includes("where zz.key = nullif(regexp_replace(upper(coalesce(a.zone_else, '')), '[^A-Z0-9]', '', 'g'), '')) as z_else,"));
  assert.ok(s.includes('and coalesce(z.z_team, z.z_else, z.z_like) is not null'));
  // ... and what is new is words on the row: defined once, read twice, both times inside the note.
  assert.equal(s.split('z_word_miss').length - 1, 3, 'z_word_miss is read somewhere else than the note: it is text for a person, never a zone');
  assert.ok(s.includes('end as z_word_miss,') && s.includes('then z.z_word_miss end,'));
  assert.ok(s.includes("'the sender''s word for the zone (' || btrim(a.zone_else) || ') is not a zone already filed; '")
    && s.includes("'no filed zone shares a word with it')"), 'the row no longer says that the word it was given is no filed zone');
  // The department zones are the portal's (one spelling of the rule there); the template only tells the filler about them.
  assert.ok(read('api/_lib/portal-core.js').includes("const ADV_DEPT_PREFIXES = ['HQ', 'MANAGEMENT'];"),
    'the portal no longer files head-office people under HQ / MANAGEMENT: the template\'s paragraph on them is out of date');
  assert.ok(whole.includes('HEAD-OFFICE PEOPLE HAVE NO TEAM') && whole.includes('role_word is the role AS ROLES & ACCESS SPELLS IT'),
    LIST + ' no longer tells the filler how a head-office person is written');
});
