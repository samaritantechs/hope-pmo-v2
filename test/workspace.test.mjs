// The two-database boundary. HOPE Loan is built on the same deployment that carries three
// hundred officers, so "the data never mixes" has to be a property the code cannot violate
// rather than a promise somebody keeps. These are the tests that make it one.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { resolveWorkspace, dbFor, workspaceFor, canSwitchWorkspace, hopeLoanConfigured,
        HOPEPMO, HOPELOAN } = await import('../api/_lib/workspace.js');
const { supabase } = await import('../api/_lib/supabase.js');

const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const GMO = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: [] };
const OFFICER = { code: 'F', name: 'A FIELD OFFICER', role: 'FIELD OFFICER', teams: ['KONGOWE'], tabs: [] };

/* The sandbox exists only while these are set. Every test that needs it configured sets them
   and puts the environment back, so the order tests run in cannot change what they prove. */
function withLoanConfigured(fn) {
  const url = process.env.HOPELOAN_SUPABASE_URL, key = process.env.HOPELOAN_SERVICE_ROLE_KEY;
  process.env.HOPELOAN_SUPABASE_URL = 'https://hopeloan.test.invalid';
  process.env.HOPELOAN_SERVICE_ROLE_KEY = 'hopeloan-test-key';
  try { return fn(); }
  finally {
    if (url === undefined) delete process.env.HOPELOAN_SUPABASE_URL; else process.env.HOPELOAN_SUPABASE_URL = url;
    if (key === undefined) delete process.env.HOPELOAN_SERVICE_ROLE_KEY; else process.env.HOPELOAN_SERVICE_ROLE_KEY = key;
  }
}

function withoutLoanConfigured(fn) {
  const url = process.env.HOPELOAN_SUPABASE_URL, key = process.env.HOPELOAN_SERVICE_ROLE_KEY;
  delete process.env.HOPELOAN_SUPABASE_URL;
  delete process.env.HOPELOAN_SERVICE_ROLE_KEY;
  try { return fn(); }
  finally {
    if (url !== undefined) process.env.HOPELOAN_SUPABASE_URL = url;
    if (key !== undefined) process.env.HOPELOAN_SERVICE_ROLE_KEY = key;
  }
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
   cached page, a deliberately edited request. None of it moves them off the real book. */
test('no role but ADMIN can reach HOPE Loan, however they ask', () => {
  withLoanConfigured(() => {
    const roles = [GMO, OFFICER,
      { role: 'PMO', teams: null, tabs: [] },
      { role: 'MANAGER', teams: ['KONGOWE'], tabs: [] },
      { role: 'OPM', teams: null, tabs: [] },
      { role: 'GENERAL MANAGER', teams: null, tabs: [] },
      { role: 'AUDITOR', teams: null, tabs: [] },
      // A role somebody has ticked every box on is still not an admin.
      { role: 'SUPERUSER', teams: null, tabs: ['upload', 'settings', 'audit'] },
      { role: '', teams: null, tabs: [] },
      {},
    ];
    for (const user of roles) {
      assert.equal(resolveWorkspace(user, 'hopeloan'), HOPEPMO,
        'role ' + JSON.stringify(user.role) + ' must never leave production');
      assert.equal(workspaceFor(user, 'hopeloan').db, supabase,
        'role ' + JSON.stringify(user.role) + ' must hold the production client');
      assert.equal(workspaceFor(user, 'hopeloan').sandbox, false);
    }
  });
});

test('a tab cannot be mistaken for a role -- admin is the role string, nothing else', () => {
  withLoanConfigured(() => {
    // Tabs are edited in Teams & Staff. A wrongly ticked box must not open a second database.
    assert.equal(resolveWorkspace({ role: 'GMO', tabs: ['upload', 'settings', 'audit'] }, 'hopeloan'), HOPEPMO);
    assert.equal(resolveWorkspace({ role: 'admin', tabs: [] }, 'hopeloan'), HOPELOAN, 'case is not the point');
  });
});

test('with nothing configured there is no sandbox at all, even for an admin', () => {
  withoutLoanConfigured(() => {
    assert.equal(hopeLoanConfigured(), false);
    assert.equal(resolveWorkspace(ADMIN, 'hopeloan'), HOPEPMO);
    assert.equal(workspaceFor(ADMIN, 'hopeloan').db, supabase);
    assert.equal(canSwitchWorkspace(ADMIN), false, 'the switch is not offered');
  });
});

test('half-configured is not configured -- one variable without the other stays production', () => {
  withoutLoanConfigured(() => {
    process.env.HOPELOAN_SUPABASE_URL = 'https://hopeloan.test.invalid';
    assert.equal(hopeLoanConfigured(), false, 'a URL with no key is not a database');
    assert.equal(resolveWorkspace(ADMIN, 'hopeloan'), HOPEPMO);
    delete process.env.HOPELOAN_SUPABASE_URL;

    process.env.HOPELOAN_SERVICE_ROLE_KEY = 'hopeloan-test-key';
    assert.equal(hopeLoanConfigured(), false, 'a key with no URL is not a database');
    assert.equal(resolveWorkspace(ADMIN, 'hopeloan'), HOPEPMO);
    delete process.env.HOPELOAN_SERVICE_ROLE_KEY;
  });
});

test('the switch is offered to an admin only, and only once configured', () => {
  withLoanConfigured(() => {
    assert.equal(canSwitchWorkspace(ADMIN), true);
    for (const u of [GMO, OFFICER, {}]) assert.equal(canSwitchWorkspace(u), false);
  });
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

test('an admin in HOPE Loan holds a different client from the production one', () => {
  withLoanConfigured(() => {
    const a = workspaceFor(ADMIN, 'hopeloan');
    assert.equal(a.workspace, HOPELOAN);
    assert.equal(a.sandbox, true);
    assert.notEqual(a.db, supabase, 'the sandbox must not be the production client');

    const b = workspaceFor(ADMIN, undefined);
    assert.equal(b.workspace, HOPEPMO);
    assert.equal(b.sandbox, false);
    assert.equal(b.db, supabase);
  });
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
