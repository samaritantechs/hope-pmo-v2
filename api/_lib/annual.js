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
import { readHolders, holderIndex, canonNames, cleanName, loadWorkbookHolders } from './holders.js';

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
const HOLDERS_LOADED_KEY = 'ANNUAL_HOLDERS_LOADED';
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

/** A group of teams' month, by the one rule: the sum of what they sold, the sum collected over the sum
    expected, the sum recovered over the sum left uncollected (on the teams that measured it), General
    the average of the measured three. The company's month and a region's month are both this. */
function monthRow_(cells, monthTarget) {
  const expected = sumMeasured(cells, 'expected'), collected = sumMeasured(cells, 'collected');
  const recCells = cells.filter(c => c.recovered != null && c.uncollected != null);
  const recU = recCells.length ? sumOf(recCells, 'uncollected') : null;
  const recovered = recCells.length ? sumOf(recCells, 'recovered') : null;
  const row = { teams: cells.length,
    sales: sumOf(cells, 'sales'), loans: sumOf(cells, 'loans'), trk1: sumOf(cells, 'trk1'), retained: sumOf(cells, 'retained'), totalLoan: sumOf(cells, 'totalLoan'),
    expected, collected, uncollected: sumMeasured(cells, 'uncollected'), recovered,
    salesPct: cells.length ? pct(sumOf(cells, 'sales'), monthTarget * cells.length) : null,
    colPct: expected != null ? pct(collected, expected) : null,
    recPct: recU != null && recU > 0 ? pct(recovered, recU) : null,
    ecolPct: mean(cells.map(c => c.ecolPct)) };
  row.retentionPct = pct(row.retained, row.loans);
  row.general = mean([row.salesPct, row.colPct, row.recPct]);
  return row;
}
/** Every region (the Teams & Staff column, or the year row's) month by month and for the year: a
    month by monthRow_, the year the average of its measured months, as the company's is. Feeds the
    annual deck's regional slides, so the rule lives here and not in the browser. */
function regionBoards_(teamRows, yms, monthTarget) {
  const groups = new Map();
  for (const t of teamRows) {
    const name = cleanName(t.region);
    if (!name || nobody(name)) continue;
    const k = K(name);
    if (!groups.has(k)) groups.set(k, { name, teams: [] });
    groups.get(k).teams.push(t);
  }
  return [...groups.values()].map(g => {
    const m = {}, held = [];
    for (const ym of yms) {
      const cells = g.teams.map(t => t.m[ym]).filter(Boolean);
      if (!cells.length) continue;
      m[ym] = monthRow_(cells, monthTarget); held.push(ym);
    }
    const rows = held.map(ym => m[ym]);
    const row = { region: g.name, teams: rows.length ? rows[rows.length - 1].teams : 0, teamsEver: g.teams.length, months: held.length,
      sales: sumOf(rows, 'sales'), loans: sumOf(rows, 'loans'), trk1: sumOf(rows, 'trk1'), retained: sumOf(rows, 'retained'),
      salesPct: mean(rows.map(r => r.salesPct)), colPct: mean(rows.map(r => r.colPct)), recPct: mean(rows.map(r => r.recPct)), ecolPct: mean(rows.map(r => r.ecolPct)), m };
    row.retentionPct = pct(row.retained, row.loans);
    row.general = mean([row.salesPct, row.colPct, row.recPct]);
    return row;
  }).sort(byGeneral);
}

/* ---------------------------------------------------------------------------- the leaders */
/** WHO HELD THE ROLE THAT MONTH. The month being lived belongs to whoever holds the team now; a
    finished month to whoever the holder history says held it on its last day; and where the
    history is silent -- nothing recorded, or the table not there yet -- to whoever holds it now
    (or the year row's name), which is exactly what every month was judged on before the history
    existed. A recorded "nobody" stays nobody. */
function makeRoleAt_(hist, today, thisYm) {
  return (t, role, ym) => {
    if (ym >= thisYm) return t[role.key];
    const end = monthEndOf(ym), asOf = end < today ? end : today;
    const h = hist.holderAt(t.key, role.col, asOf);
    return h === undefined ? t[role.key] : (h || null);
  };
}
/** One leader from the months they held: byMonth is ym -> teamKey -> { team, key, cell }. A month
    is the average of the teams they held that month; the year is the average of those months.
    `stints` says which team, in which months, so the card behind a name can show exactly that. */
function leaderFromMonths_(name, byMonth, yms) {
  const held = yms.filter(ym => byMonth.has(ym));
  const m = {}, seen = new Map();
  let sales = 0, loans = 0;
  for (const ym of held) {
    const ents = [...byMonth.get(ym).values()], cs = ents.map(e => e.cell);
    const mm = { teams: ents.length, sales: sumOf(cs, 'sales'), loans: sumOf(cs, 'loans'), retained: sumOf(cs, 'retained'),
      salesPct: mean(cs.map(c => c.salesPct)), ecolPct: mean(cs.map(c => c.ecolPct)),
      colPct: mean(cs.map(c => c.colPct)), recPct: mean(cs.map(c => c.recPct)) };
    mm.general = mean([mm.salesPct, mm.colPct, mm.recPct]);
    m[ym] = mm; sales += mm.sales; loans += sumOf(cs, 'loans');
    for (const e of ents) {
      if (!seen.has(e.key)) seen.set(e.key, { team: e.team, key: e.key, months: [] });
      seen.get(e.key).months.push(ym);
    }
  }
  const stints = [...seen.values()];
  const retained = held.reduce((s, ym) => s + m[ym].retained, 0);
  const row = { name, teams: stints.length, teamList: stints.map(x => x.team).join(', '), months: held.length, sales, loans, retained, retentionPct: pct(retained, loans),
    salesPct: mean(held.map(ym => m[ym].salesPct)), ecolPct: mean(held.map(ym => m[ym].ecolPct)),
    colPct: mean(held.map(ym => m[ym].colPct)), recPct: mean(held.map(ym => m[ym].recPct)), m, stints };
  row.general = mean([row.salesPct, row.colPct, row.recPct]);
  return row;
}
/** Every leader, by role and in any role, from who held which team in which month. A person
    named two ways ("SULEIMAN", "SULEIMAN MPOKI MWASUNGA") is one person where the longer name is
    the only one the shorter could be. Everyone-in-any-role counts a team once a month however many
    roles the person held it under, and keeps their average in each role beside the overall one. */
function leaderBoards_(teamRows, yms, roleAt) {
  const holds = [];
  for (const role of ANNUAL_ROLES) for (const t of teamRows) for (const ym of yms) {
    if (!t.m[ym]) continue;
    const nm = cleanName(roleAt(t, role, ym));
    if (!nm || nobody(nm)) continue;
    holds.push({ role, ym, t, nm });
  }
  const canonRole = new Map(ANNUAL_ROLES.map(r => [r.key, canonNames(holds.filter(h => h.role.key === r.key).map(h => h.nm))]));
  const canonAll = canonNames(holds.map(h => h.nm));
  const fold = (map, nm) => map.get(K(nm)) || nm;
  const monthsOf = items => {
    const by = new Map();
    for (const it of items) {
      if (!by.has(it.ym)) by.set(it.ym, new Map());
      by.get(it.ym).set(it.t.key, { team: it.t.team, key: it.t.key, cell: it.t.m[it.ym] });
    }
    return by;
  };
  const roles = ANNUAL_ROLES.map(role => {
    const g = new Map();
    for (const h of holds) if (h.role.key === role.key) {
      const nm = fold(canonRole.get(role.key), h.nm), k = K(nm);
      if (!g.has(k)) g.set(k, { name: nm, items: [] });
      g.get(k).items.push(h);
    }
    return { role: role.key, label: role.label,
      rows: [...g.values()].map(x => ({ id: role.key + '|' + K(x.name), ...leaderFromMonths_(x.name, monthsOf(x.items), yms) })).sort(byGeneral) };
  });
  const people = new Map();
  for (const h of holds) {
    const nm = fold(canonAll, h.nm), k = K(nm);
    if (!people.has(k)) people.set(k, { name: nm, items: [], roles: new Map() });
    const p = people.get(k);
    p.items.push(h);
    if (!p.roles.has(h.role.key)) p.roles.set(h.role.key, []);
    p.roles.get(h.role.key).push(h);
  }
  const all = [...people.values()].map(p => {
    const byRole = [...p.roles.entries()].map(([rk, items]) => {
      const r = leaderFromMonths_(p.name, monthsOf(items), yms);
      return { role: ANNUAL_ROLES.find(x => x.key === rk).label, general: r.general, months: r.months, teams: r.teams };
    });
    return { id: 'all|' + K(p.name), roles: byRole.map(b => b.role).join(', '), byRole, ...leaderFromMonths_(p.name, monthsOf(p.items), yms) };
  }).sort(byGeneral);
  return { roles, all };
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

  const [stamps, registry, sales, adj, holders0] = await Promise.all([
    readStamps_(db, user, year),
    deps.readTeamsAll(db, nowMs).catch(() => []),
    salesByMonth_(db, user, yearStart, to),
    adjReceived_(db, user, { from: yearStart, to }).catch(() => null),
    readHolders(db, yearStart, yearEnd, user.teams, teamMatchList),
  ]);
  /* THE WORKBOOKS' LEADERS, LOADED ONCE. The first time an admin who may write opens this tab on a
     database that has the table, the leaders of 2025 and of each month of 2026 are written in
     (rows already there are left as they are) and a setting remembers it was done, so nobody
     pastes anything and nothing is loaded twice. Anyone else, and a view-only code, only reads. */
  let holders = holders0, loadedHolders = null, holdersError = null;
  const mayLoad = holders.ok && (user.tabs || []).includes('settings') && !user.readOnly && !(user.teams && user.teams.length);
  if (mayLoad && !(await deps.settingGet(db, HOLDERS_LOADED_KEY))) {
    try {
      loadedHolders = await loadWorkbookHolders(db);
      await db.from('settings').upsert({ key: HOLDERS_LOADED_KEY, value: new Date(nowMs).toISOString() }, { onConflict: 'key' });
      deps.noteSettingsWritten(db);
      holders = await readHolders(db, yearStart, yearEnd, user.teams, teamMatchList);
    } catch (e) { holdersError = String((e && e.message) || e); }
  }
  const hist = holderIndex(holders.rows);

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
  /* TEAMS IN TEAMS & STAFF THAT HAD NO SALES THIS YEAR: they are in no figure, but the GMO who holds one is still that zone's GMO, and
     the deck's zone map names every GMO. Already read (the registry above), so no extra read; a name and two places, no money. */
  const sawKeys = new Set(teamRows.map(r => r.key));
  const idle = [];
  for (const [k, reg] of regByK2) {
    if (sawKeys.has(k)) continue;
    const g = reg.gmo == null ? '' : String(reg.gmo).trim(), z = reg.zone == null ? '' : String(reg.zone).trim();
    if (nobody(g) && nobody(z)) continue;
    idle.push({ team: String(reg.team).trim(), gmo: nobody(g) ? null : g, zone: nobody(z) ? null : z, region: reg.region == null ? null : String(reg.region).trim() || null });
  }

  /* ---- THE COMPANY, MONTH BY MONTH. */
  const months = yms.map((ym, i) => {
    const state = ym > thisYm ? 'future' : sheetYms.has(ym) ? 'sheet' : (live[ym] ? 'live' : 'pending');
    const cells = teamRows.map(t => t.m[ym]).filter(Boolean);
    return { ym, name: MONTH_NAMES[i], state, ...monthRow_(cells, monthTarget) };
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

  const leaders = leaderBoards_(teamRows, yms, makeRoleAt_(hist, today, thisYm));
  const regions = regionBoards_(teamRows, yms, monthTarget);

  /* ---- WHAT WAS NOT DONE, said on the screen. */
  const notes = [];
  if (!stamps.ok) notes.push('Jedwali la team_months halipo — endesha db/RUN-ME-049a hadi 049e (kwa mpangilio huo) ili miezi ya kabla ya app (2025 na Januari–Julai 2026) ipate collection na recovery. '
    + '/ The team_months table is not there — run db/RUN-ME-049a to 049e, in that order, so the months before the app (2025 and January–July 2026) get their collection and recovery.');
  if (!holders.ok) notes.push('Jedwali la team_holders halipo — endesha db/RUN-ME-050-team-holders.sql ili kila mwezi ahukumiwe kwa aliyeshika timu wakati wake; kwa sasa ni anayeshika timu leo. '
    + '/ The team_holders table is not there — run db/RUN-ME-050-team-holders.sql so each month is judged on who held the team that month; until then it is whoever holds the team today.');
  if (loadedHolders) notes.push('Viongozi wa 2025 na wa kila mwezi wa 2026 wamepakiwa kutoka kwenye faili za mwaka (' + loadedHolders + ' vipindi). Kuanzia sasa kila ukibadilisha mwenye nafasi kwenye Teams & Staff, aliyetangulia anahifadhiwa. '
    + '/ The leaders of 2025 and of each month of 2026 were loaded from the annual workbooks (' + loadedHolders + ' stretches). From now on, when you change who holds a role on Teams & Staff, the previous holder is saved.');
  if (holdersError) notes.push('Viongozi wa kutoka kwenye faili hawakupakiwa: ' + holdersError + ' / The workbooks\' leaders could not be loaded: ' + holdersError + ' — open this tab again to retry.');
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
    months, teams: teamRows, idle, totals, leaders, regions, notes,
    holders: { ok: holders.ok, stretches: holders.rows.length, loaded: loadedHolders },
    rule: 'Mwezi: mauzo ÷ lengo (wiki × 4), collected ÷ expected, recovered ÷ uncollected. Mwaka: wastani wa asilimia za miezi iliyopimwa. General: wastani wa sales %, collection % na recovery % zilizopimwa. Kiongozi: wastani wa timu zake. '
      + '/ A month: sales ÷ target (weekly × 4), collected ÷ expected, recovered ÷ uncollected. A year: the average of the measured months\' percentages. General: the average of the measured sales %, collection % and recovery %. A leader: the average of their teams.' };
}

/* =====================================================================================
   THE BOOKS BESIDE THE YEAR -- what the annual deck lays next to the months.

     "PAR data, Active portfolio, and legal performance must be presented in the ppt with no
      excuse brother"

   The Annual Rep answer is the year's own: sales, collection, recovery, leaders. Three more
   things belong in the GM's deck and are not the year's months but the BOOKS the system holds,
   read the way their own tabs read them:

     par         the Portfolio at Risk tab's answer (par(): the latest defaulter deck, bucketed by
                 days overdue and by status, per team, with the all-time PAR over everything ever
                 lent), and the same laid by region;
     portfolio   the active portfolio: every customer on the latest Expected deck with their
                 outstanding balance, how many are behind, what was due and collected that day;
     legal       the demand notice register for THE YEAR (notices dated in it), by month and by
                 team, with the recovery the register itself reports (noticeTiles_, the one
                 definition) as at the latest deck.

   NOTHING IS WORKED OUT A SECOND WAY. Each section calls the function its tab calls, with the
   caller's own scope, and only groups what comes back (by region, by month). A section the code
   may not open, or that cannot be read, comes back `{ ok: false, reason }` and the deck says so on
   its own slide; one section failing never takes the others down. PAR and the portfolio are the
   book AS AT the latest deck (the date is on the answer) -- they are not rebuilt for a past
   year-end, and the deck says that too. Read on the press of the deck's button only; cached for
   the usual minute; never on the upload or call paths.
   ===================================================================================== */
const sumBy_ = (rows, f) => rows.reduce((s, r) => s + num(r[f]), 0);

export async function annualBook(db, user, args, nowMs, deps) {
  const today = todayKey(nowMs);
  const year = annualYear(args && args.year, today);
  return cachedAnswer(db, 'annualBook|' + year, user, nowMs, () => bookCompute_(db, user, year, today, nowMs, deps));
}

async function bookCompute_(db, user, year, today, nowMs, deps) {
  const tabs = user.tabs || [];
  const may = tab => tabs.includes('settings') || tabs.includes(tab);
  const regionBy = new Map();
  for (const t of (await deps.readTeamsAll(db, nowMs).catch(() => [])) || []) {
    const r = t && t.team ? cleanName(t.region) : '';
    if (r && !nobody(r)) regionBy.set(K2(t.team), r);
  }
  const regionOf = team => regionBy.get(K2(team)) || null;
  const attempt = async (tab, label, fn) => {
    if (!may(tab)) return { ok: false, reason: 'needs the ' + label + ' tab on this code' };
    try { return { ok: true, ...(await fn()) }; } catch (e) { return { ok: false, reason: 'could not be read: ' + String((e && e.message) || e).slice(0, 160) }; }
  };
  /** Teams grouped by region: each group's sums, with whatever ratio the caller derives from them. */
  const byRegion = (rows, teamOf, fields) => {
    const g = new Map(), none = { teams: new Set() };
    for (const f of fields) none[f] = 0;
    for (const r of rows) {
      const name = regionOf(teamOf(r));
      if (!name) { none.teams.add(K2(teamOf(r))); for (const f of fields) none[f] += num(r[f]); continue; }
      if (!g.has(name)) g.set(name, { region: name, teams: new Set() });
      const x = g.get(name); x.teams.add(K2(teamOf(r)));
      for (const f of fields) x[f] = (x[f] || 0) + num(r[f]);
    }
    const out = [...g.values()].map(x => ({ ...x, teams: x.teams.size }));
    out.unplaced = { ...none, teams: none.teams.size };      // teams with no region in Teams & Staff yet: counted nowhere, said on the slide
    return out;
  };

  const [par, portfolio, legal] = await Promise.all([
    attempt('par', 'Portfolio at Risk', async () => {
      const p = await deps.par(db, user, {}, nowMs);
      const byTeam = (p.byTeam || []).map(t => ({ team: t.team, region: regionOf(t.team), customers: t.customers, arrears: t.arrears, balance: t.balance,
        par: t.par, loans: t.loans, totalLoan: t.totalLoan, parAll: t.parAll }));
      const regionsRaw = byRegion(byTeam, t => t.team, ['customers', 'arrears', 'balance', 'totalLoan']);
      const regions = regionsRaw.map(x => ({ ...x,
        par: pct(x.arrears, x.balance), parAll: x.totalLoan > 0 ? pct(x.arrears, x.totalLoan) : null }))
        .sort((a, b) => b.arrears - a.arrears);
      return { date: p.date || null, empty: !p.date, totals: p.totals, bands: p.bands || [], byBand: p.byBand || [], byStatus: (p.byStatus || []).slice(0, 8), byYear: p.byYear || [],
        byTeam, byRegion: regions, unplaced: regionsRaw.unplaced, allTime: p.allTime ? { since: p.allTime.since, loans: p.allTime.loans, totalLoan: p.allTime.totalLoan } : null };
    }),
    attempt('expected', 'Expected', async () => {
      const e = await deps.expected(db, user, { type: 'today' }, nowMs);
      const rows = e.rows || [];
      const behind = rows.filter(r => num(r.arrears) > 0);
      const status = new Map();
      for (const r of rows) {
        const k = String(r.todays_status || '').trim().toUpperCase() || '(BLANK)';
        const s = status.get(k) || { status: k, customers: 0, balance: 0 };
        s.customers++; s.balance += num(r.balance); status.set(k, s);
      }
      const team = new Map();
      for (const r of rows) {
        const t = String(r.team || '(no team)').trim();
        const x = team.get(K2(t)) || { team: t, customers: 0, balance: 0, arrears: 0, behind: 0 };
        x.customers++; x.balance += num(r.balance); x.arrears += num(r.arrears); if (num(r.arrears) > 0) x.behind++; team.set(K2(t), x);
      }
      const byTeam = [...team.values()].map(x => ({ ...x, region: regionOf(x.team), arrearsPct: pct(x.arrears, x.balance) })).sort((a, b) => b.balance - a.balance);
      const regionsRaw = byRegion(byTeam, t => t.team, ['customers', 'balance', 'arrears', 'behind']);
      const regions = regionsRaw.map(x => ({ ...x, arrearsPct: pct(x.arrears, x.balance) }))
        .sort((a, b) => b.balance - a.balance);
      const t = e.totals || {};
      return { date: e.date || null, empty: !e.date || !rows.length, customers: rows.length, balance: sumBy_(rows, 'balance'),
        expected: num(t.expected), collected: num(t.collected), collectedPct: t.pct == null ? null : t.pct,
        behind: { customers: behind.length, arrears: sumBy_(behind, 'arrears'), balance: sumBy_(behind, 'balance') },
        byStatus: [...status.values()].sort((a, b) => b.customers - a.customers), byTeam, byRegion: regions, unplaced: regionsRaw.unplaced };
    }),
    attempt('legal', 'Legal', async () => {
      const dn = await deps.demandNotices(db, user, {}, nowMs);
      const rows = (dn.rows || []).filter(r => String(r.notice_date || '').slice(0, 4) === String(year));
      const tiles = deps.noticeTiles_(rows);
      const byMonth = [];
      for (let m = 1; m <= 12; m++) {
        const ym = year + '-' + String(m).padStart(2, '0');
        const mr = rows.filter(r => String(r.notice_date || '').slice(0, 7) === ym);
        byMonth.push({ ym, notices: mr.length, demanded: sumBy_(mr, 'total_demand'), fines: sumBy_(mr, 'fine'), paidSince: deps.noticeTiles_(mr).paidSince });
      }
      const team = new Map();
      for (const r of rows) { const k = K2(r.team); if (!team.has(k)) team.set(k, { team: String(r.team || '(no team)').trim(), rows: [] }); team.get(k).rows.push(r); }
      const byTeam = [...team.values()].map(x => { const tl = deps.noticeTiles_(x.rows); return { team: x.team, region: regionOf(x.team), notices: x.rows.length, customers: tl.customers,
        demanded: sumBy_(x.rows, 'total_demand'), fines: sumBy_(x.rows, 'fine'), paidSince: tl.paidSince, recovery: tl.recovery, recoveryPct: tl.recoveryPct, cleared: tl.cleared }; })
        .sort((a, b) => b.demanded - a.demanded);
      const officer = new Map();
      for (const r of rows) { const nm = String(r.issued_by || '').trim() || '(not recorded)'; const k = K(nm); if (!officer.has(k)) officer.set(k, { officer: nm, rows: [] }); officer.get(k).rows.push(r); }
      const byOfficer = [...officer.values()].map(x => { const tl = deps.noticeTiles_(x.rows); return { officer: x.officer, notices: x.rows.length, customers: tl.customers, teams: new Set(x.rows.map(r => K2(r.team))).size,
        demanded: sumBy_(x.rows, 'total_demand'), fines: sumBy_(x.rows, 'fine'), paidSince: tl.paidSince, recovery: tl.recovery, recoveryPct: tl.recoveryPct, cleared: tl.cleared,
        first: x.rows.map(r => String(r.notice_date || '').slice(0, 10)).sort()[0] || null }; })
        .sort((a, b) => b.notices - a.notices || b.demanded - a.demanded);
      const state = new Map();
      for (const r of rows) { const k = String(r.notice_state || '').trim(); state.set(k, (state.get(k) || 0) + 1); }
      return { empty: !rows.length, asOf: dn.asOf || null, paymentsOn: !!dn.paymentsOn, notices: rows.length, customers: tiles.customers, cleared: tiles.cleared,
        demanded: sumBy_(rows, 'total_demand'), fines: sumBy_(rows, 'fine'), atNotice: sumBy_(rows, 'arrears_at_notice'),
        recovery: tiles.recovery, owed: tiles.owed, recoveryPct: tiles.recoveryPct, paidSince: tiles.paidSince,
        byMonth, byTeam, byOfficer, byState: [...state.entries()].map(([s, n]) => ({ state: s, notices: n })).sort((a, b) => b.notices - a.notices) };
    }),
  ]);
  return { year, asAt: today, par, portfolio, legal };
}
