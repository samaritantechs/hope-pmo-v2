/** PHONE NOTIFICATIONS -- the GM's handset buzzes the moment an imprest request lands.
 *
 *    "GM needs phone notifications whenever there is an imprest even if he logs in via browser"
 *
 *  Email was the nudge (mail.js) and still is. This is the second one, the one that reaches a
 *  pocket: Web Push, which the browser delivers to the phone's notification tray whether or not
 *  the portal is open -- no app to install, nothing to add on Vercel. The GM turns it on once
 *  from the bell (Taarifa) on the phone they carry; the browser hands the portal a subscription
 *  (an address at Google's or Apple's push service and two keys) and the portal keeps it in the
 *  settings table under PUSH_SUB_<CODE>. A new request then goes out to every handset whose code
 *  holds the approval pane -- the topic decides who hears, the tab decides who may subscribe.
 *
 *  THE SAME RULE AS THE EMAIL: a courtesy on top of the register, never the thing it depends on.
 *  Nothing here throws into the request that triggered it. Every send resolves with a count and
 *  a reason, under a clock, after the row exists -- and the requester's screen says "arifa
 *  haikutumwa" beside a request nobody's phone was told about, exactly as it does for email.
 *
 *  THE KEYS. Web Push signs every send with a VAPID key pair the push service learned at
 *  subscription time, so the pair must be the same on every deploy. VAPID_PUBLIC_KEY and
 *  VAPID_PRIVATE_KEY on the deployment are honoured when both are set; without them the pair is
 *  DERIVED from the service-role key the deployment already carries (HMAC, then the P-256 point
 *  for it), so the feature works with nothing added and the private half is never written
 *  anywhere. Rotating that key changes the pair: every handset then has to turn the switch off
 *  and on again, and the first send after the rotation says so in its reason.
 *
 *  Subscriptions live in `settings` rather than a table of their own so there is no migration
 *  to run before the first phone can be told -- a handful of rows, one per code, each a short
 *  JSON list of at most MAX_SUBS handsets.
 */
import webpush from 'web-push';
import { createHmac, createECDH } from 'node:crypto';
import { fetchAll } from './supabase.js';

export const PUSH_SUB_PREFIX = 'PUSH_SUB_';
/** Which tab a code must hold to hear each topic -- "all imprest processes send browser /
    device notifications". A topic nobody's tab names cannot be subscribed to, so a phone can
    never be told about a screen its code cannot open.
      IMPREST       a new request, and a retirement filed      -> the approver (Idhini)
      IMPREST_FUND  approved and waiting to be paid out, and a retirement filed -> the accountant (Ripoti)
      IMPREST_MINE  MY request decided or funded               -> the requester (Omba), own rows only */
export const PUSH_TOPICS = { IMPREST: ['impappr'], IMPREST_FUND: ['imprep'], IMPREST_MINE: ['impreq'] };
const MAX_SUBS = 5;                 // handsets per code: a phone, a spare, a tablet -- not a history
const SEND_TIMEOUT_MS = 6000;       // one push service that hangs must not hold the request open
const FANOUT_BUDGET_MS = 9000;      // the whole round, after the row and after the email
const DEFAULT_SUBJECT = 'https://github.com/samaritantechs/hope-pmo-v2';

function bad(msg) { const e = new Error(msg); e.status = 400; throw e; }
function forbid(msg) { const e = new Error(msg); e.status = 403; throw e; }
const K = v => String(v == null ? '' : v).trim().toUpperCase();
const S_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
const env = k => String(process.env[k] || '').trim();
const b64u = buf => Buffer.from(buf).toString('base64url');

/* The transport, swappable so a test can watch a send without a network -- the same shape as
   mail.js's _setFetch. */
let sendImpl = (sub, body, opts) => webpush.sendNotification(sub, body, opts);
export function _setSend(f) { sendImpl = f || ((sub, body, opts) => webpush.sendNotification(sub, body, opts)); }

/** The signing pair, computed once per process. Null when the deployment carries neither the
    explicit pair nor a service-role key to derive one from. */
let keysMemo;
export function vapidKeys() {
  if (keysMemo !== undefined) return keysMemo;
  keysMemo = computeKeys_();
  return keysMemo;
}
export function _resetKeys() { keysMemo = undefined; }
function computeKeys_() {
  const pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY');
  if (pub && priv) return { publicKey: pub, privateKey: priv, source: 'env' };
  const seed = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!seed) return null;
  /* A 256-bit HMAC is a valid P-256 private scalar unless it lands outside the curve's order,
     which setPrivateKey refuses (odds about one in four billion); the next counter is taken. */
  for (let i = 0; i < 16; i++) {
    const d = createHmac('sha256', seed).update('hope-pmo:vapid:v1:' + i).digest();
    try {
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(d);
      return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(d), source: 'derived' };
    } catch (e) { /* outside the order: next counter */ }
  }
  return null;
}

/* ------------------------------------------------------------------ the register of phones */
const subKey_ = code => PUSH_SUB_PREFIX + K(code);
const webSub_ = s => !!(s && typeof s === 'object' && typeof s.endpoint === 'string'
  && /^https:\/\/\S+$/.test(s.endpoint) && s.endpoint.length <= 1024
  && s.keys && typeof s.keys === 'object'
  && typeof s.keys.p256dh === 'string' && s.keys.p256dh.length >= 16 && s.keys.p256dh.length <= 256
  && typeof s.keys.auth === 'string' && s.keys.auth.length >= 8 && s.keys.auth.length <= 128);
/* THE HOPE CALLS APP IS A PHONE TOO.
     "I thought we allow notification even from app too"
   An Android WebView has no push service: no PushManager, no Notification, nothing for Google's
   push service to deliver to. So the app registers itself in the SAME register under its own
   endpoint, apk:<device id> (HopeCallsBridge.getDeviceId, the id the device register already
   knows), and a send to such a row goes into a QUEUE under PUSH_Q_<CODE> (settings) instead of
   to a push service. The app itself asks for the queue (pushPending) every two minutes while it
   is open and every fifteen in the background (AlertJobService), and draws each item on the
   phone's own tray. One keyed read of one small row per poll; the topics rule is the one the
   browser's subscription obeys, because it is the same row. */
const apkSub_ = s => !!(s && typeof s === 'object' && typeof s.endpoint === 'string'
  && /^apk:[A-Za-z0-9_-]{6,64}$/.test(s.endpoint));
const validSub_ = s => webSub_(s) || apkSub_(s);
export const PUSH_Q_PREFIX = 'PUSH_Q_';
const MAX_Q = 30;                   // items kept per code: a day's imprest steps, not a history
const Q_TTL_MS = 24 * 3600 * 1000;  // an alert older than a day is stale on any tray
const qKey_ = code => PUSH_Q_PREFIX + K(code);
function parseQ_(value) {
  try { const v = JSON.parse(String(value || '[]')); return Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && x.at) : []; }
  catch (e) { return []; }
}
async function readQ_(db, code) {
  const { data, error } = await db.from('settings').select('value').eq('key', qKey_(code)).maybeSingle();
  if (error) throw new Error(error.message);
  return parseQ_(data && data.value);
}
/** Appends one alert to a code's queue: trimmed to a day and to MAX_Q, the item id unique per
    send so the app can never draw the same alert twice. */
async function enqueue_(db, code, payload) {
  const now = Date.now();   // wall clock on purpose: the phone compares it with the `at` it last drew
  const items = (await readQ_(db, code)).filter(x => now - Number(x.at) < Q_TTL_MS);
  items.push({ id: now + '-' + Math.random().toString(36).slice(2, 8), at: now,
    title: S_(payload && payload.title, 120), body: S_(payload && payload.body, 400),
    url: S_(payload && payload.url, 300), tag: S_(payload && payload.tag, 80) });
  while (items.length > MAX_Q) items.shift();
  const { error } = await db.from('settings').upsert({ key: qKey_(code), value: JSON.stringify(items) }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}
function parseSubs_(value) {
  try {
    const v = JSON.parse(String(value || '[]'));
    return Array.isArray(v) ? v.filter(validSub_) : [];
  } catch (e) { return []; }
}
async function readSubs_(db, code) {
  if (!K(code)) return [];
  const { data, error } = await db.from('settings').select('value').eq('key', subKey_(code)).maybeSingle();
  if (error) throw new Error(error.message);
  return parseSubs_(data && data.value);
}
async function writeSubs_(db, code, subs) {
  const key = subKey_(code);
  const r = subs.length
    ? await db.from('settings').upsert({ key, value: JSON.stringify(subs) }, { onConflict: 'key' })
    : await db.from('settings').delete().eq('key', key);
  if (r && r.error) throw new Error(r.error.message);
}
/** The topics this person may hear: every one whose tab they hold; an ADMIN, all of them. */
export function topicsFor(user) {
  if (!user) return [];
  const have = user.tabs || [];
  return Object.keys(PUSH_TOPICS).filter(t => K(user.role) === 'ADMIN' || PUSH_TOPICS[t].some(tab => have.includes(tab)));
}

/* ------------------------------------------------------------------ the portal's four calls */
/** What the bell needs before offering the switch: the public key to subscribe with, the topics
    this code may hear, and how many of its handsets are already on. */
export async function pushKey(db, user) {
  const k = vapidKeys();
  let subs = [];
  try { subs = await readSubs_(db, user.code); } catch (e) { /* no settings table yet: none */ }
  return {
    publicKey: k ? k.publicKey : null,
    topics: topicsFor(user), devices: subs.length,
    note: k ? '' : 'Funguo za arifa hazipo kwenye deployment (SUPABASE_SERVICE_ROLE_KEY au VAPID_*). '
      + '/ No push keys on the deployment (SUPABASE_SERVICE_ROLE_KEY or VAPID_*).',
  };
}
/** The browser's subscription, kept under this code. The same endpoint sent twice replaces
    itself; the oldest handset drops off past MAX_SUBS. */
export async function pushSubscribe(db, user, args, nowMs) {
  const a = args || {};
  const sub = a.sub || a.subscription;
  if (!validSub_(sub)) bad('Usajili wa arifa haukueleweka -- jaribu tena. / The push subscription is malformed; try again.');
  /* No topics named = everything this code may hear. The bell does not choose; the tabs do. */
  const may = topicsFor(user);
  const asked = (Array.isArray(a.topics) && a.topics.length ? a.topics : may).map(K);
  const topics = [...new Set(asked.filter(t => may.includes(t)))];
  if (!topics.length) forbid('Hakuna arifa iliyofunguliwa kwa wadhifa wako. / No notification topic is open to your role.');
  const row = apkSub_(sub)
    ? { endpoint: sub.endpoint, kind: 'apk', topics, ua: S_(a.ua, 160), at: new Date(nowMs || Date.now()).toISOString() }
    : { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        topics, ua: S_(a.ua, 160), at: new Date(nowMs || Date.now()).toISOString() };
  const subs = (await readSubs_(db, user.code)).filter(s => s.endpoint !== row.endpoint);
  subs.push(row);
  while (subs.length > MAX_SUBS) subs.shift();
  await writeSubs_(db, user.code, subs);
  return { ok: true, devices: subs.length, topics };
}
export async function pushUnsubscribe(db, user, args) {
  const endpoint = S_(args && args.endpoint, 1024);
  if (!endpoint) bad('endpoint is required');
  const subs = (await readSubs_(db, user.code)).filter(s => s.endpoint !== endpoint);
  await writeSubs_(db, user.code, subs);
  return { ok: true, devices: subs.length };
}
/** THE APP'S OWN POLL. The alerts queued for this code since `since` (ms), and how often to ask
    again: two minutes for an approver's phone, ten for anyone else's, zero (do not ask) for a
    code that holds no imprest pane or has no app registered. Read-only: nothing is acknowledged
    on the server, the phone remembers the last `at` it drew. */
export async function pushPending(db, user, args) {
  const a = args || {};
  const since = Number(a.since) || 0;
  const may = topicsFor(user);
  let subs = [];
  try { subs = await readSubs_(db, user.code); } catch (e) { /* no settings table: no app registered */ }
  const registered = subs.some(s => s.kind === 'apk');
  const interval = !may.length || !registered ? 0 : (may.includes('IMPREST') ? 120 : 600);
  if (!interval) return { ok: true, items: [], interval: 0, now: Date.now() };
  const items = (await readQ_(db, user.code)).filter(x => Number(x.at) > since).sort((x, y) => Number(x.at) - Number(y.at));
  return { ok: true, items, interval, now: Date.now() };
}

/** A push to this code's own handsets, so the switch can be proven from the phone itself. */
export async function pushTest(db, user, _args, nowMs) {
  const subs = await readSubs_(db, user.code);
  if (!subs.length) bad('Simu hii haijasajiliwa bado -- washa arifa kwanza. / This phone is not subscribed yet; turn alerts on first.');
  return sendTo_(db, [{ code: user.code, subs }], {
    title: 'HOPE PMO — jaribio / test',
    body: 'Arifa zinafika kwenye simu hii. / Notifications reach this phone.',
    url: '/dashboard', tag: 'hope-test',
  }, { nowMs });
}

/* ------------------------------------------------------------------ the send itself */
/** Every handset subscribed to `topic`, whoever holds it. Resolves, never throws:
      { sent, failed, reason }  -- reason is '' when every send landed. */
export async function pushTopic(db, topic, payload, opts) {
  let rows;
  try {
    rows = await fetchAll(() => db.from('settings').select('key, value').ilike('key', PUSH_SUB_PREFIX + '%'));
  } catch (e) {
    return { sent: 0, failed: 0, reason: String((e && e.message) || e).slice(0, 120) };
  }
  const want = K(topic);
  const targets = (rows || [])
    .map(r => ({ code: String(r.key || '').slice(PUSH_SUB_PREFIX.length),
      subs: parseSubs_(r.value).filter(s => (s.topics || []).map(K).includes(want)) }))
    .filter(t => t.subs.length);
  if (!targets.length) return { sent: 0, failed: 0, reason: 'hakuna simu iliyowashwa / no phone has alerts on' };
  return sendTo_(db, targets, payload, opts);
}
/** ONE code's handsets, for the topic -- how a requester hears about their OWN request and
    nobody else's. Same answer shape as pushTopic; never throws. */
export async function pushCode(db, code, topic, payload, opts) {
  if (!K(code)) return { sent: 0, failed: 0, reason: 'hakuna msimbo / no code on the row' };
  let subs;
  try { subs = await readSubs_(db, code); }
  catch (e) { return { sent: 0, failed: 0, reason: String((e && e.message) || e).slice(0, 120) }; }
  const want = K(topic);
  subs = subs.filter(s => (s.topics || []).map(K).includes(want));
  if (!subs.length) return { sent: 0, failed: 0, reason: 'simu ya ' + K(code) + ' haijawashwa / ' + K(code) + ' has no phone on' };
  return sendTo_(db, [{ code, subs }], payload, opts);
}
/** The one line a screen shows about several sends: '' when every phone that should have
    heard did, otherwise what went wrong. */
export function pushNoteOf(...results) {
  return results.filter(r => r && (r.failed || !r.sent)).map(r => r.reason).filter(Boolean).join('; ').slice(0, 240);
}
const withTimeout_ = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(Object.assign(new Error('push timeout'), { statusCode: 0 })), ms);
  Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});
async function sendTo_(db, targets, payload, opts) {
  const deadline = Date.now() + ((opts && opts.budgetMs) || FANOUT_BUDGET_MS);
  let sent = 0, failed = 0;
  const reasons = [];
  /* The app's rows first: one queue write per code that has the app registered, whatever the
     number of handsets -- each of them reads the same queue. No signing key is needed for it. */
  const apkCodes = [...new Set(targets.filter(t => t.subs.some(s => s.kind === 'apk')).map(t => t.code))];
  await Promise.all(apkCodes.map(async code => {
    try { await enqueue_(db, code, payload); sent++; }
    catch (e) { failed++; reasons.push('app queue: ' + String((e && e.message) || e).slice(0, 80)); }
  }));
  const webTargets = targets.map(t => ({ code: t.code, subs: t.subs.filter(s => s.kind !== 'apk') })).filter(t => t.subs.length);
  if (!webTargets.length) return { sent, failed, reason: failed ? [...new Set(reasons)].join('; ').slice(0, 200) : '' };
  const k = vapidKeys();
  if (!k) return { sent, failed: failed + webTargets.reduce((n, t) => n + t.subs.length, 0), reason: 'funguo za arifa hazipo / push keys not configured' };
  const subject = env('VAPID_SUBJECT') || DEFAULT_SUBJECT;
  const body = JSON.stringify(payload || {});
  const gone = new Map();                 // code -> endpoints the push service no longer knows
  const jobs = [];
  for (const t of webTargets) for (const s of t.subs) jobs.push({ code: t.code, sub: s });
  await Promise.all(jobs.map(async j => {
    const left = deadline - Date.now();
    if (left <= 500) { failed++; reasons.push('muda umeisha / out of time'); return; }
    try {
      await withTimeout_(sendImpl({ endpoint: j.sub.endpoint, keys: j.sub.keys }, body, {
        vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey },
        TTL: 6 * 3600, urgency: 'high', timeout: Math.min(SEND_TIMEOUT_MS, left),
      }), left);
      sent++;
    } catch (e) {
      failed++;
      const st = e && e.statusCode;
      /* 404 and 410 are the push service saying "this phone unsubscribed" -- the browser was
         reinstalled, the site data cleared, the switch turned off elsewhere. Kept, it would
         fail on every request for ever; dropped, the bell shows OFF and the switch works. */
      if (st === 404 || st === 410) {
        if (!gone.has(j.code)) gone.set(j.code, new Set());
        gone.get(j.code).add(j.sub.endpoint);
      }
      reasons.push(st ? 'push service ' + st : String((e && e.message) || e).slice(0, 80));
    }
  }));
  for (const [code, eps] of gone) {
    try {
      const subs = (await readSubs_(db, code)).filter(s => !eps.has(s.endpoint));
      await writeSubs_(db, code, subs);
    } catch (e) { /* the drop is housekeeping; the count already says what happened */ }
  }
  return { sent, failed, reason: failed ? [...new Set(reasons)].join('; ').slice(0, 200) : '' };
}
