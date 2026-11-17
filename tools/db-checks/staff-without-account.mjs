/* STAFF WITHOUT A BANK ACCOUNT NUMBER: ZONE, TEAM, STAFF NAME -- db/RUN-ME-069, run for real on a PostgreSQL.

     "I also need a list of all staff without bank account numbers / 3 columns - by zone (1st and primary), team, staff name /
      So that I send it and demand them in Whatsapp group / Include even those with no zone" -- the owner, 17 Nov 2026

   db/RUN-ME-069-staff-without-bank-account-read-only.sql is a read-only list the owner will SEND to a WhatsApp group and demand answers of, so a name on it that should not be there (a
   staff who has an account, one who left) or one missing from it (a placeholder in the ACCOUNTS cell, a staff with no zone) is somebody wrongly demanded or never asked. It is not believed
   on a reading.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, so staff_registry has the columns and types the live book's table has (account, zone, role and status are
   text; the registry keeps no team column: the team is what follows the role, "Field Officer - CHAMWINO"). The fixture knows the truth: accounts of every kind (real digits with leading
   zeros, letters and digits, digits with spaces and dashes, a short account, empty, blank, N/A, NONE, ON PROCESS, a dash, HAINA, only zeros, only letters), zones (filed, in lower case, with
   runs of blanks, none at all, empty, blank, a department, two zones whose order depends on whether the database sorts spaces), roles with a team, with two dashes, with none, with a dash and
   no team, written in lower case, with extra blanks, statuses (Active, Inactive, inactive, with blanks), names with extra blanks, in lower case, with a tab, and the same staff twice.

   It passes only when: the file prints EXACTLY the rows a MODEL written again in JavaScript says, in the order it says, in TWO databases (one that sorts like C and one whose default order
   IGNORES spaces and punctuation, as the live book's en_US order does: the explicit collation is what keeps the list the same in both); the other switch (inactive staff included) does
   the same; the table is byte-identical afterwards; an empty registry and a registry where everybody has an account give no row and no error; a registry of a hundred times the live one answers in
   a fraction of a second; and EVERY ONE of a list of deliberate breaks of the file changes the list.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/staff-without-account.mjs

   It makes, uses and drops its own scratch databases. NEVER point it at the live book. Exit code 0 = the file lists what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-069-staff-without-bank-account-read-only.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const SEP = '\x1f', DBC = 'hope_sw_c', DBI = 'hope_sw_icu';
const psql = (sql, db) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-d', db, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { const err = new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); err.psql = String(e.stderr || ''); throw err; }
};
let seed = 20261117;                                               // mulberry32
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const fmt = n => n.toLocaleString('en-US');

const admin = process.env.PGDATABASE || 'postgres';
const drop = db => { try { psql('drop database if exists ' + db, admin); } catch { /* none */ } };
drop(DBC); drop(DBI);
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };
let exitCode = 1;
try {
  psql(`create database ${DBC} template template0 encoding 'UTF8'`, admin);                                                             // sorts like C (this machine has no en_US)
  psql(`create database ${DBI} template template0 encoding 'UTF8' locale_provider icu icu_locale 'en-u-ka-shifted'`, admin);            // its default order ignores spaces and punctuation, as en_US does
  for (const db of [DBC, DBI]) psql(SCHEMA, db);
  check('the second database really sorts another way by default (so the explicit collation is tested, not assumed)',
    psql(`select string_agg(x, '|' order by x) from (values ('LAKE ZONE'), ('LAKEVIEW'), ('HQ - PMO'), ('HQ-CREDIT')) t(x)`, DBI).trim() === 'HQ-CREDIT|HQ - PMO|LAKEVIEW|LAKE ZONE'
    && psql(`select string_agg(x, '|' order by x) from (values ('LAKE ZONE'), ('LAKEVIEW'), ('HQ - PMO'), ('HQ-CREDIT')) t(x)`, DBC).trim() === 'HQ - PMO|HQ-CREDIT|LAKE ZONE|LAKEVIEW');

  // ---- the registry --------------------------------------------------------------------------------------------------------------------------
  const FIRST = ['AMINA', 'JUMA', 'NEEMA', 'HASSAN', 'ZAINAB', 'OMARI', 'FATUMA', 'BAKARI', 'SALMA', 'RAJABU', 'MWAJUMA', 'ISSA'];
  const MID = ['ALLY', 'SAID', 'MOHAMED', 'JOSEPH', 'HAMISI', 'KHAMIS', 'MUSSA', 'PETER'];
  const LAST = ['MKWAWA', 'KIMARO', 'MSUYA', 'SWAI', 'MREMA', 'KOMBA', 'LEMA', 'MOSHI', 'NYERERE', 'MBWANA'];
  const ZONES = ['LAKE ZONE', 'LAKEVIEW', 'NORTH WEST', 'SOUTH WEST', 'DAR CENTER', 'HQ - PMO', 'HQ-CREDIT', 'MANAGEMENT', 'MORO-DOM', 'lake zone', ' LAKE   ZONE ', null, '', '   ', 'NORTH WEST', 'SOUTH WEST', 'DAR CENTER', 'LAKE ZONE', 'MORO-DOM', 'LAKE\tZONE'];
  const ROLES = ['Field Officer - CHAMWINO', 'Manager - Team Lindi', 'Bike Recovery - Team Chamwino', 'Area Manager - KIHONDA AREA - MORO', 'PMO RECOVERY', 'LEGAL', null, 'Field Officer -', 'Field Officer - ',
    'Manager-HIMO', 'Field Officer  -  buzwagi a', 'Field Officer - BUZWAGI A', 'Field Officer - Team Lindi', 'Field Officer - CHAMWINO', 'Manager - HIMO', 'Field Officer - KIHONDA', 'Field Officer - 12'];
  const STATUS = ['Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Inactive', 'Inactive', 'inactive', ' INACTIVE ', 'Active ', 'INACTIVE'];
  const GOOD = ['0152826626000', '307100703440', '0111222333', '20100456789', '01J2085503700', 'AB1234567890', 'ABC00012345', '307 100 70344', '0152-826-626-00', '123', '45', '12345678'];            // an account is given: digits in it
  const BAD = [null, null, null, null, '', '   ', 'N/A', 'NONE', 'ON PROCESS', '-', 'HAINA', 'nil', '0', '0000000000', '000 000', '00-00', 'pending', '.', 'ABCDEFG', '  n/a  '];             // no digit, or only zeros
  const rows = [];
  const nameOf = i => {
    const base = `${FIRST[i % FIRST.length]} ${MID[(i * 7) % MID.length]} ${LAST[(i * 3) % LAST.length]}`;
    return [base, base, base, base.toLowerCase(), base.replace(/ /g, '   '), '  ' + base + ' ', base.replace(' ', '\t'), base, base, base][(i * 7) % 10];
  };
  for (let i = 0; i < 700; i++) {
    const id = 'T' + String(i + 1).padStart(7, '0');
    const account = (i % 3 === 0) ? pick(GOOD) : pick(BAD);
    rows.push({ id, name: nameOf(i) + (i % 29 === 0 ? ' ' + id : ''), role: ROLES[(i * 11 + (i >> 5)) % ROLES.length], zone: ZONES[(i * 7 + (i >> 4)) % ZONES.length], account, status: STATUS[(i * 13 + (i >> 3)) % STATUS.length] });
  }
  for (let k = 0; k < 3; k++) { const src = rows.find(r => r.account == null && r.status === 'Active' && r.zone === 'LAKE ZONE'); rows.push({ ...src, id: 'D' + String(k + 1).padStart(7, '0'), name: src.name }); }     // the same staff filed twice: both are listed
  const q = v => (v === null ? '' : '"' + String(v).replace(/"/g, '""') + '"');
  const COPY = `copy public.staff_registry (id, name, role, zone, account, status) from stdin with (format csv, null '');\n` + rows.map(r => [r.id, q(r.name), q(r.role), q(r.zone), q(r.account), q(r.status)].join(',')).join('\n') + '\n\\.\n';
  for (const db of [DBC, DBI]) psql(COPY + 'analyze public.staff_registry;', db);

  // ---- the MODEL: the rule written again ---------------------------------------------------------------------------------------------------------
  const collapse = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const upper = s => s.toUpperCase();
  const teamOf = role => { const m = /\s+-\s+([\s\S]*)$/.exec(role == null ? '' : role); return m ? m[1] : ''; };
  for (const r of rows) {
    r.zone0 = upper(collapse(r.zone)); r.team0 = upper(collapse(teamOf(r.role))); r.name0 = upper(collapse(r.name));
    r.active = upper(String(r.status).replace(/^ +| +$/g, '')) !== 'INACTIVE';
    r.missing = /^0*$/.test(String(r.account == null ? '' : r.account).replace(/\D/g, ''));
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const expectRows = (activeOnly) => rows.filter(r => r.missing && (!activeOnly || r.active))
    .sort((a, b) => cmp(a.zone0 === '', b.zone0 === '') || cmp(a.zone0, b.zone0) || cmp(a.team0 === '', b.team0 === '') || cmp(a.team0, b.team0) || cmp(a.name0, b.name0))
    .map(r => [r.zone0 === '' ? 'NO ZONE' : r.zone0, r.team0 === '' ? '-' : r.team0, r.name0].join(SEP));
  const run = (file, db) => { const out = psql('begin;\n' + file + '\ncommit;\n', db).trim(); return out === '' ? [] : out.split('\n'); };
  const dump = db => psql(`select md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.staff_registry t;`, db).trim();
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return 'row ' + i + ': got ' + JSON.stringify(a[i]) + ' want ' + JSON.stringify(b[i]); return ''; };

  // 1. the list, in both databases, both switches
  const wantA = expectRows(true), wantAll = expectRows(false);
  const before = [dump(DBC), dump(DBI)];
  const gotC = run(FILE, DBC), gotI = run(FILE, DBI);
  check('the list is EXACTLY the model\'s (' + wantA.length + ' of ' + rows.length + ' staff, in order) in the database that sorts like C', same(gotC, wantA), firstDiff(gotC, wantA));
  check('and the SAME list, row for row, in the database whose default order ignores spaces and punctuation (the explicit collation holds the order)', same(gotI, wantA), firstDiff(gotI, wantA));
  const allFile = FILE.replace('select true as active_only', 'select false as active_only');
  const gotAllC = run(allFile, DBC), gotAllI = run(allFile, DBI);
  check('with the one switch changed to false the list also holds the staff switched to Inactive (' + wantAll.length + ' rows), exactly the model\'s, in both databases', same(gotAllC, wantAll) && same(gotAllI, wantAll) && wantAll.length > wantA.length, firstDiff(gotAllC, wantAll));
  check('the registry is byte-identical afterwards: nothing was written', dump(DBC) === before[0] && dump(DBI) === before[1]);
  check('three columns and no header of its own: every row has exactly ZONE, TEAM and STAFF NAME', gotC.every(l => l.split(SEP).length === 3)
    && psql(FILE.replace(/^set local[^\n]*\n/gm, '').replace('\nselect ', '\nselect ').replace(/order by[\s\S]*;\s*$/, 'limit 0;'), DBC) === '');
  // 2. the fixture holds every kind of row a break needs, counted
  const L = rows.filter(r => r.missing && r.active);
  const n = f => L.filter(f).length;
  check('the fixture holds every kind of row a break needs: ' + L.length + ' listed (no zone ' + n(r => r.zone0 === '') + ', no team ' + n(r => r.team0 === '') + ', two-dash role ' + n(r => /KIHONDA AREA - MORO/.test(r.team0)) + ', lower-case team ' + n(r => /BUZWAGI A/.test(r.team0)) + ', name with extra blanks ' + n(r => /\s{2,}|^\s|\s$|\t/.test(r.name)) + ', lower-case name ' + n(r => r.name !== r.name.toUpperCase()) + ', a placeholder ' + n(r => r.account != null && r.account.trim() !== '') + ', null account ' + n(r => r.account == null) + '), ' + (wantAll.length - wantA.length) + ' Inactive left out, ' + rows.filter(r => !r.missing).length + ' with an account',
    n(r => r.zone0 === '') >= 10 && n(r => r.team0 === '') >= 20 && n(r => /KIHONDA AREA - MORO/.test(r.team0)) >= 3 && n(r => /BUZWAGI A/.test(r.team0) && /buzwagi/.test(rows.find(x => x.id === r.id).role)) >= 1
      && n(r => /\s{2,}|^\s|\s$|\t/.test(r.name)) >= 10 && n(r => r.name !== r.name.toUpperCase()) >= 5 && n(r => r.account != null && r.account.trim() !== '') >= 40 && n(r => r.account == null) >= 20
      && (wantAll.length - wantA.length) >= 10 && rows.filter(r => r.missing && !r.active && /^inactive$|^ INACTIVE $/.test(r.status)).length >= 3
      && rows.filter(r => !r.missing && r.account && /^\d{1,5}$/.test(r.account)).length >= 5 && rows.filter(r => !r.missing && /[A-Z]/.test(String(r.account))).length >= 5 && n(r => /^LAKE(VIEW| ZONE)$/.test(r.zone0)) >= 5
      && L.filter(r => r.zone0 === 'HQ - PMO').length >= 3 && L.filter(r => r.zone0 === 'HQ-CREDIT').length >= 3
      && new Set(L.filter(r => r.name0 === rows.find(x => x.id === 'D0000001').name0 && r.zone0 === 'LAKE ZONE').map(r => r.id)).size >= 2);
  // 3. an empty registry, and one where everybody has an account
  psql('begin;\ndelete from public.staff_registry;\ncommit;', DBC);
  check('an empty registry gives no row and no error', same(run(FILE, DBC), []));
  psql(`insert into public.staff_registry (id, name, account, zone, role) values ('X1', 'A B', '0152826626000', 'LAKE ZONE', 'Field Officer - A'), ('X2', 'C D', 'AB123', null, null);`, DBC);
  check('a registry where everybody has an account gives no row', same(run(FILE, DBC), []));
  // 4. a registry of a hundred times the live one, in the database that sorts the way the live one does
  psql(`insert into public.staff_registry (id, name, role, zone, account, status)
        select 'B' || g, 'STAFF ' || lpad((g * 7919 % 100003)::text, 6, '0'), 'Field Officer - TEAM ' || (g % 400), 'ZONE ' || (g % 40), case when g % 3 = 0 then null else '01528266' || g end, case when g % 20 = 0 then 'Inactive' else 'Active' end
        from generate_series(1, 100000) g;
        analyze public.staff_registry;`, DBI);
  const t0 = Date.now(); const big = run(FILE, DBI); const secs = (Date.now() - t0) / 1000;
  check('a registry of 100,000 staff (a hundred times the live one) answers in ' + secs.toFixed(2) + ' s (' + fmt(big.length) + ' rows), under the 30-second ceiling', big.length > 25000 && secs < 10);

  // ---- broken on purpose: each break must change the list (in the database that sorts the way the live one does) ------------------------------------------------
  for (const db of [DBC, DBI]) { psql('begin;\ndelete from public.staff_registry;\ncommit;', db); psql(COPY + 'analyze public.staff_registry;', db); }
  const baseI = run(FILE, DBI);
  const sub = (src, re, to, what) => { const k = (src.match(new RegExp(re.source, 'g')) || []).length; if (k !== 1) throw new Error('the file has ' + k + ' of "' + what + '", the check needs exactly one'); return src.replace(re, () => to); };
  const rep = (re, to) => src => sub(src, re, to, String(re));
  const ACC = /and regexp_replace\(coalesce\(r\.account, ''\), '\\D', '', 'g'\) ~ '\^0\*\$'/;
  const breaks = [
    ['an account is missing only when it is null',                                       rep(ACC, 'and r.account is null')],
    ['an account is missing only when it is empty or blank',                             rep(ACC, "and btrim(coalesce(r.account, '')) = ''")],
    ['an account of only zeros counts as given',                                         rep(/~ '\^0\*\$'/, "~ '^$'")],
    ['a letter counts like a digit (N/A and NONE count as given)',                       rep(/'\\D', '', 'g'\) ~/, "'[^0-9A-Za-z]', '', 'g') ~")],
    ['an account of five digits or fewer is missing',                                    rep(/~ '\^0\*\$'/, "~ '^\\d{0,5}$'")],
    ['a null account is not listed (the null is not turned into a blank)',               rep(/regexp_replace\(coalesce\(r\.account, ''\), '\\D', '', 'g'\)/, "regexp_replace(r.account, '\\D', '', 'g')")],
    ['the Inactive are listed too',                                                      rep(/where \(not cfg\.active_only or upper\(btrim\(coalesce\(r\.status, ''\)\)\) <> 'INACTIVE'\)/, 'where true')],
    ['only the Inactive are listed',                                                     rep(/<> 'INACTIVE'\)/, "= 'INACTIVE')")],
    ['the status is read in the spelling the app writes (Inactive), not whatever it holds', rep(/upper\(btrim\(coalesce\(r\.status, ''\)\)\) <> 'INACTIVE'/, "r.status <> 'Inactive'")],
    ['the switch starts at false',                                                       rep(/select true as active_only/, 'select false as active_only')],
    ['a staff with no zone is left out',                                                 rep(/\nfrom s\norder by/, '\nfrom s where s.zone0 <> \'\'\norder by')],
    ['no-zone staff come first, not last',                                               rep(/order by \(s\.zone0 = ''\), /, 'order by ')],
    ['no-team staff come first within a zone, not last',                                 rep(/s\.zone0 collate "C", \(s\.team0 = ''\), /, 's.zone0 collate "C", ')],
    ['the list is sorted by team before zone',                                           rep(/order by \(s\.zone0 = ''\), s\.zone0 collate "C", \(s\.team0 = ''\), s\.team0 collate "C", s\.name0 collate "C"/, 'order by (s.team0 = \'\'), s.team0 collate "C", (s.zone0 = \'\'), s.zone0 collate "C", s.name0 collate "C"')],
    ['the zone is sorted by the database\'s own order, not C',                           rep(/s\.zone0 collate "C", /, 's.zone0, ')],
    ['the team is taken after the LAST dash of the role',                                rep(/substring\(r\.role from '\\s\+-\\s\+\(\.\*\)\$'\)/, "substring(r.role from '.*\\s+-\\s+(.*)$')")],
    ['the team is the role words before the dash',                                       rep(/substring\(r\.role from '\\s\+-\\s\+\(\.\*\)\$'\)/, "regexp_replace(r.role, '\\s+-\\s+.*$', '')")],
    ['the team is not put in capitals',                                                  rep(/upper\(btrim\(regexp_replace\(coalesce\(substring\(r\.role from '\\s\+-\\s\+\(\.\*\)\$'\), ''\), '\\s\+', ' ', 'g'\)\)\) as team0/, "btrim(regexp_replace(coalesce(substring(r.role from '\\s+-\\s+(.*)$'), ''), '\\s+', ' ', 'g')) as team0")],
    ['a name keeps its runs of blanks and its case',                                     rep(/upper\(btrim\(regexp_replace\(r\.name, '\\s\+', ' ', 'g'\)\)\) as name0/, 'r.name as name0')],
    ['a zone keeps its runs of blanks and its case',                                     rep(/upper\(btrim\(regexp_replace\(coalesce\(r\.zone, ''\), '\\s\+', ' ', 'g'\)\)\) as zone0/, "coalesce(r.zone, '') as zone0")],
    ['a staff with no team shows nothing, not a dash',                                   rep(/coalesce\(nullif\(s\.team0, ''\), '-'\) as "TEAM"/, 's.team0 as "TEAM"')],
    ['a staff with no zone shows nothing, not "NO ZONE"',                                rep(/coalesce\(nullif\(s\.zone0, ''\), 'NO ZONE'\) as "ZONE"/, 's.zone0 as "ZONE"')],
    ['the same staff filed twice is listed once',                                        rep(/\nfrom s\norder by/, '\nfrom (select distinct * from s) s\norder by')],
    ['the account is printed too',                                                       rep(/s\.name0 as "STAFF NAME"\nfrom s/, 's.name0 as "STAFF NAME", s.name0 as "ACCOUNT"\nfrom s')],
  ];
  let notCaught = 0;
  for (const [name, fn] of breaks) {
    let broken = null, why = '', ok = false;
    try { broken = fn(FILE); } catch (err) { why = err.message; }
    if (broken !== null) {
      try {
        const got = run(broken, DBI);
        ok = !same(got, baseI);
        if (!ok) why = 'the list is the same as the file\'s';
      } catch (err) { why = 'the broken file does not run: ' + err.message.slice(0, 200); }
    }
    if (!ok) notCaught++;
    check('BROKEN ON PURPOSE, the list changes: ' + name, ok, why);
  }
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all passed') + ' (' + breaks.length + ' breaks, ' + (breaks.length - notCaught) + ' caught)');
  exitCode = fails.length ? 1 : 0;
} finally {
  drop(DBC); drop(DBI);
}
process.exit(exitCode);
