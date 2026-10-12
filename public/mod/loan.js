/* loan -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/loan.js?v=BUILD. */

function lnQueueTable(rows, cols, onRow){
  S.rows = rows; S.cols = cols; ONROW = onRow;
}

function lnStageChip(s){
  var k = String(s||'').toUpperCase();
  if (k==='FUNDED'||k==='CLOSED') return 'ok';
  if (k==='REJECTED'||k==='REVERSED') return 'bad';
  if (k==='DISBURSED'||k==='APPROVED') return 'warn';
  return 'mut';
}

/** "presing save in assessment stages or any submissions should always turn the button off to
    saving, some think it doesnt fn and multiple click" -- a click focuses its button first, in
    every browser and WebView, so document.activeElement AT THE MOMENT lnAct/lnActKeep_ is
    called is reliably the button that triggered it -- no call site has to be touched to pass
    it in. Disabling it synchronously, before the network call even starts, is what actually
    stops a second tap: a disabled button does not dispatch a second click at all. */
function lnDisableTrigger_(){
  var btn = document.activeElement;
  if (!btn || btn.tagName !== 'BUTTON' || btn.disabled) return null;
  btn.disabled = true;
  return btn;
}

function lnAct(fn, args, okMsg, after){
  var btn = lnDisableTrigger_();
  srv(fn, args).then(function(r){
    /* okMsg may be a function of the answer -- Assign says whether an Assessment Plan was
       merged into the loan, and a merge that could not finish is said in red, not swallowed
       behind a plain "Assigned." (CLAUDE.md: silence reads as success). */
    var m = typeof okMsg === 'function' ? okMsg(r) : okMsg;
    if (m && typeof m === 'object') toast(m.text, !!m.bad); else toast(m || 'Imefanyika / Done');
    closeDrawer();               // the button leaves with the drawer -- nothing to re-enable
    (after || render)();
  }).catch(function(e){
    if (btn) btn.disabled = false;   // failed -- give it back so the officer can retry
    toast(String((e && e.message) || e), true);
  });
}

/** Same call, but the panel stays open -- "updating personal info shoulnt close the pannel
    after each section filling". lnAct's closeDrawer() is right for a TERMINAL action (assign,
    approve, submit -- the loan leaves this queue), wrong for one section of a multi-section
    form the officer is still working through. Returns the promise so a caller can chain
    (e.g. the pad/upload saves that have to finish before the section save itself fires). */
function lnActKeep_(fn, args, okMsg){
  var btn = lnDisableTrigger_();
  return srv(fn, args).then(function(){
    if (btn) btn.disabled = false;   // panel stays open -- the same button may be pressed again
    toast(okMsg || 'Imefanyika / Done');
  }, function(e){
    if (btn) btn.disabled = false;
    toast(String((e && e.message) || e), true); throw e;
  });
}

/* =====================================================================================
   KYC CAPTURE -- COMPRESS ON THE DEVICE, DRAW ON A CANVAS, ASK FOR GPS. Three small building
   blocks, reused everywhere a photo, a signature/thumbprint, or a pinpoint is asked for.
   ===================================================================================== */

/* "adapt the whatsapp tech, when someone uploads their 5mb photo, we optimize it before
   storing and store the low quality" -- every capture path resizes and re-encodes ON THE
   DEVICE before a byte is sent (openCameraOverlay_ draws straight from the live video frame
   at a capped dimension), which is what actually matters on a field connection; kycUpload's
   own 2MB cap is only the backstop. */
function kycUpload_(loanId, kind, dataUrl, cameraLabel){
  /* "plan:<id>" in the loan slot means the capture belongs to an Assessment Plan's draft, not
     to a loan (there is none yet) -- every capture helper passes the id straight through, so
     this one branch is the whole of plan mode as far as uploads are concerned. */
  var pm = /^plan:(.+)$/.exec(String(loanId || ''));
  if (pm) return srv('kycUpload', { plan_id: pm[1], kind: kind, data_url: dataUrl, camera_label: cameraLabel });
  return srv('kycUpload', { loan_id: loanId, kind: kind, data_url: dataUrl, camera_label: cameraLabel });
}

/* THE SIGNATURE CAPTURE.
   "i mean ... draw signature too llike how we work with phone notes apps" -- one canvas,
   drawn on with a finger. Pointer events cover touch and mouse the same way, so this works
   identically on a phone in the field and a laptop in the office.
   Fingerprint/thumbprint capture (mode 'stamp', once alongside this) was removed at the
   owner's request -- signature only, plus the field officer's own name and signature at
   recommendation. */
function wireCanvasPad_(canvasId){
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  var ctx = canvas.getContext('2d');
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1a2b4a';
  ctx.fillStyle = 'rgba(26,43,74,.55)';
  var drawing = false, dirty = false, last = null;
  function pos(e){
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  }
  function start(e){
    e.preventDefault(); drawing = true; last = pos(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}   // keeps the stroke on THIS canvas even off a fast, small screen
  }
  function move(e){
    if (!drawing) return; e.preventDefault();
    var p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; dirty = true;
  }
  function end(){ drawing = false; }
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);
  canvas.addEventListener('pointercancel', end);
  return {
    isDirty: function(){ return dirty; },
    dataUrl: function(){ return canvas.toDataURL('image/png'); },
    clear: function(){ ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
  };
}

/** A pad's "Save" button: upload only if something was actually drawn since the pad opened
    (re-saving the section must not silently re-upload and re-point at a new file when nothing
    changed), and hand the resulting path to whoever owns this field. */
function saveCanvasPad_(pad, loanId, kind, onPath){
  if (!pad || !pad.isDirty()) return Promise.resolve();
  return kycUpload_(loanId, kind, pad.dataUrl()).then(function(r){ onPath(r.path); });
}

/** A camera/file capture button -- compress, upload, remember the path. Used for the passport
    photo (customer and guarantor) and for the three site-verification photos alike; only the
    `kind` string and where the resulting path lands differ. */
/** A LIVE camera feed, never a file/gallery picker -- "photo shouldnt use gallary but phone
    camera only". A file input's capture="environment" is only a HINT some browsers ignore,
    and any hint still leaves a chooser a gallery photo can be picked from. getUserMedia opens
    the camera directly; there is no picker step for an old photo to be substituted at. */
/** "our system photos should have timestamp too" / "our timestamp could capture location and
    user who took it too" -- burned into the image itself, not just recorded as metadata
    alongside it (kyc_captures already logs who and when server-side, but a stamp on the
    picture itself survives the picture being pulled out of this system entirely). One line:
    date/time, the signed-in officer, and a GPS fix if one landed in time. GPS is requested the
    moment the overlay opens so it has the whole time the officer spends framing the shot to
    resolve -- if it never does, the stamp simply carries less, exactly like every other GPS
    read in this app; it must never hold up the shutter. */
function stampPhoto_(ctx, w, h, geoCoords){
  var now = new Date();
  var pad = function(n){ return String(n).padStart(2, '0'); };
  var when = pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear()
    + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  var who = (S.me && S.me.name) || '';
  var where = geoCoords ? (geoCoords.lat.toFixed(5) + ', ' + geoCoords.lng.toFixed(5)) : '';
  var line = [when, who, where].filter(Boolean).join(' · ');
  var fontSize = Math.max(13, Math.round(h * 0.022));
  var barH = Math.round(fontSize * 1.9);
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(0, h - barH, w, barH);
  ctx.fillStyle = '#fff';
  ctx.font = fontSize + 'px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(line, 10, h - barH / 2, w - 20);
}

function openCameraOverlay_(onCapture){
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center';
  var video = document.createElement('video');
  video.autoplay = true; video.playsInline = true; video.muted = true;
  video.style.cssText = 'width:100%;max-height:80vh;object-fit:contain;background:#000';
  var bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:12px;padding:16px;width:100%;max-width:420px';
  var shotBtn = document.createElement('button');
  shotBtn.type = 'button'; shotBtn.className = 'btn w'; shotBtn.style.flex = '1'; shotBtn.textContent = '📷 Piga / Capture';
  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button'; cancelBtn.className = 'btn w ghost'; cancelBtn.style.flex = '1'; cancelBtn.textContent = 'Ghairi / Cancel';
  bar.appendChild(shotBtn); bar.appendChild(cancelBtn);
  overlay.appendChild(video); overlay.appendChild(bar);
  document.body.appendChild(overlay);

  var stream = null, stopped = false, poppedBack = false, geoCoords = null;
  // Best-effort, non-blocking -- see stampPhoto_. A denied/slow/absent GPS is not an error
  // here, only a stamp with one less fact on it.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(function(pos){
      geoCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }, function(){}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }
  /* THE ANDROID BACK BUTTON. This overlay is a DOM element, not a real page -- the app's
     onBackPressed only ever asks the WebView "is there a previous PAGE" (web.canGoBack()), which
     knows nothing about a div sitting on top of one, so without this the hardware back button
     skipped straight past the overlay and navigated the whole app away, dropping whoever was on
     screen underneath it entirely ("clicking back from camera goes to hopecalls instead of
     recovering current customer card"). Pushing one history entry when the overlay opens gives
     the back button something of its own to consume first: it pops this same-document entry (no
     real navigation, just the popstate event below) before it can ever reach a real page. */
  history.pushState({ hopeCam: 1 }, '', location.href);
  function onPop(){ poppedBack = true; stop(); }
  window.addEventListener('popstate', onPop);
  function stop(){
    if (stopped) return; stopped = true;
    window.removeEventListener('popstate', onPop);
    if (stream) stream.getTracks().forEach(function(t){ t.stop(); });
    if (overlay.parentNode) document.body.removeChild(overlay);
    // Closed by Cancel/Capture/an error, not by the back button -- consume the pushed entry now
    // rather than leaving it for a LATER back press to pop for no reason.
    if (!poppedBack) { poppedBack = true; history.back(); }
  }
  cancelBtn.onclick = stop;
  shotBtn.disabled = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    stop(); toast('Kamera haipatikani kwenye kivinjari hiki. / Camera is not available in this browser.', true); return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    .then(function(s){
      if (stopped) { s.getTracks().forEach(function(t){ t.stop(); }); return; }   // Cancel pressed while permission was pending
      stream = s; video.srcObject = s; shotBtn.disabled = false;
    })
    .catch(function(e){ stop(); toast('Imeshindikana kufungua kamera / could not open camera: ' + (e.message || e), true); });
  shotBtn.onclick = function(){
    var maxDim = 1280, vw = video.videoWidth || maxDim, vh = video.videoHeight || maxDim;
    var scale = Math.min(1, maxDim / Math.max(vw, vh));
    var c = document.createElement('canvas'); c.width = Math.round(vw * scale); c.height = Math.round(vh * scale);
    var ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, c.width, c.height);
    stampPhoto_(ctx, c.width, c.height, geoCoords);
    var dataUrl = c.toDataURL('image/jpeg', 0.7);
    /* WHICH CAMERA ANSWERED. A genuine handset and a virtual-camera app (used to feed in a
       photo instead of a live capture) both satisfy getUserMedia() the same way -- there is
       no way to tell them apart from here. What the track's own label carries through is an
       audit trail: kycUpload_ below records it against the capture, unseen by the officer,
       so a suspicious one can be traced back to who took it. */
    var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    var cameraLabel = track && track.label || '';
    stop();
    onCapture(dataUrl, cameraLabel);
  };
}

/* TWO STATES, NOT ONE. "When a picture is captured show captured label to know it's temporary
   there.. if in a saved section show saved ✓" -- a capture uploads the moment it is taken, but
   its PATH only lands on the record when the section is saved. So a fresh capture reads
   "captured -- not saved yet" (and is marked pending), and it turns into "Saved ✓" when its
   section's save comes back (markSectionSaved_), the same label a capture that was already on
   the record opens with. A save that fails leaves it pending, which is the truth. */
var CAPTURE_SAVED_ = '✓ Imehifadhiwa / Saved';

var CAPTURE_PENDING_ = '📷 Imepigwa — bado haijahifadhiwa / Captured — not saved yet';

function markCapturePending_(status){
  if (!status) return;
  status.textContent = CAPTURE_PENDING_; status.setAttribute('data-capture-pending', '1'); status.style.color = 'var(--warn, #b45309)';
}

function markCaptureSaved_(status){
  if (!status) return;
  status.textContent = CAPTURE_SAVED_; status.removeAttribute('data-capture-pending'); status.style.color = 'var(--ok)';
}

/** Every pending capture inside a section's panel becomes "Saved ✓" -- called by the one
    section-save router once the server has said yes, never before. */
function markSectionSaved_(section){
  document.querySelectorAll('.ln-stage-panel[data-stage="' + section + '"] [data-capture-pending]').forEach(markCaptureSaved_);
}

function wirePhotoCapture_(btnId, statusId, loanId, kind, existingPath, onPath){
  var btn = document.getElementById(btnId), status = document.getElementById(statusId);
  if (!btn) return;
  function setStatus(has){ if (status) { status.textContent = has ? CAPTURE_SAVED_ : ''; status.style.color = has ? 'var(--ok)' : ''; } }
  setStatus(!!existingPath);
  btn.onclick = function(){
    openCameraOverlay_(function(dataUrl, cameraLabel){
      btn.disabled = true; if (status) { status.textContent = 'Inapakia... / Uploading...'; status.style.color = ''; }
      kycUpload_(loanId, kind, dataUrl, cameraLabel)
        .then(function(r){ onPath(r.path); markCapturePending_(status); btn.disabled = false; })
        .catch(function(e){ btn.disabled = false; setStatus(!!existingPath); toast(String((e && e.message) || e), true); });
    });
  };
}

/** A "Capture location" button -- one GPS reading, shown back as coordinates so the officer
    can see it actually landed before moving on. Used for the customer's residence, the
    business, and the guarantor's residence -- three buttons, same wiring. */
function wireGpsCapture_(btnId, statusId, existingLat, existingLng, onCoords){
  var btn = document.getElementById(btnId), status = document.getElementById(statusId);
  if (!btn) return;
  function fmt(lat, lng){ return Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5); }
  function setStatus(lat, lng){
    if (!status) return;
    var has = lat != null && lng != null;
    status.textContent = has ? (fmt(lat, lng) + ' · ' + CAPTURE_SAVED_) : '';
    status.style.color = has ? 'var(--ok)' : ''; status.removeAttribute('data-capture-pending');
  }
  setStatus(existingLat, existingLng);
  btn.onclick = function(){
    if (!navigator.geolocation) { toast('Simu hii haina GPS. / This device has no GPS.', true); return; }
    btn.disabled = true; if (status) { status.textContent = 'Inatafuta mahali... / Finding location...'; status.style.color = ''; }
    navigator.geolocation.getCurrentPosition(function(pos){
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      onCoords(lat, lng); btn.disabled = false;
      // Same two states as a photo: taken now, on the record only once the section is saved.
      if (status) { markCapturePending_(status); status.textContent = fmt(lat, lng) + ' · ' + CAPTURE_PENDING_; }
    }, function(err){
      btn.disabled = false; setStatus(existingLat, existingLng);
      toast('Imeshindikana kupata mahali / could not get location: ' + err.message, true);
    }, { enableHighAccuracy: true, timeout: 15000 });
  };
}

/** The three capture rows (photo button, canvas pad x2) share the same markup shape -- built
    once here so personal details and the guarantor section (customer and guarantor, the same
    three captures each) do not carry four copies of it. */
function captureRowPhoto_(label, btnId, statusId){
  return '<div class="fld"><label>' + esc(label) + '</label>'
    + '<button type="button" class="btn sm ghost" id="' + btnId + '">📷 Piga picha / Take photo</button>'
    + ' <span class="sub" id="' + statusId + '"></span></div>';
}

function captureRowPad_(label, canvasId, clearBtnId){
  return '<div class="fld"><label>' + esc(label) + '</label>'
    + '<canvas id="' + canvasId + '" width="300" height="120" style="width:100%;max-width:300px;height:120px;border:1.5px solid var(--line);border-radius:9px;touch-action:none;background:#fff"></canvas>'
    + ' <button type="button" class="btn sm ghost" id="' + clearBtnId + '" style="margin-top:4px">Futa / Clear</button></div>';
}

function captureRowGps_(label, btnId, statusId){
  return '<div class="fld"><label>' + esc(label) + '</label>'
    + '<button type="button" class="btn sm ghost" id="' + btnId + '">📍 Chukua mahali / Capture location</button>'
    + ' <span class="sub" id="' + statusId + '"></span></div>';
}

/** "NIDA/phone number progress-dot input" -- a row of dots below the field showing how many
    digits are still wanted, WITHOUT masking anything the officer has actually typed (a
    password-style dial hides the very thing this is meant to help proofread). One dot per
    expected digit; filled as typed, and a digit typed PAST the expected count turns the whole
    row red rather than just stopping -- that is the one thing worth flagging, since it usually
    means an extra digit slipped in. Non-digit characters (spaces, dashes someone pastes in)
    are not counted -- only digits are what NIDA/a phone number actually needs. */
function digitDots_(dotsId, expectedLen){
  var dots = '';
  for (var i = 0; i < expectedLen; i++) dots += '<span></span>';
  return '<div class="ln-dots" id="' + dotsId + '">' + dots + '</div>';
}

function wireDigitDots_(inputId, dotsId, expectedLen){
  var input = document.getElementById(inputId), box = document.getElementById(dotsId);
  if (!input || !box) return;
  function update(){
    var n = (input.value.match(/\d/g) || []).length;
    var over = n > expectedLen;
    var spans = box.children;
    for (var i = 0; i < spans.length; i++) {
      spans[i].className = over ? 'over' : (i < n ? 'filled' : '');
    }
  }
  input.addEventListener('input', update);
  update();
}

function lnReasonPrompt_(cb){
  var reason = prompt('Sababu / Reason (required):');
  if (reason && reason.trim()) cb(reason.trim());
}

VIEWS.ln_pipeline = function(){
  return srv('pipelineSummary', {}).then(function(d){
    HEAD = '<div class="kpis">'
      + kpi('Jumla ya mikopo / Total loans', money(d.total))
      + kpi('Dirisha la malipo / Disbursement window', d.windowOpen ? 'WAZI / OPEN' : 'FUNGWA / CLOSED', null, d.windowOpen ? 'good' : 'bad')
      + '</div>'
      + '<table class="otable"><thead><tr><th>Stage</th><th class="r">Count</th><th class="r">Amount (TZS)</th></tr></thead><tbody>'
      + d.stages.map(function(s){
          return '<tr><td><span class="chip ' + lnStageChip(s.stage) + '">' + esc(s.stage) + '</span></td>'
            + '<td class="r">' + money(s.count) + '</td><td class="r">' + money(s.amount) + '</td></tr>';
        }).join('') + '</tbody></table>';
    S.rows = []; S.cols = [];
  });
};

/* ---------- Customer Service: search first, register second ---------- */
VIEWS.ln_cs = function(){
  var scope = S.args.scope || 'search';
  if (scope === 'complaints') {
    return srv('complaintsList', {}).then(function(d){
      HEAD = '<div class="kpis">'
        + kpi('Wazi / Open', money(d.open), null, d.open ? 'bad' : 'good')
        + kpi('Yametatuliwa / Resolved', money(d.resolved), null, 'good')
        + '</div>' + lnCsScopeBar_(scope)
        + bar('<button class="btn sm" id="lnNewComplaint">+ Lalamiko / New complaint</button>');
      S.rows = d.rows;
      S.cols = [col('created_at', 'Logged', 'dt'), col('complainant', 'Complainant'),
        col('ref', 'REF#'), col('team', 'Team'), col('category', 'Category'),
        { key:'status', label:'Status', kind:'chip', chip:function(r){ return chipFor(r.status); } },
        col('details', 'Details'), col('logged_by', 'Logged by')];
      ONROW = null;
      S.foot = money(d.open) + ' open';
    });
  }
  HEAD = lnCsScopeBar_(scope)
    + bar('<input id="lnCsQ" placeholder="Jina au namba / Name or phone" style="min-width:220px">'
    + '<button class="btn sm" id="lnCsSearchBtn">Tafuta / Search</button>'
    + '<button class="btn sm ghost" id="lnCsNewBtn">+ Mteja mpya / New customer</button>');
  S.rows = []; S.cols = [];
  return Promise.resolve();
};

function lnCsScopeBar_(scope){
  return bar('<select id="lnCsScope">'
    + '<option value="search"' + (scope==='search'?' selected':'') + '>Loan application</option>'
    + '<option value="complaints"' + (scope==='complaints'?' selected':'') + '>Complaint register</option></select>');
}

/* Wired from wireForms() -- see the note above it: a view function's own promise resolves
   BEFORE drawView_() paints HEAD into the DOM, so wiring a button here rather than there means
   $('#lnCsSearchBtn') does not exist yet and the click never attaches. */
function wireLnCs_(){
  var sc = document.getElementById('lnCsScope');
  if (sc) sc.onchange = function(){ S.args.scope = this.value; render({ force:true }); };
  var nc = document.getElementById('lnNewComplaint');
  if (nc) nc.onclick = function(){
    drawer('<h3>Lalamiko jipya / New complaint</h3>'
      + '<div class="fld"><label>Customer REF# (if known)</label><input id="lnCxRef"></div>'
      + '<div class="fld"><label>Team</label><input id="lnCxTeam"></div>'
      + '<div class="fld"><label>Complaint type</label><input id="lnCxType" placeholder="e.g. Misallocation, Loan appeal"></div>'
      + '<div class="fld"><label>Details</label><input id="lnCxDetails"></div>'
      + '<button class="btn w" id="lnCxSave">Sajili / Register</button>');
    $('#lnCxSave').onclick = function(){
      lnAct('csComplaint', { ref: $('#lnCxRef').value.trim(), team: $('#lnCxTeam').value.trim(),
        type: $('#lnCxType').value.trim(), details: $('#lnCxDetails').value.trim() },
        'Registered.', function(){ go('ln_cs'); });
    };
  };
  var b = document.getElementById('lnCsSearchBtn');
  if (b) b.onclick = function(){
    var q = document.getElementById('lnCsQ').value.trim();
    if (!q) return;
    srv('csSearch', { q: q }).then(function(d){
      S.rows = d.rows; S.cols = [
        col('docket', 'Docket'), col('full_name', 'Full name'),
        { key:'mobile', label:'Phone', kind:'tel' }, col('branch', 'Branch'), col('team', 'Team')];
      ONROW = function(r){ lnCsRegisterForm_(r); };
      drawView_();
    }).catch(function(e){ toast(String(e.message||e), true); });
  };
  var n = document.getElementById('lnCsNewBtn');
  if (n) n.onclick = function(){ lnCsRegisterForm_(null); };
}

/* "If Disbursement mode is momo or bank then put choice not typing" -- a free-text field for a
   value that is only ever one of two things is how "Momo", "momo", "MOMO", "mobile money" all
   end up meaning the same thing to a person and four different things to a report. */
var DISB_MODES = ['Momo', 'Bank'];

// "gender should be choice not filling" / "ID too - choose type to fill wether NIDA, drivers,
// voters, passport etc" -- GENDERS is a plain choice; ID_TYPES maps the choice to the ONE
// column that type's number actually belongs in (customers already has all of them -- see
// RUN-ME-001 -- this is only which one the form shows and writes to).
var GENDERS = ['Female', 'Male'];

var ID_TYPES = { 'NIDA': 'national_id', 'Driving Licence': 'driving_licence', 'Voters ID': 'voters_id', 'Passport': 'passport_no', 'Other': 'other_id_no' };

// "the credit analysts will review that and return anything thats not adequate for refilling
// with choice comment to return" -- nothing at team level is compulsory (see teamAssessmentSave
// -- every section still saves whatever's filled, gaps and all); the gate is here instead, at
// the one place that already had the power to send a loan back: credit's own reject.
var CREDIT_RETURN_REASONS = ['Missing signature', 'Missing customer photo',
  'Missing guarantor details', 'Location (GPS) not captured', 'Verification photo missing',
  'Incomplete business details', 'Other'];
// "are all information captured enough for the future creditinfo crb report?" -- these
// columns already existed on customers (RUN-ME-001, "Every one of these is a CreditInfo
// Individual column") but nothing on any screen ever asked for them. Same pattern as GENDERS/
// ID_TYPES above: a plain choice list, generic passthrough on the server does the rest.
var MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed'];
var EDUCATIONS = ['None', 'Primary', 'Secondary', 'Tertiary'];
var EMPLOYMENTS = ['SelfEmployed', 'Employed', 'Both', 'Unemployed'];
var RESIDENCE_TYPES = ['Owned', 'Rented', 'Family'];
var RESIDENCY_CAPACITIES = ['Owner', 'Tenant', 'Living with family'];

/* BRANCH, NOT TEAM, AT REGISTRATION.

     "Registering a new customer is always by selecting branch so that the customer gets
      visible in manager assignment window then manager selects team to assign"

   Customer service used to type a team in free text -- which meant either guessing which of a
   branch's several teams would end up serving the customer, or leaving it blank. Now it picks
   a BRANCH from what actually exists (srv('branchList'), the same list this session's
   2026-08-19-team-branch.sql work put on the teams table), and the team is left for the
   manager to decide from the branch and the landmark -- see lnManagerAssignForm_. */
function lnCsRegisterForm_(existing){
  srv('branchList').then(function(bl){
    var regions = bl.regions || [], byRegion = bl.byRegion || {};
    // Which region the branch already on record belongs to, so re-opening a partly-filled
    // application shows both selects already lined up rather than just the branch.
    var curRegion = '';
    if (existing && existing.branch) {
      curRegion = regions.find(function(rg){ return (byRegion[rg]||[]).indexOf(existing.branch) >= 0; }) || '';
    }
    drawer('<h3>' + (existing ? esc(existing.full_name) : 'Mteja mpya / New customer') + '</h3>'
      + '<div class="sub">Loan Application -- requested amount only. KYC (District included) is captured by the team at assessment, not here -- CS stays fast.</div>'
      + '<div class="fld"><label>Full name</label><input id="lnFullName" value="' + esc(existing ? existing.full_name : '') + '"' + (existing ? ' readonly' : '') + '></div>'
      // Mobile and Disbursement mode sequenced together on purpose: a Momo disbursement pays
      // OUT to the same number just typed above, so the two belong next to each other, not
      // Mobile up top and Disbursement mode buried after Region/Branch/Landmark.
      + '<div class="fld"><label>Mobile</label><input id="lnMobile" value="' + esc(existing ? existing.mobile : '') + '"' + (existing ? ' readonly' : '') + '></div>'
      // "add neighbor no at customer service, they ask them who is near when we can't reach
      // you, and not the guarantor" -- someone physically near the customer, not the
      // customer's own alternate number and not the guarantor.
      + '<div class="fld"><label>Simu ya jirani / Neighbor\'s phone</label><input id="lnNeighborNo" value="' + esc(existing ? existing.neighbor_no : '') + '"></div>'
      + '<div class="fld"><label>Disbursement mode</label><select id="lnDisbMode">'
        + '<option value="">— chagua / choose —</option>'
        + DISB_MODES.map(function(m){ return '<option>' + m + '</option>'; }).join('')
        + '</select></div>'
      // "after disb mode in loanapp, fill the disb no (mobile money/momo no or bank a/c no)" --
      // right where the mode is chosen, not left for credit approval to ask a second time with
      // nothing on file. Momo and Bank fields swap in and out under the SAME mode select, same
      // pattern lnCreditForm_ already uses further down the pipeline.
      + '<div class="fld" id="lnMomoFld"><label>Namba ya Momo / Momo no.</label><input id="lnMomoNo"></div>'
      + '<div class="fld" id="lnBankFld"><label>Jina la Benki / Bank name</label><input id="lnBankName"></div>'
      + '<div class="fld" id="lnAcctFld"><label>Namba ya Akaunti / Account no.</label><input id="lnAcctNo"></div>'
      // "shift requested amount in apploan before region selection and add filling business
      // type before location choices too" -- both now sit here, ahead of Region/Branch/Landmark.
      + '<div class="fld"><label>Requested amount (TZS)</label><input id="lnAmount" type="number"></div>'
      + '<div class="fld"><label>Aina ya biashara / Business type</label><input id="lnBizType" value="' + esc(existing ? existing.business_type : '') + '"></div>'
      /* REGION FIRST, THEN BRANCH.
           "selecting a branch should autofill its region since customer service agents dont
            know that / infact they should select among regions and then choose drop list of
            branches in the regions"
         An agent knows the region a customer is in; ~80 branch names in one flat list is a
         search, not a choice. Branch starts disabled and empty -- it has nothing to offer
         until a region narrows it down to the handful that are actually in it. */
      + '<div class="fld"><label>Mkoa / Region</label><select id="lnRegion">'
        + '<option value="">' + (regions.length ? '— chagua mkoa / choose a region —' : 'Hakuna matawi -- run 2026-08-19-team-branch-DATA.sql / no branches -- run the migration') + '</option>'
        + regions.map(function(rg){ return '<option' + (rg===curRegion?' selected':'') + '>' + esc(rg) + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Tawi / Branch</label><select id="lnBranch"' + (curRegion?'':' disabled') + '>'
        + '<option value="">' + (curRegion ? '— chagua tawi / choose a branch —' : '— chagua mkoa kwanza / choose a region first —') + '</option>'
        + (byRegion[curRegion]||[]).map(function(b){ return '<option' + (existing && existing.branch===b?' selected':'') + '>' + esc(b) + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Landmark</label><input id="lnLandmark" placeholder="What the manager will assign a team from"></div>'
      + '<button class="btn w" id="lnCsSubmit">Sajili / Register application</button>');
    // Momo no. for a Momo disbursement, Bank name + Account no. for a Bank one -- nothing shown
    // (and nothing required) until a mode is actually chosen.
    function toggleDisbFlds(){
      var mode = $('#lnDisbMode').value;
      $('#lnMomoFld').style.display = mode === 'Momo' ? '' : 'none';
      $('#lnBankFld').style.display = mode === 'Bank' ? '' : 'none';
      $('#lnAcctFld').style.display = mode === 'Bank' ? '' : 'none';
    }
    $('#lnDisbMode').onchange = toggleDisbFlds; toggleDisbFlds();
    $('#lnRegion').onchange = function(){
      var rg = this.value, branches = byRegion[rg] || [];
      var sel = $('#lnBranch');
      sel.disabled = !rg;
      sel.innerHTML = '<option value="">' + (rg ? '— chagua tawi / choose a branch —' : '— chagua mkoa kwanza / choose a region first —') + '</option>'
        + branches.map(function(b){ return '<option>' + esc(b) + '</option>'; }).join('');
    };
    $('#lnCsSubmit').onclick = function(){
      lnAct('csRegister', {
        customer_id: existing ? existing.id : undefined,
        docket: existing ? existing.docket : undefined,
        full_name: $('#lnFullName').value.trim(), mobile: $('#lnMobile').value.trim(),
        neighbor_no: $('#lnNeighborNo').value.trim(),
        branch: $('#lnBranch').value.trim(), region: $('#lnRegion').value.trim(),
        landmark: $('#lnLandmark').value.trim(), business_type: $('#lnBizType').value.trim(),
        disbursement_mode: $('#lnDisbMode').value.trim(), amount: Number($('#lnAmount').value) || 0,
        momo: $('#lnMomoNo').value.trim(), bank_name: $('#lnBankName').value.trim(), account_no: $('#lnAcctNo').value.trim(),
      }, 'Application registered.');
    };
  }).catch(function(e){ toast(String(e.message||e), true); });
}

/* ---------- Manager: assignment ---------- */
VIEWS.ln_manager = function(){
  return srv('managerQueue', {}).then(function(d){
    S.rows = d.rows; S.cols = [
      col('loan_id', 'Ref'), col('docket_no', 'Docket'), col('full_name', 'Customer'),
      { key:'contact', label:'Phone', kind:'tel' }, col('branch', 'Branch'), col('team', 'Team'),
      col('nearest_landmark', 'Landmark'),
      { key:'requested_amt', label:'Requested', kind:'money' }];
    ONROW = function(r){ lnManagerAssignForm_(r); };
    S.foot = money(d.rows.length) + ' waiting for assignment';
  });
};

/* "Manager assigning to a team should be choice not filling" -- a free-text box let a typo or
   a stale team name misfile a customer with nothing to catch it. Now a SELECT, offered from the
   same teamsByBranch branchList() already builds for CS registration -- the branch's own teams,
   nothing typed. Enforced again on the server (managerAssign), not just offered here. */
function lnManagerAssignForm_(loan){
  srv('branchList').then(function(bl){
    var teams = (bl.teamsByBranch || {})[loan.branch] || [];
    drawer('<h3>' + esc(loan.full_name) + '</h3>'
      + '<div class="sub">Ref ' + esc(loan.loan_id) + ' &middot; Requested ' + money(loan.requested_amt) + '</div>'
      // Branch and landmark are what a manager assigns FROM -- registration set the branch,
      // not a team, precisely so this decision is made here, from where the customer actually is.
      + '<div class="fld"><label>Branch</label><div style="padding:8px 0;font-weight:600">' + esc(loan.branch || '—') + '</div></div>'
      + (loan.nearest_landmark ? '<div class="fld"><label>Landmark</label><div style="padding:8px 0">' + esc(loan.nearest_landmark) + '</div></div>' : '')
      + '<div class="fld"><label>Assign to team (or SHIFT to a different one of yours)</label><select id="lnAssignTeam"' + (teams.length?'':' disabled') + '>'
        + '<option value="">' + (teams.length ? '— chagua timu / choose a team —' : 'Hakuna timu za tawi hili -- run 2026-08-19-team-branch-DATA.sql / no teams on file for this branch') + '</option>'
        + teams.map(function(t){ return '<option' + (loan.team===t?' selected':'') + '>' + esc(t) + '</option>'; }).join('')
        + '</select></div>'
      + '<button class="btn w" id="lnAssignBtn">Assign</button>'
      + '<button class="btn w ghost" id="lnRejectBtn" style="margin-top:8px">Reject</button>');
    $('#lnAssignBtn').onclick = function(){
      lnAct('managerAssign', { loan_id: loan.id, team: $('#lnAssignTeam').value.trim() }, function(r){
        var m = r && r.planMerged;
        if (!m) return 'Assigned.';
        if (m.error) return { bad: true, text: 'Assigned, LAKINI mpango wa tathmini haukuunganishwa / BUT the assessment plan was NOT merged: ' + m.error };
        return m.sections && m.sections.length
          ? 'Assigned. Mpango wa tathmini umeunganishwa (' + m.sections.join(', ') + ') / Assessment plan merged into the recommendation.'
          : 'Assigned. Mpango wa tathmini umefungwa -- haukuwa na rasimu / Assessment plan closed (nothing was drafted on it).';
      }, function(){ go('ln_manager'); });
    };
    $('#lnRejectBtn').onclick = function(){
      lnReasonPrompt_(function(reason){ lnAct('managerReject', { loan_id: loan.id, reason: reason }, 'Rejected.', function(){ go('ln_manager'); }); });
    };
  }).catch(function(e){ toast(String(e.message||e), true); });
}

/* ---------- Team: the five-section assessment, saved as it goes ---------- */
VIEWS.ln_team = function(){
  return srv('teamQueue', {}).then(function(d){
    S.rows = d.rows; S.cols = [
      col('loan_id', 'Ref'), col('full_name', 'Customer'), col('branch', 'Branch'), col('team', 'Team'),
      { key:'contact', label:'Phone', kind:'tel' }, col('stage', 'Stage')];
    ONROW = function(r){ lnTeamAssessForm_(r); };
  });
};

/* THE WHOLE FORM OPENS PRE-FILLED, NOT BLANK -- teamAssessDetail, not the bare row
   teamQueue's table carries. "nothing is lost if you leave and come back" was already true in
   the database; every save here except lnAct's own closeDrawer used to leave the SCREEN saying
   otherwise. Captures upload the moment they happen (kycUpload), independent of the section's
   own Save button -- a photo taken and then the drawer closed before pressing Save is still on
   file, not lost with the rest of the section's typed fields. */
/* AN ASSESSMENT PLAN, READ AS IF IT WERE A LOAN'S DETAIL, so the one recommendation form
   below draws it. The draft is saved section by section in exactly the field names the form
   sends (assessmentPlanDraftSave), so turning it back into {loan, customer, guarantors,
   assessment} is a matter of putting each section's fields where the form looks for them. */
function lnPlanAsDetail_(plan){
  var dr = plan.draft && typeof plan.draft === 'object' ? plan.draft : {};
  var p = dr.personal || {}, b = dr.business || {}, r = dr.residence || {}, rec = dr.recommendation || {};
  var c = {};
  Object.keys(p).forEach(function(k){ if (k !== 'other_number_form_url' && k !== 'other_number_form_holder_url') c[k] = p[k]; });
  Object.keys(r).forEach(function(k){ if (k !== 'verified' && k !== 'guarantor_verified') c[k] = r[k]; });
  Object.keys(b).forEach(function(k){ if (k !== 'verified') c[k] = b[k]; });
  return {
    loan: { id: 'plan:' + plan.id, full_name: plan.full_name, contact: plan.phone, team: plan.team,
      loan_id: 'MPANGO / PLAN', docket_no: '', track_no: 1, requested_amt: null,
      collateral_type: rec.collateral_type || '',
      collateral_value: (rec.collateral_value != null && rec.collateral_value !== '') ? rec.collateral_value : null,
      other_number_form_url: p.other_number_form_url || null, other_number_form_holder_url: p.other_number_form_holder_url || null,
      contract_photo_urls: [] },
    customer: c,
    guarantors: (dr.guarantor && dr.guarantor.guarantors) || [],
    assessment: { recommend_amount: rec.amount || null, credit_score: rec.credit_score, zone_visited: rec.zone, remarks: rec.remarks,
      officer_name: rec.officer_name, officer_signature_url: rec.officer_signature_url,
      business_verified: !!b.verified, residence_verified: !!r.verified, guarantor_residence_verified: !!r.guarantor_verified },
  };
}

/* One form, two owners. With a loan row it is Team · Recommendation, saving through
   teamAssessmentSave and submitting through teamSubmit. With a PLAN row it is the same five
   sections drafted on the Assessment Plan -- "allow the pre-fillable info of loan
   recommendation at assessment plan and saving only - submitting will only happen at
   recommendation" -- saving through assessmentPlanDraftSave, photos under the plan, and no
   submit, reject, contract or KYC-copy at all: those need a loan, and the loan arrives the
   day the customer is assigned, when the draft is merged into it (mergePlanIntoLoan_). */
function lnTeamAssessForm_(loanRow, planRow){
  var planMode = !!planRow;
  var detail = planMode ? Promise.resolve(lnPlanAsDetail_(planRow)) : srv('teamAssessDetail', { loan_id: loanRow.id });
  detail.then(function(d){
    var loan = d.loan, c = d.customer || {}, a = d.assessment || {};
    var g = (d.guarantors || [])[0] || {};
    var alts = (d.guarantors || []).slice(1, 6);
    while (alts.length < 5) alts.push({});
    var locked = !planMode && Number(loan.track_no) > 1;
    var saveSection_ = function(section, fields){
      var p = planMode
        ? lnActKeep_('assessmentPlanDraftSave', { id: planRow.id, section: section, fields: fields }, 'Imehifadhiwa kwenye mpango / Saved on the plan.')
        : lnActKeep_('teamAssessmentSave', { loan_id: loan.id, section: section, fields: fields }, 'Saved.');
      // Only after the server said yes: every capture in this section now reads "Saved ✓".
      return p.then(function(r){ markSectionSaved_(section); return r; });
    };
    var idType = c.id_type || 'NIDA';
    var idNo = ID_TYPES[idType] ? (c[ID_TYPES[idType]] || '') : '';

    // "horizontal (not vertical) assessment stage switcher with business as 2nd stage" --
    // one panel shown at a time instead of one long scroll, business moved ahead of
    // residence. "sticky customer card header while scrolling" -- the name/ref/switcher stay
    // pinned to the top of the drawer's own scroll box (see .ln-sticky in the stylesheet)
    // through every stage, not just the first.
    var STAGE_TABS_ = [['personal', '1. Personal'], ['business', '2. Business'],
      ['residence', '3. Residence'], ['guarantor', '4. Guarantor'], ['recommendation', '5. Recommendation']];
    drawer('<div class="ln-sticky"><h3>' + esc(loan.full_name) + ' &middot; '
        + (planMode ? 'Mpango / Plan &middot; ' + esc(planRow.planned_date || '') : 'Ref ' + esc(loan.loan_id)) + '</h3>'
      + '<div class="sub">' + (planMode
          ? 'RASIMU TU. Kila sehemu huhifadhiwa kwenye mpango; kuwasilisha hufanyika kwenye Team &middot; Recommendation baada ya kupangiwa. / DRAFT ONLY. Each section saves on the plan; submitting happens at Team &middot; Recommendation once the customer is assigned.'
          : 'Each section SAVES ON ITS OWN -- nothing is lost if you leave and come back.') + '</div>'
      + '<div class="ln-stagebar">' + STAGE_TABS_.map(function(t, i){
          return '<button type="button" class="btn sm ln-stage-btn' + (i ? ' ghost' : '') + '" data-stage="' + t[0] + '">' + t[1] + '</button>';
        }).join('') + '</div></div>'

      + '<div class="ln-stage-panel on" data-stage="personal">'
      + '<div class="card"><div class="card-h">1. Personal details' + (locked ? ' <span class="chip mut" style="font-size:10px">Track ' + loan.track_no + ' -- identity fields locked</span>' : '') + '</div>'
      // "are all information captured enough for the future creditinfo crb report?" -- the
      // bureau "wants the parts, not only the whole" (RUN-ME-001): full_name stays what every
      // other screen searches and displays, these are the split parts alongside it, same
      // write-once treatment as DOB/national ID since they identify the same one person.
      + '<div class="fld"><label>Jina la kwanza / First name</label><input id="lnFirstName" value="' + esc(c.first_name || '') + '"' + (locked ? ' disabled' : '') + '></div>'
      + '<div class="fld"><label>Majina ya kati / Middle name(s)</label><input id="lnMiddleNames" value="' + esc(c.middle_names || '') + '"' + (locked ? ' disabled' : '') + '></div>'
      + '<div class="fld"><label>Jina la ukoo la sasa / Present surname</label><input id="lnPresentSurname" value="' + esc(c.present_surname || '') + '"' + (locked ? ' disabled' : '') + '></div>'
      + '<div class="fld"><label>Jina la ukoo la kuzaliwa / Birth surname</label><input id="lnBirthSurname" value="' + esc(c.birth_surname || '') + '"' + (locked ? ' disabled' : '') + '></div>'
      + '<div class="fld"><label>Date of birth</label><input id="lnDob" type="date" value="' + esc(c.dob || '') + '"' + (locked ? ' disabled' : '') + '></div>'
      + '<div class="fld"><label>Gender</label><select id="lnGender"' + (locked ? ' disabled' : '') + '>'
        + '<option value="">— chagua / choose —</option>'
        + GENDERS.map(function(x){ return '<option' + (c.gender === x ? ' selected' : '') + '>' + x + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Hali ya ndoa / Marital status</label><select id="lnMarital">'
        + '<option value="">— chagua / choose —</option>'
        + MARITAL_STATUSES.map(function(x){ return '<option' + (c.marital_status === x ? ' selected' : '') + '>' + x + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Wenza / Spouses</label><input id="lnSpouses" type="number" value="' + (c.spouses != null ? c.spouses : '') + '"></div>'
      + '<div class="fld"><label>Watoto / Children</label><input id="lnChildren" type="number" value="' + (c.children != null ? c.children : '') + '"></div>'
      + '<div class="fld"><label>Elimu / Education</label><select id="lnEducation">'
        + '<option value="">— chagua / choose —</option>'
        + EDUCATIONS.map(function(x){ return '<option' + (c.education === x ? ' selected' : '') + '>' + x + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Aina ya kitambulisho / ID type</label><select id="lnIdType"' + (locked ? ' disabled' : '') + '>'
        + Object.keys(ID_TYPES).map(function(x){ return '<option' + (idType === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Namba ya kitambulisho / ID number</label><input id="lnIdNo" value="' + esc(idNo) + '"' + (locked ? ' disabled' : '') + '>'
      + (idType === 'NIDA' ? digitDots_('lnIdNoDots', 20) : '') + '</div>'
      + '<div class="fld" id="lnIdOtherFld"><label>Aina gani? / Which kind?</label><input id="lnIdOther" value="' + esc(c.other_id_type || '') + '"' + (locked ? ' disabled' : '') + '></div>'
      + '<div class="fld"><label>TIN</label><input id="lnTin" value="' + esc(c.tin || '') + '"' + (locked ? ' disabled' : '') + '></div>'
      + '<div class="sub" style="margin:10px 0 4px">Kazi / Employment</div>'
      + '<div class="fld"><label>Kazi/shughuli / Occupation</label><input id="lnOccupation" value="' + esc(c.occupation || '') + '"></div>'
      + '<div class="fld"><label>Ajira / Employment</label><select id="lnEmployment">'
        + '<option value="">— chagua / choose —</option>'
        + EMPLOYMENTS.map(function(x){ return '<option' + (c.employment === x ? ' selected' : '') + '>' + x + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Mwajiri (kama yupo) / Employer (if any)</label><input id="lnEmployerName" value="' + esc(c.employer_name || '') + '"></div>'
      + '<div class="sub" style="margin:10px 0 4px">Mawasiliano zaidi / More contact</div>'
      + '<div class="fld"><label>Simu ya pili / Alternate phone</label><input id="lnMobileAlt" value="' + esc(c.mobile_alt || '') + '">' + digitDots_('lnMobileAltDots', 10) + '</div>'
      + '<div class="fld"><label>Barua pepe / Email</label><input id="lnEmail" type="email" value="' + esc(c.email || '') + '"></div>'
      // "The assessments always have a nida form filled for customers who receive money with
      // nos that ain't under their registration so there our camera has to take 2 photos, of
      // the doc and the 2nd the customer holding it" -- HOPE's own consent/authorisation form
      // (FOMU YA MAKUBALIANO ... MALIPO YA MKOPO KUPITIA NAMBA YA SIMU YA MTU MWINGINE), needed
      // only when the receiving number is not the customer's own; left blank otherwise.
      + '<div class="sub" style="margin:10px 0 4px">Kama namba ya kupokea sio ya mteja / If the receiving number is not the customer\'s own</div>'
      + captureRowPhoto_('Fomu ya idhini (hati) / Consent form (the document)', 'lnOtherNumFormBtn', 'lnOtherNumFormStatus')
      + captureRowPhoto_('Mteja akishikilia fomu / Customer holding the form', 'lnOtherNumHolderBtn', 'lnOtherNumHolderStatus')
      + captureRowPad_('Sahihi / Signature', 'lnSigPad', 'lnSigClear')
      + captureRowPhoto_('Picha ya pasipoti / Passport-size photo', 'lnPhotoBtn', 'lnPhotoStatus')
      + '<button class="btn sm" id="lnSavePersonal">Save this section</button></div>'
      + '</div>'

      // "business as 2nd stage" -- ahead of residence now, business is what an officer
      // usually reaches first on a visit (the customer is normally AT the business).
      + '<div class="ln-stage-panel" data-stage="business">'
      + '<div class="card"><div class="card-h">2. Business verification</div>'
      // "business type from the cs registration, fill business name and capture live
      // location coordinates for all 3 placess business and their residences" -- business
      // TYPE was already asked at CS registration; this is the name, and the third place.
      + '<div class="fld"><label>Jina la biashara / Business name</label><input id="lnBizName" value="' + esc(c.business_name || '') + '"></div>'
      // "Every one of these is a CreditInfo Individual column" -- income figures officers
      // already ask about verbally at this visit; weekly_profit is derived server-side from
      // daily_profit x 6, same as it already was for the other columns in this list.
      + '<div class="fld"><label>Mauzo ya siku / Daily sales (TZS)</label><input id="lnDailySales" type="number" value="' + (c.daily_sales != null ? c.daily_sales : '') + '"></div>'
      + '<div class="fld"><label>Faida ya siku / Daily profit (TZS)</label><input id="lnDailyProfit" type="number" value="' + (c.daily_profit != null ? c.daily_profit : '') + '"></div>'
      + '<div class="fld"><label>Matumizi ya wiki / Weekly expenses (TZS)</label><input id="lnWeeklyExpenses" type="number" value="' + (c.weekly_expenses != null ? c.weekly_expenses : '') + '"></div>'
      + captureRowGps_('Mahali pa biashara / Business location', 'lnBizGpsBtn', 'lnBizGpsStatus')
      // "3 business verification photos (customer alone / customer+officer / customer+
      // officer+guarantor)" (RUN-ME-011) -- the one photo above becomes the first of three.
      + captureRowPhoto_('Picha 1: mteja peke yake / Photo 1: customer alone', 'lnBizPhotoBtn', 'lnBizPhotoStatus')
      + captureRowPhoto_('Picha 2: mteja na afisa / Photo 2: customer + officer', 'lnBizPhoto2Btn', 'lnBizPhoto2Status')
      + captureRowPhoto_('Picha 3: mteja, afisa na mdhamini / Photo 3: customer + officer + guarantor', 'lnBizPhoto3Btn', 'lnBizPhoto3Status')
      + '<label><input type="checkbox" id="lnBizOk"' + (a.business_verified ? ' checked' : '') + '> Business ownership verified</label>'
      + '<button class="btn sm" id="lnSaveBusiness" style="margin-top:8px">Save this section</button></div>'
      + '</div>'

      // "customer residense and business verification should be segmented since officers
      // could reach those in different timeframes" -- these were one card behind one save
      // button, so a visit to only the residence (or only the business) still needed the
      // other half filled in before anything could be saved. Two cards, two independent
      // saves now -- each already writes to its own SECTIONS entry server-side ('residence' /
      // 'business'), this was purely a client-side coupling.
      + '<div class="ln-stage-panel" data-stage="residence">'
      + '<div class="card"><div class="card-h">3. Customer residence verification</div>'
      + '<div class="fld"><label>Mtaa / Street</label><input id="lnCustStreet" value="' + esc(c.street || '') + '"></div>'
      + '<div class="fld"><label>Kata / Ward</label><input id="lnCustWard" value="' + esc(c.ward || '') + '"></div>'
      + '<div class="fld"><label>Wilaya / District</label><input id="lnDistrict" value="' + esc(c.district || '') + '"></div>'
      + '<div class="fld"><label>Namba ya kiwanja / Block number</label><input id="lnCustBlock" value="' + esc(c.block_number || '') + '"></div>'
      + '<div class="fld"><label>Aina ya makazi / Type of residence</label><select id="lnCustResType">'
        + '<option value="">— chagua / choose —</option>'
        + RESIDENCE_TYPES.map(function(x){ return '<option' + (c.type_of_residence === x ? ' selected' : '') + '>' + x + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Hadhi ya makazi / Residency capacity</label><select id="lnCustResCap">'
        + '<option value="">— chagua / choose —</option>'
        + RESIDENCY_CAPACITIES.map(function(x){ return '<option' + (c.residency_capacity === x ? ' selected' : '') + '>' + x + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Miaka ya kuishi hapo / Years at this residence</label><input id="lnCustResYears" type="number" step="0.1" value="' + (c.years_of_residence != null ? c.years_of_residence : '') + '"></div>'
      + captureRowGps_('Mahali pa makazi ya mteja / Customer residence location', 'lnCustGpsBtn', 'lnCustGpsStatus')
      // "4 residence photos each for customer and guarantor" (RUN-ME-011).
      + captureRowPhoto_('Picha 1 ya uthibitisho makazi (na afisa) / Photo 1: residence verification (with officer)', 'lnCustResPhotoBtn', 'lnCustResPhotoStatus')
      + captureRowPhoto_('Picha 2 ya makazi / Photo 2: residence', 'lnCustResPhoto2Btn', 'lnCustResPhoto2Status')
      + captureRowPhoto_('Picha 3 ya makazi / Photo 3: residence', 'lnCustResPhoto3Btn', 'lnCustResPhoto3Status')
      + captureRowPhoto_('Picha 4 ya makazi / Photo 4: residence', 'lnCustResPhoto4Btn', 'lnCustResPhoto4Status')
      // Kiambatanisho Na. 3 of the loan contract: "Barua ya utambulisho wa makazi na biashara
      // ya Mkopaji kutoka Serikali ya Mtaa" -- a photograph OF a letter the local government
      // office issues, distinct from the officer-present verification photo above it.
      + captureRowPhoto_('Barua ya Serikali ya Mtaa (makazi/biashara) / Local govt letter (residence/business)', 'lnCustLetterBtn', 'lnCustLetterStatus')
      + '<label><input type="checkbox" id="lnResOk"' + (a.residence_verified ? ' checked' : '') + '> Customer residence verified</label><br>'
      + '<label><input type="checkbox" id="lnGResOk"' + (a.guarantor_residence_verified ? ' checked' : '') + '> Guarantor residence verified</label>'
      + '<button class="btn sm" id="lnSaveResidence" style="margin-top:8px">Save this section</button></div>'
      + '</div>'

      + '<div class="ln-stage-panel" data-stage="guarantor">'
      + '<div class="card"><div class="card-h">4. Guarantor</div>'
      + '<div class="fld"><label>Full name</label><input id="lnGName" value="' + esc(g.full_name || '') + '"></div>'
      + '<div class="fld"><label>Phone</label><input id="lnGPhone" value="' + esc(g.phone || '') + '">' + digitDots_('lnGPhoneDots', 10) + '</div>'
      + '<div class="fld"><label>Relationship</label><input id="lnGRel" value="' + esc(g.relationship || '') + '"></div>'
      // "guarantor id should be choices too.. not just nida" -- same choice as personal
      // details; stored in the guarantor's one national_id column, alongside id_type saying
      // which kind it actually is (no bureau reporting requires the guarantor to have a
      // separate column per type the way the customer does).
      + '<div class="fld"><label>Aina ya kitambulisho / ID type</label><select id="lnGIdType">'
        + Object.keys(ID_TYPES).map(function(x){ return '<option' + ((g.id_type || 'NIDA') === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Namba ya kitambulisho / ID number</label><input id="lnGIdNo" value="' + esc(g.national_id || '') + '">'
      + ((g.id_type || 'NIDA') === 'NIDA' ? digitDots_('lnGIdNoDots', 20) : '') + '</div>'
      + '<div class="fld"><label>Kazi/shughuli / Occupation</label><input id="lnGOccupation" value="' + esc(g.occupation || '') + '"></div>'
      // "residence and business ver should be filled street, ward, district for both customer
      // and guarantor" -- the guarantor's half lives here, alongside the rest of their own
      // record, not split off into section 4 where their row might not exist yet.
      + '<div class="fld"><label>Mtaa / Street</label><input id="lnGStreet" value="' + esc(g.street || '') + '"></div>'
      + '<div class="fld"><label>Kata / Ward</label><input id="lnGWard" value="' + esc(g.ward || '') + '"></div>'
      + '<div class="fld"><label>Wilaya / District</label><input id="lnGDistrict" value="' + esc(g.district || '') + '"></div>'
      + '<div class="fld"><label>Namba ya kiwanja / Block number</label><input id="lnGBlock" value="' + esc(g.block_number || '') + '"></div>'
      + '<div class="fld"><label>Aina ya makazi / Type of residence</label><select id="lnGResType">'
        + '<option value="">— chagua / choose —</option>'
        + RESIDENCE_TYPES.map(function(x){ return '<option' + (g.type_of_residence === x ? ' selected' : '') + '>' + x + '</option>'; }).join('')
        + '</select></div>'
      + '<div class="fld"><label>Hadhi ya makazi / Residency capacity</label><select id="lnGResCap">'
        + '<option value="">— chagua / choose —</option>'
        + RESIDENCY_CAPACITIES.map(function(x){ return '<option' + (g.residency_capacity === x ? ' selected' : '') + '>' + x + '</option>'; }).join('')
        + '</select></div>'
      + captureRowGps_('Mahali pa makazi ya mdhamini / Guarantor residence location', 'lnGGpsBtn', 'lnGGpsStatus')
      // "4 residence photos each for customer and guarantor" (RUN-ME-011).
      + captureRowPhoto_('Picha 1 ya uthibitisho makazi ya mdhamini (na afisa) / Photo 1: guarantor residence (with officer)', 'lnGResPhotoBtn', 'lnGResPhotoStatus')
      + captureRowPhoto_('Picha 2 ya makazi ya mdhamini / Photo 2: guarantor residence', 'lnGResPhoto2Btn', 'lnGResPhoto2Status')
      + captureRowPhoto_('Picha 3 ya makazi ya mdhamini / Photo 3: guarantor residence', 'lnGResPhoto3Btn', 'lnGResPhoto3Status')
      + captureRowPhoto_('Picha 4 ya makazi ya mdhamini / Photo 4: guarantor residence', 'lnGResPhoto4Btn', 'lnGResPhoto4Status')
      // Kiambatanisho Na. 2: "Barua ya Utambulisho ya Mdhamini kutoka kwa Serikali ya Mtaa
      // ikimtambua Mdhamini pamoja na makazi yake" -- the guarantor's own local govt letter.
      + captureRowPhoto_('Barua ya Serikali ya Mtaa ya mdhamini / Guarantor local govt letter', 'lnGLetterBtn', 'lnGLetterStatus')
      + captureRowPhoto_('Picha ya mdhamini / Guarantor photo', 'lnGPhotoBtn', 'lnGPhotoStatus')
      + captureRowPad_('Sahihi ya mdhamini / Guarantor signature', 'lnGSigPad', 'lnGSigClear')
      // "we have 5 extra guarantors who we just say are the close people to the customer
      // these are filled names nos and relationship [help in followup by having people to
      // ask whats going on when both customer and guarantor are unreachable]"
      // "the 5 extra guarantors, 3 are (*) compulsory to fill" -- the first 3, marked the same
      // way a required field is marked anywhere else in this form.
      + '<div class="sub" style="margin:10px 0 4px">Wadhamini wa ziada (5) / Extra close contacts (5) -- name, phone, relationship only. Wa kwanza 3 ni lazima (*) / The first 3 are required (*).</div>'
      + [0, 1, 2, 3, 4].map(function(i){
          var alt = alts[i] || {};
          var req = i < 3;
          return '<div class="fld" style="display:flex;gap:6px">'
            + '<input id="lnAlt' + i + 'Name" placeholder="' + (req ? 'Jina* / Name*' : 'Jina / Name') + '" value="' + esc(alt.full_name || '') + '" style="flex:2">'
            + '<input id="lnAlt' + i + 'Phone" placeholder="' + (req ? 'Simu* / Phone*' : 'Simu / Phone') + '" value="' + esc(alt.phone || '') + '" style="flex:1">'
            + '<input id="lnAlt' + i + 'Rel" placeholder="Uhusiano / Relation" value="' + esc(alt.relationship || '') + '" style="flex:1"></div>';
        }).join('')
      + '<button class="btn sm" id="lnSaveGuar" style="margin-top:6px">Save this section</button></div>'
      + '</div>'

      + '<div class="ln-stage-panel" data-stage="recommendation">'
      + '<div class="card"><div class="card-h">5. Team recommendation</div>'
      + '<div class="fld"><label>Recommended amount (TZS)</label><input id="lnRecAmt" type="number" value="' + (a.recommend_amount || loan.requested_amt || '') + '"></div>'
      + '<div class="fld"><label>Credit score</label><input id="lnCreditScore" type="number" step="0.1" value="' + (a.credit_score != null ? a.credit_score : '') + '"></div>'
      // "DHAMANA YA MKOPO ... mali za biashara na mali za nyumbani ... zenye thamani mara
      // mbili ya mkopo" -- the contract's own collateral clause; collateral_type/_value
      // already existed on loans (RUN-ME-001), nothing ever wrote to them until now.
      + '<div class="fld"><label>Aina ya dhamana / Collateral type</label><input id="lnCollType" placeholder="e.g. Business & household assets" value="' + esc(loan.collateral_type || '') + '"></div>'
      + '<div class="fld"><label>Thamani ya dhamana (TZS) / Collateral value</label><input id="lnCollValue" type="number" value="' + (loan.collateral_value != null ? loan.collateral_value : '') + '"></div>'
      + '<div class="fld"><label>Zone visited</label><input id="lnZone" value="' + esc(a.zone_visited || '') + '"></div>'
      + '<div class="fld"><label>Remarks</label><input id="lnRemarks" value="' + esc(a.remarks || '') + '"></div>'
      // "at field officer name filling and signature at recommendation" -- the officer's own
      // attestation that THEY made this visit and this recommendation, taken here rather than
      // assumed from whoever the loan happens to be assigned to (see RUN-ME-008).
      + '<div class="fld"><label>Jina la afisa / Officer name</label><input id="lnOfficerName" value="' + esc(a.officer_name || (S.me && S.me.name) || '') + '"></div>'
      + captureRowPad_('Sahihi ya afisa / Officer signature', 'lnOfficerSigPad', 'lnOfficerSigClear')
      + '<button class="btn sm" id="lnSaveRec">Save this section</button></div>'

      + (planMode
        // "my system will be used for assessment pictures ... they get the kyc and Whatsapp
        // share buttons at assessment plan" -- everything but the signed contract itself
        // (there is no loan yet to sign one for) is available here now, the same as it always
        // was at Team &middot; Recommendation once the customer is assigned.
        ? '<div class="card"><div class="card-h">Picha za tathmini / Assessment pictures</div>'
          + '<button type="button" class="btn sm ghost" id="lnPlanWaBtn">💬 Shiriki WhatsApp / Share on WhatsApp</button>'
          + '<div class="note" style="margin-top:8px">Mkataba na kuwasilisha vinapatikana kwenye Team &middot; Recommendation baada ya mteja kupangiwa; rasimu hii itahamia huko yenyewe. / The contract and Submit live at Team &middot; Recommendation once the customer is assigned; this draft moves there on its own.</div>'
          + '</div>'
          + '<div class="fld" style="margin-top:14px">'
          + '<button class="btn w ghost" id="lnCopyKyc" disabled>📋 Nakili KYC / Copy KYC for WhatsApp</button></div>'
        // "10-photo contract capture + WhatsApp share with autogenerated caption" (RUN-ME-011)
        // -- photographs of the SIGNED PAPER contract, one "add" button rather than ten fixed
        // ones (an officer works through the pages one at a time, however many the contract
        // actually runs to, up to the cap).
        : '<div class="card"><div class="card-h">Mkataba uliosainiwa / Signed contract'
          + '<span class="sub" id="lnContractCount">' + (loan.contract_photo_urls || []).length + '/10</span></div>'
          + '<button type="button" class="btn sm ghost" id="lnContractAddBtn">📷 Ongeza ukurasa / Add a page</button>'
          + '<button type="button" class="btn sm ghost" id="lnContractWaBtn" style="margin-left:6px" disabled>💬 Shiriki WhatsApp / Share on WhatsApp</button>'
          + '</div>'

          + '<div class="fld" style="margin-top:14px">'
          // "Having all the recommendation filled should produce a copy icon on the customer
          // pannel for copying all the loan recommendation KYC organized text to report in
          // whatsapp" -- enabled once there is a recommended amount to report, live as it's typed.
          + '<button class="btn w ghost" id="lnCopyKyc" disabled>📋 Nakili KYC / Copy KYC for WhatsApp</button>'
          + '<button class="btn w" id="lnSubmitRec" style="margin-top:8px">Submit recommendation</button>'
          + '<button class="btn w ghost" id="lnRejectRec" style="margin-top:8px">Reject</button></div>')
      + '</div>');

    // ---- ID type: which number field is actually being asked for ----
    function toggleIdOther(){ $('#lnIdOtherFld').style.display = $('#lnIdType').value === 'Other' ? '' : 'none'; }
    $('#lnIdType').onchange = toggleIdOther; toggleIdOther();

    // ---- the horizontal stage switcher -- one panel visible at a time ----
    document.querySelectorAll('.ln-stage-btn').forEach(function(btn){
      btn.onclick = function(){
        var stage = btn.getAttribute('data-stage');
        document.querySelectorAll('.ln-stage-btn').forEach(function(b){ b.classList.toggle('ghost', b !== btn); });
        document.querySelectorAll('.ln-stage-panel').forEach(function(p){ p.classList.toggle('on', p.getAttribute('data-stage') === stage); });
      };
    });

    // ---- NIDA/phone progress dots ----
    wireDigitDots_('lnIdNo', 'lnIdNoDots', 20);
    wireDigitDots_('lnMobileAlt', 'lnMobileAltDots', 10);
    wireDigitDots_('lnGPhone', 'lnGPhoneDots', 10);
    wireDigitDots_('lnGIdNo', 'lnGIdNoDots', 20);

    // ---- captures: canvas pads, camera buttons, GPS -- wired once, uploaded as they happen ----
    var sigPad = wireCanvasPad_('lnSigPad');
    var gSigPad = wireCanvasPad_('lnGSigPad');
    var officerSigPad = wireCanvasPad_('lnOfficerSigPad');
    $('#lnSigClear').onclick = function(){ sigPad.clear(); };
    $('#lnGSigClear').onclick = function(){ gSigPad.clear(); };
    $('#lnOfficerSigClear').onclick = function(){ officerSigPad.clear(); };

    var PATHS = { photo: c.photo_url, gPhoto: g.photo_url, gResPhoto: g.residence_verify_photo_url,
      gResPhoto2: g.residence_verify_photo2_url, gResPhoto3: g.residence_verify_photo3_url, gResPhoto4: g.residence_verify_photo4_url,
      custResPhoto: c.residence_verify_photo_url,
      custResPhoto2: c.residence_verify_photo2_url, custResPhoto3: c.residence_verify_photo3_url, custResPhoto4: c.residence_verify_photo4_url,
      bizPhoto: c.business_verify_photo_url, bizPhoto2: c.business_verify_photo2_url, bizPhoto3: c.business_verify_photo3_url,
      custLetter: c.local_govt_letter_url, gLetter: g.local_govt_letter_url,
      otherNumForm: loan.other_number_form_url, otherNumHolder: loan.other_number_form_holder_url };
    wirePhotoCapture_('lnOtherNumFormBtn', 'lnOtherNumFormStatus', loan.id, 'other-number-form', PATHS.otherNumForm, function(p){ PATHS.otherNumForm = p; });
    wirePhotoCapture_('lnOtherNumHolderBtn', 'lnOtherNumHolderStatus', loan.id, 'other-number-form-holder', PATHS.otherNumHolder, function(p){ PATHS.otherNumHolder = p; });
    wirePhotoCapture_('lnPhotoBtn', 'lnPhotoStatus', loan.id, 'photo', PATHS.photo, function(p){ PATHS.photo = p; });
    wirePhotoCapture_('lnGPhotoBtn', 'lnGPhotoStatus', loan.id, 'g-photo', PATHS.gPhoto, function(p){ PATHS.gPhoto = p; });
    wirePhotoCapture_('lnGResPhotoBtn', 'lnGResPhotoStatus', loan.id, 'g-residence', PATHS.gResPhoto, function(p){ PATHS.gResPhoto = p; });
    wirePhotoCapture_('lnGResPhoto2Btn', 'lnGResPhoto2Status', loan.id, 'g-residence2', PATHS.gResPhoto2, function(p){ PATHS.gResPhoto2 = p; });
    wirePhotoCapture_('lnGResPhoto3Btn', 'lnGResPhoto3Status', loan.id, 'g-residence3', PATHS.gResPhoto3, function(p){ PATHS.gResPhoto3 = p; });
    wirePhotoCapture_('lnGResPhoto4Btn', 'lnGResPhoto4Status', loan.id, 'g-residence4', PATHS.gResPhoto4, function(p){ PATHS.gResPhoto4 = p; });
    wirePhotoCapture_('lnCustResPhotoBtn', 'lnCustResPhotoStatus', loan.id, 'residence', PATHS.custResPhoto, function(p){ PATHS.custResPhoto = p; });
    wirePhotoCapture_('lnCustResPhoto2Btn', 'lnCustResPhoto2Status', loan.id, 'residence2', PATHS.custResPhoto2, function(p){ PATHS.custResPhoto2 = p; });
    wirePhotoCapture_('lnCustResPhoto3Btn', 'lnCustResPhoto3Status', loan.id, 'residence3', PATHS.custResPhoto3, function(p){ PATHS.custResPhoto3 = p; });
    wirePhotoCapture_('lnCustResPhoto4Btn', 'lnCustResPhoto4Status', loan.id, 'residence4', PATHS.custResPhoto4, function(p){ PATHS.custResPhoto4 = p; });
    wirePhotoCapture_('lnBizPhotoBtn', 'lnBizPhotoStatus', loan.id, 'business', PATHS.bizPhoto, function(p){ PATHS.bizPhoto = p; });
    wirePhotoCapture_('lnBizPhoto2Btn', 'lnBizPhoto2Status', loan.id, 'business2', PATHS.bizPhoto2, function(p){ PATHS.bizPhoto2 = p; });
    wirePhotoCapture_('lnBizPhoto3Btn', 'lnBizPhoto3Status', loan.id, 'business3', PATHS.bizPhoto3, function(p){ PATHS.bizPhoto3 = p; });
    // Kiambatanisho Na. 2/3 -- the two local-government letters, same live-camera capture as
    // every other photo here, just a different piece of paper being photographed.
    wirePhotoCapture_('lnCustLetterBtn', 'lnCustLetterStatus', loan.id, 'residence-letter', PATHS.custLetter, function(p){ PATHS.custLetter = p; });
    wirePhotoCapture_('lnGLetterBtn', 'lnGLetterStatus', loan.id, 'g-letter', PATHS.gLetter, function(p){ PATHS.gLetter = p; });

    // "10-photo contract capture + WhatsApp share with autogenerated caption" -- each page
    // uploads (and counts) the moment it is taken, same as every other capture in this form;
    // there is nothing to "save" for this one, kycUpload itself appends it (see loan-core.js).
    var contractCount = (loan.contract_photo_urls || []).length;
    if (!planMode) {
    function refreshContractCount_(){
      $('#lnContractCount').textContent = contractCount + '/10';
      $('#lnContractAddBtn').disabled = contractCount >= 10;
      $('#lnContractWaBtn').disabled = contractCount < 1;
    }
    refreshContractCount_();
    $('#lnContractAddBtn').onclick = function(){
      openCameraOverlay_(function(dataUrl, cameraLabel){
        $('#lnContractAddBtn').disabled = true;
        kycUpload_(loan.id, 'contract', dataUrl, cameraLabel)
          .then(function(){ contractCount++; refreshContractCount_(); })
          .catch(function(e){ toast(String((e && e.message) || e), true); })
          .then(function(){ $('#lnContractAddBtn').disabled = contractCount >= 10; });
      });
    };
    /* "Share on WhatsApp button must go with the existing images in their order, the 1st
       picture with the whole KYC text automatic" -- a wa.me link cannot carry an attachment
       (the same limit the existing WhatsApp demand-message button lives with), but the
       browser's own share sheet can: navigator.share takes a files array AND a text caption
       in one call, and on the phones this is actually used from (Android/iOS WhatsApp), that
       caption lands on the share as a whole -- which is where WhatsApp's own composer puts it,
       against the first attachment. Where the device or browser cannot share files this way
       (most desktops), it falls back to the same text-only wa.me link as before, and says so. */
    $('#lnContractWaBtn').onclick = function(){
      shareOnWhatsApp_($('#lnContractWaBtn'), function(){ return srv('contractPhotosForShare', { loan_id: loan.id }); },
        'contract', 'HOPE LOAN -- Mkataba / Contract');
    };
    }

    var COORDS = { custRes: { lat: c.residence_lat, lng: c.residence_lng },
      biz: { lat: c.business_lat, lng: c.business_lng },
      gRes: { lat: g.residence_lat, lng: g.residence_lng } };
    wireGpsCapture_('lnCustGpsBtn', 'lnCustGpsStatus', COORDS.custRes.lat, COORDS.custRes.lng, function(lat, lng){ COORDS.custRes = { lat: lat, lng: lng }; });
    wireGpsCapture_('lnBizGpsBtn', 'lnBizGpsStatus', COORDS.biz.lat, COORDS.biz.lng, function(lat, lng){ COORDS.biz = { lat: lat, lng: lng }; });
    wireGpsCapture_('lnGGpsBtn', 'lnGGpsStatus', COORDS.gRes.lat, COORDS.gRes.lng, function(lat, lng){ COORDS.gRes = { lat: lat, lng: lng }; });

    // ---- save handlers -- each one merges whatever this visit captured with the currently
    //      typed fields, so a pad drawn but not yet part of a save is picked up here. ----
    $('#lnSavePersonal').onclick = function(){
      Promise.all([
        saveCanvasPad_(sigPad, loan.id, 'signature', function(p){ PATHS.signature = p; }),
      ]).then(function(){
        var type = $('#lnIdType').value, idCol = ID_TYPES[type];
        // District moved to section 4 with street/ward ("residence and business ver should be
        // filled street, ward, district") -- not asked here any more.
        var fields = { dob: $('#lnDob').value, gender: $('#lnGender').value, id_type: type,
          first_name: $('#lnFirstName').value.trim(), middle_names: $('#lnMiddleNames').value.trim(),
          present_surname: $('#lnPresentSurname').value.trim(), birth_surname: $('#lnBirthSurname').value.trim(),
          marital_status: $('#lnMarital').value, education: $('#lnEducation').value,
          spouses: $('#lnSpouses').value !== '' ? Number($('#lnSpouses').value) : null,
          children: $('#lnChildren').value !== '' ? Number($('#lnChildren').value) : null,
          tin: $('#lnTin').value.trim(), occupation: $('#lnOccupation').value.trim(),
          employment: $('#lnEmployment').value, employer_name: $('#lnEmployerName').value.trim(),
          mobile_alt: $('#lnMobileAlt').value.trim(), email: $('#lnEmail').value.trim(),
          signature_url: PATHS.signature != null ? PATHS.signature : c.signature_url,
          photo_url: PATHS.photo,
          other_number_form_url: PATHS.otherNumForm != null ? PATHS.otherNumForm : loan.other_number_form_url,
          other_number_form_holder_url: PATHS.otherNumHolder != null ? PATHS.otherNumHolder : loan.other_number_form_holder_url };
        if (idCol) fields[idCol] = $('#lnIdNo').value.trim();
        if (type === 'Other') fields.other_id_type = $('#lnIdOther').value.trim();
        saveSection_('personal', fields);
      }).catch(function(e){ toast(String((e && e.message) || e), true); });
    };
    $('#lnSaveRec').onclick = function(){
      saveCanvasPad_(officerSigPad, loan.id, 'officer-signature', function(p){ PATHS.officerSignature = p; })
        .then(function(){
          saveSection_('recommendation',
            { amount: Number($('#lnRecAmt').value) || 0, credit_score: $('#lnCreditScore').value.trim(),
              collateral_type: $('#lnCollType').value.trim(), collateral_value: $('#lnCollValue').value.trim(),
              zone: $('#lnZone').value.trim(), remarks: $('#lnRemarks').value.trim(),
              officer_name: $('#lnOfficerName').value.trim(),
              officer_signature_url: PATHS.officerSignature != null ? PATHS.officerSignature : a.officer_signature_url });
        }).catch(function(e){ toast(String((e && e.message) || e), true); });
    };
    $('#lnSaveGuar').onclick = function(){
      // "the 5 extra guarantors, 3 are (*) compulsory to fill" -- checked here, once, rather
      // than leaving an assessment that looks complete but is missing the three follow-up
      // contacts it was actually asked for.
      for (var reqI = 0; reqI < 3; reqI++) {
        if (!$('#lnAlt' + reqI + 'Name').value.trim() || !$('#lnAlt' + reqI + 'Phone').value.trim()) {
          toast('Jaza jina na simu ya wadhamini wa ziada 1-3 / Fill in name and phone for extra contacts 1-3.', true);
          return;
        }
      }
      Promise.all([
        saveCanvasPad_(gSigPad, loan.id, 'g-signature', function(p){ PATHS.gSignature = p; }),
      ]).then(function(){
        // "guarantor id should be choices too.. not just nida" -- same ID_TYPES choice as
        // personal details; the guarantor is not reported to the bureau per-type the way the
        // customer is, so whichever type is picked is simply stored in the one national_id
        // column alongside which type it actually is.
        var gIdType = $('#lnGIdType').value;
        var primary = {
          full_name: $('#lnGName').value.trim(), phone: $('#lnGPhone').value.trim(), relationship: $('#lnGRel').value.trim(),
          id_type: gIdType, national_id: $('#lnGIdNo').value.trim(), occupation: $('#lnGOccupation').value.trim(),
          street: $('#lnGStreet').value.trim(), ward: $('#lnGWard').value.trim(), district: $('#lnGDistrict').value.trim(),
          block_number: $('#lnGBlock').value.trim(), type_of_residence: $('#lnGResType').value, residency_capacity: $('#lnGResCap').value,
          residence_lat: COORDS.gRes.lat, residence_lng: COORDS.gRes.lng,
          residence_verify_photo_url: PATHS.gResPhoto, local_govt_letter_url: PATHS.gLetter, photo_url: PATHS.gPhoto,
          residence_verify_photo2_url: PATHS.gResPhoto2, residence_verify_photo3_url: PATHS.gResPhoto3, residence_verify_photo4_url: PATHS.gResPhoto4,
          signature_url: PATHS.gSignature != null ? PATHS.gSignature : g.signature_url,
        };
        var list = [primary];
        for (var i = 0; i < 5; i++) list.push({
          full_name: $('#lnAlt' + i + 'Name').value.trim(), phone: $('#lnAlt' + i + 'Phone').value.trim(), relationship: $('#lnAlt' + i + 'Rel').value.trim(),
        });
        saveSection_('guarantor', { guarantors: list });
      }).catch(function(e){ toast(String((e && e.message) || e), true); });
    };
    // Two independent saves now -- "officers could reach those in different timeframes", so
    // a residence visit today must be bankable today without waiting on a business visit
    // that might not happen until next week (and vice versa).
    $('#lnSaveResidence').onclick = function(){
      saveSection_('residence', {
        verified: $('#lnResOk').checked, guarantor_verified: $('#lnGResOk').checked,
        street: $('#lnCustStreet').value.trim(), ward: $('#lnCustWard').value.trim(), district: $('#lnDistrict').value.trim(),
        block_number: $('#lnCustBlock').value.trim(), type_of_residence: $('#lnCustResType').value, residency_capacity: $('#lnCustResCap').value,
        years_of_residence: $('#lnCustResYears').value !== '' ? Number($('#lnCustResYears').value) : null,
        residence_lat: COORDS.custRes.lat, residence_lng: COORDS.custRes.lng, residence_verify_photo_url: PATHS.custResPhoto,
        residence_verify_photo2_url: PATHS.custResPhoto2, residence_verify_photo3_url: PATHS.custResPhoto3, residence_verify_photo4_url: PATHS.custResPhoto4,
        local_govt_letter_url: PATHS.custLetter,
      });
    };
    $('#lnSaveBusiness').onclick = function(){
      saveSection_('business', {
        verified: $('#lnBizOk').checked, business_name: $('#lnBizName').value.trim(),
        daily_sales: $('#lnDailySales').value.trim(), daily_profit: $('#lnDailyProfit').value.trim(), weekly_expenses: $('#lnWeeklyExpenses').value.trim(),
        business_lat: COORDS.biz.lat, business_lng: COORDS.biz.lng, business_verify_photo_url: PATHS.bizPhoto,
        business_verify_photo2_url: PATHS.bizPhoto2, business_verify_photo3_url: PATHS.bizPhoto3,
      });
    };
    // A plan has nothing to submit or reject -- a plan is only ever merged into a loan once
    // the customer is assigned (mergePlanIntoLoan_); see the note where its own card renders.
    if (!planMode) {
    $('#lnSubmitRec').onclick = function(){ lnAct('teamSubmit', { loan_id: loan.id, decision: 'ACCEPTED' }, 'Recommended.', function(){ go('ln_team'); }); };
    $('#lnRejectRec').onclick = function(){
      lnReasonPrompt_(function(reason){ lnAct('teamSubmit', { loan_id: loan.id, decision: 'REJECTED', reason: reason }, 'Rejected.', function(){ go('ln_team'); }); });
    };
    }
    // ---- the KYC text -- one builder, read by the Copy button AND both WhatsApp share
    //      buttons (the loan side above, and the plan side just below), so none of the three
    //      can ever say something different about the same customer. Wired for BOTH modes --
    //      "my system will be used for assessment pictures ... they get the kyc and Whatsapp
    //      share buttons at assessment plan" -- a plan is exactly this same five-section form,
    //      just without a loan yet. If a pinpoint was captured this visit it is not yet saved
    //      server-side, so this reads live DOM/capture state, not the stale `c`/`g` this
    //      drawer opened with. Maps links, not photos -- see the share buttons' own note for
    //      how the photos travel instead. ----
    /* "Share on WhatsApp button must go with the existing images in their order, the 1st
       picture with the whole KYC text automatic" -- a wa.me link cannot carry an attachment
       (the same limit the existing WhatsApp demand-message button lives with), but the
       browser's own share sheet can: navigator.share takes a files array AND a text caption
       in one call, and on the phones this is actually used from (Android/iOS WhatsApp), that
       caption lands on the share as a whole -- which is where WhatsApp's own composer puts it,
       against the first attachment. Where the device or browser cannot share files this way
       (most desktops), it falls back to a text-only wa.me link, and says so. One function,
       fed a different fetch (contract pages, or a plan's own captured photos) by each of the
       two buttons that call it, so the fallback and the caption can never drift between them. */
    function openWaTextOnly_(){
      window.open('https://wa.me/?text=' + encodeURIComponent(buildKycText_()), '_blank');
      toast('Kivinjari hiki hakiwezi kushiriki picha moja kwa moja -- maandishi tu yametumwa. / '
        + 'This browser cannot share the photos directly -- text only was sent.');
    }
    function shareOnWhatsApp_(btn, fetchImages, filePrefix, title){
      var canShareFiles = !!(navigator.canShare && navigator.share);
      if (!canShareFiles) { openWaTextOnly_(); return; }
      btn.disabled = true;
      fetchImages().then(function(r){
        var urls = (r && r.images) || [];
        return Promise.all(urls.map(function(u){ return fetch(u).then(function(res){ return res.blob(); }); }));
      }).then(function(blobs){
        var files = blobs.map(function(b, i){
          return new File([b], filePrefix + '-' + (i + 1) + '.' + (b.type.indexOf('png') >= 0 ? 'png' : 'jpg'), { type: b.type });
        });
        var text = buildKycText_();
        if (files.length && navigator.canShare({ files: files })) {
          return navigator.share({ files: files, text: text, title: title });
        }
        // No photos captured yet, or this browser accepts navigator.share but not files: text
        // still goes, same as the plain wa.me path, through the one channel that is left.
        return navigator.share({ text: text, title: title });
      }).catch(function(e){
        if (e && e.name === 'AbortError') return;   // the officer closed the share sheet -- not a failure
        toast(String((e && e.message) || e) || 'Imeshindikana kushiriki. / Could not share.', true);
        openWaTextOnly_();
      }).then(function(){ btn.disabled = false; }, function(){ btn.disabled = false; });
    }
    function mapLink_(coord){ return (coord && coord.lat != null && coord.lng != null) ? ('https://maps.google.com/?q=' + coord.lat + ',' + coord.lng) : null; }
    function buildKycText_(){
      var idType = $('#lnIdType').value, idNo = $('#lnIdNo').value.trim();
      var lines = [
        '*HOPE LOAN - KYC*',
        'Ref: ' + (loan.loan_id || '') + '   Docket: ' + (loan.docket_no || ''),
        // "recommendation kyc should go with team name, track no and credit score" -- team and
        // track_no are the loan's own, already-set fields; credit score is typed just above.
        'Timu / Team: ' + (loan.team || '—') + '   Track: ' + (loan.track_no || 1),
        'Jina / Name: ' + loan.full_name,
        'Simu / Phone: ' + (loan.contact || ''),
        'Jinsia / Gender: ' + ($('#lnGender').value || '—'),
        idType + ': ' + (idNo || '—'),
        'Wilaya/Kata/Mtaa: ' + [$('#lnDistrict').value, $('#lnCustWard').value, $('#lnCustStreet').value].filter(Boolean).join(' / '),
        'Biashara / Business: ' + ($('#lnBizName').value || '—') + ' (' + (c.business_type || '—') + ')',
        'Kiasi kilichoombwa / Requested: ' + money(loan.requested_amt),
        'Kiasi kilichopendekezwa / Recommended: ' + money(Number($('#lnRecAmt').value) || 0),
        'Alama ya mkopo / Credit score: ' + ($('#lnCreditScore').value.trim() || '—'),
        '',
        '*Mdhamini / Guarantor*: ' + ($('#lnGName').value || '—') + '  ·  ' + ($('#lnGPhone').value || '—') + '  ·  ' + ($('#lnGRel').value || '—'),
        'Wilaya/Kata/Mtaa: ' + [$('#lnGDistrict').value, $('#lnGWard').value, $('#lnGStreet').value].filter(Boolean).join(' / '),
      ];
      var extra = [0, 1, 2, 3, 4].map(function(i){ return $('#lnAlt' + i + 'Name').value.trim(); }).filter(Boolean);
      if (extra.length) lines.push('Wadhamini wa ziada / Extra contacts: ' + [0, 1, 2, 3, 4]
        .map(function(i){ var n = $('#lnAlt' + i + 'Name').value.trim(); return n ? (n + ' (' + $('#lnAlt' + i + 'Phone').value.trim() + ', ' + $('#lnAlt' + i + 'Rel').value.trim() + ')') : ''; })
        .filter(Boolean).join('; '));
      var locLines = [
        ['Makazi ya mteja / Customer residence', mapLink_(COORDS.custRes)],
        ['Biashara / Business', mapLink_(COORDS.biz)],
        ['Makazi ya mdhamini / Guarantor residence', mapLink_(COORDS.gRes)],
      ].filter(function(x){ return x[1]; });
      if (locLines.length) {
        lines.push('', '*Mahali / Locations*');
        locLines.forEach(function(x){ lines.push(x[0] + ': ' + x[1]); });
      }
      return lines.join('\n');
    }
    function toggleCopyBtn(){ $('#lnCopyKyc').disabled = !Number($('#lnRecAmt').value); }
    $('#lnRecAmt').oninput = toggleCopyBtn; toggleCopyBtn();
    $('#lnCopyKyc').onclick = function(){
      var text = buildKycText_();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function(){ toast('Imenakiliwa. / Copied.'); })
          .catch(function(){ toast('Imeshindikana kunakili. / Could not copy.', true); });
      } else {
        toast('Kivinjari hiki hakiwezi kunakili moja kwa moja. / This browser cannot copy directly.', true);
      }
    };
    // "my system will be used for assessment pictures ... they get the kyc and Whatsapp share
    // buttons at assessment plan" -- every photo the five-section form has captured on THIS
    // plan so far (planPhotosForShare, in the same reading order the form itself uses), plus
    // the same KYC caption the loan side sends. No contract page can exist yet -- there is no
    // loan to sign one for -- so this button only ever asks for the plan's own photos.
    if (planMode) {
      $('#lnPlanWaBtn').onclick = function(){
        shareOnWhatsApp_($('#lnPlanWaBtn'), function(){ return srv('planPhotosForShare', { plan_id: planRow.id }); },
          'assessment', 'HOPE LOAN -- Tathmini / Assessment');
      };
    }
  }).catch(function(e){ toast(String((e && e.message) || e), true); });
}

/* ---------- GMO / OPM senior review ---------- */
/* TWO SCREENS, ONE HELPER. Each nav id now fixes its own tier -- Manager Review always asks
   for 'manager', GMO Review always asks for 'gmo' -- so there is no dropdown to wire any more;
   which screen you are on already says which tier you are working. */
function lnSeniorView_(navId, tier, thresholdNote){
  HEAD = '<div class="note">' + esc(thresholdNote) + '</div>';
  return srv('seniorQueue', { tier: tier }).then(function(d){
    S.rows = d.rows; S.cols = [
      col('loan_id', 'Ref'), col('full_name', 'Customer'), col('branch', 'Branch'), col('team', 'Team'),
      { key:'team_recomm', label:'Recommended', kind:'money' }];
    ONROW = function(r){ lnSeniorForm_(r, tier, navId); };
  });
}

VIEWS.ln_manager_review = function(){
  return lnSeniorView_('ln_manager_review', 'manager', 'Mandatory for every loan 1,000,000+. / Lazima kwa mkopo wowote wa 1,000,000+.');
};

VIEWS.ln_gmo_review = function(){
  return lnSeniorView_('ln_gmo_review', 'gmo', 'Mandatory for every loan 6,000,000+, ALONGSIDE Manager Review, not instead of it. / '
    + 'Lazima kwa mkopo wowote wa 6,000,000+, PAMOJA na Manager Review, si badala yake.');
};

function lnSeniorForm_(loan, tier, navId){
  drawer('<h3>' + esc(loan.full_name) + '</h3><div class="sub">Recommended: ' + money(loan.team_recomm) + '</div>'
    + '<div class="fld"><label>Your recommended amount</label><input id="lnSrAmt" type="number" value="' + (loan.team_recomm||'') + '"></div>'
    + '<div class="fld"><label>Remarks</label><input id="lnSrRemarks"></div>'
    + '<button class="btn w" id="lnSrSubmit">Record recommendation</button>');
  $('#lnSrSubmit').onclick = function(){
    lnAct('seniorRecommend', { loan_id: loan.id, tier: tier, amount: Number($('#lnSrAmt').value) || 0, remarks: $('#lnSrRemarks').value.trim() },
      'Recorded.', function(){ go(navId); });
  };
}

/* ---------- Credit analyst: approval ---------- */
VIEWS.ln_credit = function(){
  return srv('creditQueue', {}).then(function(d){
    S.rows = d.rows; S.cols = [
      col('loan_id', 'Ref'), col('full_name', 'Customer'), col('branch', 'Branch'), col('team', 'Team'),
      { key:'team_recomm', label:'Recommended', kind:'money' },
      { key:'gmo_recommend', label:'GMO said', kind:'money' }];
    ONROW = function(r){ lnCreditForm_(r); };
  });
};

function lnCreditForm_(loan){
  drawer('<h3>' + esc(loan.full_name) + '</h3><div class="sub">Ref ' + esc(loan.loan_id) + '</div>'
    // "call verification tick at approval tied to min-seconds threshold from the approver's
    // own call-sync login" -- a fact, not a checkbox; filled in below once creditCallCheck
    // answers. Advisory only, same as the server side -- it is shown, never required.
    + '<div class="fld" id="lnCallVerify"><span class="chip mut">Inaangalia simu... / Checking calls...</span></div>'
    + '<div class="fld"><label>Granted amount (TZS)</label><input id="lnGrantAmt" type="number" value="' + (loan.team_recomm||'') + '"></div>'
    + '<div class="fld"><label>Previous balance (for a top-up)</label><input id="lnPrevBal" type="number" value="0"></div>'
    // "ADA YA MKOPO (APPLICATION FEES) ... asilimia tano (5%) ... na haitakuwa chini ya
    // Shilingi ..." -- the contract's own application fee, deducted from what is disbursed.
    // Suggested at 5% and recalculated as the grant changes, UNTIL touched by hand -- the
    // contract's minimum-shillings floor is a blank in the template, so raising this past 5%
    // to match it is exactly what editing it is for.
    + '<div class="fld"><label>Ada ya mkopo (5%) / Application fee (TZS)</label><input id="lnAppFee" type="number" value="' + Math.round((Number(loan.team_recomm) || 0) * 0.05) + '"></div>'
    + '<div class="fld"><label>Disbursement mode</label><select id="lnDisbMode2">'
      + '<option value="">— chagua / choose —</option>'
      + DISB_MODES.map(function(m){ return '<option' + (loan.disbursement_type===m?' selected':'') + '>' + m + '</option>'; }).join('')
      + '</select></div>'
    + '<div class="fld" id="lnBankFld"><label>Bank name</label><input id="lnBankName"></div>'
    + '<div class="fld" id="lnAcctFld"><label>Account no.</label><input id="lnAcctNo"></div>'
    + '<div id="lnSchedulePreview" class="sub" style="margin:6px 0"></div>'
    + '<button class="btn w" id="lnGrantBtn">Grant</button>'
    + '<button class="btn w ghost" id="lnCrRejectBtn" style="margin-top:8px">Reject / Return for refilling</button>'
    // "with choice comment to return" -- a picked reason, not a typed one, so a return says
    // WHAT is missing instead of whatever prose came to mind. Hidden until Reject is pressed.
    + '<div id="lnCrReasonBox" class="hide" style="margin-top:8px">'
    + '<div class="fld"><label>Sababu / Reason</label><select id="lnCrReasonChoice">'
      + CREDIT_RETURN_REASONS.map(function(r){ return '<option>' + esc(r) + '</option>'; }).join('')
      + '</select></div>'
    + '<div class="fld"><label>Maelezo zaidi (hiari) / More detail (optional)</label><input id="lnCrReasonNote"></div>'
    + '<button class="btn w ghost" id="lnCrRejectConfirm">Thibitisha kurudisha / Confirm return</button>'
    + '</div>');
  // The fee box tracks 5% of the grant until the analyst types in it directly -- same
  // "stays exactly what was typed once touched" rule as every other paired default in this app.
  var appFeeTouched = false;
  function preview(fromFeeBox){
    if (fromFeeBox) appFeeTouched = true;
    var g = Number($('#lnGrantAmt').value) || 0;
    var interest = Math.round(g * 0.36), total = g + interest, inst = Math.round(total / 12);
    if (!appFeeTouched) $('#lnAppFee').value = Math.round(g * 0.05);
    var fee = Number($('#lnAppFee').value) || 0;
    var prevBal = Number($('#lnPrevBal').value) || 0;
    var disbursing = Math.max(0, g - prevBal - fee);
    $('#lnSchedulePreview').textContent = 'Interest ' + money(interest) + ' · Total ' + money(total) + ' · 12 x ' + money(inst) + '/week'
      + ' · Fee ' + money(fee) + ' · Disbursing ' + money(disbursing);
  }
  $('#lnGrantAmt').oninput = function(){ preview(false); };
  $('#lnAppFee').oninput = function(){ preview(true); };
  $('#lnPrevBal').oninput = function(){ preview(false); };

  // "call verification tick" -- reads the analyst's OWN synced call log server-side
  // (callVerificationFor_ in loan-core.js), never a box ticked from memory.
  srv('creditCallCheck', { loan_id: loan.id }).then(function(r){
    var box = $('#lnCallVerify'); if (!box) return;
    box.innerHTML = r.verified
      ? '<span class="chip ok">✓ Imethibitishwa kwa simu / Verified by call (' + r.seconds + 's)</span>'
      : '<span class="chip warn">⚠ Hakuna simu iliyothibitishwa (≥' + r.minSeconds + 's) / No call on file at or above ' + r.minSeconds + 's</span>';
  }).catch(function(){
    var box = $('#lnCallVerify'); if (box) box.innerHTML = '<span class="chip mut">Kumbukumbu za simu hazipatikani / Call log unavailable</span>';
  });
  preview(false);
  // Bank name/account only mean something for a bank disbursement -- shown for Bank, hidden
  // (not required) for Momo or nothing chosen yet.
  function toggleBankFlds(){
    var isBank = $('#lnDisbMode2').value === 'Bank';
    $('#lnBankFld').style.display = isBank ? '' : 'none';
    $('#lnAcctFld').style.display = isBank ? '' : 'none';
  }
  $('#lnDisbMode2').onchange = toggleBankFlds; toggleBankFlds();
  $('#lnGrantBtn').onclick = function(){
    lnAct('creditApprove', {
      loan_id: loan.id, granted_amount: Number($('#lnGrantAmt').value) || 0,
      previous_balance: Number($('#lnPrevBal').value) || 0, application_fee: $('#lnAppFee').value.trim(),
      disbursement_mode: $('#lnDisbMode2').value.trim(),
      bank_name: $('#lnBankName').value.trim(), account_no: $('#lnAcctNo').value.trim(),
    }, 'Granted.', function(){ go('ln_credit'); });
  };
  $('#lnCrRejectBtn').onclick = function(){ $('#lnCrReasonBox').classList.remove('hide'); };
  $('#lnCrRejectConfirm').onclick = function(){
    var choice = $('#lnCrReasonChoice').value, note = $('#lnCrReasonNote').value.trim();
    lnAct('creditReject', { loan_id: loan.id, reason: note ? (choice + ' -- ' + note) : choice },
      'Returned.', function(){ go('ln_credit'); });
  };
}

/* ---------- Disbursement -- manager, only while finance's window is open ---------- */
VIEWS.ln_disburse = function(){
  // ONE call, not two: disburseQueue brings the window state back with the queue.
  return srv('disburseQueue', {}).then(function(d){
    HEAD = '<div class="kpis">' + kpi('Dirisha / Window', d.windowOpen ? 'WAZI / OPEN' : 'FUNGWA / CLOSED', null, d.windowOpen ? 'good' : 'bad') + '</div>';
    S.rows = d.rows; S.cols = [
      col('loan_id', 'Ref'), col('full_name', 'Customer'), col('branch', 'Branch'), col('team', 'Team'),
      { key:'principal_amt', label:'Granted', kind:'money' }, { key:'net_disbursed', label:'To disburse', kind:'money' }];
    ONROW = function(r){ lnDisburseForm_(r, d.windowOpen); };
  });
};

function lnDisburseForm_(loan, windowOpen){
  drawer('<h3>' + esc(loan.full_name) + '</h3><div class="sub">Granted ' + money(loan.principal_amt) + ' &middot; Disbursing ' + money(loan.net_disbursed) + '</div>'
    + (windowOpen ? '<button class="btn w" id="lnDisburseBtn">Disburse (authorise)</button>'
                  : '<div class="hint" style="color:var(--bad)">Window closed -- ask finance to open it.</div>')
    + '<button class="btn w ghost" id="lnDisburseRejectBtn" style="margin-top:8px">Reject</button>'
    + '<button class="btn w ghost" id="lnReturnBtn" style="margin-top:8px">Return to Credit</button>');
  if (windowOpen) $('#lnDisburseBtn').onclick = function(){
    lnAct('managerDisburse', { loan_id: loan.id }, 'Authorised -- awaiting funding.', function(){ go('ln_disburse'); });
  };
  $('#lnDisburseRejectBtn').onclick = function(){
    lnReasonPrompt_(function(reason){ lnAct('managerDisburseReject', { loan_id: loan.id, reason: reason }, 'Rejected.', function(){ go('ln_disburse'); }); });
  };
  $('#lnReturnBtn').onclick = function(){ lnAct('managerReturnToCredit', { loan_id: loan.id }, 'Returned.', function(){ go('ln_disburse'); }); };
}

/* ---------- Finance -- window, bank report, funding, payment imports, shifting, iliyonasa ---------- */
VIEWS.ln_finance = function(){
  var scope = S.args.scope || 'bank';
  /* PAYMENTS -- the list that makes shifting a misapplied one reachable at all. */
  if (scope === 'payments') {
    return srv('paymentsList', {}).then(function(d){
      HEAD = lnFinScopeBar_(scope)
        + bar('<button class="btn sm ghost" id="lnImportPayBtn">Import payments (paste rows)</button>');
      S.rows = d.rows;
      S.cols = [col('imported_at', 'Imported', 'dt'), col('ref', 'REF#'), col('full_name', 'Customer'),
        col('team', 'Team'), { key:'amount', label:'Amount', kind:'money' },
        col('trans_no', 'Trans no.'), col('paid_by', 'Paid by'), col('source', 'Source'),
        col('shifted_from_ref', 'Shifted from')];
      ONROW = function(r){ lnShiftPaymentForm_(r); };
      S.foot = money(d.rows.length) + ' payment(s) · tap a row to move one to another reference';
    });
  }
  /* ILIYONASA -- the adjustments themselves, not just the form that writes them. */
  if (scope === 'adjust') {
    return srv('adjustmentsList', {}).then(function(d){
      var net = d.rows.reduce(function(s,r){ return s + (Number(r.amount)||0); }, 0);
      HEAD = '<div class="kpis">' + kpi('Jumla / Net adjustment', money(net), 'signed total', net < 0 ? 'bad' : 'good') + '</div>'
        + lnFinScopeBar_(scope)
        + bar('<button class="btn sm" id="lnAdjustBtn">+ Iliyonasa / Manual adjustment</button>');
      S.rows = d.rows;
      S.cols = [col('adj_date', 'Date'), col('team', 'Team'), col('target', 'Target'),
        { key:'amount', label:'Amount (signed)', kind:'money' }, col('reason', 'Reason'),
        col('ref', 'REF#'), col('created_by', 'By')];
      ONROW = null;
      S.foot = money(d.rows.length) + ' adjustment(s)';
    });
  }
  // ONE call, not two: financeBankReport brings the window state back with the report.
  return srv('financeBankReport', {}).then(function(bank){
    var win = { open: bank.windowOpen };
    HEAD = '<div class="kpis">' + kpi('Dirisha / Window', win.open ? 'WAZI / OPEN' : 'FUNGWA / CLOSED', null, win.open ? 'good' : 'bad') + '</div>'
      + lnFinScopeBar_(scope)
      + bar((win.open ? '<button class="btn sm ghost" id="lnCloseWin">Close window</button>'
                      : '<button class="btn sm" id="lnOpenWin">Open window</button>')
        + '<button class="btn sm ghost" id="lnMarkAllFunded">Mark ALL below as funded</button>'
        + '<button class="btn sm ghost" id="lnImportPayBtn">Import payments (paste rows)</button>'
        + '<button class="btn sm ghost" id="lnAdjustBtn">Iliyonasa / Manual adjustment</button>');
    S.rows = bank.rows; S.cols = [
      col('docket', 'Docket'), col('full_name', 'Customer'),
      { key:'contact', label:'Phone', kind:'tel' }, col('carrier', 'Carrier'), col('bank_name', 'Bank'),
      col('account_no', 'Account'), { key:'amount', label:'Amount', kind:'money' }];
    ONROW = function(r){ lnFundOneForm_(r); };
    S.foot = money(bank.rows.length) + ' authorised, awaiting funding · ' + money(bank.rows.reduce(function(s,r){return s+(Number(r.amount)||0);},0)) + ' TZS';
    S.lnBankRows = bank.rows;    // wireLnFinance_ needs these for "mark all", after paint
    S.lnWinOpen = win.open;
  });
};

function lnFinScopeBar_(scope){
  return bar('<select id="lnFinScope">'
    + '<option value="bank"' + (scope==='bank'?' selected':'') + '>Bank report (awaiting funding)</option>'
    + '<option value="payments"' + (scope==='payments'?' selected':'') + '>Payments received</option>'
    + '<option value="adjust"' + (scope==='adjust'?' selected':'') + '>Iliyonasa / Adjustments</option></select>');
}

/* "finance manager also can shift customer transactions from received transactions from one
   ref no to another b/se there happen wrong reference payments" -- reachable from the row now,
   which is what makes financeShiftPayment usable at all. The losing team may go negative on
   recovery; that was accepted explicitly, so the warning says so rather than blocking. */
function lnShiftPaymentForm_(row){
  drawer('<h3>Hamisha malipo / Shift payment</h3>'
    + '<div class="sub">' + money(row.amount) + ' &middot; currently on ' + esc(row.ref || '—')
    + (row.shifted_from_ref ? ' (already moved once, from ' + esc(row.shifted_from_ref) + ')' : '') + '</div>'
    + '<div class="hint">The original row is kept and marked, never deleted. If moving this payment turns the losing team\'s customer into a defaulter, that team\'s recovery can go negative -- that is expected.</div>'
    + '<div class="fld"><label>Move to REF#</label><input id="lnShiftTo"></div>'
    + '<div class="fld"><label>Reason (required)</label><input id="lnShiftReason"></div>'
    + '<button class="btn w" id="lnShiftBtn">Shift payment</button>');
  $('#lnShiftBtn').onclick = function(){
    lnAct('financeShiftPayment', { payment_id: row.id, to_ref: $('#lnShiftTo').value.trim(), reason: $('#lnShiftReason').value.trim() },
      'Shifted.', function(){ go('ln_finance'); });
  };
}

function wireLnFinance_(){
  var sc = document.getElementById('lnFinScope');
  if (sc) sc.onchange = function(){ S.args.scope = this.value; render({ force:true }); };
  var close = document.getElementById('lnCloseWin'), open = document.getElementById('lnOpenWin');
  if (close) close.onclick = function(){ lnAct('financeCloseWindow', {}, 'Window closed.', function(){ go('ln_finance'); }); };
  if (open) open.onclick = function(){ lnAct('financeOpenWindow', {}, 'Window open.', function(){ go('ln_finance'); }); };
  var mark = document.getElementById('lnMarkAllFunded');
  if (mark) mark.onclick = function(){
    var ids = (S.lnBankRows || []).map(function(r){ return r.loan_id; });
    if (!ids.length) { toast('Hakuna kitu / Nothing to fund.', true); return; }
    lnAct('financeMarkFunded', { loan_ids: ids }, money(ids.length) + ' loan(s) funded.', function(){ go('ln_finance'); });
  };
  var imp = document.getElementById('lnImportPayBtn');
  if (imp) imp.onclick = lnImportPaymentsForm_;
  var adj = document.getElementById('lnAdjustBtn');
  if (adj) adj.onclick = lnAdjustmentForm_;
}

function lnFundOneForm_(row){
  drawer('<h3>' + esc(row.full_name) + '</h3><div class="sub">' + esc(row.docket) + ' &middot; ' + money(row.amount) + '</div>'
    + '<button class="btn w" id="lnFundOneBtn">Mark funded (money sent)</button>');
  $('#lnFundOneBtn').onclick = function(){
    lnAct('financeMarkFunded', { loan_ids: [row.loan_id] }, 'Funded.', function(){ go('ln_finance'); });
  };
}

function lnImportPaymentsForm_(){
  drawer('<h3>Import payments / Ingiza malipo</h3>'
    // "Importing payment at finance always require transaction ID too" -- TRANS_NO is the
    // third column, ahead of the optional PAID_BY, and a line without one stops the import
    // here with its line number; the server refuses the same way (financeImportPayments).
    + '<div class="sub">The receiver for the ISP channel finance already runs by hand -- one line per payment: REF, AMOUNT, TRANS_NO, PAID_BY (tab or comma separated). Namba ya muamala ni lazima / Transaction ID is required.</div>'
    + '<textarea id="lnPayRows" rows="8" style="width:100%" placeholder="919000001, 34000, CI250920.1234.A12345, 0715000001"></textarea>'
    + '<button class="btn w" id="lnPayImportBtn" style="margin-top:8px">Import</button>');
  $('#lnPayImportBtn').onclick = function(){
    var missing = [];
    var rows = $('#lnPayRows').value.split('\n').map(function(line, i){
      var p = line.split(/[,\t]/).map(function(x){ return x.trim(); });
      if (p[0] && !p[2]) missing.push(i + 1);
      return { ref: p[0], amount: Number(p[1]) || 0, trans_no: p[2] || '', paid_by: p[3] || '' };
    }).filter(function(r){ return r.ref; });
    if (missing.length) {
      toast('Namba ya muamala inakosekana mstari / Transaction ID missing on line ' + missing.join(', ') + '. Hakuna kilichoingizwa / Nothing imported.', true);
      return;
    }
    lnAct('financeImportPayments', { rows: rows }, money(rows.length) + ' row(s) imported.', function(){ go('ln_finance'); });
  };
}

function lnAdjustmentForm_(){
  drawer('<h3>Iliyonasa / Manual adjustment</h3>'
    + '<div class="sub">A SIGNED figure against one team\'s expected or default total for one date -- for a customer who paid what the system could not accept, or a verified transaction that did not land.</div>'
    + '<div class="fld"><label>Team</label><input id="lnAdjTeam"></div>'
    + '<div class="fld"><label>Target</label><select id="lnAdjTarget"><option value="expected">Expected</option><option value="defaults">Defaults</option></select></div>'
    + '<div class="fld"><label>Amount (+ adds, - reduces)</label><input id="lnAdjAmt" type="number"></div>'
    + '<div class="fld"><label>Reason (required)</label><input id="lnAdjReason"></div>'
    + '<button class="btn w" id="lnAdjSaveBtn">Save adjustment</button>');
  $('#lnAdjSaveBtn').onclick = function(){
    lnAct('adjustmentSave', {
      team: $('#lnAdjTeam').value.trim(), target: $('#lnAdjTarget').value,
      amount: Number($('#lnAdjAmt').value) || 0, reason: $('#lnAdjReason').value.trim(),
    }, 'Saved.', function(){ go('ln_finance'); });
  };
}

/* ---------- Reversals: three desks, one screen ----------
   Two lists in one view, because they are two halves of the same job: what is WAITING on a
   signature, and what could still be reversed at all. `scope` switches between them; the row
   click does the right thing for whichever is showing. */
/* Does this code hold a HOPE Loan tab? ADMIN holds them all -- the same rule requireTab applies
   at the server, so a button drawn by this is one the server will honour. */
function lnHolds_(tab){
  return S.me.role === 'ADMIN' || (S.me.tabs||[]).indexOf(tab) >= 0;
}

VIEWS.ln_reversals = function(){
  var canAsk = lnHolds_('loan_credit');
  var scope = S.args.scope || (canAsk && !lnHolds_('finance') && !lnHolds_('gm') ? 'eligible' : 'pending');
  if (scope === 'eligible' && !canAsk) scope = 'pending';
  return srv('reversalsList', {}).then(function(d){
    S.lnRev = d;
    HEAD = '<div class="kpis">'
      + kpi('Zinasubiri / Awaiting a signature', money(d.pending.length), null, d.pending.length ? 'bad' : 'good')
      + kpi('Zinazoweza kurudishwa / Reversible', money(d.eligible.length), 'authorised, not yet funded')
      + '</div>'
      + bar('<select id="lnRevScope">'
        + '<option value="pending"' + (scope==='pending'?' selected':'') + '>Awaiting a decision</option>'
        /* Only offered to whoever can actually file one; a finance-only code picking it was
           refused by the server at the tap, after choosing the loan and typing the reason. */
        + (canAsk ? '<option value="eligible"' + (scope==='eligible'?' selected':'') + '>Reversible loans (request one)</option>' : '')
        + '<option value="all"' + (scope==='all'?' selected':'') + '>All reversals</option></select>');
    if (scope === 'eligible') {
      S.rows = d.eligible;
      S.cols = [col('ref', 'Ref'), col('docket', 'Docket'), col('full_name', 'Customer'),
        col('branch', 'Branch'), col('team', 'Team'), { key:'amount', label:'Amount', kind:'money' }];
      ONROW = function(r){ lnRevRequestForm_(r); };
      S.foot = 'Bofya safu kuomba kurudishwa / Tap a row to request a reversal';
    } else {
      S.rows = scope === 'all' ? d.rows : d.pending;
      S.cols = [col('ref', 'Ref'), col('full_name', 'Customer'), col('team', 'Team'),
        { key:'amount', label:'Amount', kind:'money' }, col('reason', 'Reason'),
        col('requested_by', 'Requested by'),
        { key:'finance_status', label:'Finance', kind:'chip', chip:function(r){ return chipFor(r.finance_status); } },
        { key:'gm_status', label:'GM', kind:'chip', chip:function(r){ return chipFor(r.gm_status); } },
        { key:'status', label:'Status', kind:'chip', chip:function(r){ return chipFor(r.status); } }];
      ONROW = function(r){ lnRevDecideForm_(r); };
      S.foot = money(S.rows.length) + ' reversal(s)';
    }
  });
};

function wireLnReversals_(){
  var s = document.getElementById('lnRevScope');
  if (s) s.onchange = function(){ S.args.scope = this.value; render({ force:true }); };
}

/* Credit's half: requested FROM THE ROW, so the loan id never has to be read off one screen
   and typed into another -- which was the rough edge this replaces. */
function lnRevRequestForm_(row){
  drawer('<h3>Request reversal</h3>'
    + '<div class="sub">' + esc(row.full_name) + ' &middot; ' + esc(row.ref) + ' &middot; ' + money(row.amount) + '</div>'
    + '<div class="hint">Only a loan a manager has authorised but finance has NOT funded can be reversed -- the money has not moved, so nothing needs unwinding at the bank.</div>'
    + '<div class="fld"><label>Amount</label><input id="lnRevAmt" type="number" value="' + (row.amount||'') + '"></div>'
    + '<div class="fld"><label>Reason (required)</label><input id="lnRevReason"></div>'
    + '<button class="btn w" id="lnRevSubmit">Request reversal</button>');
  $('#lnRevSubmit').onclick = function(){
    lnAct('reversalRequest', { loan_id: row.loan_id, amount: Number($('#lnRevAmt').value) || 0, reason: $('#lnRevReason').value.trim() },
      'Requested -- now with finance.', function(){ go('ln_reversals'); });
  };
}

/* Finance's and the GM's halves. Which buttons appear follows the CHAIN, not the person:
   finance decides while finance is Pending; the GM only once finance has approved -- the same
   order the server enforces, so the screen can never offer a step that will be refused. */
function lnRevDecideForm_(row){
  /* The chain says whose turn it is; the tab says whether that is YOU. A credit analyst who
     opens a pending row sees whose signature it is waiting for, not buttons that would be
     refused. */
  var finTurn = row.finance_status === 'Pending';
  var gmChain = row.finance_status === 'Approved' && row.gm_status === 'Pending';
  var financePending = finTurn && lnHolds_('finance');
  var gmTurn = gmChain && lnHolds_('gm');
  var waitingOn = finTurn ? 'Inasubiri saini ya Fedha / Waiting for finance to sign.'
    : gmChain ? 'Inasubiri saini ya GM / Waiting for the GM to sign.'
    : 'Hakuna hatua iliyobaki / Nothing left to decide here.';
  drawer('<h3>' + esc(row.full_name) + '</h3>'
    + '<div class="sub">' + esc(row.ref) + ' &middot; ' + money(row.amount) + '</div>'
    + '<div class="frow"><span>Reason</span>' + esc(row.reason || '') + '</div>'
    + '<div class="frow"><span>Requested by</span>' + esc(row.requested_by || '') + '</div>'
    + '<div class="frow"><span>Finance</span>' + esc(row.finance_status || '') + (row.finance_by ? ' — ' + esc(row.finance_by) : '') + '</div>'
    + '<div class="frow"><span>GM</span>' + esc(row.gm_status || '') + (row.gm_by ? ' — ' + esc(row.gm_by) : '') + '</div>'
    + (financePending
        ? '<div class="fld" style="margin-top:10px"><label>Finance note</label><input id="lnRevNote"></div>'
          + '<button class="btn w" id="lnRevFinOk">Finance: approve</button>'
          + '<button class="btn w ghost" id="lnRevFinNo" style="margin-top:8px">Finance: reject</button>'
        : gmTurn
        ? '<div class="fld" style="margin-top:10px"><label>GM note</label><input id="lnRevNote"></div>'
          + '<button class="btn w" id="lnRevGmOk">GM: authorise (closes the contract)</button>'
          + '<button class="btn w ghost" id="lnRevGmNo" style="margin-top:8px">GM: reject</button>'
        : '<div class="hint" style="margin-top:10px">' + waitingOn + '</div>'));
  function note(){ var n = document.getElementById('lnRevNote'); return n ? n.value.trim() : ''; }
  if (financePending) {
    $('#lnRevFinOk').onclick = function(){ lnAct('reversalFinanceDecide', { id: row.id, approve: true, note: note() }, 'Approved -- now with the GM.', function(){ go('ln_reversals'); }); };
    $('#lnRevFinNo').onclick = function(){ lnAct('reversalFinanceDecide', { id: row.id, approve: false, note: note() }, 'Rejected.', function(){ go('ln_reversals'); }); };
  }
  if (gmTurn) {
    $('#lnRevGmOk').onclick = function(){ lnAct('reversalGmDecide', { id: row.id, approve: true, note: note() }, 'Authorised -- contract closed.', function(){ go('ln_reversals'); }); };
    $('#lnRevGmNo').onclick = function(){ lnAct('reversalGmDecide', { id: row.id, approve: false, note: note() }, 'Rejected.', function(){ go('ln_reversals'); }); };
  }
}

/* ---------- GM: carriers, growth ---------- */
VIEWS.ln_gm = function(){
  return srv('carriersList', {}).then(function(d){
    S.rows = d.rows; S.cols = [col('name', 'Carrier'), col('kind', 'Kind')];
    HEAD = bar('<input id="lnCarrierName" placeholder="e.g. Halotel, DCB Bank">'
      + '<select id="lnCarrierKind"><option value="momo">Mobile money</option><option value="bank">Bank</option></select>'
      + '<button class="btn sm" id="lnCarrierAdd">+ Add carrier</button>');
    ONROW = null;
  });
};

function wireLnGm_(){
  var b = document.getElementById('lnCarrierAdd');
  if (!b) return;
  b.onclick = function(){
    lnAct('carrierSave', { name: $('#lnCarrierName').value.trim(), kind: $('#lnCarrierKind').value }, 'Added.', function(){ go('ln_gm'); });
  };
}

/* ---------- Assessment Plan -- who a team means to visit, before there is even a customer ---------- */
var LN_PLAN_STALE_REASONS_ = [], LN_PLAN_TEAMS_ = [];

VIEWS.ln_assess_plan = function(){
  return srv('assessmentPlanList', { team: S.args.team || '' }).then(function(d){
    LN_PLAN_STALE_REASONS_ = d.staleReasons || [];
    /* "Users with multiple teams should also be able to create assessment plan ... they get
       their granted teams at access codes as we always pivot" -- d.teams is exactly the
       team list the signed-in code holds (every team, for a code granted all of them). One
       team: nothing to choose, the server fills it in. More than one: a pivot in the bar,
       and a picker on the add form and the edit drawer. */
    LN_PLAN_TEAMS_ = d.teams || [];
    S.rows = d.rows; S.cols = [
      col('full_name', 'Jina / Name'), col('phone', 'Simu / Phone'), col('team', 'Timu / Team'),
      col('planned_date', 'Tarehe iliyopangwa / Planned date', 'date'),
      { key:'elapsedDays', label:'ED', kind:'num' },
      // How much of the recommendation is drafted on the plan, and whether the customer has
      // since been assigned (then the recommendation itself is where to type).
      { key:'draftN', label:'Rasimu / Draft', get:function(r){ return (r.draftSections || []).length + '/5'; } },
      { key:'assignedRef', label:'Amepangiwa / Assigned', get:function(r){ return r.assignedRef ? r.assignedRef + (r.assignedTeam ? ' · ' + r.assignedTeam : '') : ''; } },
      col('stale_reason', 'Sababu / Reason'),
    ];
    // "only future dates editable" -- a new plan can only ever be for a date not yet here,
    // so the add form's own date input refuses to open on anything earlier, same rule the
    // server enforces again in assessmentPlanSave.
    var teamOpts = function(selected){
      return LN_PLAN_TEAMS_.map(function(t){ return '<option' + (t === selected ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('');
    };
    HEAD = bar(
      (LN_PLAN_TEAMS_.length > 1
        ? '<select data-arg="team"><option value="">Timu zote / All my teams</option>' + teamOpts(S.args.team || '') + '</select>'
        : '')
      + '<input id="lnPlanName" placeholder="Jina / Name">'
      + '<input id="lnPlanPhone" placeholder="Simu / Phone">'
      + '<input id="lnPlanDate" type="date" min="' + esc(todayKey_()) + '" value="' + esc(todayKey_()) + '">'
      + (LN_PLAN_TEAMS_.length > 1
        ? '<select id="lnPlanTeam"><option value="">— timu / team —</option>' + teamOpts(S.args.team || '') + '</select>'
        : '')
      + '<button class="btn sm" id="lnPlanAdd">+ Ongeza / Add</button>');
    ONROW = function(r){ lnAssessPlanForm_(r); };
    S.foot = money(d.rows.length) + ' mipango / plans';
  });
};

function todayKey_(){ return new Date().toISOString().slice(0, 10); }

function wireLnAssessPlan_(){
  var b = document.getElementById('lnPlanAdd');
  if (!b) return;
  b.onclick = function(){
    var teamSel = document.getElementById('lnPlanTeam');
    lnAct('assessmentPlanSave', {
      full_name: $('#lnPlanName').value.trim(), phone: $('#lnPlanPhone').value.trim(), planned_date: $('#lnPlanDate').value,
      team: teamSel ? teamSel.value : '',
    }, 'Imeongezwa.', function(){ go('ln_assess_plan'); });
  };
}

/** "only future dates editable" -- once a plan's own planned_date has passed, everything about
    it is locked except the stale-reason dropdown (that is what the dropdown is FOR: saying why
    a visit that was planned did not happen). Enforced again server-side in assessmentPlanSave,
    which is the one that actually matters -- this is only what the screen shows. */
function lnAssessPlanForm_(row){
  var locked = row.planned_date < todayKey_();
  drawer('<h3>' + esc(row.full_name) + '</h3><div class="sub">' + esc(row.team || '')
      + (locked ? ' &middot; <span class="chip warn">Tarehe imepita / Date has passed (ED ' + row.elapsedDays + ')</span>' : '') + '</div>'
    + (!locked && LN_PLAN_TEAMS_.length > 1
        ? '<div class="fld"><label>Timu / Team</label><select id="lnPlanEditTeam">'
          + LN_PLAN_TEAMS_.map(function(t){ return '<option' + (t === row.team ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('')
          + '</select></div>'
        : '')
    + '<div class="fld"><label>Jina / Name</label><input id="lnPlanEditName" value="' + esc(row.full_name || '') + '"' + (locked ? ' disabled' : '') + '></div>'
    + '<div class="fld"><label>Simu / Phone</label><input id="lnPlanEditPhone" value="' + esc(row.phone || '') + '"' + (locked ? ' disabled' : '') + '></div>'
    + '<div class="fld"><label>Tarehe / Date</label><input id="lnPlanEditDate" type="date" value="' + esc(row.planned_date || '') + '"' + (locked ? ' disabled' : ' min="' + esc(todayKey_()) + '"') + '></div>'
    + (locked ? '<div class="fld"><label>Sababu ya kupitwa na wakati / Stale reason</label><select id="lnPlanEditReason">'
        + '<option value="">— chagua / choose —</option>'
        + LN_PLAN_STALE_REASONS_.map(function(x){ return '<option' + (row.stale_reason === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('')
        + '</select></div>' : '')
    + '<button class="btn w" id="lnPlanSaveBtn">Hifadhi / Save</button>'
    /* "allow the pre-fillable info of loan recommendation at assessment plan and saving only"
       -- the whole recommendation form, drafted on the plan; it merges into the loan the day
       the customer is assigned. Already assigned? Then there is a loan, and the draft has
       nowhere to go -- say so and point at Team · Recommendation. */
    + (row.assignedRef
        ? '<div class="note" style="margin-top:10px">Tayari amepangiwa: Ref ' + esc(row.assignedRef) + (row.assignedTeam ? ' (' + esc(row.assignedTeam) + ')' : '')
          + ' &mdash; jaza kwenye Team &middot; Recommendation. / Already assigned &mdash; fill in at Team &middot; Recommendation.</div>'
        : '<button class="btn w ghost" id="lnPlanFillBtn" style="margin-top:8px">📝 Jaza taarifa za mapendekezo / Fill recommendation info ('
          + (row.draftSections || []).length + '/5)</button>')
    + '<button class="btn w ghost" id="lnPlanDelBtn" style="margin-top:8px">Futa / Delete</button>');
  var fill = document.getElementById('lnPlanFillBtn');
  if (fill) fill.onclick = function(){ lnTeamAssessForm_(null, row); };
  $('#lnPlanSaveBtn').onclick = function(){
    var fields = { id: row.id };
    if (locked) {
      fields.stale_reason = $('#lnPlanEditReason').value;
    } else {
      fields.full_name = $('#lnPlanEditName').value.trim();
      fields.phone = $('#lnPlanEditPhone').value.trim();
      fields.planned_date = $('#lnPlanEditDate').value;
      var editTeam = document.getElementById('lnPlanEditTeam');
      fields.team = editTeam ? editTeam.value : row.team;
    }
    lnAct('assessmentPlanSave', fields, 'Imehifadhiwa.', function(){ go('ln_assess_plan'); });
  };
  $('#lnPlanDelBtn').onclick = function(){
    if (!confirm('Futa mpango huu? / Delete this plan?')) return;
    lnAct('assessmentPlanDelete', { id: row.id }, 'Imefutwa.', function(){ go('ln_assess_plan'); });
  };
}
