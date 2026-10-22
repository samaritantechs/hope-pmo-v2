/* imprest -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/imprest.js?v=BUILD. */

/* =====================================================================================
   IMPREST -- ask, decide, fund, retire, review.
   =====================================================================================
     "our office and field staff always make imprest requests as implemented in Hoop ...
      implement request, approval and report and i'll grant the navs to those responsible ...
      so these people see their history and everything but gm gets email that has the
      details and two links (single tap approval and disapproval or read) ... so we use the
      new way but the accountant infos are no longer there for requesting but they will just
      update funded amount in imprest report tab"
     "so we'll have dashboards of applications per signed in user, and overall in reports"

   Three panes sharing one costed-trip shape: Omba Imprest (impreq, a personal dashboard over
   the requester's OWN history plus the form), Idhini ya Imprest (impappr, the GM's queue and
   the accommodation-rate table), Ripoti ya Imprest (imprep, the whole-company dashboard, and
   where the accountant writes what was actually funded). The GM can also decide straight from
   the emailed one-tap link -- see api/imprest-action.js -- without ever opening this page;
   both paths write through the same imprestDecide on the server. */
function imprestNotReady_(){
  return '<div class="note bad">Jedwali la imprest halijatengenezwa bado. Endesha '
    + '<b>db/RUN-ME-031-imprest.sql</b> kwenye Supabase, kisha rudi hapa. '
    + '/ The imprest tables have not been created yet — run that migration, then come back.</div>';
}

/* ONE VOCABULARY FOR THE STATE, everywhere a status is shown -- the request pane's history,
   the GM's queue, the report. A retired trip is still "approved" in status; retirement is a
   second fact shown beside it. */
function imprestChipCls_(r){
  if (r.status==='approved') return r.retiredAt ? 'ok' : 'warn';
  if (r.status==='rejected') return 'bad';
  return 'mut';
}

function imprestChipText_(r){
  var s = r.status==='approved' ? 'Imeidhinishwa / Approved' + (r.approved!=null && r.approved!==r.total ? ' · ' + money(r.approved) : '')
    : r.status==='rejected' ? 'Imekataliwa / Rejected'
    : 'Inasubiri / Pending';
  if (r.retiredAt) s += ' · retired';
  else if (r.status==='approved') s += ' · bila retirement';
  return s;
}

/* THE BALANCE HAS A DIRECTION. Positive means the traveller brings change back; negative means
   the company owes them -- a bare signed number on a cash sheet gets read both ways. */
function imprestBalanceCls_(r){ return r.retireBalance==null ? 'mut' : r.retireBalance>0 ? 'ok' : r.retireBalance<0 ? 'bad' : 'mut'; }

function imprestBalanceText_(r){
  if (r.retireBalance==null) return '—';
  var b = Number(r.retireBalance)||0;
  if (b>0) return money(b) + ' arudishe / to refund';
  if (b<0) return money(-b) + ' alipwe / to reimburse';
  return money(0);
}

function imprestCostingHtml_(r){
  var line = function(k,calc,v){ return '<tr><td>'+k+'</td><td class="mut" style="font-size:11px">'+calc+'</td>'
    + '<td class="r">'+money(v)+'</td></tr>'; };
  var others = [1,2,3].map(function(i){ return { d:r['other'+i+'Desc'], a:r['other'+i+'Amount'] }; })
    .filter(function(o){ return o.a>0 || o.d; });
  return '<table style="width:100%"><tbody>'
    + line('Nauli / Fare', money(r.fareTrips)+' × '+money(r.farePerTrip), r.fareAmount)
    + line('Malazi / Accommodation', money(r.accomDays)+' siku × '+money(r.accomRate)+' ('+esc(r.imprestRole||'')+')', r.accomAmount)
    + others.map(function(o){ return line(esc(o.d||'Nyingine / Other'), '', o.a); }).join('')
    + '<tr><td><b>JUMLA / TOTAL</b></td><td></td><td class="r"><b>'+money(r.total)+'</b></td></tr>'
    + '</tbody></table>';
}

/* THE PHOTOS ARE SHRUNK ON THE PHONE, before they ever reach the server -- a camera shot is
   3-8MB and three of those per trip would fill the table in a month. Redrawn on a canvas at a
   long side of 1024px and saved as JPEG at 0.6 (usually 60-120KB); if that is still over the
   server's 200KB ceiling it is shrunk again, smaller, until it fits. Decoded ONCE regardless of
   how many sizes are tried -- a phone photo is 3000x4000px, and re-decoding it per attempt is
   how a WebView on a 1GB handset gets killed mid-shrink and the typed actuals with it. */
var IMPREST_PHOTO_MAX = 200*1024;

function imprestDataUrlBytes_(u){
  var i = String(u||'').indexOf(',');
  if (i<0) return 0;
  var b64 = u.slice(i+1), pad = b64.slice(-2)==='=='?2:b64.slice(-1)==='='?1:0;
  return Math.floor(b64.length*3/4) - pad;
}

function imprestLoadImage_(file){
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

/* Does this browser turn a photo the right way up by itself? An Android System WebView older
   than Chromium 81 draws the camera's raw pixels sideways and, once re-encoded here, they stay
   sideways for every reader after -- so only a browser that fails this test pays to read the
   EXIF orientation tag itself, below. */
function imprestAutoOrients_(){ try { return !!(window.CSS && CSS.supports && CSS.supports('image-orientation','from-image')); } catch(e){ return false; } }

function imprestPhotoOrientation_(file){
  return new Promise(function(res){
    var jpeg = /jpe?g/i.test((file&&file.type)||'') || /\.jpe?g$/i.test((file&&file.name)||'');
    if (imprestAutoOrients_() || !file || !jpeg) { res(1); return; }
    var fr = new FileReader();
    fr.onerror = function(){ res(1); };
    fr.onload = function(){
      try {
        var v = new DataView(fr.result), n = v.byteLength, o = 2;
        if (n<4 || v.getUint16(0)!==0xFFD8) { res(1); return; }
        while (o+4<=n) {
          var marker = v.getUint16(o); o+=2;
          if (marker===0xFFE1) {
            var start = o+2;
            if (start+6<=n && v.getUint32(start)===0x45786966) {
              var tiff = start+6, little = v.getUint16(tiff)===0x4949;
              var ifd = tiff+v.getUint32(tiff+4, little), count = v.getUint16(ifd, little);
              for (var i=0;i<count;i++){
                var e = ifd+2+i*12; if (e+12>n) break;
                if (v.getUint16(e, little)===0x0112){ var t=v.getUint16(e+8, little); res(t>=1&&t<=8?t:1); return; }
              }
            }
            res(1); return;
          }
          if ((marker&0xFF00)!==0xFF00 || marker===0xFFDA) { res(1); return; }
          o += v.getUint16(o);
        }
      } catch(e) {}
      res(1);
    };
    fr.readAsArrayBuffer(file.slice(0,65536));
  });
}

function imprestDrawScaled_(img, maxPx, q, orient){
  var w = img.naturalWidth||img.width, h = img.naturalHeight||img.height;
  if (!w || !h) throw new Error('Faili si picha. / That file is not an image.');
  var sc = Math.min(1, maxPx/Math.max(w,h,1));
  var cw = Math.max(1,Math.round(w*sc)), ch = Math.max(1,Math.round(h*sc));
  var swap = orient>=5 && orient<=8;
  var c = document.createElement('canvas'); c.width = swap?ch:cw; c.height = swap?cw:ch;
  var ctx = c.getContext('2d');
  if (!ctx) throw new Error('Simu haina kumbukumbu ya kutosha kupunguza picha hii. / The phone ran out of memory shrinking this photo.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);  // a transparent PNG receipt must not turn black as JPEG
  switch(orient){
    case 2: ctx.transform(-1,0,0,1,cw,0); break;
    case 3: ctx.transform(-1,0,0,-1,cw,ch); break;
    case 4: ctx.transform(1,0,0,-1,0,ch); break;
    case 5: ctx.transform(0,1,1,0,0,0); break;
    case 6: ctx.transform(0,1,-1,0,ch,0); break;
    case 7: ctx.transform(0,-1,-1,0,ch,cw); break;
    case 8: ctx.transform(0,-1,1,0,0,cw); break;
  }
  ctx.drawImage(img,0,0,cw,ch);
  return c.toDataURL('image/jpeg', q);
}

function imprestShrinkForReceipt_(file){
  var steps = [[1024,0.6],[800,0.5],[640,0.42],[480,0.35]];
  return Promise.all([imprestLoadImage_(file), imprestPhotoOrientation_(file)]).then(function(r){
    for (var i=0;i<steps.length;i++){
      var u = imprestDrawScaled_(r[0], steps[i][0], steps[i][1], r[1]);
      if (imprestDataUrlBytes_(u) <= IMPREST_PHOTO_MAX) return u;
    }
    throw new Error('Picha ni kubwa mno hata baada ya kupunguzwa. / The photo is too large even after shrinking.');
  });
}

var IMPREST_PAY_MODES = ['MPESA','CRDB','CASH','NMB','AIRTEL MONEY','TIGO PESA','HALOPESA'];

/* THE RECEIPTS, fetched only when somebody asks to see them -- never dragged along with a list. */
function imprestPhotosDrawer_(id){
  drawer('<h3>Picha za risiti / Receipt photos</h3><div class="sk"></div>');
  srv('imprestPhotos', { id: id }).then(function(d){
    var ps = (d.photos||[]).filter(function(p){ return /^data:image\/(jpeg|jpg|png|webp);base64,/.test(String(p.data||'')); });
    drawer('<h3>Picha za risiti / Receipt photos</h3>'
      + (ps.length ? ps.map(function(p){
          return '<div style="margin:8px 0"><img src="'+esc(p.data)+'" alt="risiti '+p.seq+'" '
            + 'style="max-width:100%;border-radius:8px;border:1px solid var(--line)">'
            + '<div class="mut" style="font-size:10px">#'+p.seq+' · '+Math.round((p.bytes||0)/1024)+'KB</div></div>';
        }).join('')
        : '<div class="mut">Hakuna picha. / No photos.</div>'));
  }).catch(function(e){ drawer('<div class="msg bad">'+esc(String(e.message||e))+'</div>'); });
}

/* EVERYTHING ABOUT ONE REQUEST, the way the paper form would read it -- opened by tapping a
   row on any of the three panes. `opts.canRetire` (the requester's own approved, unretired
   trip) and `opts.canFund` (an accountant holding imprep, on an approved row) each add one
   more control at the bottom; neither assumes the other. */
function imprestDetailsDrawer_(r, opts){
  opts = opts || {};
  var kv = function(k,v){ return '<tr><td class="mut" style="font-size:11px;white-space:nowrap">'+k+'</td><td>'+v+'</td></tr>'; };
  var t = r.retirement;
  drawer('<h3>Imprest — '+esc(r.fullName||r.staffName||'')+'</h3>'
    + '<div class="sub"><span class="chip '+imprestChipCls_(r)+'">'+esc(imprestChipText_(r))+'</span></div>'
    + '<table style="width:100%;margin-top:8px"><tbody>'
    + kv('Aliyeomba / Requested by', esc(r.staffName||'—')+' <span class="mut">'+esc(r.staffRole||'')+'</span>')
    + kv('Simu / Mobile', esc(r.mobile||'—'))
    + kv('Jina la akaunti / Recipient', esc(r.recipientName||r.fullName||'—'))
    + kv('Barua pepe / Email', esc(r.email||'—'))
    + kv('Wadhifa / Role', esc(r.imprestRole||'—'))
    + kv('Malipo / Pay mode', esc(r.payMode||'—')+' · '+esc(r.accountNo||'—'))
    + kv('Safari / Travel', esc(r.travelDate||'—')+' · '+esc(r.destination||'—'))
    + kv('Madhumuni / Purpose', '<div style="white-space:pre-wrap">'+esc(r.purpose||'—')+'</div>')
    + '</tbody></table>'
    + '<h4 style="margin:12px 0 4px">Gharama / Costing</h4>'+imprestCostingHtml_(r)
    + (r.status!=='pending'
      ? '<h4 style="margin:12px 0 4px">Uamuzi wa GM / GM decision</h4><div>'
        + (r.approved!=null?'<b>'+money(r.approved)+'</b> · ':'')+esc(imprestChipText_(r))
        + '<div class="mut" style="font-size:11px">'+esc(r.decidedBy||'')
        + (r.decidedViaEmail?' (barua pepe / by email)':'')+'</div>'
        + (r.comment?'<div style="white-space:pre-wrap">'+esc(r.comment)+'</div>':'')+'</div>'
      : '')
    + (r.status==='approved'
      ? '<h4 style="margin:12px 0 4px">Kilicholipwa / Funded</h4><div>'
        + (r.fundedAmount!=null ? '<b>'+money(r.fundedAmount)+'</b> · '+esc(r.fundedBy||'') : '<span class="mut">bado / not yet</span>')+'</div>'
      : '')
    + (r.retiredAt
      ? '<h4 style="margin:12px 0 4px">Retirement</h4>'
        + (t ? '<table style="width:100%"><tbody>'
            + '<tr><td>Nauli / Fare</td><td class="r">'+money(t.fare)+'</td></tr>'
            + '<tr><td>Malazi / Accommodation</td><td class="r">'+money(t.accom)+'</td></tr>'
            + '<tr><td>'+esc(r.other1Desc||'Nyingine 1')+'</td><td class="r">'+money(t.other1)+'</td></tr>'
            + '<tr><td>'+esc(r.other2Desc||'Nyingine 2')+'</td><td class="r">'+money(t.other2)+'</td></tr>'
            + '<tr><td>'+esc(r.other3Desc||'Nyingine 3')+'</td><td class="r">'+money(t.other3)+'</td></tr>'
            + '<tr><td><b>JUMLA HALISI / ACTUAL</b></td><td class="r"><b>'+money(t.total)+'</b></td></tr>'
            + '</tbody></table>'
            + (t.notes?'<div style="white-space:pre-wrap;font-size:12px">'+esc(t.notes)+'</div>':'')
          : '<div>Halisi / Actual: <b>'+money(r.retireTotal||0)+'</b></div>')
        + '<div>Salio / Balance: <span class="chip '+imprestBalanceCls_(r)+'">'+esc(imprestBalanceText_(r))+'</span></div>'
        + '<button class="btn sm ghost" style="margin-top:6px" data-impp="'+esc(r.id)+'">Picha za risiti / Receipt photos</button>'
      : (opts.canRetire && r.mine && r.status==='approved'
          ? '<button class="btn w" style="margin-top:10px" id="imRetireBtn" data-imr-id="'+esc(r.id)+'">Jaza retirement / File retirement</button>'
          : ''))
    + (opts.canFund && r.status==='approved'
      ? '<h4 style="margin:12px 0 4px">Weka kilicholipwa / Record what was funded</h4>'
        + '<div class="fld"><label>Kiasi kilicholipwa (TZS) / Funded amount</label>'
        + '<input type="number" id="imfAmt" min="0" step="1" value="'+(r.fundedAmount!=null?r.fundedAmount:'')+'"></div>'
        + '<button class="btn sm" id="imfSave" data-imf-id="'+esc(r.id)+'">Hifadhi / Save</button>'
      : ''));
  var pb = $('#drawer [data-impp]'); if (pb) pb.onclick = function(){ imprestPhotosDrawer_(r.id); };
  var fs = $('#imfSave');
  if (fs) fs.onclick = function(){
    var b = fs; b.disabled = true;
    srv('imprestFund', { id: fs.getAttribute('data-imf-id'), amount: $('#imfAmt').value })
      .then(function(d){
        toast('Kimehifadhiwa / Saved' + (d && d.pushed ? ' · simu ya mwombaji imearifiwa / requester\'s phone buzzed' : '')
          + (d && d.pushNote ? ' · arifa ya simu: ' + d.pushNote : ''));
        closeDrawer(); render({ force:true });
      })
      .catch(function(e){ b.disabled = false; toast(String(e.message||e), true); });
  };
  var rb = $('#imRetireBtn'); if (rb) rb.onclick = function(){ imprestRetireDrawer_(r); };
}

/* THE RETIREMENT DRAWER. Actuals start at what was asked for -- most trips cost about what
   they were costed at, and the traveller edits the lines that differed. Photos are shrunk AS
   they are chosen, so the size is known before Send rather than discovered by a slow upload. */
var IMPREST_RETIRE_INFLIGHT = {};

function imprestRetireDrawer_(r){
  if (IMPREST_RETIRE_INFLIGHT[r.id]) { toast('Retirement ya safari hii inatumwa bado — subiri ijibiwe. / This retirement is still being sent; wait for the answer.', true); return; }
  var photos = [null,null,null], seq = [0,0,0], pending = 0, invalid = false;
  drawer('<h3>Retirement — '+esc(r.destination||r.travelDate||'')+'</h3>'
    + '<div class="sub">Imeidhinishwa <b>'+money(r.approved||0)+'</b> · safari '+esc(r.travelDate||'')+'</div>'
    + '<div class="mut" style="font-size:11px;margin:4px 0 8px">Andika gharama HALISI ulizotumia, kisha weka picha za risiti (hadi 3). '
    + '/ Enter what you ACTUALLY spent, then attach receipt photos (up to 3).</div>'
    + '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap">'
    + '<div style="flex:1;min-width:120px" class="fld"><label>Nauli / Fare (iliombwa '+money(r.fareAmount)+')</label><input id="irFare" type="number" min="0" step="1" value="'+(r.fareAmount||0)+'"></div>'
    + '<div style="flex:1;min-width:120px" class="fld"><label>Malazi / Accommodation (iliombwa '+money(r.accomAmount)+')</label><input id="irAccom" type="number" min="0" step="1" value="'+(r.accomAmount||0)+'"></div>'
    + '</div>'
    + [1,2,3].map(function(i){
        var dsc = r['other'+i+'Desc'], a = r['other'+i+'Amount']||0;
        return '<div class="fld"><label>'+esc(dsc||('Nyingine '+i+' / Other '+i))+' (iliombwa '+money(a)+')</label>'
          + '<input id="irO'+i+'" type="number" min="0" step="1" value="'+a+'"></div>';
      }).join('')
    + '<div style="display:flex;justify-content:space-between;margin:8px 0 2px"><b>JUMLA HALISI / ACTUAL</b><b id="irTotal">0</b></div>'
    + '<div style="display:flex;justify-content:space-between;margin:0 0 8px"><span>Salio / Balance</span><span id="irBal">—</span></div>'
    + '<div class="fld"><label>Maelezo / Notes</label><textarea id="irNotes" rows="2"></textarea></div>'
    + [1,2,3].map(function(i){
        return '<div class="fld"><label>Picha ya risiti '+i+' / Receipt photo '+i+(i===1?' *':'')+'</label>'
          + '<input id="irP'+i+'" type="file" accept="image/*">'
          + '<div id="irV'+i+'" class="mut" style="font-size:11px;margin:-4px 0 6px"></div></div>';
      }).join('')
    + '<button class="btn w" id="irSend" style="margin-top:10px">Wasilisha retirement / File retirement</button>');
  var num = function(id){ var el=$(id), v=el?el.value:''; if (v===''||v==null) return 0; var n=Number(v);
    if (!isFinite(n)||Math.floor(n)!==n||n<0){ invalid=true; if (el) el.style.borderColor='var(--bad)'; return 0; }
    if (el) el.style.borderColor=''; return n; };
  var gate = function(){ var b=$('#irSend'); if (b) b.disabled = pending>0||invalid; };
  var recalc = function(){
    invalid = false;
    var t = num('#irFare')+num('#irAccom')+num('#irO1')+num('#irO2')+num('#irO3');
    $('#irTotal').textContent = invalid?'—':money(t);
    var bal = (r.approved||0)-t;
    $('#irBal').innerHTML = invalid?'—':('<span class="chip '+(bal>0?'ok':bal<0?'bad':'mut')+'">'
      +money(bal>0?bal:-bal)+(bal>0?' arudishe / refund':bal<0?' alipwe / reimburse':'')+'</span>');
    gate();
  };
  ['#irFare','#irAccom','#irO1','#irO2','#irO3'].forEach(function(id){ var el=$(id); if (el) el.oninput=recalc; });
  recalc();
  [1,2,3].forEach(function(i){
    var inp = $('#irP'+i), v = $('#irV'+i);
    inp.onchange = function(){
      var f = inp.files && inp.files[0];
      var my = ++seq[i-1];
      photos[i-1] = null;
      if (!f) { v.innerHTML=''; gate(); return; }
      pending++; gate();
      v.textContent = 'inapunguzwa… / shrinking…';
      imprestShrinkForReceipt_(f).then(function(u){
        if (my!==seq[i-1]) return;
        photos[i-1] = u;
        v.innerHTML = '<img src="'+esc(u)+'" style="max-height:80px;border-radius:6px;border:1px solid var(--line);margin-top:4px"> '
          + Math.round(imprestDataUrlBytes_(u)/1024)+'KB (ilikuwa '+Math.round(f.size/1024)+'KB)';
      }, function(e){
        if (my!==seq[i-1]) return;
        v.textContent = String(e.message||e); inp.value='';
      }).then(function(){ pending--; gate(); });
    };
  });
  $('#irSend').onclick = function(){
    var b = this;
    var got = photos.filter(Boolean);
    if (!got.length) { toast('Weka angalau picha moja ya risiti. / Attach at least one receipt photo.', true); return; }
    if (got.length<3 && !confirm('Umeweka picha '+got.length+' kati ya 3. Wasilisha hivyo? / Only '+got.length+' of 3 photos. File anyway?')) return;
    b.disabled = true; IMPREST_RETIRE_INFLIGHT[r.id] = true;
    srv('imprestRetire', { id:r.id, fareActual:$('#irFare').value, accomActual:$('#irAccom').value,
      other1Actual:$('#irO1').value, other2Actual:$('#irO2').value, other3Actual:$('#irO3').value,
      notes:$('#irNotes').value, photos:got }).then(function(d){
        delete IMPREST_RETIRE_INFLIGHT[r.id];
        toast('Retirement imewasilishwa · halisi '+money(d.total)+' · salio '+money(d.balance)
          + (d.pushed ? ' · simu ' + d.pushed + ' imearifiwa / phone(s) buzzed' : '')
          + (d.pushNote ? ' · arifa ya simu: ' + d.pushNote : ''));
        closeDrawer(); render({ force:true });
      }, function(e){ delete IMPREST_RETIRE_INFLIGHT[r.id]; b.disabled=false; toast(String(e.message||e), true); });
  };
}

/* ---------- OMBA IMPREST: the requester's own dashboard, the form, then their history ---------- */
VIEWS.impreq = function(){
  return srv('imprestMine', {}).then(function(d){
    if (d.notReady) { HEAD = imprestNotReady_(); S.rows=[]; S.cols=[]; ONROW=null; return; }
    var rows = d.rows||[], roles = d.roles||[];
    /* The signed-in code's own role, and whether the approver has priced it. It is on the box
       either way (below); only the nights wait on a rate. canPrice: the viewer holds the pane
       the rate is set on, so the way out is one tap, not a message to somebody else. */
    var myRole = String(S.me.role||'').trim().toUpperCase();
    var myRow = roles.filter(function(r){ return String(r.role||'').trim().toUpperCase() === myRole; })[0] || null;
    var canPrice = S.me.role === 'ADMIN' || (S.me.tabs||[]).indexOf('impappr') >= 0;
    var appr = rows.filter(function(r){ return r.status==='approved'; });
    var toRetire = appr.filter(function(r){ return !r.retiredAt; });
    var spent = appr.reduce(function(s,r){ return s+(r.retiredAt?(r.retireTotal||0):0); }, 0);
    var toRefund = appr.reduce(function(s,r){ return s+(r.retireBalance!=null&&r.retireBalance>0?r.retireBalance:0); }, 0);
    var blocked = !!(d.unretired && d.unretired.length);
    var flash = S.imqFlash || null; S.imqFlash = null;
    /* THE PERSONAL DASHBOARD -- "dashboards of applications per signed in user". Built here,
       from the same rows the history table below already holds: no second read for it. */
    HEAD = '<div class="kpis">'
      + kpi('Maombi yangu / My requests', money(rows.length))
      + kpi('Yanasubiri / Pending', money(rows.filter(function(r){ return r.status==='pending'; }).length), '', rows.some(function(r){ return r.status==='pending'; })?'warn':'')
      + kpi('Yameidhinishwa / Approved', money(appr.length), money(appr.reduce(function(s,r){ return s+(r.approved||0); },0))+' TZS', 'good')
      + kpi('Bila retirement / Not retired', money(toRetire.length), '', toRetire.length?'warn':'')
      + kpi('Nimetumia / Spent (retired)', money(spent))
      + kpi('Ya kurejeshwa / To refund', money(toRefund), '', toRefund?'good':'')
      + '</div>'
      + (roles.length ? '' : '<div class="note" style="margin:8px 0">Hakuna viwango vya malazi bado: safari bila siku za malazi (nauli, mafuta, chakula) inaombeka sasa; siku za malazi zinasubiri mwidhinishaji aweke kiwango cha wadhifa wako kwenye Idhini ya imprest → Viwango. '
        + '/ No nightly rates yet: a trip without nights (fares, fuel, meals) can be requested now; nights wait for the approver to set your role\'s rate under Imprest approval → Rates.</div>')
      /* ONE IMPREST AT A TIME -- "if one requests and got unretired imprest, tell them to retire
         previous approved imprests first!" The server refuses the request (imprestRequest,
         imprest.js); this says so up front, in the server's own words, and closes the button
         so nobody fills the whole form to be told at the end. The list below is where they
         retire: tap the row, then Retire. */
      + (blocked ? '<div class="note bad" style="margin:8px 0;display:block">⛔ <b>Ombi jipya limefungwa / New requests are closed.</b> '
        + esc(d.unretiredNote || '') + '<br><span style="font-size:11.5px">Bofya ombi hilo kwenye orodha hapa chini &rarr; Retire. '
        + '/ Tap that request in the list below &rarr; Retire.</span></div>' : '')
      + '<div class="card"><div class="card-h">Ombi jipya / New imprest request'
        + '<span class="sub">chanya = gharama halisi / positive costs, seva inahesabu upya kwa kiwango cha wadhifa / the server recomputes at the role\'s own rate</span></div>'
        + '<div class="cleanbox">'
        + '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap">'
        + '<div style="flex:1;min-width:200px" class="fld"><label>Jina kamili / Full name *</label><input id="imqName" value="'+esc(S.me.name||'')+'"></div>'
        + '<div style="flex:1;min-width:160px" class="fld"><label>Simu / Mobile</label><input id="imqMobile" placeholder="07…"></div>'
        + '</div><div class="row" style="display:flex;gap:8px;flex-wrap:wrap">'
        + '<div style="flex:1;min-width:200px" class="fld"><label>Jina la akaunti (kama ni tofauti) / Recipient account name</label><input id="imqRecip"></div>'
        + '<div style="flex:1;min-width:200px" class="fld"><label>Barua pepe yako / Your email *</label><input id="imqEmail" type="email"></div>'
        + '</div><div class="row" style="display:flex;gap:8px;flex-wrap:wrap">'
        + '<div style="flex:1;min-width:160px" class="fld"><label>Wadhifa / Role *</label><select id="imqRole">'
          + '<option value="">— chagua / choose —</option>'
          /* "It must be of existing and of user logged in": the box always carries the signed-in
             code's own role, first and selected, whether or not the approver has priced it. Priced,
             the nightly rate fills from it at once; unpriced, it says so on the option and the
             nights (only the nights) wait on the approver -- the server accepts the requester's
             own role for a trip without nights (imprestRequest, api/_lib/imprest.js). The other
             priced roles follow and can still be picked. */
          + (myRole && !myRow
              ? '<option value="'+esc(myRole)+'" data-rate="0" selected>'+esc(myRole)+' · hakuna kiwango cha malazi bado / no nightly rate yet (wadhifa wako / your role)</option>' : '')
          + roles.map(function(r){ var mine = String(r.role||'').trim().toUpperCase() === myRole;
              return '<option value="'+esc(r.role)+'" data-rate="'+r.rate+'"'+(mine?' selected':'')+'>'+esc(r.role)+' · malazi '+money(r.rate)+'/siku'+(mine?' (wadhifa wako / your role)':'')+'</option>'; }).join('')
          + '</select>'
          /* "am not seeing role here" / "I fill the days for Accommodation, jumla doesn't count":
             an unpriced role multiplies nights by nothing. Say so under the box, with the way out
             -- one tap to the Rates table for a viewer who holds it, a message for the rest. */
          + (myRole && (!myRow || !(Number(myRow.rate) > 0))
            ? '<div class="mut" style="font-size:10.5px;margin-top:4px">Wadhifa wako (' + esc(myRole) + ') hauna kiwango cha malazi bado: nauli na gharama nyingine zinaombeka, siku za malazi zinasubiri kiwango. '
              + '/ Your role (' + esc(myRole) + ') has no nightly rate yet: fares and other costs can be requested, nights wait for the rate. '
              /* "Totals and submission not yet": a viewer who holds the Rates table sets the rate
                 HERE, on the form -- the same server function and table the approval pane uses
                 (imprestRoleSave; wired in app.html) -- and the form redraws priced. */
              + (canPrice
                  ? '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:5px">'
                    + '<input id="imqSetRate" type="number" min="1" step="1" placeholder="TZS kwa siku / per night" style="width:150px;font-size:12px">'
                    + '<button class="btn sm good" id="imqSetRateBtn" data-role="' + esc(myRole) + '">Weka kiwango sasa / Set the rate now</button>'
                    + '<a href="#" onclick="go(\'impappr\');return false" style="font-size:10.5px">viwango vyote / all rates &rarr;</a></div>'
                  : 'Muombe mwidhinishaji akiweke kwenye Idhini ya imprest → Viwango. / Ask the approver to set it under Imprest approval → Rates.')
              + '</div>' : '')
          + (!myRole ? '<div class="mut" style="font-size:10.5px;margin-top:4px">Kodi yako haina wadhifa — chagua wadhifa uliopo. / Your code has no role — pick a listed role.</div>' : '')
          + '</div>'
        + '<div style="flex:1;min-width:140px" class="fld"><label>Njia ya malipo / Payment mode</label><select id="imqPay">'
          + IMPREST_PAY_MODES.map(function(p){ return '<option>'+esc(p)+'</option>'; }).join('')+'</select></div>'
        + '<div style="flex:1;min-width:160px" class="fld"><label>Namba ya akaunti / Account No or MOMO</label><input id="imqAcct"></div>'
        + '</div><div class="row" style="display:flex;gap:8px;flex-wrap:wrap">'
        + '<div style="flex:1;min-width:140px" class="fld"><label>Tarehe ya safari / Travel date *</label><input id="imqDate" type="date" value="'+esc(today())+'"></div>'
        + '<div style="flex:2;min-width:200px" class="fld"><label>Mahali / Destination</label><input id="imqDest"></div>'
        + '</div>'
        + '<h4 style="margin:10px 0 4px">Gharama / Expense items</h4>'
        + '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">'
        + '<div style="flex:1;min-width:110px" class="fld"><label>Nauli: idadi ya safari / Fare trips</label><input id="imqTrips" type="number" min="0" step="1" value="0"></div>'
        + '<div style="flex:1;min-width:130px" class="fld"><label>Gharama ya safari moja / Cost per trip</label><input id="imqTrip" type="number" min="0" step="1" value="0"></div>'
        + '<div style="flex:1;min-width:110px" class="fld"><label>= Nauli / Fare</label><input id="imqFare" readonly value="0"></div>'
        + '</div><div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">'
        + '<div style="flex:1;min-width:110px" class="fld"><label>Malazi: siku / Nights</label><input id="imqDays" type="number" min="0" step="1" value="0"></div>'
        + '<div style="flex:1;min-width:130px" class="fld"><label>Kiwango kwa siku / Rate per day</label><input id="imqRate" readonly value="0"></div>'
        + '<div style="flex:1;min-width:110px" class="fld"><label>= Malazi / Accommodation</label><input id="imqAccom" readonly value="0"></div>'
        + '</div>'
        + [1,2,3].map(function(i){
            return '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">'
              + '<div style="flex:2;min-width:180px" class="fld"><label>Nyingine '+i+' / Other '+i+' — maelezo</label><input id="imqO'+i+'d" placeholder="mf. chakula, mafuta…"></div>'
              + '<div style="flex:1;min-width:110px" class="fld"><label>Kiasi / Amount</label><input id="imqO'+i+'a" type="number" min="0" step="1" value="0"></div>'
              + '</div>';
          }).join('')
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0 4px;font-size:15px"><b>JUMLA / TOTAL</b><b id="imqTotal">0</b></div>'
        + '<div class="fld"><label>Madhumuni ya safari / Objectives — purpose of trip *</label><textarea id="imqPurpose" rows="3"></textarea></div>'
        /* WHY THE BUTTON IS CLOSED travels on the button itself (data-closed) for the gate, and
           the core's wiring (wireForms, app.html) writes the one line under it -- for the gate,
           for a figure that is not a whole number, for no role, for nights on a role with no
           rate, and for a request with no costs on it. An empty rate table no longer closes the
           form: the requester's own role is on the box and a trip without nights goes through.
           data-blocked stays for a core older than this module. */
        + '<button class="btn w" id="imqSend" style="margin-top:6px"'+(blocked?' disabled':'')
          + (blocked ? ' data-blocked="1" data-closed="blocked"' : '') + '>'
          + (blocked ? 'Retire imprest ya awali kwanza / Retire the previous imprest first' : 'Tuma ombi / Submit request') + '</button>'
        + '<div id="imqWhy" class="note bad" style="display:none;margin-top:6px"></div>'
        /* The last submit's confirmation, carried across the redraw that follows it (S.imqFlash, set
           by the core's Send handler) -- shown once, on this draw, then forgotten. */
        + '<div id="imqOut" class="note' + (flash && flash.bad ? ' bad' : '') + '" style="' + (flash ? 'display:block' : 'display:none') + ';margin-top:8px">' + (flash ? flash.html : '') + '</div>'
        + '</div></div>';
    S.rows = rows;
    S.cols = [col('at','Tarehe / Timestamp','dt'), col('travelDate','Safari / Travel','date'), col('destination','Mahali / Destination'),
      {key:'total', label:'Jumla / Total', kind:'money'},
      {key:'status', label:'Hali / Status', kind:'chip', chip:imprestChipCls_, get:imprestChipText_},
      {key:'approved', label:'Imeidhinishwa / Approved', kind:'money'},
      {key:'retireTotal', label:'Halisi / Actual', kind:'money'},
      col('comment','Maoni / Comment')];
    ONROW = function(r){ imprestDetailsDrawer_(r, { canRetire:true }); };
  });
};

/* ---------- IDHINI YA IMPREST: the GM's queue, the rate table, and the decision ---------- */
var IMPQ_STATE = 'pending';

/* WHO HEARS THE IMPREST PHONE ALERTS -- "Imprest push notifications to roles I choose only.
   There is a privacy concern." Two broadcast topics, each either open to every holder of its
   pane (the default) or narrowed to the roles ticked; the server keeps the list in settings and
   applies it where a phone subscribes, where the app polls, and when the alert is sent
   (push.js). A requester's own steps are not a broadcast and are not on this card. The Save
   button is wired in app.html. */
var IMPREST_PUSH_TOPICS = [
  { key: 'IMPREST', label: 'Ombi jipya na retirement / New request and retirement', pane: 'Idhini ya imprest / Imprest approval' },
  { key: 'IMPREST_FUND', label: 'Imeidhinishwa, inasubiri malipo / Approved, awaiting payment', pane: 'Ripoti ya imprest / Imprest report' },
];
function imprestPushPolicyCard_(pp, allRoles, roles){
  if (!pp || !pp.policy) return '';   // a server without the policy yet: nothing to offer, nothing to break
  var policy = pp.policy;
  var names = allRoles.slice();
  roles.forEach(function(r){ if (names.indexOf(r.role) < 0) names.push(r.role); });
  IMPREST_PUSH_TOPICS.forEach(function(t){ (policy[t.key] || []).forEach(function(r){ if (names.indexOf(r) < 0) names.push(r); }); });
  if (names.indexOf('ADMIN') < 0) names.push('ADMIN');
  names.sort();
  return '<div class="card" style="padding:12px;margin:10px 0"><div class="card-h">Arifa za simu za imprest: nani anapokea / Imprest phone alerts: who receives'
    + '<span class="sub">taarifa ya ombi (jina, kiasi, mahali) iende kwa wadhifa uliochagua tu / a request\'s details (name, amounts, destination) reach only the roles you choose</span></div>'
    + IMPREST_PUSH_TOPICS.map(function(t){
        var only = policy[t.key], narrowed = Array.isArray(only);
        return '<div style="margin:8px 0 10px"><b>' + esc(t.label) + '</b> <span class="mut" style="font-size:10.5px">(' + esc(t.pane) + ')</span>'
          + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;font-size:12px">'
          + '<label><input type="radio" name="pp_' + t.key + '" value="all"' + (narrowed ? '' : ' checked') + '> Wote wenye ukurasa huo / everyone holding that pane</label>'
          + '<label><input type="radio" name="pp_' + t.key + '" value="only"' + (narrowed ? ' checked' : '') + '> Wadhifa hizi tu / these roles only</label></div>'
          + '<div data-pp="' + t.key + '" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:12px;opacity:' + (narrowed ? '1' : '0.45') + '">'
          + names.map(function(n){ return '<label style="white-space:nowrap"><input type="checkbox" data-ppr="' + t.key + '" value="' + esc(n) + '"' + (narrowed && only.indexOf(n) >= 0 ? ' checked' : '') + '> ' + esc(n) + '</label>'; }).join('')
          + '</div></div>';
      }).join('')
    + '<button class="btn sm" id="ppSave">Hifadhi / Save</button>'
    + '<div class="mut" style="font-size:10.5px;margin-top:6px">Wadhifa lazima pia uwe na ukurasa huo kwenye Nafasi na ruhusa; ADMIN pia huachwa nje asipochaguliwa; orodha tupu inanyamazisha arifa hiyo. Inatumika mara moja, hata kwa simu zilizosajiliwa zamani. Hatua za ombi la mtu mwenyewe humfikia mwombaji tu. '
    + '/ A role must also hold that pane under Roles & access; ADMIN too is left out unless ticked; an empty list silences that alert. Applies at once, even to phones registered long ago. A requester\'s own steps reach the requester only.</div>'
    + '</div>';
}

VIEWS.impappr = function(){
  return Promise.all([srv('imprestQueue', { state: IMPQ_STATE }), srv('imprestRoles', {}),
      srv('pushPolicy', {}).catch(function(){ return null; })]).then(function(a){
    var d = a[0], roles = (a[1].roles||[]), allRoles = (a[1].all||[]), pp = a[2];
    if (d.notReady) { HEAD = imprestNotReady_(); S.rows=[]; S.cols=[]; ONROW=null; return; }
    var rows = d.rows||[], c = d.counts||{};
    var pick = function(k){ return 'go(\'impappr\')'; };
    HEAD = '<div class="kpis">'
      + kpi('Yanasubiri / Pending', money(c.pending||0), '', c.pending?'bad':'')
      + kpi('Yameidhinishwa / Approved', money(c.approved||0), '', 'good')
      + kpi('Yamekataliwa / Rejected', money(c.rejected||0))
      + kpi('Bila retirement / Not retired', money(c.toRetire||0), '', c.toRetire?'warn':'')
      + '</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">'
      + ['', 'pending', 'decided', 'toRetire'].map(function(k){
          var label = k===''?'Yote / All':k==='pending'?'Yanasubiri / Pending':k==='decided'?'Yaliyoamuliwa / Decided':'Bila retirement / Not retired';
          return '<button class="btn sm'+(IMPQ_STATE===k?'':' ghost')+'" data-impq="'+k+'">'+label+'</button>';
        }).join('')
      + '</div>'
      + '<div class="card" style="padding:12px;margin:10px 0"><div class="card-h">Viwango vya malazi / Accommodation rates'
      + '<span class="sub">kiwango kwa siku kwa kila wadhifa / a nightly rate per role — mwombaji anachagua, seva inazidisha / the requester picks it, the server multiplies</span></div>'
      + (roles.length
        ? '<div class="scroll"><table><thead><tr><th>Wadhifa / Role</th><th class="r">TZS / siku</th><th class="noxl"></th></tr></thead><tbody>'
          + roles.map(function(r){ return '<tr><td>'+esc(r.role)+'</td><td class="r">'+money(r.rate)+'</td>'
            + '<td class="r noxl" style="white-space:nowrap"><button class="btn sm ghost" data-rle="'+esc(r.role)+'" data-rate="'+r.rate+'">Badili</button> '
            + '<button class="btn sm ghost danger" data-rld="'+esc(r.role)+'">Futa</button></td></tr>'; }).join('')
          + '</tbody></table></div>' : '<div class="mut">Hakuna wadhifa bado. / No roles yet.</div>')
      + (function(){
          var opts = allRoles.slice();
          roles.forEach(function(r){ if (opts.indexOf(r.role)<0) opts.push(r.role); });
          opts.sort();
          return '<div class="row" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'
            + '<select id="rlRole" style="flex:2;min-width:160px"><option value="">Chagua wadhifa / choose a role</option>'
            + opts.map(function(x){ return '<option value="'+esc(x)+'">'+esc(x)+'</option>'; }).join('')+'</select>'
            + '<input id="rlRate" style="flex:1;min-width:110px" type="number" min="0" step="1" placeholder="TZS kwa siku">'
            + '<button class="btn sm" id="rlAdd">Hifadhi / Save</button></div>'
            + '<div class="mut" style="font-size:10.5px;margin-top:4px">Wadhifa haupo? Muongeze kwenye Misimbo/Nafasi kisha rudi hapa. '
            + '/ Role not listed? Add it under Teams & Staff / Access codes first, then come back.</div>';
        })()
      + '</div>'
      + imprestPushPolicyCard_(pp, allRoles, roles);
    S.rows = rows;
    S.cols = [col('at','Tarehe / Timestamp','dt'), col('fullName','Jina / Name'), col('imprestRole','Wadhifa / Role'),
      col('travelDate','Safari / Travel','date'), col('destination','Mahali / Destination'),
      {key:'total', label:'Jumla / Total', kind:'money'},
      {key:'status', label:'Hali / Status', kind:'chip', chip:imprestChipCls_, get:imprestChipText_},
      col('comment','Maoni / Comment')];
    ONROW = function(r){
      if (r.status==='pending') { imprestDecideDrawer_(r); return; }
      imprestDetailsDrawer_(r, {});
    };
  }).catch(function(e){ HEAD = '<div class="msg bad">'+esc(String(e.message||e))+'</div>'; S.rows=[]; S.cols=[]; });
};

/* ONE DRAWER, BOTH ANSWERS -- capped at what was asked; a comment is required to reject. The
   same imprestDecide the emailed one-tap link calls. */
function imprestDecideDrawer_(r){
  drawer('<h3>Ombi la '+esc(r.fullName||r.staffName||'—')+'</h3>'
    + '<div class="sub">'+esc(r.staffName||'')+' · '+esc(r.imprestRole||'')+' · safari '+esc(r.travelDate||'—')+' · '+esc(r.destination||'')+'</div>'
    + (r.mine ? '<div class="mut" style="font-size:11.5px;margin:6px 0 2px">Hili ni ombi lako mwenyewe. / This is your own request.</div>' : '')
    + '<div style="margin:8px 0"><b>Madhumuni / Purpose:</b><div style="white-space:pre-wrap;font-size:12.5px">'+esc(r.purpose||'—')+'</div></div>'
    + imprestCostingHtml_(r)
    + '<div class="mut" style="font-size:11px">Malipo: '+esc(r.payMode||'—')+' · '+esc(r.accountNo||'—')+' · '+esc(r.recipientName||r.fullName||'')+'</div>'
    + '<div class="fld"><label>Kiasi cha kuidhinisha / Amount to approve (≤ '+money(r.total)+')</label>'
    + '<input id="imdAmt" type="number" min="1" max="'+(r.total||0)+'" step="1" value="'+(r.total||0)+'"></div>'
    + '<div class="fld"><label>Maoni / Comment</label><textarea id="imdCmt" rows="3" placeholder="Lazima ukikataa. / Required when rejecting."></textarea></div>'
    + '<button class="btn w" id="imdOk" style="margin-top:8px">Idhinisha / Approve</button>'
    + '<button class="btn w ghost danger" id="imdNo" style="margin-top:6px">Kataa / Reject</button>');
  var send = function(approve){
    if (approve){ var amt=$('#imdAmt').value; if (amt===''||!(Number(amt)>0)){ toast('Andika kiasi cha kuidhinisha. / Enter the amount to approve.', true); return; } }
    var b=$('#imdOk'), n=$('#imdNo'); if (b) b.disabled=true; if (n) n.disabled=true;
    srv('imprestDecide', { id:r.id, approve:approve, approvedAmount: approve?$('#imdAmt').value:null, comment:$('#imdCmt').value })
      .then(function(d){
        /* SAY WHETHER THE REQUESTER WAS ACTUALLY TOLD -- "he's gonna request again now, i hope
           when gm approves he gets one". This used to celebrate the DECISION and stay quiet
           about the email, so a send that failed (most often EMAIL_FROM unset -- see Settings)
           looked exactly like one that worked, and nobody knew to check until the requester
           asked why nothing arrived. Same rule the request form's own confirmation already
           follows a few screens over. */
        var base = approve ? 'Imeidhinishwa / Approved' : 'Imekataliwa / Rejected';
        toast(base + (d && d.emailed && d.emailed.requester
          ? ' · mwombaji ameambiwa kwa email / requester was emailed'
          : ' · ⚠️ mwombaji HAKUAMBIWA kwa email: ' + ((d && d.emailNote) || ''))
          /* The phones that buzzed -- the requester's, and the accountant's on an approval (api/_lib/push.js). */
          + (d && d.pushed ? ' · simu ' + d.pushed + ' imearifiwa / phone(s) buzzed' : '')
          + (d && d.pushNote ? ' · arifa ya simu: ' + d.pushNote : ''), !(d && d.emailed && d.emailed.requester));
        closeDrawer(); render({ force:true });
      })
      .catch(function(e){ if (b) b.disabled=false; if (n) n.disabled=false; toast(String(e.message||e), true); });
  };
  $('#imdOk').onclick = function(){ send(true); };
  $('#imdNo').onclick = function(){ send(false); };
}

/* ---------- RIPOTI YA IMPREST: the whole-company dashboard, and where funding is recorded ---------- */
VIEWS.imprep = function(){
  var q = { from: S.args.from||'', to: S.args.to||'', status: S.args.status||'' };
  return srv('imprestReport', q).then(function(d){
    if (d.notReady) { HEAD = imprestNotReady_(); S.rows=[]; S.cols=[]; ONROW=null; return; }
    var rows = d.rows||[], t = d.totals||{};
    /* THE OVERALL DASHBOARD -- "and overall in reports". Server-computed over the WHOLE
       period, not just what the filter below is narrowing the table to. */
    HEAD = '<div class="kpis">'
      + kpi('Maombi / Requests', money(t.count||0), 'kwenye kipindi hiki / in this period')
      + kpi('Yanasubiri / Pending', money(t.pending||0), '', t.pending?'bad':'')
      + kpi('Yameidhinishwa / Approved', money(t.approvedAmount||0), money(t.approved||0)+' maombi / requests', 'good')
      + kpi('Kimelipwa / Funded', money(t.fundedAmount||0), money(t.funded||0)+' maombi / requests')
      + kpi('Bado / Not funded', money(t.toFund||0), '', t.toFund?'warn':'')
      + kpi('Bila retirement / Not retired', money(t.toRetire||0), '', t.toRetire?'warn':'')
      + kpi('Kimetumika / Spent', money(t.spent||0), money(t.retired||0)+' retirement')
      + kpi('Ya kurejeshwa / To refund', money(t.toRefund||0), '', t.toRefund?'good':'')
      + kpi('Ya kulipwa / To reimburse', money(t.toReimburse||0), '', t.toReimburse?'bad':'')
      + '</div>'
      + bar('<input type="date" data-arg="from" value="'+esc(q.from)+'">'
          + '<input type="date" data-arg="to" value="'+esc(q.to)+'">'
          + '<select data-arg="status"><option value="">Hali zote / All statuses</option>'
          + [['pending','Yanasubiri / Pending'],['approved','Yameidhinishwa / Approved'],['rejected','Yamekataliwa / Rejected'],
             ['toFund','Bado kulipwa / Not funded'],['toRetire','Bila retirement / Not retired'],['retired','Zenye retirement / Retired']]
            .map(function(k){ return '<option value="'+k[0]+'"'+(q.status===k[0]?' selected':'')+'>'+k[1]+'</option>'; }).join('')
          + '</select>');
    S.rows = rows;
    S.cols = [col('at','Tarehe / Timestamp','dt'), col('fullName','Jina / Name'), col('imprestRole','Wadhifa / Role'),
      col('travelDate','Safari / Travel','date'), col('destination','Mahali / Destination'),
      {key:'total', label:'Jumla / Requested', kind:'money'},
      {key:'status', label:'Hali / Status', kind:'chip', chip:imprestChipCls_, get:imprestChipText_},
      {key:'approved', label:'Imeidhinishwa / Approved', kind:'money'},
      {key:'fundedAmount', label:'Kimelipwa / Funded', kind:'money'},
      {key:'retireTotal', label:'Halisi / Actual', kind:'money'},
      {key:'retireBalance', label:'Salio / Balance', kind:'chip', chip:imprestBalanceCls_, get:imprestBalanceText_},
      col('decidedBy','Aliyeamua / Decided by'), col('comment','Maoni / Comment')];
    ONROW = function(r){ imprestDetailsDrawer_(r, { canFund:true }); };
  });
};
