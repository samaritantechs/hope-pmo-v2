/* advance -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/advance.js?v=BUILD. */

/* =====================================================================================
   SALARY ADVANCE -- the HOPE advance-request Google Sheet, moved in: "I found the this file
   looks suspicious warning on the google sheet for Hope advance requests. We need to shift
   that into the app too ... like how we moved the imprests and legal demands.. even the pmo
   system at large". Four tabs, each its own nav and its own tick on Roles & access: advreq
   (the ask), advappr (the GMO's desk), advrep (the report), advstaff (HR's registry).

   The server decides the ZONE from the sign-in -- a team code is the team's zone on Teams &
   Staff; a GMO's code is their teams' zones; HR and admins see every zone -- so a shared team
   screen lists only its own zone's names ("to keep privacy") and nothing else about anyone.
   ===================================================================================== */
function advApprCls_(r){ var a = String(r.approval||'').toUpperCase(); return a === 'APPROVED' ? 'good' : a === 'DISAPPROVED' ? 'bad' : ''; }

/* THE ASK. Pick your own name (your zone's list), the date, one of the amounts; the month's
   rule and the amounts come from the server. The history of the role's requests sits below for approvers and report holders only. */
VIEWS.advreq = function(){
  var staffId = S.args.staffId || '', staffName = S.args.staffName || '';
  return srv('advRequestPage', { staffId: staffId, staffName: staffName }).then(function(d){
    S.advReq = d;
    var c = d.chosen;
    var manyZones = !(d.zones && d.zones.length === 1);
    /* CUSTOMER SERVICE: one shared code, so the names are the call-agents roster's (Settings)
       and are picked BY NAME; a name HR has not put on the registry is still offered, flagged. */
    var byName = !!d.csAgents;
    HEAD = (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      + (d.noZoneTeams && d.noZoneTeams.length
          ? '<div class="note bad">Timu hizi hazina zone kwenye Teams & Staff, hivyo wafanyakazi wake hawaonekani hapa: ' + esc(d.noZoneTeams.join(', '))
            + '. / These teams carry no zone on Teams & Staff, so their staff cannot be listed here. Set the zone there and come back.</div>' : '')
      + '<div class="card"><div class="card-h">📝 Ombi la advance ya mshahara / Advance salary request'
        /* The names of YOUR role in your zone -- "credit can't be choosing names mixed with
           FOs" -- and the subtitle says which role and which zone that is. */
        + '<span class="sub">' + esc((d.role ? 'wadhifa / role: ' + d.role + ' · ' : 'wadhifa zote / every role · ')
          + (d.zones && d.zones.length ? 'zone: ' + d.zones.join(', ') : 'zone zote / every zone')) + '</span></div>'
      + (d.roleNote ? '<div class="note bad" style="margin:10px 14px 0">⚠️ ' + esc(d.roleNote) + '</div>' : '')
      /* WHO WILL SEE IT, said before it is sent (advRouteOf_ on the server): the approver role
         in the zone, the named supervisor, or -- by name -- nobody but an admin, so a request
         that reaches no desk is never found out from silence. */
      + (d.route ? '<div class="note' + (d.route.kind === 'none' ? ' bad' : '') + '" style="margin:10px 14px 0">Ombi lako litaenda kwa / Your request goes to: <b>' + esc(d.route.label) + '</b></div>' : '')
      + (d.routingOn === false ? '<div class="note" style="margin:10px 14px 0">⚠ ' + esc(d.routingNote || '') + '</div>' : '')
      /* A FINALIZED MONTH takes no request -- "when finalize is clicked even requesting is closed for current month unless add a
         temp-reopen button": the form is not drawn at all; the finance manager's reopen (on the report) brings it back. */
      + (d.monthClosed
          ? '<div class="note bad" style="margin:10px 14px 14px">🔒 ' + esc(d.monthClosed.note || '') + (d.monthClosed.by ? ' (' + esc(d.monthClosed.by) + (d.monthClosed.at ? ', ' + eatDt_(d.monthClosed.at) + ' EAT' : '') + ')' : '') + '</div>'
          : '<div class="cleanbox">'
      + '<div class="fld"><label>Jina lako / Your name *</label>'
        + '<select data-arg="' + (byName ? 'staffName' : 'staffId') + '"><option value="">— chagua jina lako / pick your name —</option>'
        + (d.staff || []).map(function(s){
            var v = byName ? s.name : s.id, on = c && (byName ? c.name === s.name : c.id === s.id);
            return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(s.name)
              + (s.onRegistry === false ? ' ⚠ si kwenye rejista ya HR / not on HR registry' : '')
              + (s.role && !byName ? ' · ' + esc(s.role) : '') + (manyZones && s.zone ? ' (' + esc(s.zone) + ')' : '') + '</option>'; }).join('')
        + '</select>'
        + '<div class="fldnote">' + (byName
            ? 'Majina kutoka orodha ya mawakala wa simu (Settings → Call agents). Jina lisilo kwenye rejista ya HR bado linaweza kuomba; HR aliongeze ili akaunti ya benki ipatikane. / Names from the call-agents roster (Settings → Call agents). A name not on the HR registry can still ask; HR should add it so the bank account is there.'
            : 'Majina ya wadhifa wako katika zone yako tu; hakuna taarifa nyingine ya mtu inayoonyeshwa. / Only your role\'s names in your zone; nothing else about anyone is shown.') + '</div>'
        /* HOW TO REPORT A MISSING PERSON -- "how must they report a missing person so that when those staff login they must see
           themselves to request?": the exact list HR needs, said where the officer is looking. */
        + (byName ? '' : '<div class="fldnote">Jina lako halionekani? Mwambie GMO wako au HR atume: <b>JINA KAMILI (kama benki) · WADHIFA · TIMU · SIMU · BENKI + AKAUNTI · TIN</b>. '
          + 'Utaonekana baada ya HR kuweka wadhifa sahihi na zone ya timu yako. / Can\'t find your name? Ask your GMO or HR to send: <b>full name (as at the bank) · role · team · phone · bank + account · TIN</b>. '
          + 'You appear once HR has set your role and your team\'s zone.</div>') + '</div>'
      + (c
          ? '<div class="facts">'
              + '<div class="frow"><span>Staff ID</span><b>' + esc(c.id || '— (si kwenye rejista ya HR / not on HR registry)') + '</b></div>'
              + '<div class="frow"><span>Jina / Name</span><b>' + esc(c.name) + '</b></div>'
              + '<div class="frow"><span>Wadhifa / Role</span><span>' + esc(c.role || '—') + '</span></div>'
              + '<div class="frow"><span>Zone</span><span>' + esc(c.zone || '—') + '</span></div></div>'
            /* No amount, no decision, no history on this shared screen -- "Only approvers see
               that". Just the one fact the month's rule needs: a request already went in. */
            + (d.monthTaken
                ? '<div class="note bad">⚠️ Ombi la mwezi huu (' + esc(d.month) + ') tayari limetumwa tarehe ' + esc(String(d.monthTaken.submitted_at||'').slice(0,10))
                  + '. Ombi moja tu kwa mwezi; mwidhinishaji ndiye anayeliona. / A request for this month was already sent on ' + esc(String(d.monthTaken.submitted_at||'').slice(0,10))
                  + '. One request per month; the approver sees it.</div>'
                : '<div class="fld"><label>Tarehe ya maombi / Application date</label><input id="advDate" type="date" value="' + today() + '"></div>'
                  + '<div class="fld"><label>Kiasi (TZS) / Amount</label><select id="advAmount">'
                  + (d.amounts || []).map(function(a){ return '<option value="' + a + '">' + money(a) + '</option>'; }).join('') + '</select></div>'
                  + '<button class="btn w" id="advSubmit">Tuma ombi / Submit request</button>')
          : '<div class="sub">Chagua jina lako kuona fomu. / Pick your name to see the form.</div>')
      + '</div>')
      + '</div>';
    /* THE HISTORY OF YOUR ROLE IN YOUR ZONE -- "allow users to see history of their requests
       so teams see history of their zone as FOs": a team code sees its zone's field officers'
       requests, a credit officer the zone's credit ones, newest first. */
    /* ...but only approvers and holders of the report see it -- "remove requests history to all
       users except approvers": anyone else gets the form alone, no list, no table. */
    if (d.canHistory === false){ S.rows = []; S.cols = []; ONROW = null; return; }
    S.rows = d.history || [];
    S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_name','Jina / Name'), col('zone','Zone'),
      col('app_date','Tarehe ya maombi / App date','date'), col('amount','Kiasi / Amount','money'),
      {key:'approval', label:'Idhini / Approval', cls:advApprCls_}, col('comment','Maoni / Comment'),
      col('decided_by','Aliyeamua / Decided by'), col('decided_at','Uamuzi / Decided','dt')];
    ONROW = null;
    S.foot = 'Historia ya maombi ya ' + (d.role ? 'wadhifa ' + d.role : 'wadhifa zote') + ' katika zone yako / History of ' + (d.role ? d.role : 'every role') + ' requests in your zone(s): ' + money(S.rows.length) + ' · mapya juu / newest first';
  });
};

function advSubmit(){
  var d = S.advReq || {}; var c = d.chosen; if (!c) return;
  var amount = $('#advAmount').value, date = $('#advDate').value;
  if (!date){ toast('Chagua tarehe ya maombi. / Pick the application date.', true); return; }
  if (!confirm('Tuma ombi la advance la TZS ' + money(amount) + ' kwa jina la ' + c.name + '? / Submit an advance request of TZS ' + money(amount) + ' for ' + c.name + '?')) return;
  // A roster name with no registry row goes by name (customer service); everyone else by ID.
  srv('advRequest', { staffId: c.id || '', staffName: c.name, appDate: date, amount: amount })
    .then(function(r){ toast('✅ Ombi limetumwa: TZS ' + money(r.amount) + (r.route ? ' → ' + r.route.label : '') + '. / Advance request submitted.'); render({ force:true }); })
    .catch(function(e){ toast(String(e.message||e), true); });
}

/* WHAT A DESK IS, in words, for the desk and the report alike (advDeskOf_ on the server): the
   roles routed to it, the roles it supervises whole, the people it supervises by name -- "every
   request" for an admin -- or '' when nothing is routed to it yet. */
function advDeskLine_(desk){
  if (desk.admin) return 'admin — maombi yote / every request';
  var bits = [];
  if ((desk.roles||[]).length) bits.push('wadhifa unaoidhinisha / roles you approve: ' + desk.roles.join(', '));
  if ((desk.deptRoles||[]).length) bits.push('msimamizi wa wadhifa wote / supervisor of every code of: ' + desk.deptRoles.join(', '));
  if ((desk.supervisees||[]).length) bits.push('unaowasimamia / you supervise: ' + desk.supervisees.map(function(s){ return s.name; }).join(', '));
  return bits.join(' · ');
}

/* THE APPROVAL DESK, in the app's own pattern -- "the advance approvals user interface is not aligning to our
   app standard yet": KPI cards; Pending / Decided pills; ONE standard table (sort, search, zone box, S/N, Excel and
   CSV like every other screen) with the ticks on the left for the bulk save, as the phone register has them; and a
   drawer for ONE request, as the imprest approvals have it. The old screen was a hand-built table with a select and a
   box on every row, wider than a phone, whose route text wrapped to eight lines.
   The route is a chip (who decides it), the age is a chip (red past a month: the imported ones), and a request the
   routing could not place is said on the screen in an admin's note, never in silence. */
function advAgeDays_(r){ var t = Date.parse(r.submitted_at); return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86400000)); }
/* THE MONTH'S STATE, said the same way on the desk and the report (advMonthState_ on the server): finalized by Finance and closed,
   or reopened for a while. An open month says nothing -- that is the ordinary case. */
function advMonthNote_(month, ms){
  ms = ms || {};
  if (ms.reopenUntil) return '<div class="note">🔓 Mwezi ' + esc(month || '') + ' ulikamilishwa na ' + esc(ms.by || 'Fedha') + ' lakini umefunguliwa kwa muda' + (ms.reopenBy ? ' na ' + esc(ms.reopenBy) : '') + ' hadi <b>' + esc(eatDt_(ms.reopenUntil)) + ' EAT</b>: maombi na maamuzi yanaruhusiwa hadi hapo, kisha unafungwa wenyewe. / Finalized by ' + esc(ms.by || 'Finance') + ', reopened for a while until then: requests and decisions are allowed until that time, then it closes by itself.</div>';
  if (ms.closed) return '<div class="note bad">🔒 Mwezi ' + esc(month || '') + ' umekamilishwa na ' + esc(ms.by || 'Fedha') + (ms.at ? ' tarehe ' + esc(eatDt_(ms.at)) + ' EAT' : '') + ': maombi mapya na maamuzi yamefungwa hadi ufunguliwe tena. / This month was finalized by ' + esc(ms.by || 'Finance') + ': new requests and decisions are closed until it is reopened.</div>';
  return '';
}
function advApprChip_(r){ return String(r.approval||'').toUpperCase() === 'APPROVED' ? 'ok' : String(r.approval||'').toUpperCase() === 'DISAPPROVED' ? 'bad' : 'mut'; }
VIEWS.advappr = function(){
  var state = S.args.state === 'decided' ? 'decided' : S.args.state === 'closed' ? 'closed' : 'pending';
  return srv('advQueue', {}).then(function(d){
    S.advQ = d;
    var pend = d.pending || [], rec = d.recent || [];
    var monthStart = String(d.month || '') + '-01';
    pend.forEach(function(r){ r.age = advAgeDays_(r); });
    var closed = d.closed || [];
    closed.forEach(function(r){ r.age = advAgeDays_(r); });
    var older = closed.length;                      // closed: an earlier month, or this month once Finance finalized it
    var mstate = d.monthState || {};
    /* WHAT THIS DESK IS (advRouteOf_ on the server): the roles routed to it and the people it supervises -- or, plainly,
       that nothing is routed to it yet and where that is set. An admin's desk shows every request and names the ones that
       reach nobody else. */
    var deskLine = advDeskLine_(d.desk || {});
    var unr = d.unrouted || [];
    HEAD = '<div class="kpis">'
      + kpi('Yanayosubiri / Pending', money(d.count), 'maombi / requests', d.count ? 'warnc' : 'good')
      + kpi('Kiasi kinachosubiri / Pending TZS', money(d.amount), null, d.amount ? 'warnc' : '')
      + kpi('Zimefungwa / Closed', money(older), 'miezi iliyopita, au mwezi uliokamilishwa / earlier months, or a finalized month', older ? 'bad' : 'good')
      + kpi('Yaliyoamuliwa mwezi huu / Decided this month', money(rec.length), esc(d.month || ''))
      + '</div>'
      + (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      /* A FINALIZED MONTH is closed to decisions too -- until Finance reopens it for a while. */
      + advMonthNote_(d.month, mstate)
      + (d.routingOn === false
          ? '<div class="note">⚠ ' + esc(d.routingNote || '') + '</div>'
          : '<div class="note' + (deskLine ? '' : ' bad') + '">Dawati lako / Your desk: ' + (deskLine ? esc(deskLine)
              : '⚠️ hakuna wadhifa wala mtu aliyeelekezwa kwako bado — admin aweke mwidhinishaji kwenye Nafasi na ruhusa, au akuchague kama msimamizi kwenye msimbo. / nothing is routed to this desk yet: an admin sets the approver role on Roles & access, or names you as a supervisor on a code.') + '</div>')
      + (unr.length
          ? '<div class="note bad">⚠️ Maombi ' + unr.length + ' hayamfikii mtu isipokuwa admin / ' + unr.length + ' request(s) reach nobody but an admin: '
            + esc(unr.map(function(u){ return u.staff_name + ' (' + (u.req_role || '?') + (u.zone ? ' · ' + u.zone : '') + ' — ' + (u.why || '') + ')'; }).join('; '))
            + '. Weka mwidhinishaji au timu ya zone hiyo kwenye Nafasi na ruhusa / Misimbo. / Set an approver, or give a code of the approver role a team in that zone, on Roles & access / Access codes.</div>'
          : '')
      + (d.noZoneTeams && d.noZoneTeams.length
          ? '<div class="note bad">Timu bila zone kwenye Teams & Staff: ' + esc(d.noZoneTeams.join(', '))
            + '. / Teams with no zone on Teams & Staff: their officers\' requests cannot reach this desk until the zone is set.</div>' : '')
      + bar('<button class="btn sm' + (state === 'pending' ? '' : ' ghost') + '" data-arg="state" data-val="pending">Yanayosubiri / Pending (' + money(pend.length) + ')</button>'
          + '<button class="btn sm' + (state === 'decided' ? '' : ' ghost') + '" data-arg="state" data-val="decided" style="margin-left:6px">Yaliyoamuliwa / Decided (' + money(rec.length) + ')</button>'
          + '<button class="btn sm' + (state === 'closed' ? '' : ' ghost') + '" data-arg="state" data-val="closed" style="margin-left:6px">Zimefungwa / Closed (' + money(closed.length) + ')</button>'
          + '<select data-filter="zone" style="margin-left:8px"><option value="">Zone zote / All zones</option>'
            + (d.zones || []).map(function(z){ return '<option' + (S.filters.zone === z ? ' selected' : '') + '>' + esc(z) + '</option>'; }).join('') + '</select>'
          + (state === 'pending' && pend.length
              ? '<input id="advBulkCom" placeholder="Maoni kwa zilizochaguliwa / Comment for the ticked" style="margin-left:8px;min-width:200px">'
                + '<button class="btn sm" id="advApproveMany" style="margin-left:6px">✅ Idhinisha zilizochaguliwa / Approve ticked</button>'
                + '<button class="btn sm bad" id="advRejectMany" style="margin-left:6px">✖ Kataa zilizochaguliwa / Disapprove ticked</button>'
                + '<span class="chip mut" data-pickcount="1" style="margin-left:8px">0</span><span class="mutl" style="font-size:12px">zimechaguliwa / ticked</span>'
                + '<button class="btn sm ghost" id="advPickNone" style="margin-left:6px">Ondoa chaguo / Clear</button>'
              : ''));
    if (state === 'pending') {
      S.pickKey = 'id';
      S.rows = pend;
      S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_name','Jina / Name'), col('staff_id','ID'),
        {key:'staff_role', label:'Wadhifa / Role', get:function(r){ return r.staff_role || r.req_role || ''; }},
        col('zone','Zone'), {key:'amount', label:'Kiasi / Amount', kind:'money'}, col('app_date','Tarehe ya ombi / App date','date'),
        {key:'age', label:'Umri / Age', kind:'chip', get:function(r){ return r.age + ' d'; }, chip:function(r){ return r.age > 31 ? 'bad' : r.age > 7 ? 'warn' : 'mut'; }},
        {key:'routeTo', label:'Kwa / To', kind:'chip', title:'Nani anaamua / who decides',
         get:function(r){ return r.routeTo || ''; }, chip:function(r){ return r.routeKind === 'none' ? 'bad' : /not recognised/.test(r.route || '') ? 'warn' : 'mut'; }}];
      ONROW = function(r){ advDecideDrawer_(r, true); };
      S.foot = 'Yanayosubiri / Pending: ' + money(pend.length) + ' · TZS ' + money(d.amount) + ' · gusa safu kwa uamuzi mmoja, tiki kwa wengi / tap a row for one decision, tick for many';
    } else if (state === 'closed') {
      // Read-only: never decided, and no longer decidable -- an earlier month, or this month once Finance finalized it.
      S.pickKey = '';
      S.rows = closed;
      S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_name','Jina / Name'), col('staff_id','ID'),
        {key:'staff_role', label:'Wadhifa / Role', get:function(r){ return r.staff_role || r.req_role || ''; }},
        col('zone','Zone'), {key:'amount', label:'Kiasi / Amount', kind:'money'}, col('app_date','Tarehe ya ombi / App date','date'),
        {key:'age', label:'Umri / Age', kind:'chip', get:function(r){ return r.age + ' d'; }, chip:function(){ return 'mut'; }}];
      ONROW = function(r){ advDecideDrawer_(r, false, 'Imefungwa: mwezi wake umeisha au umekamilishwa. / Closed: its month is over or finalized -- it can no longer be decided.'); };
      S.foot = 'Zimefungwa / Closed (hazijaamuliwa / never decided): ' + money(closed.length);
    } else {
      S.pickKey = '';
      S.rows = rec;
      S.cols = [col('decided_at','Uamuzi / Decided','dt'), col('staff_name','Jina / Name'), col('staff_id','ID'), col('zone','Zone'),
        {key:'amount', label:'Kiasi / Amount', kind:'money'},
        {key:'approval', label:'Idhini / Approval', kind:'chip', get:function(r){ return r.approval || ''; }, chip:advApprChip_},
        col('comment','Maoni / Comment'), col('decided_by','Aliyeamua / Decided by'), col('submitted_at','Imetumwa / Submitted','dt')];
      ONROW = function(r){ advDecideDrawer_(r, false); };
      S.foot = 'Yaliyoamuliwa mwezi huu (' + esc(d.month || '') + ') / Decided this month: ' + money(rec.length) + ' · mapya juu / newest first';
    }
  });
};

/* ONE REQUEST, in a drawer: what it is, who decides it, then the comment and the two answers -- the imprest approvals'
   pattern. A decided request opens the same drawer without the buttons. A comment is required to disapprove. */
function advDecideDrawer_(r, decidable, closedNote){
  var row = function(k, v){ return '<div class="frow"><span>' + k + '</span><b>' + (v == null || v === '' ? '—' : esc(String(v))) + '</b></div>'; };
  drawer('<h3>' + esc(r.staff_name || '—') + '</h3>'
    + '<div class="sub">' + esc(r.staff_id || '') + ' · ' + esc(r.staff_role || r.req_role || '') + ' · ' + esc(r.zone || '') + '</div>'
    + '<div class="facts">'
      + row('Kiasi / Amount', 'TZS ' + money(r.amount)) + row('Tarehe ya ombi / App date', String(r.app_date || '').slice(0, 10))
      + row('Imetumwa / Submitted', String(r.submitted_at || '').replace('T', ' ').slice(0, 16))
      + row('Anayeamua / Who decides', r.route)
      + (r.approval && String(r.approval).toUpperCase() !== 'PENDING' ? row('Idhini / Approval', r.approval) + row('Aliyeamua / Decided by', r.decided_by) + row('Maoni / Comment', r.comment) : '')
    + '</div>'
    + (closedNote ? '<div class="note bad">' + esc(closedNote) + '</div>' : '')
    + (decidable
        ? '<div class="fld"><label>Maoni / Comment</label><textarea id="advdCmt" rows="3" placeholder="Lazima ukikataa. / Required when you disapprove."></textarea></div>'
          + '<button class="btn w" id="advdOk" style="margin-top:8px">Idhinisha / Approve</button>'
          + '<button class="btn w ghost danger" id="advdNo" style="margin-top:6px">Kataa / Disapprove</button>'
        : ''));
  if (!decidable) return;
  var send = function(approval){
    var com = ($('#advdCmt').value || '').trim();
    if (approval === 'Disapproved' && !com){ toast('Andika sababu ya kukataa. / A reason is needed to disapprove.', true); return; }
    var b = $('#advdOk'), n = $('#advdNo'); if (b) b.disabled = true; if (n) n.disabled = true;
    srv('advDecide', { updates: [{ id: r.id, approval: approval, comment: com }] })
      .then(function(x){
        toast(approval === 'Approved' ? 'Imeidhinishwa / Approved' + (x.skipped && x.skipped.length ? ' · ' + x.skipped.join('; ') : '') : 'Imekataliwa / Disapproved');
        closeDrawer(); render({ force:true }); })
      .catch(function(e){ if (b) b.disabled = false; if (n) n.disabled = false; toast(String(e.message||e), true); });
  };
  $('#advdOk').onclick = function(){ send('Approved'); };
  $('#advdNo').onclick = function(){ send('Disapproved'); };
}

/* THE BULK SAVE: the ticked rows, one answer, one comment -- the sheet's bulkUpdateAdvances. The buttons live on the
   bar, which is rebuilt with every render, so they are wired after every paint (wireAdvDesk). */
function advBulk_(approval){
  var ids = pickList_();
  if (!ids.length){ toast('Tiki angalau ombi moja. / Tick at least one request.', true); return; }
  var com = (($('#advBulkCom') || {}).value || '').trim();
  if (approval === 'Disapproved' && !com){ toast('Andika sababu ya kukataa kwenye kisanduku cha maoni. / Write the reason in the comment box to disapprove.', true); return; }
  if (!confirm((approval === 'Approved' ? 'Idhinisha' : 'Kataa') + ' ' + ids.length + '? / ' + (approval === 'Approved' ? 'Approve' : 'Disapprove') + ' ' + ids.length + ' request(s)?')) return;
  srv('advDecide', { updates: ids.map(function(id){ return { id: id, approval: approval, comment: com }; }) })
    .then(function(r){
      toast('Imehifadhiwa / Saved: ' + r.approved + ' approved, ' + r.disapproved + ' disapproved'
        + (r.skipped && r.skipped.length ? ' · ' + r.skipped.join('; ') : '') + '.', !!(r.skipped && r.skipped.length));
      pickClear_(); render({ force:true }); })
    .catch(function(e){ toast(String(e.message||e), true); });
}
/* Wired by wireForms (app.html) after every paint, like the devices module: the bar is rebuilt with each render. */
function wireAdvDesk(){
  var a = document.getElementById('advApproveMany');
  if (a) a.onclick = function(){ advBulk_('Approved'); };
  var r = document.getElementById('advRejectMany');
  if (r) r.onclick = function(){ advBulk_('Disapproved'); };
  var n = document.getElementById('advPickNone');
  if (n) n.onclick = function(){ pickClear_(); paint(true); };
  var f = document.getElementById('advFinalizeBtn');
  if (f) f.onclick = advFinalize_;
  var o = document.getElementById('advReopenBtn');
  if (o) o.onclick = advReopen_;
}

/* THE FINAL DECISION -- the finance manager's, on the report: "we have to put [finalized button at report for finance manager to
   finalize]". Finalize closes THIS month: the decisions made stand, nothing else in it is decided, and no new request is filed in
   it -- until Reopen opens it again for a while (ADV_REOPEN_HOURS on Settings, 24 by default), after which it closes by itself.
   Both say what they did back, in figures, so what was closed is never guessed. */
function advFinalize_(){
  var d = S.advRep || {}, ms = d.monthState || {};
  if (!confirm((ms.finalized ? 'Kamilisha tena mwezi ' : 'Kamilisha mwezi ') + d.month + '? Maamuzi ' + money(d.openDecided || 0) + ' yaliyofanywa yanakuwa ya mwisho; maombi mapya na maamuzi mengine ya mwezi huu yanafungwa hadi ufungue tena kwa muda.'
    + '\n\nFinalize ' + d.month + (ms.finalized ? ' again' : '') + '? The ' + money(d.openDecided || 0) + ' decision(s) made become final; new requests and further decisions for this month are closed until you reopen it temporarily.')) return;
  var b = document.getElementById('advFinalizeBtn'); if (b) b.disabled = true;
  srv('advFinalize', {})
    .then(function(r){
      toast('🔒 Mwezi ' + r.month + ' umekamilishwa: ' + money(r.approved) + ' approved, TZS ' + money(r.approvedAmount)
        + (r.pendingClosed ? ' · ' + money(r.pendingClosed) + ' yamefungwa bila uamuzi / closed undecided' : '') + '. / Month finalized.');
      render({ force:true }); })
    .catch(function(e){ if (b) b.disabled = false; toast(String(e.message||e), true); });
}
function advReopen_(){
  var d = S.advRep || {};
  if (!confirm('Fungua tena mwezi ' + d.month + ' kwa muda? Maombi na maamuzi yataruhusiwa tena kwa saa chache (ADV_REOPEN_HOURS kwenye Settings, 24 kama hazijawekwa), kisha mwezi unafungwa wenyewe.'
    + '\n\nReopen ' + d.month + ' temporarily? Requests and decisions are allowed again for a few hours (ADV_REOPEN_HOURS on Settings, 24 unless set), then the month closes by itself.')) return;
  var b = document.getElementById('advReopenBtn'); if (b) b.disabled = true;
  srv('advReopen', {})
    .then(function(r){ toast('🔓 Mwezi ' + r.month + ' umefunguliwa kwa saa ' + money(r.hours) + ', hadi ' + eatDt_(r.reopenUntil) + ' EAT. / Reopened for ' + money(r.hours) + ' h.'); render({ force:true }); })
    .catch(function(e){ if (b) b.disabled = false; toast(String(e.message||e), true); });
}

/* THE REPORT the sheet exported: a window, Approved by default, by zone, with the bank and
   account beside each line so payroll can pay off the board (its own Excel / CSV buttons).
   A desk's report is the desk's requests -- routed to it or decided by it -- and the screen
   says so; an admin's is every request. */
VIEWS.advrep = function(){
  var from = S.args.from || '', to = S.args.to || '', approval = S.args.approval || '';
  return srv('advReport', { from: from, to: to, approval: approval }).then(function(d){
    S.advRep = d;
    var desk = d.desk || {};
    var deskLine = advDeskLine_(desk);
    var ms = d.monthState || {};
    /* THE MONTH'S STATE as a card: open (with the decisions Finalize would make final), finalized and closed, or reopened for a
       while. The finance manager's buttons sit on the bar: Finalize while the month is open or reopened, Reopen while it is closed. */
    var mWord = ms.reopenUntil ? 'Umefunguliwa kwa muda / Reopened' : ms.closed ? 'Imekamilishwa / Finalized' : 'Wazi / Open';
    var mSub = ms.reopenUntil ? 'hadi / until ' + eatDt_(ms.reopenUntil) + ' EAT' : ms.closed ? (ms.by || '') + (ms.at ? ' · ' + eatDt_(ms.at) + ' EAT' : '')
      : money(d.openDecided || 0) + ' maamuzi yanasubiri kukamilishwa / decision(s) await Finalize';
    var fin = d.canFinalize
      ? (ms.closed
          ? '<button class="btn sm" id="advReopenBtn" style="margin-left:8px">🔓 Fungua tena kwa muda / Reopen temporarily</button>'
          : '<button class="btn sm" id="advFinalizeBtn" style="margin-left:8px">🔒 ' + (ms.finalized ? 'Kamilisha tena / Finalize again' : 'Kamilisha mwezi / Finalize ' + esc(d.month || '')) + '</button>')
      : '';
    HEAD = '<div class="kpis">'
      + kpi('Maombi / Requests', money(d.count), d.from + ' → ' + d.to + ' · ' + (d.approval === 'ALL' ? 'yote / all' : d.approval))
      + kpi('Jumla / Amount', money(d.amount), 'TZS')
      + kpi('Yaliyoidhinishwa / Approved', money(d.approved), null, 'good')
      + kpi('Kiasi kilichoidhinishwa / Approved TZS', money(d.approvedAmount), 'kwa payroll / for payroll', 'good')
      + kpi('Mwezi ' + esc(d.month || '') + ' / This month', mWord, mSub, ms.closed ? 'good' : 'warnc')
      + '</div>'
      + (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      + advMonthNote_(d.month, ms)
      + (desk.finance ? '<div class="note">💼 Ripoti ya Meneja wa Fedha: maombi yote ya kila dawati; Kamilisha hufunga mwezi huu kwa maombi na maamuzi. / The finance manager\'s report: every desk\'s requests; Finalize closes this month to requests and decisions.</div>' : '')
      + (d.routingOn === false
          ? '<div class="note">⚠ ' + esc(d.routingNote || '') + '</div>'
          : '<div class="note' + (deskLine ? '' : ' bad') + '">Ripoti hii inaonyesha / This report shows: '
              + (desk.admin ? esc(deskLine)
                 : deskLine ? 'maombi yaliyoelekezwa kwako na uliyoyaamua / the requests routed to your desk and the ones you decided — ' + esc(deskLine)
                 : '⚠️ hakuna wadhifa wala mtu aliyeelekezwa kwako — utaona uliyoyaamua tu. / nothing is routed to your desk — you see only the ones you decided.')
              + '</div>')
      + bar('<input type="date" data-arg="from" value="' + esc(d.from) + '">'
        + '<input type="date" data-arg="to" value="' + esc(d.to) + '">'
        + '<select data-arg="approval">' + (d.approvals||[]).map(function(a){
            return '<option value="' + esc(a) + '"' + (String(d.approval).toUpperCase() === a.toUpperCase() ? ' selected' : '') + '>' + esc(a === 'ALL' ? 'Yote / All' : a) + '</option>'; }).join('') + '</select>'
        + '<select data-filter="zone"><option value="">Zone zote / All zones</option>'
        + (d.zones||[]).map(function(z){ return '<option' + (S.filters.zone===z?' selected':'') + '>' + esc(z) + '</option>'; }).join('') + '</select>'
        + fin)
      + board('advRepZones', 'Kwa zone / By zone', 'maombi na kiasi kwa kila zone / requests and amount per zone', d.summary || [],
          [col('zone','Zone'), col('requests','Maombi / Requests','num'), col('amount','Kiasi / Amount','money'),
           col('approved','Approved','num'), col('approvedAmount','Approved TZS','money')],
          sumRow(d.summary || [], ['requests','amount','approved','approvedAmount']));
    S.rows = d.rows || [];
    S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_id','Staff ID'), col('staff_name','Staff'), col('staff_role','Wadhifa / Role'),
      col('zone','Zone'), col('app_date','Tarehe ya maombi / App date','date'), col('amount','Kiasi / Amount','money'),
      {key:'approval', label:'Idhini / Approval', cls:advApprCls_}, col('comment','Maoni / Comment'), col('decided_by','Aliyeamua / Decided by'),
      col('bank','Benki / Bank'), col('account','Akaunti / Account'),
      // Open until its month is over or Finance finalizes it; then final -- "closed [when its not current month ...]".
      {key:'finalState', label:'Hali ya mwisho / Final', kind:'chip', get:function(r){ return r.finalState === 'finalized' ? 'Imekamilishwa / Finalized' : r.finalState === 'closed' ? 'Imefungwa / Closed' : 'Wazi / Open'; },
       chip:function(r){ return r.finalState === 'open' ? 'warn' : 'ok'; }},
      // The last column is the approval date, in East Africa time like Submitted -- "remove kupitia/via ... replace with approval date".
      col('decided_at','Tarehe ya idhini / Approval date','dt')];
    ONROW = null;
    S.foot = money(d.count) + ' maombi / requests · TZS ' + money(d.amount) + ' · approved TZS ' + money(d.approvedAmount);
  });
};

/* HR'S REGISTRY: the sheet's DATABASE tab. Search is the card's own box; a row opens the form;
   New staff gets its ID generated (initials / running number / year) and its birth date read
   off the NIDA number. */
VIEWS.advstaff = function(){
  return srv('advStaff', {}).then(function(d){
    S.advStaffMeta = d;
    HEAD = '<div class="kpis">'
      + kpi('Wafanyakazi / Staff', money(d.total), money(d.active) + ' active')
      + kpi('Zone', money((d.zones||[]).length), (d.zones||[]).join(', '))
      + kpi('ID inayofuata / Next serial', esc(String(d.nextSerial||'')), 'herufi za kwanza / ' + esc(String(d.nextSerial||'')).padStart(3, '0') + ' / ' + esc(String(d.year||'')))
      + '</div>'
      + (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      + (d.noZoneTeams && d.noZoneTeams.length
          ? '<div class="note bad">Timu bila zone kwenye Teams & Staff: ' + esc(d.noZoneTeams.join(', '))
            + '. / Teams with no zone on Teams & Staff: set it there so their officers find their names on the request tab.</div>' : '')
      + bar('<select data-filter="zone"><option value="">Zone zote / All zones</option>'
        + (d.zones||[]).map(function(z){ return '<option' + (S.filters.zone===z?' selected':'') + '>' + esc(z) + '</option>'; }).join('') + '</select>'
        + '<select data-filter="status"><option value="">Active + Inactive</option>'
          + '<option value="ACTIVE"' + (S.filters.status==='ACTIVE'?' selected':'') + '>Active</option>'
          + '<option value="INACTIVE"' + (S.filters.status==='INACTIVE'?' selected':'') + '>Inactive</option></select>'
        /* newAdvStaff, not newStaff: Teams & Staff's own "+ Mpya / New" button carries that id, and
           wireForms wires both by id -- the later wiring won, and this button opened the wrong form. */
        + '<button class="btn sm" id="newAdvStaff">+ Staff mpya / New staff</button>');
    S.rows = d.rows || [];
    S.cols = [col('id','ID'), col('name','Jina / Name'), col('role','Wadhifa / Role'), col('zone','Zone'), col('phone','Simu / Phone'),
      col('bank','Benki / Bank'), col('account','Akaunti / Account'), col('reg_date','Usajili / Reg date','date'),
      col('birth_date','Kuzaliwa / Birth date','date'),
      {key:'status', label:'Status', cls:function(r){ return String(r.status||'').toUpperCase()==='INACTIVE' ? 'bad' : 'good'; }}];
    ONROW = advStaffForm;
    S.foot = money(d.count) + ' staff · ' + money(d.active) + ' active';
  });
};

function advStaffForm(x){
  var m = S.advStaffMeta || { zones: [] };
  var isNew = !x;
  var v = function(k){ return x && x[k] != null ? x[k] : ''; };
  var fld = function(id, label, val, type, extra){
    return '<div class="fld"><label>' + label + '</label><input id="' + id + '" type="' + (type||'text') + '" value="' + esc(String(val)) + '"' + (extra||'') + '></div>'; };
  drawer('<h3>' + (isNew ? 'Staff mpya / New staff' : esc(x.name)) + '</h3>'
    + '<div class="sub">' + (isNew
        ? 'ID itatengenezwa: herufi za kwanza za jina / namba ya mfululizo / mwaka (mf. JMM/001/2026). / The ID is generated: initials / running number / year.'
        : 'ID: <b>' + esc(x.id) + '</b> · ' + esc(x.status||'')) + '</div>'
    + fld('asReg', 'REG-DATE', v('reg_date') ? String(v('reg_date')).slice(0,10) : today(), 'date')
    + fld('asId', 'ID (acha wazi itengenezwe / leave blank to generate)', v('id'), 'text', isNew ? '' : ' readonly')
    + fld('asName', 'STAFF NAME *', v('name'))
    + fld('asPhone', 'PHONE', v('phone'), 'tel') + fld('asPhone2', 'PHONE 2', v('phone2'), 'tel')
    /* ROLE as Roles & access spells it: the request tab lists a name only under its own role,
       so a role typed another way puts the person on nobody's list. Free text stays allowed. */
    + '<div class="fld"><label>ROLE (kama Nafasi na ruhusa inavyouita / as Roles &amp; access spells it)</label><input id="asRole" list="asRoles" value="' + esc(String(v('role'))) + '">'
      + '<datalist id="asRoles">' + (m.roleNames||[]).map(function(r){ return '<option value="' + esc(r) + '">'; }).join('') + '</datalist></div>'
    + fld('asRes', 'Residence', v('residence'))
    + fld('asBank', 'BANK NAME', v('bank')) + fld('asAcc', 'ACCOUNTS', v('account'))
    + '<div class="fld"><label>ZONE (chini ya GMO / under GMO) *</label><input id="asZone" list="asZones" value="' + esc(v('zone')) + '">'
      + '<datalist id="asZones">' + (m.zones||[]).map(function(z){ return '<option value="' + esc(z) + '">'; }).join('') + '</datalist>'
      + '<div class="fldnote">Zone kama ilivyo kwenye Teams & Staff, ndiyo inayomfanya afisa aone jina lake. / The zone as Teams & Staff spells it: that is what lets an officer find this name.</div></div>'
    + fld('asNida', 'NIDA-No', v('nida'), 'text', ' inputmode="numeric"')
    + fld('asBirth', 'BIRTH DATE (kutoka NIDA / from the NIDA number)', v('birth_date') ? String(v('birth_date')).slice(0,10) : '', 'date')
    + fld('asG1', 'JINA LA MDHAMINI', v('guarantor1')) + fld('asG1P', 'SIMU YA MDHAMINI', v('guarantor1_phone'), 'tel')
    + fld('asG2', 'JINA LA MDHAMINI 2', v('guarantor2')) + fld('asG2P', 'SIMU YA MDHAMINI 2', v('guarantor2_phone'), 'tel')
    + fld('asTin', 'TIN-No', v('tin')) + fld('asNssf', 'NSSF-No', v('nssf'))
    + '<button class="btn w" id="asSave">Hifadhi / Save</button>'
    + (isNew ? '' : '<button class="btn ghost w" style="margin-top:8px" id="asStatus">'
        + (String(x.status||'').toUpperCase()==='INACTIVE' ? '● Weka Active / Set Active' : '○ Weka Inactive / Set Inactive') + '</button>'));
  // The birth date follows the NIDA number as it is typed: its first eight digits, YYYYMMDD.
  $('#asNida').oninput = function(){
    var dg = String($('#asNida').value).replace(/\D/g, '');
    if (dg.length >= 8) $('#asBirth').value = dg.slice(0,4) + '-' + dg.slice(4,6) + '-' + dg.slice(6,8);
  };
  $('#asSave').onclick = function(){
    if (!$('#asName').value.trim()){ toast('Jina linahitajika. / The name is required.', true); return; }
    if (!$('#asZone').value.trim()){ toast('Chagua zone. / Pick the zone.', true); return; }
    srv('advStaffSave', { id: $('#asId').value, regDate: $('#asReg').value, name: $('#asName').value, phone: $('#asPhone').value, phone2: $('#asPhone2').value,
      role: $('#asRole').value, residence: $('#asRes').value, bank: $('#asBank').value, account: $('#asAcc').value, zone: $('#asZone').value,
      nida: $('#asNida').value, birthDate: $('#asBirth').value, guarantor1: $('#asG1').value, guarantor1Phone: $('#asG1P').value,
      guarantor2: $('#asG2').value, guarantor2Phone: $('#asG2P').value, tin: $('#asTin').value, nssf: $('#asNssf').value,
      status: x ? x.status : 'Active' })
      .then(function(r){ toast((r.created ? 'Imeongezwa / Added: ' : 'Imehifadhiwa / Saved: ') + r.id); closeDrawer(); render({ force:true }); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
  if (!isNew) $('#asStatus').onclick = function(){
    var next = String(x.status||'').toUpperCase()==='INACTIVE' ? 'Active' : 'Inactive';
    srv('advStaffStatus', { id: x.id, status: next })
      .then(function(){ toast(x.name + ' → ' + next); closeDrawer(); render({ force:true }); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}
