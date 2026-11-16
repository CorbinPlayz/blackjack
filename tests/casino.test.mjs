// Step 4: the casino pot, max bets, the 5% dealer cut, and the pot running dry. Needs ./w.mjs (copy of worker/src/index.js).
import { Registry, Room } from './w.mjs';
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };
const mkStore = () => { const m = new Map(); return { m, storage: { get: async k => m.get(k), put: async (k, v) => void m.set(k, v), delete: async k => void m.delete(k), deleteAll: async () => m.clear(), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) } }; };
const regSt = mkStore(); const registry = new Registry({ storage: regSt.storage });
const env = { REGISTRY: { idFromName: () => 'main', get: () => ({ fetch: (u, i) => registry.fetch(new Request(u, i)) }) } };
const rooms = {};
const room = code => rooms[code] || (rooms[code] = { st: mkStore(), obj: null, tok: 'tok' + code });
const mk = (code, hostRef) => { const r = room(code); r.obj = new Room({ storage: r.st.storage }, env); return r; };
const call = async (path, body) => { const r = await registry.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) })); return Object.assign(await r.json(), { _s: r.status }); };
for (const e of ['a@x.com', 'b@x.com', 'c@x.com']) await call('/preapprove', { email: e });
const ref = {}; for (const [k, e] of [['A', 'a@x.com'], ['B', 'b@x.com'], ['C', 'c@x.com']]) ref[k] = (await call('/google', { deviceId: k.toLowerCase().repeat(32), email: e, name: k })).ref;
const bal = async k => (await call('/vault/get', { ref: ref[k] })).balance;
const init = async (code, hostRefKey) => { const T = mk(code); await T.obj.fetch(new Request('https://room/init', { method: 'POST', headers: hostRefKey ? { 'X-Ref': ref[hostRefKey] } : {}, body: JSON.stringify({ token: T.tok }) })); return T; };
const act = async (code, who, action) => {
  const r = room(code); const h = { 'X-Code': code, 'X-Ref': ref[who], 'X-Name': encodeURIComponent('Google ' + who) };
  const res = await r.obj.fetch(new Request('https://room/act', { method: 'POST', headers: h, body: JSON.stringify({ action }) }));
  return Object.assign(await res.json(), { _s: res.status });
};
const table = code => room(code).st.m.get('table');
const supply = () => regSt.m.get('supply') || 0;
const pot = () => (regSt.m.get('casino') || { pot: 0 }).pot;
const accounts = () => { let s = 0; for (const [k, v] of regSt.m) if (k.startsWith('v:')) s += v; return s; };
const onTables = () => { let s = 0; for (const c of Object.keys(rooms)) { const t = room(c).st.m.get('table'); if (t) s += t.players.reduce((a, p) => a + p.balance, 0) + ((t.house || 0) - (t.hs || 0)); } return s; };
const conserved = () => accounts() + onTables() + pot() === supply();

// ---- the casino is created with the first table and is part of the supply ----
const T = await init('CAS01', 'A');
ok(pot() === 10000000 && supply() === 10000000, 'the casino opens with a $100,000 pot, counted in the money supply');
ok(table('CAS01').hostRef === ref.A && table('CAS01').potStart === 10000000 && table('CAS01').epoch === 1 && table('CAS01').maxBet === 200000, 'the table remembers its host account, the pot at the start of the shift and a max bet of 2% of the pot');
ok(conserved(), 'invariant: accounts + seats + pot == supply');

// ---- max bet ----
await call('/bank/mint', { ref: ref.B, amount: 90000000, note: 'test' });   // $900,000 + the $1,000 grant (the grant is created by the mint call below via /vault/get)
let r = await act('CAS01', 'B', { type: 'seat', buyin: 600000 });
ok(r.ok, 'a player buys in for $6,000');
r = await act('CAS01', 'B', { type: 'bet', pid: 1, amount: 250000 });
ok(r._s === 400 && /max bet is \$2,000/i.test(r.error), 'a bet above 2% of the pot is refused: ' + r.error);
r = await act('CAS01', 'B', { type: 'bet', pid: 1, amount: 200000 });
ok(r.ok && table('CAS01').players[0].bet === 200000, 'a bet at the max is accepted');
r = await act('CAS01', 'B', { type: 'bet', pid: 1, amount: 0 });
// the max bet follows the pot
const c = regSt.m.get('casino'); const was = c.pot; c.pot = 5000; regSt.m.set('casino', c); regSt.m.set('supply', supply() - (was - 5000));   // test-only: shrink the pot (and the supply with it)
r = await act('CAS01', 'B', { type: 'bet', pid: 1, amount: 200 });
ok(r._s === 400 && /\$1\b/.test(r.error), 'the max bet shrinks with the pot: ' + r.error);
r = await act('CAS01', 'B', { type: 'bet', pid: 1, amount: 100 });
ok(r.ok && table('CAS01').maxBet === 100, 'a bet within the smaller cap works');
r = await act('CAS01', 'B', { type: 'bet', pid: 1, amount: 0 });
c.pot = was; regSt.m.set('casino', c); regSt.m.set('supply', supply() + (was - 5000));
ok(conserved(), 'invariant still holds');

// ---- real rounds move money through the pot ----
let moved = 0;
for (let i = 0; i < 6; i++) {
  const before = { seat: table('CAS01').players[0].balance, pot: pot() };
  await act('CAS01', 'B', { type: 'bet', pid: 1, amount: 100000 });
  const t0 = Date.now();
  // time is lazy: jump the table's clock by shifting every deadline into the past
  for (let k = 0; k < 40; k++) {
    const t = table('CAS01'); const D = t.deal;
    if (D.phase === 'acting') { await act('CAS01', 'B', { type: 'stand', pid: 1 }); }
    else if (D.phase === 'insurance') { await act('CAS01', 'B', { type: 'insure', pid: 1, take: false }); }
    else if (D.phase === 'results') break;
    else { D.deadline = 1; D.startedAt = 1; room('CAS01').st.m.set('table', t); await room('CAS01').obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'CAS01' } })); }
  }
  const after = { seat: table('CAS01').players[0].balance, pot: pot() };
  assert.ok(after.pot - before.pot === -(after.seat - before.seat), 'round ' + i + ': what the player won came out of the pot (and losses went in): seat ' + before.seat + '->' + after.seat + ', pot ' + before.pot + '->' + after.pot);
  assert.ok(table('CAS01').house === table('CAS01').hs, 'house is fully in the pot after every request');
  assert.ok(conserved(), 'round ' + i + ' conserved');
  moved += Math.abs(after.seat - before.seat);
  const tt = table('CAS01'); tt.deal.deadline = 1; room('CAS01').st.m.set('table', tt); await room('CAS01').obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'CAS01' } }));
}
ok(moved > 0, 'six real rounds were played; every win came out of the pot and every loss went into it (' + moved + ' cents moved)');

// ---- the pot cannot pay more than it holds ----
const T3 = mk('CAS03');
const reg0 = pot();
let tb = { players: [{ id: 1, name: 'W', start: 10000, balance: 10000, owner: ref.C }, { id: 2, name: 'X', start: 90000, balance: 90000, owner: ref.A }], history: [], settings: { auto: true, rounds: true }, house: -10000, hs: 0, funded: 80000 };
// pretend seat W just won 10,000 from a pot that now only holds 3,000
const cc = regSt.m.get('casino'); const old = cc.pot; cc.pot = 3000; regSt.m.set('casino', cc); regSt.m.set('supply', supply() - (old - 3000));
const t3 = (await import('./w.mjs')).normalizeTable(tb);
const sy = await T3.obj.bankSync(t3, 'clamp:1', []);
const taken = 10000 - 3000;
ok(sy.ok && pot() === 0 && regSt.m.get('casino').brokeAt > 0, 'the pot pays out what it has left and then is broke (the time is recorded)');
ok(t3.house === -3000 && t3.hs === t3.house && t3.players.reduce((a, p) => a + p.balance, 0) === 100000 - taken, 'the part the pot could not pay is taken back from the seats: ' + taken + ' cents');
const dup = await T3.obj.bankSync(normalizeClone(), 'clamp:1', []);
function normalizeClone() { return JSON.parse(JSON.stringify(t3)); }
regSt.m.set('supply', accounts() + onTables() + pot());   // the throw-away clamp table above was never stored: resync the test's books
ok(dup.ok, 'replaying the same pot payment is answered from the log');

// ---- the dealer cut ----
const mkCutTable = async (code, hostKey, potStart, profit) => {
  const X = await init(code, hostKey);
  const t = table(code); t.potStart = potStart; t.epoch = 1; room(code).st.m.set('table', t);
  r = await act(code, 'C', { type: 'seat', buyin: 50000 });
  const t2 = table(code); t2.players[0].balance -= profit; t2.house += profit; room(code).st.m.set('table', t2);   // the casino "won" this much at the table
  return X;
};
// reset the pot to a clean $100,000 so the numbers are easy
{ const x = regSt.m.get('casino'); x.pot = 10000000; x.brokeAt = 0; regSt.m.set('casino', x); regSt.m.set('supply', accounts() + onTables() + pot()); }
const aBefore = await bal('A'), cBefore = await bal('C');
await mkCutTable('CAS10', 'A', 10000000 - 1000, 20000);   // the pot will be above where the shift began
const m = room('CAS10').st.m.get('meta'); m.updated = Date.now() - 25 * 3600 * 1000; room('CAS10').st.m.set('meta', m);
await room('CAS10').obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'CAS10' } }));
const gain = (await bal('A')) - aBefore;
ok(gain === 1000, 'the host earned 5% of the casino profit (5% of $200 = $10), paid from the pot: got ' + gain);
ok(!room('CAS10').st.m.has('table') && conserved(), 'the closed table is gone and the money is all accounted for');
// no cut when the pot ended below where it started
const a2 = await bal('A');
await mkCutTable('CAS11', 'A', 50000000, 20000);
const m2 = room('CAS11').st.m.get('meta'); m2.updated = Date.now() - 25 * 3600 * 1000; room('CAS11').st.m.set('meta', m2);
await room('CAS11').obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'CAS11' } }));
ok((await bal('A')) === a2 && conserved(), 'no cut when the pot ended the shift below where it started');
// no cut for a table that lost money
const a3 = await bal('A');
await mkCutTable('CAS12', 'A', 1, -20000);
const m3 = room('CAS12').st.m.get('meta'); m3.updated = Date.now() - 25 * 3600 * 1000; room('CAS12').st.m.set('meta', m3);
await room('CAS12').obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'CAS12' } }));
ok((await bal('A')) === a3 && conserved(), 'no cut when the casino lost money at the table');
// ---- the host can play at their own online dealer table ----
{
  await init('CAS20', 'A');
  const hostAct = async action => { const res = await room('CAS20').obj.fetch(new Request('https://room/act', { method: 'POST', headers: { 'X-Code': 'CAS20', 'X-Ref': ref.A, 'X-Name': encodeURIComponent('Host Google'), Authorization: 'Bearer ' + room('CAS20').tok }, body: JSON.stringify({ action }) })); return Object.assign(await res.json(), { _s: res.status }); };
  const a0 = await bal('A');
  let rr = await hostAct({ type: 'seat', buyin: 10000 });
  ok(rr.ok && (await bal('A')) === a0 - 10000 && table('CAS20').players[0].owner === ref.A, 'the host takes a seat at their own online dealer table, paid from their bank account');
  rr = await hostAct({ type: 'bet', pid: 1, amount: 5000 });
  ok(rr.ok && table('CAS20').players[0].bet === 5000, 'and can place a wager like any player');
  rr = await hostAct({ type: 'settle', pid: 1, outcome: 'win' });
  ok(rr._s === 400, 'but still cannot settle their own hand (the server dealer does that)');
  ok(conserved(), 'invariant holds');
}
console.log('ALL', n, 'CASINO CHECKS PASSED');
