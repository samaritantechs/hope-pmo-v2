/* =====================================================================================
   THE REPORTS CLAUDIAN-PMO MAY READ -- read-only DATA VIEWS, for the person's own teams (handbook Part 160).

     "i want typing b/se someone could ask anything unpredictable like "team gani leo hawapigi simu kabisa"
      so it could require reading reports and giving the least one(s)"          -- the owner, 25 Nov 2026

   WHAT THE HELPER WAS. With the knowledge cards (Part 159) it knows how HOPE works. It could not read a figure: a
   question like "which team has not made a call today?" needs today's calls, team by team, and "give me the lowest"
   needs them put in order. This is the other half: a few VIEWS, each worked out by the SAME function the screen of
   the same name uses, for the SAME teams the person may see, and put in front of the model as a few lines of figures.

   THE RULES THAT HOLD EVERY VIEW (each is a test):
     - Read-only, and only the screens' own functions: the Calls report (call-core's reportCoreForPortal, the Calls
       tab's) and last week's team results (the performance record the weekly report keeps). No new SQL, no new table.
     - A view is offered only to a person who may open the screen it comes from: the Calls report to a holder of the
       Calls tab (admin and view-only codes hold every screen) or to a LEADER on the phone (Ripoti is a leader's
       screen); last week's results to a holder of the Weekly report, the Dashboard or Best of, or a leader on the
       phone. A phone officer is shown no team's figures. The teams are the person's own: an access code's, or a
       leader's live scope; never a team they do not hold.
     - Figures and the names of teams and officers only. Never a customer, a phone number, an amount of a person's
       pay. Every name is cleaned (no markup, no control character, forty characters) before it reaches the model, and
       the heading says the lines are data, not instructions.
     - ONLY WHEN THE QUESTION NEEDS THEM: a topic word (calls, collection...) AND a word that asks about teams or
       officers or a ranking (team, nani, least, kidogo...). "How do I make a call?" reads nothing.
     - NEVER ON THE UPLOAD OR THE CALL APP. This file is loaded by the helper's own function, nothing in /api/upload or
       /api/call imports it (a test fails if one does), and a view is read once for each set of teams and day in five
       minutes (the answer is kept, a read in flight is shared), under a budget (DATA_BUDGET_MS, fifteen seconds): past it the
       model is told the report did not answer, and the person still gets an answer.
     - A failure is an answer, never an error: "could not be read now".

   TO ADD A VIEW: one object in VIEWS (its topic words, who may have it, how it is read) and one test. Not before the
   owner says which report: the next candidates are the Exp.Def recovery by leader and the dashboard's day figures.
   ===================================================================================== */
import { wordsOf, keyHit } from './claudian-cards.js';
import { todayKey, weekMondayKey, addDaysKey } from './time.js';
import { wholePct } from './recovery.js';
import { reportCoreForPortal, scopedUser, scopeFor } from './call-core.js';
import { portalApi } from './portal-core.js';

/** The raw gated user of a portal person (their ACCESS CODE is in it): kept BESIDE the subject, never on it, so nothing can stringify, log or send it. The portal's own door is asked as
    this person, so the door's rule (the screens they hold, the teams they hold) is the rule of every view that goes through it: the helper can be given nothing the person's own screen
    would refuse them (handbook Part 166). */
const USERS = new WeakMap();
export function rememberUser(subject, user) { if (subject && typeof subject === 'object' && user && typeof user === 'object') USERS.set(subject, user); return subject; }
const userOf = subject => (subject && USERS.get(subject)) || null;

/** The longest the helper waits for the reports before it answers without them, and how long a reading is kept.
    FOUR SECONDS WAS TOO SHORT (26 Nov, the first live question, "team gani hazipigi simu kabisa", asked by the admin): the Calls report of EVERY team is the
    heaviest read of the Calls tab, and the model was told it "did not answer in time". The wait is fifteen seconds now, and it comes out of the model's allowance
    (modelWaitMs in claudian.js), so the page, which gives up at 35 seconds, never gives up before the server has answered. How long each report really took
    is written into the chat's note (see readViews), so the next number is read, not guessed. */
export const DATA_BUDGET_MS = 15000;
export const DATA_TTL_MS = 5 * 60 * 1000;
/** A reading still unfinished after this long has outlived the host's own sixty seconds: an instance that was paused after its answer never finishes it. The next question
    makes a new reading instead of waiting on a dead one for the rest of the five minutes (with a longer wait, a dead reading would cost every question fifteen seconds). */
export const DATA_STUCK_MS = 90 * 1000;
/** How much of a view reaches the model: the few lowest and highest, never the whole company. */
const SHOW_LOW = 8, SHOW_HIGH = 3, SHOW_ZERO = 16, SHOW_NAMES = 12, SHOW_ALL_UP_TO = 14;

const K = v => String(v == null ? '' : v).trim().toUpperCase();
/** A name as it is shown to the model: text only, one line, forty characters. A team or an officer's name is typed by a person. */
export const clean = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>`{}\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/* ---------- which question wants which report ---------- */
/** Words that say a question is about calls, about results and about this week's figures. A stem of four letters or more touches any word that holds it ("pigi" is in
    "hawapigi", "piga" in "nimepiga"); three letters or fewer are whole words. */
const TOPIC = {
  calls: ['simu', 'piga', 'pigia', 'pigi', 'pigo', 'pigiwa', 'call', 'calls', 'called', 'calling', 'dial', 'dials', 'portfolio', 'mazungumzo', 'wapigaji'],
  standing: ['makusanyo', 'kukusanya', 'collection', 'collected', 'urejeshaji', 'kurejesha', 'recovery', 'recovered', 'mauzo', 'sales', 'sold', 'asilimia', 'percent', 'malengo', 'lengo',
    'target', 'targets', 'utendaji', 'matokeo', 'performance', 'standing', 'behind', 'nyuma'],
  // this week's and today's dashboard figures: what is collected, recovered, sold, owed, applied for
  week: ['makusanyo', 'kukusanya', 'collection', 'collected', 'rejesho', 'marejesho', 'urejeshaji', 'kurejesha', 'recovery', 'recovered', 'mauzo', 'kuuza', 'sales', 'sold', 'mikopo', 'loans', 'maombi',
    'applications', 'apps', 'deni', 'madeni', 'arrears', 'wadaiwa', 'waliochelewa', 'defaulter', 'defaulters', 'expected', 'uncollected', 'asilimia', 'percent', 'percentage', 'utendaji', 'matokeo',
    'performance', 'malengo', 'lengo', 'target', 'targets', 'standing', 'behind', 'nyuma', 'abnormal'],
  // a phone person's own calls
  mine: ['simu', 'piga', 'pigia', 'pigi', 'pigo', 'pigiwa', 'call', 'calls', 'called', 'calling', 'dial', 'dials', 'portfolio', 'mazungumzo', 'reached', 'nimefikia'],
};
/** Words that say the person wants teams or officers compared, counted or ranked, not a rule explained. */
const CUES = ['team', 'teams', 'timu', 'officer', 'officers', 'afisa', 'maafisa', 'nani', 'who', 'which', 'gani', 'ipi', 'wapi', 'least', 'most', 'lowest', 'highest', 'worst', 'best', 'bottom', 'top',
  'kidogo', 'chini', 'zaidi', 'juu', 'ngapi', 'many', 'hakuna', 'none', 'zero', 'sifuri', 'kabisa', 'wangu', 'yangu', 'zangu', 'wote', 'kila', 'each', 'everyone', 'ranking', 'compare', 'linganisha'];
/** WHEN: today and now, the week, the month, last week. QTY: a count, an amount, a percentage. PERSONAL: the person's own. They say a question wants a FIGURE and not a rule explained (a how-to
    question with none of these, or of the CUES, reads nothing). LAST says last week's, NOW this week's and today's: the two results the helper can give. */
const NOW = ['leo', 'today', 'sasa', 'now', 'hii', 'huu', 'current', 'currently', 'present', 'so_far', 'hadi_sasa', 'this_week', 'this_month', 'this_morning', 'tonight', 'mwezi_huu'];
const LAST = ['iliyopita', 'uliopita', 'iliopita', 'jana', 'last', 'previous', 'prior'];
const WHEN = [...NOW, ...LAST, 'wiki', 'week', 'weekly', 'mwezi', 'month', 'monthly'];
const QTY = ['ngapi', 'wangapi', 'kiasi', 'jumla', 'total', 'asilimia', 'percent', 'percentage', 'how_many', 'how_much', 'many', 'much', 'average', 'wastani', 'sum'];
const PERSONAL = ['yangu', 'wangu', 'langu', 'zangu', 'changu', 'vyangu', 'nimepiga', 'nimepigia', 'nimefikia', 'nimeripoti', 'my', 'mine', 'nina', 'did_i', 'have_i', 'am_i'];
/** Words that make a question about OTHERS: teams, officers, who and which, each and everyone, a ranking. A question about the person's own calls has none of them. */
const TEAMISH = ['team', 'teams', 'timu', 'officer', 'officers', 'afisa', 'maafisa', 'nani', 'who', 'which', 'gani', 'ipi', 'wote', 'kila', 'each', 'everyone', 'ranking', 'compare', 'linganisha'];
const hit = (tokens, words) => words.some(w => keyHit(tokens, w));
/** Which period the question is about: 'last' (last week's results), 'now' (this week and today) or 'both' (it does not say). */
export function periodOf(question) {
  const t = wordsOf(question);
  if (hit(t, LAST) || hit(t, ['last_week', 'wiki_iliyopita', 'wiki_jana'])) return 'last';
  if (hit(t, NOW)) return 'now';
  return 'both';
}

/** The screens whose holders may be given each view (a portal person), and the phone's rule. The admin and a view-only code hold every screen. */
const CALLS_TABS = ['calls'], STANDING_TABS = ['weekly', 'dashboard', 'perf', 'reports'], WEEK_TABS = ['dashboard', 'present'];
const tabsOk = (subject, tabs) => !!subject.allTabs || tabs.some(t => (subject.tabs || []).includes(t));
const mayHave = {
  calls: s => (s.source === 'call' ? !!s.leader : tabsOk(s, CALLS_TABS)),
  standing: s => (s.source === 'call' ? !!s.leader : tabsOk(s, STANDING_TABS)),
  // the dashboard's own figures, for the teams the person's code holds: the portal door asks the same question of the tab (FN_TAB: dashboardFull is for the dashboard and the Presentation)
  week: s => s.source !== 'call' && tabsOk(s, WEEK_TABS),
  // a phone person's OWN calls: nobody else's, whatever their role (a leader's team figures are the calls view)
  mine: s => s.source === 'call',
};
/** What each view is called to the model's CONTEXT ("FIGURES YOU MAY GIVE THIS PERSON") and in the chat's note. */
const LABEL = { calls: 'calls by team', standing: 'last week by team', week: 'this week by team', mine: 'own calls' };
const GIVES = {
  calls: 'calls by team (today and this week)',
  standing: 'last full week\'s sales, collection and recovery by team',
  week: 'this week\'s and today\'s dashboard figures (sales, collection, recovery, arrears, loan applications) and how the teams stand',
  mine: 'their own calls (today and this week)',
};
const ORDER = ['calls', 'standing', 'week', 'mine'];
/** The kinds of figures this person may be given, in words for the model: what their screens and their phone allow, nothing more. */
export function figuresFor(subject) {
  if (!subject) return [];
  return ORDER.filter(id => mayHave[id](subject)).map(id => GIVES[id]);
}
/** What each kind of question wants: the comparison views read only for a question of comparison (teams, officers, a ranking), the figures views for a question of figures too. */
const INTENT = {
  calls: c => c.asks && !(c.personal && !c.teamish),         // "how many calls did I make" is about the person, not about the teams (the Calls report of every team is the heaviest read there is)
  standing: c => c.asks || c.when || c.qty,
  week: c => c.asks || c.when || c.qty,
  mine: c => !c.teamish && (c.qty || c.personal),            // "which of my teams calls least" is about teams
};

/** The views this question needs and this person may have, in a fixed order. Nothing unless a topic word of the view AND a word that asks for figures are there ("How do I make a call?" reads nothing).
    Last week's results are read only for a question about last week or that does not say; this week's only for one about now or that does not say. */
export function viewsFor(subject, question) {
  const tokens = wordsOf(question);
  if (!tokens.length || !subject) return [];
  const c = { asks: hit(tokens, CUES), when: hit(tokens, WHEN), qty: hit(tokens, QTY), personal: hit(tokens, PERSONAL), teamish: hit(tokens, TEAMISH) };
  const period = periodOf(question);
  return ORDER.filter(id => mayHave[id](subject) && hit(tokens, TOPIC[id]) && INTENT[id](c)
    && (id !== 'standing' || period !== 'now') && (id !== 'week' || period !== 'last'));
}

/* ---------- reading ---------- */
/** The teams this person may read: a portal person's code, a phone leader's live scope (the code as it reads NOW, as the phone's own Ripoti reads it).
    null is every team. */
async function teamsOf(db, subject, nowMs) {
  if (subject.source === 'call' && subject.cu) {
    const base = await scopedUser(db, subject.cu, nowMs);
    return scopeFor(db, base);
  }
  return subject.teams && subject.teams.length ? subject.teams : (subject.teams === null || subject.teams === undefined ? null : []);
}
const scopeKey = teams => (teams ? teams.map(K).filter(Boolean).sort().join(',') : 'ALL');

/** One number and one name, as a short list the model can read: "A 3/2, B 5/4". */
const pair = (n, p) => n + '/' + p;

/** TODAY'S AND THIS WEEK'S CALLS BY TEAM, from the Calls report of the person's own teams (every registered active officer is listed, at zero). */
async function readCalls(db, teams, nowMs, fmt) {
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs);
  const rep = await reportCoreForPortal(db, { teams }, { from: mon, to: today }, nowMs);
  const T = new Map();
  const team = name => { const k = K(name) || '(no team)'; if (!T.has(k)) T.set(k, { name: clean(name) || '(no team)', officers: 0, none: 0, callsToday: 0, pfToday: 0, callsWeek: 0, pfWeek: 0, noneNames: [] }); return T.get(k); };
  const todayBy = new Map();
  for (const r of rep.byDay || []) if (String(r.day).slice(0, 10) === today) todayBy.set(K(r.team) + '|' + K(r.officer), { calls: Number(r.calls) || 0, pf: Number(r.pf) || 0 });
  let officers = 0, officersNone = 0;
  const noOne = [];
  for (const u of rep.users || []) {
    const t = team(u.team);
    t.officers++; officers++;
    t.callsWeek += Number(u.calls) || 0; t.pfWeek += Number(u.portfolio) || 0;
    const td = todayBy.get(K(u.team) + '|' + K(u.name)) || { calls: 0, pf: 0 };
    t.callsToday += td.calls; t.pfToday += td.pf;
    if (!td.calls) { t.none++; officersNone++; noOne.push(clean(u.name) + ' (' + t.name + ')'); }
  }
  const rows = [...T.values()];
  if (!rows.length) return ['CALLS BY TEAM: no registered officer is in this person\'s teams, so there is nothing to report.'];
  const byToday = [...rows].sort((a, b) => a.callsToday - b.callsToday || a.pfToday - b.pfToday || a.name.localeCompare(b.name));
  const zero = byToday.filter(r => r.callsToday === 0), zeroWeek = rows.filter(r => r.callsWeek === 0).sort((a, b) => a.name.localeCompare(b.name));
  const L = [];
  L.push('CALLS BY TEAM, today (' + today + ') and this week so far (' + mon + ' to ' + today + '). A call is one number rung in a day; portfolio is a call to a customer of the team. Figures are calls/portfolio. They reach the system when an officer\'s phone syncs, so a team can read 0 early in the day or when its officers have not opened the app.');
  L.push('Teams in view: ' + rows.length + '; registered active officers: ' + officers + '; officers with no call today: ' + officersNone + '.');
  L.push('Teams with NO call today: ' + (zero.length ? zero.length + ': ' + zero.slice(0, SHOW_ZERO).map(r => r.name + ' (' + r.officers + ' officers)').join(', ') + (zero.length > SHOW_ZERO ? ', and ' + (zero.length - SHOW_ZERO) + ' more' : '') : 'none') + '.');
  if (rows.length <= SHOW_ALL_UP_TO) L.push('Every team, today, lowest first: ' + byToday.map(r => r.name + ' ' + pair(r.callsToday, r.pfToday)).join(', ') + '.');
  else {
    L.push('Lowest ' + SHOW_LOW + ' teams today: ' + byToday.slice(0, SHOW_LOW).map(r => r.name + ' ' + pair(r.callsToday, r.pfToday)).join(', ') + '.');
    L.push('Highest ' + SHOW_HIGH + ' teams today: ' + byToday.slice(-SHOW_HIGH).reverse().map(r => r.name + ' ' + pair(r.callsToday, r.pfToday)).join(', ') + '.');
  }
  const byWeek = [...rows].sort((a, b) => a.callsWeek - b.callsWeek || a.pfWeek - b.pfWeek || a.name.localeCompare(b.name));
  L.push('This week: teams with NO call all week: ' + (zeroWeek.length ? zeroWeek.length + ': ' + zeroWeek.slice(0, SHOW_ZERO).map(r => r.name).join(', ') : 'none') + '; lowest ' + Math.min(SHOW_HIGH + 2, rows.length) + ' teams: '
    + byWeek.slice(0, SHOW_HIGH + 2).map(r => r.name + ' ' + pair(r.callsWeek, r.pfWeek)).join(', ') + '.');
  if (noOne.length) L.push('Officers with no call today' + (noOne.length > SHOW_NAMES ? ' (first ' + SHOW_NAMES + ' of ' + noOne.length + ')' : '') + ': ' + noOne.slice(0, SHOW_NAMES).join(', ') + '.');
  return L;
}

/** LAST FULL WEEK'S RESULTS BY TEAM, from the performance record the weekly report keeps (as the helper's own "behind" test reads it). */
async function readStanding(db, teams, nowMs, fmt) {
  const week = addDaysKey(weekMondayKey(nowMs), -7);
  const names = teams && teams.length ? fmt.names(teams) : null;
  // A person's teams go to the database as a list; a very long one (a collection officer holds thirty-odd, a few can hold a hundred) is read whole (the
  // record is one row for each team and measure of one week: a few hundred small rows) and cut to the person's teams here, before anything is said.
  const inList = !!names && names.length <= 100;
  const { data, error } = await (() => {
    let q = db.from('performance_records').select('metric, name, value, basis').eq('period', 'week').eq('period_start', week).eq('scope', 'team');
    if (inList) q = q.in('name', names);
    return q;
  })();
  if (error) throw new Error('performance record: ' + (error.message || 'refused'));
  const mine = names && !inList ? new Set(names.map(K)) : null;
  const T = new Map();
  for (const r of data || []) {
    const k = K(r.name); if (!k) continue;
    if (mine && !mine.has(k)) continue;
    const t = T.get(k) || { name: clean(r.name), m: {} };
    const x = t.m[String(r.metric)] || (t.m[String(r.metric)] = { value: 0, basis: 0 });
    x.value += Number(r.value) || 0; x.basis += Number(r.basis) || 0;
    T.set(k, t);
  }
  const pct = (t, m) => (t.m[m] && t.m[m].basis > 0 ? wholePct((t.m[m].value / t.m[m].basis) * 100) : null);
  const rows = [...T.values()].map(t => ({ name: t.name, sales: pct(t, 'sales'), col: pct(t, 'collection'), rec: pct(t, 'recovery') }));
  const std = fmt.std;
  if (!rows.length) return ['STANDING, last full week (week of ' + week + '): no weekly record is kept for this person\'s teams (the weekly report was not opened for that week), so there is nothing to rank.'];
  const low = (key, n) => rows.filter(r => r[key] != null).sort((a, b) => a[key] - b[key] || a.name.localeCompare(b.name)).slice(0, n);
  const show = (key, n) => { const l = low(key, n); return l.length ? l.map(r => r.name + ' ' + r[key] + '%').join(', ') : 'not known'; };
  const short = rows.filter(r => (r.sales != null && r.sales < std.sales) && (r.col != null && r.col < std.col) && (r.rec != null && r.rec < std.rec)).map(r => r.name).sort();
  const L = [];
  L.push('STANDING, last full week (week of ' + week + '), by team, whole % of target. Company targets: sales ' + std.sales + '%, collection ' + std.col + '%, recovery ' + std.rec + '%.');
  L.push('Teams with a record: ' + rows.length + (teams && teams.length && rows.length < teams.length ? ' of ' + teams.length + ' (no record for the others: the weekly report was not opened for them that week)' : '') + '.');
  L.push('Lowest sales: ' + show('sales', SHOW_LOW) + '. Lowest collection: ' + show('col', SHOW_LOW) + '. Lowest recovery: ' + show('rec', SHOW_LOW) + '.');
  L.push('Teams below target on all three' + (short.length > SHOW_ZERO ? ' (first ' + SHOW_ZERO + ' of ' + short.length + ')' : '') + ': ' + (short.length ? short.slice(0, SHOW_ZERO).join(', ') : 'none') + '.');
  return L;
}


/** THIS WEEK'S AND TODAY'S FIGURES, from the dashboard (handbook Part 166). The portal's own door is asked AS THE PERSON (portalApi, with the user the access code resolved to), so the screens and the
    teams the person holds are exactly what comes back, and a person without the dashboard is refused by the door itself, not by a rule written again here. The answer is the dashboard's own, cached
    a minute by the door; only a few of its fields are kept, as lines. Never a customer, a phone number or a person's pay. */
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
/** Percentages come from the dashboard already rounded to one decimal; null is "not measured", never a nought. */
const pc = v => (num(v) == null ? 'not measured' : (Math.round(v * 10) / 10) + '%');
const tzs = v => (num(v) == null ? 'not known' : 'TZS ' + Math.round(v).toLocaleString('en-US'));
const lwBit = v => (num(v) == null ? '' : ' (last week ' + pc(v) + ')');
/** AT MOST THIS MANY DASHBOARD READS AT ONCE, whatever the scopes: the dashboard is the heaviest answer the portal makes (some forty round trips cold), and a morning when many leaders ask in the same minute is
    queued here, not a pile of them on the database together. Readings of the same scope are one reading already (the kept answer is shared while it is made). */
export const PORTAL_READS_MAX = 3;
let portalRunning = 0, portalPeak = 0; const portalWaiting = [];
const portalSlot = () => new Promise(resolve => {
  const go = () => { portalRunning++; if (portalRunning > portalPeak) portalPeak = portalRunning; resolve(() => { portalRunning--; const next = portalWaiting.shift(); if (next) next(); }); };
  if (portalRunning < PORTAL_READS_MAX) go(); else portalWaiting.push(go);
});
export const peakPortalReadsForTests = () => portalPeak;
async function readWeek(db, teams, nowMs, fmt, subject) {
  const user = userOf(subject);
  if (!user) throw new Error('no portal person to ask the dashboard as');
  const release = await portalSlot();
  try { return weekLines(await portalApi(db, user, 'dashboardFull', {}, nowMs)); } finally { release(); }
}
/** The lines for the model from one dashboard answer: the week so far, today, the defaulters and, team by team, the lowest and highest of three measures. Pure. */
export function weekLines(d) {
  const o = d && typeof d === 'object' ? d : {};
  const perf = o.perf || {}, cards = o.cards || {};
  const L = [];
  const n = num(o.teamCount);
  L.push('DASHBOARD, week ' + clean(o.weekOf) + ' to ' + clean(o.weekEnd) + ', as of ' + clean(o.asOfDate) + (o.weekday ? ' (' + clean(o.weekday) + ')' : '') + (n != null ? ', ' + n + ' team' + (n === 1 ? '' : 's') + ' in view' : '')
    + (o.pastWeek ? ' (a finished week)' : '') + '. Percentages are of target unless said; "not measured" means it could not be worked out yet.');
  L.push('THIS WEEK SO FAR: sales ' + pc(perf.salesPct) + lwBit(perf.lwSales) + ', collection ' + pc(perf.colPct) + lwBit(perf.lwCol) + ', recovery ' + pc(perf.recPct) + lwBit(perf.lwRec)
    + ', the three together ' + pc(perf.avgPct) + lwBit(perf.lwAvg) + '. Sales ' + tzs(cards.salesWeek) + ' from ' + (num(cards.salesLoans) == null ? 'an unknown number of' : cards.salesLoans)
    + ' loans. Loan applications this week: ' + (num(perf.appsCount) == null ? 'not known' : perf.appsCount) + (num(perf.appsAmount) ? ' (' + tzs(perf.appsAmount) + ')' : '')
    + (num(perf.appsPrevCount) == null ? '' : ', last week ' + perf.appsPrevCount) + '.');
  const today = clean(o.asOfDate);
  const at = list => (Array.isArray(list) ? list.find(x => x && String(x.date).slice(0, 10) === today) || null : null);
  const col = at(o.colTrend), rec = at(o.recTrend), sal = at(o.salesTrend);
  const t = [];
  t.push(col && col.uploaded ? 'collection expected ' + tzs(col.expected) + ', collected ' + tzs(col.collected) + ', uncollected ' + tzs(col.uncollected) + ' (' + pc(col.pct) + ')' : 'no collection sheet for today (a weekend, or not uploaded yet)');
  t.push(o.deckToday === false ? 'no defaulter file has been uploaded today, so today\'s recovery is not measured yet'
    : rec && rec.uploaded ? 'recovered ' + tzs(rec.recovered) + ' (' + pc(rec.pct) + ' of the uncollected it is measured against)' : 'recovery not measured yet');
  t.push(sal ? 'sales ' + tzs(sal.amount) + ' from ' + (num(sal.loans) == null ? 'an unknown number of' : sal.loans) + ' loans (' + pc(sal.pct) + ' of the day\'s target)' : 'no sales figure for today');
  L.push('TODAY (' + today + '): ' + t.join('; ') + '.');
  L.push(o.deckToday === false ? 'DEFAULTERS: no defaulter file has been uploaded today, so there are no figures for today.'
    : 'DEFAULTERS (today\'s files): ' + (num(cards.defaulters) == null ? 'not known' : cards.defaulters + ' customers owing ' + tzs(cards.curArrears))
      + (num(cards.defaultersInitial) == null ? '' : ' (this morning\'s file: ' + cards.defaultersInitial + ' customers, ' + tzs(cards.initArrears) + ')')
      + '; recovered today ' + tzs(cards.recovered) + '; cleared today ' + (num(cards.cleared) == null ? 'not known' : cards.cleared) + '. Abnormal payments flagged: '
      + (num(cards.abnormal) == null ? 'not known' : cards.abnormal) + (num(cards.abnormalAmount) ? ' (' + tzs(cards.abnormalAmount) + ')' : '') + '.');
  const rows = Array.isArray(o.teamPerf) ? o.teamPerf.filter(r => r && r.team) : [];
  if (rows.length) {
    const lowHigh = (key, label, nLow, nHigh) => {
      const list = rows.filter(r => num(r[key]) != null).sort((a, b) => a[key] - b[key] || String(a.team).localeCompare(String(b.team)));
      if (!list.length) return label + ': not measured for any team.';
      const show = r => clean(r.team) + ' ' + pc(r[key]);
      if (list.length <= SHOW_ALL_UP_TO) return label + ', lowest first: ' + list.map(show).join(', ') + '.';
      return label + ': lowest ' + nLow + ': ' + list.slice(0, nLow).map(show).join(', ') + '; highest ' + nHigh + ': ' + list.slice(-nHigh).reverse().map(show).join(', ') + '.';
    };
    L.push('TEAMS (' + rows.length + '): ' + lowHigh('collPctWeek', 'collection so far this week', 5, 2) + ' '
      + lowHigh('tRecPct', 'recovery (of ' + (rows[0].recBasis === 'week' ? 'the week\'s' : 'today\'s') + ' uncollected)', 5, 2) + ' ' + lowHigh('salesPct', 'sales this month (of the monthly target)', 5, 2));
  }
  return L;
}

/** A PHONE PERSON'S OWN CALLS, today and this week: the report of their own team (the Ripoti report, so one definition of a call), cut to their own row and nobody else's. */
async function readMine(db, teams, nowMs, fmt, subject) {
  const cu = subject && subject.cu;
  if (!cu || !String(cu.team || '').trim()) return ['YOUR CALLS: this phone is not registered to a team, so there is nothing to report.'];
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs);
  const rep = await reportCoreForPortal(db, { teams: [cu.team] }, { from: mon, to: today }, nowMs);
  return mineLines(rep, cu.name, today, mon);
}
const mmss = secs => { const s = Math.max(0, Math.round(Number(secs) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
/** The lines for the model from a Calls report: the one person's row of it. Pure. */
export function mineLines(rep, name, today, mon) {
  const me = K(name);
  const users = rep && Array.isArray(rep.users) ? rep.users : [], byDay = rep && Array.isArray(rep.byDay) ? rep.byDay : [];
  const u = users.find(x => K(x.name) === me) || null;
  const day = byDay.filter(r => K(r.officer) === me && String(r.day).slice(0, 10) === today);
  const sum = k => day.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const calls = sum('calls'), pf = sum('pf'), dur = sum('dur');
  const L = [];
  L.push('YOUR CALLS (' + clean(name) + '), today ' + today + ': ' + calls + ' call' + (calls === 1 ? '' : 's') + ' (numbers rung), ' + pf + ' of them portfolio (to customers of your teams), portfolio talk time ' + mmss(dur) + '.');
  if (u) {
    const reached = num(u.connected) == null ? 'reached: not known' : 'reached ' + u.connected + ' of ' + u.calls + ' numbers';
    L.push('THIS WEEK (' + mon + ' to ' + today + '): ' + (Number(u.calls) || 0) + ' calls, ' + (Number(u.portfolio) || 0) + ' portfolio, on ' + (Number(u.days) || 0) + ' day' + (Number(u.days) === 1 ? '' : 's') + '; portfolio talk time ' + mmss(u.duration) + '; ' + reached + '.');
  } else L.push('THIS WEEK (' + mon + ' to ' + today + '): no calls recorded for you yet.');
  L.push('Calls reach the system when your phone syncs, so a figure can be low until it has.');
  return L;
}

const READ = { calls: readCalls, standing: readStanding, week: readWeek, mine: readMine };
/** How long a reading is kept: the calls and last week's results five minutes; the dashboard two (the door keeps its own answer a minute); a person's own calls one, because they are asking how they are doing NOW. */
const TTL = { calls: DATA_TTL_MS, standing: DATA_TTL_MS, week: 2 * 60 * 1000, mine: 60 * 1000 };

/* ---------- the answer kept for five minutes, and the one in flight shared ---------- */
const kept = new Map();
export function resetClaudianDataForTests() { kept.clear(); portalRunning = 0; portalPeak = 0; portalWaiting.length = 0; }
/** One view for one set of teams: from the kept reading, or one being made, or a new one. `clock` only measures (how many seconds the reading took); it decides nothing. */
async function readOne(db, subject, id, nowMs, fmt, clock) {
  // a phone person's own calls need no teams (and are nobody else's: their reading is keyed by the person, never shared with a teammate)
  const teams = id === 'mine' ? null : await teamsOf(db, subject, nowMs);
  if (Array.isArray(teams) && !teams.length) return { lines: ['No teams are in this person\'s scope, so there is nothing to report.'], teams, ms: 0 };
  const key = id + '|' + todayKey(nowMs) + '|' + (id === 'mine' ? 'P:' + String(subject.key || subject.name || '') : scopeKey(teams)) + '|' + (id === 'standing' ? fmt.std.sales + '/' + fmt.std.col + '/' + fmt.std.rec : '');
  const c = kept.get(key);
  // A finished reading is kept for the view's own time (TTL); one still being made is shared (twelve people asking in the same minute are one read), unless it has outlived the host's own sixty seconds: that one is dead.
  if (c && nowMs - c.at < (c.done ? c.ttl : DATA_STUCK_MS)) return c.done ? c.p.then(v => ({ ...v, kept: true })) : c.p;
  const t0 = clock();
  const p = Promise.resolve().then(() => READ[id](db, teams, nowMs, fmt, subject)).then(lines => ({ lines, teams, ms: clock() - t0 }));
  const e = { at: nowMs, p, done: false, ttl: TTL[id] || DATA_TTL_MS };
  kept.set(key, e);
  // a reading that failed is not kept: the next question tries again (and a dead one replaced by a newer reading is not taken out from under it)
  p.then(() => { e.done = true; }, () => { if (kept.get(key) === e) kept.delete(key); });
  if (kept.size > 400) for (const [k, v] of kept) if (nowMs - v.at >= DATA_TTL_MS) kept.delete(k);
  return p;
}

const secs = ms => (Math.max(0, Number(ms) || 0) / 1000).toFixed(1) + 's';

/** Reads the views a question needs, all together, within the budget. `fmt` carries what a view needs from the helper's settings: { std, names }.
    Answers { lines, notes }: the lines for the model, and what the chat log keeps, with the SECONDS each report took, so that the owner reads how long a report really is on the live book:
      "calls by team 5.1s"              a report made for this question (or one already being made, joined)
      "calls by team 5.1s kept"         a report kept from an earlier question (its own seconds)
      "calls by team (late) 15.0s"      not there when the budget ran out (the reading goes on and is kept for the next question)
      "calls by team (failed) 1.2s"     could not be read.
    The "(late)" and "(failed)" words are the ones the Hope Ai tab and its report look for (they colour such a note red); the seconds come after them. `clock` is for tests. */
export async function readViews(db, subject, ids, nowMs, fmt, budgetMs = DATA_BUDGET_MS, clock = Date.now) {
  const lines = [], notes = [];
  const results = await Promise.all(ids.map(async id => {
    let t;
    const s0 = clock();
    const late = new Promise(resolve => { t = setTimeout(() => resolve({ late: true }), budgetMs); });
    const r = await Promise.race([readOne(db, subject, id, nowMs, fmt, clock).then(v => ({ v }), e => ({ failed: e })), late]).finally(() => clearTimeout(t));
    return { ...r, waited: clock() - s0 };
  }));
  ids.forEach((id, i) => {
    const r = results[i];
    if (r.v) { lines.push(...r.v.lines); notes.push(LABEL[id] + ' ' + secs(r.v.ms) + (r.v.kept ? ' kept' : '')); }
    else if (r.late) { lines.push(LABEL[id].toUpperCase() + ': the report did not answer in time (it may still be loading); say you cannot see these figures yet and that trying again in a minute may work.'); notes.push(LABEL[id] + ' (late) ' + secs(r.waited)); }
    else { lines.push(LABEL[id].toUpperCase() + ': the report could not be read now; say you cannot see these figures now.'); notes.push(LABEL[id] + ' (failed) ' + secs(r.waited)); }
  });
  return { lines, notes };
}
