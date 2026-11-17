// Casino lobby: open tables are listed (game, host, seats), updated as people sit, and drop out when the table closes.
import Front, { Registry, Room, _setStartGrant } from './w.mjs';
_setStartGrant(100000);
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };
const mk = () => { const m = new Map(); return { m, storage: { get: async k => m.get(k), put: async (k, v) => void m.set(k, v), delete: async k => void m.delete(k), deleteAll: async () => m.clear(), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) } }; };
const rs = mk(); const registry = new Registry({ storage: rs.storage }); const rooms = {};
const env = { ADMIN_KEY: 'k', REGISTRY: { idFromName: () => 'main', get: () => ({ fetch: (u, i) => registry.fetch(new Request(u, i)) }) }, ROOM: { idFromName: x => x, get: x => ({ fetch: (u, i) => { if (!rooms[x]) { rooms[x] = new Room({ storage: mk().storage }, env); } return rooms[x].fetch(new Request(u, i)); } }) } };
const reg = async (p, b) => (await registry.fetch(new Request('https://x' + p, { method: 'POST', body: JSON.stringify(b) }))).json();
const dev = { A: 'a'.repeat(32), B: 'b'.repeat(32), S: 's'.repeat(32) };
for (const [k, e] of [['A', 'amy@x.com'], ['B', 'bob@x.com']]) { await reg('/preapprove', { email: e }); await reg('/google', { deviceId: dev[k], email: e, name: k }); }
const f = async (u, d, init = {}, extra = {}) => { const r = await Front.fetch(new Request('https://w.test' + u, { ...init, headers: { 'X-Device-Id': d, 'Content-Type': 'application/json', ...extra } }), env); return Object.assign(await r.json(), { _s: r.status }); };
const real = Date.now; let clock = real.call(Date); Date.now = () => clock;
ok((await f('/api/lobby', dev.S))._s === 403, 'strangers cannot see the lobby');
let l = await f('/api/lobby', dev.A); ok(l._s === 200 && l.tables.length === 0, 'an empty casino lists no tables');
const t1 = await f('/api/rooms', dev.A, { method: 'POST', body: JSON.stringify({ game: 'roulette' }) });
ok((await f('/api/lobby', dev.A)).tables.length === 0, 'a table that has not started yet is not listed');
await f('/api/rooms/' + t1.code, dev.A, { method: 'PUT', body: JSON.stringify({ state: { players: [], history: [] } }) }, { Authorization: 'Bearer ' + t1.token });
const t2 = await f('/api/rooms', dev.B, { method: 'POST', body: JSON.stringify({ game: 'blackjack' }) });
await f('/api/rooms/' + t2.code, dev.B, { method: 'PUT', body: JSON.stringify({ state: { players: [], history: [] } }) }, { Authorization: 'Bearer ' + t2.token });
l = await f('/api/lobby', dev.B); ok(l.tables.length === 2, 'both started tables are listed');
const r1 = l.tables.find(t => t.code === t1.code), r2 = l.tables.find(t => t.code === t2.code);
ok(r1.game === 'roulette' && r2.game === 'blackjack' && r1.host === 'amy' && r2.host === 'bob' && r1.seats === 0, 'each row shows the game, the host and the seats');
ok(!JSON.stringify(l).includes(t1.token) && !/"ref"|hostRef/.test(JSON.stringify(l)), 'no tokens or account refs are exposed');
ok((await f('/api/rooms/' + t1.code + '/act', dev.B, { method: 'POST', body: JSON.stringify({ action: { type: 'seat', name: 'B', buyin: 20000 } }) })).ok, 'bob sits at the roulette table');
l = await f('/api/lobby', dev.A); ok(l.tables[0].code === t1.code && l.tables[0].seats === 1, 'busier tables come first and the seat count updates');
clock += 20 * 60 * 1000; l = await f('/api/lobby', dev.A); ok(l.tables.length === 0, 'tables nobody has touched for 15 minutes drop out of the list');
// a table closing removes it
await f('/api/rooms/' + t2.code + '/act', dev.A, { method: 'POST', body: JSON.stringify({ action: { type: 'seat', name: 'A', buyin: 10000 } }) });
ok((await f('/api/lobby', dev.A)).tables.length === 1, 'an active table is back in the list');
clock += 6 * 60 * 1000; await f('/api/rooms/' + t2.code, dev.A);
ok((await f('/api/lobby', dev.A)).tables.length === 0, 'an idle table that closes leaves the lobby');
Date.now = real;
console.log('ALL', n, 'LOBBY CHECKS PASSED');
