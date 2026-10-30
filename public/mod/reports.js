/* reports -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/reports.js?v=BUILD. */

/* =====================================================================================
   THE MONTH REPORT -- "i wish like a chip to open a monthly report that shows the 4 weeks
   summaries progress and summary".
   One row per week of the CALENDAR month (a month opening midweek gets a short first week
   rather than borrowing days from the month before), sales / collection / recovery on each,
   the movement against the week before beside each figure, and the month's totals in the
   cards and the footer. The table engine gives search, sort, Excel and JPG for free, which
   is the point -- this is the report that goes to the WhatsApp groups. */
/* =====================================================================================
   GOOD AND BAD PERFORMING TEAMS, WEEK BY WEEK.

     "GM needs monthly Good and Bad performing teams trend by sales, collection and recovery
      ... sales progress by weeks with columns: Team, w1%, w2%, w3%... Avrg% (autosorted by
      general high to low but in the trend if a week had a drop then format values red if
      constant black if rising leave black if over target set = green)"

   Three boards, one per metric, off the MONTH REPORT'S OWN ANSWER -- the same call the
   dashboard's dot makes, so opening this a moment later costs nothing (the server holds that
   answer for a minute per team-set) and the two screens cannot print two different figures
   for the same week.

   THE COLOURS ARE THE REPORT. Sorted best-average-first, a director reads down the Avrg
   column for the ranking and ACROSS a row for the direction: a red cell is a week that fell
   below the one before it, green is a week at or over target, black is holding or climbing.
   ===================================================================================== */
/* One cell's colour. The drop is measured against the last week that HAD a figure -- comparing
   against a blank week would paint a team red for a week nobody uploaded. */
function trendCellCls_(weeks, i, target){
  return function(r){
    var v = r[weeks[i].key];
    if (v == null || v === '') return '';
    var tg = targetOf_({ target: target });
    if (tg != null && Number(v) >= tg) return 'good';
    for (var j = i - 1; j >= 0; j--){
      var p = r[weeks[j].key];
      if (p == null || p === '') continue;
      return Number(v) < Number(p) ? 'bad' : '';
    }
    return '';                                   // the first measured week has nothing to fall from
  };
}

/* The last two measured weeks as one mark: which way this team is going, whatever its average.
   A team can average well and still be sliding, and that is the pair of facts the GM asked to
   see side by side. */
function trendDir_(weeks){
  return function(r){
    var got = [];
    for (var i = 0; i < weeks.length; i++){
      var v = r[weeks[i].key];
      if (v != null && v !== '') got.push(Number(v));
    }
    if (got.length < 2) return '';
    var d = got[got.length - 1] - got[got.length - 2];
    return d > 0 ? '▲' : (d < 0 ? '▼' : '▬');
  };
}

function trendCols_(weeks, target){
  var cols = [col('team', 'Timu / Team'), col('branch', 'Branch')];
  weeks.forEach(function(w, i){
    cols.push({ key: w.key, label: w.key + ' %', kind: 'pct', noAuto: true,
      title: w.from + ' → ' + w.to + (w.started ? '' : ' · bado / not yet'),
      cls: trendCellCls_(weeks, i, target) });
  });
  cols.push({ key: 'avg', label: 'Wastani / Avrg %', kind: 'pct', noAuto: true,
    title: 'wastani wa wiki zilizopimwa / the mean of the weeks that were measured',
    cls: function(r){
      var tg = targetOf_({ target: target });
      return (r.avg != null && tg != null && Number(r.avg) >= tg) ? 'good' : '';
    } });
  cols.push({ key: 'dir', label: 'Mwelekeo', title: 'wiki 2 za mwisho zilizopimwa / the last two measured weeks',
    get: trendDir_(weeks),
    cls: function(r){
      var m = trendDir_(weeks)(r);
      return m === '▲' ? 'good' : (m === '▼' ? 'bad' : '');
    } });
  return cols;
}

VIEWS.teamtrend = function(){
  return srv('monthReport', { weekOf: S.args.weekOf || '' }).then(function(d){
    var tt = d.teamTrend || { weeks: [], sales: [], collection: [], recovery: [] };
    var weeks = tt.weeks || [];
    /* WHAT THE GREEN MEANS, SAID OUT LOUD. Sales is measured against the team's own weekly
       target, so 100% IS the target; collection and recovery are measured against the
       percentage targets in Settings, and where one has not been set there is no green on
       that board at all -- better a board with no green than a green nobody can account for. */
    var tgCol = targetOf_({ target: 'col' }), tgRec = targetOf_({ target: 'rec' });
    var legend = function(tg, what){
      return '<div class="note">Kijani / green = ' + (tg == null
          ? '<b>lengo halijawekwa</b> — weka <b>' + esc(what) + '</b> kwenye Settings ili kuona kijani.'
            + ' / no target set yet — set <b>' + esc(what) + '</b> in Settings to get greens on this board.'
          : 'imefika lengo la <b>' + pct(tg) + '</b> / at or over the <b>' + pct(tg) + '</b> target.')
        + ' Nyekundu / red = imeshuka kuliko wiki iliyopita / lower than the week before.'
        + ' Nyeusi / black = imeshikilia au inapanda / holding or climbing.</div>';
    };
    var counted = function(rows, tg){
      if (tg == null) return null;
      return rows.filter(function(r){ return r.avg != null && r.avg >= tg; }).length;
    };
    var sliding = function(rows){
      var f = trendDir_(weeks);
      return rows.filter(function(r){ return f(r) === '▼'; }).length;
    };
    HEAD = weekBar(d, '<button class="pill" data-go="weekly" data-carry="weekOf" style="margin-left:8px">← Weekly Report</button>'
        + '<button class="pill" data-go="monthreport" data-carry="weekOf" style="margin-left:8px">Ripoti ya Mwezi / Month Report</button>')
      + '<div class="kpis">'
      + kpi('Mwezi / Month', esc(d.month), esc(d.monthStart) + ' → ' + esc(d.monthEnd)
            + ' · hadi / so far: ' + esc(d.asOfDate) + ' · ' + money(weeks.filter(function(w){ return w.started; }).length) + ' wiki')
      + kpi('Timu / Teams', money((tt.sales || []).length), 'kila timu unayoiona / every team you hold')
      + kpi('Mauzo ≥ lengo', money(counted(tt.sales || [], 100)),
            'wastani wa mwezi umefika lengo la wiki / month average at or over the weekly target', 'good')
      + kpi('Zinashuka / Sliding', money(sliding(tt.sales || []) + sliding(tt.collection || []) + sliding(tt.recovery || [])),
            'safu zilizoshuka wiki ya mwisho (bodi zote 3) / rows down on the last measured week, all three boards', 'warnc')
      + '</div>'
      + (d.ledgerReady ? '' : '<div class="note">Hesabu za makusanyo na urejeshaji bado zinajazwa — fungua tena baada ya dakika moja.'
          + ' / The collection & recovery ledger is still filling — open this again in a minute; sales are already exact.</div>')
      + (weeks.length
          ? board('ttSales', 'Mauzo / Sales · ' + esc(d.month),
              'kila wiki dhidi ya lengo la timu (TZS ' + money(tt.weeklyTarget) + '/wiki) / each week against the team’s own weekly target',
              tt.sales || [], trendCols_(weeks, 'sales'), false)
            + legend(100, 'SALES_TARGET_WEEKLY')
            + board('ttCol', 'Makusanyo / Collection · ' + esc(d.month),
              'yaliyokusanywa dhidi ya yaliyotarajiwa, wiki kwa wiki / collected over expected, week by week',
              tt.collection || [], trendCols_(weeks, 'col'), false)
            + legend(tgCol, 'TARGET_COL_PCT')
            + board('ttRec', 'Urejeshaji / Recovery · ' + esc(d.month),
              'kilichorejeshwa dhidi ya kisichokusanywa, siku zilizooanishwa tu / recovered over uncollected, paired days only',
              tt.recovery || [], trendCols_(weeks, 'rec'), false)
            + legend(tgRec, 'TARGET_REC_PCT')
          : '<div class="msg">—</div>')
      /* A BLANK IS NOT A ZERO, and on a board people are ranked on that distinction has to be
         written down where they read it. */
      + '<div class="note">Nafasi tupu = haikupimwa wiki hiyo (hakuna karatasi au hakuna kitabu kilichooanishwa) —'
      + ' si sifuri. Wastani hupiga hesabu ya wiki zilizopimwa tu.'
      + ' / An empty cell means that week was not measured (no sheet, or no paired deck) — never a zero.'
      + ' The average covers only the weeks that were measured.</div>';
    S.rows = [];
    S.cols = [];
    ONROW = null;
  });
};

VIEWS.monthreport = function(){
  return srv('monthReport', { weekOf: S.args.weekOf || '', teams: teamPickLoad_() }).then(function(d){
    var t = d.totals || {};
    var rows = d.rows || [];
    /* WASTANI / AVERAGE, over the weeks that have actually happened -- an average that
       divides by weeks still in the future would flatter nobody and mislead everybody. */
    var started = rows.filter(function(r){ return r.started; });
    var nWk = Math.max(started.length, 1);
    var avgOf = function(k){ return Math.round(started.reduce(function(s,r){ return s + (Number(r[k])||0); }, 0) / nWk); };
    // The latest week that has actually happened -- its deltas are the month's direction.
    var last = started.length ? started[started.length - 1] : null;
    /* The movement, drawn small beside the figure it belongs to -- green up, red down, the
       direction a WhatsApp picture is scanned for. */
    var mv = function(v, isPct){
      if (v == null || !v) return '';
      return ' <span class="' + (v>0?'good':'bad') + '" style="font-size:10px;font-weight:700">'
        + (v>0?'▲':'▼') + (isPct ? Math.round(Math.abs(v))+'%' : money(Math.abs(v))) + '</span>';
    };
    var mmdd = function(k){ return k.slice(8) + '/' + k.slice(5,7); };
    var cells = rows.map(function(r){
      var head = 'WIKI ' + r.week + ' · ' + mmdd(r.from) + '–' + mmdd(r.to);
      if (!r.started) return tcell(head, [['—','mutl'],['bado / not yet','mutl']], 'pend');
      var live = r.from <= d.asOfDate && d.asOfDate <= r.to;
      return tcell(head + (live ? ' · SASA' : ''), [
        ['<b>TZS ' + money(r.sales) + '</b>' + mv(r.dSales)],
        [money(r.loans) + ' loans', 'mutl'],
        [r.expected != null
            ? 'Col TZS ' + money(r.collected) + ' · <b>' + pct(r.colPct) + '</b>' + mv(r.dColPct, true)
            : 'Col — bado', r.expected != null ? '' : 'mutl'],
        [r.recovered != null
            ? 'Rec TZS ' + money(r.recovered) + ' · <b>' + pct(r.recPct) + '</b>' + mv(r.dRecPct, true)
            : 'Rec — bado', r.recovered != null ? '' : 'mutl'],
        ['Perf <b>' + pct(r.perf) + '</b>' + mv(r.dPerf, true), 'mutl'],
        ['<span class="mrbar"><i style="width:' + Math.max(0, Math.min(100, r.colPct||0)) + '%"></i></span>'],
      ], live ? 'now' : '');
    });
    var totCell = tcell('JUMLA / TOTAL', [
      ['<b>TZS ' + money(t.sales) + '</b>'],
      [money(t.loans) + ' loans' + (t.monthTarget>0 ? ' · ' + pct(t.salesPct) + ' ya lengo' : ''), 'mutl'],
      [t.collected != null ? 'Col TZS ' + money(t.collected) + ' · <b>' + pct(t.colPct) + '</b>' : 'Col —', 'mutl'],
      [t.recovered != null ? 'Rec TZS ' + money(t.recovered) + ' · <b>' + pct(t.recPct) + '</b>' : 'Rec —', 'mutl'],
      ['Perf <b>' + pct(t.perfPct) + '</b>', 'mutl'],
      ['<span class="mrbar"><i style="width:' + Math.max(0, Math.min(100, t.colPct||0)) + '%"></i></span>'],
    ], 'tot');
    /* The average of a percentage only counts the weeks that HAVE one -- a week whose ledger
       is still empty would drag the average toward zero and read as a collapse. */
    var avgPctOf = function(k){
      var xs = started.map(function(r){ return r[k]; }).filter(function(v){ return v != null; });
      if (!xs.length) return null;
      return Math.round(xs.reduce(function(s, v){ return s + Number(v); }, 0) / xs.length);
    };
    var aSales = avgPctOf('salesPct'), aCol = avgPctOf('colPct'), aRec = avgPctOf('recPct');
    /* "still has no percentages": the SAME card shape as every week's -- amount, then the
       percentage in bold, then the bar -- so the month summary reads exactly like the week
       summaries beside it. */
    var avgCell = tcell('WASTANI / AVERAGE', [
      ['<b>TZS ' + money(avgOf('sales')) + '</b> / wiki' + (aSales != null ? ' · <b>' + pct(aSales) + '</b>' : '')],
      [(Math.round((Number(t.loans)||0) / nWk * 10) / 10) + ' loans / wiki', 'mutl'],
      [d.ledgerReady
          ? 'Col TZS ' + money(avgOf('collected')) + ' / wiki' + (aCol != null ? ' · <b>' + pct(aCol) + '</b>' : '')
          : 'Col —', 'mutl'],
      [d.ledgerReady
          ? 'Rec TZS ' + money(avgOf('recovered')) + ' / wiki' + (aRec != null ? ' · <b>' + pct(aRec) + '</b>' : '')
          : 'Rec —', 'mutl'],
      ['Perf ~<b>' + pct(avgOf('perf')) + '</b> / wiki', 'mutl'],
      ['<span class="mrbar"><i style="width:' + Math.max(0, Math.min(100, aCol||0)) + '%"></i></span>'],
    ], 'tot');
    var c = d.cards || {};
    /* THE MONTHLY CARDS -- "the monthly cards for csagents loan apps, credit analysts, early
       col, col and rec": what the call agents brought in, what the analysts sold, and the
       three collection percentages, month to date. Null carries the same meaning it does on
       the dashboard tiles: the ledger is still filling -- a dash, never a month of zeros. */
    HEAD = weekBar(d, '<button class="pill" data-go="dashboard" data-carry="weekOf,teams" style="margin-left:8px">← Dashibodi / Dashboard</button>' + teamPick_(d))
      + (d.recoveryNote ? '<div class="note">' + esc(d.recoveryNote) + '</div>' : '')
      + '<div class="kpis">'
      + kpi('Mwezi / Month', esc(d.month), esc(d.monthStart)+' → '+esc(d.monthEnd)+' · hadi / so far: '+esc(d.asOfDate))
      + kpi('Maombi ya mikopo / Loan apps', money(c.apps), 'CS agents · yaliyoletwa mwezi huu / brought in this month')
      + kpi('Credit analysts · Sales', money(t.sales),
            (t.monthTarget>0 ? pct(t.salesPct)+' of '+money(t.monthTarget)+' · ' : '') + money(t.loans)
              + ' loans · wastani TZS '+money(avgOf('sales'))+'/wiki', 'good')
      + (c.ecolPct != null
          ? kpi('Early col % · mwezi', pct(c.ecolPct), 'karatasi ya awali / the initial sheets, month to date')
          : kpi('Early col % · mwezi', '—', 'haipatikani bado / not available yet'))
      + (t.expected != null
          ? kpi('Col % · mwezi', pct(t.colPct),
                'TZS '+money(t.collected)+' of '+money(t.expected)+' · wastani TZS '+money(avgOf('collected'))+'/wiki', 'good')
          : kpi('Col % · mwezi', '—', 'haipatikani bado / not available yet'))
      + (t.recovered != null
          ? kpi('Rec % · mwezi', pct(t.recPct),
                'TZS '+money(t.recovered)+' of '+money(t.uncollected)+' uncollected · wastani TZS '+money(avgOf('recovered'))+'/wiki', 'good')
          : kpi('Rec % · mwezi', '—', 'haipatikani bado / not available yet'))
      + '</div>'
      /* The month's own performance strip: the same three percentages and their average,
         with the arrows reading the LATEST week against the one before it -- the direction
         the month is moving right now. */
      + '<div class="kpis sm" style="margin-top:8px">'
      + kpi('Sales %', pct(t.salesPct) + trendArrow(last && last.dSalesPct), trendSub(last && last.dSalesPct, 'wiki 2 za mwisho / last two weeks'))
      + kpi('Collection %', pct(t.colPct) + trendArrow(last && last.dColPct), trendSub(last && last.dColPct, 'wiki 2 za mwisho / last two weeks'))
      + kpi('Recovery %', pct(t.recPct) + trendArrow(last && last.dRecPct), trendSub(last && last.dRecPct, 'wiki 2 za mwisho / last two weeks'))
      + kpi('Performance · wastani', pct(t.perfPct) + trendArrow(last && last.dPerf), avgSub(last && last.dPerf, t.perfOn, 'wiki 2 za mwisho / last two weeks'))
      + '</div>'
      + (d.ledgerReady ? '' : '<div class="note">Hesabu za makusanyo na urejeshaji bado zinajazwa'
          + ' — fungua tena baada ya dakika moja. / The collection & recovery ledger is still'
          + ' filling — open this again in a minute; sales are already exact.</div>')
      /* THE PICTURE FOR THE GROUPS: week 1 to the last as tiles, the live week ringed, the
         month's TOTAL and the per-week AVERAGE closing the grid -- with trendGrid's own JPG
         button on the card, so this one card is the download. The full sortable table stays
         below for search, Excel and the row-by-row detail. */
      + trendGrid('Wiki kwa wiki / Week by week · ' + d.month,
          'sales · collection · recovery kwa kila wiki · ▲▼ dhidi ya wiki iliyopita / vs the week before',
          'gMonth', cells, totCell + avgCell);
    /* The movement column: this week against the LAST week that had figures. Green up, red
       down -- the direction somebody scans a WhatsApp picture for. */
    var dcol = function(key, label, fmt){ return { key:key, label:label, kind:'text',
      get: function(r){ var v = r[key]; if (v==null) return '';
        return v ? (v>0 ? '▲ +' : '▼ −') + fmt(Math.abs(v)) : '0'; },
      cls: function(r){ var v = r[key]; return v>0 ? 'good' : (v<0 ? 'bad' : ''); } }; };
    /* The week-by-week table is a board of its own now (with its Excel and JPG), because the
       main list below became the leaders. */
    var weekCols = [
      col('week','Wiki','num'),
      col('from','Kuanzia / From','date'),
      col('to','Hadi / To','date'),
      col('sales','Sales','money'),
      col('loans','Loans','num'),
      col('salesPct','Sales %','pct'),
      dcol('dSales','± Sales', function(v){ return money(v); }),
      col('expected','Expected','money'),
      col('collected','Collected','money'),
      col('colPct','Col %','pct'),
      dcol('dColPct','± Col %', function(v){ return Math.round(v)+'%'; }),
      col('uncollected','Uncollected','money'),
      {key:'recovered', label:'Recovered', kind:'money', cls:function(r){ return r.recovered>0?'good':''; }},
      col('recPct','Rec %','pct'),
      dcol('dRecPct','± Rec %', function(v){ return Math.round(v)+'%'; }),
      col('perf','Perf %','pct'),
      dcol('dPerf','± Perf', function(v){ return Math.round(v)+'%'; }),
    ];
    /* "2026-08 has no grand totals" -- the week table's JUMLA row is the MONTH's own figures,
       the exact ones the cards carry, not a sum of week rows (a percentage cannot be summed and
       a month's target is not four quarters added back up). */
    var weekTot = { week: null, sales: t.sales, loans: t.loans, salesPct: t.salesPct,
      expected: t.expected, collected: t.collected, colPct: t.colPct,
      uncollected: t.uncollected, recovered: t.recovered, recPct: t.recPct, perf: t.perfPct };
    /* "monthly loan application report before the all leaders chip" -- what the call agents
       brought in this month, by the day the admin chose for each report, whatever stage each
       application has reached since. */
    var ag = d.agents || {};
    HEAD += board('mrWeeks', 'Wiki kwa wiki / Week by week — jedwali / table', d.month, rows, weekCols, weekTot)
      + board('mrAgents', 'Maombi ya mikopo / Loan applications — mwezi huu / this month',
          'CS agents · TRACK# reads 1 · roster agents only · kwa siku ya ripoti / by the report\'s day · ' + money(ag.total || 0) + ' apps',
          ag.rows || [],
          [{key:'id', label:'Agent'},
           {key:'names', label:'Who', cls:function(r){ return r.names?'':'bad'; },
            get:function(r){ return r.names || 'not named — add in Teams & Staff'; }},
           col('total','Apps','num'), col('unassigned','Unassigned','num'), col('assigned','Assigned','num'),
           col('advanced','Approved+','num'), col('amount','Requested','money')],
          ag.totals ? Object.assign({ id:'', names:'' }, ag.totals) : undefined)
      + csExcludedNote(ag.excluded)
      /* The role filter narrows the leaders list below, the same way a team filter narrows
         any other list. */
      + bar('<select data-filter="role"><option value="">Nafasi zote / All roles</option>'
          + (d.leaderRoles||[]).map(function(x){
              return '<option'+(S.filters.role===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('') + '</select>'
          + '<span class="chip">'+money((d.leaders||[]).length)+' viongozi / leaders</span>');
    /* THE LEADERS, CHIPPED. "then list of leaders and columns of sales, early col, col, rec and
       avrg performance where average performance gives the best one by auto sort largest to
       smallest averg % ... role column, name ... This is a chipped list of all leaders in the
       system". Best first from the server; the headers still sort; the colour rule paints a
       name red when its average is under the line. */
    S.rows = d.leaders || [];
    S.cols = [
      col('role','Nafasi / Role'),
      col('name','Jina / Name'),
      col('teams','Timu / Teams','num'),
      {key:'salesPct', label:'Sales %', kind:'pct', title:'Mauzo ya mwezi ÷ lengo (wiki × 4 kwa kila timu) / month sales ÷ weekly target × 4 per team'},
      {key:'ecolPct', label:'Early col %', kind:'pct', title:'Karatasi ya awali, mwezi huu / initial sheets, month to date'},
      {key:'colPct', label:'Col %', kind:'pct', title:'Makusanyo ya siku, mwezi huu / day collection, month to date'},
      {key:'recPct', label:'Rec %', kind:'pct', title:'Kilichorejeshwa ÷ kisichokusanywa, mwezi huu / recovered ÷ uncollected, month to date'},
      {key:'avgPct', label:'Wastani / Avg %', kind:'pct', title:'Wastani wa asilimia zilizopimwa / average of the percentages measured'},
    ];
    S.foldMain = 'mrleaders';
    S.foldLabel = 'Viongozi wote / All leaders — mwezi huu / this month, best first';
    ONROW = null;
    S.foot = 'JUMLA / TOTAL · Sales TZS '+money(t.sales)+' ('+money(t.loans)+' loans)'
      + (t.collected!=null ? ' · Collected TZS '+money(t.collected)+' of '+money(t.expected)
          +(t.colPct!=null?' ('+pct(t.colPct)+')':'') : '')
      + (t.recovered!=null ? ' · Recovered TZS '+money(t.recovered)
          +(t.recPct!=null?' ('+pct(t.recPct)+')':'') : '')
      + ' — WASTANI/wiki: Sales TZS '+money(avgOf('sales'))+(aSales!=null?' ('+pct(aSales)+')':'')
      + (d.ledgerReady
          ? ', Col TZS '+money(avgOf('collected'))+(aCol!=null?' ('+pct(aCol)+')':'')
            +', Rec TZS '+money(avgOf('recovered'))+(aRec!=null?' ('+pct(aRec)+')':'')
          : ' · M. bado zinajaza / month columns still filling');
  });
};

/* PAR reads two ways and the meeting uses both: how OLD the arrears are, and how BIG the
   loans behind them are. The second is what gets acted on -- it says where the overdue money
   is concentrated -- so it leads. */
/* AND THE ALL-TIME PAR: today's deck is every defaulter there is, so its arrears over the TOTAL
   LOAN (P+I) of everything the team was ever lent, from the loans table, is the team's all-time
   PAR; the grand total is the company's. The total loan column, never the principal. */
VIEWS.par = function(){
  return srv('par').then(function(d){
    var t = d.totals, at = d.allTime || {};
    HEAD = '<div class="kpis">'
      + kpi('At-risk arrears', money(t.arrears), 'overdue across defaulters', 'bad')
      + kpi('Outstanding balance', money(t.balance), 'remaining portfolio in default')
      + kpi('Portfolio at risk', pct(t.par), 'arrears ÷ outstanding balance',
            (t.par>=50?'bad':(t.par>=25?'warnc':'')))
      + kpi('PAR all-time', t.parAll == null ? '—' : pct(t.parAll),
            'arrears ÷ total loan (P+I) ever lent: TZS ' + money(at.totalLoan) + ' on ' + money(at.loans) + ' loans' + (at.since ? ' since ' + at.since : ''),
            (t.parAll>=10?'bad':(t.parAll>=5?'warnc':'')))
      + kpi('Defaulters', money(t.customers), d.weekday+' · '+(d.date||''))
      + kpi('Average principal', money(t.avgLoan), 'mean principal in default (interest stripped)')
      + '</div>'
      + (at.note ? '<div class="note">' + esc(at.note) + '</div>' : '')
      + board('pBand','Kwa ukubwa wa mkopo / By principal band','where the overdue money sits by loan size', d.byBand,
          [col('band','Band (principal)'), col('customers','Defaulters','num'), col('avgLoan','Avg principal','money'),
           {key:'arrears', label:'Arrears', kind:'money', cls:function(){ return 'bad'; }},
           col('balance','Balance','money'), {key:'par', label:'PAR %', kind:'pct', lowGood:true}, {key:'share', label:'Share of arrears', kind:'pct', lowGood:true}],
          {customers:t.customers, arrears:t.arrears, balance:t.balance, avgLoan:t.avgLoan, par:t.par, share:100})
      + board('pAge','Kwa muda / By days in arrears','how long each customer has been overdue', d.bands,
          [col('band','Days'), col('customers','Customers','num'), col('arrears','Arrears','money')],
          sumRow(d.bands, ['customers','arrears']))
      + board('pStat','Kwa hali / By status', null, d.byStatus,
          [col('status','Status'), col('customers','Customers','num'), col('arrears','Arrears','money')],
          sumRow(d.byStatus, ['customers','arrears']));
    S.rows = d.byTeam;
    S.cols = [col('branch','Branch'), col('team','Team'), col('customers','Defaulters','num'), col('avgLoan','Avg principal','money'),
      {key:'arrears', label:'Arrears', kind:'money', cls:function(){ return 'bad'; }},
      col('balance','Balance','money'), {key:'par', label:'PAR %', kind:'pct', lowGood:true},
      col('loans','Loans all-time','num'), col('totalLoan','Total loan all-time (P+I)','money'),
      {key:'parAll', label:'PAR all-time %', kind:'pct', lowGood:true, title:'Arrears ya leo ÷ jumla ya mikopo (P+I) iliyowahi kutolewa kwa timu / today\'s arrears over everything ever lent to the team'}];
    ONROW = null;
    S.foot = 'Defaulters: '+money(t.customers)+' · Arrears: TZS '+money(t.arrears)+' · PAR: '+pct(t.par)
      + ' · Total loan all-time: TZS '+money(t.totalLoan)+' ('+money(t.loans)+' loans) · PAR all-time: '+(t.parAll == null ? '—' : pct(t.parAll));
  });
};

/* THE AUDIT REPORT PANEL. One month, the questionnaire's sections in its order, every figure
   from the server's auditReport (see its note in portal-core.js). The customer list behind the
   month's own cohort is the tab's Orodha, so Excel/CSV export it as any other list. */
VIEWS.auditrep = function(){
  var m = S.args.month || todayKeyClient().slice(0, 7);
  return srv('auditReport', { month: m }).then(function(d){
    var thisM = todayKeyClient().slice(0, 7);
    var c0 = d.cohorts[0] || {}, c1 = d.cohorts[1] || {};
    var pc = function(v){ return v == null ? '—' : pct(v); };
    var mo = function(v){ return v == null ? '—' : money(v); };
    var sales = d.sales || {}, colx = d.collection || {}, rec = d.recovery || {};
    HEAD = bar('<label style="font-size:12px;color:var(--mut)">Mwezi wa ukaguzi / Audit month</label>'
        + '<button class="btn sm ghost" data-arg="month" data-val="' + esc(addMonths(m, -1)) + '">&#9664;</button>'
        + '<input type="month" data-arg="month" value="' + esc(m) + '">'
        + '<button class="btn sm ghost" data-arg="month" data-val="' + esc(addMonths(m, 1)) + '">&#9654;</button>'
        + '<span class="chip ' + (d.live ? 'warn' : 'mut') + '">' + (d.live ? 'Mwezi unaendelea / live month' : 'Mwezi umeisha / finished month')
          + ' &middot; as at ' + esc(d.asAt) + ' &middot; deck ' + esc(d.deckDate || '—') + '</span>'
        + (m === thisM ? '' : ' <button class="btn sm ghost" data-arg="month" data-val="' + esc(thisM) + '">Rudi mwezi huu / Back to this month</button>'))
      + (d.monthReady ? '' : '<div class="note bad">Ripoti ya mwezi haikupatikana; mauzo, collection, recovery na bonasi hazipo. / The month report could not be read; sales, collection, recovery and bonus sections are missing. Jaribu tena.</div>')
      + (d.monthReady && !d.ledgerReady ? '<div class="note">Leja ya mwezi bado inajengwa; collection na recovery zinaweza kukosekana kwa wiki za mwanzo. / The month ledger is still being built; collection and recovery may be missing for early weeks.</div>' : '')
      // 1. SALES
      + '<div class="kpis">'
      + kpi('1. Mauzo / Sales target', mo(sales.target), 'principal, weekly x 4 x teams')
      + kpi('Mauzo halisi / Actual disbursed', mo(sales.actual), (sales.loans != null ? money(sales.loans) + ' loans' : ''), (sales.pct != null && sales.pct >= 80) ? 'good' : 'bad')
      + kpi('Tofauti / Variance', mo(sales.variance), 'target − actual')
      + kpi('% Achieved', pc(sales.pct), '', (sales.pct != null && sales.pct >= 80) ? 'good' : 'bad')
      + '</div>'
      // 2. COLLECTION EFFICIENCY and RECOVERY
      + '<div class="kpis">'
      + kpi('2. Jumla ya kudaiwa / Total due', mo(colx.due), 'expected, the month’s days')
      + kpi('Kilichokusanywa / Collected', mo(colx.collected))
      + kpi('Collection efficiency', pc(colx.pct), 'collected over due', (colx.pct != null && colx.pct >= 92) ? 'good' : 'bad')
      + kpi('3. Recovery: uncollected', mo(rec.uncollected), 'arrears at the start')
      + kpi('Recovered', mo(rec.recovered), rec.target ? 'target ' + money(rec.target) + ' · variance ' + money(rec.variance) : 'no RECOVERY_TARGET_MONTHLY set', (rec.pct != null && rec.pct >= 120) ? 'good' : '')
      + kpi('Recovery %', pc(rec.pct), '', (rec.pct != null && rec.pct >= 120) ? 'good' : 'bad')
      + '</div>'
      // 4. COHORTS
      + '<div class="kpis">'
      + kpi('4. Defaulters disbursed in ' + esc(m), money(c0.customers || 0), 'customers in arrears as at ' + esc(d.asAt), 'warnc')
      + kpi('Their arrears', mo(c0.arrears))
      + kpi('Their balance', mo(c0.balance))
      + kpi('PAR (arrears / balance)', pc(c0.par), 'the PAR tab’s definition')
      + kpi('PAR > 30 days', pc(c0.par30), c0.disbursedTotal != null ? '> 30 days: ' + money(c0.over30Balance) + ' over ' + money(c0.disbursedTotal) + ' disbursed (' + money(c0.disbursedLoans) + ' loans)' : 'no disbursements of ' + esc(m) + ' in the loans table', c0.par30 == null ? '' : (c0.par30 > 5 ? 'bad' : 'good'))
      + '</div>';
    var cohortRows = d.cohorts.map(function(c){ return { month: c.month, customers: c.customers, arrears: c.arrears, balance: c.balance,
      over30Customers: c.over30Customers, over30Balance: c.over30Balance, par: c.par, disbursedLoans: c.disbursedLoans, disbursedTotal: c.disbursedTotal, par30: c.par30 }; });
    HEAD += board('auCohort', 'PAR kwa mwezi wa mkopo / PAR by disbursement month', esc(m) + ' na mwezi uliopita · as at ' + esc(d.asAt), cohortRows,
      [col('month','Disbursed in'), col('customers','Defaulters','num'), col('arrears','Arrears','money'), col('balance','Balance','money'),
       col('over30Customers','> 30 days','num'), col('over30Balance','> 30 days balance','money'), {key:'par', label:'PAR', kind:'pct', from:['arrears','balance']},
       col('disbursedLoans','Loans disbursed','num'), col('disbursedTotal','Disbursed (P+I)','money'), {key:'par30', label:'PAR > 30', kind:'pct', from:['over30Balance','disbursedTotal']}], false);
    HEAD += board('auCohortTeam', 'Timu: waliokopa ' + esc(m) + ' walio na madeni / ' + esc(m) + ' cohort by team', 'balance kubwa kwanza', c0.byTeam || [],
      [col('team','Team'), col('customers','Defaulters','num'), col('arrears','Arrears','money'), col('balance','Balance','money'), col('over30','> 30 days balance','money'), {key:'par', label:'PAR', kind:'pct', from:['arrears','balance']}]);
    HEAD += board('auCohortStatus', 'Hali ya waliokopa ' + esc(m) + ' / ' + esc(m) + ' cohort by status', '', c0.byStatus || [],
      [col('status','Status'), col('customers','Customers','num'), col('arrears','Arrears','money'), col('balance','Balance','money')]);
    // 5. AGING
    HEAD += '<div class="kpis">'
      + kpi('5. Kitabu chote / Whole book as at ' + esc(d.asAt), money(d.book.customers), 'customers in arrears')
      + kpi('Arrears', mo(d.book.arrears)) + kpi('Balance', mo(d.book.balance))
      + kpi('PAR > 30 days, whole book', pc(d.book.par30), '> 30 days balance ' + money(d.book.over30Balance) + ' over the book’s balance')
      + kpi('Chronic (> 90 days)', money(d.book.chronic), 'balance ' + money(d.book.chronicBalance), 'warnc')
      + '</div>';
    HEAD += board('auAging', 'Aging ya madeni / Aging of overdue loans', 'as at ' + esc(d.asAt) + ' · the auditor’s buckets', d.aging,
      [col('bucket','Days overdue'), col('customers','# Clients','num'), col('arrears','Arrears','money'), col('balance','Outstanding balance','money')]);
    HEAD += board('auParTeam', 'PAR kwa timu / PAR per team', 'kitabu chote as at ' + esc(d.asAt) + ' · arrears kubwa kwanza', d.bookByTeam || [],
      [col('team','Team'), col('branch','Branch'), col('customers','Customers','num'), col('arrears','Arrears','money'), col('balance','Balance','money'),
       {key:'par', label:'PAR', kind:'pct', from:['arrears','balance']}, col('over30','> 30 days balance','money'), {key:'par30', label:'PAR > 30', kind:'pct', from:['over30','balance']},
       col('chronic','Chronic','num'), {key:'share', label:'% of arrears', kind:'pct', from:['arrears','arrears']}]);
    // 6. TOP / BOTTOM
    var tb = function(id, title, r, key, label){
      var rows = (r.top || []).map(function(x){ return { ...x, end: 'Top' }; }).concat((r.bottom || []).map(function(x){ return { ...x, end: 'Bottom' }; }));
      return board(id, title, (r.teams || 0) + ' teams measured · monthly average of the weeks', rows,
        [{key:'end', label:'', kind:'chip', chip:function(x){ return x.end === 'Top' ? 'ok' : 'bad'; }}, col('team','Team'), col('branch','Branch'), {key:'avg', label: label, kind:'pct'}, col('on','Weeks','num')], false);
    };
    HEAD += tb('auTopSales', '6. Timu bora na dhaifu: Mauzo / Sales', d.ranking.sales, 'avg', 'Sales %')
      + tb('auTopCol', 'Timu bora na dhaifu: Collection', d.ranking.collection, 'avg', 'Collection %')
      + tb('auTopRec', 'Timu bora na dhaifu: Recovery', d.ranking.recovery, 'avg', 'Recovery %');
    // 7. BONUS
    var bw = [];
    (d.bonusWeeks || []).forEach(function(w){ (w.teams || []).forEach(function(t){ bw.push({ week: w.week + ' (' + w.from + ' → ' + w.to + ')', team: t.team, sales: t.sales, collection: t.collection, recovery: t.recovery }); });
      if (!(w.teams || []).length) bw.push({ week: w.week + ' (' + w.from + ' → ' + w.to + ')', team: '— hakuna / none', sales: null, collection: null, recovery: null }); });
    HEAD += board('auBonusW', '7. Bonasi ya wiki / Weekly bonus: teams that cleared all three', 'sales ≥ ' + d.thresholds.sales + '% · collection ≥ ' + d.thresholds.col + '% · recovery ≥ ' + d.thresholds.rec + '%', bw,
      [col('week','Week'), col('team','Team'), col('sales','Sales %','pct'), col('collection','Collection %','pct'), col('recovery','Recovery %','pct')], false);
    HEAD += board('auBonusM', 'Bonasi ya mwezi / Monthly bonus: teams that cleared all three on the month', 'monthly averages', d.bonusMonth || [],
      [col('team','Team'), col('sales','Sales %','pct'), col('collection','Collection %','pct'), col('recovery','Recovery %','pct')], false);
    HEAD += board('auWeeks', 'Wiki za mwezi / The month’s weeks', 'company figures, the month report’s own', d.weeksRows || [],
      [col('week','W','num'), col('from','From','date'), col('to','To','date'), col('sales','Sales','money'), col('salesPct','Sales %','pct'), col('expected','Due','money'), col('collected','Collected','money'), col('colPct','Col %','pct'), col('uncollected','Uncollected','money'), col('recovered','Recovered','money'), col('recPct','Rec %','pct')], false);
    HEAD += '<div class="note" style="display:block">' + (d.notes || []).map(esc).join('<br>') + '</div>';
    S.rows = d.list || [];
    S.cols = [col('ref','REF#'), col('full_name','Fullname'), {key:'contact', label:'Contact#', kind:'tel'}, col('team','Team'), col('branch','Branch'), col('status','Status'),
      col('disb_date','Disb date','date'), col('days','Days','num'), col('ds','D.S'), col('arrears','Arrears','money'), col('balance','Balance','money'), col('principal','Principal','money')];
    S.foldMain = 'aulist'; S.foldLabel = 'Orodha / Defaulters disbursed in ' + m;
    ONROW = openFollowup;
    S.foot = 'Waliokopa ' + m + ' na wana madeni as at ' + d.asAt;
  });
};

/* Per-team numbers answer "how is this team doing". A leader report answers "how is this
   PERSON doing" — and most supervisors carry several teams, so their real performance is the
   roll-up across all of them. The same teams appear under a different name in each section. */
VIEWS.reports = function(){
  return srv('leaderReports', { weekOf: S.args.weekOf || '' }).then(function(d){
    S.lrData = d; lrPicksInit_(d);
    var t = d.totals;
    HEAD = weekBar(d) + (d.note ? '<div class="note">'+esc(d.note)+'</div>' : '')
      + (d.recoveryNote ? '<div class="note">' + esc(d.recoveryNote) + '</div>' : '')
      + '<div class="kpis">'
      + kpi('Teams', money(t.teams), d.weekday+' · '+(d.date||''))
      + kpi('Initial arrears', money(t.initArrears))
      + kpi('Current arrears', money(t.curArrears), null, 'bad')
      + kpi('Recovered', money(t.recovered), null, 'good')
      + '</div>'
      + (d.sections||[]).map(function(sec){
          return board('lr_'+sec.role, 'Kwa ' + sec.label + ' / By ' + sec.label,
            money(sec.rows.length) + ' named · ' + money(sec.totals.teams) + ' teams'
              + (sec.unstaffed ? ' · ' + money(sec.unstaffed) + ' with nobody named' : ''),
            sec.rows,
            [{key:'leader', label:sec.label, cls:function(r){ return r.leader==='(unassigned)'?'bad':''; }},
             col('teams','Teams','num'), col('teamList','Which teams'),
             col('initArrears','Initial','money'), col('curArrears','Current','money'),
             {key:'recovered', label:'Recovered', kind:'money', cls:function(r){ return r.recovered>0?'good':''; }},
             col('progress','Progress %','pct'), col('cleared','Cleared','num')],
            {leader:'', teams:sec.totals.teams, teamList:'',
             initArrears:sec.totals.initArrears, curArrears:sec.totals.curArrears,
             recovered:sec.totals.recovered, progress:sec.totals.progress, cleared:sec.totals.cleared});
        }).join('')
      /* THE ORODHA, behind its chip: the pickers, then a table per ticked pair. The team
         distributions above are untouched -- "leave the team distributions, just ammend
         orodha". */
      + fold_('lrsegs', 'Orodha / List — ripoti kwa kiongozi / by leader',
          money((d.segments||[]).length) + ' zinapatikana / available',
          lrPicksHtml_(d) + '<div id="lrSegs">' + lrSegsHtml_(d) + '</div>');
    S.rows = d.rows;
    S.cols = [col('branch','Branch'), col('team','Team'), col('recovery','Recovery officer'), col('gmo','GMO'), col('manager','Manager'),
      col('initArrears','Initial','money'), col('curArrears','Current','money'), col('recovered','Recovered','money'),
      col('progress','Progress %','pct'), col('initCust','Init cust','num'), col('curCust','Cur cust','num'), col('cleared','Cleared','num')];
    // The per-team list keeps its place, behind a chip of its own, so the Orodha above is the
    // leader reports and this stays available without crowding them.
    S.foldMain = 'lrteams';
    S.foldLabel = 'Timu moja moja / team by team';
    ONROW = null;
  });
};

/* Commission is earned by PEOPLE and from two different jobs: the recovery officer earns a
   PERCENTAGE of what a customer's arrears fell by, the early-collection officer earns a FLAT
   amount per client who came in PAID or OVERPAID. Both are summed day by day. Officers see
   only their own row; admins see the company. */
var CMS_COLS = [col('officer','Officer'), col('recovered','Recovered','money'),
  col('recComm','Recovery comm.','money'), col('paid','Paid','num'), col('over','Overpaid','num'),
  col('colComm','Collection comm.','money'),
  /* "orodha has no these people [PMO Collection]" -- the combined table carries all THREE
     schemes, PMO's pay in its own column. */
  col('pmoComm','PMO comm.','money'),
  {key:'total', label:'Total', kind:'money', cls:function(r){ return r.total>0?'good':''; }},
  /* "have a last colomn of their weekly performance percentage" -- scheme-aware: rec % for
     recovery officers, initial col % for early, week % for PMO. Sortable like every header. */
  col('pct','Wiki % / Weekly %','pct')];

VIEWS.commission = function(){
  /* THE WEEK IS CHOSEN HERE TOO -- "back and foward weeks in commission". The same week bar
     the dashboard and the presentation use, so a finished week's pay can be read back and an
     upcoming one previewed; the server says which week it answered for. */
  return srv('commission', { weekOf: S.args.weekOf || '' }).then(function(d){
    var noRates = !d.paidTzs && !d.overTzs;
    /* THE BLINKING DOT, exactly as the dashboard's: a quiet pulse that opens the MONTH
       record. "each commission has daily and weekly record with a blinking dot for monthly
       record as the dot in dashboard". It carries the chosen week, so a past week opens
       THAT month's record. */
    HEAD = weekBar(d, '<span class="chip mut">' + esc(d.from||'') + ' &rarr; ' + esc(d.to||'') + '</span>'
        + '<button class="syncdot" data-go="cmmonth" data-carry="weekOf" title=""></button>')
      + (d.recoveryNote ? '<div class="note">' + esc(d.recoveryNote) + '</div>' : '')
      + '<div class="kpis">'
      /* THE SPLIT, BESIDE THE TOTAL. Three schemes pay three different people here --
         recovery on a percentage, early collection per PAID/OVERPAID, and PMO collection on a
         band -- and the headline used to add up only the first two, leaving a whole board out.
         Printing the three parts under the total is what makes a wrong figure findable
         without scrolling to the boards and adding them up by hand. */
      + kpi(d.teamsScoped?'Timu zangu leo / My teams today':'Company total today', money(d.totals.day),
            (d.totals.split
              ? 'rec ' + money(d.totals.split.recDay) + ' · early ' + money(d.totals.split.colDay)
                + ' · PMO ' + money(d.totals.split.pmoDay)
              : d.weekday+' · '+(d.date||'')), d.totals.day?'good':'')
      + kpi(d.teamsScoped?'Timu zangu wiki hii / My teams this week':'Company total this week', money(d.totals.week),
            (d.totals.split
              ? 'rec ' + money(d.totals.split.recWeek) + ' · early ' + money(d.totals.split.colWeek)
                + ' · PMO ' + money(d.totals.split.pmoWeek) + ' · Mon–Sun'
              : 'Mon–Sun, summed day by day'), d.totals.week?'good':'')
      /* THE LADDER, not a rate mode. Recovery is paid on the percentage now, so the headline
         says what the bands are worth rather than what percentage of an amount is paid. */
      + kpi('Recovery pay', 'Kwa asilimia / by %',
            (d.recoveryBands||[]).map(function(b){ return b.floor + '%+ ' + money(b.tzs); }).join(' · ')
              || 'ladder not loaded')
      + kpi('Early collection', money(d.paidTzs)+' / '+money(d.overTzs),
            'per PAID / per OVERPAID client', noRates?'warnc':'')
      + '</div>'
      + (d.isAdmin ? '<div class="card"><div class="card-h">Viwango / Rates</div><div class="cmsrates">'
          /* THE RECOVERY LADDER: the PERCENTAGES are fixed, the AMOUNTS are the admin's.
               "i want to have the commision amounts editable by admin on the % bands payment"
             One box per band, drawn from the bands the server sent (never retyped here), each
             showing its built-in amount beside it so a change can be seen and undone. */
          + '<div class="fld" style="grid-column:1/-1"><label>Recovery — malipo kwa asilimia / paid by percentage — TZS kwa siku / per day</label>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin:6px 0">'
            /* The five bands and the one under them -- "add 0% - 49% payment 15,000/=" -- the
               last box, nought unless the admin says otherwise. */
            + (d.recoveryBands||[]).concat(d.recoveryBelow ? [d.recoveryBelow] : []).map(function(b){
                return '<div class="fld" style="margin:0"><label>' + esc(b.label) + '</label>'
                  + '<input class="cmBand" data-floor="' + b.floor + '" type="number" min="0" step="1000" value="' + (b.tzs||0) + '">'
                  + (b.defaultTzs != null && b.defaultTzs !== b.tzs
                      ? '<div class="fldnote">chaguo-msingi / default ' + money(b.defaultTzs) + '</div>' : '')
                  + '</div>'; }).join('')
            + '</div>'
            + '<div class="fldnote">Asilimia hazibadiliki hapa; kiasi cha kila kundi ndicho kinachowekwa. / The percentages are fixed; the amount of each band is yours to set.'
            + ' Siku 6 kwa wiki: Jumatatu&ndash;Ijumaa kila siku yake, na wiki nzima kama siku ya 6.'
            + ' / Six days a week: Monday&ndash;Friday each on its own, and the whole week as the sixth.'
            + (d.recBandsCustom
                ? ' <button class="btn sm ghost" id="cmBandsReset" style="margin-left:6px">Rudisha chaguo-msingi / Reset to defaults</button>'
                : '')
            + '</div></div>'
          /* THE PMO COLLECTION LADDER, the same way -- "every recovery unit bands too, make those
             amounts editable". Per day, five bands and the one under them. */
          + '<div class="fld" style="grid-column:1/-1"><label>PMO Collection — malipo kwa asilimia / paid by percentage — TZS kwa siku / per day</label>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin:6px 0">'
            + (d.pmoBands||[]).concat(d.pmoBelow ? [d.pmoBelow] : []).map(function(b){
                return '<div class="fld" style="margin:0"><label>' + esc(b.label) + '</label>'
                  + '<input class="cmPmoBand" data-floor="' + b.floor + '" type="number" min="0" step="1000" value="' + (b.tzs||0) + '">'
                  + (b.defaultTzs != null && b.defaultTzs !== b.tzs
                      ? '<div class="fldnote">chaguo-msingi / default ' + money(b.defaultTzs) + '</div>' : '')
                  + '</div>'; }).join('')
            + '</div>'
            + '<div class="fldnote">Kila siku kwa kundi lake, zimejumlishwa kwa wiki. / Each day banded on its own percentage, added up for the week.'
            + (d.pmoBandsCustom
                ? ' <button class="btn sm ghost" id="cmPmoBandsReset" style="margin-left:6px">Rudisha chaguo-msingi / Reset to defaults</button>'
                : '')
            + '</div></div>'
          /* THE EARLY COLLECTION SWITCH -- "i need a switch at viwango/rates where i can change
             early collection commission mode to performance or back to counts". Counts is the
             two flat rates below; performance is the plan's own ladder on each day's initial
             col %, with the PMO-style weekly bonus. The ladder and the bonus are drawn whichever
             mode is on, so the amounts can be set before the switch is thrown. */
          + '<div class="fld" style="grid-column:1/-1;border-top:1px solid var(--line);padding-top:10px"><label>Early Collection — hulipwa kwa / paid by</label>'
            + '<select id="cmEarlyMode" style="max-width:520px">'
            + '<option value="counts"' + (d.earlyMode !== 'performance' ? ' selected' : '') + '>Idadi / Counts — TZS kwa kila mteja PAID / OVERPAID (viwango viwili hapa chini)</option>'
            + '<option value="performance"' + (d.earlyMode === 'performance' ? ' selected' : '') + '>Utendaji / Performance — asilimia ya kila siku (initial col %) kwa kundi lake, kama PMO Collection</option>'
            + '</select>'
            + '<div class="fldnote">' + (d.earlyMode === 'performance'
                ? 'Inatumika sasa: <b>utendaji</b>. Kila siku ya afisa inalipwa kundi la asilimia yake ya siku hiyo — timu ngapi, wateja wangapi au kiasi gani haijalishi; wiki ni siku zake zikijumlishwa. / In force: <b>performance</b>. Each officer’s day pays the band of that day’s %, whatever the teams, customers or amount; the week is its days added.'
                : 'Inatumika sasa: <b>idadi</b>. Kila mteja aliyelipa (PAID) na aliyezidisha (OVERPAID) hulipa kiasi chake. / In force: <b>counts</b>. Every PAID and every OVERPAID customer pays its flat amount.')
            + '</div></div>'
          + '<div class="fld" style="grid-column:1/-1"><label>Early Collection — utendaji / performance — TZS kwa siku / per day'
            + (d.earlyMode === 'performance' ? '' : ' <span class="chip mut">haitumiki sasa / not in force</span>') + '</label>'
            + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin:6px 0">'
            + (d.earlyBands||[]).concat(d.earlyBelow ? [d.earlyBelow] : []).map(function(b){
                return '<div class="fld" style="margin:0"><label>' + esc(b.label) + '</label>'
                  + '<input class="cmEarlyBand" data-floor="' + b.floor + '" type="number" min="0" step="1000" value="' + (b.tzs||0) + '">'
                  + (b.defaultTzs != null && b.defaultTzs !== b.tzs
                      ? '<div class="fldnote">chaguo-msingi / default ' + money(b.defaultTzs) + '</div>' : '')
                  + '</div>'; }).join('')
            + '</div>'
            + '<div class="fldnote">80–84 = 20,000 · 85–87 = 25,000 · 88–90 = 30,000 · 91–93 = 40,000 · 94–100 = 60,000 kwa siku; chini ya 80 hailipi. Siku 5 kwa wiki, wiki ni siku zake zikijumlishwa.'
            + ' / per day; below 80 pays nothing. Five days a week, the week is its days added.'
            + (d.earlyBandsCustom
                ? ' <button class="btn sm ghost" id="cmEarlyBandsReset" style="margin-left:6px">Rudisha chaguo-msingi / Reset to defaults</button>'
                : '')
            + '</div></div>'
          + '<div class="fld"><label>Early Collection — bonasi ya wiki / weekly bonus (TZS)</label>'
            + '<input id="cmEarlyBonus" type="number" min="0" step="1000" value="'+(d.earlyBonus && d.earlyBonus.tzs || 0)+'">'
            + (d.earlyBonus && d.earlyBonus.set
                ? '<button class="btn sm ghost danger" id="cmEarlyBonusDel" style="margin-top:6px">Futa bonasi / Delete bonus</button>' : '')
            + '<label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-weight:600">'
            + '<input type="checkbox" id="cmEarlyBonusOn" style="width:auto"'
            + ((!d.earlyBonus || d.earlyBonus.enabled !== false) ? ' checked' : '') + '>'
            + 'Bonasi inatumika / Bonus enabled</label>'
            + '<div class="fldnote">Utendaji pekee: kwa kiongozi wa initial col % wa wiki aliyepita asilimia yake ya wiki iliyopita. / Performance mode only: to the week’s initial col % leader who beat their own previous week.</div></div>'
          + '<div class="fld"><label>TZS per PAID client' + (d.earlyMode === 'performance' ? ' <span class="chip mut">haitumiki sasa / not in force</span>' : '') + '</label>'
            + '<input id="cmPaid" type="number" min="0" step="50" value="'+(d.paidTzs||0)+'"></div>'
          + '<div class="fld"><label>TZS per OVERPAID client</label>'
            + '<input id="cmOver" type="number" min="0" step="50" value="'+(d.overTzs||0)+'"></div>'
          /* The weekly bonus, beside the rates it belongs with. It used to live only as a raw
             key in Settings, so the person deciding what a week is worth had to leave the board
             showing it and type a number with no context beside it. */
          + '<div class="fld"><label>Bonasi ya wiki / Weekly bonus (TZS)</label>'
            + '<input id="cmBonus" type="number" min="0" step="1000" value="'+(d.pmoBonus && d.pmoBonus.tzs || 0)+'">'
            /* DELETE, not "type a zero over it". Offered only when there is a bonus to remove:
               a Delete button beside something already unset is a button that does nothing, and
               one of those on a pay screen makes an admin wonder what it did. */
            + (d.pmoBonus && d.pmoBonus.set
                ? '<button class="btn sm ghost danger" id="cmBonusDel" style="margin-top:6px">'
                  + 'Futa bonasi / Delete bonus</button>' : '')
            /* SWITCHED OFF IS NOT DELETED. The amount stays where it is and stops paying, which
               is what a month with no budget for it looks like -- deleting the figure and
               remembering it is how somebody remembers it wrongly. */
            + '<label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-weight:600">'
            + '<input type="checkbox" id="cmBonusOn" style="width:auto"'
            + ((!d.pmoBonus || d.pmoBonus.enabled !== false) ? ' checked' : '') + '>'
            + 'Bonasi inatumika / Bonus enabled</label>'
            + '<div class="fldnote">Hulipwa kwa kiongozi mmoja anayeongoza kwa asilimia ya wiki NA amepita asilimia yake ya wiki iliyopita. 0 = hakuna bonasi.'
            + ' / Paid to the single leader who tops the week AND beat their own previous week. 0 means no bonus.'
            + (d.pmoBonus && d.pmoBonus.set
                ? ' <b>Futa</b> huondoa sheria kabisa — tumia unapobadilisha vigezo.'
                  + ' / <b>Delete</b> removes the rule entirely, for when the criteria change.' : '')
            + '</div></div>'
          + '<div class="fld" style="grid-column:1/-1"><label>Maelezo ya malipo / Payout note shown to officers</label>'
            + '<input id="cmPayText" placeholder="mf. Kamisheni hulipwa kila tarehe 5 ya mwezi" value="'+esc(d.payText||'')+'"></div>'
          + '<button class="btn sm" id="cmSave">Hifadhi / Save &amp; recalculate</button>'
          + (noRates ? '<div class="note">Viwango vyote ni <b>0</b> — ndiyo maana Collection comm. inaonyesha 0.'
              + ' / Both flat rates are <b>0</b>, which is exactly why Collection comm. reads 0 while the'
              + ' PAID/OVERPAID counts flow. Type the amounts and press Save.</div>' : '')
          + '</div></div>' : '')
      // The payout note. An officer looking at a commission figure asks "when do I get it?"
      // next, and without this they ask a person instead of the screen.
      + (d.payText ? '<div class="note" style="background:var(--b50);border-color:var(--b100);color:var(--b800)">'
          + esc(d.payText) + '</div>' : '')
      /* THE TWO INDEPENDENT BOARDS -- "early col and rec should also be independent tables".
         Recovery and early collection are different people on different rules; each gets a
         day-by-day week board like the PMO pair below. No separate "leo" board -- "having
         weekly by day should kill the today only": today is simply the newest column. */
      /* TODAY'S RECOVERY BY BAND -- "how much each person earned from each disb year band in
         that days rec". One column pair per band that actually earned today: the year (or
         status) that priced the drop, the amount, and the TZS. Sits where the today table
         stood. */
      /* An empty recovery board has more than one truth behind it, and the note says which --
         guessing sent somebody to upload the same file a fourth time. Recovery is the STANDING
         as of the day -- each team's latest INITIAL decks minus the company's latest CURRENT
         deck (the dashboard's own rule, the same function), so the note lists, day by day,
         whether the day had a current deck to stand against and who was left holding one. */
      + (!(d.recBoard||[]).length
          ? '<div class="card"><div class="card-h">Recovery — wiki hii / this week</div>'
            + '<div class="note" style="margin:10px 14px">'
            + 'Urejeshaji wa siku = deki za INITIAL za mwisho za kila timu toa deki ya CURRENT ya mwisho hadi siku hiyo — kanuni ile ile ya dashibodi.'
            + ' Hakuna siku ya wiki hii ('+esc((d.recDiag&&d.recDiag.from)||'')+' → '+esc((d.recDiag&&d.recDiag.to)||'')+') yenye deki ya CURRENT ya kupimia.'
            + ' / A day’s recovery is each team’s latest INITIAL decks minus the latest CURRENT deck as of that day — the dashboard’s rule.'
            + ' No day this week has a CURRENT deck to stand against, so there is nothing to pay on yet.'
            + ((d.recDiag && d.recDiag.days && d.recDiag.days.length)
                ? '<br><span style="color:var(--mut)">' + d.recDiag.days.map(function(x){
                    return esc(x.date)+' '+esc(x.weekday||'')+': '
                      + (x.measured ? 'imepimwa / measured' : 'haijapimwa / not measured')
                      + (x.initialOnly ? ' · initial pekee / initial only: '+money(x.initialOnly)+' team(s)' : '')
                      + (x.currentOnly ? ' · current pekee / current only: '+money(x.currentOnly)+' team(s)' : '')
                      + (!x.paired && !x.initialOnly && !x.currentOnly ? ' · hakuna deki / no deck' : '');
                  }).join('<br>') + '</span>'
                : '')
            + '</div></div>'
          : '')
      + ((d.recBoard||[]).length
          ? board('cmRecWeek','Recovery — wiki hii / this week',
              'asilimia ya urejeshaji kwa KILA siku na kundi inayolipa · WK ni wiki nzima, siku ya 6 / the recovery percentage day by day and the band it pays — WK is the whole week, the 6th day'
                /* The same recovery the dashboard tiles draw, per team, filed under the officer --
                   so the total here IS the dashboard's total, and the note says how many days
                   actually had both decks to measure. */
                + ((d.recDiag && d.recDiag.days)
                    ? ' · rec = initial ya mwisho − current ya mwisho hadi siku hiyo, kama dashibodi / latest initial − latest current as of the day, same figure as the dashboard'
                      + ' · siku zilizopimwa / days measured: ' + money(d.recDiag.measured||0) + ' / ' + money(d.recDiag.days.length)
                    : ''),
              /* SIX RECORDS. Five weekdays, each its own percentage and what that band pays,
                 then WK -- the week's own percentage, which is the weekend's commission day.
                 The percentage leads each pair because it is what decides the pay now; the
                 amount follows it as the thing it was worked out from. */
              d.recBoard, [col('officer','Recovery officer')]
                .concat(['J3','J4','J5','AL','IJ','WK'].reduce(function(a,k){
                  return a.concat([
                    // The grand cell: the record's recovered over its uncollected, added across officers.
                    {key:'pct'+k, label:(k==='WK'?'Wiki %':k+' %'), kind:'pct', target:'rec', from:['rec'+k, 'base'+k]},
                    col('rec'+k, (k==='WK'?'Wiki rec':k+' rec'), 'money'),
                    col('tzs'+k, (k==='WK'?'Wiki TZS':k+' TZS'), 'money')]); }, []))
                .concat([col('weekRecovered','Jumla rec / total','money'),
                  col('weekCommission','Wiki / Week TZS','money')]),
              sumRow(d.recBoard, ['J3','J4','J5','AL','IJ','WK'].reduce(function(a,k){
                  return a.concat(['rec'+k,'tzs'+k]); }, ['weekRecovered','weekCommission'])))
          : '')
      + ((d.colBoard||[]).length
          ? board('cmColWeek','Early Collection — wiki hii / this week',
              (d.earlyMode === 'performance'
                ? 'UTENDAJI / PERFORMANCE: kila siku inalipwa kundi la asilimia yake ya initial col % (kama PMO Collection), wiki ni siku zake zikijumlishwa'
                  + ' / each day pays the band of its own initial col %, the week is its days added'
                  + (d.earlyBonus ? ' · ' + (d.earlyBonus.won
                      ? 'bonasi ya wiki: ' + money(d.earlyBonus.tzs) + ' → ' + esc(d.earlyBonus.leader || '')
                      : 'bonasi: ' + esc(d.earlyBonus.why || '')) : '')
                : 'asilimia dhidi ya kitabu cha initial expected na idadi ya PAID+OVERPAID kwa KILA siku'
                  + ' / the col % against the initial expected book and the PAID+OVERPAID count, day by day'),
              /* EACH DAY'S OWN TZS, beside its count -- "collection wiki is not showing what
                 they earned per day as recovery does". The count is what the day pays on and
                 the shillings are what it paid; a board that showed only the first left the
                 officer working the second out by hand. Same shape as the recovery board. */
              d.colBoard, [col('officer','Early col officer')]
                .concat(['J3','J4','J5','AL','IJ'].reduce(function(a,k){
                  return a.concat([col('pct'+k, k, 'pct'), col('n'+k, k+' P+O', 'num'), col('ctzs'+k, k+' TZS', 'money')]); }, []))
                .concat([{key:'weekPct', label:'Wiki %', kind:'pct', target:'ecol'}, col('weekN','Wiki P+O','num')])
                // In performance mode the bonus has a column, as on the PMO board, with last week's % beside it.
                .concat(d.earlyMode === 'performance'
                  ? [{key:'prevWeekPct', label:'Last week %', kind:'pct', target:'ecol'}, col('weekCommission','Wiki / Week TZS','money'), col('bonus','Bonus','money')]
                  : [col('weekCommission','Wiki / Week TZS','money')]),
              sumRow(d.colBoard, ['J3','J4','J5','AL','IJ'].reduce(function(a,k){
                  return a.concat(['n'+k, 'ctzs'+k]); }, ['weekN','weekCommission'].concat(d.earlyMode === 'performance' ? ['bonus'] : []))))
          : '<div class="card"><div class="card-h">Early Collection — wiki hii / this week</div>'
            + '<div class="note" style="margin:10px 14px">Hakuna faili la <b>INITIAL expected</b> la wiki hii — '
            + 'bodi hii inasoma faili la INITIAL pekee, hakuna mbadala. Pakia la leo na hujaa yenyewe. '
            + '/ No <b>INITIAL expected</b> file has landed in this range — this board reads the INITIAL file '
            + 'only, no fallback. Upload today’s initial file and it fills itself.</div></div>')
      /* PMO COLLECTION. Paid on the percentage and nothing else -- not team count, not customer
         count, not amount. This is the ONE screen the money appears on: the presentation shows
         the same officers with the shillings deliberately left out. */
      /* Empty, and SAYING WHY. Before, an unrecognised role name produced a blank space and a
         telephone call. */
      + ((!d.pmo || !d.pmo.length) && d.isAdmin ? (
          '<div class="card"><div class="card-h">PMO Collection</div><div class="note bad" style="margin:10px 14px">'
          + (d.pmoDiag.withRole === 0
              ? 'Hakuna msimbo wenye wadhifa <b>' + esc(d.pmoDiag.roleWanted) + '</b>.'
                + ' / No access code has the role <b>' + esc(d.pmoDiag.roleWanted) + '</b>.'
                + '<br>Wadhifa uliopo sasa / roles currently in use: '
                + (d.pmoDiag.rolesSeen.length ? '<code>' + d.pmoDiag.rolesSeen.map(esc).join('</code> · <code>') + '</code>' : '—')
                + '<br>Badilisha wadhifa kwenye msimbo, au weka <code>PMO_ROLE</code> kwenye Settings ulingane na uliotumia.'
                + ' / Change the role on the code, or set <code>PMO_ROLE</code> in Settings to match what you typed.'
              : 'Misimbo <b>' + money(d.pmoDiag.withRole) + '</b> ina wadhifa huo lakini haina timu.'
                + ' Mtu asiye na timu huonekana kama mwenye timu ZOTE, na asilimia yake ingekuwa ya kampuni nzima —'
                + ' hivyo hajahesabiwa. Weka timu zake kwenye msimbo wake.'
                + ' / <b>' + money(d.pmoDiag.withRole) + '</b> code(s) carry that role but list no teams.'
                + ' A code with no teams means ALL teams, whose percentage would be the whole company’s,'
                + ' so it is left off. Put their teams on the code.')
          + '</div></div>')
        : '')
      + ((d.pmo && d.pmo.length) ? (
          '<div class="card"><div class="card-h">PMO Collection'
          + '<span class="sub">asilimia ya makusanyo pekee / the collection percentage, and nothing else</span></div>'
          + '<div class="cleanbox"><div style="display:flex;gap:8px;flex-wrap:wrap">'
          + (d.pmoBands||[]).map(function(b){
              return '<span class="chip">' + esc(b.label) + ' &middot; ' + money(b.tzs) + '/siku</span>'; }).join('')
          + '</div>'
          /* The bonus condition is checked, not assumed -- and when it is not won the screen
             says WHICH half failed, because "no bonus" with no reason is the kind of thing
             somebody has to ring the office about. */
          + '<div class="note" style="margin-top:10px">'
          + (!d.pmoBonus.set
              ? '<b>Bonasi ya wiki haijawekwa.</b> Sheria ipo — atakayeongoza akiwa amepita asilimia yake ya wiki iliyopita —'
                + ' lakini kiasi hakijawekwa. Weka <code>PMO_WEEKLY_BONUS</code> kwenye Settings.'
                + ' / <b>The weekly bonus amount is not set.</b> The rule is in place; type the amount into Settings'
                + ' as <code>PMO_WEEKLY_BONUS</code> and it starts paying.'
              : d.pmoBonus.won
                ? '<b>Bonasi ya wiki: ' + money(d.pmoBonus.tzs) + '</b> &rarr; ' + esc(d.pmoBonus.leader||'')
                  + ' (' + pct(d.pmoBonus.leaderPct) + ' dhidi ya '
                  + pct(d.pmoBonus.leaderPrevPct) + ' wiki iliyopita)'
                : '<b>Bonasi ya wiki haijashindwa bado.</b> ' + esc(d.pmoBonus.why||''))
          + '</div></div></div>')
        : '')
      + ((d.pmo && d.pmo.length) ? board('cmPmoDay','PMO Collection — leo / today',
          'kiwango cha siku kinatokana na asilimia ya siku hiyo / the day’s rate follows that day’s percentage',
          /* EXPECTED IS GONE FROM BOTH THESE BOARDS. What is owed is not what anybody here is
             judged on -- uncollected and the percentage are, and a column nobody reads is a
             column between them and the two that matter. */
          d.pmo, [col('officer','PMO'), col('teams','Teams','num'), col('customers','Customers','num'),
            col('uncollected','Uncollected','money'),
            {key:'pct', label:'Collection %', kind:'pct', target:'col'}, col('band','Band'), col('commission','Today TZS','money')]) : '');
    /* The week's PMO board is a board of its own rather than the main table, because the main
       table is the recovery/early-collection week and the two are different people paid on
       different things. */
    if (d.pmo && d.pmo.length) HEAD += board('cmPmoWeek','PMO Collection — wiki hii / this week',
      'jumla ya viwango vya kila siku, si asilimia ya wiki iliyowekwa kwenye kundi moja'
      + ' / each day banded on its own percentage and added up, not the week scored once',
      /* THE FIVE DAYS, EACH WITH ITS OWN PERCENTAGE, BEFORE THE WEEK'S.
         Pay follows each day's own band added up -- a good Ijumaa is worth something after a
         poor Jumanne -- so the five percentages are what tell somebody what they are earning,
         and Week TZS is their sum. The week's own percentage is context, not the basis, which
         is why it sits AFTER them and not in front. */
      /* AND WHAT EACH DAY PAID, beside its percentage -- "collection wiki is not showing what
         they earned per day as recovery does". The rate was already on the row (tzsJ3..tzsIJ,
         see pmoBoard); the table just never drew it, so Week TZS was a sum with no parts. Same
         shape as the recovery board: the percentage, then the shillings it was worth. */
      d.pmo, [col('officer','PMO'), col('teams','Teams','num'),
        col('weekUncollected','Uncollected','money')]
        .concat(['J3','J4','J5','AL','IJ'].reduce(function(a,k){
          return a.concat([{key:'pct'+k, label:k, kind:'pct', target:'col'}, col('tzs'+k, k+' TZS', 'money')]); }, []))
        .concat([{key:'weekPct', label:'Wiki %', kind:'pct', target:'col'},
        {key:'prevWeekPct', label:'Last week %', kind:'pct', target:'col'},
        col('weekCommission','Week TZS','money'), col('bonus','Bonus','money')]),
      sumRow(d.pmo, ['J3','J4','J5','AL','IJ'].map(function(k){ return 'tzs'+k; }).concat(['weekCommission','bonus'])));
    S.rows = d.week;
    S.cols = CMS_COLS;
    // "chip the last AIO" -- the combined all-in-one Orodha folds behind a chip; the
    // independent boards above are the read, the AIO is the occasional export. It is
    // ALWAYS the weekly progress, and its chip carries its own blinking dot to the
    // month record -- "orodha should always be weekly progress with a blinking dot to
    // show monthly".
    S.foldMain = 'cmlist';
    S.foldLabel = 'Orodha / List — wiki hii / weekly progress';
    S.foldDot = '<button class="syncdot" data-go="cmmonth" data-carry="weekOf" title=""></button>';
    ONROW = null;
    S.foot = 'Wiki hii / this week (Mon–Sun): TZS ' + money(d.totals.week)
      + ((d.pmo && d.pmo.length) ? ' · PMO Collection: TZS ' + money(d.pmoTotals.week) : '');
  });
};

/* THE MONTH RECORD, behind the commission screen's blinking dot. The SAME computation from
   the month's first day -- the walk that pays the weeks pays the month, so the two can never
   disagree -- with each scheme's board reduced to its month totals per officer: thirty-one
   day columns is not a table anybody reads. The weekly bonus is a weekly rule and is
   deliberately absent here. */
VIEWS.cmmonth = function(){
  /* WHICH MONTH -- "back and foward months in the blinking dot too". Chosen outright, or
     taken from the week the dot was pressed on, or this month. */
  var month = S.args.month || (S.args.weekOf ? String(S.args.weekOf).slice(0, 7) : '');
  return srv('commission', { scope: 'month', month: month }).then(function(d){
    var sp = d.totals.split || {};
    var m = d.month || month || todayKeyClient().slice(0, 7);
    var thisM = todayKeyClient().slice(0, 7);
    /* THE WEEKS OF THE MONTH AS COLUMNS -- "weekly progress to month there with the same
       columns for each PMO Unit among the 3 as we had daily to weekly on the landing nav
       page". W1, W2 ... each carrying the cells its day columns carry on the week page; the
       month's own figures close the row. The server says which weeks the month has and which
       days each covers, so a week clipped by the month's edge is labelled with its real days. */
    var wks = d.weeks || [];
    var wkCols = function(mk){ return wks.reduce(function(a, w){ return a.concat(mk(w)); }, []); };
    var span = function(w){ return esc(w.from) + ' → ' + esc(w.to); };
    HEAD = bar('<button class="pill" data-go="commission">&larr; Kamisheni / Commission</button>'
        + '<label style="font-size:12px;color:var(--mut)">Mwezi / Month</label>'
        + '<button class="btn sm ghost" data-arg="month" data-val="' + esc(addMonths(m, -1)) + '" title="Mwezi uliopita / previous month">&#9664;</button>'
        + '<input type="month" data-arg="month" value="' + esc(m) + '">'
        + '<button class="btn sm ghost" data-arg="month" data-val="' + esc(addMonths(m, 1)) + '" title="Mwezi ujao / next month">&#9654;</button>'
        + (m === thisM
            ? '<span class="chip mut">Mwezi huu / this month &middot; ' + esc(d.from||'') + ' &rarr; ' + esc(d.to||'') + '</span>'
            : '<span class="chip warn">' + (m < thisM ? 'Mwezi uliopita / past month' : 'Mwezi ujao / upcoming month')
              + ' &middot; ' + esc(d.from||'') + ' &rarr; ' + esc(d.to||'') + '</span>'
              + ' <button class="btn sm ghost" data-arg="month" data-val="' + esc(thisM) + '">Rudi mwezi huu / Back to this month</button>'))
      + '<div class="kpis">'
      + (function(){
          /* THE THREE UNIT WIDGETS READ PERFORMANCE, NOT MONEY.
               "for rec, early col and col widgets remove the total since its on the first
                company widget, leave the officers and add the percentage performance"
             Each unit's percentage is the RATIO of its officers' amounts over the month (the
             same figure its board's JUMLA row shows), never a mean of their percentages; the
             amounts it is made of sit under it, with the officer count. The company widget
             keeps the money and gains the average of the three unit percentages. */
          var sumOf = function(rows, k){ return (rows||[]).reduce(function(s,r){ return s + (Number(r[k])||0); }, 0); };
          var ratio = function(n, dn){ return dn > 0 ? Math.round(n / dn * 1000) / 10 : null; };
          var pc = function(p){ return p == null ? '—' : money(p) + '%'; };
          var tone = function(p, t){ var tg = targetOf_({ target: t }); return (p == null || tg == null) ? '' : (p >= tg ? 'good' : 'bad'); };
          var rUncol = sumOf(d.recBoard, 'weekBase'), rRec = sumOf(d.recBoard, 'weekRecovered'), rPct = ratio(rRec, rUncol);
          var eExp = sumOf(d.colBoard, 'weekExpected'), eCol = sumOf(d.colBoard, 'weekCollected'), ePct = ratio(eCol, eExp);
          var eN = sumOf(d.colBoard, 'weekN'), eCust = sumOf(d.colBoard, 'weekCustomers');
          var pExp = sumOf(d.pmo, 'weekExpected'), pCol = sumOf(d.pmo, 'weekCollected'), pPct = ratio(pCol, pExp);
          var units = [ePct, pPct, rPct].filter(function(x){ return x != null; });
          var perf = units.length ? Math.round(units.reduce(function(s,x){ return s + x; }, 0) / units.length * 10) / 10 : null;
          return kpi(d.teamsScoped ? 'Timu zangu — mwezi hadi sasa / My teams — month to date' : 'Company total — month to date',
              money(d.totals.week),
              'rec ' + money(sp.recWeek||0) + ' · early ' + money(sp.colWeek||0) + ' · PMO ' + money(sp.pmoWeek||0)
                + ' · utendaji / PMO performance ' + pc(perf) + ' = wastani wa / avg of early col ' + pc(ePct)
                + ' · col ' + pc(pPct) + ' · rec ' + pc(rPct),
              d.totals.week ? 'good' : '')
            + kpi('Recovery — mwezi', pc(rPct),
                'uncol ' + money(rUncol) + ' · imerejeshwa / recovered ' + money(rRec)
                  + ' · ' + money((d.recBoard||[]).length) + ' officer(s)', tone(rPct, 'rec'))
            + kpi('Early Collection — mwezi', pc(ePct),
                'expected ' + money(eExp) + ' · early collected ' + money(eCol)
                  + ' · ' + money(eN) + '/' + money(eCust) + ' paid+overpaid kati ya wateja wote expected / of all expected'
                  + ' · ' + money((d.colBoard||[]).length) + ' officer(s)', tone(ePct, 'ecol'))
            + kpi('PMO Collection — mwezi', pc(pPct),
                'expected ' + money(pExp) + ' · collected ' + money(pCol)
                  + ' · ' + money((d.pmo||[]).length) + ' officer(s)', tone(pPct, 'col'));
        })()
      + '</div>'
      + (d.payText ? '<div class="note" style="background:var(--b50);border-color:var(--b100);color:var(--b800)">'
          + esc(d.payText) + '</div>' : '')
      /* RECOVERY: each week's percentage, recovered and TZS (the six records added), then the
         month -- the shape the week page has per day. */
      + board('cmMRec','Recovery — mwezi / month',
          'kila wiki: asilimia ya wiki, kilichorejeshwa na TZS ya rekodi 6 · Mwezi = jumla ya wiki / each week: its %, recovered and the six records’ TZS · the month is the weeks added',
          d.recBoard,
          [col('officer','Recovery officer')]
            .concat(wkCols(function(w){ return [
              // Each grand cell is that week's recovered over its uncollected, every officer added.
              {key:'pct'+w.key, label:w.key+' %', kind:'pct', target:'rec', title: span(w), from:['rec'+w.key, 'base'+w.key]},
              {key:'rec'+w.key, label:w.key+' rec', kind:'money', title: span(w)},
              {key:'tzs'+w.key, label:w.key+' TZS', kind:'money', title: span(w)}]; }))
            .concat([{key:'weekPct', label:'Mwezi %', kind:'pct', target:'rec', from:['weekRecovered', 'weekBase']},
              col('weekRecovered','Mwezi rec','money'), col('weekCommission','Mwezi / Month TZS','money')]),
          sumRow(d.recBoard||[], wks.reduce(function(a,w){ return a.concat(['rec'+w.key,'tzs'+w.key]); }, ['weekRecovered','weekCommission'])))
      /* EARLY COLLECTION: each week's initial col %, PAID+OVER count and TZS, then the month. */
      + board('cmMCol','Early Collection — mwezi / month',
          (d.earlyMode === 'performance'
            ? 'UTENDAJI / PERFORMANCE: kila wiki: asilimia dhidi ya kitabu cha initial, idadi ya PAID+OVERPAID na TZS ya siku zake kwa makundi · Mwezi = jumla / each week: the initial col %, the PAID+OVERPAID count and its days’ bands added · the month is the sum'
            : 'kila wiki: asilimia dhidi ya kitabu cha initial, idadi ya PAID+OVERPAID na TZS · Mwezi = jumla / each week: the initial col %, the PAID+OVERPAID count and its TZS · the month is the sum'),
          d.colBoard,
          [col('officer','Early col officer')]
            .concat(wkCols(function(w){ return [
              {key:'pct'+w.key, label:w.key+' %', kind:'pct', target:'ecol', title: span(w), from:['col'+w.key, 'exp'+w.key]},
              {key:'n'+w.key, label:w.key+' P+O', kind:'num', title: span(w)},
              {key:'ctzs'+w.key, label:w.key+' TZS', kind:'money', title: span(w)}]; }))
            .concat([{key:'weekPct', label:'Mwezi %', kind:'pct', target:'ecol'},
              col('weekPaid','Paid','num'), col('weekOver','Overpaid','num'),
              col('weekN','Mwezi P+O','num'), col('weekCommission','Mwezi / Month TZS','money')]),
          sumRow(d.colBoard||[], wks.reduce(function(a,w){ return a.concat(['n'+w.key,'ctzs'+w.key]); }, ['weekPaid','weekOver','weekN','weekCommission'])))
      /* PMO COLLECTION: each week's percentage and its days' bands added, then the month. */
      + ((d.pmo && d.pmo.length) ? board('cmMPmo','PMO Collection — mwezi / month',
          'kila wiki: asilimia ya wiki na TZS ya siku zake (kila siku kwa kundi lake) · Mwezi = jumla / each week: its % and its days’ bands added · the month is the sum',
          d.pmo, [col('officer','PMO'), col('teams','Teams','num')]
            .concat(wkCols(function(w){ return [
              {key:'pct'+w.key, label:w.key+' %', kind:'pct', target:'col', title: span(w), from:['col'+w.key, 'exp'+w.key]},
              {key:'tzs'+w.key, label:w.key+' TZS', kind:'money', title: span(w)}]; }))
            .concat([col('weekUncollected','Uncollected','money'),
              {key:'weekPct', label:'Mwezi %', kind:'pct', target:'col'}, col('weekCommission','Mwezi / Month TZS','money')]),
          sumRow(d.pmo||[], wks.map(function(w){ return 'tzs'+w.key; }).concat(['weekUncollected','weekCommission']))) : '');
    S.rows = d.week || [];
    S.cols = CMS_COLS;
    S.foldMain = 'cmlist';
    S.foldLabel = 'Orodha / List — mwezi / month to date';
    ONROW = null;
    S.foot = 'Mwezi / month to date (' + esc(d.from||'') + ' → ' + esc(d.to||'') + '): TZS '
      + money(d.totals.week)
      + ((d.pmo && d.pmo.length) ? ' · PMO: TZS ' + money(d.pmoTotals.week) : '');
  });
};

VIEWS.calls = function(){
  var from = S.args.from || addDays(today(), -7), to = S.args.to || today();
  return srv('callReport', {from:from, to:to, leader:S.args.leader||'', team:S.args.team||'',
                            user:S.args.user||''}).then(function(d){
    var t=d.totals;
    /* THE CALL COUNTING RULE (call-core.js, callRollupRows): a call is a NUMBER rung, once per
       day however many times it was dialled, and talk time is PORTFOLIO talk time. The dials
       and the other talk are shown beside the figures, in grey, so the pattern the rule
       exists for -- redial one unreachable number all morning, then chat for an hour on a
       number off the book -- is there to see and scores nothing. */
    HEAD = '<div class="kpis">'
      + kpi('Calls', money(t.calls), 'numbers rung · ' + money(t.dials) + ' dials · ' + d.from+' → '+d.to)
      + kpi('Talk time', fmtDur(t.duration), 'portfolio only · other talk ' + fmtDur(t.otherDuration))
      + kpi('Portfolio', money(t.portfolio), Math.round(100*(t.ratio||0))+'% of calls', 'good')
      + kpi('Non-portfolio', money(t.nonPortfolio))
      + kpi('Reached', money(t.connected), t.calls ? Math.round(100*t.connected/t.calls)+'% of numbers' : '')
      + '</div>'
      + (d.rule ? '<div class="note">' + esc(d.rule) + '</div>' : '')
      + (d.ruleNote ? '<div class="note bad">' + esc(d.ruleNote) + '</div>' : '')
      + (d.prunedNote ? '<div class="note bad">' + esc(d.prunedNote) + '</div>' : '')
      /* SORT BY A LEADER, NOT ONLY BY A TEAM. A leader holds several teams, and "how is this
         person's book doing" meant picking their teams out of a forty-line list one at a time
         and adding the answers up by hand. Naming them scopes the whole report to exactly the
         teams they hold, so every officer under them appears together. */
      + bar('<input type="date" data-arg="from" value="'+d.from+'"><input type="date" data-arg="to" value="'+d.to+'">'
        + '<select data-arg="leader"><option value="">Viongozi wote / Every leader</option>'
        + (d.leaders||[]).map(function(x){
            return '<option value="'+esc(x.name)+'"'+(S.args.leader===x.name?' selected':'')+'>'
              + esc(x.name) + ' \u00B7 ' + esc(x.position) + ' \u00B7 ' + x.teams + ' timu</option>'; }).join('')
        + '</select>'
        + '<select data-arg="team"><option value="">Timu zote / All teams</option>'
        + (d.teams||[]).map(function(x){
            return '<option value="'+esc(x.team)+'"'+(S.args.team===x.team?' selected':'')+'>'+esc(x.team)+'</option>'; }).join('')
        + '</select>'
        /* BY USER: their teams, and everybody on them. Not that one person -- "how is Juma's
           patch doing" is meaningless without the officers beside him.

           A SEARCH, NOT A DROPDOWN OF EVERYBODY. A list of every user who made a call is a
           long list on a big company, and it is sent whole to the browser to be scrolled. The
           box below asks the database for the two or three people whose name or number matches
           what is typed, and shows enough to tell them apart -- name, number, team. */
        + '<span style="position:relative;display:inline-block">'
        + '<input id="ofFind" placeholder="Tafuta afisa: jina au namba / officer name or number"'
        + ' value="' + esc(S.args.user || '') + '" style="min-width:260px">'
        + '<div id="ofHits" class="card" style="display:none;position:absolute;z-index:30;left:0;top:100%;'
        + 'margin-top:4px;min-width:300px;max-height:280px;overflow:auto"></div></span>'
        + (S.args.user ? ' <button class="btn sm ghost" id="ofClear">\u2715 Ondoa / Clear</button>' : '')
        + (d.leader ? '<span class="chip ok" style="margin-left:8px">' + esc(d.leader) + ' \u00B7 '
            + (d.scope === 'ALL' ? 'timu zote' : (d.scope||[]).length + ' timu') + '</span>' : '')
        + (d.user ? '<span class="chip ok" style="margin-left:8px">' + esc(d.user) + ' \u00B7 '
            + (d.userTeams||[]).length + ' timu \u00B7 na wenzake / with their teams\u2019 users</span>' : ''))
      // The backend already computed all five of v1's breakdowns; only the officer table was
      // ever shown, so category, outcome, team and per-day were computed and thrown away.
      // Category and outcome answer different questions and carry different columns, so they
      // are two boards side by side rather than one shared shape.
      + '<div class="pair">'
      + board('clCat','Kwa aina / By category', 'numbers rung, what they were about, how many were reached', d.byCategory||[],
          [col('category','Category'), col('calls','Calls','num'), col('dials','Dials','num'), col('duration','Talk time','dur'),
           col('connected','Reached','num'),
           {key:'connectRatio', label:'Reached %', kind:'pct', get:function(r){ return Math.round((r.connectRatio||0)*1000)/10; }}],
          sumRow(d.byCategory||[], ['calls','dials','duration','connected']))
      /* Outcomes belong to DIALS, not calls: the same number can be missed four times and
         reached once, so this board counts attempts and says so in its heading. */
      + board('clOut','Kwa matokeo / By outcome', 'what happened on each dial', d.byOutcome||[],
          [col('outcome','Outcome'), col('dials','Dials','num'), col('duration','Talk time','dur')],
          sumRow(d.byOutcome||[], ['dials','duration']))
      + '</div>'
      + board('clTeam','Kwa timu / By team', 'portfolio vs non-portfolio per team', d.teams||[],
          [col('branch','Branch'), col('team','Team'), col('calls','Calls','num'), col('dials','Dials','num'), col('duration','Talk time','dur'),
           {key:'portfolio', label:'Portfolio', kind:'num', cls:function(){ return 'good'; }},
           col('nonPortfolio','Non-portfolio','num'),
           {key:'ratio', label:'Portfolio %', kind:'pct', get:function(r){ return Math.round((r.ratio||0)*1000)/10; }}],
          sumRow(d.teams||[], ['calls','dials','duration','portfolio','nonPortfolio']))
      /* THE DAY-BY-OFFICER BOARD AND THE FULL OFFICER LIST ARE GONE FROM HERE.

           "having the whole list on font end is tooo long"

         Both were the same page answering a question nobody asked it: every officer times every
         day, and then every officer again. On three hundred handsets that is thousands of rows
         drawn so somebody can look for one person in them. The summaries above answer "how is
         the company doing"; a NAME answers "how is this person doing", and searching for a name
         is the thing the screen was missing.

         The officer table still exists -- it appears the moment a person is chosen, showing
         their patch. Empty until then, so the page opens short. */
      + (d.user ? '' : '<div class="card"><div class="card-h">Tafuta afisa / Find an officer</div>'
          + '<div class="cleanbox"><div class="note" style="display:block">Andika jina au namba ya afisa hapo juu '
          + 'ili kuona ripoti yake. / Type an officer\u2019s name or number in the box above to see their report. '
          + 'Muhtasari wa kampuni nzima upo hapo juu. / The company-wide summary is above.</div></div></div>');
    /* The officer table is the person's own report, so it is drawn only when there is a person.
       Before that the page is the summaries and the search, and nothing else. */
    S.rows = d.user ? d.users : [];
    S.cols = [col('name','Officer'), col('branch','Branch'), col('team','Team'), col('position','Position'), col('calls','Calls','num'),
      col('dials','Dials','num'), col('duration','Talk time','dur'), col('otherDuration','Other talk','dur'),
      {key:'portfolio', label:'Portfolio', kind:'num', cls:function(){ return 'good'; }},
      col('nonPortfolio','Non-portfolio','num'),
      {key:'ratio', label:'Portfolio %', kind:'pct', get:function(r){ return Math.round((r.ratio||0)*1000)/10; }},
      col('expected','Expected','num'), col('defaulter','Defaulter','num'),
      col('connected','Reached','num'),
      {key:'connectRatio', label:'Reached %', kind:'pct', get:function(r){ return Math.round((r.connectRatio||0)*1000)/10; }},
      col('uniqCustomers','Customers','num'), col('days','Days','num')];
    ONROW = null;
    S.foot = money(t.calls)+' calls ('+money(t.dials)+' dials) · '+fmtDur(t.duration)+' portfolio talk time · '
      + money(t.portfolio)+' portfolio ('+Math.round(100*(t.ratio||0))+'%)';
  });
};

/* Credit Analysts. The analyst is judged on their COUNT 1–6 book — defaulters who have paid
   fewer than 6 of 12 and are therefore still winnable — plus sales. The scorecard is the
   ranking; the portfolio under it is the call list. */
VIEWS.credit = function(){
  return srv('credit').then(function(d){
    var t = d.totals;
    HEAD = '<div class="kpis">'
      + kpi('Count 1–6 defaulters', money(t.cnt), 'paid 0–'+d.threshold+' of 12 (not past the 6th)')
      + kpi('Success (1–6)', pct(t.success), money(t.cleared + t.reduced)+' cleared/reduced · '+money(t.bad)+' bad', 'good')
      + kpi('Sales', money(t.sales), pct(t.salesPct)+' of target', (t.salesPct>=100?'good':''))
      + kpi('Overall', pct(t.overall), 'success & sales averaged — this ranks the analyst')
      + kpi('Below average', money(d.rows.filter(function(r){ return r.below; }).length),
            'under '+pct(d.avgOverall)+' overall', 'warnc')
      + '</div>'
      + ((!d.hasInitial || !d.hasCurrent)
          ? '<div class="note">Pakia <b>Defaulters Initial</b> na <b>Current Defaulters</b> ili kupima cleared / reduced / bad / static.'
            + ' / Both uploads are needed to measure the four states.</div>'
          : (d.usedMondayBaseline ? '' :
             '<div class="note">Monday’s baseline haijapakiwa — inatumia orodha ya leo. / Monday’s initial deck is not uploaded yet, so today’s is standing in as the baseline.</div>'))
      + board('crPerf','Ufanisi wa wachambuzi / Analyst performance',
          d.analystCount+' analysts · Init 1–6 = the baseline deck, Now 1–6 = still defaulting today', d.rows,
          [col('analyst','Analyst'), col('teams','Teams','num'), col('cnt','Init 1–6','num'), col('cntCur','Now 1–6','num'),
           {key:'cleared', label:'Cleared', kind:'num', cls:function(){ return 'good'; }},
           {key:'reduced', label:'Reduced', kind:'num', cls:function(){ return 'good'; }},
           {key:'stat', label:'Static', kind:'num'},
           {key:'bad', label:'Bad', kind:'num', cls:function(){ return 'bad'; }},
           col('success','Success %','pct'), col('recovered','Recovered','money'),
           col('sales','Sales','money'), col('salesPct','Sales %','pct'),
           {key:'overall', label:'Overall %', kind:'pct', cls:function(r){ return r.below?'bad':'good'; }}],
          {analyst:'', teams:'', cnt:t.cnt, cntCur:t.cntCur, cleared:t.cleared, reduced:t.reduced,
           stat:t.stat, bad:t.bad, success:t.success, recovered:t.recovered, sales:t.sales,
           salesPct:t.salesPct, overall:t.overall})
      + bar('<label style="font-size:12px;color:var(--mut)">Analyst</label>'
        + '<select data-filter="analyst"><option value="">All analysts</option>'
        + (d.analysts||[]).map(function(a){
            return '<option'+(S.filters.analyst===a?' selected':'')+'>'+esc(a)+'</option>'; }).join('') + '</select>'
        + '<select data-filter="state"><option value="">All states</option>'
        + ['Cleared','Reduced','Static','Bad'].map(function(s){
            return '<option'+(S.filters.state===s?' selected':'')+'>'+s+'</option>'; }).join('') + '</select>'
        + '<span class="chip">Count 1–6 portfolio · '+money(d.portfolio.length)+' customers</span>');
    S.rows = d.portfolio;
    /* The guarantor and their number: this is a list for RINGING PEOPLE, and the number you
       ring when the customer does not answer was the one column not on it. */
    S.cols = [col('ref','REF#'), col('full_name','Customer'), col('branch','Branch'), col('team','Team'), col('analyst','Analyst'),
      {key:'contact', label:'Contact', kind:'tel'},
      col('guarantor_name','Guarantor'),
      {key:'guarantor_contact', label:'G. Contact', kind:'tel'},
      {key:'paid', label:'Paid', kind:'num', get:function(r){ return (r.paid||0)+'/12'; }},
      col('initArr','Init arrears','money'), col('curArr','Current','money'),
      {key:'recovered', label:'Recovered', kind:'money', cls:function(r){ return r.recovered>0?'good':''; }},
      {key:'state', label:'State', kind:'chip', chip:function(r){
        return (r.state==='Cleared'||r.state==='Reduced') ? 'ok' : (r.state==='Static' ? 'warn' : 'bad'); }}];
    ONROW = openFollowup;
    S.foot = 'Count 1–6: '+money(d.portfolio.length)+' · Overall: '+pct(t.overall)
      + ' · average '+pct(d.avgOverall);
  });
};

/* =====================================================================================
   CREDIT INFO -- the stats pane behind the download page's CREDIT INFO REPORT.

   The same server answer the workbook is built from: the whole current defaulter book with
   each customer's credit standing, the four states, and who answers for them. This screen
   shows what the file adds up to -- by state, by analyst, by branch -- and keeps the rows
   themselves underneath, searchable and exportable, so a question about one customer does not
   need a download to answer.

   "have its stats info nav pane in the system"
   ===================================================================================== */
VIEWS.creditinfo = function(){
  return srv('creditInfo').then(function(d){
    var s = d.stats || {}, t = s.totals || {};
    HEAD = '<div class="kpis">'
      + kpi('Wateja / Customers', money(t.customers), 'kitabu cha sasa / the current deck'
            + (d.asOf ? ' · ' + esc(d.asOf) : ''))
      + kpi('Count 1–6', money(s.c16), 'hawajavuka nusu / not past the 6th of 12')
      + kpi('Deni la sasa / Current', money(t.curArr),
            'msingi / baseline TZS ' + money(t.initArr), t.curArr < t.initArr ? 'good' : '')
      + kpi('Kilichorejeshwa / Recovered', money(t.recovered), 'tangu msingi / since the baseline', 'good')
      + kpi('Success %', pct(t.success), money(t.cleared) + ' cleared · ' + money(t.reduced) + ' reduced · '
            + money(t.bad) + ' bad', 'good')
      + '</div>'
      /* WHICH BASELINE THIS IS MEASURED FROM. "Recovered since Monday" and "recovered since
         some Thursday" are different sentences, and the screen must not print the first while
         meaning the second. */
      + (!d.hasCurrent
          ? '<div class="note bad">Kitabu cha wadaiwa (Current Defaulters) hakijapakiwa bado.'
            + ' / The current defaulter deck has not been uploaded yet — there is nothing to report on.</div>'
          : (d.usedMondayBaseline
              ? '<div class="note">Msingi / baseline: <b>Jumatatu ' + esc(d.baselineDate || '') + '</b>.</div>'
              : '<div class="note">Kitabu cha Jumatatu hakijapakiwa — msingi ni cha <b>'
                + esc(d.baselineDate || '—') + '</b>. / Monday’s initial deck is not uploaded, so'
                + ' the latest one is standing in as the baseline.</div>'))
      + '<div class="note">Faili kamili linapakuliwa kwenye ukurasa wa kupakia: <b>Pakua CREDIT INFO</b>.'
      + ' / The full workbook downloads from the Upload page under <b>Credit info report</b> — it is'
      + ' this same answer, so the sheet and this screen always agree.</div>'
      + board('ciState', 'Hali / State', 'wateja, deni la sasa na kilichorejeshwa kwa kila hali',
          s.byState || [],
          [{key:'state', label:'Hali / State', kind:'chip', chip:function(r){
              return (r.state==='Cleared'||r.state==='Reduced') ? 'ok' : (r.state==='Static' ? 'warn' : 'bad'); }},
           col('customers','Wateja','num'), col('curArr','Deni la sasa','money'),
           {key:'recovered', label:'Kilichorejeshwa', kind:'money', cls:function(r){ return r.recovered>0?'good':''; }}])
      + board('ciAnalyst', 'Kwa mchambuzi / By analyst',
          money((s.byAnalyst||[]).length) + ' wachambuzi / analysts', s.byAnalyst || [],
          [{key:'analyst', label:'Mchambuzi / Analyst', cls:function(r){ return r.analyst==='(—)'?'bad':''; }},
           col('customers','Wateja','num'), col('initArr','Msingi','money'), col('curArr','Deni la sasa','money'),
           {key:'recovered', label:'Kilichorejeshwa', kind:'money', cls:function(r){ return r.recovered>0?'good':''; }},
           {key:'cleared', label:'Cleared', kind:'num', cls:function(){ return 'good'; }},
           {key:'reduced', label:'Reduced', kind:'num', cls:function(){ return 'good'; }},
           col('stat','Static','num'),
           {key:'bad', label:'Bad', kind:'num', cls:function(r){ return r.bad>0?'bad':''; }},
           col('success','Success %','pct')])
      + board('ciBranch', 'Kwa tawi / By branch', 'wapi deni lilipo / where the book sits',
          s.byBranch || [],
          [col('branch','Branch'), col('customers','Wateja','num'), col('curArr','Deni la sasa','money'),
           {key:'recovered', label:'Kilichorejeshwa', kind:'money', cls:function(r){ return r.recovered>0?'good':''; }},
           col('success','Success %','pct')]);
    /* The rows the file carries, in the file's own order (biggest debt first), behind the
       ordinary search / Excel / CSV the rest of the system uses. */
    S.rows = d.rows || [];
    S.cols = [col('ref','REF#'), col('full_name','Mteja / Customer'), col('branch','Branch'),
      col('team','Timu / Team'), col('analyst','Mchambuzi / Analyst'),
      {key:'contact', label:'Namba / Contact', kind:'tel'},
      col('guarantor_name','Mdhamini / Guarantor'),
      {key:'guarantor_contact', label:'Namba ya mdhamini', kind:'tel'},
      {key:'paid', label:'Paid', kind:'num', get:function(r){ return (r.paid||0)+'/12'; }},
      col('days','Siku','num'), col('status','Hadhi / Status'),
      col('initArr','Msingi','money'), col('curArr','Deni la sasa','money'),
      {key:'recovered', label:'Kilichorejeshwa', kind:'money', cls:function(r){ return r.recovered>0?'good':''; }},
      {key:'state', label:'Hali / State', kind:'chip', chip:function(r){
        return (r.state==='Cleared'||r.state==='Reduced') ? 'ok' : (r.state==='Static' ? 'warn' : 'bad'); }},
      col('balance','Salio','money'), col('principal','Mkopo','money'), col('disb_date','Tarehe ya mkopo','date')];
    ONROW = openFollowup;
    S.foot = money(d.count) + ' wateja / customers · Count 1–6: ' + money(s.c16);
  });
};

/* MODULE: bonusplan -- this screen lives in public/mod/bonusplan.js and loads when its tab opens (modLoad_). */

VIEWS.perf = function(){
  var a = S.args || {};
  var period = a.period || 'week';
  return srv('perfHistory', { period: period, metric: a.metric || '', scope: a.scope || '' }).then(function(d){
    /* THE BEST IS A PERCENTAGE, NOT A PURSE. "Positions and performance at best of record
       should show be perfomance % and not amounts" -- the amount crowned whoever held the
       biggest book; the percentage crowns whoever did most with theirs. The shillings ride
       along underneath as context, never as the headline. */
    var best = function(scope, metric){
      var top = (d.rows||[]).filter(function(r){ return r.scope===scope && r.metric===metric; })[0];
      return top ? ((top.pct != null ? pct(top.pct) : 'TZS ' + money(top.value)) + ' · ' + top.name) : '—';
    };
    var bestSub = function(scope, metric){
      var top = (d.rows||[]).filter(function(r){ return r.scope===scope && r.metric===metric; })[0];
      return top ? ('TZS ' + money(top.value) + (top.basis ? ' / ' + money(top.basis) : '')) : 'best leader, newest period';
    };
    HEAD = '<div class="kpis">'
      + kpi('Rekodi / Records', money(d.count), d.available ? (d.periods||[]).length + ' periods' : 'not set up yet')
      + kpi('Sales %', best('leader','sales'), bestSub('leader','sales'))
      + kpi('Collection %', best('leader','collection'), bestSub('leader','collection'), 'good')
      + kpi('Recovery %', best('leader','recovery'), bestSub('leader','recovery'), 'good')
      + '</div>'
      + (d.available ? '' : '<div class="note bad">' + esc(d.note) + '</div>')
      + '<div class="note" style="display:block">Majina hapa ni ya WAKATI ULE. Ukibadilisha viongozi kesho, '
      + 'rekodi za nyuma hazibadiliki.<br><i>The names here are as they were AT THE TIME. Reassign a leader '
      + 'tomorrow and every live board re-points with them — these records do not, which is the only thing '
      + 'that makes a year of them worth keeping.</i></div>'
      + bar(['week','month','year'].map(function(p){
          return '<button class="pill'+(p===period?' on':'')+'" data-arg="period" data-val="'+p+'">'
            + (p==='week'?'Wiki / Weekly':p==='month'?'Mwezi / Monthly':'Mwaka / Yearly') + '</button>'; }).join('')
        + '<select data-filter="metric" style="margin-left:auto"><option value="">Vyote / All three</option>'
        + ['sales','collection','recovery'].map(function(m){
            return '<option'+(S.filters.metric===m?' selected':'')+'>'+m+'</option>'; }).join('') + '</select>'
        + '<select data-filter="scope"><option value="">Timu na viongozi / Teams and leaders</option>'
        + ['team','leader'].map(function(x){
            return '<option'+(S.filters.scope===x?' selected':'')+'>'+x+'</option>'; }).join('') + '</select>');
    S.rows = d.rows || [];
    S.cols = [col('period_start','Period','date'),
      {key:'metric', label:'Metric', kind:'chip', chip:function(r){
        return r.metric==='recovery'?'ok':(r.metric==='sales'?'warn':'mut'); }},
      {key:'scope', label:'Team or leader', kind:'chip', chip:function(r){ return r.scope==='leader'?'ok':'mut'; }},
      col('name','Name'), col('position','Position then'),
      // The percentage is the record; the amounts explain it. Order says so.
      col('pct','Perf %','pct'),
      col('value','Value','money'), col('basis','Out of','money'),
      col('recorded_at','Recorded','dt')];
    S.foot = 'Imehifadhiwa wakati ripoti ya wiki ilipofunguliwa. / Written when the weekly report is opened.';
  });
};

VIEWS.audit = function(){
  var a = S.args || {};
  /* First open shows TODAY's acts, not the whole history -- the question this screen usually
     answers is "what just happened", and 300 rows of last week buries it. Only truly unset
     dates get the default: a field the reader has cleared on purpose (undefined vs '') stays
     cleared, so the full log is still one erase away. */
  if (a.from === undefined && a.to === undefined) { a.from = today(); a.to = today(); S.args = a; }
  return srv('auditLog', { limit: 300, actor: a.actor || '', action: a.action || '',
                           from: a.from || '', to: a.to || '' }).then(function(d){
    var bad = (d.rows || []).filter(function(r){ return !r.ok; }).length;
    HEAD = '<div class="kpis">'
      + kpi('Matendo / Actions', money(d.count), d.available ? 'newest first' : 'not set up yet')
      + kpi('Yaliyoshindwa / Refused', money(bad), 'attempts that were blocked or failed', bad?'bad':'good')
      + kpi('Watu / People', money((d.actors||[]).length))
      + '</div>'
      + (d.available ? '' : '<div class="note bad">' + esc(d.note) + '</div>')
      + bar('<input type="date" data-arg="from" value="'+esc(a.from||'')+'">'
        + '<input type="date" data-arg="to" value="'+esc(a.to||'')+'">'
        + '<select data-filter="action"><option value="">Matendo yote / Every action</option>'
        + (d.actions||[]).map(function(x){
            return '<option'+(S.filters.action===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('') + '</select>'
        + '<select data-filter="actor_name"><option value="">Kila mtu / Everyone</option>'
        + (d.actors||[]).map(function(x){
            return '<option'+(S.filters.actor_name===x?' selected':'')+'>'+esc(x)+'</option>'; }).join('') + '</select>');
    S.rows = d.rows || [];
    S.cols = [col('at','When','dt'), col('actor_name','Who'), col('actor_role','Role'),
      col('action','Action'),
      {key:'ok', label:'Result', kind:'chip', chip:function(r){ return r.ok?'ok':'bad'; },
       get:function(r){ return r.ok ? 'OK' : 'REFUSED'; }},
      col('team','Team'), col('ref','REF'), col('subject','What'),
      col('error','Why not'), col('ms','ms','num')];
    S.foot = 'Kumbukumbu haihifadhi maudhui — majina, namba na maoni hayamo. '
      + '/ The log records the act, not the data: no amounts, no phone numbers, no comment text.';
  });
};

/* "put their live location link on their rows in settings nav system view not call view" --
   officers signed into the ordinary HOPE Calls app (no lock app needed, see officerBeat).
   Reached from a button on Settings; a real page of its own rather than a table squeezed onto
   an already-busy screen. */
VIEWS.officerloc = function(){
  return srv('officerLocationsList').then(function(d){
    var rows = (d.rows || []).slice().sort(function(a, b){
      return String(b.last_loc_at || '').localeCompare(String(a.last_loc_at || ''));
    });
    var calls = rows.filter(function(r){ return r.source === 'calls'; }).length;
    /* THE SCREEN SAYS HOW MUCH IT CANNOT SEE: the officers who synced HOPE Calls this week, beside
       the ones that have reported a position. A list that looks complete and is not is how an
       officer ran off with 567k and nobody could be found. */
    HEAD = '<div class="kpis">' + kpi('Wenye mahali / Reporting', money(rows.length))
      + kpi('HOPE Calls zenye mahali / Call-app officers located', money(calls))
      + (d.callUsers7d != null ? kpi('Maafisa wa HOPE Calls wiki hii / Call-app officers, 7 days', money(d.callUsers7d)) : '') + '</div>'
      + (d.callsReady === false
        ? '<div class="note bad">Maafisa wa HOPE Calls hawajaanza kuripoti: endesha db/RUN-ME-2026-10-17-call-locations.sql kwenye Supabase. / '
          + 'Call-app officers cannot report yet: run db/RUN-ME-2026-10-17-call-locations.sql in Supabase. Until then this list is portal codes only.</div>'
        : '')
      + '<div class="card"><div class="card-h">Mahali walipo maafisa / Officer locations'
      + '<span class="sub">Ramani inafunguliwa kwenye kivinjari / Maps opens in the browser</span></div>'
      + (!rows.length
        ? '<div class="note">Hakuna aliyeripoti mahali bado. Inahitaji ruhusa ya location ikiwa imeruhusiwa kwenye simu, na programu ifunguliwe. / '
          + 'Nobody has reported a position yet. It needs location permission granted on the phone, and the app to have been opened.</div>'
        /* "am not seeing location link at locations" -- it was there, as the LAST of six
           columns, in a table with no scroll box: on a phone that column sat past the right
           edge, clipped. The link is now the officer's own name in the FIRST column, so it
           is on screen whatever the width, and the table scrolls like every other one here.
           With three hundred rows the list also has a search box: a name, a team or a number. */
        : '<div class="fld" style="margin:8px 14px"><input id="olQ" placeholder="Tafuta jina, timu au namba / Search name, team or number" '
          + 'oninput="olFilter_(this.value)" autocomplete="off"></div>'
          + '<div class="scroll"><table id="olTable"><thead><tr><th>Jina / Name (bonyeza = ramani / tap = map)</th><th>Chanzo / Source</th><th>Wadhifa / Role</th><th>Timu / Team</th>'
          + '<th>Simu / Phone</th><th>Usahihi / Accuracy</th><th>Ilipimwa / Fix taken</th><th>Ilisawazisha / Last sync</th></tr></thead><tbody>'
          + rows.map(function(r){
              var teams = (r.teams || []).join(', ') || 'zote / all';
              var mapUrl = 'https://www.google.com/maps?q=' + encodeURIComponent(r.last_lat) + ',' + encodeURIComponent(r.last_lng);
              return '<tr><td><a href="' + esc(mapUrl) + '" target="_blank" rel="noopener" class="btn sm ghost">📍 ' + esc(r.name) + '</a></td>'
                + '<td>' + (r.source === 'calls' ? 'HOPE Calls' : 'HOPE PMO') + '</td>'
                + '<td>' + esc(r.role) + '</td><td>' + esc(teams) + '</td>'
                + '<td>' + esc(r.phone || '—') + '</td>'
                + '<td>' + (r.last_loc_acc != null ? '±' + esc(r.last_loc_acc) + 'm' : '—') + '</td>'
                + '<td>' + esc(devAgo_(r.last_loc_at)) + '</td>'
                + '<td>' + (r.last_sync ? esc(devAgo_(r.last_sync)) : '—') + '</td></tr>';
            }).join('')
          + '</tbody></table></div>')
      + '</div>';
    S.rows = []; S.cols = null;
    ONROW = null;
  });
};
/* The search box on that list: hides rows whose text does not contain what was typed. Plain DOM,
   no server round trip -- the whole list is already on the page. */
function olFilter_(q){
  var t = document.getElementById('olTable'); if (!t) return;
  var needle = String(q || '').trim().toLowerCase();
  Array.prototype.forEach.call(t.tBodies[0].rows, function(tr){
    tr.style.display = !needle || tr.textContent.toLowerCase().indexOf(needle) >= 0 ? '' : 'none';
  });
}

