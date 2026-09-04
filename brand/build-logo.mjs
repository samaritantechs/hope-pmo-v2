/* THE SAMARITANTECHS MARK, BUILT RATHER THAN DRAWN.
 *
 * Every curve here comes out of two circles and one arithmetic file, so the logo can be
 * regenerated exactly, at any size, for ever -- and so a future change is a change to a number
 * rather than a hunt through a designer's layers that nobody has any more.
 *
 * THE IDEA. A Samaritan is the one who stopped for the person everyone else walked past. This
 * company writes software for microfinance in Tanzania -- lending to the people the banking
 * system walks past. That is not a stretched metaphor; it is the same sentence twice.
 *
 * So the mark is an S built from TWO ARCS THAT MEET:
 *
 *   the upper arc, navy    reaches down
 *   the lower arc, gold    rises to meet it
 *   where they touch       is the whole idea, and it is the centre of the mark
 *
 * It reads four ways at once, which is what makes a mark worth owning: an S for Samaritan, two
 * figures meeting, a node on a network, and -- at 16 pixels, in one colour, embroidered on a
 * shirt -- still a clean S.
 *
 * THE GEOMETRY. Two circles of radius R, centres stacked 2R apart, so their edges touch at
 * exactly one point: the join. Each arc sweeps 225 degrees, leaving the terminals open at the
 * upper right and lower left, like two hands not yet closed.
 */
const R = 20, CX = 50, TOP = 30, BOT = 70;      // circles: centres (50,30) and (50,70)
const JOIN = [CX, (TOP + BOT) / 2];             // (50,50) -- where the edges touch
const P = (cx, cy, deg) => [                     // a point on a circle, screen angles (y down)
  +(cx + R * Math.cos(deg * Math.PI / 180)).toFixed(2),
  +(cy + R * Math.sin(deg * Math.PI / 180)).toFixed(2)];
const A = P(CX, TOP, 315);                       // upper terminal, open to the upper right
const B = P(CX, BOT, 135);                       // lower terminal, open to the lower left

/* large-arc-flag 1 because each sweep is 225 degrees; sweep-flag 0 then 1 because the S turns
   one way and then the other -- that reversal IS the letterform. */
export const ARC_TOP = `M ${A[0]} ${A[1]} A ${R} ${R} 0 1 0 ${JOIN[0]} ${JOIN[1]}`;
export const ARC_BOT = `M ${JOIN[0]} ${JOIN[1]} A ${R} ${R} 0 1 1 ${B[0]} ${B[1]}`;
/* TEN, CHOSEN BY LOOKING. A contact sheet of sweep 200/225/250 against stroke 8/10/12, each
   shown full size AND at 22 pixels, settled it: 12 closes the counters up at small sizes, 8 goes
   weak, 250 curls the top bowl into an O. This is the pair that still reads as an S in a
   favicon and still survives embroidery. */
export const STROKE = 10;

export const C = {
  navy:  '#0B2A6B',   // already the company's own -- it heads every Excel export HOPE PMO makes
  gold:  '#F2A413',   // the warmth "Samaritan" promises, and a Tanzanian morning
  ink:   '#0E1726',
  slate: '#5A6B85',
  mist:  '#F4F7FB',
  white: '#FFFFFF',
};

/** The mark alone, on a 100x100 grid. `two` false gives a single-colour version. */
export function mark({ top = C.navy, bot = C.gold, two = true } = {}) {
  const b = two ? bot : top;
  return `<g id="mark" fill="none" stroke-linecap="round" stroke-width="${STROKE}">`
    + `<path id="reaching-down" d="${ARC_TOP}" stroke="${top}"/>`
    + `<path id="rising-to-meet" d="${ARC_BOT}" stroke="${b}"/>`
    + `</g>`;
}

/* THE WORDMARK IS SET IN AN ARIAL-METRIC FACE, ON PURPOSE.
 * Liberation Sans here, Arial on every Windows machine, Helvetica on every Mac: the same
 * widths, so the wordmark sets IDENTICALLY in Word, Excel, PowerPoint and a browser without
 * anybody installing anything. A brand that survives contact with Microsoft Office in a Dar es
 * Salaam office is worth more than one that needs a font licence and a support call. The
 * CamelCase is carried by COLOUR rather than by a capital alone, so the two halves of the name
 * read apart at a glance and the mark's two colours are repeated in the type. */
export const FONT = "Liberation Sans, Arial, Helvetica, sans-serif";
export function wordmark({ x = 0, y = 0, size = 100, dark = true } = {}) {
  const one = dark ? C.navy : C.white;
  const two = C.gold;
  return `<g id="wordmark"><text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}"`
    + ` font-weight="bold" letter-spacing="${(-size * 0.028).toFixed(2)}">`
    + `<tspan fill="${one}">Samaritan</tspan><tspan fill="${two}">Techs</tspan>`
    + `</text></g>`;
}

export const svg = (w, h, body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
  + (bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : '') + body + `</svg>`;
