/* present -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/present.js?v=BUILD. */

/* PRESENTATION — a real projector mode, not a card on a page: it goes full screen, plays
   like a deck for the office TV, auto-advances, and takes arrow keys / Esc. Each slide is a
   whole board (the same numbers the tabs show), so a meeting reads live figures rather than
   a screenshot someone exported that morning. */
VIEWS.present = function(){
  // BOTH halves take the same week, or the slides would pair one week's cards against another
  // week's officer boards -- which is the sort of thing nobody notices in a dark room.
  var wk = { weekOf: S.args.weekOf || '' };
  S.presWk = wk;
  /* ONE READ, THEN THE OTHER -- NOT BOTH AT ONCE, AND NEITHER TAKES THE OTHER DOWN.

       "server not responding in time - presentation page aint loading"

     This asked for the dashboard AND the officer boards in one Promise.all: the two heaviest
     answers in the system, fired side by side at the same database, and the first to fail took
     the whole page with it -- the person got one red sentence and nothing to project. The
     dashboard tab learned this months ago (DASH_LOAD_BOARDS_: the boards wait for the core and
     fail in their own place) and this screen never did.

     Now the dashboard answers first and the page is drawn from it at once; the boards are asked
     for on their own AFTER it has answered, so the two never compete for the same database, and
     if they do not arrive the deck says so on a slide of its own -- the reason, and a retry --
     while the slides that need only the dashboard play as normal. A timeout on the dashboard
     read runs the same self-diagnosis the dashboard tab runs (failed(), dashProbe_). */
  return srv('dashboardFull', wk).then(function(d){
    /* KEPT, so ticking a segment box does not go back to the server. Rebuilding this screen is
       the most expensive thing the system does -- the dashboard AND the officer boards, a
       hundred-odd round trips -- and it was being done again on every tick of every checkbox.
       The figures do not change because somebody chose not to project a slide. */
    S.presData = { d: d, b: null, bWhy: '', bLoading: false, ded: null, dedWhy: '', dedLoading: false };
    S.presUpdated = new Date();
    presRender();
    // The boards, THEN the week's deduction cases: three answers one after another, the small one last (presDed_).
    presBoards_(wk).then(function(){ return presDed_(wk); });
  });
};

/** The officer boards, asked for on their own once the dashboard is up. Whatever comes back --
    the boards or the reason they did not -- lands on the figures this page was built from, and
    the page and the deck are redrawn in place; nothing is drawn if the person has moved on to
    another tab or another week in the meantime. */
function presBoards_(wk){
  var mine = S.presData;
  if (!mine) return Promise.resolve();
  mine.bLoading = true; mine.bWhy = '';
  return srv('officerBoards', wk).then(function(b){ mine.b = b; mine.bWhy = ''; },
    function(e){ mine.bWhy = String((e && e.message) || e); })
    .then(function(){
      mine.bLoading = false;
      if (S.presData !== mine || S.view !== 'present') return;
      presRedraw_();
    });
}

/** THE WEEK'S DEDUCTION CASES, PER TEAM -- "at abnormal card in presentation - show weekly deduction case counts per team counts too. so that i get the impact
    from that view" (the owner, 25 Nov 2026; handbook Part 164, addendum 6). Asked for on their own AFTER the officer boards have answered, the same week as the other
    two (`wk`), and only for a person who holds the PMO Deduction tab: the server's gate says the same (FN_TAB `deduct`), so nobody else is even asked. One narrow read of
    a week's lines, nothing like the two before it. A miss never takes anything else with it: it is said on the page (presRender) and on the slide that needs it
    (presAbnDedSlide_), and the tile's line says "—". */
function presDed_(wk){
  var mine = S.presData;
  if (!mine || !allowed('deduct')) return Promise.resolve();
  mine.dedLoading = true; mine.dedWhy = '';
  return srv('deductionsWeek', wk).then(function(x){ mine.ded = x; mine.dedWhy = ''; },
    function(e){ mine.dedWhy = String((e && e.message) || e); })
    .then(function(){
      mine.dedLoading = false;
      if (S.presData !== mine || S.view !== 'present') return;
      presRedraw_();
    });
}

/** The same read on the deck's refresh (presRefetch): a miss keeps the last answer drawn, and says so only when there never was one. */
function presDedAgain_(wk, mine){
  if (!mine || !allowed('deduct')) return Promise.resolve();
  return srv('deductionsWeek', wk).then(function(x){ mine.ded = x; mine.dedWhy = ''; },
    function(e){ if (!mine.ded) mine.dedWhy = String((e && e.message) || e); });
}

/** Rebuild the segment page and, if the deck is playing, the slide on the wall -- staying on
    the slide it was on. */
function presRedraw_(){
  var el = document.getElementById('pres');
  var playing = el && el.style.display === 'block';
  var keep = S.presI || 0;
  presRender();
  paint(true);
  if (playing){ S.presI = Math.min(keep, Math.max(0, S.slides.length - 1)); presDraw(); }
}

/* THE DECK KEEPS UP WITH THE DAY -- "Hopecalls in presentation aint autoupdating".
   The figures were fetched once, when the tab opened, and then the deck ran on them all
   morning: the calls slide showed the office the calls of whatever minute somebody pressed
   Play. While the deck is PLAYING it now asks again every few minutes -- the same two calls
   the tab makes, both cached on the server for a minute, so an office television costs the
   database what one person opening the tab would -- rebuilds the slides in place and stays
   on the slide it was on. The header says when the figures were last fetched, so a room can
   tell a live deck from a frozen one. Stopped when the deck stops. */
var PRES_REFRESH_MS = 3 * 60 * 1000;

function presRefetch(){
  if (document.getElementById('pres').style.display !== 'block') return;
  presCheckBuild_();
  var wk = S.presWk || { weekOf: S.args.weekOf || '' };
  var mine = S.presData;
  // The same order as the tab's first load: the dashboard, THEN the boards, never side by side.
  // A miss on the boards keeps the last boards drawn; a miss on the dashboard keeps everything.
  srv('dashboardFull', wk).then(function(d){
    if (S.presData !== mine) return;
    mine.d = d;
    return srv('officerBoards', wk).then(function(b){ mine.b = b; mine.bWhy = ''; }, function(){})
      .then(function(){ return presDedAgain_(wk, mine); });
  }).then(function(){
    if (S.presData !== mine || !mine.d) return;
    S.presUpdated = new Date();
    var keep = S.presI;
    presApply();
    S.presI = Math.min(keep, Math.max(0, S.slides.length - 1));
    if (document.getElementById('pres').style.display === 'block') presDraw();
  }).catch(function(){ /* a missed refresh keeps the last figures; the stamp says how old they are */ });
}

/** THE ABNORMAL CARD'S LINE: the week's deduction cases, under the figure (handbook Part 164, addendum 6). "N deduction cases this week" when the server has answered, "— deduction
    cases this week" when it was asked and did not (a dash is "not known", never a nought: a real nought reads "0 deduction cases"), and NO line at all while the answer is on its
    way, when the table is not there (RUN-ME-043: the PMO Deduction tab itself says so) and for a person who does not hold the PMO Deduction tab -- who is not even told there is
    such a figure. Pure: it reads only what it is handed. */
function presDedLine_(pd){
  if (!pd || !allowed('deduct')) return '';
  var x = pd.ded;
  if (x && x.on === false) return '';
  // an answer with no count (damaged, or an older server) is "not known", the same dash as a failed read: never a nought
  if (x){ var n = x.cases; return typeof n === 'number' && isFinite(n) ? money(n) + ' deduction case' + (n === 1 ? '' : 's') + ' this week' : '\u2014 deduction cases this week'; }
  return pd.dedWhy ? '\u2014 deduction cases this week' : '';
}

/** THE ABNORMAL CARD'S PER-TEAM VIEW -- "show weekly deduction case counts per team counts too. so that i get the impact from that view" (the owner, 25 Nov 2026).
    One row for each team that has an abnormal payment flagged or a deduction case this week: the abnormal payments the Abnormal card counts (the dashboard's own per-team count,
    d.teamPerf[].abnormal, so the card's figure is the sum of the column) beside the week's deduction cases (deductionsWeek: the cases the PMO Deduction tab counts, a case once
    however many staff it names), the teams with most cases first, then the most abnormal payments. Twelve rows and, when there are more teams, ONE last row for all the others,
    so that the JUMLA row is always the whole of what the card says and never the whole of what fitted. While the cases are on their way, or if they did not come, their column is
    BLANK (not known, never a nought) and the caption says which; for a person who does not hold the PMO Deduction tab there is no such slide. Pure: it reads only what it is
    handed, and the rows carry `team`, so the deck's own team filter (presApply) scopes it like every other board. */
function presAbnDedSlide_(d, pd){
  if (!allowed('deduct')) return null;
  var x = pd && pd.ded, on = !!x && x.on !== false;
  var key = function(t){ return String(t == null ? '' : t).trim().toUpperCase(); };
  var by = {}, order = [];
  var row = function(team){
    var k = key(team);
    if (!by[k]){ by[k] = { team: String(team == null || team === '' ? '\u2014' : team), abnormal: 0, dedCases: on ? 0 : null }; order.push(k); }
    return by[k]; };
  // a damaged answer (a list that is not a list) never takes the deck down with it: it is read as no rows
  (Array.isArray(d.teamPerf) ? d.teamPerf : []).forEach(function(t){ if (t) row(t.team).abnormal = Number(t.abnormal) || 0; });
  if (on) (Array.isArray(x.teams) ? x.teams : []).forEach(function(t){ if (t) row(t.team).dedCases = Number(t.cases) || 0; });
  var list = order.map(function(k){ return by[k]; }).filter(function(r){ return r.abnormal > 0 || r.dedCases > 0; });
  list.sort(function(a, b){ return ((b.dedCases || 0) - (a.dedCases || 0)) || (b.abnormal - a.abnormal) || String(a.team).localeCompare(String(b.team)); });
  var SHOW = 12, rows = list.slice(0, SHOW), rest = list.slice(SHOW);
  if (rest.length) rows.push({ team: 'Timu nyingine / Other teams (' + rest.length + ')',
    abnormal: rest.reduce(function(s2, r){ return s2 + r.abnormal; }, 0),
    dedCases: on ? rest.reduce(function(s2, r){ return s2 + (r.dedCases || 0); }, 0) : null });
  var state = on ? ''
    : x ? '<div>\u26a0 Jedwali la makato halipo / the deductions table is not there yet \u2014 ' + esc(x.note || '') + '</div>'
    : pd && pd.dedWhy ? '<div>\u26a0 Kesi za makato hazikupakia / the deduction cases did not load \u2014 ' + esc(pd.dedWhy) + '</div>'
    : '<div>\u23f3 Kesi za makato zinapakia / the deduction cases are loading</div>';
  var wk = on ? '<div>Wiki / Week: ' + esc(x.weekOf) + ' \u2192 ' + esc(x.weekEnd) + ' \u00b7 Timu zenye kesi / teams with a deduction case: '
      + money(Array.isArray(x.teams) ? x.teams.length : 0) + ' / ' + money(Array.isArray(d.teamPerf) ? d.teamPerf.length : 0) + '</div>'
      + (list.length ? '' : '<div>Hakuna kesi za makato wala malipo yasiyo ya kawaida wiki hii / no deduction cases and no abnormal payments this week</div>') : '';
  return { id:'abndeduct', kind:'table', tcls:'pcolabn',
    title:'Abnormal payments & deduction cases \u2014 kwa timu / per team \u00b7 wiki hii / this week',
    caption: state + wk
      + '<div>Abnormal = malipo yaliyowekwa alama kwenye kadi ya Abnormal (jumla ni namba ya kadi) \u00b7 Deduction cases = kesi za kipekee za makato za PMO zilizoripotiwa wiki hii, kesi moja mara moja hata ikiwa na wafanyakazi wengi'
      + ' / Abnormal = the payments flagged on the Abnormal card (the total is the card\'s own number) \u00b7 Deduction cases = unique PMO deduction cases reported this week, a case counted once however many staff it names</div>',
    rows: rows,
    cols:[col('team','Team'), col('abnormal','Abnormal payments','num'), col('dedCases','Deduction cases (week)','num')] };
}

/** Build every slide from the figures already in hand. Filtering (which segments, which team)
    happens afterwards in presApply, so a choice never costs a request. */
function presSlides(){
    var d = S.presData.d, b = S.presData.b, c = d.cards;
    var dedLine = presDedLine_(S.presData);
    var slides = [];
    /* THE DAY'S TWELVE: FOUR ACROSS, THREE DOWN, FILLING THE TV -- "Add 6 widgets to hope pmo overall slide at presentation so that they
       are 4x3 full on our tv (HOPE PMO - DAY slide)" (the owner, 25 Nov 2026; handbook Part 164). Every figure is one the dashboard's own
       answer already carries, worked out by the server and only printed here, so the wall and the dashboard can never say two different
       things. Nothing is read for them: the answer is the one this slide already stood on.
       THE OWNER HAS CHANGED THE SLIDE FIVE TIMES THE SAME DAY, AND LEFT US THE CHOICE EACH TIME (handbook Part 164, addenda 1 to 3 and 5):
         "replace initial arreas widget with anything else thats crucial in the presentation hope pmo day slide summary": Initial arrears went;
         the week's recovery in shillings took its place (the Weekly recovery trend's own TOTAL, d.recTrendTotal, added up from its days the
         way the dashboard does when the server did not send it).
         "combine % of sales, and of recovered at their amounts and replace with any other meaningful widgets": the strip's Sales % is
         printed UNDER Sales this week and Recovery % UNDER Recovered this week (the week's, the percentage's own week), each as a line `s`
         beneath the figure; the two tiles left free became the week's Expected Defaulters recovery (d.edrTrendTotal: the dashboard's own
         card, a dash while the database has not answered it) and the strip's Performance average (d.perf.avgPct).
         "also cleared today to defaulters, add another meaningful widget" and "col% and uncollected today also in a single widget. add
         another meaningful one": Cleared today is printed UNDER Defaulters ("4,321 cleared today") and the strip's Collection % UNDER
         Uncollected today ("97% collected this week"); the two tiles left free became the week's Loan applications (d.perf.appsCount, with
         the amount asked, d.perf.appsAmount) and the week's Legal recovery (d.legal.grand.total: notices and calls together, the
         dashboard's own Legal card figure, a dash while either side cannot be read).
         "combine recovered today and this week, add another meaningful widget" · "show collection today% at uncollected today" · "ealry
         col% and col% week on their own widget" (addendum 5): Recovered (today's) and Recovered this week are ONE tile, the week's figure with
         its percentage and then today's amount under it (two lines: a tile's `s` may be an array); the freed tile is Sales today (the Sales
         trend card's tile for today: the approved principal, the loans, the percentage of the daily target); Uncollected today carries
         today's collection % (the Weekly expected trend card's tile for today) where the week's was; and the week's Collection % leaves
         it to stand beside the Early collection % on a tile of their own; and the Legal recovery tile says how much of its figure came BY PHONE
         ("legal recovery widget on presentation, have their phone recovery in the same widget"), a second line under it.
       A percentage the week cannot measure is a dash, never a nought. The owner can name other widgets and each is one line here. The grid
       is `grid:'4x3'` (a class and a fit in presDraw / presFit_), so a slide that asks for nothing is drawn exactly as before. */
    var pf = d.perf || {};
    var weekRecovered = d.recTrendTotal ? d.recTrendTotal.recovered : (d.recTrend || []).reduce(function(s, x){ return s + (Number(x && x.recovered) || 0); }, 0);
    var DASH_ = '—';
    /* a percentage written under its amount ("84% of target"); a dash alone when there is nothing to measure (fmt is pct or pct1, which say so) */
    var under = function(fmt, p, words){ var t = fmt(p); return t === DASH_ ? t : t + ' ' + words; };
    /* TODAY'S OWN ENTRY of a per-day card of the dashboard (the Weekly expected trend, the Sales trend): the day the dashboard's own clock says it
       is (asOfDate), found by its date -- or by its weekday when an answer carries no date. Null when the card has no such day (a weekend has no
       collection sheet; Sunday has no sales day): the tile then prints a dash, never a nought. */
    var dayNow = function(list){
      var a = d.asOfDate;
      return (list || []).filter(function(x){ return !!x && (a ? x.date === a : x.weekday === d.weekday); })[0] || null;
    };
    var colNow = dayNow(d.colTrend), salesNow = dayNow(d.salesTrend);
    /* the week's Expected Defaulters recovery: the dashboard's own total, and only when the database answered it (edrNote says it did not)
       and at least one day of the week has its two files (a week with none reads "not uploaded yet" on the dashboard, never a nought) */
    var edr = d.edrTrendTotal, edrOn = !!edr && !d.edrNote && (d.edrTrend || []).some(function(x){ return !!(x && x.uploaded); });
    /* the week's Legal recovery: the dashboard's own Legal card figure, notices AND calls together (legalGrand_'s total row: a customer served
       a notice and phoned counts once). Null on a side that cannot be read (the ledger not there, db/RUN-ME-089 not run, a phone read that
       failed or was late), and a grand figure that silently left a side out would read as a result: a dash, and no line, then */
    var lg = d.legal && d.legal.grand, lgOn = !!lg && lg.on === true && !!lg.total && lg.total.recovered != null;
    /* the week's loan applications: the strip's own count (every application that ARRIVED this week, whatever stage it is at now) */
    var appsOn = pf.appsCount != null;
    /* TODAY'S SALES: the Sales trend card's own tile for today (what the dashboard prints for the day: the approved principal, the loans, the
       percentage of the daily target), so the wall and the dashboard cannot say two different things */
    var loansTxt = function(n){ n = Number(n) || 0; return n === 1 ? '1 loan' : money(n) + ' loans'; };
    var salesTodayLine = function(){
      if (!salesNow) return '';
      var p = pct(salesNow.pct);
      return loansTxt(salesNow.loans) + (p === DASH_ ? '' : ' · ' + p + ' of target');
    };
    slides.push({ id:'kpi', kind:'kpi', grid:'4x3', title:'HOPE PMO — ' + d.weekday, items:[
      { l:'Current arrears', v:'TZS '+money(c.curArrears) },
      /* RECOVERED, TODAY'S AND THE WEEK'S IN ONE TILE ("combine recovered today and this week"): the week's money is the figure, and under it the
         percentage that belongs to it, then today's -- two lines, which a tile may carry (`s` as an array) */
      { l:'Recovered this week', v:'TZS '+money(weekRecovered), s:[under(pct, pf.recPct, 'of uncollected'), 'TZS '+money(c.recovered)+' today'] },
      { l:'Defaulters', v:money(c.defaulters), s:money(c.cleared)+' cleared today' },
      { l:'Sales this week', v:'TZS '+money(c.salesWeek), s:under(pct, pf.salesPct, 'of target') },
      /* COLLECTION TODAY % AT UNCOLLECTED TODAY ("show collection today% at uncollected today"): the Weekly expected trend card's own percentage
         for today (collected over expected, the day's sheet), where the week's used to be */
      { l:'Uncollected today', v:'TZS '+money(c.uncollectedToday), s:under(pct, colNow ? colNow.pct : null, 'collected today') },
      /* AND THE WEEK'S DEDUCTION CASES UNDER IT ("at abnormal card in presentation - show weekly deduction case counts per team counts too. so that i get the
         impact from that view", the owner, 25 Nov 2026; addendum 6): the line is made above (presDedLine_), because the cases are a read of their own and not a field
         of the dashboard's answer; nothing is read here. Their per-team counts are the slide that follows this one. */
      { l:'Abnormal', v:money(c.abnormal), s:dedLine },
      { l:'Sales today', v:salesNow ? 'TZS '+money(salesNow.amount) : DASH_, s:salesTodayLine() },
      { l:'Loan applications (week)', v:appsOn ? money(pf.appsCount) : DASH_, s:appsOn ? 'TZS '+money(pf.appsAmount)+' requested' : '' },
      /* EARLY COL % AND COL % (WEEK) ON THEIR OWN WIDGET ("ealry col% and col% week on their own widget"): the strip's two collection percentages
         side by side, the early one first as the owner wrote it, each a dash when the week cannot measure it */
      { l:'Early col · Col % (week)', v:pct(pf.ecolPct)+' · '+pct(pf.colPct) },
      /* THE PHONE'S SHARE IS SAID ON THE SAME TILE ("legal recovery widget on presentation, have their phone recovery in the same widget", the
         owner, 25 Nov 2026, addendum 5): the figure was always notices and calls TOGETHER (the grand total), but nothing on the tile said so. Under
         it: the percentage of what the two were owed, then the part that came by phone (the calls side of the grand total, `cRec`: a customer
         served a notice and phoned counts once, under notices). A dash for it if an answer has the total and not its parts. */
      { l:'Legal recovery (week)', v:lgOn ? 'TZS '+money(lg.total.recovered) : DASH_, s:lgOn ? [under(pct, lg.total.pct, 'of owed'), 'by phone ' + (lg.total.cRec != null ? 'TZS '+money(lg.total.cRec) : DASH_)] : '' },
      { l:'Exp.Def recovery (week)', v:edrOn ? 'TZS '+money(edr.recovered) : DASH_, s:edrOn ? under(pct1, edr.pct, 'of their arrears') : '' },
      { l:'Performance (average)', v:pct(pf.avgPct), s:'sales · collection · recovery' }]});
    /* THE ABNORMAL CARD'S PER-TEAM VIEW: the slide right after the day's, whose Abnormal tile it explains. Built from the dashboard's answer and the deduction read,
       never from the officer boards, so it is in the deck whether or not they arrive; absent for a person who does not hold the PMO Deduction tab. */
    var abnDed = presAbnDedSlide_(d, S.presData);
    if (abnDed) slides.push(abnDed);
    /* TEAM PERFORMANCE. Ranked on the average of sales and collection, highest first -- a team
       that sells well and collects badly is not a good team, and neither is the reverse.

       "Uncollected" and "Collection %" follow the same basis as the recovery denominator:
       today from Monday to Friday, the whole week at the weekend. Recovery % is shown against
       all three denominators at once, because which one applies changes with the day and the
       room wants to see the comparison rather than be told which to look at. */
    var tpBasis = d.teamPerf && d.teamPerf.length ? d.teamPerf[0].basis : 'today';
    var tpLab = tpBasis === 'week' ? ' (week)' : ' (today)';
    slides.push({ id:'teams', kind:'table', title:'Team performance — best first', rows:d.teamPerf.slice(0,12),
      cols:[col('branch','Branch'), col('team','Team'),
        col('salesMonth','Monthly sales','money'),
        col('curArrears','Total def','money'), col('defaulters','No. of def','num'),
        col('uncollected','Uncollected'+tpLab,'money'), col('collPct','Collection %'+tpLab,'pct'),
        col('recPctMon','Rec % vs Mon','pct'), col('recPctYest','Rec % vs yest','pct'),
        col('recPctWeek','Rec % vs week','pct')] });
    // Built here, pushed in its usual place below -- or right after the note when the boards
    // are missing, so the deck keeps the slides that need only the dashboard.
    var coltrend = { id:'coltrend', kind:'table', title:'Weekly collection trend', rows:d.colTrend,
      cols:[col('weekday','Day'), col('expected','Expected','money'), col('collected','Collected','money'),
        col('uncollected','Uncollected','money'), {key:'pct', label:'Coll %', kind:'pct', target:'col'}] };
    /* NO BOARDS YET, OR NONE AT ALL: one slide says so in their place -- while they load, and
       with the reason if they did not -- rather than the whole deck refusing to play. Every
       slide below this point reads b; the ones above and coltrend read only the dashboard. */
    if (!b){
      slides.push({ id:'boards', kind:'note', title:'Bodi za maafisa / Officer boards', rows:[],
        text: S.presData.bLoading
          ? '⏳ Zinapakia… / Loading… — slaidi za dashibodi ziko tayari / the dashboard slides are ready'
          : '⚠ Hazikupakia / Did not load — ' + (S.presData.bWhy || '')
            + '\n(bofya Jaribu tena kwenye ukurasa / press Retry on the page)' });
      slides.push(coltrend);
      return slides;
    }
    /* THE LABEL, NOT JUST THE FIGURE -- "am seeing the header saying yesterday on screen here
       so am confused b/se i know we using todays". It was: this said "yesterday" Tuesday
       through Friday while the row beside it (b.recToday) was already today's uncollected --
       "everywhere uses jana except only where there is recovery officers like in their
       commissions, their personal reports and presentation by rec officer" (see recToday's own
       note in officerBoards, portal-core.js). The label here was never moved when that rule
       was fixed, so the header kept naming the OLD denominator under the NEW figure. Officers
       chase today's own uncollected every weekday; only the weekend, which has no sheet of its
       own, reads the week's. */
    var recBasis = d.weekday === 'SAT' || d.weekday === 'SUN' ? 'week' : 'today';
    var recUncolLabel = recBasis === 'week' ? 'Uncollected (week)' : 'Uncollected (today)';
    /* Today and the week on one slide, joined on the officer -- the same rule as every other
       role board here. Today's recovery is divided by the basis above; the week's always by the
       week, which is what makes it the weekly figure rather than a second copy of the daily. */
    var recT = {};
    (b.recToday || []).forEach(function(x){ recT[x.officer] = x; });
    /* RANKED ON THE WEEK'S REC %, NOT THE AMOUNT. recBoard (officerBoards, portal-core.js)
       orders b.recWeek by recovered TZS, which is right for a board someone is paid on -- but
       on a wall the sum favours whoever holds the biggest book, not whoever is doing the best
       job of shrinking it. Same convention earlyBoard already sorts by: null (unmeasured) sinks
       to the bottom rather than reading as a beaten zero. This re-sorts the presentation's own
       copy of the rows -- the commission board and the Dashboard's officer-board widget keep
       reading b.recWeek exactly as recBoard ordered it, since neither asked to change. */
    var recRows = (b.recWeek || []).map(function(x){
      var t = recT[x.officer] || {};
      /* TODAY'S OWN DECK PAIR rides along for the two columns before the today group: the
         initial deck and the current deck of the day, which Recovered today is the difference
         of. The weekly board's own initial/current (Monday's deck against today's) are not
         drawn here: a week of new defaulters puts them the wrong way round under a positive
         recovery, and a five-day sum of them (#536) read as billions. */
      return { ...x, tInitial: t.initial, tCurrent: t.current,
        tUncollected: t.uncollected, tRecovered: t.recovered, tPct: t.pct }; })
      .sort(function(a, b2){ return (b2.pct == null ? -1 : b2.pct) - (a.pct == null ? -1 : a.pct)
        || String(a.officer).localeCompare(String(b2.officer)); });
    /* THE UNASSIGNED TEAMS, EACH UNIT'S LINE UNDER ITS OWN SLIDE -- "take the unassigned lists
       text beneath to their respective 3 slides not all in collection, col in col, rec in rec
       and early col in early col". One heading, one line, a count and the names, the way a
       figure caption sits under a table in a document; fed by officerBoards' unassignedTeams.
       It began as three lines under the collection slide alone ("todays collection is so
       essential so i always need to see the alert from there"); that slide keeps its own. */
    var ua = b.unassignedTeams || { early: [], col: [], rec: [] };
    var uaLine = function(label, list){
      return '<div><b>' + label + ' (' + list.length + '):</b> ' + (list.length ? esc(list.join(', ')) : '—') + '</div>'; };
    var uaCap = function(label, list){ return '<div class="pcaph">Unassigned:</div>' + uaLine(label, list); };
    slides.push({ id:'recovery', kind:'table', title:'Recovery by officer — best weekly Rec % first',
      rows: recRows.slice(0,12),
      caption: uaCap('Rec', ua.rec),
      /* INITIAL AND CURRENT ARE TODAY'S OWN DECKS -- the pair Recovered today is the
         difference of, drawn beside the today group they belong to. "The two columns are
         misbehaving": Monday's deck against today's read the wrong way round under a positive
         weekly recovery, and the week's five decks added up read as billions. The day's own
         pair is a book-sized figure that always reconciles: Initial - Current = Recovered today. */
      cols:[col('officer','Officer'), col('teams','Teams','num'),
        col('tInitial','Initial (today)','money'), col('tCurrent','Current (today)','money'),
        col('tUncollected', recUncolLabel, 'money'),
        col('tRecovered','Recovered today','money'), {key:'tPct', label:'Rec % (today)', kind:'pct', target:'rec'},
        col('uncollected','Uncollected (week)','money'),
        col('recovered','Recovered (week)','money'), {key:'pct', label:'Rec % (week)', kind:'pct', target:'rec', from:['recovered','uncollected']}] });
    /* Read the same way as PMO Collection, because it answers the same question about a
       different set of officers: how many teams, what is still out, and what share came in.
       The paid/overpaid counts are what the commission is worked out FROM, so they belong on
       the commission panel and not on a wall. */
    /* Early collection is judged on the list of who is due NEXT -- the INITIAL expected report
       here -- so "today" on this board is tomorrow's performance: what the officer has already
       brought in against a day that has not arrived. The two periods share one slide, joined
       on the officer. */
    /* THE CAPTION UNDER A SLIDE WHOSE COUNT 1 HAS GAPS: which teams' rows of WHICH sheet carry
       no N.C -- an upload made before db/RUN-ME-039 was run, or a file without the column -- so
       the person at the upload page knows exactly which file to send again. Empty when every
       officer has a figure. `none` is "every row is blank", `missing` the teams the server
       named, `sheet` the sheet as the upload page calls it. */
    var count1Note_ = function(none, missing, sheet){
      var teams = (missing || []).slice();
      if (!none && !teams.length) return '';
      var who = teams.length ? teams.join(', ') : 'timu zote / every team';
      return 'Count 1 haipo kwa: ' + esc(who) + ' — safu za karatasi ya ' + esc(sheet) + ' hazina N.C'
        + ' (ilipakiwa kabla ya db/RUN-ME-039 kuendeshwa, au faili halina safu hiyo). Pakia tena karatasi hiyo hiyo ya timu hizo.'
        + ' / Count 1 missing for: ' + esc(who) + ' — the ' + esc(sheet) + ' sheet rows carry no N.C'
        + ' (uploaded before db/RUN-ME-039 was run, or the file has no such column). Upload that same sheet again for those teams.';
    };
    var earlyW = {};
    (b.earlyWeek || []).forEach(function(x){ earlyW[x.officer] = x; });
    var earlyRows = (b.earlyToday || []).map(function(x){
      var w = earlyW[x.officer] || {};
      // The week's two amounts ride along so the JUMLA cell is their ratio (PCT_FROM.wPct).
      return { ...x, wUncollected: w.uncollected, wPct: w.pct, wCollected: w.collected, wExpected: w.expected }; });
    slides.push({ id:'early', kind:'table', tcls:'pcolearly',
      /* "today means of tomorrow": the first pair is the list for the day AHEAD (its date in
         the title), the second the week's initial sheets -- each day's latest upload, the
         ratio of their sums. */
      title:'Early collection — kesho / next list' + (b.earlyDate ? ' (' + b.earlyDate + ')' : '') + ' and this week',
      rows: earlyRows.slice(0,12),
      /* WHO IS STILL TO PAY, as a count, beside how many are on the list -- "put nos of
         remaining (unpaid+underpaid) ... so that we always know progress of each like 300 where
         ... paid+overpaid 600 of 900 total customers". Two plain numbers rather than "300 / 900"
         in one cell, so the JUMLA row can add each of them up. */
      /* COUNT 1 BETWEEN THEM -- "add Count1", then "sum of nc 1 of underpaid and unpaid per
         pmo": over the officer's teams, the customers on the list whose N.C (the sheet's own
         column, NOT the first number of DUE SUMMARY) is 1 and who are UNDERPAID or UNPAID. A
         count, so the JUMLA row adds it like the other two. Null until db/RUN-ME-039 is run
         and the sheet uploaded again, and the caption below says so rather than the column
         reading nought. */
      /* AND SHORT NAMES, AND THE SHARE WHO HAVE PAID -- "having the columns short in both early and today col slides, we can add CC% (Count
         collection) to see percentage of paid customers (paid among total)" (the owner, 25 Nov 2026, handbook Part 164, addendum 4): this
         list is KESHO's, so its two counts read C1 KESHO and TC KESHO beside today's slide's C1 LEO and TC LEO; and CC% KESHO is the customers
         who have PAID (paid + overpaid) among the total count, worked out by the server (countCollectionPct) and, in the JUMLA row, from the
         totals' own two parts (`from`), never as an average of the officers' percentages. No colour target (nobody has set one for a
         headcount ratio): like every percentage on the wall it goes red only under the JUMLA row's own figure. */
      cols:[col('officer','Officer'), col('teams','Teams','num'),
        col('remaining','Wamebaki / Left','num'), col('count1','C1 KESHO','num'), col('customers','TC KESHO','num'),
        {key:'ccPct', label:'CC% KESHO', kind:'pct', from:['paidOver','customers']},
        col('uncollected','Uncollected (kesho)','money'), {key:'pct', label:'Coll % (kesho)', kind:'pct', target:'ecol'},
        col('wUncollected','Uncollected (week)','money'), {key:'wPct', label:'Coll % (week)', kind:'pct', target:'ecol'}],
      /* WHICH SHEET, BY NAME. This slide reads the INITIAL (kesho / next list) sheet, not the
         day sheet, and the old caption sent people to re-upload "today's Expected sheet" --
         which they did, and the column stayed blank: "count 1 of early col at slide aint
         reading anything". The server names the teams whose rows carry no N.C (db/RUN-ME-039),
         and the caption names the sheet and its date. */
      caption: uaCap('Early col', ua.early)
        + (function(){
            var n = count1Note_(!!(earlyRows.length && earlyRows.every(function(x){ return x.count1 == null; })),
              b.earlyCount1Missing, 'Expected — Initial / kesho (next list' + (b.earlyDate ? ', ' + b.earlyDate : '') + ')');
            return n ? '<div>' + n + '</div>' : ''; })()
        // What the short names are, said on the slide
        + '<div>C1 KESHO = wateja wa N.C 1 wanaodaiwa kwenye orodha ya kesho · TC KESHO = jumla ya wateja wa orodha hiyo · CC% KESHO = wateja waliolipa (wamelipa + wamezidisha) kati ya jumla'
        + ' / C1 KESHO = N.C 1 customers still owing on the next list · TC KESHO = all customers on it (total count) · CC% KESHO = customers who have paid (paid + overpaid) among the total</div>' });
    /* TWO DIFFERENT ROOMS, and this deck used to show one under the other's name.

       "Call agents" means the CUSTOMER CARE agents: the people named as CREATED BY on the
       application reports. Nobody records their talk time or puts them on a team, and what
       they are judged on is what they brought in -- TRACK# 1 only, because a repeat customer
       is not a new win.

       The HOPE Calls app officers are everybody in the field, and they get their own two
       slides: who is on the phone most, and who is on it least. */
    /* PMO COLLECTION. Five columns, and deliberately only five: number, name, how many teams
       they hold, what is still uncollected, and the percentage. NO COMMISSION -- that lives on
       the commission panel where the person it concerns can see their own figure. A projector
       in a meeting room is the wrong place for anybody's pay, and it changes what the room
       talks about. */
    /* TODAY AND THE WEEK SIDE BY SIDE, one slide per role. Split across two, the room read
       today's figure, discussed it, and had lost the week by the time it came round -- and
       "is this better or worse than the week?" is the question every one of these boards
       exists to answer. */
    /* THE FIVE DAYS BEFORE THE WEEK, because the daily percentage is what pay is worked out
       from -- each day banded on its own and added up -- and the week's figure alone is the one
       number the officers are NOT paid on. Today is one of these five columns, so it is no
       longer shown twice. */
    /* THE CAPTION UNDER THE COLLECTION SLIDE -- its own unassigned teams, by name (uaCap, above):
         "todays collection is so essential so i always need to see the alert from there ...
          add a caption below of unassigned teams, ill need to always notice them from there"
       The early and recovery lines sit under their own slides now. */
    slides.push({ id:'pmo', kind:'table', tcls:'pcolpmo', title:'PMO Collection — kila siku / each day, then the week',
      caption: uaCap('Col', ua.col)
        // Count 1 here is today's DAY sheet; its gaps, by team, said the same way as the early slide's.
        + (function(){
            var n = count1Note_(!!((b.pmo || []).length && (b.pmo || []).every(function(x){ return x.count1 == null; })),
              b.pmoCount1Missing, 'Expected ya leo / today\'s day sheet' + (b.today ? ' (' + b.today + ')' : ''));
            return n ? '<div>' + n + '</div>' : ''; })()
        // What the two short names are, said on the slide (the owner's own words for them: C1 LEO, TC LEO)
        + '<div>C1 LEO = wateja wa N.C 1 wanaodaiwa leo · TC LEO = jumla ya wateja wa leo (total count) · CC% LEO = wateja waliolipa (wamelipa + wamezidisha) kati ya jumla'
        + ' / C1 LEO = today\'s N.C 1 customers still owing · TC LEO = all of today\'s customers (total count) · CC% LEO = customers who have paid (paid + overpaid) among the total</div>',
      rows:(b.pmo||[]).slice(0,12),
      /* COUNT 1 BETWEEN TEAMS AND J3 -- "add count 1 column too", then "sum of nc 1 of
         underpaid and unpaid per pmo": today's sheet, the officer's teams, the customers whose
         N.C column is 1 and who are UNDERPAID or UNPAID, added up. Null until db/RUN-ME-039 is
         run and the sheet uploaded again; the early slide's caption says so.
         AND THE TOTAL COUNT RIGHT AFTER IT, BOTH WITH SHORT NAMES -- "Add Tt Count (total count) column after count 1 column just rename the
         columns into C1 LEO and TC LEO, for space purposes so that i see right away its count 1s among which total in the expected collection of
         today officers today as that of early col does" (the owner, 25 Nov 2026, handbook Part 164, addendum 4). C1 LEO is the Count 1 this slide
         always had (it read "Count 1 (NC 1 leo)"); TC LEO is every customer on today's sheet over the officer's teams (the early slide's
         "Wateja / Customers", from the same board row: `customers`). Two counts, so the JUMLA row adds each up. The caption says what the
         two short names are. THEN CC% LEO, the same hour: "having the columns short in both early and today col slides, we can add CC% (Count
         collection) to see percentage of paid customers (paid among total)": the customers who have PAID (paid + overpaid) among TC LEO, from
         the board row's own `ccPct` (countCollectionPct, pmo.js: the definition the early slide uses too); in the JUMLA row the ratio of the
         totals' two parts (`from`), never an average of the officers' percentages. */
      cols:[col('officer','PMO'), col('teams','Teams','num'), col('count1','C1 LEO','num'), col('customers','TC LEO','num'),
        {key:'ccPct', label:'CC% LEO', kind:'pct', from:['paidOver','customers']},
        {key:'pctJ3', label:'J3', kind:'pct', target:'col'}, {key:'pctJ4', label:'J4', kind:'pct', target:'col'},
        {key:'pctJ5', label:'J5', kind:'pct', target:'col'}, {key:'pctAL', label:'AL', kind:'pct', target:'col'},
        {key:'pctIJ', label:'IJ', kind:'pct', target:'col'},
        col('weekUncollected','Uncollected (week)','money'), {key:'weekPct', label:'Coll % (week)', kind:'pct', target:'col'}] });
    /* LEGAL RECOVERY -- "add legal recovery slide at presentation, todays and weekly recovery
       columns as pmo recovery does". Per legal officer (the access codes whose ROLE is legal
       -- never a recovery or credit code that merely holds the tab -- with the teams their
       code carries): the noticed customers on those teams, what the
       letters demanded against (arrears at the latest notice), and what those customers PAID
       today and this week -- the payments the book records against notices (RUN-ME-041), a
       payment once per customer. Ranked on the week's share, like the recovery slide. The
       JUMLA percentages are the totals' ratio (from:), never an average of the rows. */
    var lgCap = (b.legalOn === false && b.legalNote ? '<div>⚠ ' + esc(b.legalNote) + '</div>' : '')
      + '<div>Wateja wenye notisi / noticed customers: ' + money(b.legalCustomers || 0)
      + ' · malipo yaliyorekodiwa dhidi ya notisi (REF# au simu), mara moja kwa mteja / payments recorded against notices (REF# or phone), once per customer</div>'
      + ((b.legalAll || []).length ? '<div>Wanasheria wa timu zote, hawapangwi / holding every team, not ranked: ' + esc(b.legalAll.join(', ')) + '</div>' : '')
      + ((b.legalUnheld || []).length ? '<div>Timu zisizo na mwanasheria / teams no legal code holds: ' + esc(b.legalUnheld.join(', ')) + '</div>' : '');
    /* AS IT WAS. Recovery by phone sat on this slide for a day (two columns and a line, Part 139); the owner moved it to the legal
       officers' own calls slide below: "leaving the demand recovery slide as it was" (24 Nov 2026, Part 141). */
    slides.push({ id:'legal', kind:'table', title:'Legal recovery — notisi za madai / demand notices · leo / today, then the week',
      caption: lgCap, rows:(b.legal||[]).slice(0,12),
      cols:[col('officer','Legal officer'), col('teams','Teams','num'), col('customers','Customers','num'),
        col('owed','Owed at notice','money'),
        col('tRecovered','Recovered today','money'), {key:'tPct', label:'Rec % (today)', kind:'pct', target:'rec', from:['tRecovered','owed']},
        col('recovered','Recovered (week)','money'), {key:'pct', label:'Rec % (week)', kind:'pct', target:'rec', from:['recovered','owed']}] });
    /* THE LEGAL OFFICERS' OWN CALLS SLIDE -- "I'VE BEEN SHOCKED BY LEGAL CALLS at presentation: i need their calls slide too, that
       is the one that should include calls recovery daily and weeekly. leaving the demand recovery slide as it was" (the owner,
       24 Nov 2026; handbook Part 141), said over a read-only look that showed two legal phones doing the ringing, nine
       conversations in ten with numbers the system holds for no customer, and three legal phones that had sent no call at all.
       One row for each legal phone -- the ones that sent no call this week too, marked red: they are the names the meeting most
       needs. Today's figures first, in the HOPE Calls slide's own words (numbers rung, the talk time with customers of their
       own teams, those customers), then the week's calls, then how many customers at D.C 2 and above they spoke to and what those recovered:
       today and this week. The rows are the server's (b.legalCalls: the call boards' own rows and the Legal tab's own phone
       lines, by name); nothing is worked out here. Under the three phone columns the cells are blank until db/RUN-ME-089 is run,
       and the caption names the file. Today's recovery shows once the day's later file is in (Part 140): the caption says how
       many are waiting for it. */
    /* NINE COLUMNS, SHORT HEADERS, A WIDER NAME. The wall's figure columns do not wrap (a number must stay on one line) and the
       table's columns are equal shares, so a long header runs into its neighbour: the first cut of this slide had thirteen columns
       and its headers collided on the screen. Every header here fits inside its own column at any width (the browser check measures
       it at five). A silent phone is marked in the officer's own cell, in red, so the mark costs no column; that cell may wrap and
       its column takes a double share (tcls 'pname2', styled in app.html). Dials are left to the HOPE Calls slide: this one counts
       numbers rung, as its caption says. */
    /* The mark's own words are held together by no-break spaces (written as escapes, never as the invisible character), so a
       name that needs two lines breaks BEFORE the mark and never inside it. */
    var lcRows = (b.legalCalls || []).map(function(x){ return { ...x, who: x.officer + (x.silent ? ' —\u00a0kimya\u00a0/\u00a0silent' : '') }; });
    var lcSilent = lcRows.filter(function(x){ return x.silent; }).length;
    var lcPh = b.legalPhone || null;
    var lcCap = (lcPh ? lgPhoneNote_({ ...lcPh, others: [] }, true) : '')
      + (lcPh && lcPh.on === true && lcPh.waiting ? '<div>Leo / today: ' + money(lcPh.waiting) + ' wanasubiri faili la jioni / waiting for the later file — marejesho ya leo huonekana likishapakiwa / today\'s recovery shows once it is uploaded</div>' : '')
      + '<div>Calls = namba zilizopigwa, mara moja kwa siku / numbers rung, once a day'
      + (b.callsReachNote ? ' · Reached % inasubiri / waits for db/RUN-ME-088'
        : b.callsReachMin != null ? ' · Reached = waliongea zaidi ya sek ' + b.callsReachMin + ' / spoken to for over ' + b.callsReachMin + ' s' : '')
      + ' · Portfolio = leo, namba za wateja wa timu zake / today, numbers of customers on the officer\'s own teams'
      + ' · Portfolio talk = muda wa maongezi hayo leo / the talk time of those calls today'
      + ' · DC 2+ spoken = wateja wa DC 2+ waliozungumzwa wiki hii / customers at DC 2 and above spoken to this week</div>'
      + (lcSilent ? '<div>⚠ Simu ' + money(lcSilent) + ' za wanasheria hazijapiga simu yoyote kupitia HOPE Calls wiki hii / '
          + money(lcSilent) + ' legal phone' + (lcSilent === 1 ? ' has' : 's have') + ' sent no call through HOPE Calls this week</div>' : '');
    slides.push({ id:'legalcalls', kind:'table', tcls:'pname2',
      title:'Legal calls — simu za wanasheria / the legal officers\' phones · leo / today, then the week · marejesho kwa simu / recovery by phone',
      /* "replace (reached today %) column with Duration of todays portifolio talk" (the owner, 24 Nov 2026; handbook Part 143):
         the third column is the talk time of today's calls to customers of the officer's own teams (the row's `duration`, the
         HOPE Calls slide's own "Portfolio talk"), where it was today's Reached %. The week's Reached % stays.
         EVERY legal phone, never the first so many: the rows add up to the phone card, and a row cut off the end would be a lawyer
         nobody sees. A long list is fitted to the screen by presFit_, as the HOPE Calls slide's is. */
      caption: lcCap, rows: lcRows,
      cols:[{ key:'who', label:'Legal officer', cls:function(r){ return r.silent ? 'bad' : ''; } },
        col('calls','Calls today','num'), col('duration','Portfolio talk','dur'), col('portfolio','Portfolio','num'),
        col('wCalls','Calls week','num'), {key:'wConnectPct', label:'Reached week', kind:'pct', from:['wConnected','wCalls']},
        col('spoken','DC 2+ spoken','num'), col('phToday','By phone today','money'), col('phWeek','By phone week','money')] });
    /* DAY PROGRESS -- the three office units from the day's FIRST upload to its latest.
         "we'll need to see who pushed more percentages and who is the most stuck guy behind"
       One slide, three columns, each ranked on the percentage points gained since the day's
       first upload -- so the person who took 80 to 92 sits above the one who took 90 to 93,
       whatever their absolute figure. Recovery carries the shillings beside the percentage.
       Drawn by presDraw's own 'progress' branch (presProgGroup_), sized to fit all three. */
    var dp = b.dayProgress || {};
    var dpUnits = [
      { key:'early', label:'Early col', sub:'orodha ya kesho / next list' + (dp.earlyDate ? ' · ' + dp.earlyDate : ''), rows: dp.early || [], total: dp.earlyTotal || null, avg: dp.earlyAvg || null, money:false },
      { key:'col', label:'Collection', sub:'leo / today', rows: dp.col || [], total: dp.colTotal || null, avg: dp.colAvg || null, money:false },
      { key:'rec', label:'Recovery', sub:'leo / today', rows: dp.rec || [], total: dp.recTotal || null, avg: dp.recAvg || null, money:true } ];
    slides.push({ id:'dayprog', kind:'progress',
      title:'Maendeleo ya leo / Day progress — tangu upload ya kwanza / since the first upload' + (dp.date ? ' · ' + dp.date : ''),
      units: dpUnits, rows: dpUnits.reduce(function(a, u){ return a.concat(u.rows); }, []) });
    /* "the callagents/customer service reports of assigned and unassigned at presentation i
        need it to always be sum of weekly from mon to sun"
       csWeek is already the Mon-Sun sum -- the title said neither which days nor that it was a
       sum, so on a Tuesday the room read it as Tuesday's. Now it says so. */
    /* THE STRICT RULE ON THE WALL TOO: TRACK# reads 1, created by a roster agent. What was
       left out is said in the title, because this slide pays a bonus and a room reading it
       should know the count is the strict one. */
    var csx = (b.csExcluded && b.csExcluded.week) || null;
    var csxNote = csx && (csx.noTrack || csx.repeat || (csx.notAgent||[]).length)
      ? ' · hazikuhesabiwa / not counted: ' + [csx.noTrack ? money(csx.noTrack) + ' no TRACK#' : '',
          csx.repeat ? money(csx.repeat) + ' repeat' : '',
          (csx.notAgent||[]).length ? money((csx.notAgent||[]).reduce(function(s,a){ return s + a.n; }, 0)) + ' not on the roster' : '']
          .filter(Boolean).join(', ')
      : '';
    slides.push({ id:'cs', kind:'table',
      title:'Call agents — applications brought in · TRACK# 1 · jumla ya wiki Jumatatu–Jumapili / week total Mon–Sun' + csxNote,
      rows:b.csWeek.slice(0,12),
      cols:[col('agent','Agent'), col('unassigned','Unassigned','num'), col('assigned','Assigned','num'),
        col('brought','Brought in','num'), col('amount','Amount','money')] });
    /* BOTH ENDS ON ONE PAGE. Split across two slides the room saw the busiest, talked about
       them, and had forgotten the comparison by the time the quiet ones came round. Side by
       side the slide answers the question people actually ask: who is working the phone and
       who is not. An officer who never opened the app is IN this list at zero rather than
       missing from it, which is the whole reason it is worth projecting. */
    /* THE THREE PMO UNITS ONLY.
       "For the presentation slides am interested in the 3 PMO department's Units (expected,
        collection and recovery officers - show only those for busiest and least active ones)"

       Everybody in the field calls, so this board was every registered handset in the company
       -- and the twelve names it had room for were whoever happened to call most, which on any
       given week is rarely one of the three units the meeting is about. The unit is decided on
       the server, off the teams table and the access codes, so this is a filter and not a
       second opinion about who is a recovery officer.

       If NOBODY on the board holds one of the three units -- a book where the columns are not
       filled in -- the slide falls back to the whole list rather than going blank. An empty
       slide in a meeting reads as a broken system; a full one reads as "nobody is labelled",
       which is a thing somebody can go and fix. */
    var PMO_UNITS = { EXPECTED:1, COLLECTION:1, RECOVERY:1 };
    /* TODAY'S CALLS ONLY. "the hope calls selection at presentation should only count today's
       calls" -- this board was built from callWeek (Mon-Sun), so Monday's hard morning still
       carried somebody through Thursday's slide, and a quiet Monday buried a busy Thursday.
       The server has always computed callToday alongside the week (same shape, same units,
       same sort); the slide simply never used it. Worst end derived by .reverse() of the same
       list, exactly as callWeekWorst is derived from callWeek server-side -- one calculation,
       two directions, never two answers. */
    var callDayAll = b.callToday || [];
    var callDayAllWorst = callDayAll.slice().reverse();
    var callPool = callDayAll.filter(function(x){ return PMO_UNITS[x.unit]; });
    var callPoolWorst = callDayAllWorst.filter(function(x){ return PMO_UNITS[x.unit]; });
    var unitOnly = callPool.length > 0;
    if (!unitOnly) { callPool = callDayAll; callPoolWorst = callDayAllWorst; }
    /* EVERY OFFICER OF THE THREE UNITS, busiest first -- "the hope calls slide should list all
       officers in the 3 units and format red the least actives". A slide that only ever had
       room for six at each end let a quiet officer sit unseen in the middle. The top six keep
       their green mark; the least active -- the bottom six, and anybody at nil calls however
       long the list -- are marked red. The S/N still reads as one ranking, top to bottom. */
    var callRows = callPool.map(function(x, i){
      var least = i >= callPool.length - 6 || !(Number(x.calls) || 0);
      return { ...x, end: (i < 6 && !least) ? 'Busiest' : least ? 'Least active' : '' }; });
    /* "the least active should just change just the left 'least active' but continue flowing
       high to low no of calls in that sense the s/n makes sence" -- the worst list arrives
       fewest-first, which put the absolute-zero officer at row 7 and the counts RISING down
       the slide, reversing direction mid-table. The six least active are still the same six
       people (picked from the worst end); .reverse() only prints them high-to-low, so the
       whole 12-row slide descends continuously from busiest to quietest and the S/N reads as
       one ranking. The 'Least active' label in the left column is what marks the second half. */
    /* Under the call counting rule (call-core.js): Calls are numbers rung, once per day; the
       dials sit beside them so a redialler is visible; talk time is portfolio talk time. */
    slides.push({ id:'calls', kind:'table',
      title:'HOPE Calls — busiest first (namba, si majaribio / numbers rung, not dials)'
        + (unitOnly ? ' · Expected · Collection · Recovery' : ' · vitengo havijawekwa / units not set')
        /* REACHED % = the numbers really spoken to (a call longer than the minimum seconds) out of the numbers rung, not every
           number dialled. The server says which minimum it counted by (callsReachMin); where the database is still behind the rule
           it sends no figure at all (the cells are blank) and the slide says which file to run. */
        + (b.callsReachNote ? ' · Reached % inasubiri / waits for db/RUN-ME-088'
          : b.callsReachMin != null ? ' · Reached = waliongea zaidi ya sek ' + b.callsReachMin + ' / spoken to for over ' + b.callsReachMin + ' s' : ''),
      rows: callRows,
      cols:[{ key:'end', label:'', cls:function(r){ return r.end==='Busiest' ? 'good' : r.end==='Least active' ? 'bad' : ''; } },
        col('agent','Officer'), col('unit','Unit'), col('team','Team'), col('calls','Calls','num'), col('dials','Dials','num'),
        col('duration','Portfolio talk','dur'), col('portfolio','Portfolio','num'), col('connectPct','Reached %','pct')] });
    // Sales % is against the weekly target times the teams held: both are on the slide to show it.
    slides.push({ id:'credit', kind:'table', title:'Credit analysts — this week · sales % ÷ (weekly target × teams held)', rows:b.creditWeek.slice(0,12),
      cols:[col('analyst','Analyst'), col('teams','Teams','num'), col('apps','Apps','num'), col('amount','Amount','money'),
        col('target','Target','money'), col('salesPct','Sales %','pct'), col('perf','Perf','pct')] });
    slides.push(coltrend);
    slides.push({ id:'fu', kind:'table', title:'Follow-up status — all defaulters', rows:b.fuStatus.slice(0,12),
      cols:[col('status','Status'), col('customers','Customers','num'), {key:'pct', label:'% of book', kind:'pct', lowGood:true},
        col('arrears','Arrears','money')] });
    return slides;
}

/* Not every meeting wants every board. A recovery review does not need the credit slide, and an
   evaluation of one team should not project the whole company -- so segments are selectable and
   the deck can be scoped to a single team. Both choices persist, because the same meeting runs
   every week.

   NEITHER CHOICE COSTS A REQUEST. Both are applied to figures already in hand. */
function presApply(){
  if (!S.presOff) S.presOff = (load('hopePresOff') || '').split(',').filter(Boolean);
  if (S.presTeam == null) S.presTeam = load('hopePresTeam') || '';
  var slides = presSlides();
  if (S.presTeam){
    var only = function(list, key){
      return (list || []).filter(function(x){ return String(x[key] || '') === S.presTeam; }); };
    slides = slides.map(function(sl){
      if (sl.kind !== 'table') return sl;
      // Officer/analyst/agent boards belong to whoever covers the team, so they are scoped
      // by team where the row carries one and left whole where it does not.
      if (sl.rows.length && 'team' in sl.rows[0]) return { ...sl, rows: only(sl.rows, 'team') };
      return sl;
    });
  }
  var live = slides.filter(function(sl){ return S.presOff.indexOf(sl.id) < 0; });
  S.slides = live.length ? live : slides;
  return slides;                 // the FULL list, for drawing the checkboxes
}

function presRender(){
    var d = S.presData.d;
    var slides = presApply();
    // The boards' own state, on the page: loading, or not loaded and why, with a retry.
    var boardsNote = S.presData.b ? ''
      : S.presData.bLoading
        ? '<div class="note" style="display:block">⏳ Bodi za maafisa zinapakia / the officer boards are loading'
          + ' — slaidi za dashibodi ziko tayari, unaweza kuanza / the dashboard slides are ready, you can start.</div>'
        : '<div class="note bad" style="display:block">Bodi za maafisa hazikupakia / the officer boards did not load'
          + ' — ' + esc(S.presData.bWhy || '') + ' <button class="btn sm" id="presBoardsRetry">Jaribu tena / Retry</button></div>';

    /* The deduction cases' own state, on the page, the way the boards' is: only when they did not come (and for a person who is asked for them at all). */
    var dedNote = !allowed('deduct') || S.presData.ded || S.presData.dedLoading || !S.presData.dedWhy ? ''
      : '<div class="note bad" style="display:block">Kesi za makato hazikupakia / the deduction cases did not load'
        + ' \u2014 ' + esc(S.presData.dedWhy) + ' <button class="btn sm" id="presDedRetry">Jaribu tena / Retry</button></div>';

    HEAD = weekBar(d) + boardsNote + dedNote + '<div class="kpis">'
      + kpi('Slides', money(S.slides.length), (S.presOff.length? money(S.presOff.length)+' hidden' : 'live figures, not a screenshot'), '', 'presCount')
      + kpi('Seconds per slide', String(S.presSecs || PRES_SECS_DEFAULT), 'change below')
      + kpi('Weekday', esc(d.weekday), d.weekOf) + '</div>'
      + '<div class="card"><div class="card-h">Sehemu za kuonyesha / Segments to include</div>'
      + '<div class="cleanbox"><div class="checks">'
      + slides.map(function(sl){
          return '<label><input type="checkbox" class="presSeg" value="'+esc(sl.id)+'"'
            + (S.presOff.indexOf(sl.id)<0?' checked':'')+'> '+esc(sl.title)+'</label>'; }).join('')
      + '</div>'
      + '<div class="fld" style="max-width:280px;margin-top:10px"><label>Onyesha timu / Show data for</label>'
      + '<select id="presTeam"><option value="">Timu zangu zote / All my teams</option>'
      + (d.teamPerf||[]).map(function(t){
          return '<option'+(S.presTeam===t.team?' selected':'')+'>'+esc(t.team)+'</option>'; }).join('')
      + '</select></div></div></div>'
      + '<div class="note" style="display:block">● <b>Skrini nyeusi / Blank the screen.</b> '
      + 'Ukishaanza, kitufe cha <b>Skrini nyeusi</b> juu kulia (au herufi <b>B</b>) hufunika skrini '
      + 'wakati wa maombi. Slaidi hubaki pale pale na saa inasimama; bofya popote kurudi. / '
      + '<i>Once playing, the <b>Skrini nyeusi</b> button top right — or the <b>B</b> key — covers the '
      + 'screen for prayers. The deck stays where it is and the clock stops; tap anywhere to come back.</i></div>'
      + bar('<button class="btn" id="presStart">▶ Anza / Play on the TV</button>'
        + '<label style="font-size:12px;color:var(--mut)">Sekunde / Seconds</label>'
        + '<input type="number" id="presSecs" min="5" max="300" value="'+(S.presSecs||PRES_SECS_DEFAULT)+'" style="width:80px">'
        + '<span style="font-size:12px;color:var(--mut)">Esc kutoka · ← → kubadili slaidi / Esc exits, arrows change slide</span>');
    S.rows = S.slides.map(function(sl,i){ return { n:i+1, slide:sl.title, kind:sl.kind,
      rows: sl.rows ? sl.rows.length : sl.items.length }; });
    S.cols = [col('slide','Slide'), col('kind','Type'), col('rows','Rows','num')];
    ONROW = function(r){ presStart(r.n - 1); };
}

function presStart(from){
  if (!S.slides || !S.slides.length) return;
  var el = document.getElementById('pres');
  el.style.display = 'block';
  S.presI = from || 0;
  S.presBlank = false;                    // a new play never starts behind the black
  presDraw();
  clearInterval(S.presTimer);
  S.presTimer = setInterval(function(){ S.presI = (S.presI + 1) % S.slides.length; presDraw(); },
    Math.max(5, Math.min(300, Number(S.presSecs) || PRES_SECS_DEFAULT)) * 1000);
  clearInterval(S.presRefresh);
  S.presRefresh = setInterval(presRefetch, PRES_REFRESH_MS);
  // Real full screen: on the office TV the browser chrome should not be part of the picture.
  if (el.requestFullscreen) { try { el.requestFullscreen(); } catch(e){} }
  backLayerOpen_('pres');
}

function presStop(){
  clearInterval(S.presTimer);
  clearInterval(S.presRefresh); S.presRefresh = null;
  document.getElementById('pres').style.display = 'none';
  if (document.fullscreenElement && document.exitFullscreen) { try { document.exitFullscreen(); } catch(e){} }
  backLayerClose_('pres');
}

function presDraw(){
  var s = S.slides[S.presI], body;
  if (s.kind === 'kpi'){
    /* `s` is a line UNDER the figure, inside it (so the fit that sizes the figure sizes the line with it): the percentage that belongs to an amount.
       A tile may carry SEVERAL (`s` an array: the combined Recovered tile has the percentage and then today's amount); an empty one is no line.
       The slide's most-lined tile sets how many lines EVERY tile reserves (empty ones, invisible to a reader), so that the labels and the figures of
       a row stand level whether a tile has lines under it or not. */
    var linesOf = function(it){ return [].concat(it.s || []).filter(function(x){ return !!x; }); };
    var most = 0; s.items.forEach(function(it){ most = Math.max(most, linesOf(it).length); });
    body = '<div class="pkpis' + (s.grid === '4x3' ? ' p12' : '') + '">' + s.items.map(function(it){
      var ls = linesOf(it), subs = ls.map(function(x){ return '<span class="ps">'+esc(x)+'</span>'; }).join('');
      for (var i = ls.length; i < most; i++) subs += '<span class="ps" aria-hidden="true">&nbsp;</span>';
      return '<div class="pkpi"><div class="pl">'+esc(it.l)+'</div><div class="pv">'+esc(it.v)+subs+'</div></div>'; }).join('') + '</div>';
  } else if (s.kind === 'progress'){
    body = '<div class="pprog">' + s.units.map(presProgGroup_).join('') + '</div>';
  } else if (s.kind === 'note'){
    // A slide that says what is NOT on the wall, and why -- see presSlides' boards note.
    body = '<div class="pnote">' + esc(s.text).replace(/\n/g, '<br>') + '</div>';
  } else {
    /* THE GRAND TOTAL, on the wall as well as on the tab. It is the number the meeting reads
       out, and a projected table without one sends somebody to a calculator while the slide is
       still up. Same rule as everywhere else: counts, money and talk time add up; percentages
       are worked out again from the totals that made them, never summed. */
    var tot = autoTotals(s.rows, s.cols);
    // The wall gets the same colours as the tab: green at target, red under the line.
    var ctx = colourCtx_(s.cols, tot);
    /* Wrapped, so a board still wider than the screen scrolls inside its own box rather than
       pushing the whole slide sideways and taking the navigation arrows off the edge with it. */
    /* A slide may give its table a class of its own (tcls): the legal officers' calls slide widens and wraps its name column with
       it. No slide that does not ask is drawn any differently. */
    body = '<div class="pscroll"><table class="ptable'+(s.tcls?(' '+s.tcls):'')+'"><thead><tr><th>#</th>' + s.cols.map(function(c){
        return '<th class="'+(isNum(c)?'r':'')+'">'+esc(c.label)+'</th>'; }).join('') + '</tr></thead><tbody>'
      + s.rows.map(function(r,i){ return '<tr><td>'+(i+1)+'</td>'+s.cols.map(function(c){
          var k = cellCls_(r, c, ctx);
          /* A COLUMN'S OWN MARK IS DRAWN ON THE WALL TOO (handbook Part 141). The tab's table and the boards have always applied a
             column's cls(); this renderer never did, so the HOPE Calls slide's "Least active" was never red on the TV although the
             slide asks for it ("format red the least actives") -- seen in a real browser while the legal officers' slide, whose
             silent phones must be red, was being built. */
          return '<td class="'+(isNum(c)?'r':'')+(c.cls?(' '+c.cls(r)):'')+(k?' '+k:'')+'">'+cellHtml(r,c)+'</td>'; }).join('')+'</tr>'; }).join('')
      + (tot ? '<tr class="ptot"><td></td>' + s.cols.map(function(c,i){
          return '<td class="'+(isNum(c)?'r':'')+'">'+(i===0?'JUMLA / TOTAL':cellHtml(tot,c))+'</td>'; }).join('') + '</tr>' : '')
      + '</tbody></table></div>';
    // A slide's caption sits under its table, after the total -- see the PMO slide's own.
    if (s.caption) body += '<div class="pcap">' + s.caption + '</div>';
  }
  presSetHtml_(
    '<div class="phead"><span>'+esc(s.title)+'</span>'
    + '<span class="pnum">'+(S.presI+1)+' / '+S.slides.length
      + (S.presUpdated ? ' <span style="font-size:.6em;opacity:.7" title="Takwimu zilipatikana / figures fetched">· '
          + esc(String(S.presUpdated.getHours()).padStart(2,'0') + ':' + String(S.presUpdated.getMinutes()).padStart(2,'0')) + '</span>' : '')
      + '</span>'
    /* A LABEL, NOT A DOT. This was a bare filled circle beside the close cross, which reads as
       decoration rather than a button -- the person it was built for looked at the deck and did
       not see it. It says what it does now. */
    + '<button class="pblankbtn" onclick="presBlank(true)" title="Skrini nyeusi (B) / Blank the screen">'
      + '&#9679; Skrini nyeusi</button>'
    + '<button class="pclose" onclick="presStop()">&#10005;</button></div>'
    + '<div class="pbody">'+body+'</div>'
    + '<button class="pnav pprev" onclick="presGo(-1)" title="Iliyopita / Previous">&#8249;</button>'
    + '<button class="pnav pnext" onclick="presGo(1)" title="Inayofuata / Next">&#8250;</button>'
    /* Drawn as part of the slide, not laid over it once, so an auto-advance that happens to
       fire cannot pull the black away and put the figures back in front of the room. */
    + (S.presBlank ? '<div class="pblank" onclick="presBlank(false)">'
        + '<div class="pbx">&#10005;</div>'
        + '<div class="pbnote">Bofya popote kurudi / tap anywhere to come back</div></div>' : ''));
}

function presSetHtml_(html){
  document.getElementById('pres').innerHTML = html;
  presFit_();
}

/* EVERY SLIDE FITS THE SCREEN TOP TO BOTTOM, OR SAYS WHY NOT.
     "Hope calls slide height should autofit since we cant keep scrolling" ... "all the slides"
   Measured, not guessed: the space under the heading against the slide body as drawn. Only
   when the body is taller is it shrunk, to the exact ratio, and a slide that fits is left
   exactly as drawn. Two ways to shrink, because two kinds of body:
     a TABLE     its font size, with header and padding in em (.pfit), floor 8px -- the type
                 stays crisp and the clamp() width rule keeps the columns on the screen;
     anything    the KPI grid, the day-progress columns, a note: the body is zoomed as a
     else        whole, floor 0.5, so every px measurement inside shrinks together. zoom is
                 what every projector browser here runs (Chromium, Safari, Firefox 126+); the
                 transform fallback is for anything older.
   Below the floor the box scrolls as it always did: smaller than that is not readable from
   the back of the room. Called after every draw and on resize, so a projector plugged in
   mid-meeting re-fits the slide that is up. */
function presFit_(){
  var pres = document.getElementById('pres'), body = pres && pres.querySelector('.pbody');
  if (!body) return;
  var tbl = pres.querySelector('.ptable');
  body.style.zoom = ''; body.style.transform = ''; body.style.transformOrigin = ''; body.style.width = '';
  if (tbl) { tbl.classList.remove('pfit'); tbl.style.fontSize = ''; }
  var top = body.getBoundingClientRect().top;
  var bottom = pres.clientHeight - parseFloat(getComputedStyle(pres).paddingBottom || 0);
  var avail = bottom - top - 8;   // 8px of slack: the floor must not scroll
  if (!(avail > 0)) return;
  if (tbl) {
    var cap = pres.querySelector('.pcap');
    var tAvail = avail - (cap ? cap.getBoundingClientRect().height + 12 : 0);
    var need = tbl.getBoundingClientRect().height;
    if (need <= tAvail) return;
    var base = parseFloat(getComputedStyle(tbl).fontSize) || 16;
    tbl.classList.add('pfit');
    tbl.style.fontSize = Math.max(8, Math.floor(base * tAvail / need * 10) / 10) + 'px';
    // Header and padding are now in em, so the table is shorter than the plain ratio predicts;
    // one more measured pass takes back what that freed.
    var need2 = tbl.getBoundingClientRect().height;
    if (need2 < tAvail) tbl.style.fontSize = Math.min(base, Math.max(8, parseFloat(tbl.style.fontSize) * tAvail / need2 * 0.97)) + 'px';
    return;
  }
  /* THE DAY'S TWELVE FILL THE SCREEN (handbook Part 164): on a screen wider than a phone the grid is given the whole height under the
     heading, so its three rows of 1fr stretch to the TV's bottom edge; and one value size is found for every tile -- the largest at which
     the longest figure ("TZS 1,234,567,890") still fits its tile -- so the twelve read as one set and none runs past its edge. On a narrow
     screen the grid is two columns and the zoom below fits it as it does any other body. */
  var kg = pres.querySelector('.pkpis.p12');
  if (kg){
    var vals = Array.prototype.slice.call(kg.querySelectorAll('.pv')), tiles = Array.prototype.slice.call(kg.querySelectorAll('.pkpi'));
    kg.style.height = ''; vals.forEach(function(v){ v.style.fontSize = ''; });
    if (window.innerWidth > 900){
      kg.style.height = Math.max(240, Math.floor(avail)) + 'px';
      /* A TILE'S CONTENT MUST FIT ITS HEIGHT TOO (addendum 5): a tile may carry two lines under its figure, and on a wide and short window the three rows
         are short. Besides a figure running past its tile's width, the signal to shrink is the tile's label above, or its last line below, coming within
         8 pixels of the tile's edge (never more than its own padding): a tile's text is not to touch its border. */
      var overH = function(){ return tiles.some(function(t){
        var r = t.getBoundingClientRect(), a = t.firstElementChild, z = t.lastElementChild, m = Math.min(8, parseFloat(getComputedStyle(t).paddingTop) || 0);
        return !!a && !!z && (a.getBoundingClientRect().top < r.top + m || z.getBoundingClientRect().bottom > r.bottom - m); }); };
      var over = function(){ return vals.some(function(v){ return v.scrollWidth > v.clientWidth + 1; }) || overH(); };
      var sz = vals.length ? (parseFloat(getComputedStyle(vals[0]).fontSize) || 40) : 40, guard = 40;
      while (over() && sz > 12 && guard-- > 0){ sz = Math.max(12, Math.floor(sz * 0.93)); vals.forEach(function(v){ v.style.fontSize = sz + 'px'; }); }
      return;
    }
  }
  var h = body.getBoundingClientRect().height;
  if (h <= avail) return;
  var r = Math.max(0.5, Math.floor(avail / h * 100) / 100);
  if (window.CSS && CSS.supports && CSS.supports('zoom', '0.5')) {
    body.style.zoom = r;
    // Zooming narrows the body, which can re-flow a grid into more columns and free height;
    // one more measured pass takes it back, never past full size.
    var h2 = body.getBoundingClientRect().height;
    if (h2 < avail) body.style.zoom = Math.min(1, r * avail / h2 * 0.98);
  } else {
    body.style.transformOrigin = 'top left'; body.style.transform = 'scale(' + r + ')'; body.style.width = (100 / r) + '%';
  }
}

/** ONE UNIT'S COLUMN on the day-progress slide: rank, name, a bar from where the day started
    to where it stands, and the figures under it. The bar's faint part is the morning's figure,
    the green part what was gained since, red what was lost (a corrected re-upload can move a
    figure down). The top mover and the most stuck are tagged -- and only when there is a real
    difference to tag: two officers both at nil are neither. */
function presProgGroup_(u){
  var rows = u.rows || [];
  var deltas = rows.map(function(r){ return r.deltaPct; }).filter(function(v){ return v != null; });
  var hi = deltas.length ? Math.max.apply(null, deltas) : null;
  var lo = deltas.length ? Math.min.apply(null, deltas) : null;
  var tag = function(r){
    if (rows.length < 2 || hi == null || hi === lo || r.deltaPct == null) return '';
    if (r.deltaPct === hi) return '<span class="ptag best">▲ zaidi / most</span>';
    if (r.deltaPct === lo) return '<span class="ptag stuck">▼ amekwama / stuck</span>';
    return '';
  };
  var clampPct = function(v){ return Math.max(0, Math.min(100, Number(v) || 0)); };
  var signed = function(n){ return (n > 0 ? '+' : '−') + money(Math.abs(n)); };
  var html = '<div class="pgrp"><div class="pgh"><span>' + esc(u.label) + '</span><small>' + esc(u.sub) + '</small></div>';
  if (!rows.length) html += '<div class="prow none">hakuna upload leo / nothing uploaded today</div>';
  /* The TOTAL and AVERAGE rows are drawn by the same code as an officer's row, so the three
     cannot differ in shape; they carry no rank and no tag. The server worked the total's
     percentages out from the sums and the average's as the mean per officer (see
     colTotal_/recTotal_ and colAvg_/recAvg_ in officerBoards). */
  rows.concat(u.total ? [{ ...u.total, isTotal: true }] : [], u.avg ? [{ ...u.avg, isTotal: true, isAvg: true }] : []).forEach(function(r){
    var none = !r.uploads;
    var s = r.startPct, n = r.pct, d = r.deltaPct;
    var sC = clampPct(s), nC = clampPct(n);
    var bar = '<div class="pbar"><i class="ps" style="width:' + Math.min(sC, nC) + '%"></i>'
      + (nC > sC ? '<i class="pg" style="left:' + sC + '%;width:' + (nC - sC) + '%"></i>' : '')
      + (nC < sC ? '<i class="pls" style="left:' + nC + '%;width:' + (sC - nC) + '%"></i>' : '') + '</div>';
    var dCls = d == null ? 'flat' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    var dTxt = d == null ? '—' : (d > 0 ? '+' : '') + d.toFixed(1) + ' pts';
    /* Recovery carries the shillings beside its percentage ("have both rec% and rec-Amount");
       early and collection carry who is still to pay and what is still out ("show remaining
       counts, amount uncollected and col% for early and col people"). */
    var line2 = u.money
      ? 'TZS ' + money(r.startRecovered) + ' → ' + money(r.recovered)
        + (r.deltaAmt ? ' (' + signed(r.deltaAmt) + ')' : '')
      : 'wamebaki / left ' + money(r.remaining) + ' / ' + money(r.customers) + ' · uncol TZS ' + money(r.uncollected);
    html += '<div class="prow' + (none ? ' none' : '') + (r.isTotal ? ' ptotal' : '') + (r.isAvg ? ' pavg' : '') + '">'
      + '<div class="pr1"><span class="pn">' + (r.isTotal ? '' : r.sn) + '</span><span class="po">' + esc(r.officer) + '</span>' + (r.isTotal ? '' : tag(r))
      + '<span class="pd ' + dCls + '">' + pct(s) + ' → ' + pct(n) + ' · ' + dTxt + '</span></div>'
      + bar
      + '<div class="pr2"><span>' + (none ? 'hakuna upload leo / no upload today' : esc(line2)) + '</span>'
      + '<span>' + (r.uploads || 0) + ' upload' + (r.uploads === 1 ? '' : 's') + '</span></div></div>';
  });
  return html + '</div>';
}

/** BLACK THE SCREEN WITHOUT LOSING THE DECK.
 *
 *  There is prayer time in the office, and turning the television off and on again costs the
 *  meeting a minute of watching the deck load. This covers it instead -- the presentation stays
 *  exactly where it is, still full screen, and comes back on one tap.
 *
 *  THE CLOCK STOPS WITH IT. An auto-advance running behind the black would have the deck three
 *  slides further on by the time anybody looks again, which is precisely the thing somebody
 *  standing in front of the room does not want to explain.
 */
function presBlank(on){
  S.presBlank = !!on;
  if (on){
    S.presWasRunning = !!S.presTimer;
    clearInterval(S.presTimer); S.presTimer = null;
  } else if (S.presWasRunning){
    clearInterval(S.presTimer);
    S.presTimer = setInterval(function(){ S.presI = (S.presI + 1) % S.slides.length; presDraw(); },
      Math.max(5, Math.min(300, Number(S.presSecs) || PRES_SECS_DEFAULT)) * 1000);
  }
  presDraw();
}

/** Step the deck by hand. Moving deliberately also RESTARTS the timer -- otherwise the slide
    somebody just chose to look at gets taken away a second later by a countdown that was
    already half spent, which is the most irritating thing a deck can do. */
function presGo(step){
  if (!S.slides || !S.slides.length) return;
  S.presI = (S.presI + step + S.slides.length) % S.slides.length;
  presDraw();
  if (S.presTimer){
    clearInterval(S.presTimer);
    S.presTimer = setInterval(function(){ S.presI = (S.presI + 1) % S.slides.length; presDraw(); },
      Math.max(5, Math.min(300, Number(S.presSecs) || PRES_SECS_DEFAULT)) * 1000);
  }
}
