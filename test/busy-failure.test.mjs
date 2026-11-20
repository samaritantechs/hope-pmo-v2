/* WHEN MAY A LIST THAT IS UP TO TEN MINUTES OLD BE HANDED OUT INSTEAD OF READING THE TABLE? -- isBusyFailure, api/_lib/supabase.js (handbook Part 126).

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026

   The call app's called-today numbers and the call boards each keep their last good answer and hand it out again for ten minutes when the
   database is only briefly busy or unreachable (Part 123). The second reader of #767 found that the test for "briefly unreachable" was the
   reader's retry test, isTransient, which matches words ANYWHERE in a message: five faults passed for a bad moment and were hidden for ten
   minutes under a log line that said the database was busy, and two real bad moments (PostgREST's schema-cache and pool codes, a refused
   connection) did not pass. A retry that is wrong costs nothing; a stand-in that is wrong hides a fault. So the stand-ins ask a stricter,
   separate question, and this file is its whole definition, case by case. isTransient itself, which decides retries, is NOT changed in
   meaning: the last test pins that. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { isBusyFailure, isTransient, errWords } = await import('../api/_lib/supabase.js');

const busy = [
  // the database named it, and the name says busy
  ['a statement cancelled at its limit', { code: '57014', message: 'canceling statement due to statement timeout' }],
  ['a lock timeout', { code: '55P03', message: 'canceling statement due to lock timeout' }],
  ['a deadlock', { code: '40P01', message: 'deadlock detected' }],
  ['a serialization failure', { code: '40001', message: 'could not serialize access due to concurrent update' }],
  ['no connection left', { code: '53300', message: 'sorry, too many clients already' }],
  ['out of memory', { code: '53200', message: 'out of memory' }],
  ['the server shutting down', { code: '57P01', message: 'terminating connection due to administrator command' }],
  ['the server starting up', { code: '57P03', message: 'the database system is starting up' }],
  ['a connection that failed', { code: '08006', message: 'connection failure' }],
  ['a connection that could not be made', { code: '08001', message: 'unable to connect' }],
  ['PostgREST: no database', { code: 'PGRST000', message: 'Could not connect with the database' }],
  ['PostgREST: internal connection error', { code: 'PGRST001', message: 'Internal connection error' }],
  ['PostgREST: the schema cache is being rebuilt', { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }],
  ['PostgREST: the pool timed out', { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' }],
  // no code: the network, a gateway, a client that threw
  ['the network, as supabase-js words it', { message: 'TypeError: fetch failed' }],
  ['a refused connection', { message: 'connect ECONNREFUSED 10.0.0.1:443' }],
  ['a reset connection', { message: 'read ECONNRESET' }],
  ['a name that did not resolve', { message: 'getaddrinfo EAI_AGAIN db.example.supabase.co' }],
  ['a gateway page', { message: '<!DOCTYPE html><html><title>522: Connection timed out</title>' }],
  ['a gateway page with leading blanks', { message: '\n  <!DOCTYPE html><title>503 Service Unavailable</title>' }],
  ['a gateway status with no page', { message: 'upstream returned 504' }],
  ['a timeout, thrown as an Error', new Error('canceling statement due to statement timeout')],
  ['a timeout, thrown as a string', 'timeout'],
  ['a network failure, thrown as a string', 'fetch failed'],
  ['a node error code with no message', { code: 'ETIMEDOUT', message: '' }],
  ['an undici error code', { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Connect Timeout Error' }],
];
const fault = [
  // the database named it, and the name is a fault, whatever words the message carries
  ['a bad value whose text holds 502', { code: '22P02', message: 'invalid input syntax for type integer: "15022"' }],
  ['a bad value that IS 502', { code: '22P02', message: 'invalid input syntax for type integer: "502"' }],
  ['a missing column whose name holds "network"', { code: '42703', message: 'column "network_id" does not exist' }],
  ['no right on a schema called timeouts', { code: '42501', message: 'permission denied for schema "timeouts"' }],
  ['a missing function', { code: '42883', message: 'function called_phones_today(date, integer) does not exist' }],
  ['a missing table', { code: '42P01', message: 'relation "call_logs" does not exist' }],
  ['a broken constraint that mentions a timeout', { code: '23505', message: 'duplicate key value violates unique constraint "timeout_log_pkey"' }],
  ['a function that raised an exception', { code: 'P0001', message: 'raise exception: timeout' }],
  ['PostgREST: the function is not installed', { code: 'PGRST202', message: 'Could not find the function public.called_phones_today(p_day, p_min) in the schema cache' }],
  ['PostgREST: a column is missing', { code: 'PGRST204', message: 'Could not find the column in the schema cache' }],
  // no code, and not a bad moment
  ['a value with 502 inside a number', { message: 'invalid input syntax for type integer: "0754502123"' }],
  ['a bug of ours that mentions a timeout', new TypeError("Cannot read properties of undefined (reading 'timeout')")],
  ['a bug of ours: not a function', new TypeError('settings.timeout is not a function')],
  ['a bug of ours: not defined', new ReferenceError('network is not defined')],
  ['a message with nothing to say', { message: 'boom' }],
  ['an empty message', { message: '' }],
  ['a bare string with nothing to say', 'boom'],
  ['a status number thrown bare', 504],
];
const notErrors = [
  ['null', null], ['undefined', undefined], ['an empty string', ''], ['zero', 0], ['false', false], ['an empty object', {}],
  ['a null-prototype object', Object.create(null)],
  ['an object whose message getter throws', { get message() { throw new Error('x'); } }],
  ['an object whose code getter throws', { get code() { throw new Error('x'); } }],
  ['an object whose toString throws', { toString() { throw new Error('x'); } }],
  ['a Proxy that throws on every access', new Proxy({}, { get() { throw new Error('trap'); }, has() { throw new Error('trap'); } })],
];

test('a failure the database named is judged by its NAME: busy only for the busy ones, whatever words its message carries', () => {
  for (const [what, err] of busy.filter(([, e]) => e && e.code && /^([0-9A-Z]{5}|PGRST\d+)$/.test(e.code))) assert.equal(isBusyFailure(err), true, what);
  for (const [what, err] of fault.filter(([, e]) => e && e.code)) assert.equal(isBusyFailure(err), false, what);
});

test('a failure with no code is a bad moment only when its words are the network\'s or a gateway\'s, and never when it is a fault of our own', () => {
  for (const [what, err] of busy.filter(([, e]) => !(e && e.code && /^([0-9A-Z]{5}|PGRST\d+)$/.test(e.code)))) assert.equal(isBusyFailure(err), true, what);
  for (const [what, err] of fault.filter(([, e]) => !(e && e.code))) assert.equal(isBusyFailure(err), false, what);
});

test('nothing that is not an error, and nothing that cannot be read, is a bad moment, and nothing here ever throws', () => {
  for (const [what, err] of notErrors) {
    let r;
    assert.doesNotThrow(() => { r = isBusyFailure(err); }, what);
    assert.equal(r, false, what);
    assert.doesNotThrow(() => { errWords(err); }, what + ': its words for a log line');
    assert.equal(typeof errWords(err), 'string');
  }
});

test('errWords says an error\'s code and message on one line, cut at 160 characters, and says so when there was no error', () => {
  assert.equal(errWords({ code: '57014', message: 'canceling statement\n due to  statement timeout' }), '57014 canceling statement due to statement timeout');
  assert.equal(errWords({ message: 'x'.repeat(500) }).length, 160);
  assert.match(errWords(null), /no error, but an answer of a shape the app does not take/);
  assert.equal(errWords(Object.create(null)), 'an error that cannot be read as words');
});

test('isTransient, the retry test, keeps its meaning: it stays loose on purpose (a retry that is wrong costs nothing), and no longer throws on what cannot be read', () => {
  // the loose cases the stand-in test rejects are still retried: that is what "unchanged in meaning" is
  for (const [what, err] of [['a bad value that holds 502', { message: 'invalid input syntax for type integer: "15022"' }], ['a column named network_id', { message: 'column "network_id" does not exist' }],
    ['a statement timeout', { message: 'canceling statement due to statement timeout' }], ['the network', { message: 'TypeError: fetch failed' }], ['a gateway page', { message: '<!DOCTYPE html>' }],
    ['a thrown string', 'timeout']]) assert.equal(isTransient(err), true, what);
  for (const [what, err] of [['null', null], ['an ordinary message', { message: 'duplicate key value' }], ['nothing to say', { message: 'boom' }]]) assert.equal(isTransient(err), false, what);
  for (const [what, err] of notErrors) assert.doesNotThrow(() => isTransient(err), what);
  assert.equal(isTransient(Object.create(null)), false);
});
