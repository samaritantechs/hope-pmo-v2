/* THE HANDOFF AS A PARCEL, not a document.
 *
 *     node tools/make-handoff.mjs
 *
 * docs/HANDOFF.md explains the system. This builds the thing you can actually send somebody:
 * one folder, one zip, containing the explanation AND the database AND every line of code that
 * makes it run -- arranged so a stranger can work out what to open first.
 *
 * WHAT IS DELIBERATELY NOT IN IT
 *
 *   android/sideload.keystore   The key that signs the Android app. Anybody holding it can
 *                               build an app that Android installs as an UPDATE over HOPE Calls
 *                               on any officer's phone. A handoff parcel gets forwarded, so it
 *                               must not carry the one file that would let a stranger take over
 *                               the field's handsets.
 *   .env, .env.local            The database password and service key.
 *   node_modules, build output  Rebuildable from package.json.
 *   .git                        The full history is on GitHub; the parcel is a snapshot.
 *
 * WHAT CANNOT BE IN IT
 *
 *   Your DATA. Customers, snapshots, comments and call logs live in Supabase, not in the
 *   repository, and this script has no database connection. 2-DATABASE/BACKUP-YOUR-DATA.md is
 *   the exact set of steps to take that copy yourself -- and it matters more than anything
 *   else here, because code can be rewritten and data cannot.
 */

import { mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = new Date().toISOString().slice(0, 10);
const NAME = `hope-pmo-v2-handoff-${STAMP}`;
const OUT = path.join(ROOT, 'handoff-build');
const DIR = path.join(OUT, NAME);

const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel', 'build', '.gradle', 'handoff-build']);
/* Named one by one rather than by pattern. A pattern that stops matching one day fails silently
   and ships the key; a list this short is checked by reading it. */
const SKIP_FILES = new Set(['sideload.keystore', '.env', '.env.local', 'local.properties', '.DS_Store']);

const manifest = [];

function copyTree(from, to, label) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue;
    const src = path.join(from, entry), dst = path.join(to, entry);
    if (statSync(src).isDirectory()) copyTree(src, dst, label);
    else { copyFileSync(src, dst); manifest.push([path.relative(DIR, dst), statSync(src).size, label]); }
  }
}
function put(rel, text, label) {
  const dst = path.join(DIR, rel);
  mkdirSync(path.dirname(dst), { recursive: true });
  writeFileSync(dst, text);
  manifest.push([rel, Buffer.byteLength(text), label]);
}
function take(from, rel, label) {
  if (!existsSync(path.join(ROOT, from))) return;
  const dst = path.join(DIR, rel);
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(path.join(ROOT, from), dst);
  manifest.push([rel, statSync(dst).size, label]);
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

/* ---------------------------------------------------------------- 1. the explanation */
take('docs/HANDOFF.md', '1-READ-ME-FIRST/HANDOFF.md', 'The whole system explained, for a non-programmer');
take('ARCHITECTURE.md', '1-READ-ME-FIRST/ARCHITECTURE.md', 'How the pieces fit together');
take('README.md', '1-READ-ME-FIRST/README.md', 'Setting the project up from scratch');
take('docs/V1-REVIEW-PACK.md', '1-READ-ME-FIRST/V1-REVIEW-PACK.md', 'The inventory to send the old system\'s team');
take('docs/why-no-cache.md', '1-READ-ME-FIRST/why-no-cache.md', 'Why pages are told not to cache');

/* ---------------------------------------------------------------- 2. the database */
const migFiles = readdirSync(path.join(ROOT, 'db/migrations')).filter(f => f.endsWith('.sql')).sort();
take('db/schema.sql', '2-DATABASE/schema.sql', 'Every table, from nothing');
take('db/seed.sql', '2-DATABASE/seed.sql', 'The starting rows (roles, settings)');
for (const f of migFiles) take(`db/migrations/${f}`, `2-DATABASE/migrations/${f}`, 'Migration');

/* ONE PASTE, IN ORDER. Running a folder of migrations by hand is where mistakes live -- one
   skipped, one run twice, one run before the file it depends on. Filename order IS run order
   (see the note inside the follow-up cleanup file, which is dated a day later precisely so it
   lands after the migration it must not be overwritten by). */
const full = [
  `-- HOPE PMO v2 -- THE WHOLE DATABASE, IN ONE FILE`,
  `-- Generated ${STAMP} by tools/make-handoff.mjs`,
  `--`,
  `-- Paste this into the Supabase SQL editor of an EMPTY project and press Run. It creates`,
  `-- every table, then applies every change made since, in the order they were made.`,
  `--`,
  `-- Safe to run against a database that already exists: every statement is written`,
  `-- "if not exists" or "create or replace", which is what has always made these runnable`,
  `-- late. It will not delete anything and it will not touch your data.`,
  `--`,
  `-- It does NOT contain your customers, snapshots, comments or call logs. Those are data,`,
  `-- they live in Supabase, and BACKUP-YOUR-DATA.md is how you take a copy of them.`,
  ``,
  `-- ============================================================ schema.sql`,
  readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'),
  ...migFiles.map(f => `\n-- ============================================================ ${f}\n`
    + readFileSync(path.join(ROOT, 'db/migrations', f), 'utf8')),
  `\n-- ============================================================ seed.sql`,
  readFileSync(path.join(ROOT, 'db/seed.sql'), 'utf8'),
].join('\n');
put('2-DATABASE/FULL-DATABASE.sql', full, 'Schema + every migration + seed, one paste, correct order');

put('2-DATABASE/RUN-ORDER.md', `# The database, in the order it goes in

## The short way

Open **FULL-DATABASE.sql**, paste the whole thing into the Supabase SQL editor, press Run.
That is the schema, every migration in order, and the starting rows.

It is safe to run against a database that already exists — every statement is written
\`if not exists\` or \`create or replace\`. It will not delete anything and it will not touch
your data. That is what has always made these runnable late.

## The long way, one file at a time

\`schema.sql\` first, then the migrations **in filename order**, then \`seed.sql\`.

${migFiles.map((f, i) => `${i + 1}. \`${f}\``).join('\n')}

**Filename order is run order, and it matters at least once.** Two of these define the same
counting function, and whichever runs last wins — which is why the follow-up cleanup is dated a
day later than the file it must land after. Run them out of order and nothing errors; a report
just quietly stops being counted.

## None of these break anything by being late

The application checks whether each one has been run and falls back to the slower path if not.
That is deliberate: a deploy must never be waiting on somebody remembering to open the SQL
editor. But the slower path is genuinely slower, so they are worth running.
`, 'Which SQL file to run, and in what order');

put('2-DATABASE/BACKUP-YOUR-DATA.md', `# Backing up your data — the part no parcel can contain

**This is the most important file here.** Everything else in this bundle can be rebuilt from
the repository. Your customers, snapshots, comments, call logs and access codes cannot. They
live in Supabase, not in the code, and no export of the code will ever include them.

## The one-click way

Supabase dashboard → your project → **Database** → **Backups**.

The paid tier takes a daily backup for you and keeps it. On the free tier there is no automatic
backup at all — which means that today, unless you have done the below, **one bad afternoon in
the SQL editor is the whole company's history.**

## The copy you keep yourself

Install PostgreSQL's tools (they come with the free PostgreSQL download; you do not need to run
a database, only its tools). Then, from Supabase → Project Settings → Database → Connection
string → **URI**:

\`\`\`
pg_dump "PASTE-YOUR-CONNECTION-STRING-HERE" --no-owner --no-privileges -F c -f hope-backup-YYYY-MM-DD.dump
\`\`\`

That one file is everything: structure and data. Keep it somewhere that is not the same laptop.

To read it back into an empty project:

\`\`\`
pg_restore -d "PASTE-THE-NEW-CONNECTION-STRING" --no-owner --no-privileges hope-backup-YYYY-MM-DD.dump
\`\`\`

## Just the tables you care most about, as spreadsheets

Supabase dashboard → **Table Editor** → pick a table → the **⋯** menu → **Export as CSV**.
Slower, and it loses the relationships between tables, but it needs nothing installed and
anybody can open the result.

The ones to take first, in this order: \`followup_comments\` (years of officers' notes, and the
only thing here that cannot be re-derived from a report), \`access_codes\`, \`teams\`,
\`call_users\`, \`settings\`, \`followup_status\`.

## Never put in a backup you share

The **service role key** and the **database password**. They are not in this bundle and must not
be added to it. A backup file is fine to hold customer data if it stays yours; a key is a way in
for anybody who ever sees it.
`, 'HOW TO BACK UP YOUR DATA — read this one');

/* ---------------------------------------------------------------- 3. the code */
for (const d of ['api', 'public', 'test', 'tools', 'migrate', 'db', 'android', '.github']) {
  copyTree(path.join(ROOT, d), path.join(DIR, '3-SOURCE-CODE', d), 'Source');
}
for (const f of ['package.json', 'package-lock.json', 'vercel.json', '.gitignore', 'README.md', 'ARCHITECTURE.md']) {
  take(f, `3-SOURCE-CODE/${f}`, 'Source');
}
copyTree(path.join(ROOT, 'docs'), path.join(DIR, '3-SOURCE-CODE/docs'), 'Source');

/* ---------------------------------------------------------------- 4. data files */
take('docs/hints-v2.tsv', '4-DATA-FILES/hints-v2.tsv', 'The rotating tips — upload as Hints');

/* ---------------------------------------------------------------- the front door */
const sizeOf = p => { try { return statSync(p).size; } catch { return 0; } };
const kb = n => (n / 1024).toFixed(0) + ' KB';

put('00-START-HERE.md', `# HOPE PMO v2 — the whole system, in one parcel

Generated ${STAMP}.

This is everything: the explanation, the database, and every line of code that makes it run.
It is a snapshot — the living version is the GitHub repository, and if the two ever disagree,
the repository is right.

## What to open, in order

| Folder | What is in it |
|---|---|
| **1-READ-ME-FIRST/** | \`HANDOFF.md\` is the system explained end to end for somebody who does not program. Start at its Part 15 — that is what is waiting on you. |
| **2-DATABASE/** | \`FULL-DATABASE.sql\` rebuilds the entire database from nothing in one paste. \`BACKUP-YOUR-DATA.md\` is how you take a copy of the data, and it is the most important file in this parcel. |
| **3-SOURCE-CODE/** | Every file that runs the system, arranged exactly as the repository is. |
| **4-DATA-FILES/** | The tips sheet, ready to upload. |

## The two things this parcel does not contain, and why

**Your data.** Customers, snapshots, comments, call logs — they live in Supabase, not in the
code, and nothing that exports the code will ever include them. **2-DATABASE/BACKUP-YOUR-DATA.md**
is the exact set of steps. Code can be rewritten; data cannot.

**Your secrets.** The database password and service key are in Vercel, not here. Also
deliberately left out: **the Android signing key** (\`android/sideload.keystore\`). Anybody
holding it can build an app that Android installs as an *update* over HOPE Calls on any
officer's phone. A parcel like this gets forwarded, so it does not travel with the key.

## If somebody has to pick this up cold

1. Read \`1-READ-ME-FIRST/HANDOFF.md\`, Parts 0 to 5. That is the business, the vocabulary, the
   tables and the screens.
2. Create an empty Supabase project. Paste \`2-DATABASE/FULL-DATABASE.sql\` into its SQL editor.
3. Follow \`3-SOURCE-CODE/README.md\` to run the code and point it at that project.
4. \`npm test\` proves the rules and the sums still hold — ${countTests()} of them.

## Where this came from

Repository: \`samaritantechs/hope-pmo-v2\`
Commit: \`${gitRev()}\`
Branch at the time: \`${gitBranch()}\`
`, 'Open this first');

function gitRev() { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { return 'unknown'; } }
function gitBranch() { try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { return 'unknown'; } }
function countTests() {
  try {
    let n = 0;
    for (const f of readdirSync(path.join(ROOT, 'test'))) {
      if (!f.endsWith('.test.mjs')) continue;
      n += (readFileSync(path.join(ROOT, 'test', f), 'utf8').match(/^test\(/gm) || []).length;
    }
    return n;
  } catch { return 'all'; }
}

manifest.sort((a, b) => a[0].localeCompare(b[0]));
const total = manifest.reduce((s, m) => s + m[1], 0);
put('MANIFEST.txt', `HOPE PMO v2 handoff — ${manifest.length + 1} files, ${kb(total)}\nGenerated ${STAMP} from commit ${gitRev()}\n\n`
  + `NOT INCLUDED, DELIBERATELY:\n`
  + `  android/sideload.keystore   the Android signing key -- see 00-START-HERE.md\n`
  + `  .env / .env.local           the database password and service key\n`
  + `  node_modules, build output  rebuildable from package.json\n`
  + `  your DATA                   it is in Supabase -- see 2-DATABASE/BACKUP-YOUR-DATA.md\n\n`
  + manifest.map(([p, sz]) => `${String(Math.ceil(sz / 1024)).padStart(6)} KB  ${p}`).join('\n') + '\n',
  'What is in the parcel');

/* ---------------------------------------------------------------- zip it */
let zipPath = '';
try {
  zipPath = path.join(OUT, `${NAME}.zip`);
  rmSync(zipPath, { force: true });
  execFileSync('zip', ['-q', '-r', zipPath, NAME], { cwd: OUT });
} catch (e) {
  zipPath = '';
  console.log('(zip not available — the folder is still there and can be compressed by hand)');
}

/* THE CHECK THAT MATTERS. A parcel that quietly carries the signing key is worse than no
   parcel, so this looks in the finished article rather than trusting the skip list above. */
const leaked = [];
(function scan(d) {
  for (const e of readdirSync(d)) {
    const p = path.join(d, e);
    if (statSync(p).isDirectory()) scan(p);
    else if (SKIP_FILES.has(e) || /\.keystore$|\.jks$|^\.env/.test(e)) leaked.push(path.relative(DIR, p));
  }
})(DIR);
if (leaked.length) {
  console.error('\nSTOPPED: the parcel contains files that must never be shared:\n  ' + leaked.join('\n  '));
  process.exit(1);
}

console.log(`\n${NAME}`);
console.log(`  ${manifest.length + 1} files, ${kb(total)}`);
console.log(`  folder: ${DIR}`);
if (zipPath) console.log(`  zip:    ${zipPath}  (${kb(sizeOf(zipPath))})`);
console.log(`\nChecked: no signing key, no .env, no build output.`);
