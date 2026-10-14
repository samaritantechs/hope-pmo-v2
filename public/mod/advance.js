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
   rule and the amounts come from the server. Your own history sits below once a name is picked. */
VIEWS.advreq = function(){
  var staffId = S.args.staffId || '';
  return srv('advRequestPage', { staffId: staffId }).then(function(d){
    S.advReq = d;
    var c = d.chosen;
    var manyZones = !(d.zones && d.zones.length === 1);
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
      + '<div class="cleanbox">'
      + '<div class="fld"><label>Jina lako / Your name *</label>'
        + '<select data-arg="staffId"><option value="">— chagua jina lako / pick your name —</option>'
        + (d.staff || []).map(function(s){
            return '<option value="' + esc(s.id) + '"' + (c && c.id === s.id ? ' selected' : '') + '>' + esc(s.name)
              + (s.role ? ' · ' + esc(s.role) : '') + (manyZones && s.zone ? ' (' + esc(s.zone) + ')' : '') + '</option>'; }).join('')
        + '</select>'
        + '<div class="fldnote">Majina ya wadhifa wako katika zone yako tu; hakuna taarifa nyingine ya mtu inayoonyeshwa. / Only your role\'s names in your zone; nothing else about anyone is shown.</div></div>'
      + (c
          ? '<div class="facts">'
              + '<div class="frow"><span>Staff ID</span><b>' + esc(c.id) + '</b></div>'
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
      + '</div></div>';
    /* THE HISTORY OF YOUR ROLE IN YOUR ZONE -- "allow users to see history of their requests
       so teams see history of their zone as FOs": a team code sees its zone's field officers'
       requests, a credit officer the zone's credit ones, newest first. */
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
  srv('advRequest', { staffId: c.id, appDate: date, amount: amount })
    .then(function(r){ toast('✅ Ombi limetumwa: TZS ' + money(r.amount) + (r.route ? ' → ' + r.route.label : '') + '. / Advance request submitted.'); render({ force:true }); })
    .catch(function(e){ toast(String(e.message||e), true); });
}

/* THE GMO'S DESK: the sheet's bulk approval, with the zone enforced by the sign-in. Tick,
   choose, comment, save; what was decided in the last fourteen days sits below. */
VIEWS.advappr = function(){
  var zone = S.args.zone || '';
  return srv('advQueue', { zone: zone }).then(function(d){
    S.advQ = d;
    var pend = d.pending || [];
    /* WHAT THIS DESK IS (advRouteOf_ on the server): the roles routed to it and the people it
       supervises -- or, plainly, that nothing is routed to it yet and where that is set. An
       admin's desk shows every request and names the ones that reach nobody else. */
    var desk = d.desk || {};
    var deskBits = [];
    if ((desk.roles||[]).length) deskBits.push('wadhifa unaoidhinisha / roles you approve: ' + desk.roles.join(', '));
    if ((desk.deptRoles||[]).length) deskBits.push('msimamizi wa wadhifa wote / supervisor of every code of: ' + desk.deptRoles.join(', '));
    if ((desk.supervisees||[]).length) deskBits.push('unaowasimamia / you supervise: ' + desk.supervisees.map(function(s){ return s.name; }).join(', '));
    var deskLine = desk.admin ? 'admin — maombi yote / every request' : deskBits.join(' · ');
    HEAD = '<div class="kpis">'
      + kpi('Yanayosubiri / Pending', money(d.count), 'maombi / requests', d.count ? 'warnc' : 'good')
      + kpi('Kiasi kinachosubiri / Pending TZS', money(d.amount), null, d.amount ? 'warnc' : '')
      + kpi('Yaliyoamuliwa mwezi huu / Decided this month', money((d.recent||[]).length), esc(d.month || ''))
      + '</div>'
      + (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      + (d.routingOn === false
          ? '<div class="note">⚠ ' + esc(d.routingNote || '') + '</div>'
          : '<div class="note' + (deskLine ? '' : ' bad') + '">Dawati lako / Your desk: ' + (deskLine ? esc(deskLine)
              : '⚠️ hakuna wadhifa wala mtu aliyeelekezwa kwako bado — admin aweke mwidhinishaji kwenye Nafasi na ruhusa, au akuchague kama msimamizi kwenye msimbo. / nothing is routed to this desk yet: an admin sets the approver role on Roles & access, or names you as a supervisor on a code.') + '</div>')
      + ((d.unrouted||[]).length
          ? '<div class="note bad">⚠️ Maombi ' + d.unrouted.length + ' hayamfikii mtu isipokuwa admin — wadhifa wao hauna mwidhinishaji: '
            + esc(d.unrouted.map(function(u){ return u.staff_name + ' (' + (u.req_role || '?') + ')'; }).join(', '))
            + '. Weka mwidhinishaji kwenye Nafasi na ruhusa. / ' + d.unrouted.length + ' request(s) reach nobody but an admin — their role has no approver set. Set it on Roles & access.</div>'
          : '')
      + (d.noZoneTeams && d.noZoneTeams.length
          ? '<div class="note bad">Timu bila zone kwenye Teams & Staff: ' + esc(d.noZoneTeams.join(', '))
            + '. / Teams with no zone on Teams & Staff: their officers\' requests cannot reach this desk until the zone is set.</div>' : '')
      + bar('<select data-arg="zone"><option value="">Zone zote / All zones</option>'
          + (d.zones||[]).map(function(z){ return '<option' + (zone===z?' selected':'') + '>' + esc(z) + '</option>'; }).join('') + '</select>'
          + (pend.length ? '<button class="btn sm" id="advDecideSave" style="margin-left:auto">💾 Hifadhi maamuzi / Save decisions</button>' : ''))
      + '<div class="card"><div class="card-h">✅ Idhinisha maombi ya advance / Approve advance requests'
        + '<span class="sub">mapya juu / newest first · tiki · chagua · andika maoni · hifadhi / tick · choose · comment · save</span></div>'
      + (pend.length
          ? '<div class="scroll"><table><thead><tr><th>✔</th><th>Staff</th><th>Zone</th><th>Kwa / To</th><th class="r">Kiasi / Amount</th><th>Tarehe / App date</th><th>Imetumwa / Submitted</th><th>Idhini / Approval</th><th>Maoni / Comment</th></tr></thead><tbody>'
            + pend.map(function(r, i){
                return '<tr><td><input type="checkbox" class="advChk" data-i="' + i + '"></td>'
                  + '<td><b>' + esc(r.staff_name||'') + '</b><br><span style="color:var(--mut);font-size:11px">' + esc(r.staff_id||'') + (r.staff_role ? ' · ' + esc(r.staff_role) : '') + '</span></td>'
                  + '<td>' + esc(r.zone||'') + '</td>'
                  + '<td style="white-space:normal;font-size:11px">' + esc(r.route||'') + '</td>'
                  + '<td class="r">' + money(r.amount) + '</td>'
                  + '<td>' + esc(String(r.app_date||'').slice(0,10)) + '</td><td>' + esc(String(r.submitted_at||'').replace('T',' ').slice(0,16)) + '</td>'
                  + '<td><select class="advSel" data-i="' + i + '">' + (d.approvals||['Approved','Disapproved']).map(function(a){ return '<option>' + esc(a) + '</option>'; }).join('') + '</select></td>'
                  + '<td><input class="advCom" data-i="' + i + '" placeholder="Maoni / Comment"></td></tr>';
              }).join('')
            + '</tbody></table></div>'
          : '<div class="note">Hakuna ombi linalosubiri. / No pending requests.</div>')
      + '</div>';
    S.rows = d.recent || [];
    S.cols = [col('decided_at','Uamuzi / Decided','dt'), col('staff_name','Staff'), col('staff_id','Staff ID'), col('zone','Zone'), col('route','Kwa / To'),
      col('amount','Kiasi / Amount','money'), {key:'approval', label:'Idhini / Approval', cls:advApprCls_}, col('comment','Maoni / Comment'),
      col('decided_by','Aliyeamua / Decided by'), col('submitted_at','Imetumwa / Submitted','dt')];
    ONROW = null;
    S.foot = 'Yaliyoamuliwa mwezi huu (' + esc(d.month || '') + ') / Decided this month: ' + money(S.rows.length) + ' · mapya juu / newest first';
  });
};

function advDecideSave(){
  var d = S.advQ || {}; var pend = d.pending || [];
  var checked = Array.prototype.filter.call(document.querySelectorAll('.advChk'), function(c){ return c.checked; });
  if (!checked.length){ toast('Tiki angalau ombi moja. / Tick at least one request.', true); return; }
  var updates = checked.map(function(c){
    var i = Number(c.getAttribute('data-i'));
    return { id: pend[i].id, approval: document.querySelector('.advSel[data-i="' + i + '"]').value,
      comment: document.querySelector('.advCom[data-i="' + i + '"]').value.trim() };
  });
  if (!confirm('Hifadhi maamuzi ' + updates.length + '? / Save ' + updates.length + ' decision(s)?')) return;
  srv('advDecide', { updates: updates })
    .then(function(r){
      toast('Imehifadhiwa / Saved: ' + r.approved + ' approved, ' + r.disapproved + ' disapproved'
        + (r.skipped && r.skipped.length ? ' · ' + r.skipped.join('; ') : '') + '.');
      render({ force:true }); })
    .catch(function(e){ toast(String(e.message||e), true); });
}

/* THE REPORT the sheet exported: a window, Approved by default, by zone, with the bank and
   account beside each line so payroll can pay off the board (its own Excel / CSV buttons). */
VIEWS.advrep = function(){
  var from = S.args.from || '', to = S.args.to || '', approval = S.args.approval || '';
  return srv('advReport', { from: from, to: to, approval: approval }).then(function(d){
    S.advRep = d;
    HEAD = '<div class="kpis">'
      + kpi('Maombi / Requests', money(d.count), d.from + ' → ' + d.to + ' · ' + (d.approval === 'ALL' ? 'yote / all' : d.approval))
      + kpi('Jumla / Amount', money(d.amount), 'TZS')
      + kpi('Yaliyoidhinishwa / Approved', money(d.approved), null, 'good')
      + kpi('Kiasi kilichoidhinishwa / Approved TZS', money(d.approvedAmount), 'kwa payroll / for payroll', 'good')
      + '</div>'
      + (d.on === false ? '<div class="note">⚠ ' + esc(d.note || '') + '</div>' : '')
      + bar('<input type="date" data-arg="from" value="' + esc(d.from) + '">'
        + '<input type="date" data-arg="to" value="' + esc(d.to) + '">'
        + '<select data-arg="approval">' + (d.approvals||[]).map(function(a){
            return '<option value="' + esc(a) + '"' + (String(d.approval).toUpperCase() === a.toUpperCase() ? ' selected' : '') + '>' + esc(a === 'ALL' ? 'Yote / All' : a) + '</option>'; }).join('') + '</select>'
        + '<select data-filter="zone"><option value="">Zone zote / All zones</option>'
        + (d.zones||[]).map(function(z){ return '<option' + (S.filters.zone===z?' selected':'') + '>' + esc(z) + '</option>'; }).join('') + '</select>')
      + board('advRepZones', 'Kwa zone / By zone', 'maombi na kiasi kwa kila zone / requests and amount per zone', d.summary || [],
          [col('zone','Zone'), col('requests','Maombi / Requests','num'), col('amount','Kiasi / Amount','money'),
           col('approved','Approved','num'), col('approvedAmount','Approved TZS','money')],
          sumRow(d.summary || [], ['requests','amount','approved','approvedAmount']));
    S.rows = d.rows || [];
    S.cols = [col('submitted_at','Imetumwa / Submitted','dt'), col('staff_id','Staff ID'), col('staff_name','Staff'), col('staff_role','Wadhifa / Role'),
      col('zone','Zone'), col('app_date','Tarehe ya maombi / App date','date'), col('amount','Kiasi / Amount','money'),
      {key:'approval', label:'Idhini / Approval', cls:advApprCls_}, col('comment','Maoni / Comment'), col('decided_by','Aliyeamua / Decided by'),
      col('bank','Benki / Bank'), col('account','Akaunti / Account'), col('code','Kupitia / Via')];
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
