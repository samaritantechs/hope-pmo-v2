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

VIEWS.fraud = function(){
  return srv('fraudCases', {}).then(function(d){
    var cases = d.cases || [], scanned = d.scanned || {}, deck = d.deck || {};
    var strong = cases.filter(function(c){ return c.strong; }).length;
    var ownDef = cases.filter(function(c){ return c.ownDefault; }).length;
    HEAD = '<div class="kpis">'
      + kpi('Kesi / Cases', money(cases.length), 'mikopo iliyoidhinishwa yenye kiungo / approved loans with a link', cases.length ? 'bad' : 'good')
      + kpi('Kwa namba / By number', money(strong), 'namba ya simu inayorudia / a phone number that recurs', strong ? 'bad' : '')
      + kpi('Kwa jina tu / By name only', money(cases.length - strong), 'jina linalorudia, bila namba / a name that recurs, no number', '')
      + kpi('Wana deni la awali / Own earlier loan in default', money(ownDef), 'wameidhinishwa wakiwa na mkopo kwenye defaults / approved while their earlier loan is on the sheet', ownDef ? 'bad' : '')
      + kpi('Mikopo iliyopitiwa / Loans scanned', money(scanned.loans || 0), (d.stages || []).join(', '))
      + kpi('Defaults sheet', money(scanned.defaults || 0), deck.date ? 'deki ya / deck of ' + esc(deck.date) : 'hakuna deki ya sasa / no current deck', deck.date ? '' : 'warn')
      + '</div>'
      + '<div class="note">Kanuni / The rule: mkopo ulioidhinishwa huwa <b>kesi</b> ikiwa jina au namba ya <b>mteja, mpokeaji au mdhamini</b> wake inaonekana kwenye mkopo mwingine ulioidhinishwa wa mteja mwingine (safu yoyote kati ya tatu), au kwenye <b>defaults sheet ya sasa</b> (mteja mwingine, au mkopo wake wa awali ambao bado una deni). Mikopo ya awali ya mteja huyo huyo si kiungo. Namba = kiungo imara; jina pekee = dhaifu (majina ya neno moja hayalinganishwi). '
      + '/ An approved loan is a <b>case</b> when a name or number of its <b>customer, receiver or guarantor</b> appears on another customer\'s approved loan (any of the three columns), or on the <b>current defaults sheet</b> (another customer, or this customer\'s own earlier loan still owing). A customer\'s own earlier loans are not a link. A number is a strong link; a name alone is weak (one-word names are not compared). Mpya kwanza / Newest first.'
      + (d.scope && d.scope.length ? ' <b>Upeo / Scope:</b> timu zako tu / your teams only (' + esc(d.scope.join(', ')) + ').' : '')
      + '</div>';
    S.rows = cases.map(function(c){
      return {
        approvedDate: c.approvedDate, ref: c.ref, name: c.name, team: c.team, receiver: c.receiver || '', guarantor: c.guarantor || '',
        links: money(c.nLinks) + ' · ' + (c.links || []).slice(0, 2).map(function(l){
          return frParty_(l.mine).split(' / ')[0] + ' ' + l.value + ' = ' + frParty_(l.theirs).split(' / ')[0] + ' ' + (l.t === 'loan' ? 'REF ' + (l.with.ref || '') : 'defaults ' + (l.with.ref || '')) + (l.own ? ' (wake)' : '');
        }).join('; ') + (c.nLinks > 2 ? '; …' : ''),
        strong: c.strong, ownDefault: c.ownDefault, principal: c.principal, _case: c,
      };
    });
    S.cols = [col('approvedDate', 'Imeidhinishwa / Approved', 'date'), col('ref', 'REF'), col('name', 'Mteja / Customer'), col('team', 'Timu / Team'),
      col('receiver', 'Mpokeaji / Receiver'), col('guarantor', 'Mdhamini / Guarantor'),
      { key: 'principal', label: 'Kiasi / Principal', kind: 'money' },
      col('links', 'Viungo / Links'),
      { key: 'strong', label: 'Nguvu / Strength', kind: 'chip', chip: frChipCls_, get: frChipText_ }];
    ONROW = function(r){ frCard_(r._case); };
  }).catch(function(e){ HEAD = '<div class="msg bad">' + esc(String(e.message || e)) + '</div>'; S.rows = []; S.cols = []; ONROW = null; });
};
