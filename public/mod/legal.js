/* legal -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/legal.js?v=BUILD. */

VIEWS.legal = function(){
  return srv('demandNotices', { device: hcDevice_() }).then(function(d){
    var br = d.brand || {};
    var tick = function(ok){ return ok ? '✓' : '✗'; };
    var lk = function(id, label, val){
      return ' <a href="#" id="'+id+'" data-val="'+esc(val||'')+'">'+label+'</a>';
    };
    HEAD = '<div class="kpis">' + kpi('Notices issued', money(d.count))
      + kpi('Total demanded', money(d.demanded), null, 'bad')
      + kpi('Fines charged', money(d.fines), 'late-payment penalties', 'warnc')
      /* THE QUESTION THE REGISTER EXISTS TO ANSWER: does serving a notice bring money back?
         TWO READINGS, TWO CARDS, KEPT APART -- "all i needed is 1. recovery to have difference
         of arrears at notice and current and rec% and 2. recovered amount since notices":
         RECOVERY is the arrears drop (at notice − current) with its Rec % in front, over what
         the letters chased; RECOVERED is what the customers PAID since the letters (the
         ledger, db/RUN-ME-041), the reading the dashboard card and the slide carry. */
      + kpi('Urejeshaji / Recovery',
            (d.recoveryPct != null ? pct(d.recoveryPct) + ' · ' : '') + money(d.recovery),
            'madeni wakati wa notisi − sasa / arrears at notice − current'
              + (d.owed > 0 ? ' · ya / of TZS ' + money(d.owed) : '')
              + ' · ' + money(d.cleared) + ' wamemaliza / cleared' + (d.asOf ? ' · deki ya ' + esc(d.asOf) : ''),
            d.recovery > 0 ? 'good' : '')
      + (d.paymentsOn ? kpi('Imerejeshwa tangu notisi / Recovered since notice', money(d.paidSince),
            'malipo yaliyopokelewa baada ya notisi / payments received after the notice'
            + (d.paymentsKept ? ' · yamehifadhiwa daima / kept for good' : ''), d.paidSince > 0 ? 'good' : '') : '')
      /* RECOVERED LEO AND THIS WEEK -- "add recovered leo and recovered weekly cards at demand
         notice pannel, clickable to show list of the recoveries as the dashboard recovries are
         clickable". The dashboard legal card's own reading (payments recorded against notices,
         once per customer), with its Rec % in front; a tap opens the customers and payments
         behind the figure (legalRecoveriesDrawer_, wired below with the tab). */
      + (function(){ var lg = d.legal || {};
          var sub = function(n){ return lg.on === false ? (lg.note || 'db/RUN-ME-041 haijaendeshwa / not run yet')
            : n + ' · bofya kuona orodha / tap for the list'; };
          return kpi('Imerejeshwa leo / Recovered today', (lg.tPct != null ? pct(lg.tPct) + ' · ' : '') + money(lg.tRecovered || 0),
              sub('leo ' + esc(lg.today || '') + ' · ' + money(lg.customers || 0) + ' wenye notisi / noticed'), (lg.tRecovered || 0) > 0 ? 'good' : '', 'lgRecT')
            + kpi('Imerejeshwa wiki hii / Recovered this week', (lg.pct != null ? pct(lg.pct) + ' · ' : '') + money(lg.recovered || 0),
              sub(esc(lg.mon || '') + ' → ' + esc(lg.sun || '') + ' · owed TZS ' + money(lg.owed || 0)), (lg.recovered || 0) > 0 ? 'good' : '', 'lgRecW'); })()
      + '</div>'
      + (d.paymentsOn ? '' : '<div class="note">⚠ Malipo baada ya notisi hayajasomwa bado: endesha db/RUN-ME-040, kisha RUN-ME-041a na 041b, kwenye SQL editor.'
          + ' / Payments made after a notice are not read yet: run db/RUN-ME-040, then RUN-ME-041a and 041b, in the SQL editor.'
          + ' Until then only Recovery (how far the arrears fell) shows.</div>')
      /* RUN-ME-040's reading is live off a book that is pruned to two weeks -- "remember
         received autodeletes so i dont know how we'll forever record notice recoverey" -- so a
         payment it showed last month reads as nothing this month, and it matches by a REF NO
         the book does not carry. RUN-ME-041 records each payment for good and matches by the
         customer's phone; until it is run, the tab says so rather than show a smaller figure
         as if it were the truth. */
      + (d.paymentsOn && d.paymentsKept === false ? '<div class="note">⚠ Malipo yanasomwa moja kwa moja kutoka kitabu cha wiki mbili, hayahifadhiwi bado wala hayatafutwi kwa simu: endesha db/RUN-ME-041a kisha 041b.'
          + ' / Payments are read live off the two-week book and are NOT kept yet, nor matched by phone: run db/RUN-ME-041a then 041b in the SQL editor.</div>' : '')
      + '<div class="note">Faini huanza wiki <b>2</b> baada ya rejesho la kwanza kukosekana · '
      + 'mikopo ya 2024 na kabla <b>2%</b>, baadaye <b>5%</b> kwa kila rejesho lililochelewa.'
      + ' / The fine starts two weeks after the first missed installment; 2% for loans disbursed'
      + ' in 2024 or earlier, 5% after that.</div>'
      /* THE NUMBER ON YOUR LETTERS -- "Legal phone is not from what i set but their login
         phone" / "the one used at current login". It is the printing officer's own: the HOPE
         Calls registration on the handset this is open on first, else the one under their
         code's name. Said per person WITH ITS SOURCE, so a lawyer printing from a computer that
         has never opened HOPE Calls, or registered under another name, finds out here. */
      + (br.mine
          ? '<div class="note">Simu yako kwenye barua / Your number on letters: <b>' + esc(br.mine) + '</b> ('
            + (br.mineFrom === 'device' ? 'HOPE Calls kwenye simu hii / on this handset' : 'HOPE Calls, kwa jina / by name')
            + (br.mineName ? ': ' + esc(br.mineName) : '') + ').</div>'
          : '<div class="note">⚠ Hakuna namba yako: simu hii haina usajili wa HOPE Calls, na hakuna usajili kwa jina <b>' + esc(br.me || '') + '</b>.'
            + ' Fungua mfumo kutoka simu uliyosajili HOPE Calls, au jisajili HOPE Calls kwa msimbo wako; hadi hapo barua zitaonyesha ' + esc(br.phone || '') + '.'
            + ' / No number of yours on file: this device has no HOPE Calls registration, and none is under the name <b>' + esc(br.me || '') + '</b>.'
            + ' Open the system from the phone you registered HOPE Calls on, or register HOPE Calls with your access code; until then letters show ' + esc(br.phone || '') + '.</div>')
      /* THE LETTERHEAD, SAID ON THE SCREEN. The letter prints the logo, the stamp twice and
         the signature from Settings, and one printed without its stamp is printed again in
         front of a customer. Everyone sees which are in place; an admin sets each from here. */
      + '<div class="note">Barua / Letter: nembo / logo ' + tick(br.logo) + ' · muhuri / stamp ' + tick(br.stamp)
      + ' · sahihi / signature ' + tick(br.sign)
      + ' · anayesaini / signs <b>' + esc(br.signatory || '') + '</b>, ' + esc(br.title || '')
      + ' · simu ikiwa afisa hana yake / phone when the officer has none: ' + esc(br.phone || '')
      + (S.me.role === 'ADMIN' ? ' —' + lk('lgLogo', 'weka nembo / set logo') + ' ·' + lk('lgStamp', 'muhuri / stamp')
          + ' ·' + lk('lgSign', 'sahihi / signature') + ' ·' + lk('lgWho', 'anayesaini / signatory', br.signatory)
          + ' ·' + lk('lgTitle', 'cheo / title', br.title) + ' ·' + lk('lgPhone', 'simu / phone', br.phone) : '')
      + '</div>'
      /* "haina muhuri wa kampuni": the letter prints whatever Settings hold, and a missing
         stamp is a ✗ in the line above that nobody reads. Said in its own line, by name. */
      + (br.logo && br.stamp && br.sign ? '' : '<div class="note">⚠ Barua itatoka BILA '
          + [br.logo ? '' : 'nembo / logo', br.stamp ? '' : 'muhuri wa kampuni / company stamp', br.sign ? '' : 'sahihi / signature'].filter(Boolean).join(', ')
          + '. Admin: weka kupitia viungo hapo juu. / The letter prints WITHOUT it until an admin sets it through the links above.</div>')
      + bar('<button class="btn sm" id="newNotice">+ Notisi mpya / New demand notice</button>'
        + '<span style="font-size:12px;color:var(--mut)">Bofya mstari kuona maelezo ya notisi na kupakua PDF yake. / Tap a row for the notice\'s details and to download its PDF.</span>');
    S.rows = d.rows;
    S.cols = [col('notice_id','Kumb.Na. / Ref'), col('notice_date','Notice date','date'),
      col('ref','REF#'), col('full_name','Customer'), col('branch','Branch'), col('team','Team'),
      {key:'contact', label:'Contact', kind:'tel'}, col('notice_days','Days','num'),
      col('paid_count','Paid','num'),
      // "At notice" rather than "Arrears": the point of the next columns is that this one is a
      // figure from the PAST, and a heading that does not say so invites somebody to read it
      // as what the customer owes today.
      col('arrears_at_notice','At notice','money'),
      col('arrears_now','Current','money'),
      // RECOVERY: at notice − current, and its Rec % -- the arrears reading, nothing blended in.
      {key:'arrears_down', label:'Recovery (at notice − current)', kind:'money', cls:function(r){ return r.arrears_down > 0 ? 'good' : ''; }},
      {key:'rec_pct', label:'Rec %', kind:'pct', from:['arrears_down','arrears_at_notice']},
      /* RECOVERED SINCE NOTICE: the payments book from the notice date forward -- how much, how
         many, the last one. A dash across the column means the function is not there yet
         (the note above). */
      {key:'paid_since', label:'Recovered since notice', kind:'money', cls:function(r){ return r.paid_since > 0 ? 'good' : ''; }},
      col('paid_n','Payments','num'),
      // How many of them the book could only tie to this customer by PHONE (RUN-ME-041): the
      // ordinary case, since the book's REF NO is not the deck's REF#. A dash until it is run.
      col('paid_n_phone','By phone','num'), col('last_paid','Last paid','date'),
      {key:'notice_state', label:'Status', kind:'chip', chip:function(r){
        var k = String(r.notice_state||'');
        return k.indexOf('Cleared')>=0 ? 'ok' : k.indexOf('Paying')>=0 ? 'ok' : k.indexOf('Reducing')>=0 ? 'warn'
             : k.indexOf('No movement')>=0 ? 'bad' : 'mut'; }},
      {key:'fine', label:'Fine', kind:'money', cls:function(){ return 'bad'; }},
      col('principal_remaining','Principal left','money'),
      {key:'total_demand', label:'Total demand', kind:'money', cls:function(){ return 'bad'; }},
      col('issued_by','Issued by')];
    /* "demand retrival": a row is the letter it was printed from -- the same one again, off
       the register (db/RUN-ME-040), with the company's current images. */
    /* A ROW IS A NOTICE, AND A TAP OPENS IT -- "When demand row clicked, shouldnt open the doc
       but put show details pane and print as an option". Everything the register knows about
       the notice first; the print is a button on the pane, so a touch on a phone no longer
       fires the print dialog before anybody has read what they tapped. */
    ONROW = function(r){ lgDetails(r); };
    S.foot = 'Demanded: TZS '+money(d.demanded)+' · of which fines: TZS '+money(d.fines)
      + (d.paymentsOn ? ' · paid since notice: TZS '+money(d.paidSince) : '');
  });
};

function lgIssue(){
  drawer('<h3>Notisi mpya / New demand notice</h3>'
    + '<div class="sub">Tafuta mteja kwa REF#, jina au namba ya simu. / Find the customer by REF#, name or phone number.</div>'
    + '<div class="fld"><label>REF#, jina au simu / REF#, name or phone</label><input id="lgQ" placeholder="mf. 2205489976 · ASHA JUMA · 0714..."></div>'
    + '<div class="fld"><label>Tarehe ya notisi / Notice date</label><input id="lgDate" type="date" value="'+today()+'"></div>'
    + '<button class="btn w" id="lgLoad">Tafuta / Search</button>'
    + '<div id="lgHits"></div>'
    + '<div id="lgPrev"></div>');
  var preview = function(ref){
    srv('legalPreview', { ref:ref, noticeDate:$('#lgDate').value }).then(function(e){
      if (!e.found){ toast('Hakuna mdaiwa mwenye REF# hiyo. / No defaulter with that REF#.', true); return; }
      /* ALREADY SERVED TODAY. The register showed one customer served six times on one day:
         the officer pressed Issue again each time the print did not appear. The reprint is
         offered first; a second letter is still possible, but it is now a decision. */
      var dup = e.servedToday || [], old = (e.served || []).filter(function(s){ return dup.indexOf(s) < 0; });
      $('#lgPrev').innerHTML =
        (dup.length ? '<div class="note">⚠ Ameshapewa notisi leo: <b>'+esc(dup.map(function(s){ return s.noticeId; }).join(', '))+'</b>.'
            + ' Pakua ile ile badala ya kutoa nyingine. / Already served today — download that one rather than issue another.'
            + ' <a href="#" id="lgReprint">Pakua tena / Download again</a></div>' : '')
        + (old.length ? '<div class="sub">Notisi za awali / Earlier notices: '+esc(old.map(function(s){ return s.noticeId+' ('+s.date+')'; }).join(', '))+'</div>' : '')
        + '<div class="facts"><div class="frow"><span>Customer</span><b>'+esc(e.full_name||'')+'</b></div>'
        + '<div class="frow"><span>Team</span><span>'+esc(e.team||'')+'</span></div>'
        + '<div class="frow"><span>Simu / Phone</span><span>'+esc(e.contact||'—')+'</span></div>'
        + '<div class="frow"><span>Disbursed → expiry</span><span>'
          + esc(String(e.disb_date||'—').slice(0,10))+' → '+esc(String(e.expire_date||'—').slice(0,10))+'</span></div>'
        /* THE DC, AND WHETHER IT ALLOWS A LETTER -- "a demand notice cant be generated for an
           expected/defaulter not from 2 DC and above". The server (legalPreview) decides; the
           screen says it and withholds the button below LEGAL_MIN_DC. */
        + '<div class="frow"><span>DC (marejesho yaliyokosekana / missed)</span><b class="'+(e.eligible ? 'good' : 'bad')+'">'
          + esc(String(e.dc == null ? '—' : e.dc))+'</b></div></div>'
        + (e.eligible ? '' : '<div class="note bad">⛔ Notisi hutolewa kwa mdaiwa wa DC <b>'+esc(String(e.minDc))+'</b> na zaidi tu; huyu ana DC <b>'+esc(String(e.dc))+'</b>.'
            + ' / A demand notice is issued only to a customer at <b>'+esc(String(e.minDc))+'</b> DC and above — this one is at <b>'+esc(String(e.dc))+'</b>.</div>')
        + '<div class="kpis sm">'
        + kpi('DS (default summary)', esc(e.ds || '—'))
        + kpi('Wiki za faini / Weeks late', (e.weeks||0)+' ('+e.ratePct+'%)')
        + kpi('Faini / Fine', money(e.fine), null, e.fine?'bad':'good')
        + kpi('Deni la msingi', money(e.principalRemaining))
        + kpi('Jumla ya madai / Total demand', money(e.totalDemand), null, 'bad')
        + '</div>'
        + '<div class="fld"><label>Siku za notisi / Notice days</label><input id="lgDays" type="number" min="1" value="7"></div>'
        + '<div class="fld"><label>Mdhamini / Guarantor</label><input id="lgG" value="'+esc(e.guarantor||'')+'"></div>'
        + '<div class="fld"><label>Simu ya mdhamini / Guarantor phone</label><input id="lgGC" value="'+esc(e.guarantor_contact||'')+'"></div>'
        // No button below the DC: the letter cannot be generated, and the note above says why.
        /* "Button on demands notices must be download not print": the letter is made into a PDF
           file on this device (noticePdf_) and saved -- in the app to Downloads, in a browser as
           a download -- named after the customer. No print dialog anywhere. */
        + (e.eligible ? '<button class="btn w" id="lgGo">Toa notisi &amp; pakua PDF / Issue &amp; download PDF</button>'
        + '<div class="sub">Faili huitwa jina la mteja na kuhifadhiwa Downloads. / The file is named after the customer and saved to Downloads.</div>' : '');
      if (dup.length) $('#lgReprint').onclick = function(ev){ ev.preventDefault(); lgDownload(dup[0].id); };
      if (e.eligible) $('#lgGo').onclick = function(){
        srv('addDemandNotice', { ref:e.ref, noticeDate:$('#lgDate').value, noticeDays:$('#lgDays').value,
          guarantorName:$('#lgG').value.trim(), guarantorContact:$('#lgGC').value.trim(), device: hcDevice_() })
          .then(function(r){
            toast('Notisi '+r.noticeId+' imetolewa. Inatengeneza PDF\u2026 / Issued. Making the PDF\u2026');
            noticePdf_(r.html);
            closeDrawer(); render();
          })
          .catch(function(err){ toast(String(err.message||err), true); });
      };
    }).catch(function(err){ toast(String(err.message||err), true); });
  };
  var search = function(){
    var q = $('#lgQ').value.trim();
    if (q.length < 3){ toast('Andika angalau herufi 3. / Type at least 3 characters.', true); return; }
    $('#lgPrev').innerHTML = ''; $('#lgHits').innerHTML = '';
    srv('legalFind', { q:q }).then(function(f){
      if (!f.rows.length){
        if (/^\d{6,}$/.test(q)) return preview(q);
        $('#lgHits').innerHTML = '<div class="note">Hakuna mdaiwa anayelingana. / No defaulter matches that — check the spelling, or whether their deck has been uploaded.</div>';
        return;
      }
      if (f.rows.length === 1) return preview(f.rows[0].ref);
      $('#lgHits').innerHTML = '<div class="sub">Chagua mteja / Pick the customer'
        + (f.capped ? ' (orodha imekatwa — andika zaidi / list cut short — type more)' : '') + '</div><div class="facts">'
        + f.rows.map(function(r, i){
          // The DC on every line, red below the rule, so the officer sees who cannot be served before a tap.
          var low = f.minDc != null && (r.dc == null || r.dc < f.minDc);
          return '<div class="frow lgHit" data-i="'+i+'" style="cursor:pointer"><span><b>'+esc(r.name)+'</b><br>'
            + '<small>'+esc(r.ref)+' · '+esc(r.contact||'—')+' · '+esc(r.team)
            + ' · <b class="'+(low ? 'bad' : 'good')+'">DC '+esc(String(r.dc == null ? '—' : r.dc))+'</b></small></span><span>'+money(r.arrears)+'</span></div>';
        }).join('') + '</div>';
      Array.prototype.forEach.call(document.querySelectorAll('.lgHit'), function(el){
        el.onclick = function(){ $('#lgHits').innerHTML = ''; preview(f.rows[+el.getAttribute('data-i')].ref); };
      });
    }).catch(function(err){ toast(String(err.message||err), true); });
  };
  $('#lgLoad').onclick = search;
  $('#lgQ').onkeydown = function(ev){ if (ev.key === 'Enter') search(); };
}

/* "demand retrival": the SAME letter again, off the register row (db/RUN-ME-040), with the
   company's current images -- as a PDF file, never a print dialog. */
function lgDownload(id){
  return srv('demandNoticePrint', { id: id, device: hcDevice_() }).then(function(p){
    if (p.rebuilt) toast('Notisi ya zamani: barua imejengwa upya kutoka deki ya sasa. / Issued before letters were kept: rebuilt from today\'s deck.');
    return noticePdf_(p.html);
  }).catch(function(err){ toast(String(err.message||err), true); });
}

/* =====================================================================================
   THE LETTER AS A FILE -- "Button on demands notices must be download not print".

   The letter is ONE definition (demandNoticeHtml, portal-core.js): the HTML the legal officer
   has tuned to exactly two pages. A PDF of it is made HERE, on the device, from that same HTML:
   the letter is laid out in a hidden frame at its print width, each of its two pages is drawn to
   a bitmap (html2canvas) and placed on an A4 sheet inside the letter's own margins (jsPDF), and
   the file -- named after the customer, as the print dialog named it -- goes through download():
   into Downloads inside the HOPE Calls app, as a download in a browser. No print dialog, so a
   phone and a computer get the same file.

   The two libraries (about 550 KB together) are fetched from cdnjs the FIRST time a letter is
   downloaded in a session, the way the upload page fetches its spreadsheet reader -- never at
   portal open, never by anybody who does not press the button. No connection: said plainly.

   The first page is fitted the way the print fit (hopeFit) fits it: measured, and scaled down
   just enough to sit within the sheet, so the costs table never leaves page one. An image the
   browser could not read (a logo or stamp on a host that refuses cross-site reads) is left out
   and NAMED in the toast rather than silently missing from a letter with the company's name on
   it. The pages are bitmaps at twice screen resolution: crisp on paper, not searchable text. */
var PDF_LIBS = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
};
var PDF_MM = { w: 210, h: 297, top: 15, side: 18, bottom: 18, firstMax: 243 };   // A4 and the letter's own @page margins; hopeFit's limit
function pdfLib_(key, test){
  if (test()) return Promise.resolve();
  return new Promise(function(res, rej){
    var sc = document.createElement('script');
    sc.src = PDF_LIBS[key]; sc.async = true;
    sc.onload = function(){ test() ? res() : rej(new Error(key)); };
    sc.onerror = function(){ if (sc.parentNode) sc.parentNode.removeChild(sc); rej(new Error(key)); };
    document.head.appendChild(sc);
  });
}
function pdfLibs_(){
  return Promise.all([
    pdfLib_('html2canvas', function(){ return typeof window.html2canvas === 'function'; }),
    pdfLib_('jspdf', function(){ return !!(window.jspdf && window.jspdf.jsPDF); })
  ]).catch(function(){
    throw new Error('Vifaa vya PDF havikupakia (cdnjs). Angalia mtandao kisha jaribu tena. / The PDF tools did not load (cdnjs). Check the connection and try again.');
  });
}
function noticePdf_(html){
  var tm = /<title>([^<]*)<\/title>/i.exec(html || '');
  var title = (tm ? tm[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim() : '') || 'notisi';
  var name = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + '.pdf';
  var f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  // Off screen but laid out: a hidden (display:none) frame has no sizes to measure.
  f.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1400px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(f);
  var done = function(){ if (f.parentNode) f.parentNode.removeChild(f); };
  return pdfLibs_().then(function(){
    var doc = f.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    return new Promise(function(res){ if (doc.readyState === 'complete') res(); else f.contentWindow.addEventListener('load', res); });
  }).then(function(){
    var doc = f.contentWindow.document;
    // Every image in, or given up on -- a letter drawn before its stamp arrived has no stamp.
    var imgs = Array.prototype.slice.call(doc.images);
    return Promise.all(imgs.map(function(im){
      im.setAttribute('crossorigin', 'anonymous');            // ask for a readable copy; the server's answer decides
      if (im.complete) return null;
      return new Promise(function(res){ im.onload = res; im.onerror = res; setTimeout(res, 8000); });
    })).then(function(){ return doc; });
  }).then(function(doc){
    var missing = Array.prototype.filter.call(doc.images, function(im){ return !(im.complete && im.naturalWidth > 0); })
      .map(function(im){ return im.getAttribute('alt') || 'picha / image'; });
    var fp = doc.querySelector('.first-page');
    var brk = doc.querySelector('.page-break-before');
    if (!fp || !brk) throw new Error('Barua haina kurasa mbili zinazotambulika. / The letter\'s two pages could not be found.');
    // The print fit scales the first page with CSS; here the bitmap is scaled instead, so undo it.
    fp.style.zoom = ''; fp.style.transform = ''; fp.style.height = '';
    // Page two is everything after the break, gathered into one box so it can be drawn as one.
    var p2 = doc.createElement('div'); p2.className = 'second-page';
    var n = brk.nextSibling;
    while (n) { var nx = n.nextSibling; if (n.nodeType === 1 && n.tagName === 'SCRIPT') { n = nx; continue; } p2.appendChild(n); n = nx; }
    brk.parentNode.insertBefore(p2, brk.nextSibling);
    var h2c = f.contentWindow.html2canvas || window.html2canvas;
    var opts = { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: 900 };
    return h2c(fp, opts).then(function(c1){
      return h2c(p2, opts).then(function(c2){ return { c1: c1, c2: c2, missing: missing }; });
    });
  }).then(function(r){
    var JsPDF = window.jspdf.jsPDF;
    var pdf = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    var innerW = PDF_MM.w - 2 * PDF_MM.side, innerH = PDF_MM.h - PDF_MM.top - PDF_MM.bottom;
    var place = function(canvas, maxH){
      var wmm = innerW, hmm = canvas.height * wmm / canvas.width;
      if (hmm > maxH) { var s = maxH / hmm; hmm = maxH; wmm = wmm * s; }   // the first page's own fit, as a scale
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', PDF_MM.side, PDF_MM.top, wmm, hmm);
    };
    place(r.c1, Math.min(PDF_MM.firstMax, innerH));
    pdf.addPage();
    place(r.c2, innerH);
    pdf.setProperties({ title: title });
    download(pdf.output('blob'), name);
    if (r.missing.length) toast('⚠ Barua imetoka bila: ' + r.missing.join(', ') + '. / The letter came out without: ' + r.missing.join(', ') + '.', true);
    done();
    return name;
  }).catch(function(e){ done(); toast(String(e && e.message || e), true); throw e; });
}

/* THE DETAILS PANE -- "When demand row clicked, shouldnt open the doc but put show details pane
   and print as an option". Everything the register row carries, read in two columns: the
   notice as served (reference, dates, days, the demand and its parts) and what has happened
   since (arrears now, paid since, payments and how they were matched, recovered, status).
   Download PDF is the button at the bottom. */
function lgDetails(r){
  var row = function(k, v, strong){
    return '<div class="frow"><span>'+k+'</span>'+(strong ? '<b>'+v+'</b>' : '<span>'+v+'</span>')+'</div>'; };
  /* A timestamp on ITS OWN DAY (East Africa), not the UTC day: a notice issued at 00:30 or
     one imported at "midnight" read as the evening before ("Issued by ... 2026-07-12" for a
     7/13 row). A bare date (2026-07-13) is untouched by the shift. */
  var d = function(v){
    if (!v) return '—';
    var t = Date.parse(String(v));
    return isFinite(t) && /T|\s\d{1,2}:/.test(String(v)) ? esc(new Date(t + 3*3600*1000).toISOString().slice(0,10)) : esc(String(v).slice(0,10));
  };
  var m = function(v){ return v == null ? '—' : money(v); };
  var paidLine = r.paid_since == null ? '— (RUN-ME-041)'
    : money(r.paid_since)
      + (r.paid_n != null ? ' · malipo / payments ' + r.paid_n : '')
      + (r.paid_n_phone != null ? ' (kwa simu / by phone ' + r.paid_n_phone + ')' : '')
      + (r.last_paid ? ' · mwisho / last ' + d(r.last_paid) : '');
  drawer('<h3>'+esc(r.notice_id||'')+'</h3>'
    + '<div class="sub">'+esc(r.full_name||'')+' · REF# '+esc(r.ref||'')+' · '+esc(r.team||'')+(r.branch ? ' ('+esc(r.branch)+')' : '')+'</div>'
    + '<div class="facts">'
    + row('Simu / Contact', esc(r.contact||'—'))
    + row('Tarehe ya notisi / Notice date', d(r.notice_date) + ' · siku / days ' + esc(r.notice_days == null ? '—' : r.notice_days))
    /* DS (DEFAULT SUMMARY): the deck's own "paid of target" for this customer today, in place of
       the paid-of-12 count -- "Replace Marejesho / Paid (of 12) with DS (default summary)". */
    + row('DS (default summary)', esc(r.ds || '—'))
    + row('Faini / Fine', m(r.fine))
    + row('Deni la msingi / Principal left', m(r.principal_remaining))
    + row('Jumla ya madai / Total demand', m(r.total_demand), true)
    + row('Deni wakati wa notisi / At notice', m(r.arrears_at_notice))
    + row('Deni sasa / Current', m(r.arrears_now))
    + row('Limepungua / Arrears down', m(r.arrears_down))
    + row('Kimelipwa tangu notisi / Paid since', paidLine)
    + row('Urejeshaji / Recovery (at notice − current)', m(r.arrears_down) + (r.rec_pct != null ? ' · ' + pct(r.rec_pct) : ''), true)
    + row('Hali / Status', esc(r.notice_state||'—'))
    + row('Imetolewa na / Issued by', esc(r.issued_by||'—') + (r.created_at ? ' · ' + d(r.created_at) : ''))
    + row('Barua / Letter', r.letter_kept ? 'imehifadhiwa na rejista / kept with the register' : 'ya zamani — itajengwa upya kutoka deki ya sasa / old — rebuilt from today\'s deck')
    + '</div>'
    + '<button class="btn w" id="lgDoPrint">Pakua PDF / Download PDF</button>'
    + '<div class="sub">Faili huitwa jina la mteja na kuhifadhiwa Downloads. / The file is named after the customer and saved to Downloads.</div>');
  $('#lgDoPrint').onclick = function(){ var b = $('#lgDoPrint'); b.disabled = true; lgDownload(r.id).then(function(){ b.disabled = false; }, function(){ b.disabled = false; }); };
}
