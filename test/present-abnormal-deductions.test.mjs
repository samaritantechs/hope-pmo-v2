/* THE PRESENTATION'S ABNORMAL CARD: THE WEEK'S DEDUCTION CASES, ON THE CARD AND TEAM BY TEAM (handbook Part 164, addendum 6).

     "at abnormal card in presentation - show weekly deduction case counts per team counts too. so that i get the impact from that view"
                                                                                                      -- the owner, 25 Nov 2026

   The server's half (the count itself, the week, the scope, the gate, the cost) is test/deductions-week.test.mjs. This holds the page's half, run for real on stand-ins for
   the page's own globals (esc, money, col, allowed, srv, S):
     * THE CARD'S LINE (presDedLine_): "N deduction cases this week" under the Abnormal figure; a dash when the cases were asked for and did not come (never a nought; a real
       nought reads "0 deduction cases"); nothing while they are on their way, when the table is not there, and for a person who does not hold the PMO Deduction tab;
     * THE PER-TEAM SLIDE (presAbnDedSlide_): one row for each team with an abnormal payment or a deduction case, the teams with most cases first, the abnormal payments the
       dashboard's own per-team count (so the column adds up to the card's figure), twelve rows and one last row for all the others so that the JUMLA row is always the whole
       thing, the cases' column BLANK (not nought) while they load or when they failed and the caption saying which, escaped text everywhere, no slide at all for a person
       who does not hold the tab, a damaged answer never taking the deck down;
     * THE LOAD (presDed_, presDedAgain_): asked only of a holder of the tab, for the same week as the other two reads, after them; a miss on the first load is kept with its
       reason, a miss on a refresh keeps the last answer; nothing is drawn over a tab the person has left;
     * THE WIRING: the slide sits right after the day's, before the boards' check (so it plays without them); the tile takes the line; the page says when they did not come and
       offers a retry; the rows carry `team`, so the deck's own team filter scopes the slide like every other board. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PRESENT = read('public/mod/present.js');
const APP = read('public/app.html');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, 'found ' + a + ' ... ' + b); return src.slice(i, j); };
const LINE_SRC = between(PRESENT, 'function presDedLine_(pd){', "/** THE ABNORMAL CARD'S PER-TEAM VIEW");
const SLIDE_SRC = between(PRESENT, 'function presAbnDedSlide_(d, pd){', '/** Build every slide from the figures already in hand.');
const LOAD_SRC = between(PRESENT, 'function presDed_(wk){', '/** Rebuild the segment page and, if the deck is playing');

// the page's own helpers, REAL: the escaper, the money format, the column maker and the grand-total row (with the tables it reads)
const ESC = between(APP, 'function esc(s){', 'function money(n){');
const MONEY = between(APP, 'function money(n){', '/* THE AMOUNT, NOT A NOTE.');
const COL = APP.slice(APP.indexOf('function col(key, label, kind){'), APP.indexOf('\n', APP.indexOf('function col(key, label, kind){')));
const TOTALS = between(APP, 'var PCT_FROM = {', '/** Every board is its own card');
const page = (held = true) => new Function('allowed', ESC + '\n' + MONEY + '\n' + COL + '\n' + TOTALS + '\n' + LINE_SRC + '\n' + SLIDE_SRC
  + '\nreturn { esc, money, presDedLine_, presAbnDedSlide_, autoTotals };')(() => held);

const P = page(true);
const ON = { on: true, note: null, weekOf: '2026-11-23', weekEnd: '2026-11-29', cases: 9, teams: [{ team: 'KONGOWE', cases: 4 }, { team: 'TANDIKA', cases: 3 }, { team: 'MBAGALA', cases: 2 }] };
const tp = (team, abnormal) => ({ team, abnormal, branch: 'X' });
const D = { weekOf: '2026-11-23', weekEnd: '2026-11-29', cards: { abnormal: 37 },
  teamPerf: [tp('MBAGALA', 20), tp('KONGOWE', 7), tp('TANDIKA', 0), tp('NYAMA', 10), tp('QUIET', 0)] };

test('THE CARD\'S LINE: "N deduction cases this week" when the server answered; a real nought is a nought; one is singular; thousands are separated', () => {
  const line = cases => P.presDedLine_({ ded: { ...ON, cases } });
  assert.equal(line(9), '9 deduction cases this week');
  assert.equal(line(1), '1 deduction case this week');
  assert.equal(line(0), '0 deduction cases this week', 'a week with none is a nought, said');
  assert.equal(line(1234), '1,234 deduction cases this week');
});

test('THE CARD\'S LINE: a dash when the cases were asked for and did not come (and for an answer with no count), no line while they are on their way, none when the table is not there, none for a person who does not hold the tab', () => {
  const DASH = '— deduction cases this week';
  assert.equal(P.presDedLine_({ ded: null, dedWhy: 'Server haikujibu / not responding' }), DASH, 'asked and failed: not known, never a nought');
  for (const bad of [{}, { cases: null }, { cases: '9' }, { cases: NaN }, { cases: undefined }, { on: true, cases: Infinity }, { cases: [] }]) assert.equal(P.presDedLine_({ ded: bad }), DASH, JSON.stringify(bad) + ': an answer with no real count is "not known"');
  assert.equal(P.presDedLine_({ ded: null, dedWhy: '' }), '', 'on its way (or not asked yet): nothing');
  assert.equal(P.presDedLine_({}), ''); assert.equal(P.presDedLine_(null), ''); assert.equal(P.presDedLine_(undefined), '');
  assert.equal(P.presDedLine_({ ded: { on: false, note: 'run db/RUN-ME-043', cases: 0 } }), '', 'RUN-ME-043 not run: the PMO Deduction tab says so itself; the wall says nothing');
  const none = page(false);
  for (const pd of [{ ded: ON }, { ded: null, dedWhy: 'x' }, {}]) assert.equal(none.presDedLine_(pd), '', 'not theirs to see: not even a dash that says it exists');
});

test('THE PER-TEAM SLIDE: a row for each team with an abnormal payment or a case, the teams with most cases first, then the most abnormal payments, then by name; teams with nothing are left out; the abnormal column is the dashboard\'s own count', () => {
  const s = P.presAbnDedSlide_(D, { ded: ON });
  assert.equal(s.id, 'abndeduct'); assert.equal(s.kind, 'table');
  assert.match(s.title, /Abnormal payments & deduction cases/);
  assert.deepEqual(s.cols.map(c => [c.key, c.label, c.kind]), [['team', 'Team', 'text'], ['abnormal', 'Abnormal payments', 'num'], ['dedCases', 'Deduction cases (week)', 'num']]);
  // KONGOWE 4 cases / 7 abnormal, TANDIKA 3 / 0 (a team with cases and nothing flagged is still there), MBAGALA 2 / 20, NYAMA 0 / 10 (flagged, no case); QUIET has neither
  assert.deepEqual(s.rows, [{ team: 'KONGOWE', abnormal: 7, dedCases: 4 }, { team: 'TANDIKA', abnormal: 0, dedCases: 3 }, { team: 'MBAGALA', abnormal: 20, dedCases: 2 }, { team: 'NYAMA', abnormal: 10, dedCases: 0 }]);
  // ties on cases: the most abnormal payments first, then the name
  const ties = P.presAbnDedSlide_({ teamPerf: [tp('B', 5), tp('A', 5), tp('C', 9), tp('D', 0)] }, { ded: { ...ON, teams: [{ team: 'A', cases: 1 }, { team: 'B', cases: 1 }, { team: 'C', cases: 1 }, { team: 'D', cases: 1 }] } });
  assert.deepEqual(ties.rows.map(r => r.team), ['C', 'A', 'B', 'D']);
});

test('THE JUMLA ROW IS THE WHOLE: the abnormal column adds up to the card\'s figure and the cases to the week\'s total, with the real grand-total row of the wall -- on a short list and on a long one (twelve rows and ONE last row for all the others)', () => {
  const total = s => P.autoTotals(s.rows, s.cols);
  const short = P.presAbnDedSlide_(D, { ded: ON });
  assert.equal(total(short).abnormal, 37, 'the card says 37 abnormal payments: 7 + 0 + 20 + 10');
  assert.equal(total(short).abnormal, D.teamPerf.reduce((n, t) => n + t.abnormal, 0));
  assert.equal(total(short).dedCases, 9, 'the week\'s nine cases');
  // twenty teams: eighteen of them flagged and the cases spread over seven of them
  const teams = Array.from({ length: 20 }, (_, i) => tp('TEAM' + String(i).padStart(2, '0'), (i * 7) % 11));
  const cases = Array.from({ length: 7 }, (_, i) => ({ team: 'TEAM' + String(i * 3).padStart(2, '0'), cases: i + 1 }));
  const big = P.presAbnDedSlide_({ teamPerf: teams }, { ded: { ...ON, cases: 28, teams: cases } });
  assert.equal(big.rows.length, 13, 'twelve teams and one row for the rest');
  const last = big.rows[12];
  assert.match(last.team, /^Timu nyingine \/ Other teams \(\d+\)$/);
  const flagged = teams.filter(t => t.abnormal > 0 || cases.some(c => c.team === t.team)).length;
  assert.equal(last.team, 'Timu nyingine / Other teams (' + (flagged - 12) + ')');
  assert.equal(total(big).abnormal, teams.reduce((n, t) => n + t.abnormal, 0), 'every abnormal payment of every team is in the total, shown or not');
  assert.equal(total(big).dedCases, 28, 'and every case');
  // THE LAST ROW CARRIES CASES TOO when more than twelve teams have one: fifteen teams, one case each, the last three are "the others" with three cases
  const fifteen = Array.from({ length: 15 }, (_, i) => 'F' + String(i).padStart(2, '0'));
  const lots = P.presAbnDedSlide_({ teamPerf: fifteen.map(t => tp(t, 2)) }, { ded: { ...ON, cases: 15, teams: fifteen.map(t => ({ team: t, cases: 1 })) } });
  assert.equal(lots.rows.length, 13); assert.deepEqual(lots.rows[12], { team: 'Timu nyingine / Other teams (3)', abnormal: 6, dedCases: 3 });
  assert.equal(total(lots).dedCases, 15, 'every case of every team, shown or not'); assert.equal(total(lots).abnormal, 30);
  // cases first: the twelve shown are the teams with cases, then the most flagged; the rest are the ones the room needs least
  assert.deepEqual(big.rows.slice(0, 7).map(r => r.dedCases), [7, 6, 5, 4, 3, 2, 1]);
  // exactly twelve teams: no last row; thirteen: a last row of ONE team
  const n = k => P.presAbnDedSlide_({ teamPerf: Array.from({ length: k }, (_, i) => tp('T' + String(i).padStart(2, '0'), 1)) }, { ded: { ...ON, teams: [] } }).rows;
  assert.equal(n(12).length, 12); assert.equal(n(13).length, 13); assert.equal(n(13)[12].team, 'Timu nyingine / Other teams (1)');
});

test('THE JOIN BY TEAM NAME: a deduction case under a team the dashboard does not know is a row of its own with no abnormal payment; a different spelling of the case (capitals, blanks) is the same team; the "—" team (no team on the case) is a row too', () => {
  const s = P.presAbnDedSlide_({ teamPerf: [tp('Kongowe', 6)] }, { ded: { ...ON, cases: 5, teams: [{ team: ' KONGOWE ', cases: 2 }, { team: 'OLD TEAM', cases: 2 }, { team: '—', cases: 1 }] } });
  assert.deepEqual(s.rows, [{ team: 'Kongowe', abnormal: 6, dedCases: 2 }, { team: 'OLD TEAM', abnormal: 0, dedCases: 2 }, { team: '—', abnormal: 0, dedCases: 1 }]);
  assert.equal(P.autoTotals(s.rows, s.cols).dedCases, 5);
});

test('WHILE THE CASES LOAD, OR IF THEY DID NOT COME: their column is blank (null, never a nought) and its total is blank, the abnormal payments are still there, and the caption says which and why -- escaped', () => {
  const loading = P.presAbnDedSlide_(D, { ded: null, dedWhy: '' });
  assert.ok(loading.rows.length > 0 && loading.rows.every(r => r.dedCases === null), 'not known is null on every row');
  assert.deepEqual(loading.rows.map(r => r.team), ['MBAGALA', 'NYAMA', 'KONGOWE'], 'with no cases to rank by, the most abnormal payments first (TANDIKA and QUIET have none)');
  assert.equal(P.autoTotals(loading.rows, loading.cols).dedCases, null, 'a total of "not known" is not known');
  assert.equal(P.autoTotals(loading.rows, loading.cols).abnormal, 37);
  assert.match(loading.caption, /Kesi za makato zinapakia \/ the deduction cases are loading/);
  const failed = P.presAbnDedSlide_(D, { ded: null, dedWhy: 'Seva <b>haijibu</b> & "ilikata"' });
  assert.match(failed.caption, /Kesi za makato hazikupakia \/ the deduction cases did not load/);
  assert.ok(failed.caption.includes('Seva &lt;b&gt;haijibu&lt;/b&gt; &amp; &quot;ilikata&quot;'), 'the reason is escaped text');
  assert.ok(failed.rows.every(r => r.dedCases === null));
  // the "others" row of a long list is blank too, not a nought
  const many = P.presAbnDedSlide_({ teamPerf: Array.from({ length: 15 }, (_, i) => tp('T' + i, 1)) }, { ded: null, dedWhy: 'x' });
  assert.equal(many.rows.length, 13); assert.equal(many.rows[12].dedCases, null); assert.equal(many.rows[12].abnormal, 3);
  // RUN-ME-043 not run: the slide says so, in the server's words, and the column is blank
  const off = P.presAbnDedSlide_(D, { ded: { on: false, note: 'Jedwali <halipo>', cases: 0, teams: [] } });
  assert.match(off.caption, /Jedwali la makato halipo \/ the deductions table is not there yet/); assert.ok(off.caption.includes('Jedwali &lt;halipo&gt;'));
  assert.ok(off.rows.every(r => r.dedCases === null));
});

test('THE CAPTION says the week, how many teams had a case, what the two columns are -- and that a week with nothing says so; every dynamic piece is escaped', () => {
  const s = P.presAbnDedSlide_(D, { ded: ON });
  assert.ok(s.caption.includes('Wiki / Week: 2026-11-23 → 2026-11-29'));
  assert.ok(s.caption.includes('Timu zenye kesi / teams with a deduction case: 3 / 5'), 'three teams had a case, of the five the dashboard holds');
  assert.match(s.caption, /Abnormal = malipo yaliyowekwa alama kwenye kadi ya Abnormal/); assert.match(s.caption, /Deduction cases = unique PMO deduction cases reported this week, a case counted once however many staff it names/);
  const hostile = P.presAbnDedSlide_(D, { ded: { ...ON, weekOf: '<i>', weekEnd: '"x"' } });
  assert.ok(hostile.caption.includes('&lt;i&gt;') && hostile.caption.includes('&quot;x&quot;') && !hostile.caption.includes('<i>'));
  const quiet = P.presAbnDedSlide_({ teamPerf: [tp('A', 0), tp('B', 0)] }, { ded: { ...ON, cases: 0, teams: [] } });
  assert.deepEqual(quiet.rows, []); assert.match(quiet.caption, /Hakuna kesi za makato wala malipo yasiyo ya kawaida wiki hii \/ no deduction cases and no abnormal payments this week/);
  assert.equal(P.autoTotals(quiet.rows, quiet.cols), null, 'no rows, no total row');
});

test('ITS OWN COLUMN WIDTHS AND CLEARANCE: the slide asks for the class, the four widths add up to the whole table, and the table keeps 44 pixels clear of each navigation arrow (as the day slide\'s grid does); no other wall table is touched', () => {
  assert.equal(P.presAbnDedSlide_(D, { ded: ON }).tcls, 'pcolabn');
  const css = code(APP);
  const w = {};
  for (const m of css.matchAll(/#pres \.ptable\.pcolabn((?: th:nth-child\(\d\),? ?#pres \.ptable\.pcolabn)*) th:nth-child\((\d)\)\{width:([\d.]+)%\}/g)) {
    for (const n of [m[2], ...[...m[1].matchAll(/th:nth-child\((\d)\)/g)].map(x => x[1])]) w[n] = Number(m[3]);
  }
  assert.deepEqual(w, { 1: 6, 2: 44, 3: 25, 4: 25 });
  assert.equal(Object.values(w).reduce((a, b) => a + b, 0), 100, 'four columns, the whole table');
  assert.match(css, /#pres \.ptable\.pcolabn\{width:calc\(100% - 88px\);margin:0 44px\}/, 'clear of the arrows, which sit 74 pixels in from the edge');
  assert.match(css, /#pres \.ptable\.pcolabn td:nth-child\(2\), #pres \.ptable\.pcolabn th\.r\{white-space:normal\}/, 'a long team name and a long header may wrap; a figure never does (the base rule)');
  // the margin is on the slide's own class only: the base wall table still spans the whole width
  assert.match(css, /#pres \.ptable\{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;/);
});

test('NO SLIDE AT ALL for a person who does not hold the PMO Deduction tab; and a damaged answer never takes the deck down', () => {
  assert.equal(page(false).presAbnDedSlide_(D, { ded: ON }), null);
  assert.equal(page(false).presAbnDedSlide_(D, { ded: null, dedWhy: 'x' }), null);
  // damaged shapes of the dashboard's list and of the server's: read as no rows, never thrown
  for (const bad of [{}, { teamPerf: null }, { teamPerf: 'nope' }, { teamPerf: { 0: tp('A', 1) } }, { teamPerf: [null, undefined, {}, 3, 'x', tp('A', 2)] }])
    assert.doesNotThrow(() => P.presAbnDedSlide_(bad, { ded: ON }), JSON.stringify(bad));
  for (const bad of [{ ...ON, teams: null }, { ...ON, teams: 'x' }, { ...ON, teams: { 0: { team: 'A', cases: 1 } } }, { ...ON, teams: [null, undefined, {}, 3, { team: 'A', cases: 'many' }] }, { on: true }, {}])
    assert.doesNotThrow(() => P.presAbnDedSlide_(D, { ded: bad }), JSON.stringify(bad));
  assert.deepEqual(P.presAbnDedSlide_({ teamPerf: [tp('A', 2)] }, { ded: { ...ON, teams: [{ team: 'A', cases: 'many' }] } }).rows, [{ team: 'A', abnormal: 2, dedCases: 0 }], 'a count that is not a number reads as nought for a team that is listed');
  assert.equal(P.presAbnDedSlide_({ teamPerf: [tp('A', 2)] }, undefined).rows.length, 1, 'no deduction state at all is "loading", not a crash');
});

/* --- the load --------------------------------------------------------------------------------------------------------------------------------------------- */
const loader = (held, answers) => {
  const S = { view: 'present', presData: null }, calls = [], redraws = [];
  const srv = (fn, args) => { calls.push([fn, args]); const a = answers.shift(); return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); };
  const run = new Function('S', 'srv', 'allowed', 'presRedraw_', LOAD_SRC + '\nreturn { presDed_, presDedAgain_ };')(S, srv, () => held, () => redraws.push(S.presData && { ded: S.presData.ded, why: S.presData.dedWhy, loading: S.presData.dedLoading }));
  return { S, calls, redraws, ...run };
};

test('THE FIRST LOAD: asked of a holder only, for the week the other two reads were asked for; the answer is kept and the deck redrawn once; a miss is kept with its reason, never thrown', async () => {
  const wk = { weekOf: '2026-11-16' };
  const ok = loader(true, [ON]); const mine = ok.S.presData = { d: {}, ded: null, dedWhy: '', dedLoading: false };
  await ok.presDed_(wk);
  assert.deepEqual(ok.calls, [['deductionsWeek', wk]], 'one read, the same week');
  assert.equal(mine.ded, ON); assert.equal(mine.dedWhy, ''); assert.equal(mine.dedLoading, false);
  assert.deepEqual(ok.redraws, [{ ded: ON, why: '', loading: false }]);
  // a miss
  const bad = loader(true, [new Error('Server haikujibu ndani ya sekunde 45')]); const m2 = bad.S.presData = { d: {}, ded: null, dedWhy: '', dedLoading: false };
  await bad.presDed_(wk);
  assert.equal(m2.ded, null); assert.equal(m2.dedWhy, 'Server haikujibu ndani ya sekunde 45'); assert.equal(m2.dedLoading, false); assert.equal(bad.redraws.length, 1, 'redrawn so the slide and the note say why');
  // a retry that works clears the reason
  bad.calls.length = 0; bad.S.presData.ded = null; const again = loader(true, [ON]); again.S.presData = m2; await again.presDed_(wk);
  assert.equal(m2.ded, ON); assert.equal(m2.dedWhy, '');
  // a person who does not hold the tab is never asked, and nothing is drawn for it
  const no = loader(false, [ON]); no.S.presData = { d: {}, ded: null, dedWhy: '', dedLoading: false };
  await no.presDed_(wk);
  assert.deepEqual(no.calls, []); assert.deepEqual(no.redraws, []); assert.equal(no.S.presData.ded, null);
  // no figures at all (the tab was left): nothing is asked
  const gone = loader(true, [ON]); await gone.presDed_(wk); assert.deepEqual(gone.calls, []);
});

test('NOTHING IS DRAWN OVER A TAB THE PERSON HAS LEFT, or over another week\'s figures: a late answer is kept on the figures it was asked for and the deck is not redrawn', async () => {
  const wk = { weekOf: '' };
  const l = loader(true, [ON]); const mine = l.S.presData = { d: {}, ded: null, dedWhy: '', dedLoading: false };
  const p = l.presDed_(wk);
  l.S.view = 'dashboard';                       // the person moved to another tab while it was on its way
  await p; assert.equal(mine.ded, ON); assert.deepEqual(l.redraws, []);
  const l2 = loader(true, [ON]); l2.S.presData = { d: {}, ded: null, dedWhy: '', dedLoading: false };
  const q = l2.presDed_(wk); l2.S.presData = { d: {}, ded: null, dedWhy: '', dedLoading: false };   // a new week's figures replaced them
  await q; assert.deepEqual(l2.redraws, [], 'the new figures are not redrawn by an answer for the old'); assert.equal(l2.S.presData.ded, null);
});

test('THE REFRESH (every three minutes while the deck plays): the answer replaces the last; a miss keeps the last answer and says nothing; a miss with nothing to keep says why; a person who does not hold the tab is not asked', async () => {
  const wk = { weekOf: '' };
  const NEW = { ...ON, cases: 11 };
  const l = loader(true, [NEW, new Error('slow'), new Error('slow again')]);
  const mine = { d: {}, ded: ON, dedWhy: '', dedLoading: false };
  await l.presDedAgain_(wk, mine); assert.equal(mine.ded, NEW);
  await l.presDedAgain_(wk, mine); assert.equal(mine.ded, NEW, 'a missed refresh keeps the last figures'); assert.equal(mine.dedWhy, '', 'and says nothing: the deck\'s own stamp says how old they are');
  const fresh = { d: {}, ded: null, dedWhy: '', dedLoading: false };
  await l.presDedAgain_(wk, fresh); assert.equal(fresh.ded, null); assert.equal(fresh.dedWhy, 'slow again', 'nothing to keep: the reason');
  assert.equal(l.calls.length, 3); assert.ok(l.calls.every(c => c[0] === 'deductionsWeek' && c[1] === wk));
  const no = loader(false, [NEW]); await no.presDedAgain_(wk, { d: {} }); assert.deepEqual(no.calls, []);
  await l.presDedAgain_(wk, null);        // no figures: nothing happens
});

/* --- the wiring ------------------------------------------------------------------------------------------------------------------------------------------- */
test('THE WIRING: the slide sits right after the day\'s and before the boards\' check, so it plays without them; the Abnormal tile takes the line; the rows carry `team`, so the deck\'s team filter scopes it', () => {
  const view = code(PRESENT.slice(PRESENT.indexOf('function presSlides()'), PRESENT.indexOf('function presApply()')));
  const iKpi = view.indexOf("id:'kpi'"), iAbn = view.indexOf('presAbnDedSlide_(d, S.presData)'), iTeams = view.indexOf("id:'teams'"), iBoards = view.indexOf('if (!b){');
  assert.ok(iKpi > 0 && iKpi < iAbn && iAbn < iTeams && iTeams < iBoards, 'kpi, then the per-team view, then the team performance, then the boards\' check');
  assert.match(view, /var abnDed = presAbnDedSlide_\(d, S\.presData\);\s*if \(abnDed\) slides\.push\(abnDed\);/, 'built in the deck only for a holder (the builder says null otherwise)');
  assert.match(view, /var dedLine = presDedLine_\(S\.presData\);/, 'the line is made once, above the day slide');
  assert.match(view, /\{ l:'Abnormal', v:money\(c\.abnormal\), s:dedLine \}/, 'the Abnormal tile is the dashboard\'s own figure with the line under it');
  // every other tile is as it was: exactly twelve, no other uses the line
  assert.equal((view.match(/s:dedLine/g) || []).length, 1);
  // the deck's own team filter works on a table slide whose first row has a `team`
  const apply = code(PRESENT.slice(PRESENT.indexOf('function presApply()'), PRESENT.indexOf('function presRender()')));
  assert.match(apply, /if \(sl\.rows\.length && 'team' in sl\.rows\[0\]\) return \{ \.\.\.sl, rows: only\(sl\.rows, 'team'\) \};/);
  const s = P.presAbnDedSlide_(D, { ded: ON });
  assert.ok('team' in s.rows[0]);
  const S2 = { presOff: [], presTeam: 'MBAGALA' };
  const run = new Function('S', 'presSlides', 'load', code(apply) + '\npresApply(); return S.slides;')(S2, () => [s], () => '');
  assert.deepEqual(run[0].rows, [{ team: 'MBAGALA', abnormal: 20, dedCases: 2 }], 'scoped to one team, the way every other board is');
});

test('THE LOAD ORDER AND THE GATE: the cases are asked for after the boards on the first load and on the refresh, only through the two functions that check the tab, and nothing else in the module calls the server for them', () => {
  const c = code(PRESENT);
  assert.equal((c.match(/srv\('deductionsWeek'/g) || []).length, 2, 'two places ask, no more: the first load and the refresh');
  const both = [c.slice(c.indexOf('function presDed_('), c.indexOf('function presDedAgain_(')), c.slice(c.indexOf('function presDedAgain_('), c.indexOf('function presRedraw_('))];
  for (const f of both) assert.ok(f.indexOf("allowed('deduct')") > 0 && f.indexOf("allowed('deduct')") < f.indexOf("srv('deductionsWeek'"), 'the tab is checked before the server is asked');
  assert.match(c, /presBoards_\(wk\)\.then\(function\(\)\{ return presDed_\(wk\); \}\);/, 'after the boards, never beside them');
  assert.match(c, /\.then\(function\(\)\{ return presDedAgain_\(wk, mine\); \}\)/, 'and the refresh: after the boards');
  assert.ok(!/Promise\.all/.test(c), 'no wave of reads side by side');
  // the data the page keeps for the deck
  assert.match(c, /S\.presData = \{ d: d, b: null, bWhy: '', bLoading: false, ded: null, dedWhy: '', dedLoading: false \};/);
});

test('THE PAGE SAYS WHEN THEY DID NOT COME, and offers a retry that is wired; only for a holder, only when they failed (not while loading, not once they came)', () => {
  const render = PRESENT.slice(PRESENT.indexOf('function presRender()'), PRESENT.indexOf('function presStart('));
  const note = between(render, 'var dedNote =', 'HEAD = weekBar(d)');
  const run = (held, pd) => new Function('allowed', 'S', 'esc', note + '\nreturn dedNote;')(() => held, { presData: pd }, P.esc);
  assert.equal(run(true, { ded: null, dedWhy: '', dedLoading: false }), '', 'not asked yet: nothing');
  assert.equal(run(true, { ded: null, dedWhy: 'x', dedLoading: true }), '', 'on its way (a retry): nothing');
  assert.equal(run(true, { ded: ON, dedWhy: '', dedLoading: false }), '', 'it came');
  assert.equal(run(false, { ded: null, dedWhy: 'x', dedLoading: false }), '', 'not theirs: nothing');
  const bad = run(true, { ded: null, dedWhy: 'Seva <haijibu>', dedLoading: false });
  assert.ok(bad.includes('Kesi za makato hazikupakia / the deduction cases did not load') && bad.includes('id="presDedRetry"') && bad.includes('Seva &lt;haijibu&gt;'));
  assert.match(render, /HEAD = weekBar\(d\) \+ boardsNote \+ dedNote \+ '<div class="kpis">'/, 'drawn beside the boards\' note');
  assert.match(APP, /var pdr = document\.getElementById\('presDedRetry'\);\s*if \(pdr\) pdr\.onclick = function\(\)\{ presDed_\(S\.presWk \|\| \{ weekOf: S\.args\.weekOf \|\| '' \}\); presRedraw_\(\); \};/, 'the retry asks again for the same week and redraws');
});
