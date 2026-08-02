/* Builds docs/V1-REVIEW-PACK.md -- one file to hand to whoever knows the OLD Google Sheets
   system, so they can say what v2 still gets wrong or has not got at all.

       node tools/make-review-pack.mjs

   WHY THIS EXISTS RATHER THAN "just send them the code"
   The source is about a megabyte across eighty-odd files. Nobody reviews that in a chat window,
   and a reviewer who runs out of room half way through gives an answer worse than none.

   What a reviewer actually needs is not the code -- it is a faithful INVENTORY: every tab,
   every column on it, every figure the system can be asked for, every report it accepts, every
   setting it obeys. That fits, and it is the thing they can compare against v1 line by line.

   Every list below is READ OUT OF THE CODE at the moment this runs. Nothing is typed by hand,
   so the pack cannot quietly drift from the system the way a written summary does. If a tab is
   added and this is re-run, the tab appears. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const APP = read('public/app.html');
const CALL = read('public/call.html');
const UPLOAD = read('public/upload.html');

/* ---------- portal tabs, in the order they appear on screen ---------- */
const navBlock = APP.slice(APP.indexOf('var NAV = ['));
const tabs = [...navBlock.slice(0, navBlock.indexOf('\n];')).matchAll(/\{\s*id:'([^']+)',\s*label:'([^']+)'/g)]
  .map(m => ({ id: m[1], label: m[2] }));

/* ---------- the columns each tab actually shows ----------
   Taken from the col(...) calls inside each VIEWS.<id> block. These are the column HEADINGS a
   reviewer compares against the old sheet, which is where "you left a column behind" lives. */
/* Pull the column labels out of a piece of source, in either idiom the app uses. */
function labelsIn(src) {
  const out = [];
  for (const m of src.matchAll(/col\('([^']+)',\s*'([^']*)'/g)) out.push(m[2] || m[1]);
  for (const m of src.matchAll(/\{\s*key:'([^']+)',\s*label:'([^']*)'/g)) out.push(m[2] || m[1]);
  return out;
}
/* THIS FUNCTION GOT IT WRONG ONCE, AND THE WRONGNESS TRAVELLED.

   It used to read only the body of the view. But a tab whose columns are shared between two
   places on the same screen declares them ONCE, outside the view, as a named constant --
   `var CMS_COLS = [...]` and then `S.cols = CMS_COLS`. Reading only the body found nothing,
   so this pack reported "Columns in the table: none" for My Commission.

   That was not a harmless gap in a document. The pack went to the team who know v1, they
   diffed it honestly, and it came back as "the whole per-officer table is missing, rebuild
   it" -- for seven columns that had been on screen the entire time. A tool that under-reports
   sends people to build things that already exist.

   So a shared constant is now followed and read. */
function columnsFor(id) {
  const body = viewBody(id);
  if (!body) return [];
  const out = labelsIn(body);

  // Follow a shared column list the view hands to S.cols, in either form it is written:
  //     var CMS_COLS = [ ... ];              a constant
  //     function FOLLOWUP_COLS(){ return [ ... ]; }   a builder, when a column needs a closure
  const named = new Set();
  for (const m of body.matchAll(/S\.cols\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\(\s*\))?/g)) named.add(m[1]);
  for (const name of named) out.push(...labelsIn(sharedList(name)));
  return [...new Set(out)];
}
/* The source of a named column list, bounded by MATCHING BRACKETS rather than by hunting for
   the next "];". A naive search runs past the end of a list whose last entry closes with "}]"
   and swallows whatever comes next -- which is how one tab reported ninety-one columns. */
function sharedList(name) {
  for (const start of [APP.indexOf(`var ${name} = [`), APP.indexOf(`function ${name}(){`)]) {
    if (start < 0) continue;
    const open = APP.indexOf('[', start);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < APP.length; i++) {
      const ch = APP[i];
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (!depth) return APP.slice(open, i + 1); }
    }
  }
  return '';
}

/* ---------- the KPI cards on each tab ---------- */
/* Cards, named where they can be named and COUNTED where they cannot.

   A tab that builds one card per pipeline stage writes kpi(s.stage.replace(...)) -- the label
   is worked out when the page runs, so there is no text here to read. Matching only quoted
   labels reported "Cards at the top: none" for a tab with eight of them, and that is the third
   time this pack has told the v1 team something was missing when it was on the screen.
   If a label cannot be read, say so rather than saying nothing is there. */
function kpisFor(id) {
  const body = viewBody(id);
  const named = [...new Set([...body.matchAll(/kpi\('([^']+)'/g)].map(m => m[1]))];
  const total = (body.match(/\bkpi\(/g) || []).length;
  const computed = total - (body.match(/\bkpi\('/g) || []).length;
  if (computed > 0) named.push(`(${computed} more, built from the data — labels not readable here)`);
  return named;
}
/* A view's own source, bounded by MATCHING BRACES.

   This used to run from `VIEWS.x = function` to the next `VIEWS.` in the file -- which quietly
   swallowed anything declared BETWEEN two views. A shared column list sitting between
   Assignment and Followup was read as if it belonged to Assignment, and that tab was reported
   with eleven columns it does not have. Over-reporting is as bad as under-reporting here: one
   sends people to build what exists, the other tells them something is fine when it is not. */
function viewBody(id) {
  const start = APP.indexOf(`VIEWS.${id} = function`);
  if (start < 0) return '';
  const open = APP.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < APP.length; i++) {
    const ch = APP[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return APP.slice(open, i + 1); }
  }
  return APP.slice(open);
}

/* ---------- everything the server can be asked ---------- */
const portalFns = (() => {
  const src = read('api/_lib/portal-core.js');
  const b = src.slice(src.indexOf('const FN = {'));
  const body = b.slice(0, b.indexOf('\n};'));
  const names = new Set();
  for (const m of body.matchAll(/(?:^|[\s,{])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g)) names.add(m[1]);
  for (const m of body.matchAll(/(?:^|[\s,{])([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=[,\n}])/g)) names.add(m[1]);
  return [...names].filter(n => n && !['db', 'user', 'a', 'now'].includes(n)).sort();
})();

const callFns = (() => {
  const src = read('api/_lib/call-core.js');
  const b = src.slice(src.indexOf('const HANDLERS = {'));
  return [...b.slice(0, b.indexOf('\n};')).matchAll(/(api_[A-Za-z]+)\s*:/g)].map(m => m[1]);
})();

/* ---------- the phone's tabs and its performance bar ---------- */
const phoneTabs = [...CALL.matchAll(/data-v="([a-z]+)"[^>]*>([^<]+)</g)].map(m => `${m[2].trim()} (${m[1]})`);
/* The bar is written as <span>Col leo <b id="dsCol">-</b></span>, so the label is the text
   BEFORE the value, and the id is what the code fills in. Taking both means the pack names the
   figures the way the officers see them AND the way the code refers to them. */
const barLabels = [...CALL.matchAll(/<span>([^<]{2,20}?)\s*<b id="ds(\w+)"/g)]
  .map(m => `${m[1].trim()} (${m[2].toLowerCase()})`);

/* ---------- reports it accepts ---------- */
const uploadTypes = [...UPLOAD.matchAll(/<option value="([a-z-]+)">([^<]+)</g)]
  .map(m => ({ key: m[1], label: m[2] }))
  .filter(o => !['unassigned', 'assigned', 'unassessed', 'assessed', 'pending_approval',
                 'approved', 'pending_disb', 'disbursed'].includes(o.key));
const loanStages = [...UPLOAD.matchAll(/<option value="(unassigned|assigned|unassessed|assessed|pending_approval|approved|pending_disb|disbursed)">([^<]+)</g)]
  .map(m => `${m[2]} (${m[1]})`);

/* ---------- settings it obeys ----------
   Not every setting is read through settingGet: some are pulled from a map that was fetched in
   one go, some are named in a default. Matching the NAME SHAPE instead of the call catches all
   of them -- a settings key here is always SHOUTED_WITH_UNDERSCORES and at least two words, and
   nothing else in this code looks like that. A missing setting on this list would send the
   reviewer hunting for a knob that already exists. */
const LIB = fs.readdirSync(path.join(ROOT, 'api/_lib'))
  .filter(f => f.endsWith('.js')).map(f => read('api/_lib/' + f)).join('\n');
const settings = [...new Set([...LIB.matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g)].map(m => m[1]))]
  // Weed out the handful of shouted strings that are values in the data, not settings.
  .filter(k => !/^(DEVICE_NOT|NOT_FOUND|NO_REF|NO_CODE|BAD_CODE|VERIFY_FAILED|WRONG_REF|ANA_|AME|HAJA|HAPA|REJESHO|OTHERS|PGRST)/.test(k))
  .sort();

/* ---------- tables it stores things in ---------- */
const tablesList = [...read('db/schema.sql').matchAll(/create table if not exists (\w+)/g)].map(m => m[1]).sort();

/* ---------- assemble ---------- */
const L = [];
const p = s => L.push(s);

p('# HOPE PMO v2 — review pack for the v1 team');
p('');
p('**What this is.** A complete inventory of what the new system currently has: every screen,');
p('every column on it, every figure it can produce, every report it accepts, every setting it');
p('obeys. It is generated straight from the running code, so it cannot drift from reality the');
p('way a hand-written summary does.');
p('');
p('**What we are asking for.** You know the old system. Read this and tell us what is missing');
p('or wrong. The questions are at the end.');
p('');
p(`*Generated ${new Date().toISOString().slice(0, 10)} from the live source.*`);
p('');
p('---');
p('');
p('## 1. The portal — every tab, its cards and its columns');
p('');
p(`${tabs.length} tabs, in the order they appear down the left-hand side.`);
p('');
for (const t of tabs) {
  const k = kpisFor(t.id), c = columnsFor(t.id);
  p(`### ${t.label}  \`${t.id}\``);
  p('');
  p(k.length ? `**Cards at the top:** ${k.join(' · ')}` : '**Cards at the top:** none');
  p('');
  p(c.length ? `**Columns in the table:** ${c.join(' · ')}` : '**Columns in the table:** none — this tab is boards and forms, not a list');
  p('');
}
p('---');
p('');
p('## 2. The phone app (HOPE Calls)');
p('');
p(`**Tabs:** ${phoneTabs.join(' · ') || '(see public/call.html)'}`);
p('');
p(`**The performance bar across the top:** ${barLabels.join(' · ') || '(see public/call.html)'}`);
p('');
p('Each customer row carries: name, phone, guarantor name and phone, arrears, rejesho, D.S,');
p('status, and a tick once that number has genuinely been spoken to today (a call over 5');
p('seconds, in or out).');
p('');
p('---');
p('');
p('## 3. The customer screen (Mkopo Wangu) and the wall display (HOPE Live)');
p('');
p('**Mkopo Wangu** — a customer types a reference number and sees: their name, what they owe');
p('today or how far behind they are, balance, installment, paid today, arrears, a promise they');
p('already gave an officer, and every payment they have made with receipt numbers.');
p('It deliberately never shows a phone number or guarantor details.');
p('');
p('**HOPE Live** — a screen left on a monitor or a phone home screen, refreshing itself: the');
p('same six figures as the phone bar, and nothing else. No customer data at all.');
p('');
p('---');
p('');
p('## 4. Everything the system can be asked for');
p('');
p(`**Portal (${portalFns.length}):**`);
p('');
p('```');
p(portalFns.join('  '));
p('```');
p('');
p(`**Phone and public screens (${callFns.length}):**`);
p('');
p('```');
p(callFns.join('  '));
p('```');
p('');
p('---');
p('');
p('## 5. Reports it accepts');
p('');
for (const u of uploadTypes) p(`- **${u.label}** \`${u.key}\``);
p('');
p(`**Loan pipeline stages:** ${loanStages.join(' · ')}`);
p('');
p('---');
p('');
p('## 6. Settings it obeys');
p('');
p('```');
p(settings.join('\n'));
p('```');
p('');
p('---');
p('');
p('## 7. Where everything is stored');
p('');
p(`${tablesList.length} tables:`);
p('');
p('```');
p(tablesList.join('  '));
p('```');
p('');
p('---');
p('');
p('## 8. What we would like you to tell us');
p('');
p('Please go through these in order. Be specific — a tab name and a column name is worth more');
p('than "the reports need work".');
p('');
p('1. **Missing columns.** For each tab in section 1, is there a column the old sheet showed');
p('   that is not listed? Name the tab and the column heading as it appeared in v1.');
p('');
p('2. **Missing tabs or screens.** Is there a sheet, view or report in v1 that has no equivalent');
p('   in section 1 at all?');
p('');
p('3. **Figures that are computed differently.** Where v1 and v2 both show a number with the');
p('   same name — collection %, recovery %, sales, commission, PAR, arrears — is the v2');
p('   definition in the handoff the same as v1\'s? Where they differ, which is right, and why?');
p('');
p('4. **Layout and order.** Where a tab exists but reads wrong: wrong column order, missing');
p('   totals row, missing subtotal, a grouping that has been lost, a sort that has changed.');
p('');
p('5. **Actions that are gone.** Buttons, exports, printouts, emails or approvals that v1 had');
p('   and section 4 does not appear to cover.');
p('');
p('6. **Uploads.** Does section 5 cover every file the operation actually loads? Any report');
p('   still being kept in a spreadsheet because the system will not take it?');
p('');
p('7. **Rules that live in people\'s heads.** Anything v1 did that nobody wrote down —');
p('   a weekday that behaves differently, a rounding rule, a cut-off time, an exception for one');
p('   team or one product.');
p('');
p('The full handoff — what every word means, how every figure is derived, and every rule the');
p('system follows — is in `docs/HANDOFF.md`, sent alongside this. Read section 1 of this pack');
p('with Part 4 of that one open; between them they say exactly what v2 believes.');
p('');

const outPath = path.join(ROOT, 'docs/V1-REVIEW-PACK.md');
fs.writeFileSync(outPath, L.join('\n'));
console.log('Wrote docs/V1-REVIEW-PACK.md');
console.log(`  ${tabs.length} portal tabs, ${portalFns.length} portal functions, ${callFns.length} phone functions`);
console.log(`  ${uploadTypes.length} report types, ${settings.length} settings, ${tablesList.length} tables`);
console.log(`  ${L.join('\n').length.toLocaleString()} characters`);
