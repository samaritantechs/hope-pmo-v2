/* deduct -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/deduct.js?v=BUILD. */

/* PMO DEDUCTION -- the Portfolio Monitoring form and its register, in from Google Sheets:
   "i also want to build the pmo deduction pannel shift from google sheets into the pmo
   portal". The register for a date window (this month by default), the cards the sheet's
   report opened with, the form (one case, many accused staff), HR's column on a tapped row,
   and the three-section report the sheet emailed, drawn on screen. */
/* THE CARDS ARE THE LIST'S FILTERS -- "the salio remaining card should be clickable to open its list, all cards exactly -
   add all card neccesary". A tap on a card narrows the Orodha below to the lines behind its figure (data-arg="show", wired by
   the bar exactly like a pill); the Cases card is the whole window again. Two cards open OTHER lists -- the balances still
   outstanding from before the window (per staff) and the reporters' earnings -- which are the report's sections 3 and 2,
   so neither needs the report button. The list follows the chosen dates on its own and opens newest first. */
var DED_SHOW_ = {
  all:       { label: 'Kesi / Cases',                       keep: function(){ return true; } },
  taken:     { label: 'Alichokula / Taken',                 keep: function(r){ return (+r.amount_taken || 0) > 0; } },
  topay:     { label: 'Cha kulipiwa mteja / To pay',        keep: function(r){ return (+r.to_pay || 0) > 0; } },
  proposed:  { label: 'Makato yaliyopendekezwa / Proposed', keep: function(r){ return (+r.deduction || 0) > 0; } },
  deducted:  { label: 'Imekatwa (HR) / Deducted',           keep: function(r){ return (+r.deducted || 0) > 0; } },
  remaining: { label: 'Salio / Remaining',                  keep: function(r){ return (+r.remaining || 0) > 0; } },
  nohr:      { label: 'HR hajaandika / Awaiting HR',        keep: function(r){ return !r.hr_at && !((+r.deducted || 0) > 0); } },
  prev:      { label: 'Salio la kabla / Outstanding before' },
  reporters: { label: 'Walioripoti / Reporters' }
};
/* A card that is also a pill: kpi() with the bar's own data-arg/data-val on it, lit when it is the one chosen. */
function dedCard_(key, on, label, value, sub, cls){
  return kpi(label, value, sub, cls).replace('<div class="kpi">',
    '<div class="kpi tap' + (on ? ' on' : '') + '" data-arg="show" data-val="' + key + '" role="button" tabindex="0" title="Bofya kuona orodha / Tap for the list">');
}
// Enter or Space on a focused card taps it, like the legal tab's recovery cards.
document.addEventListener('keydown', function(e){
  var t = e.target;
  if (t && t.classList && t.classList.contains('tap') && t.hasAttribute('data-arg') && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); t.click(); }
});
VIEWS.deduct = function(){
  var from = S.args.from || '', to = S.args.to || '';
  var show = DED_SHOW_[S.args.show] ? S.args.show : 'all';
  return srv('deductions', {from:from, to:to}).then(function(d){
    S.dedMeta = d;
    var rows = d.rows || [], prev = d.prevBalances || [], reps = d.reporters || [];
    var cnt = function(k){ return rows.filter(DED_SHOW_[k].keep).length; };
    var prevSum = prev.reduce(function(s, p){ return s + (+p.remaining || 0); }, 0);
    var earn = reps.reduce(function(s, p){ return s + (+p.earnings || 0); }, 0);
    var card = function(key, value, sub, cls){ return dedCard_(key, key === show, DED_SHOW_[key].label, value, sub, cls); };
    HEAD = '<div class="kpis">'
      + card('all', money(d.cases), d.from+' → '+d.to+' · '+money(d.entries)+' staff entries')
      + card('taken', money(d.amountTaken), money(cnt('taken')) + ' staff lines', d.amountTaken ? 'bad' : '')
      + card('topay', money(d.toPay), 'mara moja kwa kesi / once per case · ' + money(cnt('topay')) + ' lines', d.toPay ? 'bad' : '')
      + card('proposed', money(d.deduction), 'kwa kila staff / per staff line · ' + money(cnt('proposed')) + ' lines')
      + card('deducted', money(d.deducted), money(cnt('deducted')) + ' lines · HR', d.deducted ? 'good' : '')
      + card('remaining', money(d.remaining), 'cha kulipiwa − imekatwa / to pay − deducted · ' + money(cnt('remaining')) + ' lines', d.remaining ? 'warnc' : 'good')
      + card('nohr', money(cnt('nohr')), 'staff lines bila makato ya HR bado / lines with no HR entry yet', cnt('nohr') ? 'warnc' : 'good')
      + card('prev', money(prevSum), 'kabla ya ' + d.from + ' / before ' + d.from + ' · ' + money(prev.length) + ' staff', prevSum ? 'warnc' : 'good')
      + card('reporters', money(reps.length), 'malipo TZS ' + money(earn) + ' · TZS ' + money(d.rate) + ' kwa kesi / per unique case')
      + '</div>'
      + '<div class="note">👆 Bofya kadi kuona orodha yake hapa chini; <b>Kesi</b> hurudisha zote. Orodha inafuata tarehe ulizochagua, mpya juu — bila kubofya Ripoti.'
        + ' / Tap a card for its list below; <b>Cases</b> brings everything back. The list follows the dates you pick, newest first — no need for the Report button.</div>'
      + (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      + bar('<input type="date" data-arg="from" value="'+esc(d.from)+'">'
        + '<input type="date" data-arg="to" value="'+esc(d.to)+'">'
        + '<select data-filter="team"><option value="">All teams</option>'
        + (d.teams||[]).map(function(s){ return '<option'+(S.filters.team===s?' selected':'')+'>'+esc(s)+'</option>'; }).join('') + '</select>'
        + '<select data-filter="staff"><option value="">Staff wote / All staff</option>'
        + (d.staffList||[]).map(function(s){ return '<option'+(S.filters.staff===s?' selected':'')+'>'+esc(s)+'</option>'; }).join('') + '</select>'
        + '<button class="btn sm" id="newDeduction">+ Kesi mpya / New case</button>'
        + '<button class="btn sm" id="dedReport">Ripoti / Report</button>'
        + (d.canHr ? '<span class="chip ok">HR: unaandika makato / you record deductions</span>'
                   : '<span class="chip mut">Makato huandikwa na HR / HR records deductions</span>'));
    // Newest first, said by the arrow on the Date column -- "latest to oldest". Only on the tab's first paint (go() leaves
    // S.sort null); a column the person sorted by afterwards stays theirs.
    if (S.sort == null){ S.sort = 'submitted_at'; S.asc = false; }
    if (show === 'prev') {
      S.rows = prev;
      S.cols = [col('staff','Staff'), col('remaining','Salio / Remaining','money')];
      ONROW = null;
      S.foot = 'Salio la kabla ya ' + d.from + ' / Outstanding before ' + d.from + ': ' + money(prev.length) + ' staff · TZS ' + money(prevSum)
        + ' · rudisha tarehe ya kuanzia nyuma kuona kesi zao / move the from-date back to see their cases';
    } else if (show === 'reporters') {
      S.rows = reps;
      S.cols = [col('reporter','Aliyeripoti / Reporter'), col('cases','Kesi / Unique cases','num'), col('earnings','Malipo / Earnings','money')];
      ONROW = null;
      S.foot = 'Walioripoti / Reporters: ' + money(reps.length) + ' · TZS ' + money(d.rate) + ' kwa kesi / per unique case (DEDUCTION_REPORTER_TZS) · jumla TZS ' + money(earn);
    } else {
      S.rows = rows.filter(DED_SHOW_[show].keep);
      S.cols = [col('submitted_at','Tarehe / Date','dt'), col('reporter','Aliyeripoti / Reporter'), col('dept','Dept'),
        col('team','Team'), col('branch','Branch'), col('customer','Mteja / Customer'), col('ref','REF NO'),
        col('staff','Staff mtuhumiwa / Accused staff'), col('amount_taken','Alichokula / Taken','money'),
        col('received_date','Aliyopokea / Received','date'), col('discovery_date','Ugunduzi / Discovered','date'),
        col('deduction','Makato / Deduction','money'), col('to_pay','Cha kulipiwa / To pay','money'),
        {key:'deducted', label:'Imekatwa (HR) / Deducted', kind:'money', cls:function(r){ return r.deducted>0?'good':''; }},
        {key:'remaining', label:'Salio / Remaining', kind:'money', cls:function(r){ return r.remaining>0?'bad':''; }},
        col('hr_notes','HR notes'), col('decision','Maamuzi / Decision')];
      ONROW = openDeduction;
      S.foot = (show === 'all' ? '' : DED_SHOW_[show].label + ': ' + money(S.rows.length) + ' / ' + money(rows.length) + ' lines · ')
        + money(d.cases)+' kesi / cases · to pay TZS '+money(d.toPay)+' · deducted TZS '+money(d.deducted)+' · remaining TZS '+money(d.remaining)+' · mpya juu / newest first';
    }
  });
};

/* THE FORM: one case, as many accused staff as it takes ("Ongeza wote waliohusika"). The
   reporter is the signed-in person; every amount is recomputed on the server. */
function dedNew(){
  var m = S.dedMeta || { teams: [] };
  var staffRow = function(i){
    return '<div class="facts ded-staff" data-i="'+i+'" style="margin-bottom:8px">'
      + '<div class="fld"><label>Jina la staff mtuhumiwa / Accused staff *</label><input class="dsName" placeholder="Staff name"></div>'
      + '<div class="fld"><label>Kiasi alichokula / Amount taken</label><input class="dsTaken" type="number" min="0" step="0.01" placeholder="0"></div>'
      + '<div class="fld"><label>Makato (kiasi) / Deduction</label><input class="dsDed" type="number" min="0" step="0.01" placeholder="0"></div>'
      + '<a href="#" class="dsRm" style="font-size:12px;color:var(--bad)">✕ Ondoa huyu / Remove</a></div>';
  };
  drawer('<h3>Kesi mpya ya makato / New PMO deduction case</h3>'
    + '<div class="sub">Aliyeripoti / Reporter: <b>'+esc((S.me && S.me.name) || '')+'</b> · '+esc((S.me && S.me.role) || '')+'</div>'
    + '<div class="fld"><label>Timu / Team *</label><select id="ddTeam"><option value="">— chagua / pick —</option>'
      + (m.teams||[]).map(function(t){ return '<option>'+esc(t)+'</option>'; }).join('') + '</select></div>'
    + '<div class="fld"><label>Jina la mteja / Customer *</label><input id="ddCust"></div>'
    + '<div class="fld"><label>REF NO ya mteja / Customer REF NO *</label><input id="ddRef" inputmode="numeric"></div>'
    + '<div class="fld"><label>Tarehe aliyopokea / Date received</label><input id="ddRecv" type="date"></div>'
    + '<div class="fld"><label>Tarehe ya ugunduzi / kikao / Date discovered (meeting)</label><input id="ddDisc" type="date" value="'+today()+'"></div>'
    + '<div class="fld"><label>Maamuzi (maelezo) / Decision (details) *</label><textarea id="ddDec" rows="3"></textarea></div>'
    + '<div class="fld"><label>Cha kulipiwa mteja / Amount to be paid to the customer</label><input id="ddPay" type="number" min="0" step="0.01" placeholder="0"></div>'
    + '<h4 style="margin:10px 0 6px">Staff watuhumiwa / Accused staff (ongeza wote waliohusika)</h4>'
    + '<div id="ddStaff">' + staffRow(0) + '</div>'
    + '<button class="btn ghost w" id="ddAdd">+ Ongeza mwingine / Add another</button>'
    + '<button class="btn w" id="ddSave" style="margin-top:10px">Hifadhi kesi / Save case</button>');
  var host = $('#ddStaff'), n = 1;
  var wireRm = function(){
    Array.prototype.forEach.call(host.querySelectorAll('.dsRm'), function(a){
      a.onclick = function(ev){ ev.preventDefault();
        if (host.querySelectorAll('.ded-staff').length <= 1){ toast('Angalau staff mmoja. / At least one staff.', true); return; }
        a.parentNode.parentNode.removeChild(a.parentNode); };
    });
  };
  wireRm();
  $('#ddAdd').onclick = function(){ host.insertAdjacentHTML('beforeend', staffRow(n++)); wireRm(); };
  $('#ddSave').onclick = function(){
    var staff = Array.prototype.map.call(host.querySelectorAll('.ded-staff'), function(el){
      return { name: el.querySelector('.dsName').value.trim(), amountTaken: el.querySelector('.dsTaken').value, deduction: el.querySelector('.dsDed').value };
    }).filter(function(s){ return s.name; });
    if (!$('#ddTeam').value){ toast('Chagua timu. / Pick the team.', true); return; }
    if (!$('#ddCust').value.trim() || !$('#ddRef').value.trim()){ toast('Jina na REF NO ya mteja vinahitajika. / Customer name and REF NO are required.', true); return; }
    if (!$('#ddDec').value.trim()){ toast('Andika maamuzi / maelezo. / Write the decision.', true); return; }
    if (!staff.length){ toast('Ongeza angalau staff mmoja mtuhumiwa. / Add at least one accused staff.', true); return; }
    srv('addDeduction', { team:$('#ddTeam').value, customer:$('#ddCust').value.trim(), ref:$('#ddRef').value.trim(),
      receivedDate:$('#ddRecv').value, discoveryDate:$('#ddDisc').value, decision:$('#ddDec').value.trim(),
      toPay:$('#ddPay').value, staff:staff })
      .then(function(r){ toast('Kesi imehifadhiwa: '+r.rows+' staff. / Case saved: '+r.rows+' staff line(s).'); closeDrawer(); render({ force:true }); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}

/* A ROW IS ONE STAFF LINE OF A CASE. Everything the register holds, then HR's column -- notes
   and the amount actually deducted; remaining follows on the server (to pay − deducted). */
function openDeduction(r){
  var m = S.dedMeta || {};
  var row = function(k, v, strong){ return '<div class="frow"><span>'+k+'</span>'+(strong ? '<b>'+v+'</b>' : '<span>'+v+'</span>')+'</div>'; };
  var dd = function(v){ return v ? esc(String(v).slice(0,10)) : '—'; };
  var mm = function(v){ return v == null ? '—' : money(v); };
  drawer('<h3>'+esc(r.customer||'')+' · '+esc(r.staff||'')+'</h3>'
    + '<div class="sub">'+esc(String(r.submitted_at||'').replace('T',' ').slice(0,16))+' · '+esc(r.reporter||'')+' ('+esc(r.dept||'')+') · '+esc(r.team||'')+'</div>'
    + '<div class="facts">'
    + row('REF NO', esc(r.ref||'—'), true)
    + row('Staff mtuhumiwa / Accused staff', esc(r.staff||'—'), true)
    + row('Alichokula / Taken', mm(r.amount_taken))
    + row('Tarehe aliyopokea / Received', dd(r.received_date))
    + row('Ugunduzi / kikao / Discovered', dd(r.discovery_date))
    + row('Makato yaliyopendekezwa / Proposed deduction', mm(r.deduction))
    + row('Cha kulipiwa mteja / To pay', mm(r.to_pay), true)
    + row('Imekatwa (HR) / Deducted', mm(r.deducted), true)
    + row('Salio / Remaining', mm(r.remaining), true)
    + (r.hr_by ? row('HR', esc(r.hr_by)+' · '+dd(r.hr_at)) : '')
    + '</div>'
    + '<div class="fld"><label>Maamuzi (maelezo) / Decision</label><div class="note">'+esc(r.decision||'—')+'</div></div>'
    + (m.canHr
        ? '<h4 style="margin:10px 0 6px">HR</h4>'
          + '<div class="fld"><label>HR notes</label><textarea id="dhNotes" rows="2">'+esc(r.hr_notes||'')+'</textarea></div>'
          + '<div class="fld"><label>Kiasi kilichokatwa / Amount deducted</label><input id="dhDed" type="number" min="0" step="0.01" value="'+esc(r.deducted==null?'':r.deducted)+'"></div>'
          + '<div class="sub">Salio litahesabiwa: cha kulipiwa − kilichokatwa. / Remaining is worked out: to pay − deducted.</div>'
          + '<button class="btn w" id="dhSave">Hifadhi makato / Save deduction</button>'
        : '<div class="sub">HR notes: '+esc(r.hr_notes||'—')+' · makato huandikwa na HR / deductions are recorded by HR ('+esc(m.hrRoles||'HR')+').</div>'));
  if (m.canHr) $('#dhSave').onclick = function(){
    srv('hrDeduction', { id:r.id, hrNotes:$('#dhNotes').value.trim(), deducted:$('#dhDed').value })
      .then(function(x){ toast('Imehifadhiwa. Salio: TZS '+money(x.remaining||0)+'. / Saved. Remaining: TZS '+money(x.remaining||0)+'.'); closeDrawer(); render({ force:true }); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}

/* THE MONTHLY REPORT THE SHEET EMAILED, on screen for the chosen window: the cases by team,
   the reporters' earnings per unique case, and the balances still outstanding from before. */
function dedReport(){
  var d = S.dedMeta; if (!d) return;
  var when = d.from + ' → ' + d.to;
  drawer('<h3>Ripoti ya makato / PMO deduction report · ' + esc(when) + '</h3>'
    + '<div class="kpis sm">' + kpi('Kesi / Cases', money(d.cases)) + kpi('Staff entries', money(d.entries))
      + kpi('To pay', money(d.toPay), null, 'bad') + kpi('Deducted', money(d.deducted), null, 'good') + kpi('Remaining', money(d.remaining), null, d.remaining?'warnc':'') + '</div>'
    + '<div id="dedRep1"></div><div id="dedRep2"></div><div id="dedRep3"></div>', { wide: true });
  $('#dedRep1').innerHTML = board('dedSum', '1. Kesi kwa timu / Cases by team', 'cha kulipiwa mara moja kwa kesi / to pay once per case', d.summary || [],
    [col('team','Timu / Team'), col('cases','Kesi / Cases','num'), col('entries','Staff entries','num'),
     col('amountTaken','Alichokula / Taken','money'), col('deduction','Makato / Proposed','money'),
     col('toPay','To pay','money'), col('deducted','Deducted','money'), col('remaining','Remaining','money')],
    sumRow(d.summary || [], ['cases','entries','amountTaken','deduction','toPay','deducted','remaining']));
  $('#dedRep2').innerHTML = board('dedRep', '2. Malipo ya walioripoti / Reporter earnings', 'TZS ' + money(d.rate) + ' kwa kila kesi / per unique case (DEDUCTION_REPORTER_TZS)', d.reporters || [],
    [col('reporter','Aliyeripoti / Reporter'), col('cases','Kesi / Unique cases','num'), col('earnings','Malipo / Earnings','money')],
    sumRow(d.reporters || [], ['cases','earnings']));
  $('#dedRep3').innerHTML = (d.prevBalances && d.prevBalances.length)
    ? board('dedPrev', '3. Salio la kabla ya ' + esc(d.from) + ' / Balances outstanding before ' + esc(d.from), 'kwa staff / per staff, remaining > 0', d.prevBalances,
        [col('staff','Staff'), col('remaining','Salio / Remaining','money')], sumRow(d.prevBalances, ['remaining']))
    : '<div class="note">3. Hakuna salio la kabla ya ' + esc(d.from) + '. / No outstanding balances before ' + esc(d.from) + '.</div>';
  var root = document.getElementById('drawer');
  Array.prototype.forEach.call(root.querySelectorAll('[data-jpg]'), function(el){ el.onclick = function(e){ e.stopPropagation(); saveJpg(document.getElementById(el.getAttribute('data-jpg'))); }; });
  Array.prototype.forEach.call(root.querySelectorAll('[data-xls]'), function(el){ el.onclick = function(e){ e.stopPropagation(); exportBoard(el.getAttribute('data-xls'), 'xls'); }; });
  Array.prototype.forEach.call(root.querySelectorAll('[data-csv]'), function(el){ el.onclick = function(e){ e.stopPropagation(); exportBoard(el.getAttribute('data-csv'), 'csv'); }; });
}
