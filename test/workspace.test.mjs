// The two-database boundary. HOPE Loan is built on the same deployment that carries three
// hundred officers, so "the data never mixes" has to be a property the code cannot violate
// rather than a promise somebody keeps. These are the tests that make it one.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { resolveWorkspace, dbFor, workspaceFor, canSwitchWorkspace, hopeLoanConfigured,
        hopeLoanMode_forDisplay, HOPEPMO, HOPELOAN } = await import('../api/_lib/workspace.js');
const { supabase } = await import('../api/_lib/supabase.js');

const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const GMO = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: [] };
const OFFICER = { code: 'F', name: 'A FIELD OFFICER', role: 'FIELD OFFICER', teams: ['KONGOWE'], tabs: [] };

/* `try { return fn(); } finally { restore(); }` is wrong for an ASYNC fn, and every test below
   that awaits one of these now takes that path (checking more than one user needs more than
   one `await workspaceFor(...)`, which is where this bites). `return fn()` hands back a
   pending promise the instant fn suspends at its first internal await -- it does not wait for
   fn to finish -- so `finally` restores the environment while fn is still only partway
   through, and a SECOND user checked later in the same callback runs for real against
   whatever the environment reverted to. That is not a hypothetical: it is exactly what turned
   a `hopeloan` client back into a live network probe against `SUPABASE_URL` mid-loop, timing
   out for several seconds before failing the assertion for a reason that had nothing to do
   with the code under test.

   The fix is the same one `.finally()` exists for: restore synchronously when fn is
   synchronous (so a sync assertion failure still throws synchronously, exactly as before, and
   no caller has to start awaiting these), and defer the restore onto the returned promise when
   fn is async, so it runs only once fn has actually settled. */
function withRestore_(fn, restore) {
  let result;
  try { result = fn(); }
  catch (e) { restore(); throw e; }
  if (result && typeof result.finally === 'function') return result.finally(restore);
  restore();
  return result;
}

/* The sandbox exists only while these are set. Every test that needs it configured sets them
   and puts the environment back, so the order tests run in cannot change what they prove. */
function withLoanConfigured(fn) {
  const url = process.env.HOPELOAN_SUPABASE_URL, key = process.env.HOPELOAN_SERVICE_ROLE_KEY;
  process.env.HOPELOAN_SUPABASE_URL = 'https://hopeloan.test.invalid';
  process.env.HOPELOAN_SERVICE_ROLE_KEY = 'hopeloan-test-key';
  return withRestore_(fn, () => {
    if (url === undefined) delete process.env.HOPELOAN_SUPABASE_URL; else process.env.HOPELOAN_SUPABASE_URL = url;
    if (key === undefined) delete process.env.HOPELOAN_SERVICE_ROLE_KEY; else process.env.HOPELOAN_SERVICE_ROLE_KEY = key;
  });
}

function withoutLoanConfigured(fn) {
  const url = process.env.HOPELOAN_SUPABASE_URL, key = process.env.HOPELOAN_SERVICE_ROLE_KEY;
  delete process.env.HOPELOAN_SUPABASE_URL;
  delete process.env.HOPELOAN_SERVICE_ROLE_KEY;
  return withRestore_(fn, () => {
    if (url !== undefined) process.env.HOPELOAN_SUPABASE_URL = url;
    if (key !== undefined) process.env.HOPELOAN_SERVICE_ROLE_KEY = key;
  });
}

test('nobody reaches HOPE Loan unless they ask for it by name', () => {
  withLoanConfigured(() => {
    for (const asked of [undefined, null, '', 'hopepmo', 'HOPEPMO', 'production', 'sandbox', 'other']) {
      assert.equal(resolveWorkspace(ADMIN, asked), HOPEPMO,
        JSON.stringify(asked) + ' must resolve to production');
    }
  });
});

test('an admin who asks for HOPE Loan gets it, in any capitalisation', () => {
  withLoanConfigured(() => {
    for (const asked of ['hopeloan', 'HOPELOAN', ' HopeLoan ']) {
      assert.equal(resolveWorkspace(ADMIN, asked), HOPELOAN, JSON.stringify(asked));
    }
  });
});

/* THE ONE THAT MATTERS. An officer's phone can send whatever it likes -- a copied URL, an old
   cached page, a deliberately edited request. None of it moves them off the real book. Every
   fixture below is either not ADMIN and holds none of HOPE Loan's own seven tabs, or holds
   only HOPE PMO tabs (upload/settings/audit) -- neither counts, same as a code with no
   `upload` tab still cannot reach Upload. */
test('no role, and no ticked HOPE Loan tab, can reach HOPE Loan, however they ask', async () => {
  await withLoanConfigured(async () => {
    const roles = [GMO, OFFICER,
      { role: 'PMO', teams: null, tabs: [] },
      { role: 'MANAGER', teams: ['KONGOWE'], tabs: [] },
      { role: 'OPM', teams: null, tabs: [] },
      { role: 'GENERAL MANAGER', teams: null, tabs: [] },
      { role: 'AUDITOR', teams: null, tabs: [] },
      // Every HOPE PMO admin tab ticked, and still not one HOPE Loan tab among them.
      { role: 'SUPERUSER', teams: null, tabs: ['upload', 'settings', 'audit'] },
      { role: '', teams: null, tabs: [] },
      {},
    ];
    for (const user of roles) {
      assert.equal(resolveWorkspace(user, 'hopeloan'), HOPEPMO,
        'role ' + JSON.stringify(user.role) + ' must never leave production');
      const ws = await workspaceFor(user, 'hopeloan');
      assert.equal(ws.db, supabase, 'role ' + JSON.stringify(user.role) + ' must hold the production client');
      assert.equal(ws.sandbox, false);
      /* And they are never told WHY -- a non-admin gets `ready: true` on production, not a
         "not ready" that would confirm a sandbox exists somewhere to be asked about. */
      assert.equal(ws.ready, true, 'a refusal must not leak that a sandbox exists');
    }
  });
});

/* THE OTHER HALF OF THE SAME RULE. "i mean they cant reach tabs i didnt tick for anyone to
   see yet" -- a code that WAS ticked for one of HOPE Loan's own tabs is exactly the code this
   whole redesign is for: no ADMIN role, no separate "sandbox" switch to be granted, just the
   same checkbox every other tab uses. */
test('a non-admin holding even one HOPE Loan tab reaches HOPE Loan', async () => {
  await withLoanConfigured(async () => {
    const holders = [
      { role: 'MANAGER', teams: ['KONGOWE'], tabs: ['manager'] },
      { role: 'GMO', teams: null, tabs: ['gmo'] },
      { role: 'CUSTOMER SERVICE', teams: null, tabs: ['customer_service'] },
      // Holding a HOPE Loan tab alongside ordinary HOPE PMO ones changes nothing about those.
      { role: 'FIELD OFFICER', teams: ['KONGOWE'], tabs: ['followup', 'finance'] },
    ];
    for (const user of holders) {
      assert.equal(resolveWorkspace(user, 'hopeloan'), HOPELOAN,
        JSON.stringify(user.tabs) + ' must be enough, with no ADMIN role at all');
      const ws = await workspaceFor(user, 'hopeloan');
      assert.equal(ws.workspace, HOPELOAN);
      assert.equal(ws.sandbox, true);
      assert.notEqual(ws.db, supabase);
    }
  });
});

test('a HOPE PMO tab cannot be mistaken for a HOPE Loan one', () => {
  withLoanConfigured(() => {
    // upload/settings/audit are HOPE PMO's own admin tabs -- ticking all three of them is not
    // the same as being ticked for any of HOPE Loan's seven, so this must still stay on production.
    assert.equal(resolveWorkspace({ role: 'GMO', tabs: ['upload', 'settings', 'audit'] }, 'hopeloan'), HOPEPMO);
    assert.equal(resolveWorkspace({ role: 'admin', tabs: [] }, 'hopeloan'), HOPELOAN, 'case is not the point');
  });
});

/* HOPELOAN_ENABLED=false is the explicit OFF, and it must beat everything -- it is the only
   thing an environment variable is still genuinely for here now that running the SQL is the
   configuration. */
test('an explicit HOPELOAN_ENABLED=false turns the sandbox off outright', async () => {
  await withoutLoanConfigured(async () => {
    process.env.HOPELOAN_ENABLED = 'false';
    assert.equal(hopeLoanConfigured(), false);
    assert.equal(resolveWorkspace(ADMIN, 'hopeloan'), HOPEPMO);
    assert.equal((await workspaceFor(ADMIN, 'hopeloan')).db, supabase);
    delete process.env.HOPELOAN_ENABLED;
  });
  assert.equal(await canSwitchWorkspace({ role: 'ADMIN' }), false);
});

test('half-configured PROJECT mode falls back to schema mode rather than half-working', () => {
  withoutLoanConfigured(() => {
    // A URL with no key is not a second project -- but the production credentials are still
    // there, so schema mode remains available. What it must NOT do is build a broken client
    // out of half a configuration.
    process.env.HOPELOAN_SUPABASE_URL = 'https://hopeloan.test.invalid';
    assert.equal(hopeLoanMode_forDisplay(), 'schema', 'a URL with no key is not project mode');
    delete process.env.HOPELOAN_SUPABASE_URL;

    process.env.HOPELOAN_SERVICE_ROLE_KEY = 'hopeloan-test-key';
    assert.equal(hopeLoanMode_forDisplay(), 'schema', 'a key with no URL is not project mode');
    delete process.env.HOPELOAN_SERVICE_ROLE_KEY;
  });
});

test('the switch is offered to an admin, or a code holding a HOPE Loan tab, and nobody else', async () => {
  await withLoanConfigured(async () => {
    assert.equal(await canSwitchWorkspace(ADMIN), true);
    for (const u of [GMO, OFFICER, {}]) {
      assert.equal(await canSwitchWorkspace(u), false, JSON.stringify(u.role));
    }
    assert.equal(await canSwitchWorkspace({ role: 'MANAGER', tabs: ['manager'] }), true,
      'a ticked HOPE Loan tab is enough, admin or not');
  });
});

/* THE PRESENTATION SWITCH -- Settings' "HOPE LOAN in the sidebar" card writes HOPELOAN_VISIBLE,
   and hidden must mean hidden for EVERYONE: the whole point is presenting HOPE PMO with no
   trace of HOPE LOAN in the presenter's OWN admin sidebar. The fetch mock answers the two
   reads apart by URL: the HOPELOAN_VISIBLE settings read, and the sandbox probe. */
test('the Settings visibility switch hides HOPE LOAN from everybody, the admin included', async () => {
  const { clearHopeLoanProbe } = await import('../api/_lib/workspace.js');
  const real = globalThis.fetch;
  const answer = visible => async url => String(url).indexOf('HOPELOAN_VISIBLE') >= 0
    ? new Response(JSON.stringify({ key: 'HOPELOAN_VISIBLE', value: visible }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    : new Response('[{"key":"WORKSPACE"}]',
        { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    await withLoanConfigured(async () => {
      globalThis.fetch = answer('NO');
      clearHopeLoanProbe();
      assert.equal(await canSwitchWorkspace(ADMIN), false, 'hidden means hidden for the admin too');

      globalThis.fetch = answer('YES');
      clearHopeLoanProbe();
      assert.equal(await canSwitchWorkspace(ADMIN), true, 'one press brings it back');
    });
  } finally {
    globalThis.fetch = real;
    clearHopeLoanProbe();
  }
});

/* dbFor is the last line rather than the first: resolveWorkspace is what decides, and a caller
   that skipped it must not be able to reach the sandbox by passing a string straight through. */
test('dbFor hands back production for anything it does not recognise', () => {
  withLoanConfigured(() => {
    for (const name of [undefined, null, '', 'HOPELOAN', 'hopeloan ', 'sandbox', 'hopepmo', 0, {}]) {
      assert.equal(dbFor(name), supabase, JSON.stringify(name) + ' must be the production client');
    }
    assert.notEqual(dbFor(HOPELOAN), supabase, 'the exact resolved name is the only way through');
  });
});

test('an admin in HOPE Loan holds a different client from the production one', async () => {
  await withLoanConfigured(async () => {
    const a = await workspaceFor(ADMIN, 'hopeloan');
    assert.equal(a.workspace, HOPELOAN);
    assert.equal(a.sandbox, true);
    assert.notEqual(a.db, supabase, 'the sandbox must not be the production client');

    const b = await workspaceFor(ADMIN, undefined);
    assert.equal(b.workspace, HOPEPMO);
    assert.equal(b.sandbox, false);
    assert.equal(b.db, supabase);
  });
});

/* THE BUG THAT PRODUCED "its in app but ends at trying": the switch was gated on a real probe
   while ROUTING was gated only on credentials existing, so a deployment whose schema was
   missing or unexposed hid the button in the portal AND still routed the call app into a
   sandbox that could not answer -- leaving the phone on "trying…" under a red SANDBOX banner
   forever. One question, one place, and an unready sandbox is refused in words. */
test('an unready sandbox routes to production and says so, instead of hanging', async () => {
  const { clearHopeLoanProbe } = await import('../api/_lib/workspace.js');
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('{"message":"schema must be one of the following: public"}',
      { status: 404, headers: { 'Content-Type': 'application/json' } });
    clearHopeLoanProbe();
    const ws = await workspaceFor(ADMIN, 'hopeloan');
    assert.equal(ws.ready, false, 'the caller must be able to tell it did not happen');
    assert.equal(ws.db, supabase, 'and must be given production, never a client that cannot answer');
    assert.equal(ws.sandbox, false, 'so no screen paints a SANDBOX banner over live data');
  } finally { globalThis.fetch = real; clearHopeLoanProbe(); }
});

test('the sandbox client is built once and reused, not per request', () => {
  withLoanConfigured(() => {
    // A client per request is a connection pool per request -- the mistake that took the
    // system down when paged reads were fired six at a time.
    assert.equal(dbFor(HOPELOAN), dbFor(HOPELOAN));
  });
});

test('pointing the environment at a different project yields a different client', () => {
  withLoanConfigured(() => {
    const first = dbFor(HOPELOAN);
    process.env.HOPELOAN_SUPABASE_URL = 'https://hopeloan-two.test.invalid';
    assert.notEqual(dbFor(HOPELOAN), first, 'a changed URL must not reuse the old connection');
  });
});

/* =====================================================================================
   SCHEMA MODE -- the free path: the same project, a second schema, turned on by one flag.
   ===================================================================================== */

function withSchemaModeEnabled(fn) {
  const enabled = process.env.HOPELOAN_ENABLED;
  process.env.HOPELOAN_ENABLED = 'true';
  return withRestore_(fn, () => {
    if (enabled === undefined) delete process.env.HOPELOAN_ENABLED; else process.env.HOPELOAN_ENABLED = enabled;
  });
}

/* RUNNING THE SQL IS THE CONFIGURATION. The switch used to need HOPELOAN_ENABLED on top of
   the migration -- a second switch saying the same thing, and the one somebody could not find
   ("i cant find HOPELOAN_ENABLED"). Schema mode is available whenever the production
   credentials exist; whether it is READY is answered by asking the database. */
test('schema mode needs no environment variable at all', async () => {
  withoutLoanConfigured(() => {
    assert.equal(hopeLoanMode_forDisplay(), 'schema', 'production credentials are enough');
    assert.equal(hopeLoanConfigured(), true);
    assert.notEqual(dbFor(HOPELOAN), supabase, 'schema mode is still a distinct client');
    assert.equal(resolveWorkspace(ADMIN, 'hopeloan'), HOPELOAN);
    assert.equal(resolveWorkspace(GMO, 'hopeloan'), HOPEPMO, 'the role-or-tab check applies regardless');
  });
});

test('HOPELOAN_ENABLED still works as an explicit override, both ways', () => {
  withoutLoanConfigured(() => {
    withSchemaModeEnabled(() => {
      assert.equal(hopeLoanMode_forDisplay(), 'schema', 'explicit yes');
    });
    for (const v of ['0', 'false', 'no', '', 'nah', 'disabled']) {
      process.env.HOPELOAN_ENABLED = v;
      assert.equal(hopeLoanConfigured(), false, JSON.stringify(v) + ' must turn the sandbox off');
    }
    delete process.env.HOPELOAN_ENABLED;
  });
});

/* THE PROBE IS WHAT DECIDES WHETHER THE SWITCH IS DRAWN. It asks the sandbox schema for the
   settings row RUN-ME-001-origination.sql writes -- so the button appears exactly when it will
   work, and never before. Both failure shapes matter: no schema at all, and a schema that
   exists but was never exposed to PostgREST, which is the step easiest to miss. */
test('the switch appears only once the SQL has actually been run', async () => {
  const { hopeLoanReady, clearHopeLoanProbe } = await import('../api/_lib/workspace.js');
  const real = globalThis.fetch;
  try {
    // A database that refuses the sandbox schema -- the un-migrated state every deployment
    // starts in. PostgREST answers 404 for a schema it was never told about.
    globalThis.fetch = async () => new Response('{"message":"schema must be one of the following: public"}',
      { status: 404, headers: { 'Content-Type': 'application/json' } });
    clearHopeLoanProbe();
    assert.equal(await hopeLoanReady(), false, 'no schema yet -- no switch');
    assert.equal(await canSwitchWorkspace(ADMIN), false, 'and the admin is not offered it');

    // Now the migration has been run and the schema answers.
    globalThis.fetch = async () => new Response('[{"key":"WORKSPACE"}]',
      { status: 200, headers: { 'Content-Type': 'application/json' } });
    clearHopeLoanProbe();
    assert.equal(await hopeLoanReady(), true, 'the SQL is in -- the switch appears');
    assert.equal(await canSwitchWorkspace(ADMIN), true);
    assert.equal(await canSwitchWorkspace(GMO), false, 'no HOPE Loan tab, however ready the sandbox is');
  } finally {
    globalThis.fetch = real;
    clearHopeLoanProbe();
  }
});

test('a successful probe is cached, so sign-in does not pay for it every time', async () => {
  const { hopeLoanReady, clearHopeLoanProbe } = await import('../api/_lib/workspace.js');
  const real = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response('[{"key":"WORKSPACE"}]',
      { status: 200, headers: { 'Content-Type': 'application/json' } }); };
    clearHopeLoanProbe();
    await hopeLoanReady(); await hopeLoanReady(); await hopeLoanReady();
    assert.equal(calls, 1, 'three sign-ins, one probe');
  } finally {
    globalThis.fetch = real;
    clearHopeLoanProbe();
  }
});

test('a separate project, once configured, wins over schema mode', () => {
  withoutLoanConfigured(() => {
    withSchemaModeEnabled(() => {
      assert.equal(hopeLoanMode_forDisplay(), 'schema');
      withLoanConfigured(() => {
        // withLoanConfigured sets HOPELOAN_SUPABASE_URL/KEY -- project mode should now win,
        // so a deployment that has graduated to its own project is never left quietly running
        // on the shared schema because the old flag was never removed.
        assert.equal(hopeLoanMode_forDisplay(), 'project');
      });
      // And falls back to schema mode once the project variables are gone again.
      assert.equal(hopeLoanMode_forDisplay(), 'schema');
    });
  });
});

test('schema mode and project mode never share a cached client', () => {
  withoutLoanConfigured(() => {
    withSchemaModeEnabled(() => {
      const schemaClient = dbFor(HOPELOAN);
      withLoanConfigured(() => {
        assert.notEqual(dbFor(HOPELOAN), schemaClient, 'switching mode must not reuse the old client');
      });
    });
  });
});
