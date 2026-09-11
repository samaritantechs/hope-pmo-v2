/* =======================================================================================
   THE PHONE'S END OF THE COMPANY REGISTER -- what an enrolled handset may say and ask.
   =======================================================================================
     "GM wants us to enroll and lock all our hope company phones ... some of uor unworth
      employees quit with our phones"

   The portal's half (portal-core.js) is the OFFICE's: who is enrolled, what state each
   handset is meant to be in, and who ordered it. This is the HANDSET's half, and it exists
   because `state` and `reported` are worthless until something on the phone actually writes
   one of them. A lock order that nothing ever confirms is a row in a table, not a locked
   phone.

   WHY THIS IS NOT BEHIND THE PORTAL DOOR. A phone in a field officer's pocket has no access
   code and never will; asking it to sign in the way a portal user does would mean shipping a
   staff credential inside an APK we are handing to the very people we may one day need to
   lock out. So the credential is per-device instead: enrolment mints one random token, it
   goes into that one phone at provisioning, and it authorises exactly one IMEI.

   WHAT A STOLEN TOKEN BUYS, stated plainly rather than assumed away: whoever holds it can
   report false status for THAT phone -- claim "unlocked" while locked, or the reverse -- and
   flatten its battery reading. They CANNOT read the register, cannot reach another IMEI,
   cannot change what the office decided, and cannot unlock anything: the command always
   flows office -> phone, and `state` is never writable from here. That asymmetry is the
   whole security model, and it is why a phone can never talk itself free.

   THE COMMAND IS DERIVED, NEVER QUEUED. There is no pending-commands table to drift out of
   step with the register; the answer to "what should I be doing" is computed from `state` on
   every beat. A phone that misses a week of heartbeats gets the CURRENT truth the moment it
   comes back, not a stale backlog replayed at it.

   ================== AND IT MUST NOT COST THE UPLOAD OR THE CALL APP ==================
   Rule one of this repository is that uploading and the call app never go down and never
   slow down. Three hundred company handsets beating against the SAME Postgres that serves
   those two is the first thing in this system that could break that rule by simply existing
   -- not through a slow query, but through sheer count.

   So the pace is deliberately NOT Hoop's. Hoop beats every 60 seconds, on phones whose
   OWNERS pay the airtime and against a database serving a dealership. Here the company pays
   the data and the database is the one three hundred officers are already working through.
   The steady beat is therefore a QUARTER HOUR, and the short pace is used only while an
   order is outstanding -- seconds, and it closes the moment the phone confirms. Pressing
   Funga still reaches a phone in seconds; it is being idle that is cheap.

   Both numbers are settings, not constants in an APK: the right pace is a business judgement
   about data cost and database load, and it must never need an app release to revisit.
   ======================================================================================= */
import { fetchAll } from './supabase.js';

/* A beat is cheap and constant; an event row is not. Writing history on every heartbeat
   would bury the state changes that matter under thousands of "still locked, still 84%"
   rows, so the trail records TRANSITIONS only -- the moment a phone's own story changed. */
/* `issued_at` is here for one reason: together with `holder` it answers "has this phone left
   the store", which is what decides whether silence may ever lock it. See graceFor(). */
const BEAT_COLS = 'imei, item, state, state_reason, reported, enrol_token, holder, issued_at';

const S = v => String(v == null ? '' : v).trim();

/* What the office's decision means as an instruction to the handset.
     enrolled  on the register, no lock ordered -- run, stay quiet, keep reporting
     locked    lock now
     released  handed back for good; this phone has been set free
     lost      written off -- an employee left with it and is not bringing it back. It stays
               LOCKED: a handset we have given up on is exactly the one that must not quietly
               come back to life if somebody reinstates it. */
export function commandFor(state) {
  switch (S(state)) {
    case 'locked': return 'lock';
    case 'lost':   return 'lock';
    case 'released':
    case 'enrolled':
    default:       return 'unlock';
  }
}

/* THE LINES ON A LOCKED PHONE, and why every one of them comes from here.
   =========================================================================================
   A locked company handset draws something like:

       HOPE MICROCREDIT
       SIMU HII NI MALI YA HOPE MICROCREDIT. IRUDISHE OFISINI AU PIGA 0659077770.
       IMEI: 351388334583295
       SABABU: AMEACHA KAZI NA SIMU

   Not one of those lines is baked into the APK, and that is the point. The company name has
   changed before, the number a stranded person is told to call changes on a Tuesday, and the
   reason changes per handset. A phone in somebody's pocket for eighteen months cannot be
   waiting on an app release for any of them, so the APK holds only the LAYOUT and the server
   holds every word in it.

   {brand} and {namba} are filled here rather than on the handset for the same reason: one
   substitution, on a machine we can fix, instead of the same little parser in every build of
   the app that is already out there. */
const LOCK_SETTINGS = ['DEVICE_LOCK_BRAND', 'DEVICE_LOCK_MESSAGE', 'DEVICE_HELP_PHONE',
  'DEVICE_LOCK_REASON'];

const DEFAULT_BRAND = 'HOPE MICROCREDIT';

function fill(text, brand, phone) {
  return S(text)
    .replace(/\{\s*(brand|kampuni)\s*\}/gi, brand)
    .replace(/\{\s*(namba|phone|simu)\s*\}/gi, phone)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* THE SETTINGS A BEAT LEANS ON, AND WHY A FAILURE HERE MUST NOT REACH THE HANDSET.
   =========================================================================================
   Several reads of `settings` hang off every beat -- the lock screen's words, the offline
   grace, the beat pace. Every one of them DECORATES the answer; none of them decides whether
   a phone locks or unlocks, which is the only thing the beat exists to carry.

   Left unguarded, a settings table that is slow, migrating or briefly unreachable would
   throw straight out of the beat. That is a 500 to the handset, and a handset that gets a
   500 does nothing at all: the phone stays exactly as it was. For a LOCKED phone whose
   holder has just settled up, "stays as it was" means stays locked -- and the whole fleet
   with it, for as long as the wobble lasts, over a brand name and two numbers.

   So the reads fail soft. A settings outage costs the lock screen its custom wording; it can
   no longer cost anybody their unlock.

   NULL FOR "COULD NOT ASK", EMPTY FOR "ASKED, NOTHING SET" -- the same three-state care the
   rest of this system takes. Collapsing them would be a bug: an unset key has to fall
   through to the default, and an unreachable table must not, or a wobble would silently hand
   every handset a window it was never given. */
async function readSettings(db, keys) {
  try {
    return await fetchAll(() => db.from('settings').select('key, value').in('key', keys));
  } catch (e) {
    return null;
  }
}

async function lockWords(db) {
  // Unreadable settings read the same as unset ones here: the lock screen falls back to the
  // default brand and drops the help number rather than promising one it does not have.
  const rows = (await readSettings(db, LOCK_SETTINGS)) || [];
  const get = k => { const r = rows.find(x => S(x.key) === k); return r ? S(r.value) : ''; };
  const brand = get('DEVICE_LOCK_BRAND') || DEFAULT_BRAND;
  const phone = get('DEVICE_HELP_PHONE');
  /* Two defaults, not one, because "Piga namba ." is what a single default with an unset
     number produces -- a sentence promising a number that is not there, on the one screen
     where that is worst. No number, no promise of one. */
  const raw = get('DEVICE_LOCK_MESSAGE')
    || (phone ? 'Simu hii ni mali ya {brand}. Irudishe ofisini au piga {namba}.'
              : 'Simu hii ni mali ya {brand}. Irudishe ofisini.');
  return {
    brand,
    message: fill(raw, brand, phone),
    helpPhone: phone || null,
    /* The reason a self-lock shows. An ordered lock always carries its own -- the portal
       refuses to send one without -- but a phone that locked itself on the offline grace was
       never given words by anybody, and a blank reason on the screen is worse than a dull
       sentence from settings. */
    fallbackReason: get('DEVICE_LOCK_REASON'),
  };
}

/* THE PACE. Both numbers live on the server rather than in the APK, which is what makes this
   a decision rather than a release: change them and the whole fleet follows on its next
   beat, including handsets already in the field.

   THE STEADY BEAT IS A QUARTER HOUR, and the reasoning is in the header of this file: three
   hundred handsets against the database that serves the upload and the call app, on data the
   company pays for. At fifteen minutes that is ~17 MB per handset per month and a write
   every three seconds across the fleet. At Hoop's sixty seconds it would be ~260 MB and five
   writes a second, which is a rule-one risk taken for nothing: the short pace below already
   makes an ORDER arrive in seconds, and the rest of the time there is nothing to say.

   AND IT IS A CEILING, NOT A PROMISE. Android defers jobs on an idle handset to its own
   maintenance windows, so a phone asleep in a drawer drifts past whatever is set here. */
const BEAT_SECONDS = 15 * 60;
const PENDING_BEAT_SECONDS = 25;
async function paceFor(db) {
  const rows = await readSettings(db, ['DEVICE_BEAT_SECONDS', 'DEVICE_PENDING_BEAT_SECONDS']);
  const pick = (key, dflt, min) => {
    if (rows === null) return dflt;                    // could not ask: the standing default
    const hit = rows.find(r => S(r.key) === key);
    const raw = hit ? Number(S(hit.value)) : NaN;
    /* A FLOOR THAT CANNOT BE TYPED AWAY. Every other number in this file is the admin's to
       set freely; this one is not, because a typo of 1 here is three hundred handsets
       hammering the database the upload runs on. Ten seconds for a pending order, sixty for
       the steady beat -- below that the setting is treated as the mistake it is. */
    return Number.isFinite(raw) && raw >= min ? Math.round(raw) : dflt;
  };
  return {
    steady: pick('DEVICE_BEAT_SECONDS', BEAT_SECONDS, 60),
    pending: pick('DEVICE_PENDING_BEAT_SECONDS', PENDING_BEAT_SECONDS, 10),
  };
}

/* HOW LONG A PHONE MAY GO UNHEARD-FROM BEFORE IT LOCKS ITSELF.
   =========================================================================================
   This is the hardest honest call in the feature, and it belongs on the server rather than
   in the APK so it can be changed without shipping a build to every handset.

   A phone that cannot reach us cannot be told to lock. Do nothing about that and "keep it in
   airplane mode" defeats the entire system -- which is exactly what somebody who has decided
   to walk off with a company handset will do. Lock on every missed beat and we strand an
   officer who spent a day in a village with one bar, which on this fleet means they cannot
   work their list either.

   The split that resolves it is whether the phone has left the store:

     still in the store  null -- NEVER self-lock. Spare handsets in a drawer are offline for
                         weeks by design, and a shelf that locked itself in the dark would be
                         a self-inflicted wound with no upside at all.
     issued to somebody  a real number, generously set. Counted from the last beat that
                         actually SUCCEEDED, not from the last attempt.

   A self-lock is never the phone judging its holder. It is the handset saying "I have not
   heard from the office in far too long", and the moment it reaches us again the office's
   real answer wins -- including unlocking it straight back.

   THE DEFAULT IS FOURTEEN DAYS, not Hoop's seven. A field officer can be out of coverage for
   a long stretch of a Tanzanian week, and the cost of a wrong self-lock here is an officer
   who cannot do their round -- the call app is on that same handset. Somebody who has
   actually quit will still hit it; a fortnight of silence from a working officer will not. */
const DEFAULT_GRACE_HOURS = 24 * 14;
async function graceFor(db, dev) {
  if (!S(dev.holder) && !dev.issued_at) return null;          // still in the store: never
  const rows = (await readSettings(db, ['DEVICE_OFFLINE_GRACE_HOURS'])) || [];
  const raw = rows.length ? Number(S(rows[0].value)) : NaN;
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : DEFAULT_GRACE_HOURS;
}

/* THE WINDOW A LOCKED PHONE GETS WHEN IT IS SWITCHED ON AGAIN.
   =========================================================================================
   A locked handset draws a pinned screen the moment it boots, and that screen is the reason
   a phone can be stuck for good: somebody who has HANDED THE PHONE BACK cannot reach
   Settings to turn wifi on, so the handset cannot call home, so it never hears it has been
   released. The office freed it hours ago and the phone will never find out. Without this
   the only way back is a cable.

   So a reboot buys a few minutes of ordinary use -- long enough to pull the shade down and
   turn the radio on, and no longer.

   THREE FENCES, because a window like this is exactly where a loophole would live.
     1. ONLY EVER AT BOOT. Never from a beat, never from a failed unlock, never while the
        phone is awake. A locked handset in somebody's hand cannot talk itself into a window.
     2. RATE-LIMITED, AND THE CLOCK SURVIVES THE REBOOT THAT WOULD RESET IT. Switching the
        phone off and on again is the first thing anybody tries, and it buys nothing: the
        second boot finds the stamp left by the first and locks immediately.
     3. IT ENDS THE INSTANT THE PHONE REACHES US, because at that moment it has served its
        whole purpose -- we can see the handset and it can hear us. */
const DEFAULT_BOOT_GRACE_MINUTES = 5;
const DEFAULT_BOOT_GRACE_EVERY_HOURS = 24;
async function bootGraceFor(db) {
  /* AND HERE THE FAILURE IS NOT THE DEFAULT. Every other read above degrades towards the
     phone staying exactly as locked as it already is; this one would degrade towards OPENING
     a door, so a settings table we could not reach means no window at all. An unset key is a
     different matter and still falls through to five minutes. */
  const rows = await readSettings(db, ['DEVICE_BOOT_GRACE_MINUTES', 'DEVICE_BOOT_GRACE_EVERY_HOURS']);
  if (rows === null) return { minutes: 0, everyHours: 24 };
  const pick = (key, dflt) => {
    const hit = rows.find(r => S(r.key) === key);
    const raw = hit ? Number(S(hit.value)) : NaN;
    /* ZERO IS A REAL ANSWER and means "no window at all". Turning this off for the fleet is a
       decision the office must be able to make, so it cannot fall through to the default the
       way a blank or a typo does. Negative is a typo and is treated as one. */
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : dflt;
  };
  return {
    minutes: pick('DEVICE_BOOT_GRACE_MINUTES', DEFAULT_BOOT_GRACE_MINUTES),
    everyHours: pick('DEVICE_BOOT_GRACE_EVERY_HOURS', DEFAULT_BOOT_GRACE_EVERY_HOURS),
  };
}

/* THE TOKEN IS THE IDENTITY, and the handset's claim about itself is not.
   Resolving by token means the app never has to be right about which of a dual-SIM phone's
   two IMEIs we wrote down -- an API that has changed shape three times across the Android
   versions this fleet spans, where an honest phone reading the wrong slot would otherwise
   look exactly like an attack.

   Every failure -- no token, an unknown token, a row with no token at all -- gives the SAME
   answer, because saying which turns this endpoint into an oracle for probing the fleet. */
async function byToken(db, p) {
  const token = S(p && p.token);
  if (!token) { const e = new Error('Token required'); e.status = 400; throw e; }
  const rows = await fetchAll(() => db.from('devices').select(BEAT_COLS).eq('enrol_token', token));
  const dev = rows.find(r => S(r.enrol_token) === token) || null;
  if (!dev) { const e = new Error('Not enrolled'); e.status = 403; throw e; }
  return dev;
}

/* ---------------------------------------------------------------------------------------
   THE HEARTBEAT. One call does both directions: the phone says what it is, and is told what
   it should be. Deliberately one round trip -- these run on cellular data in places with one
   bar, and every extra request is another chance to not arrive.
   --------------------------------------------------------------------------------------- */
async function beat(db, [payload], nowMs) {
  const p = payload || {};
  const dev = await byToken(db, p);
  const imei = S(dev.imei);

  const at = new Date(nowMs).toISOString();
  const reported = p.locked === true ? 'locked' : p.locked === false ? 'unlocked' : null;
  const patch = { last_seen: at, updated_at: at };
  if (reported) patch.reported = reported;
  if (S(p.appVersion)) patch.app_version = S(p.appVersion).slice(0, 40);
  if (S(p.android)) patch.android = S(p.android).slice(0, 40);
  /* WHAT THE HANDSET THINKS ITS OWN IMEI IS, kept beside the register's rather than checked
     against it. A dual-SIM phone HAS two IMEIs and getImei() is not consistent across Android
     versions, so treating a difference as proof the token walked would cry wolf on ordinary
     hardware. Recorded, shown on the device's own row, and left for a person to judge --
     which is the honest handling of a signal this noisy. */
  if (S(p.imei)) patch.reported_imei = S(p.imei).slice(0, 32);
  // A battery reading is only ever 0-100; anything else is a bug on the handset, not a fact.
  const bat = Number(p.battery);
  if (Number.isFinite(bat) && bat >= 0 && bat <= 100) patch.battery = Math.round(bat);
  /* WHERE THE HANDSET WAS WHEN IT LAST SPOKE, with the age of the fix beside it.
     -----------------------------------------------------------------------------------------
       "add location tracking too, GM will want it."

     The phone reports its LAST KNOWN position rather than waking the GPS every minute, so the
     fix can be much older than the beat carrying it. `last_loc_at` is what keeps those two
     facts apart; collapse them and the register starts claiming a phone is somewhere it left
     on Tuesday, which is worse than having no position at all, because somebody drives there.

     Range-checked rather than trusted, and dropped WHOLE when it fails -- half a coordinate is
     a point in the sea. */
  const lat = Number(p.lat), lng = Number(p.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)
      && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      && !(lat === 0 && lng === 0)) {        // 0,0 is the Gulf of Guinea, i.e. "no fix"
    patch.last_lat = lat;
    patch.last_lng = lng;
    const acc = Number(p.locAcc);
    patch.last_loc_acc = Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null;
    /* Trust the handset's clock only where it produces a plausible past moment. A fix stamped
       in the future, or at the epoch, tells us the phone's clock is wrong -- not where it is --
       so the beat's own time stands in and the age shown is honest about what we know. */
    const when = Number(p.locAt);
    patch.last_loc_at = Number.isFinite(when) && when > 946684800000 && when <= nowMs + 86400000
      ? new Date(when).toISOString() : at;
  }

  let { error } = await db.from('devices').update(patch).eq('imei', imei);
  /* Pre-migration tolerance: `reported_imei` and the location columns may not be there yet,
     and PostgREST refuses the whole update for one unknown column. The beat itself matters
     more than any of them -- a phone that cannot report its state is a phone the office has
     lost, while one that cannot report what it thinks its IMEI is, or where it was, is merely
     one somebody cannot double-check or cannot go and find. */
  if (error && /reported_imei|last_lat|last_lng|last_loc_acc|last_loc_at/
        .test(String(error.message || ''))) {
    const { reported_imei, last_lat, last_lng, last_loc_acc, last_loc_at, ...rest } = patch;
    ({ error } = await db.from('devices').update(rest).eq('imei', imei));
  }
  if (error) throw new Error(error.message);

  // History gets the transition, never the heartbeat -- see the note on BEAT_COLS.
  if (reported && reported !== S(dev.reported)) {
    await db.from('device_events').insert([{
      imei, event: 'heartbeat', from_state: dev.reported || null, to_state: reported,
      reason: 'reported by handset', actor: 'device', at }]);
  }

  const command = commandFor(dev.state);
  const retire = S(dev.state) === 'released';
  /* THE WORDS GO DOWN ON EVERY BEAT, not only when the answer is "lock", because of the
     offline grace: a phone that self-locks in a dead spot draws its screen from whatever it
     last stored, so if the words only travelled alongside a lock order, the one handset that
     locks with nobody around to explain it would be the one showing a blank screen.

     WITH ONE EXCEPTION: a phone being handed back for good gets no words at all. It is about
     to unharden, stop being Device Owner and stop calling home, and leaving our lock message
     in a former employee's storage is the opposite of releasing it. */
  const words = retire ? { brand: null, message: null, helpPhone: null, fallbackReason: '' }
                       : await lockWords(db);
  const grace = await graceFor(db, dev);
  const boot = retire ? { minutes: 0, everyHours: 0 } : await bootGraceFor(db);
  const pace = await paceFor(db);
  /* HAS THIS PHONE DONE WHAT IT WAS TOLD? Compare the order against what the handset just
     said it is doing -- `reported` from this very beat when it spoke, the stored value when
     it did not. A phone that has never reported at all counts as unlocked, which is true: it
     is not showing a lock screen. A retiring phone is never "unsettled" -- it is on its way
     out, and hurrying it changes nothing. */
  const nowLocked = S(reported || dev.reported) === 'locked';
  const settled = retire || command === (nowLocked ? 'lock' : 'unlock');
  return {
    ok: true,
    command,                                   // lock | unlock
    state: dev.state,
    /* Ordered locks carry their own reason; a self-lock has none to carry, so it gets the one
       from settings. Either way the handset is never left with an empty reason line. */
    reason: retire ? null : (S(dev.state_reason) || words.fallbackReason || null),
    // The register's IMEI, not the handset's guess at it. This is the number on the report and
    // the one somebody will read out on the phone, and on Android 10+ it is the only one a
    // handset can put on its own lock screen at all.
    imei,
    brand: words.brand,
    message: words.message,
    helpPhone: words.helpPhone,
    // -1 rather than null: the handset parses this into an int, and "never" has to survive
    // that trip as a value it can act on rather than as a missing field it has to guess at.
    graceHours: grace == null ? -1 : grace,
    bootGraceMinutes: boot.minutes,
    bootGraceEveryHours: boot.everyHours,
    // So a released phone can stop calling home for good rather than beating forever.
    retire,
    /* WHEN TO COME BACK -- decided here, because only the server knows whether an order is
       still outstanding. The answer is short ONLY while the register and the handset disagree:
       an order given and not yet carried out. That window is seconds long in practice and
       closes the moment the phone confirms; steady state stays at the quarter hour. */
    nextBeatSeconds: settled ? pace.steady : pace.pending,
  };
}

/* ---------------------------------------------------------------------------------------
   PROVISIONING. The freshly-flashed phone's first words: "here is the token that was put in
   me -- who am I?" It carries no status yet, so it is not a beat; it is the handshake that
   tells the bench the token reached the handset before the box is closed again.
   --------------------------------------------------------------------------------------- */
async function hello(db, [payload], nowMs) {
  const p = payload || {};
  const dev = await byToken(db, p);
  const at = new Date(nowMs).toISOString();
  await db.from('devices').update({ last_seen: at, updated_at: at }).eq('imei', dev.imei);
  const words = await lockWords(db);
  return { ok: true, imei: dev.imei, item: dev.item || null, state: dev.state,
    holder: dev.holder || null,
    command: commandFor(dev.state), reason: S(dev.state_reason) || words.fallbackReason || null,
    brand: words.brand, message: words.message, helpPhone: words.helpPhone };
}

/* ---------------------------------------------------------------------------------------
   THE CLAIM: a phone asks which of a batch it is, instead of being told.

   A token is minted for ONE IMEI, so a command carrying one can only be run against one
   handset -- and looping that across a USB hub would let plug-in ORDER decide which phone got
   which identity, with nothing downstream to catch a swap, because a beat resolves a handset
   BY ITS TOKEN and files what it says under the row that token belongs to.

   So the bench command carries a BATCH token -- the same string for every handset, which is
   what makes it safe to broadcast to all of them at once -- and the phone sends back the IMEI
   it reads off itself to collect the token minted for it.

   THE IMEI IS A SELECTOR HERE, NEVER A CREDENTIAL, which is why this is allowed when the rule
   above says the handset's claim about itself is not its identity. It cannot obtain a token on
   its own: it only picks between the handful of rows the office deliberately put in one batch,
   minutes earlier. Getting it wrong loses you a phone from the batch; it can never win you
   another phone's identity.

   IT FAILS CLOSED, and every refusal is identical -- distinguishing them would turn this into
   an oracle for asking the office which IMEIs it is holding. */
const BATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/* SAY NOTHING TO THE HANDSET, WRITE IT DOWN FOR THE OFFICE.
   =====================================================================================
   The refusal above is deliberately opaque and must stay that way. But the person it is
   actually about is at a bench with the phone on a cable, and until now the system told
   them nothing either: the claim writes no row, the handset has no row, and the register
   shows no trace of a phone that tried to enrol and was turned away. Three hundred handsets
   go through this, and the commonest bench failure of all -- the IMEI on the stock sheet is
   not the IMEI in the phone -- produced a dead end with no thread to pull.

   So a refused claim is filed in device_events, where the Locking pane reads it back (see
   deviceList). It carries THE IMEI THE HANDSET PRESENTED, which is the one fact the operator
   cannot obtain any other way and the one that ends the hunt in a glance.

   WHY THIS IS NOT A WRITE ANYBODY CAN PROVOKE. It runs only after the batch has been proved
   REAL AND LIVE -- a 32-hex secret minted by the office and good for a day -- so the only
   party who can cause a row here is the bench that was handed it, writing one row per
   broadcast it runs. An unknown or stale batch is still refused with nothing written at all,
   which is what keeps /api/device from being a table anyone can fill.

   AND IT NEVER CHANGES THE ANSWER. The insert is wrapped because bookkeeping that fails must
   not turn a 403 into a 500: the handset would then read "THE OFFICE REFUSED THIS PHONE
   (HTTP 500)" and the operator would go looking for a broken server instead of a wrong
   number. */
async function noteRefusal_(db, said, why, nowMs) {
  try {
    await db.from('device_events').insert([{
      imei: said[0], event: 'claim-refused', actor: 'device',
      reason: 'simu ilijitambulisha / handset presented: ' + said.join(', ').slice(0, 120)
        + ' — ' + why,
      at: new Date(nowMs).toISOString(),
    }]);
  } catch (ignored) { /* deliberately swallowed -- see the note above */ }
}

async function claim(db, [payload], nowMs) {
  const p = payload || {};
  const batch = S(p && p.batch);
  const refuse = () => { const e = new Error('Not in this batch'); e.status = 403; throw e; };
  if (!batch) { const e = new Error('Batch required'); e.status = 400; throw e; }

  /* Whatever the handset managed to read. One entry on a single-SIM phone, two on a dual, and
     none at all on a build that refuses -- which is a refusal here, not a guess. */
  const said = (Array.isArray(p.imeis) ? p.imeis : [p.imei])
    .map(S).filter(Boolean);
  if (!said.length) refuse();

  let rows = [];
  try {
    rows = await fetchAll(() => db.from('devices')
      .select('imei, enrol_token, enrol_batch_at').eq('enrol_batch', batch));
  } catch (e) {
    // Before the migration there is no such column, so there is no batch to be in. Same
    // refusal: this endpoint never explains itself to a handset.
    if (/enrol_batch/i.test(String(e && e.message || ''))) refuse();
    throw e;
  }
  if (!rows.length) refuse();

  /* The batch is a bearer secret for the length of a bench session. Whoever holds it, plus an
     IMEI that is in it, can obtain that device's token -- exactly the power the bench needs
     and exactly the power nobody should still hold next week. */
  const issued = rows.map(r => Date.parse(r.enrol_batch_at || '')).filter(t => !isNaN(t));
  if (!issued.length || nowMs - Math.max(...issued) > BATCH_MAX_AGE_MS) refuse();

  /* PAST HERE THE BATCH IS GENUINE AND STILL OPEN, so a refusal is a bench problem rather
     than a stranger knocking -- and that is exactly the one worth filing. */
  const dev = rows.find(r => said.includes(S(r.imei)));
  if (!dev) {
    await noteRefusal_(db, said, 'haipo kwenye batch hii / not one of the IMEIs in this batch',
      nowMs);
    refuse();
  }
  if (!S(dev.enrol_token)) {
    await noteRefusal_(db, said, 'ipo kwenye batch lakini haina token / in the batch but its '
      + 'row carries no token', nowMs);
    refuse();
  }
  return { ok: true, token: S(dev.enrol_token) };
}

const FNS = { dev_hello: hello, dev_beat: beat, dev_claim: claim };

/** Same transport shape as callApi: one route, a named fn, positional args. */
export async function deviceApi(db, fn, args, nowMs = Date.now()) {
  /* OWN PROPERTIES ONLY. FNS is an object literal, so `FNS['constructor']` and friends are
     truthy and would be CALLED with (db, args, nowMs) -- past every guard each real handler
     begins with. This door is the one that is not behind an access code at all, so it matters
     more here than anywhere else in the system. */
  const f = Object.prototype.hasOwnProperty.call(FNS, S(fn)) ? FNS[S(fn)] : null;
  if (typeof f !== 'function') { const e = new Error('Unknown function: ' + S(fn)); e.status = 400; throw e; }
  return f(db, Array.isArray(args) ? args : [args], nowMs);
}
