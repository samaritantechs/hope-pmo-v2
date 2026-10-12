/* adjust -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/adjust.js?v=BUILD. */

/* ILIYONASIA -- the manual, signed, attributable adjustment. Pick the report date, pick which
   of the four books it belongs to, put a positive amount to add or a negative one to reduce,
   and the register keeps who/when/why forever. The reason the reports can be made right in
   the SYSTEM instead of patched in somebody's Excel. */
/* ALL FOUR BOOKS ARE LIVE. The two arrears ones retired for a while and are back by
   instruction -- "do as expected just manual add or reduce the amount to the customer or team
   as i input!" -- so they are offered and labelled like any other. `targets` still comes from
   the server and the picker is built from it, so if a book is ever withdrawn again the list
   follows without this map being touched. */
var ADJ_TARGET_LABELS = {
  'expected-initial':  'Expected — Initial',
  'expected-current':  'Expected — Current',
  'defaulter-initial': 'Defaulter — Initial',
  'defaulter-current': 'Defaulter — Current',
};

/* What the commission side did with a register row -- the server decides which of these is
   true (see `adjustments` in portal-core.js); this is only the wording. */
var ADJ_COUNT_LABELS = {
  counted:      'Inahesabika / counted',
  superseded:   'Imeondolewa — deki imelipa / auto-removed',
  'no-ref':     'Hakuna REF / no ref',
  unchecked:    'Haikuhakikiwa / unchecked',
  'amount-only': 'Kiasi pekee / amount only',
};

VIEWS.adjust = function(){
  return Promise.all([srv('adjustments', { from: S.args.from || '', to: S.args.to || '' }),
                      srvTeams_().catch(function(){ return { rows: [] }; })]).then(function(r){
    var d = r[0], tm = r[1];
    var tg = d.totals || {};
    /* WHAT THE PICKER MAY OFFER IS THE SERVER'S TO SAY, and once it was not: both selects
       drew all four of ADJ_TARGET_LABELS whatever the server accepted, so a withdrawn book
       sat there looking live. Somebody filled in a date, a team, an amount, a ref and a
       reason, pressed Hifadhi, and only then was told "target must be one of: ..." -- with
       the typing still to do again. `targets` comes back from `adjustments` (ADJ_TARGETS in
       portal-core.js) and this is the list it names, so the picker follows the server rather
       than this file. All four are live today; the fallback below is only for a page talking
       to a server old enough not to send the list at all. */
    var adjLive = (d.targets && d.targets.length) ? d.targets
      : ['expected-initial', 'expected-current', 'defaulter-initial', 'defaulter-current'];
    var adjOptions_ = function(sel){
      return adjLive.map(function(k){
        return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>'
          + esc(ADJ_TARGET_LABELS[k] || k) + '</option>';
      }).join('');
    };
    /* An arrears tile, with what its net does to recovery read off the net's own sign. The
       amount is added to the arrears the deck carries, so a positive net on the MORNING deck
       raises recovery and a positive net on the EVENING deck lowers it. */
    var defKpi_ = function(label, net, book){
      var up = book === 'initial' ? net > 0 : net < 0;
      return kpi(label, money(net),
        !net ? 'jumla / net'
             : (up ? 'urejeshaji hupanda / recovery goes up'
                   : 'urejeshaji hushuka / recovery goes down'),
        !net ? '' : (up ? 'good' : 'bad'));
    };
    HEAD = '<div class="kpis">'
      + kpi('Marekebisho / Adjustments', money((d.rows||[]).length))
      + kpi('Expected — Initial', money(tg['expected-initial'] || 0), 'jumla / net', (tg['expected-initial']||0) < 0 ? 'bad' : '')
      + kpi('Expected — Current', money(tg['expected-current'] || 0), 'jumla / net', (tg['expected-current']||0) < 0 ? 'bad' : '')
      /* WHICH WAY EACH ARREARS BOOK'S NET MOVES RECOVERY. They pull opposite ways -- recovery
         is morning arrears minus evening arrears -- so a net figure without its direction is
         half a fact. And the SIGN of the net decides it: these captions were fixed text until
         a net of minus five hundred thousand sat under one reading "raises recovery". */
      + defKpi_('Defaulter — Initial', tg['defaulter-initial'] || 0, 'initial')
      + defKpi_('Defaulter — Current', tg['defaulter-current'] || 0, 'current')
      + '</div>'
      + (d.ready === false ? '<div class="note bad">' + esc(d.note || '') + '</div>' : '')
      /* THE ONE THING ON THIS TAB THAT NEEDS A PERSON, AT THE TOP.
         "so if autoremoved find a way to flag by anything on the transaction row in iliyonasia
          that alerts what was done"
         A row whose customer the deck has since caught up with is AUTO-REMOVED from the
         commission count -- the deck pays for them now, so counting the register too would pay
         twice. That standing-down used to be invisible. It is a banner here and a chip on the
         row itself, because a figure that changed for a reason nobody can see is the exact
         thing this register exists to stop. */
      + ((d.superseded ? '<div class="note bad" style="padding:6px 10px;font-size:12px;line-height:1.35">'
          + '<b>' + d.superseded + '</b> ' + (d.superseded === 1 ? 'safu imeondolewa' : 'safu zimeondolewa')
          + ' kwenye hesabu ya kamisheni — deki sasa inaonyesha wateja hao WAMELIPA, hivyo deki '
          + 'ndiyo inayolipa. Kiasi bado kinahesabika; safu hizi zinaweza kufutwa. '
          + '/ <b>' + d.superseded + '</b> row' + (d.superseded === 1 ? '' : 's')
          + ' auto-removed from the commission count: the deck now shows those customers PAID, so '
          + 'the deck pays for them. The amount still applies — these rows can be deleted.'
          + '</div>' : ''))
      + ((d.ready !== false && d.deckChecked === false && (d.rows||[]).some(function(x){ return x.ref; }))
          ? '<div class="note" style="padding:6px 10px;font-size:12px">Deki halikuhakikiwa safari hii. '
            + '/ The deck could not be checked this time — the customer flags below are unverified.</div>' : '')
      /* The entry form, on the page rather than behind a drawer: this tab exists to be typed
         into, and the person doing it is entering a dozen corrections off a reconciliation. */
      + '<div class="card"><div class="card-h">Rekebisha / New adjustment'
        + '<span class="sub">chanya huongeza &middot; hasi hupunguza / positive adds &middot; negative reduces</span></div>'
        + '<div class="cleanbox">'
        /* Opens on TODAY -- most corrections are for the report on the desk right now, and a
           date typed for a back-dated one simply overtypes it. */
        + '<div class="fld"><label>Tarehe ya ripoti / Report date</label><input type="date" id="adjDate" value="'+esc(today())+'"></div>'
        + '<div class="fld"><label>Aina ya ripoti / Report type</label><select id="adjTarget">'
          + adjOptions_('')
          + '</select>'
          /* WHICH WAY THIS ROW WILL MOVE THE FIGURES, SAID BEFORE IT IS SAVED. The arrears pair
             pull in opposite directions -- recovery is initial minus current -- and the one
             that pulls DOWN is the one somebody will query afterwards. Better read here, while
             the choice is still being made, than argued about on a Monday. */
          + '<div class="sub" id="adjTargetHint" style="margin-top:4px"></div></div>'
        + '<div class="fld"><label>Timu / Team (hiari / optional)</label><select id="adjTeam">'
          + '<option value="">— kitabu chote / whole book —</option>'
          + (tm.rows||[]).map(function(t){ return '<option>'+esc(t.team)+'</option>'; }).join('')
          + '</select></div>'
        + '<div class="fld"><label>Kiasi / Amount (TZS, + au −)</label><input type="number" id="adjAmt" step="any" placeholder="mf. -250000"></div>'
        /* NOT OPTIONAL -- a row with no ref cannot be attributed to a commission customer, and
           the register says so with a chip on every such row ("no-ref"). The label used to say
           "hiari / optional", which told the person typing the opposite of what the register
           itself does the moment they save without one. Left blank on the arrears pair on
           purpose -- those books pay no per-customer commission, so there is nothing for a ref
           to attribute -- but the field itself is never presented as something to skip. */
        + '<div class="fld"><label>REF ya mteja / Customer ref'
          + '<span class="sub"> — inahitajika ili ihesabike kwenye kamisheni / needed for the commission count</span>'
          + '</label><input id="adjRef"></div>'
        + '<div class="fld" style="grid-column:1/-1"><label>Sababu / Reason</label><input id="adjReason" placeholder="kwa nini inarekebishwa / why this is being adjusted"></div>'
        + '<div class="clact"><button class="btn sm" id="adjSave">Hifadhi / Save</button></div>'
        + '<div id="adjOut" class="note" style="display:none"></div>'
        + '</div></div>'
      + bar('<input type="date" data-arg="from" value="'+esc(S.args.from||'')+'">'
          + '<input type="date" data-arg="to" value="'+esc(S.args.to||'')+'">');
    S.adjRows = d.rows || [];
    S.rows = d.rows || [];
    S.cols = [col('adj_date','Tarehe / Date','date'),
      {key:'target', label:'Ripoti / Report', get:function(r){ return ADJ_TARGET_LABELS[r.target] || r.target; }},
      col('team','Team'),
      {key:'amount', label:'Kiasi / Amount', kind:'money',
       cls:function(r){ return num(r.amount) < 0 ? 'bad' : 'good'; }},
      col('ref','REF'),
      /* WHAT THE COMMISSION SIDE DID WITH THIS ROW. Four states, and each one tells the person
         reading it what to do: counted (nothing), superseded (delete it when tidying), no-ref
         (type the customer number and it starts counting), amount-only (nothing to do). */
      {key:'countState', label:'Kamisheni / Commission', kind:'chip',
       chip:function(r){ return r.countState === 'superseded' ? 'bad'
         : r.countState === 'counted' ? 'ok'
         : r.countState === 'no-ref' ? 'warn' : 'mut'; },
       get:function(r){ return (ADJ_COUNT_LABELS[r.countState] || r.countState || '—')
         /* A row filed while the arrears books were retired is applying again -- flagged
            here because it moves a figure today that it did not move when it was written. */
         /* A row that was already in the register when the arrears books came back moves a
            figure today that it did not move yesterday -- flagged here, explained in the
            drawer. */
         + (r.reopened ? ' · inatumika tena / applying again' : ''); }},
      col('reason','Sababu / Reason'),
      col('created_by','Aliyerekebisha / By'), col('created_at','Lini / When','dt')];
    /* A tap on a row opens it, AND THE WHOLE ROW IS EDITABLE -- "the iliyonasia register rows
       info should be editable". Only the amount used to be, so a row typed against the wrong
       day, the wrong book, the wrong team, or with the customer number left off had to be
       deleted and re-typed: which loses who entered it and when, and leaves the figure it was
       correcting wrong in the meantime. The REF especially, now that a row carrying one counts
       as a collected customer on the commission board -- a missing ref used to be a shrug and
       is now money.

       The drawer also says, in words, what the commission side did with this row: whether it
       is being counted, whether the deck has overtaken it, or what to type to make it count. */
    ONROW = function(r){
      var cs = r.countState || '';
      drawer('<h3>Rekebisho / Adjustment</h3>'
        + '<div class="sub">' + esc(ADJ_TARGET_LABELS[r.target] || r.target) + ' · ' + esc(r.adj_date)
          + (r.team ? ' · ' + esc(r.team) : ' · kitabu chote / whole book') + '</div>'
        + (r.countNote ? '<div class="note ' + (cs === 'superseded' ? 'bad' : cs === 'counted' ? 'good' : '')
            + '" style="padding:6px 10px;font-size:12px;line-height:1.35">' + esc(r.countNote) + '</div>' : '')
        /* AND, ON A ROW THAT LAY DORMANT, WHAT TO CHECK. The list can only fit "inatumika tena";
           the reason it matters -- that a deck may have carried the same payment while this row
           was not applying -- needs the sentence, and here is where somebody opening the row to
           decide its fate will read it. */
        + (r.reopenedNote ? '<div class="note warn"'
            + ' style="padding:6px 10px;font-size:12px;line-height:1.35">' + esc(r.reopenedNote) + '</div>' : '')
        + '<div class="frow"><span>Aliyeweka / By</span>' + esc(r.created_by || '') + '</div>'
        + '<div class="fld" style="margin-top:10px"><label>Tarehe ya ripoti / Report date</label>'
          + '<input type="date" id="adjEditDate" value="' + esc(String(r.adj_date || '').slice(0,10)) + '"></div>'
        /* A ROW ON A RETIRED BOOK STILL NAMES ITS OWN BOOK -- dropping the option would show
           it as Expected — Initial, which it is not. It is offered here and nowhere else, so
           the only way it can be selected is by already being it. Saving it back is refused
           by the server, so the note says the two ways out rather than letting somebody
           press Hifadhi and find out. */
        + '<div class="fld"><label>Aina ya ripoti / Report type</label><select id="adjEditTarget">'
          + (adjLive.indexOf(r.target) < 0
              ? '<option value="' + esc(r.target) + '" selected>'
                + esc(ADJ_TARGET_LABELS[r.target] || r.target) + '</option>'
              : '')
          + adjOptions_(r.target)
          + '</select>'
          + (adjLive.indexOf(r.target) < 0
              ? '<div class="sub" style="margin-top:4px">Kitabu hiki kimestaafu — chagua Expected ili '
                + 'kuhifadhi, au futa safu hii. / This book has retired: pick an Expected book to save '
                + 'this row onto, or delete it.</div>'
              : '')
          + '</div>'
        + '<div class="fld"><label>Timu / Team</label><select id="adjEditTeam">'
          + '<option value="">— kitabu chote / whole book —</option>'
          + (tm.rows||[]).map(function(t){
              return '<option'+(String(t.team)===String(r.team||'')?' selected':'')+'>'+esc(t.team)+'</option>'; }).join('')
          + '</select></div>'
        + '<div class="fld"><label>Kiasi / Amount (TZS, + au −)</label>'
          + '<input type="number" id="adjEditAmt" step="any" value="' + esc(String(num(r.amount))) + '"></div>'
        + '<div class="fld"><label>REF ya mteja / Customer ref'
          + '<span class="sub"> — inahitajika ili ihesabike kwenye kamisheni / needed for the commission count</span>'
          + '</label><input id="adjEditRef" value="' + esc(r.ref || '') + '"></div>'
        + '<div class="fld"><label>Sababu / Reason</label>'
          + '<input id="adjEditReason" value="' + esc(r.reason || '') + '"></div>'
        + '<button class="btn w" id="adjEditSave">Hifadhi mabadiliko / Save changes</button>'
        + '<button class="btn w ghost" id="adjEditDel" style="margin-top:8px">Futa rekebisho / Delete this adjustment</button>');
      $('#adjEditSave').onclick = function(){
        var v = Number($('#adjEditAmt').value);
        if (!isFinite(v) || !v) { toast('Weka kiasi kisicho sifuri. / A non-zero amount is required.', true); return; }
        var dt = String($('#adjEditDate').value || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) { toast('Chagua tarehe. / A date is required.', true); return; }
        /* EVERY FIELD IS SENT, because the drawer shows every field: what is on screen is what
           is saved. The server's absent-means-untouched rule is for callers that send a
           subset; this one deliberately is not. */
        srv('adjustmentAmend', { id: r.id, amount: v, date: dt,
              target: $('#adjEditTarget').value, team: $('#adjEditTeam').value,
              ref: $('#adjEditRef').value, reason: $('#adjEditReason').value })
          .then(function(){ closeDrawer(); toast('Rekebisho limehifadhiwa. / Adjustment saved.'); render({ force: true }); })
          .catch(function(e){ toast(String(e.message || e), true); });
      };
      $('#adjEditDel').onclick = function(){
        if (!confirm('Futa rekebisho hili? / Delete this adjustment?\n\n'
            + (ADJ_TARGET_LABELS[r.target] || r.target) + ' · ' + r.adj_date
            + ' · TZS ' + money(num(r.amount)))) return;
        srv('adjustmentDelete', { id: r.id })
          .then(function(){ closeDrawer(); render({ force: true }); })
          .catch(function(e){ toast(String(e.message || e), true); });
      };
    };
    S.foot = 'Jumla / Net across everything shown: TZS ' + money(d.net || 0)
      + (d.superseded ? ' · ' + d.superseded + ' zimeondolewa kwenye kamisheni / auto-removed from commission' : '')
      + ' · bofya mstari kuhariri au kufuta / tap a row to edit it or delete';
  });
};
