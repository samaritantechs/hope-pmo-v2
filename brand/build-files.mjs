/* EVERY FILE IN THE PACKAGE, FROM ONE GEOMETRY FILE.  node brand/build-files.mjs
   Nothing here is hand-positioned: the lockups are built from the mark's own measurements and
   from the wordmark's, which were taken from the browser (see measure.mjs) rather than guessed
   from character counts. That is what stops a logo carrying stray whitespace that shifts it
   off-centre five files later. */
import { writeFileSync } from 'node:fs';
import { mark, wordmark, svg, C, STROKE } from './build-logo.mjs';

/* THE MARK'S OWN BOX. Two circles r=20 at (50,30) and (50,70), plus half a stroke all round. */
/* THE MARK'S OWN BOX -- and its CLEAR SPACE, which is part of the artwork rather than a note
   in a guide nobody opens. Flush to the edge, the arcs are TANGENT to the box: a circle is
   locally flat where it touches, so the mark reads as though somebody cropped it, and anything
   placed beside it touches the ink. The clear space is one stroke width all round -- again a
   rule that scales with the logo instead of a number to look up. */
const R = 20, SW = STROKE / 2, PAD = STROKE;
const INK  = { x: 50 - R - SW, y: 30 - R - SW, w: 2 * (R + SW), h: 40 + 2 * (R + SW) };  // 25,5,50,90
const MARK = { x: INK.x - PAD, y: INK.y - PAD, w: INK.w + 2 * PAD, h: INK.h + 2 * PAD };

/* THE WORDMARK, MEASURED IN THE BROWSER at font-size 56 and reduced to ems, so any size works:
     advance width  406.5 / 56 = 7.259 em
     ink above the baseline  51 / 56 = 0.911 em   (the ascender of h and t, taller than the caps)
     ink below the baseline  none -- "SamaritanTechs" has no descender in it. */
const WM = { w: 7.259, asc: 0.911 };

/* THE GAP between mark and word is the mark's STROKE, doubled -- a rule that scales with the
   logo instead of a number somebody has to look up and eventually gets wrong. */
const GAP = STROKE * 2.4;

const files = [];
const put = (name, s) => { writeFileSync(new URL('./svg/' + name, import.meta.url), s); files.push(name); };
const at = (dx, dy, inner, k = 1) =>
  `<g transform="translate(${dx},${dy})${k !== 1 ? ` scale(${k})` : ''}">${inner}</g>`;

/* ---- the mark alone, tight to its own ink, with no padding baked in ---- */
const markOnly = (o) => svg(MARK.w, MARK.h, at(-MARK.x, -MARK.y, mark(o)));
put('mark.svg',       markOnly());
put('mark-white.svg', markOnly({ top: C.white, bot: C.white }));
put('mark-navy.svg',  markOnly({ top: C.navy,  bot: C.navy }));
put('mark-black.svg', markOnly({ top: '#000',  bot: '#000' }));
put('mark-gold.svg',  markOnly({ top: C.gold,  bot: C.gold }));

/* THE LOCKUPS ARE LAID OUT FROM INK BOXES WITH EVEN CLEAR SPACE ALL ROUND.
   The first attempt positioned each piece by hand and every lockup ended up with generous space
   on one side and the type flush against the edge on the other -- which is exactly the kind of
   thing nobody notices in the file and everybody notices on a banner. Here the artwork is
   measured, the padding is one stroke width, and the box is whatever those add up to. */
const PADL = STROKE;
const ink = (size) => ({ w: WM.w * size, h: WM.asc * size });   // the wordmark's ink, at a size

function horizontal({ dark = true, bg = null, size = 52, gap = STROKE * 2.4 } = {}) {
  const t = ink(size);
  const cw = INK.w + gap + t.w, ch = Math.max(INK.h, t.h);
  const W = cw + 2 * PADL, H = ch + 2 * PADL;
  return svg(+W.toFixed(1), +H.toFixed(1),
    at(PADL - INK.x, PADL + (ch - INK.h) / 2 - INK.y, mark(dark ? {} : { top: C.white, bot: C.gold }))
    + wordmark({ x: +(PADL + INK.w + gap).toFixed(1),
                 y: +(PADL + (ch + t.h) / 2).toFixed(1), size, dark }), bg);
}
put('logo-horizontal.svg',         horizontal());
put('logo-horizontal-white.svg',   horizontal({ dark: false }));
put('logo-horizontal-on-navy.svg', horizontal({ dark: false, bg: C.navy }));

/* ---- stacked, for a square-ish space: an invoice head, a stamp, the corner of a slide.
   The mark carries more weight here because it has the room -- its height is set against the
   width of the word beneath it rather than left at whatever the horizontal version used. ---- */
function stacked({ dark = true, bg = null, size = 32 } = {}) {
  const t = ink(size);
  const k = (t.w * 0.52) / INK.h;                 // mark height ~ half the word's width
  const mw = INK.w * k, mh = INK.h * k;
  const lead = size * 0.72;
  const cw = Math.max(mw, t.w), ch = mh + lead + t.h;
  const W = cw + 2 * PADL, H = ch + 2 * PADL;
  return svg(+W.toFixed(1), +H.toFixed(1),
    at(+(PADL + (cw - mw) / 2 - INK.x * k).toFixed(2), +(PADL - INK.y * k).toFixed(2),
       mark(dark ? {} : { top: C.white, bot: C.gold }), k)
    + wordmark({ x: +(PADL + cw / 2).toFixed(1), y: +(PADL + mh + lead + t.h).toFixed(1), size, dark })
      .replace('<text ', '<text text-anchor="middle" '), bg);
}
put('logo-stacked.svg',         stacked());
put('logo-stacked-white.svg',   stacked({ dark: false }));
put('logo-stacked-on-navy.svg', stacked({ dark: false, bg: C.navy }));

/* ---- the profile picture. Square, because every platform takes a square and crops a CIRCLE
   out of it -- so the mark is sized to the inscribed circle, not to the square, or it arrives
   with its corners bitten off on three hundred officers' phones. ---- */
function profile(bg, o) {
  const S = 1000, k = 640 / INK.h;   // mark ink = 64% of the square, so it survives the circle
  return svg(S, S, `<rect width="${S}" height="${S}" fill="${bg}"/>`
    + at(+((S - INK.w * k) / 2 - INK.x * k).toFixed(1), +((S - INK.h * k) / 2 - INK.y * k).toFixed(1), mark(o), k));
}
put('profile.svg',       profile(C.navy,  { top: C.white, bot: C.gold }));
put('profile-light.svg', profile(C.white, {}));
put('profile-gold.svg',  profile(C.gold,  { top: C.navy,  bot: C.white }));

/* ---- the icon: a rounded square, so it reads as an app tile rather than a shape adrift ---- */
function icon(px, bg, o, radius) {
  const k = (px * 0.60) / INK.h;
  return svg(px, px, `<rect width="${px}" height="${px}" rx="${radius}" fill="${bg}"/>`
    + at(+((px - INK.w * k) / 2 - INK.x * k).toFixed(2), +((px - INK.h * k) / 2 - INK.y * k).toFixed(2), mark(o), k));
}
put('icon.svg',       icon(64, C.navy,  { top: C.white, bot: C.gold }, 14));
put('icon-light.svg', icon(64, C.white, {}, 14));

console.log(files.length + ' files\n' + files.join('\n'));
