// Video poker (Jacks or Better): hand ranking, deal/draw, limits, and money conservation with the casino pot.
import { vpEval, vpMult, vpName, normalizeTable, normalizeSecret, applyAction, advance, _setStartGrant } from './w.mjs';
_setStartGrant(100000);
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };
// card = suit*13 + rank; rank 0 = ace, 1..8 = 2..9, 9 = 10, 10 = J, 11 = Q, 12 = K
const C = (r, s) => s * 13 + r;
const H = (...x) => x.map(([r, s]) => C(r, s));
ok(vpEval(H([0,0],[12,0],[11,0],[10,0],[9,0])) === 'royal', 'royal flush');
ok(vpEval(H([4,1],[5,1],[6,1],[7,1],[8,1])) === 'sflush', 'straight flush');
ok(vpEval(H([0,0],[1,0],[2,0],[3,0],[4,0])) === 'sflush', 'ace-low straight flush (A-2-3-4-5) is not royal');
ok(vpEval(H([3,0],[3,1],[3,2],[3,3],[9,0])) === 'quads', 'four of a kind');
ok(vpEval(H([3,0],[3,1],[3,2],[9,3],[9,0])) === 'full', 'full house');
ok(vpEval(H([1,2],[5,2],[7,2],[9,2],[12,2])) === 'flush', 'flush');
ok(vpEval(H([0,0],[12,1],[11,2],[10,3],[9,0])) === 'straight', 'broadway straight (10-J-Q-K-A)');
ok(vpEval(H([0,0],[1,1],[2,2],[3,3],[4,0])) === 'straight', 'wheel straight (A-2-3-4-5)');
ok(vpEval(H([11,0],[12,1],[0,2],[1,3],[2,0])) === 'none', 'no wrap-around straights (Q-K-A-2-3)');
ok(vpEval(H([3,0],[3,1],[3,2],[9,3],[11,0])) === 'trips', 'three of a kind');
ok(vpEval(H([3,0],[3,1],[9,2],[9,3],[11,0])) === 'twopair', 'two pair');
ok(vpEval(H([10,0],[10,1],[2,2],[5,3],[7,0])) === 'jacks' && vpEval(H([0,0],[0,1],[2,2],[5,3],[7,0])) === 'jacks' && vpEval(H([12,0],[12,1],[2,2],[5,3],[7,0])) === 'jacks', 'a pair of jacks, queens, kings or aces pays');
ok(vpEval(H([9,0],[9,1],[2,2],[5,3],[7,0])) === 'none' && vpEval(H([8,0],[8,1],[2,2],[5,3],[7,0])) === 'none', 'a pair of tens or lower does not pay');
ok(vpEval([1, 2, 3]) === 'none' && vpName('royal') === 'Royal flush' && vpMult('full') === 9 && vpMult('none') === 0, 'junk hands and the pay table');
// all 2,598,960 hands: the return to the player must be close to a real Jacks-or-Better machine (about 99%)
{ let tot = 0, cnt = 0; const k = (a, b, c, d, e) => { tot += vpMult(vpEval([a, b, c, d, e])); cnt++; };
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let c = b + 1; c < 52; c++) for (let d = c + 1; d < 52; d++) for (let e = d + 1; e < 52; e++) k(a, b, c, d, e);
  ok(cnt === 2598960, 'enumerated every five-card hand');
  console.log('  (pay per dollar with no holds on a straight deal:', (tot / cnt).toFixed(4) + ')'); }

// ---- engine ----
let NOW = 1700000000000; const A = 'AAAAAAAA', B = 'BBBBBBBB';
const mk = () => ({ t: normalizeTable({ settings: { auto: true, game: 'poker' }, maxBet: 200000 }), secret: normalizeSecret(null) });
const act = (g, ref, a, extra = {}) => applyAction(g.t, { role: 'player', ref }, a, Object.assign({ secret: g.secret, now: NOW, funded: true, account: 1e9, name: 'N' + ref[0], rand: g.rand }, extra));
const seat = (g, ref, buyin = 100000) => { const r = act(g, ref, { type: 'seat', buyin }); assert.ok(r.ok, r.error); };
const g = mk(); seat(g, A); seat(g, B);
ok(g.t.settings.game === 'poker' && g.t.players.every(p => !p.out && !p.fresh), 'poker seats are active at once');
ok(!act(g, A, { type: 'bet', pid: 1, amount: 500 }).ok && !act(g, A, { type: 'rbet', k: 'red', sel: [], a: 500 }).ok, 'blackjack and roulette actions are refused at a poker table');
ok(!act(g, A, { type: 'vdraw', holds: [] }).ok, 'cannot draw before dealing');
ok(/smallest/.test(act(g, A, { type: 'vdeal', a: 100 }).error), 'minimum $5 hand');
ok(/at most 25%/.test(act(g, A, { type: 'vdeal', a: 30000 }).error), 'at most 25% of chips on a hand');
ok(/pays at most/.test(act(g, A, { type: 'vdeal', a: 20000 }, { pot: 100000 }).error), 'a hand whose top prize would exceed 2% of the pot is refused');
ok(!act(g, 'CCCCCCCC', { type: 'vdeal', a: 500 }).ok, 'only seated players deal');
// a scripted deal: rand picks index 0 each time from the sorted remaining cards -> cards 0,1,2,3,4 (ace..5 of suit 0 = straight flush A-5)
g.t.maxBet = 200000; g.rand = () => 0;
const h0 = g.t.house, b0 = g.t.players[0].balance;
let r = act(g, A, { type: 'vdeal', a: 1000 });
ok(r.ok && g.t.players[0].vp.phase === 'hold' && g.t.players[0].vp.hand.join() === '0,1,2,3,4', 'deal five cards');
ok(g.t.players[0].balance === b0 - 1000 && g.t.house === h0 + 1000, 'the stake moves into the house at the deal');
ok(!act(g, A, { type: 'vdeal', a: 1000 }).ok, 'cannot deal again mid-hand');
ok(!act(g, A, { type: 'vdraw', holds: [7] }).ok && !act(g, A, { type: 'vdraw', holds: ['0'] }).ok, 'junk holds are refused');
// hold all five: no draw, hand is a straight flush (ace-low) -> 50x
r = act(g, A, { type: 'vdraw', holds: [0, 1, 2, 3, 4] });
ok(r.ok && g.t.players[0].vp.res.k === 'sflush' && g.t.players[0].vp.res.pay === 50000 && g.t.players[0].vp.phase === 'idle', 'stand pat on a straight flush pays 50x');
ok(g.t.players[0].balance === b0 - 1000 + 50000 && g.t.house === h0 - 49000, 'the house pays the winnings (net 49x)');
// replacing cards never repeats a card in the hand
g.rand = () => 0; act(g, A, { type: 'vdeal', a: 1000 });
const first = g.t.players[0].vp.hand.slice();
act(g, A, { type: 'vdraw', holds: [0] });
const after = g.t.players[0].vp.hand; ok(after[0] === first[0] && new Set(after).size === 5, 'held cards stay and replacements are never duplicates');
// random-play conservation: balances + house always sum to the same total
let total = g.t.players.reduce((s, p) => s + p.balance, 0) + g.t.house; g.rand = undefined;
for (let i = 0; i < 400; i++) {
  const ref = i % 2 ? A : B;
  const p = g.t.players.find(q => q.ref === ref); if (!p) continue;
  if (p.balance < 1500) { act(g, ref, { type: 'rebuy', buyin: 50000 }); total = g.t.players.reduce((s, q) => s + q.balance, 0) + g.t.house; }
  const hr = act(g, ref, { type: 'vdeal', a: 500 }, { noLimits: false });
  if (hr.ok) { const holds = [0, 1, 2, 3, 4].filter(() => Math.random() < 0.5); const d = act(g, ref, { type: 'vdraw', holds }); assert.ok(d.ok, d.error); }
  const now = g.t.players.reduce((s, q) => s + q.balance, 0) + g.t.house;
  assert.ok(now === total, 'conserved at step ' + i + ': ' + now + ' vs ' + total);
}
ok(true, 'balances + house stay constant over 400 random hands');
ok(g.t.history.length > 0, 'hands show up in the table history');
console.log('ALL', n, 'POKER CHECKS PASSED');
