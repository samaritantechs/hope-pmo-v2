/* leave -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/leave.js?v=BUILD. */

/* =====================================================================================
   LEAVE / HOLIDAY -- the FOMU YA RUHUSA NA LIKIZO Google Form and its sheet, moved in the
   same way advance.js moved the salary-advance sheet: "the tunnels and approvals must be the
   same to advances when people request leaves / holidays" ... "it needs to be 3 tabs to fit
   perfection like advances ... request tab, approval tab and reports tab for leaves". Three
   tabs, not advance's four: `leavereq` is the ask, `leaveappr` is the desk (hidden from an
   idle holder the same way advappr's own is -- withoutIdleApprovalTab, api/me.js, one
   routing read twice, not copied), `leaverep` is the report. No fourth, HR-registry tab:
   advance's own staff registry (advstaff) is reused as it is.
   Server side: api/_lib/portal-core.js's leaveRequestPage / leaveRequest / leaveQueue /
   leaveDecide / leaveReport, reusing advance's own routing (advRouting_, advRouteOf_,
   advDeskOf_, advSees_) rather than a second copy of "who approves whom" -- "Advance
   approver = Leave approver" was already true the moment that was reused. Who even SEES the
   tabs at all (a separate question) is copied from advance's own tab grants by
   db/RUN-ME-052-leave-tabs-from-advance.sql, so the owner does not have to re-tick Roles &
   access by hand.
   ===================================================================================== */
function leaveApprCls_(r){ var a = String(r.approval||'').toUpperCase(); return a === 'APPROVED' ? 'good' : a === 'DISAPPROVED' ? 'bad' : a === 'EXPIRED' ? 'mut' : ''; }
function leaveExpired_(r){ return String((r && r.approval) || '').toUpperCase() === 'EXPIRED'; }
var LEAVE_EXPIRED_NOTE = 'Muda umeisha: halikuamuliwa kabla ya tarehe yake ya kuanza, haliwezi kuamuliwa tena. Mhusika anaweza kuomba tena. / Expired: nobody decided it before its own start date, so it can no longer be decided. The staff can ask again.';

/* THE ASK. Pick your own name (your zone's or role's list, or the call-agents roster for
   customer service), the dates, a reason, who covers; the balance and who will decide it
   come from the server. The history below is for approvers and report holders only. */
VIEWS.leavereq = function(){
  var staffId = S.args.staffId || '', staffName = S.args.staffName || '';
  return srv('leaveRequestPage', { staffId: staffId, staffName: staffName }).then(function(d){
    S.leaveReq = d;
    var c = d.chosen;
    var manyZones = !(d.zones && d.zones.length === 1);
    var byName = !!d.csAgents;
    var b = d.balance;
    HEAD = (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      + (d.noZoneTeams && d.noZoneTeams.length
          ? '<div class="note bad">Timu hizi hazina zone kwenye Teams & Staff, hivyo wafanyakazi wake hawaonekani hapa: ' + esc(d.noZoneTeams.join(', '))
            + '. / These teams carry no zone on Teams & Staff, so their staff cannot be listed here. Set the zone there and come back.</div>' : '')
      + '<div class="card"><div class="card-h">🌴 Ombi la likizo / Ruhusa / Leave &amp; holiday request'
        + '<span class="sub">' + esc((d.role ? 'wadhifa / role: ' + d.role + ' · ' : 'wadhifa zote / every role · ')
          + (d.zones && d.zones.length ? 'zone: ' + d.zones.join(', ') : 'zone zote / every zone')) + '</span></div>'
      + (d.roleNote ? '<div class="note bad" style="margin:10px 14px 0">⚠️ ' + esc(d.roleNote) + '</div>' : '')
      + (d.route ? '<div class="note' + (d.route.kind === 'none' ? ' bad' : '') + '" style="margin:10px 14px 0">Ombi lako litaenda kwa / Your request goes to: <b>' + esc(d.route.label) + '</b></div>' : '')
      + (d.routingOn === false ? '<div class="note" style="margin:10px 14px 0">⚠ ' + esc(d.routingNote || '') + '</div>' : '')
      + '<div class="cleanbox">'
      + '<div class="fld"><label>Jina lako / Your name *</label>'
        + '<select data-arg="' + (byName ? 'staffName' : 'staffId') + '"><option value="">— chagua jina lako / pick your name —</option>'
        + (d.staff || []).map(function(s){
            var v = byName ? s.name : s.id, on = c && (byName ? c.name === s.name : c.id === s.id);
            return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(s.name)
              + (s.onRegistry === false ? ' ⚠ si kwenye rejista ya HR / not on HR registry' : '')
              + (s.role && !byName ? ' · ' + esc(s.role) : '') + (manyZones && s.zone ? ' (' + esc(s.zone) + ')' : '') + '</option>'; }).join('')
        + '</select>'
        + '<div class="fldnote">' + (byName
            ? 'Majina kutoka orodha ya mawakala wa simu (Settings → Call agents). / Names from the call-agents roster (Settings → Call agents).'
            : 'Majina ya wadhifa wako katika zone yako tu. / Only your role\'s names in your zone.') + '</div></div>'
      + (c
          ? '<div class="facts">'
              + '<div class="frow"><span>Staff ID</span><b>' + esc(c.id || '— (si kwenye rejista ya HR / not on HR registry)') + '</b></div>'
              + '<div class="frow"><span>Jina / Name</span><b>' + esc(c.name) + '</b></div>'
              + '<div class="frow"><span>Wadhifa / Role</span><span>' + esc(c.role || '—') + '</span></div>'
              + '<div class="frow"><span>Zone</span><span>' + esc(c.zone || '—') + '</span></div></div>'
            + (b ? '<div class="kpis" style="margin:10px 14px 0">'
                + kpi('Siku za likizo kwa mwaka / Annual days', money(b.annualDays), null)
                + kpi('Zilizotumika (zilizoidhinishwa) / Taken (approved)', money(b.taken), null, b.taken ? 'warnc' : 'good')
                + kpi('Zinazosubiri uamuzi / Pending decision', money(b.pending), null, b.pending ? 'warnc' : '')
                + kpi('Zilizobaki / Remaining', money(b.remaining), null, b.remaining < 0 ? 'bad' : (b.remaining === 0 ? 'warnc' : 'good'))
                + '</div>' : '')
            + '<div class="fld"><label>Tarehe ya kuanza / Start date</label><input id="lvStart" type="date" value="' + today() + '"></div>'
            + '<div class="fld"><label>Tarehe ya kurudi / Return date (last day back at work)</label><input id="lvEnd" type="date" value="' + today() + '"></div>'
            + '<div class="fldnote" id="lvDaysNote">—</div>'
            + '<div class="fld"><label>Sababu / Reason</label><select id="lvReason">'
              + (d.reasons || []).map(function(r){ return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join('') + '</select></div>'
            + '<div class="fld" id="lvOtherFld" style="display:none"><label>Sababu nyingine / Other reason</label><input id="lvOther" type="text"></div>'
            + '<div class="fld"><label>Atakayekaimu majukumu yako / Who covers for you</label><input id="lvCover" type="text"></div>'
            + '<div class="fld"><label>Maelezo zaidi (si lazima) / Notes (optional)</label><input id="lvNotes" type="text"></div>'
            + '<button class="btn w" id="lvSubmit">Tuma ombi / Submit request</button>'
          : '<div class="sub">Chagua jina lako kuona fomu. / Pick your name to see the form.</div>')
      + '</div></div>';
    /* #lvReason/#lvStart/#lvEnd/#lvSubmit are not in the real DOM yet here -- this promise
       resolves BEFORE drawView_() paints HEAD into the page (the exact bug HOPE Loan's own
       HEAD buttons had on first write; see the note beside wireLnCs_ in app.html). Wired from
       wireLeaveDesk() instead, called from the core's wireBar() after that paint. */
    if (d.canHistory === false){ S.rows = []; S.cols = []; ONROW = null; return; }
    S.rows = d.history || [];
    S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_name','Jina / Name'), col('zone','Zone'),
      col('start_date','Kuanza / Start','date'), col('end_date','Kurudi / Return','date'), col('days','Siku / Days','num'),
      col('reason','Sababu / Reason'), col('cover_name','Kaimu / Cover'),
      {key:'approval', label:'Idhini / Approval', cls:leaveApprCls_}, col('comment','Maoni / Comment'),
      col('decided_by','Aliyeamua / Decided by'), col('decided_at','Uamuzi / Decided','dt')];
    ONROW = null;
    S.foot = 'Historia ya maombi ya ' + (d.role ? 'wadhifa ' + d.role : 'wadhifa zote') + ' katika zone yako / History: ' + money(S.rows.length) + ' · mapya juu / newest first';
  });
};
function leaveSubmit_(){
  var c = (S.leaveReq || {}).chosen; if (!c) return;
  var start = $('#lvStart').value, end = $('#lvEnd').value, reason = $('#lvReason').value;
  var other = ($('#lvOther') ? $('#lvOther').value : '').trim();
  if (!start || !end){ toast('Weka tarehe ya kuanza na kurudi. / Pick the start and return date.', true); return; }
  if (end < start){ toast('Tarehe ya kurudi haiwezi kuwa kabla ya kuanza. / The return date cannot be before the start date.', true); return; }
  if (reason === 'Other' && !other){ toast('Andika sababu. / Type the reason.', true); return; }
  var days = Math.round((new Date(end + 'T00:00:00Z') - new Date(start + 'T00:00:00Z')) / 86400000) + 1;
  if (!confirm('Tuma ombi la likizo la siku ' + days + ' (' + start + ' → ' + end + ') kwa jina la ' + c.name + '? / Submit a ' + days + '-day leave request (' + start + ' → ' + end + ') for ' + c.name + '?')) return;
  srv('leaveRequest', { staffId: c.id || '', staffName: c.name, startDate: start, endDate: end, reason: reason, reasonOther: other,
      coverName: $('#lvCover').value, notes: $('#lvNotes').value })
    .then(function(r){ toast('✅ Ombi limetumwa: siku ' + r.days + (r.route ? ' → ' + r.route.label : '') + '. / Leave request submitted.'); render({ force:true }); })
    .catch(function(e){ toast(String(e.message||e), true); });
}

/* THE DESK: pending / decided / expired, the imprest-and-advance pattern (KPIs, pills, one
   standard table with tick-boxes for the bulk save, a drawer for one request). */
function leaveAgeDays_(r){ var t = Date.parse(r.submitted_at); return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86400000)); }
function leaveApprChip_(r){ return String(r.approval||'').toUpperCase() === 'APPROVED' ? 'ok' : String(r.approval||'').toUpperCase() === 'DISAPPROVED' ? 'bad' : leaveExpired_(r) ? 'warn' : 'mut'; }
VIEWS.leaveappr = function(){
  return srv('leaveQueue', {}).then(function(q){
    S.leaveQ = q;
    var state = S.args.state === 'decided' ? 'decided' : S.args.state === 'expired' ? 'expired' : 'pending';
    var pend = q.pending || [], rec = q.recent || [], exp = q.expired || [];
    pend.forEach(function(r){ r.age = leaveAgeDays_(r); });
    exp.forEach(function(r){ r.age = leaveAgeDays_(r); });
    var deskLine = advDeskLine_(q.desk || {});
    var unr = q.unrouted || [];
    HEAD = '<div class="kpis">'
      + kpi('Yanayosubiri / Pending', money(q.count), 'maombi / requests', q.count ? 'warnc' : 'good')
      + kpi('Siku zinazosubiri / Pending days', money(q.days), null, q.days ? 'warnc' : '')
      + kpi('Zimeisha muda / Expired', money(q.expiredCount), 'hayakuamuliwa kabla ya tarehe ya kuanza / never decided before the start date', q.expiredCount ? 'bad' : 'good')
      + kpi('Yaliyoamuliwa mwezi huu / Decided this month', money(rec.length), null)
      + '</div>'
      + (q.on === false ? '<div class="note">⚠ ' + esc(q.note || '') + '</div>' : '')
      + (q.routingOn === false
          ? '<div class="note">⚠ ' + esc(q.routingNote || '') + '</div>'
          : '<div class="note' + (deskLine ? '' : ' bad') + '">Dawati lako / Your desk: ' + (deskLine ? esc(deskLine)
              : '⚠️ hakuna wadhifa wala mtu aliyeelekezwa kwako bado. / nothing is routed to this desk yet.') + '</div>')
      + (unr.length
          ? '<div class="note bad">⚠️ Maombi ' + unr.length + ' hayamfikii mtu isipokuwa admin / ' + unr.length + ' request(s) reach nobody but an admin: '
            + esc(unr.map(function(u){ return u.staff_name + ' (' + (u.req_role || '?') + (u.zone ? ' · ' + u.zone : '') + ' — ' + (u.why || '') + ')'; }).join('; ')) + '</div>'
          : '')
      + (q.noZoneTeams && q.noZoneTeams.length
          ? '<div class="note bad">Timu bila zone kwenye Teams & Staff: ' + esc(q.noZoneTeams.join(', ')) + '.</div>' : '')
      + bar('<button class="btn sm' + (state === 'pending' ? '' : ' ghost') + '" data-arg="state" data-val="pending">Yanayosubiri / Pending (' + money(pend.length) + ')</button>'
          + '<button class="btn sm' + (state === 'decided' ? '' : ' ghost') + '" data-arg="state" data-val="decided" style="margin-left:6px">Yaliyoamuliwa / Decided (' + money(rec.length) + ')</button>'
          + '<button class="btn sm' + (state === 'expired' ? '' : ' ghost') + '" data-arg="state" data-val="expired" style="margin-left:6px">Zimeisha muda / Expired (' + money(exp.length) + ')</button>'
          + '<select data-filter="zone" style="margin-left:8px"><option value="">Zone zote / All zones</option>'
            + (q.zones || []).map(function(z){ return '<option' + (S.filters.zone === z ? ' selected' : '') + '>' + esc(z) + '</option>'; }).join('') + '</select>'
          + (state === 'pending' && pend.length
              ? '<input id="lvBulkCom" placeholder="Maoni kwa zilizochaguliwa / Comment for the ticked" style="margin-left:8px;min-width:200px">'
                + '<button class="btn sm" id="lvApproveMany" style="margin-left:6px">✅ Idhinisha zilizochaguliwa / Approve ticked</button>'
                + '<button class="btn sm bad" id="lvRejectMany" style="margin-left:6px">✖ Kataa zilizochaguliwa / Disapprove ticked</button>'
                + '<span class="chip mut" data-pickcount="1" style="margin-left:8px">0</span><span class="mutl" style="font-size:12px">zimechaguliwa / ticked</span>'
                + '<button class="btn sm ghost" id="lvPickNone" style="margin-left:6px">Ondoa chaguo / Clear</button>'
              : ''));
    var dayCols = [col('start_date','Kuanza / Start','date'), col('end_date','Kurudi / Return','date'), {key:'days', label:'Siku / Days', kind:'num'}];
    if (state === 'pending') {
      S.pickKey = 'id';
      S.rows = pend;
      S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_name','Jina / Name'), col('staff_id','ID'),
        {key:'staff_role', label:'Wadhifa / Role', get:function(r){ return r.staff_role || r.req_role || ''; }},
        col('zone','Zone')].concat(dayCols).concat([col('reason','Sababu / Reason'), col('cover_name','Kaimu / Cover'),
        {key:'age', label:'Umri / Age', kind:'chip', get:function(r){ return r.age == null ? '' : r.age + ' d'; }, chip:function(r){ return r.age > 14 ? 'bad' : r.age > 3 ? 'warn' : 'mut'; }},
        {key:'routeTo', label:'Kwa / To', kind:'chip', get:function(r){ return r.routeTo || ''; }, chip:function(r){ return r.routeKind === 'none' ? 'bad' : 'mut'; }}]);
      ONROW = function(r){ leaveDecideDrawer_(r, true); };
      S.foot = 'Yanayosubiri / Pending: ' + money(pend.length) + ' · siku ' + money(q.days) + ' · gusa safu kwa uamuzi mmoja, tiki kwa wengi / tap a row for one decision, tick for many';
    } else if (state === 'expired') {
      S.pickKey = '';
      S.rows = exp;
      S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_name','Jina / Name'), col('staff_id','ID'), col('zone','Zone')]
        .concat(dayCols).concat([col('reason','Sababu / Reason'),
        {key:'age', label:'Umri / Age', kind:'chip', get:function(r){ return r.age == null ? '' : r.age + ' d'; }, chip:function(){ return 'mut'; }}]);
      ONROW = function(r){ leaveDecideDrawer_(r, false, LEAVE_EXPIRED_NOTE); };
      S.foot = 'Zimeisha muda / Expired (hazikuamuliwa / never decided): ' + money(exp.length) + ' · wahusika wanaweza kuomba tena / their owners can ask again';
    } else {
      S.pickKey = '';
      S.rows = rec;
      S.cols = [col('decided_at','Uamuzi / Decided','dt'), col('staff_name','Jina / Name'), col('staff_id','ID'), col('zone','Zone')]
        .concat(dayCols).concat([col('reason','Sababu / Reason'),
        {key:'approval', label:'Idhini / Approval', kind:'chip', get:function(r){ return r.approval || ''; }, chip:leaveApprChip_},
        col('comment','Maoni / Comment'), col('decided_by','Aliyeamua / Decided by'), col('submitted_at','Imetumwa / Submitted','dt')]);
      ONROW = function(r){ leaveDecideDrawer_(r, false); };
      S.foot = 'Yaliyoamuliwa / Decided: ' + money(rec.length) + ' · mapya juu / newest first';
    }
  });
};
function leaveDecideDrawer_(r, decidable, closedNote){
  var row = function(k, v){ return '<div class="frow"><span>' + k + '</span><b>' + (v == null || v === '' ? '—' : esc(String(v))) + '</b></div>'; };
  drawer('<h3>' + esc(r.staff_name || '—') + '</h3>'
    + '<div class="sub">' + esc(r.staff_id || '') + ' · ' + esc(r.staff_role || r.req_role || '') + ' · ' + esc(r.zone || '') + '</div>'
    + '<div class="facts">'
      + row('Tarehe / Dates', String(r.start_date||'').slice(0,10) + ' → ' + String(r.end_date||'').slice(0,10)) + row('Siku / Days', r.days)
      + row('Sababu / Reason', r.reason) + row('Kaimu / Cover', r.cover_name) + row('Maelezo / Notes', r.notes)
      + row('Imetumwa / Submitted', String(r.submitted_at || '').replace('T', ' ').slice(0, 16))
      + row('Anayeamua / Who decides', r.route)
      + (leaveExpired_(r) ? row('Hali / Status', 'Muda umeisha / Expired')
          : r.approval && String(r.approval).toUpperCase() !== 'PENDING' ? row('Idhini / Approval', r.approval) + row('Aliyeamua / Decided by', r.decided_by) + row('Maoni / Comment', r.comment) : '')
    + '</div>'
    + (closedNote ? '<div class="note bad">' + esc(closedNote) + '</div>' : '')
    + (decidable
        ? '<div class="fld"><label>Maoni / Comment</label><textarea id="lvdCmt" rows="3" placeholder="Lazima ukikataa. / Required when you disapprove."></textarea></div>'
          + '<button class="btn w" id="lvdOk" style="margin-top:8px">Idhinisha / Approve</button>'
          + '<button class="btn w ghost danger" id="lvdNo" style="margin-top:6px">Kataa / Disapprove</button>'
        : ''));
  if (!decidable) return;
  var send = function(approval){
    var com = ($('#lvdCmt').value || '').trim();
    if (approval === 'Disapproved' && !com){ toast('Andika sababu ya kukataa. / A reason is needed to disapprove.', true); return; }
    var b = $('#lvdOk'), n = $('#lvdNo'); if (b) b.disabled = true; if (n) n.disabled = true;
    srv('leaveDecide', { updates: [{ id: r.id, approval: approval, comment: com }] })
      .then(function(x){
        toast(approval === 'Approved' ? 'Imeidhinishwa / Approved' + (x.skipped && x.skipped.length ? ' · ' + x.skipped.join('; ') : '') : 'Imekataliwa / Disapproved');
        closeDrawer(); render({ force:true }); })
      .catch(function(e){ if (b) b.disabled = false; if (n) n.disabled = false; toast(String(e.message||e), true); });
  };
  $('#lvdOk').onclick = function(){ send('Approved'); };
  $('#lvdNo').onclick = function(){ send('Disapproved'); };
}
function leaveBulk_(approval){
  var ids = pickList_();
  if (!ids.length){ toast('Tiki angalau ombi moja. / Tick at least one request.', true); return; }
  var com = (($('#lvBulkCom') || {}).value || '').trim();
  if (approval === 'Disapproved' && !com){ toast('Andika sababu ya kukataa kwenye kisanduku cha maoni. / Write the reason in the comment box to disapprove.', true); return; }
  if (!confirm((approval === 'Approved' ? 'Idhinisha' : 'Kataa') + ' ' + ids.length + '? / ' + (approval === 'Approved' ? 'Approve' : 'Disapprove') + ' ' + ids.length + ' request(s)?')) return;
  srv('leaveDecide', { updates: ids.map(function(id){ return { id: id, approval: approval, comment: com }; }) })
    .then(function(r){
      toast('Imehifadhiwa / Saved: ' + r.approved + ' approved, ' + r.disapproved + ' disapproved'
        + (r.skipped && r.skipped.length ? ' · ' + r.skipped.join('; ') : '') + '.', !!(r.skipped && r.skipped.length));
      pickClear_(); render({ force:true }); })
    .catch(function(e){ toast(String(e.message||e), true); });
}
/* Wired by wireBar (app.html) after every paint, like the advance module -- one function for
   every button this module draws, on any of its three tabs, the same way wireAdvDesk also
   wires advFinalizeBtn/advReopenBtn even though those sit on advrep, not advappr. Covers
   leavereq's own ask form too (lvReason/lvStart/lvEnd/lvSubmit): wiring those from inside
   VIEWS.leavereq itself, before this runs, attaches to elements that do not exist yet --
   "clicking name on omba likizo - Imeshindikana / Cannot set properties of null (setting
   'onchange')" was exactly that, the first time a name was ever picked and the form first
   appeared. */
function wireLeaveDesk(){
  var a = document.getElementById('lvApproveMany');
  if (a) a.onclick = function(){ leaveBulk_('Approved'); };
  var r = document.getElementById('lvRejectMany');
  if (r) r.onclick = function(){ leaveBulk_('Disapproved'); };
  var n = document.getElementById('lvPickNone');
  if (n) n.onclick = function(){ pickClear_(); paint(true); };
  var s = document.getElementById('lvAnnualSave');
  if (s) s.onclick = function(){
    var days = $('#lvAnnualDays').value;
    if (days === '' || Number(days) < 0){ toast('Weka idadi ya siku, sifuri au zaidi. / Enter a whole number of days, zero or more.', true); return; }
    if (!confirm('Badilisha siku za likizo kwa mwaka, kwa kila mfanyakazi, kuwa ' + days + '? / Change the annual leave allowance, per staff, to ' + days + '?')) return;
    s.disabled = true;
    srv('leaveSetAnnualDays', { days: days })
      .then(function(r){ toast('✅ Siku za likizo kwa mwaka: ' + r.annualDays + '. / Annual leave allowance: ' + r.annualDays + '.'); render({ force:true }); })
      .catch(function(e){ s.disabled = false; toast(String(e.message||e), true); });
  };
  var lvReason = document.getElementById('lvReason'), lvOther = document.getElementById('lvOtherFld');
  if (lvReason) lvReason.onchange = function(){ if (lvOther) lvOther.style.display = lvReason.value === 'Other' ? '' : 'none'; };
  var lvStart = document.getElementById('lvStart'), lvEnd = document.getElementById('lvEnd'), lvDaysNote = document.getElementById('lvDaysNote');
  if (lvStart && lvEnd && lvDaysNote) {
    var b = (S.leaveReq || {}).balance;
    var recalc = function(){
      if (!lvStart.value || !lvEnd.value){ lvDaysNote.textContent = '—'; return; }
      var days = Math.round((new Date(lvEnd.value + 'T00:00:00Z') - new Date(lvStart.value + 'T00:00:00Z')) / 86400000) + 1;
      lvDaysNote.textContent = days > 0 ? (days + ' siku / day(s)' + (b ? ' · zitakazobaki ikiidhinishwa / remaining if approved: ' + money(b.remaining - days) : ''))
        : 'Tarehe ya kurudi haiwezi kuwa kabla ya kuanza. / The return date cannot be before the start date.';
    };
    lvStart.oninput = recalc; lvEnd.oninput = recalc; recalc();
  }
  var lvSubmit = document.getElementById('lvSubmit');
  if (lvSubmit) lvSubmit.onclick = leaveSubmit_;
}

/* THE REPORT: a window, Approved by default, by zone, with the standing leave balance beside
   each row -- the advrep pattern, minus the finance manager's Finalize (leave has no payroll
   month to close; see the note in api/_lib/portal-core.js's leave section). */
VIEWS.leaverep = function(){
  var from = S.args.from || '', to = S.args.to || '', approval = S.args.approval || '';
  return srv('leaveReport', { from: from, to: to, approval: approval }).then(function(d){
    S.leaveRep = d;
    var deskLine = advDeskLine_(d.desk || {});
    HEAD = '<div class="kpis">'
      + kpi('Maombi / Requests', money(d.count), d.from + ' → ' + d.to + ' · ' + (d.approval === 'ALL' ? 'yote / all' : d.approval))
      + kpi('Siku / Days', money(d.days), null)
      + kpi('Yaliyoidhinishwa / Approved', money(d.approved), null, 'good')
      + kpi('Siku zilizoidhinishwa / Approved days', money(d.approvedDays), null, 'good')
      + kpi('Zimeisha muda / Expired', money(d.expired), null, d.expired ? 'bad' : 'good')
      + kpi('Siku za likizo kwa mwaka / Annual days per staff', money(d.annualDays), 'kwa kila mfanyakazi / per staff, kampuni nzima / company-wide')
      + '</div>'
      + (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      + (d.canSetAnnualDays
          ? '<div class="note" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
            + '<span>Badilisha siku za likizo kwa mwaka, kwa kila mfanyakazi / Change the annual leave allowance, per staff:</span>'
            + '<input id="lvAnnualDays" type="number" min="0" step="1" value="' + esc(String(d.annualDays)) + '" style="width:70px">'
            + '<button class="btn sm" id="lvAnnualSave">Hifadhi / Save</button></div>'
          : '')
      + (d.routingOn === false
          ? '<div class="note">⚠ ' + esc(d.routingNote || '') + '</div>'
          : '<div class="note' + (deskLine ? '' : ' bad') + '">Ripoti hii inaonyesha / This report shows: '
              + (d.desk && d.desk.admin ? esc(deskLine)
                 : deskLine ? 'maombi yaliyoelekezwa kwako na uliyoyaamua / the requests routed to your desk and the ones you decided — ' + esc(deskLine)
                 : '⚠️ hakuna wadhifa wala mtu aliyeelekezwa kwako — utaona uliyoyaamua tu. / nothing is routed to your desk — you see only the ones you decided.')
              + '</div>')
      + bar('<input type="date" data-arg="from" value="' + esc(d.from) + '">'
        + '<input type="date" data-arg="to" value="' + esc(d.to) + '">'
        + '<select data-arg="approval">' + (d.approvals||[]).map(function(a){
            return '<option value="' + esc(a) + '"' + (String(d.approval).toUpperCase() === a.toUpperCase() ? ' selected' : '') + '>' + esc(a === 'ALL' ? 'Yote / All' : a) + '</option>'; }).join('') + '</select>'
        + '<select data-filter="zone"><option value="">Zone zote / All zones</option>'
        + (d.zones||[]).map(function(z){ return '<option' + (S.filters.zone===z?' selected':'') + '>' + esc(z) + '</option>'; }).join('') + '</select>')
      + board('leaveRepZones', 'Kwa zone / By zone', 'maombi na siku kwa kila zone / requests and days per zone', d.summary || [],
          [col('zone','Zone'), col('requests','Maombi / Requests','num'), col('days','Siku / Days','num'),
           col('approved','Approved','num'), col('approvedDays','Approved days','num')],
          sumRow(d.summary || [], ['requests','days','approved','approvedDays']));
    S.rows = d.rows || [];
    S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_id','Staff ID'), col('staff_name','Staff'),
      {key:'staff_role', label:'Wadhifa / Role', get:function(r){ return r.staff_role || r.req_role || ''; }}, col('zone','Zone'),
      col('start_date','Kuanza / Start','date'), col('end_date','Kurudi / Return','date'), {key:'days', label:'Siku / Days', kind:'num'},
      col('reason','Sababu / Reason'), col('cover_name','Kaimu / Cover'),
      {key:'approval', label:'Idhini / Approval', cls:leaveApprCls_}, col('comment','Maoni / Comment'), col('decided_by','Aliyeamua / Decided by'),
      {key:'remaining', label:'Zilizobaki (baada) / Remaining (after)', kind:'num', get:function(r){ return r.balance ? r.balance.remaining : ''; },
       cls:function(r){ return r.balance && r.balance.remaining < 0 ? 'bad' : ''; }},
      col('decided_at','Tarehe ya idhini / Approval date','dt')];
    ONROW = null;
    S.foot = money(d.count) + ' maombi / requests · siku ' + money(d.days) + ' · approved days ' + money(d.approvedDays)
      + (d.expired ? ' · ' + money(d.expired) + ' zimeisha muda / expired (hazikuamuliwa / never decided)' : '');
  });
};
