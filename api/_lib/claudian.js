/* =====================================================================================
   CLAUDIAN-PMO -- the helper in the corner of HOPE PMO and HOPE Calls.

     "Please add an Ai floating bubble in both calls and system UI ... allow our system users to ask
      and get replied on anything while re- using my plan's token on the lowest Claude version so
      that not to drawn energy per questions requested, when limit reached we just give them through
      of working hard hints and advice to try ask later - were we set rules like, one can't update
      system or it's info from there, it's only there to help - determine user role so as to answer
      what they ask considering their responsibilities and privacy of the other depts data or
      company levels ... and all answers depend on the amount of teams / reports / data / navs the
      user is granted." ... "Name the Agent "Claudian-PMO" I baptist that with CLAUDE legacy within it"
      ... "Claudian-PMO must use short and clear answers not to drawn tokens, and must always
      emphasize portigolio calls and company targets to users who are behind. Remember we have it
      their on default lowest version and user can never switch to something like fable"
      ... "So CLAUDIAN-PMO should never behave like Ai ask if there is anything else someone needs
      to ask you know we protecting development tokens"       -- the owner, 25 Nov 2026 (handbook Part 155)

   WHAT IT IS, IN ONE PARAGRAPH. A person taps the bubble; if the agent is OFF in Settings they get
   a list of ready questions with their answers (claudian-faq.js: no model, no tokens); if it is ON
   they may also type a question, which goes to the cheapest Claude model there is, with the
   glossary at the front, a line about each screen THEY may open, the company's targets for each team and (when it
   is known) how their teams did last week, and comes back as two to four short sentences, with no
   closing offer and no question. Everything it says is logged for the owner's Hope Ai tab. It can
   change nothing: it has no tools, and nothing it writes is ever run.

   THE OWNER'S ORDERS, AS MECHANISM (a rule that rests on the model's good behaviour alone is a hope):
     * THE LOWEST MODEL, NEVER CHOSEN BY A USER -- CLAUDIAN_MODEL is a constant of this file. The
       request body is read for a question, a language and a thing to look at; no field of it can reach
       the model's name, its length, its temperature or its system text (test/claudian.test.mjs
       sends every such field and shows none moves).
     * SHORT, AND THEN STOP -- three layers, so that one failing is not the end of the rule: the
       instruction to the model; MAX_OUTPUT_TOKENS, a ceiling it cannot talk past; and cleanReply,
       which cuts a closing offer or question out of what came back whatever the model wrote.
       "hi", "thanks" and "asante" are answered here with a word and NO model call.
     * ONLY WHAT THE PERSON MAY SEE -- the person's screens (and for the phone app, their lists) are
       the only screens the model is told exist; it is never given a customer, a loan, a phone
       number, a staff record or another team's figure. Numbers of seven digits or more in a question
       are replaced before the model sees them AND before they are logged (maskNumbers): a loan
       number or a phone typed into a question never reaches Anthropic or the owner's tab.
     * READ-ONLY -- no tools are offered, no output is parsed into an action.
     * USERS WHO ARE BEHIND ARE TOLD, EVERY TIME -- `standing` reads how the person's teams did LAST
       FULL WEEK against the company's targets (a complete week, so a Monday morning is never
       "behind" for having had one day); a team short of any of the three it measures (sales %,
       collection %, recovery %: the weekly record keeps no more) is BEHIND, and the model is told
       to finish every answer to such a person with one sentence on portfolio calls and the targets.
       The owner's other targets (customers and amount sold a day, early collection, the recovery
       amount, calls a day) are quoted, never judged. Unknown standing is said to the model as
       unknown, never guessed (handbook Part 157).
     * LIMITS THAT SPEAK -- a person's questions a day (CLAUDIAN_USER_DAILY), everybody's (CLAUDIAN_ALL_DAILY),
       a gap of two seconds between questions, eight questions in flight at once, a request that is
       given 25 seconds; and whenever the provider says "too many", "credit", "overloaded" or does
       not answer, the person is given a "working hard, try later" line with advice that is useful
       meanwhile (call your lists, look at the targets), never an error.

   CLAUDIAN IS ITS OWN FUNCTION (api/claudian.js). It adds nothing to /api/upload or /api/call
   (CLAUDE.md section 1: those two never go down and never slow down), reads nothing of the call
   tables, and a slow answer from the provider holds only its own request.

   WITHOUT THE MIGRATION OR THE KEY IT STILL WORKS, SMALLER: no table (db/RUN-ME-090) = nothing is
   logged and the limits are held in the server's memory; no ANTHROPIC_API_KEY, or the switch OFF,
   or the SDK not installed = the FAQ list. Never a failed screen. The key is an environment
   variable of the host, read by the SDK from the environment: it is never in the repository, a
   settings row, a table or a chat.
   ===================================================================================== */
import crypto from 'node:crypto';
import { zoneAnswer, ZONE_ROLE_COLS } from './zone.js';
import { todayKey, weekMondayKey, addDaysKey } from './time.js';
import { registrySpellings } from './snapshots.js';
import { wholePct } from './recovery.js';
import { SYSTEM_PROMPT, CTX, TAB_NOTES, CALL_NOTES, TARGETS_DEFAULT, SALES_TARGET_DEFAULT, tabWords } from './claudian-knowledge.js';
import { faqChoices, faqAnswer, faqLabel } from './claudian-faq.js';
import { faqMatch } from './claudian-match.js';
import { pickCards, tabKeyScore } from './claudian-cards.js';
import { viewsFor, readViews, resetClaudianDataForTests } from './claudian-data.js';

const K = s => String(s == null ? '' : s).trim().toUpperCase();

export const CLAUDIAN_NAME = 'Claudian-PMO';
/** THE MODEL: the lowest Claude there is (Claude Haiku 5.5), fixed HERE. Nothing a user sends can change it. */
export const CLAUDIAN_MODEL = 'claude-haiku-5-5';
export const SETTING_AI = 'CLAUDIAN_AI';
export const SETTING_USER_DAILY = 'CLAUDIAN_USER_DAILY';
export const SETTING_ALL_DAILY = 'CLAUDIAN_ALL_DAILY';
/** A row that switches the helper's READING OF REPORTS off (handbook Part 160): OFF, NO, FALSE or 0. Absent or anything else, it reads them. */
export const SETTING_DATA = 'CLAUDIAN_DATA';
export const DEFAULT_USER_DAILY = 20;
export const DEFAULT_ALL_DAILY = 2000;
export const MAX_QUESTION_CHARS = 400;
export const MAX_ANSWER_CHARS = 900;
export const MAX_OUTPUT_TOKENS = 300;
export const MAX_HISTORY_CHARS = 240;
export const MAX_NOTES = 8;
export const MIN_GAP_MS = 2000;
export const MAX_INFLIGHT = 8;
export const REQUEST_TIMEOUT_MS = 25000;
export const STANDING_BUDGET_MS = 1500;
const CFG_TTL_MS = 20000, ROWS_TTL_MS = 60000, STANDING_TTL_MS = 600000;

/** The Settings rows that hold THE COMPANY'S TARGETS (handbook Part 157). The first three are the percentage targets every table already colours
    itself by (PCT_TARGET_KEYS in portal-core.js; a test holds the two lists equal, since this file may not import the portal's core); the four
    others are the owner's own numbers (TARGETS_DEFAULT in claudian-knowledge.js) and are read by nothing else. */
export const TARGET_PCT_KEYS = { ecol: 'TARGET_EARLY_COL_PCT', col: 'TARGET_COL_PCT', rec: 'TARGET_REC_PCT' };
export const TARGET_COUNT_KEYS = { salesCustomers: 'TARGET_SALES_CUSTOMERS_DAILY', salesAmount: 'TARGET_SALES_AMOUNT_DAILY', recAmount: 'TARGET_REC_AMOUNT', callsDay: 'TARGET_CALLS_DAILY' };
const SETTING_KEYS = [SETTING_AI, SETTING_USER_DAILY, SETTING_ALL_DAILY, SETTING_DATA, 'CALL_MIN_SECS', 'SALES_TARGET_WEEKLY', 'SALES_TARGET',
  ...Object.values(TARGET_PCT_KEYS), ...Object.values(TARGET_COUNT_KEYS), 'RECOVERY_TARGET_MONTHLY', 'ADVANCE_AMOUNTS'];
export const ADVANCE_AMOUNTS_DEFAULT = '50,000, 100,000, 150,000, 200,000';

const langOf = l => (String(l || '').toLowerCase().startsWith('en') ? 'en' : 'sw');
const digitsInt = (v, dflt, lo, hi) => {
  const n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10);
  return (isNaN(n) || n < lo) ? dflt : Math.min(hi, n);
};
/** A percentage target as the Settings screen's own reader takes it (pctTargets in portal-core.js): "90", "90%", " 90 " and "90.5" are numbers,
    blank or words are not and the owner's number stands. */
const pctTarget = (v, dflt) => {
  const raw = String(v == null ? '' : v).replace(/[%\s,]/g, '');
  const n = raw === '' ? NaN : Number(raw);
  return isFinite(n) && n > 0 && n <= 1000 ? n : dflt;
};
const money = n => Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const hash = s => crypto.createHash('sha256').update(String(s == null ? '' : s)).digest('hex').slice(0, 16);

/* ---------- the words that are fixed ---------- */
const FIXED = {
  offTopic: { sw: 'Naweza kusaidia mambo ya HOPE PMO tu.', en: 'I can only help with HOPE PMO matters.' },
  refused: { sw: 'Siwezi kujibu swali hilo.', en: 'I cannot answer that.' },
  empty: { sw: 'Andika swali.', en: 'Type a question.' },
  /** A typed question with the AI off that touches no ready answer: said plainly, with the way out (the ready questions, or other words). */
  noMatch: { sw: 'Sijapata jibu la swali hilo kati ya maswali ya kawaida. Chagua moja hapa chini, au liandike kwa maneno mengine.', en: 'No ready answer fits that question. Pick one below, or type it in other words.' },
  slow: { sw: 'Subiri sekunde chache kabla ya swali lingine.', en: 'Wait a few seconds before the next question.' },
};
/** "Working hard, try later": what a person is told when the helper cannot answer, with advice that is worth following meanwhile. Three
    wordings so that it does not read as a machine; chosen by the minute, never at random (a test can name the one it gets). */
const HARD = {
  sw: [
    'Claudian-PMO ana kazi nyingi sasa hivi. Jaribu tena baadaye kidogo. Wakati huo piga simu za portfolio kwa wateja wa orodha yako ya leo.',
    'Claudian-PMO amefikia kikomo chake cha sasa. Jaribu tena baadaye. Wakati huo angalia malengo ya kampuni kwenye Dashibodi na piga wateja wa orodha yako.',
    'Claudian-PMO anapumzika kidogo. Jaribu tena baadaye. Wakati huo fuatilia ahadi za kulipa za leo na piga simu za portfolio.',
  ],
  en: [
    'Claudian-PMO is working hard right now. Try again a little later. Meanwhile, make your portfolio calls to today\'s customers.',
    'Claudian-PMO has reached its limit for now. Try again later. Meanwhile, check the company targets on the Dashboard and call the customers on your list.',
    'Claudian-PMO is taking a short rest. Try again later. Meanwhile, follow up today\'s promises to pay and make your portfolio calls.',
  ],
};
export const hardHint = (lang, nowMs) => HARD[langOf(lang)][Math.floor((nowMs || Date.now()) / 60000) % 3];

/* ---------- what is not said to the model, or logged ---------- */
/** Seven digits or more in a row, and phone numbers written with spaces, dots or dashes, become "[namba]": loan numbers, REFs, phones, NIDA
    and account numbers never reach the provider or the log. A date such as 2026-11-25 is not a phone number and is left. */
export function maskNumbers(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/(?<!\d)\+?\d[\d ().-]{7,}\d(?!\d)/g, m => (/\d{4}-\d{1,2}-\d{1,2}/.test(m) || m.replace(/\D/g, '').length < 9 ? m : '[namba]'));
  return t.replace(/\d{7,}/g, '[namba]');
}
const squeeze = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
/** A question as it is used and logged: text, blanks run together, numbers masked, at most MAX_QUESTION_CHARS. */
export function cleanQuestion(q) { return maskNumbers(squeeze(typeof q === 'string' ? q : '')).slice(0, MAX_QUESTION_CHARS); }

/* ---------- small talk: a word back, no model ---------- */
const GREET = /^(hi|hello|hey|habari|hujambo|mambo|vipi|niaje|poa|salaam|shikamoo|marahaba|good (morning|afternoon|evening)|asubuhi njema|habari za (asubuhi|mchana|jioni)|mambo vipi)$/i;
const THANKS = /^(thanks?|thank you|thanks a lot|thank you very much|asante|asante sana|shukrani|nashukuru|sawa|sawa sawa|ok|okay|poa sana|nimeelewa|nimepata)$/i;
const BYE = /^(bye|goodbye|kwaheri|baadaye|tutaonana|good night|usiku mwema)$/i;
/** A message that is only a greeting, thanks or goodbye: answered with one word and NO model call. null for anything else. */
export function smallTalk(q, lang) {
  const t = squeeze(q).replace(/[!.?,;:)(]+$/g, '').replace(/^[!.?,;:)(]+/g, '').trim();
  if (!t || t.length > 40) return null;
  const sw = langOf(lang) === 'sw';
  if (THANKS.test(t)) return sw ? 'Karibu.' : 'You are welcome.';
  if (GREET.test(t)) return sw ? 'Habari.' : 'Hello.';
  if (BYE.test(t)) return sw ? 'Kwaheri.' : 'Goodbye.';
  return null;
}

/* ---------- what comes back: short, then stop ---------- */
const OFFER = new RegExp([
  '\\?\\s*$',
  '\\b(anything else|let me know|feel free|hope (this|that) helps|happy to help|glad to help|would you like|do you want|do you need|if you (need|have|want|would|like)|need (any )?(more|further|anything)|ask (me )?(again|more|another)|don\'?t hesitate|is there anything|can i help|i am here|i\'m here|just ask)\\b',
  '(naweza kukusaidia|ninaweza kukusaidia|unahitaji (kingine|msaada|zaidi)|ungependa|ungetaka|kama una (swali|maswali|hitaji|shida)|kama unahitaji|uliza tena|usisite|nijulishe|niambie|karibu tena|kuna kingine|nipo hapa|niko hapa|ni furaha yangu)',
].join('|'), 'i');
const OPENER = /^(habari|hujambo|hello|hi|hey|karibu|sure|certainly|of course|bila shaka|sawa)\s*[,!]\s*/i;
/** What the model wrote, as plain short text: no greeting, no mark-up, and NO closing offer or question (the owner's order: it answers and
    stops). Only trailing sentences are cut, and the first sentence is always kept. */
export function cleanReply(text) {
  let t = String(text == null ? '' : text).replace(/\r/g, '').trim();
  t = t.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/__(.+?)__/gs, '$1').replace(/`+/g, '').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[*-]\s+/gm, '\u2022 ');
  t = t.replace(OPENER, '').replace(/\n{3,}/g, '\n\n').trim();
  if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
  // the sentences, from the end: a closing offer or question is dropped, the first sentence is always kept
  const parts = t.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
  while (parts.length > 1 && OFFER.test(parts[parts.length - 1])) parts.pop();
  const lastKept = parts[parts.length - 1] || '';
  const at = lastKept ? t.lastIndexOf(lastKept) : -1;
  let out = (at >= 0 ? t.slice(0, at + lastKept.length) : t).trim();
  if (out.length > MAX_ANSWER_CHARS) {
    const cut = out.slice(0, MAX_ANSWER_CHARS);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('\n'));
    out = (end > 120 ? cut.slice(0, end + 1) : cut).trim();
  }
  return out;
}

/* ---------- who is asking ---------- */
/** A person signed in to the portal. `key` is a one-way fingerprint of the access code (the code is a password: never logged, never stored). */
export function portalSubject(user) {
  const all = K(user.role) === 'ADMIN' || !!user.readOnly;
  return { source: 'portal', key: 'p:' + hash(user.code), name: user.name || '', role: user.role || '', teams: user.teams && user.teams.length ? user.teams : null,
    tabs: (user.tabs || []).map(String), allTabs: all, leader: false, readOnly: !!user.readOnly };
}
/** A registered handset (HOPE Calls): `cu` is its call_users row, `pseudo` the scope call-core works out for it. */
export function callSubject(cu, pseudo, device) {
  return { source: 'call', key: 'c:' + hash(device), name: (cu && cu.name) || '', role: (cu && cu.role) || '', teams: pseudo && pseudo.teams && pseudo.teams.length ? pseudo.teams : null,
    tabs: [], allTabs: false, leader: !!(cu && cu.is_leader), readOnly: false,
    // the call_users row: what the data views need to read a leader's teams as the code reads NOW (never logged: baseRow picks its own fields)
    cu: cu || null };
}

/* ---------- the settings it reads (one small read, kept twenty seconds; a write drops it) ---------- */
const cfgCache = new WeakMap();
export function noteClaudianSettingsWritten(db) { cfgCache.delete(db); }
export async function loadCfg(db, nowMs = Date.now()) {
  const hit = cfgCache.get(db);
  if (hit && nowMs - hit.at < CFG_TTL_MS) return hit.cfg;
  let rows = [];
  try { const { data } = await db.from('settings').select('key, value').in('key', SETTING_KEYS); rows = data || []; } catch (e) { rows = []; }
  const by = {};
  for (const r of rows) by[String(r.key)] = r.value;
  const target = digitsInt(by.SALES_TARGET_WEEKLY, digitsInt(by.SALES_TARGET, SALES_TARGET_DEFAULT, 1, 1e13), 1, 1e13);
  const T = TARGETS_DEFAULT;
  const targets = {
    salesPct: T.salesPct,
    salesCustomers: digitsInt(by[TARGET_COUNT_KEYS.salesCustomers], T.salesCustomers, 1, 1000000),
    salesAmount: digitsInt(by[TARGET_COUNT_KEYS.salesAmount], T.salesAmount, 1, 1e13),
    ecolPct: pctTarget(by[TARGET_PCT_KEYS.ecol], T.ecolPct),
    colPct: pctTarget(by[TARGET_PCT_KEYS.col], T.colPct),
    recPct: pctTarget(by[TARGET_PCT_KEYS.rec], T.recPct),
    recAmount: digitsInt(by[TARGET_COUNT_KEYS.recAmount], T.recAmount, 1, 1e13),
    callsDay: digitsInt(by[TARGET_COUNT_KEYS.callsDay], T.callsDay, 1, 1000000),
  };
  // What "behind" is measured against: the three figures the weekly record keeps (sales % of the weekly target, collection %, recovery %).
  const std = { sales: targets.salesPct, col: targets.colPct, rec: targets.recPct };
  const minSecs = digitsInt(by.CALL_MIN_SECS, 5, 0, 2000000000);
  const cfg = {
    on: /^(ON|YES|TRUE|1)$/i.test(String(by[SETTING_AI] == null ? '' : by[SETTING_AI]).trim()),
    data: !/^(OFF|NO|FALSE|0)$/i.test(String(by[SETTING_DATA] == null ? '' : by[SETTING_DATA]).trim()),
    userDaily: digitsInt(by[SETTING_USER_DAILY], DEFAULT_USER_DAILY, 1, 10000),
    allDaily: digitsInt(by[SETTING_ALL_DAILY], DEFAULT_ALL_DAILY, 1, 1000000),
    targets, std, target, minSecs, recTarget: digitsInt(by.RECOVERY_TARGET_MONTHLY, 0, 0, 1e13),
    vars: { minSecs: String(minSecs), salesCust: String(targets.salesCustomers), salesAmt: money(targets.salesAmount), ecolPct: String(targets.ecolPct),
      colPct: String(targets.colPct), recPct: String(targets.recPct), recAmt: money(targets.recAmount), callsDay: String(targets.callsDay),
      advAmounts: String(by.ADVANCE_AMOUNTS == null || !String(by.ADVANCE_AMOUNTS).trim() ? ADVANCE_AMOUNTS_DEFAULT : by.ADVANCE_AMOUNTS).trim() },
  };
  cfgCache.set(db, { at: nowMs, cfg });
  return cfg;
}
/** Whether a key is in this host's environment. The key itself is never read here, only its presence. */
export const keyPresent = () => !!String(process.env.ANTHROPIC_API_KEY || '').trim();

/* ---------- the teams table, for the zone beside a person and the names their weekly figures are filed under ---------- */
const rowsCache = new WeakMap();
async function teamRowsOf(db, nowMs) {
  const hit = rowsCache.get(db);
  if (hit && nowMs - hit.at < ROWS_TTL_MS) return hit.rows;
  let rows = [];
  try { const { data } = await db.from('teams').select(['team', 'zone'].concat(ZONE_ROLE_COLS).join(', ')); rows = data || []; } catch (e) { rows = []; }
  rowsCache.set(db, { at: nowMs, rows });
  return rows;
}
/** A promise that gives up after `ms` (rejecting with status 0), with its timer always cleared: nothing is left pending after the answer. */
function raceTimeout(p, ms) {
  let t;
  const late = new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error('timeout'), { status: 0 })), ms); });
  return Promise.race([Promise.resolve(p), late]).finally(() => clearTimeout(t));
}
const withBudget = (p, ms) => new Promise(resolve => {
  const t = setTimeout(() => resolve(null), ms);
  Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
});

/** How the person's teams did in the LAST FULL WEEK against the company's targets, from the performance record the weekly report keeps
    (api/_lib/performance.js). null when it is not known (an all-teams person, no record, no table, too slow): never guessed. A complete week,
    so that a Monday morning is not "behind" for having had one working day. */
const standingCache = new Map();
export async function standingOf(db, subject, cfg, nowMs = Date.now(), teamRows = null) {
  const teams = subject.teams;
  if (!teams || !teams.length || teams.length > 40) return null;
  const week = addDaysKey(weekMondayKey(nowMs), -7);
  const rows0 = teamRows || await teamRowsOf(db, nowMs);
  const names = registrySpellings(teams, rows0);
  const memoKey = week + '|' + names.map(K).sort().join(',') + '|' + cfg.std.sales + '|' + cfg.std.col + '|' + cfg.std.rec;
  const hit = standingCache.get(memoKey);
  if (hit && nowMs - hit.at < STANDING_TTL_MS) return hit.v;
  const got = await withBudget((async () => {
    const { data, error } = await db.from('performance_records').select('metric, name, value, basis')
      .eq('period', 'week').eq('period_start', week).eq('scope', 'team').in('name', names);
    return error ? null : (data || []);
  })(), STANDING_BUDGET_MS);
  let v = null;
  if (got && got.length) {
    const sum = {};
    for (const r of got) {
      const m = String(r.metric);
      const s = sum[m] || (sum[m] = { value: 0, basis: 0 });
      s.value += Number(r.value) || 0; s.basis += Number(r.basis) || 0;
    }
    // the whole percentage the way every board shows it (half and above rounds up: wholePct, api/_lib/recovery.js)
    const pct = m => (sum[m] && sum[m].basis > 0 ? wholePct((sum[m].value / sum[m].basis) * 100) : null);
    const have = { sales: pct('sales'), col: pct('collection'), rec: pct('recovery') };
    const std = cfg.std;
    const short = ['sales', 'col', 'rec'].filter(k => have[k] != null && have[k] < std[k]);
    if (have.sales != null || have.col != null || have.rec != null) v = { week, have, std: { ...std }, short, behind: short.length > 0 };
  }
  if (standingCache.size > 500) standingCache.clear();
  standingCache.set(memoKey, { at: nowMs, v });
  return v;
}

/* ---------- the request to the model ---------- */
export { SYSTEM_PROMPT };


/** The scoring of a question against a screen's words (a screen the question talks about is the one whose note is sent). */
function noteScore(q, id) {
  const qs = new Set((String(q).toLowerCase().match(/[a-z]{4,}/g) || []));
  let s = 0;
  if (qs.size) for (const w of tabWords(id)) if (qs.has(w)) s++;
  // the words staff use for the screen, in Swahili and English (claudian-cards-data.js): a question in Swahili finds the note too
  return s + tabKeyScore(q, id);
}
/** The screens this person may open: labels, and the notes of the few the question is about. Admin holds every screen. */
export function screensOf(subject, question) {
  const ids = Object.keys(TAB_NOTES).filter(id => subject.allTabs || (subject.tabs || []).includes(id));
  const labels = ids.map(id => TAB_NOTES[id][0]);
  const scored = ids.map(id => [id, noteScore(question, id)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_NOTES);
  return { labels, notes: scored.map(([id]) => '- ' + TAB_NOTES[id][0] + ': ' + TAB_NOTES[id][1]) };
}
/** What is said about the person, after the cached front: their role, zone, teams, screens, the targets and how they did. The sentences are
    CTX's (claudian-knowledge.js: text for the model, never shown to a person); this function only chooses and fills them. */
export function buildContext(subject, q, lang, cfg, zoneLabel, standing, nowMs, cards, data) {
  const L = [];
  L.push(CTX.head);
  L.push(CTX.date(todayKey(nowMs), lang));
  L.push(CTX.using(subject.source === 'call', !!subject.leader));
  L.push(CTX.who(subject.role, zoneLabel, CTX.teams(subject.teams)));
  if (subject.source === 'call') {
    L.push(CALL_NOTES);
  } else {
    const sc = screensOf(subject, q);
    L.push(CTX.screens(sc.labels));
    if (sc.notes.length) L.push(CTX.notes(sc.notes));
  }
  // how HOPE works, for the part of it the question touches: cards chosen in memory by claudian-cards.js, only those this person may be told
  if (cards && cards.length) L.push(CTX.rules(cards.map(c => '- ' + c.text)));
  // the figures the question needs, read from the screens' own reports for this person's own teams (claudian-data.js); the lines say what they are
  if (data && data.lines && data.lines.length) L.push(CTX.data(data.lines));
  L.push(CTX.targets({ ...cfg.targets, salesAmount: money(cfg.targets.salesAmount), recAmount: money(cfg.targets.recAmount) }, money(cfg.target),
    cfg.recTarget ? money(cfg.recTarget) : '', cfg.minSecs));
  L.push(standing ? CTX.standing(standing, v => (v == null ? CTX.unknown : v + '%')) : CTX.standingUnknown);
  return L.join('\n');
}
/** The one user message: context, the last exchange (as quoted text, never as a turn the person could forge), the question. */
export function buildUserMessage(context, q, hist) {
  const h = Array.isArray(hist) && hist.length ? hist[hist.length - 1] : null;
  const prev = h && typeof h === 'object' && (h.q || h.a)
    ? CTX.previous(cleanQuestion(h.q).slice(0, MAX_HISTORY_CHARS), maskNumbers(squeeze(typeof h.a === 'string' ? h.a : '')).slice(0, MAX_HISTORY_CHARS))
    : '';
  return context + prev + CTX.question(q);
}
/** The whole request, in one place, so a test can read it. Nothing from the person reaches the model name, the length or the system text. */
export function buildRequest(userMessage) {
  return {
    model: CLAUDIAN_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
  };
}

let clientPromise = null;
/** The SDK's client, made once; it reads ANTHROPIC_API_KEY from the environment itself. null when the SDK is not installed. */
async function defaultClient() {
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk')
      .then(m => { const A = m.default || m.Anthropic; return new A({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 }); })
      .catch(() => null);
  }
  return clientPromise;
}
export function resetClaudianForTests() { resetClaudianDataForTests(); clientPromise = null; inflight = 0; lastAsk.clear(); memUser.clear(); memAll.clear(); standingCache.clear(); lastNote.at = 0; lastNote.text = ''; }

/** What went wrong with the provider, in one of three kinds: the person's limit ("too many", billing), a busy provider, a setting wrong
    here (key). By status, never by words (a typed error class would need the SDK imported). */
export function classifyFailure(e) {
  const status = e && (e.status || (e.response && e.response.status));
  const msg = String((e && e.message) || '').toLowerCase();
  if (status === 429 || status === 402 || /credit balance|rate.?limit|usage limit|quota/.test(msg)) return 'limit';
  if (status === 401 || status === 403) return 'key';
  return 'busy';
}

/* ---------- the counts that limit a person, and the log ---------- */
let inflight = 0;
const lastAsk = new Map();           // user key -> ms of the last question
const memUser = new Map();           // day|user key -> questions answered by the model today (this server)
const memAll = new Map();            // day -> the same, for everybody
const countMissingUntil = new WeakMap();
const allCache = new WeakMap();
const tableMissing = e => /claudian_chats|does not exist|schema cache|relation/i.test(String((e && e.message) || e || ''));
async function countRows(db, day, key) {
  const miss = countMissingUntil.get(db);
  if (miss && Date.now() < miss) return null;
  try {
    let q = db.from('claudian_chats').select('id', { count: 'exact', head: true }).eq('day', day).eq('mode', 'ai');
    if (key) q = q.eq('user_key', key);
    const r = await q;
    if (r.error) { if (tableMissing(r.error)) countMissingUntil.set(db, Date.now() + 60000); return null; }
    return typeof r.count === 'number' ? r.count : null;
  } catch (e) { if (tableMissing(e)) countMissingUntil.set(db, Date.now() + 60000); return null; }
}
/** Questions the model has answered for this person today, and for everybody: the larger of the database's count and this server's own. */
export async function usageToday(db, subject, nowMs) {
  const day = todayKey(nowMs);
  const mine = Math.max((await countRows(db, day, subject.key)) || 0, memUser.get(day + '|' + subject.key) || 0);
  let all = allCache.get(db);
  if (!all || all.day !== day || nowMs - all.at > 60000) { all = { day, at: nowMs, n: (await countRows(db, day, null)) || 0 }; allCache.set(db, all); }
  return { mine, all: Math.max(all.n, memAll.get(day) || 0) };
}
function bump(subject, nowMs) {
  const day = todayKey(nowMs);
  memUser.set(day + '|' + subject.key, (memUser.get(day + '|' + subject.key) || 0) + 1);
  memAll.set(day, (memAll.get(day) || 0) + 1);
  if (memUser.size > 5000) memUser.clear();
}
const zoneText = (subject, rows) => {
  try { const a = zoneAnswer({ name: subject.name, teams: subject.teams }, rows); return a.zone || (a.zoneAll ? 'ALL ZONES' : a.zoneUnset ? 'NO ZONE SET' : ''); } catch (e) { return ''; }
};
const logMissingUntil = new WeakMap();
export const lastNote = { at: 0, text: '' };
/** One row of the Hope Ai tab. Never throws: a log that fails must not fail an answer. */
export async function logChat(db, row) {
  const miss = logMissingUntil.get(db);
  if (miss && Date.now() < miss) return false;
  try {
    const { error } = await db.from('claudian_chats').insert(row);
    if (error) { if (tableMissing(error)) logMissingUntil.set(db, Date.now() + 60000); return false; }
    return true;
  } catch (e) { if (tableMissing(e)) logMissingUntil.set(db, Date.now() + 60000); return false; }
}
const teamsText = teams => (!teams ? 'ALL' : teams.length <= 12 ? teams.join(', ') : teams.slice(0, 12).join(', ') + ' +' + (teams.length - 12)).slice(0, 240);
function baseRow(subject, zone, lang, nowMs) {
  return { day: todayKey(nowMs), source: subject.source, user_key: subject.key, user_name: String(subject.name || '').slice(0, 80), role: String(subject.role || '').slice(0, 60),
    teams: teamsText(subject.teams), zone: String(zone || '').slice(0, 80), lang, thread: subject.key + ':' + todayKey(nowMs) };
}

/* ---------- the one entry point ---------- */
/** What a person asks, and what they get back. `body`: { op: 'status' | 'faq' | 'ask', q, id, lang, hist }. Every answer is { ok-shaped }, never an
    error to the person: a limit, a busy provider and a missing key all come back as words. `deps` is for tests: { client, nowMs }. */
export async function claudianHandle(db, subject, body, deps = {}) {
  const nowMs = deps.nowMs || Date.now();
  const b = body && typeof body === 'object' ? body : {};
  const lang = langOf(b.lang);
  const op = b.op === 'ask' || b.op === 'faq' ? b.op : 'status';
  const cfg = await loadCfg(db, nowMs);
  const aiOn = cfg.on && (!!deps.client || keyPresent());
  const base = { name: CLAUDIAN_NAME, lang, ai: aiOn };
  const choices = () => faqChoices(subject, lang);

  if (op === 'status') {
    let left = null;
    if (aiOn) { const u = await usageToday(db, subject, nowMs); left = Math.max(0, cfg.userDaily - u.mine); }
    return { ...base, mode: aiOn ? 'ai' : 'faq', faq: choices(), left, limit: aiOn ? cfg.userDaily : null };
  }

  if (op === 'faq') {
    const a = faqAnswer(String(b.id || ''), subject, lang, cfg.vars);
    if (!a) return { ...base, mode: 'faq', answer: FIXED.refused[lang], faq: choices() };
    const zone = zoneText(subject, await teamRowsOf(db, nowMs));
    await logChat(db, { ...baseRow(subject, zone, lang, nowMs), mode: 'faq', faq_id: a.id, question: a.q.slice(0, MAX_QUESTION_CHARS), answer: null });
    return { ...base, mode: 'faq', id: a.id, q: a.q, answer: a.a };
  }

  // ---- op === 'ask' ----
  const q = cleanQuestion(b.q);
  if (!q) return { ...base, mode: 'faq', answer: FIXED.empty[lang], faq: choices() };
  const rows = await teamRowsOf(db, nowMs);
  const zone = zoneText(subject, rows);
  const row = baseRow(subject, zone, lang, nowMs);

  const talk = smallTalk(q, lang);
  if (talk) {
    await logChat(db, { ...row, mode: 'canned', question: q, answer: talk, tokens_in: 0, tokens_out: 0 });
    return { ...base, mode: 'canned', answer: talk };
  }
  if (!aiOn) {
    // The typing box is there for everybody (Part 163). With no model to answer it, the question is matched, in memory, to the ready answers THIS person may be
    // offered: nothing is read, nothing is spent, and a person is never answered from a screen they do not hold.
    const why = cfg.on ? 'no key or sdk' : 'agent off';
    const m = faqMatch(subject, q);
    const near = m.near.map(n => ({ id: n.id, q: faqLabel(n.id, lang) })).filter(n => n.q);
    const nearNote = m.near.length ? ' \u00b7 near: ' + m.near.map(n => n.id).join(', ') : '';
    const a = m.best ? faqAnswer(m.best.id, subject, lang, cfg.vars) : null;
    if (a) {
      await logChat(db, { ...row, mode: 'match', faq_id: a.id, question: q, answer: a.a.slice(0, 1200), tokens_in: 0, tokens_out: 0, note: why + ' \u00b7 score ' + m.best.score + nearNote });
      return { ...base, mode: 'match', id: a.id, q: a.q, answer: a.a, near };
    }
    await logChat(db, { ...row, mode: 'nomatch', question: q, answer: null, tokens_in: 0, tokens_out: 0, note: why + (m.tie ? ' \u00b7 tie' : '') + nearNote });
    return { ...base, mode: 'nomatch', answer: FIXED.noMatch[lang], near };
  }

  // the person's own pace, then the day's limits
  const last = lastAsk.get(subject.key) || 0;
  if (nowMs - last < MIN_GAP_MS && !deps.noGap) return { ...base, mode: 'busy', answer: FIXED.slow[lang] };
  const used = await usageToday(db, subject, nowMs);
  if (used.mine >= cfg.userDaily || used.all >= cfg.allDaily) {
    const why = used.mine >= cfg.userDaily ? 'person limit' : 'company limit';
    await logChat(db, { ...row, mode: 'limit', question: q, answer: null, note: why });
    return { ...base, mode: 'limit', answer: hardHint(lang, nowMs), left: 0 };
  }
  // A PLACE IN LINE IS TAKEN HERE, where the line is counted, and given back on every way out: nine people asking at once cannot all be let through
  // because none of them had yet got as far as the model.
  if (inflight >= MAX_INFLIGHT) return { ...base, mode: 'busy', answer: hardHint(lang, nowMs) };
  inflight++;
  try {
    const standing = await standingOf(db, subject, cfg, nowMs, rows);
    const cards = pickCards(subject, q);
    // A question that needs figures ("which team has not called today?") has the reports read, for the teams this person holds and only if the screen is theirs.
    let data = null;
    const wanted = cfg.data ? viewsFor(subject, q) : [];
    if (wanted.length) {
      try { data = await readViews(db, subject, wanted, nowMs, { std: cfg.std, names: ts => registrySpellings(ts, rows) }); } catch (e) { data = null; }
    }
    const req = buildRequest(buildUserMessage(buildContext(subject, q, lang, cfg, zone, standing, nowMs, cards, data), q, b.hist));
    lastAsk.set(subject.key, nowMs);
    if (lastAsk.size > 5000) lastAsk.clear();
    const t0 = Date.now();
    let res = null, fail = null;
    try {
      const client = deps.client || await defaultClient();
      if (!client) throw Object.assign(new Error('SDK not installed'), { status: 0 });
      res = await raceTimeout(client.messages.create(req), REQUEST_TIMEOUT_MS + 2000);
    } catch (e) { fail = e; }
    const ms = Date.now() - t0;

    if (fail) {
      const kind = classifyFailure(fail);
      lastNote.at = nowMs; lastNote.text = kind === 'key' ? 'the provider refused the key' : kind === 'limit' ? 'the provider said limit or credit' : 'the provider did not answer';
      // A request the provider calls malformed (400) is OUR fault and the one thing nobody can see from a person's screen: its own words go in the note
      // (the provider's message is about the request, never a key or a person), so that the owner reads what to put right.
      const why = fail.status === 400 && fail.message && kind !== 'limit' ? ': ' + String(fail.message).replace(/\s+/g, ' ').slice(0, 160) : '';
      await logChat(db, { ...row, mode: kind === 'limit' ? 'limit' : 'busy', question: q, answer: null, ms, note: lastNote.text + (fail.status ? ' (' + fail.status + ')' : '') + why });
      return { ...base, mode: kind === 'limit' ? 'limit' : 'busy', answer: hardHint(lang, nowMs) };
    }
    const u = (res && res.usage) || {};
    const text = res && Array.isArray(res.content) ? res.content.filter(c => c && c.type === 'text').map(c => c.text).join('\n') : '';
    let answer = res && res.stop_reason === 'refusal' ? FIXED.refused[lang] : cleanReply(text);
    if (!answer) answer = FIXED.refused[lang];
    bump(subject, nowMs);
    const allc = allCache.get(db); if (allc) allc.n++;
    await logChat(db, { ...row, mode: 'ai', question: q, answer: answer.slice(0, 1200), tokens_in: (u.input_tokens | 0) + (u.cache_creation_input_tokens | 0) + (u.cache_read_input_tokens | 0),
      tokens_out: u.output_tokens | 0, cache_read: u.cache_read_input_tokens | 0, ms, behind: standing ? !!standing.behind : null,
      note: [res && res.stop_reason && res.stop_reason !== 'end_turn' ? String(res.stop_reason).slice(0, 40) : '', cards.length ? 'cards: ' + cards.map(c => c.id).join(', ') : '',
        data && data.notes && data.notes.length ? 'data: ' + data.notes.join(', ') : ''].filter(Boolean).join(' · ') || null });
    return { ...base, mode: 'ai', answer, left: Math.max(0, cfg.userDaily - used.mine - 1) };
  } finally { inflight--; }
}

/** The state of the helper for the admin's Settings card (never the key, only whether one is present). */
export async function claudianState(db, nowMs = Date.now()) {
  const cfg = await loadCfg(db, nowMs);
  const day = todayKey(nowMs);
  const all = (await countRows(db, day, null)) || memAll.get(day) || 0;
  return { on: cfg.on, keyPresent: keyPresent(), model: CLAUDIAN_MODEL, name: CLAUDIAN_NAME, userDaily: cfg.userDaily, allDaily: cfg.allDaily, today: all,
    targets: cfg.targets, lastProblem: lastNote.text ? { at: lastNote.at, text: lastNote.text } : null };
}
