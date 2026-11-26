/* hopeai-report -- the report of the Hope Ai tab that the owner hands to a chat (handbook Part 162). A helper module of HOPE PMO's portal: it has no screen of
   its own; public/mod/hopeai.js fetches it (modLoad_) the first time the report is asked for. Plain script, no build step: every function here is a global,
   and none of them touches the page, the server or the clock: rows in, one text out, so a test can run them on made-up chats. Bump `var BUILD` in
   app.html whenever this file changes: the loader fetches it as /mod/hopeai-report.js?v=BUILD.

     "I need to always export a report you may need at that window of Hope Ai, then clear all existing history so that i may always deliver you with what
      went on (so that you tell me any concerns) and keep the db fresh."                                           -- the owner, 25 Nov 2026

   THE READER OF THIS FILE'S OUTPUT IS A CHAT, so it is written in English, as plain text, in three parts: A the counts, B what to look at first, C every typed
   question with its answer. Part B is rules in plain words (a hint is not a verdict: each says how it was found); the reader reads the chats they point to.
   Nothing here decides that an answer was wrong. Ready questions (a tap on a catalogue entry) are counted, not repeated: their answers are the catalogue's. */

var HAR_CAP = { held: 20, other: 15, gaps: 40, gapsRest: 60, idk: 30, repeated: 20, risky: 30, heavy: 10, taps: 15, teams: 30, answer: 1500, question: 600, noans: 40, noansNear: 30, noansFig: 15, matched: 30 };
var HAR_KIND = { ai: 'AI', faq: 'READY', match: 'MATCH', nomatch: 'NO ANSWER', canned: 'FIXED', limit: 'LIMIT', busy: 'BUSY' };
/* Words that say the helper did not know or could not see (Swahili and English). Found by words, so a hit may be a false one and a miss is possible. */
var HAR_IDK = /sijui|siwezi kuona|siwezi kukusaidia|siwezi kuangalia|sina taarifa|sina uwezo|sina ruhusa|haipo kwenye|i don't know|i do not know|cannot see|can't see|cannot look up|can't look up|not able to|no access|i do not have|i don't have|do not have access|unable to/i;
/* Words that look like an attempt to get the helper to break its rules. Found by words: a hint, never a verdict. */
var HAR_RISKY = /ignore (all|any|your|the|previous|prior)|disregard|system prompt|developer message|jailbreak|pretend|act as |you are now|bypass|override|reveal your|your instructions|nenosiri|password|puuza maagizo|maagizo yako|prompt/i;

function harEat_(iso) {
  var ms = Date.parse(iso);
  return isNaN(ms) ? String(iso == null ? '' : iso) : new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
function harOne_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function harClip_(s, n) { s = harOne_(s); return s.length > n ? s.slice(0, n - 3) + '...' : s; }
/** A text of several lines, kept as lines, each after the first indented under the label. */
function harBlock_(s, n, pad) {
  s = String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim();
  if (s.length > n) s = s.slice(0, n - 3) + '...';
  return s.replace(/\n/g, '\n' + (pad || '        '));
}
function harNorm_(q) { return String(q == null ? '' : q).toLowerCase().replace(/[^a-z0-9\[\]\s]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function harPerson_(thread) { return String(thread || '').replace(/:\d{4}-\d{2}-\d{2}$/, ''); }
function harTeams_(s) {
  return String(s == null ? '' : s).split(',').map(function(x){ return x.replace(/\s*\+\d+\s*$/, '').trim(); }).filter(function(x){ return x; });
}
function harNote_(note) {
  var o = { cards: '', data: '', dataRaw: '', other: [] };
  String(note == null ? '' : note).split(' \u00b7 ').forEach(function(p){
    p = harOne_(p);
    if (!p) return;
    if (p.indexOf('data: ') === 0) o.dataRaw = p.slice(6);                    // every state, for the seconds the reports took (harReads_)
    if (p.indexOf('cards: ') === 0) o.cards = p.slice(7);
    else if (p.indexOf('data: ') === 0 && !/\((late|failed)\)/.test(p)) o.data = p.slice(6);
    else o.other.push(p);
  });
  return o;
}
/** Two notes that differ only in how many seconds a report took are one kind of note ("data: calls by team (late) 15.0s" and "... 15.2s"): the seconds and the word kept are left out of the key they are grouped by. */
function harKind_(t) { return t.indexOf('data: ') === 0 ? t.replace(/ \d+(?:\.\d+)?s(?= kept|,|$)/g, '').replace(/ kept(?=,|$)/g, '') : t; }
/** The reports the helper read for a question (handbook Part 160), from the notes "data: calls by team 5.1s", "... 5.1s kept", "... (late) 15.0s", "... (failed) 1.2s". For each report: how many were made,
    how long they took, how many were kept from an earlier question, late or failed. A note of an earlier build has no seconds: it counts as made, with no time. */
function harReads_(map, dataRaw) {
  if (!dataRaw) return;
  String(dataRaw).split(', ').forEach(function(part){
    var m = /^(.+?)(?: \((late|failed)\))?(?: (\d+(?:\.\d+)?)s)?( kept)?$/.exec(harOne_(part));
    if (!m) return;
    var o = map[m[1]] || (map[m[1]] = { made: 0, kept: 0, late: 0, failed: 0, secs: [], longestLate: 0 });
    var secs = m[3] == null ? null : Number(m[3]);
    if (m[2] === 'late') { o.late++; if (secs != null && secs > o.longestLate) o.longestLate = secs; }
    else if (m[2] === 'failed') o.failed++;
    else if (m[4]) o.kept++;
    else { o.made++; if (secs != null) o.secs.push(secs); }
  });
}
function harReadsLine_(map) {
  var names = Object.keys(map).sort();
  if (!names.length) return '';
  return 'Reports the helper read for the person\'s own teams (Part 160), with the seconds each took: ' + names.map(function(k){
    var o = map[k], s = o.secs.slice().sort(function(a, b){ return a - b; }), n = s.length;
    var med = n ? (s[(n - 1) >> 1] + s[n >> 1]) / 2 : 0;
    return k + ' ' + harNum_(o.made) + ' made' + (n ? ' (median ' + med.toFixed(1) + ' s, longest ' + s[n - 1].toFixed(1) + ' s)' : '') + (o.kept ? ', ' + harNum_(o.kept) + ' kept' : '')
      + (o.late ? ', ' + harNum_(o.late) + ' late' + (o.longestLate ? ' (waited ' + o.longestLate.toFixed(1) + ' s)' : '') : '') + (o.failed ? ', ' + harNum_(o.failed) + ' failed' : '');
  }).join('; ') + '.';
}
/** The note of a typed question the ready answers handled (kinds MATCH and NO ANSWER): "agent off" or "no key or sdk", a score, "tie", "near: id, id". */
function harReadyNote_(note) {
  var o = { why: '', score: '', tie: false, figure: false, near: [] };
  String(note == null ? '' : note).split(' \u00b7 ').forEach(function(p){
    p = harOne_(p);
    if (p === 'agent off' || p === 'no key or sdk') o.why = p;
    else if (p.indexOf('score ') === 0) o.score = p.slice(6);
    else if (p === 'tie') o.tie = true;
    else if (p === 'figure') o.figure = true;
    else if (p.indexOf('near: ') === 0) o.near = p.slice(6).split(',').map(harOne_).filter(function(x){ return x; });
  });
  return o;
}
function harBump_(map, key, init) { return map[key] || (map[key] = init()); }
function harSet_(o) { return Object.keys(o).length; }
function harPct_(a, b) { return b ? Math.round(1000 * a / b) / 10 + '%' : '-'; }
function harN_(n, one, many) { return harNum_(n) + ' ' + (Number(n) === 1 ? one : (many || one + 's')); }
function harPad_(s, n, left) { s = String(s); while (s.length < n) s = left ? ' ' + s : s + ' '; return s; }
function harNum_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function harTop_(map, n, by) {
  return Object.keys(map).map(function(k){ return { k: k, v: map[k] }; }).sort(function(a, b){ return by(b.v) - by(a.v) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); }).slice(0, n);
}

/** Everything the report counts, in one pass over the rows (oldest first, as the server pages them). */
function harModel_(rows) {
  var m = { n: rows.length, kind: { ai: 0, faq: 0, match: 0, nomatch: 0, canned: 0, limit: 0, busy: 0 }, tin: 0, tout: 0, cache: 0, ms: 0, msN: 0, first: '', last: '', typed: 0,
    chats: {}, people: {}, days: {}, roles: {}, teams: {}, source: { portal: 0, call: 0 }, held: [], other: {}, gaps: {}, idk: [], noans: {}, noansNear: {}, noansFig: {}, matched: [], asked: {}, risky: [], who: {}, taps: {}, behindChats: {}, knownBehind: {}, reads: {} };
  rows.forEach(function(r){
    var mode = HAR_KIND[r.mode] ? r.mode : 'ai', day = String(r.day || '').slice(0, 10), thread = r.thread || (harOne_(r.name) + ':' + day), person = harPerson_(thread);
    m.kind[mode]++;
    m.tin += r.tokensIn || 0; m.tout += r.tokensOut || 0; m.cache += r.cacheRead || 0;
    if (r.ms > 0) { m.ms += r.ms; m.msN++; }
    if (day && (!m.first || day < m.first)) m.first = day;
    if (day && (!m.last || day > m.last)) m.last = day;
    if (r.source === 'call') m.source.call++; else m.source.portal++;
    var chat = harBump_(m.chats, thread, function(){ return { thread: thread, day: day, rows: [], at: r.at }; });
    chat.name = r.name; chat.role = r.role; chat.zone = r.zone; chat.teams = r.teams; chat.source = r.source;    // the latest the system knew
    chat.rows.push(r);
    m.people[person] = 1;
    if (r.behind === true) m.behindChats[thread] = 1;
    if (r.behind === true || r.behind === false) m.knownBehind[thread] = 1;
    var d = harBump_(m.days, day || '-', function(){ return { chats: {}, people: {}, asked: 0, ai: 0, faq: 0, none: 0, held: 0, tokens: 0 }; });
    d.chats[thread] = 1; d.people[person] = 1; d.asked++; d.tokens += (r.tokensIn || 0) + (r.tokensOut || 0);
    if (mode === 'ai') d.ai++; if (mode === 'faq' || mode === 'match') d.faq++; if (mode === 'nomatch') d.none++; if (mode === 'limit' || mode === 'busy') d.held++;
    var ro = harBump_(m.roles, harOne_(r.role) || '-', function(){ return { chats: {}, people: {}, asked: 0, ai: 0, faq: 0, none: 0, held: 0, tokens: 0 }; });
    ro.chats[thread] = 1; ro.people[person] = 1; ro.asked++; ro.tokens += (r.tokensIn || 0) + (r.tokensOut || 0);
    if (mode === 'ai') ro.ai++; if (mode === 'faq' || mode === 'match') ro.faq++; if (mode === 'nomatch') ro.none++; if (mode === 'limit' || mode === 'busy') ro.held++;
    var ts = harTeams_(r.teams); if (!ts.length) ts = ['-'];
    ts.forEach(function(t){ var te = harBump_(m.teams, t, function(){ return { chats: {}, people: {}, asked: 0 }; }); te.chats[thread] = 1; te.people[person] = 1; te.asked++; });
    var w = harBump_(m.who, person, function(){ return { name: '', role: '', tokens: 0, asked: 0, limit: 0 }; });
    w.name = r.name; w.role = r.role; w.tokens += (r.tokensIn || 0) + (r.tokensOut || 0); w.asked++; if (mode === 'limit') w.limit++;
    if (mode === 'faq') { var id = r.faq || '(no id)'; m.taps[id] = (m.taps[id] || 0) + 1; return; }
    m.typed++;
    var q = harNorm_(r.q);
    if (q && mode !== 'canned') { var a = harBump_(m.asked, q, function(){ return { n: 0, people: {}, q: r.q }; }); a.n++; a.people[person] = 1; }          // a greeting or thanks is not a need
    if (mode === 'limit' || mode === 'busy') m.held.push(r);
    if (mode === 'match' || mode === 'nomatch') {                   // handled by the ready answers: not a stop, not a failure, and never a card gap (no model was asked)
      if (mode === 'nomatch') {
        // three different things: nothing came near (a gap: write a ready answer), a ready answer was only OFFERED (two weighed alike, or a few of its words touched: widen ITS keys),
        // a figure of the person's own (refused on purpose: a ready answer is a rule and cannot give one)
        var rn0 = harReadyNote_(r.note), bucket = rn0.figure ? m.noansFig : (rn0.tie || rn0.near.length ? m.noansNear : m.noans);
        var na = harBump_(bucket, q || '(empty)', function(){ return { n: 0, people: {}, q: r.q, near: rn0.near }; }); na.n++; na.people[person] = 1;
      } else m.matched.push(r);
      if (HAR_RISKY.test(String(r.q || ''))) m.risky.push(r);
      return;
    }
    var note = harNote_(r.note);
    harReads_(m.reads, note.dataRaw);
    note.other.forEach(function(t){ var o = harBump_(m.other, harKind_(t), function(){ return { n: 0, ex: r }; }); o.n++; });
    if (mode === 'ai' && !note.cards && !note.data) {
      var g = harBump_(m.gaps, q || '(empty)', function(){ return { n: 0, people: {}, q: r.q, ex: r }; });
      g.n++; g.people[person] = 1;
    }
    if (mode === 'ai' && HAR_IDK.test(String(r.a || ''))) m.idk.push(r);
    if (HAR_RISKY.test(String(r.q || ''))) m.risky.push(r);
  });
  m.chatList = Object.keys(m.chats).map(function(k){ return m.chats[k]; });
  return m;
}

function harRowLine_(r) {
  return harEat_(r.at) + ' | ' + harClip_(r.name, 30) + ' (' + harClip_(r.role, 24) + ', ' + (r.source === 'call' ? 'HOPE Calls' : 'Portal') + ') | ' + harClip_(r.q, 110);
}
function harList_(L, items, cap, line, moreWord) {
  items.slice(0, cap).forEach(function(x, i){ L.push('  ' + (i + 1) + '. ' + line(x)); });
  if (items.length > cap) L.push('  ... and ' + (items.length - cap) + ' more ' + (moreWord || 'of the same kind') + ' (they are in part C).');
}
function harTable_(L, head, rows) {
  L.push('  ' + head);
  rows.forEach(function(r){ L.push('  ' + r); });
}

/** The report. `rows` are the server's export rows, oldest first; `meta`: { madeAt (ISO), by, upTo, total, faqLabels, lastClear, complete }. */
function harBuild_(rows, meta) {
  meta = meta || {}; rows = rows || [];
  var m = harModel_(rows), faq = meta.faqLabels || {}, L = [];
  var chats = m.chatList.length, people = harSet_(m.people);
  var behind = harSet_(m.behindChats);
  L.push('HOPE AI REPORT - what people asked Claudian-PMO, for a chat to read');
  L.push('Made: ' + harEat_(meta.madeAt) + ' (East Africa time)' + (meta.by ? ' by ' + harOne_(meta.by) : ''));
  L.push('Covers: every chat on file up to ' + (meta.upTo ? harEat_(meta.upTo) : '-') + (m.first ? ', from ' + m.first + ' to ' + m.last : '') + ' (a chat written after that moment is not in it). ' + harN_(m.n, 'row') + ': '
    + harN_(chats, 'chat') + ' of ' + harN_(people, 'person', 'people') + ', ' + harN_(m.typed, 'typed question') + ', ' + harN_(m.kind.faq, 'tap') + ' of ready questions.');
  if (meta.total != null && meta.total !== m.n) L.push('WARNING: the server counted ' + harNum_(meta.total) + ' rows when the report was drawn and ' + harNum_(m.n) + ' reached the page. The report is NOT complete; nothing should be cleared on the strength of it.');
  L.push('Earlier history: ' + (meta.lastClear ? 'cleared on ' + harEat_(meta.lastClear.at) + ' by ' + harOne_(meta.lastClear.by || '?') + ' (' + harNum_(meta.lastClear.deleted) + ' rows up to ' + harEat_(meta.lastClear.upTo) + '): this report starts after it.' : 'never cleared by this tab (or the note of it is gone): this report starts at the first chat ever kept.'));
  L.push('');
  L.push('TO THE CHAT THAT READS THIS: the owner of HOPE PMO handed you this report so that you tell them any concerns about what people asked Claudian-PMO, the helper in the corner of the portal and the call app.');
  L.push('  Read part A, then part B, then the chats in part C that B points to. Say the concerns in plain words (what the report shows, and separately what it cannot show: it holds only what was typed and answered).');
  L.push('  Change nothing unasked, and do not put this file in any repository: it holds staff names, what they asked and whatever they typed (customers\' names too, if they typed them). The answers were written by a small model: a wrong answer is a concern, not a verdict on the person.');
  L.push('');
  L.push('HOW TO READ IT');
  L.push('  A chat is one person on one day. Kinds of row: AI = the model answered a typed question; READY = a tap on a ready question (an answer from the catalogue, no model, no tokens);');
  L.push('  FIXED = a greeting or thanks answered with one word, no model; LIMIT = the person was told they had reached a limit; BUSY = the model could not answer and the person was told to try later.');
  L.push('  MATCH = a typed question answered from the best ready answer while the AI was off or had no key (no model, no tokens; the ready question it answered is named); NO ANSWER = a typed question no ready answer fitted (the person was shown the nearest ready questions).');
  L.push('  A note after a row: "cards: ..." = the knowledge cards the answer stood on; "data: ..." = the reports it read for the person\'s own teams; anything else is a stop or a failure.');
  L.push('  "Behind" = the person\'s teams were behind the company standards last week. Names, roles, zones and teams are as the system knew them when the person asked.');
  L.push('  Numbers of seven digits or more were replaced by [namba] before anything was kept. NOTHING ELSE was taken out: a customer\'s name or a short reference typed into a question is in the report as it was typed. The report holds staff names, what they asked and whatever they typed: share it only where it is meant.');
  L.push('  In the tables, ready = READY taps + MATCH answers (a typed question answered from a ready answer), none = NO ANSWER, held = LIMIT + BUSY.');
  L.push('  Part B is hints found by plain rules (each says how it was found), not conclusions.');
  L.push('');
  L.push('PART A - THE COUNTS');
  L.push('  Rows ' + harNum_(m.n) + ': AI ' + harNum_(m.kind.ai) + ', READY ' + harNum_(m.kind.faq) + ', MATCH ' + harNum_(m.kind.match) + ', NO ANSWER ' + harNum_(m.kind.nomatch) + ', FIXED ' + harNum_(m.kind.canned) + ', LIMIT ' + harNum_(m.kind.limit) + ', BUSY ' + harNum_(m.kind.busy)
    + '. Where: Portal ' + harNum_(m.source.portal) + ', HOPE Calls ' + harNum_(m.source.call) + '.');
  L.push('  Tokens: ' + harNum_(m.tin) + ' in, ' + harNum_(m.tout) + ' out, ' + harNum_(m.cache) + ' read from cache.' + (m.msN ? ' Average answer time ' + harNum_(m.ms / m.msN) + ' ms.' : ''));
  var readsLine = harReadsLine_(m.reads);
  if (readsLine) L.push('  ' + readsLine);
  var noansTotal = function(o){ return Object.keys(o).reduce(function(s, k){ return s + o[k].n; }, 0); };
  L.push('  NO ANSWER ' + harNum_(m.kind.nomatch) + ' = nothing came near ' + harNum_(noansTotal(m.noans)) + ', a ready answer was only offered ' + harNum_(noansTotal(m.noansNear)) + ', a figure of the person\'s own ' + harNum_(noansTotal(m.noansFig)) + ' (B9, B9b, B9c).');
  var knownN = harSet_(m.knownBehind);
  L.push('  Chats of teams that were behind last week: ' + harNum_(behind) + ' of ' + harNum_(chats) + ' (' + harPct_(behind, chats) + '); the standing was known for ' + harNum_(knownN) + ' of them' + (knownN < chats ? ' (it is read only when the model answers a typed question)' : '') + '.');
  L.push('');
  L.push('  By day (newest first)');
  harTable_(L, 'day        chats people asked   AI  ready none held tokens', Object.keys(m.days).sort().reverse().map(function(k){
    var d = m.days[k]; return harPad_(k, 10) + ' ' + harPad_(harSet_(d.chats), 5, 1) + ' ' + harPad_(harSet_(d.people), 6, 1) + ' ' + harPad_(d.asked, 5, 1) + ' ' + harPad_(d.ai, 4, 1) + ' ' + harPad_(d.faq, 5, 1) + ' ' + harPad_(d.none, 4, 1) + ' ' + harPad_(d.held, 4, 1) + ' ' + harPad_(harNum_(d.tokens), 8, 1);
  }));
  L.push('');
  L.push('  By role');
  harTable_(L, 'role                          chats people asked   AI  ready none held tokens', harTop_(m.roles, 60, function(v){ return v.asked; }).map(function(e){
    var d = e.v; return harPad_(harClip_(e.k, 28), 29) + ' ' + harPad_(harSet_(d.chats), 5, 1) + ' ' + harPad_(harSet_(d.people), 6, 1) + ' ' + harPad_(d.asked, 5, 1) + ' ' + harPad_(d.ai, 4, 1) + ' ' + harPad_(d.faq, 5, 1) + ' ' + harPad_(d.none, 4, 1) + ' ' + harPad_(d.held, 4, 1) + ' ' + harPad_(harNum_(d.tokens), 8, 1);
  }));
  L.push('');
  var teamTop = harTop_(m.teams, HAR_CAP.teams, function(v){ return v.asked; });
  L.push('  By team (a person with several teams counts under each' + (harSet_(m.teams) > teamTop.length ? '; the ' + teamTop.length + ' busiest of ' + harSet_(m.teams) : '') + ')');
  harTable_(L, 'team                          chats people asked', teamTop.map(function(e){
    return harPad_(harClip_(e.k, 28), 29) + ' ' + harPad_(harSet_(e.v.chats), 5, 1) + ' ' + harPad_(harSet_(e.v.people), 6, 1) + ' ' + harPad_(e.v.asked, 5, 1);
  }));
  L.push('');
  L.push('PART B - LOOK AT THESE FIRST (found by plain rules; read the chats they point to in part C)');
  // B1
  L.push('B1. Told to try later (LIMIT or BUSY): ' + harN_(m.held.length, 'question') + ' by ' + harN_(harSet_(m.held.reduce(function(o, r){ o[harPerson_(r.thread)] = 1; return o; }, {})), 'person', 'people') + '. Found by: the row\'s kind.');
  harList_(L, m.held.slice().reverse(), HAR_CAP.held, function(r){ return '[' + (r.mode === 'limit' ? 'LIMIT' : 'BUSY') + '] ' + harRowLine_(r); }, 'rows');
  // B2
  var other = harTop_(m.other, 200, function(v){ return v.n; });
  L.push('B2. Stops and failures written in a note (anything that is not a card or a report): ' + harN_(other.length, 'kind') + ', ' + harN_(other.reduce(function(s, e){ return s + e.v.n; }, 0), 'row') + '. Found by: the note\'s own words.');
  harList_(L, other, HAR_CAP.other, function(e){ return e.v.n + 'x  "' + harClip_(e.k, 160) + '"  first seen ' + harEat_(e.v.ex.at) + ' (' + harClip_(e.v.ex.name, 24) + ')'; }, 'kinds');
  // B3
  var gaps = harTop_(m.gaps, 500, function(v){ return v.n; });
  var aiN = m.kind.ai, gapN = gaps.reduce(function(s, e){ return s + e.v.n; }, 0);
  L.push('B3. Typed questions the model answered with NO knowledge card and NO report behind them (the likeliest gaps in what Claudian knows): ' + harNum_(gapN) + ' of ' + harN_(aiN, 'AI answer') + ' (' + harPct_(gapN, aiN) + '). Found by: the note has neither "cards:" nor "data:". Most asked first.');
  harList_(L, gaps, HAR_CAP.gaps, function(e){ return e.v.n + 'x by ' + harSet_(e.v.people) + ' people: ' + harClip_(e.v.q, 160); }, 'questions');
  // B4
  L.push('B4. AI answers that say the helper did not know or could not see something: ' + harNum_(m.idk.length) + '. Found by words only (Swahili and English), so there may be false hits and misses.');
  harList_(L, m.idk.slice().reverse(), HAR_CAP.idk, function(r){ return harRowLine_(r) + '\n       -> ' + harClip_(r.a, 200); }, 'answers');
  // B5
  var rep = harTop_(m.asked, 500, function(v){ return v.n; }).filter(function(e){ return e.v.n >= 2 && harSet_(e.v.people) >= 2; });
  L.push('B5. The same question typed by several people (what people most need answered): ' + harN_(rep.length, 'question') + '. Found by: the question\'s words, lower-cased and without punctuation, asked at least twice by at least two people.');
  harList_(L, rep, HAR_CAP.repeated, function(e){ return e.v.n + 'x by ' + harSet_(e.v.people) + ' people: ' + harClip_(e.v.q, 160); }, 'questions');
  // B6
  L.push('B6. Questions that look like an attempt to get the helper to break its rules or to reveal its instructions: ' + harNum_(m.risky.length) + '. Found by words only (ignore, system prompt, password, pretend, bypass...): most are harmless.');
  harList_(L, m.risky.slice().reverse(), HAR_CAP.risky, harRowLine_, 'rows');
  // B7
  var heavy = harTop_(m.who, HAR_CAP.heavy, function(v){ return v.tokens; }).filter(function(e){ return e.v.tokens > 0; });
  var hitters = Object.keys(m.who).filter(function(k){ return m.who[k].limit > 0; });
  L.push('B7. Who used the most tokens (the ' + harN_(heavy.length, 'heaviest', 'heaviest') + '), and who reached the daily limit (' + harN_(hitters.length, 'person', 'people') + '). Found by: the sum of tokens, and rows of kind LIMIT.');
  harList_(L, heavy, HAR_CAP.heavy, function(e){ return harClip_(e.v.name, 30) + ' (' + harClip_(e.v.role, 24) + '): ' + harNum_(e.v.tokens) + ' tokens in ' + e.v.asked + ' rows' + (e.v.limit ? ', told of the limit ' + e.v.limit + 'x' : ''); }, 'people');
  // B8
  var taps = harTop_(m.taps, 100, function(v){ return v; });
  L.push('B8. Ready questions tapped: ' + harN_(m.kind.faq, 'tap') + ' of ' + harN_(taps.length, 'different one') + (taps.length > HAR_CAP.taps ? ' (the ' + HAR_CAP.taps + ' most tapped)' : '') + '.');
  harList_(L, taps, HAR_CAP.taps, function(e){ var f = faq[e.k]; return e.v + 'x  ' + (f ? f.en + ' / ' + f.sw : e.k); }, 'ready questions');
  // B9: three lists, because a NO ANSWER is three different things
  var noans = harTop_(m.noans, 500, function(v){ return v.n; });
  L.push('B9. Typed questions NOTHING in the ready list came near (the AI was off or had no key): ' + harNum_(noansTotal(m.noans)) + ' of ' + harN_(noans.length, 'kind') + '. Found by: the row\'s kind NO ANSWER, with no nearest ready question and no figure asked for. THESE are the questions to write NEW ready answers for. Most asked first.');
  harList_(L, noans, HAR_CAP.noans, function(e){ return e.v.n + 'x by ' + harSet_(e.v.people) + ' people: ' + harClip_(e.v.q, 160); }, 'questions');
  var noansNear = harTop_(m.noansNear, 500, function(v){ return v.n; });
  L.push('B9b. Typed questions a ready answer was only OFFERED for (two weighed alike, or a few of its words touched): ' + harNum_(noansTotal(m.noansNear)) + ' of ' + harN_(noansNear.length, 'kind') + '. Found by: the row\'s note has "near:" or "tie". These need the words of an EXISTING ready answer widened, not a new answer: the first one named is the nearest.');
  harList_(L, noansNear, HAR_CAP.noansNear, function(e){ var f0 = e.v.near[0] ? faq[e.v.near[0]] : null; return e.v.n + 'x by ' + harSet_(e.v.people) + ' people: ' + harClip_(e.v.q, 120) + (f0 ? '  [nearest: ' + harClip_(f0.en, 60) + ']' : ''); }, 'questions');
  var noansFig = harTop_(m.noansFig, 500, function(v){ return v.n; });
  L.push('B9c. Typed questions that ask for a figure of the person\'s OWN: ' + harNum_(noansTotal(m.noansFig)) + ' of ' + harN_(noansFig.length, 'kind') + '. Found by: the row\'s note has "figure". Refused on purpose (a ready answer is a rule and cannot give a number); not a gap. With the AI on, the reports answer them.');
  harList_(L, noansFig, HAR_CAP.noansFig, function(e){ return e.v.n + 'x by ' + harSet_(e.v.people) + ' people: ' + harClip_(e.v.q, 160); }, 'questions');
  // B10
  L.push('B10. Typed questions answered from a ready answer (MATCH): ' + harNum_(m.matched.length) + '. Found by: the row\'s kind MATCH. Check that each answer is the one asked for: a wrong one is a concern about the matching words, not about the person.');
  harList_(L, m.matched.slice().reverse(), HAR_CAP.matched, function(r){ var f = faq[r.faq]; return harRowLine_(r) + '\n       -> ' + (f ? f.en : (r.faq || '?')); }, 'rows');
  L.push('');
  L.push('PART C - EVERY CHAT (newest day first). Ready questions are counted on the chat\'s line, not repeated.');
  var byDay = {};
  m.chatList.forEach(function(c){ (byDay[c.day] = byDay[c.day] || []).push(c); });
  Object.keys(byDay).sort().reverse().forEach(function(day){
    byDay[day].sort(function(a, b){ return String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : 0; }).forEach(function(c){
      var rowsOf = c.rows, typed = rowsOf.filter(function(r){ return r.mode !== 'faq'; }), taps2 = rowsOf.length - typed.length;
      var tok = rowsOf.reduce(function(s, r){ return s + (r.tokensIn || 0) + (r.tokensOut || 0); }, 0);
      var isBehind = !!m.behindChats[c.thread];
      L.push('');
      L.push('== ' + day + ' | ' + harClip_(c.name, 40) + ' | ' + harClip_(c.role, 30) + ' | ' + harClip_(c.zone, 24) + ' | teams: ' + harClip_(c.teams, 80) + ' | ' + (c.source === 'call' ? 'HOPE Calls' : 'Portal')
        + ' | ' + rowsOf.length + ' rows, tokens ' + harNum_(tok) + (isBehind ? ' | BEHIND last week' : '') + (taps2 ? ' | ' + taps2 + ' ready tap' + (taps2 === 1 ? '' : 's') : ''));
      var tapNames = {};
      rowsOf.forEach(function(r){ if (r.mode === 'faq') { var f = faq[r.faq]; var nm = f ? f.en : (r.faq || r.q); tapNames[nm] = (tapNames[nm] || 0) + 1; } });
      var tn = Object.keys(tapNames); if (tn.length) L.push('   ready: ' + tn.map(function(k){ return harClip_(k, 70) + (tapNames[k] > 1 ? ' x' + tapNames[k] : ''); }).join('; '));
      typed.forEach(function(r){
        var note = harNote_(r.note);
        L.push('   ' + harEat_(r.at).slice(11) + ' ' + HAR_KIND[r.mode] + (r.tokensIn || r.tokensOut ? ' tokens ' + harNum_(r.tokensIn) + '>' + harNum_(r.tokensOut) : '') + (r.ms ? ' ' + harNum_(r.ms) + 'ms' : ''));
        L.push('     Q: ' + harBlock_(r.q, HAR_CAP.question));
        if (r.mode === 'match' || r.mode === 'nomatch') {
          var rn = harReadyNote_(r.note), f = r.faq ? faq[r.faq] : null;
          if (r.mode === 'match') L.push('     A (ready answer to: ' + harClip_(f ? f.en : (r.faq || '?'), 90) + '): ' + harBlock_(r.a || '(no answer text)', HAR_CAP.answer));
          else L.push('     A: (no ready answer fitted)' + (rn.tie ? ' (two ready answers weighed alike)' : '') + (rn.figure ? ' (the question asks for a figure of the person\'s own: a ready answer is a rule and cannot give one)' : ''));
          if (rn.near.length) L.push('     nearest ready questions: ' + rn.near.map(function(id){ return harClip_(faq[id] ? faq[id].en : id, 60); }).join('; '));
          return;
        }
        L.push('     A: ' + harBlock_(r.a || '(no answer text)', HAR_CAP.answer));
        if (note.cards) L.push('     cards: ' + note.cards);
        if (note.data) L.push('     data: ' + note.data);
        note.other.forEach(function(t){ L.push('     NOTE: ' + t); });
      });
    });
  });
  L.push('');
  L.push('END OF REPORT: ' + harN_(chats, 'chat') + ', ' + harN_(m.n, 'row') + ', ' + harN_(m.typed, 'typed question') + '. If this line is missing the file was cut short.');
  return L.join('\n') + '\n';
}
