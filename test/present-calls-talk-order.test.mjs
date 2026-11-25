/* THE HOPE CALLS SLIDE IS RANKED BY PORTFOLIO TALK TIME, NOT BY CALLS (handbook Part 164, addendum 7).

     "Sort busiest and least active officers slide by portifolio talk time brother not calls" -- the owner, 25 Nov 2026

   The Presentation's HOPE Calls slide lists every officer of the three PMO units, the busiest at the top and the least active at the bottom, the first six
   marked Busiest (green) and the last six Least active (red). It was ranked by CALLS (numbers rung); the owner wants it ranked by the time spent talking to
   portfolio customers. What is held here:

     * the rank is made in ONE place, the server's call board (callBoard in officerBoards, api/_lib/portal-core.js): PORTFOLIO TALK TIME first; calls only
       where the talk time ties (the officer who rang nobody comes after the one who rang and was not answered); a tie in both keeps the order the officers first
       appear in, as ties always did. Today's board, the week's and the week's other way up (callWeekWorst) all follow it, and no figure of any line changed;
     * the page reads that order DOWN and never sorts it again (a second sort is a second answer to who is busiest), marks the first six and the last six, and an
       officer with no portfolio talk at all is red however long the list and however many numbers they rang: the mark follows the key;
     * the slide says what it is ranked by, its nine columns are as they were, and the payload doc says the order.

   The slide in a real browser, from the real server's answer, at five sizes, with its picture: tools/browser-checks/portal-present-calls-talk-order.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');      // the code of a slice: a comment may name what was taken out
const PRESENT = read('public/mod/present.js');
const PORTAL = read('api/_lib/portal-core.js');
const NOW = Date.parse('2026-07-24T09:00:00Z');                    // Friday noon in East Africa
const TODAY = '2026-07-24', MON = '2026-07-20';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['present', 'dashboard'] };

/* THE BOOK. Eight officers, made so that the order by calls and the order by portfolio talk time are as different as they can be:

     BRAVO B      expected   2 numbers, 500 s of portfolio talk      the fewest calls but one, and the most talk of the three units
     ALPHA A      expected   6 numbers, 60 s                         (Monday: two more numbers, ten minutes of talk: the week only)
     FOXTROT F    expected   3 numbers, 60 s                         ties ALPHA in talk time and has fewer calls
     CHARLIE C    recovery   9 numbers rung, 900 s of talk, NONE of it with a portfolio customer   the most calls of anybody and no portfolio talk at all
     HOTEL H      recovery   4 numbers rung, nobody answered         ties DELTA in both keys; appears first (its ids come first), the alphabet says otherwise
     DELTA D      recovery   4 numbers rung, nobody answered
     GOLF G       expected   registered, has not rung anybody
     NOBODY N     no unit    7 numbers, 700 s of portfolio talk      the most talk of all, and not one of the three units: on the board, not on the slide  */
const L = (id, officer, team, n, secs, { portfolio = true, day = TODAY } = {}) => ({ id, user_id: 'u-' + officer, officer, team, phone: '07' + String(10000000 + n), call_date: day,
  duration: secs, portfolio, ref: portfolio ? 'R' + n : null, category: portfolio ? 'EXPECTED' : null, outcome: secs > 5 ? 'CONNECTED' : 'MISSED' });
const CALLS = ({ deltaFirst = false } = {}) => {
  let n = 0;
  const rows = (prefix, officer, team, count, secs, opts) => Array.from({ length: count }, (_, i) => L(prefix + i, officer, team, n++, secs, opts));
  return [
    ...rows(deltaFirst ? 'b1-' : 'a1-', 'HOTEL H', 'T3', 4, 0),
    ...rows(deltaFirst ? 'a1-' : 'b1-', 'DELTA D', 'T2', 4, 0),
    ...rows('c1-', 'ALPHA A', 'T2', 6, 10),
    ...rows('d1-', 'FOXTROT F', 'T3', 3, 20),
    ...rows('e1-', 'BRAVO B', 'T1', 2, 250),
    ...rows('f1-', 'CHARLIE C', 'T1', 9, 100, { portfolio: false }),
    ...rows('g1-', 'NOBODY N', 'T1', 7, 100),
    ...rows('h1-', 'ALPHA A', 'T2', 2, 300, { day: MON }),
  ];
};
const tables = (extra = {}) => ({
  teams: [{ team: 'T1', team_code: 'C1', expected: 'BRAVO B', recovery: 'CHARLIE C' }, { team: 'T2', team_code: 'C2', expected: 'ALPHA A', recovery: 'DELTA D' },
    { team: 'T3', team_code: 'C3', expected: 'FOXTROT F', recovery: 'HOTEL H' }, { team: 'T4', team_code: 'C4', expected: 'GOLF G' }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }], access_codes: [{ code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: [] }],
  call_users: [{ user_id: 'u-golf', name: 'GOLF G', team: 'T4', role: 'OFFICER' }], call_logs: CALLS(), roles: [], audit_log: [], ...extra,
});
const boards = (db = fakeDb(tables())) => portalApi(db, ADMIN, 'officerBoards', {}, NOW);
const names = list => list.map(r => r.agent);

test('THE BOARD IS RANKED BY PORTFOLIO TALK TIME: the most talk first, calls only where the talk ties, and the officers who talked least last, today and for the week', async () => {
  const b = await boards();
  assert.deepEqual(names(b.callToday), ['NOBODY N', 'BRAVO B', 'ALPHA A', 'FOXTROT F', 'CHARLIE C', 'HOTEL H', 'DELTA D', 'GOLF G'],
    'today: 700 s, 500 s, then ALPHA and FOXTROT at 60 s (ALPHA first: she rang six numbers, he three), then the three at nought (CHARLIE rang nine, HOTEL and DELTA four each), the silent one last');
  // what it was ranked by before: the order by calls is another order altogether
  assert.deepEqual(b.callToday.slice().sort((a, c) => c.calls - a.calls).map(r => r.agent).slice(0, 3), ['CHARLIE C', 'NOBODY N', 'ALPHA A'], 'the fixture really does rank differently by calls');
  assert.deepEqual(names(b.callWeek), ['NOBODY N', 'ALPHA A', 'BRAVO B', 'FOXTROT F', 'CHARLIE C', 'HOTEL H', 'DELTA D', 'GOLF G'],
    'the week by the same rule: ALPHA\'s Monday (ten minutes on two numbers) puts her ahead of BRAVO, who has 500 s');
  // the figures are the figures they always were: only the order moved
  const by = n => b.callToday.find(r => r.agent === n);
  assert.deepEqual([by('BRAVO B').calls, by('BRAVO B').duration, by('BRAVO B').portfolio], [2, 500, 2]);
  assert.deepEqual([by('CHARLIE C').calls, by('CHARLIE C').duration, by('CHARLIE C').otherDuration], [9, 0, 900], 'nine numbers rung, 900 s of talk, none of it portfolio talk: nought where the rank is made');
  assert.deepEqual([by('ALPHA A').calls, by('ALPHA A').duration], [6, 60]); assert.deepEqual([by('FOXTROT F').calls, by('FOXTROT F').duration], [3, 60]);
  assert.deepEqual([by('GOLF G').calls, by('GOLF G').duration], [0, 0]);
  assert.equal(b.callToday.length, 8, 'nobody was dropped or added');
  assert.equal(by('BRAVO B').unit, 'EXPECTED'); assert.equal(by('CHARLIE C').unit, 'RECOVERY'); assert.equal(by('NOBODY N').unit, null);
});

test('officers that tie in BOTH keys keep the order they first appear in, whatever the alphabet says; the week\'s other end is this list the other way up', async () => {
  const b = await boards();
  assert.deepEqual(names(b.callToday).filter(n => n === 'HOTEL H' || n === 'DELTA D'), ['HOTEL H', 'DELTA D'], 'HOTEL\'s calls come first in the book (its ids), so HOTEL ranks first: the tie is not settled by name');
  assert.deepEqual(b.callWeekWorst, b.callWeek.slice().reverse(), 'one list, two directions: never a second calculation');
  assert.equal(b.callWeekWorst[0].agent, 'GOLF G', 'the officer who rang nobody at all is the worst');
  // the same book with DELTA's calls first: the two swap places, and nobody else moves (only a tie of BOTH keys follows the book)
  const swapped = tables(); swapped.call_logs = CALLS({ deltaFirst: true });
  const r = await boards(fakeDb(swapped));
  assert.deepEqual(names(r.callToday).filter(n => n === 'HOTEL H' || n === 'DELTA D'), ['DELTA D', 'HOTEL H'], 'DELTA\'s calls come first in this book, so DELTA ranks first');
  assert.deepEqual(names(r.callToday).filter(n => n !== 'HOTEL H' && n !== 'DELTA D'), names(b.callToday).filter(n => n !== 'HOTEL H' && n !== 'DELTA D'), 'and every officer the keys tell apart ranks where they did');
});

test('an officer who dialled all day and never spoke to a portfolio customer ranks with the officers who talked least, below one who rang three numbers and talked a minute', async () => {
  const b = await boards();
  const at = n => names(b.callToday).indexOf(n);
  assert.ok(at('CHARLIE C') > at('FOXTROT F'), 'nine numbers rung and 900 s on the phone, none of it portfolio talk: after the officer with three numbers and 60 s of portfolio talk');
  assert.ok(at('BRAVO B') < at('ALPHA A') && at('ALPHA A') < at('FOXTROT F'), 'more portfolio talk first, then more calls');
});

test('the one sort lives in the call board and nowhere else on the way to the slide', () => {
  const core = code(PORTAL);
  assert.match(core, /const callBoardOrder = \(a, b\) => \(Number\(b\.duration\) \|\| 0\) - \(Number\(a\.duration\) \|\| 0\) \|\| \(Number\(b\.calls\) \|\| 0\) - \(Number\(a\.calls\) \|\| 0\);/, 'talk time first, calls second');
  assert.equal((core.match(/\}\)\.sort\(callBoardOrder\);/g) || []).length, 1, 'the board\'s own list is sorted by it, once');
  const start = core.indexOf('function callBoard(rows)'), end = core.indexOf('const callToday = callBoard(callSrc.t);');
  assert.ok(start > 0 && end > start);
  assert.ok(!/b\.calls - a\.calls/.test(core.slice(start, end)), 'the board no longer sorts by calls');
  assert.ok(/const callWeekWorst = callWeek\.slice\(\)\.reverse\(\);/.test(core), 'the worst end is derived from the same list');
});

/* ---- THE PAGE ---- */
// the slide's own code, run for real: from the three units to the line after its push (the credit slide's comment), with the page's own col()
const callsSlide = b => {
  const from = PRESENT.indexOf('var PMO_UNITS = {');
  const to = PRESENT.indexOf('// Sales % is against the weekly target times the teams held');
  assert.ok(from > 0 && to > from, 'the calls slide\'s code is where it was');
  const slides = [];
  new Function('b', 'slides', 'col', PRESENT.slice(from, to))(b, slides, (key, label, kind) => ({ key, label, kind: kind || 'text' }));
  assert.equal(slides.length, 1, 'it builds one slide');
  assert.equal(slides[0].id, 'calls');
  return slides[0];
};
const officer = (agent, unit, calls, duration) => ({ agent, team: 'T', unit, calls, dials: calls, duration, otherDuration: 0, portfolio: calls, nonPortfolio: 0, connected: null, customers: 0, connectPct: null, portfolioPct: null });
const marks = s => s.rows.map(r => r.end);
const UNITS = ['EXPECTED', 'COLLECTION', 'RECOVERY'];
// n officers of the three units in the order the server hands them over: the most portfolio talk first, the calls going up and down on their own
const inTalkOrder = n => Array.from({ length: n }, (_, i) => officer('O' + String(i + 1).padStart(2, '0'), UNITS[i % 3], 1 + (i * 7) % 13, (n - i) * 60));

test('THE SLIDE READS THE SERVER\'S ORDER DOWN: the rows are in the order they arrive, the first six are Busiest, the last six Least active, the ones between are not marked', () => {
  const s = callsSlide({ callToday: inTalkOrder(14) });
  assert.deepEqual(s.rows.map(r => r.agent), inTalkOrder(14).map(r => r.agent), 'every officer, in the order the server sent');
  assert.deepEqual(marks(s), ['Busiest', 'Busiest', 'Busiest', 'Busiest', 'Busiest', 'Busiest', '', '', 'Least active', 'Least active', 'Least active', 'Least active', 'Least active', 'Least active']);
  assert.ok(s.rows.every((r, i, a) => !i || a[i - 1].duration >= r.duration), 'the Portfolio talk column descends from the first row to the last: the S/N reads as one ranking');
  assert.ok(!s.rows.every((r, i, a) => !i || a[i - 1].calls >= r.calls), 'and the Calls beside it need not: it is the talk that is ranked');
});

test('the page never sorts again: a list handed over in the other order is drawn in the other order (so the rank has one author, the server)', () => {
  const asc = inTalkOrder(10).reverse();
  const s = callsSlide({ callToday: asc });
  assert.deepEqual(s.rows.map(r => r.agent), asc.map(r => r.agent), 'the page did not sort it');
  assert.ok(!/\.sort\(/.test(code(PRESENT.slice(PRESENT.indexOf('var PMO_UNITS = {'), PRESENT.indexOf('// Sales % is against the weekly target times the teams held')))), 'there is no sort in the slide\'s code');
});

test('NOBODY WITH NO PORTFOLIO TALK IS EVER LEFT UNMARKED: red above the bottom six too, whether or not they rang anybody; one who talked is not red because of how few calls they made', () => {
  // twenty officers; the last nine have no portfolio talk at all, one of them rang fifty numbers and was not answered, the last rang nobody
  const list = inTalkOrder(20).map((r, i) => (i >= 11 ? { ...r, duration: 0, calls: i === 12 ? 50 : (i === 19 ? 0 : r.calls) } : r));
  list[10] = { ...list[10], duration: 5, calls: 1 };               // ten seconds from the bottom of the talkers, one call: not red
  const s = callsSlide({ callToday: list });
  const red = marks(s).map((m, i) => (m === 'Least active' ? i : -1)).filter(i => i >= 0);
  assert.deepEqual(red, [11, 12, 13, 14, 15, 16, 17, 18, 19], 'the nine with no talk, among them the one who rang fifty numbers (rows 11 to 13 are above the bottom six: only the key marks them)');
  assert.equal(marks(s)[12], 'Least active', 'fifty calls and no portfolio talk is the quietest there is on this slide');
  assert.equal(marks(s)[10], '', 'one call and a few seconds of talk is not');
  assert.deepEqual(marks(s).slice(0, 6), Array(6).fill('Busiest'));
  // and a list where every officer has talked: only the bottom six are red
  assert.equal(marks(callsSlide({ callToday: inTalkOrder(20) })).filter(m => m === 'Least active').length, 6);
  // an officer in the first six with no talk at all is not "Busiest"
  const lean = callsSlide({ callToday: [officer('A', 'EXPECTED', 3, 0), officer('B', 'RECOVERY', 0, 0)] });
  assert.deepEqual(marks(lean), ['Least active', 'Least active']);
});

test('only the three units are on the slide, in the server\'s order; a book where nobody holds a unit falls back to the whole list rather than going blank', () => {
  const mixed = [officer('NOUNIT A', null, 40, 900), officer('E', 'EXPECTED', 5, 300), officer('NOUNIT B', null, 2, 200), officer('R', 'RECOVERY', 9, 100)];
  assert.deepEqual(callsSlide({ callToday: mixed }).rows.map(r => r.agent), ['E', 'R'], 'the officer with the most talk of all is not one of the three units');
  const none = callsSlide({ callToday: mixed.filter(r => !r.unit) });
  assert.deepEqual(none.rows.map(r => r.agent), ['NOUNIT A', 'NOUNIT B']);
  assert.match(none.title, /vitengo havijawekwa \/ units not set/);
});

test('THE SLIDE\'S TWO WORDS ABOUT ITSELF: its title says what it is ranked by, and its nine columns are as they were (Calls and Dials still there, Portfolio talk now the ranked one)', () => {
  const s = callsSlide({ callToday: inTalkOrder(8), callsReachMin: 5 });
  assert.equal(s.title, 'HOPE Calls — busiest first by time talking to customers (muda wa maongezi na wateja, si idadi ya simu / not by calls made) · Expected · Collection · Recovery · Reached = waliongea zaidi ya sek 5 / spoken to for over 5 s');
  assert.deepEqual(s.cols.map(c => c.key), ['end', 'agent', 'unit', 'team', 'calls', 'dials', 'duration', 'portfolio', 'connectPct']);
  assert.deepEqual(s.cols.map(c => c.label).slice(1), ['Officer', 'Unit', 'Team', 'Calls', 'Dials', 'Portfolio talk', 'Portfolio', 'Reached %']);
  assert.equal(s.cols.find(c => c.key === 'duration').kind, 'dur', 'the ranked column is printed as minutes and seconds, as before');
  assert.ok(!/numbers rung, not dials/.test(s.title), 'the title no longer claims the ranking is by numbers rung');
  // and with Reached % waiting for its file the title still says so, after the new words
  assert.match(callsSlide({ callToday: inTalkOrder(8), callsReachNote: 'x' }).title, /not by calls made\) · Expected · Collection · Recovery · Reached % inasubiri \/ waits for db\/RUN-ME-088$/);
});

test('the slide is built from the SERVER\'S OWN ANSWER, end to end: the officers of the three units, the busiest in talk first, the one who rang nine numbers and talked to nobody about the portfolio near the bottom', async () => {
  const b = await boards();
  const s = callsSlide(b);
  assert.deepEqual(s.rows.map(r => r.agent), ['BRAVO B', 'ALPHA A', 'FOXTROT F', 'CHARLIE C', 'HOTEL H', 'DELTA D', 'GOLF G'], 'NOBODY N talked the most and is not one of the three units: he is on the board and not on the slide');
  assert.equal(s.rows[0].end, 'Busiest');
  assert.deepEqual(s.rows.filter(r => !r.duration).map(r => r.end), ['Least active', 'Least active', 'Least active', 'Least active'], 'every officer with no portfolio talk is red');
  // today's board only, as the owner ordered on 22 Nov: the week's order (ALPHA ahead of BRAVO) is not what the slide shows
  assert.ok(s.rows.findIndex(r => r.agent === 'BRAVO B') < s.rows.findIndex(r => r.agent === 'ALPHA A'));
});

test('the payload doc says the order, and the handbook and CHAT.md carry the owner\'s words', () => {
  const doc = read('docs/REPORT-PAYLOADS.md');
  assert.match(doc, /`callToday\[\{agent, team, calls, duration, portfolio, customers, unit, connectPct, portfolioPct\}\]`[^\n]*ranked by portfolio talk time/i, 'callToday is documented as ranked by portfolio talk time');
  assert.ok(/Sort busiest and least active officers slide by portifolio talk time brother not calls/.test(read('docs/HANDOFF.md')), 'the handbook has the owner\'s words');
  assert.ok(/Sort busiest and least active officers slide by portifolio talk time brother not calls/.test(read('CHAT.md')), 'and so has CHAT.md');
  // the owner's second message, which says the same in plainer words and is what the title says
  for (const f of ['docs/HANDOFF.md', 'CHAT.md']) assert.ok(/i meant busiest are those talking to customers - not just making calls/.test(read(f)), f + ' has the owner\'s second message');
});
