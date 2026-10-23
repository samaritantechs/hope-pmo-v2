/* fraud -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/fraud.js?v=BUILD. */

/* FRAUD DETECTOR -- "every approved loan with a number or name among customer, guarantor or
   receiver that still exists in an another approved [loan] of the three columns or in the
   current defaults sheet, auto list the case list that will open card details containing
   previous involved loan details vs current. Autosorted newest to oldest."
   The rule lives on the server (fraudCases, api/_lib/fraud.js). This draws the case list,
   newest first, and the card: this loan's parties beside each linked loan's and each defaults
   row's, the matching fields marked. */
var FR_PARTY = { customer: 'mteja / customer', receiver: 'mpokeaji / receiver', guarantor: 'mdhamini / guarantor' };
function frParty_(p){ return FR_PARTY[p] || p; }
function frKind_(k){ return k === 'phone' ? 'namba / number' : 'jina / name'; }
function frWhen_(d){ return d ? esc(String(d).slice(0, 10)) : '—'; }
function frBadge_(l){
  return l.kind === 'phone'
    ? '<span class="chip bad" style="font-size:10px">KWA NAMBA / BY NUMBER</span>'
    : '<span class="chip warn" style="font-size:10px">KWA JINA / BY NAME</span>';
}
/** One line per link, for the list and the card head. */
function frLinkLine_(l){
  var w = l.with || {};
  var where = l.t === 'loan'
    ? 'mkopo REF ' + esc(w.ref || '?') + ' (' + esc(w.name || '') + (w.team ? ' · ' + esc(w.team) : '') + (w.approvedDate ? ' · ' + frWhen_(w.approvedDate) : '') + ')'
    : (l.own ? 'MKOPO WAKE WA AWALI kwenye defaults / THEIR OWN EARLIER LOAN on defaults, REF ' : 'defaults sheet REF ') + esc(w.ref || '?')
      + ' (' + esc(w.name || '') + (w.team ? ' · ' + esc(w.team) : '') + (w.status ? ' · ' + esc(w.status) : '') + (w.dc != null ? ' · DC ' + esc(w.dc) : '') + ')';
  return frParty_(l.mine) + ' <b>' + esc(l.value) + '</b> = ' + frParty_(l.theirs) + ' kwenye / on ' + where;
}
/** The side-by-side table: this loan's parties against the linked row's, matches marked. */
function frCompare_(c, l){
  var w = l.with || {};
  var hit = function(mine, theirs){ return (l.mine === mine && l.theirs === theirs) || (l.mine === theirs && l.theirs === mine); };
  var mark = function(on){ return on ? ' style="background:#fee2e2;font-weight:700"' : ''; };
  var row = function(label, a, b, on){ return '<tr><td class="mut">' + label + '</td><td' + mark(on) + '>' + esc(a == null || a === '' ? '—' : String(a)) + '</td><td' + mark(on) + '>' + esc(b == null || b === '' ? '—' : String(b)) + '</td></tr>'; };
  var isLoan = l.t === 'loan';
  var head = isLoan
    ? 'Mkopo mwingine / Other loan<br><span class="mut" style="font-weight:400">REF ' + esc(w.ref || '') + ' · ' + frWhen_(w.approvedDate) + '</span>'
    : 'Defaults sheet<br><span class="mut" style="font-weight:400">REF ' + esc(w.ref || '') + ' · deki ya / deck of ' + frWhen_(w.deckDate) + '</span>';
  var rows = ''
    + row('Mteja / Customer', c.name, w.name, l.kind === 'name' && hit('customer', 'customer') || (l.kind === 'name' && (l.mine === 'customer' || l.theirs === 'customer') && (l.mine !== l.theirs)))
    + row('Simu ya mteja / Customer phone', c.contact, w.contact, l.kind === 'phone' && (l.mine === 'customer' || l.theirs === 'customer'))
    + (isLoan ? row('MoMo ya mteja / Customer momo', c.momo, w.momo, l.kind === 'phone' && (l.mine === 'customer' || l.theirs === 'customer')) : '')
    + (isLoan ? row('Mpokeaji / Receiver', c.receiver, w.receiver, l.kind === 'name' && (l.mine === 'receiver' || l.theirs === 'receiver')) : row('Mpokeaji (mkopo huu) / Receiver (this loan)', c.receiver, '', l.kind === 'name' && l.mine === 'receiver'))
    + (isLoan ? row('MoMo ya mpokeaji / Receiver momo', c.receiverMomo, w.receiverMomo, l.kind === 'phone' && (l.mine === 'receiver' || l.theirs === 'receiver')) : row('MoMo ya mpokeaji (mkopo huu) / Receiver momo (this loan)', c.receiverMomo, '', l.kind === 'phone' && l.mine === 'receiver'))
    + row('Mdhamini / Guarantor', c.guarantor, w.guarantor, l.kind === 'name' && (l.mine === 'guarantor' || l.theirs === 'guarantor'))
    + row('Simu ya mdhamini / Guarantor phone', c.guarantorContact, w.guarantorContact, l.kind === 'phone' && (l.mine === 'guarantor' || l.theirs === 'guarantor'))
    + row('Timu / Team', c.team, w.team, false)
    + (isLoan
        ? row('Bidhaa / Product', c.product, w.product, false)
          + row('Kiasi / Principal', money(c.principal), money(w.principal), false)
          + row('Imeidhinishwa / Approved', frWhen_(c.approvedDate) + (c.approvedBy ? ' · ' + c.approvedBy : ''), frWhen_(w.approvedDate) + (w.approvedBy ? ' · ' + w.approvedBy : ''), false)
          + row('Imetolewa / Disbursed', frWhen_(c.disbDate), frWhen_(w.disbDate), false)
          + row('Hali / Stage', c.stage, w.stage, false)
          + row('Aliyeandaa / Created by', c.createdBy, w.createdBy, false)
        : row('Hali / Status', c.stage, w.status + (w.dc != null ? ' · DC ' + w.dc : '') + (w.daysElapsed != null ? ' · siku ' + w.daysElapsed : ''), false)
          + row('Madeni / Arrears', '', money(w.arrears), false)
          + row('Salio / Balance', '', money(w.balance), false)
          + row('Imetolewa / Disbursed', frWhen_(c.disbDate), frWhen_(w.disbDate), false));
  return '<div class="card" style="padding:10px;margin:8px 0">'
    + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">' + frBadge_(l)
    + (l.own ? '<span class="chip bad" style="font-size:10px">MKOPO WAKE WA AWALI / OWN EARLIER LOAN</span>' : '')
    + '<span style="font-size:12px">' + frLinkLine_(l) + '</span></div>'
    + '<div class="scroll"><table><thead><tr><th></th><th>Mkopo huu / This loan<br><span class="mut" style="font-weight:400">REF ' + esc(c.ref || '') + ' · ' + frWhen_(c.approvedDate) + '</span></th><th>' + head + '</th></tr></thead><tbody>'
    + rows + '</tbody></table></div></div>';
}
function frCard_(c){
  var html = '<h3 style="margin:0 0 2px">Kesi / Case · ' + esc(c.name || '') + '</h3>'
    + '<div class="hint" style="margin-bottom:8px">REF ' + esc(c.ref || '') + (c.docket ? ' · docket ' + esc(c.docket) : '') + ' · ' + esc(c.team || '')
    + ' · ' + esc(c.product || '') + ' · TZS ' + money(c.principal) + ' · imeidhinishwa / approved ' + frWhen_(c.approvedDate)
    + (c.approvedBy ? ' na / by ' + esc(c.approvedBy) : '') + (c.createdBy ? ' · imeandaliwa na / created by ' + esc(c.createdBy) : '') + '</div>'
    + '<div class="note" style="margin-bottom:8px"><b>' + money(c.nLinks) + ' viungo / links</b> · ' + money(c.nLoans) + ' mikopo mingine / other loans · '
    + money(c.nDefaults) + ' kwenye defaults / on the defaults sheet'
    + (c.more ? ' · ' + money(c.more) + ' hazijaonyeshwa / not shown' : '') + '</div>'
    + (c.links || []).map(function(l){ return frCompare_(c, l); }).join('');
  drawer(html, { wide: true });
}
function frChipCls_(r){ return r.strong ? 'bad' : 'warn'; }
function frChipText_(r){ return r.strong ? 'KWA NAMBA / NUMBER' : 'KWA JINA / NAME'; }

/* THE CONTROLS ON TOP -- "have the sorts on top by team by type etc". The cases are already on
   the page (one read, kept a minute on the server), so every pick here is a repaint, not a
   request: team, the officer who prepared the loan, strength, the kind of link, and the order.
   The counters follow the pick, with "x / N" saying how much of the book is on screen. */
var FR = { cases: [], meta: {}, team: '', officer: '', strength: '', kind: '', sort: 'new', q: '' };
function frSet_(k, v){ FR[k] = v; frDraw_(); paint(true); }
function frReset_(){ FR.team = ''; FR.officer = ''; FR.strength = ''; FR.kind = ''; FR.sort = 'new'; frDraw_(); paint(true); }
function frFiltered_(){
  return FR.cases.filter(function(c){
    if (FR.team && (c.team || '') !== FR.team) return false;
    if (FR.officer && (c.createdBy || '') !== FR.officer) return false;
    if (FR.strength === 'phone' && !c.strong) return false;
    if (FR.strength === 'name' && c.strong) return false;
    if (FR.kind === 'loan' && !c.nLoans) return false;
    if (FR.kind === 'def' && !c.nDefaults) return false;
    if (FR.kind === 'own' && !c.ownDefault) return false;
    return true;
  });
}
function frSorted_(list){
  var when = function(c){ return String(c.approvedDate || '') + '|' + String(c.createdAt || ''); };
  var newest = function(a, b){ return when(a) > when(b) ? -1 : when(a) < when(b) ? 1 : 0; };
  var out = list.slice();
  if (FR.sort === 'old') out.sort(function(a, b){ return -newest(a, b); });
  else if (FR.sort === 'team') out.sort(function(a, b){ return String(a.team || '').localeCompare(String(b.team || '')) || newest(a, b); });
  else if (FR.sort === 'officer') out.sort(function(a, b){ return String(a.createdBy || '').localeCompare(String(b.createdBy || '')) || newest(a, b); });
  else if (FR.sort === 'amount') out.sort(function(a, b){ return (b.principal || 0) - (a.principal || 0) || newest(a, b); });
  else if (FR.sort === 'links') out.sort(function(a, b){ return (b.nLinks || 0) - (a.nLinks || 0) || newest(a, b); });
  else out.sort(newest);
  return out;
}
function frCounts_(key){
  var m = {};
  FR.cases.forEach(function(c){ var k = c[key] || ''; if (k) m[k] = (m[k] || 0) + 1; });
  return Object.keys(m).sort().map(function(k){ return { k: k, n: m[k] }; });
}
function frSelect_(key, label, allLabel, opts){
  return '<div class="fld" style="min-width:150px"><label>' + label + '</label><select onchange="frSet_(\'' + key + '\', this.value)">'
    + '<option value="">' + allLabel + '</option>'
    + opts.map(function(o){ return '<option value="' + esc(o.v) + '"' + (FR[key] === o.v ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join('')
    + '</select></div>';
}
function frDraw_(){
  var d = FR.meta, scanned = d.scanned || {}, deck = d.deck || {};
  var shown = frSorted_(frFiltered_());
  var strong = shown.filter(function(c){ return c.strong; }).length;
  var ownDef = shown.filter(function(c){ return c.ownDefault; }).length;
  var picked = !!(FR.team || FR.officer || FR.strength || FR.kind);
  HEAD = '<div class="kpis">'
    + kpi('Kesi / Cases', money(shown.length) + (picked ? ' <span class="mut" style="font-size:12px">/ ' + money(FR.cases.length) + '</span>' : ''), 'mikopo iliyoidhinishwa yenye kiungo / approved loans with a link', shown.length ? 'bad' : 'good')
    + kpi('Kwa namba / By number', money(strong), 'namba ya simu inayorudia / a phone number that recurs', strong ? 'bad' : '')
    + kpi('Kwa jina tu / By name only', money(shown.length - strong), 'jina linalorudia, bila namba / a name that recurs, no number', '')
    + kpi('Wana deni la awali / Own earlier loan in default', money(ownDef), 'wameidhinishwa wakiwa na mkopo kwenye defaults / approved while their earlier loan is on the sheet', ownDef ? 'bad' : '')
    + kpi('Mikopo iliyopitiwa / Loans scanned', money(scanned.loans || 0), (d.stages || []).join(', '))
    + kpi('Defaults sheet', money(scanned.defaults || 0), deck.date ? 'deki ya / deck of ' + esc(deck.date) : 'hakuna deki ya sasa / no current deck', deck.date ? '' : 'warn')
    + '</div>'
    + '<div class="card" style="padding:10px;margin:8px 0"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">'
    + frSelect_('team', 'Timu / Team', 'Zote / All (' + money(FR.cases.length) + ')', frCounts_('team').map(function(o){ return { v: o.k, t: o.k + ' (' + o.n + ')' }; }))
    + frSelect_('officer', 'Aliyeandaa / Created by', 'Wote / All', frCounts_('createdBy').map(function(o){ return { v: o.k, t: o.k + ' (' + o.n + ')' }; }))
    + frSelect_('strength', 'Nguvu / Strength', 'Zote / All', [{ v: 'phone', t: 'Kwa namba / By number' }, { v: 'name', t: 'Kwa jina tu / By name only' }])
    + frSelect_('kind', 'Aina ya kiungo / Link kind', 'Zote / All', [{ v: 'loan', t: 'Mkopo mwingine / Other loan' }, { v: 'def', t: 'Defaults sheet' }, { v: 'own', t: 'Mkopo wake wa awali / Own earlier loan' }])
    + frSelect_('sort', 'Panga / Sort', 'Mpya kwanza / Newest first', [{ v: 'old', t: 'Za zamani kwanza / Oldest first' }, { v: 'team', t: 'Timu / Team' }, { v: 'officer', t: 'Aliyeandaa / Created by' }, { v: 'amount', t: 'Kiasi kikubwa / Largest first' }, { v: 'links', t: 'Viungo vingi / Most links' }])
    + '<button class="btn sm ghost" onclick="frReset_()">Futa vichujio / Clear</button>'
    + '<span class="mut" style="font-size:11.5px">Zinaonyeshwa / Showing <b>' + money(shown.length) + '</b> / ' + money(FR.cases.length) + '</span>'
    + '</div>'
    /* THE LOOK-UP BEFORE APPROVAL -- "the search in here will help credit analysts to search a
       number among the list before approval - but return active customer even if not in the
       list - for search character only". Against the whole book (fraudFind), not the cases on
       the page; the answer opens in the drawer (frFindDrawer_). */
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end;margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb">'
    + '<div class="fld" style="flex:1;min-width:230px"><label>Angalia kabla ya idhini / Check before approval — namba au jina / a number or a name</label>'
    + '<input id="frQ" value="' + esc(FR.q || '') + '" placeholder="0712… au / or JINA" onkeydown="if (event.key === \'Enter\') frFind_()"></div>'
    + '<button class="btn sm" onclick="frFind_()">Tafuta kwenye kitabu chote / Search the whole book</button>'
    + '<span class="mut" style="font-size:11px">mikopo yote iliyoidhinishwa na defaults sheet, si kesi tu / every approved loan and the defaults sheet, not only the cases</span>'
    + '</div></div>'
    + '<div class="note">Kanuni / The rule: mkopo ulioidhinishwa huwa <b>kesi</b> ikiwa jina au namba ya <b>mteja, mpokeaji au mdhamini</b> wake inaonekana kwenye mkopo mwingine ulioidhinishwa wa mteja mwingine (safu yoyote kati ya tatu), au kwenye <b>defaults sheet ya sasa</b> (mteja mwingine, au mkopo wake wa awali ambao bado una deni). Mikopo ya awali ya mteja huyo huyo si kiungo. Namba = kiungo imara; jina pekee = dhaifu (majina ya neno moja hayalinganishwi). '
    + '/ An approved loan is a <b>case</b> when a name or number of its <b>customer, receiver or guarantor</b> appears on another customer\'s approved loan (any of the three columns), or on the <b>current defaults sheet</b> (another customer, or this customer\'s own earlier loan still owing). A customer\'s own earlier loans are not a link. A number is a strong link; a name alone is weak (one-word names are not compared).'
    + (d.scope && d.scope.length ? ' <b>Upeo / Scope:</b> timu zako tu, pande zote mbili / your teams only, on both sides (' + esc(d.scope.join(', ')) + ').' : '')
    + '</div>';
  S.rows = shown.map(function(c){
    return {
      approvedDate: c.approvedDate, ref: c.ref, name: c.name, team: c.team, createdBy: c.createdBy || '', receiver: c.receiver || '', guarantor: c.guarantor || '',
      links: money(c.nLinks) + ' · ' + (c.links || []).slice(0, 2).map(function(l){
        return frParty_(l.mine).split(' / ')[0] + ' ' + l.value + ' = ' + frParty_(l.theirs).split(' / ')[0] + ' ' + (l.t === 'loan' ? 'REF ' + (l.with.ref || '') : 'defaults ' + (l.with.ref || '')) + (l.own ? ' (wake)' : '');
      }).join('; ') + (c.nLinks > 2 ? '; …' : ''),
      strong: c.strong, ownDefault: c.ownDefault, principal: c.principal, _case: c,
    };
  });
  S.cols = [col('approvedDate', 'Imeidhinishwa / Approved', 'date'), col('ref', 'REF'), col('name', 'Mteja / Customer'), col('team', 'Timu / Team'),
    col('createdBy', 'Aliyeandaa / Created by'), col('receiver', 'Mpokeaji / Receiver'), col('guarantor', 'Mdhamini / Guarantor'),
    { key: 'principal', label: 'Kiasi / Principal', kind: 'money' },
    col('links', 'Viungo / Links'),
    { key: 'strong', label: 'Nguvu / Strength', kind: 'chip', chip: frChipCls_, get: frChipText_ }];
  ONROW = function(r){ frCard_(r._case); };
}

function frFind_(){
  var box = document.getElementById('frQ'), q = box ? String(box.value || '').trim() : '';
  if (q.length < 3) { toast('Andika angalau herufi au tarakimu 3. / Type at least 3 letters or digits.', true); if (box) box.focus(); return; }
  FR.q = q;
  var btn = document.querySelector('button[onclick="frFind_()"]'); if (btn) btn.disabled = true;
  srv('fraudFind', { q: q }).then(function(d){ if (btn) btn.disabled = false; frFindDrawer_(d); })
    .catch(function(e){ if (btn) btn.disabled = false; toast(String(e.message || e), true); });
}
function frFindDrawer_(d){
  var hits = d.hits || [], byId = {};
  FR.cases.forEach(function(c){ byId[c.id] = c; });
  var loanHits = hits.filter(function(h){ return h.t === 'loan'; }), defHits = hits.filter(function(h){ return h.t === 'def'; });
  var found = function(h){ return h.where.map(function(w){ return frParty_(w.party).split(' / ')[0] + ' ' + (w.field === 'name' ? 'jina' : w.field === 'momo' ? 'momo' : 'simu') + ' <b>' + esc(w.value) + '</b>'; }).join(', '); };
  var html = '<h3 style="margin:0 0 2px">Matokeo / Results · “' + esc(d.q || '') + '”</h3>'
    + '<div class="hint" style="margin-bottom:8px">' + (d.kind === 'number' ? 'namba / a number' : 'jina / a name') + ' · '
    + money(d.total || 0) + ' ' + (d.total === 1 ? 'mahali / place' : 'mahali / places') + ' kwenye mikopo ' + money((d.scanned || {}).loans || 0)
    + ' iliyoidhinishwa na defaults sheet ' + ((d.deck || {}).date ? 'ya ' + esc(d.deck.date) : '') + ' / in ' + money((d.scanned || {}).loans || 0)
    + ' approved loans and the defaults sheet' + (d.scope && d.scope.length ? ' · timu zako tu / your teams only' : '')
    + ((d.total || 0) > hits.length ? ' · ' + money(hits.length) + ' zinaonyeshwa / shown' : '') + '</div>';
  if (!hits.length) {
    html += '<div class="note" style="background:#ecfdf3;border-color:#abefc6">✅ Haipo kwenye kitabu: hakuna mkopo ulioidhinishwa wala mstari wa defaults sheet wenye “' + esc(d.q || '') + '”. '
      + '/ Not in the book: no approved loan and no defaults-sheet row carries “' + esc(d.q || '') + '”.</div>';
  }
  /* THE LATEST APPEARANCE FIRST -- "search return latest appearance of the searched no in
     previous approved info - whether holding previous fraud already or not". The newest
     approved loan the characters sit on, said whole, with whether it already holds a case. */
  if (loanHits.length) {
    var top = loanHits[0], tw = top.with, tc = byId[tw.id];
    html += '<div class="card" style="padding:10px;margin:6px 0 10px;border-left:4px solid ' + (tc ? '#B42318' : '#0B2A6B') + '">'
      + '<div class="mut" style="font-size:10.5px;letter-spacing:.3px">MARA YA MWISHO KUONEKANA KWENYE MIKOPO ILIYOIDHINISHWA / LATEST APPEARANCE IN APPROVED LOANS</div>'
      + '<div style="font-size:15px;font-weight:700;margin:2px 0">' + esc(tw.name || '') + ' · REF ' + esc(tw.ref || '') + '</div>'
      + '<div style="font-size:12px">' + found(top) + ' · ' + esc(tw.team || '') + ' · ' + esc(tw.stage || '')
      + ' · imeidhinishwa / approved ' + frWhen_(tw.approvedDate) + (tw.approvedBy ? ' na / by ' + esc(tw.approvedBy) : '')
      + (tw.createdBy ? ' · imeandaliwa na / created by ' + esc(tw.createdBy) : '') + ' · TZS ' + money(tw.principal) + '</div>'
      + '<div style="margin-top:5px">' + (tc
          ? '<span class="chip bad">INA KESI TAYARI / ALREADY HOLDS A CASE · ' + money(tc.nLinks) + ' viungo</span> '
            + '<a href="#" onclick="frCard_(FR.cases.filter(function(x){ return x.id === \'' + esc(tw.id) + '\'; })[0]);return false">fungua kesi / open the case &rarr;</a>'
          : '<span class="chip warn">HAINA KESI BADO / NO CASE YET</span> <span class="mut" style="font-size:11px">lakini namba au jina lipo kwenye mkopo huu / but the characters sit on this loan</span>')
      + (loanHits.length > 1 ? ' <span class="mut" style="font-size:11px">· mikopo mingine ' + money(loanHits.length - 1) + ' hapa chini / ' + money(loanHits.length - 1) + ' earlier loan(s) below</span>' : '')
      + '</div></div>';
  }
  if (loanHits.length) {
    html += '<h4 style="margin:10px 0 4px">Mikopo iliyoidhinishwa / Approved loans (' + money(loanHits.length) + ')</h4>'
      + '<div class="scroll"><table><thead><tr><th>Ilipatikana kama / Found as</th><th>Mteja / Customer</th><th>REF</th><th>Timu / Team</th><th>Hali / Stage</th><th>Imeidhinishwa / Approved</th><th class="r">Kiasi / Principal</th><th>Kesi / Case</th></tr></thead><tbody>'
      + loanHits.map(function(h){ var w = h.with, c = byId[w.id];
          return '<tr' + (c ? ' style="cursor:pointer" onclick="frCard_(FR.cases.filter(function(x){ return x.id === \'' + esc(w.id) + '\'; })[0])"' : '') + '>'
            + '<td>' + found(h) + '</td><td>' + esc(w.name || '') + '</td><td>' + esc(w.ref || '') + '</td><td>' + esc(w.team || '') + '</td>'
            + '<td>' + esc(w.stage || '') + '</td><td>' + frWhen_(w.approvedDate) + (w.approvedBy ? ' · ' + esc(w.approvedBy) : '') + '</td><td class="r">' + money(w.principal) + '</td>'
            + '<td>' + (c ? '<span class="chip ' + (c.strong ? 'bad' : 'warn') + '">KESI · ' + money(c.nLinks) + ' viungo</span>' : '<span class="mut">—</span>') + '</td></tr>'; }).join('')
      + '</tbody></table></div>';
  }
  if (defHits.length) {
    html += '<h4 style="margin:10px 0 4px">Defaults sheet (' + money(defHits.length) + ')</h4>'
      + '<div class="scroll"><table><thead><tr><th>Ilipatikana kama / Found as</th><th>Mteja / Customer</th><th>REF</th><th>Timu / Team</th><th>Hali / Status</th><th class="r">DC</th><th class="r">Madeni / Arrears</th><th class="r">Salio / Balance</th></tr></thead><tbody>'
      + defHits.map(function(h){ var w = h.with;
          return '<tr><td>' + found(h) + '</td><td>' + esc(w.name || '') + '</td><td>' + esc(w.ref || '') + '</td><td>' + esc(w.team || '') + '</td>'
            + '<td>' + esc(w.status || '') + '</td><td class="r">' + (w.dc == null ? '—' : esc(w.dc)) + '</td><td class="r">' + money(w.arrears) + '</td><td class="r">' + money(w.balance) + '</td></tr>'; }).join('')
      + '</tbody></table></div>';
  }
  html += '<div class="mut" style="font-size:10.5px;margin-top:8px">Kitabu hiki ni mikopo iliyoidhinishwa (approved, pending_disb, disbursed, funded, closed) na deki ya sasa ya defaults; maombi ambayo hayajaidhinishwa hayamo. '
    + '/ The book is the approved loans and the current defaults deck; applications not yet approved are not in it.</div>';
  drawer(html, { wide: true });
}

VIEWS.fraud = function(){
  return srv('fraudCases', {}).then(function(d){
    FR.cases = d.cases || [];
    FR.meta = { scanned: d.scanned || {}, deck: d.deck || {}, scope: d.scope, stages: d.stages || [] };
    frDraw_();
  }).catch(function(e){ HEAD = '<div class="msg bad">' + esc(String(e.message || e)) + '</div>'; S.rows = []; S.cols = []; ONROW = null; });
};
