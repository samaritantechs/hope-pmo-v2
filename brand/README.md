# SamaritanTechs — the brand package

Everything in `svg/`, `png/`, `jpg/` and `docs/` is **generated**. Nothing in them is
hand-drawn, hand-positioned or hand-kerned, which is the whole point: the logo can be rebuilt
from arithmetic if every file here is ever lost, and it will come back identical.

```
node brand/build-files.mjs     # 16 SVGs        — the masters
node brand/build-raster.mjs    # 29 PNG + 6 JPG — needs Chromium (it renders through canvas)
node brand/build-docs.mjs      # letterhead + invoice .docx
```

## The mark

Two arcs of the same circle, radius 20, one above the other, meeting in the middle of the
square. The navy arc comes down from the top and stops at the centre; the gold arc starts at
that same point and carries on down. Same radius, same stroke, same sweep — one reaches, one
rises, and the joint is a single shared coordinate.

That is the parable, and it is also the business: a Samaritan is the one who stopped for the
person everybody else walked past, and this company writes the software that lends to people
the banking system walks past. It is not a handshake and not two hands — those are drawn a
thousand times and they turn to mud at 32 px. Two arcs stay legible as a favicon because at
that size they are still just two thick curved strokes.

The geometry lives in `build-logo.mjs`:

```js
const R = 20, CX = 50, TOP = 30, BOT = 70;   // two circles, one above the other
export const STROKE = 10;                    // 10 keeps the counters open; 12 closes them
```

Change a number there and every file in the package regenerates from it.

## Colour

| | hex | where |
|---|---|---|
| Navy | `#0B2A6B` | the reaching arc, all body type, the dark ground |
| Gold | `#F2A413` | the rising arc, `Techs`, one accent per page |
| Ink | `#0E1726` | print black — never `#000` on paper |
| Slate | `#5A6B85` | secondary type, rules |
| Mist | `#F4F7FB` | table fills, panels |
| White | `#FFFFFF` | the knockout |

Navy on white and white on navy both clear WCAG AA at body size. Gold does not — it is an
accent, never text on white.

## Typeface

**Arial** (metrically identical to **Liberation Sans**, which is what actually renders here).
Bold for the wordmark, at `letter-spacing: -1.46` per 52 px of size — the ratio, not the
number, is what carries to other sizes. Arial is on every machine in every office in Dar es
Salaam, which matters more for an invoice that has to open on a stranger's laptop than any
licensed face would.

`Samaritan` is navy, `Techs` is gold. One word, two colours, no space and no camel-case gap.

## Clear space and minimum size

Clear space is **one stroke width** all round, and it is baked into every master file rather
than written in a guide nobody opens — the SVG's own box already carries it, so anything
placed flush against the file is still correctly spaced.

Minimum sizes: horizontal lockup **120 px / 32 mm** wide; stacked **72 px / 20 mm**; the mark
alone **20 px**. Below that the counters start to fill in.

## Files

| | |
|---|---|
| `svg/` | 16 masters. Open in Illustrator, Figma, Inkscape, Canva, Photoshop. Print at any size. |
| `png/` | 29 transparent files: the logo at 2400/1200/600/300, the mark down to 32, profile pictures, favicons at 512/192/180/64/32/16. |
| `jpg/` | 6 files flattened onto a stated background, for the forms and print shops that refuse a PNG. |
| `docs/` | `SamaritanTechs-letterhead.docx` and `SamaritanTechs-invoice.docx` — A4, header, footer, live page-number field. |

**There is no PSD, on purpose.** A layered Photoshop file is one more thing that opens in one
program and drifts out of step with the vector master the first time anybody edits it. The SVGs
open in Photoshop too — File → Open, and every path arrives as a path.

## Which file

- Website header, email signature, letterhead → `svg/logo-horizontal.svg`
- On a navy or photographic background → `logo-horizontal-white.svg`
- Square-ish space (invoice head, slide corner, stamp) → `logo-stacked.svg`
- WhatsApp Business, Instagram, LinkedIn, X → `png/samaritantechs-profile-1000.png`
- App tile / favicon → `png/favicon-512.png` and down
- Somebody's Word template that will not take a PNG → `jpg/`

The profile files are square with the mark sized to the **inscribed circle**, so they survive
every platform that crops a circle out of a square.

## Misuse

Do not recolour the arcs, do not put the mark in a coloured circle of its own, do not add a
drop shadow or an outline, do not stretch it (the arcs stop being circular and everyone can see
it without knowing why), do not set the wordmark in another face, and do not put the colour
lockup on a mid-tone photo — that is what the white version is for.
