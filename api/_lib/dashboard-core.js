import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { todayKey, currentWeekday, isoWeekday, addDaysKey, weekMondayKey } from './time.js';
import { latestSnapshot, snapshotsInRange, resolveLatestPerKey, upperTeams } from './snapshots.js';

/** Narrow a query to the teams the caller may see, or leave it alone for somebody who sees
    everything. One line, used everywhere, so "did this one get narrowed?" is answerable by
    looking rather than by remembering. */
const onTeams = (q, teams) => (teams && teams.length ? q.in('team', upperTeams(teams)) : q);
import { recoveryBasis, collectedOf, uncollectedOf, num } from './recovery.js';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

/** The whole dashboard computation, separated from the route so the full pipeline runs under
    tests against a fake PostgREST client. `db` is anything with the supabase-js query shape;
    `nowMs` pins the clock for tests and defaults to the real one in production.

    Response is purely ADDITIVE over the original /api/dashboard shape -- everything an
    existing consumer read (totals.*, teams[], asOfWeekday) is still there, meaning the same
    thing on weekdays. New: totals.recovery, per-team recovered/uncollected, period, and a
    `dates` block that says exactly which snapshot every figure came from -- built for the
    run-both-systems-side-by-side phase.

    On weekends the dashboard switches to week-to-date (period: 'week'), matching
    api_callDailySummary in the live Code.gs: collections/received/defaulter decks aggregate
    Mon-Fri instead of showing an empty Saturday. */
/* THE SAME QUESTION, ASKED ONCE.

   The dashboard is the most expensive answer in the system -- measured at 555,000 rows for
   somebody who sees every team. It is also the first thing everybody opens, and the figures
   behind it change only when a report is uploaded, which happens a few times a day.

   So the answer is kept for a minute, per set of teams. The first person through pays for it;
   everyone else on the same teams, and the same person moving away and back, gets it at once.

   ONE MINUTE IS THE PROMISE, and it is deliberately short: an upload made on another server
   cannot reach in here to clear this, so a minute is the longest anybody waits to see their
   own upload reflected. Long enough to be worth having, short enough that nobody is left
   wondering whether the file went in.

   Held in the running process, which the platform reuses between requests and may discard at
   any moment. An empty cache just means doing the work -- which is what used to happen every
   single time. */
const DASH_TTL_MS = 60000;
/* Kept against the DATABASE CLIENT, not in a single shared map. In production there is one
   long-lived client, so this behaves exactly as one map would. In a test there is a fresh
   fake per case -- and a shared map would have handed one test's figures to the next, which
   is a test suite that passes while the system is wrong. Weak, so a discarded client takes
   its cache with it. */
const dashCache = new WeakMap();
function dashBucket(db) {
  let m = dashCache.get(db);
  if (!m) { m = new Map(); dashCache.set(db, m); }
  return m;
}

export async function buildDashboard(db, user, nowMs = Date.now()) {
  const key = (user.teams ? upperTeams(user.teams).slice().sort().join(',') : 'ALL')
    + '|' + todayKey(nowMs);
  const bucket = dashBucket(db);
  const hit = bucket.get(key);
  // hit.at <= nowMs guards a clock that jumps backwards, which would otherwise make a stale
  // answer look brand new for as long as the clock stayed behind.
  if (hit && hit.at <= nowMs && (nowMs - hit.at) < DASH_TTL_MS) return hit.value;
  const value = await buildDashboardUncached(db, user, nowMs);
  bucket.set(key, { at: nowMs, value });
  return value;
}

async function buildDashboardUncached(db, user, nowMs) {
  const today = todayKey(nowMs);
  const wd = currentWeekday(nowMs);
  const iso = isoWeekday(nowMs);
  const weekend = iso >= 6;
  const period = weekend ? 'week' : 'day';
  const weekMon = weekMondayKey(nowMs);
  const weekFri = addDaysKey(weekMon, 4);
  const basis = recoveryBasis(iso);
  const scoped = rows => rows.filter(r => teamAllowed(user, r.team));

  // ---- Expected (collections), defaulter decks, sales, received -- independent reads ----
  const [expected, decks, sal0, rcv0] = await Promise.all([
    loadExpected(db, { weekend, today, weekMon, weekFri, teams: user.teams }),
    loadDecks(db, { weekend, today, wd, weekMon, weekFri, teams: user.teams }),
    // Sales = approved within the CURRENT WEEK, the same correction the live system's sales
    // KPI already made -- unbounded, this counted every approved loan ever (the whole book).
    // Narrowed at the database like everything else on this path. scoped() below still runs --
    // it is the rule, and a filter that quietly stopped working must not become a data leak --
    // but by then there is almost nothing left for it to drop.
    fetchAll(() => onTeams(db.from('loans').select('team, principal_amt, loan_amt, approved_date')
      .eq('stage', 'approved').gte('approved_date', weekMon).lte('approved_date', today), user.teams)),
    fetchAll(() => onTeams(weekend
      ? db.from('received_payments').select('team, amount_paid').gte('paid_at', weekMon).lte('paid_at', today)
      : db.from('received_payments').select('team, amount_paid').eq('paid_at', today), user.teams)),
  ]);

  const expRows = scoped(expected.rows);
  const sal = scoped(sal0);
  const rcv = scoped(rcv0);
  const defCurRows = scoped(decks.currentRows);
  const deckPairs = decks.pairs.map(p => ({ ini: scoped(p.ini), cur: scoped(p.cur) }));

  // ---- Recovered: initial arrears minus current arrears, STRICTLY paired decks only.
  // A missing side yields 0 with a note, never +/- the whole book (initial with no current
  // would read as "everything recovered"; current with no initial as the negative of it).
  let recovered = 0;
  const recoveredByTeam = {};
  for (const p of deckPairs) {
    for (const r of p.ini) { recovered += num(r.arrears); bump(recoveredByTeam, r.team, num(r.arrears)); }
    for (const r of p.cur) { recovered -= num(r.arrears); bump(recoveredByTeam, r.team, -num(r.arrears)); }
  }

  // ---- Recovery denominator, per the basis rule ----
  let recDen, recDenDates, yesterdaySource;
  if (basis.kind === 'today' || basis.kind === 'week') {
    // Monday divides by today's uncollected; the weekend divides by the week's -- and expRows
    // is already exactly that set (today's snapshot / the week's snapshots respectively).
    recDen = uncollectedOf(expRows);
    recDenDates = expected.dates;
  } else {
    const yKey = addDaysKey(today, -1);
    // A fresh Expected-Yesterday file wins. Its snapshot_date convention is ambiguous by
    // nature -- the file DESCRIBES yesterday but may be stamped with today's date -- so the
    // window [yesterday, today] accepts either convention.
    const yFile = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'yesterday' }, { notBefore: yKey, notAfter: today, teams: user.teams });
    if (yFile.rows.length) {
      recDen = uncollectedOf(scoped(yFile.rows));
      recDenDates = [yFile.date];
      yesterdaySource = 'yesterday-file';
    } else {
      // Fall back to the previous 'today' snapshot. This actually improves on the live
      // system: a holiday gap falls back to the prior REAL working day instead of last
      // week's sheet, because "latest date before today" skips as far back as it needs to.
      const prev = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'today' }, { notAfter: yKey, teams: user.teams });
      recDen = uncollectedOf(scoped(prev.rows));
      recDenDates = prev.date ? [prev.date] : [];
      yesterdaySource = 'previous-today-snapshot';
    }
  }

  const totals = {
    expectedCustomers: expRows.length,
    expectedAmount: sum(expRows, 'payment_expected'),
    collected: expRows.reduce((s, r) => s + collectedOf(r), 0),
    uncollected: uncollectedOf(expRows),
    defaulterCustomers: defCurRows.length,
    defaulterArrears: sum(defCurRows, 'arrears'),
    salesCount: sal.length,
    salesAmount: sal.reduce((s, r) => s + (num(r.principal_amt) || num(r.loan_amt)), 0),
    receivedCount: rcv.length,
    receivedAmount: sum(rcv, 'amount_paid'),
    recovery: {
      recovered,
      denominator: recDen,
      pct: recDen > 0 ? Math.round((recovered / recDen) * 1000) / 10 : null,
      basis: basis.kind,
      basisLabel: basis.label,
      ...(yesterdaySource ? { yesterdaySource } : {}),
      ...(decks.note ? { note: decks.note } : {}),
    },
  };

  const byTeam = {};
  function team_(t) {
    const k = t || '(no team)';
    byTeam[k] = byTeam[k] || { team: k, expectedAmount: 0, collected: 0, uncollected: 0, recovered: 0, defaulterArrears: 0, defaulterCustomers: 0, salesAmount: 0, receivedAmount: 0 };
    return byTeam[k];
  }
  for (const r of expRows) {
    const t = team_(r.team);
    const c = collectedOf(r);
    t.expectedAmount += num(r.payment_expected);
    t.collected += c;
    t.uncollected += Math.max(0, num(r.payment_expected) - c);
  }
  for (const r of defCurRows) { const t = team_(r.team); t.defaulterArrears += num(r.arrears); t.defaulterCustomers += 1; }
  for (const [k, v] of Object.entries(recoveredByTeam)) team_(k).recovered = v;
  for (const r of sal) { team_(r.team).salesAmount += (num(r.principal_amt) || num(r.loan_amt)); }
  for (const r of rcv) { team_(r.team).receivedAmount += num(r.amount_paid); }

  return {
    totals,
    teams: Object.values(byTeam).sort((a, b) => a.team.localeCompare(b.team)),
    asOfWeekday: wd,
    period,
    dates: {
      today,
      weekMon,
      weekFri,
      expected: expected.dates,
      recoveryDen: recDenDates,
      decks: decks.dates,
    },
  };
}

/** Weekday: the latest 'today' snapshot no later than today (batch-resolved). Weekend: every
    'today' snapshot of the week Mon-Fri, batch-resolved per day, in one query. */
/* `teams` is the whole reason these two are not slow. Every snapshot read below is narrowed
   AT THE DATABASE to the teams the caller may see. Without it, an officer scoped to one team
   still downloaded all forty and threw thirty-nine away after they arrived -- measured at 567
   round trips and 555,000 rows for one dashboard, which is 85 seconds of waiting before a
   single figure is worked out. The platform gives up at 60. */
async function loadExpected(db, { weekend, today, weekMon, weekFri, teams }) {
  if (!weekend) {
    const snap = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'today' }, { notAfter: today, teams: teams });
    return { rows: snap.rows, dates: snap.date ? [snap.date] : [] };
  }
  const all = await snapshotsInRange(db, 'repayment_snapshots', { snapshot_type: 'today' }, weekMon, weekFri, teams);
  const perDay = resolveLatestPerKey(all, r => r.snapshot_date);
  const dates = [...perDay.keys()].sort();
  return { rows: dates.flatMap(d => perDay.get(d).rows), dates };
}

/** Defaulter decks. Weekday: the current weekday's deck; its initial side must exist at the
    SAME snapshot_date to count as a pair. Weekend: all five decks of the week, paired the
    same way per weekday. currentRows feeds the defaulter KPIs regardless of pairing; only
    the recovered figure insists on strict pairs. */
async function loadDecks(db, { weekend, today, wd, weekMon, weekFri, teams }) {
  const out = { currentRows: [], pairs: [], dates: {}, note: null };
  if (!weekend) {
    const cur = await latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: wd }, { notAfter: today, teams: teams });
    if (!cur.rows.length) return out;
    out.currentRows = cur.rows;
    out.dates[wd] = cur.date;
    const ini = await latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: wd }, { onDate: cur.date, teams: teams });
    if (ini.rows.length) out.pairs.push({ ini: ini.rows, cur: cur.rows });
    else out.note = `No initial ${wd} deck dated ${cur.date} -- Recovered is 0 rather than a whole-book figure.`;
    return out;
  }
  const [curAll, iniAll] = await Promise.all([
    snapshotsInRange(db, 'defaulter_snapshots', { snapshot_type: 'current' }, weekMon, weekFri, teams),
    snapshotsInRange(db, 'defaulter_snapshots', { snapshot_type: 'initial' }, weekMon, weekFri, teams),
  ]);
  const curPer = resolveLatestPerKey(curAll, r => r.weekday);
  const iniPer = resolveLatestPerKey(iniAll, r => r.weekday);
  const unpaired = [];
  for (const d of WEEKDAYS) {
    const c = curPer.get(d);
    if (!c || !c.rows.length) continue;                       // no deck at all that day
    out.currentRows = out.currentRows.concat(c.rows);
    out.dates[d] = c.date;
    const i = iniPer.get(d);
    if (i && i.rows.length && String(i.date) === String(c.date)) out.pairs.push({ ini: i.rows, cur: c.rows });
    else unpaired.push(d);
  }
  if (unpaired.length) out.note = `No matching initial deck for ${unpaired.join(', ')} -- those day(s) contribute 0 to Recovered rather than a whole-book figure.`;
  return out;
}

function bump(map, team, v) {
  const k = team || '(no team)';
  map[k] = (map[k] || 0) + v;
}

function sum(rows, field) { return rows.reduce((s, r) => s + num(r[field]), 0); }
