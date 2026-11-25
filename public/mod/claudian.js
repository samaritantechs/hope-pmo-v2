/* MODULE: claudian -- CLAUDIAN-PMO, the helper in the corner of HOPE PMO and of HOPE Calls (handbook Part 156).

     "Please add an Ai floating bubble in both calls and system UI - that one could drag anywhere to their screen's position ..."
     "In settings- give a switch button to switch it on or off, when I switch the agen off, it shifts to FAQs only that are choices and
      answers a role could ask and get answers but when the agent is on - it answers with Hope and System knowledge as Ai."
     "CLAUDIAN-PMO should never behave like Ai ask if there is anything else someone needs to ask you know we protecting development tokens"
                                                                                          -- the owner, 25 Nov 2026

   ONE FILE, TWO PAGES. The portal loads it with modLoad_('claudian') and HOPE Calls with a script tag, each some seconds AFTER it is
   open and signed in, never before: a page that cannot load it simply has no bubble (CLAUDE.md section 1: the call app never waits for
   anything of this). It makes NO request until somebody taps the bubble, and what it asks for is /api/claudian, a function of its own.

   WHAT IT DRAWS: a round bubble (the HOPE Ai icon) that is dragged to any place on the screen and stays there (its place is kept as a
   fraction of the screen, so a turned phone or a resized window puts it back inside); a tap opens a panel: the ready questions as
   choices, and, only when the helper is switched ON, a box to type a question. The panel draws nothing the server did not send and
   NEVER adds a closing offer or question of its own (the owner's order: it answers and stops). Every answer is put on the screen as
   TEXT (textContent), never as markup.

   IT LIVES IN A SHADOW ROOT: the pages' own styles cannot reach it and its styles cannot reach them. A browser with no shadow roots gets
   no bubble. The page that mounts it hands over: code() or device() (who is asking), lang() ('sw' or 'en'), z (its layer), base (the
   API's address when it is not this site's own), host ('portal' or 'call').
   ES5, no libraries, no build step. */
(function () {
  'use strict';
  if (window.ClaudianPMO) return;

  var SIZE = 56;                 // the bubble's diameter, in pixels
  var EDGE = 8;                  // never nearer than this to the screen's edge
  var TAP_PX = 6;                // a press that moves less than this is a tap, not a drag
  var WIDE = 560;                // at or under this width the panel is a sheet across the bottom of the screen
  var TIMEOUT_MS = 35000;        // the server gives the model 25 seconds
  var MAX_Q = 400;               // the server cuts a question here too
  var MAX_MSGS = 40;             // the panel keeps the last forty lines
  var STATUS_FRESH_MS = 60000;   // the ready questions and the switch are asked again when the panel is opened after this long
  var TAIL_MS = 450;             // after a touch tap toggles the panel, the mouse events and the click that follow it are swallowed for this long ...
  var TAIL_PX = 24;              // ... if they are aimed this near the place of the tap

  /* THE WORDS. Swahili first; the panel follows the page's own language (and the SW / EN button in its header changes it for this sitting). */
  var T = {
    sw: {
      open: 'Fungua msaidizi Claudian-PMO',
      close: 'Funga',
      move: 'Buruta kuhamisha',
      home: 'Rudisha kwenye kona',
      subAi: 'Uliza swali kuhusu HOPE PMO',
      subFaq: 'Majibu ya maswali ya kawaida',
      welcomeAi: 'Andika swali kuhusu HOPE PMO, au chagua moja hapa chini.',
      welcomeFaq: 'Andika swali lako au chagua moja hapa chini. Claudian-PMO inajibu maswali ya kawaida tu kwa sasa.',
      ready: 'Maswali ya kawaida',
      matched: 'Jibu la swali la kawaida:',
      near: 'Karibu na:',
      ph: 'Andika swali lako…',
      send: 'Tuma',
      left: 'Maswali yaliyobaki leo: {n}',
      thinking: 'Inafikiri…',
      loading: 'Inapakia…',
      net: 'Hakuna mtandao. Jaribu tena baadaye.',
      srv: 'Msaidizi ana hitilafu kwa sasa. Jaribu tena baadaye.',
      gone: 'Msaidizi hapatikani kwa akaunti hii.',
      lang: 'EN'
    },
    en: {
      open: 'Open the Claudian-PMO helper',
      close: 'Close',
      move: 'Drag to move',
      home: 'Back to the corner',
      subAi: 'Ask a question about HOPE PMO',
      subFaq: 'Answers to the standard questions',
      welcomeAi: 'Type a question about HOPE PMO, or pick one below.',
      welcomeFaq: 'Type your question or pick one below. Claudian-PMO answers the standard questions only for now.',
      ready: 'Ready questions',
      matched: 'Ready answer to:',
      near: 'Closest:',
      ph: 'Type your question…',
      send: 'Send',
      left: 'Questions left today: {n}',
      thinking: 'Thinking…',
      loading: 'Loading…',
      net: 'No connection. Try again later.',
      srv: 'The helper has a fault right now. Try again later.',
      gone: 'The helper is not available for this account.',
      lang: 'SW'
    }
  };

  /* The HOPE Ai icon (docs/brand/HOPE-Ai-icon.svg: the same drawing, held equal to it by a test), drawn once for the bubble and once, with another id, for the header.
     The letters of HOPE Ai are bent along the round face: each stays whole and stands upright toward the centre of a circle. */
  var ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="61 58 390 390" aria-hidden="true" focusable="false">'
    + '<defs><clipPath id="HEADID"><path d="M256 64C334 64 388 124 388 208C388 262 366 308 348 336C340 356 334 368 322 378C304 392 280 394 256 394C232 394 208 392 190 378C178 368 172 356 164 336C146 308 124 262 124 208C124 124 178 64 256 64Z"/></clipPath></defs>'
    + '<rect x="88" y="188" width="28" height="100" rx="14" fill="#0B2A6B"/><rect x="95" y="200" width="9" height="62" rx="4.5" fill="#93C5FD"/>'
    + '<rect x="396" y="188" width="28" height="100" rx="14" fill="#0B2A6B"/><rect x="408" y="200" width="9" height="62" rx="4.5" fill="#93C5FD"/>'
    + '<path d="M222 399Q256 405 290 399C288 418 278 430 262 438Q256 442 250 438C234 430 224 418 222 399Z" fill="#0B2A6B"/>'
    + '<path d="M256 64C334 64 388 124 388 208C388 262 366 308 348 336C340 356 334 368 322 378C304 392 280 394 256 394C232 394 208 392 190 378C178 368 172 356 164 336C146 308 124 262 124 208C124 124 178 64 256 64Z" fill="#1D4ED8"/>'
    + '<g clip-path="url(#HEADID)"><path d="M110 250Q256 326 402 250V400H110Z" fill="#0B2A6B"/><path d="M110 250Q256 326 402 250" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/></g>'
    + '<path d="M178 108C158 124 146 150 142 182" fill="none" stroke="#FFFFFF" stroke-opacity=".85" stroke-width="6" stroke-linecap="round"/>'
    + '<ellipse cx="204" cy="206" rx="17" ry="24" fill="#FFFFFF"/><ellipse cx="308" cy="206" rx="17" ry="24" fill="#FFFFFF"/>'
    + '<g fill="none" stroke="#FFFFFF" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round">'
    + '<g transform="translate(190.8 320.1) rotate(25.8) scale(.95) translate(-11 -15)"><path d="M0 0V30M22 0V30M0 15H22"/></g>'
    + '<g transform="translate(218.4 330.2) rotate(14.5) scale(.95) translate(-42 -15)"><ellipse cx="42" cy="15" rx="11" ry="15"/></g>'
    + '<g transform="translate(247.5 334.8) rotate(3.3) scale(.95) translate(-73 -15)"><path d="M62 30V0H75A9 9 0 0 1 75 18H62"/></g>'
    + '<g transform="translate(276.8 333.5) rotate(-8) scale(.95) translate(-104 -15)"><path d="M115 0H93V30H115M93 15H110"/></g>'
    + '<g transform="translate(313.4 323.6) rotate(-22.5) scale(.95) translate(-144 -15)"><path d="M133 30L144 0L155 30M137.5 19H150.5"/></g>'
    + '<g transform="translate(330.4 315.2) rotate(-29.8) scale(.95) translate(-164 -15)"><path d="M164 11V30"/><circle cx="164" cy="2" r="3.4" fill="#93C5FD" stroke="none"/></g>'
    + '</g></svg>';

  var CSS = [
    ':host{all:initial;position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
    '*{box-sizing:border-box}',
    '.root{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;',
    '--card:#fff;--ink:#0F172A;--mut:#64748B;--line:#D5DEEC;--chip:#EFF6FF;--chipink:#1D4ED8;--ua:#1D4ED8;--aa:#F1F5F9;--hint:#FEF3C7;--hintink:#92400E;--bad:#FEE2E2;--badink:#991B1B}',
    '.root.dark{--card:#131C2E;--ink:#E5EAF2;--mut:#8B9AB3;--line:#22304A;--chip:#10244A;--chipink:#93C5FD;--ua:#2563EB;--aa:#1B2740;--hint:#3A2F10;--hintink:#FCD34D;--bad:#3B1515;--badink:#FCA5A5}',
    '.bub{position:absolute;left:0;top:0;width:56px;height:56px;margin:0;padding:0;border:0;border-radius:14px;background:none;cursor:grab;pointer-events:auto;',
    'touch-action:none;display:block;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}',
    '.bub:focus-visible{outline:3px solid #1D4ED8;outline-offset:2px}',
    '.root.dark .bub:focus-visible{outline-color:#93C5FD}',
    '.bub.drag{cursor:grabbing;transform:scale(1.07)}',
    '.bub.away{visibility:hidden}',
    '.bub svg{width:100%;height:100%;display:block;pointer-events:none;filter:drop-shadow(0 4px 5px rgba(8,28,74,.5))}',
    '.root.dark .bub svg{filter:drop-shadow(0 0 1.5px rgba(255,255,255,.85)) drop-shadow(0 4px 5px rgba(0,0,0,.6))}',
    '@media (prefers-reduced-motion:no-preference){.bub.pulse svg{animation:cpulse 1.6s ease-out 3}@keyframes cpulse{0%{filter:drop-shadow(0 0 0 rgba(29,78,216,.9))}100%{filter:drop-shadow(0 0 16px rgba(29,78,216,0))}}}',
    '.panel{position:absolute;display:none;flex-direction:column;pointer-events:auto;width:380px;max-height:540px;background:var(--card);color:var(--ink);',
    'border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 60px -20px rgba(8,28,74,.7);overflow:hidden;font-size:14px;line-height:1.4}',
    '.panel.open{display:flex}',
    '.panel.sheet{width:auto;max-height:none}',
    '.hd{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);background:linear-gradient(90deg,#0B2A6B,#1D4ED8);color:#fff;flex:none}',
    '.hd .ico{width:36px;height:36px;flex:none}',
    '.hd .ico svg{width:100%;height:100%;display:block}',
    '.hd .ttl{flex:1;min-width:0;display:flex;flex-direction:column}',
    '.hd .ttl b{font-size:15px;letter-spacing:.2px}',
    '.hd .ttl small{font-size:11.5px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hd button{font:inherit;color:#fff;background:rgba(255,255,255,.16);border:0;border-radius:8px;min-width:34px;height:30px;padding:0 8px;cursor:pointer;font-weight:700}',
    '.hd button:hover{background:rgba(255,255,255,.28)}',
    '.hd button:focus-visible{outline:2px solid #fff;outline-offset:1px}',
    '.body{position:relative;flex:1;min-height:90px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}',
    '.m{max-width:88%;padding:8px 11px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}',
    '.m.u{align-self:flex-end;background:var(--ua);color:#fff;border-bottom-right-radius:4px}',
    '.m.a{align-self:flex-start;background:var(--aa);color:var(--ink);border-bottom-left-radius:4px}',
    '.m.h{align-self:flex-start;background:var(--hint);color:var(--hintink);border-bottom-left-radius:4px}',
    '.m.e{align-self:flex-start;background:var(--bad);color:var(--badink);border-bottom-left-radius:4px}',
    '.m.w{align-self:stretch;max-width:100%;background:none;color:var(--mut);padding:2px 2px 0;font-size:13px}',
    '.m.t{align-self:flex-start;background:none;color:var(--mut);font-style:italic}',
    '.m.near{display:flex;flex-direction:column;gap:6px}',
    'details.faq{flex:none;border-top:1px dashed var(--line);padding-top:6px}',
    'details.faq summary{cursor:pointer;color:var(--mut);font-size:12.5px;font-weight:700;padding:2px 0 6px;list-style-position:inside}',
    '.chips{display:flex;flex-wrap:wrap;gap:6px;max-height:210px;overflow-y:auto;padding-bottom:2px}',
    '.chips.full{max-height:none;overflow-y:visible}',
    '.chip{font:inherit;font-size:13px;text-align:left;background:var(--chip);color:var(--chipink);border:1px solid var(--line);border-radius:999px;padding:6px 11px;cursor:pointer}',
    '.chip:hover{border-color:var(--chipink)}',
    '.chip:disabled{opacity:.55;cursor:default}',
    '.chip:focus-visible,.send:focus-visible,textarea:focus-visible{outline:2px solid #3B82F6;outline-offset:1px}',
    '.ft{display:flex;flex:none;gap:8px;padding:8px 10px;border-top:1px solid var(--line);align-items:flex-end}',
    '.ft textarea{flex:1;resize:none;font:inherit;font-size:14px;color:var(--ink);background:var(--card);border:1.5px solid var(--line);border-radius:12px;padding:8px 10px;max-height:96px;min-height:38px}',
    '.send{font:inherit;font-weight:700;color:#fff;background:#1D4ED8;border:0;border-radius:12px;height:38px;padding:0 14px;cursor:pointer}',
    '.send:disabled{opacity:.55;cursor:default}',
    '.mt{display:flex;justify-content:space-between;align-items:center;gap:8px;flex:none;padding:4px 12px 8px;color:var(--mut);font-size:11.5px}',
    '.mt button{font:inherit;font-size:11.5px;color:var(--mut);background:none;border:0;cursor:pointer;text-decoration:underline;padding:2px}',
    '@media print{:host{display:none}}'
  ].join('');

  /* ---------------- pure helpers: position and text (exported for the tests) ---------------- */
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function bounds(vw, vh) { return { minX: EDGE, minY: EDGE, maxX: Math.max(EDGE, vw - SIZE - EDGE), maxY: Math.max(EDGE, vh - SIZE - EDGE) }; }
  /** The nearest place on the screen where the whole bubble still shows. */
  function clampPos(x, y, vw, vh) { var b = bounds(vw, vh); return { x: Math.round(clamp(+x || 0, b.minX, b.maxX)), y: Math.round(clamp(+y || 0, b.minY, b.maxY)) }; }
  /** A place as a fraction of the room the bubble can move in: what is kept, so a turned phone or a resized window keeps the bubble inside. */
  function toFrac(x, y, vw, vh) {
    var b = bounds(vw, vh), w = b.maxX - b.minX, h = b.maxY - b.minY;
    return { fx: w > 0 ? clamp((x - b.minX) / w, 0, 1) : 1, fy: h > 0 ? clamp((y - b.minY) / h, 0, 1) : 1 };
  }
  function fromFrac(f, vw, vh) { var b = bounds(vw, vh); return clampPos(b.minX + f.fx * (b.maxX - b.minX), b.minY + f.fy * (b.maxY - b.minY), vw, vh); }
  /** A press that moved less than TAP_PX (as the crow flies) is a tap. */
  function isTap(dx, dy) { return dx * dx + dy * dy < TAP_PX * TAP_PX; }
  function defaultPos(vw, vh, host) { return clampPos(vw - SIZE - 12, vh - SIZE - (host === 'call' ? 100 : 92), vw, vh); }
  function trimQ(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAX_Q); }
  function fillN(t, n) { return String(t).replace('{n}', String(n)); }

  /* ---------------- the state ---------------- */
  var st = {
    mounted: false, opts: null, host: null, root: null, e: {}, pos: null, frac: null, open: false, busy: false,
    status: null, statusAt: 0, statusLang: '', userLang: null, langAtToggle: '', hist: null, ticket: 0, sess: 0, pulsed: false
  };

  function posKey() { return 'claudianPos.' + ((st.opts && st.opts.host) || 'portal'); }
  function readFrac() {
    try {
      var o = JSON.parse(localStorage.getItem(posKey()) || 'null');
      if (o && isFinite(o.fx) && isFinite(o.fy)) return { fx: clamp(+o.fx, 0, 1), fy: clamp(+o.fy, 0, 1) };
    } catch (e) { /* private window, blocked storage: the default place */ }
    return null;
  }
  function writeFrac(f) { try { localStorage.setItem(posKey(), JSON.stringify({ fx: Math.round(f.fx * 10000) / 10000, fy: Math.round(f.fy * 10000) / 10000 })); } catch (e) { /* kept for this sitting only */ } }
  function dropFrac() { try { localStorage.removeItem(posKey()); } catch (e) { /* nothing to drop */ } }

  function hostLang() { try { return st.opts && st.opts.lang && st.opts.lang() === 'en' ? 'en' : 'sw'; } catch (e) { return 'sw'; } }
  /** The page's own language, unless somebody pressed SW / EN in the panel and the page's language has not moved since. */
  function lang() { var h = hostLang(); if (st.userLang && st.langAtToggle === h) return st.userLang; st.userLang = null; return h; }
  function tr(k) { return T[lang()][k]; }

  function isDark() {
    try {
      var b = document.body;
      if (b.classList.contains('dark')) return true;
      var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(b).backgroundColor || '');
      if (!m || (m[4] !== undefined && +m[4] === 0)) return false;
      return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) < 110;
    } catch (e) { return false; }
  }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  /* ---------------- the request ---------------- */
  function api(op, extra) {
    var o = st.opts, body = { op: op, lang: lang() }, k;
    if (typeof o.device === 'function') body.device = o.device(); else body.code = o.code();
    for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    return fetch((o.base || '') + '/api/claudian', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (j) { return j || {}; }, function () { return {}; }).then(function (j) {
        if (!r.ok || j.ok === false) { var err = new Error(j.error || 'error'); err.status = r.status; throw err; }
        return j;
      });
    }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ---------------- the panel's lines ---------------- */
  function lines() { var out = [], c = st.e.body.children, i; for (i = 0; i < c.length; i++) if (/(^| )m( |$)/.test(c[i].className)) out.push(c[i]); return out; }
  function addMsg(kind, text) {
    var m = el('div', 'm ' + kind, text);
    st.e.body.insertBefore(m, st.e.faq);
    var all = lines(); while (all.length > MAX_MSGS) st.e.body.removeChild(all.shift());
    // an answer is read from its first line; what somebody typed is shown at the bottom
    if (kind === 'u') st.e.body.scrollTop = st.e.body.scrollHeight; else st.e.body.scrollTop = Math.max(0, m.offsetTop - 12);
    return m;
  }
  function thinking(on, text) {
    if (st.e.think && st.e.think.parentNode) st.e.think.parentNode.removeChild(st.e.think);
    st.e.think = null;
    if (!on) return;
    st.e.think = el('div', 'm t', text || tr('thinking'));
    st.e.body.insertBefore(st.e.think, st.e.faq);
    st.e.body.scrollTop = st.e.body.scrollHeight;
  }
  /** Everything of one person's conversation, forgotten: the lines, what the server last said (the list of ready questions, the questions left), the last exchange that rides with the
      next question, an answer still on its way (its callbacks see a new session and stay out of the panel). Signing out of HOPE Calls runs it: the handset is shared, and the next
      officer must not meet the last one's questions and answers, or send them to the model as the PREVIOUS EXCHANGE (the second reader of Part 163). */
  function forget() {
    st.sess++; st.ticket++;
    st.hist = null; st.status = null; st.statusAt = 0;
    if (!st.mounted) return;
    if (st.open) closePanel();
    var all = lines(), i; for (i = 0; i < all.length; i++) if (all[i] !== st.e.welcome) st.e.body.removeChild(all[i]);
    thinking(false); setBusy(false);
    st.e.ta.value = ''; fitBox();
    paintMode();
  }
  /** After an answer, a person who works the keyboard is where they were: a chip is disabled while the question is on its way, and a disabled button drops the focus. A touch screen is left
      alone (focusing the box would raise the keyboard by itself), and so is anybody who has already gone somewhere else. */
  function regainFocus() {
    try {
      if (!st.open) return;
      var sr = st.e.root.getRootNode ? st.e.root.getRootNode() : null, ae = sr && sr.activeElement;
      if (ae && ae !== st.e.bub && ae !== st.e.body) return;
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
      st.e.ta.focus();
    } catch (e) { /* focus is a nicety */ }
  }
  function setBusy(b) {
    st.busy = b;
    st.e.send.disabled = b;
    var c = st.e.body.querySelectorAll('.chip'), i; for (i = 0; i < c.length; i++) c[i].disabled = b;
  }
  /** The nearest ready questions to what was typed, as a line of their own in the conversation: a tap asks one of them, exactly as a tap on the list does. */
  function addNear(list) {
    var box = el('div', 'm w near'), row = el('div', 'chips full');
    box.appendChild(el('div', null, tr('near')));
    (list || []).forEach(function (c) {
      var b = el('button', 'chip', c.q); b.type = 'button'; b.setAttribute('data-id', c.id);
      b.onclick = function () { askFaq(c); };
      row.appendChild(b);
    });
    box.appendChild(row);
    st.e.body.insertBefore(box, st.e.faq);
    var all = lines(); while (all.length > MAX_MSGS) st.e.body.removeChild(all.shift());
    return box;
  }
  function drawChips(list) {
    var box = st.e.chips; box.textContent = '';
    box.className = 'chips' + (st.status && st.status.ai ? '' : ' full');          // with the helper off the ready questions are the whole of it: no height limit
    (list || []).forEach(function (c) {
      var b = el('button', 'chip', c.q); b.type = 'button'; b.setAttribute('data-id', c.id);
      b.onclick = function () { askFaq(c); };
      box.appendChild(b);
    });
    st.e.faq.style.display = list && list.length ? '' : 'none';
    st.e.faq.open = !(st.status && st.status.ai);          // the ready questions are the whole of it when the helper is off
  }
  /** The words in the header and the box follow the switch the server reported and the language of the moment. */
  function paintMode() {
    var ai = !!(st.status && st.status.ai);
    st.e.sub.textContent = ai ? tr('subAi') : tr('subFaq');
    st.e.ta.placeholder = tr('ph');
    st.e.send.textContent = tr('send');
    st.e.summary.textContent = tr('ready');
    st.e.lg.textContent = tr('lang');
    st.e.x.setAttribute('aria-label', tr('close')); st.e.x.title = tr('close');
    st.e.home.textContent = tr('home');
    st.e.bub.setAttribute('aria-label', tr('open')); st.e.bub.title = tr('move');
    st.e.panel.setAttribute('aria-label', 'Claudian-PMO');
    var left = st.status && st.status.left != null && ai ? fillN(tr('left'), st.status.left) : '';
    st.e.left.textContent = left;
    if (st.e.welcome) st.e.welcome.textContent = ai ? tr('welcomeAi') : tr('welcomeFaq');
    drawChips(st.status ? st.status.faq : []);
  }
  function showFailure(e) {
    var gone = e && (e.status === 401 || e.status === 403), srv = e && e.status >= 500;
    addMsg(gone ? 'e' : 'h', gone ? tr('gone') : srv ? tr('srv') : tr('net'));
  }
  /** A question that was not answered goes back into the box, if the person has not typed something else: on a phone a Swahili question of 400 characters is not retyped for a failed network. */
  function restoreQ(q) { if (q && !st.e.ta.value) { st.e.ta.value = q; fitBox(); } }

  /* ---------------- what a tap does ---------------- */
  function loadStatus(force) {
    if (!force && st.status && st.statusLang === lang() && Date.now() - st.statusAt < STATUS_FRESH_MS) { paintMode(); return Promise.resolve(); }
    if (st.busy) return Promise.resolve();
    setBusy(true); thinking(true, tr('loading'));
    var mine = ++st.ticket, sess = st.sess, asked = lang();
    return api('status').then(function (r) {
      if (sess !== st.sess) return;
      st.status = r; st.statusAt = Date.now(); st.statusLang = asked;   // the language it was ASKED in: SW / EN may have been pressed while it was on its way
    }, function (e) {
      if (sess !== st.sess) return;
      st.status = null; if (mine === st.ticket) showFailure(e);
    }).then(function () { if (sess !== st.sess) return; thinking(false); setBusy(false); paintMode(); catchUpLang(); });
  }
  /** SW / EN pressed while something was on its way: loadStatus returns at once while busy, so the ready questions stayed in the old language until the panel was closed and opened a minute later
      (the second reader of Part 163). When nothing is on its way any more, the list is asked for again in the language now on the button. Bounded by the person's own presses. */
  function catchUpLang() { if (st.open && st.status && st.statusLang !== lang()) loadStatus(true); }
  function askFaq(c) {
    if (st.busy) return;
    addMsg('u', c.q);
    setBusy(true); thinking(true);
    var sess = st.sess, asked = lang();
    api('faq', { id: c.id }).then(function (r) {
      if (sess !== st.sess) return;
      thinking(false);
      addMsg(r && r.mode === 'faq' && r.id ? 'a' : 'h', r && r.answer ? String(r.answer) : tr('net'));
      followSwitch(r);
      if (r && r.faq) { st.status = st.status || {}; st.status.faq = r.faq; st.statusLang = asked; drawChips(r.faq); }
    }, function (e) { if (sess !== st.sess) return; thinking(false); showFailure(e); }).then(function () { if (sess !== st.sess) return; setBusy(false); regainFocus(); catchUpLang(); });
  }
  function ask() {
    if (st.busy) return;
    var q = trimQ(st.e.ta.value);
    if (!q) return;
    st.e.ta.value = ''; fitBox();
    addMsg('u', q);
    setBusy(true); thinking(true);
    var sess = st.sess, asked = lang();
    api('ask', { q: q, hist: st.hist ? [st.hist] : [] }).then(function (r) {
      if (sess !== st.sess) return;
      thinking(false);
      var text = r && r.answer ? String(r.answer) : tr('net');
      var ok = r && (r.mode === 'ai' || r.mode === 'canned' || r.mode === 'match');
      // a ready answer found for what was typed says which ready question it answers, so a wrong guess is seen for what it is
      var top = r && r.mode === 'match' && r.q ? addMsg('w', tr('matched') + ' ' + String(r.q)) : null;
      addMsg(ok ? 'a' : 'h', text);
      if (r && (r.mode === 'busy' || r.mode === 'limit')) restoreQ(q);
      if (top) st.e.body.scrollTop = Math.max(0, top.offsetTop - 12);
      if (r && r.near && r.near.length) addNear(r.near);
      if (r && r.mode === 'ai') st.hist = { q: q, a: text.slice(0, 240) }; else if (r && r.mode !== 'canned') st.hist = null;
      followSwitch(r);
      if (r && r.left != null && st.status) { st.status.left = r.left; paintMode(); }
      if (r && r.faq) { st.status = st.status || {}; st.status.faq = r.faq; st.statusLang = asked; drawChips(r.faq); }
    }, function (e) { if (sess !== st.sess) return; thinking(false); showFailure(e); restoreQ(q); }).then(function () { if (sess !== st.sess) return; setBusy(false); regainFocus(); catchUpLang(); });
  }
  /** Every answer says whether the AI is ON (the switch on Settings): when the owner turns it off while a panel is open, the box goes away with the next answer, not a minute later. */
  function followSwitch(r) {
    if (r && typeof r.ai === 'boolean' && st.status && !!st.status.ai !== r.ai) { st.status.ai = r.ai; if (!r.ai) st.hist = null; paintMode(); }
  }
  function fitBox() { var t = st.e.ta; t.style.height = 'auto'; t.style.height = Math.min(96, t.scrollHeight) + 'px'; }

  /* ---------------- the place of the bubble and the panel ---------------- */
  function setPos(p) { st.pos = p; st.e.bub.style.left = p.x + 'px'; st.e.bub.style.top = p.y + 'px'; }
  function saveFrac() { st.frac = toFrac(st.pos.x, st.pos.y, window.innerWidth, window.innerHeight); writeFrac(st.frac); }
  function keyboardRoom() { try { var v = window.visualViewport; return v ? Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop)) : 0; } catch (e) { return 0; } }
  function layoutPanel() {
    var vw = window.innerWidth, vh = window.innerHeight, p = st.e.panel, kb = keyboardRoom();
    if (vw <= WIDE) {
      p.className = 'panel sheet' + (st.open ? ' open' : '');
      p.style.left = '8px'; p.style.right = '8px'; p.style.top = 'auto'; p.style.bottom = (8 + kb) + 'px';
      p.style.height = Math.max(240, Math.min(Math.round((vh - kb) * 0.78), 600)) + 'px';
      st.e.bub.className = st.e.bub.className.replace(/ ?away/, '') + ' away';
    } else {
      var vhe = vh - kb;                         // the window less what the keyboard covers
      var w = 380, h = Math.min(540, vhe - 2 * EDGE - 12);
      p.className = 'panel' + (st.open ? ' open' : '');
      p.style.height = h + 'px'; p.style.right = 'auto'; p.style.bottom = 'auto';
      var onRight = st.pos.x + SIZE / 2 > vw / 2;
      var left = clamp(onRight ? st.pos.x + SIZE - w : st.pos.x, EDGE, Math.max(EDGE, vw - w - EDGE));
      var top = clamp(st.pos.y + SIZE / 2 > vhe / 2 ? st.pos.y - h - 10 : st.pos.y + SIZE + 10, EDGE, Math.max(EDGE, vhe - h - EDGE));
      // On a short window there is no room above or below the bubble: the panel would be drawn over it, and a bubble that cannot be seen cannot be dragged or told apart. It goes BESIDE it.
      if (left < st.pos.x + SIZE && left + w > st.pos.x && top < st.pos.y + SIZE && top + h > st.pos.y) {
        left = clamp(onRight ? st.pos.x - w - 10 : st.pos.x + SIZE + 10, EDGE, Math.max(EDGE, vw - w - EDGE));
      }
      p.style.left = left + 'px';
      p.style.top = top + 'px';
      st.e.bub.className = st.e.bub.className.replace(/ ?away/, '');
    }
  }
  function onResize() { if (!st.mounted) return; setPos(fromFrac(st.frac, window.innerWidth, window.innerHeight)); if (st.open) layoutPanel(); }

  function paintTheme() { if (st.e.root) st.e.root.className = 'root' + (isDark() ? ' dark' : ''); }
  function openPanel() {
    if (st.open) return;
    st.open = true;
    paintTheme();
    st.e.bub.setAttribute('aria-expanded', 'true');
    st.e.bub.className = st.e.bub.className.replace(/ ?pulse/, '');
    layoutPanel();
    paintMode();
    loadStatus(false).then(function () {
      try {
        // A person who taps the box while the list is still on its way has the focus already (and, on a phone, the keyboard up): it is theirs, never moved.
        var sr = st.e.root.getRootNode ? st.e.root.getRootNode() : null, ae = sr && sr.activeElement;
        if (ae && ae !== st.e.bub) return;
        if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) st.e.ta.focus();
        else st.e.x.focus();
      } catch (e) { /* focus is a nicety */ }
    });
  }
  function closePanel() {
    if (!st.open) return;
    st.open = false;
    st.e.panel.className = st.e.panel.className.replace(/ ?open/, '');
    st.e.bub.className = st.e.bub.className.replace(/ ?away/, '');
    st.e.bub.setAttribute('aria-expanded', 'false');
    try { st.e.bub.focus(); } catch (e) { /* nothing to focus */ }
  }
  function toggle() { if (st.open) closePanel(); else openPanel(); }

  /** THE TAIL OF A TOUCH. A browser follows a touch with the mouse events and a click of the same tap, aimed at whatever is under the finger THEN. A tap that opens the panel moves the
      bubble away (on a phone the sheet covers the screen), so the click that follows landed on the page's own control under it (HOPE Calls' log-out question, a header button) or on the
      sheet's buttons (the one that puts the bubble back in its corner): the second reader of Part 163 found it. For a moment after a touch or pen tap has toggled the panel, the mouse
      events and the click AT THE PLACE OF THAT TAP are swallowed before any page control sees them: a deliberate tap somewhere else (the box, a choice) is a tap and goes through. */
  function swallowTail(x, y) {
    var types = ['mousedown', 'mouseup', 'click'], i;
    var stop = function (ev) { if (Math.abs(ev.clientX - x) <= TAIL_PX && Math.abs(ev.clientY - y) <= TAIL_PX) { ev.stopPropagation(); ev.preventDefault(); } };
    for (i = 0; i < types.length; i++) document.addEventListener(types[i], stop, true);
    setTimeout(function () { for (var j = 0; j < types.length; j++) document.removeEventListener(types[j], stop, true); }, TAIL_MS);
  }
  function wireDrag(btn) {
    var down = null, moved = false, suppress = false, lastToggle = 0;
    if (window.PointerEvent) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button != null && e.button !== 0) return;
        down = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: st.pos.x, oy: st.pos.y };
        moved = false;
        try { btn.setPointerCapture(e.pointerId); } catch (x) { /* a pointer that is already gone */ }
      });
      btn.addEventListener('pointermove', function (e) {
        if (!down || e.pointerId !== down.id) return;
        var dx = e.clientX - down.sx, dy = e.clientY - down.sy;
        if (!moved && isTap(dx, dy)) return;
        moved = true;
        if (btn.className.indexOf(' drag') < 0) btn.className += ' drag';
        setPos(clampPos(down.ox + dx, down.oy + dy, window.innerWidth, window.innerHeight));
        if (st.open) layoutPanel();
      });
      var end = function (e) {
        if (!down || e.pointerId !== down.id) return;
        var was = moved; down = null; moved = false;
        btn.className = btn.className.replace(/ ?drag/, '');
        try { btn.releasePointerCapture(e.pointerId); } catch (x) { /* released already */ }
        if (was) { suppress = true; setTimeout(function () { suppress = false; }, 0); saveFrac(); }
        // A TAP opens it from the finger's own release: a browser is not obliged to follow a touch with a click (some WebViews do not, and this
        // one's test browser did not), so the release is what counts, and the click that may follow it is ignored below.
        else if (e.type === 'pointerup') { lastToggle = Date.now(); if (e.pointerType && e.pointerType !== 'mouse') swallowTail(e.clientX, e.clientY); toggle(); }
      };
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
    }
    // A click that is nobody's release: the keyboard (Enter, Space), a screen reader's activation, a browser with no pointer events.
    btn.addEventListener('click', function (e) { if (suppress) { e.preventDefault(); return; } if (Date.now() - lastToggle < 700) return; lastToggle = Date.now(); toggle(); });
    // the keyboard moves it too: arrows nudge it, with Shift a longer way
    btn.addEventListener('keydown', function (e) {
      var d = e.shiftKey ? 48 : 12, dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -d; else if (e.key === 'ArrowRight') dx = d; else if (e.key === 'ArrowUp') dy = -d; else if (e.key === 'ArrowDown') dy = d; else return;
      e.preventDefault();
      setPos(clampPos(st.pos.x + dx, st.pos.y + dy, window.innerWidth, window.innerHeight));
      saveFrac();
      if (st.open) layoutPanel();
    });
  }

  /* ---------------- building it ---------------- */
  function mount(opts) {
    if (st.mounted) return true;
    if (!opts || !document.body || !document.body.attachShadow) return false;
    st.opts = opts;
    var host = document.createElement('div');
    host.id = 'claudianPMO';
    host.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:' + (opts.z || 55);
    var sh = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style'); style.textContent = CSS; sh.appendChild(style);
    var root = el('div', 'root'); sh.appendChild(root);
    var e = st.e = { root: root };

    var bub = e.bub = el('button', 'bub pulse'); bub.type = 'button'; bub.setAttribute('aria-expanded', 'false'); bub.innerHTML = ICON.replace(/HEADID/g, 'cbub');
    root.appendChild(bub);

    var panel = e.panel = el('div', 'panel'); panel.setAttribute('role', 'dialog'); root.appendChild(panel);
    var hd = el('div', 'hd'); panel.appendChild(hd);
    var ico = el('span', 'ico'); ico.innerHTML = ICON.replace(/HEADID/g, 'chead'); hd.appendChild(ico);
    var ttl = el('div', 'ttl'); hd.appendChild(ttl);
    ttl.appendChild(el('b', null, 'Claudian-PMO'));
    e.sub = el('small', 'sub'); ttl.appendChild(e.sub);
    e.lg = el('button'); e.lg.type = 'button'; hd.appendChild(e.lg);
    e.x = el('button', null, '×'); e.x.type = 'button'; hd.appendChild(e.x);

    e.body = el('div', 'body'); e.body.setAttribute('role', 'log'); e.body.setAttribute('aria-live', 'polite'); e.body.tabIndex = 0; panel.appendChild(e.body);
    e.welcome = el('div', 'm w'); e.body.appendChild(e.welcome);
    e.faq = el('details', 'faq'); e.body.appendChild(e.faq);
    e.summary = el('summary'); e.faq.appendChild(e.summary);
    e.chips = el('div', 'chips'); e.faq.appendChild(e.chips);

    e.ft = el('div', 'ft'); panel.appendChild(e.ft);
    e.ta = el('textarea'); e.ta.rows = 1; e.ta.maxLength = MAX_Q; e.ft.appendChild(e.ta);
    e.send = el('button', 'send'); e.send.type = 'button'; e.ft.appendChild(e.send);
    var mt = el('div', 'mt'); panel.appendChild(mt);
    e.left = el('span'); mt.appendChild(e.left);
    e.home = el('button'); e.home.type = 'button'; mt.appendChild(e.home);

    var frac = readFrac();
    var vw = window.innerWidth, vh = window.innerHeight;
    var p0 = frac ? fromFrac(frac, vw, vh) : defaultPos(vw, vh, opts.host);
    st.frac = frac || toFrac(p0.x, p0.y, vw, vh);
    document.body.appendChild(host);
    st.host = host;
    setPos(p0);
    wireDrag(bub);

    e.x.onclick = closePanel;
    e.lg.onclick = function () { var h = hostLang(); st.userLang = lang() === 'sw' ? 'en' : 'sw'; st.langAtToggle = h; paintMode(); loadStatus(true); };
    e.send.onclick = ask;
    e.ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); ask(); } });
    e.ta.addEventListener('input', fitBox);
    e.home.onclick = function () { dropFrac(); var d = defaultPos(window.innerWidth, window.innerHeight, opts.host); setPos(d); st.frac = toFrac(d.x, d.y, window.innerWidth, window.innerHeight); if (st.open) layoutPanel(); };
    panel.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); closePanel(); } });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    try { if (window.visualViewport) { var vv = function () { if (st.open) layoutPanel(); }; window.visualViewport.addEventListener('resize', vv); window.visualViewport.addEventListener('scroll', vv); } } catch (x) { /* no visual viewport */ }

    st.mounted = true;
    paintTheme();
    try { if (window.MutationObserver) new MutationObserver(paintTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] }); } catch (x) { /* the look is re-read when the panel opens */ }
    paintMode();
    return true;
  }

  window.ClaudianPMO = {
    mount: mount,
    hide: function () { forget(); if (st.host) st.host.style.display = 'none'; },
    show: function () { if (st.host) st.host.style.display = ''; },
    open: function () { if (st.mounted) openPanel(); },
    close: function () { if (st.mounted) closePanel(); },
    mounted: function () { return st.mounted; },
    /* the pure parts, for the tests (test/claudian-ui.test.mjs): nothing here touches a page */
    _t: { T: T, ICON: ICON, SIZE: SIZE, EDGE: EDGE, TAP_PX: TAP_PX, WIDE: WIDE, clampPos: clampPos, toFrac: toFrac, fromFrac: fromFrac, isTap: isTap, defaultPos: defaultPos, trimQ: trimQ, fillN: fillN }
  };
})();
