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
  drawer('<h3>'+(isNew?'Wadhifa mpya / New role':esc(x.role))+'</h3>'
    + '<div class="sub">Msimbo wenye orodha tupu ya tabs hurithi hii. / A code with a blank tab list inherits this one.</div>'
    + '<div class="fld"><label>Wadhifa / Role</label><input id="rName" value="'+esc(x?x.role:'')+'"'+(isNew?'':' readonly')+'></div>'
    /* TWO LISTS, EACH UNDER ITS OWN NAME. One flat run of words put `gmo`, `manager`, `team`,
       `finance`, `gm` and `customer_service` beside `dashboard` and `followup` with nothing
       to say the first six open HOPE LOAN -- so a role called GMO got `gmo` ticked, a manager
       got `manager`, and each found a second system in their sidebar. Every box now says
       which system it opens and which screens. */
    + '<div class="fld"><label>Tabs — HOPE PMO</label><div class="checks">'
    + all.filter(function(t){ return !isLoanTab_(t); }).map(function(t){ return tabTick_(t, have); }).join('')
    + '</div></div>'
    + '<div class="fld"><label>Tabs — HOPE Loan</label>'
    + '<div class="fldnote">Hizi hufungua HOPE LOAN, si skrini za HOPE PMO. / These open HOPE LOAN screens, not HOPE PMO ones.</div>'
    + '<div class="checks">'
    + all.filter(isLoanTab_).map(function(t){ return tabTick_(t, have); }).join('')
    + '</div></div>'
    + '<button class="btn w" id="rSave">Hifadhi / Save</button>'
    + (isNew ? '' : '<button class="btn ghost w" style="margin-top:8px;color:var(--bad);border-color:var(--badline)" id="rDel">Futa / Delete role</button>'));
  $('#rSave').onclick = function(){
    var tabs = Array.prototype.filter.call(document.querySelectorAll('.rTab'), function(c){ return c.checked; })
      .map(function(c){ return c.value; }).join(',');
    srv('saveRole', { role: $('#rName').value.trim(), tabs: tabs })
      .then(function(){ toast('Imehifadhiwa. / Saved.'); closeDrawer(); render(); })
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
        + ' <button class="btn sm" id="newRole">+ Wadhifa mpya / New role</button></span></div>'
        + '<div class="note" style="margin:10px 14px">Bofya wadhifa kuchagua tabs zake. Kila msimbo wenye wadhifa huu hurithi orodha hii.'
        + ' / Tap a role to tick its tabs. Every access code with that role inherits this list.'
        /* "Start with empty accessible navs for all roles except all for ADMIN so that i go
           set well now : i fear running into errors" -- so the button says what it does, what
           it keeps, and that it can be taken back, before it is pressed. */
        + '<br><b>Anza upya</b> huondoa tabs zote kwa nafasi zote (ADMIN inabaki na zote) ili uanze kupanga upya &mdash; hali ya sasa inahifadhiwa na <b>Rudisha</b> inairejesha.'
        + ' / <b>Start empty</b> clears every role\'s tabs (ADMIN keeps all of them) so you can set them deliberately. The current state is saved first, and <b>Undo</b> puts it back.</div>'
        + '<div class="scroll"><table><thead><tr><th class="sn">S/N</th><th>Wadhifa / Role</th>'
        + '<th>Tabs</th><th class="r">Idadi</th><th class="r">Misimbo / Codes</th><th></th></tr></thead><tbody>'
        + (ac.roles||[]).map(function(r, i){
            var n = (ac.rows||[]).filter(function(x){ return String(x.role||'').toUpperCase() === String(r.role||'').toUpperCase(); }).length;
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
              + '<td class="r">'+money(n)+'</td>'
              + '<td class="r"><button class="btn sm ghost" data-role="'+esc(r.role)+'">Badili / Edit</button></td></tr>';
          }).join('') + '</tbody></table></div></div>'

      + '<div class="card"><div class="card-h">Misimbo ya kuingia / Access codes'
        + '<span class="sub"><button class="btn sm" id="newCode">+ Msimbo mpya / New code</button>'
        + ' <a href="/upload?admin=1" style="margin-left:8px">Pakia orodha / Upload a list &rarr;</a></span></div>'
      + '<div class="scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Teams</th><th>Code</th><th></th></tr></thead><tbody>'
      + ac.rows.map(function(x, i){
          return '<tr><td>'+esc(x.name)+'</td><td>'+esc(x.role)+'</td>'
            + '<td>'+esc(x.teams?x.teams.join(', '):'ALL')+'</td>'
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
    srv('saveAccessCode', { code:document.getElementById('kCode').value.trim(), oldCode:(x?x.code:''), name:document.getElementById('kName').value.trim(),
      role:document.getElementById('kRole').value.trim(), teams:document.getElementById('kTeams').value.trim(),
      tabs:tabs })
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
        toast(msg); closeDrawer(); render();
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
