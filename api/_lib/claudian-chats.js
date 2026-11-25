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

   THE REPORT FOR CLAUDE, AND THE CLEAR (handbook Part 162):

     "I need to always export a report you may need at that window of Hope Ai, then clear all existing history so that i may always deliver you
      with what went on (so that you tell me any concerns) and keep the db fresh."                              -- the owner, 25 Nov 2026

   The tab can hand over EVERYTHING on file (not only the window it shows) as one report, a page of rows at a time (claudianChatsExport), and can
   then clear exactly what that report held (claudianChatsClear: admin only, audited). The report is DRAWN AT THE NEWEST ROW ON FILE when it is
   asked for: that row's own time (`upTo`) is the line, a page asks for rows up to it, and a clear deletes rows up to it and nothing after it, so a
   chat that arrives while the report is made is kept for the next report. The clear also counts the rows up to that line first and refuses when
   there are MORE than the report held (a row that was being written as the report was read): nothing is deleted then and the owner is told to
   export again. A clear that is cut short by its time limit deletes whole slices only and can be pressed again.

   THE COST (CLAUDE.md section 1). Nothing here is on /api/upload or /api/call, and portal-core.js
   (which api/upload.js imports) loads this file only when one of the two functions is CALLED. The
   list is two reads of one small table through its day index, for at most 31 days (7 by default):
   the light columns of every row, and the text of the typed questions only (a ready question's text
   is its catalogue entry, so it is not read). A window with more than CHATS_MAX_THREADS chats says
   so and shows the newest. When RUN-ME-090 has not been run the tab says that and shows nothing:
   never an empty table, which would read as "nobody has asked anything".
   ===================================================================================== */
import { fetchAll, runQuery } from './supabase.js';
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

/* ===================================================================================================================================
   THE REPORT AND THE CLEAR (handbook Part 162)
   =================================================================================================================================== */
export const EXPORT_PAGE_ROWS = 500;
export const CLEAR_BUDGET_MS = 30000;
export const CLEAR_SLICE_DAYS = 7;
export const SETTING_LAST_CLEAR = 'CLAUDIAN_LAST_CLEAR';
const EXPORT_COLS = 'created_at, day, source, user_name, role, teams, zone, lang, thread, mode, faq_id, question, answer, tokens_in, tokens_out, cache_read, ms, behind, note';
/** A time as the database writes one (or as ISO writes one): the report's line is a value an earlier answer gave, never something typed. */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/;
const stampOk = v => typeof v === 'string' && v.length <= 40 && STAMP.test(v) && !isNaN(Date.parse(v));
const wholeIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const shapeRow = r => ({
  at: r.created_at, day: String(r.day || '').slice(0, 10), source: r.source || '', name: r.user_name || '', role: r.role || '', teams: r.teams || '', zone: r.zone || '',
  lang: r.lang || '', thread: r.thread || '', mode: r.mode || '', faq: r.faq_id || '', q: r.question || '', a: r.answer || '', tokensIn: whole(r.tokens_in),
  tokensOut: whole(r.tokens_out), cacheRead: whole(r.cache_read), ms: whole(r.ms), behind: r.behind === true ? true : r.behind === false ? false : null, note: r.note || '',
});

/** The note the last clear left (one setting row, JSON), shaped and bounded: anything that is not what the clear wrote reads as "never cleared". */
export function lastClearOf(text) {
  let o;
  try { o = JSON.parse(String(text || '')); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || !stampOk(o.at) || !stampOk(o.upTo) || !wholeIn(o.deleted, 0, 100000000)) return null;
  return { at: o.at, by: String(o.by || '').slice(0, 80), role: String(o.role || '').slice(0, 60), upTo: o.upTo, deleted: o.deleted, partial: o.partial === true };
}

/** One page of the whole history, oldest first. The first call (no `upTo`) draws the line at the newest row on file and counts the rows up to it; every
    later call gives that `upTo` back with the `offset` the last page announced as `next`. A page is at most EXPORT_PAGE_ROWS rows. Without the table
    (db/RUN-ME-090 not run) it says so and holds nothing: never an empty report. */
export async function claudianChatsExport(db, args) {
  const a = args && typeof args === 'object' ? args : {};
  let upTo = null;
  if (a.upTo != null && a.upTo !== '') { if (!stampOk(a.upTo)) throw bad('upTo must be the time an earlier page of this report gave.'); upTo = a.upTo; }
  const offset = a.offset == null ? 0 : a.offset;
  if (!wholeIn(offset, 0, 100000000)) throw bad('offset must be a whole number from 0.');
  const nothing = { on: true, note: null, upTo: null, total: 0, offset: 0, rows: [], next: null, faqLabels: {} };
  const gone = e => { if (missing(e)) return { ...nothing, on: false, note: CHATS_NOTE }; throw e; };
  if (upTo === null) {
    const r = await runQuery(() => db.from('claudian_chats').select('created_at').order('created_at', { ascending: false }).limit(1));
    if (r.error) return gone(r.error);
    if (!r.data || !r.data.length) return nothing;
    upTo = String(r.data[0].created_at);
  }
  let total = null;
  if (offset === 0) {                                  // counted once, with the first page: the pages after it are not slowed by a count each
    const t = await runQuery(() => db.from('claudian_chats').select('id', { count: 'exact', head: true }).lte('created_at', upTo));
    if (t.error) return gone(t.error);
    total = Number.isFinite(t.count) ? t.count : 0;
  }
  const p = await runQuery(() => db.from('claudian_chats').select(EXPORT_COLS).lte('created_at', upTo)
    .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + EXPORT_PAGE_ROWS - 1));
  if (p.error) return gone(p.error);
  const rows = (p.data || []).map(shapeRow);
  const more = rows.length === EXPORT_PAGE_ROWS && (total === null || offset + rows.length < total);
  const out = { on: true, note: null, upTo, total, offset, rows, next: more ? offset + rows.length : null, faqLabels: {} };
  if (offset === 0) for (const e of FAQ) out.faqLabels[e.id] = { sw: e.sw.q, en: e.en.q };
  return out;
}

/** Deletes the rows the report held: everything with a `created_at` up to `upTo`, and nothing after it. `expected` is the number of rows the report
    held. Refuses (deleting nothing) when MORE rows than that are up to the line. Deletes a week of days at a time and stops between slices when its
    time is up (`partial`: press it again). Answers what was deleted and what is left up to the line. */
export async function claudianChatsClear(db, args, nowMs = Date.now(), budgetMs = CLEAR_BUDGET_MS) {
  const a = args && typeof args === 'object' ? args : {};
  if (!stampOk(a.upTo)) throw bad('upTo must be the time the report was drawn at.');
  if (Date.parse(a.upTo) > nowMs + 5 * 60 * 1000) throw bad('upTo is in the future.');
  if (!wholeIn(a.expected, 0, 100000000)) throw bad('expected must be the number of chats the report held.');
  const upTo = a.upTo, started = Date.now();
  const out = { on: true, note: null, cleared: false, changed: false, partial: false, upTo, expected: a.expected, found: 0, deleted: 0, remaining: 0 };
  const count = async () => {
    const r = await runQuery(() => db.from('claudian_chats').select('id', { count: 'exact', head: true }).lte('created_at', upTo));
    if (r.error) throw r.error;
    return Number.isFinite(r.count) ? r.count : 0;
  };
  const edgeDay = async asc => {
    const r = await runQuery(() => db.from('claudian_chats').select('day').lte('created_at', upTo).order('day', { ascending: asc }).limit(1));
    if (r.error) throw r.error;
    return r.data && r.data[0] ? String(r.data[0].day).slice(0, 10) : null;
  };
  try {
    out.found = await count();
    if (out.found > a.expected) return { ...out, changed: true };           // rows the report never held: nothing is deleted
    if (out.found === 0) return { ...out, cleared: true };
    const first = await edgeDay(true), last = await edgeDay(false);
    for (let from = first; from && last && from <= last; from = addDaysKey(from, CLEAR_SLICE_DAYS)) {
      if (Date.now() - started > budgetMs) { out.partial = true; break; }
      const to = addDaysKey(from, CLEAR_SLICE_DAYS - 1) < last ? addDaysKey(from, CLEAR_SLICE_DAYS - 1) : last;
      const r = await runQuery(() => db.from('claudian_chats').delete().gte('day', from).lte('day', to).lte('created_at', upTo));
      if (r.error) throw r.error;
    }
    out.remaining = await count();
  } catch (e) {
    if (missing(e)) return { ...out, on: false, note: CHATS_NOTE };
    throw e;
  }
  out.deleted = Math.max(0, out.found - out.remaining);
  out.cleared = out.remaining === 0;
  return out;
}
