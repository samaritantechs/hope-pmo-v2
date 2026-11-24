/* THE DAY'S LATER FILE IS NOT IN YET: every screen that shows a day says so (handbook Part 140).

   The owner's own look at the upload times (db/RUN-ME-087, pasted 24 Nov 2026): from Monday to Saturday the morning
   (initial) file comes in at about 05:00 and the later (current) file at about 20:00. So the stage Part 136 calls
   'morning' -- the morning file's customers, nothing recovered, nobody CLEARED, because nothing has been compared --
   is how a day reads through the WHOLE WORKING DAY, on the phone, the Exp.Def Report, a leader's card and the Expected
   Defaulters tab. A nought with no words reads as "nobody recovered anything" (CLAUDE.md section 2: silence reads as
   success). The server names the stage in ONE place (dayStage, api/_lib/expdf.js) and sends it with the answers the
   screens already ask for; the pages draw one line for it, and the phone prints a dash where recovery is not known.

   What this file holds: the naming, the stage on each of the four screens at each of the four stages (through the real
   portal dispatch where a page asks through it), that a week and a month carry none, the two pages' own builders RUN
   on stand-ins, and the pins of where they are called. The phone's daily summary (a dash for the bar) is in
   test/call.test.mjs, through the real call dispatch; the screens in a real browser are
   tools/browser-checks/expdef-later-file.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { expdfMine, expdfReport, expdfLeader, dayStage } = await import('../api/_lib/expdf.js');
const { portalApi } = await import('../api/_lib/portal-core.js');

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const APP = read('public/app.html'), CALL = read('public/call.html');
const EXPDF = read('api/_lib/expdf.js'), CORE = read('api/_lib/portal-core.js'), CALLCORE = read('api/_lib/call-core.js');

const DASH = String.fromCharCode(0x2014);                        // what the page prints for a figure that is not known
const DAY = '2026-11-24', BEFORE = '2026-11-23';                 // a Tuesday and the Monday before it
const NOW = Date.parse(DAY + 'T07:00:00Z');                      // 10:00 in East Africa: the middle of the working day
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const wdOf = d => WD[new Date(d + 'T12:00:00Z').getUTCDay()];
/** One deck row. Every customer was disbursed on a Tuesday, so the day read is their cycle day. */
function row(ref, date, type, arrears) {
  return { ref, full_name: 'C ' + ref, contact: '0714' + ref, team: 'MASWA', arrears, status: 'Defaulter', days_elapsed: 3, disb_date: '2026-11-17',
    ds: '3-6', dc: 3, weekday: wdOf(date), snapshot_date: date, snapshot_type: type, upload_batch: type[0] + date,
    created_at: date + (type === 'initial' ? 'T02:00:00Z' : 'T17:00:00Z') };
}
/** The book at each stage of the day. Monday has both of its files in every one of them. */
function decks(stage) {
  const out = [row('A', BEFORE, 'initial', 30000), row('A', BEFORE, 'current', 30000), row('B', BEFORE, 'initial', 12000), row('B', BEFORE, 'current', 12000)];
  if (stage === 'pair' || stage === 'morning') out.push(row('A', DAY, 'initial', 30000), row('B', DAY, 'initial', 12000));
  if (stage === 'pair' || stage === 'current') out.push(row('A', DAY, 'current', 20000));          // A paid 10,000; B is off the later file
  return out;
}
const tablesFor = stage => ({
  teams: [{ team: 'MASWA', zone: 'LAKE', team_code: 'MAS 1', gmo: 'GMO M', manager: 'MANAGER M', bike: 'BIKE M', opm: 'OPM M', recovery: 'REC M', credit: 'CA M', expected: 'EARLY M' }],
  settings: [], access_codes: [], roles: [], defaulter_snapshots: decks(stage), repayment_snapshots: [], followup_status: [], followup_comments: [], call_logs: [], call_users: [] });
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings', 'expdfrep', 'defexp'] };
const TEAM = { code: 'T', name: 'SOMEBODY', role: 'GMO', teams: ['MASWA'], tabs: [] };
const db = stage => fakeDb(tablesFor(stage));

/** The text of one function of a page, from its name to its closing brace. */
function fnOf(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' is in the page');
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('no end of ' + name);
}

test('the stage is named in one place: which of the day\'s own two files are in', () => {
  assert.equal(dayStage(true, true, false), 'pair');
  assert.equal(dayStage(true, true, true), 'pair');
  assert.equal(dayStage(true, false, true), 'morning', 'the morning file alone, whatever earlier files there are');
  assert.equal(dayStage(true, false, false), 'morning');
  assert.equal(dayStage(false, true, true), 'current');
  assert.equal(dayStage(false, false, true), 'earlier');
  assert.equal(dayStage(false, false, false), 'none');
  // One naming, used by the two places that read a day off its files: no second ladder of the same words.
  assert.ok(/const stage = dayStage\(dayIni\.rows\.length > 0, dayCur\.rows\.length > 0, older\.rows\.length > 0\);/.test(EXPDF), 'expdfCore asks it');
  assert.ok(/stage: dayStage\(iniToday, curToday, def\.rows\.length > 0 \|\| iniSnap\.rows\.length > 0\) \};/.test(CORE), 'the tab asks it');
  const decides = src => (src.match(/\? 'morning' :/g) || []).length;
  assert.equal(decides(EXPDF) + decides(CORE) + decides(CALLCORE), 1, 'the ladder that DECIDES the stage is written once, in dayStage: no second rule beside it');
});

test('WITH THE MORNING FILE ONLY every screen that shows the day is told so: the phone, the report, a leader\'s card and the tab', async () => {
  const phone = await expdfMine(db('morning'), TEAM, { scope: 'team' }, NOW);
  assert.equal(phone.diag.stage, 'morning');
  assert.deepEqual([phone.totals.customers, phone.totals.initial, phone.totals.recovered], [2, 42000, 0], 'the morning\'s two customers, nothing recovered: nothing has been compared');
  assert.ok(!phone.rows.some(r => r.status === 'CLEARED'), 'and nobody reads CLEARED');
  const rep = await portalApi(db('morning'), ADMIN, 'expdfReport', { period: 'day' }, NOW);
  assert.equal(rep.stage, 'morning', 'the report\'s day, through the portal\'s own dispatch');
  assert.equal(rep.totals.recovered, 0);
  for (const [role, leader] of [['GMO', 'GMO M'], ['MANAGER', 'MANAGER M'], ['BIKE', 'BIKE M']]) {
    const card = await portalApi(db('morning'), ADMIN, 'expdfLeader', { role, leader, period: 'day' }, NOW);
    assert.equal(card.stage, 'morning', role + '\'s card');
  }
  const tab = await portalApi(db('morning'), ADMIN, 'expectedDefaulters', {}, NOW);
  assert.equal(tab.stage, 'morning', 'the Expected Defaulters tab');
  assert.equal(tab.recovered, 0); assert.ok(!tab.rows.some(r => r.status === 'CLEARED'));
});

test('WITH BOTH FILES IN nothing is said: the day is measured', async () => {
  const phone = await expdfMine(db('pair'), TEAM, { scope: 'team' }, NOW);
  assert.equal(phone.diag.stage, 'pair');
  assert.deepEqual([phone.totals.customers, phone.totals.initial, phone.totals.recovered], [2, 42000, 22000], 'A paid 10,000 and B, off the later file, cleared 12,000');
  assert.equal((await portalApi(db('pair'), ADMIN, 'expdfReport', { period: 'day' }, NOW)).stage, 'pair');
  assert.equal((await portalApi(db('pair'), ADMIN, 'expdfLeader', { role: 'GMO', leader: 'GMO M', period: 'day' }, NOW)).stage, 'pair');
  assert.equal((await portalApi(db('pair'), ADMIN, 'expectedDefaulters', {}, NOW)).stage, 'pair');
});

test('the other two stages are named too, and are not the morning: a later file with no morning file, and no file of the day yet', async () => {
  for (const [stage, want] of [['current', 'current'], ['earlier', 'earlier']]) {
    assert.equal((await expdfMine(db(stage), TEAM, { scope: 'team' }, NOW)).diag.stage, want, 'the phone, ' + stage);
    assert.equal((await portalApi(db(stage), ADMIN, 'expdfReport', { period: 'day' }, NOW)).stage, want, 'the report, ' + stage);
    assert.equal((await portalApi(db(stage), ADMIN, 'expectedDefaulters', {}, NOW)).stage, want, 'the tab, ' + stage);
  }
});

test('a PAST day that never had its later file says so too; a week and a month carry no stage (they have their own words)', async () => {
  // Read on Wednesday for Tuesday: Tuesday still has its morning file only.
  const later = Date.parse('2026-11-25T07:00:00Z');
  const past = await portalApi(db('morning'), ADMIN, 'expdfReport', { period: 'day', weekOf: DAY }, later);
  assert.equal(past.stage, 'morning', 'the day read is Tuesday, whose later file was never uploaded');
  const week = await portalApi(db('morning'), ADMIN, 'expdfReport', { period: 'week' }, NOW);
  assert.equal(week.stage, undefined, 'the week says which days were added and which were not filed (its own note)');
  assert.ok(Array.isArray(week.days));
  const month = await portalApi(db('morning'), ADMIN, 'expdfReport', { period: 'month' }, NOW);
  assert.equal(month.stage, undefined, 'a month is its first deck against the freshest file: a comparison that WAS made');
  assert.equal((await portalApi(db('morning'), ADMIN, 'expdfLeader', { role: 'GMO', leader: 'GMO M', period: 'week' }, NOW)).stage, undefined);
  // The direct functions agree with the dispatch.
  assert.equal((await expdfReport(db('morning'), ADMIN, {}, NOW)).stage, 'morning');
  assert.equal((await expdfReport(db('morning'), ADMIN, { monthly: true }, NOW)).stage, undefined);
  assert.equal((await expdfLeader(db('morning'), ADMIN, { role: 'GMO', leader: 'GMO M' }, NOW)).stage, 'morning');
});

test('THE PORTAL: one line, drawn on the morning stage and on nothing else, by the report\'s day, a leader\'s card and the tab', () => {
  const xdLaterNote_ = new Function(fnOf(APP, 'xdLaterNote_') + '; return xdLaterNote_;')();
  const note = xdLaterNote_({ stage: 'morning' });
  assert.ok(/^<div class="note bad xd-later">/.test(note), 'a red note, as its neighbour for a missing baseline is');
  assert.ok(/Faili la jioni la siku hii bado halijapakiwa: marejesho yanasoma 0 na hakuna aliye CLEARED hadi lipakiwe\./.test(note), 'in Swahili');
  assert.ok(/The later file of this day is not uploaded yet: recovery reads 0 and nobody reads CLEARED until it is\./.test(note), 'and in English');
  for (const d of [{ stage: 'pair' }, { stage: 'current' }, { stage: 'earlier' }, { stage: 'none' }, {}, null, undefined, { stage: 'MORNING' }])
    assert.equal(xdLaterNote_(d), '', 'nothing is said for ' + JSON.stringify(d));
  // Where it is called: exactly the three screens that show a day.
  assert.equal((APP.match(/\+ xdLaterNote_\(d\)/g) || []).length, 3);
  const rep = APP.slice(APP.indexOf('VIEWS.expdfrep = function(){'), APP.indexOf('VIEWS.expdfrep = function(){') + 3200);
  assert.ok(/The baseline deck is not uploaded, so recovery reads 0\.<\/div>'\)\s+\+ xdLaterNote_\(d\)\s+\+ xdDaysNote_\(d\)/.test(rep), 'the report: under the baseline note, above the week\'s own note');
  const tab = fnOf(APP, 'xdBar_');                             // the tab's head is far from the bar: find it by its own words
  assert.ok(tab.length > 0);
  assert.ok(/\+ xdLaterNote_\(d\)\n\s+\+ '<div class="kpis">'\n\s+\+ kpi\('In the weekly cycle'/.test(APP), 'the tab: above its figures');
  assert.ok(/No initial deck for this period, so recovery reads 0\.<\/div>'\)\n\s+\+ xdLaterNote_\(d\)\n/.test(APP), 'the leader\'s card: under its baseline note');
});

test('THE PHONE: a dash for what is not known yet and one line of words; figures as before once the later file is in', () => {
  const xdMorningSrc = fnOf(CALL, 'xdMorning_'), barSrc = fnOf(CALL, 'drawBikeStrip_');
  const run = (expdf, rows) => {
    const els = {};
    const el = id => (els[id] = els[id] || { textContent: '', classList: { toggle() {}, remove() {}, add() {} } });
    const S = { bike: true, expdf, cache: { expdf: rows }, cacheAt: { expdf: Date.parse('2026-11-24T07:05:00Z') } };
    const xdSum_ = list => { const rec = list.reduce((s, r) => s + r.recovered, 0), ini = list.reduce((s, r) => s + r.initial, 0);
      return { customers: list.length, arrears: list.reduce((s, r) => s + r.amt, 0), initial: ini, recovered: rec, pct: ini > 0 ? 100 * rec / ini : null }; };
    const make = new Function('S', 'document', '$', 'filterForView_', 'xdSum_', 'mc_', 'todayKeyLocal_', 'hhmm_',
      xdMorningSrc + '\n' + barSrc + '\nreturn { xdMorning_: xdMorning_, drawBikeStrip_: drawBikeStrip_ };');
    const page = make(S, { getElementById: id => el(id) }, sel => el(String(sel).replace('#', '')), list => list, xdSum_, n => 'm' + n, () => '2026-11-24', () => '10:05');
    page.drawBikeStrip_();
    return { morning: page.xdMorning_(), cust: els.bkCust.textContent, deni: els.bkDeni.textContent, rec: els.bkRec.textContent, pct: els.bkPct.textContent };
  };
  const ROWS = [{ amt: 30000, initial: 30000, recovered: 0 }, { amt: 12000, initial: 12000, recovered: 0 }];
  const m = run({ date: '2026-11-24', diag: { stage: 'morning' } }, ROWS);
  assert.deepEqual(m, { morning: true, cust: '2', deni: 'm42000', rec: DASH, pct: DASH },
    'before the later file: customers and debt as they are, recovered and Rec a dash -- never 0 and 0%');
  const PAID = [{ amt: 20000, initial: 30000, recovered: 10000 }, { amt: 0, initial: 12000, recovered: 12000 }];
  const p = run({ date: '2026-11-24', diag: { stage: 'pair' } }, PAID);
  assert.deepEqual(p, { morning: false, cust: '2', deni: 'm20000', rec: 'm22000', pct: '52%' }, 'with both files in: the figures, as before');
  for (const expdf of [null, { date: '2026-11-24' }, { date: '2026-11-24', diag: {} }, { date: '2026-11-24', diag: { stage: 'earlier' } }])
    assert.equal(run(expdf, PAID).morning, false, 'an answer that does not name the morning stage draws as it always did: ' + JSON.stringify(expdf));

  // The Exp.Def tab's own strip: the line, and the same dashes; the per-leader split prints no recovery it does not know.
  const strip = fnOf(CALL, 'drawExpdfStrip_');
  assert.ok(/var m = mc_, morning = xdMorning_\(\);/.test(strip));
  assert.ok(/\+ \(morning \? '<div class="xnote" id="xdLater">Orodha ya jioni ya leo bado haijapakiwa \\u2014 marejesho yataonekana ikishapakiwa\.<\/div>' : ''\)/.test(strip),
    'the line, in the strip\'s own Swahili, beside the one for a missing initial list');
  assert.ok(/<span>Marejesho<\/span><b class="ok">' \+ \(morning \? '\\u2014' : m\(t\.recovered\)\) \+ '<\/b>/.test(strip), 'Marejesho is a dash');
  assert.ok(/<span>Rec %<\/span><b>' \+ \(\(morning \|\| t\.pct == null\) \? '\\u2014' : Math\.round\(t\.pct\) \+ '%'\) \+ '<\/b>/.test(strip), 'Rec % is a dash');
  assert.ok(/\+ \(morning \? '' : ' \\u00B7 ' \+ m\(x\.recovered\) \+ \(x\.pct==null\?'':' \\u00B7 '\+Math\.round\(x\.pct\)\+'%'\)\)/.test(strip), 'a leader\'s line carries no recovery before it is known');
  // A bike officer's card is the notes alone, so the line reaches them too.
  assert.ok(/if \(S\.bike\)\{ el\.classList\.remove\('shut'\); el\.classList\.toggle\('hide', !notes\); el\.innerHTML = notes; return; \}/.test(strip));
});

test('IT COSTS THE DATABASE NOTHING: the stage rides in answers the screens already ask for', () => {
  // The phone's list hands the page the whole of diag, as it did; the stage is one more word in it.
  assert.ok(/diag: d\.diag \} \};/.test(CALLCORE), 'api_callList passes diag on whole');
  assert.ok(/stage: core\.stage \|\| null \},/.test(EXPDF), 'expdfMine puts the stage in diag');
  // The bar's figure: null (a dash) on the morning stage, by arithmetic on what expdfMine already answered.
  assert.ok(/const stage = \(x\.diag && x\.diag\.stage\) \|\| null;\n\s+expdf = \{ pct: stage === 'morning' \? null : rat\(x\.totals\.recovered, x\.totals\.initial\), num: x\.totals\.recovered,/.test(CALLCORE));
  // No screen asks the server anything new for it: the page functions that draw it make no request.
  for (const name of ['xdMorning_', 'drawBikeStrip_', 'drawExpdfStrip_']) assert.ok(!/srv\(/.test(fnOf(CALL, name)), name + ' asks the server for nothing');
  assert.ok(!/srv\(/.test(fnOf(APP, 'xdLaterNote_')));
});

test('both pages were bumped so that every browser and handset fetches them, and the handbook and CHAT.md record the change', () => {
  const build = (APP.match(/var BUILD = '([^']+)';/) || [])[1] || '', callBuild = (CALL.match(/var CALL_BUILD = '([^']+)';/) || [])[1] || '';
  assert.ok(build >= '2026-11-24-b', 'BUILD ' + build);
  assert.ok(callBuild >= '2026-11-24-a', 'CALL_BUILD ' + callBuild);
  const h = read('docs/HANDOFF.md'), c = read('CHAT.md');
  assert.match(h, /## Part 140 /);
  assert.match(h, /RUN-ME-087/);
  assert.match(c, /Part 140/);
  assert.match(c, /later file/);
});
