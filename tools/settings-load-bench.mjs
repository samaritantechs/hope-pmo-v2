/* How many rows cross the wire to draw the Settings tab, counted rather than guessed.

   Run it with:   node tools/settings-load-bench.mjs

   It builds a year of a real-sized operation in memory -- 30k customers' worth of daily
   Expected and Defaulters decks, payments and call logs -- then draws the Settings tab both
   ways and counts the rows and round trips each one needs. The last line checks the two
   agree; if it ever says NO, the fast path is lying and must not ship.

   No database and no network: it runs against the same in-memory fake the tests use. */
process.env.SUPABASE_URL ||= 'http://x';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'y';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { fakeDb } = await import(path.join(ROOT, 'test/fake-db.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));

const ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };
const NOW = Date.parse('2026-08-01T09:00:00Z');

// A year of a real-sized operation: 30k customers, an Expected and a Defaulters deck each
// working day, plus payments and call logs.
const DAYS = 260, PER_DAY_EXP = 1200, PER_DAY_DEF = 900, PER_DAY_RCV = 700, PER_DAY_CALL = 2000;
const day = i => new Date(Date.parse('2025-08-01') + i * 86400000).toISOString().slice(0, 10);
const mk = (n, i, f) => Array.from({ length: n }, (_, j) => f(day(i), j));

const t = { repayment_snapshots: [], defaulter_snapshots: [], received_payments: [], abnormal_payments: [], call_logs: [] };
for (let i = 0; i < DAYS; i++) {
  const d = day(i);
  for (const r of mk(PER_DAY_EXP, i, () => ({ snapshot_date: d }))) t.repayment_snapshots.push(r);
  for (const r of mk(PER_DAY_DEF, i, () => ({ snapshot_date: d }))) t.defaulter_snapshots.push(r);
  for (const r of mk(PER_DAY_RCV, i, () => ({ paid_at: d }))) t.received_payments.push(r);
  for (const r of mk(PER_DAY_CALL, i, () => ({ call_date: d }))) t.call_logs.push(r);
}
const TOTAL = Object.values(t).reduce((s, a) => s + a.length, 0);

// Wrap the fake to count every row it hands back.
function counting(tables, opts) {
  const db = fakeDb(tables, opts);
  let rows = 0, calls = 0;
  const wrap = (q) => new Proxy(q, { get(o, p) {
    if (p === 'then') return (res, rej) => o.then((r) => { calls++; if (Array.isArray(r.data)) rows += r.data.length; return res(r); }, rej);
    const v = o[p];
    return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? wrap(o) : out; } : v;
  } });
  return { db: { from: (n) => wrap(db.from(n)),
                 rpc: async (n, a) => { const r = await db.rpc(n, a); calls++; if (Array.isArray(r.data)) rows += r.data.length; return r; },
                 _dump: db._dump },
           stat: () => ({ rows, calls }) };
}

const COUNT_FN = (store) => {
  const src = [['expected','repayment_snapshots','snapshot_date'],['defaulters','defaulter_snapshots','snapshot_date'],
               ['received','received_payments','paid_at'],['abnormal','abnormal_payments','created_at'],['calls','call_logs','call_date']];
  const out = [];
  for (const [key, table, col] of src) {
    const n = {};
    for (const r of (store[table] ? store[table].rows : [])) { const d = String(r[col] ?? '').slice(0,10) || null; n[d] = (n[d]||0)+1; }
    for (const [d, c] of Object.entries(n)) out.push({ source: key, day: d === 'null' ? null : d, n: c });
  }
  return out;
};

const before = counting(t);
const b0 = Date.now();
const rb = await portalApi(before.db, ADMIN, 'storageUsage', {}, NOW);
const bt = Date.now() - b0;

const after = counting(t, { rpc: { storage_usage_by_date: COUNT_FN } });
const a0 = Date.now();
const ra = await portalApi(after.db, ADMIN, 'storageUsage', {}, NOW);
const at = Date.now() - a0;

const B = before.stat(), A = after.stat();
const bytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(1) + ' KB' : (n/1048576).toFixed(1) + ' MB';
console.log('A year of a real-sized operation: ' + TOTAL.toLocaleString() + ' rows stored\n');
console.log('  before   ' + B.rows.toLocaleString().padStart(10) + ' rows over the wire, ' + String(B.calls).padStart(4) + ' round trips, ' + String(bt).padStart(5) + ' ms');
console.log('  after    ' + A.rows.toLocaleString().padStart(10) + ' rows over the wire, ' + String(A.calls).padStart(4) + ' round trips, ' + String(at).padStart(5) + ' ms');
console.log('\n  rows sent cut by ' + (100 - (A.rows / B.rows) * 100).toFixed(2) + '%  (' + Math.round(B.rows / A.rows) + 'x fewer)');
console.log('  at ~30 bytes a row that is about ' + bytes(B.rows * 30) + ' down to ' + bytes(A.rows * 30) + ' per open of the Settings tab');
console.log('\n  same answer? ' + (JSON.stringify(rb.dates) === JSON.stringify(ra.dates)
  && rb.totalRows === ra.totalRows && rb.bytes === ra.bytes ? 'YES' : 'NO -- STOP'));
