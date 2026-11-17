// Roulette against the real bank and casino pot: wins come out of the pot, losses go into it, nothing is created or lost.
import { Registry, Room, _setStartGrant } from './w.mjs';
_setStartGrant(100000);
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };
const mkStore = () => { const m = new Map(); return { m, storage: { get: async k => m.get(k), put: async (k, v) => void m.set(k, v), delete: async k => void m.delete(k), deleteAll: async () => m.clear(), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) } }; };
const regSt = mkStore(); const registry = new Registry({ storage: regSt.storage });
const env = { REGISTRY: { idFromName: () => 'main', get: () => ({ fetch: (u, i) => registry.fetch(new Request(u, i)) }) } };
const rooms = {}; const room = code => rooms[code] || (rooms[code] = { st: mkStore(), obj: null });
const call = async (path, body) => { const r = await registry.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) })); return Object.assign(await r.json(), { _s: r.status }); };
for (const e of ['a@x.com', 'b@x.com']) await call('/preapprove', { email: e });
const ref = {}; for (const [k, e] of [['A', 'a@x.com'], ['B', 'b@x.com']]) ref[k] = (await call('/google', { deviceId: k.toLowerCase().repeat(32), email: e, name: k })).ref;
const bal = async k => (await call('/vault/get', { ref: ref[k] })).balance;
const real = Date.now; let clock = real.call(Date); Date.now = () => clock;
const R = room('RUL01'); R.obj = new Room({ storage: R.st.storage }, env);
await R.obj.fetch(new Request('https://room/init', { method: 'POST', headers: { 'X-Ref': ref.A }, body: JSON.stringify({ token: 'tok', game: 'roulette' }) }));
const act = async (who, action) => { const r = await R.obj.fetch(new Request('https://room/act', { method: 'POST', headers: { 'X-Code': 'RUL01', 'X-Ref': ref[who], 'X-Name': encodeURIComponent(who) }, body: JSON.stringify({ action }) })); return Object.assign(await r.json(), { _s: r.status }); };
const get = async () => (await (await R.obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'RUL01' } }))).json());
const table = () => R.st.m.get('table');
const supply = () => regSt.m.get('supply'), pot = () => regSt.m.get('casino').pot;
const accounts = () => { let s = 0; for (const [k, v] of regSt.m) if (k.startsWith('v:')) s += v; return s; };
const seats = () => !table() ? 0 : table().players.reduce((a, p) => a + p.balance, 0) + (table().house - table().hs);
const conserved = () => accounts() + seats() + pot() === supply();
ok(table().settings.game === 'roulette', 'the table was created as a roulette table');
ok((await act('A', { type: 'seat', buyin: 100000 })).ok && (await act('B', { type: 'seat', buyin: 100000 })).ok, 'two players buy in from their bank accounts');
ok(conserved(), 'conserved after buy-ins');
ok((await act('A', { type: 'rbet', k: 'num', sel: [5], a: 25000 })).error.match(/pays at most/), 'a straight-up that could win more than 2% of the pot is refused');
ok((await act('A', { type: 'rbet', k: 'num', sel: [5], a: 500 })).ok && (await act('B', { type: 'rbet', k: 'red', sel: [], a: 2000 })).ok, 'bets are accepted');
const pot0 = pot();
let guard = 0, spun = 0;
while (spun < 1 && guard++ < 10) { clock += 31000; await get(); if (table().roul.phase === 'results') spun++; }
const t = table(); const nets = t.players.map(p => p.rl ? p.rl.net : 0);
ok(spun === 1 && t.roul.num >= 0, 'the wheel spun after the window: ' + t.roul.num);
ok(pot() === pot0 - nets[0] - nets[1], 'the casino pot moved by exactly the players\' net result (' + (nets[0] + nets[1]) + ')');
ok(conserved(), 'conserved after the spin');
// many spins, with both players betting every time
for (let i = 0; i < 40; i++) {
  clock += 9000; await get();
  for (const w of ['A', 'B']) { const k = ['red', 'black', 'odd', 'even', 'low', 'high'][i % 6]; await act(w, { type: 'rbet', k, sel: [], a: 1000 }); await act(w, { type: 'rbet', k: 'num', sel: [i % 38], a: 500 }); }
  clock += 31000; await get();
  assert.ok(conserved(), 'conserved on spin ' + i);
}
ok(table().roul.n > 30 && conserved(), '40 more spins: ' + table().roul.n + ' in total, money still conserved');
// leaving returns chips to the account; the pot keeps the house result
clock += 9000; await get();
const before = await bal('A'); const chips = table().players.find(p => p.owner === ref.A).balance;
const lv = await act('A', { type: 'remove', pid: table().players.find(p => p.owner === ref.A).id });
ok(lv.ok && (await bal('A')) === before + chips && conserved(), 'leaving cashes the chips out to the bank account');
// idle close: nobody acts for 5 minutes, B is cashed out
clock += 6 * 60 * 1000; await get(); await R.obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'RUL01' } }));
ok(!R.st.m.get('meta') && conserved(), 'an idle roulette table closes and cashes everybody out');
Date.now = real;
console.log('ALL', n, 'ROULETTE BANK CHECKS PASSED');
