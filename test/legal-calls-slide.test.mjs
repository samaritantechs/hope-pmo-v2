/* THE LEGAL OFFICERS' CALLS SLIDE (handbook Part 141).

   "I'VE BEEN SHOCKED BY LEGAL CALLS
    at presentation: i need their calls slide too, that is the one that should include calls recovery daily and weeekly.
    leaving the demand recovery slide as it was" -- the owner, 24 Nov 2026, over a read-only look at the legal phones:
    two of them doing the ringing, nine conversations in ten with numbers the system holds for no customer, and three
    that had sent no call at all.

   What is held here:
     * WHO is on the slide: every phone whose role READS legal -- by the reading db/RUN-ME-089 stamps by (the role of the
       one access code that carries the phone's name, else the registered role) and the portal's one test of a legal role
       -- the SILENT ones too; nobody else.
     * WHAT each row carries: the call boards' own figures for that name (today, the week) and the Legal tab's own phone
       lines (customers at D.C 2 and above spoken to, recovered today and this week); the rows add up to the phone card.
     * A dash, not a nought, where recovery by phone cannot be read.
     * No read is added: the rows are arithmetic over what the officer boards already hold.
     * The Presentation: the demand-recovery slide is as it was before recovery by phone was put on it, and the new slide
       carries it.
   The screens in a real browser: tools/browser-checks/portal-legal-phone.mjs (section 9). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeDb } from './fake-db.mjs';
import { LEGAL_PHONE_RPC } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi, phoneRoleRead } = await import('../api/_lib/portal-core.js');

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-07-24T09:00:00Z');                    // Friday noon in East Africa
const TODAY = '2026-07-24', MON = '2026-07-20';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const ONE_TEAM = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['MBAGALA'], tabs: ['legal', 'dashboard', 'present'] };

/* THE PHONES. Who reads legal, and who does not:
     u1  WAKILI ONE    registered LEGAL, one code of that name says LEGAL                      legal
     u2  wakili two    registered FIELD OFFICER, the ONE code of that name says Legal Officer  legal (the code's role is read)
     u3  WAKILI ALL    registered LEGAL (its code holds every team)                            legal
     u4  WAKILI KIMYA  registered LEGAL, no code, NOT ONE CALL                                 legal, and silent
     u5  MENEJA M      registered LEGAL, but the one code of that name says MANAGER            not legal (the code's role is read)
     u6  ADV ONE       registered Advocate - HQ                                                legal only when the setting names that role
     u7  PARA ONE      registered PARALEGAL                                                    not legal (the word LEGAL is not in it)
     u8  TWIN NAME     registered LEGAL, TWO codes carry the name (LEGAL and MANAGER)          legal (two codes decide nothing: the registered role)
     u9  RECO ONE      registered PMO RECOVERY                                                 not legal
     u10 WAKILI OFF    registered LEGAL, switched off                                          not listed */
const USERS = () => [
  { user_id: 'u1', name: 'WAKILI ONE', team: 'KONGOWE', role: 'LEGAL' },
  { user_id: 'u2', name: 'wakili two', team: 'MBAGALA', role: 'FIELD OFFICER' },
  { user_id: 'u3', name: 'WAKILI ALL', team: 'TANDIKA', role: 'LEGAL' },
  { user_id: 'u4', name: 'WAKILI KIMYA', team: 'KONGOWE', role: 'LEGAL' },
  { user_id: 'u5', name: 'MENEJA M', team: 'KONGOWE', role: 'LEGAL' },
  { user_id: 'u6', name: 'ADV ONE', team: 'KONGOWE', role: 'Advocate - HQ' },
  { user_id: 'u7', name: 'PARA ONE', team: 'KONGOWE', role: 'PARALEGAL' },
  { user_id: 'u8', name: 'TWIN NAME', team: 'MBAGALA', role: 'LEGAL' },
  { user_id: 'u9', name: 'RECO ONE', team: 'KONGOWE', role: 'PMO RECOVERY' },
  { user_id: 'u10', name: 'WAKILI OFF', team: 'KONGOWE', role: 'LEGAL', active: false },
];
const CODES = () => [
  { code: 'L1', name: 'WAKILI ONE', role: 'LEGAL', teams: ['KONGOWE'], tabs: [] },
  { code: 'L2', name: 'WAKILI TWO', role: 'Legal Officer', teams: ['MBAGALA'], tabs: [] },
  { code: 'L3', name: 'WAKILI ALL', role: 'LEGAL', teams: [], tabs: [] },
  { code: 'M5', name: ' meneja m ', role: 'MANAGER', teams: ['KONGOWE'], tabs: [] },
  { code: 'T1', name: 'TWIN NAME', role: 'LEGAL', teams: ['MBAGALA'], tabs: [] },
  { code: 'T2', name: 'TWIN NAME', role: 'MANAGER', teams: ['KONGOWE'], tabs: [] },
  { code: 'R1', name: 'RECO ONE', role: 'PMO RECOVERY', teams: ['KONGOWE'], tabs: ['legal'] },
];
/* THE CALLS of the week (Mon 20 to Fri 24 Jul). A number is one call a day however often it is dialled; a dial is a
   conversation when it lasted longer than five seconds. */
const L = (id, officer, team, phone, date, extra = {}) => ({ id, officer, team, phone, call_date: date, duration: 0, portfolio: false, outcome: 'CONNECTED', ref: null, category: null, ...extra });
const CALLS = () => [
  // WAKILI ONE today: three numbers, one of them dialled twice; two conversations, one with a customer of her own team
  L('c01', 'WAKILI ONE', 'KONGOWE', '0712000100', TODAY, { duration: 130, portfolio: true, ref: '100', category: 'DEFAULTER' }),
  L('c02', 'WAKILI ONE', 'KONGOWE', '0712000100', TODAY, { duration: 3, portfolio: true, ref: '100', category: 'DEFAULTER' }),
  L('c03', 'WAKILI ONE', 'KONGOWE', '0799000001', TODAY, { duration: 400 }),
  L('c04', 'WAKILI ONE', 'KONGOWE', '0799000002', TODAY, { duration: 2 }),
  // ... and earlier in the week
  L('c05', 'WAKILI ONE', 'KONGOWE', '0799999999', '2026-07-21', { duration: 45, portfolio: true, ref: '100', category: 'DEFAULTER' }),
  L('c06', 'WAKILI ONE', 'KONGOWE', '0712000300', '2026-07-22', { duration: 60, portfolio: true, ref: '300', category: 'DEFAULTER' }),
  // wakili two: today two numbers, both conversations; Thursday one
  L('c07', 'wakili two', 'MBAGALA', '255755000100', TODAY, { duration: 300, ref: '100' }),
  L('c08', 'wakili two', 'MBAGALA', '0712000200', TODAY, { duration: 20, portfolio: true, ref: '200', category: 'DEFAULTER' }),
  L('c09', 'wakili two', 'MBAGALA', '0788888888', '2026-07-23', { duration: 80, portfolio: true, ref: '600', category: 'DEFAULTER' }),
  // WAKILI ALL: one conversation today
  L('c10', 'WAKILI ALL', 'TANDIKA', '0712000500', TODAY, { duration: 33, portfolio: true, ref: '500', category: 'DEFAULTER' }),
  // people who are not on the slide ring too
  L('c11', 'MENEJA M', 'KONGOWE', '0712000900', TODAY, { duration: 90, portfolio: true, ref: '900' }),
  L('c12', 'RECO ONE', 'KONGOWE', '0712000901', TODAY, { duration: 90, portfolio: true, ref: '901' }),
  // TWIN NAME: a dial on Monday that only rang
  L('c13', 'TWIN NAME', 'MBAGALA', '0712000902', MON, { duration: 0 }),
  // last week: outside the window
  L('c14', 'WAKILI KIMYA', 'KONGOWE', '0712000903', '2026-07-15', { duration: 500, portfolio: true, ref: '903' }),
];
/* WHAT A STAMP WOULD HAVE WRITTEN (the fixture of test/legal-phone.test.mjs): customer 100 spoken to today by ONE (130 s) and
   by two (300 s: she spoke longest, so the day's 40,000 is hers); 100 again on the 21st by ONE (10,000); 200 today by two
   (nothing paid); 300 at D.C 1 (not the lawyers'); 400 by a PARALEGAL (not a lawyer); 500 by ALL (5,000); 600 on the 23rd by
   two, whose later file is not in; 700 by an ADVOCATE (a lawyer only when the setting says so). */
const R = (day, ref, team, dc, uid, officer, role, phone, secs, calls, ini, cur, rec, extra = {}) => ({ day, ref, team, full_name: 'CUSTOMER ' + ref,
  contact: '0712000' + ref, guarantor_contact: '0755000' + ref, dc, ds: (12 - dc - 1) + '-12', user_id: uid, officer, role, phone, match_type: 'CUSTOMER',
  calls, secs, initial_arrears: ini, current_arrears: cur, recovered: rec, paired: true, stamped_at: day + 'T12:00:00Z', ...extra });
const STAMPED = () => [
  R(TODAY, '100', 'KONGOWE', 3, 'u1', 'WAKILI ONE', 'LEGAL', '0712000100', 130, 2, 100000, 60000, 40000),
  R(TODAY, '100', 'KONGOWE', 3, 'u2', 'wakili two', 'Legal Officer', '255755000100', 300, 1, 100000, 60000, 40000),
  R('2026-07-21', '100', 'KONGOWE', 3, 'u1', 'WAKILI ONE', 'LEGAL', '0799999999', 45, 1, 110000, 100000, 10000),
  R(TODAY, '200', 'MBAGALA', 2, 'u2', 'wakili two', 'Legal Officer', '0712000200', 20, 1, 50000, 50000, 0),
  R('2026-07-22', '300', 'KONGOWE', 1, 'u1', 'WAKILI ONE', 'LEGAL', '0712000300', 60, 1, 30000, 21000, 9000),
  R(TODAY, '400', 'KONGOWE', 4, 'u7', 'PARA ONE', 'PARALEGAL', '0712000400', 500, 3, 40000, 32000, 8000),
  R(TODAY, '500', 'TANDIKA', 2, 'u3', 'WAKILI ALL', 'LEGAL', '0712000500', 33, 1, 20000, 15000, 5000),
  R('2026-07-23', '600', 'MBAGALA', 5, 'u2', 'wakili two', 'Legal Officer', '0788888888', 80, 2, 70000, null, 0, { paired: false, match_type: 'GUARANTOR' }),
  R(TODAY, '700', 'KONGOWE', 2, 'u6', 'ADV ONE', 'Advocate - HQ', '0712000700', 90, 1, 30000, 24000, 6000),
];
const tables = (extra = {}) => ({
  teams: [{ team: 'KONGOWE', team_code: 'KON1' }, { team: 'MBAGALA', team_code: 'MBA1' }, { team: 'TANDIKA', team_code: 'TAN1' }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  access_codes: CODES(), call_users: USERS(), call_logs: CALLS(),
  demand_notices: [], notice_payment_ledger: [],
  legal_phone_recovery: STAMPED(),
  legal_phone_days: [{ day: '2026-07-21', stamped_at: '2026-07-22T01:00:00Z' }, { day: TODAY, stamped_at: TODAY + 'T08:55:00Z' }],
  ...extra,
});
const NP = { notice_payments: (store, args) => args.p_refs.map((ref, i) => ({ ref, since: args.p_dates[i], paid: 0, n: 0, last_paid: null, n_phone: 0 })), fold_notice_payments: () => 0 };
const withFn = (t = tables()) => fakeDb(t, { rpc: { ...NP, ...LEGAL_PHONE_RPC } });
const withoutFn = (t = tables()) => fakeDb(t, { rpc: { ...NP } });
/* The Legal recovery slide of public/mod/present.js as it stood in the commit before recovery by phone was put on it (Part 139):
   "leaving the demand recovery slide as it was". Kept here as text, so the test does not depend on the repository's history. */
const LEGAL_SLIDE_AS_IT_WAS = String.raw`    var lgCap = (b.legalOn === false && b.legalNote ? '<div>⚠ ' + esc(b.legalNote) + '</div>' : '')
      + '<div>Wateja wenye notisi / noticed customers: ' + money(b.legalCustomers || 0)
      + ' · malipo yaliyorekodiwa dhidi ya notisi (REF# au simu), mara moja kwa mteja / payments recorded against notices (REF# or phone), once per customer</div>'
      + ((b.legalAll || []).length ? '<div>Wanasheria wa timu zote, hawapangwi / holding every team, not ranked: ' + esc(b.legalAll.join(', ')) + '</div>' : '')
      + ((b.legalUnheld || []).length ? '<div>Timu zisizo na mwanasheria / teams no legal code holds: ' + esc(b.legalUnheld.join(', ')) + '</div>' : '');
    slides.push({ id:'legal', kind:'table', title:'Legal recovery — notisi za madai / demand notices · leo / today, then the week',
      caption: lgCap, rows:(b.legal||[]).slice(0,12),
      cols:[col('officer','Legal officer'), col('teams','Teams','num'), col('customers','Customers','num'),
        col('owed','Owed at notice','money'),
        col('tRecovered','Recovered today','money'), {key:'tPct', label:'Rec % (today)', kind:'pct', target:'rec', from:['tRecovered','owed']},
        col('recovered','Recovered (week)','money'), {key:'pct', label:'Rec % (week)', kind:'pct', target:'rec', from:['recovered','owed']}] });`;
const boards = (db, user = ADMIN) => portalApi(db, user, 'officerBoards', {}, NOW);
const row = (b, name) => b.legalCalls.find(r => r.officer === name);
async function quiet(fn) { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } }

test('THE ROLE A PHONE IS READ AS is the sentence RUN-ME-089 stamps by: the one code of that name, else the registered role', () => {
  const codes = CODES();
  assert.equal(phoneRoleRead({ name: 'WAKILI ONE', role: 'LEGAL' }, codes), 'LEGAL');
  assert.equal(phoneRoleRead({ name: 'wakili two', role: 'FIELD OFFICER' }, codes), 'Legal Officer', 'the code\'s role, found whatever the capitals of the name');
  assert.equal(phoneRoleRead({ name: '  Meneja M', role: 'LEGAL' }, codes), 'MANAGER', 'and whatever the blanks around it: the code says MANAGER, so this phone is not a lawyer\'s');
  assert.equal(phoneRoleRead({ name: 'TWIN NAME', role: 'LEGAL' }, codes), 'LEGAL', 'two codes of one name decide nothing: the registered role');
  assert.equal(phoneRoleRead({ name: 'TWIN NAME', role: 'RECOVERY' }, codes), 'RECOVERY', 'whichever of the two comes first, and whatever it says: a phone of that name registered as recovery is not a lawyer\'s');
  assert.equal(phoneRoleRead({ name: 'X', role: 'FIELD OFFICER' }, [{ name: 'X', role: 'LEGAL' }, { name: 'x ', role: 'LEGAL' }]), 'FIELD OFFICER', 'even two codes that agree: "having count(*) = 1"');
  assert.equal(phoneRoleRead({ name: 'NOBODY N', role: 'Legal Officer' }, codes), 'Legal Officer', 'no code of that name: the registered role');
  assert.equal(phoneRoleRead({ name: 'NOBODY N', role: null }, codes), '');
  assert.equal(phoneRoleRead({ name: 'NOBODY N' }, null), '');
  assert.equal(phoneRoleRead({ name: '', role: 'LEGAL' }, [{ name: '', role: 'MANAGER' }]), 'LEGAL', 'a phone with no name matches no code');
  assert.equal(phoneRoleRead({ name: null, role: 'LEGAL' }, [{ name: null, role: 'MANAGER' }]), 'LEGAL');
  // coalesce() stops at the first value that is not NULL: an EMPTY role on the one code is that code's answer; a NULL one is not.
  assert.equal(phoneRoleRead({ name: 'X', role: 'LEGAL' }, [{ name: 'X', role: '' }]), '');
  assert.equal(phoneRoleRead({ name: 'X', role: 'LEGAL' }, [{ name: 'X', role: null }]), 'LEGAL');
  assert.equal(phoneRoleRead(null, codes), ''); assert.equal(phoneRoleRead(undefined, undefined), '');
  // The sentence itself, in the file the owner ran: if it changes there, this reading changes here.
  const sql = read('db/RUN-ME-089-legal-recovery-by-phone.sql');
  assert.ok(sql.includes("cross join lateral (select coalesce((select min(c.role) from public.access_codes c where upper(btrim(c.name)) = upper(btrim(u.name)) having count(*) = 1), u.role, '') as role) r"),
    'legal_phones() reads the role this way');
});

test('WHO IS ON THE SLIDE: every phone that reads legal, the silent ones too, and nobody else', async () => {
  const b = await boards(withFn());
  assert.deepEqual(b.legalCalls.map(r => r.officer).sort(), ['TWIN NAME', 'WAKILI ALL', 'WAKILI KIMYA', 'WAKILI ONE', 'wakili two'],
    'the four phones that read legal by code or by registration, and the one two codes cannot decide; not the manager whose phone says LEGAL, the paralegal, the advocate, the recovery officer, nor the phone that is switched off');
  const kimya = row(b, 'WAKILI KIMYA');
  assert.deepEqual([kimya.calls, kimya.dials, kimya.wCalls, kimya.wDials, kimya.silent, kimya.spoken, kimya.phToday, kimya.phWeek], [0, 0, 0, 0, true, 0, 0, 0],
    'a legal phone that sent no call this week is on the slide at nought, and marked: last week\'s call is not this week\'s');
  assert.equal(row(b, 'TWIN NAME').silent, false, 'a dial that only rang is still a phone that is used');
  assert.deepEqual([row(b, 'TWIN NAME').wCalls, row(b, 'TWIN NAME').wDials, row(b, 'TWIN NAME').calls], [1, 1, 0]);
  // The setting names another role as the legal one: its phones join, by the one test of a legal role.
  const adv = await boards(withFn(tables({ settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }, { key: 'LEGAL_ROLE', value: 'Advocate - HQ' }] })));
  assert.ok(row(adv, 'ADV ONE'), 'the advocate is a lawyer when the LEGAL_ROLE setting says so');
  assert.equal(row(adv, 'ADV ONE').phWeek, 6000);
  assert.ok(row(adv, 'WAKILI ONE'), 'and a role that carries the word LEGAL still is');
});

test('WHAT A ROW CARRIES: the call boards\' own figures for that name, today and the week', async () => {
  const b = await boards(withFn());
  for (const name of ['WAKILI ONE', 'wakili two', 'WAKILI ALL', 'TWIN NAME', 'WAKILI KIMYA']) {
    const r = row(b, name), t = b.callToday.find(x => x.agent === name), w = b.callWeek.find(x => x.agent === name);
    assert.ok(t && w, name + ' is on both call boards');
    assert.deepEqual([r.calls, r.dials, r.connected, r.connectPct, r.portfolio, r.duration], [t.calls, t.dials, t.connected, t.connectPct, t.portfolio, t.duration], name + ': today is the call board\'s row');
    assert.deepEqual([r.wCalls, r.wDials, r.wConnected, r.wConnectPct], [w.calls, w.dials, w.connected, w.connectPct], name + ': the week is the call board\'s row');
  }
  const one = row(b, 'WAKILI ONE');
  assert.deepEqual([one.calls, one.dials, one.connected, one.portfolio, one.duration], [3, 4, 2, 1, 133],
    'three numbers rung with four dials; two of the numbers spoken to (130 s and 400 s: the 3 s and the 2 s only rang); one of them a customer of her own team, 133 s on the line with her in two dials');
  assert.deepEqual([one.wCalls, one.wDials, one.wConnected], [5, 6, 4], 'the week adds Tuesday\'s and Wednesday\'s numbers');
  assert.equal(one.team, 'KONGOWE');
});

test('RECOVERY BY PHONE on the row is the Legal tab\'s own lines, and the rows add up to the phone card', async () => {
  const db = withFn();
  const b = await boards(db);
  const tab = await portalApi(db, ADMIN, 'demandNotices', {}, NOW);
  assert.deepEqual([row(b, 'wakili two').spoken, row(b, 'wakili two').phToday, row(b, 'wakili two').phWeek], [3, 40000, 40000],
    'she spoke longest with customer 100 today (40,000), with 200 (nothing paid) and with 600 on Thursday (its later file is not in)');
  assert.deepEqual([row(b, 'WAKILI ONE').spoken, row(b, 'WAKILI ONE').phToday, row(b, 'WAKILI ONE').phWeek], [1, 0, 10000],
    'ONE keeps Tuesday\'s 10,000; the customer at D.C 1 is not counted, and today\'s 40,000 went to the lawyer who spoke longest');
  assert.deepEqual([row(b, 'WAKILI ALL').spoken, row(b, 'WAKILI ALL').phToday, row(b, 'WAKILI ALL').phWeek], [1, 5000, 5000],
    'a lawyer whose code holds every team has no row on the demand board, and has one here');
  assert.equal(b.legalPhone.on, true);
  const sum = k => b.legalCalls.reduce((s, r) => s + r[k], 0);
  assert.equal(sum('phWeek'), b.legalPhone.recovered, 'the week\'s column adds up to the phone card');
  assert.equal(sum('phToday'), b.legalPhone.tRecovered, 'and today\'s to its today');
  assert.equal(b.legalPhone.recovered, tab.legal.phone.recovered, 'which is the Legal tab\'s own card');
  assert.equal(sum('phWeek'), 55000);
  assert.deepEqual(b.legalCalls.map(r => r.officer), ['wakili two', 'WAKILI ONE', 'WAKILI ALL', 'TWIN NAME', 'WAKILI KIMYA'],
    'ranked on the week\'s recovery by phone, then on the week\'s calls: the silent phone is last');
});

test('a lawyer a line names is on the slide even when the phone has been switched off since, so the rows still add up', async () => {
  const t = tables();
  t.call_users = t.call_users.map(u => u.user_id === 'u3' ? { ...u, active: false } : u);
  const b = await boards(withFn(t));
  const all = row(b, 'WAKILI ALL');
  assert.ok(all, 'still a row');
  assert.deepEqual([all.phWeek, all.spoken], [5000, 1]);
  assert.equal(b.legalCalls.reduce((s, r) => s + r.phWeek, 0), b.legalPhone.recovered);
});

test('A DASH, NOT A NOUGHT, where recovery by phone cannot be read: the calls are still shown', async () => {
  const off = await boards(withoutFn());
  assert.equal(off.legalPhone.on, false);
  assert.match(off.legalPhone.note, /RUN-ME-089/);
  assert.deepEqual(off.legalCalls.map(r => r.officer).sort(), ['TWIN NAME', 'WAKILI ALL', 'WAKILI KIMYA', 'WAKILI ONE', 'wakili two'], 'the phones are listed all the same');
  for (const r of off.legalCalls) assert.deepEqual([r.spoken, r.phToday, r.phWeek], [null, null, null], r.officer + ': nothing is known, so nothing is shown');
  assert.deepEqual([row(off, 'WAKILI ONE').calls, row(off, 'WAKILI ONE').wCalls], [3, 5], 'and the calls do not wait for the file');
  // The function is there and fails: the same.
  const failing = fakeDb(tables(), { rpc: { ...NP, legal_phone_week: () => { throw new Error('canceling statement due to statement timeout'); } } });
  const bad = await quiet(() => boards(failing));
  assert.equal(bad.legalPhone.on, null);
  assert.ok(bad.legalCalls.length === 5 && bad.legalCalls.every(r => r.phWeek === null && r.spoken === null));
});

test('a code that holds one team sees the legal phones of that team only', async () => {
  const b = await boards(withFn(), ONE_TEAM);
  assert.deepEqual(b.legalCalls.map(r => r.officer).sort(), ['TWIN NAME', 'wakili two'], 'the phones registered on MBAGALA');
  assert.ok(b.legalCalls.every(r => r.team === 'MBAGALA'));
});

test('IT COSTS THE DATABASE NOTHING: the rows are arithmetic over what the boards already hold', async () => {
  const count = async t => {
    const base = withFn(t); let trips = 0;
    const db = { from(n) { trips++; return base.from(n); }, rpc(n, a) { trips++; return base.rpc(n, a); }, _dump: n => base._dump(n) };
    const b = await boards(db);
    return { trips, rows: b.legalCalls.length };
  };
  const none = tables(); none.call_users = none.call_users.filter(u => !/WAKILI|TWIN|ADV|PARA|MENEJA/i.test(u.name)); none.legal_phone_recovery = [];
  const a = await count(none), z = await count(tables());
  assert.equal(a.rows, 0); assert.equal(z.rows, 5);
  assert.equal(z.trips, a.trips, 'five legal phones on the slide and not one more trip to the database than with none');
  const core = read('api/_lib/portal-core.js');
  const fn = core.slice(core.indexOf('function legalCallRows_('), core.indexOf('/** One line a customer a day, from the stamped rows'));
  assert.ok(fn.length > 500 && !/\bdb\b|await /.test(fn), 'the builder never touches the database');
  assert.match(core, /const legalCalls = legalCallRows_\(myPhoneUsers, codeRows, cfgS\.get\(LEGAL_ROLE_KEY, LEGAL_ROLE_DEFAULT\), callToday, callWeek, legalPhone, legalPhoneBy\);/);
  // ONE sum per lawyer for the boards and the slide: the line that adds a phone line up exists once, and both read its map.
  assert.equal(core.split('o.w += l.recovered; o.n += 1; if (l.day === today) o.t += l.recovered;').length - 1, 1, 'the per-lawyer sum is written once');
  assert.match(core, /const legalPhoneBy = legalPhoneByOfficer_\(legalPhoneLines, today\);/);
  assert.match(core, /const byOfficer = new Map\(legalPhoneBy\);/, 'the boards take a COPY: they empty theirs as they go');
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.doesNotMatch(read(f), /legalCalls|phoneRoleRead|legalCallRows_/, f + ' knows nothing of it');
});

test('THE PRESENTATION: the demand-recovery slide is as it was, and the legal officers\' calls slide carries recovery by phone', () => {
  const pres = read('public/mod/present.js');
  // As it was before recovery by phone was put on it (the commit before Part 139), the comment that says so aside.
  const block = s => { const i = s.indexOf('    var lgCap = '), j = s.indexOf("from:['recovered','owed']}] });", i); assert.ok(i > 0 && j > i); return s.slice(i, j + 31); };
  assert.equal(block(pres).replace(/    \/\* AS IT WAS\.[\s\S]*?\*\/\n/, ''), LEGAL_SLIDE_AS_IT_WAS, 'the Legal recovery slide: its caption, its title and its eight columns, to the letter');
  assert.doesNotMatch(block(pres), /phToday|phWeek|lgPhoneNote_|kwa simu/, 'nothing of the phone on it');
  // The new slide: right after it, fed by the server's rows, the phone figures and the line in its caption.
  const i = pres.indexOf("slides.push({ id:'legalcalls', kind:'table',");
  assert.ok(i > pres.indexOf("slides.push({ id:'legal', kind:'table'") && i < pres.indexOf("slides.push({ id:'calls', kind:'table'"), 'between the Legal recovery slide and the HOPE Calls slide');
  const slide = pres.slice(pres.indexOf('var lcRows ='), pres.indexOf('/* DAY PROGRESS'));
  assert.ok(slide.includes("var lcRows = (b.legalCalls || []).map(function(x){ return { ...x, who: x.officer + (x.silent ? ' —\\u00a0kimya\\u00a0/\\u00a0silent' : '') }; });"),
    'the server\'s rows; a silent phone is marked in the officer\'s own cell, the mark held together by no-break spaces written as escapes');
  assert.doesNotMatch(pres, /\u00a0/, 'and no invisible no-break space is typed into the file itself');
  assert.match(slide, /cols:\[\{ key:'who', label:'Legal officer', cls:function\(r\)\{ return r\.silent \? 'bad' : ''; \} \},/, 'in red');
  /* "replace (reached today %) column with Duration of todays portifolio talk" (the owner, 24 Nov 2026; Part 143): the third column is
     the row's own `duration` (today's talk with customers of the officer's own teams), printed as the HOPE Calls slide prints it. */
  assert.match(slide, /col\('calls','Calls today','num'\), col\('duration','Portfolio talk','dur'\), col\('portfolio','Portfolio','num'\),/);
  assert.doesNotMatch(slide, /Reached today|col\('connectPct'/, 'today\'s Reached % is off this slide');
  assert.match(slide, /Portfolio talk = muda wa maongezi hayo leo \/ the talk time of those calls today/, 'and the caption says what the new column is');
  assert.ok(pres.includes("col('duration','Portfolio talk','dur'), col('portfolio','Portfolio','num'), col('connectPct','Reached %','pct')] });"), 'the HOPE Calls slide keeps its own three, as it was');
  assert.match(slide, /col\('wCalls','Calls week','num'\), \{key:'wConnectPct', label:'Reached week', kind:'pct', from:\['wConnected','wCalls'\]\},/, 'the week\'s Reached % total is the totals\' ratio');
  assert.match(slide, /col\('spoken','DC 2\+ spoken','num'\), col\('phToday','By phone today','money'\), col\('phWeek','By phone week','money'\)\] \}\);/);
  assert.match(slide, /caption: lcCap, rows: lcRows,\n/, 'every legal phone is a row: no cap, so the rows add up to the card');
  // Nine columns and short headers: the wall's figure columns do not wrap, and thirteen collided on the screen.
  const cols = slide.slice(slide.indexOf("cols:[{ key:'who'"), slide.indexOf("] });", slide.indexOf("cols:[{ key:'who'")));
  const labels = [...cols.matchAll(/(?:col\('[^']+','([^']+)'|label:'([^']+)')/g)].map(m => m[1] || m[2]);
  assert.equal(labels.length, 9, 'nine columns: ' + labels.join(' | '));
  assert.ok(labels.every(l => l.length <= 14), 'no header longer than fourteen characters: ' + labels.filter(l => l.length > 14).join(' | '));
  // The wall draws a column's own mark (it never did: the HOPE Calls slide's "Least active" was not red on the TV either).
  assert.ok(pres.includes("return '<td class=\"'+(isNum(c)?'r':'')+(c.cls?(' '+c.cls(r)):'')+(k?' '+k:'')+'\">'+cellHtml(r,c)+'</td>';"), 'presDraw applies a column\'s cls() to its cell');
  // The name column is wider and may wrap, on this slide only: the table takes the slide's own class, and the three rules name it.
  assert.match(slide, /slides\.push\(\{ id:'legalcalls', kind:'table', tcls:'pname2',/, 'the slide asks for the wider name column');
  assert.match(pres, /<table class="ptable'\+\(s\.tcls\?\(' '\+s\.tcls\):''\)\+'">/, 'and the wall gives a table its slide\'s class');
  assert.equal((pres.match(/tcls:'pname2'/g) || []).length, 1, 'no other slide asks for the wider name column');
  // (25 Nov 2026, handbook Part 164, addendum 4: the two collection slides ask for column widths of their own, under classes of their own)
  assert.deepEqual([...pres.matchAll(/tcls:'(\w+)'/g)].map(m => m[1]).sort(), ['pcolearly', 'pcolpmo', 'pname2'], 'the slides that ask for a class: this one, and the two collection slides under theirs');
  const css = read('public/app.html');
  assert.match(css, /#pres \.ptable\.pname2 th:first-child\{width:4%\}\n\s*#pres \.ptable\.pname2 th:nth-child\(2\)\{width:18%\}\n\s*#pres \.ptable\.pname2 td:nth-child\(2\)\{white-space:normal\}/, 'the three rules, all under the slide\'s class');
  assert.equal((css.match(/\.pname2/g) || []).length, 3, 'and nothing else is styled by it');
  assert.match(slide, /var lcCap = \(lcPh \? lgPhoneNote_\(\{ \.\.\.lcPh, others: \[\] \}, true\) : ''\)/, 'the phone card\'s own line, with nobody "without a row": every lawyer with a line has one here');
  assert.match(slide, /lcPh && lcPh\.on === true && lcPh\.waiting \?/, 'and how many of today\'s wait for the later file');
  assert.match(slide, /legal phone' \+ \(lcSilent === 1 \? ' has' : 's have'\) \+ ' sent no call through HOPE Calls this week/, 'and how many legal phones are silent');
  // The dashboard's two boards keep their phone column: nobody asked for those to change.
  const app = read('public/app.html');
  assert.match(app, /\{key:'phWeek', label:'Kwa simu \/ By phone', kind:'money'/);
  const build = (app.match(/var BUILD = '([^']+)';/) || [])[1] || '';
  assert.ok(build >= '2026-11-24-c', 'the module changed, so the page was bumped: BUILD ' + build);
});

test('the handbook and CHAT.md record the slide, the owner\'s words and what is not done', () => {
  const h = read('docs/HANDOFF.md'), c = read('CHAT.md');
  assert.match(h, /## Part 141 /);
  assert.match(h, /SHOCKED BY LEGAL CALLS/);
  assert.match(c, /Part 141/);
  assert.match(c, /SHOCKED BY LEGAL CALLS/);
  assert.match(c, /legalCalls/);
});
