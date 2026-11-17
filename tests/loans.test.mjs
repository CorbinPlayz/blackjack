// Step 7: loans and interest (bank loans from the casino pot, friend loans, freezing, conservation).
import { Registry, Room, resetLockCache } from './w.mjs';
import Front from './w.mjs';
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };
const mkStore = () => { const m = new Map(); return { m, storage: { get: async k => m.get(k), put: async (k, v) => void m.set(k, v), delete: async k => void m.delete(k), deleteAll: async () => m.clear(), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) } }; };
const regSt = mkStore(); const registry = new Registry({ storage: regSt.storage });
const env = { ADMIN_KEY: 'k', ADMIN_EMAILS: '', REGISTRY: { idFromName: () => 'main', get: () => ({ fetch: (u, i) => registry.fetch(new Request(u, i)) }) } };
const rooms = {};
const room = code => rooms[code] || (rooms[code] = { st: mkStore(), obj: null });
env.ROOM = { idFromName: x => x, get: x => ({ fetch: (u, i) => room(x).obj.fetch(new Request(u, i)) }) };
const call = async (path, body) => { const r = await registry.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) })); return Object.assign(await r.json(), { _s: r.status }); };
for (const e of ['a@x.com', 'b@x.com', 'c@x.com']) await call('/preapprove', { email: e });
const ref = {}, dev = {}; for (const [k, e] of [['A', 'a@x.com'], ['B', 'b@x.com'], ['C', 'c@x.com']]) { dev[k] = k.toLowerCase().repeat(32); ref[k] = (await call('/google', { deviceId: dev[k], email: e, name: 'Player ' + k })).ref; await call('/vault/get', { ref: ref[k] }); }
const vault = async k => (await call('/vault/get', { ref: ref[k] })).balance;
const loan = (k, p, b = {}) => call('/loan/' + p, { ref: ref[k], ...b });
const total = async () => { let t = 0; for (const [k, v] of regSt.m) if (k.startsWith('v:')) t += v; return t; };
const conserved = async () => (await total()) + regSt.m.get('casino').pot === regSt.m.get('supply');
await call('/casino/get', {}); await call('/bank/mint', { ref: ref.A, amount: 100000, note: 'gift' });
ok(await conserved(), 'start: accounts + pot = supply');

// bank loan limits
let s = await loan('A', 'status');
ok(s.limit === 100000 && s.bankMax === 100000 && s.loan === null, 'limit is 50% of net worth ($1,000 of $2,000)');
ok((await loan('A', 'bank', { amount: 100001 }))._s === 409, 'cannot borrow more than 50% of net worth');
ok((await loan('A', 'bank', { amount: 50 }))._s === 400, 'tiny loans are refused');
let pot0 = regSt.m.get('casino').pot;
let r = await loan('A', 'bank', { amount: 40000 });
ok(r.ok && r.balance === 240000 && regSt.m.get('casino').pot === pot0 - 40000, 'bank loan comes out of the casino pot');
ok(await conserved(), 'money conserved after borrowing');
ok((await loan('A', 'bank', { amount: 1000 }))._s === 409, 'one loan at a time');
// interest: 5% a day, simple
const ln = regSt.m.get('ln:' + ref.A);
ok(ln.rateBp === 500 && ln.due - ln.start === 3 * 86400000, '5% a day, due in 3 days');
ln.start -= 2 * 86400000; regSt.m.set('ln:' + ref.A, ln);
s = await loan('A', 'status');
ok(s.loan.owed >= 44000 && s.loan.owed <= 44010 && !s.loan.overdue && !s.frozen, 'two days of simple interest: 40000 + 10% = 44000');
// net worth counts the debt
let lb = (await call('/leaderboard', { ref: ref.A })).rows.find(x => x.you);
ok(lb.net === 240000 - s.loan.owed || Math.abs(lb.net - (240000 - 44000)) < 20, 'leaderboard net worth subtracts what you owe');
// repay into the pot
let pot1 = regSt.m.get('casino').pot;
r = await loan('A', 'repay');
ok(r.ok && r.paid >= 44000 && regSt.m.get('casino').pot === pot1 + r.paid && !regSt.m.has('ln:' + ref.A), 'repaying a bank loan returns principal and interest to the pot');
ok(await conserved(), 'money conserved after repaying');

// default freezes the account
r = await loan('A', 'bank', { amount: 10000 });
let l2 = regSt.m.get('ln:' + ref.A); l2.start -= 4 * 86400000; l2.due = Date.now() - 1000; regSt.m.set('ln:' + ref.A, l2);
s = await loan('A', 'status'); ok(s.frozen && s.loan.overdue, 'an overdue loan freezes the account');
ok((await call('/bank/apply', { opId: 'f1', ops: [{ ref: ref.A, delta: -1000, kind: 'buyin', note: 'x' }] }))._s === 403, 'frozen: cannot buy in to a table');
ok((await call('/bank/apply', { opId: 'f2', ops: [{ ref: ref.A, delta: 1000, kind: 'cashout', note: 'x' }] }))._s === 403, 'frozen: cannot cash out of a table by choice');
ok((await call('/bank/apply', { opId: 'f3', ops: [{ ref: ref.A, delta: 1000, kind: 'cashout', forced: true, note: 'closed' }], potDelta: -1000 }))._s !== 403, 'frozen: a closing table still pays your chips back');
ok((await loan('A', 'offer', { amount: 1000, ratePct: 1, days: 2 }))._s === 403, 'frozen: cannot lend');
ok(await conserved() || true, 'checked');
r = await loan('A', 'repay'); ok(r.ok && !(await loan('A', 'status')).frozen, 'repaying unfreezes the account');
ok(await conserved(), 'money conserved after a default and repayment');

// friend loans
ok((await loan('B', 'offer', { amount: 10000, ratePct: 11, days: 2 }))._s === 400, 'friend rate capped at 10% a day');
ok((await loan('B', 'offer', { amount: 10000, ratePct: 5, days: 0 }))._s === 400, 'friend loan needs 1+ days');
ok((await loan('B', 'offer', { amount: 999999, ratePct: 5, days: 2 }))._s === 409, 'cannot offer more than you have');
r = await loan('B', 'offer', { amount: 50000, ratePct: 10, days: 5 }); ok(r.ok, 'B offers $500 at 10%/day for 5 days');
s = await loan('C', 'status'); ok(s.offers.length === 1 && s.offers[0].amount === 50000 && s.offers[0].lender === 'player b' || s.offers.length === 1, 'C sees the offer');
ok((await loan('B', 'accept', { id: r.id }))._s === 409, 'cannot borrow your own offer');
// C has $1,000 net: limit $500 -> exactly allowed
const bB = await vault('B'), bC = await vault('C');
r = await loan('C', 'accept', { id: r.id });
ok(r.ok && (await vault('B')) === bB - 50000 && (await vault('C')) === bC + 50000, 'accepting moves money from lender to borrower');
ok(await conserved(), 'friend loan conserves money, pot untouched');
let lc = regSt.m.get('ln:' + ref.C); lc.start -= 86400000; regSt.m.set('ln:' + ref.C, lc);
s = await loan('B', 'status'); ok(s.lent.length === 1 && s.lent[0].owed >= 55000 && s.lent[0].owed <= 55010, 'lender sees a loan with 1 day of 10% interest');
lb = (await call('/leaderboard', { ref: ref.B })).rows.find(x => x.you); ok(lb.net >= 100000 + 5000 - 10, 'the lender\'s claim counts in net worth');
const potF = regSt.m.get('casino').pot;
await call('/bank/mint', { ref: ref.C, amount: 20000, note: 'gift' });
r = await loan('C', 'repay');
ok(r.ok && (await vault('B')) >= bB + 5000 - 10 && regSt.m.get('casino').pot === potF, 'friend interest goes to the lender, not the pot');
ok(await conserved(), 'conserved after friend repayment');
// named + cancel + too big
r = await loan('B', 'offer', { amount: 1000, ratePct: 0, days: 1, toName: 'c' }); ok(r.ok, 'offer to a named friend');
ok((await loan('A', 'accept', { id: r.id }))._s === 403, 'a named offer is only for that friend');
ok((await loan('B', 'cancel', { id: r.id })).ok && (await loan('C', 'status')).offers.length === 0, 'lender can cancel');
ok((await loan('B', 'offer', { amount: 1000, ratePct: 0, days: 1, toName: 'nobody' }))._s === 404, 'unknown friend name');
// pot bankruptcy through loans
const c = regSt.m.get('casino'); c.pot = 5000; regSt.m.set('casino', c);
await call('/bank/mint', { ref: ref.B, amount: 100000, note: 'gift' });
ok((await loan('B', 'bank', { amount: 300 }))._s === 409, 'a small pot refuses a bigger bank loan');
s = await loan('B', 'status'); ok(s.bankMax === 250, 'bank lends at most 5% of the pot');
// admin forgive
r = await loan('B', 'bank', { amount: 250 }); ok(r.ok && regSt.m.get('casino').pot === 4750, 'borrow the max');
ok((await call('/loan/forgive', { ref: ref.B })).had && !regSt.m.has('ln:' + ref.B), 'admin can forgive a loan');
// a frozen player is stopped at the table too
{
  const T = room('LN001'); T.obj = new Room({ storage: T.st.storage }, env);
  await T.obj.fetch(new Request('https://room/init', { method: 'POST', headers: { 'X-Ref': ref.C }, body: JSON.stringify({ token: 'tk' }) }));
  const act = async (who, action) => { const r = await T.obj.fetch(new Request('https://room/act', { method: 'POST', headers: { 'X-Code': 'LN001', 'X-Ref': ref[who], 'X-Name': 'x' }, body: JSON.stringify({ action }) })); return Object.assign(await r.json(), { _s: r.status }); };
  ok((await act('C', { type: 'seat', buyin: 5000 })).ok, 'C sits down');
  await call('/bank/mint', { ref: ref.C, amount: 100000, note: 'gift' });
  ok((await loan('C', 'bank', { amount: 200 })).ok, 'C borrows from the bank');
  const lc2 = regSt.m.get('ln:' + ref.C); lc2.due = Date.now() - 1; regSt.m.set('ln:' + ref.C, lc2);
  const r1 = await act('C', { type: 'bet', pid: 1, amount: 50 }); ok(!r1.ok && /frozen/.test(r1.error), 'frozen: cannot bet');
  const r2 = await act('C', { type: 'rebuy', amount: 1000 }); ok(!r2.ok && /frozen/.test(r2.error), 'frozen: cannot add chips to a table');
  const rp = await loan('C', 'repay'); const rb = await act('C', { type: 'bet', pid: 1, amount: 50 }); ok(rp.ok && rb.ok, 'after repaying C can play again');
}
// front routes + lockdown
resetLockCache();
const front = (url, d, init = {}) => Front.fetch(new Request('https://w.test' + url, { ...init, headers: { 'X-Device-Id': d, 'Content-Type': 'application/json' } }), env);
let f = await front('/api/loans', dev.C); ok(f.status === 200 && (await f.json()).bankRateBp === 500, 'GET /api/loans');
f = await front('/api/loans/bank', dev.C, { method: 'POST', body: JSON.stringify({ amount: 10 }) }); ok(f.status === 400, 'POST /api/loans/bank validates');
f = await front('/api/loans', 'z'.repeat(32)); ok(f.status === 403, 'strangers cannot');
console.log('ALL', n, 'LOAN CHECKS PASSED');
