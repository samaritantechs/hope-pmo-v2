/* devices -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/devices.js?v=BUILD. */

/* =====================================================================================
   THE COMPANY PHONE REGISTER -- two panes, one register.

     "GM wants us to enroll and lock all our hope company phones ... field officers,
      managers, gmos, pmos etc are provided with company devices and some of uor unworth
      employees quit with our phones so GM has ordered to implement those two nav panes for
      locking and unlocking in hopepmo too"

   Kufunga simu and Kufungua simu draw the SAME list from the SAME function below -- one
   implementation, so the two panes can never disagree about the fleet. What differs is which
   orders each offers. Hiding the other pane's buttons here is the COURTESY; the rule is on
   the server, which gates every state change on the state being asked for rather than on the
   screen that asked (see requireDeviceOrder_ in portal-core.js). Anyone reading this should
   assume the buttons are a convenience and the gate is elsewhere.
   ===================================================================================== */
/* The lock app's package name, as a LAST RESORT only -- the server sends the real one with
   every enrolment, read from DEVICE_LOCK_PACKAGE. The command below is copied at a bench and
   run against a handset, so it has to name the APK that is actually installed: a wrong package
   makes `am broadcast` print "Broadcast completed: result=0", which reads exactly like success
   while nothing was enrolled. See docs/DEVICE-LOCKING.md. */
var DEV_PKG = 'com.samaritantechs.hooploanlock';

function devStateChip_(r){
  if (r.shiftPending) return 'warn';
  if (r.state === 'lost') return 'bad';
  if (r.state === 'locked') return r.lockState === 'pending' ? 'warn' : 'bad';
  if (r.state === 'released') return 'mut';
  return 'ok';
}

function devStateText_(r){
  // Shown ahead of the ordinary state text -- a shift changes WHICH REGISTER owns this row
  // next, which matters more than what this register currently thinks the phone is doing.
  if (r.shiftPending) return 'Inasubiri kuhama / shift pending';
  if (r.state === 'lost') return 'Hasara / written off';
  if (r.state === 'locked') return r.lockState === 'pending'
    ? 'Imeagizwa kufungwa / lock ordered' : 'Imefungwa / locked';
  if (r.state === 'released') return 'Imeachiwa / released';
  return 'Inatumika / in service';
}

/** How long since the handset last spoke. */
function devSeen_(r){ return devAgo_(r.lastSeen); }

/** The position column: how old the FIX is, which is not how old the beat is. */
function devWhere_(r){
  if (r.lat == null || r.lng == null) return '—';
  return devAgo_(r.locAt);
}

/* ONE CALL FOR EVERY ORDER, so the 409 about a released-and-silent phone is handled in one
   place rather than at each button. The confirmation it raises is a question about the phones
   the server NAMED -- the rest are already done, and the message says how many. */
function devOrder_(state, imeis, reason, force){
  return srv('deviceSetState', { imeis: imeis, state: state, reason: reason || '', force: !!force })
    .then(function(r){
      var said = [];
      if (r.changed) said.push(r.changed + ' zimebadilishwa / changed');
      if (r.alreadyThere) said.push(r.alreadyThere + ' zilikuwa hivyo / already');
      if (r.notEnrolled) said.push(r.notEnrolled + ' hazipo kwenye rejista / not enrolled');
      toast(said.join(' · ') || 'Hakuna kilichobadilika. / Nothing changed.');
      closeDrawer(); render({ force:true });
      return r;
    })
    .catch(function(e){
      if (e && e.code === 'RELEASED_NOT_LISTENING' && e.imeis && e.imeis.length) {
        var n = e.changed || 0;
        if (confirm((n ? n + ' zimefungwa. ' : '')
            + e.imeis.length + ' simu iliachiwa na haijaongea tangu hapo — haitasikia amri hii.\n\n'
            + (n ? n + ' phone(s) were locked. ' : '')
            + e.imeis.length + ' was released and has not spoken since, so it will not hear this '
            + 'order. Leave the order standing for when the app is put back on it by cable?')) {
          return devOrder_(state, e.imeis, reason, true);
        }
        render({ force:true });
        return null;
      }
      toast(String((e && e.message) || e), true);
      throw e;
    });
}

/** The paste box every bulk order shares: a column of IMEIs, and a reason box on locking.
    TICKED ROWS FILL IT IN. Somebody working down the register ticks the phones and presses the
    button; somebody working from a paper list pastes a column. Both end in the same box, so
    there is one order path and one confirmation, and the ticks are visible as text before
    anything is sent -- which on a bulk lock is the last chance to notice a wrong row.

    THE REASON IS OFFERED, NOT DEMANDED -- "Hope is still requiring reason to lock" / make it
    optional. It used to block Tuma with nothing typed; a locked phone with a blank reason is
    still worth locking, and a required field a legitimate lock cannot get past is worse than
    an empty one on the history. It still shows only where it ever has (locking, not unlock or
    release), and still lands on the phone's own screen and in its history when given. */
function devBulkDrawer_(state, title, showReason){
  var ticked = pickList_();
  drawer('<h3>' + esc(title) + '</h3>'
    + (ticked.length
        ? '<div class="note ok"><b>' + money(ticked.length) + '</b> zimechaguliwa kwenye orodha. '
          + '/ taken from the ticks on the register — edit the list if that is not what you meant.</div>'
        : '')
    + '<div class="fld"><label>IMEI (moja kwa mstari / one per line)</label>'
    + '<textarea id="devBulkList" rows="8" placeholder="351388334583295&#10;351388334583296">'
    + esc(ticked.join('\n')) + '</textarea></div>'
    + (showReason
        ? '<div class="fld"><label>Sababu / Reason <span class="mut">(hiari / optional)</span></label>'
          + '<input id="devBulkWhy" placeholder="mfano: ameacha kazi na simu"></div>'
          + '<div class="note">Ikijazwa, sababu inaonekana kwenye skrini ya simu iliyofungwa na kwenye '
          + 'historia yake. / If given, the reason shows on the locked phone\'s own screen and stays in its history.</div>'
        : '')
    + '<button class="btn w" id="devBulkGo">Tuma / Send</button>');
  $('#devBulkGo').onclick = function(){
    var list = String($('#devBulkList').value || '').trim();
    if (!list) { toast('Weka IMEI. / Paste at least one IMEI.', true); return; }
    var why = showReason ? String(($('#devBulkWhy')||{}).value || '').trim() : '';
    $('#devBulkGo').disabled = true;
    devOrder_(state, list, why).catch(function(){ $('#devBulkGo').disabled = false; });
  };
}

/** SHIFTING PHONES TO THE OTHER COMPANY, one or many, ticks welcome exactly like a bulk lock.
    -----------------------------------------------------------------------------------------
      "another button for shift so that hoop can shift a device to hope and viceversa saving
       re-enlorrment energy"
      "I dont need to fill anything during shifting from one to other"

    Achia gives up Device Owner, and re-taking it is refused while any account is signed in --
    so achia-then-enrol on a used phone means a factory reset. This writes an ORDER instead:
    the phone reads it on its own next beat and moves itself, never letting go of ownership.

    THIS DRAWER USED TO MAKE THE ADMIN CARRY THE BATCH BY HAND: open the other office's own
    Sajili simu, copy 32 hex characters, paste them back here. That was deliberate the first
    time round -- there is no standing trust between two separate companies' SERVERS -- but
    it missed that the person doing the carrying is the same admin on both sides, and asking
    them to be their own courier for a string they could just as well fetch themselves was
    friction with no security behind it.

    So THIS BROWSER now does the carrying, using an access code for the other portal that
    lives ONLY in this device's localStorage (srvOther_ above says why that is not the same
    thing as server-to-server trust). Enter it once; every Shift after that is tick, press
    Hamisha, done -- the address is already filled in from DEVICE_SHIFT_PARTNER, and the
    batch is minted and collected without anybody reading it off one screen to type into
    another.

    The manual route never goes away -- a batch handed over some other way still works,
    under "Chaguo jingine / Another way" -- because the auto-fetch depends on this browser
    reaching the other portal directly, and an office network that blocks that is a real
    case, not a hypothetical one. */
function devShiftDrawer_(oneImei){
  // Opened from a single row: that phone, and nothing from whatever is ticked elsewhere on
  // the list -- ticks are for the bulk button, a row's own button means just this phone.
  var ticked = oneImei ? [oneImei] : pickList_();
  var savedCode = load('devShiftCode');
  /* NOTHING TO TYPE, WHEN THERE IS NOTHING TO ASK.
       "It shouldnt request nothing just select imeis and transfer wether hope to hoop or
        viceversa."
     Once the phones are ticked, the other office's address is known and this device already
     holds the code for it, every field the drawer used to show was pre-filled and only there
     to be scrolled past. So in that case the drawer is the count and the button, and the
     fields stay in the page -- the Go handler still reads them by id -- folded under "change
     something" for the one time in fifty the list or the address is not what was meant. A
     first-time device (no code yet), or an empty tick list, still sees the fields open. */
  /* Quiet no longer waits for a saved code: with DEVICE_SHIFT_SECRET on both servers the
     batch is fetched server-to-server and no code is ever needed. The code path below is
     the fallback the server asks for by name ("need-batch") when that is not configured. */
  var quiet = ticked.length > 0 && !!S.shiftPartner;
  var fields = '<div class="fld"><label>IMEI (moja kwa mstari / one per line)</label>'
    + '<textarea id="devShiftList" rows="6" placeholder="351388334583295&#10;351388334583296">'
    + esc(ticked.join('\n')) + '</textarea></div>'
    + '<div class="fld"><label>Anwani ya ofisi nyingine / The other office\'s address</label>'
    + '<input id="devShiftServer" placeholder="https://…" value="' + esc(S.shiftPartner || '') + '"></div>'
    /* THE CODE, SHOWN ONE OF TWO WAYS. Saved: a quiet confirmation with a way to change it --
       nobody wants their own credential echoed back at them in a text box every time. Not
       saved: the field to set it, said plainly where it lives and where it does not. */
    + (savedCode
        ? '<div class="note ok" id="devShiftCodeOk">✓ Umehifadhi msimbo wa ofisi nyingine kwenye simu hii. '
          + '<a href="#" id="devShiftCodeChange" style="text-decoration:underline">Badilisha</a>. '
          + '/ This device already holds your code for the other office. '
          + '<a href="#" id="devShiftCodeChange2" style="text-decoration:underline">Change it</a>.</div>'
        : '<div class="fld" id="devShiftCodeFld"><label>Msimbo wako kwenye ofisi nyingine (mara moja) / '
          + 'Your code on the other office (once)</label>'
          + '<input id="devShiftCode" type="password" placeholder="msimbo / access code" '
          + 'style="font-family:monospace"></div>'
          + '<div class="note mutl">Inahifadhiwa kwenye simu HII TU — kamwe haiendi kwenye database yetu. '
          + 'Baada ya hapo, Hamisha haihitaji chochote kingine. / Saved on THIS DEVICE ONLY — never sent to '
          + 'our own database. After this, Shift needs nothing else typed.</div>')
    + '<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--mut);font-size:12.5px">'
      + 'Chaguo jingine — bandika batch mwenyewe / Another way — paste a batch by hand</summary>'
    + '<div class="fld" style="margin-top:8px"><label>Batch kutoka Sajili simu yao / Batch from THEIR Sajili simu</label>'
    + '<input id="devShiftBatch" placeholder="32 hex characters" style="font-family:monospace"></div>'
    + '<div class="note">Ukijaza hii, Hamisha itatumia batch hii moja kwa moja badala ya kuomba moja '
      + 'kiotomatiki. Ni siri ya saa 24 tu, kutoka Sajili simu yao kwa IMEI hizi hizi. '
      + '/ Fill this and Shift uses it directly instead of fetching one automatically. Good for 24 hours '
      + 'only, from their own Sajili simu for these same IMEIs.</div></details>';
  drawer('<h3>Hamisha kwenda kampuni nyingine / Shift to the other company</h3>'
    + '<div class="note">Simu HAIACHI kuwa Device Owner — inahama tu. Hakuna kufuta wala kebo. '
      + '/ The phone does NOT give up ownership — it just moves. No wipe, no cable.</div>'
    + (ticked.length
        ? '<div class="note ok"><b>' + money(ticked.length) + '</b> zimechaguliwa kwenye orodha'
          + (quiet
              ? ' — bonyeza Hamisha tu. / ticked on the register — just press Shift.'
              : '. / taken from the ticks on the register — edit the list if that is not what you meant.')
          + (quiet ? '<div class="mutl" style="margin-top:4px;font-size:12px">→ '
              + esc(S.shiftPartner) + '</div>' : '')
          + '</div>'
        : '')
    + (quiet
        ? '<button class="btn w" id="devShiftGo">Hamisha / Shift</button>'
          + '<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--mut);font-size:12.5px">'
          + 'Badilisha kitu — orodha, anwani, msimbo / Change something — list, address, code</summary>'
          + '<div style="margin-top:8px">' + fields + '</div></details>'
        : fields + '<button class="btn w" id="devShiftGo">Hamisha / Shift</button>'));

  var showCodeField = function(){
    var ok = $('#devShiftCodeOk'); if (ok) ok.outerHTML =
      '<div class="fld" id="devShiftCodeFld"><label>Msimbo wako kwenye ofisi nyingine (mara moja) / '
      + 'Your code on the other office (once)</label>'
      + '<input id="devShiftCode" type="password" placeholder="msimbo / access code" '
      + 'style="font-family:monospace"></div>';
  };
  var cc1 = $('#devShiftCodeChange'), cc2 = $('#devShiftCodeChange2');
  if (cc1) cc1.onclick = function(ev){ ev.preventDefault(); showCodeField(); };
  if (cc2) cc2.onclick = function(ev){ ev.preventDefault(); showCodeField(); };

  $('#devShiftGo').onclick = function(){
    var list = String($('#devShiftList').value || '').trim();
    if (!list) { toast('Weka IMEI. / Paste at least one IMEI.', true); return; }
    var server = String($('#devShiftServer').value || '').trim();
    if (!/^https:\/\//i.test(server)) {
      toast('Anwani lazima ianze na https:// . / The address must start with https:// .', true);
      return;
    }
    var manualBatch = String(($('#devShiftBatch') || {}).value || '').trim();
    var codeInput = $('#devShiftCode');
    var code = codeInput ? String(codeInput.value || '').trim() : (load('devShiftCode') || '');
    if (codeInput && code) store('devShiftCode', code);   // saved the moment it is used, not before

    var go = $('#devShiftGo');
    var finish = function(server2, batch2){
      go.disabled = true;
      return srv('deviceShift', { imeis: list, server: server2, batch: batch2 || undefined })
        .then(function(r){
          var said = [];
          if (r.ordered) said.push(r.ordered + ' zimeagizwa kuhama / ordered to shift');
          if (r.alreadyReleased) said.push(r.alreadyReleased + ' tayari zimeachiwa / already released');
          if (r.unknown) said.push(r.unknown + ' hazipo kwenye rejista / not on this register');
          toast(said.join(' · ') || 'Hakuna kilichobadilika. / Nothing changed.');
          closeDrawer(); render({ force:true });
        })
        .catch(function(e){ go.disabled = false; toast(String((e && e.message) || e), true); });
    };

    /* MANUAL WINS IF FILLED IN -- the "advanced" box is a deliberate override, not a
       fallback tried after the automatic path fails silently. Somebody who opened it and
       pasted a batch gets exactly the batch they pasted, every time. */
    if (manualBatch) { finish(server, manualBatch); return; }

    /* FIRST, NO BATCH AT ALL: the server fetches one from the other office itself when
       DEVICE_SHIFT_SECRET is set on both sides ("hope><hoop needs no verification"). Only
       if it answers need-batch does this fall to the code-once path below. */
    var byCode = function(){
      if (!code) {
        var det = $('#devShiftCodeFld') && $('#devShiftCodeFld').closest('details');
        if (det) det.open = true;
        showCodeField();
        toast('Weka msimbo wa ofisi nyingine (mara moja), au bandika batch kwa mkono. / Enter your code for '
          + 'the other office (once), or paste a batch by hand.', true);
        return;
      }
      go.disabled = true;
      srvOther_(server, code, 'deviceEnrol', { imeis: list })
        .then(function(r){
          if (!r || !r.batch) {
            go.disabled = false;
            toast('Ofisi nyingine haikurudisha batch. / The other office did not hand back a batch.', true);
            return;
          }
          return finish(server, r.batch);
        })
        .catch(function(e){ go.disabled = false; toast(String((e && e.message) || e), true); });
    };
    go.disabled = true;
    srv('deviceShift', { imeis: list, server: server })
      .then(function(r){
        var said = [];
        if (r.ordered) said.push(r.ordered + ' zimeagizwa kuhama / ordered to shift');
        if (r.alreadyReleased) said.push(r.alreadyReleased + ' tayari zimeachiwa / already released');
        if (r.unknown) said.push(r.unknown + ' hazipo kwenye rejista / not on this register');
        toast(said.join(' · ') || 'Hakuna kilichobadilika. / Nothing changed.');
        closeDrawer(); render({ force:true });
      })
      .catch(function(e){
        go.disabled = false;
        if (/need-batch/i.test(String((e && e.message) || e))) { byCode(); return; }
        toast(String((e && e.message) || e), true);
      });
    return;
  };
}

/** ONE PHONE'S STORY, and the orders that can be given against it from this pane. */
function devOpen_(imei, mode){
  srv('deviceHistory', { imei: imei }).then(function(d){
    if (!d.found) { toast('Simu hii haipo kwenye rejista. / Not on the register.', true); return; }
    var r = d.device;
    var line = function(k, v){ return '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0">'
      + '<span class="mutl">' + esc(k) + '</span><b>' + esc(v == null || v === '' ? '—' : String(v)) + '</b></div>'; };
    drawer('<h3>' + esc(r.imei) + '</h3>'
      + '<div class="note"><span class="chip ' + devStateChip_(r) + '">' + esc(devStateText_(r)) + '</span>'
      + (r.lockedNeverSpoke
          ? ' <span class="chip bad">Haijawahi kuongea / never called home</span>' : '')
      + '</div>'
      + line('Mfano / Model', r.item)
      + line('Ana nayo / Held by', r.holder)
      + line('Kutoka / From', r.origin ? r.origin + ' (imehamishwa / shifted here)' : null)
      + line('Timu / Team', r.team)
      + line('Wadhifa / Role', r.role)
      + line('Ilionekana / Last seen', devSeen_(r))
      + line('Betri / Battery', r.battery == null ? null : r.battery + '%')
      + line('Toleo / App', r.appVersion)
      /* WHERE IT WAS, AND HOW OLD THAT IS -- never the first without the second. The handset
         reports its LAST KNOWN position rather than waking the GPS every beat, so this fix can
         be hours older than the beat that carried it, and somebody reading a map pin without
         its age will drive to where the phone was on Tuesday. */
      + (r.lat != null && r.lng != null
          ? '<div class="note">📍 <b>' + esc(r.lat.toFixed(5)) + ', ' + esc(r.lng.toFixed(5)) + '</b>'
            + (r.locAcc != null ? ' <span class="mutl">±' + money(r.locAcc) + 'm</span>' : '')
            + '<br><span class="mutl">Ilipimwa / fix taken: ' + esc(devAgo_(r.locAt))
            + (r.locAt && r.lastSeen && (Date.parse(r.lastSeen) - Date.parse(r.locAt)) > 3600000
                ? ' — <b>ni ya zamani kuliko mawasiliano ya mwisho</b> / older than the last beat' : '')
            + '</span><br><a class="tel" target="_blank" rel="noopener" href="https://www.google.com/maps?q='
            + esc(r.lat + ',' + r.lng) + '">Fungua ramani / Open map</a></div>'
          : '<div class="note mutl">📍 Hakuna mahali bado / no position reported yet</div>')
      + line('Sababu / Reason', r.reason)
      + line('Ameagiza / Ordered by', r.by)
      /* THE SHIFT ORDER SITTING ON THIS ROW, if there is one, and it is shown here because
         "why has this phone not moved" is exactly what somebody opens this drawer to ask. */
      + (r.shiftTo
          ? '<div class="note warnc">Inasubiri kuhama kwenda <b>' + esc(r.shiftTo) + '</b> — '
            + 'itaenda kwenye beat yake ijayo. / Waiting to shift to <b>' + esc(r.shiftTo)
            + '</b> — it moves on its next beat.</div>'
          : '')
      /* THE HANDSET'S OWN GUESS AT ITS IMEI, shown only when it differs. A dual-SIM phone has
         two and Android is not consistent about which it hands back, so a difference is a
         thing for a person to look at, never a fact to act on. */
      + (r.reportedImei && r.reportedImei !== r.imei
          ? '<div class="note">Simu inasema IMEI yake ni <b>' + esc(r.reportedImei) + '</b>. '
            + 'Simu za SIM mbili zina IMEI mbili — si lazima iwe tatizo. '
            + '/ The handset reports a different IMEI. A dual-SIM phone has two; this is not '
            + 'proof of anything on its own.</div>'
          : '')
      + '<div class="fld"><label>Ana nayo nani? / Who is carrying it?</label>'
      + '<input id="devHolder" value="' + esc(r.holder || '') + '" placeholder="jina la mfanyakazi / staff name"></div>'
      + '<div class="fld"><label>Timu / Team</label><input id="devTeam" value="' + esc(r.team || '') + '"></div>'
      + '<div class="fld"><label>Wadhifa / Role</label><input id="devRole" value="' + esc(r.role || '') + '"></div>'
      + '<button class="btn w ghost" id="devSaveHolder">Hifadhi mwenye simu / Save holder</button>'
      /* THE WAY BACK TO A PHONE'S TOKEN. The enrol drawer shows the batch command once and
         then it is gone; a handset that was wiped, or arrived late to the bench, needs its own
         credential read back. The server has always been able to do this -- this is the button
         that reaches it, and it is on the LOCKING pane only, because provisioning is the
         bench's own work. The read is audited. */
      + (mode === 'lock'
          ? '<button class="btn w ghost" id="devToken">🔑 Token ya simu hii / This phone\'s command</button>'
            + '<button class="btn w ghost" id="devShiftOne" style="margin-top:8px">↔️ Hamisha simu hii / '
            + 'Shift this phone</button>'
          : '')
      + (mode === 'lock'
          ? '<div class="fld" style="margin-top:10px"><label>Sababu / Reason <span class="mut">(hiari / optional)</span></label>'
            + '<input id="devWhy" placeholder="mfano: ameacha kazi na simu"></div>'
            + '<button class="btn w bad" id="devLock">🔒 Funga / Lock</button>'
            + '<button class="btn w ghost" id="devLost">Andika hasara / Write off</button>'
          : '<button class="btn w" id="devUnlock" style="margin-top:10px">🔓 Fungua / Unlock</button>'
            + '<button class="btn w ghost" id="devRelease">Achia kabisa / Release for good</button>'
            + '<div class="note">Achia humwambia simu ijifungue, iache ulinzi na <b>iache kuongea nasi</b>. '
            + 'Ni ya simu inayorudishwa kwa mwenyewe. / Release tells the handset to unlock, drop the '
            + 'restrictions and <b>stop calling home</b>. It is for a phone leaving the company for good.</div>')
      + '<div class="card" style="margin-top:12px"><div class="card-h">Historia / History</div>'
      + '<div class="scroll"><table><thead><tr><th>Lini</th><th>Tukio</th><th>Sababu</th><th>Nani</th></tr></thead><tbody>'
      + (d.events || []).map(function(e){
          return '<tr><td>' + esc(String(e.at || '').replace('T',' ').slice(0,16)) + '</td>'
            + '<td>' + esc(e.event) + (e.to ? ' → ' + esc(e.to) : '') + '</td>'
            + '<td>' + esc(e.reason || '') + '</td><td>' + esc(e.actor || '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>');

    $('#devSaveHolder').onclick = function(){
      srv('deviceIssue', { imei: imei, holder: $('#devHolder').value,
        team: $('#devTeam').value, role: $('#devRole').value })
        .then(function(){ toast('Imehifadhiwa. / Saved.'); closeDrawer(); render({ force:true }); })
        .catch(function(e){ toast(String(e.message || e), true); });
    };
    if (mode === 'lock') {
      $('#devShiftOne').onclick = function(){ devShiftDrawer_(imei); };
      $('#devToken').onclick = function(){
        srv('deviceToken', { imei: imei }).then(function(t){
          if (!t.token) { toast('Simu hii haina token. / This phone has no token — enrol it again.', true); return; }
          var pkg = t.pkg || DEV_PKG, origin = location.origin;
          /* ONE PHONE, ONE TOKEN -- the single-handset form of the bench command. No batch, so
             it does not expire, and it names this phone and no other. */
          /* STEP 0, ONLY WHEN CONFIGURED -- "if there should be installation or anything then
             it must be included in the token copy". Numbered 0 rather than renumbering 1/2 so
             every existing note below that says "step 2" or "steps 1 and 2" (the result=2
             handling further down) keeps meaning exactly what it always has. */
          var install = t.apkPath ? 'adb install -r "' + t.apkPath + '"' : '';
          var own = 'adb shell dpm set-device-owner ' + pkg + '/.LockAdmin';
          var run = 'adb shell am broadcast --include-stopped-packages'
            + ' -a ' + pkg + '.ENROL'
            + ' -n ' + pkg + '/.EnrolReceiver'
            + ' -e server ' + origin
            + ' -e token ' + t.token;
          /* ONE LINE, CHAINED, NOT THREE LINES PASTED -- "make sure single cmd works
             everything". See the identical note in devEnrolDrawer_ for why `&&` sits before
             ownership (no point granting it to an app that never installed) and plain `&`
             sits before enrol (set-device-owner answering "already set" is success and can
             exit non-zero for it, so `&&` there would stop the chain on the one run that
             needed nothing more done). */
          var all = (install ? install + ' && ' : '') + '(' + own + ' & ' + run + ')';
          /* TWO BOXES, NOT ONE, and that is the whole point of this drawer's shape.
             -----------------------------------------------------------------------------
             These were one textarea holding two lines, with "run them in this order" written
             above it -- and a terminal does not read notes. Pasting two lines into cmd runs
             the first and drops the second into the type-ahead buffer, where its echo
             interleaves with the first command's output and it never runs at all. What the
             operator gets back is the first command's answer, looking for all the world like
             the answer to both:

               ... -e token 1ea6d5bf...com.samaritantechs.hooploanlock/.LockAdmin was already
               an admin for user 0.

             No "Broadcasting:", no "Broadcast completed:", no result code. Nothing enrolled,
             and nothing on the screen that says so. So the commands are handed over one at a
             time, each with its own button, and the ordering note now has something to point
             at. The batch drawer never had this problem: it copies one command. */
          drawer('<h3>' + esc(imei) + '</h3>'
            + '<div class="note">Amri ya simu hii pekee. Endesha <b>moja baada ya nyingine</b> — '
            + 'subiri prompt irudi kabla ya ya pili. Zikibandikwa pamoja, cmd inaendesha ya kwanza '
            + 'tu na ya pili inapotea kimya. / This one handset\'s command, in <b>two steps</b>. '
            + 'Run the first, wait for the prompt to come back, then run the second. Pasted '
            + 'together, cmd runs only the first and swallows the second silently.</div>'
            + devCmdBox_('A', 'Amri moja / All-in-one', all, 'devCmdAll')
            + '<div class="note">Au fuata hatua kwa hatua hapa chini ukitaka kuona kila jibu lenyewe. '
            + '/ Or follow the numbered steps below if you want to see each answer on its own.</div>'
            + (install
                ? '<div class="fld"><label>0 · Sakinisha / Install</label>'
                  + '<textarea id="devCmd0" rows="2" readonly>' + esc(install) + '</textarea></div>'
                  + '<button class="btn w ghost" id="devCmd0Copy">Nakili ya 0 / Copy step 0</button>'
                : '')
            + '<div class="fld"><label>1 · Umiliki / Ownership</label>'
            + '<textarea id="devCmd1" rows="2" readonly>' + esc(own) + '</textarea></div>'
            + '<button class="btn w ghost" id="devCmd1Copy">Nakili ya kwanza / Copy step 1</button>'
            /* THE ANSWER THAT LOOKS LIKE A FAILURE AND IS NOT. Android throws
               IllegalStateException when the device owner is already set -- including when it
               is already set to US, which is the success case. An operator reading a stack
               trace assumes the step failed and goes round again. */
            + '<div class="note">Ikijibu <b>"device owner (' + esc(pkg) + '/.LockAdmin) is already set"</b> '
            + 'hatua hii <b>imeshakamilika</b> — ni mafanikio, si kosa. Nenda hatua ya 2. '
            + '/ If it answers <b>"device owner … is already set"</b> naming this same package, this step '
            + 'is <b>already done</b> — that stack trace is success, not a failure. Go to step 2.</div>'
            + '<div class="fld" style="margin-top:10px"><label>2 · Sajili / Enrol</label>'
            + '<textarea id="devCmd2" rows="4" readonly>' + esc(run) + '</textarea></div>'
            + '<button class="btn w ghost" id="devCmd2Copy">Nakili ya pili / Copy step 2</button>'
            + '<div class="note">Unatakiwa kuona <b>result=1</b> na neno <b>ENROLLED</b>. Kitu kingine chochote '
            + 'ni kosa — soma ujumbe uliorudi. / You are looking for <b>result=1</b> and the word '
            + '<b>ENROLLED</b>. Anything else is a failure and the message says which.</div>'
            /* result=2 IS THE ONE THE RECEIVER GIVES THE WRONG ADVICE FOR, on HOPE.
               ---------------------------------------------------------------------------
               HOPE provisions against the lock app Hoop already ships, whose built-in
               fallback server is hoop-pmo. The app writes its server ONLY when it has no
               token -- `boolean fresh = existing.isEmpty()` in EnrolReceiver -- so on a
               handset that already carries one, `-e server` is read and thrown away, every
               time, in silence. The claim then goes to HOOP, HOOP does not know our batch,
               and the bench reads HTTP 403 as "wrong IMEI" and starts re-checking numbers
               that were never the problem.

               The receiver answers result=2 by suggesting `-e current`. That moves the token
               and DELIBERATELY leaves the server where it is -- correct inside one office,
               wrong here: the phone would end up holding a HOPE credential while beating to
               HOOP, which is a handset no register can reach and no desk can unlock.

               Clearing the token is what makes the next enrolment fresh, and RELEASE over the
               cable is the only thing that clears it. */
            + '<div class="note bad"><b>Ikijibu result=2 "ALREADY ENROLLED"</b> — simu hii bado ni ya '
            + 'rejista nyingine (hoop-pmo), na <b>-e server haisomwi</b> kwenye simu yenye token. '
            + '<b>Usitumie -e current</b>: itabadilisha token lakini itaacha server ya zamani. '
            + 'Kwanza iachie kwa kebo ukitumia token yake ya rejista ile, kisha rudia hatua 1 na 2:'
            + '<br><code style="font-size:11px;word-break:break-all">adb shell am broadcast '
            + '--include-stopped-packages -a ' + esc(pkg) + '.RELEASE -n ' + esc(pkg)
            + '/.ReleaseReceiver -e token &lt;token ya rejista ile&gt;</code>'
            + '<br>/ <b>result=2 means this handset still belongs to another register</b> (hoop-pmo) — '
            + 'routine when a phone comes across from Hoop, not a fault. <b>Releasing it in Hoop\'s '
            + 'portal is not enough</b>: that unlocks the handset and gives up ownership but leaves its '
            + 'token in place, so it still answers this way. '
            + 'The app writes its server address only when it holds no token, so <b>-e server is '
            + 'silently ignored</b> on a phone that has one — which is why the claim 403s: it is '
            + 'asking the wrong office. <b>Do not use -e current</b>; it moves the token and keeps the '
            + 'old server, leaving a phone no register can reach. Release it over the cable with its '
            + 'token from <i>that</i> register (result=1 or result=3 both clear it), then run steps 1 '
            + 'and 2 again. result=3 keeps ownership, so step 1 can be skipped.'
            /* THE ANGLE BRACKETS ARE THE SAFETY NET, and the error they produce needs saying
               once. cmd reads < and > as file redirection, so a placeholder left in errors
               with "The syntax of the command is incorrect" instead of running -- which is
               exactly why it is written with them. Without that line an operator reads a
               Windows parser error as a broken command and starts editing the wrong thing. */
            + '<br><b>"The syntax of the command is incorrect"</b> = bado hujaweka token. Ondoa '
            + '&lt; &gt; na weka token yenyewe. / That Windows error means the placeholder is '
            + 'still in it — cmd reads &lt; &gt; as redirection. Replace the brackets <i>and</i> '
            + 'the words between them with the token itself. Nothing was sent to the phone.</div>'
            + '<div class="note">Token ni siri ya simu hii. / The token is this handset\'s credential — it is '
            + 'not on any list or export, and reading it here is written to the audit log.</div>');
          var copy = function(id){
            var el = $(id); el.select();
            try { document.execCommand('copy'); toast('Imenakiliwa. / Copied.'); }
            catch (e) { toast('Chagua na nakili kwa mkono. / Select and copy it by hand.', true); }
          };
          wireDevCmdCopies_();
          if (install) $('#devCmd0Copy').onclick = function(){ copy('#devCmd0'); };
          $('#devCmd1Copy').onclick = function(){ copy('#devCmd1'); };
          $('#devCmd2Copy').onclick = function(){ copy('#devCmd2'); };
        }).catch(function(e){ toast(String((e && e.message) || e), true); });
      };
      $('#devLock').onclick = function(){
        var why = String($('#devWhy').value || '').trim();
        devOrder_('locked', [imei], why);
      };
      $('#devLost').onclick = function(){
        var why = String($('#devWhy').value || '').trim();
        if (!why) { toast('Sababu inahitajika. / A reason is required.', true); return; }
        if (!confirm('Andika simu hii kama hasara? Itabaki imefungwa milele.\n\n'
          + 'Write this phone off? It stays LOCKED for good — that is the point of it.')) return;
        devOrder_('lost', [imei], why);
      };
    } else {
      $('#devUnlock').onclick = function(){ devOrder_('enrolled', [imei], ''); };
      $('#devRelease').onclick = function(){
        if (!confirm('Achia simu hii kabisa? Itaacha kuongea nasi na haitaweza kufungwa tena bila kebo.\n\n'
          + 'Release for good? It stops calling home, and cannot be locked again without a cable.')) return;
        devOrder_('released', [imei], '');
      };
    }
  }).catch(function(e){ toast(String((e && e.message) || e), true); });
}

/* ONE COMMAND, ONE BOX, ONE COPY BUTTON -- always, everywhere a bench command is shown.
   -----------------------------------------------------------------------------------
   The single-phone token drawer already learned this the hard way (see its own note, a few
   screens down): pasting two lines into cmd.exe runs only the first and swallows the second
   into the type-ahead buffer, in silence -- no error, no second prompt, just a step that
   never ran and nothing on screen saying so. So every bench step, on every drawer, is its
   own textarea and its own button, numbered, never concatenated into one paste. */
function devCmdBox_(n, label, cmd, id){
  return '<div class="fld" style="margin-top:10px"><label>' + esc(n) + ' &middot; ' + esc(label) + '</label>'
    + '<textarea id="' + id + '" rows="3" readonly>' + esc(cmd) + '</textarea></div>'
    + '<button class="btn w ghost dcCopy" data-t="' + id + '">Nakili hatua ' + esc(n) + ' / Copy step ' + esc(n) + '</button>';
}

function wireDevCmdCopies_(){
  Array.prototype.forEach.call(document.querySelectorAll('.dcCopy'), function(b){
    b.onclick = function(){
      var t = $('#' + b.getAttribute('data-t'));
      if (!t) return;
      t.select();
      try { document.execCommand('copy'); toast('Imenakiliwa. / Copied.'); }
      catch (e) { toast('Chagua na nakili kwa mkono. / Select and copy it by hand.', true); }
    };
  });
}

/** ENROL. The bench's own screen: paste the column of IMEIs, get the commands back. */
function devEnrolDrawer_(){
  drawer('<h3>Sajili simu / Enrol phones</h3>'
    + '<div class="fld"><label>IMEI (moja kwa mstari / one per line)</label>'
    + '<textarea id="devEnrolList" rows="8" placeholder="351388334583295&#10;351388334583296"></textarea></div>'
    + '<div class="fld"><label>Mfano / Model</label><input id="devEnrolItem" placeholder="mfano: Samsung A05"></div>'
    + '<button class="btn w" id="devEnrolGo">Sajili / Enrol</button>');
  $('#devEnrolGo').onclick = function(){
    var list = String($('#devEnrolList').value || '').trim();
    if (!list) { toast('Weka IMEI. / Paste at least one IMEI.', true); return; }
    $('#devEnrolGo').disabled = true;
    srv('deviceEnrol', { imeis: list, item: $('#devEnrolItem').value })
      .then(function(r){
        if (r.ready === false) { toast(r.note, true); $('#devEnrolGo').disabled = false; return; }
        /* THE COMMAND, WITH THE BATCH ALREADY IN IT. One line for every phone on the hub:
           each handset reads its own IMEI and collects the token minted for it, so plug-in
           order cannot decide which phone gets which identity. */
        var origin = location.origin;
        /* The package comes from the SERVER, because the command has to name the APK that is
           actually on these handsets -- and `am broadcast` answers a wrong package with
           "Broadcast completed: result=0", which reads exactly like success while nothing was
           enrolled. Set DEVICE_LOCK_PACKAGE in Settings if you run your own build. */
        var pkg = r.pkg || DEV_PKG;
        var install = 'adb install -r "' + r.apkPath + '"';
        var own = 'adb shell dpm set-device-owner ' + pkg + '/.LockAdmin';
        var run = 'adb shell am broadcast --include-stopped-packages'
          + ' -a ' + pkg + '.ENROL'
          + ' -n ' + pkg + '/.EnrolReceiver'
          + ' -e server ' + origin
          + ' -e batch ' + r.batch;
        /* ONE LINE, CHAINED, NOT THREE LINES PASTED -- "make sure single cmd works everything".
           cmd.exe only swallows a SECOND LINE (a second Enter); operators chained on one line
           with && / & is exactly what the operator's own working curl-chain already proved.
           `&&` between install and ownership: no point granting ownership onto an app that
           never installed. Plain `&` between ownership and enrol, deliberately, NOT `&&`:
           set-device-owner answering "already set" is the SUCCESS case and can exit non-zero
           for it, so `&&` there would stop the chain on exactly the run that needed nothing
           more done. */
        var all = (r.apkPath ? install + ' && ' : '') + '(' + own + ' & ' + run + ')';
        var step = 1;
        drawer('<h3>' + money(r.enrolled) + ' zimesajiliwa / enrolled</h3>'
          + (r.alreadyOn ? '<div class="note">' + money(r.alreadyOn) + ' zilikuwepo tayari — zimehifadhi token yake ya zamani. '
              + '/ already on the register, each keeping the token it already had.</div>' : '')
          + (r.revived ? '<div class="note">' + money(r.revived) + ' zilizokuwa zimeachiwa zimerudi kazini. '
              + '/ previously released, now back in service.</div>' : '')
          + '<div class="note">Kwa kila simu. Amri moja hapa chini inafanya kila kitu — au fuata hatua kwa '
          + 'hatua chini yake ukitaka kuona kila jibu lenyewe. / For each phone. The one command below does '
          + 'everything — or follow the numbered steps beneath it if you want to see each answer on its own.</div>'
          + devCmdBox_('A', 'Amri moja / All-in-one', all, 'devCmdAll')
          + (r.apkPath ? devCmdBox_(String(step++), 'Sakinisha / Install', install, 'devCmdI') : '')
          + devCmdBox_(String(step++), 'Umiliki / Ownership', own, 'devCmdO')
          /* Same trap as the single-phone drawer: that stack trace is the success case. */
          + '<div class="note">Ikijibu <b>"device owner … is already set"</b> ikitaja <b>' + esc(pkg) + '</b>, '
          + 'simu hiyo ilishamilikiwa — endelea. / If set-device-owner answers <b>"device owner … is already '
          + 'set"</b> naming <b>' + esc(pkg) + '</b>, that handset is already owned — that stack trace is '
          + 'success. Move on.</div>'
          + devCmdBox_(String(step++), 'Sajili / Enrol', run, 'devCmdR')
          + '<div class="note">Batch hii inakufa baada ya saa 24. / This batch expires in 24 hours.</div>');
        wireDevCmdCopies_();
      })
      .catch(function(e){ $('#devEnrolGo').disabled = false; toast(String(e.message || e), true); });
  };
}

/** THE SHARED VIEW. `mode` is 'lock' or 'unlock' and decides only which orders are offered. */
/* THE REFUSED-CLAIM STRIP, and why it says what the 403 would not.
   ---------------------------------------------------------------------------------------
   The handset is told nothing on purpose -- an endpoint that explains itself to a phone is
   an endpoint anybody can ask which IMEIs the office is holding. The bench is not a phone,
   so it is told everything, here.

   TWO CAUSES, TWO DIFFERENT NEXT MOVES, and the whole value of this strip is telling them
   apart. Not on the register: the number in the phone is not the number that was pasted --
   the stock sheet was wrong, or it is a dual-SIM's other slot -- so enrol the one printed
   here and the handset goes through. On the register: the command carried a batch that
   phone was not in, which is what an old copied command does, so re-open Sajili simu. */
function devRefused_(list, mode){
  if (mode !== 'lock' || !list || !list.length) return '';
  return '<div class="note bad"><b>' + money(list.length) + '</b> simu zimejaribu kujisajili '
    + 'zikakataliwa (saa 24) / handsets tried to enrol in the last 24h and were refused:'
    + '<ul style="margin:6px 0 0 18px;padding:0">'
    + list.map(function(r){
        return '<li style="margin:3px 0"><b>' + esc(r.imei) + '</b> · ' + esc(devAgo_(r.at))
          + ' · ' + money(r.tries) + ' mara / tries<br>'
          + (r.onRegister
              ? 'Ipo kwenye rejista lakini haikuwa kwenye batch ya amri uliyotumia — amri ya zamani. '
                + 'Fungua <b>+ Sajili simu</b> tena na nakili amri mpya. '
                + '/ On the register, but not in the batch that command carried — it is an old '
                + 'command. Re-open <b>+ Sajili simu</b> and copy the fresh one.'
              : '<b>Haipo kwenye rejista.</b> Hii ndiyo IMEI halisi iliyoko ndani ya simu; '
                + 'uliyoandika ni namba nyingine. Sajili hii hapa juu. '
                + '/ <b>Not on the register.</b> This is the IMEI actually inside that handset — '
                + 'what was pasted was a different number. Enrol this one.')
          + '</li>';
      }).join('')
    + '</ul></div>';
}

function devicesView_(mode){
  /* `refused` AND `shiftPartner` ARE ASKED FOR ONLY BY THE PANE THAT ENROLS/SHIFTS.
     Kufungua simu never provisions or moves a handset, so it never pays either read. */
  return srv('deviceList', { q: S.args.q || '', refused: mode === 'lock', shiftPartner: mode === 'lock' }).then(function(d){
    var c = d.counts || {};
    S.devMode = mode;
    // Stashed, not consumed here: the Shift drawer reads it when it opens, so the default
    // address is on screen the moment somebody presses Hamisha, never a beat later.
    if (d.shiftPartner) S.shiftPartner = d.shiftPartner;
    HEAD = (d.ready === false
        ? '<div class="note bad">' + esc(d.note) + '</div>'
        : '')
      + '<div class="kpis">'
      + kpi('Simu / Phones', money(d.total), money(c.issued) + ' zimetolewa · ' + money(c.inStore) + ' stoo')
      + kpi('Zimefungwa / Locked', money(c.locked),
            c.lockPending ? money(c.lockPending) + ' bado hazijathibitisha / not yet confirmed' : 'zote zimethibitisha / all confirmed',
            c.locked ? 'bad' : '')
      + kpi('Hasara / Written off', money(c.lost), 'zimeachwa zimefungwa / left locked', c.lost ? 'bad' : '')
      + kpi('Kimya / Quiet', money(c.stale), money(c.neverSeen) + ' hazijawahi kuongea / never spoke', 'warnc')
      + '</div>'
      /* THE ALARM, said where somebody will see it: a handset ordered locked that has never
         once called home was never provisioned properly, and no other screen can show that. */
      + (c.lockedNeverSpoke
          ? '<div class="note bad"><b>' + money(c.lockedNeverSpoke) + '</b> simu zimeagizwa kufungwa lakini '
            + 'hazijawahi kuongea nasi — hazikuwekwa app vizuri. Zirudishe kwenye bench. '
            + '/ ordered locked but never called home: the app was never provisioned properly on them. '
            + 'They are not locked and cannot be. Take them back to the bench.</div>'
          : '')
      /* AND THE OTHER HALF OF THE SAME PROBLEM, one step earlier: a phone that asked to
         enrol and was refused. The bench sees only "THE OFFICE REFUSED THIS PHONE (HTTP
         403)", which names three possible causes and settles none of them. This names the
         one that happened, and prints the IMEI THE HANDSET ITSELF REPORTED -- which on the
         commonest failure of all is simply not the number that was pasted. */
      + devRefused_(d.refused, mode)
      /* WHERE THE WORDS LIVE, said on the screen that orders the lock. They have always come
         from settings and never from the app -- but Settings lists only keys that already
         have a row, so until somebody wrote one there was nothing to click and no way to
         learn the key's name. Whoever presses Funga is exactly who wonders what the phone
         will say, so the pointer belongs here. */
      + (mode === 'lock'
          ? '<div class="note mutl">Maneno na alama kwenye skrini ya simu iliyofungwa yanabadilishwa '
            + '<b>Mipangilio → Skrini ya simu iliyofungwa</b> (msimamizi). Hayamo ndani ya app. '
            + '/ The words and the mark on a locked phone\'s screen are edited in '
            + '<b>Settings → The locked phone\'s screen</b> (admin). None of it is inside the app.</div>'
          : '')
      + bar('<label style="font-size:12px;color:var(--mut)">Tafuta / Search</label>'
          + '<input data-arg="q" value="' + esc(S.args.q || '') + '" placeholder="IMEI, jina, timu">'
          + (mode === 'lock'
              ? '<button class="btn sm" id="devEnrolBtn" style="margin-left:8px">+ Sajili simu / Enrol</button>'
                + '<button class="btn sm bad" id="devLockMany" style="margin-left:6px">🔒 Funga kwa wingi / Lock many</button>'
                /* SHIFT LIVES ON THE LOCKING PANE, next to Enrol, because it is the same job:
                   deciding which register a handset belongs to. requireDeviceOrder_('locked')
                   on the server agrees -- Kufungua simu cannot order one, only receive one. */
                + '<button class="btn sm ghost" id="devShiftMany" style="margin-left:6px">↔️ Hamisha / Shift</button>'
              : '<button class="btn sm" id="devUnlockMany" style="margin-left:8px">🔓 Fungua kwa wingi / Unlock many</button>'
                + '<button class="btn sm ghost" id="devReleaseMany" style="margin-left:6px">Achia kwa wingi / Release many</button>')
          /* THE LIVE TICK COUNT. Written into this chip by the tick handler rather than by a
             re-render: re-rendering the tab to change one number would close the keyboard,
             lose the scroll position and empty the search box. */
          + '<span class="chip mut" data-pickcount="1" style="margin-left:8px">0</span>'
          + '<span class="mutl" style="font-size:12px">zimechaguliwa / ticked</span>'
          + '<button class="btn sm ghost" id="devPickNone" style="margin-left:6px">Ondoa chaguo / Clear</button>'
          + '<span class="chip mut" style="margin-left:8px">'
          + (mode === 'lock' ? 'Kufunga / Locking' : 'Kufungua / Unlocking') + '</span>');
    /* TICKS ON, keyed by IMEI -- see the note above tableHtml. The bulk buttons read them, and
       a phone stays ticked through a sort or a search because the selection is a set of IMEIs
       rather than a set of row positions. */
    S.pickKey = 'imei';
    S.rows = d.rows || [];
    S.cols = [col('imei','IMEI'),
      {key:'state', label:'Hali / State', kind:'chip', chip:devStateChip_,
       get:devStateText_},
      /* A PHONE HANDED OVER BY THE OTHER OFFICE HAS NO HOLDER HERE, and "—" in this column
         reads as "in the store". It is not: Hoop's sold stock arrives locked and in a
         customer's pocket. The origin stands in until somebody issues it. */
      {key:'holder', label:'Ana nayo / Held by',
       get:function(r){ return r.holder || (r.origin ? 'kutoka ' + r.origin + ' / from ' + r.origin : ''); },
       cls:function(r){ return r.holder ? '' : (r.origin ? 'mutl' : ''); }},
      col('team','Timu'), col('role','Wadhifa'),
      col('item','Mfano / Model'),
      {key:'lastSeen', label:'Ilionekana / Seen', get:devSeen_,
       cls:function(r){ return r.neverSeen ? 'bad' : (r.stale ? 'warnc' : ''); }},
      {key:'battery', label:'Betri', kind:'num', get:function(r){ return r.battery == null ? '' : r.battery + '%'; }},
      /* THE AGE OF THE FIX, not the coordinate. A pair of decimals in a table column is noise
         nobody reads; what somebody scanning this list needs to know is whether there is a
         recent position to act on. The coordinate and its map link are one tap away, in the
         drawer, beside the warning that says when the fix is older than the beat. */
      {key:'locAt', label:'Mahali / Where', get:devWhere_,
       cls:function(r){ return (r.lat == null) ? 'mutl' : ''; }},
      col('reason','Sababu / Reason'), col('by','Ameagiza / By')];
    ONROW = function(r){ devOpen_(r.imei, mode); };
    S.foot = money(d.total) + ' simu / phones'
      + (d.searching ? ' · utafutaji / searching "' + d.q + '"' : '');
  });
}

VIEWS.devlock = function(){ return devicesView_('lock'); };

VIEWS.devunlock = function(){ return devicesView_('unlock'); };

function wireDevices(){
  var a = document.getElementById('devEnrolBtn');
  if (a) a.onclick = devEnrolDrawer_;
  var z = document.getElementById('devPickNone');
  if (z) z.onclick = function(){ pickClear_(); paint(true); };
  var b = document.getElementById('devLockMany');
  if (b) b.onclick = function(){ devBulkDrawer_('locked', 'Funga kwa wingi / Lock many', true); };
  var c = document.getElementById('devUnlockMany');
  if (c) c.onclick = function(){ devBulkDrawer_('enrolled', 'Fungua kwa wingi / Unlock many', false); };
  var e = document.getElementById('devReleaseMany');
  if (e) e.onclick = function(){ devBulkDrawer_('released', 'Achia kwa wingi / Release many', false); };
  var f = document.getElementById('devShiftMany');
  /* NOT `f.onclick = devShiftDrawer_`. An onclick handler is called with the click EVENT,
     and devShiftDrawer_'s first argument is "the one IMEI a row button opened it for" --
     so wiring it bare handed the PointerEvent in as that IMEI. The drawer then said
     "1 zimechaguliwa" and the list read "[object PointerEvent]", and the ticks on the
     register were never looked at. Reported from the bench as "still requires to input
     imei on object ... text". */
  if (f) f.onclick = function(){ devShiftDrawer_(); };
}
