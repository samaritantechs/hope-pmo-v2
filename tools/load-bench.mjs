/* WHY IS THE SYSTEM HEAVY? Counts the round trips and rows behind each screen.

       node tools/load-bench.mjs

   Builds a real-sized operation in memory -- 30,000 customers, a snapshot a day, a year of
   payments and call logs -- and then opens each screen, counting every request that would go
   to Supabase and every row that would come back.

   Round trips are what matter. Each one is a separate HTTPS call from Vercel to Supabase and
   back, 100-300ms on a good day. Thirty of them is nine seconds before a single figure is
   worked out, and no amount of clever JavaScript afterwards makes that up.

   No database and no network: it runs against the same in-memory fake the tests use, so the
   numbers are about SHAPE -- how many asks, how many rows -- not about hardware. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL ||= 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'y';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { fakeDb } = await import(path.join(ROOT, 'test/fake-db.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const { PAGE_SIZE } = await import(path.join(ROOT, 'api/_lib/supabase.js'));

const CUSTOMERS = Number(process.env.CUSTOMERS || 30000);
const DAYS = Number(process.env.DAYS || 20);
const NOW = Date.parse('2026-08-02T09:00:00Z');
const TODAY = '2026-08-02';
const TEAMS = Array.from({ length: 40 }, (_, i) => 'TEAM' + String(i + 1).padStart(2, '0'));
const day = i => new Date(Date.parse(TODAY) - i * 86400000).toISOString().slice(0, 10);

console.log(`Building ${CUSTOMERS.toLocaleString()} customers over ${DAYS} days…`);
const t = { teams: TEAMS.map(x => ({ team: x })), settings: [], access_codes: [],
  repayment_snapshots: [], defaulter_snapshots: [], followup_status: [], followup_comments: [],
  loans: [], received_payments: [], call_logs: [], complaints: [], restructures: [],
  demand_notices: [], abnormal_payments: [], call_users: [], roles: [], call_agents: [] };

for (let d = 0; d < DAYS; d++) {
  const date = day(d);
  for (let i = 0; i < CUSTOMERS; i++) {
    const team = TEAMS[i % TEAMS.length];
    t.repayment_snapshots.push({ id: `e${d}-${i}`, ref: 'R' + i, full_name: 'CUSTOMER ' + i,
      contact: '07120' + String(i).padStart(5, '0'), team, payment_expected: 5000,
      todays_payment: d % 2 ? 5000 : 0, todays_status: d % 2 ? 'PAID' : 'UNPAID', arrears: 0,
      initial_inst: 5000, other_inst: 5000, balance: 60000, due_summary: '2/6',
      snapshot_type: 'today', snapshot_date: date, upload_batch: 'b' + d, created_at: date + 'T04:00:00Z' });
  }
  // The defaulter deck is smaller: roughly a fifth of the book, initial + current.
  for (let i = 0; i < CUSTOMERS / 5; i++) {
    const team = TEAMS[i % TEAMS.length];
    for (const type of ['initial', 'current']) {
      t.defaulter_snapshots.push({ id: `d${d}-${i}-${type}`, ref: 'R' + i, full_name: 'CUSTOMER ' + i,
        team, arrears: 4000, status: 'Defaulter', ds: '3-6', dc: 3, weekday: 'SUN',
        disb_date: '2026-05-01', other_inst: 5000,
        snapshot_type: type, snapshot_date: date, upload_batch: `b${d}${type}`, created_at: date + 'T04:00:00Z' });
    }
  }
}
for (let i = 0; i < CUSTOMERS / 5; i++) {
  t.followup_status.push({ ref: 'R' + i, team: TEAMS[i % TEAMS.length], full_name: 'CUSTOMER ' + i,
    contact: '07120' + String(i).padStart(5, '0'), arrears: 4000, status: 'Defaulter',
    fu_status: 'AMETOA AHADI', ds: '3-6', dc: 3, last_trans: day(3) });
}
for (let i = 0; i < CUSTOMERS * 2; i++) {
  t.followup_comments.push({ id: 'c' + i, ref: 'R' + (i % (CUSTOMERS / 5)),
    team: TEAMS[i % TEAMS.length], comment: 'x', created_at: day(i % DAYS) + 'T08:00:00Z' });
}
for (let i = 0; i < CUSTOMERS; i++) {
  t.loans.push({ id: 'l' + i, team: TEAMS[i % TEAMS.length], stage: 'approved',
    principal_amt: 300000, requested_amt: 350000, approved_date: day(i % DAYS), full_name: 'CUSTOMER ' + i });
  t.received_payments.push({ id: 'p' + i, ref_no: 'R' + i, team: TEAMS[i % TEAMS.length],
    amount_paid: 5000, paid_at: day(i % DAYS) });
}
const TOTAL = Object.values(t).reduce((s, a) => s + a.length, 0);
console.log(`  ${TOTAL.toLocaleString()} rows in memory\n`);

/* Wrap the fake so every .range() page is counted the way fetchAll actually issues them. */
function counting(tables) {
  const db = fakeDb(tables);
  let trips = 0, rows = 0;
  const wrap = q => new Proxy(q, { get(o, p) {
    if (p === 'then') return (res, rej) => o.then(r => {
      trips++; if (Array.isArray(r.data)) rows += r.data.length; return res(r);
    }, rej);
    const v = o[p];
    return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? wrap(o) : out; } : v;
  } });
  return { db: { from: n => wrap(db.from(n)), rpc: async (n, a) => { trips++; return db.rpc(n, a); }, _dump: n => db._dump(n) },
           stat: () => ({ trips, rows }) };
}

const ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };
const OFFICER = { code: 'O', name: 'OFFICER', role: 'GMO', teams: [TEAMS[0]], tabs: [] };

const SCREENS = [
  ['Dashboard (admin, all teams)', 'dashboardFull', {}, ADMIN],
  ['Dashboard (one team)', 'dashboardFull', {}, OFFICER],
  ['Defaulters Followup', 'followup', {}, ADMIN],
  ['Expected Repayment', 'expectedDay', { type: 'today' }, ADMIN],
  ['Loan Applications', 'loanPipeline', {}, ADMIN],
  ['Promise to Pay', 'promises', {}, ADMIN],
  ['Weekly report', 'weekly', {}, ADMIN],
];

console.log('screen                            trips      rows      ms');
console.log('─'.repeat(62));
let worstTrips = 0;
for (const [label, fn, args, user] of SCREENS) {
  const c = counting(t);
  const t0 = Date.now();
  let err = '';
  try { await portalApi(c.db, user, fn, args, NOW); }
  catch (e) { err = ' (' + String(e.message).slice(0, 30) + ')'; }
  const ms = Date.now() - t0;
  const { trips, rows } = c.stat();
  worstTrips = Math.max(worstTrips, trips);
  console.log(label.padEnd(32) + String(trips).padStart(6) + String(rows.toLocaleString()).padStart(11)
    + String(ms).padStart(8) + err);
}

console.log('\nPage size: ' + PAGE_SIZE.toLocaleString() + ' rows per request.');
console.log('At 150ms per round trip over the internet, the worst screen above spends about '
  + (worstTrips * 0.15).toFixed(1) + ' seconds JUST WAITING, before any figure is worked out.');
console.log('Vercel cuts a function off at 60 seconds.');
