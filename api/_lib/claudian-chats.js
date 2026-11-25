/* =====================================================================================
   THE HOPE AI TAB'S READ SIDE: what people asked Claudian-PMO, by chat, role, team and day
   (handbook Part 158).

     "Have a new tab called Hope Ai in the system with rows of user chats that I could open and
      see what the user is chatting.. like reports of Claudian-PMO chats per user roles, teams and
      dates"  ...  "So after that experience too we'll be back here to check what should be
      considered from the chats."                                -- the owner, 25 Nov 2026

   WHAT A "CHAT" IS. The helper logs one row for each question and each tap (db/RUN-ME-090), and
   writes the same `thread` on a person's rows of one day (their one-way fingerprint and the day).
   A chat in this tab is that thread: one person, one day, every question and tap in order. The list
   gives a row for each chat, with who (name, role, zone, teams, where they asked from), how many
   questions of which kind, the tokens, whether their teams were behind last week, and their first
   typed question; opening it (claudianChatThread) gives the whole conversation.

   WHO READS IT. The tab is granted like every other tab (the audit log's own rule): the admin holds
   it from the start and a role can be ticked for it. The two functions are gated on the tab `hopeai`
   in portal-core.js (FN_TAB). What is in the rows is what the helper already made safe to keep: the
   asker's name, role, teams and zone as the system knew them, the question with every number of
   seven digits or more already replaced by [namba], the answer, and a one-way fingerprint that is
   never an access code or a device number.

   THE COST (CLAUDE.md section 1). Nothing here is on /api/upload or /api/call, and portal-core.js
   (which api/upload.js imports) loads this file only when one of the two functions is CALLED. The
   list is two reads of one small table through its day index, for at most 31 days (7 by default):
   the light columns of every row, and the text of the typed questions only (a ready question's text
   is its catalogue entry, so it is not read). A window with more than CHATS_MAX_THREADS chats says
   so and shows the newest. When RUN-ME-090 has not been run the tab says that and shows nothing:
   never an empty table, which would read as "nobody has asked anything".
   ===================================================================================== */
import { fetchAll } from './supabase.js';
import { todayKey, addDaysKey } from './time.js';
import { FAQ } from './claudian-faq.js';

export const CHATS_DEFAULT_DAYS = 7;
export const CHATS_MAX_DAYS = 31;
export const CHATS_MAX_THREADS = 3000;
export const SNIPPET_CHARS = 140;
export const CHATS_NOTE = 'Jedwali la mazungumzo bado halijaanzishwa — endesha db/RUN-ME-090-claudian-chats.sql. / The chats table does not exist yet — run db/RUN-ME-090-claudian-chats.sql.';

const MODES = ['ai', 'faq', 'canned', 'limit', 'busy'];
const TYPED_MODES = ['ai', 'canned', 'limit', 'busy'];
const LIGHT = 'created_at, day, source, user_key, user_name, role, teams, zone, lang, thread, mode, faq_id, tokens_in, tokens_out, cache_read, behind';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = s => {
  if (!DAY.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
/** The table has not been made yet (db/RUN-ME-090 not run): PostgREST says it could not find the table in its schema cache, Postgres that the relation does not
    exist. Any other failure (a refusal, a timeout) is NOT this and is not reported as this. */
const missing = e => /does not exist|schema cache|could not find the table/i.test(String((e && e.message) || e || ''));
const squeeze = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const whole = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const bad = m => Object.assign(new Error(m), { status: 400 });

/** The days the tab reads: `to` is today unless a real day is given, `from` is six days earlier unless given, a window turned the wrong way is
    turned back, and one longer than CHATS_MAX_DAYS is cut to its newest CHATS_MAX_DAYS (and says so). */
export function chatWindow(args, nowMs) {
  const a = args && typeof args === 'object' ? args : {};
  const today = todayKey(nowMs);
  let to = realDay(String(a.to || '')) ? String(a.to) : today;
  let from = realDay(String(a.from || '')) ? String(a.from) : addDaysKey(to, -(CHATS_DEFAULT_DAYS - 1));
  if (from > to) { const t = from; from = to; to = t; }
  let clamped = false;
  if (addDaysKey(from, CHATS_MAX_DAYS - 1) < to) { from = addDaysKey(to, -(CHATS_MAX_DAYS - 1)); clamped = true; }
  return { from, to, today, clamped };
}

/** One row for each chat of the window, newest first. */
export async function claudianChatsList(db, args, nowMs = Date.now()) {
  const w = chatWindow(args, nowMs);
  const out = { on: true, note: null, from: w.from, to: w.to, today: w.today, clamped: w.clamped, rowsRead: 0, truncated: false, threads: [], faqLabels: {} };
  let light, typed;
  try {
    [light, typed] = await Promise.all([
      fetchAll(() => db.from('claudian_chats').select(LIGHT).gte('day', w.from).lte('day', w.to).order('created_at', { ascending: false })),
      fetchAll(() => db.from('claudian_chats').select('thread, created_at, question').gte('day', w.from).lte('day', w.to).in('mode', TYPED_MODES).order('created_at', { ascending: true })),
    ]);
  } catch (e) {
    if (missing(e)) return { ...out, on: false, note: CHATS_NOTE };
    throw e;
  }
  const byThread = new Map();
  for (const r of light || []) {
    const key = String(r.thread || (r.user_key + ':' + r.day));
    let t = byThread.get(key);
    if (!t) {                                   // the rows come newest first: the person's name, role and teams are the latest the system knew
      t = { thread: key, day: r.day, source: r.source || '', name: r.user_name || '', role: r.role || '', zone: r.zone || '', teams: r.teams || '', lang: r.lang || '',
        firstAt: r.created_at, lastAt: r.created_at, n: 0, ai: 0, faq: 0, canned: 0, limit: 0, busy: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0,
        behind: null, faqIds: {}, first: '' };
      byThread.set(key, t);
    }
    t.n++;
    if (MODES.includes(r.mode)) t[r.mode]++;
    t.tokensIn += whole(r.tokens_in); t.tokensOut += whole(r.tokens_out); t.cacheRead += whole(r.cache_read);
    if (String(r.created_at) < String(t.firstAt)) t.firstAt = r.created_at;
    if (String(r.created_at) > String(t.lastAt)) t.lastAt = r.created_at;
    if (r.behind === true) t.behind = true; else if (r.behind === false && t.behind === null) t.behind = false;
    if (r.faq_id) t.faqIds[r.faq_id] = (t.faqIds[r.faq_id] || 0) + 1;
  }
  for (const r of typed || []) {                // oldest first: the first typed question of the chat
    const t = byThread.get(String(r.thread || ''));
    if (t && !t.first && r.question) t.first = squeeze(r.question).slice(0, SNIPPET_CHARS);
  }
  const all = [...byThread.values()].sort((a, b) => (String(a.lastAt) < String(b.lastAt) ? 1 : String(a.lastAt) > String(b.lastAt) ? -1 : 0));
  out.rowsRead = (light || []).length;
  out.truncated = all.length > CHATS_MAX_THREADS;
  out.threads = all.slice(0, CHATS_MAX_THREADS);
  const seen = new Set();
  for (const t of out.threads) for (const id of Object.keys(t.faqIds)) seen.add(id);
  for (const e of FAQ) if (seen.has(e.id)) out.faqLabels[e.id] = { sw: e.sw.q, en: e.en.q };
  return out;
}

/** One chat in full: who, and every question and tap in order, with the answer the person was given. */
export async function claudianChatThread(db, args) {
  const key = args && typeof args.thread === 'string' ? args.thread : '';          // a string and nothing else: a list or an object is not a chat
  const m = /^(.{3,100}):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m || !realDay(m[2])) throw bad('thread must be a chat of the list.');
  let rows;
  try {
    rows = await fetchAll(() => db.from('claudian_chats')
      .select('created_at, day, source, user_name, role, teams, zone, lang, mode, faq_id, question, answer, tokens_in, tokens_out, cache_read, ms, behind, note')
      .eq('user_key', m[1]).eq('day', m[2]).order('created_at', { ascending: true }));
  } catch (e) {
    if (missing(e)) return { on: false, note: CHATS_NOTE, thread: key, who: null, items: [] };
    throw e;
  }
  const last = (rows && rows.length) ? rows[rows.length - 1] : null;
  const labels = {};
  for (const e of FAQ) labels[e.id] = { sw: e.sw.q, en: e.en.q };
  return {
    on: true, note: null, thread: key, day: m[2],
    who: last ? { name: last.user_name || '', role: last.role || '', zone: last.zone || '', teams: last.teams || '', source: last.source || '', lang: last.lang || '' } : null,
    items: (rows || []).map(r => ({
      at: r.created_at, mode: r.mode, faq: r.faq_id || '', faqLabel: r.faq_id && labels[r.faq_id] ? labels[r.faq_id] : null,
      q: r.question || '', a: r.answer || '', tokensIn: whole(r.tokens_in), tokensOut: whole(r.tokens_out), cacheRead: whole(r.cache_read), ms: whole(r.ms),
      behind: r.behind === true ? true : r.behind === false ? false : null, note: r.note || '',
    })),
  };
}
