/* SVG -> PNG and JPEG, through a canvas in the headless browser already on this machine.

   NOT THROUGH --screenshot, and that is the second thing I got wrong here. A screenshot
   captures the VIEWPORT, and the viewport turned out not to be the size I asked for: with
   --window-size exactly matching the artwork, eighty pixels of a two-hundred-and-twenty pixel
   logo were simply missing, and the same file in a taller window came out whole. Both headless
   modes did it. A logo package cannot be built on a renderer that silently crops.

   Drawing into a canvas of stated width and height has no viewport in it at all: the bitmap is
   the size it is asked for, every time, and the same code path produces the PNG and the JPEG so
   the two cannot drift apart.

   THE SIZE ALWAYS COMES FROM THE viewBox. An earlier version rewrote the width attribute with
   /width="\d+"/, which silently does not match width="480.5" -- so the height was scaled, the
   width was not, and every lockup came out squashed. Reading the aspect ratio out of the file
   and deriving the other dimension cannot distort anything. */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HERE = new URL('.', import.meta.url).pathname;
for (const d of ['png', 'jpg']) mkdirSync(HERE + d, { recursive: true });

const viewBox = svg => {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!m) throw new Error('no viewBox in ' + svg.slice(0, 60));
  return { w: +m[1], h: +m[2] };
};

/** One trip to the browser: draw the artwork at an exact pixel size and hand back the bytes.
    `bg` null keeps the alpha channel -- PNG only, since JPEG has no transparency to keep. */
function draw(svgFile, w, h, type, bg, quality) {
  const svg = readFileSync(HERE + 'svg/' + svgFile, 'utf8');
  const page = `<html><body><canvas id="c" width="${w}" height="${h}"></canvas><pre id="o"></pre>
<script>
var i = new Image();
i.onload = function(){
  var c = document.getElementById('c'), x = c.getContext('2d');
  ${bg ? `x.fillStyle=${JSON.stringify(bg)};x.fillRect(0,0,${w},${h});` : ''}
  x.drawImage(i, 0, 0, ${w}, ${h});
  document.getElementById('o').textContent = c.toDataURL(${JSON.stringify(type)}${quality ? ',' + quality : ''});
};
i.onerror = function(){ document.getElementById('o').textContent = 'IMAGE-FAILED'; };
i.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
</script></body></html>`;
  writeFileSync(HERE + '.tmp.html', page);
  const dom = execFileSync(CHROME, ['--headless', '--no-sandbox', '--disable-gpu',
    '--virtual-time-budget=6000', '--dump-dom', HERE + '.tmp.html'],
    { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 1 << 28 });
  /* READ THE <pre>, NOT THE WHOLE DOCUMENT. --dump-dom returns the SCRIPT SOURCE too, so a
     test for the failure marker anywhere in the page matched the line that WRITES the marker
     and every render "failed" while the browser was doing its job perfectly. The answer is
     whatever the page put in the one element it was told to put it in. */
  const box = dom.match(/<pre id="o">([\s\S]*?)<\/pre>/);
  const said = box ? box[1].trim() : '';
  if (said === 'IMAGE-FAILED') throw new Error('the browser could not load ' + svgFile);
  const m = said.match(/^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('no bitmap came back for ' + svgFile + ' -- page said: ' + said.slice(0, 80));
  return Buffer.from(m[1], 'base64');
}

/** Render `w` pixels wide; the height follows the artwork, so nothing is ever squashed. */
export function png(svgFile, w, name, bg = null) {
  const b = viewBox(readFileSync(HERE + 'svg/' + svgFile, 'utf8'));
  const h = Math.round(w * b.h / b.w);
  writeFileSync(HERE + 'png/' + name, draw(svgFile, w, h, 'image/png', bg));
  return `${name}  ${w}x${h}`;
}

/** JPEG cannot carry transparency, so every one of these is drawn on a STATED background --
    never on "whatever the viewer's page happens to be", which is how a logo ends up with a
    black box behind it in somebody's slide deck. */
export function jpg(svgFile, w, name, bg = '#FFFFFF') {
  const b = viewBox(readFileSync(HERE + 'svg/' + svgFile, 'utf8'));
  const h = Math.round(w * b.h / b.w);
  writeFileSync(HERE + 'jpg/' + name, draw(svgFile, w, h, 'image/jpeg', bg, 0.94));
  return `${name}  ${w}x${h}`;
}
