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
  if (HA.mode === 'faq' && !t.faq) return false;
  if (HA.mode === 'held' && !((t.limit || 0) + (t.busy || 0))) return false;
  if (HA.mode === 'typedOnly' && !(t.ai || t.canned || t.limit || t.busy)) return false;
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
    n: t.n, ai: t.ai, faq: t.faq, held: (t.limit || 0) + (t.busy || 0), tokens: (t.tokensIn || 0) + (t.tokensOut || 0), behind: t.behind,
    first: t.first || haFaqText_(t, labels), _t: t };
}
function haBehindText_(v){ return v === true ? 'NYUMA / BEHIND' : v === false ? 'SAWA / OK' : '—'; }
function haBehindCls_(v){ return v === true ? 'bad' : v === false ? 'ok' : 'mut'; }

/** One line of a board: the figures of a set of chats. */
function haTally_(list){
  var o = { chats: list.length, asked: 0, ai: 0, faq: 0, held: 0, tokens: 0, behind: 0 }, people = {};
  list.forEach(function(t){
    o.asked += t.n || 0; o.ai += t.ai || 0; o.faq += t.faq || 0; o.held += (t.limit || 0) + (t.busy || 0);
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
    col('ai', 'AI', 'num'), col('faq', 'Ya kawaida / Ready', 'num'), col('held', 'Kikomo / Limit', 'num'), col('tokens', 'Tokens', 'num'),
    col('behind', 'Nyuma / Behind', 'num')];
}
function haBoardRows_(groups, firstKey, order){
  var rows = Object.keys(groups).map(function(k){ var o = haTally_(groups[k]); o[firstKey] = k; return o; });
  rows.sort(order || function(a, b){ return b.chats - a.chats || String(a[firstKey]).localeCompare(String(b[firstKey])); });
  return rows;
}
var HA_SUM = ['chats', 'asked', 'ai', 'faq', 'held', 'tokens', 'behind'];
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
    + kpi('Ya kawaida / Ready answers', money(t.faq), 'bila tokens / no tokens')
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
        { v: 'held', t: 'Kikomo au shughuli / Limit or busy' }, { v: 'typedOnly', t: 'Walioandika swali / Typed a question' }])
    + haSelect_('behind', 'Nyuma? / Behind?', 'Wote / All', [{ v: 'yes', t: 'Timu ziko nyuma / Teams behind' }, { v: 'no', t: 'Timu ziko sawa / Teams on target' }])
    + '<button class="btn sm ghost" onclick="haReset_()">Futa vichujio / Clear</button>'
    + '<span class="mut" style="font-size:11.5px">Yanaonyeshwa / Showing <b>' + money(list.length) + '</b> / ' + money(all.length) + '</span>'
    + '</div></div>';
  /* Thirteen columns, the last of them the first question: on a laptop the list wraps to the card's width (S.fit = 'words', cleared in go(): it breaks at spaces
     only, so no short column is squeezed to a few letters) so the question is in sight without a scroll to the right; a phone keeps the sideways scroll. */
  S.fit = 'words';
  S.rows = list.map(function(x){ return haRow_(x, labels); });
  /* The two chips read '' on the list's TOTAL row (it has no chat, so no thread): a chip's text is whatever its get() answers, and an empty total
     row would otherwise print PORTAL under the Where column. */
  S.cols = [col('lastAt', 'Mara ya mwisho / Last', 'dt'),
    { key: 'source', label: 'Wapi / Where', kind: 'chip', chip: function(r){ return r.source === 'call' ? 'warn' : 'ok'; }, get: function(r){ return !r.thread ? '' : r.source === 'call' ? 'CALLS' : 'PORTAL'; } },
    col('name', 'Mtu / Person'), col('role', 'Cheo / Role'), col('zone', 'Zone'), col('teams', 'Timu / Teams'),
    col('n', 'Maswali / Asked', 'num'), col('ai', 'AI', 'num'), col('faq', 'Ya kawaida / Ready', 'num'), col('held', 'Kikomo / Limit', 'num'), col('tokens', 'Tokens', 'num'),
    { key: 'behind', label: 'Nyuma? / Behind?', kind: 'chip', chip: function(r){ return haBehindCls_(r.behind); }, get: function(r){ return !r.thread ? '' : haBehindText_(r.behind); } },
    col('first', 'Swali la kwanza / First question')];
  ONROW = function(r){ haOpen_(r.thread); };
  S.tail = d.on === false || !all.length ? '' : haBoards_(list, labels, d);
  S.foot = 'Gusa mstari kufungua mazungumzo yote. Majina, vyeo na timu ni vile mfumo ulivyovijua wakati mtu aliuliza; namba za tarakimu 7 au zaidi zilibadilishwa kuwa [namba] kabla swali kuhifadhiwa. '
    + '/ Tap a row to open the whole chat. Names, roles and teams are as the system knew them when the person asked; numbers of seven digits or more were replaced by [namba] before the question was kept. '
    + 'Kuwapa cheo kingine ruhusa ya kichupo hiki kunawaruhusu kusoma mazungumzo ya kila mtu. / Ticking this tab for a role lets that role read everybody\'s chats.';
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
function haTime_(iso){
  var ms = Date.parse(iso);
  return isNaN(ms) ? '' : new Date(ms + 3 * 3600 * 1000).toISOString().slice(11, 16);
}
var HA_MODE_TEXT = { ai: 'AI', faq: 'KAWAIDA / READY', canned: 'NENO MOJA / FIXED', limit: 'KIKOMO / LIMIT', busy: 'SHUGHULI / BUSY' };
var HA_MODE_CLS = { ai: 'ok', faq: 'mut', canned: 'mut', limit: 'warn', busy: 'warn' };
function haOpen_(thread){
  srv('claudianThread', { thread: thread }).then(function(d){ haDrawer_(d); }).catch(function(e){ toast(String(e && e.message || e), true); });
}
function haDrawer_(d){
  if (d.on === false) { drawer('<div class="note bad">' + esc(d.note || '') + '</div>'); return; }
  var w = d.who || {}, items = d.items || [];
  var rows = items.map(function(x){
    return { at: x.at, mode: HA_MODE_TEXT[x.mode] || x.mode, q: x.q, a: x.a || (x.mode === 'faq' ? '(jibu la kawaida / ready answer)' : ''),
      tokensIn: x.tokensIn, tokensOut: x.tokensOut, ms: x.ms, behind: haBehindText_(x.behind), note: x.note };
  });
  BOARDS.haThread = { title: 'Hope-Ai-' + String(w.name || 'chat') + '-' + (d.day || ''), rows: rows,
    cols: [col('at', 'Saa / Time', 'dt'), col('mode', 'Aina / Kind'), col('q', 'Swali / Question'), col('a', 'Jibu / Answer'), col('tokensIn', 'Tokens ndani / in', 'num'),
      col('tokensOut', 'Tokens nje / out', 'num'), col('ms', 'ms', 'num'), col('behind', 'Nyuma? / Behind?'), col('note', 'Maelezo / Note')] };
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
      + (x.a ? '<div style="margin:2px 0;white-space:pre-wrap"><b>Jibu / Answer:</b> ' + esc(x.a) + '</div>'
             : '<div class="mut" style="margin:2px 0">' + (x.mode === 'faq' ? 'Jibu la kawaida kutoka kwenye orodha. / A ready answer from the catalogue.' : '—') + '</div>')
      + (x.note ? '<div style="margin:2px 0;color:var(--bad);font-size:12px">' + esc(x.note) + '</div>' : '')
      + '</div>';
  });
  drawer(html, { wide: true, xls: 'haThread' });
}
