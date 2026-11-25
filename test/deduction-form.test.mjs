/* THE PMO DEDUCTION FORM: SEVERAL CUSTOMERS IN ONE CASE, ONE PRESS OF SAVE IS ONE CASE (handbook Part 164).

     "at filling deductions case, we can add another customer & ref no in the same case as we add multi officers"
     "[a reporter] pressed multiple times at submitting deduction case and deductions went so many (16) so we must delete all unique rows in the
      existing deductions bro and prevent such an issue in the future"                                    -- the owner, 25 Nov 2026

   The server's side (the same submission is the same case; several customers in the two cells every line has; half a customer refused) is held by test/portal.test.mjs through the real dispatch. This holds
   the PAGE's side by what its code says, the order it says it in, and the one thing a source pin can do honestly: that a later edit does not take the guard away. The form in a real browser, with a slow
   server, sixteen presses and a failed save: tools/browser-checks/portal-deductions-form.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const DEDUCT = read('public/mod/deduct.js');
const FORM = DEDUCT.slice(DEDUCT.indexOf('function dedNew()'), DEDUCT.indexOf('/* A ROW IS ONE STAFF LINE OF A CASE.'));
const SAVE = FORM.slice(FORM.indexOf("$('#ddSave').onclick = function(){"));
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('the form has customer rows like its staff rows: a name and a REF NO each, an Add button, a Remove link, at least one row, and no single customer box', () => {
  assert.match(FORM, /var custRow = function\(i\)\{/);
  assert.match(FORM, /class="facts ded-cust"/);
  assert.match(FORM, /<input class="dcName"/); assert.match(FORM, /<input class="dcRef" inputmode="numeric"/);
  assert.match(FORM, /id="ddAddCust"[^>]*>\+ Ongeza mteja mwingine \/ Add another customer<\/button>/);
  assert.match(FORM, /class="dcRm"[^>]*>✕ Ondoa huyu \/ Remove<\/a>/);
  assert.match(FORM, /Angalau mteja mmoja\. \/ At least one customer\./, 'the last row cannot be removed, and it says so');
  assert.ok(!/id="ddCust"|id="ddRef"/.test(FORM), 'the two single boxes are gone: one customer is a row');
  // the staff rows are untouched: same ids, same classes
  for (const s of ['class="facts ded-staff"', 'class="dsName"', 'class="dsTaken"', 'class="dsDed"', 'class="dsRm"', 'id="ddAdd"', 'id="ddStaff"']) assert.ok(FORM.includes(s), s + ' is still on the form');
});

test('what is sent: the customers as a list of { name, ref } in the order typed (empty rows dropped, half rows said and not sent), and no old single pair', () => {
  assert.match(SAVE, /if \(!nm && !rf\) return;/);
  assert.match(SAVE, /if \(!nm \|\| !rf\) \{ half = true; return; \}/);
  assert.match(SAVE, /customers\.push\(\{ name: nm, ref: rf \}\)/);
  assert.match(SAVE, /if \(half \|\| !customers\.length\)\{ toast\('Kila mteja anahitaji jina na REF NO\. \/ Every customer needs a name and a REF NO\.', true\); return; \}/);
  assert.match(SAVE, /srv\('addDeduction', \{ team:\$\('#ddTeam'\)\.value, customers:customers,/);
  assert.ok(!/customer:\$\('#ddCust'\)|ref:\$\('#ddRef'\)/.test(SAVE), 'no old single pair is sent');
});

test('ONE PRESS, ONE CASE: the handler returns while a save is on its way, switches the button off BEFORE it asks the server, and says it is saving', () => {
  const c = code(SAVE);
  const guard = c.indexOf('if (S.dedSaving) return;'), lock = c.indexOf('S.dedSaving = true; btn.disabled = true;'), ask = c.indexOf("srv('addDeduction'");
  assert.ok(guard > 0 && lock > guard && ask > lock, 'the guard, then the lock, then the request: in that order');
  assert.match(c, /btn\.textContent = 'Inahifadhi… \/ Saving…'/);
  assert.match(FORM, /S\.dedSaving = false;\n/, 'a new form starts unlocked');
  // validation (nothing to send) comes before the lock, so a refused press never leaves the button off
  assert.ok(c.indexOf("toast('Andika maamuzi") < lock && c.indexOf("toast('Chagua timu") < lock && c.indexOf('Kila mteja anahitaji jina na REF NO') < lock);
});

test('a save that comes back, either way, unlocks: a failure brings the button and its words back and keeps the form; a success closes it and names a repeat as already saved', () => {
  const c = code(SAVE);
  const then = c.slice(c.indexOf('.then(function(r){'), c.indexOf('.catch(function(e){'));
  const catchB = c.slice(c.indexOf('.catch(function(e){'));
  assert.match(then, /S\.dedSaving = false;/);
  assert.match(then, /r && r\.duplicate\s*\?\s*'Kesi hii ilikwisha hifadhiwa — haikurudiwa\. \/ This case was already saved — not repeated\.'/);
  assert.match(then, /closeDrawer\(\); render\(\{ force:true \}\);/);
  assert.match(catchB, /S\.dedSaving = false; btn\.disabled = false; btn\.textContent = DED_SAVE_LABEL_;/);
  assert.match(catchB, /toast\('Haikuhifadhiwa \/ NOT saved: ' \+ String\(\(e && e\.message\) \|\| e\), true\)/);
  assert.ok(!/closeDrawer\(\)/.test(catchB), 'a failed save keeps the form open with what was typed');
  assert.match(DEDUCT, /var DED_SAVE_LABEL_ = 'Hifadhi kesi \/ Save case';/);
  assert.match(FORM, />' \+ DED_SAVE_LABEL_ \+ '<\/button>/, 'the label is written once and used for the button and for its return');
});

test('the server\'s side is the one wall that holds when this page is old, a second tab, a retry or a script: ids made from the submission, written ON CONFLICT DO NOTHING, nothing read first', () => {
  const core = read('api/_lib/portal-core.js');
  const fn = core.slice(core.indexOf('async function addDeduction('), core.indexOf('/** HR\'s column: notes and the amount actually deducted'));
  assert.match(fn, /const caseId = dedUuid_\(content\);/);
  assert.match(fn, /id: dedUuid_\(content \+ '\|' \+ i\),/);
  assert.match(fn, /\.upsert\(rows, \{ onConflict: 'id', ignoreDuplicates: true \}\)\.select\('id'\)/);
  assert.ok(!/randomUUID|Math\.random/.test(core.slice(core.indexOf('function dedUuid_'), core.indexOf('/** HR\'s column: notes and the amount actually deducted'))), 'no luck anywhere in a case\'s ids');
  assert.ok(!/\.from\('pmo_deductions'\)\s*\.select\(/.test(fn), 'nothing is read before the write: there is no gap for two instances to fall into');
  assert.match(fn, /duplicate: added === 0/);
  // what the content is made of: everything the submission says, nothing about when
  const content = fn.slice(fn.indexOf('const content = JSON.stringify(['), fn.indexOf('const caseId'));
  for (const part of ['user.name', 'team', 'customers.map', 'receivedDate', 'discoveryDate', 'decision', 'toPay', 'staff.map']) assert.ok(content.includes(part), part + ' is part of what makes a submission the same');
  assert.ok(!/\bnowMs\b|\bat\b|submitted_at|new Date|Date\.now/.test(content), 'the time is not part of it: a second press a minute later is the same case');
});
