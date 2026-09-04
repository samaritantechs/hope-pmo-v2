/* MEASURE THE WORDMARK IN THE BROWSER, rather than guessing its width from character counts.
   The lockup's viewBox is then EXACT -- no stray whitespace baked into every export, which is
   what makes a logo drift off-centre in somebody's slide five files later. */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { wordmark, FONT } from './build-logo.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export function textBox(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="300">`
    + wordmark({ x: 10, y: 200, size }) + `</svg>`;
  const page = `<html><body>${svg}<pre id="o"></pre><script>
var t = document.querySelector('text'), b = t.getBBox();
document.getElementById('o').textContent = JSON.stringify(
  {x:+b.x.toFixed(2), y:+b.y.toFixed(2), w:+b.width.toFixed(2), h:+b.height.toFixed(2)});
</script></body></html>`;
  writeFileSync('brand/.measure.html', page);
  const dom = execFileSync(CHROME, ['--headless','--no-sandbox','--disable-gpu',
    '--virtual-time-budget=3000','--dump-dom','brand/.measure.html'], {encoding:'utf8'});
  const m = dom.match(/\{"x":[^}]+\}/);
  if (!m) throw new Error('could not measure the wordmark');
  return JSON.parse(m[0]);
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(textBox(56)));
