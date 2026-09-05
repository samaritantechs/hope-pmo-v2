import { fetchAll, runQuery, rpcAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { TZ_OFFSET_MS, todayKey, weekMondayKey, isoWeekday, addDaysKey } from './time.js';
import { latestSnapshot, snapshotsInRange, resolveLatestPerKey, upperTeams, teamMatchList } from './snapshots.js';
import { expectedTotalsInRange, expectedTotalsLatest, tCustomers, tExpected, tCollected } from './snapshot-totals.js';
import { buildDashboard, SALES_STAGES } from './dashboard-core.js';
import { collectedOf } from './recovery.js';
import { expdfMine } from './expdf.js';
import { isSystemOpen } from './system-gate.js';
/* The Iliyonasia register and the one function that folds it into a collection figure. */
import { adjReceived_, withAdj_, ADJ_BUDGET_MS } from './adjustments.js';
import { notifCore, notifSeenCore, notifKeyFor } from './notify.js';
import { statusWithPaid } from './settled.js';
/* The collection role has ONE definition in this system and it lives here -- a setting, not a
   constant, because it is typed by a person. Asking the same question the PMO board asks is
   what stops the two screens disagreeing about who is a collection officer. */
import { isPmoRole, hasCollectionWord, PMO_ROLE_KEY, PMO_ROLE_DEFAULT } from './pmo.js';

/** The HOPE Calls backend, ported from the api_call* family in the live Code.gs -- same
    endpoints, same shapes, so call.html works against either system. Differences are all
    upgrades the engine gives for free:
      - dedup is the call_logs PRIMARY KEY (insert ... on conflict do nothing), not a
        script lock racing a sheet read;
      - no weekly archive gymnastics -- Postgres has no cell cap, call_logs just grows
        and stays indexed;
      - the daily-summary strip reuses dashboard-core.js, so it reconciles with the
        portal dashboard BY CONSTRUCTION (one formula, one file), recovery basis included. */

export const APP = { BRAND: 'HOPE MICROCREDIT CO. LTD', MOTTO: 'MKOPO CHAP CHAP' };
export const FU_STATUSES = [
  'AMENASIA / WRONG REF', 'HAJAPATA MKOPO', 'HAPATIKANI YEYE & MDHAMINI',
  'YEYE / MDHAMINI HANA USHIRIKIANO', 'AMETOA AHADI', 'ANALIPA LEO',
  'AMETUMA KWA AFISA', 'REJESHO LIMELIWA', 'ANA NAMBA NYINGINE', 'OTHERS',
];
export const FU_NEED_DATE = ['AMETOA AHADI'];
export const FU_NEED_COMMENT = ['AMETUMA KWA AFISA', 'REJESHO LIMELIWA', 'OTHERS'];
export const FU_NEED_NUMBER = ['ANA NAMBA NYINGINE'];

/* =====================================================================================
   THE FOLLOW-UP STATUS LIST IS EDITABLE, AND A NEW ONE IS ALWAYS A PLAIN COMMENT.
   =====================================================================================
   "defaulters followup status management -- edit existing/add new fu_status; new ones should
    be plain-comment type with no calendar or new-number characteristics"

   The ten above are the ones the system BEHAVES differently for: AMETOA AHADI opens a promise
   date, ANA NAMBA NYINGINE opens a replacement number, and three of them require a comment.
   Those behaviours are wired into the promise report, the bell, the assignment rotation and
   the phone's follow-up sheet -- they are not decorations on a word.

   So the list is editable and the BEHAVIOURS ARE NOT. A status somebody adds is a plain
   comment: no calendar, no number box, nothing downstream that has to know its name. That is
   what was asked for, and it is also the only version that is safe -- a new word that silently
   acquired a promise date would start writing rows into the promise report that no report
   knows how to read.

   A built-in status can be REMOVED from the list, and its behaviour goes with it: the need-date
   and need-number sets are intersected with whatever the list actually contains, so a
   deployment that has no use for AMETOA AHADI is not left with a calendar for a word nobody
   can choose.

   Stored as one setting, one per line. Until an admin edits it the built-in list is what
   everybody sees, so nothing changes by this existing. */
export const FU_STATUS_KEY = 'FU_STATUSES';

/** Parse the stored list. Blank, missing, or nothing but whitespace all mean "use the built-in
    ten" rather than "no statuses at all" -- an empty dropdown is a screen nobody can use, and
    somebody clearing the box by accident must not be able to stop the whole company logging a
    follow-up. */
export function parseFuStatuses(raw) {
  const list = String(raw == null ? '' : raw)
    .split(/[\r\n]+/).map(x => x.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const k = x.toUpperCase();
    if (seen.has(k)) continue;                 // the same word twice is one option, not two
    seen.add(k);
    out.push(x);
  }
  return out.length ? out : FU_STATUSES.slice();
}

/** The list plus the behaviours that survive it. */
export function fuStatusShape(list) {
  const has = new Set(list.map(x => String(x).trim().toUpperCase()));
  const keep = arr => arr.filter(x => has.has(x.toUpperCase()));
  return {
    fuStatuses: list,
    fuNeedDate: keep(FU_NEED_DATE),
    fuNeedComment: keep(FU_NEED_COMMENT),
    fuNeedNumber: keep(FU_NEED_NUMBER),
    // Which of them are the built-ins, so an editing screen can show that removing one takes a
    // behaviour with it, and that the rest are plain comments.
    fuBuiltIn: FU_STATUSES.slice(),
  };
}

/** Read the list for this database. */
export async function fuStatusConfig(db) {
  const raw = await settingGet(db, FU_STATUS_KEY);
  return fuStatusShape(parseFuStatuses(raw));
}

/* ---------- small ports, byte-faithful to Code.gs ---------- */
export function pnorm(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.indexOf('255') === 0) d = d.slice(3);
  d = d.replace(/^0+/, '');
  return d.slice(-9);
}
export function h36(s) {
  s = String(s == null ? '' : s);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
export function dsFmt(v) {                       // D.S / DUE SUMMARY = paid/target, NOT a date
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-]\d{2,4}$/);
  return m ? (m[1] + '/' + m[2]) : s;
}
const K = s => String(s == null ? '' : s).trim().toUpperCase();
const num = v => (typeof v === 'number' ? v : Number(v) || 0);
function eatStamp(ms) {                          // 'yyyy-mm-dd HH:MM' on the EAT clock
  const d = new Date(ms + TZ_OFFSET_MS);
  return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16);
}
function eatDate(ms) { return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10); }
function eatTime(ms) { return new Date(ms + TZ_OFFSET_MS).toISOString().slice(11, 16); }

async function settingGet(db, key) {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  return data ? data.value : null;
}

/** SEVERAL SETTINGS, ONE ROUND TRIP. Boot asked for five of them one after another -- five
    separate journeys to the database, each returning a single row, each one holding a
    connection while three hundred handsets opened the app on the same Monday morning. They
    are all in the same table and none of them depends on the answer to another, so they are
    one `in` query. Same values, a fifth of the traffic, and four fewer things to wait for on
    a mobile connection. */
async function settingsMany(db, keys) {
  const rows = await fetchAll(() => db.from('settings').select('key, value').in('key', keys));
  const by = {};
  for (const r of rows) by[String(r.key)] = r.value;
  return k => (by[k] == null ? null : by[k]);
}

/* ---------- users ---------- */
/** Every request resolves the device to an account here, so this is the one place that has
    to honour deactivation. Checking `active` only at registration would mean a revoked
    officer kept working until they happened to sign out -- which they never do. */
async function userByDevice(db, dev) {
  dev = String(dev == null ? '' : dev).trim();
  if (!dev) return null;
  const { data, error } = await db.from('call_users').select('*').eq('device_id', dev).limit(1);
  // The error was being dropped on the floor, so ANY database failure here surfaced to the
  // officer as "device not registered" -- sending them to re-register, which cannot fix it.
  if (error) throw new Error(error.message);
  const cu = (data && data[0]) || null;
  if (!cu) return null;
  if (cu.active === false) { const e = new Error('ACCOUNT_OFF'); e.accountOff = true; throw e; }
  return cu;
}
/** Callers that answer with ok:false rather than throwing need the two cases apart: a device
    nobody has registered is a sign-in prompt, a switched-off account is not. */
async function userByDeviceSoft(db, dev) {
  try { return await userByDevice(db, dev); }
  catch (e) { if (e && e.accountOff) return null; throw e; }
}
/** A call_users row -> the same {name, role, teams} shape authCode returns, so teamAllowed
    works identically whether the caller came from the portal or the calls app. */
export function pseudoUser(cu) {
  const lt = cu.leader_teams;
  /* A HOME TEAM OF NULL MEANS EVERY TEAM, NOT A TEAM CALLED "".
     An ALL-teams admin registers with team = NULL on purpose (call_users.team is a foreign key,
     so the literal 'ALL' used to break registration outright). Wrapping that null in an array
     scoped them to a team name that does not exist, so every figure came back zero -- which is
     how the performance strip showed dashes for the one person most likely to be looking at it.
     The lists escaped it because they take their own path; the strip did not. */
  const teams = !cu.is_leader ? (K(cu.team) ? [K(cu.team)] : null)
    : (!lt || !lt.length || lt.some(t => K(t) === 'ALL')) ? null
    : lt.map(t => K(t)).filter(Boolean);
  return { name: cu.name, role: cu.role, teams };
}
/** The rotation names people by the teams table's role columns, so holding one of those
    columns anywhere is what counts -- not the role on their access code. */
async function isRecycleLeader(db, name) {
  const n = K(name);
  if (!n) return false;
  const rows = await fetchAll(() => db.from('teams').select('gmo, manager, bike'));
  return rows.some(t => K(t.gmo) === n || K(t.manager) === n || K(t.bike) === n);
}
async function teamList(db) {
  const rows = await readTeamsAll(db);
  return rows.filter(r => r.team).map(r => r.team).sort();
}

/* ---------- boot / register ---------- */
/* THREE HUNDRED HANDSETS OPEN THIS AT THE SAME TIME ON A MONDAY MORNING, and it used to be
   TEN ROUND TRIPS TAKEN ONE AFTER THE OTHER: the teams list, the device, CALL_BRAND,
   CALL_LOGO_URL, the open/closed switch, today's calls, CALL_SYNC_SECONDS,
   CALL_LOGOUT_ENABLED, the teams table AGAIN for the rotation check, and the follow-up status
   list. Nine of those ten waits bought one small answer each.

   Nothing here depended on the answer to the thing before it, so nothing here should have been
   waiting for it:

     five settings   -> ONE `in` query (settingsMany)
     teams read x2   -> ONE read, shared with the rotation check
     what is left    -> issued together, not in single file

   The officer's app opens in one wait instead of ten, and a Monday-morning rush costs the
   database a third of the connections it used to. */
async function boot(db, [dev], nowMs) {
  const BOOT_KEYS = ['CALL_BRAND', 'CALL_LOGO_URL', 'CALL_SYNC_SECONDS', 'CALL_LOGOUT_ENABLED', FU_STATUS_KEY, 'DATA_VERSION', 'OFFLINE_PACK'];
  let cu = null, accountOff = false;
  const [teamRows, setting] = await Promise.all([
    fetchAll(() => db.from('teams').select('team, gmo, manager, bike')),
    settingsMany(db, BOOT_KEYS),
    (async () => {
      try { cu = await userByDevice(db, dev); }
      catch (e) { if (e && e.accountOff) accountOff = true; else throw e; }
    })(),
  ]);
  const teams = teamRows.filter(r => r.team).map(r => r.team).sort();
  const brand = setting('CALL_BRAND') || APP.BRAND;
  const logo = setting('CALL_LOGO_URL') || '';
  // An unauthenticated device gets branding only. The team list used to be handed out here,
  // which is half of what made self-registration work: pick a team off the list, get its book.
  /* Whether to show the way across to the system at all. Calls itself is NEVER gated -- an
     officer's day does not depend on the portal being open -- but the switch button, and the
     sign-in it leads to, disappear while the system is closed. Sent on both branches so the
     sign-in screen and the app agree. */
  const systemOpen = await isSystemOpen(db, nowMs);
  if (!cu) return { ok: false, error: accountOff ? 'ACCOUNT_OFF' : 'DEVICE_NOT_REGISTERED',
    teams: [], brand, motto: APP.MOTTO, logo, systemOpen };
  const today = todayKey(nowMs);
  const logs = await fetchAll(() => db.from('call_logs').select('duration, portfolio').eq('user_id', cu.user_id).eq('call_date', today));
  const syncSec = parseInt(setting('CALL_SYNC_SECONDS'), 10);
  const logoutSetting = K(setting('CALL_LOGOUT_ENABLED'));
  // The rotation check, off the teams read above rather than a second one of the same table.
  const me = K(cu.name);
  const expdfOwner = !!me && teamRows.some(t => K(t.gmo) === me || K(t.manager) === me || K(t.bike) === me);
  // Asked the portal's way -- see callSystemAdmin_. Free for an ordinary officer.
  const systemAdmin = await callSystemAdmin_(db, cu, nowMs);
  return {
    ok: true,
    systemOpen,
    /* THE PERSON WHO CLOSED THE SYSTEM STILL NEEDS THE DOOR TO IT.

         "Brother, I am role admin and i too dont see the switch button in the call app!"

       Quite right, and it is a trap of my making: closing the system takes the way across to
       the portal off EVERY handset, and the admin who closed it is holding a handset too. So
       the one person who can reopen it had no button to go and do so.

       The portal itself has always let an admin through a closed door -- that is what gatedUser
       does -- so the phone was hiding a door that would have opened. This tells it not to.

       IT REVEALS A BUTTON, NOT AN AUTHORITY. Pressing it navigates to the portal, which asks
       for an access code and re-checks it on the server exactly as it does for anybody else.
       The same reasoning as the HOPE Loan switch below: being able to press it is not
       permission, the code is. So a handset that registered as an admin and has since been
       demoted gains nothing at all by seeing it. */
    systemAdmin,
    userId: cu.user_id, name: cu.name, team: cu.team, role: cu.role,
    leader: !!cu.is_leader,
    // Whether the teams table names this person as a GMO / MANAGER / BIKE officer anywhere --
    // that, not their login role, is what gives them a rotation list to work.
    // Everyone follows up in this mode, so everyone gets the tab. The flag now only says
    // whether this person ALSO has a list of their own to switch to.
    expdfLeader: true,
    expdfOwner,
    leaderTeams: cu.is_leader ? (!cu.leader_teams || !cu.leader_teams.length ? 'ALL' : cu.leader_teams.join(',')) : '',
    /* THE TEAM LIST, NARROWED TO WHAT THIS HANDSET MAY SEE.
       The unauthenticated branch above stopped publishing every team name years ago, and says
       why: "half of what made self-registration work: pick a team off the list, get its book."
       The REGISTERED branch went on sending the whole company's list to all two hundred
       handsets -- and nothing on the phone has ever read it (call.html draws the header from
       `team` and `leaderTeams`). So it was a standing disclosure of the enrolment surface,
       paid for on every boot, in exchange for nothing.
       A leader over named teams gets those; an all-teams leader legitimately gets all; an
       ordinary officer gets their own and no other. */
    teams: (cu.is_leader && (!cu.leader_teams || !cu.leader_teams.length))
      ? teams
      : (cu.is_leader
          ? teams.filter(t => (cu.leader_teams || []).some(x => K(x) === K(t)))
          : teams.filter(t => K(t) === K(cu.team))),
    watermark: num(cu.last_ts),
    // From the same settings query as everything else above, not a sixth journey.
    ...fuStatusShape(parseFuStatuses(setting(FU_STATUS_KEY))),
    brand, motto: APP.MOTTO, logo,
    /* WHICH UPLOAD THIS ANSWER BELONGS TO.

       The handset keeps every list on the device for an hour, which is right on a bad
       connection and wrong the moment an upload corrects something: the phone goes on showing
       the list it already had, so a fix that landed at nine o'clock reaches nobody until ten.
       Uploading and then being told "still not there" is the same sentence whether the fix
       failed or the phone simply has not asked again -- and telling those two apart has cost
       days.

       DATA_VERSION is stamped by the upload the moment anything lands, and is already carried
       for the phone index. Handing it to the phone costs nothing -- it comes from the same
       settings query as the brand and the sync interval -- and lets the device throw its cache
       away the instant the book behind it changes, rather than an hour later. */
    dataVersion: setting('DATA_VERSION') || '',
    /* CRISIS PREPAREDNESS -- the admin's switch for the offline pack. "national challenges of
       oct 29th 2025 when internet was shut down". OFF by default; when the setting says YES
       the handset shows its own download switch, and when the admin turns it off again every
       handset drops the pack on its next successful boot. Same settings read as everything
       else here -- no extra journey. */
    offlinePack: ['YES', 'TRUE', '1', 'ON'].includes(K(setting('OFFLINE_PACK'))),
    syncEverySec: (!syncSec || isNaN(syncSec)) ? 300 : Math.max(60, Math.min(3600, syncSec)),
    logoutEnabled: logoutSetting !== 'NO' && logoutSetting !== 'FALSE' && logoutSetting !== '0',
    today: {
      calls: logs.length,
      duration: logs.reduce((s, r) => s + num(r.duration), 0),
      portfolio: logs.filter(r => !!r.portfolio).length,
    },
  };
}

/** Identity is keyed by PHONE, not device: a phone upgrade or reinstall picks the SAME
    identity back up instead of forking a new one, and nobody spins up a second account to
    dodge their numbers. A portal access code grants leader status with that code's own team
    scope -- validated against access_codes, the one place codes live in v2 too. */
async function register(db, [dev, name, team, accessCode, phone, passcode], nowMs) {
  dev = String(dev == null ? '' : dev).trim();
  if (!dev) throw new Error('Missing device id.');
  name = String(name == null ? '' : name).trim();
  const phoneD = pnorm(phone);
  if (!phoneD) throw new Error('Enter your phone number.');
  team = String(team == null ? '' : team).trim();
  const code = String(accessCode == null ? '' : accessCode).trim();
  let role = 'OFFICER', leader = false, leaderTeams = null;
  const teams = await teamList(db);
  if (code) {
    const { data: u } = await db.from('access_codes').select('*').eq('code', code).maybeSingle();
    if (!u) throw new Error('Invalid access code.');
    /* A VIEW-ONLY CODE DOES NOT REGISTER A HANDSET. A phone session exists to write --
       follow-ups, promises, call logs -- and the read-only supervisor's surface is the
       portal, where the same books are visible and every write is refused at the door.
       Refused here with directions rather than half-working there. */
    if (['AUDITOR', 'READONLY', 'READ ONLY', 'READ-ONLY'].includes(K(u.role || ''))) {
      throw new Error('Msimbo huu ni wa kuangalia tu — tumia mfumo (portal) badala ya app ya simu. '
        + '/ This is a view-only code: use the system portal, where every screen is open and nothing can be changed.');
    }
    leader = true;
    role = u.role || 'LEADER';
    leaderTeams = (u.teams && u.teams.length) ? u.teams : null;   // null = ALL, same convention as auth.js
    // call_users.team is a FOREIGN KEY into teams -- it is the leader's display-only "home"
    // team, never their scope (that's leader_teams). An ALL-teams code has no home team, and
    // writing the literal 'ALL' there violated the constraint and blocked admin registration
    // outright. Resolve it to a real team when the code names one, else leave it NULL.
    const home = team || (leaderTeams && leaderTeams[0]) || '';
    team = teams.find(t => K(t) === K(home)) || null;
    name = u.name || name;
    // A switched-off account must not be able to walk back in through the leader door. This
    // check existed only on the officer path, so a disabled handset re-registered happily and
    // then boot refused it -- which reached the user as "Registration did not complete. Try
    // again.", a message that sent them round the same loop forever.
    const { data: off } = await db.from('call_users').select('active').eq('phone', phoneD).maybeSingle();
    if (off && off.active === false) throw new Error('Akaunti yako imezimwa. / Your account has been switched off. Ask your PMO officer.');
  } else {
    // An officer signs in with their TEAM'S CODE. Before this, anyone holding the APK could
    // type any name, pick any team off the public list, and be handed that team's whole
    // portfolio -- no code at all.
    //
    // The code decides which team they get; it is NOT a team picker, so the team list is
    // never published to a handset that has not signed in. Identity still comes from the
    // phone number, so a shared code does not mean a shared identity: call attribution,
    // watermarks and per-officer reports keep working per person.
    const pass = String(passcode == null ? '' : passcode).trim();
    if (!pass) throw new Error('Weka msimbo wa timu yako. / Enter your team code.');
    const codeKey = K(pass).replace(/[^0-9A-Z]/g, '');
    /* NOT THE MEMO. Rotating a team code is how an admin CUTS the handsets that had the old
       one, and a fifteen-second window in which the old code still registers is a fifteen-second
       window in which somebody who was just cut walks back in. Registration is rare -- a handset
       does it once -- so it pays for a live read, and the test that pins this is the one that
       caught the memo the moment it was applied here. */
    const teamRows = await fetchAll(() => db.from('teams').select('*'));
    const match = teamRows.find(t => K(t.team_code || '').replace(/[^0-9A-Z]/g, '') === codeKey && codeKey);
    if (!match) throw new Error('Msimbo wa timu si sahihi. / That team code is not correct. Ask your PMO officer.');
    if (!name) throw new Error('Andika jina lako. / Enter your name.');
    team = match.team;
    role = 'OFFICER';

    // An officer an admin switched off cannot walk back in on the team code -- that is what
    // "cut this ONE person without changing everyone's code" has to mean.
    const { data: acct } = await db.from('call_users').select('active').eq('phone', phoneD).maybeSingle();
    if (acct && acct.active === false) throw new Error('Akaunti yako imezimwa. / Your account has been switched off. Ask your PMO officer.');
  }
  if (!name) throw new Error('Could not find a name on file for that access code.');
  const uid = 'U' + h36(phoneD);
  const now = new Date(nowMs).toISOString();
  const { data: existing } = await db.from('call_users').select('user_id, registered_at, last_sync, last_ts').eq('phone', phoneD).maybeSingle();
  const vals = {
    user_id: uid, name, team, role, is_leader: leader, leader_teams: leaderTeams,
    device_id: dev, phone: phoneD,
    registered_at: (existing && existing.registered_at) || now,
    last_sync: (existing && existing.last_sync) || null,
    last_ts: (existing && existing.last_ts) || null,
  };
  // Never write passcode_hash / passcode_salt / active from here: registering must not be a
  // way to clear your own passcode or re-enable an account an admin switched off.
  
  // Same phone re-registering updates in place, never a second row (phone is UNIQUE, and
  // user_id is derived from it, so upserting by user_id covers both cases).
  const { error } = await db.from('call_users').upsert(vals, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  // A device is signed in as ONE identity: release any other row still claiming this device,
  // otherwise boot would keep resolving to whoever used the device first.
  const { error: e2 } = await db.from('call_users').update({ device_id: null }).eq('device_id', dev).neq('user_id', uid);
  if (e2) throw new Error(e2.message);
  return { ok: true, userId: uid, name, team, leader, leaderTeams: leaderTeams ? leaderTeams.join(',') : (leader ? 'ALL' : '') };
}

/* ---------- lists ---------- */
/** "Amepigiwa leo" -- a REAL conversation with that number today, by anyone, in either
    direction. Android logs a call the moment it is placed, so a number that rang out, was
    rejected, or was answered and dropped in two seconds all arrive as call_log rows with a
    tiny duration. Ticking those off marked customers as done who had never been spoken to,
    and the officer moved on. Anything at or under CALL_MIN_SECS seconds is a dial attempt,
    not a call, and no longer counts. */
const CALL_MIN_SECS_DEFAULT = 5;
/* "AMEPIGIWA LEO" -- THE SECOND WHOLE-TABLE READ ON A HOT PATH, and the one that gets worse
   as the day goes on.

   Every list load read EVERY call log made anywhere in the company today. That is small at
   eight in the morning and it is not small at four in the afternoon: three hundred officers
   making fifty calls each is fifteen thousand rows, dragged again for every list every
   handset opens. The cost grows exactly as the day gets busier, which is the worst possible
   shape for it to have -- the system feels fine when it is tested and fails when it is used.

   IT IS AN ADVISORY TICK. It greys a row and prints "Amepigiwa leo" so two officers do not
   ring the same customer within the hour. It is deliberately COMPANY-WIDE and stays that way:
   scoping it to the signed-in officer would answer a different, less useful question.

   Half a minute of staleness cannot be noticed here, because THE PHONE ALREADY CACHES THE
   WHOLE LIST FOR AN HOUR -- the ticks on an officer's screen are routinely fifty minutes old
   already. So this is invisible to them and removes the read for everybody who asks in the
   same half-minute, which on three hundred handsets is most of them.

   WITH ONE EXCEPTION, WHICH IS THE ONE THAT WOULD HAVE BEEN NOTICED: your OWN call. An officer
   rings a customer, the handset syncs, and the tick has to be there when they look.

   THE OBVIOUS ANSWER TO THAT IS WRONG, and a 300-handset simulation is what showed it. Dropping
   the cache whenever a sync writes a call looks right and destroys the whole saving: with three
   hundred officers syncing, SOMETHING is always writing, so the cache is invalidated faster
   than it can ever be used. Measured that way, call_logs still cost 1.5 million rows -- exactly
   the number the cache was added to remove.

   So a sync MERGES its own numbers into the warm set instead of throwing it away. The officer's
   call is ticked the instant they look, the set stays warm for the other 299, and no read is
   spent on either. The duration threshold is remembered alongside the set so the merge applies
   the same rule the read did -- a dial attempt still must not tick. */
const CALLED_TTL_MS = 30000;
const calledCache = new WeakMap();              // db -> { at, day, min, value }

/** Fold calls just written into the warm set, if there is one. Never fetches: with nothing
    cached there is nothing to correct, and the next read builds it fresh anyway. */
function noteCalledToday(db, nowMs, records) {
  const hit = calledCache.get(db);
  if (!hit || hit.day !== todayKey(nowMs)) return;
  for (const r of records || []) {
    if (r.call_date !== hit.day) continue;
    if (num(r.duration) <= hit.min) continue;              // a dial attempt is not a call
    const d = pnorm(r.phone);
    if (d) hit.value[d] = 1;
  }
}
async function calledTodaySet(db, nowMs) {
  const day = todayKey(nowMs);
  const hit = calledCache.get(db);
  if (hit && hit.day === day && hit.at <= nowMs && (nowMs - hit.at) < CALLED_TTL_MS) return hit.value;
  const raw = parseInt(String(await settingGet(db, 'CALL_MIN_SECS') || '').replace(/[^0-9]/g, ''), 10);
  const min = (isNaN(raw) || raw < 0) ? CALL_MIN_SECS_DEFAULT : raw;
  // Filtered here rather than in the query: durations are numbers, and PostgREST-style range
  // filters on this path compare as text, where '60' sorts below '6'.
  const rows = await fetchAll(() => db.from('call_logs').select('phone, duration').eq('call_date', day));
  const set = {};
  for (const r of rows) {
    if (num(r.duration) <= min) continue;
    const d = pnorm(r.phone); if (d) set[d] = 1;
  }
  calledCache.set(db, { at: nowMs, day, min, value: set });
  return set;
}
/* =====================================================================================
   THREE KINDS OF USER SEE A NARROWER LIST -- AND ONLY THOSE THREE.
   =====================================================================================
   "i have a special case for credit analysts, expected and collection officers in call app
    only and not in system ... thats for 3 kind of users only and not the rest"

   Everybody else keeps exactly the list they have always had. These three are chased on a
   subset of the book, and scrolling past the customers they are not measured on is how the
   ones they ARE measured on get missed.

   CREDIT ANALYSTS -- customers who have not passed the fifth instalment.
     "e.g. 3-5, 4-12, 5-9, 0-3 -- not 6-9, 10-12"
     D.S / DUE SUMMARY is paid-of-target, so this is simply: paid <= 5. Every example fits.

   EXPECTED AND COLLECTION OFFICERS -- early collection, on the Leo and Kesho lists ONLY.
     "see only dc/nc 1 customers in Leo and Kesho lists ONLY (e.g. 0-1, 2-3, 6-9 -- not 5-9
      or 3-9)"
     The words say one, the examples say three: the five examples separate cleanly on how far
     BEHIND the customer is (target minus paid) -- kept 1, 1, 3 against dropped 4, 6 -- and on
     nothing else. No threshold on either number alone fits them.

     Asked, and answered: "keep those with behind = 1 only". So one it is -- and it stays a
     setting, because the answer to that question was worth asking for and will be worth
     changing without a deploy.

       CALL_CREDIT_MAX_PAID    default 5   credit: keep paid <= this
       CALL_EARLY_MAX_BEHIND   default 1   expected/collection: keep (target - paid) <= this

     The credit rule is confirmed too: "0 to 5-12 are under credit analysts supervision from
     6/6 not" -- paid 0 through 5 are theirs, 6 and up are not, whether the instalment was met
     or missed.

   A ROW WITH NO D.S AT ALL IS ALWAYS KEPT. An unreadable or missing due summary is a fault in
   the upload, and answering it by hiding the customer would turn a bad column into a customer
   nobody calls.
*/
/* =====================================================================================
   WHY CATHERINE SAW THE WHOLE BOOK ANYWAY.

     "logged in to catherine and at leo just the first customer is 6-10, at kesho 4-12"

   6-10 is four behind and 4-12 is eight. Neither should have been in front of a collection
   officer at all -- so the narrowing was not running for her, and the reason was one string.

   This list matched a role by EXACT EQUALITY against the literal word 'COLLECTION'. But no
   access code in this system says that. A collection officer's role is 'PMO COLLECTION' --
   pmo.js names it, PMO_ROLE_DEFAULT sets it, the staff roster resolves it through isPmoRole,
   and register() copies whatever the access code says straight onto call_users.role. So the
   role on Catherine's handset read 'PMO COLLECTION', matched nothing here, and callRoleKind
   returned null. Null means "no special case", and no special case means the whole book.

   The name fallback underneath could not save her either: it looks a person up in the teams
   table's own columns, and a PMO collection officer is deliberately NOT there -- one person
   holds thirty-odd teams, so their teams live on their ACCESS CODE. That is the right storage
   decision and it is unchanged; it just meant neither route reached her.

   THE RULE IS NOW WRITTEN THE WAY THE REST OF THE SYSTEM WRITES IT: the collection role is
   whatever the PMO_ROLE setting says, compared with isPmoRole -- which already forgives case
   and punctuation, so 'PMO COLLECTION', 'PMO-Collection' and 'pmo collection' are one answer.
   Rename the role in Settings and this follows it, with no deploy, exactly as intended.

   The other two are matched on the WORD rather than the whole string, because these are typed
   by a person into a form: 'CREDIT ANALYST', 'Credit', 'EARLY COLLECTION', 'Expected
   Collection Officer' all say the same thing and all used to fail unless spelled to the
   character. Deciding on a contained word cannot reach RECOVERY, GMO, MANAGER, BIKE, OPM,
   LEGAL or ADMIN -- none of them carries any of these words -- so no role that was untouched
   before becomes narrowed now. */
const CREDIT_WORDS = ['CREDIT'];
const EXPECTED_WORDS = ['EXPECTED', 'EARLY'];
/* The collection word list lives in pmo.js now, so the phone and the commission screen cannot
   end up with two different opinions about who is a collection officer. */
const normRole = v => String(v == null ? '' : v).trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const hasWord = (role, words) => words.some(w => (' ' + role + ' ').includes(' ' + w + ' '));

/** Whether a role string counts as CREDIT -- the same word-contains rule callRoleKind uses,
    exported so anywhere else that has to pick "the credit people" out of a roster (the
    recovery-by-credit board, for one) asks the exact same question rather than growing a
    second opinion about who is a credit officer. */
export function isCreditRole(role) { return hasWord(normRole(role), CREDIT_WORDS); }

/** paid-of-target off a "4/6" or "4-6" due summary. null when there is nothing to read. */
export function dsParts(v) {
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\s*[\/\-]\s*(\d{1,2})$/);
  if (!m) return null;
  return { paid: Number(m[1]), target: Number(m[2]) };
}

/** WHICH OF THE THREE, IF ANY, THIS PERSON IS.
    Two sources, because the three roles are held in two different places: credit and expected
    are columns on the teams table (holding one anywhere is what counts, the same rule the
    recycling rotation uses), while a collection officer's teams live on their access code and
    the role is written there. Either is enough. */
export async function callRoleKind(db, user) {
  /* BY ROLE, AND ONLY BY ROLE.

       "We should read them by roles not names" ... "careen is in recovery"

     There used to be a fallback that matched the registered NAME against the teams table's
     credit/expected/collection columns -- and CAREEN is exactly why it had to go. She is a
     RECOVERY leader whose whole job is the full defaulter book; a name floating between a
     short form on the phone and a full form on a sheet is one wrong match away from
     narrowing the book of somebody who needs all of it. A role is WRITTEN DOWN, on the
     access code or by the registration itself, and it says what the person is chased on.
     Somebody whose role says none of these is a plain officer with the whole book -- if
     they should be narrowed, the fix is their role, not a guess from their name.

     The word checks cost nothing and resolve almost everyone; the one query -- the PMO role
     name, memoised with every other setting -- runs only for a role that matched no word,
     because a deployment is free to rename the collection role into any language at all. */
  const role = normRole(user && user.role);
  if (!role) return null;
  if (hasWord(role, CREDIT_WORDS)) return 'CREDIT';
  if (hasWord(role, EXPECTED_WORDS)) return 'EXPECTED';
  if (hasCollectionWord(role)) return 'COLLECTION';
  /* THE 300 PLAIN HANDSETS STOP HERE, FOR FREE. Registration itself writes 'OFFICER' and
     'LEADER' -- they are this system's own constants, never a renamed collection role -- and
     without this line every one of those handsets paid a settings round trip on EVERY list
     load to be told what it already was. The read below is only for a role somebody TYPED on
     an access code that matched no keyword, which is the one case a renamed PMO role can be. */
  if (role === 'OFFICER' || role === 'LEADER') return null;
  const pmoName = await settingGet(db, PMO_ROLE_KEY).then(v => v || PMO_ROLE_DEFAULT, () => PMO_ROLE_DEFAULT);
  if (isPmoRole(role, pmoName)) return 'COLLECTION';
  return null;
}

/** The narrowing itself, kept pure so the rule can be read and tested on its own. */
export function narrowForRole(rows, kind, which, limits) {
  if (!kind) return rows;
  if (kind === 'CREDIT') {
    return rows.filter(r => {
      const d = dsParts(r.ds);
      return !d || d.paid <= limits.creditMaxPaid;
    });
  }
  /* A COLLECTION officer's whole job is the single counts -- and so is an EARLY-collection
     (EXPECTED) officer's.

       "she is called todays collection single counts e.g 3-4 ds=1"
       "Catherine is still seeing 2-12 samples"
       "still multi defaulter beeing seen in both pmo early collection and today collection
        users. please check well"

     The first fix narrowed only COLLECTION's defaulter tabs, keeping an old assumption that
     the EXPECTED officer's book must stay whole. The owner has now said plainly that BOTH
     collection classes are chased on single counts on every tab, so the same rule follows
     both of them onto EVERY list. A row with no readable D.S stays, as everywhere: unknown
     is not "far behind". The plain OFFICERs' book -- nearly all 300 handsets -- is untouched;
     `kind` is null for them and this function returned before reaching here. */
  return rows.filter(r => {
    const d = dsParts(r.ds);
    return !d || (d.target - d.paid) <= limits.earlyMaxBehind;
  });
}

async function roleLimits(db) {
  // Two settings from the same table, in ONE query rather than one after the other. Neither
  // depends on the other, and this runs on every list an early-collection or credit officer
  // opens -- a wait bought nothing.
  const setting = await settingsMany(db, ['CALL_CREDIT_MAX_PAID', 'CALL_EARLY_MAX_BEHIND']);
  const n = (k, dflt) => {
    const x = parseInt(setting(k), 10);
    return isNaN(x) || x < 0 ? dflt : x;
  };
  return { creditMaxPaid: n('CALL_CREDIT_MAX_PAID', 5),
    earlyMaxBehind: n('CALL_EARLY_MAX_BEHIND', 1) };
}

/* EXACTLY WHAT THE LEO AND KESHO LISTS DRAW.
   Ten columns, and this is the read two hundred handsets make several times a day on a mobile
   connection. It was taking every column of the table -- the docket, four schedule dates, the
   branch, the zone, the totals -- none of which appears anywhere on a phone.

   IF A FIELD IS ADDED TO THE PHONE'S ROW OR SHEET IT MUST BE ADDED HERE. The fake database
   honours the projection, so a forgotten one is a red test rather than a customer on somebody's
   phone with no name and nothing to tap -- which is exactly how that happened once before. */
const CALL_EXPECTED_COLS = 'ref, full_name, contact, guarantor_name, guarantor_contact, '
  + 'arrears, payment_expected, todays_status, due_summary, team';

/* =====================================================================================
   THE TEAMS SOMEBODY HOLDS, NOT THE ONE THEY REGISTERED FROM.

     "just legal officers and credit analysists told me they dont see their customers"

   Two roles, not everybody -- which is what made this findable. Both hold MANY teams and both
   register the ordinary way, with their team's code.

   pseudoUser scopes a non-leader to `[cu.team]`: the single team whose code they typed. That is
   exactly right for a field officer, who works one team, and exactly wrong for a credit analyst,
   who supervises every team where `teams.credit` carries their name. Their book is thirty teams
   and the handset was showing them one -- and then narrowing THAT by paid <= 5 on top, so the
   list came back nearly empty and correct-looking.

   The system already knows the answer. callRoleKind identifies a credit analyst by looking their
   name up in exactly these columns; it just used the answer to NARROW the list and never to
   scope it. So the same map now widens the scope too.

   THIS CANNOT BECOME A WAY ROUND TEAM SCOPING. It only ever ADDS teams the person holds a role
   column on -- the same source the recycling rotation and the portal's leader filter have always
   trusted -- and an ALL-teams user (teams null) is left exactly as they are. A plain officer
   holding no column anywhere gets nothing added, which is nearly every handset, so nothing
   changes for the people this must not disturb. */
/* THE ROLE MAP IS THE SAME ANSWER FOR EVERY HANDSET, SO IT IS READ ONCE A MINUTE.

   This lookup arrived with the credit-analyst fix and it runs on EVERY list load. Two hundred
   handsets opening Leo, Kesho and Def through a morning is thousands of reads of a table whose
   answer is identical for all of them and changes when somebody is reassigned -- which is not
   often, and never in the middle of a Monday.

   Cached against DATA_VERSION exactly as the phone index is, so an upload or a reassignment
   moves the key and the next caller rebuilds it; the sixty-second ceiling is the backstop for a
   deployment where the version never moves. One read a minute for the whole company, instead of
   one per screen per officer.

   The map is name -> [teams], built once, so callers ask it a question rather than filtering the
   table themselves. */
/* THE SAME FIFTY ROWS, ON THIS SIDE TOO.

   The portal memoises the teams table; the phone side reads it separately and, in the calls
   report, TWICE in one request -- measured. Its own memo rather than a shared one, because
   call-core importing portal-core would close an import cycle this codebase has already had to
   break once (see expdf.js). Two modules asking once every fifteen seconds is two reads a
   minute for the whole company, which is not worth a cycle to avoid. */
/* IS THIS HANDSET AN ADMIN -- ASKED THE WAY THE PORTAL'S OWN DOOR ASKS IT.
   =====================================================================================
     "some leaders aint seeing the 🔁 in call app"

   The switch to the portal was revealed by `K(cu.role) === 'ADMIN'`: an EXACT match on the
   role string copied onto the handset at registration. The portal's door asks something else
   entirely -- `user.tabs.includes('settings')`, the RESOLVED tab list -- and the two disagree
   for exactly the people who complained:

     - a leader whose role is not literally spelled ADMIN but whose ROLE grants the settings
       tab: an administrator to the portal, invisible to the phone;
     - a leader granted settings on their own access code rather than through a role;
     - anyone whose role is spelled with different capitals from the row in `roles`.

   That last one is the Tunduru blackout and the roleTabsOf blackout for the third time: an
   exact-case string comparison standing between a person and their own screen. One rule, one
   place (CLAUDE.md) -- so the phone now runs the portal's rule instead of a lookalike.

   RULE 1: THIS COSTS AN ORDINARY OFFICER NOTHING. A handset that registered on a TEAM code is
   not a leader and cannot be an administrator, so it returns before any read. Only a handset
   that registered with an ACCESS code asks -- a handful of people out of three hundred -- and
   what it asks for is two config-sized tables, both remembered per database client for a
   minute and shared by every leader on that instance. Neither is on the list path or the sync
   path; boot is once per app start.

   A read that fails answers "not an admin", never an error: the switch staying hidden is a
   button somebody has to ask about, while a boot that fails is an officer who cannot work. */
const ADMIN_LOOKUP_TTL_MS = 60000;
const adminLookupCache = new WeakMap();

/* AND IT IS ON A CLOCK, because this runs inside BOOT.
   A try/catch covers a read that FAILS. It does nothing at all about a read that HANGS -- and
   the database this talks to has been running Unhealthy at 83% RAM, where hanging is the
   likelier of the two. A hung read here is not a missing button, it is a leader whose app
   will not start, which is the one outcome rule 1 exists to prevent.

   So: answered in time, or not answered. Not answered means "not an administrator", which
   costs somebody a button they can get back by reopening the app, and costs nobody their day.
   The read runs on and fills the memo for the next boot. */
const ADMIN_LOOKUP_BUDGET_MS = 1500;
function adminWithin_(p, ms, fallback) {
  let t = null;
  const late = new Promise(res => { t = setTimeout(() => res(fallback), ms); if (t.unref) t.unref(); });
  return Promise.race([p.then(v => { clearTimeout(t); return v; }, () => { clearTimeout(t); return fallback; }), late]);
}

async function adminTabsSource_(db, nowMs) {
  const at = nowMs || Date.now();
  const hit = adminLookupCache.get(db);
  if (hit && (at - hit.at) < ADMIN_LOOKUP_TTL_MS) return hit.v;
  const read = (async () => {
    const [codes, roles] = await Promise.all([
      fetchAll(() => db.from('access_codes').select('name, role, tabs')),
      fetchAll(() => db.from('roles').select('role, tabs')),
    ]);
    const v = { codes: codes || [], roles: roles || [] };
    // Stored on the way past, so a read that arrived LATE still serves the next boot rather
    // than being thrown away for having missed this one.
    adminLookupCache.set(db, { at: Date.now(), v });
    return v;
  })().catch(() => null);
  const v = await adminWithin_(read, ADMIN_LOOKUP_BUDGET_MS, null);
  // Only a real answer is memoised here; a timeout must not pin "not an admin" for a minute.
  if (v) return v;
  return { codes: [], roles: [] };
}

/** The portal's own admin test, run against what the handset knows. Exported for the test that
    holds the two doors to the same answer. */
export function callIsAdmin_(cu, codes, roles) {
  if (!cu || !cu.is_leader) return false;                 // a team-code handset is never one
  if (K(cu.role) === 'ADMIN') return true;                // as before, and still true
  const mine = (codes || []).find(c => K(c.name) === K(cu.name));
  /* resolveTabs' own two rules, in its own order: an ADMIN role holds every tab whatever its
     row says, and otherwise the code's tabs and the role's tabs are merged. */
  if (mine && K(mine.role) === 'ADMIN') return true;
  const roleRow = (roles || []).find(r => K(r.role) === K((mine && mine.role) || cu.role));
  const tabs = [...((mine && mine.tabs) || []), ...((roleRow && roleRow.tabs) || [])];
  return tabs.includes('settings');
}

async function callSystemAdmin_(db, cu, nowMs) {
  if (!cu || !cu.is_leader) return false;                 // no read at all for an officer
  if (K(cu.role) === 'ADMIN') return true;                // no read needed for the obvious case
  const src = await adminTabsSource_(db, nowMs);
  return callIsAdmin_(cu, src.codes, src.roles);
}

const TEAMS_ALL_TTL_MS = 15000;
const teamsAllCache = new WeakMap();

export function noteCallTeamsWritten(db) { teamsAllCache.delete(db); }

async function readTeamsAll(db, nowMs) {
  const at = nowMs || Date.now();
  const hit = teamsAllCache.get(db);
  if (hit && (at - hit.at) < TEAMS_ALL_TTL_MS) return hit.rows;
  const rows = await fetchAll(() => db.from('teams').select('*'));
  teamsAllCache.set(db, { at, rows });
  return rows;
}

const TEAM_ROLE_TTL_MS = 60000;
const teamRoleCache = new WeakMap();

async function teamRoleMap(db, nowMs) {
  const at = nowMs || Date.now();
  const hit = teamRoleCache.get(db);
  if (hit && (at - hit.at) < TEAM_ROLE_TTL_MS) return hit.map;
  /* `collection` is optional -- it arrived in a later migration and migrations here are run by
     hand -- so asking for it must not take the other columns down with it. */
  const rows = await fetchAll(() => db.from('teams').select('team, ' + POS_ORDER.join(', ') + ', collection'))
    .catch(() => fetchAll(() => db.from('teams').select('team, ' + POS_ORDER.join(', '))));
  const cols = POS_ORDER.concat(['collection']);
  const map = new Map();
  map._rows = rows;                            // the same read, for the callers that want it raw
  for (const r of rows) {
    if (!r.team) continue;
    for (const c of cols) {
      const n = K(r[c]);
      if (!n) continue;
      if (!map.has(n)) map.set(n, []);
      map.get(n).push(r.team);
    }
  }
  teamRoleCache.set(db, { at, map });
  return map;
}
/** The teams table's role columns, off the same one-a-minute read. */
async function teamRoleRows(db, nowMs) {
  const map = await teamRoleMap(db, nowMs);
  return map._rows || [];
}

async function heldTeams(db, name, nowMs) {
  const n = K(name);
  if (!n) return [];
  const map = await teamRoleMap(db, nowMs);
  return map.get(n) || [];
}

/** The scope a handset should actually read: their own team(s) PLUS every team they hold a role
    column on. null stays null -- that is "everything", and widening everything is meaningless. */
export async function scopeFor(db, user) {
  if (!user.teams) return null;
  const held = await heldTeams(db, user.name);
  if (!held.length) return user.teams;
  const seen = new Set(user.teams.map(K));
  const out = user.teams.slice();
  for (const t of held) if (!seen.has(K(t))) { seen.add(K(t)); out.push(t); }
  return out;
}

async function list(db, [dev, which, which2], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  const base = pseudoUser(cu);
  /* Widened BEFORE anything is read, because the widening is what decides which rows to ask the
     database for -- doing it afterwards would mean fetching one team's customers and then
     filtering thirty teams' worth of nothing. */
  const user = { ...base, teams: await scopeFor(db, base) };
  const called = await calledTodaySet(db, nowMs);
  const hit = (a, b) => !!(called[pnorm(a)] || called[pnorm(b)]);
  let rows;
  if (which === 'expdf') {
    // The recycling rotation's own list, for the GMO / MANAGER / BIKE signed in on this
    // handset. Their assignment lived only in the portal before, so the three people who
    // actually work it could not see it -- the rotation existed on paper and the follow-up
    // did not happen.
    const d = await expdfMine(db, user, { scope: which2 === 'team' ? 'team' : 'auto' }, nowMs);
    return { ok: true, rows: d.rows.map(r => ({
      ref: r.ref, name: r.full_name, contact: r.contact,
      gName: r.guarantor_name, gContact: r.guarantor_contact,
      amt: r.arrears, installment: r.rejesho, custStatus: r.status, fuStatus: r.cycle,
      /* `initial` is the baseline Rec % divides by. It was left off because nothing on the
         phone printed it -- but the summary now re-adds itself whenever the GMO/Manager/Bike
         pill narrows the list, and a percentage cannot be re-derived from arrears and
         recovered alone (a customer whose arrears GREW has recovered 0, and 0 + arrears is
         not their baseline). One number per row, so the handset can recompute exactly rather
         than approximately. */
      initial: r.initial,
      recovered: r.recovered,
      ds: dsFmt(r.ds), days: r.dc == null ? '' : r.dc, team: r.team,
      called: hit(r.contact, r.guarantor_contact),
      leader: r.leader, role: r.role,
    })), expdf: { totals: d.totals, byCycle: d.byCycle, byLeader: d.byLeader, dayName: d.dayName,
      date: d.date, hasBaseline: d.hasBaseline, scope: d.scope, canSwitch: d.canSwitch,
      diag: d.diag } };
  }
  let asOf = null, stale = false;
  if (which === 'defaulters') {
    // Only the columns this list actually renders. The table carries promise dates, comment
    // trails and timestamps the phone never shows, and every one of them was crossing a mobile
    // connection for every customer, every load.
    // Narrowed to this officer's team AT THE DATABASE. Team names are stored uppercase by
    // normTeam on every path that writes them, and pseudoUser uppercases the officer's, so
    // this matches exactly what the JS filter below would have kept -- it just no longer
    // downloads the other thirty-nine teams first.
    const fu = await fetchAll(() => {
      let q = db.from('followup_status').select(
        'ref, full_name, contact, guarantor_name, guarantor_contact, arrears, rejesho, status, fu_status, ds, days_elapsed, team, updated_at');
      if (user.teams && user.teams.length) q = q.in('team', teamMatchList(user.teams));
      return q;
    });
    // Skip pure FK stubs (created so an EXPECTED customer's comment can reference
    // followup_status) -- a real defaulter row always carries status/arrears from its upload.
    /* A DEFAULTER WHO HAS PAID SAYS SO. Some rows arrive with zero or negative arrears and
       NO status at all -- and officers were ringing them at speed with nothing on the row to
       say the debt is gone ("officers rapidly call them without seeing they have no status
       at all"). The Expected lists already wear PAID; the defaulter book now does too, and
       only where the balance itself proves it: a null arrears is unknown, never "paid". */
    const paidChip = r => statusWithPaid(r.arrears, r.status, '');
    rows = fu.filter(r => teamAllowed(user, r.team) && !(r.status == null && r.arrears == null)).map(r => ({
      ref: r.ref, name: r.full_name, contact: r.contact, gName: r.guarantor_name, gContact: r.guarantor_contact,
      amt: num(r.arrears), installment: num(r.rejesho), custStatus: paidChip(r), fuStatus: r.fu_status || '',
      ds: dsFmt(r.ds), days: r.days_elapsed == null ? '' : r.days_elapsed, team: r.team,
      called: hit(r.contact, r.guarantor_contact),
    }));
    rows.sort((a, b) => b.amt - a.amt);
    /* HOW OLD IS THIS LIST? A customer stays a defaulter until their weekday's deck is
       uploaded again WITHOUT them, so a deck that has not been re-uploaded for a fortnight
       leaves people on the list who may have cleared. The officer could not tell -- the
       Expected lists say how old they are and this one said nothing.

       The newest update across the list is the honest answer: it is the last time any of these
       figures were refreshed by an upload. */
    let newest = '';
    for (const r of fu) { const u = String(r.updated_at || ''); if (u > newest) newest = u; }
    asOf = newest ? newest.slice(0, 10) : null;
    stale = !!(asOf && asOf < todayKey(nowMs));
  } else {
    // KESHO is DERIVED, not a separate upload. The PMO uploads each day's Expected sheet
    // under its own date, exactly as the live system worked -- so tomorrow's list is simply
    // the sheet dated tomorrow, and asking anyone to upload the same file twice under a
    // second label was a workflow this system invented for itself.
    //
    // There are no weekend sheets, so Friday's "tomorrow" is Monday, and so is the weekend's.
    let snap, wantDate;
    if (which === 'tomorrow') {
      const u = isoWeekday(nowMs);
      const skip = u >= 5 ? (8 - u) : 1;          // Fri +3, Sat +2, Sun +1, otherwise +1
      wantDate = addDaysKey(todayKey(nowMs), skip);
      snap = await latestSnapshot(db, 'repayment_snapshots',
        { snapshot_type: 'today' }, { onDate: wantDate, teams: user.teams, columns: CALL_EXPECTED_COLS });
      // Older uploads that used the explicit "Expected - Tomorrow" type still work.
      if (!snap.rows.length) {
        snap = await latestSnapshot(db, 'repayment_snapshots',
          { snapshot_type: 'tomorrow' }, { notAfter: todayKey(nowMs), teams: user.teams, columns: CALL_EXPECTED_COLS });
      }
    } else {
      wantDate = todayKey(nowMs);
      snap = await latestSnapshot(db, 'repayment_snapshots',
        { snapshot_type: 'today' }, { notAfter: wantDate, teams: user.teams, columns: CALL_EXPECTED_COLS });
    }
    /* WHICH DAY IS THE OFFICER ACTUALLY LOOKING AT.
       When today's Expected file has not been uploaded, this read falls back to the most
       recent one on or before today -- and said nothing. An officer then worked YESTERDAY's
       customers believing they were today's, which is the "Leo inaonyesha wa jana" report.
       Falling back is right (an old list beats no list); doing it silently is not. */
    asOf = snap.date || null;
    stale = !!(asOf && wantDate && String(asOf) !== String(wantDate));
    /* THE EXPECTED CARD WEARS THE LAST FOLLOW-UP TOO. "some cards show the latest comment
       type before opening ... all should. in both expected and def pannels" -- a comment on
       an Expected customer already lands in followup_status (the stub upsert in addComment
       exists exactly so it can), but this branch hard-coded fuStatus: '' and never read it
       back. So a defaulter card showed "Ametoa Ahadi" on its face while the same save on an
       Expected card was invisible until the card was opened -- and the officer, seeing
       nothing, rang the customer again. One narrow two-column read, scoped to the officer's
       teams like everything else here. */
    const fuChip = {};
    const fuRows = await fetchAll(() => {
      let q = db.from('followup_status').select('ref, fu_status');
      if (user.teams && user.teams.length) q = q.in('team', teamMatchList(user.teams));
      return q;
    });
    for (const f of fuRows) if (f.fu_status) fuChip[String(f.ref)] = f.fu_status;
    rows = snap.rows.filter(r => teamAllowed(user, r.team)).map(r => ({
      ref: r.ref, name: r.full_name, contact: r.contact, gName: r.guarantor_name, gContact: r.guarantor_contact,
      amt: num(r.arrears), installment: num(r.payment_expected), custStatus: r.todays_status || '',
      fuStatus: fuChip[String(r.ref)] || '',
      ds: dsFmt(r.due_summary), days: '', team: r.team,
      called: hit(r.contact, r.guarantor_contact),
    }));
    rows.sort((a, b) => {
      const pu = s => (K(s) === 'PAID' || K(s) === 'OVERPAID') ? 1 : 0;
      const pa = pu(a.custStatus), pb = pu(b.custStatus);
      return pa !== pb ? pa - pb : b.amt - a.amt;   // unpaid first, then largest arrears
    });
  }
  /* The three special cases, applied LAST -- after the list is built, sorted and scoped to the
     officer's teams -- so it is visibly a narrowing of the ordinary list and nothing else.
     `narrowed` is reported so the phone can say so rather than leaving somebody wondering
     where half the book went. */
  const kind = await callRoleKind(db, user);
  let narrowed = null, singles = 0;
  if (kind) {
    const limits = await roleLimits(db);
    const before = rows.length;
    rows = narrowForRole(rows, kind, which, limits);
    if (rows.length !== before) narrowed = { role: kind, shown: rows.length, of: before };

    /* THE NEAR-WINS RIDE ON THE COLLECTION OFFICER'S OWN LIST.

         "for early collection and today collection, not just leo and kesho but they should
          also see defaults of single count since thats were they repair their performance --
          if a customer of 3-7 pays to 6-7 by their effort then they got nothing"

       An early/today-collection officer is judged on collection, and a defaulter only turns
       into collection on the day they COMPLETE. Pushing somebody from 3-7 to 6-7 is real
       work that shows up nowhere; pushing 6-7 over the line does. So the defaulters ONE
       COUNT from done -- the same distance the Leo narrowing itself uses, so the two rules
       cannot drift -- are appended to Leo and Kesho, where this officer actually works.
       Not the whole book (that is the Def tab, untouched); just the wins waiting to happen.

       Deduped by ref against the day's own list, FK stubs skipped, sorted by arrears so the
       biggest near-win is on top of the section. Each row is marked `sc` and keeps its
       Defaulter chip, so it cannot be mistaken for a customer due today. */
    if ((kind === 'EXPECTED' || kind === 'COLLECTION') && (which === 'today' || which === 'tomorrow')) {
      const fu = await fetchAll(() => {
        let q = db.from('followup_status').select(
          'ref, full_name, contact, guarantor_name, guarantor_contact, arrears, rejesho, status, fu_status, ds, days_elapsed, team');
        if (user.teams && user.teams.length) q = q.in('team', teamMatchList(user.teams));
        return q;
      });
      const have = new Set(rows.map(r => String(r.ref)));
      const behindMax = Math.max(1, limits.earlyMaxBehind);
      const add = fu.filter(r => {
        if (r.status == null && r.arrears == null) return false;   // FK stubs, not defaulters
        if (!teamAllowed(user, r.team) || have.has(String(r.ref))) return false;
        const d = dsParts(r.ds);
        const behind = d ? d.target - d.paid : 0;
        return behind >= 1 && behind <= behindMax;
      }).map(r => ({
        ref: r.ref, name: r.full_name, contact: r.contact,
        gName: r.guarantor_name, gContact: r.guarantor_contact,
        amt: num(r.arrears), installment: num(r.rejesho),
        // The same paid-says-so rule as the Def tab -- two lists that disagree about whether
        // one customer has paid is worse than either answer alone.
        custStatus: statusWithPaid(r.arrears, r.status, 'Defaulter'),
        fuStatus: r.fu_status || '',
        ds: dsFmt(r.ds), days: r.days_elapsed == null ? '' : r.days_elapsed, team: r.team,
        called: hit(r.contact, r.guarantor_contact), sc: true,
      })).sort((a, b) => b.amt - a.amt);
      singles = add.length;
      rows = rows.concat(add);
    }
  }
  return { ok: true, rows, asOf, stale, narrowed, singles: singles || undefined };
}

/* ---------- daily summary strip ---------- */
/** The six numbers the phone's performance bar carries, for the officer's own team(s):
      col       today's collection
      kesho     TOMORROW's list -- early collection, what officers are actually judged on
      weekCol   the week's collection, Mon-Fri to date
      sales     approvals MONTH-to-date against the monthly target
      expdf     recovery on the day's expected defaulters
      recovery  the dashboard's own recovery figure

    Col and Recovery come straight out of buildDashboard, and Exp.Def out of the same
    expdfMine the Exp.Def tab renders -- the SAME code paths, so the strip reconciles with the
    portal and with the screen below it by construction rather than by coincidence.

    Sales is deliberately MONTHLY on every day of the week. A team's target is 5m a day across
    5 working days -- 25m a week, 100m a month -- and the month is the period the business
    actually judges, so a Monday reading is month-to-date progress, not a week that has barely
    started. SALES_TARGET_MONTHLY overrides the 100m default.

    The client multiplies pct by 100, so everything here is a FRACTION or null. */
async function dailySummary(db, [dev], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  return summaryFor(db, pseudoUser(cu), nowMs);
}
/** The six numbers on the phone's top strip, for whoever is asking. Split out from
    dailySummary so the widget can serve the same figures to a screen nobody is holding --
    one derivation, so a wall display and an officer's phone can never disagree. */
/* THE SIX FIGURES ARE THE DASHBOARD'S OWN, AND THAT IS EXPENSIVE.
 *
 * Working them out a second, cheaper way would be two answers that can disagree on a wall in
 * front of the company, so this deliberately runs buildDashboard -- the heaviest read in the
 * system. The mistake was letting EVERY PHONE run it. Two hundred officers opening the app, plus
 * a refresh on every upload, is two hundred whole-book reads; for an all-teams admin that is the
 * full forty teams, and it is what turned the dashboard into an HTML error page instead of JSON.
 *
 * The cache belongs HERE, not on the widget that happened to get one first. Officers on the same
 * team ask the identical question, so the first one pays and the rest are free for two minutes.
 * Nothing about the figures changes -- one derivation still, just not one per handset.
 */
/* THE BURST, AND WHAT pg_stat_activity SHOWED OF IT.

     27 queries active at the same instant, nearly all of them the totals functions, none
     older than three seconds, nothing blocked -- on a morning the dashboard could not load.

   That is this strip. Every upload moves DATA_VERSION, every handset re-asks for its strip on
   its next sync, and the cache below only helped once the first answer had LANDED: during the
   burst itself, every handset on a scope ran buildDashboard side by side, and forty-odd scopes
   did that at once. A Small instance's CPU saturates under it, every query slows, and the
   dashboard's dozen reads queue behind three hundred phones.

   Three rules now, in this order:

     the question in flight is shared     one computation per scope, however many ask
     a few computations at a time         per lambda, the rest wait in line for a slot
     while the line is long, the last     a handset whose scope HAS a strip gets it at once,
       known strip is served                marked stale, and a refresh joins the line

   The phone already asks again when a sync reports a newer version, so a stale strip costs
   nobody anything but a minute; a burst that used to be sixty whole-book reads at once is now
   three at a time, and the uploads and the dashboard get the database back. */
const SUMMARY_TTL_MS = 120000;
const SUMMARY_MAX_INFLIGHT = 3;
const summaryMaxInflight_ = () => Number(process.env.CALL_SUMMARY_MAX_INFLIGHT) || SUMMARY_MAX_INFLIGHT;
const summaryCache = new Map();
let summaryInflight = 0;
const summaryQueue = [];
function summarySlot_() {
  if (summaryInflight < summaryMaxInflight_()) { summaryInflight += 1; return Promise.resolve(); }
  return new Promise(res => summaryQueue.push(res)).then(() => { summaryInflight += 1; });
}
function summaryRelease_() {
  summaryInflight -= 1;
  const next = summaryQueue.shift();
  if (next) next();
}
function summaryKey_(user) {
  return (user.teams ? upperTeams(user.teams).slice().sort().join(',') : 'ALL');
}
export function _clearSummaryCache() { summaryCache.clear(); }   // tests only
async function summaryFor(db, user, nowMs) {
  const key = summaryKey_(user);
  const hit = summaryCache.get(key) || {};
  const fresh = hit.value && hit.at <= nowMs && (nowMs - hit.at) < SUMMARY_TTL_MS;
  if (fresh) return { ...hit.value, cached: true, computedAt: hit.at };
  if (hit.pending) {
    // Somebody on this scope is already computing it: share the answer, or serve the last one.
    if (hit.value) return { ...hit.value, cached: true, stale: true, computedAt: hit.at };
    return hit.pending;
  }
  if (hit.value && summaryInflight >= summaryMaxInflight_()) {
    // The line is long and this scope has a strip: hand it over now, refresh in the background.
    summaryRun_(db, user, nowMs, key).catch(() => {});
    return { ...hit.value, cached: true, stale: true, computedAt: hit.at };
  }
  return summaryRun_(db, user, nowMs, key);
}
function summaryRun_(db, user, nowMs, key) {
  const prev = summaryCache.get(key) || {};
  const pending = (async () => {
    await summarySlot_();
    try {
      const value = await summaryCompute(db, user, nowMs);
      summaryCache.set(key, { at: nowMs, value });
      return { ...value, cached: false, computedAt: nowMs };
    } catch (e) {
      // A failed refresh keeps the last strip, if there was one; never a poisoned entry.
      const cur = summaryCache.get(key);
      if (cur && cur.pending === pending) {
        if (cur.value) summaryCache.set(key, { at: cur.at, value: cur.value }); else summaryCache.delete(key);
      }
      throw e;
    } finally { summaryRelease_(); }
  })();
  summaryCache.set(key, { at: prev.at || 0, value: prev.value, pending });
  return pending;
}
async function summaryCompute(db, user, nowMs) {
  const d = await buildDashboard(db, user, nowMs);
  const rat = (n, den) => (den > 0 ? n / den : null);
  const mine = rows => rows.filter(r => teamAllowed(user, r.team));

  const monthlyRaw = parseInt(String((await settingGet(db, 'SALES_TARGET_MONTHLY')) || '').replace(/[^0-9]/g, ''), 10);
  const monthly = (!monthlyRaw || isNaN(monthlyRaw) || monthlyRaw < 1) ? 100000000 : monthlyRaw;

  const today = todayKey(nowMs);
  const monthFrom = today.slice(0, 8) + '01';
  // "sales in the app interface report summary bar aint reflecting okay" -- SALES_STAGES, not
  // just 'approved': a sale does not stop being one the moment it is disbursed.
  const loans = await fetchAll(() => db.from('loans').select('team, principal_amt, loan_amt, approved_date')
    .in('stage', SALES_STAGES).gte('approved_date', monthFrom).lte('approved_date', today));
  const salesNum = mine(loans).reduce((s, r) => s + (num(r.principal_amt) || num(r.loan_amt)), 0);
  const teamCount = user.teams ? user.teams.length : (await teamList(db)).length;
  const salesDen = monthly * Math.max(teamCount, 1);

  /* KESHO % -- early collection. Officers are judged on TOMORROW's list as much as today's,
     so it sits right beside Col: leave it off and the number they are measured on is the one
     thing the phone never shows them. Same derivation as the Kesho tab -- the sheet dated
     tomorrow, with Friday and the weekend rolling on to Monday. */
  const u = isoWeekday(nowMs);
  /* TEAM-DAY TOTALS, not customers. The strip is six percentages -- no name, no number, no
     balance -- and two hundred handsets ask for it every few minutes. An all-teams admin was
     downloading the whole book to work out two of them. */
  let kSnap = await expectedTotalsLatest(db,
    { type: 'today', onDate: addDaysKey(today, u >= 5 ? (8 - u) : 1), teams: user.teams });
  /* THE SAME FALLBACK THE KESHO TAB HAS, AND IT WAS MISSING HERE.
     Nobody uploads an "Expected - Tomorrow" sheet -- tomorrow's list is the ordinary Expected
     sheet filed under tomorrow's date, and the tab has always read it that way with the old
     explicit type behind it. This figure only had the first half, so on any deployment that
     never files a sheet ahead, Kesho on the strip read a permanent dash while the Kesho tab
     right below it listed customers. A number that is always blank looks exactly like a bar
     that is not working. */
  if (!kSnap.rows.length) {
    kSnap = await expectedTotalsLatest(db, { type: 'tomorrow', notAfter: today, teams: user.teams });
  }
  const kRows = mine(kSnap.rows);
  const kExp = tExpected(kRows);
  const kCol = tCollected(kRows);

  /* WEEK COL -- collection Mon-Fri to date. A day on its own says nothing about whether the
     week is being carried; the officers are chased on the week, so the week is on the bar.
     Same per-day batch resolution the dashboard uses on weekends, so a re-upload of any day
     supersedes rather than doubles. */
  /* AND THE ILIYONASIA REGISTER OVER THE SAME FIVE DAYS.
     "not just there ... everywhere the amount should add as stated during manual input"
     Without it this one figure -- the week's Col, on the bar three hundred officers read all
     day -- would be the last place in the system still quoting the deck alone, and it would
     contradict the Col beside it on the same bar, which comes from buildDashboard and does
     apply the register.

     RULE 1, COUNTED. This is ONE read on the call path: a hand-typed book of tens of rows,
     bounded to Monday-Friday, issued IN PARALLEL with the week read above rather than after
     it, so the strip waits no longer than it did. It sits behind summaryCache and its single
     flight, so it is one read per scope per refresh, not one per handset -- and a deployment
     without the table gets null and the bar is exactly what it is today. The budget for this
     whole path is in test/speed.test.mjs and it went up by one in the same commit. */
  const weekMon_ = weekMondayKey(nowMs), weekFri_ = addDaysKey(weekMon_, 4);
  const [weekAll, wAdj] = await Promise.all([
    expectedTotalsInRange(db, { type: 'today', from: weekMon_, to: weekFri_, teams: user.teams }),
    // On a budget: the strip draws on time or without the correction, never late. See
    // ADJ_BUDGET_MS -- a slow database is a reason to ask for less, not to make the phone wait.
    adjReceived_(db, user, { from: weekMon_, to: weekFri_, budgetMs: ADJ_BUDGET_MS }),
  ]);
  const wRows = [...resolveLatestPerKey(weekAll, r => r.snapshot_date).entries()]
    .flatMap(([date, s]) => withAdj_(mine(s.rows), wAdj, 'expected-current', date));
  const wExp = tExpected(wRows);
  const wCol = tCollected(wRows);

  /* EXP.DEF % -- what has come back off the day's expected defaulters against what they owed
     at the start of it. A recycling leader sees their own book; everyone else sees the team's,
     exactly as the Exp.Def tab below does. */
  let expdf = { pct: null, num: 0, den: 0, customers: 0 };
  try {
    const x = await expdfMine(db, user, { scope: 'auto' }, nowMs);
    expdf = { pct: rat(x.totals.recovered, x.totals.initial), num: x.totals.recovered,
      den: x.totals.initial, customers: x.totals.customers, scope: x.scope };
  } catch (e) { /* no decks yet -- the bar shows a dash, never an error */ }

  const rec = d.totals.recovery;
  return {
    ok: true,
    period: d.period,
    col: { pct: rat(d.totals.collected, d.totals.expectedAmount), num: d.totals.collected, den: d.totals.expectedAmount },
    kesho: { pct: rat(kCol, kExp), num: kCol, den: kExp, customers: tCustomers(kRows) },
    weekCol: { pct: rat(wCol, wExp), num: wCol, den: wExp, customers: tCustomers(wRows) },
    sales: { pct: rat(salesNum, salesDen), num: salesNum, den: salesDen, teams: teamCount, basis: 'month' },
    expdf,
    recovery: { pct: rat(rec.recovered, rec.denominator), num: rec.recovered, den: rec.denominator, basis: rec.basis },
    /* REC LEO -- the newest paired deck day on its own, in shillings.
       On a weekend the Rec figure beside it is the whole week Mon-Fri, because there is no
       weekend deck to read, and a week total cannot tell an officer what the last day brought
       in: a steady week and a week carried entirely by Friday print the same number. This is
       that day by itself. It carries the DAY it belongs to, so the phone can say "leo" only
       when it really is today and name the day otherwise. */
    recToday: rec.latest
      ? { num: rec.latest.recovered, day: rec.latest.day, date: rec.latest.date, isToday: rec.latest.isToday }
      : null,
    /* WHICH UPLOAD THESE FIGURES ARE. The phone keeps the strip on screen across restarts, so
       it has to know what it is holding: it stores this beside the numbers and asks again only
       when a sync reports a different one. Sent by the figures themselves rather than assumed
       by the caller, so the two can never drift apart. */
    dataVersion: (await settingGet(db, 'DATA_VERSION')) || '',
  };
}

/* ---------- sync ---------- */
/** Phone -> {name, ref, team, role C|G, src EXP|DEF} index over exactly the universe the
    officers work: followup (defaulters) + today/tomorrow expected + alternate numbers logged
    via ANA NAMBA NYINGINE follow-ups. Customers win over guarantors for the same number. */
/* =======================================================================================
   THE ONE THAT TURNED THE DATABASE RED.

     "Whenever we insist our field officers to use the app, postgres gets full red, i can't
      even upload report updates, we get delay errors and so on."

   Measured, on a 40-team book: ONE sync carrying ONE call = 11 round trips and 4,002 rows.
   Every row of followup_status, every row of today's AND tomorrow's repayment snapshot, and
   the numbered comments -- the WHOLE COMPANY BOOK, on a request that only needed to answer
   "whose number is this".

   And it was rebuilt from scratch EVERY TIME. Nothing cached it.

   Three hundred handsets sync every five minutes. Through a working day that is roughly ONE
   FULL-BOOK SCAN PER SECOND, sustained, for eight hours -- from a table that also has to
   accept uploads. That is not a slow query anybody can point at; it is the database being
   asked to read its largest tables a thousand times an hour to answer a question whose answer
   did not change between any two of them. The uploads then queue behind it, which is exactly
   the "I can't even upload" half of the report.

   THE ANSWER WAS ALREADY IN THIS FUNCTION'S CALLER, two lines above the call to it.
   DATA_VERSION is stamped by api/upload.js the moment anything is uploaded, and sync already
   reads it on every request to tell the phone its figures are stale. So the index is cached
   against exactly that: same DATA_VERSION and same day means the same index, byte for byte,
   because the tables it reads only change when something is uploaded.

     first officer after an upload   pays the read, once
     the other 299                   free
     someone uploads                 DATA_VERSION moves, the next sync rebuilds

   No staleness window to get wrong, and no way for an officer to work an index older than the
   last upload -- which a plain time-to-live could not promise. The TTL underneath is a
   backstop for a deployment whose DATA_VERSION never moves (nothing uploaded yet, or an older
   upload path), so an unset key degrades to "rebuild every 5 minutes" rather than "cache
   forever".

   THE COST THIS CACHE USED TO CARRY -- AND NO LONGER DOES. A replacement number an officer
   records in a comment was not in the index until it rebuilt: at most five minutes, sooner if
   anything was uploaded. That read as a fair price until the field showed what officers
   actually do with "Ana namba nyingine" -- they record the number and DIAL IT, within the
   minute, and a synced call is never reclassified. So exactly the calls the status exists to
   enable were stamped non-portfolio, permanently. NEW_NUMBER_VERSION is the answer, and it is
   the same shape as DATA_VERSION on purpose: addComment moves it whenever a comment carries a
   number, it rides in the index's cache key, and every warm lambda rebuilds on its next sync
   instead of serving out the stale tail of its five minutes. Rebuilds are paid per recorded
   number -- a handful a day -- not per sync, which keeps the arithmetic above intact.

   Held against the DATABASE CLIENT like every other cache here, so a test's fake cannot hand
   its answer to the next test. In production that is one long-lived client per warm lambda,
   which is where the sharing happens. */
const PHONE_INDEX_TTL_MS = 300000;
const phoneIndexCache = new WeakMap();          // db -> { key, at, value }

/** `version` is DATA_VERSION plus NEW_NUMBER_VERSION, which the caller has ALREADY read --
    sync fetches both in one trip anyway (DATA_VERSION goes to the phone on every request so
    the handset knows when its figures went stale). Passing them in rather than re-reading
    them here keeps the cache free on a hit: a served index costs zero queries, not one. */
async function phoneIndex(db, nowMs, version) {
  const today = todayKey(nowMs);
  const key = today + '|' + String(version == null ? '' : version);
  const hit = phoneIndexCache.get(db);
  if (hit && hit.key === key && hit.at <= nowMs && (nowMs - hit.at) < PHONE_INDEX_TTL_MS) {
    return hit.value;
  }
  const value = await phoneIndexCompute(db, nowMs, today);
  phoneIndexCache.set(db, { key, at: nowMs, value });
  return value;
}

async function phoneIndexCompute(db, nowMs, today) {
  const [fu, eT, eM, eWin, cm] = await Promise.all([
    // The phone index needs names and numbers, nothing else.
    fetchAll(() => db.from('followup_status').select('ref, full_name, contact, guarantor_name, guarantor_contact, team')),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'today' }, { notAfter: today }),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'tomorrow' }, { notAfter: today }),
    /* THE TWO-WEEK WINDOW, AS ONE DATABASE TRIP. "sometimes they call customers not in these
       batches like expected of two next days b/se they have their numbers and i have not yet
       uploaded but last week has that number so any customer number within these 2 weeks is
       portfolio call." Every expected sheet dated in the last two weeks -- and any sheet
       already uploaded for a FUTURE date (no upper bound, deliberately).

       The first cut of this read the RAW SHEETS over REST: fourteen days of rows, thirty-plus
       pages per index rebuild -- and the rebuild is per warm lambda, so with three hundred
       handsets syncing that put enough read load on the database to slow SIGN-IN for
       everybody within the hour it shipped. The window is really DISTINCT CUSTOMERS, which is
       exactly what the database itself should collapse: expected_phone_window
       (db/RUN-ME-017) returns one row per distinct customer -- a few thousand rows, one or
       two pages. Where the function is not installed yet, the index falls back to the
       coverage it always had (today, tomorrow, the register) -- narrower, never heavier.
       The defaulter decks need no read of their own: every current-deck upload rebuilds
       followup_status with contacts and guarantors, and fu above is that whole register. */
    rpcAll(db, 'expected_phone_window', { p_from: addDaysKey(today, -13) })
      .then(r => (r.error || !Array.isArray(r.data)) ? [] : r.data),
    /* ONLY the comments that carry a replacement phone number. This read every comment ever
       written -- after the v1 history import, hundreds of thousands of rows -- to find the few
       hundred with a number on them. The portal's copy of this was fixed weeks ago and the
       phone's was not, which is why the app felt slower than the portal on the same data. */
    fetchAll(() => db.from('followup_comments').select('ref, new_number, full_name, team')
      .not('new_number', 'is', null).neq('new_number', '')),
  ]);
  const byNum = {};
  const add = (numRaw, name, ref, team, role, src) => {
    const d = pnorm(numRaw);
    if (!d || byNum[d]) return;               // first add wins -- customers are added before guarantors
    byNum[d] = { K: d, N: name || '', R: ref || '', T: team || '', C: role, S: src || '' };
  };
  /* =====================================================================================
     A CUSTOMER ON TODAY'S COLLECTION LIST IS A COLLECTION CALL, EVEN IF THEY ALSO OWE.

       "Simu zangu zinaenda upande wa defaulter"   -- CATHERINE, PMO COLLECTION, 34 teams
       Ripoti: 258 calls, Expected 8, Defaulter 229

     `add` is first-add-wins, and the follow-up REGISTER was added before today's expected
     sheet. So any customer who appears in both -- and most do, because the register is the
     standing book of everyone who has ever fallen behind -- was stamped DEF, and every call to
     them counted as a defaulter call. A collection officer working Leo all morning therefore
     read as somebody chasing defaulters.

     It got worse the moment the register was repaired. While the upload was only writing one
     slice of the deck, the register held a fraction of the book and most numbers fell through
     to EXP by accident. Filling it properly -- which was the right fix -- moved almost
     everybody to DEF. Her 229 is the size of that.

     TODAY'S SHEET WINS, and the reason is what the two lists MEAN. The register is standing:
     a customer sits in it for weeks. The expected sheet is TODAY -- this person has a payment
     due now, which is why they are on a phone today. Being behind as well does not change what
     the call was for.

     Customers still go in before guarantors; that ordering is separate and unchanged. */
  eT.rows.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'EXP'));
  eM.rows.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'EXP'));
  fu.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'DEF'));
  /* AFTER the register, on purpose: a standing defaulter who also sat on last week's sheet is
     still being chased as a defaulter -- only TODAY's and tomorrow's sheets outrank the
     register (the CATHERINE rule above). A customer known ONLY from the window -- last week's
     sheet, or one uploaded early for two days ahead -- lands here as EXPECTED. */
  eWin.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'EXP'));
  const refName = {}, refTeam = {}, refSrc = {};
  Object.values(byNum).forEach(o => { if (o.R) { refName[o.R] = o.N; refTeam[o.R] = o.T; refSrc[o.R] = o.S; } });
  cm.forEach(r => {
    const nn = String(r.new_number == null ? '' : r.new_number).trim();
    if (!nn) return;
    const ref = String(r.ref || '');
    add(nn, refName[ref] || r.full_name || '', ref, refTeam[ref] || r.team, 'C', refSrc[ref] || 'DEF');
  });
  eT.rows.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'EXP'));
  eM.rows.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'EXP'));
  fu.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'DEF'));
  eWin.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'EXP'));
  return byNum;
}
const OUTCOMES = { CONNECTED: 1, MISSED: 1, REJECTED: 1, BLOCKED: 1 };
async function sync(db, [dev, calls], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  // The same {name, role, teams} shape every other team check in this system uses, so
  // "is this customer mine" is answered by the one rule rather than by a second one here.
  const user = pseudoUser(cu);
  calls = calls || [];
  let wm = num(cu.last_ts);
  /* WHY A SYNC CARRIES A NUMBER THAT HAS NOTHING TO DO WITH CALLS.
     The performance strip is worked out from the whole book and is far too expensive to
     recompute on a timer for two hundred officers, so it used to refresh a quarter of an hour
     after an upload at best. This stamp changes the moment anything is uploaded. The phone is
     already talking to us every few minutes; it compares this against the one it holds and
     asks for new figures only when it has actually changed.
     One read of one row by primary key, on a request that was happening anyway. */
  /* NEW_NUMBER_VERSION rides in the same round trip: recording an "Ana namba nyingine"
     number moves it, and it is part of the phone index's cache key below, so the index is
     never stale for the call the officer makes the minute after recording the number. */
  const vs = await settingsMany(db, ['DATA_VERSION', 'NEW_NUMBER_VERSION']);
  const dataVersion = vs('DATA_VERSION') || '';
  if (!calls.length) return { ok: true, added: 0, dup: 0, watermark: wm, portfolio: 0, nonPortfolio: 0, dataVersion };
  const byNum = await phoneIndex(db, nowMs, dataVersion + '|' + (vs('NEW_NUMBER_VERSION') || ''));
  const records = [];
  const seenBatch = {};
  let pf = 0, npf = 0, batchDup = 0;
  for (const c of calls) {
    const ts = num(c.ts);
    if (!ts) continue;
    const d = pnorm(c.num);
    const dur = Math.max(0, num(c.dur));
    let outcome = String(c.outcome || 'CONNECTED').toUpperCase();
    if (!OUTCOMES[outcome]) outcome = 'CONNECTED';
    const id = 'C' + h36(dev + '|' + d + '|' + ts + '|' + dur + '|' + outcome);
    if (seenBatch[id]) { batchDup++; continue; }
    seenBatch[id] = 1;
    const m = byNum[d];
    /* PORTFOLIO MEANS *THEIR* BOOK, NOT THE COMPANY'S.
       "A user's portfolio calls should count for their assigned team's customers only, a call
        in other teams not assigned to the users are non portfolio."

       A match against any customer anywhere used to count -- so ringing a friend who happens
       to borrow from another branch scored as portfolio work, and an officer's portfolio ratio
       was not a measure of their own book at all.

       A customer with NO team recorded still counts as portfolio. That is a gap in the upload,
       not evidence the call was outside their book, and demoting it would dock an officer for
       somebody else's blank cell. A leader who sees every team keeps every match, which is
       right: every team is their book. */
    const mine = !!m && (!m.T || teamAllowed(user, m.T));
    records.push({
      id, user_id: cu.user_id, officer: cu.name, team: cu.team, phone: d,
      direction: c.dir === 'in' ? 'IN' : 'OUT',
      call_date: eatDate(ts), call_time: eatTime(ts), duration: dur,
      /* The customer is still NAMED on an out-of-book match -- the officer dialled the number,
         so this hides nothing from them, and a report that says "this call was to another
         team's customer" is more useful than one that says only "unmatched". */
      portfolio: mine, match_type: m ? (m.C === 'G' ? 'GUARANTOR' : 'CUSTOMER') : null,
      ref: m ? m.R : null, customer: m ? m.N : null,
      synced_at: new Date(nowMs).toISOString(),
      outcome, category: mine ? (m.S === 'EXP' ? 'EXPECTED' : 'DEFAULTER') : null,
    });
    if (mine) pf++; else npf++;
    if (ts > wm) wm = ts;
  }
  if (!records.length) return { ok: true, added: 0, dup: batchDup, watermark: wm, portfolio: 0, nonPortfolio: 0, dataVersion };
  // Dedup is the id PRIMARY KEY itself -- on conflict do nothing. No lock, no read-then-write
  // race: two overlapping syncs of the same call cannot both insert it, by construction.
  const { data: inserted, error } = await db.from('call_logs')
    .upsert(records, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  if (error) throw new Error(error.message);
  const added = (inserted || []).length;
  // Their own calls are folded into the warm set, so they are ticked the moment they look --
  // without throwing away an index the other 299 handsets are about to use.
  noteCalledToday(db, nowMs, records);
  const { error: e2 } = await db.from('call_users')
    .update({ last_sync: new Date(nowMs).toISOString(), last_ts: wm }).eq('user_id', cu.user_id);
  if (e2) throw new Error(e2.message);
  return { ok: true, added, dup: batchDup + (records.length - added), watermark: wm, portfolio: pf, nonPortfolio: npf, dataVersion };
}

/* ---------- comments / follow-up ---------- */
/* How much of one customer's history the phone asks for. Deliberately generous -- an officer
   scrolling back through a year of notes is doing their job -- but not unbounded. */
const COMMENT_LIMIT = 100;
async function comments(db, [dev, ref]) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  /* The four columns this list draws, newest first, capped. A customer with three years of
     imported history has hundreds of notes and nobody scrolls past the last few dozen -- and
     select('*') carried the promise dates, docket numbers and phone numbers the screen never
     shows, on a mobile connection, for every one of them. */
  /* The customer's registered complaints come back with their history -- the officer about to
     ring somebody must know there is an open complaint BEFORE the call. One keyed read,
     allowed to fail quietly so the history never stops loading over its side-dish. */
  const [{ data, error }, compRes] = await Promise.all([
    db.from('followup_comments')
      .select('comment, fu_status, created_by, created_at, new_number, promise_date, promise_amt')
      .eq('ref', String(ref)).order('created_at', { ascending: false }).limit(COMMENT_LIMIT),
    runQuery(() => db.from('complaints')
      .select('complainant, category, details, status, created_at')
      .eq('ref', String(ref)).order('created_at', { ascending: false }).limit(10)),
  ]);
  if (error) throw new Error(error.message);
  const items = (data || []).map(c => ({
    by: c.created_by || '', at: c.created_at ? eatStamp(Date.parse(c.created_at)) : '',
    fu: c.fu_status || '', comment: c.comment || '',
    /* The number an "Ana namba nyingine" recorded. It was written into the log and never
       shown anywhere on the phone -- the one fact that changes which number to dial next. */
    newNo: String(c.new_number == null ? '' : c.new_number).trim(),
    /* And the promise itself: an AHADI comment showed only the day it was WRITTEN, not the
       day the customer promised FOR -- the date the whole status exists to record. */
    promiseDate: c.promise_date ? String(c.promise_date).slice(0, 10) : '',
    promiseAmt: c.promise_amt == null ? null : num(c.promise_amt),
  }));
  const complaints = ((compRes && !compRes.error && compRes.data) ? compRes.data : []).map(c => ({
    who: c.complainant || '', what: String(c.details || c.category || '').slice(0, 200),
    status: c.status || '', at: c.created_at ? eatStamp(Date.parse(c.created_at)) : '',
  }));
  return { ok: true, items, complaints, capped: items.length >= COMMENT_LIMIT };
}
async function addComment(db, [dev, p], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) throw new Error('Device not registered.');
  p = p || {};
  const ref = String(p.ref == null ? '' : p.ref).trim();
  if (!ref) throw new Error('ref is required');
  const fu = p.fu || '';
  if (FU_NEED_DATE.includes(fu) && !p.promiseDate) throw new Error('A promise date is required for "Ametoa Ahadi".');
  if (FU_NEED_COMMENT.includes(fu) && !p.comment) throw new Error('A comment is required for that follow-up status.');
  if (FU_NEED_NUMBER.includes(fu) && !p.newNo) throw new Error('A new phone number is required for "Ana namba nyingine".');
  const now = new Date(nowMs).toISOString();
  // followup_comments.ref references followup_status(ref); an Expected customer who isn't a
  // defaulter has no row there yet -- create the stub so their call history still lands.
  const { error: sErr } = await db.from('followup_status')
    .upsert({ ref, team: p.team || null, full_name: p.name || null }, { onConflict: 'ref', ignoreDuplicates: true });
  if (sErr) throw new Error(sErr.message);
  const { error: cErr } = await db.from('followup_comments').insert({
    ref, team: p.team || null, full_name: p.name || null, comment: p.comment || null,
    fu_status: fu || null, promise_date: p.promiseDate || null, promise_amt: p.promiseAmt || null,
    new_number: p.newNo ? pnorm(p.newNo) : null, created_by: cu.name, created_at: now,
  });
  if (cErr) throw new Error(cErr.message);
  /* A COMMENT WITHOUT A STATUS KEEPS THE STATUS. The form accepts either a status or a bare
     comment ("Chagua hali au andika maoni") -- but this update wrote fu_status: fu || null,
     so a plain comment ERASED the chip the card was wearing. That is the "latest comments
     don't always ferment on the top card as some of them do": a customer marked Ametoa Ahadi
     went blank on the list the moment anyone added a note, and the next officer, seeing
     nothing on the card, rang them again. Only a chosen status now replaces the status (and
     its promise fields, which belong to it); a bare comment updates the comment trail alone. */
  const patch = { last_comment: p.comment || null, comment_by: cu.name, comment_at: now, updated_at: now };
  if (fu) {
    patch.fu_status = fu;
    patch.promise_date = p.promiseDate || null;
    patch.promise_amt = p.promiseAmt || null;
  }
  const { error: uErr } = await db.from('followup_status').update(patch).eq('ref', ref);
  if (uErr) throw new Error(uErr.message);
  /* RECORDING A REPLACEMENT NUMBER MOVES THE PHONE INDEX. The officer who has just written
     an "Ana namba nyingine" dials that number within the minute, and an index cached before
     this comment would stamp the call non-portfolio -- permanently, because a synced log is
     never reclassified. The stamp is part of the index's cache key (see phoneIndex), so every
     warm lambda rebuilds on its next sync. Allowed to fail quietly: the comment is saved
     either way, and a missed stamp only means the old five-minute window, not a lost note. */
  if (p.newNo) {
    await runQuery(() => db.from('settings')
      .upsert({ key: 'NEW_NUMBER_VERSION', value: String(nowMs) }, { onConflict: 'key' }));
  }
  return { ok: true, ref, savedAt: now };
}

/* ---------- leader report ---------- */
const POS_ORDER = ['manager', 'opm', 'gmo', 'credit', 'recovery', 'expected', 'bike'];
const POS_LABEL = { manager: 'Manager', opm: 'OPM', gmo: 'GMO', credit: 'Credit', recovery: 'Recovery', expected: 'Expected', bike: 'Bike' };
/** Live leader resolution off the teams table's role columns (same columns as the Leaders
    sheet) -- a reassignment shows up without re-registering, and positions come from the
    most senior role held. Exported for the portal's contacts export, so "what is this
    person's title" has exactly one definition. */
export function buildLeaderMaps(teamRows) {
  const teamsOf = {}, posOf = {};
  for (const r of teamRows) {
    for (const col of POS_ORDER) {
      const nm = K(r[col]);
      if (!nm) continue;
      if (!teamsOf[nm]) teamsOf[nm] = {};
      if (r.team) teamsOf[nm][r.team] = 1;
      if (!posOf[nm]) posOf[nm] = {};
      posOf[nm][col] = 1;
    }
  }
  return { teamsOf, posOf };
}
export function positionOf(posOf, name, role) {
  const held = posOf[K(name)];
  if (held) { for (const p of POS_ORDER) if (held[p]) return POS_LABEL[p]; }
  role = String(role == null ? '' : role).trim();
  if (!role) return 'Officer';
  /* "PMO RECOVERY" and "PMO EXPECTED" on an access code are THE SAME JOBS as the teams
     sheet's recovery/expected columns -- confirmed by the owner ("they are the same job").
     Access-code roles are free-typed, so anyone whose name is not on the teams sheet used to
     surface in the Ripoti role picker as a second "Pmo recovery" group beside "Recovery",
     splitting one role's people and totals in two. Fold any role that carries the word into
     the canonical label; everything else keeps its typed role, capitalised as before. */
  const up = role.toUpperCase();
  if (up.indexOf('RECOVERY') >= 0) return POS_LABEL.recovery;
  if (up.indexOf('EXPECTED') >= 0) return POS_LABEL.expected;
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}
const categoryOf = r => (!r.portfolio ? 'OTHER' : (K(r.category) === 'EXPECTED' || K(r.category) === 'DEFAULTER') ? K(r.category) : 'UNCATEGORIZED');
const outcomeOf = r => { const o = K(r.outcome); return (o === 'MISSED' || o === 'REJECTED' || o === 'BLOCKED') ? o : 'CONNECTED'; };

async function reportCore(db, scopeTeams, from, to, alwaysUid, nowMs) {
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : addDaysKey(todayKey(nowMs), -7);
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : todayKey(nowMs);
  let scope = null;
  if (scopeTeams) {
    scope = {};
    (Array.isArray(scopeTeams) ? scopeTeams : String(scopeTeams).split(',')).forEach(t => { const k = K(t); if (k) scope[k] = 1; });
  }
  /* THE COUNTING IS THE DATABASE'S JOB -- the second time this report has been saved from the
     same symptom. The first rescue narrowed select('*') to ten columns, and that bought a
     year; 321 officers calling all week is six figures of rows, and no column diet survives
     that. Every figure below is a count or a sum grouped by day, officer, category and
     outcome, so call_report_rollup (db/RUN-ME-014) does the grouping where the rows live and
     a week crosses the wire as a few thousand grouped rows instead of ~100,000 call rows.

     The row read stays as the fallback, because migrations here are run by hand and the tab
     has to keep working -- limping, as it does today -- between the deploy and the paste. */
  const scopeKeys = scopeTeams && Object.keys(scope || {}).length ? Object.keys(scope) : null;
  let rollup = null;
  const [users0, teamRows] = await Promise.all([
    fetchAll(() => db.from('call_users').select('*')),
    readTeamsAll(db),
    (async () => {
      const { data, error } = await rpcAll(db, 'call_report_rollup',
        { p_from: fromKey, p_to: toKey, p_teams: scopeKeys });
      // [] is a real answer (a quiet window); only an ERROR means the function is not there.
      if (!error && Array.isArray(data)) rollup = data;
    })(),
  ]);
  let logs = [];
  if (!rollup) {
    /* Scoped at the database. A leader over one team read every call the whole company made
       in the window and discarded the rest here -- on the table that grows fastest of all.
       AND ONLY THE COLUMNS THE REPORT READS: the hash id, direction, call_time, match_type,
       customer and synced_at were most of the bytes on the wire and no figure touches them. */
    logs = await fetchAll(() => {
      let q = db.from('call_logs')
        .select('user_id, team, officer, call_date, duration, portfolio, category, outcome, ref, phone')
        .gte('call_date', fromKey).lte('call_date', toKey);
      if (scopeKeys) q = q.in('team', scopeKeys);
      return q;
    });
  }
  // Report by each officer's CURRENT team/name, not the snapshot taken when the call synced --
  // a reassignment must not strand old calls under a team nobody is scoped to see anymore.
  const curTeam = {}, curName = {}, curRole = {}, curPhone = {};
  users0.forEach(r => { curTeam[r.user_id] = r.team || ''; curName[r.user_id] = r.name || ''; curRole[r.user_id] = r.role || ''; curPhone[r.user_id] = r.phone || ''; });
  const { posOf } = buildLeaderMaps(teamRows);
  const teamBranch = new Map(teamRows.map(t => [K(t.team), t.branch || null]));

  const rows = [];
  for (const r of logs) {
    const uid = String(r.user_id);
    const team = Object.prototype.hasOwnProperty.call(curTeam, uid) ? curTeam[uid] : r.team;
    // A leader's OWN calls always count in their OWN report even if their home team isn't in scope.
    if (scope && !scope[K(team)] && uid !== alwaysUid) continue;
    rows.push({ ...r, team, officer: curName[uid] || r.officer, uid });
  }
  const byDayUser = {}, users = {}, teams = {}, byCategory = {}, byOutcome = {};
  for (const r of rows) {
    const day = String(r.call_date), officer = String(r.officer), team = String(r.team), uid = r.uid;
    const dk = day + '|' + uid, isPf = !!r.portfolio;
    const cat = categoryOf(r), outc = outcomeOf(r), dur = num(r.duration);
    if (!byDayUser[dk]) byDayUser[dk] = { day, officer, team, calls: 0, dur: 0, pf: 0, npf: 0 };
    byDayUser[dk].calls++; byDayUser[dk].dur += dur; isPf ? byDayUser[dk].pf++ : byDayUser[dk].npf++;
    if (!users[uid]) users[uid] = { name: officer, team, role: curRole[uid] || '', phone: curPhone[uid] || '', calls: 0, dur: 0, pf: 0, npf: 0, days: {}, uniq: {}, expected: 0, defaulter: 0, connected: 0 };
    const u = users[uid];
    u.calls++; u.dur += dur; u.days[day] = 1;
    if (isPf) { u.pf++; u.uniq[String(r.ref || r.phone)] = 1; } else u.npf++;
    if (cat === 'EXPECTED') u.expected++; else if (cat === 'DEFAULTER') u.defaulter++;
    if (outc === 'CONNECTED') u.connected++;
    if (!teams[team]) teams[team] = { team, calls: 0, dur: 0, pf: 0, npf: 0 };
    teams[team].calls++; teams[team].dur += dur; isPf ? teams[team].pf++ : teams[team].npf++;
    if (!byCategory[cat]) byCategory[cat] = { category: cat, calls: 0, dur: 0, connected: 0 };
    byCategory[cat].calls++; byCategory[cat].dur += dur; if (outc === 'CONNECTED') byCategory[cat].connected++;
    if (!byOutcome[outc]) byOutcome[outc] = { outcome: outc, calls: 0, dur: 0 };
    byOutcome[outc].calls++; byOutcome[outc].dur += dur;
  }
  /* THE SAME AGGREGATION FROM GROUPED ROWS. Each 'g' row is (day, officer, category, outcome,
     portfolio) with its count and talk time already added up by the database; this walks them
     with the same current-team remap and the same scope rule the per-call loop above applies,
     so the two roads land on identical figures -- the agreement test holds them to it. The
     'u' rows carry each officer's distinct portfolio customers, which no grouped count can
     reproduce (the same customer rung twice must count once). */
  const rollTot = { calls: 0, duration: 0, portfolio: 0, nonPortfolio: 0 };
  if (rollup) for (const g of rollup) {
    if (g.kind !== 'g') continue;
    const uid = String(g.user_id);
    const team = Object.prototype.hasOwnProperty.call(curTeam, uid) ? curTeam[uid] : (g.team || '');
    if (scope && !scope[K(team)] && uid !== alwaysUid) continue;
    const day = String(g.day).slice(0, 10);
    const officer = curName[uid] || '';
    const n = num(g.calls), dur = num(g.dur), isPf = !!g.portfolio;
    const cat = g.category, outc = g.outcome;
    rollTot.calls += n; rollTot.duration += dur; isPf ? rollTot.portfolio += n : rollTot.nonPortfolio += n;
    const dk = day + '|' + uid;
    if (!byDayUser[dk]) byDayUser[dk] = { day, officer, team, calls: 0, dur: 0, pf: 0, npf: 0 };
    const bd = byDayUser[dk];
    bd.calls += n; bd.dur += dur; isPf ? bd.pf += n : bd.npf += n;
    if (!users[uid]) users[uid] = { name: officer, team, role: curRole[uid] || '', phone: curPhone[uid] || '', calls: 0, dur: 0, pf: 0, npf: 0, days: {}, uniq: {}, uniqN: 0, expected: 0, defaulter: 0, connected: 0 };
    const u = users[uid];
    u.calls += n; u.dur += dur; u.days[day] = 1;
    isPf ? u.pf += n : u.npf += n;
    if (cat === 'EXPECTED') u.expected += n; else if (cat === 'DEFAULTER') u.defaulter += n;
    if (outc === 'CONNECTED') u.connected += n;
    if (!teams[team]) teams[team] = { team, calls: 0, dur: 0, pf: 0, npf: 0 };
    teams[team].calls += n; teams[team].dur += dur; isPf ? teams[team].pf += n : teams[team].npf += n;
    if (!byCategory[cat]) byCategory[cat] = { category: cat, calls: 0, dur: 0, connected: 0 };
    byCategory[cat].calls += n; byCategory[cat].dur += dur; if (outc === 'CONNECTED') byCategory[cat].connected += n;
    if (!byOutcome[outc]) byOutcome[outc] = { outcome: outc, calls: 0, dur: 0 };
    byOutcome[outc].calls += n; byOutcome[outc].dur += dur;
  }
  if (rollup) for (const g of rollup) {
    if (g.kind !== 'u') continue;
    const uid = String(g.user_id);
    if (users[uid]) users[uid].uniqN = num(g.uniq);
  }
  /* AN OFFICER WHO MADE NO CALLS IS THE POINT OF THIS REPORT.

     Everything above is built from the call log, so somebody who never opened the app all week
     simply did not appear -- and that is the one name a review of underperformance most needs
     to see. A report that quietly omits its worst case is worse than no report.

     So every registered officer in scope is placed on the board, at zero if that is what they
     did. Switched-off accounts are left out: they are not expected to be calling, and listing
     them as zeroes would bury the officers who are. */
  for (const u of users0) {
    const uid = String(u.user_id);
    if (users[uid]) continue;
    if (u.active === false) continue;
    const team = u.team || '';
    if (scope && !scope[K(team)] && uid !== alwaysUid) continue;
    if (!String(u.name || '').trim()) continue;
    users[uid] = { name: u.name, team, role: u.role || '', phone: u.phone || '', calls: 0, dur: 0, pf: 0, npf: 0,
      days: {}, uniq: {}, expected: 0, defaulter: 0, connected: 0 };
  }

  const CAT_ORDER = { EXPECTED: 1, DEFAULTER: 2, UNCATEGORIZED: 3, OTHER: 4 };
  const OUT_ORDER = { CONNECTED: 1, MISSED: 2, REJECTED: 3, BLOCKED: 4 };
  const totals = rollup ? rollTot : { calls: rows.length, duration: 0, portfolio: 0, nonPortfolio: 0 };
  if (!rollup) rows.forEach(r => { totals.duration += num(r.duration); r.portfolio ? totals.portfolio++ : totals.nonPortfolio++; });
  totals.ratio = totals.calls ? totals.portfolio / totals.calls : 0;
  return {
    from: fromKey, to: toKey,
    byDay: Object.keys(byDayUser).sort().map(k => byDayUser[k]),
    users: Object.keys(users).sort((a, b) => users[a].name < users[b].name ? -1 : users[a].name > users[b].name ? 1 : 0).map(k => {
      const u = users[k];
      /* The phone each officer REGISTERED with rides along, so the board that shows a name
         at zero can also ring that name -- the whole reason a supervisor is looking at it. */
      return { name: u.name, team: u.team, branch: teamBranch.get(K(u.team)) || null, position: positionOf(posOf, u.name, u.role), phone: u.phone || '', calls: u.calls, duration: u.dur,
        portfolio: u.pf, nonPortfolio: u.npf, ratio: u.calls ? u.pf / u.calls : 0,
        uniqCustomers: u.uniqN != null ? u.uniqN : Object.keys(u.uniq).length, days: Object.keys(u.days).length,
        expected: u.expected, defaulter: u.defaulter, connected: u.connected, connectRatio: u.calls ? u.connected / u.calls : 0 };
    }),
    teams: Object.keys(teams).sort().map(k => { const t = teams[k]; return { team: t.team, branch: teamBranch.get(K(t.team)) || null, calls: t.calls, duration: t.dur, portfolio: t.pf, nonPortfolio: t.npf, ratio: t.calls ? t.pf / t.calls : 0 }; }),
    byCategory: Object.keys(byCategory).sort((a, b) => (CAT_ORDER[a] || 9) - (CAT_ORDER[b] || 9)).map(k => { const c = byCategory[k]; return { category: c.category, calls: c.calls, duration: c.dur, connected: c.connected, connectRatio: c.calls ? c.connected / c.calls : 0 }; }),
    byOutcome: Object.keys(byOutcome).sort((a, b) => (OUT_ORDER[a] || 9) - (OUT_ORDER[b] || 9)).map(k => { const o = byOutcome[k]; return { outcome: o.outcome, calls: o.calls, duration: o.dur }; }),
    totals,
  };
}
async function report(db, [dev, from, to, team, leader], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  if (!cu.is_leader) throw new Error('Leader access only.');
  const teamRows = await readTeamsAll(db);
  const { teamsOf, posOf } = buildLeaderMaps(teamRows);
  const live = Object.keys(teamsOf[K(cu.name)] || {});
  const lt = cu.leader_teams;
  const full = live.length ? live : ((!lt || !lt.length || lt.some(t => K(t) === 'ALL')) ? null : lt);

  // The list that fills the Team dropdown on the phone: every team this leader is allowed to
  // look at. A leader who sees ALL gets every team on the books; anyone else gets only theirs.
  // It is built from the leader's PERMISSION, not from who happened to make calls this week --
  // a team with a quiet week must still be pickable, otherwise it looks like it disappeared.
  const choices = (full ? full : teamRows.map(r => r.team))
    .map(t => String(t || '').trim()).filter(Boolean)
    .filter((t, i, a) => a.findIndex(x => K(x) === K(t)) === i)
    .sort();

  /* SORTING BY A LEADER, ON THE PHONE TOO.

       "Add leader drop down after team selection in Ripoti, so if I choose leader from a
        dropdown of present system leaders eg Catherine then the below calls appear of
        catherine's teams and leaders too"

     The portal has had this since the same request was made about it; Ripoti was left with the
     team dropdown alone, so answering "how is Catherine's book doing" on a handset meant picking
     her teams out of a forty-line list one at a time and adding them up by hand.

     A leader holds several teams, so naming one resolves to exactly those -- and everybody
     working under them, other leaders included, comes back together because the report is built
     from the teams rather than from the person.

     NARROWED BY WHAT THE CALLER MAY SEE, NEVER WIDENED. Choosing a leader whose teams overlap
     yours shows the overlap; choosing one whose teams you hold none of shows nothing rather than
     showing you somebody else's book. A leader filter must not become a way round team scoping,
     and on the phone that matters more, not less. */
  const wantLead = String(leader == null ? '' : leader).trim();
  const leadName = (wantLead && Object.keys(teamsOf).find(n => K(n) === K(wantLead))) || '';
  let scope = full;
  if (leadName) {
    const theirs = Object.keys(teamsOf[K(leadName)] || {});
    scope = scope ? theirs.filter(t => scope.some(s => K(s) === K(t))) : theirs;
  }

  // A team picked in the dropdown narrows the scope further, but only to a team they could
  // already see. An unrecognised or out-of-scope name is ignored rather than obeyed, so the
  // dropdown can never be used to read a team the leader has no business reading -- and with a
  // leader chosen, "in scope" means inside THAT leader's teams as well.
  const want = String(team == null ? '' : team).trim();
  const picked = want && choices.find(t => K(t) === K(want)) || '';
  if (picked && (!scope || scope.some(t => K(t) === K(picked)))) scope = [picked];

  /* While looking at somebody else's book, the leader's own calls stay out of it unless their
     own team is inside what is being looked at. Otherwise a manager filtering to Catherine
     would see their own Team A calls mixed in and read them as hers. */
  const filtered = !!(picked || leadName);
  const alwaysUid = !filtered ? cu.user_id
    : ((scope && scope.some(t => K(t) === K(cu.team))) ? cu.user_id : null);

  const out = await reportCore(db, scope, from, to, alwaysUid, nowMs);
  out.ok = true;
  out.teamChoices = choices;
  out.team = picked;
  /* Only the leaders this person may actually look at -- somebody holding four teams should not
     be handed a dropdown of forty names, thirty-six of which answer "nothing". Built from the
     same map the scoping uses, so the list and the rule can never disagree. */
  const mine = full ? new Set(full.map(K)) : null;
  out.leaderChoices = Object.keys(teamsOf)
    .filter(n => !mine || Object.keys(teamsOf[n]).some(t => mine.has(K(t))))
    .sort()
    .map(n => ({ name: n, position: positionOf(posOf, n, ''), teams: Object.keys(teamsOf[n]).length }));
  out.leader = leadName;
  out.debugScope = scope || 'ALL';
  out.debugHomeTeam = cu.team || '';
  return out;
}

/** The same report, reached from the PORTAL instead of a registered device: scope comes from
    the access code's own teams (widened by any teams that person leads live off the teams
    role columns), optionally narrowed to one team the caller may already see. Port of
    api_callReportPortal -- one report implementation for both front ends. */
export async function reportCoreForPortal(db, user, { from, to, team, leader, user: user_ } = {}, nowMs = Date.now()) {
  const teamRows = await readTeamsAll(db);
  const { teamsOf, posOf } = buildLeaderMaps(teamRows);
  const live = Object.keys(teamsOf[K(user.name)] || {});
  let scope = live.length ? live : user.teams;                 // null stays null = ALL

  /* SORTING BY A LEADER, NOT ONLY BY A TEAM.
     "at Ripoti not only sorting teams we should also be able to sort by any leaders and their
      teams will show e.g sorting a pmo recovery then the pmo and other call app users of their
      intermatching teams appear"

     A leader holds several teams, and the question somebody actually asks is "how is this
     person's book doing" -- which meant picking their teams out of a forty-line dropdown one at
     a time and adding the answers up by hand. Naming the leader resolves to exactly the teams
     they hold, so every officer working under them appears together.

     NARROWED BY WHAT THE CALLER MAY SEE, never widened. Choosing a leader whose teams overlap
     yours shows the overlap; choosing one whose teams you hold none of shows nothing rather
     than showing you somebody else's book. A leader filter must not become a way round team
     scoping. */
  const wantLead = String(leader || '').trim();
  if (wantLead) {
    const theirs = Object.keys(teamsOf[K(wantLead)] || {});
    scope = scope ? theirs.filter(t => scope.some(s => K(s) === K(t))) : theirs;
  }

  const want = String(team || '').trim();
  if (want) {
    const allowed = !scope || scope.some(t => K(t) === K(want));
    if (allowed) scope = [want];                               // not allowed -> keep their normal scope
  }
  const out = await reportCore(db, scope, from, to, null, nowMs);

  /* SORTING BY A USER, AND GETTING THEIR TEAMS' USERS WITH THEM.
     "sort call ripoti by user and their assigned teams' users"

     A leader narrows to the teams they HOLD. This narrows to the teams one person WORKS -- and
     then shows everybody on those teams, not that person alone. Which is the question a
     supervisor actually asks: not "how did Juma do" but "how is Juma's patch doing", and the
     answer is meaningless without the officers beside him.

     Applied to the built report rather than to the scope, because the officer's own team comes
     from the report itself -- resolving it beforehand would mean reading call_users twice and
     risking two answers about which team somebody is on. */
  const wantUser = String(user_ || '').trim();
  if (wantUser) {
    /* =====================================================================================
       A PERSON'S TEAMS ARE THE TEAMS THEY HOLD, NOT THE TEAMS THEIR CALLS LANDED ON.

         "teams - loaded single team ... it loaded just dodoma for Betty instead of all her
          assigned teams"

       This built the set from the report's OWN rows -- the teams a call happened to be filed
       under during the window asked for. A call is stamped with the officer's home team at the
       moment it syncs, so somebody who leads eleven teams and whose own calls all landed on
       Dodoma resolved to Dodoma, and the report about her book showed a eleventh of it.

       Her book is what she HOLDS, and the system already knows it in two places: the teams
       table's role columns (a leader named in gmo/manager/recovery/credit/... on a team holds
       that team) and her own registration -- the home team, plus the teams her access code
       carries if she signed in as a leader.

       All three are taken together. The call-derived teams stay in the union rather than being
       replaced by it: somebody who worked a team they do not formally hold still worked it, and
       dropping that would be a different way of showing less than the truth. */
    const held = new Set();
    Object.keys(teamsOf[K(wantUser)] || {}).forEach(t => { const k = K(t); if (k) held.add(k); });
    /* One small read, by name, for the registration. `ilike` because a name typed into a search
       box is not going to match the stored capitalisation, and this is the same person either
       way. */
    const reg = await fetchAll(() => db.from('call_users')
      .select('team, leader_teams').ilike('name', wantUser));
    for (const r of (reg || [])) {
      const k = K(r.team); if (k) held.add(k);
      for (const t of (r.leader_teams || [])) { const x = K(t); if (x && x !== 'ALL') held.add(x); }
    }
    const theirTeams = new Set(held);
    (out.byDay || []).filter(r => K(r.officer) === K(wantUser))
      .forEach(r => { const k = K(r.team); if (k) theirTeams.add(k); });
    const mate = r => theirTeams.has(K(r.team));
    if (theirTeams.size) {
      out.users = (out.users || []).filter(mate);
      out.byDay = (out.byDay || []).filter(mate);
      out.teams = (out.teams || []).filter(mate);
      out.totals = {
        calls: out.users.reduce((s, u) => s + (u.calls || 0), 0),
        duration: out.users.reduce((s, u) => s + (u.duration || 0), 0),
        portfolio: out.users.reduce((s, u) => s + (u.portfolio || 0), 0),
        nonPortfolio: out.users.reduce((s, u) => s + (u.nonPortfolio || 0), 0),
      };
      out.totals.ratio = out.totals.calls ? out.totals.portfolio / out.totals.calls : 0;
    }
    out.userTeams = [...theirTeams];
  }
  out.user = wantUser;
  /* Everybody who made a call in the window, so the dropdown offers people the report can
     actually answer for rather than the whole staff list. */
  out.users_ = [...new Set((out.byDay || []).map(r => r.officer).filter(Boolean))].sort();
  out.ok = true;
  out.scope = scope || 'ALL';
  /* Every name the teams table carries in a leader column, with the position they hold, so the
     dropdown can be built from the same map the scoping uses rather than from a second guess
     about who counts as a leader. */
  out.leaders = Object.keys(teamsOf).sort().map(n => ({
    name: n, position: positionOf(posOf, n, ''), teams: Object.keys(teamsOf[n]).length }));
  out.leader = wantLead || '';
  return out;
}

/* ---------- dispatch ---------- */
/** The company's name and logo, with nothing else attached -- the launcher, the sign-in
    screens and the upload page all show the brand before anyone has identified themselves,
    and none of them should have to impersonate a handset to ask for it. One setting feeds
    every surface, so uploading the logo once changes it everywhere. */
async function brand(db) {
  return { brand: (await settingGet(db, 'CALL_BRAND')) || APP.BRAND,
    motto: APP.MOTTO, logo: (await settingGet(db, 'CALL_LOGO_URL')) || '' };
}

/* THE ANNOUNCEMENT, READ BY ANYONE.

   When management puts a notice up it has to reach the SIGN-IN screen, which is exactly the
   place nobody has identified themselves yet -- so this cannot sit behind an access code. It
   rides beside api_brand, which is unauthenticated for the same reason.

   That is a deliberate decision with a cost: whatever is posted here is readable by anybody
   who can reach the site. It is a company noticeboard, not a private message, and the save
   side says so in as many words.

   `ts` is the whole point of the shape. A phone polls this; an image does not. So the poll
   carries a version stamp and the image only comes down when that stamp changes. */
async function announcement(db) {
  const rows = await fetchAll(() => db.from('announcement').select('*'));
  const a = rows[0];
  if (!a || !a.is_on) return { on: false, ts: 0 };
  const ts = Date.parse(a.updated_at || '') || 0;
  return { on: true, ts, text: String(a.text || ''), image: String(a.image_url || '') };
}

/* =====================================================================================
   THE WIDGET FEED. One small answer, for a screen nobody is holding.

   The point of a widget is that nobody opens anything: it sits on a phone's home screen or on
   a monitor in the office and stays right. That means it will be asked the same question over
   and over, all day, by every device that has it -- so this answer has to be CHEAP. It is the
   same six numbers the officers' phones already show, and nothing else: no customer rows, no
   names, no phone numbers. A few hundred bytes.

   It also means it must never need a login screen. A widget cannot show a form. So it takes
   the code the person already has -- a leader's access code or an officer's team code, the
   same two the launcher understands -- and that code is what scopes the figures. Anyone
   holding a code can already see these numbers by opening the app; this only saves them the
   opening. */
/* THE ANSWER IS THE SAME FOR EVERYONE ON THE SAME TEAMS, SO WORK IT OUT ONCE.

   The widget's figures are a whole dashboard computation -- and for somebody who sees every
   team, that is the heaviest question this system can be asked. Left uncached, a wall display
   and ten phones on the same team would each pay for it in full, every two minutes, all day.
   For a leader scoped to ALL teams it was slow enough that the platform cut the request off
   before it could answer, which is what "mtandao haujibu" was really reporting.

   The figures come from uploads that happen a few times a day, so a copy kept for two minutes
   is never meaningfully behind, and every screen after the first gets its answer instantly.
   Two minutes also matches how often a screen asks, so a room full of them costs about what
   one of them costs.

   Kept in the running process, which serverless hosting reuses between requests but may throw
   away at any moment. That is fine: an empty cache just means doing the work, which is what
   used to happen every time. */
const WIDGET_TTL_MS = 120000;
const widgetCache = new Map();
function widgetKey_(user) {
  return (user.teams ? upperTeams(user.teams).slice().sort().join(',') : 'ALL');
}
// Kept under its old name: it always meant "forget the figures", and now there is only one
// place to forget them.
export function _clearWidgetCache() { widgetCache.clear(); summaryCache.clear(); }   // tests only

async function widget(db, [code], nowMs) {
  const raw = String(code == null ? '' : code).trim();
  if (!raw) return { ok: false, error: 'NO_CODE' };

  /* HOPE Live is a system-side screen -- the whole company's figures on a wall -- so it opens
     and closes with the system, exactly as the admin asked. Checked BEFORE the code is looked
     up, so a closed system says "closed" rather than leaking whether a code is real. Admins
     are not exempt here: unlike the portal, nobody needs Live to turn the switch back on. */
  if (!(await isSystemOpen(db, nowMs))) return { ok: false, error: 'SYSTEM_CLOSED' };

  // A leader's access code first: it carries the wider scope of the two.
  const rows = await fetchAll(() => db.from('access_codes').select('code, name, role, teams').eq('code', raw));
  let user = null, who = '';
  if (rows.length) {
    const a = rows[0];
    user = { name: a.name, role: a.role, teams: a.teams && a.teams.length ? a.teams : null };
    who = a.name || '';
  } else {
    // Otherwise a team code, normalised exactly as register() and teamCode() normalise it, so
    // a code that opens one door opens this one and never the other way round.
    const c = K(raw).replace(/[^0-9A-Z]/g, '');
    const teams = await fetchAll(() => db.from('teams').select('team, team_code'));
    const hit = c && teams.find(t => K(t.team_code || '').replace(/[^0-9A-Z]/g, '') === c);
    if (!hit) return { ok: false, error: 'BAD_CODE' };
    user = { name: hit.team, role: 'TEAM', teams: [hit.team] };
    who = hit.team;
  }

  /* ONE CACHE, NOT TWO. This used to keep its own beside the figures' -- so the same numbers
     could be two minutes old here and fresh on a phone, from two different clocks. The cache
     now lives with the figures themselves and this simply asks for them. */
  const s = await summaryFor(db, user, nowMs);
  const fresh = !!s.cached;
  // Percentages and totals only. Deliberately no rows: a widget that carried customer data
  // would be putting names and balances on a lock screen anyone walking past can read.
  const trim = x => (x ? { pct: x.pct, num: x.num, den: x.den } : { pct: null, num: 0, den: 0 });
  const figures = {
    col: trim(s.col), kesho: trim(s.kesho), weekCol: trim(s.weekCol),
    sales: trim(s.sales), expdf: trim(s.expdf), recovery: trim(s.recovery),
    day: todayKey(nowMs),
    /* THE MOMENT THE FIGURES WERE WORKED OUT, not the moment they were handed over. A screen
       saying "live" over numbers computed four minutes ago is lying by a small amount, which
       is the only kind an unattended display gets away with -- but it has to be the real
       amount, so this comes from the cache entry and not from now. */
    at: new Date(s.computedAt == null ? nowMs : s.computedAt).toISOString(),
  };

  return {
    ok: true,
    who,
    scope: user.teams ? user.teams.join(', ') : 'All teams',
    brand: (await settingGet(db, 'CALL_BRAND')) || APP.BRAND,
    logo: (await settingGet(db, 'CALL_LOGO_URL')) || '',
    // The age of the FIGURES, not of this reply. A screen that says "live" over numbers worked
    // out four minutes ago is lying by a small amount, which is the only kind of lying an
    // unattended display gets away with for long.
    ...figures,
    cached: !!fresh,
  };
}

/* =====================================================================================
   THE CUSTOMER'S OWN VIEW. Third door into this system, beside Leaders and Officers.

   A customer types their reference number and sees their own loan. Nothing else: not a list,
   not a search, not another customer, not a total. One ref in, one loan out.

   WHAT IT DELIBERATELY DOES NOT RETURN, and why it matters:
   A reference number is the only thing being asked for, and refs are short and sequential --
   somebody who tries ten thousand of them gets ten thousand answers. That is tolerable when
   each answer is "your own balance", which the customer already knows, and NOT tolerable when
   each answer is a name attached to a working phone number. So no phone number, no guarantor
   name, no guarantor phone, ever, on this door. Whoever is holding the ref already knows the
   customer's number; printing it back only helps somebody who does not.

   The name IS returned, because without it a customer cannot tell whether they typed their own
   ref or their neighbour's, which is the one mistake this screen must not let pass quietly.

   HARDENING, when the operation wants it: set CUSTOMER_LOGIN_VERIFY to 'phone4' and the
   customer must also give the last four digits of the phone on their file. That turns
   guessing a ref into guessing a ref AND four digits, and the customer types four more
   characters. Off by default, because the ask was a reference number and nothing more. */
function last4_(s) { const d = String(s == null ? '' : s).replace(/\D/g, ''); return d.slice(-4); }
async function customerLookup(db, [ref, verify], nowMs) {
  const key = String(ref == null ? '' : ref).trim();
  if (!key) return { ok: false, error: 'NO_REF' };

  // The customer's own row, wherever it is freshest. Their loan lives in the repayment book
  // while it is being collected and in the follow-up book once it falls behind; a customer who
  // has gone quiet must not be told "hakuna taarifa" simply because they stopped being on a
  // daily list.
  const [snaps, fu] = await Promise.all([
    fetchAll(() => db.from('repayment_snapshots').select('*').eq('ref', key)),
    fetchAll(() => db.from('followup_status').select('*').eq('ref', key)),
  ]);
  const latest = snaps.slice().sort((a, b) =>
    String(a.snapshot_date || '').localeCompare(String(b.snapshot_date || ''))
    || String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .filter(r => r.snapshot_type === 'today' || r.snapshot_type === 'initial').pop()
    || snaps[snaps.length - 1] || null;
  const f = fu[0] || null;
  if (!latest && !f) return { ok: false, error: 'NOT_FOUND' };

  const src = latest || f;
  const mode = K(await settingGet(db, 'CUSTOMER_LOGIN_VERIFY') || '');
  if (mode === 'PHONE4') {
    const want = last4_(src.contact);
    // No number on file means nothing to check against. Refusing would lock out the very
    // customers whose records are thinnest, so the ref alone stands in that case.
    if (want && last4_(verify) !== want) return { ok: false, error: 'VERIFY_FAILED' };
  }

  // Their payments, newest first. "Did my payment arrive?" is the question this screen exists
  // to answer, and being able to answer it without phoning an officer is most of the point.
  const paid = await fetchAll(() => db.from('received_payments')
    .select('paid_at, amount_paid, transaction_id').eq('ref_no', key));
  const payments = paid
    .map(p => ({ date: String(p.paid_at || '').slice(0, 10), amount: num(p.amount_paid),
                 receipt: String(p.transaction_id || '') }))
    .filter(p => p.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 40);

  const arrears = num(latest ? latest.arrears : f.arrears);
  return {
    ok: true,
    ref: key,
    name: src.full_name || '',
    team: src.team || '',
    asOf: latest ? String(latest.snapshot_date || '').slice(0, 10) : null,
    loan: {
      dueSummary: latest ? (latest.due_summary || '') : '',    // "4/6" -- paid of target
      installment: num(latest && latest.initial_inst),
      expectedToday: num(latest && latest.payment_expected),
      paidToday: num(latest && latest.todays_payment),
      statusToday: latest ? (latest.todays_status || '') : '',
      balance: num(latest && latest.balance),
      total: num(latest && latest.total_amount),
      arrears,
      disbDate: String((latest && latest.disb_date) || (f && f.disb_date) || '').slice(0, 10) || null,
      lastPayment: String((latest && latest.last_trans_date) || (f && f.last_trans) || '').slice(0, 10) || null,
    },
    behind: arrears > 0,
    // What the officer has already been told, so a customer who has promised a date sees that
    // it was written down -- and does not get chased for something already agreed.
    promise: f && f.promise_date
      ? { date: String(f.promise_date).slice(0, 10), amount: num(f.promise_amt) } : null,
    payments,
    // Deliberately absent: contact, guarantor_name, guarantor_contact. See the note above.
  };
}

/** Is this a TEAM code? The launcher's sign-in box only understood portal access codes, so a
    field officer who typed the one code they were given got "Msimbo si sahihi" and stopped --
    when in fact their code was perfectly valid, just for the other door. This says which door
    a code opens, so the launcher can simply take them through it.

    It reveals nothing register() does not: the same code, typed there, already answers the
    same question -- and without a name and a phone number it still hands over nothing. */
async function teamCode(db, [code]) {
  // Matched exactly as register() matches it -- same normalisation, so a code that opens the
  // door there is a code this recognises here, and never the other way round.
  const c = K(String(code == null ? '' : code)).replace(/[^0-9A-Z]/g, '');
  if (!c) return { ok: false };
  const teams = await fetchAll(() => db.from('teams').select('team, team_code'));
  const hit = teams.find(t => K(t.team_code || '').replace(/[^0-9A-Z]/g, '') === c);
  return hit ? { ok: true, team: hit.team } : { ok: false };
}

/* THE BELL, FOR THE FIELD. Same updates as the portal's -- complaints logged at the desk and
   follow-up comments -- scoped to the teams this handset may see, through the SAME
   implementation. An officer had no way to learn that a complaint had been raised against a
   customer on their round except by being telephoned about it.

   "Read up to here" is remembered against the handset's own user id, so an officer marking
   theirs read does not mark anybody else's. */
async function callNotifications(db, [dev], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  const d = await notifCore(db, pseudoUser(cu), notifKeyFor(cu.user_id), nowMs);
  return { ok: true, ...d };
}
async function callNotifSeen(db, [dev], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  return { ok: true, ...(await notifSeenCore(db, notifKeyFor(cu.user_id), nowMs)) };
}

const HANDLERS = {
  api_brand: brand,
  api_teamCode: teamCode,
  api_customerLookup: customerLookup,
  api_widget: widget,
  api_announcement: announcement,
  api_callBoot: boot,
  api_callRegister: register,
  api_callList: list,
  api_callDailySummary: dailySummary,
  api_callSync: sync,
  api_callComments: comments,
  api_callAddComment: addComment,
  api_callReport: report,
  api_callNotifications: callNotifications,
  api_callNotifSeen: callNotifSeen,
};
export async function callApi(db, fn, args, nowMs = Date.now()) {
  const h = HANDLERS[fn];
  if (!h) { const e = new Error('Unknown call API: ' + fn); e.status = 400; throw e; }
  return h(db, args || [], nowMs);
}
