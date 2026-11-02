/* checklist -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every function
   here is a global exactly as it would be inside app.html, and it may use any helper the core
   page defines. Bump `var BUILD` in app.html whenever this file changes -- the loader fetches
   it as /mod/checklist.js?v=BUILD. */

/* =====================================================================================
   DAILY CHECKLIST -- the window a leader works, and the editor the GM manages it from.

     "MONDAY | ACTIVITY | CHECKBOX  CutOff 00:00 HRS | CAMERA (icon) & View Button --
      Thats how implementation of the window they work on should be for leaders at a tab
      'Daily Checklist' ... I should be able to manage tasks per role at my bonasi tab"

   THE WINDOW (VIEWS.checklist): the weekday as its heading, then one row per task the GM set
   for this person's ROLE on this weekday -- the activity, a checkbox with its cut-off beside
   it, a camera that opens the phone's camera inside the app, and a View that opens the photo.
   Ticks and photos are stamped by the SERVER, so a phone clock set back changes nothing; a
   tick after the cut-off is kept and marked late. Today is worked; an earlier day is read.
   Somebody holding the Daily Bonus Plan tab (the GM) also gets a board of everybody's day.

   THE EDITOR (ckPlanCard_, drawn at the top of the Daily Bonus Plan tab): pick a role, pick a
   weekday, list the tasks with their cut-offs, Save. One role's week is saved whole.

   Server: api/_lib/checklist.js. Table: checklist_entries (RUN-ME-048); the plan is a setting.
   ===================================================================================== */
var CK = { plan: null, roles: [], role: '', day: 'MON', days: null, dirty: false };
var CK_WEEKDAYS = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
var CK_DAY = { MON:'Jumatatu / MONDAY', TUE:'Jumanne / TUESDAY', WED:'Jumatano / WEDNESDAY', THU:'Alhamisi / THURSDAY',
  FRI:'Ijumaa / FRIDAY', SAT:'Jumamosi / SATURDAY', SUN:'Jumapili / SUNDAY' };
var CK_PHOTO_MAX = 200*1024;

function ckHm_(iso){                 // the server's stamp, shown on the EAT clock
  if (!iso) return '';
  var t = Date.parse(iso); if (!isFinite(t)) return '';
  var d = new Date(t + 3*60*60*1000);
  return ('0'+d.getUTCHours()).slice(-2) + ':' + ('0'+d.getUTCMinutes()).slice(-2);
}
function ckCutoff_(c){ return (!c || c==='00:00') ? 'Siku nzima / all day' : 'CutOff ' + c + ' HRS'; }

/* ------------------------------------------------------------------ the window */
function ckRowHtml_(r, today){
  var tick = '<label class="chk" style="margin:0;gap:8px"><input type="checkbox" data-ck-item="'+esc(r.id)+'"'
    + (r.ticked?' checked':'') + (today?'':' disabled') + ' onchange="ckTick_(this)">'
    + '<span class="mut" style="font-size:11.5px;font-weight:500">'+esc(ckCutoff_(r.cutoff))+'</span></label>'
    + '<div data-ck-stamp="'+esc(r.id)+'" style="font-size:11px;margin-top:3px">' + ckStampHtml_(r) + '</div>';
  var cam = today
    ? '<label class="btn sm ghost" title="Piga picha / Take a photo" style="cursor:pointer">&#128247;'
      + '<input type="file" accept="image/*" capture="environment" data-ck-item="'+esc(r.id)+'" onchange="ckPhotoPick_(this)" style="display:none"></label> '
    : '';
  var view = '<button class="btn sm" data-ck-view="'+esc(r.id)+'" data-entry="'+esc(r.entry_id||'')+'"'
    + (r.photo?'':' disabled') + ' onclick="ckView_(this)" title="Ona picha / View the photo">&raquo; View</button>'
    + '<div data-ck-photo="'+esc(r.id)+'" class="mut" style="font-size:11px;margin-top:3px">' + ckPhotoHtml_(r) + '</div>';
  return '<tr><td style="text-align:left;white-space:normal;min-width:220px">'+esc(r.activity)+'</td>'
    + '<td style="text-align:left">'+tick+'</td><td style="text-align:left;white-space:nowrap">'+cam+view+'</td></tr>';
}
function ckStampHtml_(r){
  if (!r.ticked) return '<span class="mut">haijatikiwa / not ticked</span>';
  return '<span class="chip '+(r.late?'bad':'ok')+'">'+(r.late?'imechelewa / late':'kwa wakati / on time')+' · '+ckHm_(r.ticked_at)+'</span>';
}
function ckPhotoHtml_(r){
  return r.photo ? 'picha / photo ' + ckHm_(r.photo_at) + (r.photo_bytes ? ' · ' + Math.round(r.photo_bytes/1024) + 'KB' : '') : 'hakuna picha / no photo';
}

VIEWS.checklist = function(){
  return srv('checklist', { date: S.args.date || '' }).then(function(d){
    var head = '<div class="card"><div class="card-h" style="font-size:16px;letter-spacing:.04em">'+esc(CK_DAY[d.weekday]||d.weekday)
      + '<span class="sub">'+esc(d.date)+' · '+esc(d.role)+' · '+esc(d.name)+' · saa ya seva / server time '+esc(d.serverTime)+'</span></div>'
      + bar('<label style="font-size:12px;color:var(--mut)">Siku / Day</label>'
        + '<input type="date" data-arg="date" value="'+esc(d.date)+'" max="'+esc(d.date > (S.args.date||'') ? d.date : d.date)+'">'
        + (d.today ? '' : '<span class="chip mut">siku iliyopita — kusoma tu / an earlier day, read only</span>'))
      + '<div class="kpis">'
      + kpi('Kazi / Tasks', money(d.rows.length), 'za '+esc(d.role)+' siku hii')
      + kpi('Zimetikiwa / Ticked', money(d.done), null, d.rows.length && d.done===d.rows.length ? 'good' : '')
      + kpi('Zimechelewa / Late', money(d.late), null, d.late?'bad':'')
      + kpi('Picha / Photos', money(d.photos))
      + '</div>'
      + (d.notReady ? '<div class="note bad">'+esc(d.notReadyNote||'')+'</div>' : '')
      + (!d.planned ? '<div class="note">Hakuna kazi zilizowekwa kwa <b>'+esc(d.role)+'</b> siku ya '+esc(CK_DAY[d.weekday]||d.weekday)+'.'
          + ' / No tasks are set for this role on this weekday — they are set per role on the <b>Daily Bonus Plan</b> tab.</div>' : '')
      + '<div class="scroll2" style="overflow-x:auto"><table class="bpt" style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>'
      + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)">ACTIVITY / KAZI</th>'
      + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)">CHECKBOX</th>'
      + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)">CAMERA &amp; VIEW</th></tr></thead>'
      + '<tbody class="ckt">' + d.rows.map(function(r){ return ckRowHtml_(r, d.today); }).join('') + '</tbody></table></div>'
      + '<div class="mut" style="padding:8px 14px 12px;font-size:12px">Tiki na picha zinapigwa muhuri na seva, si saa ya simu. Baada ya saa ya mwisho tiki inakubaliwa lakini inaandikwa <b>imechelewa</b>. '
      + '/ Ticks and photos are stamped by the server, not the phone. A tick after the cut-off is kept and marked <b>late</b>.</div>'
      + '</div>';
    if (d.board) {
      head += board('ckBoard', 'Siku ya kila kiongozi / Everybody’s day', esc(d.date) + ' · ' + money(d.board.length) + ' people',
        d.board,
        [col('name','Name'), col('role','Role'), col('done','Ticked','num'),
         {key:'missing', label:'Not ticked', kind:'num', cls:function(r){ return r.missing>0?'bad':''; }},
         {key:'late', label:'Late', kind:'num', cls:function(r){ return r.late>0?'bad':''; }},
         col('photos','Photos','num'),
         {key:'last', label:'Last tick', get:function(r){ return ckHm_(r.last); }}],
        {name:'', role:'', done:d.board.reduce(function(s,r){ return s+r.done; },0), missing:d.board.reduce(function(s,r){ return s+r.missing; },0),
         late:d.board.reduce(function(s,r){ return s+r.late; },0), photos:d.board.reduce(function(s,r){ return s+r.photos; },0), last:''});
    }
    HEAD = head;
    S.rows = []; S.cols = []; ONROW = null;
    S.foot = esc(CK_DAY[d.weekday]||d.weekday) + ' · ' + money(d.done) + ' / ' + money(d.rows.length) + ' ticked';
  });
};

function ckTick_(el){
  var item = el.getAttribute('data-ck-item'), on = !!el.checked;
  el.disabled = true;
  srv('checklistTick', { item_id: item, on: on }).then(function(r){
    el.checked = !!r.ticked;
    var st = document.querySelector('[data-ck-stamp="'+item+'"]'); if (st) st.innerHTML = ckStampHtml_(r);
    var v = document.querySelector('[data-ck-view="'+item+'"]'); if (v) { v.setAttribute('data-entry', r.entry_id||''); v.disabled = !r.photo; }
    toast(r.ticked ? (r.late ? 'Imetikiwa — baada ya saa ya mwisho / Ticked, after the cut-off' : 'Imetikiwa / Ticked') : 'Tiki imeondolewa / Untick saved');
  }).catch(function(e){ el.checked = !on; toast(String(e.message||e), true); })
    .then(function(){ el.disabled = false; });
}

/* THE PHOTO IS SHRUNK ON THE PHONE before it goes anywhere -- a camera shot is 3-8MB. Drawn on
   a canvas at a long side of 1024px as JPEG 0.6, smaller again until it fits the server's
   200KB. Modern WebViews turn the picture the right way up themselves (image-orientation:
   from-image); the receipt code in mod/imprest.js reads the EXIF tag for older ones -- this
   screen does not, so on a WebView older than Chromium 81 a sideways photo stays sideways. */
function ckLoadImage_(file){
  return new Promise(function(res, rej){
    var fr = new FileReader();
    fr.onerror = function(){ rej(new Error('Picha haikusomeka. / Could not read the photo.')); };
    fr.onload = function(){
      var img = new Image();
      img.onerror = function(){ rej(new Error('Faili si picha. / That file is not an image.')); };
      img.onload = function(){ res(img); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function ckBytes_(u){ var i = String(u||'').indexOf(','); if (i<0) return 0; var b = u.slice(i+1), p = b.slice(-2)==='=='?2:b.slice(-1)==='='?1:0; return Math.floor(b.length*3/4)-p; }
function ckShrink_(file){
  var steps = [[1024,0.6],[800,0.5],[640,0.42],[480,0.35]];
  return ckLoadImage_(file).then(function(img){
    var w = img.naturalWidth||img.width, h = img.naturalHeight||img.height;
    if (!w || !h) throw new Error('Faili si picha. / That file is not an image.');
    for (var i=0;i<steps.length;i++){
      var sc = Math.min(1, steps[i][0]/Math.max(w,h,1)), cw = Math.max(1,Math.round(w*sc)), ch = Math.max(1,Math.round(h*sc));
      var c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var ctx = c.getContext('2d'); if (!ctx) throw new Error('Simu haina kumbukumbu ya kutosha. / The phone ran out of memory.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,cw,ch); ctx.drawImage(img,0,0,cw,ch);
      var u = c.toDataURL('image/jpeg', steps[i][1]);
      if (ckBytes_(u) <= CK_PHOTO_MAX) return u;
    }
    throw new Error('Picha ni kubwa mno hata baada ya kupunguzwa. / The photo is too large even after shrinking.');
  });
}
function ckPhotoPick_(inp){
  var item = inp.getAttribute('data-ck-item'), f = inp.files && inp.files[0];
  if (!f) return;
  var ph = document.querySelector('[data-ck-photo="'+item+'"]');
  if (ph) ph.textContent = 'inapunguzwa… / shrinking…';
  ckShrink_(f).then(function(u){
    if (ph) ph.textContent = 'inatumwa… / sending…';
    return srv('checklistPhoto', { item_id: item, photo: u });
  }).then(function(r){
    if (ph) ph.innerHTML = ckPhotoHtml_(r);
    var v = document.querySelector('[data-ck-view="'+item+'"]'); if (v) { v.setAttribute('data-entry', r.entry_id||''); v.disabled = false; }
    var st = document.querySelector('[data-ck-stamp="'+item+'"]'); if (st) st.innerHTML = ckStampHtml_(r);
    toast('Picha imehifadhiwa / Photo saved ' + ckHm_(r.photo_at));
  }).catch(function(e){
    if (ph) ph.textContent = String(e.message||e);
    toast(String(e.message||e), true);
  }).then(function(){ inp.value = ''; });
}
function ckView_(btn){
  var id = btn.getAttribute('data-entry');
  if (!id) { toast('Hakuna picha bado. / No photo yet.', true); return; }
  drawer('<h3>Picha / Photo</h3><div class="sk"></div>');
  srv('checklistPhotoGet', { entry_id: id }).then(function(d){
    var ok = /^data:image\/(jpeg|jpg|png|webp);base64,/.test(String(d.photo||''));
    drawer('<h3>Picha / Photo</h3>'
      + '<div style="font-size:12.5px;margin-bottom:8px"><b>'+esc(d.activity)+'</b><br>'+esc(d.name)+' · '+esc(d.role)+' · '+esc(d.day)
      + '<br>Picha / photo: <b>'+esc(ckHm_(d.photo_at))+'</b>'
      + (d.ticked_at ? ' · tiki / tick: <b>'+esc(ckHm_(d.ticked_at))+'</b>'+(d.late?' <span class="chip bad">imechelewa / late</span>':' <span class="chip ok">kwa wakati / on time</span>') : ' · haijatikiwa / not ticked')
      + ' · ' + esc(ckCutoff_(d.cutoff)) + '</div>'
      + (ok ? '<img src="'+esc(d.photo)+'" alt="picha" style="max-width:100%;border-radius:8px;border:1px solid var(--line)">'
            + '<div class="mut" style="font-size:10px">'+Math.round((d.photo_bytes||0)/1024)+'KB · muhuri wa seva / server stamp</div>'
          : '<div class="mut">Hakuna picha. / No photo.</div>'), { wide: true });
  }).catch(function(e){ drawer('<div class="msg bad">'+esc(String(e.message||e))+'</div>'); });
}

/* ------------------------------------------------------------------ the editor (Daily Bonus Plan tab) */
function ckPlanLoad_(){
  return srv('checklistPlan').then(function(d){
    CK.plan = d.plan || { roles: {} }; CK.roles = d.roles || [];
    if (!CK.role || CK.roles.indexOf(CK.role) < 0) CK.role = CK.roles[0] || '';
    CK.days = null; CK.dirty = false;
    return ckPlanCard_();
  });
}
function ckDays_(){
  if (!CK.days) {
    var src = (CK.plan && CK.plan.roles && CK.plan.roles[CK.role]) || {};
    CK.days = {};
    CK_WEEKDAYS.forEach(function(wd){ CK.days[wd] = (src[wd]||[]).map(function(it){ return { id: it.id, activity: it.activity, cutoff: it.cutoff }; }); });
  }
  return CK.days;
}
function ckPlanCard_(){
  return '<div class="card" id="ckPlan">' + ckPlanInner_() + '</div>';
}
function ckPlanInner_(){
  var days = ckDays_(), list = days[CK.day] || [];
  var rows = list.map(function(it, i){
    return '<tr><td style="text-align:left;white-space:normal;width:60%"><input type="text" value="'+esc(it.activity)+'" maxlength="160" placeholder="mf. Ukaguzi wa gari" '
      + 'style="width:100%;text-align:left" oninput="ckEdit_('+i+',\'activity\',this.value)"></td>'
      + '<td><input type="time" value="'+esc(it.cutoff||'00:00')+'" style="width:110px" onchange="ckEdit_('+i+',\'cutoff\',this.value)"></td>'
      + '<td><button class="btn sm ghost danger" title="Ondoa / Remove" onclick="ckRemove_('+i+')">&times;</button></td></tr>';
  }).join('');
  return '<div class="card-h">Kazi za kila siku kwa wadhifa / Daily Checklist tasks per role'
    + '<span class="sub">zinaonekana kwenye tab ya Daily Checklist kwa kila kiongozi wa wadhifa huo · shown on the Daily Checklist tab to every leader of that role</span></div>'
    + '<div class="cfg" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:12px 14px;align-items:end">'
    + '<div class="fld" style="margin:0"><label>Wadhifa / Role</label><select onchange="ckRole_(this.value)">'
      + (CK.roles.length ? CK.roles.map(function(r){ return '<option'+(r===CK.role?' selected':'')+'>'+esc(r)+'</option>'; }).join('')
                         : '<option value="">— hakuna wadhifa / no roles yet —</option>')
      + '</select></div>'
    + '<div class="fld" style="margin:0"><label>Siku / Weekday</label><div class="pills" style="padding:0">'
      + CK_WEEKDAYS.map(function(wd){ var n = (days[wd]||[]).length;
          return '<button class="pill'+(wd===CK.day?' on':'')+'" onclick="ckDay_(\''+wd+'\')">'+wd+(n?' <b>('+n+')</b>':'')+'</button>'; }).join('')
      + '</div></div></div>'
    + '<div class="scroll2" style="overflow-x:auto;padding:0 14px"><table class="bpt" style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr>'
    + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)">ACTIVITY / KAZI — '+esc(CK_DAY[CK.day]||CK.day)+'</th>'
    + '<th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)">CutOff (HRS)</th><th></th></tr></thead>'
    + '<tbody>' + (rows || '<tr><td colspan="3" class="mut" style="padding:8px">Hakuna kazi siku hii. / No tasks on this day yet.</td></tr>') + '</tbody></table></div>'
    + '<div style="padding:10px 14px 12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    + '<button class="btn sm ghost" onclick="ckAdd_()">+ Ongeza kazi / Add task</button>'
    + '<button class="btn sm" onclick="ckSave_(this)"'+(CK.role?'':' disabled')+'>Hifadhi wiki ya '+esc(CK.role||'—')+' / Save this role’s week</button>'
    + (CK.dirty ? '<span class="chip warn">haijahifadhiwa / unsaved</span>' : '')
    + '<span class="mut" style="font-size:12px">00:00 = siku nzima, hakuna saa ya mwisho. Wiki nzima ya wadhifa huhifadhiwa pamoja. / 00:00 means all day, no cut-off. The whole week of the role is saved together.</span>'
    + '</div>';
}
function ckRedraw_(){ var el = document.getElementById('ckPlan'); if (el) el.innerHTML = ckPlanInner_(); }
function ckRole_(r){
  if (CK.dirty && !confirm('Mabadiliko ya '+CK.role+' hayajahifadhiwa. Yaache? / Unsaved changes for '+CK.role+'. Discard them?')) { ckRedraw_(); return; }
  CK.role = r; CK.days = null; CK.dirty = false; ckRedraw_();
}
function ckDay_(wd){ CK.day = wd; ckRedraw_(); }
function ckEdit_(i, k, v){ var l = ckDays_()[CK.day]; if (l && l[i]) { l[i][k] = v; CK.dirty = true; } }
function ckAdd_(){ ckDays_()[CK.day].push({ id: '', activity: '', cutoff: '00:00' }); CK.dirty = true; ckRedraw_(); }
function ckRemove_(i){ ckDays_()[CK.day].splice(i, 1); CK.dirty = true; ckRedraw_(); }
function ckSave_(btn){
  if (!CK.role) return;
  btn.disabled = true;
  srv('checklistPlanSave', { role: CK.role, days: ckDays_() }).then(function(d){
    CK.plan = d.plan || CK.plan; CK.days = null; CK.dirty = false; ckRedraw_();
    var n = CK_WEEKDAYS.reduce(function(s,wd){ return s + ((d.days||{})[wd]||[]).length; }, 0);
    toast('Imehifadhiwa: kazi '+n+' kwa '+CK.role+' / Saved: '+n+' tasks for '+CK.role);
  }).catch(function(e){ btn.disabled = false; toast(String(e.message||e), true); });
}
