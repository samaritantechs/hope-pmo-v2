/* annual-ppt -- the Annual Rep tab's "Export deck (PPT)": the GM's deck for the year on screen,
   made in the browser from the answer the tab already holds. Plain script, no build step; the
   tab (public/mod/annual.js) fetches this file the first time the button is pressed, as
   /deck/annual-ppt.js?v=BUILD, and bump `var BUILD` in app.html whenever it changes.

     "Having the ppt design in place -- I wish to have an export annual ppt button that will
      always ppt export with updated data of selected year"

   WHAT IT READS. Nothing new: S.anData is the annual answer of the year the tab is showing
   (every figure and every sentence below is cut from it) and, for the "against last year"
   slides, the year before, asked for once on the press (the server keeps each year's answer a
   minute). Not one new query for the database to answer except that one. The arithmetic is the
   server's (api/_lib/annual.js: a month, a region, a leader, a year); this file only chooses,
   sorts and words. Where the data for a slide is not there -- no collection in a year before the
   stamps, no regions, no analysts, no year before -- the slide is left out and the contents slide
   says what is in.

   THE BOOKS. PAR, the active portfolio and the legal register are not the year's months but the books
   the system holds, so the press also asks for srv('annualBook', { year }): the PAR tab's answer, the
   latest Expected deck, and the demand notices of the year, each read by its own tab's reader and
   grouped by region on the server (api/_lib/annual.js). A section that cannot be read gets a slide that
   says why, never a silent gap.

   THE DESIGN is the 2026 to-date deck's: HOPE blue, Calibri, the logo top right, cards, native
   charts, tables with a navy head. Colours are written as hex (a deck made in the browser has no
   theme step), which looks the same and edits the same.

   THE LIBRARY is PptxGenJS 3.12.0 (MIT), vendored beside this file as /deck/pptxgen.bundle.js so
   the export needs no third-party host and works offline once loaded. It is fetched on the press,
   never at page load. */

var ANPPT_C = { text1: '1E2350', text2: '2B2F86', bg1: 'FFFFFF', bg2: 'F1F5FB', a1: '1F57D6', a2: '29A8E0', a3: '1E9E63', a4: 'E0A100', a5: 'D93636', a6: '7A86A8' };
var ANPPT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var ANPPT_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var ANPPT_FONT = '+mn-lt';

/* ---------------------------------------------------------------------------- formatting */
function anPptN0_(v) { return v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US'); }
function anPptB2_(v) { return (v / 1e9).toFixed(2) + 'B'; }
function anPptM1_(v) { return (v / 1e6).toFixed(0) + 'M'; }
function anPptPc_(v) { return v == null ? '—' : Number(v).toFixed(1) + '%'; }
function anPptPc0_(v) { return v == null ? '—' : Math.round(v) + '%'; }
function anPptMean_(v) { v = v.filter(function (x) { return x != null && !isNaN(x); }); return v.length ? Math.round(v.reduce(function (s, x) { return s + Number(x); }, 0) / v.length * 10) / 10 : null; }
function anPptSum_(rows, k) { return rows.reduce(function (s, r) { return s + (Number(r[k]) || 0); }, 0); }
function anPptMon_(ym) { return ANPPT_MON[Number(String(ym).slice(5, 7)) - 1] || String(ym); }
function anPptLong_(ym) { return ANPPT_LONG[Number(String(ym).slice(5, 7)) - 1] || String(ym); }

/* ---------------------------------------------------------------------------- the model */
/** Everything a slide needs, from the year's answer `d` and (optionally) the year before `prev`.
    Pure: no DOM, no network -- so a test can run it. Returns null when the year has no month yet. */
function anPptModel_(d, prev, book) {
  var had = (d.months || []).filter(function (m) { return m.state !== 'future' && m.teams > 0; });
  if (!had.length) return null;
  var first = had[0], last = had[had.length - 1];
  var year = Number(d.year);
  var complete = !!d.today && year < Number(String(d.today).slice(0, 4));
  var minM = Math.min(3, had.length);                          // "established": a team with at least this many months
  var T = (d.teams || []).slice();
  var Y = d.totals || {};
  var roles = {}; ((d.leaders && d.leaders.roles) || []).forEach(function (r) { roles[r.role] = r.rows || []; });
  var regions = (d.regions || []).filter(function (z) { return z.months > 0; });
  var credit = (roles.credit || []).filter(function (r) { return r.months >= minM; }).sort(function (a, b) { return b.sales - a.sales; });
  var prevHad = prev ? (prev.months || []).filter(function (m) { return m.state !== 'future' && m.teams > 0; }) : [];
  var prevBy = {}; prevHad.forEach(function (m) { prevBy[m.ym.slice(5, 7)] = m; });
  var cmp = had.map(function (m) { return prevBy[m.ym.slice(5, 7)] || null; });
  var sameMonthsPrev = cmp.filter(Boolean);
  return {
    year: year, complete: complete, had: had, first: first, last: last, minM: minM, today: d.today || '', target: d.target || 0,
    labels: had.map(function (m) { return anPptMon_(m.ym); }),
    colMonths: had.filter(function (m) { return m.colPct != null; }),
    recMonths: had.filter(function (m) { return m.recPct != null; }),
    pending: had.filter(function (m) { return m.state === 'pending'; }),
    teams: T, Y: Y, regions: regions, credit: credit, gmo: (roles.gmo || []).filter(function (r) { return r.general != null; }), opm: (roles.opm || []).filter(function (r) { return r.general != null; }),
    stamped: T.some(function (t) { return t.yearStamped; }),
    prev: prev ? { year: Number(prev.year), totals: prev.totals || {}, had: prevHad, same: sameMonthsPrev, cmp: cmp,
      sameSales: anPptSum_(sameMonthsPrev, 'sales'), wholeSales: Number((prev.totals || {}).sales) || 0 } : null,
    recentYms: had.length >= 4 ? had.slice(-3).map(function (m) { return m.ym; }) : [],
    book: book || null,
  };
}

/* ---------------------------------------------------------------------------- the deck */
/** Build the deck on a fresh PptxGenJS (`Pptx` is the constructor). `A` = { title, logo }, image data in
    pptxgenjs's "image/png;base64,..." form. Returns the pres, ready to write. */
function anPptBuild_(Pptx, M, A) {
  var C = ANPPT_C;
  var pres = new Pptx();
  pres.layout = 'LAYOUT_16x9';                                  // 10 x 5.625 in
  var Y = M.Y, T = M.teams, had = M.had, first = M.first, last = M.last, labels = M.labels, P = M.prev;
  var firstL = anPptMon_(first.ym), lastL = anPptMon_(last.ym), lastLong = anPptLong_(last.ym), firstLong = anPptLong_(first.ym);
  var span = firstL === lastL ? firstLong : firstLong + ' to ' + lastLong;
  var heading = M.complete ? '(' + M.year + ') ANNUAL REPORT' : '(' + M.year + ') ANNUAL REPORT TO DATE';
  var FOOT = 'HOPE MICROCREDIT COMPANY LIMITED  ·  ' + M.year + (M.complete ? ' annual report' : ' to date') + ', ' + span;
  pres.title = 'HOPE Microcredit: ' + M.year + (M.complete ? '' : ' to date');
  pres.author = 'HOPE Microcredit Company Limited';
  pres.company = 'HOPE Microcredit Company Limited';
  pres.theme = { headFontFace: 'Calibri', bodyFontFace: 'Calibri' };

  pres.defineSlideMaster({ title: 'TITLE', background: { data: A.title },
    objects: [
      { image: { data: A.logo, x: 0.45, y: 0.4, w: 1.7, h: 0.556, objectName: 'Logo' } },
      { placeholder: { options: { name: 'title', type: 'title', x: 0.9, y: 1.55, w: 7.2, h: 0.7, fontSize: 30, bold: true, color: C.text2, align: 'left', margin: 0 }, text: '' } },
      { placeholder: { options: { name: 'subtitle', type: 'body', x: 0.9, y: 2.3, w: 7.2, h: 0.6, fontSize: 24, bold: true, color: C.a2, align: 'left', margin: 0 }, text: '' } },
    ] });
  pres.defineSlideMaster({ title: 'CONTENT', background: { color: 'FFFFFF' },
    objects: [
      { image: { data: A.logo, x: 8.6, y: 0.3, w: 0.9, h: 0.294, objectName: 'Logo' } },
      { placeholder: { options: { name: 'title', type: 'title', x: 0.5, y: 0.28, w: 7.9, h: 0.55, fontSize: 24, bold: true, color: C.text2, align: 'left', margin: 0, valign: 'middle' }, text: '' } },
      { text: { text: FOOT, options: { x: 0.5, y: 5.27, w: 7.5, h: 0.22, fontSize: 9, color: C.a6, margin: 0, objectName: 'Footer' } } },
    ], slideNumber: { x: 9.0, y: 5.27, w: 0.5, h: 0.22, fontSize: 9, color: C.a6, align: 'right' } });

  /* ---- helpers */
  var section = null;
  function sec(title) { section = title; pres.addSection({ title: title }); }
  function content(title) {
    var s = pres.addSlide({ masterName: 'CONTENT', sectionTitle: section });
    s.addText(title, { placeholder: 'title' });
    return s;
  }
  function card(s, x, y, w, h, label, value, sub, o) {
    o = o || {};
    s.addShape(pres.ShapeType.roundRect, { x: x, y: y, w: w, h: h, rectRadius: 0.08, fill: { color: C.bg2 }, line: { color: C.bg2, width: 0 }, objectName: 'Card ' + label });
    s.addText(label.toUpperCase(), { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: 0.25, fontSize: 10, bold: true, color: C.a6, margin: 0, charSpacing: 1, objectName: 'Label ' + label });
    s.addText(value, { x: x + 0.15, y: y + 0.36, w: w - 0.3, h: 0.6, fontSize: o.vs || 28, bold: true, color: o.color || C.text2, margin: 0, valign: 'middle', objectName: 'Value ' + label });
    if (sub) s.addText(sub, { x: x + 0.15, y: y + 0.96, w: w - 0.3, h: h - 1.06, fontSize: 10.5, color: C.text1, margin: 0, valign: 'top', objectName: 'Sub ' + label });
  }
  function bullets(s, items, x, y, w, h, size) {
    var runs = [];
    items.forEach(function (t, i) {
      t.forEach(function (p, j) { runs.push({ text: p.text, options: { bold: !!p.bold, bullet: j === 0 ? { indent: 14 } : false, breakLine: j === t.length - 1 && i < items.length - 1, paraSpaceAfter: 7 } }); });
    });
    s.addText(runs, { x: x, y: y, w: w, h: h, fontSize: size || 13, color: C.text1, valign: 'top', margin: 0, objectName: 'Notes' });
  }
  function note(s, text, y, h) {
    s.addText(text, { x: 0.5, y: y, w: 9, h: h || 0.45, fontSize: 10.5, italic: true, color: C.a6, margin: 0, valign: 'top', objectName: 'Note' });
  }
  function heading2(s, text, x, y, w, color) {
    s.addText(text, { x: x, y: y, w: w, h: 0.3, fontSize: 12, bold: true, color: color, margin: 0, objectName: 'Heading ' + text });
  }
  var fontOpts = { catAxisLabelFontFace: ANPPT_FONT, valAxisLabelFontFace: ANPPT_FONT, dataLabelFontFace: ANPPT_FONT, legendFontFace: ANPPT_FONT, titleFontFace: ANPPT_FONT };
  function chart(s, cats, series, o) {
    var data = series.map(function (se) { return { name: se.name, labels: cats, values: se.values }; });
    var opts = { x: o.x, y: o.y, w: o.w, h: o.h, barDir: o.dir || 'col', barGrouping: o.stacked ? 'stacked' : 'clustered',
      chartColors: o.colors || [C.a1, C.a2], barGapWidthPct: o.gap || 45, showLegend: series.length > 1, legendPos: 'b', legendFontSize: 10, legendColor: C.text1,
      showValue: true, dataLabelPosition: o.stacked ? 'ctr' : 'outEnd', dataLabelFontSize: o.dl || 10, dataLabelColor: o.stacked ? 'FFFFFF' : C.text1, dataLabelFormatCode: o.fmt || '#,##0',
      catAxisLabelFontSize: o.cat || 10, catAxisLabelColor: C.text1, valAxisHidden: true, valAxisLabelFontSize: 9, valAxisLabelColor: C.a6,
      valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, catAxisOrientation: o.reverse ? 'maxMin' : 'minMax',
      showTitle: false, objectName: o.name };
    if (o.min != null) opts.valAxisMinVal = o.min;
    if (o.max != null) opts.valAxisMaxVal = o.max;
    for (var k in fontOpts) opts[k] = fontOpts[k];
    s.addChart(pres.charts.BAR, data, opts);
  }
  function table(s, rows, x, y, w, colW, o) {
    o = o || {};
    var head = rows[0].map(function (t) { return { text: t, options: { bold: true, color: C.bg1, fill: { color: C.text2 }, fontSize: o.fs || 10, align: 'center', valign: 'middle' } }; });
    var body = rows.slice(1).map(function (r, i) {
      return r.map(function (t, j) { return { text: String(t), options: { fontSize: o.fs || 10, color: C.text1, align: (o.left || (o.textCols || [0]).indexOf(j) >= 0) ? 'left' : 'right', valign: 'middle', fill: { color: i % 2 ? C.bg1 : C.bg2 }, bold: j === 0 } }; });
    });
    s.addTable([head].concat(body), { x: x, y: y, w: w, colW: colW, rowH: o.rowH || 0.26, border: { type: 'solid', pt: 0.5, color: 'E3E8F2' }, margin: [0.02, 0.08, 0.02, 0.08], objectName: o.name || 'Table', autoPage: false });
  }
  /* Two tables side by side, the best and the worst of a list. */
  function bestWorst(s, title, rows, key, colHead, fmt, extra) {
    var n = Math.min(8, Math.floor(rows.length / 2));
    var top = rows.slice(0, n), low = rows.slice(-n).reverse();
    var head = ['Team', extra ? extra.head : 'Months', colHead];
    var line = function (r) { return [r.team, extra ? extra.get(r) : r.months, fmt(r[key])]; };
    heading2(s, 'Highest, teams with ' + M.minM + ' month' + (M.minM === 1 ? '' : 's') + ' or more', 0.5, 1.0, 4.4, C.a3);
    table(s, [head].concat(top.map(line)), 0.5, 1.35, 4.4, [2.2, 1.0, 1.2], { name: 'Highest ' + title, rowH: 0.3 });
    heading2(s, 'Lowest, teams with ' + M.minM + ' month' + (M.minM === 1 ? '' : 's') + ' or more', 5.1, 1.0, 4.4, C.a5);
    table(s, [head].concat(low.map(line)), 5.1, 1.35, 4.4, [2.2, 1.0, 1.2], { name: 'Lowest ' + title, rowH: 0.3 });
    return n;
  }
  var regKey = function (v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase(); };
  var teamsOf = function (region) { return T.filter(function (t) { return regKey(t.region) === regKey(region); }).sort(function (a, b) { return a.team < b.team ? -1 : a.team > b.team ? 1 : 0; }); };
  /* The GMO of a region: whoever holds the most of its teams, with "+n" for the others. */
  var gmoOf = function (region) {
    var c = {}; teamsOf(region).forEach(function (t) { var g = t.gmo && String(t.gmo).trim(); if (g) c[g] = (c[g] || 0) + 1; });
    var names = Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); });
    return names.length ? names[0] + (names.length > 1 ? ' +' + (names.length - 1) : '') : '—';
  };
  var established = T.filter(function (r) { return r.months >= M.minM; });
  var byKey = function (rows, k) { return rows.filter(function (r) { return r[k] != null; }).sort(function (a, b) { return b[k] - a[k]; }); };
  var Z = M.regions, hasZ = Z.length >= 2;
  var CR = M.credit, hasCR = CR.length >= 3;
  var colM = M.colMonths, recM = M.recMonths;
  var hasColT = established.filter(function (r) { return r.colPct != null; }).length >= 4;
  var hasGeneralT = established.filter(function (r) { return r.general != null; }).length >= 4;
  var sales = had.map(function (m) { return m.sales; });
  var best = sales.indexOf(Math.max.apply(null, sales)), worst = sales.indexOf(Math.min.apply(null, sales));
  var top5 = T.slice().sort(function (a, b) { return b.sales - a.sales; }).slice(0, 5);
  var top5share = Y.sales ? top5.reduce(function (a, r) { return a + r.sales; }, 0) / Y.sales * 100 : 0;
  var smallT = T.filter(function (r) { return r.sales < M.target; });
  var isRecent = function (r) { return M.recentYms.indexOf(r.first) >= 0; };
  var recentWord = M.recentYms.length ? anPptLong_(M.recentYms[0]) : '';
  var sectionsIn = [];

  /* ---- title */
  sec('Opening');
  var ts = pres.addSlide({ masterName: 'TITLE', sectionTitle: 'Opening' });
  ts.addText('HOPE MICROCREDIT COMPANY LIMITED', { placeholder: 'title' });
  ts.addText(heading, { placeholder: 'subtitle' });
  ts.addText(span + ' ' + M.year, { x: 0.9, y: 2.95, w: 6, h: 0.35, fontSize: 16, color: C.text1, margin: 0, objectName: 'Period' });
  ts.addText('Prepared ' + M.today, { x: 0.9, y: 3.35, w: 6, h: 0.3, fontSize: 11, color: C.a6, margin: 0, objectName: 'Prepared' });

  /* ---- contents: filled in at the end, once we know what is in. Holds its place now. */
  var contents = content('What this report covers');

  /* ---- at a glance */
  sec('At a glance'); sectionsIn.push(['At a glance', 'the ' + (M.complete ? 'year' : 'year so far') + ' in six numbers']);
  (function () {
    var s = content(M.year + ' at a glance');
    var w = 2.9, h = 1.5, gx = 0.15;
    var ret25 = P && P.totals.retentionPct != null ? ' (' + P.year + ': ' + anPptPc_(P.totals.retentionPct) + ')' : '';
    card(s, 0.5, 1.05, w, h, 'Sales', 'TZS ' + anPptB2_(Y.sales), anPptN0_(Y.loans) + ' loans, ' + anPptN0_(Y.trk1) + ' to first-time customers');
    card(s, 0.5 + w + gx, 1.05, w, h, 'Retention', anPptPc_(Y.retentionPct), anPptN0_(Y.retained) + ' of ' + anPptN0_(Y.loans) + ' loans went to returning customers' + ret25);
    card(s, 0.5 + 2 * (w + gx), 1.05, w, h, 'Teams', String(last.teams), 'selling in ' + lastLong + (had.length > 1 ? ', ' + (last.teams >= first.teams ? 'up' : 'down') + ' from ' + first.teams + ' in ' + firstLong : ''));
    card(s, 0.5, 1.05 + h + gx, w, h, 'Collection', anPptPc_(Y.colPct), Y.colPct == null ? 'not recorded for this year' : 'of what was due was collected, the average of ' + (colM.length > 1 ? 'the ' + colM.length + ' measured months' : 'the measured period'), { color: C.a3 });
    card(s, 0.5 + w + gx, 1.05 + h + gx, w, h, 'Recovery', anPptPc_(Y.recPct), Y.recovered == null ? 'not recorded for this year' : 'of arrears brought back: TZS ' + anPptB2_(Y.recovered) + ' of ' + anPptB2_(Y.uncollected), { color: C.a1 });
    card(s, 0.5 + 2 * (w + gx), 1.05 + h + gx, w, h, 'General', anPptPc_(Y.general), 'the average of sales ' + anPptPc_(Y.salesPct) + (Y.colPct != null ? ', collection ' + anPptPc_(Y.colPct) : '') + (Y.recPct != null ? ' and recovery ' + anPptPc_(Y.recPct) : ''), { color: C.text2 });
    note(s, 'Percentages are the average of the months that have happened' + (M.complete ? '.' : ', so the months still to come do not count as nothing.'), 4.75, 0.3);
  })();

  /* ---- growth and coverage */
  if (had.length >= 2 || hasZ) {
    sec('Growth and coverage'); sectionsIn.push(['Growth and coverage', 'teams' + (hasZ ? ' and regions' : '')]);
  }
  if (had.length >= 2) (function () {
    var s = content('Teams went from ' + first.teams + ' to ' + last.teams);
    chart(s, labels, [{ name: 'Teams selling', values: had.map(function (m) { return m.teams; }) }], { x: 0.4, y: 1.0, w: 5.9, h: 4.1, colors: [C.a1], name: 'Teams by month', fmt: '0' });
    var newTeams = T.filter(function (r) { return r.first && r.first > first.ym; }).length;
    var gone = T.filter(function (r) { return r.m && r.m[first.ym] && !r.m[last.ym]; }).length;
    var step = 0, stepAt = 1; for (var i = 1; i < had.length; i++) { var dlt = had[i].teams - had[i - 1].teams; if (Math.abs(dlt) > Math.abs(step)) { step = dlt; stepAt = i; } }
    var b = [[{ text: newTeams + ' team' + (newTeams === 1 ? '' : 's') + ' ', bold: true }, { text: 'started selling after ' + firstLong + '.' + (gone ? ' ' + gone + ' that sold in ' + firstLong + ' do not sell in ' + lastLong + ' (closed or merged).' : '') }]];
    if (step) b.push([{ text: 'The biggest step: ', bold: true }, { text: (step > 0 ? step + ' more' : Math.abs(step) + ' fewer') + ' teams in ' + anPptLong_(had[stepAt].ym) + '.' }]);
    if (first.teams && last.teams && first.sales) b.push([{ text: 'Sales per team ', bold: true }, { text: (last.sales / last.teams >= first.sales / first.teams ? 'rose' : 'moved') + ' from TZS ' + anPptM1_(first.sales / first.teams) + ' a month in ' + firstLong + ' to ' + anPptM1_(last.sales / last.teams) + ' in ' + lastLong + '.' }]);
    bullets(s, b, 6.5, 1.2, 3.0, 3.6, 13);
  })();
  if (hasZ) (function () {
    var s = content('Coverage across ' + Z.length + ' regions');
    var zs = Z.slice().sort(function (a, b) { return b.teams - a.teams; });
    chart(s, zs.map(function (z) { return z.region; }), [{ name: 'Teams', values: zs.map(function (z) { return z.teams; }) }], { x: 0.4, y: 1.0, w: 5.9, h: 4.1, dir: 'bar', reverse: true, colors: [C.a2], name: 'Teams by region', fmt: '0', gap: 35 });
    var tot = zs.reduce(function (a, z) { return a + z.teams; }, 0);
    var b = [[{ text: tot + ' teams ', bold: true }, { text: 'across ' + zs.length + ' regions in ' + lastLong + '.' }],
      [{ text: zs[0].region + ' ', bold: true }, { text: 'is the largest with ' + zs[0].teams + ' teams, ' + Math.round(zs[0].teams / tot * 100) + '% of the network.' }]];
    if (zs.length >= 3) b.push([{ text: zs[1].region + ' and ' + zs[2].region + ' ', bold: true }, { text: 'follow with ' + zs[1].teams + ' and ' + zs[2].teams + ' teams.' }]);
    bullets(s, b, 6.5, 1.2, 3.0, 3.6, 13);
  })();

  /* ---- sales */
  sec('Sales'); sectionsIn.push(['Sales', (P && P.same.length ? 'by month, against ' + P.year + ', ' : 'by month, ') + 'by team']);
  (function () {
    var s = content('Sales by month');
    chart(s, labels, [{ name: 'Sales (TZS billion)', values: sales.map(function (v) { return +(v / 1e9).toFixed(2); }) }], { x: 0.4, y: 1.0, w: 6.2, h: 4.1, colors: [C.a1], name: 'Sales by month', fmt: '0.00' });
    var b = [[{ text: 'TZS ' + anPptB2_(Y.sales) + ' ', bold: true }, { text: 'sold ' + (had.length > 1 ? 'from ' + firstLong + ' to ' + lastLong : 'in ' + firstLong) + '.' }]];
    if (had.length > 1) {
      b.push([{ text: labels[best] + ' was the best month, ', bold: true }, { text: 'TZS ' + anPptB2_(sales[best]) + '. ' + labels[worst] + ' the lowest, TZS ' + anPptB2_(sales[worst]) + '.' }]);
      if (first.sales) b.push([{ text: lastLong + ' is ' + Math.abs(Math.round((last.sales / first.sales - 1) * 100)) + '% ' + (last.sales >= first.sales ? 'above ' : 'below ') + firstLong + ' ', bold: true }, { text: 'with ' + Math.abs(last.teams - first.teams) + (last.teams >= first.teams ? ' more' : ' fewer') + ' teams.' }]);
    }
    bullets(s, b, 6.8, 1.2, 2.7, 3.6, 13);
  })();
  if (P && P.same.length) (function () {
    var s = content(M.year + ' against ' + P.year + ', month by month');
    var cmpV = P.cmp.map(function (m) { return m ? +(m.sales / 1e9).toFixed(2) : 0; });
    chart(s, labels, [{ name: String(P.year), values: cmpV }, { name: String(M.year), values: sales.map(function (v) { return +(v / 1e9).toFixed(2); }) }],
      { x: 0.4, y: 1.0, w: 6.4, h: 4.1, colors: [C.a2, C.a1], name: 'Sales ' + P.year + ' and ' + M.year, fmt: '0.0', dl: 8, gap: 35 });
    var cur = anPptSum_(had.filter(function (m, i) { return P.cmp[i]; }), 'sales');
    var diff = P.sameSales ? Math.round((cur / P.sameSales - 1) * 100) : null;
    var b = [[{ text: 'Same months: ', bold: true }, { text: 'TZS ' + anPptB2_(cur) + ' in ' + M.year + ' against ' + anPptB2_(P.sameSales) + ' in ' + P.year + (diff == null ? '.' : ', ' + Math.abs(diff) + '% ' + (diff >= 0 ? 'more' : 'less') + '.') }]];
    if (P.wholeSales && Y.sales > P.wholeSales) b.push([{ text: 'Already past the whole of ' + P.year + ', ', bold: true }, { text: 'which sold TZS ' + anPptB2_(P.wholeSales) + ' in twelve months.' }]);
    else if (P.wholeSales) b.push([{ text: P.year + ' sold ', bold: true }, { text: 'TZS ' + anPptB2_(P.wholeSales) + ' in the whole year.' }]);
    b.push([{ text: 'Billions of TZS ', bold: true }, { text: 'on the chart, month against the same month.' }]);
    bullets(s, b, 7.0, 1.2, 2.5, 3.6, 12);
  })();
  if (T.length >= 3) (function () {
    var s = content((T.length >= 10 ? 'Ten' : String(Math.min(10, T.length))) + ' teams that sold the most');
    var top = T.slice().sort(function (a, b) { return b.sales - a.sales; }).slice(0, 10);
    chart(s, top.map(function (r) { return r.team; }), [{ name: 'Sales (TZS million)', values: top.map(function (r) { return Math.round(r.sales / 1e6); }) }], { x: 0.4, y: 1.0, w: 6.2, h: 4.1, dir: 'bar', reverse: true, colors: [C.a1], name: 'Top teams by sales', fmt: '#,##0', gap: 30 });
    var b = [[{ text: top[0].team + ' leads ', bold: true }, { text: 'with TZS ' + anPptM1_(top[0].sales) + ', then ' + top[1].team + ' and ' + top[2].team + '.' }]];
    if (T.length >= 10) b.push([{ text: 'The top five ', bold: true }, { text: 'sold ' + top5share.toFixed(1) + '% of the total.' }]);
    if (M.target) b.push([{ text: smallT.length + ' of ' + T.length + ' teams ', bold: true }, { text: 'sold under one month\'s target (TZS ' + anPptM1_(M.target) + ') in total' + (M.recentYms.length ? '; ' + smallT.filter(isRecent).length + ' of them opened in ' + recentWord + ' or later.' : '.') }]);
    bullets(s, b, 6.8, 1.2, 2.7, 3.6, 12.5);
  })();
  var salesPctT = byKey(established, 'salesPct');
  if (salesPctT.length >= 4) (function () {
    var s = content('Sales against the monthly target');
    bestWorst(s, 'sales %', salesPctT, 'salesPct', 'Sales %', anPptPc0_);
    note(s, 'Target: TZS ' + anPptM1_(M.target) + ' of sales per team per month. A team is measured on the months it has been selling.', 4.55, 0.3);
  })();

  /* ---- customers */
  sec('Customers'); sectionsIn.push(['Customers', 'first-time and returning' + (hasZ ? ', by team and region' : ', by team')]);
  (function () {
    var s = content('First-time and returning customers');
    chart(s, labels, [{ name: 'First-time (TRK 1)', values: had.map(function (m) { return m.trk1; }) }, { name: 'Returning', values: had.map(function (m) { return m.retained; }) }],
      { x: 0.4, y: 1.0, w: 6.4, h: 4.1, stacked: true, colors: [C.a2, C.a1], name: 'First-time and returning', fmt: '#,##0', dl: 8, gap: 35 });
    var ret = had.map(function (m) { return m.retentionPct; });
    var bi = ret.indexOf(Math.max.apply(null, ret.filter(function (v) { return v != null; }))), wi = ret.indexOf(Math.min.apply(null, ret.filter(function (v) { return v != null; })));
    var b = [[{ text: anPptN0_(Y.loans) + ' loans, ', bold: true }, { text: anPptN0_(Y.trk1) + ' first-time and ' + anPptN0_(Y.retained) + ' returning.' }],
      [{ text: 'Retention ' + anPptPc_(Y.retentionPct) + ', ', bold: true }, { text: (P && P.totals.retentionPct != null ? 'against ' + anPptPc_(P.totals.retentionPct) + ' for ' + P.year + '. ' : '') + 'A loan not on track 1 is a returning customer\'s.' }]];
    if (had.length > 1 && bi >= 0 && wi >= 0) b.push([{ text: labels[bi] + ' was highest at ' + anPptPc_(ret[bi]) + ', ', bold: true }, { text: labels[wi] + ' lowest at ' + anPptPc_(ret[wi]) + '.' }]);
    bullets(s, b, 7.0, 1.2, 2.5, 3.6, 12);
  })();
  var retT = established.filter(function (r) { return r.retentionPct != null && r.loans >= 30; }).sort(function (a, b) { return b.retentionPct - a.retentionPct; });
  if (retT.length >= 4) (function () {
    var s = content('Retention by team');
    var n = bestWorst(s, 'retention', retT, 'retentionPct', 'Retention %', anPptPc_, { head: 'Loans', get: function (r) { return anPptN0_(r.loans); } });
    var low = retT.slice(-n), newLow = low.filter(isRecent).length;
    note(s, 'Retention is returning customers over all loans. A team that opened recently has few customers who can return' + (M.recentYms.length ? ', so ' + (newLow === low.length ? 'all ' + low.length : newLow + ' of these ' + low.length) + ' lowest teams opened in ' + recentWord + ' or later' : '') + '. Teams under 30 loans are left out.', 4.55, 0.55);
  })();
  if (hasZ) (function () {
    var zr = Z.filter(function (z) { return z.retentionPct != null; }).sort(function (a, b) { return b.retentionPct - a.retentionPct; });
    if (zr.length < 2) return;
    var s = content('Retention by region');
    chart(s, zr.map(function (z) { return z.region; }), [{ name: 'Retention %', values: zr.map(function (z) { return +z.retentionPct.toFixed(1); }) }], { x: 0.4, y: 1.0, w: 5.9, h: 4.1, dir: 'bar', reverse: true, colors: [C.a1], name: 'Retention by region', fmt: '0.0', gap: 35, min: 0, max: 100 });
    var hi = zr[0], lo = zr[zr.length - 1], big = Z.slice().sort(function (a, b) { return b.teams - a.teams; })[0];
    var b = [[{ text: hi.region + ' is highest at ' + anPptPc_(hi.retentionPct) + ', ', bold: true }, { text: 'with ' + hi.teams + ' teams.' }],
      [{ text: big.region + ' is the largest region, ', bold: true }, { text: big.teams + ' teams, at ' + anPptPc_(big.retentionPct) + '.' }]];
    if (lo.region !== hi.region && lo.region !== big.region) b.push([{ text: lo.region + ' is lowest at ' + anPptPc_(lo.retentionPct) + ', ', bold: true }, { text: lo.teams + ' teams.' }]);
    b.push([{ text: 'Company retention ' + anPptPc_(Y.retentionPct) + (P && P.totals.retentionPct != null ? ', ' : '.'), bold: true }, { text: P && P.totals.retentionPct != null ? 'against ' + anPptPc_(P.totals.retentionPct) + ' for ' + P.year + '.' : '' }]);
    bullets(s, b, 6.5, 1.1, 3.0, 3.9, 12.5);
  })();

  /* ---- collection */
  var hasCol = colM.length >= 2 || hasColT;
  if (hasCol) { sec('Collection'); sectionsIn.push(['Collection', (colM.length >= 2 ? 'by month and ' : '') + 'by team']); }
  if (colM.length >= 2) (function () {
    var s = content('Collection by month');
    var vals = colM.map(function (m) { return m.colPct; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    chart(s, colM.map(function (m) { return anPptMon_(m.ym); }), [{ name: 'Collection %', values: vals }], { x: 0.4, y: 1.0, w: 6.2, h: 4.1, colors: [C.a3], name: 'Collection by month', fmt: '0.0', min: Math.max(0, Math.floor((lo - 10) / 10) * 10), max: Math.max(100, Math.ceil(hi / 10) * 10) });
    var ecolM = had.filter(function (m) { return m.ecolPct != null; });
    var b = [[{ text: 'TZS ' + anPptB2_(Y.collected) + ' collected ', bold: true }, { text: 'of ' + anPptB2_(Y.expected) + ' due.' }],
      [{ text: 'From ' + anPptPc_(vals[0]) + ' in ' + anPptLong_(colM[0].ym) + ' ', bold: true }, { text: 'to ' + anPptPc_(vals[vals.length - 1]) + ' in ' + anPptLong_(colM[colM.length - 1].ym) + '.' }]];
    if (ecolM.length) b.push([{ text: 'Early collection ', bold: true }, { text: 'averaged ' + anPptPc_(Y.ecolPct) + ' in the months it was recorded (' + ecolM.map(function (m) { return anPptMon_(m.ym); }).join(', ') + ').' }]);
    bullets(s, b, 6.8, 1.2, 2.7, 3.6, 12.5);
  })();
  if (hasColT) (function () {
    var s = content('Collection by team');
    var el = byKey(established, 'colPct');
    bestWorst(s, 'collection', el, 'colPct', 'Collection %', anPptPc_);
    note(s, el.filter(function (r) { return r.colPct >= 92; }).length + ' of ' + el.length + ' teams with ' + M.minM + ' month' + (M.minM === 1 ? '' : 's') + ' or more collected 92% or better of what was due.' + (M.stamped ? ' For this year collection is the year\'s, as its report closed it.' : ''), 4.55, 0.3);
  })();

  /* ---- recovery */
  if (recM.length >= 2) {
    sec('Recovery'); sectionsIn.push(['Recovery', 'what came back from arrears']);
    var s = content('Recovery by month');
    var vals = recM.map(function (m) { return m.recPct; });
    chart(s, recM.map(function (m) { return anPptMon_(m.ym); }), [{ name: 'Recovery %', values: vals }], { x: 0.4, y: 1.0, w: 6.2, h: 4.1, colors: [C.a1], name: 'Recovery by month', fmt: '0.0', min: 0, max: Math.max(100, Math.ceil(Math.max.apply(null, vals) / 10) * 10) });
    var bi = vals.indexOf(Math.max.apply(null, vals)), wi = vals.indexOf(Math.min.apply(null, vals));
    bullets(s, [
      [{ text: 'TZS ' + anPptB2_(Y.recovered) + ' recovered ', bold: true }, { text: 'out of TZS ' + anPptB2_(Y.uncollected) + ' left uncollected after the due dates.' }],
      [{ text: anPptLong_(recM[bi].ym) + ' was the strongest month at ' + anPptPc_(vals[bi]) + ', ', bold: true }, { text: anPptLong_(recM[wi].ym) + ' the weakest at ' + anPptPc_(vals[wi]) + '.' }],
      [{ text: 'Recovery % ', bold: true }, { text: 'is recovered over uncollected, measured on the teams that had arrears that month.' }],
    ], 6.8, 1.2, 2.7, 3.6, 12.5);
  }

  /* ---- regions */
  if (hasZ) {
    sec('Regions'); sectionsIn.push(['Regions', 'sales, retention and general performance']);
    var sR = content('Regions: sales and general performance');
    var zs = Z.slice().sort(function (a, b) { return b.sales - a.sales; });
    chart(sR, zs.map(function (z) { return z.region; }), [{ name: 'Sales (TZS billion)', values: zs.map(function (z) { return +(z.sales / 1e9).toFixed(2); }) }], { x: 0.3, y: 1.0, w: 4.1, h: 3.5, dir: 'bar', reverse: true, colors: [C.a1], name: 'Sales by region', fmt: '0.00', gap: 30, dl: 9, cat: 9 });
    table(sR, [['Region', 'GMO', 'Teams', 'Collect.', 'Recov.', 'General']].concat(zs.map(function (z) { return [z.region, gmoOf(z.region), z.teams, anPptPc0_(z.colPct), anPptPc0_(z.recPct), anPptPc0_(z.general)]; })), 4.5, 1.05, 5.0, [1.3, 1.2, 0.5, 0.7, 0.65, 0.65], { fs: 9, rowH: 0.32, name: 'Region table', textCols: [0, 1] });
    note(sR, 'Billions of TZS on the chart. A region is its teams\' months added together, the percentages the average of its months. The GMO is the one holding most of the region\'s teams. Recovery above 100% means more came back than was left uncollected that month, on a small base, and it lifts General.', 4.55, 0.55);
    /* THE KEY: every region with its GMO and the teams in it, laid in columns so a long list never
       runs off its card; a region that will not fit the page goes on the next one. */
    var order = Z.slice().sort(function (a, b) { return teamsOf(b.region).length - teamsOf(a.region).length; });
    var cols = order.length > 6 ? 4 : 3, cw = (9.0 - (cols - 1) * 0.12) / cols, perLine = Math.floor(cw * (order.length > 6 ? 15 : 13));
    var page = null, heights = [], pageNo = 0;
    var newPage = function () { pageNo += 1; page = content('Regions: who is in them' + (pageNo > 1 ? ' (continued)' : '')); heights = []; for (var i = 0; i < cols; i++) heights.push(0); };
    newPage();
    order.forEach(function (z) {
      var ts = teamsOf(z.region), names = ts.map(function (t) { return t.team; }).join(', ');
      var lines = Math.max(1, Math.ceil(names.length / perLine)), h = 0.62 + lines * (order.length > 6 ? 0.125 : 0.14);
      var c = heights.indexOf(Math.min.apply(null, heights));
      if (heights[c] + h > 4.1 && heights[c] > 0) { newPage(); c = 0; }
      var x = 0.5 + c * (cw + 0.12), y = 1.0 + heights[c];
      page.addShape(pres.ShapeType.roundRect, { x: x, y: y, w: cw, h: h, rectRadius: 0.06, fill: { color: C.bg2 }, line: { color: C.bg2, width: 0 }, objectName: 'Region card ' + z.region });
      page.addText([{ text: z.region, options: { bold: true, fontSize: 11, color: C.text2, breakLine: true } },
        { text: 'GMO: ' + gmoOf(z.region) + '  ·  ' + ts.length + ' team' + (ts.length === 1 ? '' : 's'), options: { fontSize: 8.5, color: C.a1, bold: true, breakLine: true } },
        { text: names, options: { fontSize: order.length > 6 ? 7.5 : 8.5, color: C.text1 } }], { x: x + 0.1, y: y + 0.05, w: cw - 0.2, h: h - 0.1, valign: 'top', margin: 0, objectName: 'Region key ' + z.region });
      heights[c] += h + 0.1;
    });
  }

  /* ---- credit analysts */
  if (hasCR) {
    sec('Credit analysts'); sectionsIn.push(['Credit analysts', 'sales and retention by analyst']);
    var sC = content('Credit analysts: sales and results');
    var topC = CR.slice(0, 12);
    table(sC, [['Credit analyst', 'Teams', 'Months', 'Sales (TZS M)', 'Retention', 'Collect.', 'General']].concat(topC.map(function (r) { return [r.name, r.teams, r.months, anPptN0_(r.sales / 1e6), anPptPc0_(r.retentionPct), anPptPc0_(r.colPct), anPptPc0_(r.general)]; })),
      0.5, 1.0, 9.0, [2.2, 0.9, 0.95, 1.5, 1.15, 1.15, 1.15], { fs: 9.5, rowH: 0.26, name: 'Credit analysts table' });
    var allCr = ((M.credit && M.credit.length) || 0);
    note(sC, 'The ' + (topC.length < 12 ? '' : 'twelve ') + 'credit analysts with the most sales are shown (' + allCr + ' with ' + M.minM + ' month' + (M.minM === 1 ? '' : 's') + ' or more). A month counts for the analyst who held the team that month. Teams is the number they held in the year.', 4.72, 0.5);
    var retC = topC.filter(function (r) { return r.retentionPct != null; }).sort(function (a, b) { return b.retentionPct - a.retentionPct; });
    if (retC.length >= 3) {
      var sD = content('Retention by credit analyst');
      chart(sD, retC.map(function (r) { return r.name; }), [{ name: 'Retention %', values: retC.map(function (r) { return +r.retentionPct.toFixed(1); }) }], { x: 0.4, y: 1.0, w: 5.9, h: 4.1, dir: 'bar', reverse: true, colors: [C.a2], name: 'Retention by analyst', fmt: '0.0', gap: 30, min: 0, max: 100 });
      bullets(sD, [
        [{ text: retC[0].name + ' leads at ' + anPptPc_(retC[0].retentionPct) + ', ', bold: true }, { text: 'on ' + retC[0].teams + ' teams.' }],
        [{ text: 'Lowest of the ' + retC.length + ': ', bold: true }, { text: retC.slice(-3).reverse().map(function (r) { return r.name + ' ' + anPptPc_(r.retentionPct); }).join(', ') + '.' }],
        [{ text: 'The ' + retC.length + ' ', bold: true }, { text: 'with the most sales; retention is returning loans over all loans in the months they held the teams.' }],
      ], 6.5, 1.2, 3.0, 3.6, 13);
    }
  }

  /* ---- teams, leaders, snapshot */
  sec('Teams and leaders');
  var tlItems = [];
  var genT = byKey(established, 'general');
  if (hasGeneralT) (function () {
    tlItems.push('general performance');
    var s = content('General performance by team');
    var n = Math.min(10, Math.floor(genT.length / 2));
    var row = function (r) { return [r.team, anPptPc0_(r.salesPct), anPptPc0_(r.colPct), anPptPc0_(r.recPct), anPptPc0_(r.general)]; };
    heading2(s, 'Top ' + n, 0.5, 0.95, 4.6, C.a3);
    table(s, [['Team', 'Sales', 'Collect.', 'Recov.', 'General']].concat(genT.slice(0, n).map(row)), 0.5, 1.25, 4.6, [1.75, 0.65, 0.75, 0.75, 0.7], { fs: 9.5, rowH: 0.27, name: 'Top general' });
    heading2(s, 'Bottom ' + n, 5.25, 0.95, 4.25, C.a5);
    table(s, [['Team', 'Sales', 'Collect.', 'Recov.', 'General']].concat(genT.slice(-n).reverse().map(row)), 5.25, 1.25, 4.25, [1.5, 0.6, 0.7, 0.7, 0.75], { fs: 9.5, rowH: 0.27, name: 'Bottom general' });
    note(s, 'General is the average of sales, collection and recovery over the months a team has been selling (' + M.minM + ' or more). Recovery passes 100% where the uncollected amount was small, which lifts the top of this list; read the recovery column beside it.', 4.4, 0.65);
  })();
  if (M.gmo.length || M.opm.length) (function () {
    tlItems.push('leaders');
    var s = content('General performance by leader');
    var g = M.gmo.slice(0, 25);
    if (g.length) {
      heading2(s, 'GMOs, by General %', 0.5, 0.95, 5.2, C.text2);
      chart(s, g.map(function (r) { return r.name; }), [{ name: 'General %', values: g.map(function (r) { return Math.round(r.general); }) }], { x: 0.3, y: 1.2, w: 5.6, h: 4.0, dir: 'bar', reverse: true, colors: [C.a1], name: 'GMO general', fmt: '0', gap: 25, dl: 8, cat: 8 });
    }
    if (M.opm.length) {
      heading2(s, 'OPMs, by General %', g.length ? 6.1 : 0.5, 0.95, 3.4, C.text2);
      table(s, [['OPM', 'Sales', 'Collect.', 'General']].concat(M.opm.slice(0, 12).map(function (r) { return [r.name, anPptPc0_(r.salesPct), anPptPc0_(r.colPct), anPptPc0_(r.general)]; })), g.length ? 6.1 : 0.5, 1.3, g.length ? 3.4 : 5.5, g.length ? [1.1, 0.7, 0.8, 0.8] : [2.4, 1.0, 1.1, 1.0], { fs: 9.5, rowH: 0.26, name: 'OPM table' });
    }
    s.addText('A leader is judged on the teams they held each month, averaged, then averaged over their months. Names are those recorded for each month.', { x: g.length ? 6.1 : 0.5, y: g.length ? 3.9 : 4.4, w: g.length ? 3.4 : 9, h: 0.9, fontSize: 10.5, italic: true, color: C.a6, margin: 0, valign: 'top', objectName: 'Leader note' });
  })();
  (function () {
    tlItems.push('the months in one table');
    var s = content('Statistical snapshot: ' + (had.length === 1 ? 'the month' : 'the ' + had.length + ' months'));
    var row = function (name, teams, sales, loans, ret, col, rec, gen) { return [name, teams, anPptB2_(sales), anPptN0_(loans), anPptPc_(ret), anPptPc_(col), anPptPc_(rec), anPptPc_(gen)]; };
    var rows = [['Month', 'Teams', 'Sales (TZS)', 'Loans', 'Retention', 'Collection', 'Recovery', 'General']]
      .concat(had.map(function (m, i) { return row(labels[i], m.teams, m.sales, m.loans, m.retentionPct, m.colPct, m.recPct, m.general); }))
      .concat([row(M.complete ? 'Year' : 'Year to date', last.teams, Y.sales, Y.loans, Y.retentionPct, Y.colPct, Y.recPct, Y.general)]);
    var rowH = Math.min(0.3, 3.7 / rows.length);
    table(s, rows, 0.5, 1.0, 9.0, [1.5, 0.8, 1.35, 1.0, 1.1, 1.1, 1.05, 1.1], { fs: rows.length > 12 ? 9.5 : 10, rowH: rowH, name: 'Snapshot table' });
    note(s, 'Sales and loans are totals for the period. Collection, recovery and General are the average of the months; retention is returning loans over all loans.', 4.78, 0.3);
  })();
  sectionsIn.push(['Teams, leaders, snapshot', tlItems.join(', ')]);

  /* ---- portfolio at risk, where the year's report stamped it */
  var parT = T.filter(function (r) { return r.par != null; });
  if (parT.length >= 4) (function () {
    sec('PAR at year close'); sectionsIn.push(['Portfolio at risk, as the year closed it', 'by team, from the ' + M.year + ' report']);
    var s = content('Portfolio at risk by team, as the ' + M.year + ' report closed it');
    var asc = parT.slice().sort(function (a, b) { return a.par - b.par; });
    var n = Math.min(8, Math.floor(asc.length / 2));
    var line = function (r) { return [r.team, anPptPc_(r.par), r.totalDef == null ? '—' : anPptN0_(r.totalDef / 1e6)]; };
    heading2(s, 'Lowest PAR', 0.5, 1.0, 4.4, C.a3);
    table(s, [['Team', 'PAR %', 'Total def (TZS M)']].concat(asc.slice(0, n).map(line)), 0.5, 1.35, 4.4, [2.2, 1.0, 1.2], { name: 'Lowest PAR', rowH: 0.3, fs: 9.5 });
    heading2(s, 'Highest PAR', 5.1, 1.0, 4.4, C.a5);
    table(s, [['Team', 'PAR %', 'Total def (TZS M)']].concat(asc.slice(-n).reverse().map(line)), 5.1, 1.35, 4.4, [2.2, 1.0, 1.2], { name: 'Highest PAR', rowH: 0.3, fs: 9.5 });
    note(s, 'PAR is the share of the loan book overdue, as the ' + M.year + ' report closed it. Company average ' + anPptPc_(Y.par) + ' over ' + parT.length + ' teams.', 4.55, 0.3);
  })();

  /* ---- THE BOOKS: portfolio at risk, the active portfolio, legal. Each is the portal's own tab's answer. */
  var BK = M.book || {};
  var parDate = BK.par && BK.par.date ? BK.par.date : null;
  var rs = function (v) { return anPptM1_(v); };
  var sayWhy = function (title, sec_, what) {
    var sl = content(title);
    sl.addShape(pres.ShapeType.roundRect, { x: 0.5, y: 1.2, w: 9.0, h: 1.6, rectRadius: 0.08, fill: { color: C.bg2 }, line: { color: C.bg2, width: 0 }, objectName: 'Reason card' });
    sl.addText([{ text: what, options: { bold: true, fontSize: 16, color: C.text2, breakLine: true } }, { text: sec_, options: { fontSize: 13, color: C.text1 } }],
      { x: 0.75, y: 1.3, w: 8.5, h: 1.4, valign: 'middle', margin: 0, objectName: 'Reason' });
  };
  var stateWord = function (st) { var i = String(st).indexOf('/'); return (i >= 0 ? String(st).slice(i + 1) : String(st)).trim() || 'No state'; };

  /* -- portfolio at risk */
  (function () {
    var P_ = BK.par;
    sec('Portfolio at risk'); sectionsIn.push(['Portfolio at risk', P_ && P_.ok && !P_.empty ? 'as at ' + P_.date + ': days overdue, region, team, status' : 'the portal\'s PAR tab']);
    if (!P_ || !P_.ok) { sayWhy('Portfolio at risk', P_ ? 'This section ' + P_.reason + '. Export again from a code that holds it.' : 'The books did not load with this export. Check the connection and export again.', 'Not in this export'); return; }
    if (P_.empty) { sayWhy('Portfolio at risk', 'The portal has no defaulter deck uploaded, so there is no PAR to show. Upload the defaulter deck and export again.', 'No defaulter deck yet'); return; }
    var Tt = P_.totals || {};
    var s1 = content('Portfolio at risk: the book as at ' + P_.date);
    var w = 1.95, h = 1.3, gx = 0.1;
    card(s1, 0.5, 1.0, w, h, 'PAR', anPptPc_(Tt.par), 'arrears over the balance of customers in arrears', { color: C.a5 });
    card(s1, 0.5 + (w + gx), 1.0, w, h, 'Arrears', 'TZS ' + anPptB2_(Tt.arrears), anPptN0_(Tt.customers) + ' customers in arrears');
    card(s1, 0.5 + 2 * (w + gx), 1.0, w, h, 'All-time PAR', anPptPc_(Tt.parAll), 'arrears over TZS ' + anPptB2_(Tt.totalLoan) + ' ever lent' + (P_.allTime && P_.allTime.since ? ' since ' + P_.allTime.since : ''), { color: C.a1 });
    card(s1, 0.5 + 3 * (w + gx), 1.0, w, h, 'Average loan', 'TZS ' + anPptN0_(Tt.avgLoan), 'of the customers in arrears', { vs: 20 });
    var bands = (P_.bands || []).filter(function (b) { return b.customers > 0 || b.arrears > 0; });
    if (bands.length) {
      chart(s1, bands.map(function (b) { return b.band; }), [{ name: 'Arrears (TZS million)', values: bands.map(function (b) { return Math.round(b.arrears / 1e6); }) }], { x: 0.4, y: 2.45, w: 5.6, h: 2.7, colors: [C.a5], name: 'Arrears by days overdue', fmt: '#,##0', gap: 35 });
      bullets(s1, [[{ text: 'Arrears by days overdue, ', bold: true }, { text: 'in TZS million. ' + bands.reduce(function (a, b) { return b.arrears > a.arrears ? b : a; }, bands[0]).band + ' days holds the most.' }],
        [{ text: 'PAR ', bold: true }, { text: 'is the arrears over the balance of those customers; all-time PAR puts the same arrears over everything the company has lent.' }]], 6.2, 2.6, 3.3, 2.4, 11.5);
    }
    var regs = (P_.byRegion || []).filter(function (r) { return r.par != null; }).sort(function (a, b) { return b.par - a.par; });
    if (regs.length >= 2) {
      var s2 = content('Portfolio at risk by region');
      chart(s2, regs.map(function (r) { return r.region; }), [{ name: 'PAR %', values: regs.map(function (r) { return +r.par.toFixed(1); }) }], { x: 0.3, y: 1.0, w: 4.3, h: 3.5, dir: 'bar', reverse: true, colors: [C.a5], name: 'PAR by region', fmt: '0.0', gap: 30, dl: 9, cat: 9 });
      table(s2, [['Region', 'Customers', 'Arrears (M)', 'PAR %', 'All-time']].concat(regs.map(function (r) { return [r.region, anPptN0_(r.customers), anPptN0_(r.arrears / 1e6), anPptPc_(r.par), anPptPc_(r.parAll)]; })), 4.7, 1.05, 4.8, [1.5, 0.85, 0.95, 0.75, 0.75], { fs: 9, rowH: 0.3, name: 'PAR by region table' });
      note(s2, 'As at ' + P_.date + '. A region is its teams\' customers added together: arrears over balance, and over everything its teams have lent.', 4.6, 0.4);
    }
    var tms = (P_.byTeam || []).filter(function (t) { return t.customers > 0; });
    if (tms.length >= 4) {
      var s3 = content('Portfolio at risk by team');
      var n = Math.min(10, Math.floor(tms.length / 2));
      var worst = tms.slice().sort(function (a, b) { return b.arrears - a.arrears; }).slice(0, n);
      var best = (P_.byTeam || []).filter(function (t) { return t.parAll != null; }).sort(function (a, b) { return a.parAll - b.parAll; }).slice(0, n);
      heading2(s3, 'Most arrears', 0.5, 0.95, 4.4, C.a5);
      table(s3, [['Team', 'Cust.', 'Arrears (M)', 'PAR %']].concat(worst.map(function (t) { return [t.team, t.customers, anPptN0_(t.arrears / 1e6), anPptPc_(t.par)]; })), 0.5, 1.28, 4.4, [1.7, 0.7, 1.1, 0.9], { fs: 9.5, rowH: 0.29, name: 'Most arrears' });
      heading2(s3, 'Lowest all-time PAR', 5.1, 0.95, 4.4, C.a3);
      table(s3, [['Team', 'Lent (M)', 'Arrears (M)', 'All-time']].concat(best.map(function (t) { return [t.team, anPptN0_(t.totalLoan / 1e6), anPptN0_(t.arrears / 1e6), anPptPc_(t.parAll)]; })), 5.1, 1.28, 4.4, [1.5, 0.9, 1.0, 1.0], { fs: 9.5, rowH: 0.29, name: 'Lowest all-time PAR' });
      note(s3, 'As at ' + P_.date + '. A team with no customer in arrears sits at 0%: the best row on the board, not a missing one.', 4.6, 0.4);
    }
    var sts = (P_.byStatus || []).filter(function (x) { return x.arrears > 0; });
    if (sts.length >= 2) {
      var s4 = content('Arrears by status');
      chart(s4, sts.map(function (x) { return x.status; }), [{ name: 'Arrears (TZS million)', values: sts.map(function (x) { return Math.round(x.arrears / 1e6); }) }], { x: 0.4, y: 1.0, w: 5.9, h: 4.1, colors: [C.a5], name: 'Arrears by status', fmt: '#,##0', gap: 40 });
      bullets(s4, sts.slice(0, 4).map(function (x) { return [{ text: x.status + ': ', bold: true }, { text: anPptN0_(x.customers) + ' customers, TZS ' + anPptM1_(x.arrears) + ' in arrears.' }]; }), 6.5, 1.2, 3.0, 3.6, 12.5);
    }
  })();

  /* -- the active portfolio */
  (function () {
    var A_ = BK.portfolio;
    sec('Active portfolio'); sectionsIn.push(['Active portfolio', A_ && A_.ok && !A_.empty ? 'the customers on the ' + A_.date + ' expected deck' : 'the portal\'s expected deck']);
    if (!A_ || !A_.ok) { sayWhy('Active portfolio', A_ ? 'This section ' + A_.reason + '. Export again from a code that holds it.' : 'The books did not load with this export. Check the connection and export again.', 'Not in this export'); return; }
    if (A_.empty) { sayWhy('Active portfolio', 'The portal has no expected deck uploaded, so there is no active portfolio to show. Upload the expected deck and export again.', 'No expected deck yet'); return; }
    var s1 = content('Active portfolio: customers on the ' + A_.date + ' deck');
    var w = 1.95, h = 1.3, gx = 0.1, behindPct = A_.customers ? Math.round(A_.behind.customers / A_.customers * 1000) / 10 : null;
    card(s1, 0.5, 1.0, w, h, 'Customers', anPptN0_(A_.customers), 'on the latest expected deck');
    card(s1, 0.5 + (w + gx), 1.0, w, h, 'Outstanding', 'TZS ' + anPptB2_(A_.balance), 'balance still owed by them', { color: C.a1 });
    card(s1, 0.5 + 2 * (w + gx), 1.0, w, h, 'Behind', anPptPc_(behindPct), anPptN0_(A_.behind.customers) + ' customers owe TZS ' + anPptM1_(A_.behind.arrears) + ' in arrears', { color: C.a5 });
    card(s1, 0.5 + 3 * (w + gx), 1.0, w, h, 'Collected that day', anPptPc_(A_.collectedPct), 'TZS ' + anPptM1_(A_.collected) + ' of ' + anPptM1_(A_.expected) + ' due', { color: C.a3 });
    var sts = (A_.byStatus || []).slice(0, 6);
    if (sts.length) {
      chart(s1, sts.map(function (x) { return x.status; }), [{ name: 'Customers', values: sts.map(function (x) { return x.customers; }) }], { x: 0.4, y: 2.45, w: 5.6, h: 2.7, colors: [C.a2], name: 'Customers by status', fmt: '#,##0', gap: 35 });
      bullets(s1, [[{ text: 'Customers by today\'s status ', bold: true }, { text: 'on the deck, ' + sts[0].status + ' the largest with ' + anPptN0_(sts[0].customers) + '.' }],
        [{ text: 'Behind ', bold: true }, { text: 'means arrears on the deck: ' + anPptN0_(A_.behind.customers) + ' of ' + anPptN0_(A_.customers) + ' customers, holding TZS ' + anPptB2_(A_.behind.balance) + ' of the balance.' }]], 6.2, 2.6, 3.3, 2.4, 11.5);
    }
    var regs = (A_.byRegion || []).slice().sort(function (a, b) { return b.balance - a.balance; });
    if (regs.length >= 2) {
      var s2 = content('Active portfolio by region');
      chart(s2, regs.map(function (r) { return r.region; }), [{ name: 'Outstanding (TZS billion)', values: regs.map(function (r) { return +(r.balance / 1e9).toFixed(2); }) }], { x: 0.3, y: 1.0, w: 4.3, h: 3.5, dir: 'bar', reverse: true, colors: [C.a1], name: 'Balance by region', fmt: '0.00', gap: 30, dl: 9, cat: 9 });
      table(s2, [['Region', 'Customers', 'Balance (B)', 'Behind', 'Arrears %']].concat(regs.map(function (r) { return [r.region, anPptN0_(r.customers), (r.balance / 1e9).toFixed(2), anPptN0_(r.behind), anPptPc_(r.arrearsPct)]; })), 4.7, 1.05, 4.8, [1.5, 0.85, 0.95, 0.75, 0.75], { fs: 9, rowH: 0.3, name: 'Portfolio by region table' });
      note(s2, 'As at ' + A_.date + '. Arrears % is arrears over the outstanding balance, summed over the region\'s customers.', 4.6, 0.4);
    }
    var tms = (A_.byTeam || []).slice(0, 12);
    if (tms.length >= 4) {
      var s3 = content('Active portfolio by team');
      table(s3, [['Team', 'Region', 'Customers', 'Balance (M)', 'Behind', 'Arrears %']].concat(tms.map(function (t) { return [t.team, t.region || '—', anPptN0_(t.customers), anPptN0_(t.balance / 1e6), anPptN0_(t.behind), anPptPc_(t.arrearsPct)]; })), 0.5, 1.0, 9.0, [2.0, 1.9, 1.1, 1.4, 1.0, 1.6], { fs: 9.5, rowH: 0.28, name: 'Portfolio by team table', textCols: [0, 1] });
      note(s3, 'The twelve teams with the largest outstanding balance, as at ' + A_.date + '.', 4.7, 0.3);
    }
  })();

  /* -- legal */
  (function () {
    var L_ = BK.legal;
    sec('Legal'); sectionsIn.push(['Legal', L_ && L_.ok && !L_.empty ? 'demand notices in ' + M.year + ' and what they brought in' : 'the portal\'s legal register']);
    if (!L_ || !L_.ok) { sayWhy('Legal performance', L_ ? 'This section ' + L_.reason + '. Export again from a code that holds it.' : 'The books did not load with this export. Check the connection and export again.', 'Not in this export'); return; }
    if (L_.empty) { sayWhy('Legal performance', 'The register holds no demand notice dated ' + M.year + '.', 'No notices in ' + M.year); return; }
    var s1 = content('Legal: demand notices in ' + M.year);
    var w = 2.9, h = 1.5, gx = 0.15;
    card(s1, 0.5, 1.05, w, h, 'Notices', anPptN0_(L_.notices), anPptN0_(L_.customers) + ' customers served');
    card(s1, 0.5 + w + gx, 1.05, w, h, 'Demanded', 'TZS ' + anPptB2_(L_.demanded), 'including TZS ' + anPptM1_(L_.fines) + ' in fines', { color: C.a1 });
    card(s1, 0.5 + 2 * (w + gx), 1.05, w, h, 'Cleared', anPptN0_(L_.cleared), 'customers owe nothing now', { color: C.a3 });
    card(s1, 0.5, 1.05 + h + gx, w, h, 'Recovery', anPptPc_(L_.recoveryPct), 'arrears down by TZS ' + anPptM1_(L_.recovery) + ' of ' + anPptM1_(L_.owed) + ' at notice', { color: C.a3 });
    card(s1, 0.5 + w + gx, 1.05 + h + gx, w, h, 'Paid since notice', L_.paymentsOn ? 'TZS ' + anPptM1_(L_.paidSince) : '—', L_.paymentsOn ? 'received after the letters, once per customer' : 'the payments ledger is not installed', { color: C.a1 });
    card(s1, 0.5 + 2 * (w + gx), 1.05 + h + gx, w, h, 'Arrears at notice', 'TZS ' + anPptM1_(L_.atNotice), 'what the letters chased');
    note(s1, 'Notices dated ' + M.year + (L_.asOf ? ', recovery as at the ' + L_.asOf + ' defaulter deck' : '') + '. Each customer is counted once, at their earliest notice.', 4.75, 0.3);
    var s2 = content('Notices by month and by state');
    var ms = L_.byMonth.filter(function (m) { return m.notices > 0; });
    chart(s2, ms.map(function (m) { return anPptMon_(m.ym); }), [{ name: 'Notices', values: ms.map(function (m) { return m.notices; }) }], { x: 0.3, y: 1.0, w: 5.0, h: 3.6, colors: [C.a1], name: 'Notices by month', fmt: '#,##0', gap: 40 });
    var st = (L_.byState || []).filter(function (x) { return x.notices > 0; }).slice(0, 5);
    if (st.length) chart(s2, st.map(function (x) { return stateWord(x.state); }), [{ name: 'Notices', values: st.map(function (x) { return x.notices; }) }], { x: 5.4, y: 1.0, w: 4.3, h: 3.6, dir: 'bar', reverse: true, colors: [C.a2], name: 'Notices by state', fmt: '#,##0', gap: 35, dl: 9, cat: 9 });
    heading2(s2, 'By month', 0.5, 0.75, 4.0, C.text2); heading2(s2, 'Where the notices stand now', 5.5, 0.75, 4.0, C.text2);
    note(s2, 'The busiest month was ' + anPptLong_(ms.reduce(function (a, m) { return m.notices > a.notices ? m : a; }, ms[0]).ym) + ' with ' + ms.reduce(function (a, m) { return Math.max(a, m.notices); }, 0) + ' notices.', 4.7, 0.3);
    var tms = (L_.byTeam || []).slice(0, 12);
    if (tms.length >= 3) {
      var s3 = content('Legal by team');
      table(s3, [['Team', 'Region', 'Notices', 'Demanded (M)', 'Paid since (M)', 'Recovery %']].concat(tms.map(function (t) { return [t.team, t.region || '—', anPptN0_(t.notices), anPptN0_(t.demanded / 1e6), L_.paymentsOn ? anPptN0_(t.paidSince / 1e6) : '—', anPptPc_(t.recoveryPct)]; })), 0.5, 1.0, 9.0, [2.0, 1.9, 1.0, 1.5, 1.4, 1.2], { fs: 9.5, rowH: 0.28, name: 'Legal by team table', textCols: [0, 1] });
      note(s3, 'The twelve teams with the most demanded in ' + M.year + '. Recovery % is the arrears drop over what the letters chased.', 4.7, 0.3);
    }
  })();

  /* ---- notes: observations, what to focus on, what is not here, sources */
  sec('Notes'); sectionsIn.push(['Notes', 'what the figures say and where they come from']);
  (function () {
    var rows = [];
    if (P && P.same.length && P.sameSales) {
      var cur = anPptSum_(had.filter(function (m, i) { return P.cmp[i]; }), 'sales'), df = Math.round((cur / P.sameSales - 1) * 100);
      rows.push([(df >= 0 ? '+' : '') + df + '%', C.a1, 'Sales against ' + P.year + '. ', 'The same months sold TZS ' + anPptB2_(cur) + ' against ' + anPptB2_(P.sameSales) + ' last year.']);
    } else rows.push(['TZS ' + anPptB2_(Y.sales), C.a1, 'Sales. ', anPptN0_(Y.loans) + ' loans in ' + (had.length > 1 ? had.length + ' months' : firstLong) + ', ' + anPptN0_(Y.trk1) + ' of them to first-time customers.']);
    rows.push([String(last.teams), C.a2, 'The network. ', last.teams + ' teams sold in ' + lastLong + (had.length > 1 && first.sales ? ', each TZS ' + anPptM1_(last.sales / last.teams) + ' on average against ' + anPptM1_(first.sales / first.teams) + ' in ' + firstLong : '') + '.']);
    if (Y.colPct != null) rows.push([anPptPc0_(Y.colPct), C.a3, 'Collection. ', 'Averaged ' + anPptPc_(Y.colPct) + (colM.length > 1 ? '; ' + anPptLong_(colM[colM.reduce(function (b, m, i, a) { return m.colPct > a[b].colPct ? i : b; }, 0)].ym) + ' was the highest month at ' + anPptPc_(Math.max.apply(null, colM.map(function (m) { return m.colPct; }))) + ' and ' + anPptLong_(colM[colM.reduce(function (b, m, i, a) { return m.colPct < a[b].colPct ? i : b; }, 0)].ym) + ' the lowest at ' + anPptPc_(Math.min.apply(null, colM.map(function (m) { return m.colPct; }))) : '') + '.']);
    if (Y.recPct != null) rows.push([anPptPc0_(Y.recPct), C.a4, 'Recovery. ', 'Averaged ' + anPptPc_(Y.recPct) + (Y.colPct != null ? ' against ' + anPptPc_(Y.colPct) + ' for collection' : '') + '; TZS ' + anPptB2_(Y.recovered) + ' came back out of ' + anPptB2_(Y.uncollected) + ' left uncollected.']);
    rows.push([anPptPc0_(Y.retentionPct), C.text2, 'Retention. ', anPptPc_(Y.retentionPct) + ' of loans went to returning customers' + (P && P.totals.retentionPct != null ? ', against ' + anPptPc_(P.totals.retentionPct) + ' in ' + P.year : '') + '.']);
    var s = content('Key observations');
    var pitch = Math.min(0.83, 4.1 / rows.length);
    rows.forEach(function (r, i) {
      var y = 1.0 + i * pitch, h = pitch - 0.13;
      s.addShape(pres.ShapeType.roundRect, { x: 0.5, y: y, w: 9.0, h: h, rectRadius: 0.08, fill: { color: C.bg2 }, line: { color: C.bg2, width: 0 }, objectName: 'Row ' + (i + 1) });
      s.addShape(pres.ShapeType.roundRect, { x: 0.62, y: y + (h - 0.5) / 2, w: 1.3, h: 0.5, rectRadius: 0.08, fill: { color: r[1] }, line: { color: r[1], width: 0 }, objectName: 'Figure chip ' + (i + 1) });
      s.addText(r[0], { x: 0.62, y: y + (h - 0.5) / 2, w: 1.3, h: 0.5, fontSize: r[0].length > 6 ? 13 : 18, bold: true, color: C.bg1, align: 'center', valign: 'middle', margin: 0, objectName: 'Figure ' + (i + 1) });
      s.addText([{ text: r[2], options: { bold: true, color: C.text2 } }, { text: r[3], options: { color: C.text1 } }], { x: 2.1, y: y, w: 7.3, h: h, fontSize: 13, valign: 'middle', margin: 0, objectName: 'Observation ' + (i + 1) });
    });
  })();
  (function () {
    var rows = [];
    var lowRec = established.filter(function (r) { return r.recPct != null && r.recPct < 50; }).length;
    if (recM.length && established.some(function (r) { return r.recPct != null; })) rows.push([String(lowRec), C.a4, 'Recovery needs the most attention. ', lowRec + ' of ' + established.length + ' established teams recovered under half of their arrears' + (Y.recPct != null && Y.colPct != null ? ', and the company averaged ' + anPptPc_(Y.recPct) + ' against ' + anPptPc_(Y.colPct) + ' for collection' : '') + '.']);
    if (M.target && smallT.length) rows.push([String(smallT.length), C.a1, 'Some teams are still below one month\'s target in total. ', smallT.length + ' of ' + T.length + ' teams sold under TZS ' + anPptM1_(M.target) + ' in the period' + (M.recentYms.length ? ', and ' + smallT.filter(isRecent).length + ' of them opened in ' + recentWord + ' or later' : '') + '.']);
    var bigZ = Z.filter(function (z) { return z.teams >= 10 && z.retentionPct != null; }).sort(function (a, b) { return a.retentionPct - b.retentionPct; })[0];
    if (bigZ && Y.retentionPct != null) rows.push([anPptPc0_(bigZ.retentionPct), C.a5, bigZ.region + ' has the lowest retention of the large regions. ', anPptPc_(bigZ.retentionPct) + ' across ' + bigZ.teams + ' teams, against ' + anPptPc_(Y.retentionPct) + ' for the company: returning customers are the lever.']);
    var lowCol = established.filter(function (r) { return r.colPct != null && r.colPct < 85; }).length;
    if (hasColT) rows.push([String(lowCol), C.a3, 'Collection, and the teams below 85%. ', lowCol + ' of ' + established.filter(function (r) { return r.colPct != null; }).length + ' established teams collected under 85% of what was due' + (Y.colPct != null ? ', while the company averaged ' + anPptPc_(Y.colPct) : '') + '.']);
    if (rows.length < 2) return;
    var s = content('What the figures point to');
    var pitch = Math.min(1.0, 4.1 / rows.length);
    rows.forEach(function (r, i) {
      var y = 1.0 + i * pitch, h = pitch - 0.15;
      s.addShape(pres.ShapeType.roundRect, { x: 0.5, y: y, w: 9.0, h: h, rectRadius: 0.08, fill: { color: C.bg2 }, line: { color: C.bg2, width: 0 }, objectName: 'Row ' + (i + 1) });
      s.addShape(pres.ShapeType.roundRect, { x: 0.62, y: y + (h - 0.5) / 2, w: 1.3, h: 0.5, rectRadius: 0.08, fill: { color: r[1] }, line: { color: r[1], width: 0 }, objectName: 'Figure chip ' + (i + 1) });
      s.addText(r[0], { x: 0.62, y: y + (h - 0.5) / 2, w: 1.3, h: 0.5, fontSize: 18, bold: true, color: C.bg1, align: 'center', valign: 'middle', margin: 0, objectName: 'Figure ' + (i + 1) });
      s.addText([{ text: r[2], options: { bold: true, color: C.text2 } }, { text: r[3], options: { color: C.text1 } }], { x: 2.1, y: y, w: 7.3, h: h, fontSize: 13, valign: 'middle', margin: 0, objectName: 'Focus ' + (i + 1) });
    });
  })();
  (function () {
    var s = content('Not in this export');
    table(s, [['Section of the 2025 report', 'Where it comes from']].concat([
      ['Staff headcount and turnover', 'HR records: the portal holds no staff history'],
      ['Loan applications: assigned and unassigned, processing time', 'Not kept as history: needs a daily count of applications per stage'],
      ['Legal: court cases, win rate and lawyer cost', 'The legal sheet. The portal holds the demand notices, which are in this deck'],
      ['Fleet maintenance: status, cost, condition', 'The fleet maintenance file (pending)'],
    ]), 0.5, 1.0, 9.0, [4.3, 4.7], { fs: 11, rowH: 0.55, name: 'Not in this export', left: true });
    note(s, 'Everything else in the annual report is in this deck: sales, retention, collection, recovery, regions, credit analysts, teams, leaders, portfolio at risk, the active portfolio and legal.', 4.7, 0.35);
  })();
  (function () {
    var s = content('Notes on the figures');
    var b = [
      [{ text: 'Source. ', bold: true }, { text: 'The Annual Rep tab of the HOPE portal, ' + M.today + '. Sales, count and retention come from the approved list in the loans table; collection and recovery from the stamped workbook months and the daily decks.' }],
      [{ text: 'Percentages. ', bold: true }, { text: 'Sales % is sales over TZS ' + anPptM1_(M.target) + ' per team per month; collection % is collected over expected; recovery % is recovered over uncollected. A year is the average of the months that have happened.' }],
      [{ text: 'Retention. ', bold: true }, { text: 'A loan whose track number is not 1 belongs to a returning customer, so retention is loans less track 1 loans, over loans.' }],
    ];
    if (M.pending.length) b.push([{ text: 'Still being built. ', bold: true }, { text: 'Collection and recovery for ' + M.pending.map(function (m) { return anPptLong_(m.ym); }).join(', ') + ' were not ready when this was exported, so they are blank. Export again shortly.' }]);
    if (M.stamped) b.push([{ text: M.year + '. ', bold: true }, { text: 'Collection and PAR are the year\'s, as the ' + M.year + ' report closed them; there is no monthly collection or recovery for this year.' }]);
    if (BK.par || BK.portfolio || BK.legal) b.push([{ text: 'The books. ', bold: true }, { text: 'Portfolio at risk' + (parDate ? ' and the active portfolio are the portal\'s books as at ' + parDate : ' and the active portfolio are the portal\'s books as at the latest deck') + (M.complete ? ', not rebuilt for the end of ' + M.year : '') + '. Legal counts the notices dated ' + M.year + ', with recovery as at the latest deck.' }]);
    b.push([{ text: 'Not in this report. ', bold: true }, { text: 'See the previous slide.' }]);
    bullets(s, b, 0.6, 1.0, 8.8, 4.2, 12);
  })();

  /* ---- the contents slide, now that the sections are known */
  (function () {
    var s = contents;
    var n = sectionsIn.length, wide = n > 10, cols = wide ? 3 : 2, gap = wide ? 0.1 : 0.2;
    var iw = (9.0 - (cols - 1) * gap) / cols, rowsN = Math.ceil(n / cols), pitch = Math.min(1.0, 4.1 / rowsN), ih = Math.min(0.8, pitch - 0.12);
    sectionsIn.forEach(function (it, i) {
      var col = i % cols, row = Math.floor(i / cols), x = 0.5 + col * (iw + gap), y = 1.0 + row * pitch;
      s.addShape(pres.ShapeType.roundRect, { x: x, y: y, w: iw, h: ih, rectRadius: 0.08, fill: { color: C.bg2 }, line: { color: C.bg2, width: 0 }, objectName: 'Item ' + (i + 1) });
      s.addShape(pres.ShapeType.ellipse, { x: x + 0.12, y: y + (ih - 0.4) / 2, w: 0.4, h: 0.4, fill: { color: C.a1 }, line: { color: C.a1, width: 0 }, objectName: 'Number ' + (i + 1) });
      s.addText(String(i + 1), { x: x + 0.12, y: y + (ih - 0.4) / 2, w: 0.4, h: 0.4, fontSize: 13, bold: true, color: C.bg1, align: 'center', valign: 'middle', margin: 0, objectName: 'Numeral ' + (i + 1) });
      s.addText([{ text: it[0], options: { bold: true, fontSize: wide ? 12 : 14, color: C.text2, breakLine: true } }, { text: it[1], options: { fontSize: wide ? 8.5 : 10.5, color: C.text1 } }],
        { x: x + 0.62, y: y + 0.03, w: iw - 0.72, h: ih - 0.06, valign: 'middle', margin: 0, objectName: 'Item text ' + (i + 1) });
    });
  })();
  return pres;
}

/* ---------------------------------------------------------------------------- the button */
function anPptScript_(src, ready) {
  return new Promise(function (res, rej) {
    if (ready()) return res();
    var s = document.createElement('script');
    s.src = src + '?v=' + encodeURIComponent(typeof BUILD === 'undefined' ? '' : BUILD);
    s.onload = function () { ready() ? res() : rej(new Error('The deck library loaded but did not start.')); };
    s.onerror = function () { if (s.parentNode) s.parentNode.removeChild(s); rej(new Error('The deck library did not load. Check the connection and try again.')); };
    document.head.appendChild(s);
  });
}
function anPptImage_(url) {
  return fetch(url).then(function (r) { if (!r.ok) throw new Error('A deck image did not load (' + url + ').'); return r.blob(); }).then(function (b) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).replace(/^data:/, '')); };   // pptxgenjs wants "image/png;base64,..."
      fr.onerror = function () { rej(new Error('A deck image could not be read.')); };
      fr.readAsDataURL(b);
    });
  });
}
/** The press: the library and the two images (cached by the browser after the first time), the year
    before for the comparison slides (a miss only drops those slides), then build and save. */
function anPptRun_(btn) {
  var d = S.anData;
  if (!d) { toast('Open a year first, then export.', true); return Promise.resolve(); }
  var label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing the deck…'; }
  var prevP = (d.years || []).indexOf(Number(d.year) - 1) >= 0 ? srv('annual', { year: String(Number(d.year) - 1) }).catch(function () { return null; }) : Promise.resolve(null);
  var bookP = srv('annualBook', { year: String(d.year) }).catch(function () { return null; });
  return Promise.all([
    anPptScript_('/deck/pptxgen.bundle.js', function () { return !!window.PptxGenJS; }),
    anPptImage_('/deck/hope-title.jpg'), anPptImage_('/deck/hope-logo.png'), prevP, bookP,
  ]).then(function (r) {
    var M = anPptModel_(d, r[3], r[4]);
    if (!M) throw new Error('No month of ' + d.year + ' has data yet.');
    var pres = anPptBuild_(window.PptxGenJS, M, { title: r[1], logo: r[2] });
    var name = 'HOPE_Annual_Report_' + M.year + (M.complete ? '' : '_to_date') + '.pptx';
    return pres.writeFile({ fileName: name, compression: true }).then(function () { toast('Saved ' + name + ' · ' + (M.prev ? 'with ' + M.prev.year + ' for comparison' : 'no earlier year to compare with')); });
  }).catch(function (e) {
    toast('Could not make the deck: ' + ((e && e.message) || e), true);
  }).then(function () {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  });
}
