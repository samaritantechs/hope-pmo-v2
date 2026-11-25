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
       minutes (the answer is kept, a read in flight is shared), under a budget of a few seconds: past it the model is
       told the report did not answer, and the person still gets an answer.
     - A failure is an answer, never an error: "could not be read now".

   TO ADD A VIEW: one object in VIEWS (its topic words, who may have it, how it is read) and one test. Not before the
   owner says which report: the next candidates are the Exp.Def recovery by leader and the dashboard's day figures.
   ===================================================================================== */
import { wordsOf, keyHit } from './claudian-cards.js';
import { todayKey, weekMondayKey, addDaysKey } from './time.js';
import { wholePct } from './recovery.js';
import { reportCoreForPortal, scopedUser, scopeFor } from './call-core.js';

/** The longest the helper waits for the reports before it answers without them, and how long a reading is kept. */
export const DATA_BUDGET_MS = 4000;
export const DATA_TTL_MS = 5 * 60 * 1000;
/** How much of a view reaches the model: the few lowest and highest, never the whole company. */
const SHOW_LOW = 8, SHOW_HIGH = 3, SHOW_ZERO = 16, SHOW_NAMES = 12, SHOW_ALL_UP_TO = 14;

const K = v => String(v == null ? '' : v).trim().toUpperCase();
/** A name as it is shown to the model: text only, one line, forty characters. A team or an officer's name is typed by a person. */
export const clean = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>`{}\[\]\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

/* ---------- which question wants which report ---------- */
/** Words that say a question is about calls, and about last week's results. A stem of four letters or more touches any word that holds it ("pigi" is in
    "hawapigi", "piga" in "nimepiga"); three letters or fewer are whole words. */
const TOPIC = {
  calls: ['simu', 'piga', 'pigia', 'pigi', 'pigo', 'pigiwa', 'call', 'calls', 'called', 'calling', 'dial', 'dials', 'portfolio', 'mazungumzo', 'wapigaji'],
  standing: ['makusanyo', 'kukusanya', 'collection', 'collected', 'urejeshaji', 'kurejesha', 'recovery', 'recovered', 'mauzo', 'sales', 'sold', 'asilimia', 'percent', 'malengo', 'lengo',
    'target', 'targets', 'utendaji', 'matokeo', 'performance', 'standing', 'behind', 'nyuma'],
};
/** Words that say the person wants teams or officers compared, counted or ranked, not a rule explained. */
const CUES = ['team', 'teams', 'timu', 'officer', 'officers', 'afisa', 'maafisa', 'nani', 'who', 'which', 'gani', 'ipi', 'wapi', 'least', 'most', 'lowest', 'highest', 'worst', 'best', 'bottom', 'top',
  'kidogo', 'chini', 'zaidi', 'juu', 'ngapi', 'many', 'hakuna', 'none', 'zero', 'sifuri', 'kabisa', 'wangu', 'yangu', 'zangu', 'wote', 'kila', 'each', 'everyone', 'ranking', 'compare', 'linganisha'];
const hit = (tokens, words) => words.some(w => keyHit(tokens, w));

/** The screens whose holders may be given each view (a portal person), and the phone's rule. The admin and a view-only code hold every screen. */
const CALLS_TABS = ['calls'], STANDING_TABS = ['weekly', 'dashboard', 'perf', 'reports'];
const tabsOk = (subject, tabs) => !!subject.allTabs || tabs.some(t => (subject.tabs || []).includes(t));
const mayHave = {
  calls: s => (s.source === 'call' ? !!s.leader : tabsOk(s, CALLS_TABS)),
  standing: s => (s.source === 'call' ? !!s.leader : tabsOk(s, STANDING_TABS)),
};

/** The views this question needs and this person may have, in a fixed order (at most two). Nothing unless a topic word AND a word of comparison are there. */
export function viewsFor(subject, question) {
  const tokens = wordsOf(question);
  if (!tokens.length || !subject || !hit(tokens, CUES)) return [];
  return ['calls', 'standing'].filter(id => hit(tokens, TOPIC[id]) && mayHave[id](subject));
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

const READ = { calls: readCalls, standing: readStanding };
const LABEL = { calls: 'calls by team', standing: 'last week by team' };

/* ---------- the answer kept for five minutes, and the one in flight shared ---------- */
const kept = new Map();
export function resetClaudianDataForTests() { kept.clear(); }
async function readOne(db, subject, id, nowMs, fmt) {
  const teams = await teamsOf(db, subject, nowMs);
  if (Array.isArray(teams) && !teams.length) return { lines: ['No teams are in this person\'s scope, so there is nothing to report.'], teams };
  const key = id + '|' + todayKey(nowMs) + '|' + scopeKey(teams) + '|' + (id === 'standing' ? fmt.std.sales + '/' + fmt.std.col + '/' + fmt.std.rec : '');
  const c = kept.get(key);
  if (c && nowMs - c.at < DATA_TTL_MS) return c.p;
  const p = Promise.resolve().then(() => READ[id](db, teams, nowMs, fmt)).then(lines => ({ lines, teams }));
  kept.set(key, { at: nowMs, p });
  // a reading that failed is not kept: the next question tries again
  p.catch(() => { if (kept.get(key) && kept.get(key).p === p) kept.delete(key); });
  if (kept.size > 400) for (const [k, v] of kept) if (nowMs - v.at >= DATA_TTL_MS) kept.delete(k);
  return p;
}

/** Reads the views a question needs, all together, within the budget. `fmt` carries what a view needs from the helper's settings: { std, names }.
    Answers { lines, notes }: the lines for the model, and what the chat log keeps ("data: calls by team"; "(late)" or "(failed)" when it did not come). */
export async function readViews(db, subject, ids, nowMs, fmt, budgetMs = DATA_BUDGET_MS) {
  const lines = [], notes = [];
  const results = await Promise.all(ids.map(id => {
    let t;
    const late = new Promise(resolve => { t = setTimeout(() => resolve({ late: true }), budgetMs); });
    return Promise.race([readOne(db, subject, id, nowMs, fmt).then(v => ({ v }), e => ({ failed: e })), late]).finally(() => clearTimeout(t));
  }));
  ids.forEach((id, i) => {
    const r = results[i];
    if (r.v) { lines.push(...r.v.lines); notes.push(LABEL[id]); }
    else if (r.late) { lines.push(LABEL[id].toUpperCase() + ': the report did not answer in time; say you cannot see these figures now.'); notes.push(LABEL[id] + ' (late)'); }
    else { lines.push(LABEL[id].toUpperCase() + ': the report could not be read now; say you cannot see these figures now.'); notes.push(LABEL[id] + ' (failed)'); }
  });
  return { lines, notes };
}
