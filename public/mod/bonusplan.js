/* bonusplan -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/bonusplan.js?v=BUILD. */

/* =====================================================================================
   BONASI YA KILA SIKU / DAILY BONUS PLAN -- the daily bonus meter and the leaders'
   checklist, drawn as a PICTURE so the GM can say what to change.

     "GM needs an idea to breakdown - Bonuses by day criteria from assessment plan to recovery
      like we've always had monthly bonus of 100k to a team and 100k to each of its unit
      leaders if they hit standard of collection 96%, sales 80% and recovery 120% but gm
      needs teams to hit these daily and see what they progressively earn as bonus per day to
      the end of the month"
     "GM also needs Leaders checklist - with pictures of timestamps or timelimits of filling
      they've supervised or fulfilled tasks ... and if someone misses the filling per day then
      they under perform and from this we get leaders bonuses by progress per day ... so on
      this create a new tab and fill your buildup idea so that I get a picture"

   A PREVIEW AND NOTHING ELSE. No server call, no table, nothing saved, no real team's figures:
   the month on the screen is an EXAMPLE (the page says so), and the boxes are there to be
   changed. It adds no read to /api/upload or /api/call, which is rule one of this repository,
   and it is the reason this is safe to ship before a single rule has been agreed.

   THE MATHS IS REAL, THOUGH, and it is pure -- bpWhole_, bpDay_, bpMonth_, bpChecklist_ and
   bpLeaderDay_ take plain numbers and return plain numbers, so the same functions can move to
   the server when the plan is agreed and test/pages.test.mjs already runs them for real.

   ONE RULE CARRIED OVER, not invented: a percentage is read the way it is SHOWN, half and
   above rounding up (89.5 is 90), exactly as the commission ladders now do (wholePct in
   api/_lib/recovery.js). A gate that rounded differently from the board next to it would be
   two answers about the same figure.
   ===================================================================================== */
var BP = null;

var BP_PICK = [         // Collection %, Sales % of the daily target, Recovery % -- EXAMPLE figures
  [97,85,124],[96,78,131],[95,92,118],[98,81,126],[96,70,140],[97,88,121],[93,96,119],
  [96,82,122],[96,84,135],[95.6,91,120],[97,79.6,128],[98,86,133],[94,90,117],[96,83,123],
  [97,95,129],[96,80,120],[99,87,138],[96,77,125],[95,88,121],[97,84,127],[96,82,130],[98,90,136]];
var BP_EV = { photo:'Picha ya app / in-app photo', screen:'Skrini / screenshot', auto:'Mfumo / system checks',
              tick:'Tiki + maoni / tick + note' };
/* Each leader: what they lead, the THREE results gates their day is scored on, and the
   checklist. due = the time it must be filled by; ev = how it is proved; pts = weight;
   must = a day without it is a lost checklist. All of it a proposal, to be changed. */
var BP_LEADERS = [
  { role:'Meneja wa Eneo / Area Manager', leads:'his own team(s)',
    gates:['Collection ≥ 96%','Sales ≥ 80% of target','Recovery ≥ 120%'], items:[
    {id:'am1',t:'Team at the meeting point — group photo, everyone present',due:'07:15',ev:'photo',pts:2},
    {id:'am2',t:'Assessment plan reviewed (who to visit, max loans marked)',due:'07:45',ev:'screen',pts:3,must:1},
    {id:'am3',t:'Roles for the day in every car: who is on sales, collection, recovery',due:'07:45',ev:'tick',pts:2},
    {id:'am4',t:'Car OK: fuel dashboard, tools, spare tyre, phones charged',due:'07:45',ev:'photo',pts:2,must:1},
    {id:'am5',t:'Early collection status posted: Expected called, % paid so far',due:'10:00',ev:'screen',pts:2},
    {id:'am6',t:'Sales progress posted; every live assessment sent up to Credit',due:'13:00',ev:'screen',pts:2},
    {id:'am7',t:'Pending assessments uploaded before Credit leaves at 17:00',due:'15:00',ev:'auto',pts:2},
    {id:'am8',t:'Unpaid Expected and defaulters: visit plan posted, photo at first visit',due:'16:30',ev:'photo',pts:2},
    {id:'am9',t:'Day report: sales, collection %, recovery %, tomorrow’s assessment list',due:'18:00',ev:'screen',pts:3,must:1},
    {id:'am10',t:'Calls made in the app with a comment on each; new numbers entered',due:'18:00',ev:'auto',pts:2}] },
  { role:'GMO', leads:'every team in the region',
    gates:['Regional collection ≥ 96%','Regional sales ≥ 80%','Regional recovery ≥ 120%'], items:[
    {id:'gm1',t:'Yesterday’s result per team reviewed (dashboard screenshot)',due:'07:30',ev:'screen',pts:2,must:1},
    {id:'gm2',t:'Briefing call with the managers held',due:'08:15',ev:'auto',pts:2},
    {id:'gm3',t:'The two weakest teams named in the group, with the action for each',due:'09:30',ev:'screen',pts:3,must:1},
    {id:'gm4',t:'Weakest team called or visited (call log or location pin)',due:'12:00',ev:'auto',pts:2},
    {id:'gm5',t:'Recovery push: the lowest-recovery team contacted',due:'15:30',ev:'screen',pts:2},
    {id:'gm6',t:'Visit day only: photo at the team with timestamp',due:'17:00',ev:'photo',pts:2},
    {id:'gm7',t:'Region day report posted',due:'18:30',ev:'screen',pts:3,must:1}] },
  { role:'OPM', leads:'all field operations',
    gates:['Company collection ≥ 96%','Company sales ≥ 80%','Company recovery ≥ 120%'], items:[
    {id:'op1',t:'Yesterday’s company board reviewed; today’s focus posted',due:'07:30',ev:'screen',pts:3,must:1},
    {id:'op2',t:'GMOs’ briefing held',due:'08:30',ev:'auto',pts:2},
    {id:'op3',t:'Early collection checked across regions',due:'10:30',ev:'screen',pts:2},
    {id:'op4',t:'Sales against the daily target reviewed; shortfall teams named',due:'14:00',ev:'screen',pts:2},
    {id:'op5',t:'Open escalations: complaints, police, legal — each has an owner',due:'16:00',ev:'tick',pts:2},
    {id:'op6',t:'Day report to the GM posted',due:'18:30',ev:'screen',pts:3,must:1}] },
  { role:'PMO Supervisor', leads:'the PMO units',
    gates:['Early collection ≥ 90%','Collection ≥ 96%','Recovery ≥ 120%'], items:[
    {id:'ps1',t:'Yesterday’s board reviewed: every PMO unit’s %',due:'07:30',ev:'screen',pts:2,must:1},
    {id:'ps2',t:'One short huddle (15 min at most) held; assignments out',due:'08:30',ev:'tick',pts:2},
    {id:'ps3',t:'Early collection status per officer posted',due:'10:00',ev:'screen',pts:2},
    {id:'ps4',t:'Abnormal payments reviewed today (reviewed count)',due:'12:00',ev:'auto',pts:3,must:1},
    {id:'ps5',t:'Call-rate check: each PMO and bike officer at target',due:'13:30',ev:'auto',pts:2},
    {id:'ps6',t:'Bike attendance inspected: tracking-app screenshot',due:'16:00',ev:'photo',pts:2},
    {id:'ps7',t:'Closing summary to the PMO Manager',due:'17:30',ev:'screen',pts:3,must:1}] },
  { role:'CS Agent Supervisor', leads:'the call-centre agents',
    gates:['Dockets ≥ 3 per team','Every docket handed over within 30 min','Names and numbers verified before approval'], items:[
    {id:'cs1',t:'Agents present; desks and lines ready (roster ticked)',due:'07:45',ev:'tick',pts:2},
    {id:'cs2',t:'Dockets so far against 3+ per team',due:'10:00',ev:'auto',pts:2},
    {id:'cs3',t:'Three call recordings sampled and scored',due:'12:00',ev:'screen',pts:2},
    {id:'cs4',t:'Names and numbers of every new application double-checked',due:'13:00',ev:'auto',pts:3,must:1},
    {id:'cs5',t:'Every docket handed to its manager within 30 minutes',due:'16:00',ev:'auto',pts:2},
    {id:'cs6',t:'Dockets-of-the-day report posted',due:'17:30',ev:'screen',pts:3,must:1}] },
  { role:'PMO Manager', leads:'the PMO office',
    gates:['Collection ≥ 96%','Recovery ≥ 120%','Abnormal + trapped payments cleared'], items:[
    {id:'pm1',t:'Yesterday’s units reviewed; today’s focus posted',due:'07:30',ev:'screen',pts:2,must:1},
    {id:'pm2',t:'Early collection status asked from the lead',due:'09:30',ev:'tick',pts:2},
    {id:'pm3',t:'Abnormal and trapped payments cleared or assigned',due:'12:00',ev:'auto',pts:3,must:1},
    {id:'pm4',t:'Meetings kept to the two fixed windows (08:30 and 15:30)',due:'16:00',ev:'tick',pts:1},
    {id:'pm5',t:'Collection and recovery push for the weakest units',due:'15:30',ev:'screen',pts:2},
    {id:'pm6',t:'PMO day report to the GM posted',due:'17:30',ev:'screen',pts:3,must:1}] }];

/** A percentage the way the board SHOWS it: half and above rounds up. Mirrors wholePct in
    api/_lib/recovery.js -- the 1e-9 is floating-point noise, nothing legitimate lives there. */
function bpWhole_(p){
  if (p == null || p === '') return null;
  var n = Number(p);
  return isFinite(n) ? Math.round(n + 1e-9) : null;
}

function bpNum_(v){ var n = Number(v); return (v === '' || v == null || !isFinite(n) || n < 0) ? 0 : n; }

function bpGate_(v, need){ var p = bpWhole_(v); return p != null && p >= need; }

/** One day's three gates and the share of the day's slice they earn. `share` is the weight of
    the gates hit over the weight of all three, so a day is worth what it earned, not all-or-nothing. */
function bpDay_(row, cfg){
  var gc = bpGate_(row[0], cfg.g.col), gs = bpGate_(row[1], cfg.g.sales), gr = bpGate_(row[2], cfg.g.rec);
  var wsum = cfg.w.col + cfg.w.sales + cfg.w.rec;
  var pts = (gc ? cfg.w.col : 0) + (gs ? cfg.w.sales : 0) + (gr ? cfg.w.rec : 0);
  return { col:gc, sales:gs, rec:gr, share: wsum > 0 ? pts / wsum : 0, perfect: gc && gs && gr };
}

/** The month so far. The pot is cut into one slice per WORKING day (rows.length), a day earns
    its slice times its share, and -- only if switched on -- a perfect day after `sFrom` perfect
    days in a row earns `sPct` more, never past `cap`% of the pot. Days beyond `played` have
    not happened: they earn nothing and are not counted as misses. */
function bpMonth_(rows, played, cfg){
  var n = rows.length, slice = n ? cfg.pot / n : 0, run = 0, exact = 0, streak = 0, perfect = 0, out = [];
  var p = Math.max(0, Math.min(played, n)), capAmt = cfg.pot * cfg.cap / 100;
  for (var i = 0; i < n; i++) {
    if (i >= p) { out.push({ ahead:true }); continue; }
    var d = bpDay_(rows[i], cfg);
    streak = d.perfect ? streak + 1 : 0;
    var boost = (cfg.streak && d.perfect && streak >= cfg.sFrom) ? cfg.sPct / 100 : 0;
    /* ROUNDED ON THE RUNNING TOTAL, NOT PER DAY. A pot that does not divide by the days (100,000 over
       22 is 4,545.45) would otherwise lose a few shillings to rounding every day and a perfect month
       would pay 99,990. The day shows the whole shillings the running total just gained. */
    exact += slice * (d.share + boost);
    var earn = Math.max(0, Math.min(Math.round(exact), Math.round(capAmt)) - run);
    run += earn; if (d.perfect) perfect++;
    out.push({ d:d, earn:earn, run:run, streak:streak, boost:boost > 0 });
  }
  // Today's rule, on the same days: the month's AVERAGE against the three standards, all or nothing.
  var avg = [0, 1, 2].map(function(k){ var s = 0; for (var j = 0; j < p; j++) s += Number(rows[j][k]) || 0; return p ? s / p : null; });
  var oldWins = p > 0 && bpGate_(avg[0], cfg.g.col) && bpGate_(avg[1], cfg.g.sales) && bpGate_(avg[2], cfg.g.rec);
  return { days:out, slice:slice, played:p, earned:run, perfectDays:perfect,
    maxSoFar: Math.round(slice * p),
    pace: p ? Math.min(Math.round(capAmt), Math.round(exact / p * n)) : 0,   // from the unrounded total, or ten perfect days pace to 100,001
    oldRule: oldWins ? cfg.pot : 0, avg:avg };
}

/** A leader's checklist for one day. on time = full points, late = `latePct`% of them, missed = 0.
    A mandatory item missed loses the whole checklist; a checklist with nothing filled at all is
    `unfilled`. */
function bpChecklist_(items, st, cfg){
  var total = 0, got = 0, ok = 0, late = 0, miss = 0, must = false;
  for (var i = 0; i < items.length; i++) {
    var it = items[i], s = st[it.id] || 'ok';
    total += it.pts;
    if (s === 'ok') { got += it.pts; ok++; }
    else if (s === 'late') { got += it.pts * cfg.latePct / 100; late++; }
    else { miss++; if (it.must) must = true; }
  }
  var score = total ? got / total : 0;
  if (must) score = 0;
  return { score:score, ok:ok, late:late, missed:miss, mustMissed:must, unfilled: items.length > 0 && miss === items.length };
}

/** A leader's day: the checklist share plus the results share (gates hit out of three). A day
    with nothing filled is lost outright when `lose` is on -- that is the "no filling means under-
    performed" rule, stated once. */
function bpLeaderDay_(items, st, cfg, nDays){
  var c = bpChecklist_(items, st, cfg), cw = cfg.lw / 100;
  var share = (c.unfilled && cfg.lose) ? 0 : cw * c.score + (1 - cw) * (cfg.results / 3);
  var slice = nDays ? cfg.lpot / nDays : 0;
  return { c:c, share:share, slice:slice, earn:Math.round(slice * share) };
}

function bpState_(){
  if (BP) return BP;
  BP = { pot:100000, lpot:100000, w:{col:40,sales:30,rec:30}, g:{col:96,sales:80,rec:120},
    streak:false, sFrom:3, sPct:25, cap:125, played:15, lw:40, latePct:50, lose:true, results:2, role:0,
    rows: BP_PICK.map(function(r){ return r.slice(); }), st:{ am4:'late', am5:'miss' } };
  return BP;
}

function bpDayLabels_(){        // the working days of the example month, October 2026
  var nm = ['Jpl','Jtt','Jnn','Jtn','Alh','Ijm','Jms'], out = [];
  for (var d = 1; d <= 31; d++) {
    var dt = new Date(Date.UTC(2026, 9, d)), w = dt.getUTCDay();
    if (w >= 1 && w <= 5) out.push(nm[w] + ' ' + d);
  }
  return out;
}

function bpFld_(label, path, val, extra){
  return '<div class="fld"><label>' + label + '</label><input type="number" min="0" step="any" data-bp="' + path
    + '" value="' + esc(val) + '"' + (extra || '') + '></div>';
}

function bpHtml_(){
  var B = bpState_(), labels = bpDayLabels_();
  var ideas = '<div class="cols">'
    + '<div class="box"><b class="t">Leo / Today</b>One verdict at the end of the month: the team earns the pot only if the MONTH reached '
      + 'collection 96%, sales 80% and recovery 120%. Miss one in the last week and the month is lost; nobody sees what they have '
      + 'earned until it is over.</div>'
    + '<div class="box new"><b class="t">Pendekezo / Proposed</b>Every working day carries a slice of the pot. The slice is split across the three '
      + 'gates by weight, so a team ends each day knowing what it banked and what it left on the table.</div>'
    + '<div class="box"><b class="t">Kwa nini / Why</b>A bad Tuesday no longer kills the month, so there is a reason to fight on it. '
      + 'Hitting all three gates every day still earns exactly today’s pot — the budget does not move, unless the streak boost below is switched on.</div></div>';
  var cfg = '<div class="cfg">'
    + bpFld_('Bonasi ya timu (TZS)', 'pot', B.pot)
    + bpFld_('Collection ≥ %', 'g.col', B.g.col) + bpFld_('Sales ≥ % of daily target', 'g.sales', B.g.sales)
    + bpFld_('Recovery ≥ %', 'g.rec', B.g.rec)
    + bpFld_('Uzito: Collection / weight', 'w.col', B.w.col) + bpFld_('Uzito: Sales / weight', 'w.sales', B.w.sales)
    + bpFld_('Uzito: Recovery / weight', 'w.rec', B.w.rec)
    + bpFld_('Siku zilizochezwa / Days played', 'played', B.played, ' max="' + B.rows.length + '"')
    + '<div class="fld"><label>Streak boost</label><label style="font-weight:600;color:var(--ink);display:flex;gap:6px;align-items:center">'
      + '<input type="checkbox" data-bp="streak"' + (B.streak ? ' checked' : '') + ' style="width:auto"> on</label></div>'
    + bpFld_('Boost after perfect days in a row', 'sFrom', B.sFrom) + bpFld_('Boost: +% of the slice', 'sPct', B.sPct)
    + bpFld_('Cap: % of the pot', 'cap', B.cap) + '</div>'
    + '<div style="padding:0 14px 12px;font-size:12px;color:var(--mut)">Asilimia zinasomwa kama zinavyoonekana (89.5 → 90), kanuni ile ile ya kamisheni. '
    + '/ A percentage is read the way the board shows it: half and above rounds up, as in My Commission.</div>';
  var kp = '<div class="kpis" style="padding:0 14px">'
    + kpi('Kipande cha siku / Daily slice', '<span data-bpo="slice">—</span>', 'pot ÷ working days')
    + kpi('Umepata / Earned so far', '<span data-bpo="earned">—</span>', '', 'good')
    + kpi('Kiwango cha juu / Most possible so far', '<span data-bpo="max">—</span>')
    + kpi('Mwezi kwa mwenendo huu / Month at this pace', '<span data-bpo="pace">—</span>', '', 'warnc')
    + kpi('Njia ya sasa / Today’s rule', '<span data-bpo="old">—</span>', 'month average, all or nothing')
    + kpi('Siku kamili / Perfect days', '<span data-bpo="perf">—</span>')
    + '</div>';
  var rows = B.rows.map(function(r, i){
    return '<tr data-bprow="' + i + '"><td>' + esc(labels[i] || ('Siku ' + (i + 1))) + '</td>'
      + [0, 1, 2].map(function(j){
          return '<td><input type="number" step="any" data-bp="r.' + i + '.' + j + '" value="' + esc(r[j]) + '">'
            + ' <span class="gate" data-bpg="' + i + '.' + j + '">·</span><small data-bpr="' + i + '.' + j + '" style="color:var(--mut)"></small></td>';
        }).join('')
      + '<td data-bpo="e.' + i + '">—</td><td data-bpo="r.' + i + '">—</td>'
      + '<td><div class="meter"><i data-bpo="m.' + i + '" style="width:0"></i></div></td></tr>';
  }).join('');
  var tbl = '<div class="scroll2"><table class="bpt"><thead><tr><th>Siku / Day</th><th>Collection %</th><th>Sales %</th>'
    + '<th>Recovery %</th><th>Leo / Today</th><th>Jumla / Running</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<div style="padding:8px 14px 12px;font-size:12px;color:var(--mut)">MIFANO TU / EXAMPLE FIGURES ONLY — change any cell to see the day recalculate. '
    + 'Two cells show the rounding rule: 95.6 reads as 96 and 79.6 as 80.</div>';
  var lead = '<div class="scroll2"><table class="bpt"><thead><tr><th>Kiongozi / Leader</th><th>Anaongoza / Leads</th>'
    + '<th style="text-align:left">Matokeo (gates 3) / Result gates</th></tr></thead><tbody>'
    + BP_LEADERS.map(function(L){
        return '<tr><td><b>' + esc(L.role) + '</b></td><td style="text-align:left">' + esc(L.leads) + '</td>'
          + '<td style="text-align:left;white-space:normal">' + L.gates.map(esc).join(' · ') + '</td></tr>'; }).join('')
    + '</tbody></table></div>'
    + '<div style="padding:8px 14px 12px;font-size:12.5px;line-height:1.55">'
    + 'Siku ya kiongozi = kipande × ( uzito wa checklist × alama za checklist + (100 − uzito) × matokeo ). '
    + 'Leader’s day = slice × ( checklist weight × checklist score + (100 − weight) × results ). '
    + 'CS agents, PMOs and Credits keep earning on the team pot exactly as they do today.</div>';
  var pills = '<div class="pills" style="padding:0 14px">' + BP_LEADERS.map(function(L, i){
    return '<button class="pill' + (B.role === i ? ' on' : '') + '" data-bp-role="' + i + '">' + esc(L.role) + '</button>'; }).join('') + '</div>';
  var safe = '<ul class="bpul"><li><b>Picha ndani ya app tu</b> — no gallery uploads. The SERVER stamps the time, not the phone, so a clock set back changes nothing.</li>'
    + '<li><b>Mahali + saa</b> on every photo: an office photo at 07:15 while the team is in the field shows.</li>'
    + '<li><b>Dirisha la muda</b>: on time up to the due time, late up to 30 minutes after (half points), then missed. Nothing can be filled after midnight; an edited entry is marked edited.</li>'
    + '<li><b>Mfumo unajiangalia</b> (AUTO items): calls with comments, new numbers entered, assessments uploaded — there is no photo to fake.</li>'
    + '<li><b>Ukaguzi</b>: the GM or OPM spot-checks a few leader-days each week; a false entry costs that month’s leader bonus (to be decided).</li>'
    + '<li><b>Namba moja</b>: gates use the same whole-percent rule and the same figures as My Commission, so nobody argues about which number counts.</li></ul>';
  var plan = '<div class="cols">'
    + '<div class="box"><b class="t">Hatua 1 — wiki 2 / Phase 1</b>Run it by hand from the boards that already exist: the system already knows each team’s daily collection, sales and recovery. Post the meter in the group each evening. Nothing to build yet.</div>'
    + '<div class="box"><b class="t">Hatua 2 / Phase 2</b>Leaders’ checklist screen in the app: one table of entries (who, item, server time, photo, location), one nightly job that scores the day. Not in the upload or call paths.</div>'
    + '<div class="box"><b class="t">Hatua 3 / Phase 3</b>The meter on each team’s phone and in My Commission, with the month’s running total and what was left on the table. Migration runs by hand; the screen works without it.</div></div>'
    + '<div style="padding:0 14px 12px"><b style="font-size:13px">Maamuzi yanayohitajika / Decisions needed</b><ul class="bpul">'
    + '<li>Budget: a team that averages 96 / 80 / 120 but misses some days earns LESS than today’s rule pays (the example month above shows it). '
      + 'The meter rewards consistency. Decide whether a month that clears all three standards in total is topped up to the full pot.</li>'
    + '<li>Weights 40 / 30 / 30 — or equal thirds? Partial credit for 2 of 3 gates, or all-or-nothing per day?</li>'
    + '<li>Streak boost: yes or no, after how many days, with what cap on the budget?</li>'
    + '<li>Does Saturday count? Holidays and no-field days: remove the day and re-split the pot over the rest.</li>'
    + '<li>Sales gate: 80% of which daily target, and how a team that moves mid-month is pro-rated.</li>'
    + '<li>Leaders: checklist weight (40%), late grace (30 min, half points), “unfilled day is lost”, and the mandatory items per role.</li>'
    + '<li>Who audits, what a false entry costs, the pay date and the window to dispute a day.</li></ul></div>';
  return '<div class="bp" id="bpRoot">'
    + '<div class="note" style="display:block">⚠ <b>RASIMU / DRAFT — kwa majadiliano.</b> Hakuna kinachohifadhiwa na hakuna namba ya timu halisi hapa; '
    + 'mwezi ulio hapa chini ni mfano. / Nothing is saved and no real team’s figures are used — the month below is an example. '
    + 'Change any box and the screen recalculates.</div>'
    + '<div class="card"><div class="card-h">Wazo / The idea<span class="sub">kutoka bonasi ya mwezi hadi bonasi ya kila siku · from a monthly cliff to a daily meter</span></div>' + ideas + '</div>'
    + '<div class="card"><div class="card-h">Timu — mita ya kila siku / Team daily meter<span class="sub">mfano: Oktoba 2026, siku 22 · example month</span></div>'
      + cfg + kp + tbl + '</div>'
    + '<div class="card"><div class="card-h">Viongozi / Leaders<span class="sub">meneja, GMO, OPM, PMO supervisor, CS agent supervisor, PMO manager</span></div>' + lead + '</div>'
    + '<div class="card"><div class="card-h">Checklist ya kiongozi / Leader’s daily checklist<span class="sub">chagua kiongozi, weka hali ya kila kipengele · pick a leader, set each item</span></div>'
      + pills + '<div id="bpLeader">' + bpLeaderHtml_() + '</div></div>'
    + '<div class="card"><div class="card-h">Ushahidi na ulinzi / Evidence and safeguards</div>' + safe + '</div>'
    + '<div class="card"><div class="card-h">Jinsi ya kujenga / How it would be built</div>' + plan + '</div>'
    + '</div>';
}

function bpLeaderHtml_(){
  var B = bpState_(), L = BP_LEADERS[B.role];
  var rows = L.items.map(function(it){
    var s = B.st[it.id] || 'ok';
    return '<tr><td style="text-align:left;white-space:normal;min-width:260px">' + esc(it.t) + (it.must ? ' <span class="chip bad">lazima / must</span>' : '') + '</td>'
      + '<td>' + esc(it.due) + '</td><td style="text-align:left"><span class="chip">' + esc(BP_EV[it.ev]) + '</span></td><td>' + it.pts + '</td>'
      + '<td><select data-bp="st.' + it.id + '"><option value="ok"' + (s === 'ok' ? ' selected' : '') + '>Kwa wakati / On time</option>'
      + '<option value="late"' + (s === 'late' ? ' selected' : '') + '>Imechelewa / Late</option>'
      + '<option value="miss"' + (s === 'miss' ? ' selected' : '') + '>Haikufanyika / Missed</option></select></td></tr>';
  }).join('');
  return '<div class="scroll2"><table class="bpt"><thead><tr><th style="text-align:left">Kipengele / Item</th><th>Saa / Due</th>'
    + '<th style="text-align:left">Ushahidi / Proof</th><th>Alama</th><th>Hali / Status</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<div class="cfgbox" style="padding:10px 14px 0;font-size:12px;color:var(--mut)">Matokeo matatu ya ' + esc(L.role) + ': '
    + L.gates.map(esc).join(' · ') + '</div>' + bpLeaderCfg_()
    + '<div class="kpis" style="padding:0 14px">'
    + kpi('Alama za checklist / Checklist score', '<span data-bpo="lscore">—</span>')
    + kpi('Siku ya leo / Today', '<span data-bpo="learn">—</span>', '', 'good')
    + kpi('Kipande cha siku / Daily slice', '<span data-bpo="lslice">—</span>')
    + kpi('Mwezi kama kila siku ni leo / Month if every day were today', '<span data-bpo="lmonth">—</span>', '', 'warnc') + '</div>'
    + '<div id="bpLnote" style="padding:0 14px 12px;font-size:12px;color:var(--mut)"></div>';
}

function bpLeaderCfg_(){
  var B = bpState_();
  return '<div class="cfg">'
    + bpFld_('Bonasi ya kiongozi (TZS)', 'lpot', B.lpot)
    + bpFld_('Uzito wa checklist % / Checklist weight', 'lw', B.lw)
    + bpFld_('Imechelewa = % ya alama / Late counts as %', 'latePct', B.latePct)
    + '<div class="fld"><label>Matokeo ya leo / Result gates hit</label><select data-bp="results">'
      + [0, 1, 2, 3].map(function(n){ return '<option value="' + n + '"' + (B.results === n ? ' selected' : '') + '>' + n + ' / 3</option>'; }).join('')
      + '</select></div>'
    + '<div class="fld"><label>Siku isiyojazwa / Unfilled day</label><label style="font-weight:600;color:var(--ink);display:flex;gap:6px;align-items:center">'
      + '<input type="checkbox" data-bp="lose"' + (B.lose ? ' checked' : '') + ' style="width:auto"> day is lost</label></div></div>';
}

/** Writes every computed cell. Called after any change, and it only sets text and classes, so a
    box being typed in keeps its focus -- redrawing the page on each keystroke would not. */
function bpRefresh_(){
  var B = bpState_(), root = document.getElementById('bpRoot');
  if (!root) return;
  var set = function(k, v){ var el = root.querySelector('[data-bpo="' + k + '"]'); if (el) el.textContent = v; };
  var m = bpMonth_(B.rows, B.played, B);
  set('slice', money(m.slice)); set('earned', money(m.earned)); set('max', money(m.maxSoFar));
  set('pace', money(m.pace)); set('old', money(m.oldRule));
  set('perf', m.perfectDays + ' / ' + m.played);
  m.days.forEach(function(d, i){
    var tr = root.querySelector('[data-bprow="' + i + '"]');
    if (tr) tr.className = d.ahead ? 'ahead' : '';
    [0, 1, 2].forEach(function(j){
      var g = root.querySelector('[data-bpg="' + i + '.' + j + '"]'), r = root.querySelector('[data-bpr="' + i + '.' + j + '"]');
      var v = B.rows[i][j], w = bpWhole_(v);
      if (g) {
        if (d.ahead) { g.className = 'gate'; g.textContent = '·'; }
        else { var hit = j === 0 ? d.d.col : j === 1 ? d.d.sales : d.d.rec; g.className = 'gate ' + (hit ? 'y' : 'n'); g.textContent = hit ? '✓' : '✗'; }
      }
      if (r) r.textContent = (w != null && String(Number(v)) !== String(w) && !d.ahead) ? ' →' + w : '';
    });
    set('e.' + i, d.ahead ? '—' : money(d.earn) + (d.boost ? ' +' : ''));
    set('r.' + i, d.ahead ? '—' : money(d.run));
    var bar = root.querySelector('[data-bpo="m.' + i + '"]');
    if (bar) bar.style.width = (d.ahead || !B.pot ? 0 : Math.min(100, Math.round(d.run / B.pot * 100))) + '%';
  });
  var L = BP_LEADERS[B.role], ld = bpLeaderDay_(L.items, B.st, B, B.rows.length);
  set('lscore', Math.round(ld.c.score * 100) + '%');
  set('learn', money(ld.earn)); set('lslice', money(ld.slice));
  set('lmonth', money(Math.round(ld.earn * B.rows.length)));
  var note = root.querySelector('#bpLnote');
  if (note) note.textContent = ld.c.unfilled && B.lose ? 'Hakuna kilichojazwa → siku imepotea. / Nothing filled in → the day is lost.'
    : ld.c.mustMissed ? 'Kipengele cha lazima kimekosekana → sehemu ya checklist ni sifuri. / A mandatory item was missed → the checklist share is zero.'
    : ld.c.ok + ' kwa wakati, ' + ld.c.late + ' zimechelewa, ' + ld.c.missed + ' hazikufanyika. / ' + ld.c.ok + ' on time, ' + ld.c.late + ' late, ' + ld.c.missed + ' missed.';
}

function bpSet_(path, el){
  var B = bpState_(), p = path.split('.');
  if (p[0] === 'r') { B.rows[+p[1]][+p[2]] = el.value === '' ? '' : Number(el.value); return; }
  if (p[0] === 'st') { B.st[p[1]] = el.value; return; }
  var v = el.type === 'checkbox' ? el.checked : (path === 'results' ? Number(el.value) : bpNum_(el.value));
  if (p.length === 2) B[p[0]][p[1]] = v; else B[p[0]] = v;
}

function bpWire_(){
  var root = document.getElementById('bpRoot');
  if (!root || root.getAttribute('data-wired')) return;
  root.setAttribute('data-wired', '1');
  var onChange = function(e){
    var el = e.target, path = el && el.getAttribute && el.getAttribute('data-bp');
    if (!path) return;
    bpSet_(path, el);
    bpRefresh_();
  };
  root.addEventListener('input', onChange);
  root.addEventListener('change', onChange);
  root.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('[data-bp-role]') : null;
    if (!b) return;
    bpState_().role = Number(b.getAttribute('data-bp-role'));
    Array.prototype.forEach.call(root.querySelectorAll('[data-bp-role]'), function(x){
      x.classList.toggle('on', x === b); });
    document.getElementById('bpLeader').innerHTML = bpLeaderHtml_();
    bpRefresh_();
  });
  bpRefresh_();
}

VIEWS.bonusplan = function(){
  HEAD = bpHtml_();
  S.rows = []; S.cols = []; ONROW = null;
  return Promise.resolve();
};
