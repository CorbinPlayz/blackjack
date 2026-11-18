// Craps against the real bank and casino pot: wins come out of the pot, losses go into it, nothing is created or lost.
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
const R = room('CRP01'); R.obj = new Room({ storage: R.st.storage }, env);
await R.obj.fetch(new Request('https://room/init', { method: 'POST', headers: { 'X-Ref': ref.A }, body: JSON.stringify({ token: 'tok', game: 'craps' }) }));
const act = async (who, action) => { const r = await R.obj.fetch(new Request('https://room/act', { method: 'POST', headers: { 'X-Code': 'CRP01', 'X-Ref': ref[who], 'X-Name': encodeURIComponent(who) }, body: JSON.stringify({ action }) })); return Object.assign(await r.json(), { _s: r.status }); };
const get = async () => (await (await R.obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'CRP01' } }))).json());
const table = () => R.st.m.get('table');
const supply = () => regSt.m.get('supply'), pot = () => regSt.m.get('casino').pot;
const accounts = () => { let s = 0; for (const [k, v] of regSt.m) if (k.startsWith('v:')) s += v; return s; };
const seats = () => !table() ? 0 : table().players.reduce((a, p) => a + p.balance, 0) + (table().house - table().hs);
const conserved = () => accounts() + seats() + pot() === supply();
ok(table().settings.game === 'craps', 'the table was created as a craps table');
ok((await act('A', { type: 'seat', buyin: 100000 })).ok && (await act('B', { type: 'seat', buyin: 100000 })).ok, 'two players buy in from their bank accounts');
ok(conserved(), 'conserved after buy-ins');
ok((await act('A', { type: 'cbet', k: 'anycraps', a: 25000 })).ok && (await act('A', { type: 'cclear' })).ok, 'the biggest allowed bet (25% of chips) is accepted and can be cleared');
for (let i = 0; i < 150; i++) {
  clock += 6500; await get();
  for (const w of ['A', 'B']) {
    const T = table().craps, kinds = T.phase === 'come' ? ['pass', 'dp', 'field', 'any7', 'anycraps'] : ['odds_pass', 'odds_dp', 'field', 'any7', 'anycraps'];
    await act(w, { type: 'cbet', k: kinds[Math.floor(Math.random() * kinds.length)], a: 500 });
    await act(w, { type: 'cbet', k: 'field', a: 500 });
  }
  assert.ok(conserved(), 'conserved with bets on the table ' + i);
  clock += 20500; await get();
  assert.ok(conserved(), 'conserved after roll ' + i);
}
ok(table().craps.n > 100 && conserved(), table().craps.n + ' rolls, money conserved');
ok(!JSON.stringify(await get()).includes('"deck"'), 'nothing secret in the table data');
const before = await bal('A'); const chips = table().players.find(p => p.owner === ref.A).balance;
const lv = await act('A', { type: 'remove', pid: table().players.find(p => p.owner === ref.A).id });
ok(lv.ok && (await bal('A')) === before + chips && conserved(), 'leaving cashes the chips out to the bank account');
Date.now = real;
console.log('ALL', n, 'CRAPS BANK CHECKS PASSED');
