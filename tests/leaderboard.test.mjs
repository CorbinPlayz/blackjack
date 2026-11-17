// Step 6: the net-worth leaderboard (bank account + own chips on tables; never the casino pot; free money and dealer cuts are not profit).
import { Registry, Room, resetLockCache, _setStartGrant } from './w.mjs';
_setStartGrant(100000);
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
const ref = {}, dev = {}; for (const [k, e] of [['A', 'a@x.com'], ['B', 'b@x.com'], ['C', 'c@x.com']]) { dev[k] = k.toLowerCase().repeat(32); ref[k] = (await call('/google', { deviceId: dev[k], email: e, name: 'Player ' + k })).ref; }
for (const k of ['A', 'B', 'C']) await call('/vault/get', { ref: ref[k] });   // opening the app creates the welcome grant
const T = room('LB001'); T.obj = new Room({ storage: T.st.storage }, env);
await T.obj.fetch(new Request('https://room/init', { method: 'POST', headers: { 'X-Ref': ref.A }, body: JSON.stringify({ token: 'tk' }) }));
const act = async (who, action) => { const r = await T.obj.fetch(new Request('https://room/act', { method: 'POST', headers: { 'X-Code': 'LB001', 'X-Ref': ref[who], 'X-Name': encodeURIComponent('Player ' + who) }, body: JSON.stringify({ action }) })); return Object.assign(await r.json(), { _s: r.status }); };
const board = async (who) => (await call('/leaderboard', { ref: ref[who] })).rows;
const vault = async k => (await call('/vault/get', { ref: ref[k] })).balance;
const table = () => T.st.m.get('table');

let rows = await board('A');
ok(rows.length === 3 && rows.every(r => r.net === 100000 && r.profit === 0), 'a new account is worth its $1,000 welcome grant and has made no profit');
await call('/bank/mint', { ref: ref.B, amount: 50000, note: 'gift' });
ok((await act('B', { type: 'seat', buyin: 60000 })).ok && (await act('C', { type: 'seat', buyin: 30000 })).ok, 'two players sit down');
rows = await board('B');
const by = k => rows.find(r => r.name === k.toLowerCase());
ok(by('B').net === 150000 && by('C').net === 100000, 'chips on a table still count as the player\'s money (net worth does not drop when you sit down)');
ok(by('B').profit === 0 && by('B').you === true && by('A').you === false, 'a mint is free money, not profit; "you" marks your own row');
// play real rounds so the seats move
for (let i = 0; i < 4; i++) { await act('B', { type: 'bet', pid: 1, amount: 10000 }); await act('C', { type: 'bet', pid: 2, amount: 5000 }); for (let k = 0; k < 6; k++) { const d = table().deal; if (d.phase === 'insurance') { await act('B', { type: 'insure', pid: 1, take: false }); await act('C', { type: 'insure', pid: 2, take: false }); } else if (d.phase === 'acting') { await act('B', { type: 'stand', pid: 1 }); await act('C', { type: 'stand', pid: 2 }); } } await act('B', { type: 'next' }); if (table().deal.phase === 'betting' && table().deal.startedAt) { /* auto-repeat already bet */ } }
rows = await board('B');
const seatB = table().players.find(p => p.owner === ref.B).balance, seatC = table().players.find(p => p.owner === ref.C).balance;
ok(by('B').net === (await vault('B')) + seatB && by('C').net === (await vault('C')) + seatC, 'after real rounds: net worth = bank account + chips on the seat (' + by('B').net + ' / ' + by('C').net + ')');
const pot = regSt.m.get('casino').pot, supply = regSt.m.get('supply');
ok(rows.reduce((a, r) => a + r.net, 0) + pot === supply, 'all net worth plus the casino pot equals the money supply: the pot is never counted as anybody\'s money');
// a dealer cut is pay, not winning
await call('/bank/apply', { opId: 'cut:1', ops: [{ ref: ref.A, delta: 7000, kind: 'dealercut', note: 'cut' }], potDelta: -7000 });
rows = await board('A');
ok(by('A').net === 107000 && by('A').profit === 0, 'a dealer cut raises net worth but is not counted as profit');
// the order
ok(rows.every((r, i) => i === 0 || rows[i - 1].net >= r.net) && rows.every((r, i) => r.rank === i + 1), 'ranked by net worth');
// closing the table keeps net worth the same and clears the snapshot
const before = rows.map(r => r.net).join();
const meta = T.st.m.get('meta'); meta.updated = Date.now() - 25 * 3600 * 1000; T.st.m.set('meta', meta);
await T.obj.fetch(new Request('https://room/state', { headers: { 'X-Code': 'LB001' } }));
rows = await board('A');
ok(!regSt.m.has('ts:LB001') && rows.length === 3, 'a closed table leaves no chips behind in the ranking');
ok(rows.reduce((a, r) => a + r.net, 0) + regSt.m.get('casino').pot === regSt.m.get('supply'), 'and the money still adds up after the close');
// the web route
resetLockCache();
const front = (url, d) => Front.fetch(new Request('https://w.test' + url, { headers: d ? { 'X-Device-Id': d } : {} }), env);
let f = await front('/api/leaderboard', dev.A); const j = await f.json();
ok(f.status === 200 && j.rows.length === 3 && !('ref' in j.rows[0]), 'approved players can read the leaderboard, and it never shows account ids');
f = await front('/api/leaderboard', 'z'.repeat(32)); ok(f.status === 403, 'strangers cannot');
console.log('ALL', n, 'LEADERBOARD CHECKS PASSED');
