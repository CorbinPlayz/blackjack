// Pace and safety: $5 minimum, 25% cap, new players sit out, 5-second countdown, $2,500 grant, daily bonus.
import { Registry, Room, normalizeTable, normalizeSecret, applyAction, advance } from './w.mjs';
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };
const NOW = { t: 1700000000000 };
const A = 'AAAAAAAA', B = 'BBBBBBBB';
const mk = refs => { const t = normalizeTable({ settings: { auto: true } }), secret = normalizeSecret(null); refs.forEach((r, i) => { const x = applyAction(t, { role: 'player', ref: r }, { type: 'seat', name: 'P' + i, buyin: 100000 }, { secret, now: NOW.t, funded: true, account: 1e9, name: 'P' + i }); assert.ok(x.ok, x.error); }); advance(t, secret, NOW.t); return { t, secret }; };
const act = (g, ref, a) => applyAction(g.t, { role: 'player', ref }, a, { secret: g.secret, now: NOW.t });
const tick = (g, ms) => { NOW.t += ms; return advance(g.t, g.secret, NOW.t); };
let g = mk([A, B]);
ok(g.t.players.every(p => p.out && p.fresh), 'new players start sitting out');
let r = act(g, A, { type: 'bet', pid: 1, amount: 499 }); ok(!r.ok && /minimum bet is \$5/.test(r.error), 'under $5 is refused');
r = act(g, A, { type: 'bet', pid: 1, amount: 25001 }); ok(!r.ok && /25%/.test(r.error), 'more than 25% of your chips is refused');
r = act(g, A, { type: 'bet', pid: 1, amount: 25000 }); ok(r.ok && !g.t.players[0].out && !g.t.players[0].fresh, 'a legal bet joins the round');
ok(g.t.deal.phase === 'betting' && g.t.players[1].out, 'the other new player is still sitting out, so the first bettor is alone');
ok(g.t.deal.dealAt > NOW.t && g.t.deal.dealAt - NOW.t === 5000, 'with everyone active bet, a 5-second countdown starts');
tick(g, 4000); ok(g.t.deal.phase === 'betting', 'still waiting at 4 seconds');
act(g, B, { type: 'bet', pid: 2, amount: 1000 }); ok(g.t.deal.dealAt - NOW.t === 5000, 'a new bet restarts the countdown');
act(g, B, { type: 'bet', pid: 2, amount: 0 }); ok(g.t.players[1].out === false && g.t.deal.dealAt === 0, 'clearing a bet cancels the countdown');
act(g, B, { type: 'sitout', pid: 2, out: true }); ok(g.t.deal.dealAt > 0, 'sitting out lets the countdown run again');
tick(g, 5100); ok(g.t.deal.phase !== 'betting' && g.t.players[1].hands.length === 0, 'the hand is dealt after 5 seconds, without the sat-out player');
// a tiny stack can still bet what it has
g = mk([A]); g.t.players[0].balance = 300; r = act(g, A, { type: 'bet', pid: 1, amount: 300 }); ok(r.ok, 'with under $5 left you can still bet everything');
// grant and bonus
const m = new Map(); const reg = new Registry({ storage: { get: async k => m.get(k), put: async (k, v) => void m.set(k, v), delete: async k => void m.delete(k), deleteAll: async () => m.clear(), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) } });
const call = async (path, body) => { const x = await reg.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) })); return Object.assign(await x.json(), { _s: x.status }); };
await call('/preapprove', { email: 'z@x.com' }); const ref = (await call('/google', { deviceId: 'z'.repeat(32), email: 'z@x.com', name: 'Z' })).ref;
let v = await call('/vault/get', { ref }); ok(v.balance === 250000, 'new accounts get $2,500');
let b = await call('/bonus/status', { ref }); ok(!b.eligible, 'no bonus while you hold $500 or more');
ok((await call('/bonus/claim', { ref }))._s === 409, 'claiming above the limit is refused');
await call('/vault/add', { ref, delta: -240000 }); b = await call('/bonus/status', { ref }); ok(b.eligible && b.amount === 25000, 'under $500: the $250 bonus is available');
const s0 = m.get('supply'); b = await call('/bonus/claim', { ref }); ok(b.ok && b.balance === 35000 && m.get('supply') === s0 + 25000, 'claiming pays $250 and adds it to the supply');
ok((await call('/bonus/claim', { ref }))._s === 409 && !(await call('/bonus/status', { ref })).eligible, 'only once every 24 hours');
m.set('bn:' + ref, Date.now() - 86400001); ok((await call('/bonus/status', { ref })).eligible, 'available again after 24 hours');
ok(m.get('p:' + ref).free === 250000 + 25000, 'the bonus counts as free money, not profit');
console.log('ALL', n, 'PACE CHECKS PASSED');
