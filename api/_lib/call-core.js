import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { TZ_OFFSET_MS, todayKey, weekMondayKey, isoWeekday, addDaysKey } from './time.js';
import { latestSnapshot } from './snapshots.js';
import { buildDashboard } from './dashboard-core.js';

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
async function userByDevice(db, dev) {
  dev = String(dev == null ? '' : dev).trim();
  if (!dev) return null;
  const { data } = await db.from('call_users').select('*').eq('device_id', dev).limit(1);
  return (data && data[0]) || null;
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
async function teamList(db) {
  const rows = await fetchAll(() => db.from('teams').select('*'));
  return rows.filter(r => r.team).map(r => r.team).sort();
}

/* ---------- boot / register ---------- */
async function boot(db, [dev], nowMs) {
  const teams = await teamList(db);
  const cu = await userByDevice(db, dev);
  const brand = (await settingGet(db, 'CALL_BRAND')) || APP.BRAND;
  const logo = (await settingGet(db, 'CALL_LOGO_URL')) || '';
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED', teams, brand, motto: APP.MOTTO, logo };
  const today = todayKey(nowMs);
  const logs = await fetchAll(() => db.from('call_logs').select('duration, portfolio').eq('user_id', cu.user_id).eq('call_date', today));
  const syncSec = parseInt(await settingGet(db, 'CALL_SYNC_SECONDS'), 10);
  const logoutSetting = K(await settingGet(db, 'CALL_LOGOUT_ENABLED'));
  return {
    ok: true,
    userId: cu.user_id, name: cu.name, team: cu.team, role: cu.role,
    leader: !!cu.is_leader,
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
async function register(db, [dev, name, team, accessCode, phone], nowMs) {
  dev = String(dev == null ? '' : dev).trim();
  if (!dev) throw new Error('Missing device id.');
  name = String(name == null ? '' : name).trim();
  const phoneD = pnorm(phone);
  if (!phoneD) throw new Error('Enter your phone number.');
  team = String(team == null ? '' : team).trim();
  const code = String(accessCode == null ? '' : accessCode).trim();
  let role = 'OFFICER', leader = false, leaderTeams = null;
  if (code) {
    const { data: u } = await db.from('access_codes').select('*').eq('code', code).maybeSingle();
    if (!u) throw new Error('Invalid access code.');
    leader = true;
    role = u.role || 'LEADER';
    leaderTeams = (u.teams && u.teams.length) ? u.teams : null;   // null = ALL, same convention as auth.js
    if (!team) team = leaderTeams ? leaderTeams[0] : 'ALL';
    name = u.name || name;
  } else {
    if (!name) throw new Error('Enter your name.');
    if (!team) throw new Error('Choose your team.');
    const teams = await teamList(db);
    if (!teams.some(t => K(t) === K(team))) throw new Error('Unknown team. Ask your PMO officer.');
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
async function calledTodaySet(db, nowMs) {
  const rows = await fetchAll(() => db.from('call_logs').select('phone').eq('call_date', todayKey(nowMs)));
  const set = {};
  for (const r of rows) { const d = pnorm(r.phone); if (d) set[d] = 1; }
  return set;
}
async function list(db, [dev, which], nowMs) {
  const cu = await userByDevice(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  const user = pseudoUser(cu);
  const called = await calledTodaySet(db, nowMs);
  const hit = (a, b) => !!(called[pnorm(a)] || called[pnorm(b)]);
  let rows;
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
    const snap = await latestSnapshot(db, 'repayment_snapshots',
      { snapshot_type: which === 'tomorrow' ? 'tomorrow' : 'today' }, { notAfter: todayKey(nowMs) });
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
/** Col / Sales / Recovery for the officer's own team(s). Col and Recovery come straight out
    of buildDashboard -- the SAME code path the portal dashboard uses, so the strip reconciles
    with it by construction, recovery basis (Mon today / Tue-Fri yesterday / weekend week)
    included. Sales keeps the live system's target framing: approvals vs SALES_TARGET_MONTHLY
    x team count month-to-date on weekdays, SALES_TARGET_WEEKLY x team count for the week on
    weekends. The client multiplies pct by 100, so everything here is a FRACTION or null. */
async function dailySummary(db, [dev], nowMs) {
  const cu = await userByDevice(db, dev);
  if (!cu) return { ok: false, error: 'DEVICE_NOT_REGISTERED' };
  const user = pseudoUser(cu);
  const d = await buildDashboard(db, user, nowMs);
  const weekend = isoWeekday(nowMs) >= 6;
  const rat = (n, den) => (den > 0 ? n / den : null);

  const weeklyRaw = parseInt(String((await settingGet(db, 'SALES_TARGET_WEEKLY')) || (await settingGet(db, 'SALES_TARGET')) || '').replace(/[^0-9]/g, ''), 10);
  const weekly = (!weeklyRaw || isNaN(weeklyRaw) || weeklyRaw < 1) ? 100000000 : weeklyRaw;
  const monthlyRaw = parseInt(String((await settingGet(db, 'SALES_TARGET_MONTHLY')) || '').replace(/[^0-9]/g, ''), 10);
  const monthly = (!monthlyRaw || isNaN(monthlyRaw) || monthlyRaw < 1) ? weekly * 4 : monthlyRaw;

  const today = todayKey(nowMs);
  const salesFrom = weekend ? weekMondayKey(nowMs) : today.slice(0, 8) + '01';   // week-to-date vs month-to-date
  const loans = await fetchAll(() => db.from('loans').select('team, principal_amt, loan_amt, approved_date')
    .eq('stage', 'approved').gte('approved_date', salesFrom).lte('approved_date', today));
  const salesNum = loans.filter(r => teamAllowed(user, r.team))
    .reduce((s, r) => s + (num(r.principal_amt) || num(r.loan_amt)), 0);
  const teamCount = user.teams ? user.teams.length : (await teamList(db)).length;
  const salesDen = (weekend ? weekly : monthly) * Math.max(teamCount, 1);

  const rec = d.totals.recovery;
  return {
    ok: true,
    period: d.period,
    col: { pct: rat(d.totals.collected, d.totals.expectedAmount), num: d.totals.collected, den: d.totals.expectedAmount },
    sales: { pct: rat(salesNum, salesDen), num: salesNum, den: salesDen, teams: teamCount },
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
  const cu = await userByDevice(db, dev);
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
  const cu = await userByDevice(db, dev);
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
  const cu = await userByDevice(db, dev);
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
  const cu = await userByDevice(db, dev);
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
