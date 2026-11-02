/* =====================================================================================
   THE DAILY CHECKLIST -- a leader's own day, task by task, against a cut-off, with proof.

     "Thats how implementation of the window they work on should be for leaders at a tab
      'Daily Checklist' ... where my settings stay on the Bonasi ya wiki tab ...
      I should be able to manage tasks per role at my bonasi tab"

   Two things, kept apart on purpose:

   THE PLAN -- which tasks, on which weekday, by what cut-off, for which ROLE. One settings row
   (key DAILY_CHECKLIST), written from the Daily Bonus Plan tab by whoever holds it. No
   migration: it is a setting, and the GM changes it the way they change a bonus amount. A
   leader is shown the tasks of the role their access code carries, on the weekday the day is.

   THE ENTRIES -- one row per person, per day, per task (checklist_entries, RUN-ME-048): the
   tick with the SERVER's own time stamp (the phone's clock is nobody's evidence), whether it
   came after the cut-off, and the photo taken in the app with its own server stamp. A list
   never reads the photo column; a photo is fetched one at a time when somebody presses View.

   WHAT A PERSON MAY DO: tick and photograph their OWN day, today only -- yesterday is read. A
   person holding the Daily Bonus Plan tab (the GM) also sees everybody's day on a board and
   may open any photo. Nobody edits a stamp.

   NOTHING HERE TOUCHES /api/upload OR /api/call. The reads are a settings row and a person's
   handful of entries; the writes are one row at a time.
   ===================================================================================== */
import { fetchAll } from './supabase.js';
import { todayKey, weekdayOfKey, localNow } from './time.js';

const K = v => String(v == null ? '' : v).trim().toUpperCase();
function bad(msg) { const e = new Error(msg); e.status = 400; throw e; }
function forbid(msg) { const e = new Error(msg); e.status = 403; throw e; }

export const CHECKLIST_KEY = 'DAILY_CHECKLIST';
export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const DAY_NAMES = { MON: 'Jumatatu / Monday', TUE: 'Jumanne / Tuesday', WED: 'Jumatano / Wednesday',
  THU: 'Alhamisi / Thursday', FRI: 'Ijumaa / Friday', SAT: 'Jumamosi / Saturday', SUN: 'Jumapili / Sunday' };

const CK_NOT_READY = 'Jedwali la checklist halijatengenezwa bado. Endesha db/RUN-ME-048-daily-checklist.sql '
  + 'kwenye Supabase. / The checklist table has not been created yet -- run that migration first.';
function tableMissing(err) {
  const s = String((err && (err.message || err.code)) || err || '');
  return /does not exist|Could not find the table|42P01|PGRST205/i.test(s)
    || /PGRST204/i.test(s) || /Could not find the '.*' column of/i.test(s);
}

const isDay = s => { const v = String(s || ''); return /^\d{4}-\d{2}-\d{2}$/.test(v) && !!weekdayOfKey(v); };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ACTIVITY_MAX = 160;
const ITEMS_MAX = 30;

/* THE CUT-OFF. HH:MM on the EAT clock, the day's own. "00:00" is the GM's placeholder in the
   window they drew ("CutOff 00:00 HRS"), and as a real cut-off it would mean nothing can ever
   be on time -- so 00:00 means NO cut-off: the whole day, never late. Said on the editor too. */
export function isLate(cutoff, nowMs) {
  const c = String(cutoff || '').trim();
  if (!TIME_RE.test(c) || c === '00:00') return false;
  const hhmm = localNow(nowMs).toISOString().slice(11, 16);
  return hhmm > c;
}

function newId_() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/** The plan as stored, made safe: upper-cased roles, known weekdays only, every item with an
    id, a trimmed activity and a valid cut-off. Anything else is dropped, never thrown at a
    screen -- a setting typed by hand in Settings must not take the tab down. */
export function normalisePlan(raw) {
  const out = { roles: {} };
  const roles = raw && typeof raw === 'object' && raw.roles && typeof raw.roles === 'object' ? raw.roles : {};
  for (const [r, days] of Object.entries(roles)) {
    const role = K(r);
    if (!role || !days || typeof days !== 'object') continue;
    const d = {};
    for (const wd of WEEKDAYS) {
      const list = Array.isArray(days[wd]) ? days[wd] : [];
      const seen = new Set();
      const items = [];
      for (const it of list) {
        const activity = String((it && it.activity) || '').replace(/\s+/g, ' ').trim().slice(0, ACTIVITY_MAX);
        if (!activity) continue;
        let id = String((it && it.id) || '').trim();
        if (!id || seen.has(id)) id = newId_();
        seen.add(id);
        const cutoff = TIME_RE.test(String((it && it.cutoff) || '').trim()) ? String(it.cutoff).trim() : '00:00';
        items.push({ id, activity, cutoff });
        if (items.length >= ITEMS_MAX) break;
      }
      if (items.length) d[wd] = items;
    }
    if (Object.keys(d).length) out.roles[role] = d;
  }
  return out;
}

async function readPlan_(db) {
  const { data, error } = await db.from('settings').select('value').eq('key', CHECKLIST_KEY).maybeSingle();
  if (error) throw error;
  let raw = {};
  try { raw = JSON.parse((data && data.value) || '{}'); } catch (e) { raw = {}; }
  return normalisePlan(raw);
}

/** Every role name the system knows -- Roles & access first, then any role an access code
    carries that the roles table does not list. The plan is managed per role, so the editor
    offers the roles that exist rather than a box to spell one. */
async function roleNames_(db) {
  const seen = new Set();
  for (const table of ['roles', 'access_codes']) {
    try {
      const rows = await fetchAll(() => db.from(table).select('role'));
      for (const r of rows) { const k = K(r && r.role); if (k) seen.add(k); }
    } catch (e) { /* a table that is not there yet names no roles */ }
  }
  return [...seen].sort();
}

/* ------------------------------------------------------------------ the plan (Bonasi tab) */
export async function checklistPlan(db, user) {
  const [plan, roles] = await Promise.all([readPlan_(db), roleNames_(db)]);
  return { ok: true, plan, roles, weekdays: WEEKDAYS.slice(), dayNames: DAY_NAMES };
}

/** One role's week, replaced whole: { role, days: { MON: [{id?, activity, cutoff}], ... } }.
    An item's id is kept when the editor sends it back, so an entry already ticked against it
    keeps pointing at the same task after its wording is corrected; a new row gets a new id. */
export async function checklistPlanSave(db, user, args = {}) {
  const role = K(args.role);
  if (!role) bad('Chagua wadhifa. / Choose a role.');
  const days = args.days && typeof args.days === 'object' ? args.days : {};
  for (const wd of WEEKDAYS) {
    for (const it of (Array.isArray(days[wd]) ? days[wd] : [])) {
      const activity = String((it && it.activity) || '').trim();
      if (!activity) continue;
      if (activity.length > ACTIVITY_MAX) bad('Kazi ni ndefu mno (herufi ' + ACTIVITY_MAX + ' zaidi). / A task is longer than ' + ACTIVITY_MAX + ' characters.');
      const c = String((it && it.cutoff) || '').trim();
      if (c && !TIME_RE.test(c)) bad('Saa ya mwisho si sahihi: "' + c + '". Andika kama 07:30. / Cut-off "' + c + '" is not a time; write it like 07:30.');
    }
    if (Array.isArray(days[wd]) && days[wd].length > ITEMS_MAX) bad('Kazi ' + ITEMS_MAX + ' zaidi kwa siku moja. / At most ' + ITEMS_MAX + ' tasks on one day.');
  }
  const plan = await readPlan_(db);
  const cleaned = normalisePlan({ roles: { [role]: days } });
  if (cleaned.roles[role]) plan.roles[role] = cleaned.roles[role]; else delete plan.roles[role];
  const { error } = await db.from('settings').upsert({ key: CHECKLIST_KEY, value: JSON.stringify(plan) }, { onConflict: 'key' });
  if (error) throw error;
  return { ok: true, role, days: plan.roles[role] || {}, plan };
}

/* ------------------------------------------------------------------ the window (Daily Checklist tab) */
const ENTRY_COLS = 'id, code, name, role, item_id, ticked_at, late, photo_at, photo_bytes';
const canSeeAll_ = user => K(user && user.role) === 'ADMIN' || !!(user && user.tabs && user.tabs.includes('bonusplan'));

/** The day: this person's role's tasks for the weekday, each with their own tick and photo. */
export async function checklist(db, user, args = {}, nowMs = Date.now()) {
  const today = todayKey(nowMs);
  let date = isDay(args.date) ? String(args.date) : today;
  if (date > today) date = today;                   // tomorrow is not a day anyone has had yet
  const weekday = weekdayOfKey(date);
  const role = K(user.role);
  const plan = await readPlan_(db);
  const items = ((plan.roles[role] || {})[weekday]) || [];
  let mine = [], notReady = false;
  try {
    mine = await fetchAll(() => db.from('checklist_entries').select(ENTRY_COLS).eq('code', String(user.code)).eq('day', date));
  } catch (e) { if (tableMissing(e)) notReady = true; else throw e; }
  const byItem = {};
  for (const e of mine) byItem[String(e.item_id)] = e;
  const rows = items.map(it => {
    const e = byItem[it.id];
    return { id: it.id, activity: it.activity, cutoff: it.cutoff,
      entry_id: e ? e.id : null,
      ticked: !!(e && e.ticked_at), ticked_at: e ? e.ticked_at || null : null, late: !!(e && e.late),
      photo: !!(e && e.photo_at), photo_at: e ? e.photo_at || null : null, photo_bytes: e ? e.photo_bytes || null : null };
  });
  /* THE GM'S BOARD -- everybody's day, one line per person, only for somebody who holds the
     tab the plan is managed on. A leader pays nothing for it: the read is not made. */
  let board = null;
  if (canSeeAll_(user) && !notReady) {
    const all = await fetchAll(() => db.from('checklist_entries').select(ENTRY_COLS).eq('day', date));
    const by = {};
    for (const e of all) {
      const k = String(e.code);
      const b = by[k] || (by[k] = { code: k, name: e.name || k, role: K(e.role), done: 0, late: 0, photos: 0, total: 0, last: null });
      if (e.ticked_at) { b.done++; if (e.late) b.late++; if (!b.last || String(e.ticked_at) > b.last) b.last = String(e.ticked_at); }
      if (e.photo_at) b.photos++;
    }
    board = Object.values(by).map(b => {
      b.total = (((plan.roles[b.role] || {})[weekday]) || []).length;
      b.missing = Math.max(0, b.total - b.done);
      return b;
    }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  return { ok: true, date, weekday, dayName: DAY_NAMES[weekday] || weekday, today: date === today,
    role, name: user.name || '', serverTime: localNow(nowMs).toISOString().slice(11, 16),
    rows, done: rows.filter(r => r.ticked).length, late: rows.filter(r => r.late).length,
    photos: rows.filter(r => r.photo).length,
    planned: items.length > 0, notReady, notReadyNote: notReady ? CK_NOT_READY : null,
    canSeeAll: canSeeAll_(user), board };
}

/** The task this person is allowed to write against today, or a refusal that says why. */
async function todaysItem_(db, user, args, nowMs) {
  const itemId = String((args && args.item_id) || '').trim();
  if (!itemId) bad('Chagua kazi. / Name the task.');
  const today = todayKey(nowMs);
  const weekday = weekdayOfKey(today);
  const plan = await readPlan_(db);
  const it = ((((plan.roles[K(user.role)] || {})[weekday]) || []).find(x => x.id === itemId)) || null;
  if (!it) bad('Kazi hiyo si ya wadhifa wako leo. / That task is not on your role’s list today.');
  return { it, today, weekday };
}

async function ownRow_(db, user, day, itemId) {
  const { data, error } = await db.from('checklist_entries').select(ENTRY_COLS)
    .eq('code', String(user.code)).eq('day', day).eq('item_id', itemId).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Tick (on: true) or untick (on: false) one of today's tasks. The server stamps the time and
    decides late; an untick removes the tick and keeps the photo, if one was taken. */
export async function checklistTick(db, user, args = {}, nowMs = Date.now()) {
  const { it, today, weekday } = await todaysItem_(db, user, args, nowMs);
  const on = args.on == null ? true : !!args.on;
  let row;
  try {
    row = await ownRow_(db, user, today, it.id);
    if (on) {
      const stamp = { ticked_at: new Date(nowMs).toISOString(), late: isLate(it.cutoff, nowMs),
        activity: it.activity, cutoff: it.cutoff, name: user.name || null, role: K(user.role) || null, weekday };
      if (row) {
        const { error } = await db.from('checklist_entries').update(stamp).eq('id', row.id);
        if (error) throw error;
        row = { ...row, ...stamp };
      } else {
        const { data, error } = await db.from('checklist_entries')
          .insert([{ day: today, code: String(user.code), item_id: it.id, ...stamp }]).select(ENTRY_COLS);
        if (error) throw error;
        row = (data && data[0]) || { ...stamp, item_id: it.id };
      }
    } else if (row) {
      if (row.photo_at) {
        const { error } = await db.from('checklist_entries').update({ ticked_at: null, late: false }).eq('id', row.id);
        if (error) throw error;
        row = { ...row, ticked_at: null, late: false };
      } else {
        const { error } = await db.from('checklist_entries').delete().eq('id', row.id);
        if (error) throw error;
        row = null;
      }
    }
  } catch (e) { if (tableMissing(e)) bad(CK_NOT_READY); throw e; }
  return { ok: true, item_id: it.id, ticked: !!(row && row.ticked_at), ticked_at: row ? row.ticked_at || null : null,
    late: !!(row && row.late), photo: !!(row && row.photo_at), entry_id: row ? row.id || null : null };
}

/* THE PHOTO -- the same ceiling as an imprest receipt (200KB after the phone has shrunk it),
   the same three formats, and never a bare file path: the image itself is what is kept. */
const PHOTO_MAX_BYTES = 200 * 1024;
const PHOTO_MIN_BYTES = 1024;
function photoBytes_(s) {
  const v = String(s || '');
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(v);
  if (!m) return null;
  const b64 = m[2], pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor(b64.length * 3 / 4) - pad;
}

/** Attach today's photo to one of today's tasks. A photo may come before the tick -- the tick
    is the claim, the photo the proof, and either may be first. A second photo replaces the
    first; both stamps are the server's. */
export async function checklistPhoto(db, user, args = {}, nowMs = Date.now()) {
  const { it, today, weekday } = await todaysItem_(db, user, args, nowMs);
  const photo = String(args.photo || '');
  const bytes = photoBytes_(photo);
  if (bytes === null) bad('Picha si halali (JPEG/PNG/WEBP). / That is not a valid photo (JPEG/PNG/WEBP).');
  if (bytes > PHOTO_MAX_BYTES) bad('Picha ni kubwa mno (zaidi ya ' + Math.round(PHOTO_MAX_BYTES / 1024) + 'KB). / The photo is too large.');
  if (bytes < PHOTO_MIN_BYTES) bad('Picha ni ndogo mno. / The photo is too small to be a photo.');
  const stamp = { photo, photo_bytes: bytes, photo_at: new Date(nowMs).toISOString(),
    activity: it.activity, cutoff: it.cutoff, name: user.name || null, role: K(user.role) || null, weekday };
  let row;
  try {
    row = await ownRow_(db, user, today, it.id);
    if (row) {
      const { error } = await db.from('checklist_entries').update(stamp).eq('id', row.id);
      if (error) throw error;
      row = { ...row, ...stamp };
    } else {
      const { data, error } = await db.from('checklist_entries')
        .insert([{ day: today, code: String(user.code), item_id: it.id, ...stamp }]).select(ENTRY_COLS);
      if (error) throw error;
      row = (data && data[0]) || { ...stamp, item_id: it.id };
    }
  } catch (e) { if (tableMissing(e)) bad(CK_NOT_READY); throw e; }
  return { ok: true, item_id: it.id, photo: true, photo_at: stamp.photo_at, photo_bytes: bytes,
    ticked: !!row.ticked_at, ticked_at: row.ticked_at || null, late: !!row.late, entry_id: row.id || null };
}

/** One photo, by entry: the person's own, or anyone's for somebody who holds the plan. */
export async function checklistPhotoGet(db, user, args = {}) {
  const id = String((args && args.entry_id) || '').trim();
  if (!id) bad('Chagua picha. / Name the entry.');
  let row;
  try {
    const { data, error } = await db.from('checklist_entries')
      .select('id, code, name, role, day, activity, cutoff, ticked_at, late, photo, photo_at, photo_bytes').eq('id', id).maybeSingle();
    if (error) throw error;
    row = data || null;
  } catch (e) { if (tableMissing(e)) bad(CK_NOT_READY); throw e; }
  if (!row) bad('Hakuna picha. / No such entry.');
  if (String(row.code) !== String(user.code) && !canSeeAll_(user)) forbid('Picha hii si yako. / This photo is not yours to open.');
  return { ok: true, id: row.id, name: row.name || row.code, role: row.role || '', day: row.day, activity: row.activity || '',
    cutoff: row.cutoff || '', ticked_at: row.ticked_at || null, late: !!row.late,
    photo: row.photo || null, photo_at: row.photo_at || null, photo_bytes: row.photo_bytes || null };
}
