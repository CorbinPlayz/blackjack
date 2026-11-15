// Step 2: every online chip comes from, and returns to, a bank account. Needs ./w.mjs (copy of worker/src/index.js).
// Real Room + Registry classes with in-memory storage, so this exercises the same code path as production.
import { Registry, Room } from './w.mjs';
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };

const mkStore = () => { const m = new Map(); return { m, storage: { get: async k => m.get(k), put: async (k, v) => void m.set(k, v), delete: async k => void m.delete(k), deleteAll: async () => m.clear(), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) } }; };
const regSt = mkStore(); const registry = new Registry({ storage: regSt.storage });
const env = { REGISTRY: { idFromName: () => 'main', get: () => ({ fetch: (u, i) => registry.fetch(new Request(u, i)) }) } };
const rooms = {};
const room = code => rooms[code] || (rooms[code] = { st: mkStore(), obj: null, tok: 'tok' + code });
const mk = code => { const r = room(code); r.obj = new Room({ storage: r.st.storage }, env); return r; };
const call = async (path, body) => { const r = await registry.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) })); return Object.assign(await r.json(), { _s: r.status }); };

for (const e of ['a@x.com', 'b@x.com', 'c@x.com']) await call('/preapprove', { email: e });
const ref = {}; for (const [k, e] of [['A', 'a@x.com'], ['B', 'b@x.com'], ['C', 'c@x.com']]) ref[k] = (await call('/google', { deviceId: k.toLowerCase().repeat(32), email: e, name: k })).ref;
const bal = async k => (await call('/vault/get', { ref: ref[k] })).balance;

// ---- a table ----
const T = mk('TBL01');
await T.obj.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ token: T.tok }) }));
const act = async (code, who, action) => {          // who: 'H' = host, or an account letter
  const r = room(code);
  const h = { 'X-Code': code, 'X-Ref': who === 'H' ? ref.A : ref[who] };
  if (who === 'H') h.Authorization = 'Bearer ' + r.tok;
  const res = await r.obj.fetch(new Request('https://room/act', { method: 'POST', headers: h, body: JSON.stringify({ action }) }));
  return Object.assign(await res.json(), { _s: res.status });
};
const table = code => room(code).st.m.get('table');
const supply = () => regSt.m.get('supply') || 0;
const accounts = () => { let s = 0; for (const [k, v] of regSt.m) if (k.startsWith('v:')) s += v; return s; };
const onTables = () => { let s = 0; for (const c of Object.keys(rooms)) { const t = room(c).st.m.get('table'); if (t) s += t.players.reduce((a, p) => a + p.balance, 0) + (t.house || 0); } return s; };
const conserved = () => accounts() + onTables() === supply();

ok((await bal('A')) === 100000 && (await bal('B')) === 100000 && (await bal('C')) === 100000 && supply() === 300000, 'every account is granted $1,000 once, even before it opens the bank page');
ok(conserved(), 'invariant: accounts + chips on tables + house == total created');

let r = await act('TBL01', 'H', { type: 'add', name: 'Free', start: 99999999 });
ok(r._s === 400 && /bank account/.test(r.error) && table('TBL01').players.length === 0, 'host cannot add free chips');
r = await act('TBL01', 'B', { type: 'seat', name: 'Bea', buyin: 150000 });
ok(r._s === 400 && /Not enough money/.test(r.error) && (await bal('B')) === 100000, 'cannot buy in for more than the account holds');
r = await act('TBL01', 'B', { type: 'seat', name: 'Bea', buyin: 40000 });
ok(r.ok && (await bal('B')) === 60000 && r.vaultBalance === 60000 && table('TBL01').players[0].balance === 40000, 'buy-in debits the account and seats the chips');
ok(conserved(), 'invariant holds after a buy-in');
r = await act('TBL01', 'C', { type: 'seat', name: 'Cy', buyin: 20000 });
ok(r.ok && (await bal('C')) === 80000, 'second player buys in');

// bank trip = your own money, fee stays with the house
r = await act('TBL01', 'B', { type: 'rebuy', pid: 1, amount: 10000 });
ok(r.ok && r.fee === 1000 && (await bal('B')) === 50000 && table('TBL01').players[0].balance === 49000 && table('TBL01').house === 1000, 'bank trip debits the account; the 10% fee goes to the house');
r = await act('TBL01', 'H', { type: 'rebuy', pid: 1, amount: 100 });
ok(r._s === 400 && /Only the player/.test(r.error), 'the host cannot spend a player\'s account');
r = await act('TBL01', 'C', { type: 'rebuy', pid: 2, amount: 90000 });
ok(r._s === 400 && /Not enough money/.test(r.error) && (await bal('C')) === 80000, 'a bank trip cannot exceed the account');
ok(conserved(), 'invariant holds after bank trips');

// self-dealing is closed
await act('TBL01', 'B', { type: 'bet', pid: 1, amount: 5000 }); await act('TBL01', 'C', { type: 'bet', pid: 2, amount: 5000 });
ok((await act('TBL01', 'H', { type: 'start' })).ok, 'round starts');
r = await act('TBL01', 'B', { type: 'settle', pid: 1, outcome: 'win' });
ok(r._s === 400 && /own hand|only change your own|dealer/i.test(r.error) && table('TBL01').players[0].balance === 49000, 'a player cannot settle their own win');
r = await act('TBL01', 'B', { type: 'settle', pid: 2, outcome: 'loss' });
ok(r._s === 400, 'a player cannot settle someone else either');
r = await act('TBL01', 'H', { type: 'settle', pid: 1, outcome: 'win' });
ok(r.ok && table('TBL01').players[0].balance === 54000 && table('TBL01').house === -4000, 'the dealer settles; the win comes out of the house, not thin air');
ok(conserved(), 'invariant holds after a win');
r = await act('TBL01', 'B', { type: 'undo' });
ok(r._s === 400 && /Only the dealer/.test(r.error), 'a player cannot undo a loss to get chips back');
r = await act('TBL01', 'H', { type: 'settle', pid: 2, outcome: 'loss' });
ok(r.ok && table('TBL01').house === 1000, 'loss goes to the house');
r = await act('TBL01', 'H', { type: 'undo' });
ok(r.ok && table('TBL01').house === -4000 && conserved(), 'dealer undo reverses the house too and the invariant holds');
await act('TBL01', 'H', { type: 'settle', pid: 2, outcome: 'loss' });

// bank moves cannot be undone for free money
await act('TBL01', 'B', { type: 'rebuy', pid: 1, amount: 1000 });
r = await act('TBL01', 'H', { type: 'undo' });
ok(r._s === 400 && /Bank moves/.test(r.error), 'a bank trip cannot be undone (that would refund chips twice)');

// trivia = the only new money
const sBefore = supply();
r = await act('TBL01', 'B', { type: 'trivia', pid: 1 });
ok(r.ok && supply() === sBefore + r.delta && conserved(), 'trivia winnings are minted into the supply and the invariant still holds');

// cash-out
r = await act('TBL01', 'B', { type: 'vault_deposit', pid: 1, amount: 3000 });
ok(r.ok && r.vaultBalance === (await bal('B')) && conserved(), 'saving chips credits the account');
await act('TBL01', 'H', { type: 'settings', rounds: false });
await act('TBL01', 'H', { type: 'settings', rounds: true });
await act('TBL01', 'B', { type: 'bet', pid: 1, amount: 100 }); await act('TBL01', 'H', { type: 'start', force: true });
r = await act('TBL01', 'B', { type: 'remove', pid: 1 });
ok(r._s === 400 && /Finish the hand/.test(r.error), 'cannot walk away mid-hand');
await act('TBL01', 'H', { type: 'finish' });
const seatB = table('TBL01').players.find(p => p.owner === ref.B).balance, acctB = await bal('B');
r = await act('TBL01', 'B', { type: 'remove', pid: 1 });
ok(r.ok && (await bal('B')) === acctB + seatB && conserved(), 'leaving pays the chips back to the account exactly');
r = await act('TBL01', 'H', { type: 'remove', pid: 2 });
ok(r.ok && table('TBL01').players.length === 0 && conserved(), 'host removing a player also pays them back');
ok(table('TBL01').funded === table('TBL01').house, 'with no seats left the table holds only the house position');

// reset creates nothing
await act('TBL01', 'C', { type: 'seat', name: 'Cy', buyin: 1000 });
const tot = accounts() + onTables(); await act('TBL01', 'H', { type: 'reset' });
ok(accounts() + onTables() === tot && conserved(), 'reset creates and destroys no chips');

// apply is idempotent
const o = { opId: 'dup:1', ops: [{ ref: ref.A, delta: -100, kind: 'buyin', note: 'x' }] };
const b1 = await bal('A'); await call('/bank/apply', o); const d = await call('/bank/apply', o);
ok(d.dup === true && (await bal('A')) === b1 - 100, 'replaying the same bank operation is ignored (no double spend)');
await call('/bank/apply', { opId: 'dup:2', ops: [{ ref: ref.A, delta: 100, kind: 'cashout', note: 'put the test cents back' }] });
ok((await call('/bank/apply', { opId: 'neg:1', ops: [{ ref: ref.A, delta: -99999999, kind: 'buyin', note: '' }] }))._s === 409, 'the bank refuses to go below zero');
ok((await call('/bank/apply', { opId: 'bad:1', ops: [{ ref: ref.A, delta: 5, kind: 'mint', note: '' }] }))._s === 400, 'clients cannot pass off a mint as a table move');

// table expiry pays everyone back
await act('TBL01', 'B', { type: 'seat', name: 'Bea', buyin: 5000 });
const before = accounts() + onTables(); const table0house = room('TBL01').st.m.get('table').house; const m = room('TBL01').st.m.get('meta'); m.updated = Date.now() - 25 * 3600 * 1000; room('TBL01').st.m.set('meta', m);
r = await room('TBL01').obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'TBL01' } }));
ok(r.status === 404 && accounts() === before - table0house && conserved() && !room('TBL01').st.m.has('table'), 'an expired table pays every seat back before it is wiped');

// seeding a table from a local game gives no chips
const T2 = mk('TBL02'); await T2.obj.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ token: T2.tok }) }));
r = await T2.obj.fetch(new Request('https://room/state', { method: 'PUT', headers: { Authorization: 'Bearer ' + T2.tok, 'X-Code': 'TBL02' }, body: JSON.stringify({ state: { players: [{ id: 1, name: 'Free', start: 99999999, balance: 99999999 }], history: [] } }) }));
ok(r.status === 200 && table('TBL02').players.length === 0, 'starting an online table from a local game imports no free chips');

// ---- randomized: nothing anyone does can break the invariant ----
let seed = 987654321; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const codes = ['TBL02', 'TBL03']; mk('TBL03'); await room('TBL03').obj.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ token: room('TBL03').tok }) }));
let accepted = 0, total = 0;
for (let i = 0; i < 6000; i++) {
  const code = codes[ri(0, 1)], who = ['H', 'A', 'B', 'C'][ri(0, 3)], t = table(code), pid = t.players.length ? t.players[ri(0, t.players.length - 1)].id : 1;
  const amt = [0, 7, 100, 100, 500, 2500, 2500, 10000, 50000, 99999999, -5][ri(0, 10)];
  const a = [
    { type: 'seat', name: 'P' + ri(1, 9), buyin: amt }, { type: 'add', name: 'F', start: amt }, { type: 'rebuy', pid, amount: amt },
    { type: 'bet', pid, amount: amt }, { type: 'start', force: rnd() < .5 }, { type: 'double', pid },
    { type: 'settle', pid, outcome: ['win', 'loss', 'blackjack', 'push'][ri(0, 3)] }, { type: 'insurance', pid, result: ['win', 'loss'][ri(0, 1)] },
    { type: 'trivia', pid }, { type: 'vault_deposit', pid, amount: amt }, { type: 'vault_withdraw', pid, amount: amt },
    { type: 'finish' }, { type: 'undo' }, { type: 'remove', pid }, { type: 'reset' }, { type: 'sitout', pid, out: rnd() < .5 },
  ][ri(0, 15)];
  const res = await act(code, who, a); total++; if (res.ok) accepted++;
  assert.ok(conserved(), 'INVARIANT BROKEN after ' + JSON.stringify([code, who, a]) + ' accounts=' + accounts() + ' tables=' + onTables() + ' supply=' + supply());
  for (const k of Object.keys(ref)) assert.ok((await bal(k)) >= 0, 'negative account');
}
ok(true, 'randomized: ' + total + ' actions (' + accepted + ' accepted) by 3 accounts and 2 hosts: accounts + chips + house == supply after every single one');
console.log('ALL', n, 'FUNDED-TABLE CHECKS PASSED');
