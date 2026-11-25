/* hopeai -- a screen of HOPE PMO's portal, split out of public/app.html and fetched the first
   time its tab opens (see modLoad_ in app.html). Plain script, no build step: every
   function here is a global exactly as it was inside app.html, and it may use any helper
   the core page defines. Bump `var BUILD` in app.html whenever this file changes -- the
   loader fetches it as /mod/hopeai.js?v=BUILD. */

/* THE HOPE AI TAB (handbook Part 158) --
     "Have a new tab called Hope Ai in the system with rows of user chats that I could open and see what the user is chatting.. like reports
      of Claudian-PMO chats per user roles, teams and dates" · "So after that experience too we'll be back here to check what should be
      considered from the chats."                                                     -- the owner, 25 Nov 2026

   ONE READ for the window (claudianChats: a row for each chat, a chat being one person's day with Claudian-PMO), and ONE MORE when a row is
   opened (claudianThread: every question and tap of that chat in order). Everything else on this screen is a repaint of what has arrived:
   the role, team, where-from, kind-of-answer and behind filters, the counters that follow them, and the boards under the list (by role, by
   team, by day, and the ready questions people tap), which are worked out here from the chats the list shows -- so the boards and the list
   can never disagree. The server answers only a date window (seven days to begin with, thirty-one at most). */
var HA = { d: null, key: '', role: '', team: '', source: '', mode: '', behind: '' };

function haKey_(t){ return String(t.thread || '').replace(/:\d{4}-\d{2}-\d{2}$/, ''); }
/** The teams a chat's asker held, one by one: "KONGOWE, MBAGALA +3" is two teams and a count; "ALL" is every team. */
function haTeamsOf_(t){
  var s = String(t.teams || '');
  if (!s) return [];
  return s.split(',').map(function(x){ return x.replace(/\s*\+\d+\s*$/, '').trim(); }).filter(function(x){ return x; });
}
function haPass_(t){
  if (HA.role && (t.role || '') !== HA.role) return false;
  if (HA.team && haTeamsOf_(t).indexOf(HA.team) < 0) return false;
  if (HA.source && (t.source || '') !== HA.source) return false;
  if (HA.mode === 'ai' && !t.ai) return false;
  if (HA.mode === 'faq' && !((t.faq || 0) + (t.match || 0))) return false;
  if (HA.mode === 'nomatch' && !t.nomatch) return false;
  if (HA.mode === 'held' && !((t.limit || 0) + (t.busy || 0))) return false;
  if (HA.mode === 'typedOnly' && !(t.ai || t.canned || t.limit || t.busy || t.match || t.nomatch)) return false;
  if (HA.behind === 'yes' && t.behind !== true) return false;
  if (HA.behind === 'no' && t.behind !== false) return false;
  return true;
}
function haSet_(k, v){ HA[k] = v; haDraw_(); paint(true); }
function haReset_(){ HA.role = ''; HA.team = ''; HA.source = ''; HA.mode = ''; HA.behind = ''; haDraw_(); paint(true); }
function haSelect_(key, label, allLabel, opts){
  return '<div class="fld" style="min-width:150px"><label>' + label + '</label><select onchange="haSet_(\'' + key + '\', this.value)">'
    + '<option value="">' + allLabel + '</option>'
    + opts.map(function(o){ return '<option value="' + esc(o.v) + '"' + (HA[key] === o.v ? ' selected' : '') + '>' + esc(o.t) + '</option>'; }).join('')
    + '</select></div>';
}
function haCounts_(list, pick){
  var m = {};
  list.forEach(function(t){ pick(t).forEach(function(k){ if (k) m[k] = (m[k] || 0) + 1; }); });
  return Object.keys(m).sort().map(function(k){ return { v: k, t: k + ' (' + m[k] + ')' }; });
}
/** The text of a chat of ready questions only: the first two, in Swahili, and how many more. */
function haFaqText_(t, labels){
  var ids = Object.keys(t.faqIds || {});
  if (!ids.length) return '';
  var names = ids.slice(0, 2).map(function(id){ return labels && labels[id] ? labels[id].sw : id; });
  return 'Maswali ya kawaida / Ready: ' + names.join('; ') + (ids.length > 2 ? ' +' + (ids.length - 2) : '');
}
function haRow_(t, labels){
  return { thread: t.thread, day: t.day, lastAt: t.lastAt, source: t.source, name: t.name, role: t.role, zone: t.zone, teams: t.teams,
    n: t.n, ai: t.ai, faq: (t.faq || 0) + (t.match || 0), none: t.nomatch || 0, held: (t.limit || 0) + (t.busy || 0), tokens: (t.tokensIn || 0) + (t.tokensOut || 0), behind: t.behind,
    first: t.first || haFaqText_(t, labels), _t: t };
}
function haBehindText_(v){ return v === true ? 'NYUMA / BEHIND' : v === false ? 'SAWA / OK' : '—'; }
function haBehindCls_(v){ return v === true ? 'bad' : v === false ? 'ok' : 'mut'; }

/** One line of a board: the figures of a set of chats. */
function haTally_(list){
  var o = { chats: list.length, asked: 0, ai: 0, faq: 0, none: 0, held: 0, tokens: 0, behind: 0 }, people = {};
  list.forEach(function(t){
    o.asked += t.n || 0; o.ai += t.ai || 0; o.faq += (t.faq || 0) + (t.match || 0); o.none += t.nomatch || 0; o.held += (t.limit || 0) + (t.busy || 0);
    o.tokens += (t.tokensIn || 0) + (t.tokensOut || 0); if (t.behind === true) o.behind++;
    people[haKey_(t)] = 1;
  });
  o.people = Object.keys(people).length;
  return o;
}
function haGroup_(list, keysOf){
  var m = {};
  list.forEach(function(t){ keysOf(t).forEach(function(k){ (m[k] = m[k] || []).push(t); }); });
  return m;
}
function haBoardCols_(firstKey, firstLabel){
  return [col(firstKey, firstLabel), col('chats', 'Mazungumzo / Chats', 'num'), col('people', 'Watu / People', 'num'), col('asked', 'Maswali / Asked', 'num'),
    col('ai', 'AI', 'num'), col('faq', 'Ya kawaida / Ready', 'num'), col('none', 'Hakuna jibu / No answer', 'num'), col('held', 'Kikomo / Limit', 'num'), col('tokens', 'Tokens', 'num'),
    col('behind', 'Nyuma / Behind', 'num')];
}
function haBoardRows_(groups, firstKey, order){
  var rows = Object.keys(groups).map(function(k){ var o = haTally_(groups[k]); o[firstKey] = k; return o; });
  rows.sort(order || function(a, b){ return b.chats - a.chats || String(a[firstKey]).localeCompare(String(b[firstKey])); });
  return rows;
}
var HA_SUM = ['chats', 'asked', 'ai', 'faq', 'none', 'held', 'tokens', 'behind'];
/** The boards under the list: the reports the owner asked for, "per user roles, teams and dates", and the ready questions people tap. */
function haBoards_(list, labels, d){
  var byRole = haBoardRows_(haGroup_(list, function(t){ return [t.role || '—']; }), 'role');
  var byTeam = haBoardRows_(haGroup_(list, function(t){ var ts = haTeamsOf_(t); return ts.length ? ts : ['—']; }), 'team');
  byTeam.forEach(function(r){ if (r.team === 'ALL') r.team = 'ALL (timu zote / every team)'; });
  var byDay = haBoardRows_(haGroup_(list, function(t){ return [t.day || '—']; }), 'day', function(a, b){ return String(b.day).localeCompare(String(a.day)); });
  var faq = {};
  list.forEach(function(t){ Object.keys(t.faqIds || {}).forEach(function(id){
    var o = faq[id] || (faq[id] = { id: id, question: labels && labels[id] ? labels[id].sw + ' / ' + labels[id].en : id, taps: 0, chats: 0 });
    o.taps += t.faqIds[id]; o.chats++;
  }); });
  var faqRows = Object.keys(faq).map(function(k){ return faq[k]; }).sort(function(a, b){ return b.taps - a.taps || a.id.localeCompare(b.id); });
  var sub = d.from + ' → ' + d.to;
  return board('haRole', 'Kwa cheo / By role', sub, byRole, haBoardCols_('role', 'Cheo / Role'), sumRow(byRole, HA_SUM))
    + board('haTeam', 'Kwa timu / By team', sub + ' · mtu mwenye timu nyingi anahesabiwa kwa kila timu / a person with several teams counts under each', byTeam, haBoardCols_('team', 'Timu / Team'), sumRow(byTeam, HA_SUM))
    + board('haDay', 'Kwa siku / By day', sub, byDay, haBoardCols_('day', 'Siku / Day'), sumRow(byDay, HA_SUM))
    + (faqRows.length
        ? board('haFaq', 'Maswali ya kawaida yaliyochaguliwa / Ready questions tapped', sub, faqRows,
            [col('question', 'Swali / Question'), col('taps', 'Mara / Taps', 'num'), col('chats', 'Mazungumzo / Chats', 'num')], sumRow(faqRows, ['taps']))
        : '');
}

/** Everything that is drawn from the answer and the filters: counters, controls, the list and the boards under it. A pick repaints; it asks for nothing. */
function haDraw_(){
  var d = HA.d || {}, labels = d.faqLabels || {}, all = d.threads || [];
  var list = all.filter(haPass_);
  var t = haTally_(list), picked = !!(HA.role || HA.team || HA.source || HA.mode || HA.behind);
  var a = S.args || {};
  var ofAll = picked ? ' <span class="mut" style="font-size:12px">/ ' + money(all.length) + '</span>' : '';
  HEAD = '<div class="kpis">'
    + kpi('Mazungumzo / Chats', money(t.chats) + ofAll, 'mtu mmoja, siku moja / one person, one day')
    + kpi('Watu / People', money(t.people))
    + kpi('Maswali / Questions asked', money(t.asked), 'yaliyoandikwa na yaliyochaguliwa / typed and tapped')
    + kpi('Majibu ya AI / AI answers', money(t.ai), 'tokens ' + money(t.tokens))
    + kpi('Ya kawaida / Ready answers', money(t.faq), 'bila tokens: yaliyochaguliwa na yaliyoandikwa / no tokens: tapped and typed')
    + kpi('Hakuna jibu la kawaida / No ready answer', money(t.none), 'yaliyoandikwa AI ikiwa imezimwa / typed while the AI is off', t.none ? 'warn' : '')
    + kpi('Kikomo au shughuli / Limit or busy', money(t.held), 'walioambiwa wajaribu baadaye / told to try later', t.held ? 'warn' : '')
    + kpi('Timu ziko nyuma / Chats of teams behind', money(t.behind), 'wiki iliyopita / last week', t.behind ? 'bad' : '')
    + '</div>'
    + (d.on === false ? '<div class="note bad">' + esc(d.note || '') + '</div>' : '')
    + (d.clamped ? '<div class="note">Kipindi kimepunguzwa hadi siku 31 za mwisho. / The window was cut to its newest 31 days.</div>' : '')
    + (d.truncated ? '<div class="note bad">Mazungumzo ni mengi kuliko yanayoonyeshwa: yanayoonyeshwa ni ' + money(all.length) + ' ya hivi karibuni. Punguza tarehe. '
        + '/ There are more chats than are shown: the newest ' + money(all.length) + ' are. Narrow the dates.</div>' : '')
    + bar('<input type="date" data-arg="from" value="' + esc(a.from || '') + '"> <input type="date" data-arg="to" value="' + esc(a.to || '') + '">'
      + ' <button class="btn sm ghost" data-args=\'' + esc(JSON.stringify({ from: today(), to: today() })) + '\'>Leo / Today</button>'
      + ' <button class="btn sm ghost" data-args=\'' + esc(JSON.stringify({ from: addDays(today(), -6), to: today() })) + '\'>Siku 7 / 7 days</button>'
      + ' <button class="btn sm ghost" data-args=\'' + esc(JSON.stringify({ from: addDays(today(), -29), to: today() })) + '\'>Siku 30 / 30 days</button>')
    + '<div class="card" style="padding:10px;margin:8px 0"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">'
    + haSelect_('role', 'Cheo / Role', 'Vyote / All', haCounts_(all, function(x){ return [x.role]; }))
    + haSelect_('team', 'Timu / Team', 'Zote / All', haCounts_(all, haTeamsOf_))
    + haSelect_('source', 'Wapi / Where', 'Pote / Both', [{ v: 'portal', t: 'Portal' }, { v: 'call', t: 'HOPE Calls' }])
    + haSelect_('mode', 'Aina ya jibu / Kind of answer', 'Zote / All', [{ v: 'ai', t: 'AI alijibu / the AI answered' }, { v: 'faq', t: 'Maswali ya kawaida / Ready questions' },
        { v: 'nomatch', t: 'Hakuna jibu la kawaida / No ready answer' }, { v: 'held', t: 'Kikomo au shughuli / Limit or busy' }, { v: 'typedOnly', t: 'Walioandika swali / Typed a question' }])
    + haSelect_('behind', 'Nyuma? / Behind?', 'Wote / All', [{ v: 'yes', t: 'Timu ziko nyuma / Teams behind' }, { v: 'no', t: 'Timu ziko sawa / Teams on target' }])
    + '<button class="btn sm ghost" onclick="haReset_()">Futa vichujio / Clear</button>'
    + '<span class="mut" style="font-size:11.5px">Yanaonyeshwa / Showing <b>' + money(list.length) + '</b> / ' + money(all.length) + '</span>'
    + '</div></div>'
    + haExpCard_(d);
  /* Fourteen columns, the last of them the first question: on a laptop the list wraps to the card's width (S.fit = 'words', cleared in go(): it breaks at spaces
     only, so no short column is squeezed to a few letters) so the question is in sight without a scroll to the right; a phone keeps the sideways scroll. */
  S.fit = 'words';
  S.rows = list.map(function(x){ return haRow_(x, labels); });
  /* The two chips read '' on the list's TOTAL row (it has no chat, so no thread): a chip's text is whatever its get() answers, and an empty total
     row would otherwise print PORTAL under the Where column. */
  S.cols = [col('lastAt', 'Mara ya mwisho / Last', 'dt'),
    { key: 'source', label: 'Wapi / Where', kind: 'chip', chip: function(r){ return r.source === 'call' ? 'warn' : 'ok'; }, get: function(r){ return !r.thread ? '' : r.source === 'call' ? 'CALLS' : 'PORTAL'; } },
    col('name', 'Mtu / Person'), col('role', 'Cheo / Role'), col('zone', 'Zone'), col('teams', 'Timu / Teams'),
    col('n', 'Maswali / Asked', 'num'), col('ai', 'AI', 'num'), col('faq', 'Ya kawaida / Ready', 'num'), col('none', 'Hakuna jibu / No answer', 'num'), col('held', 'Kikomo / Limit', 'num'), col('tokens', 'Tokens', 'num'),
    { key: 'behind', label: 'Nyuma? / Behind?', kind: 'chip', chip: function(r){ return haBehindCls_(r.behind); }, get: function(r){ return !r.thread ? '' : haBehindText_(r.behind); } },
    col('first', 'Swali la kwanza / First question')];
  ONROW = function(r){ haOpen_(r.thread); };
  S.tail = d.on === false || !all.length ? '' : haBoards_(list, labels, d);
  S.foot = 'Gusa mstari kufungua mazungumzo yote. Majina, vyeo na timu ni vile mfumo ulivyovijua wakati mtu aliuliza; namba za tarakimu 7 au zaidi zilibadilishwa kuwa [namba] kabla swali kuhifadhiwa; jina la mteja au namba fupi iliyoandikwa kwenye swali HAIONDOLEWI: iko kama ilivyoandikwa. '
    + '/ Tap a row to open the whole chat. Names, roles and teams are as the system knew them when the person asked; numbers of seven digits or more were replaced by [namba] before the question was kept; a customer\'s name or a short reference typed into a question is NOT removed: it is kept as typed. '
    + 'Kuwapa cheo kingine ruhusa ya kichupo hiki kunawaruhusu kusoma mazungumzo ya kila mtu. / Ticking this tab for a role lets that role read everybody\'s chats.';
}

/* THE REPORT FOR CLAUDE, AND THE CLEAR (handbook Part 162) --
     "I need to always export a report you may need at that window of Hope Ai, then clear all existing history so that i may always deliver you with what
      went on (so that you tell me any concerns) and keep the db fresh."                                         -- the owner, 25 Nov 2026

   EXPORT asks the server for EVERYTHING on file (not only the window the list shows), a page of 500 rows at a time up to the line the first page draws (the
   newest row's own time), builds one plain-text report from them in the browser (public/mod/hopeai-report.js, fetched the first time it is wanted) and saves
   it. CLEAR deletes exactly those rows (the line and the count go back to the server, which refuses if there is more on file than the report held) and is
   offered to the admin alone, and only after an export in this visit that came back whole. Nothing here repaints the list while pages arrive: the card
   updates its own words. */
var HAX = { busy: false, step: '', done: 0, total: 0, got: null, err: '' };
function haStamp_(iso){
  var ms = Date.parse(iso);
  return isNaN(ms) ? String(iso || '') : new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
function haWho_(){
  try { return (typeof S !== 'undefined' && S.me && (S.me.name || S.me.role)) || ''; } catch (e) { return ''; }
}
function haExpLabel_(){
  return HAX.busy && HAX.step === 'export' ? 'Inapakua... / Downloading...' : 'Pakua ripoti yote / Export the whole report';
}
function haExpNote_(d){
  var bits = [];
  if (d && d.lastClear) bits.push('Historia ilifutwa mara ya mwisho ' + esc(haStamp_(d.lastClear.at)) + ' na ' + esc(d.lastClear.by || '?') + ' (mazungumzo ' + money(d.lastClear.deleted)
    + ') / History last cleared ' + esc(haStamp_(d.lastClear.at)) + ' by ' + esc(d.lastClear.by || '?') + ' (' + money(d.lastClear.deleted) + ' rows)');
  if (HAX.busy) bits.push(HAX.step === 'clear' ? 'Inafuta... / Clearing...'
    : 'Inapakua ' + money(HAX.done) + (HAX.total ? ' kati ya ' + money(HAX.total) : '') + '... / Downloading ' + money(HAX.done) + (HAX.total ? ' of ' + money(HAX.total) : '') + '...');
  else if (HAX.err) bits.push('<span style="color:var(--bad)">' + esc(HAX.err) + '</span>');
  else if (HAX.got) bits.push('Imepakuliwa: ' + money(HAX.got.count) + ' hadi ' + esc(haStamp_(HAX.got.upTo)) + '. Hifadhi faili, kisha unaweza kufuta. / Exported: ' + money(HAX.got.count)
    + ' rows up to ' + esc(haStamp_(HAX.got.upTo)) + '. Save the file, then you may clear.');
  return bits.join(' &nbsp;&middot;&nbsp; ');
}
/** The card under the filters: the two buttons and what is going on. The clear button is drawn only for the admin (the server checks it again), and is dead until
    an export of this visit came back whole. */
function haExpCard_(d){
  if (!d || d.on === false) return '';
  return '<div class="card" style="padding:10px;margin:8px 0"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    + '<b>Ripoti kwa Claude / Report for Claude</b>'
    + '<button class="btn sm" id="haExpBtn" onclick="haExport_()"' + (HAX.busy ? ' disabled' : '') + '>' + haExpLabel_() + '</button>'
    + (d.canClear ? '<button class="btn sm ghost" id="haClrBtn" onclick="haClear_()"' + (HAX.got && !HAX.busy ? '' : ' disabled') + '>Futa historia iliyopakuliwa / Clear what was exported</button>'
        : '<span class="mut" style="font-size:11.5px">Kufuta ni kwa msimamizi tu. / Clearing is for the admin only.</span>')
    + '<span class="mut" style="font-size:11.5px" id="haExpNote">' + haExpNote_(d) + '</span>'
    + '</div><div class="mut" style="font-size:11px;margin-top:4px">Ripoti ni faili moja la maandishi lenye historia YOTE (si siku zilizoonyeshwa tu): hesabu, mambo ya kuangalia kwanza, na kila mazungumzo. Mpe Claude faili hilo akueleze wasiwasi wowote. '
    + '/ One text file of ALL the history (not only the days shown): the counts, what to look at first, and every chat. Give the file to Claude and ask for any concerns. Clearing deletes only what that file held.</div></div>';
}
function haExpUi_(){
  var n = document.getElementById('haExpNote'), b = document.getElementById('haExpBtn'), c = document.getElementById('haClrBtn');
  if (n) n.innerHTML = haExpNote_(HA.d);
  if (b) { b.disabled = !!HAX.busy; b.textContent = haExpLabel_(); }
  if (c) c.disabled = !(HAX.got && !HAX.busy);
}
function haExport_(){
  if (HAX.busy) return;
  HAX.busy = true; HAX.step = 'export'; HAX.err = ''; HAX.got = null; HAX.done = 0; HAX.total = 0; haExpUi_();
  var rows = [], upTo = '', total = 0, labels = {};
  modLoad_('hopeai-report').then(function(){
    function page(offset){
      return srv('claudianChatsExport', { upTo: upTo, offset: offset }).then(function(d){
        if (d.on === false) throw new Error(d.note || 'The chats table is not there.');
        if (offset === 0) { upTo = d.upTo || ''; total = d.total || 0; labels = d.faqLabels || {}; HAX.total = total; }
        if (!upTo) return null;
        Array.prototype.push.apply(rows, d.rows || []);
        HAX.done = rows.length; haExpUi_();
        return d.next != null ? page(d.next) : null;
      });
    }
    return page(0);
  }).then(function(){
    HAX.busy = false;
    if (!upTo) { HAX.err = 'Hakuna historia ya kupakua. / There is no history to export.'; haExpUi_(); return; }
    var whole = rows.length === total, typed = 0;
    rows.forEach(function(r){ if (r.mode !== 'faq') typed++; });
    var text = harBuild_(rows, { madeAt: new Date().toISOString(), by: haWho_(), upTo: upTo, total: total, faqLabels: labels, lastClear: HA.d && HA.d.lastClear });
    download(new Blob([text], { type: 'text/plain;charset=utf-8;' }), 'Hope-Ai-report-' + today() + '.txt');
    HAX.got = whole ? { upTo: upTo, count: rows.length, typed: typed } : null;
    HAX.err = whole ? '' : 'Ripoti haijakamilika (' + money(rows.length) + ' kati ya ' + money(total) + '): usifute. Pakua tena. / The report is not whole (' + money(rows.length) + ' of ' + money(total) + '): do not clear. Export again.';
    haExpUi_();
  }).catch(function(e){ HAX.busy = false; HAX.got = null; HAX.err = String((e && e.message) || e); haExpUi_(); });
}
function haClear_(){
  var g = HAX.got;
  if (!g || HAX.busy || !(HA.d && HA.d.canClear)) return;
  var when = haStamp_(g.upTo);
  if (!confirm('Futa mazungumzo ' + money(g.count) + ' (maswali ' + money(g.typed) + ' yaliyoandikwa) yaliyopakuliwa hadi ' + when + '?\n\nHaiwezi kurudishwa. Hakikisha faili la ripoti limehifadhiwa kabla ya kuendelea.\n\n'
    + 'Delete the ' + money(g.count) + ' rows (' + money(g.typed) + ' typed questions) that were exported, up to ' + when + '?\n\nThis cannot be undone. Make sure the report file is saved before you go on.')) return;
  HAX.busy = true; HAX.step = 'clear'; HAX.err = ''; haExpUi_();
  srv('claudianChatsClear', { upTo: g.upTo, expected: g.count, date: String(g.upTo).slice(0, 10) }).then(function(out){
    HAX.busy = false;
    if (out.on === false) { HAX.err = out.note || ''; haExpUi_(); return; }
    if (out.changed) {
      HAX.got = null;
      HAX.err = 'Kuna mazungumzo mengi kuliko yaliyomo kwenye ripoti (' + money(out.found) + ' dhidi ya ' + money(out.expected) + '): hakuna kilichofutwa. Pakua ripoti tena. '
        + '/ There is more on file than the report held (' + money(out.found) + ' against ' + money(out.expected) + '): nothing was deleted. Export again.';
      haExpUi_(); return;
    }
    if (out.partial) {
      HAX.err = 'Imefutwa ' + money(out.deleted) + ', bado ' + money(out.remaining) + ': bonyeza tena. / ' + money(out.deleted) + ' deleted, ' + money(out.remaining) + ' left: press again.';
      haExpUi_(); return;
    }
    HAX.got = null;
    toast('Zimefutwa ' + money(out.deleted) + ' / ' + money(out.deleted) + ' rows cleared');
    render();
  }).catch(function(e){ HAX.busy = false; HAX.err = String((e && e.message) || e); haExpUi_(); });
}

VIEWS.hopeai = function(){
  var a = S.args || {};
  /* First open shows the last seven days, today included; a date the reader has cleared on purpose (undefined vs '') stays cleared and the server
     reads its own default, so the page never holds a second rule for the window. */
  if (a.from === undefined && a.to === undefined) { a.from = addDays(today(), -6); a.to = today(); S.args = a; }
  return srv('claudianChats', { from: a.from || '', to: a.to || '' }).then(function(d){
    var key = (d.from || '') + '|' + (d.to || '');
    if (HA.key !== key) { HA.role = ''; HA.team = ''; HA.source = ''; HA.mode = ''; HA.behind = ''; }   // a new window: the old picks may name nobody in it
    HA.key = key; HA.d = d;
    haDraw_();
  });
};

/* ONE CHAT, IN FULL -- who asked, and every question and tap in the order they happened, with what the person was answered. */
/** A chat's note: what went wrong or was cut, in red (a stop, a failure), and in grey what the helper was given for the question: the knowledge cards
    ("cards: a, b"; handbook Part 159) and the reports it read ("data: calls by team"; Part 160, "(late)" or "(failed)" when the report did not come: that
    one is red). The parts of a note are joined with " · " by the server. */
function haNoteHtml_(note) {
  return String(note).split(' \u00b7 ').map(function(part){
    var cards = part.indexOf('cards: ') === 0, data = part.indexOf('data: ') === 0 && !/\((late|failed)\)/.test(part);
    // what a typed question with the AI off leaves in its note (Part 163) is information, never a problem: grey, said in both languages
    var ready = part === 'agent off' || part === 'no key or sdk' || part === 'tie' || part === 'figure' || part.indexOf('score ') === 0 || part.indexOf('near: ') === 0;
    var grey = cards || data || ready;
    var text = cards ? 'Kadi / Cards: ' + esc(part.slice(7)) : data ? 'Takwimu / Data: ' + esc(part.slice(6))
      : part === 'agent off' ? 'AI ilikuwa imezimwa / The AI was off' : part === 'no key or sdk' ? 'AI haikuwa na ufunguo / The AI had no key'
      : part === 'tie' ? 'Majibu mawili yalilingana / Two ready answers weighed alike' : part === 'figure' ? 'Aliomba namba yake mwenyewe / Asked for a figure of their own' : part.indexOf('score ') === 0 ? 'Alama ya kufanana / Match score: ' + esc(part.slice(6))
      : part.indexOf('near: ') === 0 ? 'Maswali ya karibu / Nearest ready questions: ' + esc(part.slice(6)) : esc(part);
    return '<div style="margin:2px 0;font-size:12px;color:' + (grey ? 'var(--mut)' : 'var(--bad)') + '">' + text + '</div>';
  }).join('');
}

function haTime_(iso){
  var ms = Date.parse(iso);
  return isNaN(ms) ? '' : new Date(ms + 3 * 3600 * 1000).toISOString().slice(11, 16);
}
var HA_MODE_TEXT = { ai: 'AI', faq: 'KAWAIDA / READY', match: 'JIBU LA KAWAIDA / READY ANSWER', nomatch: 'HAKUNA JIBU / NO ANSWER', canned: 'NENO MOJA / FIXED', limit: 'KIKOMO / LIMIT', busy: 'SHUGHULI / BUSY' };
var HA_MODE_CLS = { ai: 'ok', faq: 'mut', match: 'ok', nomatch: 'warn', canned: 'mut', limit: 'warn', busy: 'warn' };
function haOpen_(thread){
  srv('claudianThread', { thread: thread }).then(function(d){ haDrawer_(d); }).catch(function(e){ toast(String(e && e.message || e), true); });
}
function haDrawer_(d){
  if (d.on === false) { drawer('<div class="note bad">' + esc(d.note || '') + '</div>'); return; }
  var w = d.who || {}, items = d.items || [];
  var rows = items.map(function(x){
    return { at: x.at, mode: HA_MODE_TEXT[x.mode] || x.mode, q: x.q, a: x.a || (x.mode === 'faq' ? '(jibu la kawaida / ready answer)' : x.mode === 'nomatch' ? '(hakuna jibu la kawaida / no ready answer)' : ''),
      tokensIn: x.tokensIn, tokensOut: x.tokensOut, ms: x.ms, behind: haBehindText_(x.behind), note: x.note, ready: x.faqLabel ? x.faqLabel.sw + ' / ' + x.faqLabel.en : '' };
  });
  BOARDS.haThread = { title: 'Hope-Ai-' + String(w.name || 'chat') + '-' + (d.day || ''), rows: rows,
    cols: [col('at', 'Saa / Time', 'dt'), col('mode', 'Aina / Kind'), col('q', 'Swali / Question'), col('a', 'Jibu / Answer'), col('tokensIn', 'Tokens ndani / in', 'num'),
      col('tokensOut', 'Tokens nje / out', 'num'), col('ms', 'ms', 'num'), col('behind', 'Nyuma? / Behind?'), col('ready', 'Jibu la kawaida kwa / Ready answer to'), col('note', 'Maelezo / Note')] };
  var tin = 0, tout = 0;
  items.forEach(function(x){ tin += x.tokensIn || 0; tout += x.tokensOut || 0; });
  var html = '<h3 style="margin:0 0 2px">' + esc(w.name || '—') + ' <span class="mut" style="font-weight:400;font-size:13px">· ' + esc(w.role || '—') + '</span></h3>'
    + '<div class="hint" style="margin-bottom:8px">' + esc(d.day || '') + ' · ' + (w.source === 'call' ? 'HOPE Calls' : 'Portal') + ' · ' + esc(w.zone || '—') + ' · ' + esc(w.teams || '—')
    + ' · ' + money(items.length) + ' ' + (items.length === 1 ? 'swali / question' : 'maswali / questions') + ' · tokens ' + money(tin) + ' → ' + money(tout) + '</div>';
  if (!items.length) html += '<div class="note">Hakuna maswali kwenye mazungumzo haya. / No questions in this chat.</div>';
  items.forEach(function(x){
    var cls = HA_MODE_CLS[x.mode] || 'mut';
    html += '<div class="card" style="padding:8px 10px;margin:6px 0">'
      + '<div class="mut" style="font-size:11px;margin-bottom:3px">' + esc(haTime_(x.at)) + ' · <span class="chip ' + cls + '" style="font-size:10px">' + esc(HA_MODE_TEXT[x.mode] || x.mode || '') + '</span>'
      + (x.tokensIn || x.tokensOut ? ' · tokens ' + money(x.tokensIn) + ' → ' + money(x.tokensOut) + (x.cacheRead ? ' (cache ' + money(x.cacheRead) + ')' : '') : '')
      + (x.ms ? ' · ' + money(x.ms) + ' ms' : '') + (x.behind === true ? ' · <span class="chip bad" style="font-size:10px">NYUMA / BEHIND</span>' : '') + '</div>'
      + '<div style="margin:2px 0"><b>Swali / Question:</b> ' + esc(x.q || '—') + '</div>'
      + (x.mode === 'match' && x.faqLabel ? '<div class="mut" style="margin:2px 0"><b>Jibu la swali la kawaida / Ready answer to:</b> ' + esc(x.faqLabel.sw + ' / ' + x.faqLabel.en) + '</div>' : '')
      + (x.a ? '<div style="margin:2px 0;white-space:pre-wrap"><b>Jibu / Answer:</b> ' + esc(x.a) + '</div>'
             : '<div class="mut" style="margin:2px 0">' + (x.mode === 'faq' ? 'Jibu la kawaida kutoka kwenye orodha. / A ready answer from the catalogue.' : x.mode === 'nomatch' ? 'Hakuna jibu la kawaida lililofaa. / No ready answer fitted.' : '—') + '</div>')
      + (x.note ? haNoteHtml_(x.note) : '')
      + '</div>';
  });
  drawer(html, { wide: true, xls: 'haThread' });
}
