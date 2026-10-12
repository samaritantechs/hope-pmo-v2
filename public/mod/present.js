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
    S.presData = { d: d, b: null, bWhy: '', bLoading: false };
    S.presUpdated = new Date();
    presRender();
    presBoards_(wk);
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
    return srv('officerBoards', wk).then(function(b){ mine.b = b; mine.bWhy = ''; }, function(){});
  }).then(function(){
    if (S.presData !== mine || !mine.d) return;
    S.presUpdated = new Date();
    var keep = S.presI;
    presApply();
    S.presI = Math.min(keep, Math.max(0, S.slides.length - 1));
    if (document.getElementById('pres').style.display === 'block') presDraw();
  }).catch(function(){ /* a missed refresh keeps the last figures; the stamp says how old they are */ });
}

/** Build every slide from the figures already in hand. Filtering (which segments, which team)
    happens afterwards in presApply, so a choice never costs a request. */
function presSlides(){
    var d = S.presData.d, b = S.presData.b, c = d.cards;
    var slides = [];
    slides.push({ id:'kpi', kind:'kpi', title:'HOPE PMO — ' + d.weekday, items:[
      { l:'Current arrears', v:'TZS '+money(c.curArrears) },
      { l:'Recovered', v:'TZS '+money(c.recovered) },
      { l:'Defaulters', v:money(c.defaulters) },
      { l:'Sales this week', v:'TZS '+money(c.salesWeek) },
      { l:'Uncollected today', v:'TZS '+money(c.uncollectedToday) },
      { l:'Abnormal', v:money(c.abnormal) }]});
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
    slides.push({ id:'early', kind:'table',
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
      cols:[col('officer','Officer'), col('teams','Teams','num'),
        col('remaining','Wamebaki / Left','num'), col('count1','Count 1 (NC 1)','num'), col('customers','Wateja / Customers','num'),
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
            return n ? '<div>' + n + '</div>' : ''; })() });
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
    slides.push({ id:'pmo', kind:'table', title:'PMO Collection — kila siku / each day, then the week',
      caption: uaCap('Col', ua.col)
        // Count 1 here is today's DAY sheet; its gaps, by team, said the same way as the early slide's.
        + (function(){
            var n = count1Note_(!!((b.pmo || []).length && (b.pmo || []).every(function(x){ return x.count1 == null; })),
              b.pmoCount1Missing, 'Expected ya leo / today\'s day sheet' + (b.today ? ' (' + b.today + ')' : ''));
            return n ? '<div>' + n + '</div>' : ''; })(),
      rows:(b.pmo||[]).slice(0,12),
      /* COUNT 1 BETWEEN TEAMS AND J3 -- "add count 1 column too", then "sum of nc 1 of
         underpaid and unpaid per pmo": today's sheet, the officer's teams, the customers whose
         N.C column is 1 and who are UNDERPAID or UNPAID, added up. Null until db/RUN-ME-039 is
         run and the sheet uploaded again; the early slide's caption says so. */
      cols:[col('officer','PMO'), col('teams','Teams','num'), col('count1','Count 1 (NC 1 leo)','num'),
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
    slides.push({ id:'legal', kind:'table', title:'Legal recovery — notisi za madai / demand notices · leo / today, then the week',
      caption: lgCap, rows:(b.legal||[]).slice(0,12),
      cols:[col('officer','Legal officer'), col('teams','Teams','num'), col('customers','Customers','num'),
        col('owed','Owed at notice','money'),
        col('tRecovered','Recovered today','money'), {key:'tPct', label:'Rec % (today)', kind:'pct', target:'rec', from:['tRecovered','owed']},
        col('recovered','Recovered (week)','money'), {key:'pct', label:'Rec % (week)', kind:'pct', target:'rec', from:['recovered','owed']}] });
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
        + (unitOnly ? ' · Expected · Collection · Recovery' : ' · vitengo havijawekwa / units not set'),
      rows: callRows,
      cols:[{ key:'end', label:'', cls:function(r){ return r.end==='Busiest' ? 'good' : r.end==='Least active' ? 'bad' : ''; } },
        col('agent','Officer'), col('unit','Unit'), col('team','Team'), col('calls','Calls','num'), col('dials','Dials','num'),
        col('duration','Portfolio talk','dur'), col('portfolio','Portfolio','num'), col('connectPct','Reached %','pct')] });
    slides.push({ id:'credit', kind:'table', title:'Credit analysts — this week', rows:b.creditWeek.slice(0,12),
      cols:[col('analyst','Analyst'), col('apps','Apps','num'), col('amount','Amount','money'),
        col('salesPct','Sales %','pct'), col('perf','Perf','pct')] });
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

    HEAD = weekBar(d) + boardsNote + '<div class="kpis">'
      + kpi('Slides', money(S.slides.length), (S.presOff.length? money(S.presOff.length)+' hidden' : 'live figures, not a screenshot'), '', 'presCount')
      + kpi('Seconds per slide', String(S.presSecs || 15), 'change below')
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
        + '<input type="number" id="presSecs" min="5" max="300" value="'+(S.presSecs||15)+'" style="width:80px">'
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
    Math.max(5, Math.min(300, Number(S.presSecs) || 15)) * 1000);
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
    body = '<div class="pkpis">' + s.items.map(function(it){
      return '<div class="pkpi"><div class="pl">'+esc(it.l)+'</div><div class="pv">'+esc(it.v)+'</div></div>'; }).join('') + '</div>';
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
    body = '<div class="pscroll"><table class="ptable"><thead><tr><th>#</th>' + s.cols.map(function(c){
        return '<th class="'+(isNum(c)?'r':'')+'">'+esc(c.label)+'</th>'; }).join('') + '</tr></thead><tbody>'
      + s.rows.map(function(r,i){ return '<tr><td>'+(i+1)+'</td>'+s.cols.map(function(c){
          var k = cellCls_(r, c, ctx);
          return '<td class="'+(isNum(c)?'r':'')+(k?' '+k:'')+'">'+cellHtml(r,c)+'</td>'; }).join('')+'</tr>'; }).join('')
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
      Math.max(5, Math.min(300, Number(S.presSecs) || 15)) * 1000);
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
      Math.max(5, Math.min(300, Number(S.presSecs) || 15)) * 1000);
  }
}
