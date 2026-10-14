/* admin -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/admin.js?v=BUILD. */

/* Teams & Staff is the supervisory distribution -- the assignment rotation and every leader
   report read these columns, so a reassignment has to be editable here, not re-uploaded. */
// "recovery officers and collection officers names aint reflecting in abnormal payments ...
// pmo column" -- the PMO column on Abnormal Payments names whoever the customer's stage maps
// to (RECOVERY -> teams.recovery, COLLECTION -> teams.collection -- see ABN_STAGE server-side)
// but 'collection' was never on this list, so there was never a box on this screen to type a
// Collection officer's name into at all. The column itself already exists once
// db/migrations/2026-08-09-team-contacts.sql has been run (it is additive/optional -- saveTeam
// silently drops the field until then); this is the other half, the form to fill it from.
var TEAM_ROLES = ['opm','recovery','gmo','manager','credit','expected','bike','collection','legal'];

/* THERE IS NO CREDIT ID ANY MORE. An analyst used to be carried by the number they appear under
   in the sale-approvals report, and every report then had to translate that number back into a
   person. Now the approvals report is read by NAME against the CREDIT column below, so there is
   nothing left to type in and nothing left to keep in step. */
/* THE OFFLINE SHEET, TYPED IN HERE INSTEAD OF KEPT IN A SPREADSHEET.
   region · zone · a phone number beside every role that has a name · the legal officer · the
   collection officer. Optional columns: until 2026-08-09-team-contacts.sql is run, saveTeam
   drops them rather than sending them, so the form saves everything else exactly as before. */
var TEAM_EXTRA = [
  ['region', 'REGION'], ['zone', 'ZONE'], ['branch', 'BRANCH'],
  ['opm_no', 'OPM No'],
  ['recovery_no', 'RECOVERY No'], ['recovery_id', 'RECOVERY ID'],
  ['gmo_no', 'GMO No'], ['gmo_id', 'GMO ID'],
  ['manager_no', 'MANAGER No'], ['manager_id', 'MANAGER ID'],
  ['credit_no', 'C. ANALYST No'], ['credit_id', 'C. ANALYST ID'],
  // "my final thought of the teams and staff table" renamed EXPECTED to EARLY COL on the
  // sheet -- the field is still expected/expected_no underneath, so nothing else has to change.
  ['expected_no', 'EARLY COL No'], ['early_col_id', 'EARLY COL ID'],
  ['bike_no', 'BIKE No'], ['bike_id', 'BIKE ID'],
  ['legal', 'LEGAL'], ['legal_no', 'LEGAL No'], ['legal_id', 'LEGAL ID'],
  ['collection', 'COLLECTION'], ['collection_no', 'COL No'], ['collection_id', 'COL ID'],
];

/* NAME AND NUMBER, ONE COLUMN, RED WHEN THE NUMBER IS MISSING. "I need to see the full table
   of detailed teams and staff in the web so that I know what misses when am there too -- b/se
   its still unlike the export, there I see as before" -- the main table used to show only the
   name half of every role, so a team with nobody to call for its Bulk SMS export looked exactly
   like one that did. Every role column now carries its number too, and turns the same `bad` red
   the Msimbo/Code column already uses for "field officers cannot sign in" -- so a gap is visible
   by scanning the table, not only by running an export and reading its prompt. */
function roleCol(nameKey, phoneKey, label){
  return { key: nameKey, label: label,
    cls: function(r){ return r[phoneKey] ? '' : 'bad'; },
    get: function(r){
      var nm = String(r[nameKey] || '').trim(), ph = String(r[phoneKey] || '').trim();
      if (!nm && !ph) return '—';
      if (nm && ph) return nm + ' · ' + ph;
      return nm ? (nm + ' — no number') : ('(' + ph + ')');
    } };
}

VIEWS.teams = function(){
  return Promise.all([srvTeams_(), srv('callAgents').catch(function(){ return null; }),
                      srv('staffRoster').catch(function(){ return null; })]).then(function(rr){
    var d = rr[0]; S.csAgents = rr[1]; S.staff = rr[2];
    // Every team name, for the merge picker in the drawer -- so the destination is CHOSEN from
    // what exists rather than typed, which is how the wrong spelling got created in the first
    // place. Kept on S because the drawer is opened from a row, not re-fetched.
    S.teamNames = d.rows.map(function(r){ return r.team; }).filter(Boolean).sort();
    var staffed = {};
    d.rows.forEach(function(r){ TEAM_ROLES.forEach(function(c){ if (r[c]) staffed[r[c]] = 1; }); });
    S.roleMeta = d;
    var noCode = d.rows.filter(function(r){ return !r.team_code; }).length;
    HEAD = '<div class="kpis">' + kpi('Teams', money(d.rows.length))
      + kpi('Supervisors named', money(Object.keys(staffed).length), 'across ' + TEAM_ROLES.length + ' roles')
      + kpi('Roles', money((d.roles||[]).length), 'tab permissions per role')
      + kpi('Bila msimbo / No code', money(noCode), 'officers cannot sign in', noCode?'bad':'good') + '</div>'
      + '<div class="note">Msimbo wa timu ndio maafisa wanaingia nao. Ukibadilisha, simu zote za timu hiyo zinakatwa mara moja.'
      + ' / The team code is what field officers sign in with. Changing it cuts every handset on that team immediately —'
      + ' that is how you lock out someone who has left. To cut <b>one</b> person only, switch their account off in Settings.</div>'
      /* WAFANYAKAZI / STAFF -- the same people, listed BY PERSON instead of by team.
         Moving somebody off ten teams and onto ten others was twenty edits down in the table
         below, each one a chance to miss a row. Here it is one row, one save.
         It also shows the COLLECTION OFFICERS, whose teams live on their access code rather
         than on the teams table -- so they were not on this screen at all. */
      + (S.me.can.admin && S.staff
          ? fold_('staff', 'Wafanyakazi / Staff — by person',
              ((S.staff.staff||[]).length) + ' watu / people',
            '<div class="card" id="staffCard"><div class="card-h">Wafanyakazi / Staff &mdash; by person'
            + '<span class="sub"><button class="btn sm ghost" id="staffXl">\u2b07 Excel &mdash; namba zote / all numbers</button>'
            + ' <button class="btn sm" id="newStaff">+ Mpya / New</button></span></div>'
            + '<div class="note" style="margin:10px 14px">Bofya mtu kubadili timu zake zote kwa mara moja.'
            + ' / Tap a person to set <b>all</b> their teams at once. Timu usiyoichagua inaondolewa kwake.'
            + ' / A team you leave unticked is taken off them.'
            + ' Namba zenye \ud83d\udcf1 zinatoka kwenye app ya simu &mdash; ndipo watu wanajisajili wenyewe.'
            + ' / Numbers marked \ud83d\udcf1 come from the call app registration, the freshest source.</div>'
            + '<div class="scroll"><table><thead><tr><th class="sn">S/N</th><th>Jina / Name</th><th>Wadhifa / Role</th>'
            + '<th>Namba / Phone</th><th class="r">Timu</th><th>Teams</th><th></th></tr></thead><tbody>'
            + (S.staff.staff||[]).map(function(x, i){
                var key = x.role + '\u0001' + x.name;
                return '<tr class="clickrow" data-staff="'+esc(key)+'"><td class="sn">'+(i+1)+'</td>'
                  + '<td><b>'+esc(x.name)+'</b></td><td>'+esc(x.roleLabel)+'</td>'
                  + '<td>'+(x.phone ? esc(x.phone)+(x.phoneFrom==='app'?' \ud83d\udcf1':'') : '\u2014')+'</td>'
                  + '<td class="r">'+money((x.teams||[]).length)+'</td>'
                  + '<td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
                  + esc((x.teams||[]).join(', ') || '—')+'</td>'
                  + '<td class="r"><button class="btn sm ghost" data-staff="'+esc(key)+'">Badili / Edit</button></td></tr>';
              }).join('')
            + '</tbody></table></div></div>')
          : '')
      /* The roles table used to sit here. It moved to SETTINGS, immediately above the access
         codes it governs -- "I need a new role assign table before access codes" -- because
         that is the screen where somebody decides who may see what, and a role's tabs are
         only meaningful next to the codes that inherit them. */
      // The agent ids come from the application reports; the humans behind them are named
      // here. One id can cover two people who share a desk and a login.
      + (S.me.can.admin && S.csAgents
          ? '<div class="card" id="agentsCard"><div class="card-h">Call agents (application reports)'
            + '<span class="sub"><button class="btn sm" id="newAgent">+ Agent</button></span></div>'
            + ((S.csAgents.unnamed||[]).length
                ? '<div class="note bad" style="margin:10px 14px"><b>'+money(S.csAgents.unnamed.length)
                  + '</b> agent id(s) appear on applications but have no name yet: '
                  + esc(S.csAgents.unnamed.join(', ')) + '</div>' : '')
            + '<div class="scroll"><table><thead><tr><th class="sn">S/N</th><th>Agent ID</th><th>Who</th><th></th></tr></thead><tbody>'
            + (S.csAgents.agents||[]).map(function(a, i){
                return '<tr class="clickrow" data-agent="'+esc(a.user_id)+'"><td class="sn">'+(i+1)+'</td>'
                  + '<td><b>'+esc(a.user_id)+'</b></td><td>'+esc(a.names||'—')+'</td>'
                  + '<td class="r"><button class="btn sm ghost" data-agent="'+esc(a.user_id)+'">Badili / Edit</button></td></tr>';
              }).join('') + '</tbody></table></div></div>'
          : '')
      /* DOWNLOAD, EDIT, UPLOAD. Forty rows of twenty columns is not something anybody should
         retype, and the file that comes out is in exactly the shape the importer reads -- so
         it goes straight back in through Upload Reports > Teams after a few cells change. */
      + (S.me.can.admin ? bar('<button class="btn sm" id="newTeam">+ Timu mpya / New team</button>'
          + '<button class="btn sm ghost" id="teamsDl" style="margin-left:8px">\u2b07 Pakua orodha / Download leaders sheet</button>'
          + '<a class="btn sm ghost" href="/upload?admin=1" style="margin-left:8px">\u2b06 Pakia iliyohaririwa / Upload the edited one</a>'
          + '<span style="font-size:12px;color:var(--mut);margin-left:8px">Bofya mstari kubadili wasimamizi. / Tap a row to edit its supervisors.</span>') : '');
    S.rows = d.rows;
    S.cols = [col('branch','Branch'), col('region','Region'), col('zone','Zone'), col('team','Team'),
      // The code field officers sign in with. Shown in clear on purpose: the PMO reads it out
      // over the phone, and changes it the moment it leaks.
      {key:'team_code', label:'Msimbo / Code', cls:function(r){ return r.team_code?'':'bad'; },
       get:function(r){ return r.team_code || 'HAKUNA / NONE'; }},
      roleCol('opm', 'opm_no', 'OPM'), roleCol('recovery', 'recovery_no', 'Recovery'),
      roleCol('gmo', 'gmo_no', 'GMO'), roleCol('manager', 'manager_no', 'Manager'),
      roleCol('credit', 'credit_no', 'Credit'), roleCol('expected', 'expected_no', 'Early col'),
      roleCol('bike', 'bike_no', 'Bike'), roleCol('legal', 'legal_no', 'Legal'),
      roleCol('collection', 'collection_no', 'Collection')];
    ONROW = S.me.can.admin ? function(r){ teamForm(r); } : null;
  });
};

function agentForm(x){
  var isNew = !x;
  drawer('<h3>'+(isNew?'Call agent mpya / New agent':esc(x.user_id))+'</h3>'
    + '<div class="sub">Agent ID lazima ilingane na CREATED BY kwenye ripoti ya maombi. / The id must match CREATED BY on the application report.</div>'
    + '<div class="fld"><label>Agent ID</label><input id="agId" value="'+esc(x?x.user_id:'')+'"'+(isNew?'':' readonly')+'></div>'
    + '<div class="fld"><label>Majina / Who (comma-separated)</label><input id="agNames" value="'+esc(x&&x.names?x.names:'')+'"></div>'
    + '<button class="btn w" id="agSave">Hifadhi / Save</button>'
    + (isNew ? '' : '<button class="btn ghost w" style="margin-top:8px;color:var(--bad);border-color:var(--badline)" id="agDel">Ondoa / Remove</button>'));
  $('#agSave').onclick = function(){
    srv('saveCallAgent', { userId: $('#agId').value.trim(), names: $('#agNames').value.trim() })
      .then(function(){ toast('Imehifadhiwa. / Saved.'); closeDrawer(); render(); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
  if (!isNew) $('#agDel').onclick = function(){
    if (!confirm('Ondoa "'+x.user_id+'"? / Remove this agent from the roster?')) return;
    srv('saveCallAgent', { userId: x.user_id, remove: true })
      .then(function(){ toast('Imeondolewa. / Removed.'); closeDrawer(); render(); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}

/* ONE PERSON, ALL THEIR TEAMS, ONE SAVE.
 *
 *  The list of ticks IS the answer -- a team left unticked is taken off them. That is the half
 *  that made this worth building: a reassignment done ten rows at a time and abandoned half way
 *  leaves a team pointing at somebody who has left, and nothing on any screen says so.
 *
 *  The role decides where the save goes. The seven supervisory roles live as a column on the
 *  teams table; a COLLECTION or LEGAL officer's teams are a list on their access code instead.
 *  Nobody using this screen has to know that -- the server writes to whichever place the role
 *  actually lives in. */
function staffForm(x){
  var meta = S.staff || { roles: [], allTeams: [] };
  var isNew = !x;
  var have = (x && x.teams) || [];
  var roles = meta.roles || [];
  drawer('<h3>'+(isNew ? 'Mfanyakazi mpya / New staff member' : esc(x.name))+'</h3>'
    + '<div class="sub">Timu ulizochagua ndio anazokuwa nazo. Usiyoichagua inaondolewa.'
    + ' / The teams you tick are the ones they hold. Anything unticked is taken off them.</div>'
    + '<div class="fld"><label>Jina / Name</label><input id="sfName" value="'+esc(x?x.name:'')+'"></div>'
    + '<div class="fld"><label>Wadhifa / Role</label><select id="sfRole">'
    + roles.map(function(r){
        return '<option value="'+esc(r.key)+'"'+((x && x.role===r.key)?' selected':'')+'>'+esc(r.label)+'</option>';
      }).join('') + '</select></div>'
    /* A PORTFOLIO ROLE (collection, legal) IS an access code with that role -- their teams live
       there, not on this table. Saying so here means the refusal from the server is never the
       first time anybody hears it. Which roles those are, and what to call them, come from the
       server's own roles list (source:'access_code'), never hardcoded here -- a second portfolio
       role added later needs no matching edit on this screen. */
    + '<div class="note" id="sfNote" style="display:none"></div>'
    + '<div class="fld"><label>Timu / Teams <span id="sfCount" class="sub"></span></label>'
    + '<div style="margin:4px 0 8px"><button class="btn sm ghost" type="button" id="sfAll">Chagua zote / All</button> '
    + '<button class="btn sm ghost" type="button" id="sfNone">Ondoa zote / None</button></div>'
    + '<div class="checks" style="max-height:46vh;overflow:auto">'
    + (meta.allTeams||[]).map(function(t){
        return '<label><input type="checkbox" class="sfTeam" value="'+esc(t)+'"'
          + (have.indexOf(t)>=0?' checked':'')+'> '+esc(t)+'</label>'; }).join('')
    + '</div></div>'
    + '<button class="btn w" id="sfSave">Hifadhi / Save</button>');

  var boxes = function(){ return document.querySelectorAll('.sfTeam'); };
  var recount = function(){
    var n = 0;
    Array.prototype.forEach.call(boxes(), function(c){ if (c.checked) n++; });
    $('#sfCount').textContent = '(' + n + ')';
    var cur = roles.filter(function(r){ return r.key === $('#sfRole').value; })[0];
    var portfolio = !!(cur && cur.source === 'access_code');
    $('#sfNote').style.display = portfolio ? '' : 'none';
    if (portfolio) $('#sfNote').innerHTML = 'Afisa wa aina hii lazima awe na msimbo wa kuingia wenye wadhifa "'
      + esc(cur.label) + '". / A ' + esc(cur.label) + ' officer must already have an access code with'
      + ' that role — create it under Settings first, then set their teams here.';
  };
  Array.prototype.forEach.call(boxes(), function(c){ c.onchange = recount; });
  $('#sfRole').onchange = recount;
  $('#sfAll').onclick = function(){ Array.prototype.forEach.call(boxes(), function(c){ c.checked = true; }); recount(); };
  $('#sfNone').onclick = function(){ Array.prototype.forEach.call(boxes(), function(c){ c.checked = false; }); recount(); };
  recount();

  $('#sfSave').onclick = function(){
    var teams = Array.prototype.filter.call(boxes(), function(c){ return c.checked; })
      .map(function(c){ return c.value; });
    var name = $('#sfName').value.trim();
    if (!name) { toast('Jina linahitajika. / A name is required.', true); return; }
    srv('saveStaffTeams', { role: $('#sfRole').value, name: name, code: (x && x.code) || '', teams: teams })
      .then(function(r){
        /* SAY WHAT ACTUALLY HAPPENED. "Saved" after a save that changed nothing, or that quietly
           took somebody off four teams, is the same word for two very different events. */
        toast('Imehifadhiwa / Saved — ' + teams.length + ' timu'
          + (r && r.cleared ? ', ' + r.cleared + ' imeondolewa / removed' : ''));
        closeDrawer(); render();
      })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}

/* Which tick words belong to HOPE Loan -- read off NAV_LOAN itself, so the list the admin
   ticks and the gate each screen checks are one definition. */
function loanTabSet_(){
  var out = {};
  NAV_LOAN.forEach(function(n){
    (Array.isArray(n.tab) ? n.tab : (n.tab ? [n.tab] : [])).forEach(function(t){ out[t] = true; });
  });
  return out;
}

function isLoanTab_(t){ return !!loanTabSet_()[t]; }
/* Which tick words belong to HOPE Management -- read off NAV's own div flags (isMgmtId_ in
   the core), so the third list here and the third division of the sidebar are one definition. */
function isMgmtTab_(t){ return !isLoanTab_(t) && isMgmtId_(t); }

/* The screens a tick word opens, named beside the word, so "gmo" reads as "GMO Review" and
   not as whatever the admin assumed. */
function tabScreens_(t){
  var names = [];
  if (isLoanTab_(t)) {
    NAV_LOAN.forEach(function(n){
      var need = Array.isArray(n.tab) ? n.tab : (n.tab ? [n.tab] : []);
      if (need.indexOf(t) >= 0 && !n.hidden) names.push(n.label);
    });
  } else {
    NAV.forEach(function(n){ if ((n.tab ? n.tab === t : n.id === t) && !n.hidden) names.push(n.label); });
    if (t === 'upload') names.push('Upload Reports');
  }
  return names;
}

function tabTick_(t, have){
  var screens = tabScreens_(t);
  return '<label><input type="checkbox" class="rTab" value="'+esc(t)+'"'
    + (have.indexOf(t)>=0?' checked':'')+'> '+esc(t)
    + (screens.length ? ' <span style="color:var(--mut);font-size:11px">— '+esc(screens.join(' · '))+'</span>' : '')
    + '</label>';
}

function roleForm(x){
  var isNew = !x;
  var all = (S.roleMeta && S.roleMeta.allTabs) || [];
  var have = (x && x.tabs) || [];
  /* WHAT THIS ROLE APPROVES (RUN-ME-045), asked from the approver's side -- "granting someone
     approval tab I choose which roles they can approve ... Simplest solving. If I choose same
     role then I select user". The list shows under the advappr tick and follows it live; a
     role ticked here gets THIS role as its approver (one approver per role, so one already
     pointing elsewhere says so and moves). The same role ticked means each of its codes then
     names a supervisor on the code form. */
  var roleRows = (S.roleMeta && S.roleMeta.roles) || [];
  var me = x ? String(x.role || '').toUpperCase() : '';
  /* ONE SUPERVISOR FOR THE WHOLE ROLE (RUN-ME-046) -- "choose role user as supervisor of the
     whole dept not assigning every user to the same person": one code, by name and role; a
     read-only admin's list carries no codes, so the picker shows disabled. */
  var codeRows = (S.acRows || []).slice().sort(function(a, b){ return (String(a.role||'') + ' ' + String(a.name||'')).localeCompare(String(b.role||'') + ' ' + String(b.name||'')); });
  var codesMasked = codeRows.some(function(c){ return c.code === '••••'; });
  var supCode = String((x && x.approver_code) || '');
  /* THE APPROVER OF THIS ROLE, AS A ROLE -- "At field officer role ... I expected to choose
     gmo role not a single person user ... Not just field officer, and the rest": the same
     fact as the list above read from the requester's side (FIELD OFFICER → GMO), on every
     role's form. This role's own line is here, not in the list above. */
  var curAppr = String((x && x.approver_role) || '').toUpperCase();
  var roleKnown = roleRows.some(function(r){ return String(r.role||'').toUpperCase() === curAppr; });
  drawer('<h3>'+(isNew?'Wadhifa mpya / New role':esc(x.role))+'</h3>'
    + '<div class="sub">Msimbo wenye orodha tupu ya tabs hurithi hii. / A code with a blank tab list inherits this one.</div>'
    + '<div class="fld"><label>Wadhifa / Role</label><input id="rName" value="'+esc(x?x.role:'')+'"'+(isNew?'':' readonly')+'></div>'
    /* TWO LISTS, EACH UNDER ITS OWN NAME. One flat run of words put `gmo`, `manager`, `team`,
       `finance`, `gm` and `customer_service` beside `dashboard` and `followup` with nothing
       to say the first six open HOPE LOAN -- so a role called GMO got `gmo` ticked, a manager
       got `manager`, and each found a second system in their sidebar. Every box now says
       which system it opens and which screens. */
    /* THREE LISTS NOW, one per division of the sidebar: HOPE PMO's working screens, HOPE
       Management's company screens, HOPE Loan's origination screens. */
    + '<div class="fld"><label>Tabs — HOPE PMO</label><div class="checks">'
    + all.filter(function(t){ return !isLoanTab_(t) && !isMgmtTab_(t); }).map(function(t){ return tabTick_(t, have); }).join('')
    + '</div></div>'
    + '<div class="fld"><label>Tabs — HOPE Management</label>'
    + '<div class="fldnote">Watu, fedha, simu, rekodi na Settings — si ufuatiliaji wa portfolio. / People, money, phones, records and Settings — not portfolio follow-up.</div>'
    + '<div class="checks">'
    + all.filter(isMgmtTab_).map(function(t){ return tabTick_(t, have); }).join('')
    + '</div></div>'
    /* "if I choose approver then approver gets the approval tab automatic" -- so the list is
       always open, and ticking a role in it ticks advappr above by itself (the server adds the
       tab too, whatever the box says). */
    + '<div class="fld" id="rApprovesWrap">'
      + '<label>Huidhinisha maombi ya advance ya wadhifa / Approves advance requests from roles</label><div class="checks">'
      + roleRows.filter(function(r){ return String(r.role||'').toUpperCase() !== me; }).map(function(r){
          var ap = String(r.approver_role||'').toUpperCase();
          var mine = !!me && ap === me;
          return '<label><input type="checkbox" class="rApp" value="'+esc(r.role)+'"'+(mine ? ' checked' : '')+'> '+esc(r.role)
            + (ap && !mine ? ' <span style="color:var(--mut);font-size:11px">(sasa / now: '+esc(r.approver_role)+')</span>' : '')
            + '</label>'; }).join('')
      + '</div><div class="fldnote">Ukitiki wadhifa hapa, wadhifa huu unapata tab ya <b>advappr</b> wenyewe, na maombi ya advance ya wadhifa huo huja kwenye dawati lake, ndani ya zone zake. Wadhifa una mwidhinishaji mmoja tu: ukiutiki hapa, unaondoka kwa yule wa awali.'
        + ' / Tick a role here and this role gets the <b>advappr</b> tab by itself; that role\'s advance requests then come to this desk, within its zones. A role has ONE approver: ticking it here takes it off the one it had.'
        + (S.routingOn === false ? '<br>⚠️ ' + esc(S.routingNote || '') : '') + '</div></div>'
    + '<div class="fld"><label>Mwidhinishaji wa wadhifa huu — wadhifa / Approver of this role — a role</label>'
      + '<select id="rApproverRole"><option value="">— hakuna / none —</option>'
      + roleRows.map(function(r){ var rr = String(r.role||'').toUpperCase();
          return '<option value="'+esc(r.role)+'"'+(rr === curAppr ? ' selected' : '')+'>'+esc(r.role)
            + (rr === me ? ' — wadhifa uleule: msimamizi kwa msimbo / same role: a supervisor per code' : '')+'</option>'; }).join('')
      + (curAppr && !roleKnown ? '<option value="'+esc(curAppr)+'" selected>'+esc(curAppr)+'</option>' : '')
      + '</select>'
      + '<div class="fldnote">Kila mwenye wadhifa huo huona na kuamua maombi ya advance ya wadhifa huu, ndani ya zone zake — FIELD OFFICER → GMO, MANAGER → GMO, PMO COLLECTION → PMO MANAGER — na anapata tab ya <b>advappr</b> wenyewe. Ukichagua wadhifa huu wenyewe (CREDIT → CREDIT), taja msimamizi mmoja hapa chini, au kwenye kila msimbo — tab ya <b>advappr</b> inakwenda kwa mtu huyo tu, si kwa wenye wadhifa wote. Mtu mmoja (hapa chini, au kwenye msimbo) anashinda wadhifa.'
        + ' / Every holder of that role sees and decides this role\'s advance requests, within their zones — FIELD OFFICER → GMO, MANAGER → GMO, PMO COLLECTION → PMO MANAGER — and gets the <b>advappr</b> tab by itself. Pick this role itself (credit → credit) and name one supervisor below, or on each code — the <b>advappr</b> tab goes to that person only, not to every holder of the role. A named person (below, or on a code) wins over the role.</div></div>'
    + '<div class="fld"><label>Msimamizi wa wadhifa huu — mtu mmoja / One supervisor for this whole role</label>'
      + '<select id="rSupCode"'+(codesMasked ? ' disabled' : '')+'><option value="">— hakuna / none —</option>'
      + codeRows.map(function(c){ return '<option value="'+esc(c.code)+'"'+(c.code === supCode ? ' selected' : '')+'>'+esc(c.name||'')+' · '+esc(c.role||'')+'</option>'; }).join('')
      + '</select>'
      + '<div class="fldnote">Maombi yote ya advance ya wadhifa huu huenda kwa mtu huyu, zone yoyote, bila kumchagua kwenye kila msimbo. Msimamizi aliyechaguliwa kwenye msimbo wenyewe anashinda.'
        + ' / Every advance request of this role goes to this person, whatever the zone, with nothing to set on each code. A supervisor named on a code itself wins over this.</div></div>'
    + '<div class="fld"><label>Tabs — HOPE Loan</label>'
    + '<div class="fldnote">Hizi hufungua HOPE LOAN, si skrini za HOPE PMO. / These open HOPE LOAN screens, not HOPE PMO ones.</div>'
    + '<div class="checks">'
    + all.filter(isLoanTab_).map(function(t){ return tabTick_(t, have); }).join('')
    + '</div></div>'
    + '<button class="btn w" id="rSave">Hifadhi / Save</button>'
    + (isNew ? '' : '<button class="btn ghost w" style="margin-top:8px;color:var(--bad);border-color:var(--badline)" id="rDel">Futa / Delete role</button>'));
  // Ticking a role to approve ticks the approval tab by itself: one decision, not two.
  var apprTick = document.querySelector('.rTab[value="advappr"]');
  Array.prototype.forEach.call(document.querySelectorAll('.rApp'), function(c){
    c.onchange = function(){ if (c.checked && apprTick) apprTick.checked = true; };
  });
  $('#rSave').onclick = function(){
    var tabs = Array.prototype.filter.call(document.querySelectorAll('.rTab'), function(c){ return c.checked; })
      .map(function(c){ return c.value; }).join(',');
    var approves = Array.prototype.filter.call(document.querySelectorAll('.rApp'), function(c){ return c.checked; })
      .map(function(c){ return c.value; }).join(',');
    var supSel = document.getElementById('rSupCode');
    srv('saveRole', { role: $('#rName').value.trim(), tabs: tabs, approves: approves,
      // This role's own approver, as the select shows it: blank clears it.
      approverRole: $('#rApproverRole').value,
      // A disabled picker (codes masked) says nothing, and nothing said is nothing changed.
      approverCode: supSel && !supSel.disabled ? supSel.value : undefined })
      // The tabs save on any database; the approvals only with RUN-ME-045, and the answer says.
      .then(function(r){ toast(r && r.note ? '⚠️ Tabs zimehifadhiwa; uidhinishaji haujahifadhiwa. / Tabs saved; the approvals were not: ' + r.note : 'Imehifadhiwa. / Saved.', !!(r && r.note)); closeDrawer(); render(); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
  if (!isNew) $('#rDel').onclick = function(){
    if (!confirm('Futa wadhifa "'+x.role+'"? / Delete this role?')) return;
    srv('deleteRole', { role: x.role })
      .then(function(){ toast('Imefutwa. / Deleted.'); closeDrawer(); render(); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}

function teamForm(x){
  var isNew = !x;
  drawer('<h3>'+(isNew?'Timu mpya / New team':esc(x.team))+'</h3>'
    + '<div class="sub">Wasimamizi hapa ndio wanaotumika kwenye ugawaji na ripoti zote. / These names drive assignment and every leader report.</div>'
    + '<div class="fld"><label>Timu / Team</label><input id="tTeam" value="'+esc(x?x.team:'')+'"'+(isNew?'':' readonly')+'></div>'
    + '<div class="fld"><label>Msimbo wa timu / Team code</label>'
      + '<div style="display:flex;gap:8px"><input id="tCode" style="flex:1" value="'+esc(x&&x.team_code?x.team_code:'')+'">'
      + '<button class="btn sm ghost" id="tGen" style="width:auto">Tengeneza / Generate</button></div>'
      + '<div class="fldnote">Maafisa wa timu hii wanaingia nao. Ukiubadilisha, simu zao zote zinakatwa. / Field officers on this team sign in with this. Changing it releases every one of their handsets.</div></div>'
    + TEAM_ROLES.map(function(c){
        // "my final thought of the teams and staff table" renamed EXPECTED to EARLY COL --
        // the column is still `expected`, only the label people see changes.
        var label = c === 'expected' ? 'EARLY COL' : c.toUpperCase();
        return '<div class="fld"><label>'+label+'</label><input id="t_'+c+'" value="'+esc(x&&x[c]?x[c]:'')+'"></div>';
      }).join('')
    + TEAM_EXTRA.map(function(e){
        return '<div class="fld"><label>'+esc(e[1])+'</label><input id="t_'+e[0]+'" value="'+esc(x&&x[e[0]]?x[e[0]]:'')+'"></div>';
      }).join('')
    + '<button class="btn w" id="tSave">Hifadhi / Save</button>'
    /* MERGE IS A FIRST-CLASS CHOICE, NOT A CONSOLATION AFTER A FAILED DELETE.

         "Am not seeing the merge team option (provide opt to the new merged team name)"
         "and of course its the better option"

       It WAS only offered when a delete was refused, which meant it existed exactly where
       nobody would look for it -- behind an error. And it is the better option for the case
       that actually happens: a misspelling holding real work. So it sits above Delete, with
       every other team to choose from by name, and it says plainly what will happen. */
    + (isNew ? '' :
        '<div class="fld" style="margin-top:14px"><label>Unganisha na timu nyingine / Merge into another team</label>'
        + '<select id="tMergeTo"><option value="">— chagua timu sahihi / choose the correct team —</option>'
        /* EXACT comparison, not upper-cased. `teams.team` is the primary key and Postgres
           compares it exactly, so TUNDURU and Tunduru are two separate rows -- which is how a
           duplicate comes to exist at all. Excluding case-insensitively hid the very team
           somebody was trying to merge into, which was reported as "Tunduru is not appearing".
           Only the row you are standing on is left out. */
        + (S.teamNames || []).filter(function(n){ return String(n) !== String(x.team); })
            .map(function(n){ return '<option>' + esc(n) + '</option>'; }).join('')
        + '</select>'
        + '<div class="fldnote">Kumbukumbu zote za <b>' + esc(x.team) + '</b> zitahamia kwenye timu'
        + ' uliyochagua, kisha jina hili litaondolewa. Hakuna kinachofutwa isipokuwa jina.'
        + ' / Every record filed under <b>' + esc(x.team) + '</b> moves to the team you pick —'
        + ' snapshots, decks, follow-ups, loans, payments, complaints, call logs, handsets and'
        + ' the team lists on access codes. Then this name is removed.'
        + ' <b>Nothing is deleted except the name.</b></div></div>'
        + '<button class="btn ghost w" id="tMerge">\u21c4 Unganisha / Merge this team</button>')
    + (isNew ? '' : '<button class="btn ghost w" style="margin-top:8px;color:var(--bad);border-color:var(--badline)" id="tDel">Futa timu / Delete team</button>'));
  // Generate fills the box so the code is visible BEFORE saving -- an admin has to be able to
  // write it down or read it out, and a code that only appears after the drawer closes gets
  // lost. Nothing is committed until Save.
  document.getElementById('tGen').onclick = function(){
    var A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ', out = '';
    var b = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(b);
    for (var i = 0; i < 6; i++) out += A[b[i] % A.length];
    document.getElementById('tCode').value = out;
  };
  document.getElementById('tSave').onclick = function(){
    var p = { team: document.getElementById('tTeam').value.trim(),
              teamCode: document.getElementById('tCode').value.trim() };
    TEAM_ROLES.forEach(function(c){ p[c] = document.getElementById('t_'+c).value.trim(); });
    TEAM_EXTRA.forEach(function(e){ p[e[0]] = document.getElementById('t_'+e[0]).value.trim(); });
    srv('saveTeam', p).then(function(r){
      toast(r.rotated
        ? ('Msimbo umebadilishwa — simu ' + money(r.released) + ' zimekatwa. / Code changed, ' + money(r.released) + ' handset(s) released.')
        : 'Imehifadhiwa. / Saved.');
      closeDrawer(); render();
    }).catch(function(e){ toast(String(e.message||e), true); });
  };
  /* A MISSPELLED TEAM HOLDS REAL WORK.

       "Team TUNDURU should be deleted because the correct one is Tunduru. it fails saying it
        has expected snapshots"

     Refusing the delete is right -- removing a team that still holds records would orphan
     them. But the admin's intention was never "throw the snapshots away"; it was "these belong
     to the other spelling". So when the server refuses, the screen offers the merge instead of
     leaving them at a dead end with an error they cannot act on. */
  var mrg = document.getElementById('tMerge');
  if (mrg) mrg.onclick = function(){
    var sel = document.getElementById('tMergeTo');
    var into = sel ? sel.value.trim() : '';
    if (!into){ toast('Chagua timu sahihi kwanza. / Choose the correct team first.', true); return; }
    if (!confirm('Hamisha kumbukumbu ZOTE za ' + x.team + ' kwenda ' + into + ', kisha uondoe '
        + x.team + '?\n\nMove EVERY record from ' + x.team + ' to ' + into
        + ', then remove ' + x.team + '?\n\nNothing is deleted except the name. This cannot be undone.')) return;
    srv('deleteTeam', { team:x.team, moveTo:into }).then(function(r){
      var what = Object.keys(r.moved||{}).map(function(k){ return money(r.moved[k])+' '+k; });
      toast('Imeunganishwa na ' + r.mergedInto + '. / Merged into ' + r.mergedInto
        + (what.length ? ' — ' + what.join(', ') + '.' : ' — nothing needed moving.'));
      closeDrawer(); render();
    }).catch(function(e){ toast(String(e.message||e), true); });
  };
  var del = document.getElementById('tDel');
  if (del) del.onclick = function(){
    if (!confirm('Futa timu '+x.team+'?\n\nDelete this team?')) return;
    var done = function(r){
      toast(r && r.mergedInto
        ? ('Imehamishwa kwenda ' + r.mergedInto + '. / Merged into ' + r.mergedInto + ' — '
           + Object.keys(r.moved||{}).map(function(k){ return money(r.moved[k])+' '+k; }).join(', ')
           + (Object.keys(r.moved||{}).length ? '' : 'nothing to move') + '.')
        : (r && r.released
            ? ('Imefutwa \u2014 simu ' + r.released + ' zimekatwa. / Deleted, ' + r.released + ' handset(s) released.')
            : 'Imefutwa. / Deleted.'));
      closeDrawer(); render();
    };
    srv('deleteTeam', { team:x.team }).then(done).catch(function(e){
      var msg = String(e.message||e);
      // Only the "still holds records" refusal has a merge as its answer.
      if (!/still holds|bado ina kumbukumbu/i.test(msg)) { toast(msg, true); return; }
      var into = prompt(msg + '\n\n— — —\nAndika jina la timu sahihi ya kuihamishia,'
        + ' au bonyeza Cancel.\nType the CORRECT team to merge ' + x.team
        + ' into, or press Cancel:', '');
      if (!into || !into.trim()) return;
      if (!confirm('Hamisha kumbukumbu zote za ' + x.team + ' kwenda ' + into.trim().toUpperCase()
          + ', kisha futa ' + x.team + '?\n\nMove EVERY record from ' + x.team + ' to '
          + into.trim().toUpperCase() + ', then remove ' + x.team + '? Nothing is deleted except the name.')) return;
      srv('deleteTeam', { team:x.team, moveTo:into.trim() }).then(done)
        .catch(function(e2){ toast(String(e2.message||e2), true); });
    });
  };
}

/* EVERY report that grows, not just the big five. This list used to stop at Call Logs, which
   left an admin able to clean five things and stuck with the rest.
   `kept` marks the four registers people ALSO type into from inside the app. Cleaning a date
   there takes only what arrived in an upload -- a complaint logged at the desk or an officer's
   comment is somebody's work, not a report, and must not vanish in a tidy-up. */
var CLEAN_TYPES = [
  { key:'expected',       label:'Expected Repayment' },
  { key:'defaulters',     label:'Defaulters (initial + current)' },
  { key:'received',       label:'Received Payments' },
  { key:'abnormal',       label:'Abnormal Payments' },
  { key:'calls',          label:'Call Logs' },
  { key:'loans',          label:'Loan Pipeline (all stages)' },
  { key:'comments',       label:'Comments Log', kept:1 },
  { key:'complaints',     label:'Complaints', kept:1 },
  { key:'restructures',   label:'Loan Restructuring', kept:1 },
  { key:'demand_notices', label:'Demand Notices', kept:1 },
  /* The one register that grew with no way to clean it: a customer who leaves the deck keeps
     their row on purpose, so nothing ever removed one. It is last in the list and marked,
     because unlike every other line here it takes comment history with it. */
  { key:'followup',       label:'Follow-up list (customers + their comments)', cascade:1 },
];

/* The storage half of the Settings screen, drawn twice: once as a placeholder so the tab can
   PAINT, and again when the counting comes back. It was part of the blocking Promise.all, and
   on the night the database was struggling that meant the whole Settings tab sat on a spinner
   waiting for the slowest, least urgent number on the page. The switch an admin comes here for
   in an emergency -- open/close the system -- must never queue behind a row count. */
function sgKpis_(sg){
  return kpi('Stored rows', sg ? money(sg.totalRows) : '…',
      sg ? ((sg.oldest||'—')+' → '+(sg.newest||'—')) : 'inahesabu / counting…', null, 'sgRowsK')
    + kpi('Database used', sg ? mb(sg.bytes) : '…',
      sg ? (mb(sg.perMonth)+' / month at this rate') : 'inahesabu / counting…', null, 'sgBytesK');
}

function sgPlanNote_(sg){
  if (!sg) return 'Nafasi inahesabiwa nyuma ya pazia — ukurasa huu uko tayari.'
    + ' / Storage is being counted in the background — the rest of this page is ready now.';
  return 'Supabase Free ni <b>500 MB</b>, Pro ni <b>8 GB</b>.'
    + ' / Free tier holds 500 MB, Pro holds 8 GB. Kwa kasi ya sasa (' + mb(sg.perDay) + ' kwa siku),'
    + ' 8 GB inatosha takriban <b>' + (sg.perMonth>0 ? Math.floor(8*1024*1024*1024/sg.perMonth) : '∞')
    + ' miezi</b> bila kusafisha. / at the current rate, 8 GB lasts about that many months with no cleanup.'
    + ' Ukisafisha tarehe za zamani hapa chini, haitajaa kamwe. / Clean old dates below and it never fills.'
    /* The server says when the day-by-day board is partial (the counting function is not in
       the database yet) -- said here, or the board below quietly shows fewer dates than the
       totals imply and somebody "cleans" guessing at what is there. */
    + (sg.undated && sg.undated.length
        ? '<br><b>Angalizo / Note:</b> mgawanyo kwa tarehe haupo kwa: ' + esc(sg.undated.join(', '))
          + '. Endesha db/RUN-ME-012 (DOSE 1) kuurudisha. / The day-by-day split is missing for those'
          + ' reports until db/RUN-ME-012 DOSE 1 is run — totals above are still exact.'
        : '');
}

function sgDatesBoard_(sg){
  var dates = sg ? sg.dates : [];
  return board('sgDates','Kilichohifadhiwa kwa tarehe / What is stored, by date',
      sg ? 'row counts per report type — delete a date and that day’s history goes with it'
         : 'inahesabu nyuma ya pazia / still counting in the background',
      dates, [col('date','Date','date')].concat(CLEAN_TYPES.map(function(t){
        return col(t.key, t.label, 'num'); })).concat([col('total','Total','num')]),
      sumRow(dates, CLEAN_TYPES.map(function(t){ return t.key; }).concat(['total'])));
}

function sgFill_(sg){
  // The person may have moved on while this counted; a patch must never paint another tab.
  if (S.view !== 'settings' || !$('#sgRowsK')) return;
  $('#sgRowsK').innerHTML = money(sg.totalRows);
  var s1 = $('#sgRowsKS'); if (s1) s1.textContent = (sg.oldest||'—')+' → '+(sg.newest||'—');
  $('#sgBytesK').innerHTML = mb(sg.bytes);
  var s2 = $('#sgBytesKS'); if (s2) s2.textContent = mb(sg.perMonth)+' / month at this rate';
  var pn = $('#sgPlanNote'); if (pn) pn.innerHTML = sgPlanNote_(sg);
  var dt = $('#clDate'); if (dt && !dt.value) dt.value = sg.oldest || '';
  var b = $('#sgDates');
  if (b){
    var tmp = document.createElement('div');
    tmp.innerHTML = sgDatesBoard_(sg);
    b.parentNode.replaceChild(tmp.firstChild, b);
  }
}

VIEWS.settings = function(){
  return Promise.all([srv('settings'), srv('accessCodes'), srv('officerAccounts'),
      srv('systemOpenGet'), srvTeams_()]).then(function(r){
    var st=r[0], ac=r[1], cu=r[2], so=r[3], tm=r[4];
    var sg = S.storage || null;
    if (!sg){
      /* Fired, not awaited: the tab paints now and this fills the storage panel when it
         lands. A failure writes itself into the note instead of taking the tab down --
         storage arithmetic is the one part of Settings worth having late or not at all. */
      srv('storageUsage').then(function(d){ S.storage = d; sgFill_(d); })
        .catch(function(e){
          var pn = $('#sgPlanNote');
          if (pn && S.view === 'settings') pn.innerHTML =
            'Hesabu ya nafasi imeshindikana kwa sasa / storage count failed for now — '
            + esc(String((e && e.message) || e));
        });
    }
    // The HOPE LOAN visibility switch, read off the settings rows already in hand. Unset
    // means SHOWN -- the switch is newer than every deployment that lacks the row.
    var hlOn = !/^(no|off|0|false|hapana)$/i.test(String(settingVal(st.rows, 'HOPELOAN_VISIBLE', 'YES') || '').trim());
    S.officers = cu;
    S.teamCount = (tm.rows||[]).length;
    S.roles = ac.roles || [];
    // The roles card and its drawer live on THIS screen now, and both read S.roleMeta.
    S.roleMeta = { roles: ac.roles || [], allTabs: ac.allTabs || [] };
    // The code form's supervisor picker reads the codes list, and both forms say when the
    // routing columns (RUN-ME-045) are not in yet.
    S.acRows = ac.rows || []; S.routingOn = ac.routingOn; S.routingNote = ac.routingNote || '';
    // Feeds codeForm's tab checkboxes -- HOPE PMO and HOPE Loan together, same list roleForm
    // already draws from, so "Extra tabs" stops being a box where a typo grants nothing.
    S.allTabs = ac.allTabs || [];
    // Two registers live here because they answer the same question -- who may use this
    // system: an access code is a PORTAL login, a call user is a PHONE registration.
    HEAD = '<div class="kpis">' + kpi('Settings', money(st.rows.length))
        + kpi('Access codes', money(ac.count)) + kpi('Phone users', money(cu.count))
        + sgKpis_(sg)
        + '</div>'
        + '<div class="note" id="sgPlanNote">' + sgPlanNote_(sg) + '</div>'
      /* The master open/close switch, the officer-locations button and the HOPE LOAN
         presentation switch used to open this page; by the owner's choice they now sit lower
         down, between Field officer accounts and the Announcement -- see there. */
      /* Uploads append rather than overwrite -- that is what makes trends and "recovery since
         Monday" possible -- so the tables only grow. Nothing breaks when they do (Postgres has
         no cell ceiling), but the plan's disk is finite, so this is where old dates get let go. */
      + '<div class="card"><div class="card-h">Kusafisha ripoti za zamani / Clean old reports'
        + '<span class="sub">chagua tarehe na aina za ripoti / pick a date and the report types</span></div>'
        + '<div class="cleanbox">'
        + '<div class="fld"><label>Tarehe / Date</label><input type="date" id="clDate" value="'+esc((sg && sg.oldest)||'')+'"></div>'
        + '<div class="fld"><label>Aina za ripoti / Report types</label><div class="checks">'
        + CLEAN_TYPES.map(function(t){
            return '<label><input type="checkbox" class="clType" value="'+t.key+'"> '+esc(t.label)
              // Say it on the box itself, not only in the result. Somebody ticking "Complaints"
              // deserves to know before they press Clean that desk-logged ones are staying.
              + (t.kept ? ' <span style="color:var(--mut);font-size:11px">(zilizopakiwa tu / uploaded only)</span>' : '')
              + (t.cascade ? ' <span style="color:var(--bad);font-size:11px">(huondoa na maoni yao / removes their comments too)</span>' : '')
              + '</label>'; }).join('')
        + '<div style="margin-top:6px"><button type="button" class="btn sm ghost" id="clAll">Chagua zote / Select all</button>'
          + ' <button type="button" class="btn sm ghost" id="clNone">Ondoa zote / Clear</button></div>'
        + '</div></div>'
        + '<label class="chk"><input type="checkbox" id="clThrough"> Na zote za kabla yake / and everything on or before that date</label>'
        + '<div class="clact"><button class="btn sm ghost" id="clCheck">Angalia / Check first</button>'
        + ' <button class="btn sm danger" id="clRun">Futa / Clean</button></div>'
        + '<div id="clOut" class="note" style="display:none"></div>'
        + '</div></div>'
      + fold_('sgdates', 'Kilichohifadhiwa kwa tarehe / What is stored, by date',
              'bofya kufungua / tap to open', sgDatesBoard_(sg))


      /* THE FOLLOW-UP STATUS LIST. Editable, one per line. The BEHAVIOURS are not editable and
         the note says so: the built-in words are the ones other screens know by name -- the
         promise date feeds the Promise to Pay tab and now the bell, the replacement number
         feeds the phone index -- and a new word that silently acquired a promise date would
         start writing rows no report knows how to read. */
      + '<div class="card"><div class="card-h">Hali za ufuatiliaji / Follow-up statuses'
        + '<span class="sub">moja kwa kila mstari / one per line</span></div>'
        + '<div class="cleanbox">'
        + '<div class="note" style="display:block">Unaweza kuhariri au kuongeza. Mpya zote ni '
        + '<b>maoni tu</b> &mdash; hazina kalenda wala kisanduku cha namba mpya.'
        + '<br><i>Edit or add freely. Anything new is a <b>plain comment</b>: no calendar, no '
        + 'new-number box. Those belong to the built-in words below, which other screens know by '
        + 'name &mdash; remove one and its behaviour goes with it.</i></div>'
        + '<div class="fld"><label>Orodha / The list</label>'
          + '<textarea id="fuList" rows="12" style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:11px;font-family:inherit">'
          + esc((S.fuMeta && S.fuMeta.fuStatuses ? S.fuMeta.fuStatuses : FU_STATUSES).join('\n'))
          + '</textarea></div>'
        + '<div class="fldnote">Zenye kalenda / with a calendar: <b>'
          + esc(((S.fuMeta && S.fuMeta.fuNeedDate) || FU_NEED_DATE).join(', ') || '\u2014') + '</b>'
          + ' &middot; zenye namba mpya / with a new-number box: <b>'
          + esc(((S.fuMeta && S.fuMeta.fuNeedNumber) || FU_NEED_NUMBER).join(', ') || '\u2014') + '</b></div>'
        + '<div class="clact"><button class="btn sm" id="fuListSave">Hifadhi / Save</button></div>'
        + '<div id="fuListOut" class="note" style="display:none"></div>'
        + '</div></div>'

      /* TIPS TIMING. "Am not seeing were to set tips timelapse in settings" -- there was
         nowhere to see, because the two numbers the lightbulb runs on (how often a tip changes,
         how long each one stays up) were a hard-coded fallback nothing could ever override. Two
         plain settings now, read straight out of the same list this screen already has below --
         no extra call to find the current values. */
      + '<div class="card"><div class="card-h">Muda wa vidokezo / Tips timing'
        + '<span class="sub">kitufe cha 💡 juu ya skrini / the 💡 button at the top of the screen</span></div>'
        + '<div class="cleanbox">'
        + '<div class="fld"><label>Kila sekunde ngapi hubadilika / Rotates every (seconds)</label>'
          + '<input type="number" min="30" id="hintEvery" value="'+esc(settingVal(st.rows,'HINT_EVERY_SEC','240'))+'"></div>'
        + '<div class="fld"><label>Hubaki sekunde ngapi / Stays visible for (seconds)</label>'
          + '<input type="number" min="3" id="hintHold" value="'+esc(settingVal(st.rows,'HINT_HOLD_SEC','7'))+'"></div>'
        + '<div class="clact"><button class="btn sm" id="hintTimingSave">Hifadhi / Save</button></div>'
        + '<div id="hintTimingOut" class="note" style="display:none"></div>'
        + '</div></div>'

      /* THE SETTINGS THAT RUN THE BUSINESS -- see SETTINGS_GROUPS above. */
      + SETTINGS_GROUPS.map(function(g){ return settingsGroupCard_(g, st.rows); }).join('')

      /* YOUR OWN CODE. The access code IS the password here, and changing it used to mean
         editing your own row in a list of everybody else's -- a screen for administering other
         people, not for changing your own secret. */
      + '<div class="card"><div class="card-h">Badilisha msimbo wangu / Change my code'
        + '<span class="sub">' + esc(S.me && S.me.name ? S.me.name : '') + '</span></div>'
        + '<div class="cleanbox">'
        + '<div class="fld"><label>Msimbo wa sasa / Current code</label>'
          + '<input id="pwOld" data-secret data-upper autocomplete="off"></div>'
        + '<div class="fld"><label>Msimbo mpya / New code</label>'
          + '<input id="pwNew" data-secret data-upper autocomplete="off"></div>'
        + '<div class="fld"><label>Rudia mpya / Repeat new code</label>'
          + '<input id="pwNew2" data-secret data-upper autocomplete="off"></div>'
        + '<div class="fldnote">Herufi 6 au zaidi, herufi na namba pekee. Utahitaji kuingia upya. '
          + '/ Six characters or more, letters and numbers only. You will be signed out and back in.</div>'
        + '<div class="clact"><button class="btn sm" id="pwSave">Hifadhi / Save</button></div>'
        + '<div id="pwOut" class="note" style="display:none"></div>'
        + '</div></div>'

      /* WHO MAY SEE WHAT IS DECIDED ONCE, BY ROLE.
           "remove the tabs column from access codes, I need a new role assign table before
            access codes so it always list all existing roles and i click role - it opens all
            existing tabs and I choose what that role while access, so now we decide easy for
            all users"
         Every role in the system, every time -- click one and its tabs open as a tick list.
         A code no longer carries tabs of its own, so there is exactly one place a permission
         is decided and no code can quietly hold a set nobody remembers granting. */
      + '<div class="card" id="rolesCard"><div class="card-h">Nafasi na ruhusa / Roles &amp; access'
        + '<span class="sub">'
        + '<button class="btn sm ghost" id="resetRoles">Anza upya / Start empty</button>'
        + (ac.roleBackupAt ? ' <button class="btn sm ghost" id="undoRoles">Rudisha / Undo</button>' : '')
        /* "Clear all approval granted roles so that I start granting and choosing what they
           govern" -- the approval tab, the approvers and the supervisors, off every role and
           code but ADMIN, saved first so it can be put back. */
        + ' <button class="btn sm ghost" id="resetApprovals">Futa uidhinishaji / Clear approvals</button>'
        + (ac.approvalsBackupAt ? ' <button class="btn sm ghost" id="undoApprovals">Rudisha uidhinishaji / Undo approvals</button>' : '')
        + ' <button class="btn sm" id="newRole">+ Wadhifa mpya / New role</button></span></div>'
        + '<div class="note" style="margin:10px 14px">Bofya wadhifa kuchagua tabs zake. Kila msimbo wenye wadhifa huu hurithi orodha hii.'
        + ' / Tap a role to tick its tabs. Every access code with that role inherits this list.'
        /* "Start with empty accessible navs for all roles except all for ADMIN so that i go
           set well now : i fear running into errors" -- so the button says what it does, what
           it keeps, and that it can be taken back, before it is pressed. */
        + '<br><b>Anza upya</b> huondoa tabs zote kwa nafasi zote (ADMIN inabaki na zote) ili uanze kupanga upya &mdash; hali ya sasa inahifadhiwa na <b>Rudisha</b> inairejesha.'
        + ' / <b>Start empty</b> clears every role\'s tabs (ADMIN keeps all of them) so you can set them deliberately. The current state is saved first, and <b>Undo</b> puts it back.</div>'
        /* WHO APPROVES WHOSE ADVANCE, set here and on the code form (RUN-ME-045): "choose role
           credit choose supervisor from role credit ... choose role pmo collection choose their
           approver as role pmo manager ... this also sounds neat for me to setup not you in bg".
           The sheet routed by department zone codes with approver codes; the portal routes on
           the role that asks (this column) and, where named, the code's own supervisor. */
        + '<br><b>Uidhinishaji wa advance</b>: unapompa wadhifa tab ya <b>advappr</b>, tiki wadhifa anazoidhinisha (GMO: F.O, MANAGER, BIKE; PMO MANAGER: PMO COLLECTION). Ukitiki wadhifa uleule (CREDIT → CREDIT), kila msimbo huchaguliwa msimamizi wake kwenye fomu ya msimbo. <b>Futa uidhinishaji</b> huondoa tab hiyo, waidhinishaji na wasimamizi wote (ADMIN inabaki) ili uanze kupanga — <b>Rudisha</b> inairejesha.'
        + ' / <b>Advance approvals</b>: when you grant a role the <b>advappr</b> tab, tick the roles it approves (GMO: F.O, MANAGER, BIKE; PMO MANAGER: PMO COLLECTION). Tick the SAME role (credit → credit) and each code then names its supervisor on the code form. <b>Clear approvals</b> takes that tab, every approver and every supervisor off (ADMIN keeps it) so you grant from empty; <b>Undo</b> puts them back.'
        + (ac.routingOn === false ? '<br>⚠️ ' + esc(ac.routingNote || '') : '')
        + '</div>'
        + '<div class="scroll"><table><thead><tr><th class="sn">S/N</th><th>Wadhifa / Role</th>'
        /* "At roles what is idadi ... I thought it's number of assigned users by role, I have
           single pmo manager and am seeing 23!" -- it was the tab count, and the users were the
           column after it. Both now say what they count. */
        + '<th>Tabs</th><th class="r">Idadi ya tabs / Tabs count</th><th>Mwidhinishaji wa advance / Advance approver</th><th class="r">Watumiaji / Users (codes)</th><th></th></tr></thead><tbody>'
        + (ac.roles||[]).map(function(r, i){
            var n = (ac.rows||[]).filter(function(x){ return String(x.role||'').toUpperCase() === String(r.role||'').toUpperCase(); }).length;
            var ap = String(r.approver_role || '');
            var apRow = ap ? (ac.roles||[]).filter(function(x){ return String(x.role||'').toUpperCase() === ap.toUpperCase(); })[0] : null;
            var approves = (ac.roles||[]).filter(function(x){ return x.approver_role && String(x.approver_role).toUpperCase() === String(r.role||'').toUpperCase(); })
              .map(function(x){ return x.role; });
            return '<tr class="clickrow" data-role="'+esc(r.role)+'"><td class="sn">'+(i+1)+'</td>'
              /* "I Need to see team / F.O (Field officer) at Nafasi na ruhusa / Roles & access":
                 the row every team code signs in under -- tick it, and every field officer on
                 a team code holds those tabs. */
              + '<td><b>'+esc(r.role)+'</b>'+(r.teamCodes ? ' <span class="chip mut">F.O · misimbo ya timu / team codes</span>' : '')+'</td>'
              /* A role that has never been given a row reads differently from one deliberately
                 emptied, and on a screen being filled in from scratch that difference is the
                 whole point -- it says "this one is still waiting for you". */
              + '<td style="white-space:normal">'+((r.tabs||[]).length ? esc(r.tabs.join(', '))
                  : (r.unset ? '<span class="chip mut">haijawekwa / not set yet</span>' : '—'))+'</td>'
              + '<td class="r">'+((r.tabs||[]).length)+'</td>'
              /* The approver, with the two things worth a warning beside it: the same role (so
                 every code needs a named supervisor) and an approver role that does not hold
                 the approval tab (so nobody would see the requests). And the other direction --
                 which roles this one approves -- since that is how a GMO reads it. */
              + '<td style="white-space:normal">'
                + (ap ? esc(ap)
                    + (ap.toUpperCase() === String(r.role||'').toUpperCase() && !r.approverName ? ' <span class="chip mut">msimamizi kwa msimbo / supervisor per code</span>' : '')
                    + (apRow && (apRow.tabs||[]).indexOf('advappr') < 0 ? ' <span class="chip bad">hana tab advappr / approver lacks the advappr tab</span>' : '')
                  : (r.approverName ? '' : '<span class="chip mut">—</span>'))
                // The one person who supervises the whole role (RUN-ME-046), by name.
                + (r.approverName ? (ap ? ' · ' : '') + '<span class="chip ok">msimamizi / supervisor: ' + esc(r.approverName) + '</span>' : '')
                + (approves.length ? '<div style="color:var(--mut);font-size:11px">huidhinisha / approves: '+esc(approves.join(', '))+'</div>' : '')
              + '</td>'
              + '<td class="r">'+money(n)+'</td>'
              + '<td class="r"><button class="btn sm ghost" data-role="'+esc(r.role)+'">Badili / Edit</button></td></tr>';
          }).join('') + '</tbody></table></div></div>'

      + '<div class="card"><div class="card-h">Misimbo ya kuingia / Access codes'
        + '<span class="sub"><button class="btn sm" id="newCode">+ Msimbo mpya / New code</button>'
        + ' <a href="/upload?admin=1" style="margin-left:8px">Pakia orodha / Upload a list &rarr;</a></span></div>'
      + '<div class="scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Teams</th><th>Msimamizi / Supervisor</th><th>Code</th><th></th></tr></thead><tbody>'
      + ac.rows.map(function(x, i){
          return '<tr><td>'+esc(x.name)+'</td><td>'+esc(x.role)+'</td>'
            + '<td>'+esc(x.teams?x.teams.join(', '):'ALL')+'</td>'
            // The supervisor as a NAME -- the code it is stored as is a password.
            + '<td>'+(x.supervisorName ? esc(x.supervisorName) : (x.supervisor ? '<span class="chip bad">msimbo haupo / code gone</span>' : '—'))+'</td>'
            + '<td><code>'+esc(x.code)+'</code></td>'
            + '<td class="r"><button class="btn sm ghost" data-code="'+esc(x.code)+'">Badili / Edit</button></td></tr>';
        }).join('') + '</tbody></table></div></div>'
      /* Field officers cannot create their own accounts any more. An admin issues one against
         the officer's phone number with a passcode, and can switch it off or re-issue the
         passcode at any moment -- both of which release the handset immediately. */
      + fold_('officers', 'Akaunti za maafisa / Field officer accounts',
              cu.count + ' akaunti / accounts',
        '<div class="card"><div class="card-h">Akaunti za maafisa / Field officer accounts'
        + '<span class="sub"><button class="btn sm" id="newOfficer">+ Afisa mpya / New officer</button></span></div>'
      + (cu.withoutPasscode
          ? '<div class="note bad" style="margin:10px 14px"><b>'+money(cu.withoutPasscode)+'</b> akaunti bado zinatumia usajili wa zamani bila nenosiri.'
            + ' / accounts are still signed in from the old passcode-free registration.'
            + ' Issue each one a passcode to close it.</div>'
          : '')
      + '<div class="scroll"><table><thead><tr><th class="sn">S/N</th><th>Name</th><th>Team</th><th>Phone</th><th>Role</th>'
        + '<th>Passcode</th><th>Status</th><th class="r">Calls</th><th></th></tr></thead><tbody>'
      + (cu.rows.length ? cu.rows.map(function(u, i){
          return '<tr><td class="sn">'+(i+1)+'</td><td><b>'+esc(u.name||'')+'</b></td><td>'+esc(u.team||'')+'</td>'
            + '<td>'+esc(u.phone||'')+'</td>'
            + '<td>'+esc(u.role||'')+(u.is_leader?' <span class="chip">leader</span>':'')+'</td>'
            + '<td>'+(u.hasPasscode?'<span class="chip ok">set</span>':'<span class="chip bad">none</span>')+'</td>'
            + '<td>'+(!u.active ? '<span class="chip bad">off</span>'
                      : u.signedIn ? '<span class="chip ok">signed in</span>'
                      : '<span class="chip mut">not signed in</span>')+'</td>'
            + '<td class="r">'+money(u.calls)+'</td>'
            + '<td class="r"><button class="btn sm ghost" data-user="'+esc(u.user_id)+'">Simamia / Manage</button></td></tr>';
        }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--mut);padding:20px">Hakuna akaunti bado. / No accounts yet.</td></tr>')
      + '</tbody></table></div></div>')
      /* THE MASTER SWITCH -- the one that decides whether anybody else can see any of the rest.
         Closed, the whole company has HOPE Calls and nothing else: no portal, no HOPE Live, and
         no button offering either. The admin is never shut out by it -- otherwise there would
         be no way back. Placed here, below the officers' accounts, by the owner's choice. */
      + '<div class="card"><div class="card-h">Mfumo kwa watumiaji wote / The system, for everybody'
        + '<span class="sub">HOPE Calls haiathiriki kamwe / HOPE Calls is never affected</span></div>'
        + '<div class="cleanbox">'
        + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
        + '<span class="chip ' + (so.open ? 'ok' : 'bad') + '" id="soState">'
          + (so.open ? 'IMEFUNGULIWA / OPEN' : 'IMEFUNGWA / CLOSED') + '</span>'
        + '<button class="btn sm' + (so.open ? ' danger' : '') + '" id="soToggle">'
          + (so.open ? 'Funga mfumo / Close the system' : 'Fungua mfumo / Open the system') + '</button>'
        + '</div>'
        + '<div class="note" style="margin-top:10px">'
        + (so.open
            ? 'Kila mwenye msimbo anaweza kufungua mfumo na HOPE Live.'
              + ' / Everyone with a code can open the portal and HOPE Live.'
            : 'Watumiaji wanaona HOPE Calls pekee. Kitufe cha kubadili na HOPE Live vimefichwa,'
              + ' na seva inakataa hata mtu akijaribu anwani moja kwa moja.'
              + ' / Users see HOPE Calls only. The switch button and HOPE Live are hidden, and the'
              + ' server refuses those addresses even if somebody types them in directly.')
        + '</div></div></div>'
      /* "can we track were they are by the devices without lockapp ... officers have become
         many and managing them has been like kids ... some even dare escape with our phones
         and fraud demands of customer installments" -- a live-location link per officer, for
         whoever has the ordinary HOPE Calls app open with location allowed, lock app or not.
         See officerBeat/officerLocationsList. A button here rather than a row of numbers on
         this already-busy screen; the list itself is its own page. */
      + '<div class="card"><div class="card-h">Mahali walipo maafisa / Officer locations'
        + '<span class="sub">Hakuna lockapp inayohitajika / No lock app required</span></div>'
        + '<button class="btn sm" id="sgOfficerLoc">Fungua orodha / Open the list</button></div>'
      /* THE PRESENTATION SWITCH. HOPE LOAN is being perfected inside this portal before the
         company has formally received it, so the owner must be able to present HOPE PMO with
         no trace of it in the sidebar -- and put it back with one press afterwards. Hidden
         means hidden for every sign-in, this admin's included; nothing is deleted and no data
         moves either way. The server side of the same rule lives in canSwitchWorkspace(). */
      + '<div class="card"><div class="card-h">HOPE LOAN kwenye menyu / HOPE LOAN in the sidebar'
        + '<span class="sub">kuficha hakufuti chochote / hiding deletes nothing</span></div>'
        + '<div class="cleanbox">'
        + '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
        + '<span class="chip ' + (hlOn ? 'ok' : 'bad') + '" id="hlState">'
          + (hlOn ? 'INAONEKANA / SHOWN' : 'IMEFICHWA / HIDDEN') + '</span>'
        + '<button class="btn sm" id="hlToggle">'
          + (hlOn ? 'Ficha HOPE LOAN / Hide HOPE LOAN' : 'Onyesha HOPE LOAN / Show HOPE LOAN') + '</button>'
        + '</div>'
        + '<div class="note" style="margin-top:10px">'
        + (hlOn
            ? 'Ukificha: navs zote za HOPE LOAN zinatoweka kwenye menyu kwa kila mtumiaji, admin pia.'
              + ' Takwimu na skrini zake zinabaki salama — bonyeza tena kuzirudisha.'
              + ' / Hidden, every HOPE LOAN nav disappears from the sidebar for every sign-in, admin'
              + ' included. Its data and screens stay exactly as they are — press again to bring them back.'
            : 'HOPE LOAN imefichwa: hakuna nav yake inayoonekana kwa yeyote sasa.'
              + ' Hakuna kilichofutwa — bonyeza kuonyesha tena.'
              + ' / HOPE LOAN is hidden: none of its navs are visible to anybody right now.'
              + ' Nothing was deleted — press to show it again.')
        + '</div></div></div>'
      + '<div class="card"><div class="card-h">Tangazo / Announcement'
        + '<span class="sub">huonekana kwenye kila skrini, hata ya kuingia / shows on every screen, including sign-in</span></div>'
        + '<div class="fld"><label>Maandishi / Text (max 500)</label>'
          + '<textarea id="annText" rows="3" maxlength="500" style="width:100%"></textarea></div>'
        + '<div class="fld"><label>Picha / Picture (optional, under 600 KB)</label>'
          + '<input type="file" id="annFile" accept="image/*"></div>'
        + '<div id="annPrev" style="margin:8px 0"></div>'
        + '<div style="display:flex;gap:8px">'
          + '<button class="btn sm" id="annPost" style="flex:1">Tangaza / Post</button>'
          + '<button class="btn sm ghost" id="annOff">Ondoa / Take it down</button></div>'
        + '<div class="note">Kila mtu ataliona mara moja, na litabaki hadi kila mmoja alifunge.'
          + ' Halifichwi — mtu yeyote anayefika kwenye tovuti anaweza kuliona.'
          + ' / Everyone sees it at once and it stays until each person closes it.'
          + ' It is NOT private: anyone who can reach the site can read it.</div>'
        + '</div>'
      /* THE RAW KEY/VALUE LIST, FOLDED. It used to be the tab's main table, permanently open
         below everything else -- a hundred-odd rows of internals that made the whole screen
         scroll forever, when the honest use of it is "find one key, change it". Same rows,
         same tap-a-row-to-edit, behind a chip like its two long neighbours. */
      + fold_('setvals', 'Orodha ya thamani / Settings values',
              st.rows.length + ' &middot; bofya mstari kubadili / tap a row to edit',
        '<div class="card">'
        + bar('<button class="btn sm" id="newSetting">+ Badili thamani / Set a value</button>')
        + '<div class="scroll"><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>'
        + st.rows.map(function(r){
            return '<tr data-skey="'+esc(r.key)+'" style="cursor:pointer"><td><code>'+esc(r.key)+'</code></td>'
              + '<td>'+esc(r.value == null ? '' : String(r.value))+'</td></tr>'; }).join('')
        + '</tbody></table></div></div>');
    S.acRows = ac.rows; S.cuRows = cu.rows; S.setRows = st.rows;
    S.rows = []; S.cols = null;
    ONROW = null;
  });
};

/* A field officer account. The phone number IS the login name -- it is also what keys their
   call history, so it stays fixed once set. The passcode is shown exactly once, when it is
   generated: it is stored only as a hash, so nobody, including an admin, can read it back. */
function officerForm(x){
  var isNew = !x;
  var teams = (S.officers && S.officers.teams) || [];
  drawer('<h3>'+(isNew?'Afisa mpya / New field officer':esc(x.name||''))+'</h3>'
    + '<div class="sub">Afisa hawezi kujisajili mwenyewe. / An officer cannot register themselves — you issue the account.</div>'
    + '<div class="fld"><label>Jina / Name</label><input id="oName" value="'+esc(x?x.name:'')+'"></div>'
    + '<div class="fld"><label>Simu / Phone (ndio anaingia nayo / this is the login)</label>'
      + '<input id="oPhone" inputmode="tel" value="'+esc(x?x.phone:'')+'"'+(isNew?'':' readonly')+'></div>'
    + '<div class="fld"><label>Timu / Team</label><select id="oTeam"><option value="">— none —</option>'
      + teams.map(function(t){ return '<option'+(x&&x.team===t?' selected':'')+'>'+esc(t)+'</option>'; }).join('')
      + '</select></div>'
    + '<div class="fld"><label>Wadhifa / Role</label><input id="oRole" value="'+esc(x&&x.role?x.role:'OFFICER')+'"></div>'
    + '<label class="chk"><input id="oLeader" type="checkbox"'+(x&&x.is_leader?' checked':'')+'> Kiongozi / Leader (sees reports)</label>'
    /* The scope a leader reads reports over. This existed in the database and NOT on the form,
       so the form could never send it -- and a save that does not mention it used to erase it,
       which is how a multi-team leader kept collapsing to a single team. */
    + '<div class="fld" id="oLtWrap" style="'+(x&&x.is_leader?'':'display:none')+'"><label>Timu anazoziona kiongozi / Leader\'s teams (orodha, au ALL)</label>'
      + '<input id="oLeaderTeams" value="'+esc(x&&x.leader_teams?x.leader_teams.join(', '):'')+'" placeholder="ALL">'
      + '<div class="fldnote">Tupu au ALL = timu zote. / Blank or ALL = every team.</div></div>'
    + '<label class="chk"><input id="oActive" type="checkbox"'+(!x||x.active?' checked':'')+'> Inatumika / Active</label>'
    + '<div class="fldnote">Ukiizima, simu yake inakatwa mara moja. / Switching this off cuts their handset immediately.</div>'
    + '<label class="chk"><input id="oIssue" type="checkbox"'+(isNew?' checked disabled':'')+'> '
      + (isNew ? 'Tengeneza nenosiri / Issue a passcode' : 'Badilisha nenosiri / Issue a NEW passcode')+'</label>'
    + (isNew ? '' : '<div class="fldnote">Nenosiri jipya linakata simu iliyokuwa na la zamani. / A new passcode releases the handset that had the old one.</div>')
    + '<div id="oOut"></div>'
    + '<button class="btn w" id="oSave">Hifadhi / Save</button>'
    /* The middle action between "save" and "delete": release the handset, keep everything
       else. This existed once, in a form nothing could reach any more -- an admin whose
       officer registered with the wrong name or team had no button for the commonest fix. */
    + (x && x.signedIn ? '<button class="btn ghost w" style="margin-top:8px" id="oFree">Ondoa kwenye simu / Sign the phone out</button>'
        + '<div class="fldnote">Historia na akaunti vinabaki; ataingia tena kwa nenosiri lake. / Keeps the account and its history — they simply sign in again.</div>' : '')
    // Switching off keeps their call history and is right for someone who left. Deleting is
    // for accounts that should never have existed -- a test, a typo, a duplicate -- so it is
    // separate, and it says plainly that the call history goes with it.
    + (isNew ? '' : '<button class="btn ghost w" style="margin-top:8px;color:var(--bad);border-color:var(--badline)" id="oDel">Futa kabisa / Delete account</button>'
        + '<div class="fldnote">Kufuta kunaondoa na historia ya simu zake. Kuzima tu kunaihifadhi. / Deleting also removes their call history; switching off keeps it.</div>'));
  var lch = $('#oLeader');
  if (lch) lch.onchange = function(){ var w = $('#oLtWrap'); if (w) w.style.display = lch.checked ? '' : 'none'; };
  var fr = document.getElementById('oFree');
  if (fr) fr.onclick = function(){
    srv('removeCallUser', { userId: x.user_id, mode: 'unregister' })
      .then(function(){ toast('Simu imeondolewa. / The phone is signed out.'); closeDrawer(); render(); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
  if (!isNew) $('#oDel').onclick = function(){
    if (!confirm('Futa akaunti ya "' + (x.name||'') + '" na historia yake yote ya simu?\n\n'
      + 'Kwa mtu aliyeondoka, ni bora kuizima badala yake. / Delete this account AND all of its call history? '
      + 'For someone who has left, switching it off is usually better.')) return;
    srv('deleteOfficerAccount', { userId: x.user_id })
      .then(function(){ toast('Imefutwa. / Deleted.'); closeDrawer(); render(); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
  $('#oSave').onclick = function(){
    srv('saveOfficerAccount', { name:$('#oName').value.trim(), phone:$('#oPhone').value.trim(),
      team:$('#oTeam').value, role:$('#oRole').value.trim(),
      isLeader:$('#oLeader').checked, leaderTeams:$('#oLeaderTeams').value.trim(),
      active:$('#oActive').checked,
      issuePasscode: isNew || $('#oIssue').checked })
      .then(function(r){
        if (r.passcode){
          // Shown once, and only here. There is no screen anywhere that can show it again.
          $('#oOut').innerHTML = '<div class="passout"><div class="pl">Nenosiri / Passcode — '
            + 'andika sasa, halitaonekana tena / write it down now, it is never shown again</div>'
            + '<div class="pv">'+esc(r.passcode)+'</div></div>';
          $('#oSave').textContent = 'Nimeandika / Done';
          $('#oSave').onclick = function(){ closeDrawer(); render(); };
          toast('Imehifadhiwa. / Saved.');
        } else { toast('Imehifadhiwa. / Saved.'); closeDrawer(); render(); }
      })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}

/** Add or edit a portal login. Editing keeps the code itself fixed -- changing it would
    silently orphan whoever is already using it. */
function codeForm(x){
  var isNew = !x;
  var roles = (S.roles||[]).map(function(r){ return r.role; });
  if (x && roles.indexOf(x.role) < 0) roles.push(x.role);
  /* THE ADVANCE SUPERVISOR OF THIS CODE (RUN-ME-045): one other code, offered by NAME and
     role -- "even select codeuser as the supervisor ... At their code I have to choose one
     credit as supervisor". A read-only admin's list carries no codes (they are masked), so
     the picker is shown disabled rather than offering a choice that cannot be saved. */
  var others = (S.acRows||[]).filter(function(c){ return !x || c.code !== x.code; })
    .sort(function(a, b){ return (String(a.role||'') + ' ' + String(a.name||'')).localeCompare(String(b.role||'') + ' ' + String(b.name||'')); });
  var masked = others.some(function(c){ return c.code === '••••'; });
  var sup = String((x && x.supervisor) || '');
  drawer('<h3>'+(isNew?'Msimbo mpya / New access code':'Badili / Edit '+esc(x.name))+'</h3>'
    + '<div class="sub">Msimbo ndio nywila -- usiushirikishe. / The code is the password.</div>'
    + '<div class="fld"><label>Msimbo / Code</label><input id="kCode" value="'+esc(x?x.code:'')+'">'
      + (isNew ? '' : '<div class="fldnote">Unaweza kuubadilisha — mtumiaji ataingia na mpya. / You can change this; the holder signs in with the new one from that moment.</div>')
      + '</div>'
    /* THE NAME COMES FROM TEAMS & STAFF, NOT FROM TYPING.
       "the access code of any leader should be created without inputing another name but by
        setting only the code for that role and they find their names roles and codes ready
        so that we solve name mismatches too"
       Every screen that matches this person later -- roles, phones, reports -- matches the
       SPELLING stored in the teams table, so a code created with a retyped variant of the
       same human is a mismatch built in on day one. Picking fills name, role and teams from
       the roster; all three stay editable for the rare code that is not a roster person. */
    + '<div class="fld"><label>Chagua kutoka Timu na Wafanyakazi / Pick from Teams &amp; Staff</label>'
      + '<select id="kPick"><option value="">\u2014 chagua mtu / pick a person \u2014</option></select>'
      + '<div class="fldnote">Jina, wadhifa na timu vinajazwa kutoka jedwali \u2014 hakuna kuandika jina mara ya pili. / Fills the fields below from the staff table, so the spelling can never drift.</div></div>'
    + '<div class="fld"><label>Jina / Name</label><input id="kName" value="'+esc(x?x.name:'')+'"></div>'
    + '<div class="fld"><label>Wadhifa / Role</label><input id="kRole" list="roleList" value="'+esc(x?x.role:'')+'">'
      + '<datalist id="roleList">'+roles.map(function(r){ return '<option value="'+esc(r)+'">'; }).join('')+'</datalist></div>'
    + '<div class="fld"><label>Timu / Teams (ALL au orodha)</label><input id="kTeams" value="'+esc(x&&x.teams?x.teams.join(', '):'ALL')+'">'
      + '<div class="fldnote">Kwa wadhifa wenye safu kwenye jedwali la timu (OPM, RECOVERY, GMO, MANAGER, CREDIT, EXPECTED, BIKE), orodha hii pia inamweka mtu huyu kwenye Timu na Wafanyakazi. ALL haimpi mtu timu zote — inafungua tu kuona.'
      + '<br>For a role that has a column in the teams table, this list also files the person into Teams &amp; Staff. ALL only opens the view; it never makes somebody the officer of every team.</div>'
      + '</div>'
    + '<div class="fld"><label>Msimamizi wa advance / Advance supervisor (anayeidhinisha maombi ya msimbo huu / who approves this code\'s requests)</label>'
      + '<select id="kSup"'+(masked ? ' disabled' : '')+'><option value="">— hakuna: wadhifa wa kuidhinisha ndio unaamua / none: the approver role decides —</option>'
      + others.map(function(c){ return '<option value="'+esc(c.code)+'"'+(c.code === sup ? ' selected' : '')+'>'+esc(c.name||'')+' · '+esc(c.role||'')+'</option>'; }).join('')
      + '</select>'
      /* "At codes I choose role user as supervisor of the whole dept not assigning every user
         to the same person": one tick writes the chosen person on this code's ROLE instead. */
      + '<label class="chk" style="margin-top:6px"><input type="checkbox" id="kSupRole"> Mfanye msimamizi wa wadhifa wote wa <b id="kSupRoleName">'+esc(x ? x.role : '')+'</b> — si msimbo huu tu / Make them the supervisor of every <b>'+esc(x ? x.role : '')+'</b> code, not this code only</label>'
      + '<div class="fldnote">Akichaguliwa, yeye pekee ndiye anayeona maombi ya advance ya msimbo huu, zone yoyote. Ukitiki "wadhifa wote", anaandikwa mara moja kwenye wadhifa na msimbo huu unaachwa wazi.'
        + ' / When set, only this person sees this code\'s advance requests, whatever the zone. Tick "every code" and they are written once on the role, with this code left blank.'
        + (function(){ var rr = (S.roles||[]).filter(function(r){ return x && String(r.role||'').toUpperCase() === String(x.role||'').toUpperCase(); })[0];
            return rr && rr.approverName ? '<br>Msimamizi wa wadhifa huu sasa / this role\'s supervisor now: <b>' + esc(rr.approverName) + '</b>' : ''; })()
        + (S.routingOn === false ? '<br>⚠️ ' + esc(S.routingNote || '') : '') + '</div></div>'
    /* NO TAB LIST HERE ANY MORE. "remove the tabs column from access codes, I need a new role
       assign table before access codes ... so now we decide easy for all users". A code used
       to be able to carry extra tabs of its own, which meant a permission could be granted in
       two places and audited in neither. Access is decided once, on the ROLE, in the card
       directly above this list -- and saving a code clears whatever extras it was carrying,
       which is the point of moving the decision rather than duplicating it. */
    + '<div class="fldnote" style="margin-bottom:11px">Ruhusa zinatoka kwenye wadhifa &mdash; badilisha kwenye jedwali la <b>Nafasi na ruhusa</b> juu ya orodha hii.'
      + ' / Access comes from the ROLE. Set it in the <b>Roles &amp; access</b> table above this list; saving here clears any extra tabs this code still carried.</div>'
    + '<button class="btn w" id="kSave">Hifadhi / Save</button>'
    + (isNew ? '' : '<button class="btn ghost w" style="margin-top:8px;color:var(--bad);border-color:var(--badline)" id="kDel">Futa msimbo / Delete code</button>'));
  document.getElementById('kSave').onclick = function(){
    var tabs = Array.prototype.filter.call(document.querySelectorAll('.kTab'), function(c){ return c.checked; })
      .map(function(c){ return c.value; }).join(',');
    var supSel = document.getElementById('kSup');
    srv('saveAccessCode', { code:document.getElementById('kCode').value.trim(), oldCode:(x?x.code:''), name:document.getElementById('kName').value.trim(),
      role:document.getElementById('kRole').value.trim(), teams:document.getElementById('kTeams').value.trim(),
      tabs:tabs,
      // A disabled picker (codes masked) says nothing, and nothing said is nothing changed.
      supervisor: supSel && !supSel.disabled ? supSel.value : undefined,
      roleSupervisor: !!(document.getElementById('kSupRole') && document.getElementById('kSupRole').checked) })
      /* THE ROSTER FOLLOWED, SO SAY SO. Saving a code now also re-files that person in the
         teams table, and a change to a screen the admin is not looking at has to be reported
         or it is indistinguishable from nothing happening. */
      .then(function(r){
        var s = r && r.staff, msg = 'Imehifadhiwa.';
        if (s) {
          var bits = [];
          if (s.renamedOn) bits.push('jina limebadilishwa kwenye timu ' + s.renamedOn + ' / renamed on ' + s.renamedOn);
          if (s.added) bits.push('ameongezwa kwenye timu ' + s.added + ' / added to ' + s.added);
          if (s.cleared) bits.push('ameondolewa kwenye timu ' + s.cleared + ' / removed from ' + s.cleared);
          if (bits.length) msg += ' Timu na Wafanyakazi: ' + bits.join('; ') + ' (' + s.role.toUpperCase() + ').';
        }
        if (r && r.roleSupervisor && r.roleSupervisor.saved) msg += ' Msimamizi wa wadhifa wote wa ' + r.roleSupervisor.role + ' ameandikwa. / Written as the supervisor of every ' + r.roleSupervisor.role + ' code.';
        // The code saves on any database; the supervisors only with RUN-ME-045/046, and the answer says.
        if (r && r.note) msg += ' ⚠️ Msimamizi hajahifadhiwa / the supervisor was not saved: ' + r.note;
        toast(msg, !!(r && r.note)); closeDrawer(); render();
      })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
  var del = document.getElementById('kDel');
  if (del) del.onclick = function(){
    if (!confirm('Futa msimbo wa '+(x.name)+'? Hataweza kuingia tena.\n\nDelete this code? They will no longer be able to sign in.')) return;
    srv('deleteAccessCode', { code:x.code })
      .then(function(){ toast('Imefutwa.'); closeDrawer(); render(); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}

function settingForm(key, value){
  /* Any setting that holds a picture -- the app logo above all -- used to need a URL hosted
     somewhere else, which is a deploy and a hosting decision for what is really just "here is
     our logo". Pick the file and it is stored inline, downscaled to 512px first so a 2MB
     export does not travel to every handset on every boot while still being sharp enough for
     the largest screen that shows it. */
  drawer('<h3>Badili thamani / Set a value</h3><div class="sub">Mfano: COMMISSION_RATE = 5</div>'
    + '<div class="fld"><label>Key</label><input id="sKey" value="'+esc(key)+'"'+(key?' readonly':'')+'></div>'
    + '<div class="fld"><label>Value</label><input id="sVal" value="'+esc(value)+'"></div>'
    + '<div class="fld"><label>Au chagua picha / Or choose an image (logo)</label>'
      + '<input type="file" id="sImg" accept="image/*"></div>'
    + '<div id="sPrev" style="margin:0 0 10px"></div>'
    + '<button class="btn w" id="sSave">Hifadhi / Save</button>'
    // Every other register here can lose a row. A key typed wrongly once used to stay forever,
    // and a switch left behind by an old build kept quietly applying.
    + (key ? '<button class="btn w ghost danger" id="sDel" style="margin-top:8px">Futa / Delete this setting</button>' : ''));
  if (/^data:image\//.test(String(value||''))) document.getElementById('sPrev').innerHTML =
    '<img src="'+esc(value)+'" style="width:64px;height:64px;object-fit:contain;border-radius:10px;background:#fff">';
  document.getElementById('sImg').onchange = function(){
    var f = this.files && this.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function(){
      var im = new Image();
      im.onload = function(){
        var n = 512, s = Math.min(n / im.width, n / im.height, 1);
        var cv = document.createElement('canvas');
        cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        var url = cv.toDataURL('image/png');
        document.getElementById('sVal').value = url;
        document.getElementById('sPrev').innerHTML =
          '<img src="'+esc(url)+'" style="width:64px;height:64px;object-fit:contain;border-radius:10px;background:#fff">';
        toast('Picha imesomwa — bonyeza Hifadhi. / Image read — now press Save.');
      };
      im.onerror = function(){ toast('Faili hii si picha inayosomeka. / That file is not a readable image.', true); };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
  document.getElementById('sSave').onclick = function(){
    srv('settingSet', { key:document.getElementById('sKey').value.trim(), value:document.getElementById('sVal').value })
      .then(function(){ toast('Imehifadhiwa.'); closeDrawer(); render({ force:true }); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
  var sd = document.getElementById('sDel');
  if (sd) sd.onclick = function(){
    if (!confirm('Futa "'+key+'"? Mfumo utarudi kwenye thamani ya kawaida.\n\n'
      + 'Delete this setting? The system falls back to its built-in default.')) return;
    srv('settingDelete', { key: key })
      .then(function(){ toast('Imefutwa.'); closeDrawer(); render({ force:true }); })
      .catch(function(e){ toast(String(e.message||e), true); });
  };
}

// Read one key out of the settings rows the page already has, rather than a call of its own.
function settingVal(rows, key, dflt){
  var r = (rows||[]).find(function(x){ return x.key === key; });
  return r ? r.value : dflt;
}

/* THE SETTINGS THAT RUN THE BUSINESS, NAMED, NOT HIDDEN.
     "i needed these settings at seetings from the fresh start as i did in version one"
   Every one of these already worked as a setting -- readable through the generic key/value
   box if you already knew the exact key to type. That is not the same as being IN Settings:
   the sales-target mismatch (1.58B shown, ~370m expected) was exactly this -- a setting nobody
   knew existed, quietly running on its built-in fallback. These are the same keys the server
   has always read (see settingNum/settingGet call sites in portal-core.js and call-core.js),
   given a label, a current value and a Save button, grouped the way a person filling them in
   from scratch would think about them. Nothing new is invented; everything here already had a
   fallback default, which is why leaving a field exactly as shown changes nothing. */
var SETTINGS_GROUPS = [
  { id:'salesTarget', title:'Malengo ya mauzo / Sales targets', sub:'kila timu / per team',
    preview:true, fields:[
      { key:'SALES_TARGET_WEEKLY', label:'Kwa wiki (siku 5 za kazi) / Per week (5 working days), TZS',
        type:'number', dflt:'100000000',
        note:'Dashibodi na ripoti ya wiki: hii ÷ 5 × idadi ya timu = lengo la kampuni kwa siku. / The Dashboard and weekly report divide this by 5 and multiply by the number of teams for the whole-company daily figure.' },
      { key:'SALES_TARGET_MONTHLY', label:'Kwa mwezi / Per month, TZS', type:'number', dflt:'400000000',
        note:'HOPE Calls scorecard pekee. / HOPE Calls scorecard only -- a separate board from the two above.' },
      /* THE THREE PERCENTAGE TARGETS. Every table on every screen -- the Orodha, the officer
         boards, the deck on the wall -- turns a percentage GREEN once it reaches its target and
         RED when it is under the JUMLA line; a blank target means nothing turns green. */
      { key:'TARGET_EARLY_COL_PCT', label:'Lengo la Early Col % / Early collection % target', type:'number', dflt:'',
        note:'Asilimia ya karatasi ya awali (initial). Wazi = hakuna kijani. / Initial-sheet collection %. Blank = nothing turns green.' },
      { key:'TARGET_COL_PCT', label:'Lengo la Col % / Collection % target', type:'number', dflt:'',
        note:'Ukusanyaji wa siku na wa PMO Collection. / Day collection and PMO Collection %.' },
      { key:'TARGET_REC_PCT', label:'Lengo la Rec % / Recovery % target', type:'number', dflt:'',
        note:'Kilichorejeshwa ÷ kisichokusanywa. Mauzo: 100% ya lengo ni kijani. / Recovered ÷ uncollected. Sales: 100% of target is green.' },
    ] },
  { id:'rotation', title:'Mzunguko wa kufuatilia wadaiwa / Recycling rotation',
    sub:'nani anamiliki mdaiwa wiki hii / who owns a defaulter this week', fields:[
      { key:'ASSIGN_ACTIVE', label:'Hai / Active -- mfululizo, ukitenganisha kwa mkato',
        type:'text', dflt:'BIKE,MANAGER,GMO' },
      { key:'ASSIGN_CHRONIC', label:'Sugu / Chronic', type:'text', dflt:'BIKE,GMO,MANAGER' },
      { key:'ASSIGN_EXPIRED', label:'Muda umepita / Expired', type:'text', dflt:'MANAGER,GMO' },
      { key:'ASSIGN_GRACE_WEEKS', label:'Wiki za neema kabla ya kuwa sugu / Grace weeks before chronic',
        type:'number', dflt:'2' },
      { key:'ASSIGN_BUCKET_DAYS', label:'Siku kabla ya kuzunguka (Hai) / Days before rotating (Active)',
        type:'number', dflt:'2' },
    ] },
  { id:'restructure', title:'Marekebisho ya mikopo / Loan restructuring', sub:'sifa na masharti / eligibility and terms',
    fields:[
      { key:'RESTRUCTURE_MIN_DC', label:'Malipo ya chini yaliyokosekana kustahili / Min missed installments (DC) to qualify',
        type:'number', dflt:'4' },
      { key:'RESTRUCTURE_MAX_MONTHS', label:'Miezi ya juu ya malipo mapya / Max new repayment months',
        type:'number', dflt:'4' },
      { key:'RESTRUCTURE_INTEREST_PCT', label:'Riba mpya kwa kilichobaki (%) / New interest on the remaining (%)',
        type:'number', dflt:'12' },
    ] },
  { id:'thresholds', title:'Vigezo vingine / Other thresholds', sub:null, fields:[
      { key:'ABNORMAL_STEP', label:'Kizidisho cha malipo ya kawaida (TZS) / Normal payment multiple, TZS',
        type:'number', dflt:'500',
        note:'Malipo yasiyo kizidisho cha hii huonekana Abnormal Payments. / A payment that is not a multiple of this is flagged there.' },
      { key:'CALL_MIN_SECS', label:'Sekunde za chini kuhesabu simu / Minimum seconds to count a call',
        type:'number', dflt:'5' },
      { key:'CALL_EARLY_MAX_BEHIND', label:'Kesho: nyuma siku ngapi bado zaonekana / Kesho tab: max days behind still shown',
        type:'number', dflt:'1' },
      { key:'CALL_CREDIT_MAX_PAID', label:'1-6: kiwango cha juu cha malipo / Count 1-6: upper paid limit',
        type:'number', dflt:'5' },
    ] },
  /* THE LOCKED PHONE'S OWN SCREEN.
     -------------------------------------------------------------------------------------
       "I cant see where to edit this 'Simu hii ni mali ya hope...' at locking"

     Every word on that screen has always come from settings -- and not one of them could be
     found. Settings lists only rows that EXIST, so a key never written has nothing to click,
     and the only way in was the key/value drawer, which needs the exact string typed from
     memory. A setting nobody can find is a setting nobody has. So the five that compose the
     screen are written out here with their real defaults, exactly like every other group.

     The timing numbers (DEVICE_BEAT_SECONDS, DEVICE_OFFLINE_GRACE_HOURS and the rest) are
     deliberately NOT here: this card is what a locked handset says, and those are how often
     it speaks. They remain key/value rows -- docs/DEVICE-LOCKING.md section 6 lists them. */
  { id:'lockscreen', title:'Skrini ya simu iliyofungwa / The locked phone\'s screen',
    sub:'maneno yanatoka hapa, si kwenye app / the words come from here, not the app',
    preview:true, fields:[
      { key:'DEVICE_LOCK_BRAND', label:'Jina la kampuni juu / Company name across the top',
        type:'text', dflt:'HOPE MICROCREDIT',
        note:'Pia hujaza {brand} hapo chini. / Also fills {brand} below.' },
      { key:'DEVICE_LOCK_MESSAGE', label:'Ujumbe / The message', type:'text', dflt:'',
        note:'Wazi = ujumbe wa kawaida. Tumia {brand} na {namba}. / Blank uses the built-in sentence. '
          + 'Write {brand} and {namba} where those belong — the server fills them in.' },
      { key:'DEVICE_HELP_PHONE', label:'Namba ya kupiga / The number to call', type:'text', dflt:'',
        note:'Hujaza {namba}. Ikiwa wazi, ujumbe wa kawaida hauahidi namba yoyote badala ya kuahidi tupu. '
          + '/ Fills {namba}. Left blank, the built-in sentence promises no number rather than a blank one.' },
      { key:'DEVICE_LOCK_LOGO', label:'Alama / The mark', type:'text', dflt:'',
        note:'Wazi = alama ya HOPE (/lock-logo.png). Andika <b>none</b> kuiondoa kabisa. '
          + '/ Blank means HOPE\'s mark. Write <b>none</b> for no mark at all — see docs/DEVICE-LOCKING.md §6a.' },
    ] },
  /* THE BENCH COMMANDS THEMSELVES -- what app, and from where.
     -------------------------------------------------------------------------------------
       "if there should be installation or anything then it must be included in the token
        copy" / "should be inclusive in code if important"
     INCLUDED BY DEFAULT, not opt-in: blank DEVICE_LOCK_APK_PATH uses the real path already in
     use on this bench (apkPathFor_, portal-core.js), so the install step rides on every bench
     command unless an operator deliberately writes <b>none</b> to leave it out. A bench
     command that assumes the APK is already on the phone is exactly the trap that read
     result=0 as success while nothing was ever installed. */
  { id:'deviceBench', title:'Amri za benchi / The bench commands', sub:'app gani, na kutoka wapi / which app, and from where',
    fields:[
      { key:'DEVICE_LOCK_PACKAGE', label:'Package ya app / The app\'s package', type:'text', dflt:'',
        note:'Wazi = com.samaritantechs.hooploanlock (app iliyopo tayari). Badilisha tu ukiwa na build yako '
          + 'mwenyewe. / Blank = com.samaritantechs.hooploanlock (the app that already exists). Change this '
          + 'only if you build and sign your own.' },
      { key:'DEVICE_LOCK_APK_PATH', label:'Njia ya APK kwenye kompyuta ya benchi / The APK\'s path on the bench computer', type:'text', dflt:'',
        note:'Wazi = %USERPROFILE%\\Downloads\\HOOPLOAN-Lock.apk (njia inayotumika tayari) -- hatua ya '
          + '"Sakinisha" inakuwa sehemu ya kila amri ya benchi kiotomatiki. Andika <b>none</b> kuiacha nje. '
          + '/ Blank = %USERPROFILE%\\Downloads\\HOOPLOAN-Lock.apk (the path already in use) -- the "Install" '
          + 'step rides on every bench command automatically. Write <b>none</b> to leave it out.' },
    ] },
  /* WHERE SHIFT SENDS A PHONE BY DEFAULT.
     -------------------------------------------------------------------------------------
       "I dont need to fill anything during shifting from one to other"

     One APK, two companies -- so "the other office" is not a choice anybody makes each
     time a phone moves, it is a fact of the deployment. The Hamisha / Shift drawer opens
     with this address already in the field; nobody types it unless it changes. */
  { id:'deviceShift', title:'Kuhamisha simu kati ya makampuni / Shifting phones between companies',
    sub:'anwani ya ofisi nyingine, kwa Hamisha / the other office\'s address, for Shift', fields:[
      { key:'DEVICE_SHIFT_PARTNER', label:'Anwani ya HOOP / HOOP\'s address', type:'text',
        dflt:'https://hoop-pmo.vercel.app',
        note:'Hii ndiyo simu inayohamishwa inakoenda. Badilisha tu kama anwani yao imebadilika. '
          + '/ This is where a shifted phone goes. Change it only if their address itself changes.' },
    ] },
  /* THE IMPREST GM AND THE ADDRESS ITS EMAIL LINKS POINT TO -- "i'll set GM email in
     settings". A blank IMPREST_GM_EMAIL means no notice is sent at all; the request, approval
     and report panes still work either way, exactly the same "courtesy, never the
     dependency" rule the weekly report's ADMIN_EMAIL already follows. APP_BASE_URL is this
     deployment's own web address; without it the notice is still sent, only without its two
     links (Decide now, Open in the portal) -- see api/_lib/imprest.js. */
  { id:'imprest', title:'Imprest -- GM na anwani ya email / GM and the email address',
    sub:'nani anaidhinisha, na kiungo cha email kinaenda wapi / who decides, and where the email links point',
    fields:[
      { key:'IMPREST_GM_EMAIL', label:'Barua pepe ya GM / GM\'s email', type:'text', dflt:'',
        note:'GM lazima awe na msimbo wake wa kuingia na tab ya Idhini ya imprest ikiwa imetikwa; '
          + 'hii ni email tu ya kutuma taarifa. / The GM still needs their own access code with '
          + 'Imprest approval ticked -- this only says where the notice email goes. Blank = no email sent.' },
      { key:'APP_BASE_URL', label:'Anwani ya mfumo huu / This deployment\'s own web address', type:'text', dflt:'',
        note:'Mfano https://hope-pmo-v2.vercel.app -- bila hii, viungo vya "Amua sasa" na "Fungua '
          + 'kwenye portal" haviwekwi kwenye email. / e.g. https://hope-pmo-v2.vercel.app -- without '
          + 'it, the email is still sent but without its Decide-now or Open-in-portal links.' },
      /* "he's gonna request again now, i hope when gm approves he gets one" -- and the reason
         he did not is almost always this field, blank. A blank EMAIL_FROM falls back to
         Resend's own onboarding sender, which Resend will only deliver to the address of the
         Resend ACCOUNT ITSELF -- enough to see the GM's own notice arrive (if the GM signed up
         for the Resend account) and nothing else. A requester's personal Gmail is a different
         address, so Resend silently refuses it -- the request still saves, the GM's own notice
         still lands, and only the requester's decision email goes missing, which is exactly
         the shape of the bug reported here. Same key the weekly report's ADMIN_EMAIL email
         already uses (api/_lib/portal-core.js), shared rather than a second copy. */
      { key:'EMAIL_FROM', label:'Mtumaji wa email / Email sender address', type:'text', dflt:'',
        note:'Mfano HOPE PMO &lt;imprest@hopemicrocredit.co.tz&gt; -- lazima iwe kwenye domain '
          + 'iliyothibitishwa Resend. Ikiachwa wazi, taarifa za GM zinaweza kufika lakini email za '
          + 'maamuzi kwa waombaji HAZITAFIKA. / e.g. HOPE PMO &lt;imprest@hopemicrocredit.co.tz&gt; '
          + '-- must be on a domain verified in Resend. Left blank, the GM\'s own notice may still '
          + 'arrive but decision emails to REQUESTERS will silently fail to deliver.' },
    ] },
];

function settingsGroupCard_(g, rows){
  var html = '<div class="card"><div class="card-h">' + esc(g.title)
    + (g.sub ? '<span class="sub">' + esc(g.sub) + '</span>' : '') + '</div><div class="cleanbox">'
    + g.fields.map(function(f){
        return '<div class="fld"><label>' + f.label + '</label>'
          + '<input type="' + (f.type||'text') + '" id="cfg_' + f.key + '" value="'
          + esc(settingVal(rows, f.key, f.dflt)) + '">'
          + (f.note ? '<div class="fldnote">' + f.note + '</div>' : '') + '</div>';
      }).join('')
    + (g.preview ? '<div class="fldnote" id="cfgPreview_' + g.id + '"></div>' : '')
    + '<div class="clact"><button class="btn sm" id="cfgSave_' + g.id + '">Hifadhi / Save</button></div>'
    + '<div id="cfgOut_' + g.id + '" class="note" style="display:none"></div>'
    + '</div></div>';
  return html;
}

/* THE PREVIEW THAT WOULD HAVE CAUGHT THIS BEFORE IT SHIPPED.
   "i doubt it uses a monthly target or what am not sure for i have 70+ teams so i expected
    target to be around 370m+" -- the mismatch was never visible until it showed up on the
    Dashboard, divided among teams and days by then. Sales Target now shows what it actually
    produces, live, as you type -- so a number that is off by 4x is caught here instead. */
function wireSettingsPreview_(){
  wireLockPreview_();
  var w = document.getElementById('cfg_SALES_TARGET_WEEKLY'), out = document.getElementById('cfgPreview_salesTarget');
  if (!w || !out) return;
  var n = Math.max(1, S.teamCount || 1);
  var upd = function(){
    var weekly = Number(w.value) || 0;
    var daily = Math.round(weekly * n / 5);
    out.textContent = 'Timu ' + n + ': TZS ' + money(weekly) + '/wiki kila moja → lengo la kampuni TZS '
      + money(daily) + '/siku. / ' + n + ' teams: TZS ' + money(weekly) + '/week each → company target TZS '
      + money(daily) + '/day.';
  };
  w.oninput = upd; upd();
}

/* SEPARATE FROM wireClean ON PURPOSE. wireClean returns early when the Settings cards are not
   on screen -- which is every screen except Settings, including the Weekly report this button
   lives on. Wired here it is reached wherever it is drawn, and does nothing where it is not. */
/* The leaders sheet, out as a CSV in the importer's own shape. Built from what the SERVER says
   the columns are rather than from a list here, so the round trip cannot drift: if the importer
   learns a column, the download carries it without this file being touched. */
function wireTeamsDownload(){
  var b = document.getElementById('teamsDl');
  if (!b) return;
  b.onclick = function(){
    b.disabled = true;
    srv('teamsExport').then(function(d){
      var q = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var lines = [d.headers.map(q).join(',')];
      (d.rows || []).forEach(function(r){ lines.push(r.map(q).join(',')); });
      download(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }),
        'leaders-' + today() + '.csv');
      toast(money(d.count) + ' timu zimepakuliwa. / ' + d.count + ' teams downloaded.');
      b.disabled = false;
    }).catch(function(e){ b.disabled = false; toast(String(e.message || e), true); });
  };
}

/* THE PHONE LIST: role, team, name, number -- one press, a real Excel file. Same
   SpreadsheetML trick as exportXls (no library, works inside the WebView), but fed by the
   server's staffExport rather than the on-screen table, because the on-screen staff list is
   BY PERSON and the file wanted is BY ROLE AND TEAM, with the app's fresh numbers. */
function wireStaffExcel(){
  var b = document.getElementById('staffXl');
  if (!b) return;
  b.onclick = function(e){
    e.stopPropagation();
    b.disabled = true;
    srv('staffExport').then(function(d){
      var html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">'
        + '<xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>'
        + '<x:Name>Namba</x:Name><x:WorksheetOptions><x:FreezePanes/><x:SplitHorizontal>1</x:SplitHorizontal>'
        + '<x:TopRowBottomPane>1</x:TopRowBottomPane></x:WorksheetOptions></x:ExcelWorksheet>'
        + '</x:ExcelWorksheets></x:ExcelWorkbook></xml>'
        + '<style>th{background:#0B2A6B;color:#fff;font-weight:700}td,th{border:1px solid #ccc;padding:4px 6px}</style>'
        + '</head><body><table><thead><tr><th>S/N</th>'
        + d.headers.map(function(h){ return '<th>'+esc(h)+'</th>'; }).join('')
        + '</tr></thead><tbody>'
        + (d.rows||[]).map(function(r, i){
            // Numbers stay TEXT on purpose: Excel eats a leading zero off a phone number.
            return '<tr><td x:num>'+(i+1)+'</td>'+r.map(function(v){ return '<td x:str>'+esc(v==null?'':v)+'</td>'; }).join('')+'</tr>';
          }).join('')
        + '</tbody></table></body></html>';
      download(new Blob(['﻿'+html], {type:'application/vnd.ms-excel;charset=utf-8;'}),
        'namba-viongozi-maafisa-' + today() + '.xls');
      toast(money(d.count) + ' namba zimepakuliwa. / ' + d.count + ' numbers downloaded.');
      b.disabled = false;
    }).catch(function(err){ b.disabled = false; toast(String(err.message||err), true); });
  };
}

/* THREE SETTINGS CARDS USED TO BE WIRED HERE: "Rejista ya ufuatiliaji" (followupClean),
   "Rebuild register" (rebuildFollowup) and the duplicate-upload sweep (purgeSuperseded). They
   were removed from Settings on purpose -- the register repairs itself on every upload and the
   sweep runs as upload housekeeping (see the note in api/upload.js beside purgeSuperseded) --
   but their click wiring stayed behind, looking up ids no screen draws. Gone now; the server
   functions remain for the API. */
/* Cleaning old reports deletes a DAY OF HISTORY, so the flow is deliberately two-step: Check
   counts the rows without touching anything, Clean asks once more and names the number. */
/* The approvals' clean slate and its way back -- wired like the roles' own (resetRoles /
   undoRoles in the core), called from wireForms once this module is in. */
function wireApprovalsReset_(){
  var b = document.getElementById('resetApprovals');
  if (b) b.onclick = function(){
    if (!confirm('Ondoa tab ya advappr, waidhinishaji na wasimamizi wote kwa nafasi na misimbo yote? ADMIN inabaki, na hali ya sasa inahifadhiwa ili uweze kurudisha.'
      + '\n\nTake the advappr tab, every approver and every supervisor off every role and code? ADMIN keeps the tab. The current state is saved first, so Undo can put it back.')) return;
    b.disabled = true;
    srv('resetApprovals', {})
      .then(function(r){
        toast('Imefutwa: tab kwa nafasi ' + money(r.tabsCleared) + ', waidhinishaji ' + money(r.approversCleared) + ', wasimamizi ' + money(r.codesCleared)
          + '. / Cleared: the tab off ' + money(r.tabsCleared) + ' role(s), ' + money(r.approversCleared) + ' approver(s), ' + money(r.codesCleared) + ' supervisor(s).'
          + (r.note ? ' ⚠️ ' + r.note : ''), !!r.note);
        render();
      })
      .catch(function(e){ b.disabled = false; toast(String(e.message||e), true); });
  };
  var u = document.getElementById('undoApprovals');
  if (u) u.onclick = function(){
    if (!confirm('Rudisha uidhinishaji wote kama ulivyokuwa kabla ya "Futa uidhinishaji"?\n\nPut every approval, approver and supervisor back as it was before "Clear approvals"?')) return;
    u.disabled = true;
    srv('resetApprovals', { undo: true })
      .then(function(r){ toast('Imerudishwa: nafasi ' + money(r.roles) + ', misimbo ' + money(r.codes) + '. / Restored ' + money(r.roles) + ' role(s) and ' + money(r.codes) + ' code(s).'); render(); })
      .catch(function(e){ u.disabled = false; toast(String(e.message||e), true); });
  };
}

function wireClean(){
  var run = document.getElementById('clRun'), chk = document.getElementById('clCheck');
  if (!run && !chk) return;
  var chosen = function(){
    return Array.prototype.filter.call(document.querySelectorAll('.clType'), function(c){ return c.checked; })
      .map(function(c){ return c.value; });
  };
  var out = document.getElementById('clOut');
  var say = function(html, bad){ out.style.display='block'; out.className = 'note'+(bad?' bad':''); out.innerHTML = html; };
  // Ten report types is too many to tick one by one when the answer is usually "all of them".
  var setAll = function(on){
    Array.prototype.forEach.call(document.querySelectorAll('.clType'), function(c){ c.checked = on; });
  };
  var all = document.getElementById('clAll'), none = document.getElementById('clNone');
  if (all) all.onclick = function(){ setAll(true); };
  if (none) none.onclick = function(){ setAll(false); };
  var call = function(dryRun){
    var types = chosen();
    if (!types.length){ say('Chagua angalau aina moja ya ripoti. / Choose at least one report type.', true); return; }
    var date = document.getElementById('clDate').value;
    var through = document.getElementById('clThrough').checked;
    srv('purgeSnapshots', { date: date, types: types, through: through, dryRun: dryRun })
      .then(function(r){
        // Only name the reports that actually had something. A line listing eight zeroes buries
        // the one number that mattered.
        var hits = Object.keys(r.deleted).filter(function(k){ return r.deleted[k] > 0; });
        var detail = hits.length
          ? hits.map(function(k){ return k+': '+money(r.deleted[k]); }).join(' · ')
          : 'hakuna kitu kwa tarehe hiyo / nothing stored for that date';
        var kept = r.protectedRows
          ? '<br><span style="color:var(--mut)">' + money(r.protectedRows)
            + ' iliyoandikwa ndani ya mfumo imeachwa / typed inside the app, left alone</span>'
          : '';
        /* What ELSE goes. Removing a customer from the follow-up list takes their whole
           comment history with them, and a cascade discovered afterwards is the worst kind of
           surprise in a system holding the company's follow-up record. Said in red, before. */
        var extra = '';
        Object.keys(r.cascaded || {}).forEach(function(k){
          var c = r.cascaded[k];
          if (c.rows) extra += '<br><span style="color:var(--bad)"><b>' + money(c.rows) + '</b> '
            + esc(c.label) + ' zitaondoka pamoja nao / go with them</span>';
          if (c.stillDefaulters) extra += '<br><span style="color:var(--bad)"><b>' + money(c.stillDefaulters)
            + '</b> kati yao bado ni wadaiwa hai / of these are still live defaulters</span>';
        });
        if (dryRun){
          say('<b>'+money(r.total)+'</b> rows would be deleted for <b>'+esc(r.date)+'</b>'
            + (r.through?' and everything before it':'') + '.<br>'+esc(detail) + kept + extra);
        } else {
          say('<b>'+money(r.total)+'</b> rows deleted. '+esc(detail) + kept + extra);
          S.storage = null; render({ force:true });
        }
      })
      .catch(function(e){ say(esc(String(e.message || e)), true); });
  };
  if (chk) chk.onclick = function(){ call(true); };
  if (run) run.onclick = function(){
    var types = chosen(), date = document.getElementById('clDate').value;
    var through = document.getElementById('clThrough').checked;
    if (!types.length){ say('Chagua angalau aina moja ya ripoti. / Choose at least one report type.', true); return; }
    var warn = types.indexOf('followup') >= 0
      ? '\n\nONYO / WARNING: "Follow-up list" huondoa wateja NA maoni yao yote.'
        + ' / removes customers AND every comment ever written about them.'
      : '';
    if (!confirm('Futa ' + types.join(', ') + ' ya ' + date
      + (through ? ' na zote za kabla yake' : '') + '?\n\nHistoria ya siku hiyo itapotea. / That day’s history will be gone.'
      + warn)) return;
    call(false);
  };

  var fuListSave = document.getElementById('fuListSave'), fuListOut = document.getElementById('fuListOut');
  if (fuListSave) fuListSave.onclick = function(){
    fuListOut.style.display = 'block'; fuListOut.className = 'note';
    fuListOut.textContent = 'Inahifadhi\u2026';
    srv('fuStatusesSave', { list: document.getElementById('fuList').value })
      .then(function(f){
        FU_STATUSES = f.fuStatuses; FU_NEED_DATE = f.fuNeedDate || [];
        FU_NEED_NUMBER = f.fuNeedNumber || []; S.fuMeta = f;
        fuListOut.innerHTML = '<b>' + f.fuStatuses.length + '</b> hali zimehifadhiwa. / statuses saved.'
          + ' Simu zitapata orodha hii mara moja. / The phones get this list at once.';
        toast('Imehifadhiwa. / Saved.');
      })
      .catch(function(e){ fuListOut.className = 'note bad'; fuListOut.textContent = String(e.message || e); });
  };

  var hintTimingSave = document.getElementById('hintTimingSave'), hintTimingOut = document.getElementById('hintTimingOut');
  if (hintTimingSave) hintTimingSave.onclick = function(){
    var every = Math.max(30, parseInt(document.getElementById('hintEvery').value, 10) || 240);
    var hold = Math.max(3, parseInt(document.getElementById('hintHold').value, 10) || 7);
    hintTimingOut.style.display = 'block'; hintTimingOut.className = 'note';
    hintTimingOut.textContent = 'Inahifadhi…';
    Promise.all([
      srv('settingSet', { key: 'HINT_EVERY_SEC', value: String(every) }),
      srv('settingSet', { key: 'HINT_HOLD_SEC', value: String(hold) }),
    ]).then(function(){
      hintTimingOut.innerHTML = 'Imehifadhiwa. Simu zitapata muda huu mara moja.'
        + ' / Saved. Every screen picks this up on its next tip load.';
      toast('Imehifadhiwa. / Saved.');
    }).catch(function(e){ hintTimingOut.className = 'note bad'; hintTimingOut.textContent = String(e.message || e); });
  };

  wireSettingsPreview_();
  SETTINGS_GROUPS.forEach(function(g){
    var btn = document.getElementById('cfgSave_' + g.id), out = document.getElementById('cfgOut_' + g.id);
    if (!btn) return;
    btn.onclick = function(){
      out.style.display = 'block'; out.className = 'note'; out.textContent = 'Inahifadhi…';
      Promise.all(g.fields.map(function(f){
        return srv('settingSet', { key: f.key, value: document.getElementById('cfg_' + f.key).value.trim() });
      })).then(function(){
        out.textContent = 'Imehifadhiwa. / Saved.';
        toast('Imehifadhiwa. / Saved.');
      }).catch(function(e){ out.className = 'note bad'; out.textContent = String(e.message || e); });
    };
  });

  /* CHANGING YOUR OWN CODE. It signs you back in with the new one straight away -- the browser
     is holding the old code, and a save that quietly left it holding a dead one would look
     exactly like the change having failed. */
  var pwSave = document.getElementById('pwSave'), pwOut = document.getElementById('pwOut');
  if (pwSave) pwSave.onclick = function(){
    var oldC = document.getElementById('pwOld').value.trim();
    var newC = document.getElementById('pwNew').value.trim();
    var newC2 = document.getElementById('pwNew2').value.trim();
    pwOut.style.display = 'block'; pwOut.className = 'note'; pwOut.textContent = 'Inahifadhi\u2026';
    srv('changeMyCode', { oldCode: oldC, newCode: newC, confirmCode: newC2 })
      .then(function(r){
        store('hopeCode', r.code);
        S.code = r.code;
        pushOfficerCode_(r.code);
        pwOut.className = 'note';
        pwOut.innerHTML = 'Msimbo umebadilishwa. / Code changed. '
          + '<b>Uandike mahali salama.</b> / <b>Write it down somewhere safe.</b>';
        document.getElementById('pwOld').value = '';
        document.getElementById('pwNew').value = '';
        document.getElementById('pwNew2').value = '';
        toast('Msimbo umebadilishwa. / Code changed.');
      })
      .catch(function(e){ pwOut.className = 'note bad'; pwOut.textContent = String(e.message || e); });
  };
}
