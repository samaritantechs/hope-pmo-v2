import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { TZ_OFFSET_MS, todayKey, weekMondayKey, isoWeekday, addDaysKey } from './time.js';
import { latestSnapshot, snapshotsInRange, resolveLatestPerKey, upperTeams } from './snapshots.js';
import { expectedTotalsInRange, expectedTotalsLatest, tCustomers, tExpected, tCollected } from './snapshot-totals.js';
import { buildDashboard } from './dashboard-core.js';
import { collectedOf } from './recovery.js';
import { expdfMine } from './expdf.js';
import { isSystemOpen } from './system-gate.js';
import { notifCore, notifSeenCore, notifKeyFor } from './notify.js';

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
  const rows = await fetchAll(() => db.from('teams').select('*'));
  return rows.filter(r => r.team).map(r => r.team).sort();
}

/* ---------- boot / register ---------- */
async function boot(db, [dev], nowMs) {
  const teams = await teamList(db);
  let cu = null, accountOff = false;
  try { cu = await userByDevice(db, dev); }
  catch (e) { if (e && e.accountOff) accountOff = true; else throw e; }
  const brand = (await settingGet(db, 'CALL_BRAND')) || APP.BRAND;
  const logo = (await settingGet(db, 'CALL_LOGO_URL')) || '';
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
  const syncSec = parseInt(await settingGet(db, 'CALL_SYNC_SECONDS'), 10);
  const logoutSetting = K(await settingGet(db, 'CALL_LOGOUT_ENABLED'));
  return {
    ok: true,
    systemOpen,
    userId: cu.user_id, name: cu.name, team: cu.team, role: cu.role,
    leader: !!cu.is_leader,
    // Whether the teams table names this person as a GMO / MANAGER / BIKE officer anywhere --
    // that, not their login role, is what gives them a rotation list to work.
    // Everyone follows up in this mode, so everyone gets the tab. The flag now only says
    // whether this person ALSO has a list of their own to switch to.
    expdfLeader: true,
    expdfOwner: await isRecycleLeader(db, cu.name),
    leaderTeams: cu.is_leader ? (!cu.leader_teams || !cu.leader_teams.length ? 'ALL' : cu.leader_teams.join(',')) : '',
    teams,
    watermark: num(cu.last_ts),
    fuStatuses: FU_STATUSES, fuNeedDate: FU_NEED_DATE, fuNeedComment: FU_NEED_COMMENT, fuNeedNumber: FU_NEED_NUMBER,
    brand, motto: APP.MOTTO, logo,
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
async function calledTodaySet(db, nowMs) {
  const raw = parseInt(String(await settingGet(db, 'CALL_MIN_SECS') || '').replace(/[^0-9]/g, ''), 10);
  const min = (isNaN(raw) || raw < 0) ? CALL_MIN_SECS_DEFAULT : raw;
  // Filtered here rather than in the query: durations are numbers, and PostgREST-style range
  // filters on this path compare as text, where '60' sorts below '6'.
  const rows = await fetchAll(() => db.from('call_logs').select('phone, duration').eq('call_date', todayKey(nowMs)));
  const set = {};
  for (const r of rows) {
    if (num(r.duration) <= min) continue;
    const d = pnorm(r.phone); if (d) set[d] = 1;
  }
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
const EARLY_ROLES = ['EXPECTED', 'COLLECTION'];

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
  const role = K(user && user.role);
  if (role === 'CREDIT' || role === 'CREDIT ANALYST') return 'CREDIT';
  if (EARLY_ROLES.includes(role)) return role;
  const n = K(user && user.name);
  if (!n) return null;
  const rows = await fetchAll(() => db.from('teams').select('credit, expected'));
  if (rows.some(t => K(t.credit) === n)) return 'CREDIT';
  if (rows.some(t => K(t.expected) === n)) return 'EXPECTED';
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
  // Leo and Kesho ONLY. The defaulter lists are the whole point of an early-collection
  // officer's follow-up work and must not be touched.
  if (which !== 'today' && which !== 'tomorrow') return rows;
  return rows.filter(r => {
    const d = dsParts(r.ds);
    return !d || (d.target - d.paid) <= limits.earlyMaxBehind;
  });
}

async function roleLimits(db) {
  const n = async (k, dflt) => {
    const v = await settingGet(db, k);
    const x = parseInt(v, 10);
    return isNaN(x) || x < 0 ? dflt : x;
  };
  return { creditMaxPaid: await n('CALL_CREDIT_MAX_PAID', 5),
    earlyMaxBehind: await n('CALL_EARLY_MAX_BEHIND', 1) };
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

async function list(db, [dev, which, which2], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  const user = pseudoUser(cu);
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
      if (user.teams && user.teams.length) q = q.in('team', upperTeams(user.teams));
      return q;
    });
    // Skip pure FK stubs (created so an EXPECTED customer's comment can reference
    // followup_status) -- a real defaulter row always carries status/arrears from its upload.
    rows = fu.filter(r => teamAllowed(user, r.team) && !(r.status == null && r.arrears == null)).map(r => ({
      ref: r.ref, name: r.full_name, contact: r.contact, gName: r.guarantor_name, gContact: r.guarantor_contact,
      amt: num(r.arrears), installment: num(r.rejesho), custStatus: r.status || '', fuStatus: r.fu_status || '',
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
    rows = snap.rows.filter(r => teamAllowed(user, r.team)).map(r => ({
      ref: r.ref, name: r.full_name, contact: r.contact, gName: r.guarantor_name, gContact: r.guarantor_contact,
      amt: num(r.arrears), installment: num(r.payment_expected), custStatus: r.todays_status || '', fuStatus: '',
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
  let narrowed = null;
  if (kind) {
    const before = rows.length;
    rows = narrowForRole(rows, kind, which, await roleLimits(db));
    if (rows.length !== before) narrowed = { role: kind, shown: rows.length, of: before };
  }
  return { ok: true, rows, asOf, stale, narrowed };
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
const SUMMARY_TTL_MS = 120000;
const summaryCache = new Map();
function summaryKey_(user) {
  return (user.teams ? upperTeams(user.teams).slice().sort().join(',') : 'ALL');
}
export function _clearSummaryCache() { summaryCache.clear(); }   // tests only
async function summaryFor(db, user, nowMs) {
  const key = summaryKey_(user);
  const hit = summaryCache.get(key);
  if (hit && (nowMs - hit.at) < SUMMARY_TTL_MS && hit.at <= nowMs) {
    return { ...hit.value, cached: true, computedAt: hit.at };
  }
  const value = await summaryCompute(db, user, nowMs);
  summaryCache.set(key, { at: nowMs, value });
  return { ...value, cached: false, computedAt: nowMs };
}
async function summaryCompute(db, user, nowMs) {
  const d = await buildDashboard(db, user, nowMs);
  const rat = (n, den) => (den > 0 ? n / den : null);
  const mine = rows => rows.filter(r => teamAllowed(user, r.team));

  const monthlyRaw = parseInt(String((await settingGet(db, 'SALES_TARGET_MONTHLY')) || '').replace(/[^0-9]/g, ''), 10);
  const monthly = (!monthlyRaw || isNaN(monthlyRaw) || monthlyRaw < 1) ? 100000000 : monthlyRaw;

  const today = todayKey(nowMs);
  const monthFrom = today.slice(0, 8) + '01';
  const loans = await fetchAll(() => db.from('loans').select('team, principal_amt, loan_amt, approved_date')
    .eq('stage', 'approved').gte('approved_date', monthFrom).lte('approved_date', today));
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
  const weekAll = await expectedTotalsInRange(db, { type: 'today',
    from: weekMondayKey(nowMs), to: addDaysKey(weekMondayKey(nowMs), 4), teams: user.teams });
  const wRows = mine([...resolveLatestPerKey(weekAll, r => r.snapshot_date).values()].flatMap(s => s.rows));
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
async function phoneIndex(db, nowMs) {
  const today = todayKey(nowMs);
  const [fu, eT, eM, cm] = await Promise.all([
    // The phone index needs names and numbers, nothing else.
    fetchAll(() => db.from('followup_status').select('ref, full_name, contact, guarantor_name, guarantor_contact, team')),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'today' }, { notAfter: today }),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'tomorrow' }, { notAfter: today }),
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
  fu.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'DEF'));
  eT.rows.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'EXP'));
  eM.rows.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'EXP'));
  const refName = {}, refTeam = {}, refSrc = {};
  Object.values(byNum).forEach(o => { if (o.R) { refName[o.R] = o.N; refTeam[o.R] = o.T; refSrc[o.R] = o.S; } });
  cm.forEach(r => {
    const nn = String(r.new_number == null ? '' : r.new_number).trim();
    if (!nn) return;
    const ref = String(r.ref || '');
    add(nn, refName[ref] || r.full_name || '', ref, refTeam[ref] || r.team, 'C', refSrc[ref] || 'DEF');
  });
  fu.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'DEF'));
  eT.rows.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'EXP'));
  eM.rows.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'EXP'));
  return byNum;
}
const OUTCOMES = { CONNECTED: 1, MISSED: 1, REJECTED: 1, BLOCKED: 1 };
async function sync(db, [dev, calls], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  calls = calls || [];
  let wm = num(cu.last_ts);
  /* WHY A SYNC CARRIES A NUMBER THAT HAS NOTHING TO DO WITH CALLS.
     The performance strip is worked out from the whole book and is far too expensive to
     recompute on a timer for two hundred officers, so it used to refresh a quarter of an hour
     after an upload at best. This stamp changes the moment anything is uploaded. The phone is
     already talking to us every few minutes; it compares this against the one it holds and
     asks for new figures only when it has actually changed.
     One read of one row by primary key, on a request that was happening anyway. */
  const dataVersion = (await settingGet(db, 'DATA_VERSION')) || '';
  if (!calls.length) return { ok: true, added: 0, dup: 0, watermark: wm, portfolio: 0, nonPortfolio: 0, dataVersion };
  const byNum = await phoneIndex(db, nowMs);
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
    records.push({
      id, user_id: cu.user_id, officer: cu.name, team: cu.team, phone: d,
      direction: c.dir === 'in' ? 'IN' : 'OUT',
      call_date: eatDate(ts), call_time: eatTime(ts), duration: dur,
      portfolio: !!m, match_type: m ? (m.C === 'G' ? 'GUARANTOR' : 'CUSTOMER') : null,
      ref: m ? m.R : null, customer: m ? m.N : null,
      synced_at: new Date(nowMs).toISOString(),
      outcome, category: m ? (m.S === 'EXP' ? 'EXPECTED' : 'DEFAULTER') : null,
    });
    if (m) pf++; else npf++;
    if (ts > wm) wm = ts;
  }
  if (!records.length) return { ok: true, added: 0, dup: batchDup, watermark: wm, portfolio: 0, nonPortfolio: 0, dataVersion };
  // Dedup is the id PRIMARY KEY itself -- on conflict do nothing. No lock, no read-then-write
  // race: two overlapping syncs of the same call cannot both insert it, by construction.
  const { data: inserted, error } = await db.from('call_logs')
    .upsert(records, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  if (error) throw new Error(error.message);
  const added = (inserted || []).length;
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
  const { data, error } = await db.from('followup_comments')
    .select('comment, fu_status, created_by, created_at')
    .eq('ref', String(ref)).order('created_at', { ascending: false }).limit(COMMENT_LIMIT);
  if (error) throw new Error(error.message);
  const items = (data || []).map(c => ({
    by: c.created_by || '', at: c.created_at ? eatStamp(Date.parse(c.created_at)) : '',
    fu: c.fu_status || '', comment: c.comment || '',
  }));
  return { ok: true, items, capped: items.length >= COMMENT_LIMIT };
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
  const { error: uErr } = await db.from('followup_status').update({
    fu_status: fu || null, promise_date: p.promiseDate || null, promise_amt: p.promiseAmt || null,
    last_comment: p.comment || null, comment_by: cu.name, comment_at: now, updated_at: now,
  }).eq('ref', ref);
  if (uErr) throw new Error(uErr.message);
  return { ok: true, ref, savedAt: now };
}

/* ---------- leader report ---------- */
const POS_ORDER = ['manager', 'opm', 'gmo', 'credit', 'recovery', 'expected', 'bike'];
const POS_LABEL = { manager: 'Manager', opm: 'OPM', gmo: 'GMO', credit: 'Credit', recovery: 'Recovery', expected: 'Expected', bike: 'Bike' };
/** Live leader resolution off the teams table's role columns (same columns as the Leaders
    sheet) -- a reassignment shows up without re-registering, and positions come from the
    most senior role held. */
function buildLeaderMaps(teamRows) {
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
function positionOf(posOf, name, role) {
  const held = posOf[K(name)];
  if (held) { for (const p of POS_ORDER) if (held[p]) return POS_LABEL[p]; }
  role = String(role == null ? '' : role).trim();
  if (!role) return 'Officer';
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
  const [users0, teamRows, logs] = await Promise.all([
    fetchAll(() => db.from('call_users').select('*')),
    fetchAll(() => db.from('teams').select('*')),
    fetchAll(() => db.from('call_logs').select('*').gte('call_date', fromKey).lte('call_date', toKey)),
  ]);
  // Report by each officer's CURRENT team/name, not the snapshot taken when the call synced --
  // a reassignment must not strand old calls under a team nobody is scoped to see anymore.
  const curTeam = {}, curName = {}, curRole = {};
  users0.forEach(r => { curTeam[r.user_id] = r.team || ''; curName[r.user_id] = r.name || ''; curRole[r.user_id] = r.role || ''; });
  const { posOf } = buildLeaderMaps(teamRows);

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
    if (!users[uid]) users[uid] = { name: officer, team, role: curRole[uid] || '', calls: 0, dur: 0, pf: 0, npf: 0, days: {}, uniq: {}, expected: 0, defaulter: 0, connected: 0 };
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
    users[uid] = { name: u.name, team, role: u.role || '', calls: 0, dur: 0, pf: 0, npf: 0,
      days: {}, uniq: {}, expected: 0, defaulter: 0, connected: 0 };
  }

  const CAT_ORDER = { EXPECTED: 1, DEFAULTER: 2, UNCATEGORIZED: 3, OTHER: 4 };
  const OUT_ORDER = { CONNECTED: 1, MISSED: 2, REJECTED: 3, BLOCKED: 4 };
  const totals = { calls: rows.length, duration: 0, portfolio: 0, nonPortfolio: 0 };
  rows.forEach(r => { totals.duration += num(r.duration); r.portfolio ? totals.portfolio++ : totals.nonPortfolio++; });
  totals.ratio = totals.calls ? totals.portfolio / totals.calls : 0;
  return {
    from: fromKey, to: toKey,
    byDay: Object.keys(byDayUser).sort().map(k => byDayUser[k]),
    users: Object.keys(users).sort((a, b) => users[a].name < users[b].name ? -1 : users[a].name > users[b].name ? 1 : 0).map(k => {
      const u = users[k];
      return { name: u.name, team: u.team, position: positionOf(posOf, u.name, u.role), calls: u.calls, duration: u.dur,
        portfolio: u.pf, nonPortfolio: u.npf, ratio: u.calls ? u.pf / u.calls : 0,
        uniqCustomers: Object.keys(u.uniq).length, days: Object.keys(u.days).length,
        expected: u.expected, defaulter: u.defaulter, connected: u.connected, connectRatio: u.calls ? u.connected / u.calls : 0 };
    }),
    teams: Object.keys(teams).sort().map(k => { const t = teams[k]; return { team: t.team, calls: t.calls, duration: t.dur, portfolio: t.pf, nonPortfolio: t.npf, ratio: t.calls ? t.pf / t.calls : 0 }; }),
    byCategory: Object.keys(byCategory).sort((a, b) => (CAT_ORDER[a] || 9) - (CAT_ORDER[b] || 9)).map(k => { const c = byCategory[k]; return { category: c.category, calls: c.calls, duration: c.dur, connected: c.connected, connectRatio: c.calls ? c.connected / c.calls : 0 }; }),
    byOutcome: Object.keys(byOutcome).sort((a, b) => (OUT_ORDER[a] || 9) - (OUT_ORDER[b] || 9)).map(k => { const o = byOutcome[k]; return { outcome: o.outcome, calls: o.calls, duration: o.dur }; }),
    totals,
  };
}
async function report(db, [dev, from, to, team], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  if (!cu.is_leader) throw new Error('Leader access only.');
  const teamRows = await fetchAll(() => db.from('teams').select('*'));
  const { teamsOf } = buildLeaderMaps(teamRows);
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

  // A team picked in the dropdown narrows the scope, but only to a team they could already see.
  // An unrecognised or out-of-scope name is ignored rather than obeyed, so the dropdown can
  // never be used to read a team the leader has no business reading.
  const want = String(team == null ? '' : team).trim();
  const picked = want && choices.find(t => K(t) === K(want)) || '';
  const scope = picked ? [picked] : full;

  // While looking at one chosen team, the leader's own calls stay out of it unless that IS
  // their team. Otherwise a manager filtering to Team B would see their own Team A calls
  // mixed in and think Team B made them.
  const alwaysUid = picked ? (K(cu.team) === K(picked) ? cu.user_id : null) : cu.user_id;

  const out = await reportCore(db, scope, from, to, alwaysUid, nowMs);
  out.ok = true;
  out.teamChoices = choices;
  out.team = picked;
  out.debugScope = scope || 'ALL';
  out.debugHomeTeam = cu.team || '';
  return out;
}

/** The same report, reached from the PORTAL instead of a registered device: scope comes from
    the access code's own teams (widened by any teams that person leads live off the teams
    role columns), optionally narrowed to one team the caller may already see. Port of
    api_callReportPortal -- one report implementation for both front ends. */
export async function reportCoreForPortal(db, user, { from, to, team } = {}, nowMs = Date.now()) {
  const teamRows = await fetchAll(() => db.from('teams').select('*'));
  const { teamsOf } = buildLeaderMaps(teamRows);
  const live = Object.keys(teamsOf[K(user.name)] || {});
  let scope = live.length ? live : user.teams;                 // null stays null = ALL
  const want = String(team || '').trim();
  if (want) {
    const allowed = !scope || scope.some(t => K(t) === K(want));
    if (allowed) scope = [want];                               // not allowed -> keep their normal scope
  }
  const out = await reportCore(db, scope, from, to, null, nowMs);
  out.ok = true;
  out.scope = scope || 'ALL';
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
async function callNotifications(db, [dev]) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  const d = await notifCore(db, pseudoUser(cu), notifKeyFor(cu.user_id));
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
