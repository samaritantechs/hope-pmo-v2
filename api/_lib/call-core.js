import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { TZ_OFFSET_MS, todayKey, weekMondayKey, isoWeekday, addDaysKey } from './time.js';
import { latestSnapshot, snapshotsInRange, resolveLatestPerKey } from './snapshots.js';
import { buildDashboard } from './dashboard-core.js';
import { collectedOf } from './recovery.js';
import { expdfMine } from './expdf.js';

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
  const teams = !cu.is_leader ? [K(cu.team)]
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
  if (!cu) return { ok: false, error: accountOff ? 'ACCOUNT_OFF' : 'DEVICE_NOT_REGISTERED',
    teams: [], brand, motto: APP.MOTTO, logo };
  const today = todayKey(nowMs);
  const logs = await fetchAll(() => db.from('call_logs').select('duration, portfolio').eq('user_id', cu.user_id).eq('call_date', today));
  const syncSec = parseInt(await settingGet(db, 'CALL_SYNC_SECONDS'), 10);
  const logoutSetting = K(await settingGet(db, 'CALL_LOGOUT_ENABLED'));
  return {
    ok: true,
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
  if (which === 'defaulters') {
    const fu = await fetchAll(() => db.from('followup_status').select('*'));
    // Skip pure FK stubs (created so an EXPECTED customer's comment can reference
    // followup_status) -- a real defaulter row always carries status/arrears from its upload.
    rows = fu.filter(r => teamAllowed(user, r.team) && !(r.status == null && r.arrears == null)).map(r => ({
      ref: r.ref, name: r.full_name, contact: r.contact, gName: r.guarantor_name, gContact: r.guarantor_contact,
      amt: num(r.arrears), installment: num(r.rejesho), custStatus: r.status || '', fuStatus: r.fu_status || '',
      ds: dsFmt(r.ds), days: r.days_elapsed == null ? '' : r.days_elapsed, team: r.team,
      called: hit(r.contact, r.guarantor_contact),
    }));
    rows.sort((a, b) => b.amt - a.amt);
  } else {
    // KESHO is DERIVED, not a separate upload. The PMO uploads each day's Expected sheet
    // under its own date, exactly as the live system worked -- so tomorrow's list is simply
    // the sheet dated tomorrow, and asking anyone to upload the same file twice under a
    // second label was a workflow this system invented for itself.
    //
    // There are no weekend sheets, so Friday's "tomorrow" is Monday, and so is the weekend's.
    let snap;
    if (which === 'tomorrow') {
      const u = isoWeekday(nowMs);
      const skip = u >= 5 ? (8 - u) : 1;          // Fri +3, Sat +2, Sun +1, otherwise +1
      snap = await latestSnapshot(db, 'repayment_snapshots',
        { snapshot_type: 'today' }, { onDate: addDaysKey(todayKey(nowMs), skip) });
      // Older uploads that used the explicit "Expected - Tomorrow" type still work.
      if (!snap.rows.length) {
        snap = await latestSnapshot(db, 'repayment_snapshots',
          { snapshot_type: 'tomorrow' }, { notAfter: todayKey(nowMs) });
      }
    } else {
      snap = await latestSnapshot(db, 'repayment_snapshots',
        { snapshot_type: 'today' }, { notAfter: todayKey(nowMs) });
    }
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
  return { ok: true, rows };
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
  const user = pseudoUser(cu);
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
  const kSnap = await latestSnapshot(db, 'repayment_snapshots',
    { snapshot_type: 'today' }, { onDate: addDaysKey(today, u >= 5 ? (8 - u) : 1) });
  const kRows = mine(kSnap.rows);
  const kExp = kRows.reduce((s, r) => s + num(r.payment_expected), 0);
  const kCol = kRows.reduce((s, r) => s + collectedOf(r), 0);

  /* WEEK COL -- collection Mon-Fri to date. A day on its own says nothing about whether the
     week is being carried; the officers are chased on the week, so the week is on the bar.
     Same per-day batch resolution the dashboard uses on weekends, so a re-upload of any day
     supersedes rather than doubles. */
  const weekAll = await snapshotsInRange(db, 'repayment_snapshots', { snapshot_type: 'today' },
    weekMondayKey(nowMs), addDaysKey(weekMondayKey(nowMs), 4));
  const wRows = mine([...resolveLatestPerKey(weekAll, r => r.snapshot_date).values()].flatMap(s => s.rows));
  const wExp = wRows.reduce((s, r) => s + num(r.payment_expected), 0);
  const wCol = wRows.reduce((s, r) => s + collectedOf(r), 0);

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
    kesho: { pct: rat(kCol, kExp), num: kCol, den: kExp, customers: kRows.length },
    weekCol: { pct: rat(wCol, wExp), num: wCol, den: wExp, customers: wRows.length },
    sales: { pct: rat(salesNum, salesDen), num: salesNum, den: salesDen, teams: teamCount, basis: 'month' },
    expdf,
    recovery: { pct: rat(rec.recovered, rec.denominator), num: rec.recovered, den: rec.denominator, basis: rec.basis },
  };
}

/* ---------- sync ---------- */
/** Phone -> {name, ref, team, role C|G, src EXP|DEF} index over exactly the universe the
    officers work: followup (defaulters) + today/tomorrow expected + alternate numbers logged
    via ANA NAMBA NYINGINE follow-ups. Customers win over guarantors for the same number. */
async function phoneIndex(db, nowMs) {
  const today = todayKey(nowMs);
  const [fu, eT, eM, cm] = await Promise.all([
    fetchAll(() => db.from('followup_status').select('*')),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'today' }, { notAfter: today }),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'tomorrow' }, { notAfter: today }),
    fetchAll(() => db.from('followup_comments').select('ref, new_number, full_name, team')),
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
  if (!calls.length) return { ok: true, added: 0, dup: 0, watermark: wm, portfolio: 0, nonPortfolio: 0 };
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
  if (!records.length) return { ok: true, added: 0, dup: batchDup, watermark: wm, portfolio: 0, nonPortfolio: 0 };
  // Dedup is the id PRIMARY KEY itself -- on conflict do nothing. No lock, no read-then-write
  // race: two overlapping syncs of the same call cannot both insert it, by construction.
  const { data: inserted, error } = await db.from('call_logs')
    .upsert(records, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  if (error) throw new Error(error.message);
  const added = (inserted || []).length;
  const { error: e2 } = await db.from('call_users')
    .update({ last_sync: new Date(nowMs).toISOString(), last_ts: wm }).eq('user_id', cu.user_id);
  if (e2) throw new Error(e2.message);
  return { ok: true, added, dup: batchDup + (records.length - added), watermark: wm, portfolio: pf, nonPortfolio: npf };
}

/* ---------- comments / follow-up ---------- */
async function comments(db, [dev, ref]) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  const { data, error } = await db.from('followup_comments').select('*').eq('ref', String(ref)).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const items = (data || []).map(c => ({
    by: c.created_by || '', at: c.created_at ? eatStamp(Date.parse(c.created_at)) : '',
    fu: c.fu_status || '', comment: c.comment || '',
  }));
  return { ok: true, items };
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
async function report(db, [dev, from, to], nowMs) {
  const cu = await userByDeviceSoft(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  if (!cu.is_leader) throw new Error('Leader access only.');
  const teamRows = await fetchAll(() => db.from('teams').select('*'));
  const { teamsOf } = buildLeaderMaps(teamRows);
  const live = Object.keys(teamsOf[K(cu.name)] || {});
  const lt = cu.leader_teams;
  const scope = live.length ? live : ((!lt || !lt.length || lt.some(t => K(t) === 'ALL')) ? null : lt);
  const out = await reportCore(db, scope, from, to, cu.user_id, nowMs);
  out.ok = true;
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
const HANDLERS = {
  api_callBoot: boot,
  api_callRegister: register,
  api_callList: list,
  api_callDailySummary: dailySummary,
  api_callSync: sync,
  api_callComments: comments,
  api_callAddComment: addComment,
  api_callReport: report,
};
export async function callApi(db, fn, args, nowMs = Date.now()) {
  const h = HANDLERS[fn];
  if (!h) { const e = new Error('Unknown call API: ' + fn); e.status = 400; throw e; }
  return h(db, args || [], nowMs);
}
