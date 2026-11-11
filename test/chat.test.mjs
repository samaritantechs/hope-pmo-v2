/* CHAT.md -- the chat, kept in the repository (CLAUDE.md section 3).
 *
 *   "Chat is refusing to rewind and even providing any handoff thats why i wish there is
 *    something like merge, so that you continue automatic"
 *
 * The chat that ran this repository from August to November 2026 ended with no handoff: it had
 * grown past its size limit and could not write one. A handoff that is written at the end is a
 * handoff that is not written on the day it is needed, so it is written all the time instead --
 * CHAT.md, updated in the same commit as every change, loaded by every new chat with CLAUDE.md.
 *
 * "Updated in the same commit" is a promise, and a promise to be careful is worth nothing six
 * weeks later (docs/HANDOFF.md Part 14m). So it is written down here as something that FAILS:
 * a change that moves a version stamp or adds a Part to the handbook turns `npm test` red until
 * CHAT.md has been brought up to it.
 *
 * It reads four files and no database. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const chat = read('CHAT.md');
const HOW = '. CHAT.md is what the next chat starts from: bring its "As of" line and section 4 up to this change, '
  + 'in the same commit (CLAUDE.md section 3).';

test('CHAT.md names the versions the code is at', () => {
  const build = /^var BUILD = '([^']+)'/m.exec(read('public/app.html'));
  const callBuild = /^var CALL_BUILD = '([^']+)'/m.exec(read('public/call.html'));
  assert.ok(build, 'var BUILD is where it has always been in public/app.html');
  assert.ok(callBuild, 'var CALL_BUILD is where it has always been in public/call.html');
  const app = JSON.parse(read('app-version.json'));
  for (const stamp of ['`BUILD ' + build[1] + '`', '`CALL_BUILD ' + callBuild[1] + '`', '`versionCode ' + app.versionCode + '`']) {
    assert.ok(chat.includes(stamp), 'CHAT.md does not say ' + stamp + HOW);
  }
});

test('CHAT.md has caught up with the handbook', () => {
  const parts = [...read('docs/HANDOFF.md').matchAll(/^## Part (\d+)\b/gm)].map(m => Number(m[1]));
  assert.ok(parts.length > 40, 'the handbook still numbers its Parts');
  const last = Math.max(...parts);
  assert.match(chat, new RegExp('\\*\\*Part ' + last + '\\*\\*'),
    'docs/HANDOFF.md is at Part ' + last + ' and CHAT.md does not say so' + HOW);
});

test('CLAUDE.md sends every new chat to CHAT.md', () => {
  const claude = read('CLAUDE.md');
  // The import: a line of its own, outside any code block, or it is text and loads nothing.
  assert.match(claude, /^@CHAT\.md$/m, 'the line that loads CHAT.md together with the rules');
  assert.ok(!/```[^`]*^@CHAT\.md$[^`]*```/m.test(claude), 'and it is not inside a code block');
  assert.match(claude, /read it before anything\s+else/, 'with the instruction for a chat that was not handed it');
});

test('CHAT.md keeps the things a new chat cannot work without', () => {
  for (const heading of ['## 1. The first five minutes of a new chat', "## 2. The owner's standing orders",
                         '## 3. What a chat can and cannot reach', '## 4. Where the work stands',
                         '## 6. Scheduled tasks', '## 7. How the work is done here', '## 8. Waiting on someone']) {
    assert.ok(chat.includes('\n' + heading + '\n'), 'CHAT.md has lost "' + heading + '"');
  }
  // The orders are the owner's words, kept where they were first written down -- not a second copy.
  assert.ok(chat.includes('docs/HOPE-OWNER-HANDOFF.md'), 'it points at the standing orders already on record');
  assert.ok(fs.existsSync(new URL('../docs/HOPE-OWNER-HANDOFF.md', import.meta.url)));
  // Every scheduled task a new chat has to take over is named.
  assert.ok(chat.includes('HOPE PMO change check (8-hourly)'));
});

test('CHAT.md carries no key, no password and nobody\'s address', () => {
  /* It is written by a chat, in a hurry, at the end of every change, and the repository is public.
     docs/SECURITY.md: a key lives in the host's settings and nowhere else. */
  const never = [
    [/eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/, 'something shaped like a signed key (a JWT)'],
    [/\bsb_(secret|publishable)_[A-Za-z0-9]/, 'a Supabase key'],
    [/\b(postgres|postgresql):\/\/[^\s/]+:[^\s/]+@/i, 'a database connection string with its password'],
    [/\bSUPABASE_SERVICE_ROLE_KEY\s*=\s*\S/, 'a service key assignment'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, 'an e-mail address'],
  ];
  for (const [re, what] of never) assert.ok(!re.test(chat), 'CHAT.md contains ' + what + ': take it out');
});
