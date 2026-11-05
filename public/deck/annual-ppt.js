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

/* ---------------------------------------------------------------------------- regions on the map */
/* The 31 regions of Tanzania (/deck/tz-regions.js) and how Teams & Staff spells them. A name matches by its letters
   only, so "Dar-es-salaam", "DAR ES SALAAM" and "dar es salaam" are one. A few are not regions at all and are put
   where they belong, said on the slide: Kahama is a district town of Shinyanga Region, Coast is Pwani's English
   name, Zanzibar is its Mjini Magharibi (Urban West) region. A name that is none of them (a zone such as "LAKE
   ZONE") is not placed, and the slide lists it rather than dropping it. */
var ANPPT_REG_ALIAS = (function () {
  var m = {}, k = function (v) { return String(v).toUpperCase().replace(/[^A-Z]/g, ''); };
  var add = function (canon, list) { list.forEach(function (x) { m[k(x)] = canon; }); };
  ['Arusha', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi', 'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Morogoro', 'Mtwara', 'Mwanza', 'Njombe', 'Pwani',
    'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida', 'Songwe', 'Tabora', 'Tanga'].forEach(function (n) { add(n, [n]); });
  add('Dar es Salaam', ['Dar es Salaam', 'DSM', 'Dar']);
  add('Pwani', ['Coast', 'Coast Region']);
  add('Shinyanga', ['Kahama']);
  add('Mjini Magharibi', ['Mjini Magharibi', 'Zanzibar Urban', 'Zanzibar West', 'Zanzibar Urban West', 'Zanzibar', 'Unguja Mjini', 'Magharibi']);
  add('Kusini Unguja', ['Kusini Unguja', 'South Unguja', 'Zanzibar South', 'Zanzibar Central', 'Zanzibar South and Central', 'Zanzibar Central South']);
  add('Kaskazini Unguja', ['Kaskazini Unguja', 'North Unguja', 'Zanzibar North']);
  add('Kaskazini Pemba', ['Kaskazini Pemba', 'North Pemba', 'Pemba North']);
  add('Kusini Pemba', ['Kusini Pemba', 'South Pemba', 'Pemba South']);
  return { map: m, key: k };
})();
/** The official region a Teams & Staff region name stands for, or null. */
function anPptCanonRegion_(name) { return ANPPT_REG_ALIAS.map[ANPPT_REG_ALIAS.key(name)] || null; }
/** Four colour steps for a set of values: fixed edges (value <= edge falls in the lower step) or quartiles.
    Returns the step of a value and the legend rows for the steps that hold something. */
function anPptBuckets_(vals, edges, fmt) {
  var sorted = vals.slice().sort(function (a, b) { return a - b; }), n = sorted.length, e = edges ? edges.slice() : [0.25, 0.5, 0.75].map(function (p) { return sorted[Math.min(n - 1, Math.floor(p * n))]; });
  var step = function (x) { var b = 0; while (b < e.length && x > e[b]) b++; return b; };
  var items = [];
  for (var b = 0; b <= e.length; b++) {
    var inB = vals.filter(function (x) { return step(x) === b; });
    if (inB.length) { var lo = Math.min.apply(null, inB), hi = Math.max.apply(null, inB); items.push({ b: b, count: inB.length, label: lo === hi ? fmt(lo) : fmt(lo) + ' to ' + fmt(hi) }); }
  }
  return { step: step, items: items };
}

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
    teams: T, Y: Y, regions: regions, credit: credit, legalRole: (roles.legal || []).filter(function (r) { return r.general != null; }), gmo: (roles.gmo || []).filter(function (r) { return r.general != null; }), opm: (roles.opm || []).filter(function (r) { return r.general != null; }),
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
  /* Not every chart is a bar: a TREND is a line, a SHARE is a doughnut, a spread of teams is a scatter. Bars stay
     where something is being ranked. All native, so each can be restyled in PowerPoint. */
  var PALETTE = [C.a1, C.a2, C.a3, C.a4, C.a5, C.a6, '8E6BD8', 'F28E2B'];
  function lineChart(s, cats, series, o) {
    var data = series.map(function (se) { return { name: se.name, labels: cats, values: se.values }; });
    var opts = { x: o.x, y: o.y, w: o.w, h: o.h, chartColors: o.colors || PALETTE, lineSize: 3, lineDataSymbol: 'circle', lineDataSymbolSize: 8,
      showValue: o.showValue !== false, dataLabelPosition: 't', dataLabelFontSize: o.dl || 9, dataLabelColor: C.text1, dataLabelFormatCode: o.fmt || '0.0',
      showLegend: series.length > 1, legendPos: 'b', legendFontSize: 10, legendColor: C.text1,
      catAxisLabelFontSize: 10, catAxisLabelColor: C.text1, valAxisLabelFontSize: 9, valAxisLabelColor: C.a6, valAxisLabelFormatCode: o.axisFmt || '0',
      valGridLine: { color: 'E3E8F2', size: 0.5 }, catGridLine: { style: 'none' }, showTitle: false, objectName: o.name };
    if (o.min != null) opts.valAxisMinVal = o.min;
    if (o.max != null) opts.valAxisMaxVal = o.max;
    for (var k in fontOpts) opts[k] = fontOpts[k];
    s.addChart(pres.charts.LINE, data, opts);
  }
  function doughnut(s, labels, values, o) {
    var opts = { x: o.x, y: o.y, w: o.w, h: o.h, holeSize: 55, chartColors: PALETTE.slice(0, labels.length), showLegend: true, legendPos: o.legend || 'r', legendFontSize: 10, legendColor: C.text1,
      showPercent: true, showValue: false, showLabel: false, dataLabelColor: 'FFFFFF', dataLabelFontSize: 10, dataLabelFormatCode: '0%', dataBorder: { pt: 1.5, color: 'FFFFFF' }, showTitle: false, objectName: o.name };
    for (var k in fontOpts) opts[k] = fontOpts[k];
    s.addChart(pres.charts.DOUGHNUT, [{ name: o.series, labels: labels, values: values }], opts);
  }
  function scatter(s, xs, ys, o) {
    var opts = { x: o.x, y: o.y, w: o.w, h: o.h, chartColors: [C.a1], lineSize: 0, lineDataSymbol: 'circle', lineDataSymbolSize: 9, showLegend: false, showValue: false,
      showCatAxisTitle: true, catAxisTitle: o.xTitle, showValAxisTitle: true, valAxisTitle: o.yTitle, catAxisTitleFontSize: 10, valAxisTitleFontSize: 10, catAxisTitleColor: C.a6, valAxisTitleColor: C.a6,
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelColor: C.a6, valAxisLabelColor: C.a6, valGridLine: { color: 'E3E8F2', size: 0.5 }, catGridLine: { color: 'E3E8F2', size: 0.5 }, showTitle: false, objectName: o.name };
    for (var k in fontOpts) opts[k] = fontOpts[k];
    s.addChart(pres.charts.SCATTER, [{ name: 'X-Axis', values: xs }, { name: o.series, values: ys }], opts);
  }
  /* The n biggest of a list as named slices, the rest grouped, for a doughnut. */
  function slices(rows, n, labelFn, valueFn, otherLabel) {
    var sorted = rows.slice().sort(function (a, b) { return valueFn(b) - valueFn(a); }), top = sorted.slice(0, n), rest = sorted.slice(n);
    var labels = top.map(labelFn), values = top.map(valueFn);
    if (rest.length) { labels.push(otherLabel); values.push(rest.reduce(function (a, r) { return a + valueFn(r); }, 0)); }
    return { labels: labels, values: values };
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
  /* ---- THE MAP: each region a native freeform shape (so it can be recoloured in PowerPoint), coloured by a four-step
     scale, named and valued on the map where it is big enough and by a call-out in the sea where it is not. */
  var TZ = (typeof ANPPT_TZ !== 'undefined') ? ANPPT_TZ : null;
  var RAMPS = { blue: ['D6E6FA', '9DC4F3', '5B93E6', '1F57D6'], green: ['DDF1E6', 'A9DCC0', '5DBB88', '1E8E5A'], red: ['FBE0E0', 'F4B0B0', 'E36B6B', 'C53030'] };
  var CALLOUT = { 'Dar es Salaam': 1, 'Mjini Magharibi': 1, 'Kusini Unguja': 1, 'Kaskazini Unguja': 1, 'Kaskazini Pemba': 1, 'Kusini Pemba': 1 };
  /** Group rows ({ region, ... }) by the official region they stand for. */
  function placeRows(rows) {
    var groups = {}, unplaced = [], notes = [];
    (rows || []).forEach(function (r) {
      var c = anPptCanonRegion_(r.region);
      if (!c) { unplaced.push(r); return; }
      (groups[c] = groups[c] || []).push(r);
      if (ANPPT_REG_ALIAS.key(r.region) !== ANPPT_REG_ALIAS.key(c)) notes.push(short(r.region, 22) + ' is shown in ' + c);
    });
    return { groups: groups, unplaced: unplaced, notes: notes };
  }
  /** Draw the country in `box` (inches). fillFor(region) -> { fill, dark } or null (no data); labelFor(region) -> text or null. */
  function drawMap(sl, box, fillFor, labelFor) {
    var lon0 = 29.45, lon1 = 41.9, latN = -0.85, latS = -11.85, cosl = Math.cos(6.3 * Math.PI / 180);
    var sc = Math.min(box.w / ((lon1 - lon0) * cosl), box.h / (latN - latS));
    var ox = box.x + (box.w - (lon1 - lon0) * cosl * sc) / 2, oy = box.y + (box.h - (latN - latS) * sc) / 2;
    var X = function (lon) { return ox + (lon - lon0) * cosl * sc; }, Y = function (lat) { return oy + (latN - lat) * sc; };
    var callouts = [], chips = [];
    TZ.regions.forEach(function (reg) {
      var rings = reg.g.map(function (g) { var pts = []; for (var i = 0; i < g.length; i += 2) pts.push([X(g[i] / 100), Y(g[i + 1] / 100)]); return pts; });
      var xs = [], ys = []; rings.forEach(function (r) { r.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
      var minX = Math.min.apply(null, xs), minY = Math.min.apply(null, ys), w = Math.max(0.02, Math.max.apply(null, xs) - minX), h = Math.max(0.02, Math.max.apply(null, ys) - minY);
      var pts = [];
      rings.forEach(function (r) { r.forEach(function (p, i) { pts.push({ x: p[0] - minX, y: p[1] - minY, moveTo: i === 0 }); }); pts.push({ close: true }); });
      var f = fillFor(reg.n);
      sl.addShape(pres.ShapeType.custGeom, { x: minX, y: minY, w: w, h: h, points: pts, fill: { color: f ? f.fill : 'E8ECF2' }, line: { color: 'FFFFFF', width: 0.6 }, objectName: 'Region ' + reg.n });
      var text = f ? labelFor(reg.n) : null;
      if (!text) return;
      var cx = X(reg.c[0]), cy = Y(reg.c[1]);
      if (CALLOUT[reg.n]) { callouts.push({ n: reg.n, text: text, cx: cx, cy: cy }); return; }
      chips.push({ n: reg.n, text: text, x: cx, y: cy, w: Math.min(1.0, Math.max(0.46, reg.n.length * 0.052 + 0.12)), h: 0.3 });
    });
    // labels that would sit on each other are pushed apart (the smaller overlap first), then kept inside the map
    for (var it = 0; it < 40; it++) {
      var moved = false;
      for (var i = 0; i < chips.length; i++) for (var j = i + 1; j < chips.length; j++) {
        var a = chips[i], b = chips[j], ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy <= ox) { var dy = oy / 2 + 0.006; if (a.y <= b.y) { a.y -= dy; b.y += dy; } else { a.y += dy; b.y -= dy; } }
        else { var dx = ox / 2 + 0.006; if (a.x <= b.x) { a.x -= dx; b.x += dx; } else { a.x += dx; b.x -= dx; } }
      }
      if (!moved) break;
    }
    chips.forEach(function (c) {
      var x = Math.max(box.x + 0.02, Math.min(box.x + box.w - c.w - 0.02, c.x - c.w / 2)), y = Math.max(box.y, Math.min(box.y + box.h - c.h, c.y - c.h / 2));
      sl.addText([{ text: c.n, options: { fontSize: 6, color: C.text1, breakLine: true } }, { text: c.text, options: { fontSize: 8.5, bold: true, color: C.text2 } }],
        { x: x, y: y, w: c.w, h: c.h, align: 'center', valign: 'middle', margin: 0, shape: pres.ShapeType.roundRect, rectRadius: 0.05, fill: { color: 'FFFFFF', transparency: 12 }, objectName: 'Label ' + c.n });
    });
    // the small coastal and island regions: a short leader into the sea and the label beside it, stacked in order of latitude so no leader crosses
    callouts.sort(function (a, b) { return a.cy - b.cy; });
    var lx = X(41.0), gap = 0.34, y0 = Math.min(callouts.length ? callouts[0].cy - 0.1 : 0, box.y + box.h - gap * callouts.length - 0.2);
    callouts.forEach(function (c, i) {
      var ly = y0 + i * gap;
      sl.addShape(pres.ShapeType.line, { x: c.cx, y: Math.min(c.cy, ly + 0.13), w: Math.max(0.02, lx - 0.04 - c.cx), h: Math.max(0.0, Math.abs(ly + 0.13 - c.cy)), line: { color: C.a6, width: 0.5 }, flipV: ly + 0.13 < c.cy, objectName: 'Leader ' + c.n });
      sl.addText([{ text: c.n, options: { fontSize: 6, color: C.text1, breakLine: true } }, { text: c.text, options: { fontSize: 8.5, bold: true, color: C.text2 } }],
        { x: lx, y: ly, w: 0.95, h: 0.28, align: 'left', valign: 'middle', margin: 0, objectName: 'Callout ' + c.n });
    });
  }
  /** One map slide: the country coloured by `value` over the placed rows, with a key and the regions that could not be placed. */
  function mapSlide(title, rows, o) {
    if (!TZ) return false;
    var placed = placeRows(rows), vals = {}, keys = [];
    Object.keys(placed.groups).forEach(function (k) { var v = o.value(placed.groups[k]); if (v != null && !isNaN(v)) { vals[k] = v; keys.push(k); } });
    if (keys.length < 2) return false;
    var bk = anPptBuckets_(keys.map(function (k) { return vals[k]; }), o.edges, o.fmt), ramp = RAMPS[o.ramp];
    var sl = content(title);
    drawMap(sl, { x: 0.35, y: 0.95, w: 5.55, h: 4.25 },
      function (k) { if (!(k in vals)) return null; var b = bk.step(vals[k]); return { fill: ramp[b], dark: b >= 2 }; },
      function (k) { return k in vals ? o.label(vals[k]) : null; });
    // the key, at the right
    sl.addText(o.heading, { x: 6.1, y: 0.95, w: 3.4, h: 0.45, fontSize: 20, bold: true, color: C.text2, margin: 0, valign: 'middle', objectName: 'Map heading' });
    sl.addText(o.sub, { x: 6.1, y: 1.4, w: 3.4, h: 0.58, fontSize: 10, color: C.text1, margin: 0, valign: 'top', objectName: 'Map sub' });
    sl.addText(o.legendTitle.toUpperCase(), { x: 6.1, y: 2.02, w: 3.4, h: 0.2, fontSize: 8.5, bold: true, color: C.a6, charSpacing: 1, margin: 0, objectName: 'Legend title' });
    var ly = 2.25;
    bk.items.forEach(function (it) {
      sl.addShape(pres.ShapeType.roundRect, { x: 6.1, y: ly, w: 0.26, h: 0.18, rectRadius: 0.04, fill: { color: ramp[it.b] }, line: { color: ramp[it.b], width: 0 }, objectName: 'Key ' + it.label });
      sl.addText(it.label + (o.unit ? ' ' + o.unit : '') + '  ·  ' + it.count + ' region' + (it.count === 1 ? '' : 's'), { x: 6.45, y: ly - 0.02, w: 3.05, h: 0.22, fontSize: 9.5, color: C.text1, margin: 0, valign: 'middle', objectName: 'Key text ' + it.label });
      ly += 0.25;
    });
    sl.addShape(pres.ShapeType.roundRect, { x: 6.1, y: ly, w: 0.26, h: 0.18, rectRadius: 0.04, fill: { color: 'E8ECF2' }, line: { color: 'C9D0DC', width: 0.5 }, objectName: 'Key none' });
    sl.addText(o.noneText || 'No data', { x: 6.45, y: ly - 0.02, w: 3.05, h: 0.22, fontSize: 9.5, color: C.a6, margin: 0, valign: 'middle', objectName: 'Key text none' });
    var ranked = keys.slice().sort(function (a, b) { return o.low ? vals[a] - vals[b] : vals[b] - vals[a]; });
    var lines = [{ text: o.listTitle, options: { bold: true, fontSize: 9.5, color: C.text2, breakLine: true } }]
      .concat(ranked.slice(0, 4).map(function (k, i) { return { text: k + '  ' + o.label(vals[k]), options: { fontSize: 9.5, color: C.text1, breakLine: i < 3 } }; }));
    sl.addText(lines, { x: 6.1, y: ly + 0.33, w: 3.4, h: 0.92, margin: 0, valign: 'top', objectName: 'Map list' });
    var foot = [];
    if (placed.unplaced.length) foot.push('Not on the map: ' + placed.unplaced.slice(0, 3).map(function (r) { return short(r.region, 18); }).join(', ') + (placed.unplaced.length > 3 ? ' and ' + (placed.unplaced.length - 3) + ' more' : '') + ' (not region names).');
    if (placed.notes.length) foot.push(placed.notes.slice(0, 3).join('; ') + '.');
    foot.push(TZ.attribution + '.');
    sl.addText(foot.join(' '), { x: 6.1, y: 4.62, w: 3.4, h: 0.58, fontSize: 7, italic: true, color: C.a6, margin: 0, valign: 'top', objectName: 'Map footnote' });
    return true;
  }
  /* A list too long for one slide is PAGED, never squeezed: a real book has two dozen regions, and a table of
     that many rows runs off the page. */
  function pages(items, size) { var out = []; for (var i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out.length ? out : [[]]; }
  function pageTitle(title, i, n) { return n > 1 ? title + ' (' + (i + 1) + ' of ' + n + ')' : title; }
  function short(v, n) { v = String(v == null ? '' : v); return v.length > n ? v.slice(0, n - 1) + '…' : v; }
  /* Regions, ten to a slide: the bars on the left and the table on the right carry the same ten. */
  function regionPages(title, rows, o) {
    var pg = pages(rows, o.size || 10);
    pg.forEach(function (rs, i) {
      var sl = content(pageTitle(title, i, pg.length));
      chart(sl, rs.map(function (r) { return short(r.region, 18); }), [{ name: o.series, values: rs.map(o.value) }], { x: 0.3, y: 1.0, w: 3.9, h: 3.5, dir: 'bar', reverse: true, colors: [o.color], name: o.name + ' ' + (i + 1), fmt: o.fmt, gap: 30, dl: 9, cat: 9 });
      table(sl, [o.head].concat(rs.map(o.line)), 4.3, 1.05, 5.2, o.widths, { fs: 8.5, rowH: 0.3, name: o.name + ' table ' + (i + 1), textCols: o.textCols || [0] });
      note(sl, i === 0 ? o.note : o.noteMore, 4.62, 0.55);
    });
  }
  var regKey = function (v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toUpperCase(); };
  var teamsOf = function (region) { return T.filter(function (t) { return regKey(t.region) === regKey(region); }).sort(function (a, b) { return a.team < b.team ? -1 : a.team > b.team ? 1 : 0; }); };
  /* The GMO of a region: whoever holds the most of its teams, with "+n" for the others. */
  var gmoOf = function (region) {
    var c = {}; teamsOf(region).forEach(function (t) { var g = t.gmo && String(t.gmo).trim(); if (g) c[g] = (c[g] || 0) + 1; });
    var names = Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); });
    return names.length ? names[0] + (names.length > 1 ? ' +' + (names.length - 1) : '') : '—';
  };
  var noRegion = T.filter(function (t) { var r = String(t.region == null ? '' : t.region).trim(); return !r || /^(NO[ -]|NONE$|N\/A$|-$)/i.test(r); }).length;
  var unsetNote = noRegion ? ' ' + noRegion + ' of ' + T.length + ' teams have no region set in Teams & Staff yet and are not in the regional figures.' : '';
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
    sec('Growth and coverage'); sectionsIn.push(['Growth and coverage', 'teams' + (hasZ ? ', regions and the map' : '')]);
  }
  if (had.length >= 2) (function () {
    var s = content('Teams went from ' + first.teams + ' to ' + last.teams);
    lineChart(s, labels, [{ name: 'Teams selling', values: had.map(function (m) { return m.teams; }) }], { x: 0.4, y: 1.0, w: 5.9, h: 4.1, colors: [C.a1], name: 'Teams by month', fmt: '0' });
    var newTeams = T.filter(function (r) { return r.first && r.first > first.ym; }).length;
    var gone = T.filter(function (r) { return r.m && r.m[first.ym] && !r.m[last.ym]; }).length;
    var step = 0, stepAt = 1; for (var i = 1; i < had.length; i++) { var dlt = had[i].teams - had[i - 1].teams; if (Math.abs(dlt) > Math.abs(step)) { step = dlt; stepAt = i; } }
    var b = [[{ text: newTeams + ' team' + (newTeams === 1 ? '' : 's') + ' ', bold: true }, { text: 'started selling after ' + firstLong + '.' + (gone ? ' ' + gone + ' that sold in ' + firstLong + ' do not sell in ' + lastLong + ' (closed or merged).' : '') }]];
    if (step) b.push([{ text: 'The biggest step: ', bold: true }, { text: (step > 0 ? step + ' more' : Math.abs(step) + ' fewer') + ' teams in ' + anPptLong_(had[stepAt].ym) + '.' }]);
    if (first.teams && last.teams && first.sales) b.push([{ text: 'Sales per team ', bold: true }, { text: (last.sales / last.teams >= first.sales / first.teams ? 'rose' : 'moved') + ' from TZS ' + anPptM1_(first.sales / first.teams) + ' a month in ' + firstLong + ' to ' + anPptM1_(last.sales / last.teams) + ' in ' + lastLong + '.' }]);
    bullets(s, b, 6.5, 1.2, 3.0, 3.6, 13);
  })();
  if (hasZ) (function () {
    var all = Z.slice().sort(function (a, b) { return b.teams - a.teams; }), zs = all.slice(0, 12);
    var s = content('Coverage across ' + Z.length + ' regions');
    var sl8 = slices(all, 8, function (z) { return short(z.region, 16); }, function (z) { return z.teams; }, 'Other regions');
    doughnut(s, sl8.labels, sl8.values, { x: 0.4, y: 1.0, w: 5.9, h: 4.1, name: 'Teams by region', series: 'Teams' });
    var tot = all.reduce(function (a, z) { return a + z.teams; }, 0);
    var b = [[{ text: tot + ' teams ', bold: true }, { text: 'across ' + all.length + ' regions in ' + lastLong + (all.length > 8 ? '; the eight largest are named, the rest grouped.' : '.') }],
      [{ text: all[0].region + ' ', bold: true }, { text: 'is the largest with ' + all[0].teams + ' teams, ' + Math.round(all[0].teams / tot * 100) + '% of the regional network.' }]];
    if (all.length >= 3) b.push([{ text: all[1].region + ' and ' + all[2].region + ' ', bold: true }, { text: 'follow with ' + all[1].teams + ' and ' + all[2].teams + ' teams.' }]);
    if (noRegion) b.push([{ text: noRegion + ' teams ', bold: true }, { text: 'have no region set in Teams & Staff yet and are not counted here.' }]);
    bullets(s, b, 6.5, 1.2, 3.0, 3.6, 12.5);
  })();
  /* the same coverage on the map: every region, Songwe and Zanzibar's five included */
  if (hasZ && TZ) (function () {
    var rows = Z.map(function (z) { return { region: z.region, teams: z.teams }; }), pl = placeRows(rows);
    var nReg = Object.keys(pl.groups).length, nTeams = 0; Object.keys(pl.groups).forEach(function (k) { pl.groups[k].forEach(function (r) { nTeams += r.teams; }); });
    mapSlide('Where HOPE works: ' + nReg + ' of 31 regions', rows, { value: function (g) { return g.reduce(function (a, r) { return a + r.teams; }, 0); }, label: function (v) { return String(v); },
      ramp: 'blue', edges: [1, 3, 7], fmt: function (v) { return String(v); }, heading: nReg + ' of 31 regions', sub: nTeams + ' teams selling in ' + lastLong + ', the number in each region on the map.',
      legendTitle: 'Teams in the region', noneText: 'No teams', listTitle: 'Most teams' });
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
    lineChart(s, labels, [{ name: String(P.year), values: cmpV }, { name: String(M.year), values: sales.map(function (v) { return +(v / 1e9).toFixed(2); }) }],
      { x: 0.4, y: 1.0, w: 6.4, h: 4.1, colors: [C.a2, C.a1], name: 'Sales ' + P.year + ' and ' + M.year, fmt: '0.0', axisFmt: '0.0', dl: 8 });
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
      { x: 0.3, y: 1.0, w: 4.4, h: 4.1, stacked: true, colors: [C.a2, C.a1], name: 'First-time and returning', fmt: '#,##0', dl: 8, gap: 35 });
    doughnut(s, ['First-time', 'Returning'], [Y.trk1, Y.retained], { x: 4.75, y: 1.0, w: 2.2, h: 2.9, name: 'Share first-time and returning', series: 'Loans', legend: 'b' });
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
    var pg = pages(zr, 12);
    pg.forEach(function (rs, i) {
      var s = content(pageTitle('Retention by region', i, pg.length));
      chart(s, rs.map(function (z) { return short(z.region, 18); }), [{ name: 'Retention %', values: rs.map(function (z) { return +z.retentionPct.toFixed(1); }) }], { x: 0.4, y: 1.0, w: 5.9, h: 4.1, dir: 'bar', reverse: true, colors: [C.a1], name: 'Retention by region ' + (i + 1), fmt: '0.0', gap: 35, min: 0, max: 100, dl: 9, cat: 9 });
      if (i > 0) { bullets(s, [[{ text: 'Regions ranked by retention, ', bold: true }, { text: 'continued from the previous slide.' }], [{ text: 'Company retention ' + anPptPc_(Y.retentionPct) + '.', bold: true }]], 6.5, 1.2, 3.0, 3.6, 12.5); return; }
      var hi = zr[0], lo = zr[zr.length - 1], big = Z.slice().sort(function (a, b) { return b.teams - a.teams; })[0];
      var b = [[{ text: hi.region + ' is highest at ' + anPptPc_(hi.retentionPct) + ', ', bold: true }, { text: 'with ' + hi.teams + ' teams.' }],
        [{ text: big.region + ' is the largest region, ', bold: true }, { text: big.teams + ' teams, at ' + anPptPc_(big.retentionPct) + '.' }]];
      if (lo.region !== hi.region && lo.region !== big.region) b.push([{ text: lo.region + ' is lowest at ' + anPptPc_(lo.retentionPct) + ', ', bold: true }, { text: lo.teams + ' teams.' }]);
      b.push([{ text: 'Company retention ' + anPptPc_(Y.retentionPct) + (P && P.totals.retentionPct != null ? ', ' : '.'), bold: true }, { text: P && P.totals.retentionPct != null ? 'against ' + anPptPc_(P.totals.retentionPct) + ' for ' + P.year + '.' : '' }]);
      if (noRegion) b.push([{ text: noRegion + ' teams ', bold: true }, { text: 'have no region set yet.' }]);
      bullets(s, b, 6.5, 1.1, 3.0, 3.9, 12.5);
    });
  })();

  /* ---- collection */
  var hasCol = colM.length >= 2 || hasColT;
  if (hasCol) { sec('Collection'); sectionsIn.push(['Collection', (colM.length >= 2 ? 'by month and ' : '') + 'by team']); }
  if (colM.length >= 2) (function () {
    var s = content('Collection by month');
    var vals = colM.map(function (m) { return m.colPct; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    lineChart(s, colM.map(function (m) { return anPptMon_(m.ym); }), [{ name: 'Collection %', values: vals }], { x: 0.4, y: 1.0, w: 6.2, h: 4.1, colors: [C.a3], name: 'Collection by month', fmt: '0.0', min: Math.max(0, Math.floor((lo - 10) / 10) * 10), max: Math.max(100, Math.ceil(hi / 10) * 10) });
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
    lineChart(s, recM.map(function (m) { return anPptMon_(m.ym); }), [{ name: 'Recovery %', values: vals }], { x: 0.4, y: 1.0, w: 6.2, h: 4.1, colors: [C.a1], name: 'Recovery by month', fmt: '0.0', min: 0, max: Math.max(100, Math.ceil(Math.max.apply(null, vals) / 10) * 10) });
    var bi = vals.indexOf(Math.max.apply(null, vals)), wi = vals.indexOf(Math.min.apply(null, vals));
    bullets(s, [
      [{ text: 'TZS ' + anPptB2_(Y.recovered) + ' recovered ', bold: true }, { text: 'out of TZS ' + anPptB2_(Y.uncollected) + ' left uncollected after the due dates.' }],
      [{ text: anPptLong_(recM[bi].ym) + ' was the strongest month at ' + anPptPc_(vals[bi]) + ', ', bold: true }, { text: anPptLong_(recM[wi].ym) + ' the weakest at ' + anPptPc_(vals[wi]) + '.' }],
      [{ text: 'Recovery % ', bold: true }, { text: 'is recovered over uncollected, measured on the teams that had arrears that month.' }],
    ], 6.8, 1.2, 2.7, 3.6, 12.5);
  }

  /* ---- how the year moved: the three measures and General on one line chart */
  var both = had.filter(function (m) { return m.colPct != null && m.recPct != null && m.salesPct != null; });
  if (both.length >= 3) (function () {
    var s = content('How the year moved');
    var pick = function (k) { return both.map(function (m) { return Math.round(m[k]); }); };
    var top = Math.max.apply(null, [].concat(pick('salesPct'), pick('colPct'), pick('recPct'), pick('general')));
    lineChart(s, both.map(function (m) { return anPptMon_(m.ym); }), [{ name: 'Sales %', values: pick('salesPct') }, { name: 'Collection %', values: pick('colPct') }, { name: 'Recovery %', values: pick('recPct') }, { name: 'General %', values: pick('general') }],
      { x: 0.3, y: 1.0, w: 6.6, h: 4.1, colors: [C.a1, C.a3, C.a4, C.text2], name: 'The measures by month', fmt: '0', dl: 8, min: 0, max: Math.max(100, Math.ceil(top / 10) * 10) });
    var g = both.map(function (m) { return m.general; }), bi = g.indexOf(Math.max.apply(null, g)), wi = g.indexOf(Math.min.apply(null, g));
    bullets(s, [[{ text: anPptLong_(both[bi].ym) + ' was the best month overall, ', bold: true }, { text: 'General ' + anPptPc_(g[bi]) + '.' }],
      [{ text: anPptLong_(both[wi].ym) + ' the weakest, ', bold: true }, { text: 'General ' + anPptPc_(g[wi]) + '.' }],
      [{ text: 'Collection holds steadiest; ', bold: true }, { text: 'sales and recovery swing the most from month to month.' }]], 7.1, 1.2, 2.4, 3.6, 12);
    if (!sectionsIn.some(function (x) { return x[0] === 'Recovery'; })) sectionsIn.push(['The year\'s trend', 'the measures month by month']);
  })();

  /* ---- regions */
  if (hasZ) {
    sec('Regions'); sectionsIn.push(['Regions', 'sales, retention and general performance']);
    var zs = Z.slice().sort(function (a, b) { return b.sales - a.sales; });
    regionPages('Regions: sales and general performance', zs, { series: 'Sales (TZS billion)', value: function (z) { return +(z.sales / 1e9).toFixed(2); }, fmt: '0.00', color: C.a1, name: 'Sales by region',
      head: ['Region', 'GMO', 'Teams', 'Coll.', 'Rec.', 'General'], widths: [1.3, 1.65, 0.5, 0.55, 0.5, 0.7], textCols: [0, 1],
      line: function (z) { return [short(z.region, 17), short(gmoOf(z.region), 22), z.teams, anPptPc0_(z.colPct), anPptPc0_(z.recPct), anPptPc0_(z.general)]; },
      note: 'Billions of TZS, regions ranked by sales. A region is its teams\' months added together, the percentages the average of its months. The GMO holds most of its teams. Recovery above 100% lifts General on a small base.' + unsetNote,
      noteMore: 'Regions ranked by sales, as on the first slide.' });
    mapSlide('Regions on the map: General performance', Z.map(function (z) { return { region: z.region, general: z.general, teams: z.teams }; }), {
      value: function (g) { var w = 0, a = 0; g.forEach(function (r) { if (r.general != null) { w += r.teams; a += r.general * r.teams; } }); return w ? Math.round(a / w * 10) / 10 : null; },
      label: function (v) { return Math.round(v) + '%'; }, fmt: function (v) { return Math.round(v) + '%'; }, ramp: 'green', heading: 'General %', legendTitle: 'General %', noneText: 'No teams', listTitle: 'Highest',
      sub: 'The average of sales, collection and recovery, region by region. Darker is better; a region with several teams is weighted by them.' });
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
  var scT = established.filter(function (r) { return r.salesPct != null && r.colPct != null; });
  if (scT.length >= 8) (function () {
    tlItems.push('where teams sit');
    var s = content('Where each team sits: sales against collection');
    scatter(s, scT.map(function (r) { return +r.salesPct.toFixed(1); }), scT.map(function (r) { return +r.colPct.toFixed(1); }), { x: 0.4, y: 1.0, w: 6.2, h: 4.1, name: 'Sales against collection by team', series: 'Teams', xTitle: 'Sales, % of target', yTitle: 'Collection, %' });
    var hiS = scT.filter(function (r) { return r.salesPct >= 100; }).length, hiC = scT.filter(function (r) { return r.colPct >= 92; }).length, both = scT.filter(function (r) { return r.salesPct >= 100 && r.colPct >= 92; });
    bullets(s, [[{ text: scT.length + ' teams, one dot each, ', bold: true }, { text: 'with ' + M.minM + ' month' + (M.minM === 1 ? '' : 's') + ' or more.' }],
      [{ text: hiS + ' reach the sales target, ' + hiC + ' collect 92% or more; ', bold: true }, { text: both.length + ' do both' + (both.length ? ': ' + both.slice(0, 4).map(function (r) { return r.team; }).join(', ') + (both.length > 4 ? ' and ' + (both.length - 4) + ' more' : '') + '.' : '.') }],
      [{ text: 'Top right ', bold: true }, { text: 'is the best place to be; a dot far left sells little, a dot low down collects little.' }]], 6.8, 1.2, 2.7, 3.6, 12);
  })();
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
  /* WHO LED EACH MONTH: a leader's month is the average of the teams they held that month (the server's
     leader rows carry m[ym]); the table names the first three of every month, the matrix lays the year's
     best leaders out month by month with each month's leader marked. */
  function leaderTrend(rows, label, withMatrix) {
    var ms = had.filter(function (m) { return rows.some(function (r) { return r.m && r.m[m.ym] && r.m[m.ym].general != null; }); });
    if (ms.length < 2 || rows.length < 2) return;
    var ranked = ms.map(function (m) { return { ym: m.ym, list: rows.filter(function (r) { return r.m && r.m[m.ym] && r.m[m.ym].general != null; }).sort(function (a, b) { return b.m[m.ym].general - a.m[m.ym].general; }) }; });
    var led = {}; ranked.forEach(function (x) { if (x.list[0]) led[x.list[0].name] = (led[x.list[0].name] || 0) + 1; });
    var ledTop = Object.keys(led).sort(function (a, b) { return led[b] - led[a] || (a < b ? -1 : 1); });
    tlItems.push('who led each month');
    var s = content(label + 's: who led each month');
    var cell = function (x, i) { var r = x.list[i]; return r ? [short(r.name, 22), anPptPc0_(r.m[x.ym].general)] : ['—', '—']; };
    var body = ranked.map(function (x) { return [anPptLong_(x.ym)].concat(cell(x, 0), cell(x, 1), cell(x, 2)); });
    table(s, [['Month', 'Led by', 'General', 'Second', 'General', 'Third', 'General']].concat(body), 0.5, 1.0, 9.0, [1.1, 2.1, 0.75, 1.9, 0.75, 1.65, 0.75], { fs: 9.5, rowH: Math.min(0.29, 3.7 / (body.length + 1)), name: label + ' leaders by month', textCols: [0, 1, 3, 5] });
    note(s, 'Most months led: ' + ledTop.slice(0, 3).map(function (n) { return n + ' ' + led[n]; }).join(', ') + '. A ' + label + ' is judged each month on the teams they held that month: the average of those teams\' sales, collection and recovery.', 4.72, 0.5);
    if (!withMatrix) return;
    var pick = rows.slice(0, 10), seen = {}; pick.forEach(function (r) { seen[r.name] = 1; });
    rows.forEach(function (r) { if (led[r.name] && !seen[r.name] && pick.length < 14) { pick.push(r); seen[r.name] = 1; } });
    var s2 = content(label + 's by month: General %');
    var cw = (9.0 - 1.6 - 0.65 - 0.5) / ms.length;
    var hd = function (t) { return { text: t, options: { bold: true, color: C.bg1, fill: { color: C.text2 }, fontSize: 8.5, align: 'center', valign: 'middle' } }; };
    var trs = [[hd(label)].concat(ms.map(function (m) { return hd(anPptMon_(m.ym)); }), [hd('Year'), hd('Led')])];
    pick.forEach(function (r, i) {
      var base = i % 2 ? C.bg1 : C.bg2;
      var row = [{ text: short(r.name, 22), options: { fontSize: 8.5, bold: true, color: C.text1, align: 'left', valign: 'middle', fill: { color: base } } }];
      ranked.forEach(function (x) {
        var v = r.m && r.m[x.ym] ? r.m[x.ym].general : null, isLead = x.list[0] && x.list[0].name === r.name;
        row.push({ text: v == null ? '—' : String(Math.round(v)) + '%', options: { fontSize: 8.5, bold: !!isLead, color: isLead ? '0B5D36' : C.text1, align: 'center', valign: 'middle', fill: { color: isLead ? 'CFEFDD' : base } } });
      });
      row.push({ text: anPptPc0_(r.general), options: { fontSize: 8.5, bold: true, color: C.text2, align: 'center', valign: 'middle', fill: { color: base } } });
      row.push({ text: String(led[r.name] || 0), options: { fontSize: 8.5, color: C.text1, align: 'center', valign: 'middle', fill: { color: base } } });
      trs.push(row);
    });
    var colW = [1.6].concat(ms.map(function () { return cw; }), [0.65, 0.5]);
    s2.addTable(trs, { x: 0.5, y: 1.0, w: 9.0, colW: colW, rowH: Math.min(0.28, 3.7 / trs.length), border: { type: 'solid', pt: 0.5, color: 'E3E8F2' }, margin: [0.02, 0.05, 0.02, 0.05], objectName: label + ' by month matrix', autoPage: false });
    var racers = rows.slice(0, 5);
    // the axis spans what the five actually scored, so the lines separate instead of hugging the top
    var raceVals = []; racers.forEach(function (r) { ranked.forEach(function (x) { if (r.m && r.m[x.ym] && r.m[x.ym].general != null) raceVals.push(r.m[x.ym].general); }); });
    var raceMin = Math.max(0, Math.floor((Math.min.apply(null, raceVals) - 5) / 10) * 10), raceMax = Math.ceil((Math.max.apply(null, raceVals) + 5) / 10) * 10;
    var s3 = content(label + 's: the monthly race');
    lineChart(s3, ranked.map(function (x) { return anPptMon_(x.ym); }), racers.map(function (r) { return { name: short(r.name, 20), values: ranked.map(function (x) { return r.m && r.m[x.ym] ? Math.round(r.m[x.ym].general) : null; }) }; }),
      { x: 0.3, y: 1.0, w: 6.6, h: 4.1, name: label + ' monthly race', fmt: '0', showValue: false, min: raceMin, max: raceMax });
    bullets(s3, [[{ text: 'The five best ' + label + 's of the year, ', bold: true }, { text: 'General % each month.' }],
      [{ text: ledTop[0] + ' led the most months, ', bold: true }, { text: led[ledTop[0]] + ' of ' + ranked.length + '.' }],
      [{ text: 'A line that breaks ', bold: true }, { text: 'is a month the ' + label + ' held no team.' }]], 7.1, 1.2, 2.4, 3.6, 12);
    note(s2, 'Green marks the month\'s leader. ' + label + 's shown: the ' + Math.min(10, rows.length) + ' with the best year, plus anyone who led a month. Led is the number of months at the top.', 4.72, 0.4);
  }
  leaderTrend(M.gmo, 'GMO', true);
  leaderTrend(M.opm, 'OPM', false);
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
      doughnut(s1, bands.map(function (b) { return b.band + ' days'; }), bands.map(function (b) { return Math.round(b.arrears / 1e6); }), { x: 0.4, y: 2.4, w: 5.6, h: 2.8, name: 'Arrears by days overdue', series: 'Arrears (TZS million)' });
      bullets(s1, [[{ text: 'Arrears by days overdue, ', bold: true }, { text: 'in TZS million. ' + bands.reduce(function (a, b) { return b.arrears > a.arrears ? b : a; }, bands[0]).band + ' days holds the most.' }],
        [{ text: 'PAR ', bold: true }, { text: 'is the arrears over the balance of those customers; all-time PAR puts the same arrears over everything the company has lent.' }]], 6.2, 2.6, 3.3, 2.4, 11.5);
    }
    var regs = (P_.byRegion || []).filter(function (r) { return r.par != null; }).sort(function (a, b) { return b.par - a.par; });
    var pu = P_.unplaced && P_.unplaced.teams ? ' ' + P_.unplaced.teams + ' teams with no region set yet (TZS ' + anPptM1_(P_.unplaced.arrears) + ' in arrears) are not in these rows.' : '';
    if (regs.length >= 2) regionPages('Portfolio at risk by region', regs, { series: 'PAR %', value: function (r) { return +r.par.toFixed(1); }, fmt: '0.0', color: C.a5, name: 'PAR by region',
      head: ['Region', 'Cust.', 'Arrears (M)', 'PAR %', 'All-time'], widths: [1.5, 0.75, 1.15, 0.9, 0.9],
      line: function (r) { return [short(r.region, 18), anPptN0_(r.customers), anPptN0_(r.arrears / 1e6), anPptPc_(r.par), anPptPc_(r.parAll)]; },
      note: 'As at ' + P_.date + ', regions ranked by PAR. A region is its teams\' customers added together: arrears over balance, and over everything its teams have lent.' + pu,
      noteMore: 'Regions ranked by PAR, highest first, as at ' + P_.date + '.' });
    mapSlide('Portfolio at risk on the map', P_.byRegion || [], {
      value: function (g) { var a = 0, b = 0; g.forEach(function (r) { a += r.arrears; b += r.balance; }); return b > 0 ? Math.round(a / b * 1000) / 10 : null; },
      label: function (v) { return v.toFixed(1) + '%'; }, fmt: function (v) { return v.toFixed(1) + '%'; }, ramp: 'red', heading: anPptPc_((P_.totals || {}).par) + ' PAR',
      legendTitle: 'PAR %', noneText: 'No customers in arrears', listTitle: 'Highest PAR', sub: 'Arrears over the balance of customers in arrears, by region, as at ' + P_.date + '. Darker is worse.' });
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
      doughnut(s4, sts.map(function (x) { return x.status; }), sts.map(function (x) { return Math.round(x.arrears / 1e6); }), { x: 0.4, y: 1.0, w: 5.9, h: 4.1, name: 'Arrears by status', series: 'Arrears (TZS million)' });
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
      doughnut(s1, sts.map(function (x) { return x.status; }), sts.map(function (x) { return x.customers; }), { x: 0.4, y: 2.4, w: 5.6, h: 2.8, name: 'Customers by status', series: 'Customers' });
      bullets(s1, [[{ text: 'Customers by today\'s status ', bold: true }, { text: 'on the deck, ' + sts[0].status + ' the largest with ' + anPptN0_(sts[0].customers) + '.' }],
        [{ text: 'Behind ', bold: true }, { text: 'means arrears on the deck: ' + anPptN0_(A_.behind.customers) + ' of ' + anPptN0_(A_.customers) + ' customers, holding TZS ' + anPptB2_(A_.behind.balance) + ' of the balance.' }]], 6.2, 2.6, 3.3, 2.4, 11.5);
    }
    var regs = (A_.byRegion || []).slice().sort(function (a, b) { return b.balance - a.balance; });
    var au = A_.unplaced && A_.unplaced.teams ? ' ' + A_.unplaced.teams + ' teams with no region set yet (TZS ' + anPptB2_(A_.unplaced.balance) + ' outstanding) are not in these rows.' : '';
    if (regs.length >= 2) regionPages('Active portfolio by region', regs, { series: 'Outstanding (TZS billion)', value: function (r) { return +(r.balance / 1e9).toFixed(2); }, fmt: '0.00', color: C.a1, name: 'Balance by region',
      head: ['Region', 'Cust.', 'Bal. (B)', 'Behind', 'Arrears %'], widths: [1.5, 0.75, 0.95, 0.95, 1.05],
      line: function (r) { return [short(r.region, 18), anPptN0_(r.customers), (r.balance / 1e9).toFixed(2), anPptN0_(r.behind), anPptPc_(r.arrearsPct)]; },
      note: 'As at ' + A_.date + ', regions ranked by outstanding balance. Arrears % is arrears over the balance, summed over the region\'s customers.' + au,
      noteMore: 'Regions ranked by outstanding balance, as at ' + A_.date + '.' });
    var bigBook = (A_.balance || 0) >= 2e9, mny = function (v) { return bigBook ? (v / 1e9).toFixed(2) + 'B' : Math.round(v / 1e6) + 'M'; };
    mapSlide('Active portfolio on the map', A_.byRegion || [], {
      value: function (g) { return g.reduce(function (a, r) { return a + r.balance; }, 0); }, label: mny, fmt: mny,
      ramp: 'blue', heading: 'TZS ' + anPptB2_(A_.balance), legendTitle: 'Balance outstanding, TZS', noneText: 'No customers', listTitle: 'Largest balance',
      sub: 'Outstanding balance of the customers on the ' + A_.date + ' expected deck, by region. Darker is larger.' });
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
    lineChart(s2, ms.map(function (m) { return anPptMon_(m.ym); }), [{ name: 'Notices', values: ms.map(function (m) { return m.notices; }) }], { x: 0.3, y: 1.0, w: 5.0, h: 3.6, colors: [C.a1], name: 'Notices by month', fmt: '#,##0', axisFmt: '0', min: 0 });
    var st = (L_.byState || []).filter(function (x) { return x.notices > 0; }).slice(0, 5);
    if (st.length) doughnut(s2, st.map(function (x) { return stateWord(x.state); }), st.map(function (x) { return x.notices; }), { x: 5.4, y: 1.0, w: 4.3, h: 3.6, name: 'Notices by state', series: 'Notices' });
    heading2(s2, 'By month', 0.5, 0.75, 4.0, C.text2); heading2(s2, 'Where the notices stand now', 5.5, 0.75, 4.0, C.text2);
    note(s2, 'The busiest month was ' + anPptLong_(ms.reduce(function (a, m) { return m.notices > a.notices ? m : a; }, ms[0]).ym) + ' with ' + ms.reduce(function (a, m) { return Math.max(a, m.notices); }, 0) + ' notices.', 4.7, 0.3);
    var tms = (L_.byTeam || []).slice(0, 12);
    if (tms.length >= 3) {
      var s3 = content('Legal by team');
      table(s3, [['Team', 'Region', 'Notices', 'Demanded (M)', 'Paid since (M)', 'Recovery %']].concat(tms.map(function (t) { return [t.team, t.region || '—', anPptN0_(t.notices), anPptN0_(t.demanded / 1e6), L_.paymentsOn ? anPptN0_(t.paidSince / 1e6) : '—', anPptPc_(t.recoveryPct)]; })), 0.5, 1.0, 9.0, [2.0, 1.9, 1.0, 1.5, 1.4, 1.2], { fs: 9.5, rowH: 0.28, name: 'Legal by team table', textCols: [0, 1] });
      note(s3, 'The twelve teams with the most demanded in ' + M.year + '. Recovery % is the arrears drop over what the letters chased.', 4.7, 0.3);
    }
    /* THE LEGAL OFFICERS: the register records who issued each notice, so volume and what came back are
       read per officer, each customer counted once at their earliest notice from that officer. */
    var ofs = (L_.byOfficer || []).slice(0, 12);
    if (ofs.length) {
      var s4 = content('Legal officers: notices and results');
      table(s4, [['Officer', 'Notices', 'Customers', 'Teams', 'Demanded (M)', 'Paid since (M)', 'Recovery %', 'Cleared']].concat(ofs.map(function (o) { return [short(o.officer, 26), anPptN0_(o.notices), anPptN0_(o.customers), anPptN0_(o.teams), anPptN0_(o.demanded / 1e6), L_.paymentsOn ? anPptN0_(o.paidSince / 1e6) : '—', anPptPc_(o.recoveryPct), anPptN0_(o.cleared)]; })),
        0.5, 1.0, 9.0, [2.3, 0.8, 0.95, 0.7, 1.2, 1.2, 1.0, 0.85], { fs: 9.5, rowH: 0.28, name: 'Legal officers table', textCols: [0] });
      note(s4, 'The officer who issued each notice, ' + M.year + ', most notices first. Recovery % is the arrears drop over what that officer\'s letters chased. Cleared is customers who owe nothing now.', 4.72, 0.45);
      var rc = ofs.filter(function (o) { return o.recoveryPct != null; }).sort(function (a, b) { return b.recoveryPct - a.recoveryPct; }).slice(0, 10);
      if (rc.length >= 3) {
        var s5 = content('Recovery by legal officer');
        chart(s5, rc.map(function (o) { return short(o.officer, 20); }), [{ name: 'Recovery %', values: rc.map(function (o) { return +o.recoveryPct.toFixed(1); }) }], { x: 0.4, y: 1.0, w: 5.9, h: 4.1, dir: 'bar', reverse: true, colors: [C.a3], name: 'Recovery by legal officer', fmt: '0.0', gap: 30, min: 0, max: Math.max(100, Math.ceil(Math.max.apply(null, rc.map(function (o) { return o.recoveryPct; })) / 10) * 10), dl: 9, cat: 9 });
        bullets(s5, [[{ text: rc[0].officer + ' leads at ' + anPptPc_(rc[0].recoveryPct) + ', ', bold: true }, { text: 'on ' + anPptN0_(rc[0].notices) + ' notices.' }],
          [{ text: 'Ranked by recovery, ', bold: true }, { text: 'the arrears drop over what each officer\'s letters chased.' }],
          [{ text: 'Register ' + anPptPc_(L_.recoveryPct) + ', ', bold: true }, { text: 'all officers together.' }]], 6.5, 1.2, 3.0, 3.6, 12.5);
      }
    }
    if (M.legalRole.length) {
      var s6 = content('Legal officers: the teams they hold');
      table(s6, [['Officer', 'Teams', 'Months', 'Sales %', 'Collect.', 'Recov.', 'General']].concat(M.legalRole.slice(0, 12).map(function (r) { return [short(r.name, 26), anPptN0_(r.teams), anPptN0_(r.months), anPptPc0_(r.salesPct), anPptPc0_(r.colPct), anPptPc0_(r.recPct), anPptPc0_(r.general)]; })),
        0.5, 1.0, 9.0, [2.8, 0.9, 0.95, 1.0, 1.1, 1.1, 1.15], { fs: 9.5, rowH: 0.28, name: 'Legal officers teams table', textCols: [0] });
      note(s6, 'The legal officer recorded on each team in Teams & Staff, judged on those teams as any leader is: the average of their sales, collection and recovery, month by month.', 4.72, 0.45);
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
    if (hasZ && !TZ) b.push([{ text: 'Map. ', bold: true }, { text: 'The map of Tanzania did not load with this export, so the map slides are left out. Export again.' }]);
    if (noRegion) b.push([{ text: 'Regions. ', bold: true }, { text: noRegion + ' of ' + T.length + ' teams have no region set in Teams & Staff yet, so they are not in the regional slides. Set them there and export again.' }]);
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
/** SAVING THE DECK. The page's own saver (`download` in app.html) is the one way a file leaves this system on every
    device: a link in a browser, and inside the Android app -- whose web view cannot follow a blob: link, and used to
    close or say "open in Chrome" -- the app's own save bridge into the phone's Downloads folder. PptxGenJS's writeFile
    makes the blob: link itself, so it works in a browser and nowhere in the app. The deck is therefore made as a file
    in memory and handed to `download`. The type is set here because the library's file is typed as a plain zip, and
    Android would then name the saved file "...pptx.zip". Resolves true when the app's saver took it (it tells the
    person itself), false when it was a browser download. A page without `download` still gets writeFile. */
var ANPPT_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
function anPptSave_(pres, name) {
  if (typeof download !== 'function') return pres.writeFile({ fileName: name, compression: true }).then(function () { return false; });
  /* exportPresentation({ compression: true }) is what writeFile itself calls in a browser, and it returns a compressed
     blob. write({ outputType: 'blob' }) looks the same but the library then skips compression altogether (it only
     compresses when no output type is named): the same deck came out 3.3 MB instead of 0.45 MB, which on a phone is
     a slow save and a very large string across the app's bridge. */
  var made = typeof pres.exportPresentation === 'function' ? pres.exportPresentation({ compression: true }) : pres.write({ outputType: 'blob', compression: true });
  return made.then(function (blob) {
    download(new Blob([blob], { type: ANPPT_MIME }), name);
    return typeof androidBridge_ === 'function' && !!androidBridge_();
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
    // the regions of Tanzania, for the maps: if they do not load the deck is still made, without them
    anPptScript_('/deck/tz-regions.js', function () { return !!window.ANPPT_TZ; }).catch(function () { return null; }),
  ]).then(function (r) {
    var M = anPptModel_(d, r[3], r[4]);
    if (!M) throw new Error('No month of ' + d.year + ' has data yet.');
    var pres = anPptBuild_(window.PptxGenJS, M, { title: r[1], logo: r[2] });
    var name = 'HOPE_Annual_Report_' + M.year + (M.complete ? '' : '_to_date') + '.pptx';
    return anPptSave_(pres, name).then(function (viaApp) {
      /* Inside the app the saver says "saved to Downloads" (or why not) itself, once the phone has the file; a second
         line from here would only talk over it. */
      if (!viaApp) toast('Saved ' + name + ' \u00B7 ' + (M.prev ? 'with ' + M.prev.year + ' for comparison' : 'no earlier year to compare with'));
    });
  }).catch(function (e) {
    toast('Could not make the deck: ' + ((e && e.message) || e), true);
  }).then(function () {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  });
}
