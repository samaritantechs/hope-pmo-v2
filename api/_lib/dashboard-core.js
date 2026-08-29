import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { todayKey, currentWeekday, isoWeekday, addDaysKey, weekMondayKey } from './time.js';
import { resolveLatestPerKey, upperTeams } from './snapshots.js';
import { cachedAnswer } from './answer-cache.js';
import { expectedTotalsInRange, expectedTotalsLatest, defaulterTotalsInRange, defaulterTotalsLatest,
  tCustomers, tExpected, tCollected, tUncollected, tArrears } from './snapshot-totals.js';

/** Narrow a query to the teams the caller may see, or leave it alone for somebody who sees
    everything. One line, used everywhere, so "did this one get narrowed?" is answerable by
    looking rather than by remembering. */
const onTeams = (q, teams) => (teams && teams.length ? q.in('team', upperTeams(teams)) : q);
import { recoveryBasis, num } from './recovery.js';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
/* SATURDAY IS A WORKING DAY HERE, AND THE WEEKEND VIEW WAS THROWING IT AWAY.
   The weekend aggregation walked Mon-Fri and read a Mon-Fri date range, on the assumption
   that a weekend has no decks. It does: a Saturday deck is filed under weekday SAT and dated
   that Saturday -- 18,224 initial and 18,150 current rows on 2026-08-29 alone. Both were
   outside the range AND outside the loop, so an entire day of recovery work was invisible in
   the week's total and the phone's Rec fell back to Friday.
   Sunday is included for the same reason: whether it is worked is a question for the data,
   not for a constant. A day nobody uploads a deck for simply has no rows and costs nothing. */
const WEEKDAYS_ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** "sales in the app interface report summary bar aint reflecting okay" -- every sales query in
    this codebase filtered on stage === 'approved', which is a CURRENT-STATE check being asked
    a HISTORY question ("was this loan sold this period?"). A loan does not sit at 'approved'
    for long -- the very next thing that normally happens to it is disbursement -- so within a
    day or two of a real sale, that loan's stage moves on and it silently stops counting as a
    sale for the rest of the month, understating every sales figure on the system (dashboard,
    the call app's own strip, the GM's weekly report, the sales trend widgets). A sale that was
    approved and later disbursed/funded/closed is still a sale; only 'rejected' (undone before
    it ever went out) and 'reversed' (money never moved) genuinely were not one. */
export const SALES_STAGES = ['approved', 'disbursed', 'funded', 'closed'];

/* THE DASHBOARD NEVER READS A CUSTOMER ROW ANY MORE. Every figure it returns is a sum or a
   count -- no name, phone or balance appears anywhere on it -- and it used to fetch every
   snapshot row of the week to work them out: about 161,000 of them here, all held in this
   process's memory at once. That is the 504s and the memory bill.

   It now reads TEAM-DAY TOTALS instead (api/_lib/snapshot-totals.js): one row per team, per
   day, per upload batch, with the money already added up by the database. Roughly two hundred
   rows for the same answer. The batch rule still runs here, over those rows, because that rule
   must have exactly one home -- see snapshots.js. */

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
/* The dashboard was measured at 555,000 rows for somebody who sees every team, and it is the
   first thing everybody opens. It is kept for a minute per set of teams -- see
   answer-cache.js, which the officer boards share, since the Presentation deck waits on both. */
export async function buildDashboard(db, user, nowMs = Date.now()) {
  return cachedAnswer(db, 'dashboard', user, nowMs, () => buildDashboardUncached(db, user, nowMs));
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
      .in('stage', SALES_STAGES).gte('approved_date', weekMon).lte('approved_date', today), user.teams)),
    fetchAll(() => onTeams(weekend
      ? db.from('received_payments').select('team, amount_paid').gte('paid_at', weekMon).lte('paid_at', today)
      : db.from('received_payments').select('team, amount_paid').eq('paid_at', today), user.teams)),
  ]);

  const expRows = scoped(expected.rows);
  const sal = scoped(sal0);
  const rcv = scoped(rcv0);
  const defCurRows = scoped(decks.currentRows);
  const deckPairs = decks.pairs.map(p => ({ ...p, ini: scoped(p.ini), cur: scoped(p.cur) }));

  // ---- Recovered: initial arrears minus current arrears, STRICTLY paired decks only.
  // A missing side yields 0 with a note, never +/- the whole book (initial with no current
  // would read as "everything recovered"; current with no initial as the negative of it).
  let recovered = 0;
  const recoveredByTeam = {};
  /* AND HOW MUCH OF THAT WAS TODAY?
     On a weekend `recovered` is the whole week Mon-Fri added together, because there is no
     Saturday or Sunday deck to read -- decks are per weekday, MON..FRI. That total is the
     right thing to chase, and it is also the reason an officer opening the app on Saturday
     cannot tell what the LATEST day actually brought in: a flat week and a week carried
     entirely by Friday show the same figure.
     So the newest paired day is kept beside the total, with the day it belongs to. It is
     named rather than assumed to be today, because on a weekend it is Friday's -- a number
     labelled "leo" that is really Friday's is worse than no number. */
  let latest = null;
  for (const p of deckPairs) {
    let dayRec = 0;
    for (const r of p.ini) { recovered += num(r.arrears_amt); dayRec += num(r.arrears_amt); bump(recoveredByTeam, r.team, num(r.arrears_amt)); }
    for (const r of p.cur) { recovered -= num(r.arrears_amt); dayRec -= num(r.arrears_amt); bump(recoveredByTeam, r.team, -num(r.arrears_amt)); }
    if (p.date && (!latest || String(p.date) > String(latest.date))) {
      latest = { day: p.day || null, date: p.date, recovered: dayRec };
    }
  }

  // ---- Recovery denominator, per the basis rule ----
  let recDen, recDenDates, yesterdaySource;
  if (basis.kind === 'today' || basis.kind === 'week') {
    // Monday divides by today's uncollected; the weekend divides by the week's -- and expRows
    // is already exactly that set (today's snapshot / the week's snapshots respectively).
    recDen = tUncollected(expRows);
    recDenDates = expected.dates;
  } else {
    const yKey = addDaysKey(today, -1);
    // A fresh Expected-Yesterday file wins. Its snapshot_date convention is ambiguous by
    // nature -- the file DESCRIBES yesterday but may be stamped with today's date -- so the
    // window [yesterday, today] accepts either convention.
    const yFile = await expectedTotalsLatest(db, { type: 'yesterday', notBefore: yKey, notAfter: today, teams: user.teams });
    if (yFile.rows.length) {
      recDen = tUncollected(scoped(yFile.rows));
      recDenDates = [yFile.date];
      yesterdaySource = 'yesterday-file';
    } else {
      // Fall back to the previous 'today' snapshot. This actually improves on the live
      // system: a holiday gap falls back to the prior REAL working day instead of last
      // week's sheet, because "latest date before today" skips as far back as it needs to.
      const prev = await expectedTotalsLatest(db, { type: 'today', notAfter: yKey, teams: user.teams });
      recDen = tUncollected(scoped(prev.rows));
      recDenDates = prev.date ? [prev.date] : [];
      yesterdaySource = 'previous-today-snapshot';
    }
  }

  const totals = {
    expectedCustomers: tCustomers(expRows),
    expectedAmount: tExpected(expRows),
    collected: tCollected(expRows),
    uncollected: tUncollected(expRows),
    defaulterCustomers: tCustomers(defCurRows),
    defaulterArrears: tArrears(defCurRows),
    salesCount: sal.length,
    salesAmount: sal.reduce((s, r) => s + (num(r.principal_amt) || num(r.loan_amt)), 0),
    receivedCount: rcv.length,
    receivedAmount: rcv.reduce((s, r) => s + num(r.amount_paid), 0),
    recovery: {
      recovered,
      denominator: recDen,
      pct: recDen > 0 ? Math.round((recovered / recDen) * 1000) / 10 : null,
      basis: basis.kind,
      basisLabel: basis.label,
      /* The newest paired day on its own, so a screen showing a week total can also show what
         the last day contributed. Null when no deck pairs at all -- never 0, which would read
         as "nothing came in" rather than "nobody uploaded". */
      latest: latest
        ? { recovered: latest.recovered, day: latest.day, date: latest.date,
            isToday: String(latest.date) === String(today) }
        : null,
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
    t.expectedAmount += num(r.expected_amt);
    t.collected += num(r.collected_amt);
    t.uncollected += num(r.uncollected_amt);
  }
  for (const r of defCurRows) { const t = team_(r.team); t.defaulterArrears += num(r.arrears_amt); t.defaulterCustomers += num(r.customers); }
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
    const snap = await expectedTotalsLatest(db, { type: 'today', notAfter: today, teams });
    return { rows: snap.rows, dates: snap.date ? [snap.date] : [] };
  }
  const all = await expectedTotalsInRange(db, { type: 'today', from: weekMon, to: weekFri, teams });
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
    const cur = await defaulterTotalsLatest(db, { type: 'current', weekday: wd, notAfter: today, teams });
    if (!cur.rows.length) return out;
    out.currentRows = cur.rows;
    out.dates[wd] = cur.date;
    const ini = await defaulterTotalsLatest(db, { type: 'initial', weekday: wd, onDate: cur.date, teams });
    // The day a pair belongs to travels WITH it. Recovered is a sum over pairs, and a sum that
    // has forgotten which days made it cannot answer "and how much of that was today?".
    if (ini.rows.length) out.pairs.push({ day: wd, date: cur.date, ini: ini.rows, cur: cur.rows });
    else out.note = `No initial ${wd} deck dated ${cur.date} -- Recovered is 0 rather than a whole-book figure.`;
    return out;
  }
  /* TO TODAY, NOT TO FRIDAY. On a Saturday `weekFri` is yesterday, so a deck uploaded this
     morning sat outside the window and could not be seen however the loop below was written.
     `today` is never before weekFri on a weekend, so this only ever widens. */
  const rangeTo = today > weekFri ? today : weekFri;
  const [curAll, iniAll] = await Promise.all([
    defaulterTotalsInRange(db, { type: 'current', from: weekMon, to: rangeTo, teams }),
    defaulterTotalsInRange(db, { type: 'initial', from: weekMon, to: rangeTo, teams }),
  ]);
  const curPer = resolveLatestPerKey(curAll, r => r.weekday);
  const iniPer = resolveLatestPerKey(iniAll, r => r.weekday);
  const unpaired = [];
  for (const d of WEEKDAYS_ALL) {
    const c = curPer.get(d);
    if (!c || !c.rows.length) continue;                       // no deck at all that day
    out.currentRows = out.currentRows.concat(c.rows);
    out.dates[d] = c.date;
    const i = iniPer.get(d);
    if (i && i.rows.length && String(i.date) === String(c.date)) out.pairs.push({ day: d, date: c.date, ini: i.rows, cur: c.rows });
    else unpaired.push(d);
  }
  if (unpaired.length) out.note = `No matching initial deck for ${unpaired.join(', ')} -- those day(s) contribute 0 to Recovered rather than a whole-book figure.`;
  return out;
}

function bump(map, team, v) {
  const k = team || '(no team)';
  map[k] = (map[k] || 0) + v;
}

