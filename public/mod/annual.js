/* annual -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every function
   here is a global exactly as it would be inside app.html, and it may use any helper the core
   page defines. Bump `var BUILD` in app.html whenever this file changes -- the loader fetches it
   as /mod/annual.js?v=BUILD. */

/* =====================================================================================
   THE ANNUAL REPORT -- the GM's annual workbook, read off the system and always current.

     "we also build a new tab 'Annual' - this will always update the annual statics, GM wants
      to always have the report autoupdating ... in the tab i could go months, years, report
      types, export excels, jpgs etc of what you see best"

   One call per year (srv('annual', { year })) brings every team's twelve months; everything on
   this screen -- the whole year, one month's own sheet, the company month by month, a metric
   across the months, the leaders by role and in any role -- is cut from that one answer, so
   changing the month or the report type costs nothing. Every table is a board with its own
   Excel / JPG / CSV, and the list behind the chip is the same table with the search box.

   The arithmetic is the server's (api/_lib/annual.js) and is printed under the bar: a month's
   three percentages are the month report's own; a year's are the average of its measured
   months; GENERAL is the average of the measured three; a leader is the average of their
   teams. Sales, count and retention come from the loans table for every month; collection and
   recovery come from the stamped workbook months (2025, January–July 2026) or the month ledger.
   ===================================================================================== */
var AN_MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
var AN_MON_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
var AN_STATE = { sheet: ['kutoka ripoti', 'from the sheet', 'ok'], live: ['mfumo', 'the system', 'ok'],
  pending: ['leja inajengwa', 'ledger pending', 'warn'], future: ['bado', 'not yet', 'mut'] };
/* THE TOP OF THIS SCREEN IS ENGLISH ONLY AND BUILT FOR A PHONE: "The top design ain't user
   experience friendly". The three report types are one full-width row of big touch targets, the
   year stepper and the month picker share the row under it, and nothing wraps into a corner. The
   report-type buttons live inside a `.pills` wrapper because that is where the shared pill style
   is defined -- outside it they are plain grey browser buttons. */
var AN_LEADER_COLS = [['opm', 'OPM'], ['pmo', 'PMO'], ['credit', 'Credit'], ['manager', 'Manager'], ['gmo', 'GMO'],
  ['legal', 'Legal'], ['region', 'Region'], ['bike', 'Bike'], ['earlyCol', 'Early col']];
var AN_METRICS = [['salesPct', 'Sales %', 'pct'], ['sales', 'Mauzo / Sales', 'money'], ['ecolPct', 'Early col %', 'pct'],
  ['colPct', 'Collection %', 'pct'], ['recPct', 'Recovery %', 'pct'], ['general', 'General %', 'pct'],
  ['loans', 'Count', 'num'], ['retentionPct', 'Retention %', 'pct']];

function anYmLabel_(ym){ var i = Number(String(ym).slice(5, 7)) - 1; return (AN_MON[i] || ym) + ' ' + String(ym).slice(0, 4); }
function anYmLong_(ym){ var i = Number(String(ym).slice(5, 7)) - 1; return (AN_MON_SW[i] || '') + ' / ' + (['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'][i] || ym) + ' ' + String(ym).slice(0, 4); }
function anStateWords_(st){ var w = AN_STATE[st] || [st, st, 'mut']; return w[1]; }
function anStateCls_(st){ return (AN_STATE[st] || [0, 0, 'mut'])[2]; }
/* A percentage's colour on the cards: at or over its target green, otherwise plain -- the same
   targets the tables use (targetOf_). The tables themselves paint by the one colour rule. */
function anCls_(key, v){ if (v == null) return ''; var t = targetOf_({ key: key }); return (t != null && Number(v) >= t) ? 'good' : ''; }
function anPc_(v){ return v == null ? '—' : pct(v); }

/* The bar: the three report types, then the year and the month. A month narrows the Teams and
   Leaders reports to that month's own sheet; "By month" always shows the whole year. */
function anBar_(d, rep, month){
  var yrs = d.years || [d.year];
  var i = yrs.indexOf(Number(d.year));
  var prev = i > 0 ? yrs[i - 1] : null, next = (i >= 0 && i < yrs.length - 1) ? yrs[i + 1] : null;
  // Row one: the report type, three equal buttons across the full width.
  var seg = '<div class="pills" style="flex-wrap:nowrap;margin-bottom:8px">' + [['teams', 'Teams'], ['months', 'By month'], ['leaders', 'Leaders']].map(function(p){
    return '<button class="pill' + (rep === p[0] ? ' on' : '') + '" style="flex:1;padding:10px 6px;font-size:13.5px" data-arg="rep" data-val="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>';
  // Row two: the year, stepped, and the month, filling what is left.
  var sel = '<select data-arg="month" aria-label="Month" style="flex:1 1 150px;min-width:0;max-width:100%"><option value="">Whole year</option>'
    + (d.months || []).filter(function(m){ return m.state !== 'future'; }).map(function(m){
        return '<option value="' + m.ym + '"' + (month === m.ym ? ' selected' : '') + '>' + anYmLabel_(m.ym) + ' · ' + anStateWords_(m.state) + '</option>'; }).join('')
    + '</select>';
  var year = '<span style="display:inline-flex;align-items:center;gap:6px;flex:0 0 auto">'
    + '<button class="btn sm ghost" data-arg="year" data-val="' + esc(prev || d.year) + '"' + (prev ? '' : ' disabled') + ' title="Previous year" aria-label="Previous year">&#9664;</button>'
    + '<b style="min-width:42px;text-align:center">' + esc(d.year) + '</b>'
    + '<button class="btn sm ghost" data-arg="year" data-val="' + esc(next || d.year) + '"' + (next ? '' : ' disabled') + ' title="Next year" aria-label="Next year">&#9654;</button></span>';
  var ppt = '<button class="btn sm" style="flex:0 0 auto" onclick="anPptExport_(this)" title="The deck for ' + esc(d.year) + ', made from what is on screen">Export deck (PPT)</button>';
  return seg + bar(year + sel + ppt);
}
/* THE DECK: the button asks for /deck/annual-ppt.js the first time it is pressed (the file, the
   PowerPoint library and the two images are never fetched at page load), then runs it. The deck
   is made in the browser from S.anData and the year before; see the file's own header. */
function anPptExport_(btn){
  if (window.anPptRun_) return anPptRun_(btn);
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing the deck…'; }
  var s = document.createElement('script');
  s.src = '/deck/annual-ppt.js?v=' + encodeURIComponent(BUILD);
  s.onload = function(){ if (btn) { btn.disabled = false; btn.textContent = 'Export deck (PPT)'; } anPptRun_(btn); };
  s.onerror = function(){ if (s.parentNode) s.parentNode.removeChild(s); if (btn) { btn.disabled = false; btn.textContent = 'Export deck (PPT)'; } toast('The deck did not load. Check the connection and try again.', true); };
  document.head.appendChild(s);
}
/* Where each month came from, in one line under the bar -- the sheet, the system, or not yet. */
function anSources_(d){
  var had = (d.months || []).filter(function(m){ return m.state !== 'future'; });
  var by = {};
  had.forEach(function(m){ (by[m.state] = by[m.state] || []).push(AN_MON[Number(m.ym.slice(5, 7)) - 1]); });
  return '<div class="mut" style="font-size:12px;margin:2px 0 10px;display:flex;flex-direction:column;gap:4px">'
    + Object.keys(by).map(function(st){ return '<div><span class="chip ' + anStateCls_(st) + '">' + esc(anStateWords_(st)) + '</span> ' + esc(by[st].join(', ')) + '</div>'; }).join('')
    + '<div>Month target: TZS ' + money(d.target) + ' per team</div></div>';
}
function anKpis_(t, when){
  return '<div class="kpis">'
    + kpi('Sales', money(t.sales), money(t.loans) + ' loans · ' + money(t.trk1) + ' TRK1 · ' + money(t.retained) + ' retained (' + anPc_(t.retentionPct) + ') · ' + when)
    + kpi('Sales %', anPc_(t.salesPct), 'against target', anCls_('salesPct', t.salesPct))
    + kpi('Early col %', anPc_(t.ecolPct), 'the initial sheet', anCls_('ecolPct', t.ecolPct))
    + kpi('Collection %', anPc_(t.colPct), t.expected != null ? 'TZS ' + money(t.collected) + ' / ' + money(t.expected) : '', anCls_('colPct', t.colPct))
    + kpi('Recovery %', anPc_(t.recPct), t.recovered != null ? 'TZS ' + money(t.recovered) + ' / ' + money(t.uncollected) : '', anCls_('recPct', t.recPct))
    + kpi('General %', anPc_(t.general), 'the average of sales, collection and recovery', t.general == null ? '' : (t.general >= 70 ? 'good' : (t.general < 50 ? 'bad' : '')))
    + '</div>';
}
function anTeamCols_(yearMode){
  var c = AN_LEADER_COLS.map(function(p){ return { key: p[0], label: p[1], nameCol: p[0] !== 'region' }; });
  c.push({ key: 'team', label: 'Timu / Team', nameCol: true },
    col('sales', 'Mauzo / Sales', 'money'), col('totalLoan', 'Total loan (P+I)', 'money'), col('salesPct', 'Sales %', 'pct'),
    col('loans', 'Count', 'num'), col('trk1', 'TRK1', 'num'), col('retained', 'Retained', 'num'), col('retentionPct', 'Retention %', 'pct'),
    col('expected', 'Expected', 'money'), col('collected', 'Collected', 'money'), col('uncollected', 'Uncollected', 'money'),
    col('ecolPct', 'Early col %', 'pct'), col('colPct', 'Collection %', 'pct'),
    col('recovered', 'Recovered', 'money'), col('recPct', 'Recovery %', 'pct'), col('unrecovered', 'Unrecovered', 'money'),
    { key: 'general', label: 'General %', kind: 'pct', avgKey: 'general' });
  if (yearMode) c.push(col('totalDef', 'Total def', 'money'), { key: 'par', label: 'PAR %', kind: 'pct', lowGood: true }, col('months', 'Miezi / Months', 'num'));
  return c;
}
/* The total row of a board, from the server's own figures -- the engine fills only what is left
   blank, so a percentage here is the company's, never an average of the rows above it. */
function anTotals_(t, cols){
  var o = {};
  cols.forEach(function(c){ if (t[c.key] != null) o[c.key] = t[c.key]; });
  o[cols[0].key] = '';
  return o;
}
/* One month's sheet: every team that had the month, its leaders beside the month's figures. */
function anMonthRows_(d, ym){
  return (d.teams || []).filter(function(t){ return t.m && t.m[ym]; }).map(function(t){
    var c = t.m[ym], o = { team: t.team, key: t.key };
    AN_LEADER_COLS.forEach(function(p){ o[p[0]] = t[p[0]]; });
    Object.keys(c).forEach(function(k){ o[k] = c[k]; });
    o.unrecovered = (c.uncollected != null && c.recovered != null) ? c.uncollected - c.recovered : null;
    return o;
  }).sort(function(a, b){ return (b.general == null ? -1 : b.general) - (a.general == null ? -1 : a.general) || (b.sales - a.sales); });
}
function anMonthOf_(d, ym){ return (d.months || []).filter(function(m){ return m.ym === ym; })[0] || {}; }

/* ---- TIMU / TEAMS: the ANNUAL sheet (the year) or one month's sheet. */
function anTeams_(d, month){
  var yearMode = !month;
  var rows = yearMode ? d.teams : anMonthRows_(d, month);
  var tot = yearMode ? d.totals : anMonthOf_(d, month);
  var cols = anTeamCols_(yearMode);
  var when = yearMode ? (d.totals.months + ' months') : anYmLabel_(month) + ' · ' + anStateWords_(tot.state);
  HEAD += anKpis_(tot, when)
    + board('anTeams', yearMode ? 'Timu — mwaka ' + d.year + ' / Teams — the year' : 'Timu — ' + anYmLong_(month),
        money(rows.length) + ' timu / teams · bora kwanza / best first',
        rows, cols, anTotals_(tot, cols));
  S.rows = rows; S.cols = cols;
  S.foldMain = 'anlist'; S.foldLabel = 'Orodha / List — tafuta na panga / search and sort';
  S.foot = 'Mauzo / Sales: TZS ' + money(tot.sales) + ' · Sales ' + anPc_(tot.salesPct) + ' · Col ' + anPc_(tot.colPct) + ' · Rec ' + anPc_(tot.recPct) + ' · General ' + anPc_(tot.general);
}

/* ---- KWA MWEZI / BY MONTH: the company month by month (the MONTHLY sheet), then one metric
   across the months for every team (the SALES / COLN / REC / COUNT sheets, one at a time). */
function anMonths_(d, metric){
  var mdef = AN_METRICS.filter(function(x){ return x[0] === metric; })[0] || AN_METRICS[0];
  var mrows = (d.months || []).filter(function(m){ return m.state !== 'future'; });
  var mcols = [{ key: 'name', label: 'Mwezi / Month' },
    { key: 'state', label: 'Chanzo / Source', kind: 'chip', get: function(r){ return r.state ? anStateWords_(r.state) : ''; }, chip: function(r){ return anStateCls_(r.state); } },
    col('teams', 'Timu / Teams', 'num'), col('sales', 'Mauzo / Sales', 'money'), col('salesPct', 'Sales %', 'pct'),
    col('loans', 'Count', 'num'), col('trk1', 'TRK1', 'num'), col('retained', 'Retained', 'num'), col('retentionPct', 'Retention %', 'pct'),
    col('expected', 'Expected', 'money'), col('collected', 'Collected', 'money'), col('colPct', 'Collection %', 'pct'),
    col('uncollected', 'Uncollected', 'money'), col('ecolPct', 'Early col %', 'pct'), col('recovered', 'Recovered', 'money'), col('recPct', 'Recovery %', 'pct'),
    { key: 'general', label: 'General %', kind: 'pct', avgKey: 'general' }];
  var yearTot = anTotals_(d.totals, mcols);
  yearTot.name = ''; yearTot.teams = d.totals.teams;
  HEAD += anKpis_(d.totals, d.totals.months + ' months')
    + board('anMonths', 'Kampuni kwa mwezi / The company, month by month', 'mwaka ' + d.year + ' · JUMLA = mwaka: wastani wa miezi / the year: the average of the months', mrows, mcols, yearTot);
  // The metric pills, then the matrix: a team per row, a month per column, the year at the end.
  var pills = AN_METRICS.map(function(x){ return '<button class="pill' + (x[0] === mdef[0] ? ' on' : '') + '" data-arg="metric" data-val="' + x[0] + '">' + x[1] + '</button>'; }).join('');
  var xcols = [{ key: 'team', label: 'Timu / Team', nameCol: true }];
  mrows.forEach(function(m){ xcols.push({ key: 'm' + m.ym.slice(5, 7), label: AN_MON[Number(m.ym.slice(5, 7)) - 1], kind: mdef[2], title: anYmLabel_(m.ym) + ' · ' + anStateWords_(m.state) }); });
  xcols.push({ key: 'year', label: 'Mwaka / Year', kind: mdef[2], avgKey: mdef[2] === 'pct' ? 'year' : undefined });
  var xrows = (d.teams || []).map(function(t){
    var o = { team: t.team, year: t[mdef[0]] };
    mrows.forEach(function(m){ var c = t.m[m.ym]; o['m' + m.ym.slice(5, 7)] = c ? c[mdef[0]] : null; });
    return o;
  });
  var xtot = { team: '', year: d.totals[mdef[0]] };
  mrows.forEach(function(m){ xtot['m' + m.ym.slice(5, 7)] = m[mdef[0]]; });
  HEAD += '<div class="pills">' + pills + '</div>'
    + board('anMatrix', mdef[1] + ' kwa timu na mwezi / by team and month', 'mwaka ' + d.year + ' · JUMLA = kampuni / the company', xrows, xcols, xtot);
  S.rows = mrows; S.cols = mcols;
  S.foldMain = 'anlist'; S.foldLabel = 'Orodha / List — miezi / the months';
  S.foot = d.totals.months + ' months · General ' + anPc_(d.totals.general);
}

/* ---- VIONGOZI / LEADERS: one board per role (the GMO sheets), then everyone in any role. A
   leader's figure is the average of the months they held a team, each month the average of the
   teams they held THAT month (the holder history, api/_lib/holders.js). The total row is the company. */
function anRange_(yms){
  // ['2026-01','2026-02','2026-03','2026-06'] -> 'JAN–MAR, JUN'
  var idx = yms.map(function(ym){ return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1; }), out = [], i = 0;
  var nm = function(n){ return AN_MON[n % 12] + (yms.length && yms[0].slice(0, 4) !== yms[yms.length - 1].slice(0, 4) ? ' ' + Math.floor(n / 12) : ''); };
  while (i < idx.length) {
    var j = i;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    out.push(i === j ? nm(idx[i]) : nm(idx[i]) + '–' + nm(idx[j]));
    i = j + 1;
  }
  return out.join(', ');
}
function anLeaderRows_(rows, month){
  return rows.map(function(r){
    var src = month ? r.m[month] : r;
    if (!src) return null;
    var byRole = (r.byRole || []).map(function(b){ return b.role + ' ' + anPc_(b.general); }).join(' · ');
    return { id: r.id, name: r.name, roles: month ? (r.roles || '') : (byRole || r.roles || ''), teams: month ? src.teams : r.teams, teamList: month ? '' : r.teamList,
      months: month ? 1 : r.months, sales: src.sales, salesPct: src.salesPct, ecolPct: src.ecolPct, colPct: src.colPct, recPct: src.recPct, general: src.general };
  }).filter(Boolean).sort(function(a, b){ return (b.general == null ? -1 : b.general) - (a.general == null ? -1 : a.general); });
}
function anLeaderCols_(withRoles, month){
  var c = [];
  if (withRoles) c.push(col('roles', month ? 'Nafasi / Roles' : 'Nafasi na General % / Roles and General %'));
  c.push({ key: 'name', label: 'Jina / Name', kind: 'tap', tap: 'anLeader_', nameCol: true, data: function(r){ return { id: r.id }; } },
    col('teams', 'Timu / Teams', 'num'));
  if (!month) c.push(col('teamList', 'Timu zipi / Which teams'));
  c.push(col('months', 'Miezi / Months', 'num'),
    col('sales', 'Mauzo / Sales', 'money'), col('salesPct', 'Sales %', 'pct'), col('ecolPct', 'Early col %', 'pct'),
    col('colPct', 'Collection %', 'pct'), col('recPct', 'Recovery %', 'pct'), { key: 'general', label: 'General %', kind: 'pct', avgKey: 'general' });
  return c;
}
function anLeaders_(d, month){
  var tot = month ? anMonthOf_(d, month) : d.totals;
  var when = month ? anYmLabel_(month) : 'the year ' + d.year;
  HEAD += anKpis_(tot, when);
  var L = d.leaders || { roles: [], all: [] };
  var cols = anLeaderCols_(false, month);
  (L.roles || []).forEach(function(sec){
    var rows = anLeaderRows_(sec.rows || [], month);
    if (!rows.length) return;
    var t = anTotals_(tot, cols); t.teams = tot.teams; t.months = tot.months;
    HEAD += board('anL_' + sec.role, 'Kwa ' + sec.label + ' / By ' + sec.label, money(rows.length) + ' named · ' + when + ' · wastani wa miezi waliyoshika timu / the average of the months they held a team', rows, cols, t);
  });
  var allCols = anLeaderCols_(true, month);
  var all = anLeaderRows_(L.all || [], month);
  var at = anTotals_(tot, allCols); at.teams = tot.teams; at.months = tot.months;
  HEAD += board('anAll', 'Wote, nafasi yoyote / Everyone, in any role', money(all.length) + ' named · kila timu mara moja kwa mwezi / a team counts once a month, whatever the role', all, allCols, at);
  S.rows = all; S.cols = allCols;
  S.foldMain = 'anlist'; S.foldLabel = 'Orodha / List — viongozi wote / all leaders';
  S.foot = money(all.length) + ' viongozi / leaders · ' + when;
}
/* The card behind a leader's name: the teams they held and WHEN they held them, then every team's
   General % month by month -- the GMO sheet for one person, with Excel beside the (x). A month
   they did not hold the team is blank, not zero. */
function anLeader_(el){
  var id = el.getAttribute('data-tap-id');
  var d = S.anData;
  if (!id || !d) return;
  var L = d.leaders || { roles: [], all: [] }, row = null, label = 'Everyone';
  (L.roles || []).forEach(function(sec){ (sec.rows || []).forEach(function(r){ if (!row && r.id === id) { row = r; label = sec.label; } }); });
  if (!row) (L.all || []).forEach(function(r){ if (!row && r.id === id) { row = r; label = 'any role'; } });
  if (!row) return;
  var month = S.args.month || '';
  var byKey = {}; (d.teams || []).forEach(function(t){ byKey[t.key] = t; });
  var avg_ = function(v){ v = v.filter(function(x){ return x != null; }); return v.length ? Math.round(v.reduce(function(s, x){ return s + Number(x); }, 0) / v.length * 10) / 10 : null; };
  var rows = [];
  (row.stints || []).forEach(function(st){
    var t = byKey[st.key]; if (!t) return;
    var yms = month ? st.months.filter(function(ym){ return ym === month; }) : st.months;
    if (!yms.length) return;
    var cs = yms.map(function(ym){ return t.m[ym]; }).filter(Boolean);
    rows.push({ team: st.team, held: anRange_(yms), months: yms.length,
      sales: cs.reduce(function(s, c){ return s + (Number(c.sales) || 0); }, 0), loans: cs.reduce(function(s, c){ return s + (Number(c.loans) || 0); }, 0),
      salesPct: avg_(cs.map(function(c){ return c.salesPct; })), ecolPct: avg_(cs.map(function(c){ return c.ecolPct; })),
      colPct: avg_(cs.map(function(c){ return c.colPct; })), recPct: avg_(cs.map(function(c){ return c.recPct; })), general: avg_(cs.map(function(c){ return c.general; })) });
  });
  rows.sort(function(a, b){ return (b.general == null ? -1 : b.general) - (a.general == null ? -1 : a.general); });
  var src = month ? row.m[month] : row;
  var cols = [{ key: 'team', label: 'Timu / Team', nameCol: true }, col('held', 'Alishika / Held'), col('months', 'Miezi / Months', 'num'), col('sales', 'Mauzo / Sales', 'money'), col('loans', 'Count', 'num'),
    col('salesPct', 'Sales %', 'pct'), col('ecolPct', 'Early col %', 'pct'), col('colPct', 'Collection %', 'pct'), col('recPct', 'Recovery %', 'pct'),
    { key: 'general', label: 'General %', kind: 'pct', avgKey: 'general' }];
  var tot = { team: '', held: '', months: month ? (src ? 1 : 0) : row.months, sales: src ? src.sales : null, loans: rows.reduce(function(s, r){ return s + (Number(r.loans) || 0); }, 0),
    salesPct: src ? src.salesPct : null, ecolPct: src ? src.ecolPct : null, colPct: src ? src.colPct : null, recPct: src ? src.recPct : null, general: src ? src.general : null };
  var period = month ? anYmLabel_(month) : 'mwaka / year ' + d.year;
  BOARDS.an_leader = { title: row.name + ' · ' + label + ' · ' + (month ? anYmLabel_(month) : d.year), rows: rows, cols: cols };
  var html = '<h3>' + esc(row.name) + ' <span class="chip ok">' + esc(label) + '</span> <span class="chip">' + esc(period) + '</span></h3>'
    + '<div class="mut" style="font-size:12px;margin-bottom:8px">' + esc(rows.length) + ' timu / teams · kila mwezi ni wastani wa timu alizoshika mwezi huo / each month is the average of the teams held that month · JUMLA = kiongozi / the leader</div>'
    + tableSimple(rows, cols, tot);
  if (!month) {
    var had = (d.months || []).filter(function(m){ return m.state !== 'future'; });
    var xcols = [{ key: 'team', label: 'Timu / Team' }];
    had.forEach(function(m){ xcols.push({ key: 'm' + m.ym.slice(5, 7), label: AN_MON[Number(m.ym.slice(5, 7)) - 1], kind: 'pct', title: anYmLabel_(m.ym) }); });
    xcols.push({ key: 'year', label: 'Mwaka / Year', kind: 'pct', avgKey: 'year' });
    var xrows = (row.stints || []).map(function(st){
      var t = byKey[st.key], o = { team: st.team, year: null };
      if (!t) return o;
      had.forEach(function(m){ var c = st.months.indexOf(m.ym) >= 0 ? t.m[m.ym] : null; o['m' + m.ym.slice(5, 7)] = c ? c.general : null; });
      o.year = avg_(st.months.map(function(ym){ return t.m[ym] ? t.m[ym].general : null; }));
      return o;
    });
    var xtot = { team: '', year: row.general };
    had.forEach(function(m){ xtot['m' + m.ym.slice(5, 7)] = row.m[m.ym] ? row.m[m.ym].general : null; });
    html += '<h4 style="margin:12px 0 6px">General % kwa mwezi / by month</h4>' + tableSimple(xrows, xcols, xtot);
  }
  drawer(html, { wide: true, xls: 'an_leader' });
}

VIEWS.annual = function(){
  var year = S.args.year || todayKeyClient().slice(0, 4);
  var rep = S.args.rep || 'teams';
  return srv('annual', { year: year }).then(function(d){
    S.anData = d;
    S.args.year = String(d.year);
    var month = S.args.month || '';
    if (month && month.slice(0, 4) !== String(d.year)) { month = ''; S.args.month = ''; }
    HEAD = anBar_(d, rep, month) + anSources_(d)
      + (d.notes || []).map(function(n){ return '<div class="note">' + esc(n) + '</div>'; }).join('');
    if (rep === 'months') anMonths_(d, S.args.metric || 'salesPct');
    else if (rep === 'leaders') anLeaders_(d, month);
    else anTeams_(d, month);
    HEAD += '<div class="mut" style="font-size:11.5px;margin:8px 0">' + esc(d.rule || '') + '</div>';
    ONROW = null;
  });
};
