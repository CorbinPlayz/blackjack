import fs from 'fs'; import vm from 'vm'; import assert from 'assert';
const { applyAction, normalizeTable } = await import('./worker.mjs');
const html = fs.readFileSync('/home/claude/blackjack/index.html', 'utf8');
const script0 = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
function newCore() { const ctx = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }; vm.createContext(ctx); vm.runInContext(script0 + '\nthis.Core = Core;', ctx); return ctx.Core; }
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const money = c => (c / 100).toFixed(2);
const snap = (ps, hs) => JSON.stringify({ p: ps.map(p => [p.id, p.name, p.start, p.balance, p.added || 0]), h: hs.map(h => [h.id, h.pid, h.name, h.outcome, h.wager, h.delta]) });
let ops = 0, oks = 0;
for (let game = 0; game < 60; game++) {
  const core = newCore(), t = normalizeTable({}), host = { role: 'host', ref: '' };
  for (let i = 0; i < 250; i++) {
    const ids = core.state.players.map(p => p.id); const pid = ids.length ? ids[ri(0, ids.length - 1)] : 999;
    const bal = (core.state.players.find(p => p.id === pid) || { balance: 5000 }).balance;
    const kind = ri(0, 99); let a, c;
    const wager = () => { const r = rnd(); return r < .05 ? 0 : r < .15 ? bal + ri(1, 500) : r < .25 ? Math.max(1, Math.floor(bal / 2)) : ri(1, Math.max(1, bal)); };
    if (kind < 12 || !ids.length) { const st = ri(1, 200000), nm = 'P' + ri(1, 99); a = { type: 'add', name: nm, start: st }; c = core.addPlayer(nm, money(st)); }
    else if (kind < 52) { const w = wager(), o = ['win', 'blackjack', 'push', 'loss', 'bogus'][ri(0, 4)]; a = { type: 'settle', pid, wager: w, outcome: o }; c = core.settle(pid, money(w), o); }
    else if (kind < 64) { const w = wager(), r = ['win', 'loss', 'x'][ri(0, 2)]; a = { type: 'insurance', pid, wager: w, result: r }; c = core.insurance(pid, money(w), r); }
    else if (kind < 74) { const amt = ri(0, 30000); a = { type: 'rebuy', pid, amount: amt }; c = core.rebuy(pid, money(amt)); }
    else if (kind < 86) { a = { type: 'undo' }; c = core.undo(); }
    else if (kind < 92) { a = { type: 'remove', pid }; c = { ok: core.removePlayer(pid) }; }
    else if (kind < 94) { a = { type: 'reset' }; core.resetAll(); c = { ok: true }; }
    else { const w = ri(1, 3); a = { type: 'settle', pid: 12345, wager: w, outcome: 'win' }; c = core.settle(12345, money(w), 'win'); }
    const r = applyAction(t, host, a);
    ops++; if (r.ok) oks++;
    assert.strictEqual(!!r.ok, !!c.ok, `ok flag differs on ${JSON.stringify(a)} (server ${JSON.stringify(r)}, local ${JSON.stringify(c)})`);
    if (r.ok && a.type !== 'add' && a.type !== 'remove' && a.type !== 'reset' && a.type !== 'undo') assert.strictEqual(r.delta, c.delta, 'delta differs ' + JSON.stringify(a));
    assert.strictEqual(snap(t.players, t.history), snap(core.state.players, core.state.history), `state differs after ${JSON.stringify(a)}`);
  }
}
console.log(`PASS parity: ${ops} random actions (${oks} accepted) gave identical balances, history and chips-added in the offline game and on the server`);
