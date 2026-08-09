// In-memory PostgREST fake, mutation-capable -- the read subset matches the one inside
// dashboard.test.mjs (filters, order, range with the 1000-row page cap, maybeSingle) plus
// insert / upsert(onConflict, ignoreDuplicates) / update, which the calls endpoints need.

/* What the server will hand back in one request. Supabase does not set PostgREST's db-max-rows
   by default, so a real deployment returns whatever is asked for; a deployment that DOES set it
   truncates silently. Both are worth being able to reproduce, so it is settable. */
export let PAGE_CAP = 100000;
export function setPageCap(n) { PAGE_CAP = n; }

/** Postgres LIKE, properly: `%` is any run of characters, `_` is exactly one, and a backslash
    escapes either of them into its literal self. Regex metacharacters in the pattern are escaped
    so searching for "C++" or "(a)" matches those characters rather than blowing up.

    IT USED TO KNOW ONLY ABOUT `%`, which made it useless for the one thing LIKE most needs
    testing for: a pattern built from something a PERSON typed. `_` went through as a literal,
    so a test could prove an unescaped user string was harmless when in the real database it is
    a wildcard -- and on the access-code look-up that is the difference between "invalid code"
    and being signed in as somebody else. */
const rxEsc = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function likeMatch(value, pattern) {
  const v = String(value == null ? '' : value);
  const p = String(pattern == null ? '' : pattern);
  let rx = '';
  for (let i = 0; i < p.length; i++) {
    const c = p.charAt(i);
    if (c === '\\' && i + 1 < p.length) { rx += rxEsc(p.charAt(++i)); continue; }
    if (c === '%') { rx += '.*'; continue; }
    if (c === '_') { rx += '.'; continue; }
    rx += rxEsc(c);
  }
  return new RegExp('^' + rx + '$', 'i').test(v);
}

/* Set by setUnstableOrder(). Module-level so it survives across the several fakeDb
   instances one test may build. */
export let UNSTABLE = false;
export function setUnstableOrder(on) { UNSTABLE = !!on; FakeQuery._scan = 0; }

class FakeQuery {
  static _seq = 0;
  static _scan = 0;
  constructor(table, name) {
    this.table = table;
    this.tableName = name;
    /* The URL the real client would be about to request. fetchAll reads the table name off
       this to decide which unique column settles a paged read's order, so the fake has to
       offer it or that decision is untestable -- and untested, it is the kind of thing that
       silently stops happening. */
    this.url = { pathname: '/rest/v1/' + String(name) };
    this.filters = []; this.ords = []; this.lim = null; this.rng = null; this.single = false; this.mode = 'select'; this.payload = null; this.opts = null; this.wantRows = false; this.cols = null; }
  /** PostgREST returns ONLY the columns asked for. The fake used to ignore the argument and
      hand back whole rows, which meant a narrowed select that forgot a column passed every
      test and failed in the field -- exactly how customer rows reached officers' phones with
      no name and nothing to tap. Honouring the projection makes that a red test instead. */
  /* PostgREST also answers "how many?" without sending any of them: select(cols, { count:
     'exact', head: true }) returns the number in a header and no body at all. That is the
     cheapest read there is, and the fake has to offer it or the only way to test a count is to
     fetch the rows and count them here -- which is the thing a count exists to avoid. */
  select(cols, opts) {
    if (this.mode !== 'select') this.wantRows = true;
    const list = String(cols == null ? '*' : cols).split(',').map(s => s.trim()).filter(Boolean);
    this.cols = (!list.length || list.includes('*')) ? null : list;
    this.headOnly = !!(opts && opts.head);
    this.wantCount = !!(opts && opts.count);
    return this;
  }
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
      the thing the search is written to avoid.

      EVERY OPERATOR IT UNDERSTANDS HAS TO BEHAVE, not just the ones a search box uses. This
      recognised `ilike` and treated EVERYTHING ELSE as equality -- so "approved_date.gte.X"
      quietly meant "approved_date = X". A read narrowed to a date range therefore passed its
      tests while returning almost nothing, which is the precise shape of bug this fake exists
      to catch. An operator it does not know is now a thrown error rather than a wrong answer.

      A null never satisfies a comparison, the same as in Postgres -- which is what makes
      "either of these two dates is recent" exclude a row that has neither. */
  or(expr) {
    const parts = String(expr || '').split(',').map(p => {
      const i = p.indexOf('.'), j = p.indexOf('.', i + 1);
      if (i < 0 || j < 0) return null;
      return { col: p.slice(0, i), op: p.slice(i + 1, j), val: p.slice(j + 1) };
    }).filter(Boolean);
    const test = (p, r) => {
      const v = r[p.col];
      switch (p.op) {
        case 'ilike': return likeMatch(v, p.val);
        case 'eq':    return String(v) === p.val;
        case 'neq':   return String(v) !== p.val;
        case 'gte':   return v != null && String(v) >= p.val;
        case 'gt':    return v != null && String(v) > p.val;
        case 'lte':   return v != null && String(v) <= p.val;
        case 'lt':    return v != null && String(v) < p.val;
        case 'is':    return p.val === 'null' ? v == null : String(v) === p.val;
        default:
          throw new Error('fake-db: .or() does not understand the operator "' + p.op
            + '" (in "' + p.col + '.' + p.op + '.' + p.val + '"). Add it rather than letting it '
            + 'be silently treated as equality.');
      }
    };
    this.filters.push(r => parts.some(p => test(p, r)));
    return this;
  }
  /** PostgREST accepts SEVERAL order columns and applies them left to right, which is the
      whole mechanism behind a tiebreaker: `order=created_at.desc,id.asc` sorts by the date and
      settles the ties by id. The fake kept only the last one, so a tiebreaker would have
      REPLACED the caller's sort here and matched it in the field -- the fake has to model
      this properly or it hides the very thing being added. */
  order(k, opts) { this.ords.push({ k, asc: !opts || opts.ascending !== false }); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  insert(rows) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, opts) { this.mode = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.opts = opts || {}; return this; }
  update(patch) { this.mode = 'update'; this.payload = patch; return this; }
  delete() { this.mode = 'delete'; return this; }
  /* A column that was asked for but is absent from the stored row still comes back as a key
     with null, the way Postgres answers for a column that exists but holds nothing. */
  _project(r) {
    if (!this.cols) return { ...r };
    const out = {};
    for (const c of this.cols) out[c] = r[c] === undefined ? null : r[c];
    return out;
  }
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
    // The count is of everything that MATCHED, before any range or limit -- which is what
    // PostgREST's exact count means and the whole reason it is worth asking for.
    const matched = out.length;
    if (this.headOnly) return { data: [], error: null, count: matched };
    /* WITHOUT AN ORDER BY, POSTGRES DOES NOT PROMISE AN ORDER -- and on a big table it
       genuinely does not give the same one twice. `synchronize_seqscans` is on by default, so
       a sequential scan joins whichever scan is already running, wherever it has got to, and
       wraps round at the end. Two requests for the same unchanged rows come back rotated
       against each other, which is exactly what breaks offset/limit paging.

       Off by default so every existing test keeps the tidy insertion order it was written
       against; switched on, it reproduces the live fault. */
    if (UNSTABLE && !this.ords.length && out.length > 1) {
      const k = (FakeQuery._scan++) % out.length;
      out = out.slice(k).concat(out.slice(0, k));
    }
    for (let i = this.ords.length - 1; i >= 0; i--) {
      const { k, asc } = this.ords[i];
      out = out.slice().sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    out = out.slice(0, Math.min(this.lim != null ? this.lim : PAGE_CAP, PAGE_CAP));
    out = out.map(r => this._project(r));
    if (this.single) return { data: out[0] || null, error: null, count: this.wantCount ? matched : null };
    return { data: out, error: null, count: this.wantCount ? matched : null };
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
    from(name) { if (!store[name]) store[name] = { rows: [] }; return new FakeQuery(store[name], name); },
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
