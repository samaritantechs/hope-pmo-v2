/* THE ANDROID XML MUST PARSE.
 *
 * Same lesson as pages.test.mjs, one directory over. The APK build on main (android-apk.yml
 * run #22) failed at processReleaseMainManifest with "Error parsing AndroidManifest.xml":
 * a comment added to the manifest used " -- " as a dash, and XML forbids a double hyphen
 * anywhere inside a comment. Nothing in this sandbox builds an APK, the Java had been
 * syntax-checked with a plain JDK and looked fine, and the merge went out on that basis --
 * the manifest merger runs BEFORE javac, so the Java never even got compiled. The whole
 * update pipeline for three hundred handsets stopped on a hyphen.
 *
 * This is the cheapest possible guard against that: every .xml under android/app/src/main
 * is scanned, and a comment carrying "--" fails the suite. It proves only well-formedness
 * of comments, not that the manifest is right; but it is exactly the failure that got past
 * everything else, and it now cannot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ANDROID_MAIN = new URL('../android/app/src/main/', import.meta.url).pathname;

function xmlFiles(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...xmlFiles(p));
    else if (/\.xml$/i.test(d.name)) out.push(p);
  }
  return out;
}

test('no XML under android/app/src/main carries a double hyphen inside a comment', () => {
  const files = xmlFiles(ANDROID_MAIN);
  assert.ok(files.some(f => /AndroidManifest\.xml$/.test(f)), 'the manifest itself is among the files scanned');
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /<!--([\s\S]*?)-->/g;
    let m;
    while ((m = re.exec(src))) {
      assert.ok(!m[1].includes('--'),
        f.replace(ANDROID_MAIN, '') + ': a comment contains a double hyphen, which XML forbids and '
        + 'the manifest merger fails the whole APK build on. Comment begins: '
        + JSON.stringify(m[1].trim().slice(0, 100)));
    }
  }
});

test('every comment in the manifest is actually closed (an unclosed one swallows the rest of the file)', () => {
  const src = readFileSync(join(ANDROID_MAIN, 'AndroidManifest.xml'), 'utf8');
  const opens = (src.match(/<!--/g) || []).length;
  const closes = (src.match(/-->/g) || []).length;
  assert.equal(opens, closes, opens + ' comment openers vs ' + closes + ' closers');
});

/* THE STANDING NOTIFICATION SAYS "AUTO UPDATING DATA", AND NOTHING ABOUT LOCATION.
     "Bro we can't have notification on handset that we are reporting device location.
      If it's a compulsory policy then at least say 'Hope pmo is auto updating data'."
   Android makes the notification itself compulsory for a background location service; the
   wording is ours. This pins the wording, and pins the channel at MINIMUM importance on a
   channel id that is not the original one -- a channel's importance freezes when it is first
   created, so lowering it under the old id would have changed nothing on phones already
   running the service. */
test('the officer-location service notification says auto updating data, quietly, on a fresh channel', () => {
  const src = readFileSync(join(ANDROID_MAIN, 'java/com/samaritantechs/hopecalls/OfficerLocationService.java'), 'utf8');
  /* Only what the PERSON sees: the channel's name and description, the notification's title
     and line. Internal names (the thread, the preference key) are not on the screen. */
  const shown = [...src.matchAll(/(?:setContentTitle|setContentText|setDescription)\("([^"]*)"\)|new NotificationChannel\(CHANNEL_ID, "([^"]*)"/g)]
    .map(m => m[1] || m[2]);
  assert.ok(shown.length >= 4, 'channel name, description, title and line are all literal strings (' + shown.length + ')');
  assert.ok(shown.filter(s => /inasasisha data|auto updating data/i.test(s)).length >= 2,
    'both the channel description and the notification line carry the agreed wording');
  for (const s of shown) {
    assert.ok(!/location|mahali|ripoti/i.test(s), 'no user-visible string mentions location: ' + s);
  }
  assert.ok(/IMPORTANCE_MIN/.test(src) && !/IMPORTANCE_LOW|IMPORTANCE_DEFAULT|IMPORTANCE_HIGH/.test(src), 'the channel is minimum importance');
  assert.ok(/setSilent\(true\)/.test(src) && /PRIORITY_MIN/.test(src), 'the notification itself is silent and lowest priority');
  assert.ok(/CHANNEL_ID = "hope_pmo_sync"/.test(src), 'a new channel id, so the quieter importance takes effect on update');
  assert.ok(/deleteNotificationChannel\("officer_location"\)/.test(src), 'and the old channel is retired');
});
