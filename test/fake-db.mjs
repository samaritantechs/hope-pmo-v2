// In-memory PostgREST fake, mutation-capable -- the read subset matches the one inside
// dashboard.test.mjs (filters, order, range with the 1000-row page cap, maybeSingle) plus
// insert / upsert(onConflict, ignoreDuplicates) / update, which the calls endpoints need.

const PAGE_CAP = 1000;

/** Postgres LIKE, near enough: % is anything, and the comparison ignores case. Regex
    metacharacters in the pattern are escaped, so searching for "C++" or "(a)" matches those
    characters rather than blowing up or matching everything. */
function likeMatch(value, pattern) {
  const v = String(value == null ? '' : value);
  const rx = String(pattern == null ? '' : pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*');
  return new RegExp('^' + rx + '$', 'i').test(v);
}

class FakeQuery {
  static _seq = 0;
  constructor(table) { this.table = table; this.filters = []; this.ord = null; this.lim = null; this.rng = null; this.single = false; this.mode = 'select'; this.payload = null; this.opts = null; this.wantRows = false; }
  select() { if (this.mode !== 'select') this.wantRows = true; return this; }
  eq(k, v) { this.filters.push(r => String(r[k]) === String(v)); return this; }
  neq(k, v) { this.filters.push(r => String(r[k]) !== String(v)); return this; }
  // PostgREST spells "everything with a value here" as .not(col, 'is', null) -- the idiom for
  // a delete-all, which needs a filter to be accepted at all.
  not(k, op, v) { this.filters.push(r => !(op === 'is' && v === null ? r[k] == null : String(r[k]) === String(v))); return this; }
  gte(k, v) { this.filters.push(r => r[k] != null && String(r[k]) >= String(v)); return this; }
  lte(k, v) { this.filters.push(r => r[k] != null && String(r[k]) <= String(v)); return this; }
  in(k, arr) { this.filters.push(r => arr.map(String).includes(String(r[k]))); return this; }
  // Case-insensitive LIKE, with % meaning "anything". What a search box compiles to.
  ilike(k, pat) { this.filters.push(r => likeMatch(r[k], pat)); return this; }
  /** PostgREST spells OR as one string: "ref.ilike.%X%,full_name.ilike.%X%". A search across
      several columns is one request because of it, so the fake has to understand it or the
      only way to test a search is to fetch whole tables and filter in JavaScript -- which is
      the thing the search is written to avoid. */
  or(expr) {
    const parts = String(expr || '').split(',').map(p => {
      const i = p.indexOf('.'), j = p.indexOf('.', i + 1);
      if (i < 0 || j < 0) return null;
      return { col: p.slice(0, i), op: p.slice(i + 1, j), val: p.slice(j + 1) };
    }).filter(Boolean);
    this.filters.push(r => parts.some(p => p.op === 'ilike'
      ? likeMatch(r[p.col], p.val)
      : String(r[p.col]) === p.val));
    return this;
  }
  order(k, opts) { this.ord = { k, asc: !opts || opts.ascending !== false }; return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(rows) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, opts) { this.mode = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.opts = opts || {}; return this; }
  update(patch) { this.mode = 'update'; this.payload = patch; return this; }
  delete() { this.mode = 'delete'; return this; }
  _exec() {
    const rows = this.table.rows;
    if (this.mode === 'insert') {
      // Postgres fills `id` from `default gen_random_uuid()`, and code that inserts a parent
      // then writes a child row keyed on the returned id depends on getting one back. Without
      // this the fake handed back an undefined id and that whole path was untestable.
      const made = this.payload.map(r => (r.id == null ? { ...r, id: 'gen-' + (++FakeQuery._seq) } : { ...r }));
      for (const r of made) rows.push({ ...r });
      return { data: this.wantRows ? made.map(r => ({ ...r })) : null, error: null };
    }
    if (this.mode === 'upsert') {
      const key = this.opts.onConflict || 'id';
      const inserted = [];
      for (const r of this.payload) {
        const i = rows.findIndex(x => String(x[key]) === String(r[key]));
        if (i >= 0) { if (!this.opts.ignoreDuplicates) rows[i] = { ...rows[i], ...r }; }
        else { rows.push({ ...r }); inserted.push({ ...r }); }
      }
      return { data: this.wantRows ? inserted : null, error: null };
    }
    if (this.mode === 'delete') {
      // PostgREST returns the deleted rows when the call asks for them, which is how a caller
      // reports "12 rows replaced" rather than guessing.
      const gone = rows.filter(r => this.filters.every(f => f(r))).map(r => ({ ...r }));
      const keep = rows.filter(r => !this.filters.every(f => f(r)));
      rows.length = 0;
      for (const r of keep) rows.push(r);
      return { data: this.wantRows ? gone : null, error: null, count: gone.length };
    }
    if (this.mode === 'update') {
      let n = 0;
      for (const r of rows) if (this.filters.every(f => f(r))) { Object.assign(r, this.payload); n++; }
      return { data: this.wantRows ? rows.filter(r => this.filters.every(f => f(r))) : null, error: null, count: n };
    }
    let out = rows.filter(r => this.filters.every(f => f(r)));
    if (this.ord) {
      const { k, asc } = this.ord;
      out = out.slice().sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    out = out.slice(0, Math.min(this.lim != null ? this.lim : PAGE_CAP, PAGE_CAP));
    out = out.map(r => ({ ...r }));
    if (this.single) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
  then(res, rej) { return Promise.resolve(this._exec()).then(res, rej); }
}

/** fakeDb(tables, opts)
    opts.rpc  – { name: fn|null }. A function stands in for a Postgres function; null stands in
                for one that has NOT been created yet, which is the state of every live database
                between a deploy and someone running the migration by hand. Code that calls an
                RPC has to survive that, so the fake has to be able to reproduce it. */
export function fakeDb(tables, opts = {}) {
  const store = {};
  for (const [name, rows] of Object.entries(tables || {})) store[name] = { rows: rows.map(r => ({ ...r })) };
  const rpcs = opts.rpc || {};
  return {
    from(name) { if (!store[name]) store[name] = { rows: [] }; return new FakeQuery(store[name]); },
    async rpc(name, args) {
      if (!Object.prototype.hasOwnProperty.call(rpcs, name) || rpcs[name] == null) {
        // What PostgREST actually says when the function is missing.
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } };
      }
      return { data: await rpcs[name](store, args), error: null };
    },
    _dump(name) { return store[name] ? store[name].rows : []; },
  };
}
