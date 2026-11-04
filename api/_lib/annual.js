/* =====================================================================================
   THE ANNUAL REPORT -- a year per team, per month, always up to date.
   =====================================================================================
     "we also build a new tab 'Annual' - this will always update the annual statics, GM wants
      to always have the report autoupdating"
     "The task is to stamp monthly collection and recovery data jan 2025 - july 2026.
      Customer retention comes from sales which we already have ... in the tab i could go
      months, years, report types, export excels, jpgs etc"

   The GM's annual workbook is a sheet per month and a sheet per summary (ANNUAL, SALES, COLN,
   REC, COUNT, one per GMO), kept by hand. This is that workbook, read off the system:

     SALES, COUNT, TRK1, RETAINED      the loans table, every month of the year, summed by the
                                        database (loan_month_totals_by_team, RUN-ME-049) or on
                                        the server when the function is not installed. A sale
                                        is what SALES_STAGES says it is, dated by approved_date,
                                        the one rule every sales figure in this system uses.
                                        TRK1 is a first-time customer (track number 1); the
                                        rest are retained. Never stamped, never frozen.
     COLLECTION, EARLY COL, RECOVERY    the MONTH LEDGER the month report fills (monthLedgerDays_
                                        -- the same cells, so a month here is the month report's
                                        month), for every month the system saw. The months before
                                        the app -- 2025, and January to July 2026 -- live in
                                        `team_months`, stamped from the workbooks by RUN-ME-049. A
                                        month with stamped rows is read from them and from nowhere
                                        else; a month without is read from the ledger.

   THE ARITHMETIC, as the workbook does it, written once:
     a month's %     sales / (SALES_TARGET_WEEKLY x 4), collected / expected, recovered /
                     uncollected -- the month report's own three.
     a year's %      THE AVERAGE OF ITS MONTHS' PERCENTAGES, over the months that were measured.
                     The workbook averages twelve cells; a running year here averages the months
                     that have happened, so November does not read as "twelve months, two of
                     them nothing". A month that could not be measured (no expected deck paired,
                     no initial sheet) leaves both the sum and the divisor.
     GENERAL         the average of the measured among sales %, collection % and recovery % --
                     perfOf on the month report, GENERAL on the workbook.
     a leader's %    the average of their teams' figures for the same period; a leader in two
                     roles is judged on the union of the teams. Who holds a team is Teams & Staff
                     as it stands today (readTeamsAll, the codes laid over the sheet), except on a
                     year whose stamped year row names the holders -- 2025's names are 2025's.
     the company     a month: sums over the teams (collected over expected, as the month report's
                     totals); the year: the average of its months, like any other row. 2025,
                     whose collection was closed per team and per year only, averages the teams.

   NOT ON THE UPLOAD OR CALL PATHS. One answer per year per scope, cached the usual minute. The
   ledger months are filled under one budget, oldest first; a month the budget does not reach
   says "ledger pending" and is picked up on the next open (the ledger stores its progress).
   Without RUN-ME-049 the tab opens on sales and the ledger alone and says the stamps are
   missing: fall back, never fail. */
import { fetchAll, rpcAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { todayKey, weekMondayKey } from './time.js';
import { teamMatchList, upperTeams } from './snapshots.js';
import { num } from './recovery.js';
import { SALES_STAGES } from './dashboard-core.js';
import { adjReceived_ } from './adjustments.js';
import { cachedAnswer } from './answer-cache.js';
import { monthSummaryRows } from './snapshot-totals.js';

const K = s => String(s == null ? '' : s).trim().toUpperCase();
/* THE JOIN KEY ACROSS SPELLINGS. The workbook writes "TENGERU- USARIVER " and "Tunduru"; the
   registry may write TENGERU-USARIVER and TUNDURU. Letters and digits only, so the stamped row,
   the sales row and the registry row meet on one team. */
export const K2 = s => K(s).replace(/[^A-Z0-9]+/g, '');
const onTeams = (q, teams) => (teams && teams.length ? q.in('team', teamMatchList(teams)) : q);
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const r1 = v => (v == null ? null : Math.round(Number(v) * 10) / 10);
/** The average of what was measured -- a null leaves both the sum and the divisor. */
export function mean(vals) {
  const m = (vals || []).filter(v => v != null && v !== '' && !isNaN(Number(v)));
  return m.length ? r1(m.reduce((s, v) => s + Number(v), 0) / m.length) : null;
}
const nn = v => (v == null || v === '' ? null : Number(v));

export const MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
/* The roles a team is held under, in the workbook's own headings. `col` is the Teams & Staff
   column (the PMO collection officer lives on `collection`, early collection on `expected`);
   `yr` is the year row's column in team_months. */
export const ANNUAL_ROLES = [
  { key: 'gmo', col: 'gmo', yr: 'gmo', label: 'GMO' },
  { key: 'manager', col: 'manager', yr: 'manager', label: 'Manager' },
  { key: 'opm', col: 'opm', yr: 'opm', label: 'OPM' },
  { key: 'pmo', col: 'collection', yr: 'pmo', label: 'PMO' },
  { key: 'credit', col: 'credit', yr: 'credit', label: 'Credit' },
  { key: 'earlyCol', col: 'expected', yr: 'early_col', label: 'Early collection' },
  { key: 'recovery', col: 'recovery', yr: null, label: 'Recovery' },
  { key: 'bike', col: 'bike', yr: 'bike', label: 'Bike' },
  { key: 'legal', col: 'legal', yr: 'legal', label: 'Legal' },
];
const PLACE_COLS = [['region', 'region'], ['zone', 'zone']];
const NOBODY = /^(NO[ -]|NONE$|N\/A$|-$|\(UNASSIGNED\))/i;
const nobody = s => !s || NOBODY.test(String(s).trim());

/* How long the ledger months may take between them. The month report gives one month eight
   seconds; a year's worth of cold months would not fit any budget, so the months are filled
   oldest first until this runs out, and the rest say "pending" and come on the next open. */
const ANNUAL_LEDGER_BUDGET_MS = 20000;
const FIRST_YEAR = 2025;

function tableMissing(err) {
  const s = err && typeof err === 'object' ? String(err.message || '') + ' ' + String(err.code || '') + ' ' + String(err.details || '') : String(err || '');
  return /does not exist|Could not find the table|42P01|PGRST205/i.test(s);
}
function monthEndOf(ym) {
  const [y, m] = ym.split('-').map(Number);
  return todayKey(Date.UTC(y, m, 0, 12));
}
/** The year asked for, or this one: four digits, not before the first annual report, not ahead of today. */
export function annualYear(v, today) {
  const thisY = Number(String(today).slice(0, 4));
  const y = parseInt(String(v == null ? '' : v).slice(0, 4), 10);
  return (y >= 2020 && y <= thisY) ? y : thisY;
}

/* ---------------------------------------------------------------------------- the reads */
async function readStamps_(db, user, year) {
  try {
    const rows = await fetchAll(() => onTeams(db.from('team_months').select('*')
      .gte('ym', String(year)).lte('ym', year + '-12'), user.teams));
    return { rows: (rows || []).filter(r => r && r.team && teamAllowed(user, r.team)), ok: true };
  } catch (e) {
    if (tableMissing(e)) return { rows: [], ok: false };
    throw e;
  }
}
/** The year's sales per team per month: the database's sum when RUN-ME-049's function is in,
    every sale row of the year summed here when it is not (and `light: false` says so). */
async function salesByMonth_(db, user, from, to) {
  const by = new Map();
  const put = (team, ym, loans, trk1, sales, totalLoan) => {
    const k = K2(team);
    if (!k || !ym) return;
    if (!by.has(k)) by.set(k, { team: String(team).trim(), byYm: {} });
    const e = by.get(k).byYm;
    const c = e[ym] || (e[ym] = { loans: 0, trk1: 0, sales: 0, totalLoan: 0 });
    c.loans += loans; c.trk1 += trk1; c.sales += sales; c.totalLoan += totalLoan;
  };
  const t = upperTeams(user.teams || []);
  const { data, error } = await rpcAll(db, 'loan_month_totals_by_team',
    { p_from: from, p_to: to, p_teams: t.length ? t : null, p_stages: SALES_STAGES });
  if (!error && Array.isArray(data)) {
    for (const r of data) if (teamAllowed(user, r.team)) put(r.team, String(r.ym || '').slice(0, 7), num(r.loans), num(r.trk1), num(r.principal), num(r.loan_amt));
    return { by, light: true };
  }
  const rows = await fetchAll(() => onTeams(db.from('loans')
    .select('team, stage, approved_date, principal_amt, loan_amt, interest_amt, track_no')
    .gte('approved_date', from).lte('approved_date', to).in('stage', SALES_STAGES), user.teams));
  for (const l of rows || []) {
    if (!teamAllowed(user, l.team) || !SALES_STAGES.includes(l.stage)) continue;
    const ym = String(l.approved_date || '').slice(0, 7);
    const principal = num(l.principal_amt) || num(l.loan_amt);
    const total = num(l.loan_amt) || (num(l.principal_amt) + num(l.interest_amt));
    put(l.team, ym, 1, num(l.track_no) === 1 ? 1 : 0, principal, total);
  }
  return { by, light: false };
}

/* ---------------------------------------------------------------------------- the cells */
function emptyCell() {
  return { src: null, sales: 0, loans: 0, trk1: 0, retained: 0, totalLoan: 0, salesPct: null,
    expected: null, collected: null, uncollected: null, ecolPct: null, colPct: null,
    recovered: null, recPct: null, retentionPct: null, general: null };
}
function finishCell_(c, monthTarget) {
  c.salesPct = pct(c.sales, monthTarget);
  c.colPct = c.expected != null ? pct(c.collected, c.expected) : null;
  c.recPct = (c.recovered != null && c.uncollected > 0) ? pct(c.recovered, c.uncollected) : null;
  c.retentionPct = pct(c.retained, c.loans);
  c.general = mean([c.salesPct, c.colPct, c.recPct]);
  return c;
}
const sumOf = (cells, f) => cells.reduce((s, c) => s + num(c[f]), 0);
const sumMeasured = (cells, f) => { const m = cells.filter(c => c[f] != null); return m.length ? m.reduce((s, c) => s + Number(c[f]), 0) : null; };
const byGeneral = (a, b) => (b.general == null ? -1 : b.general) - (a.general == null ? -1 : a.general)
  || (num(b.sales) - num(a.sales)) || String(a.team || a.name || '').localeCompare(String(b.team || b.name || ''));

/** A leader's row: the average of their teams' figures, for the year and for each month. */
function leaderRow_(name, teams, yms) {
  const row = { name, teams: teams.length, teamList: teams.map(t => t.team).join(', '), teamKeys: teams.map(t => t.key),
    months: yms.filter(ym => teams.some(t => t.m[ym])).length,
    sales: teams.reduce((s, t) => s + num(t.sales), 0), loans: teams.reduce((s, t) => s + num(t.loans), 0),
    salesPct: mean(teams.map(t => t.salesPct)), ecolPct: mean(teams.map(t => t.ecolPct)),
    colPct: mean(teams.map(t => t.colPct)), recPct: mean(teams.map(t => t.recPct)), m: {} };
  row.general = mean([row.salesPct, row.colPct, row.recPct]);
  for (const ym of yms) {
    const cs = teams.map(t => t.m[ym]).filter(Boolean);
    if (!cs.length) continue;
    const mm = { teams: cs.length, sales: sumOf(cs, 'sales'), salesPct: mean(cs.map(c => c.salesPct)), ecolPct: mean(cs.map(c => c.ecolPct)),
      colPct: mean(cs.map(c => c.colPct)), recPct: mean(cs.map(c => c.recPct)) };
    mm.general = mean([mm.salesPct, mm.colPct, mm.recPct]);
    row.m[ym] = mm;
  }
  return row;
}
function leaderBoards_(teamRows, yms) {
  const roles = ANNUAL_ROLES.map(role => {
    const by = new Map();
    for (const t of teamRows) {
      const nm = t[role.key];
      if (nobody(nm)) continue;
      const k = K(nm);
      if (!by.has(k)) by.set(k, { name: String(nm).trim(), teams: [] });
      by.get(k).teams.push(t);
    }
    return { role: role.key, label: role.label, rows: [...by.values()].map(h => leaderRow_(h.name, h.teams, yms)).sort(byGeneral) };
  });
  // Everyone, in any role: one person, the union of every team they hold under any heading.
  const all = new Map();
  for (const r of roles) for (const t of teamRows) {
    const nm = t[ANNUAL_ROLES.find(x => x.key === r.role).key];
    if (nobody(nm)) continue;
    const k = K(nm);
    if (!all.has(k)) all.set(k, { name: String(nm).trim(), roles: [], teams: new Map() });
    const a = all.get(k);
    if (!a.roles.includes(r.label)) a.roles.push(r.label);
    a.teams.set(t.key, t);
  }
  const everyone = [...all.values()].map(a => ({ roles: a.roles.join(', '), ...leaderRow_(a.name, [...a.teams.values()], yms) })).sort(byGeneral);
  return { roles, all: everyone };
}

/* ---------------------------------------------------------------------------- the answer */
export async function annualReport(db, user, args, nowMs, deps) {
  const today = todayKey(nowMs);
  const year = annualYear(args && args.year, today);
  return cachedAnswer(db, 'annual|' + year, user, nowMs, () => annualCompute_(db, user, year, today, nowMs, deps));
}

async function annualCompute_(db, user, year, today, nowMs, deps) {
  const started = Date.now();
  const thisYm = today.slice(0, 7);
  const yms = [];
  for (let m = 1; m <= 12; m++) yms.push(year + '-' + String(m).padStart(2, '0'));
  const yearStart = year + '-01-01', yearEnd = year + '-12-31';
  const to = yearEnd < today ? yearEnd : today;
  // The same target as the month report: weekly x 4 per team, the weekly falling back to the plain one.
  const weeklyTarget = await deps.settingNum(db, 'SALES_TARGET_WEEKLY', await deps.settingNum(db, 'SALES_TARGET', 100000000));
  const monthTarget = weeklyTarget * 4;

  const [stamps, registry, sales, adj] = await Promise.all([
    readStamps_(db, user, year),
    deps.readTeamsAll(db, nowMs).catch(() => []),
    salesByMonth_(db, user, yearStart, to),
    adjReceived_(db, user, { from: yearStart, to }).catch(() => null),
  ]);

  /* WHICH MONTHS THE LEDGER ANSWERS: every month that has happened and has no stamped rows.
     The two summary reads the ledger makes per month are made ONCE for the whole stretch --
     a handful of rows per upload -- and handed in, so seven cold months do not pay fourteen. */
  const sheetYms = new Set(stamps.rows.filter(r => /^\d{4}-\d{2}$/.test(String(r.ym))).map(r => String(r.ym)));
  const liveYms = yms.filter(ym => ym <= thisYm && !sheetYms.has(ym));
  const live = {};
  const notReached = [];
  if (liveYms.length) {
    const lo = liveYms[0] + '-01';
    const [exp, def] = await Promise.all([
      monthSummaryRows(db, 'expected', { from: lo, to }).catch(() => []),
      monthSummaryRows(db, 'defaulter', { from: lo, to }).catch(() => []),
    ]);
    const summaries = { exp: exp || [], def: def || [] };
    const deadline = started + ANNUAL_LEDGER_BUDGET_MS;
    const mon = weekMondayKey(nowMs);
    for (const ym of liveYms) {
      const monthStart = ym + '-01', mEnd = monthEndOf(ym), mTo = mEnd < today ? mEnd : today;
      const left = deadline - Date.now();
      if (left < 1500) { live[ym] = null; notReached.push(ym); continue; }
      let days = null;
      try { days = await deps.monthLedgerDays_(db, { monthStart, today: mTo, mon, budgetMs: left, summaries }); } catch (e) { days = null; }
      live[ym] = days ? deps.ledgerByTeam_(days, monthStart, mTo, adj) : null;
      if (!days) notReached.push(ym);
    }
  }

  // One entry per team the year saw, keyed across spellings; the registry's spelling wins on screen.
  const regByK2 = new Map();
  for (const t of registry || []) if (t && t.team && teamAllowed(user, t.team)) regByK2.set(K2(t.team), t);
  const teams = new Map();
  const entry = name => {
    const k = K2(name);
    if (!k) return null;
    let e = teams.get(k);
    if (!e) {
      const reg = regByK2.get(k) || null;
      e = { key: k, team: reg ? String(reg.team).trim() : K(name), reg, cells: {}, yearRow: null };
      teams.set(k, e);
    }
    return e;
  };
  const cellOf = (e, ym) => e.cells[ym] || (e.cells[ym] = emptyCell());
  for (const r of stamps.rows) {
    const e = entry(r.team);
    if (!e) continue;
    if (String(r.ym) === String(year)) { e.yearRow = r; continue; }
    if (!sheetYms.has(String(r.ym))) continue;
    const c = cellOf(e, String(r.ym));
    c.src = 'sheet';
    c.expected = nn(r.expected); c.collected = nn(r.collected); c.uncollected = nn(r.uncollected);
    c.ecolPct = nn(r.ecol_pct); c.recovered = nn(r.recovered);
  }
  for (const ym of liveYms) {
    const by = live[ym];
    if (!by) continue;
    for (const T in by) {
      const m = by[T];
      if (!teamAllowed(user, T)) continue;
      if (!(num(m.e) > 0 || num(m.ie) > 0 || num(m.pairedDays) > 0)) continue;
      const e = entry(T);
      if (!e) continue;
      const c = cellOf(e, ym);
      c.src = 'live';
      c.expected = num(m.e); c.collected = num(m.c); c.uncollected = num(m.u);
      c.ecolPct = pct(num(m.ic), num(m.ie));
      c.recovered = num(m.pairedDays) > 0 ? num(m.rec) : null;
    }
  }
  for (const s of sales.by.values()) {
    const e = entry(s.team);
    if (!e) continue;
    for (const ym in s.byYm) {
      if (ym < yms[0] || ym > yms[11]) continue;
      const v = s.byYm[ym], c = cellOf(e, ym);
      if (!c.src) c.src = 'sales';
      c.sales = v.sales; c.loans = v.loans; c.trk1 = v.trk1; c.retained = v.loans - v.trk1; c.totalLoan = v.totalLoan;
    }
  }
  for (const e of teams.values()) for (const ym in e.cells) finishCell_(e.cells[ym], monthTarget);

  /* ---- EVERY TEAM'S YEAR. */
  const teamRows = [];
  for (const e of teams.values()) {
    const cells = yms.filter(ym => e.cells[ym]).map(ym => e.cells[ym]);
    if (!cells.length && !e.yearRow) continue;
    const yr = e.yearRow, reg = e.reg || {};
    const row = { team: e.team, key: e.key, months: cells.length, first: yms.find(ym => e.cells[ym]) || null,
      sales: sumOf(cells, 'sales'), totalLoan: sumOf(cells, 'totalLoan'), loans: sumOf(cells, 'loans'),
      trk1: sumOf(cells, 'trk1'), retained: sumOf(cells, 'retained'),
      expected: sumMeasured(cells, 'expected'), collected: sumMeasured(cells, 'collected'),
      uncollected: sumMeasured(cells, 'uncollected'), recovered: sumMeasured(cells, 'recovered'),
      salesPct: mean(cells.map(c => c.salesPct)), colPct: mean(cells.map(c => c.colPct)),
      recPct: mean(cells.map(c => c.recPct)), ecolPct: mean(cells.map(c => c.ecolPct)),
      totalDef: null, par: null, yearStamped: false, m: {} };
    if (yr) {
      // A year closed per team and per year only (2025): the stamped collection stands where no month measured one.
      if (row.colPct == null && yr.col_pct != null) { row.colPct = r1(yr.col_pct); row.yearStamped = true; }
      if (yr.total_def != null) row.totalDef = num(yr.total_def);
      if (yr.par_pct != null) row.par = r1(yr.par_pct);
    }
    row.retentionPct = pct(row.retained, row.loans);
    row.unrecovered = (row.uncollected != null && row.recovered != null) ? row.uncollected - row.recovered : null;
    row.general = mean([row.salesPct, row.colPct, row.recPct]);
    // Who holds the team: the year row where it names them, Teams & Staff otherwise.
    const pick = (col, yrCol) => {
      const stamped = yr && yrCol && yr[yrCol] != null ? String(yr[yrCol]).trim() : '';
      const v = stamped || (reg[col] == null ? '' : String(reg[col]).trim());
      return v || null;
    };
    for (const role of ANNUAL_ROLES) row[role.key] = pick(role.col, role.yr);
    for (const [k, c] of PLACE_COLS) row[k] = pick(c, c);
    row.branch = reg.branch == null ? null : String(reg.branch).trim() || null;
    for (const ym of yms) if (e.cells[ym]) row.m[ym] = e.cells[ym];
    teamRows.push(row);
  }
  teamRows.sort(byGeneral);

  /* ---- THE COMPANY, MONTH BY MONTH. */
  const months = yms.map((ym, i) => {
    const state = ym > thisYm ? 'future' : sheetYms.has(ym) ? 'sheet' : (live[ym] ? 'live' : 'pending');
    const cells = teamRows.map(t => t.m[ym]).filter(Boolean);
    const expected = sumMeasured(cells, 'expected'), collected = sumMeasured(cells, 'collected');
    const recCells = cells.filter(c => c.recovered != null && c.uncollected != null);
    const recU = recCells.length ? sumOf(recCells, 'uncollected') : null;
    const recovered = recCells.length ? sumOf(recCells, 'recovered') : null;
    const row = { ym, name: MONTH_NAMES[i], state, teams: cells.length,
      sales: sumOf(cells, 'sales'), loans: sumOf(cells, 'loans'), trk1: sumOf(cells, 'trk1'), retained: sumOf(cells, 'retained'), totalLoan: sumOf(cells, 'totalLoan'),
      expected, collected, uncollected: sumMeasured(cells, 'uncollected'), recovered,
      salesPct: cells.length ? pct(sumOf(cells, 'sales'), monthTarget * cells.length) : null,
      colPct: expected != null ? pct(collected, expected) : null,
      recPct: recU != null && recU > 0 ? pct(recovered, recU) : null,
      ecolPct: mean(cells.map(c => c.ecolPct)) };
    row.retentionPct = pct(row.retained, row.loans);
    row.general = mean([row.salesPct, row.colPct, row.recPct]);
    return row;
  });
  const had = months.filter(m => m.state !== 'future' && m.teams > 0);
  const totals = { teams: teamRows.length, months: had.length,
    sales: sumOf(teamRows, 'sales'), totalLoan: sumOf(teamRows, 'totalLoan'), loans: sumOf(teamRows, 'loans'),
    trk1: sumOf(teamRows, 'trk1'), retained: sumOf(teamRows, 'retained'),
    expected: sumMeasured(teamRows, 'expected'), collected: sumMeasured(teamRows, 'collected'),
    uncollected: sumMeasured(teamRows, 'uncollected'), recovered: sumMeasured(teamRows, 'recovered'),
    totalDef: sumMeasured(teamRows, 'totalDef'),
    salesPct: mean(had.map(m => m.salesPct)), colPct: mean(had.map(m => m.colPct)),
    recPct: mean(had.map(m => m.recPct)), ecolPct: mean(had.map(m => m.ecolPct)),
    par: mean(teamRows.map(t => t.par)) };
  // A year whose collection was closed per team only (2025): the company's is the teams' average.
  if (totals.colPct == null && teamRows.some(t => t.yearStamped)) totals.colPct = mean(teamRows.map(t => t.colPct));
  totals.retentionPct = pct(totals.retained, totals.loans);
  totals.unrecovered = (totals.uncollected != null && totals.recovered != null) ? totals.uncollected - totals.recovered : null;
  totals.general = mean([totals.salesPct, totals.colPct, totals.recPct]);

  const leaders = leaderBoards_(teamRows, yms);

  /* ---- WHAT WAS NOT DONE, said on the screen. */
  const notes = [];
  if (!stamps.ok) notes.push('Jedwali la team_months halipo — endesha db/RUN-ME-049a, 049b, 049c na 049d (kwa mpangilio huo) ili miezi ya kabla ya app (2025 na Januari–Julai 2026) ipate collection na recovery. '
    + '/ The team_months table is not there — run db/RUN-ME-049a, 049b, 049c and 049d, in that order, so the months before the app (2025 and January–July 2026) get their collection and recovery.');
  if (!sales.light) notes.push('Mauzo ya mwaka yamejumlishwa hapa seva kutoka kwenye safu zote — endesha db/RUN-ME-049a-annual-table-and-sales-function.sql ili database ijumlishe. '
    + '/ The year\'s sales were summed on this server from every sale row — run db/RUN-ME-049a-annual-table-and-sales-function.sql to have the database sum them.');
  if (notReached.length) notes.push('Leja ya ' + notReached.map(ym => MONTH_NAMES[Number(ym.slice(5, 7)) - 1]).join(', ')
    + ' bado inajengwa (au totals functions hazijawekwa) — collection na recovery za mwezi huo hazionekani; fungua tena baada ya muda. '
    + '/ The ledger for ' + notReached.map(ym => MONTH_NAMES[Number(ym.slice(5, 7)) - 1]).join(', ')
    + ' is still being built (or the totals functions are not installed) — that month shows no collection or recovery yet; open again shortly.');
  if (teamRows.some(t => t.yearStamped)) notes.push(year + ': collection na PAR ni za mwaka mzima kama ripoti ya ' + year + ' ilivyozifunga (collection = 100 − PAR); faili za ' + year + ' hazina collection wala recovery ya kila mwezi, hivyo miezi yake inaonyesha mauzo tu. '
    + '/ ' + year + ': collection and PAR are the year\'s, as the ' + year + ' report closed them (collection = 100 − PAR); the ' + year + ' files carry no monthly collection or recovery, so its months show sales only.');

  const thisYear = Number(today.slice(0, 4));
  const years = [];
  for (let y = Math.min(FIRST_YEAR, year); y <= thisYear; y++) years.push(y);
  return { year, years, today, thisYm, target: monthTarget, weeklyTarget, stamped: stamps.ok, light: sales.light,
    months, teams: teamRows, totals, leaders, notes,
    rule: 'Mwezi: mauzo ÷ lengo (wiki × 4), collected ÷ expected, recovered ÷ uncollected. Mwaka: wastani wa asilimia za miezi iliyopimwa. General: wastani wa sales %, collection % na recovery % zilizopimwa. Kiongozi: wastani wa timu zake. '
      + '/ A month: sales ÷ target (weekly × 4), collected ÷ expected, recovered ÷ uncollected. A year: the average of the measured months\' percentages. General: the average of the measured sales %, collection % and recovery %. A leader: the average of their teams.' };
}
