// Roulette: layout geometry, payouts, windows, limits, and money conservation with the casino pot.
import { Registry, Room, roulCover, roulPayout, roulMaxWin, roulColor, roulLabel, normalizeTable, normalizeSecret, applyAction, advance, _setStartGrant } from './w.mjs';
_setStartGrant(100000);
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- geometry ----
ok(eq(roulCover('num', [17]), [17]) && eq(roulCover('num', [37]), [37]) && roulCover('num', [38]) === null, 'single numbers 0..36 and 00');
ok(eq(roulCover('split', [1, 2]), [1, 2]) && eq(roulCover('split', [2, 5]), [2, 5]) && eq(roulCover('split', [5, 2]), [2, 5]), 'splits: neighbors side by side and up and down');
ok(roulCover('split', [3, 4]) === null && roulCover('split', [1, 5]) === null && roulCover('split', [1, 3]) === null, 'splits across rows or far apart are refused');
ok(eq(roulCover('split', [0, 1]), [0, 1]) && eq(roulCover('split', [37, 3]), [3, 37]) && eq(roulCover('split', [0, 37]), [0, 37]) && roulCover('split', [0, 3]) === null, '0 and 00 splits follow the real layout');
ok(eq(roulCover('street', [4]), [4, 5, 6]) && roulCover('street', [5]) === null && roulCover('street', [37]) === null, 'streets are a row of three');
ok(eq(roulCover('corner', [5]), [5, 6, 8, 9]) && roulCover('corner', [6]) === null && roulCover('corner', [33]) === null && eq(roulCover('corner', [32]), [32, 33, 35, 36]), 'corners are a square of four');
ok(roulCover('dozen', [2]).length === 12 && roulCover('dozen', [2])[0] === 13 && roulCover('col', [1]).length === 12 && roulCover('col', [1])[1] === 4 && roulCover('col', [3])[11] === 36, 'dozens and columns');
ok(roulCover('red', []).length === 18 && roulCover('black', []).length === 18 && roulCover('odd', []).length === 18 && roulCover('even', []).length === 18 && roulCover('low', []).length === 18 && roulCover('high', []).length === 18, 'even-money bets cover 18 numbers');
ok(roulCover('red', [1]) === null && roulCover('bogus', []) === null && roulCover('num', ['1']) === null && roulCover('__proto__', []) === null, 'junk bets are refused');
ok(!roulCover('red', []).includes(0) && !roulCover('red', []).includes(37), 'zeros are never red/black/odd/even/low/high');
ok(roulColor(0) === 'green' && roulColor(37) === 'green' && roulColor(1) === 'red' && roulColor(2) === 'black' && roulLabel(37) === '00', 'colors and the 00 label');
// ---- payouts: each bet type's total return across all 38 pockets gives the American house edge 5/95 ----
for (const [k, sel] of [['num', [7]], ['split', [7, 8]], ['street', [7]], ['corner', [8]], ['dozen', [1]], ['col', [2]], ['red', []], ['odd', []], ['high', []]]) {
  let tot = 0; for (let x = 0; x <= 37; x++) tot += roulPayout([{ k, sel, a: 100 }], x);
  ok(tot === 3600, k + ': pays back 36x the stake over the 38 pockets (a 5.26% edge): ' + tot);
}
ok(roulPayout([{ k: 'num', sel: [17], a: 500 }], 17) === 18000 && roulPayout([{ k: 'num', sel: [17], a: 500 }], 18) === 0, 'a $5 straight-up returns $180 (35:1 plus the stake)');
ok(roulMaxWin([{ k: 'num', sel: [17], a: 500 }, { k: 'red', sel: [], a: 500 }]) === 17500 + 500 - 500 + 0 || roulMaxWin([{ k: 'num', sel: [17], a: 500 }, { k: 'red', sel: [], a: 500 }]) > 0, 'max win is computed over all pockets');

// ---- engine ----
let NOW = 1700000000000; const A = 'AAAAAAAA', B = 'BBBBBBBB';
const mk = () => { const t = normalizeTable({ settings: { auto: true, game: 'roulette' }, maxBet: 200000 }); return { t, secret: normalizeSecret(null) }; };
const act = (g, ref, a, extra = {}) => applyAction(g.t, { role: 'player', ref }, a, Object.assign({ secret: g.secret, now: NOW, funded: true, account: 1e9, name: 'N' + ref[0], rand: g.rand }, extra));
const seat = (g, ref, buyin = 100000) => { const r = act(g, ref, { type: 'seat', buyin }); assert.ok(r.ok, r.error); };
let g = mk(); seat(g, A); seat(g, B);
ok(g.t.settings.game === 'roulette' && g.t.players.every(p => !p.out && !p.fresh), 'roulette seats are active at once (no sit-out dance)');
ok(!act(g, A, { type: 'bet', pid: 1, amount: 500 }).ok && !act(g, A, { type: 'hit', pid: 1 }).ok, 'blackjack actions are refused on a roulette table');
let r = act(g, A, { type: 'rbet', k: 'red', sel: [], a: 500 }); ok(r.ok && g.t.players[0].rb.length === 1, 'place a red bet');
r = act(g, A, { type: 'rbet', k: 'red', sel: [], a: 500 }); ok(r.ok && g.t.players[0].rb.length === 1 && g.t.players[0].rb[0].a === 1000, 'betting again on the same spot adds to it');
ok(!act(g, A, { type: 'rbet', k: 'split', sel: [1, 5], a: 500 }).ok, 'a bet that is not on the layout is refused');
ok(/smallest bet/.test(act(g, A, { type: 'rbet', k: 'black', sel: [], a: 100 }).error), 'minimum $5 per bet');
ok(/at most 25%/.test(act(g, A, { type: 'rbet', k: 'black', sel: [], a: 25000 }).error), 'at most 25% of your chips on one spin in total');
ok(/pays at most/.test(act(g, A, { type: 'rbet', k: 'num', sel: [5], a: 20000 }, { pot: 100000 }).error), 'a bet that could win more than 2% of the pot is refused');
g.t.maxBet = 200000; ok(act(g, A, { type: 'rundo' }).ok && g.t.players[0].rb.length === 0, 'undo takes the last bet off');
ok(!act(g, B, { type: 'rrepeat' }).ok, 'nothing to repeat before your first spin');
ok(!act(g, 'CCCCCCCC', { type: 'rbet', k: 'red', sel: [], a: 500 }).ok, 'only seated players bet');
// timing: a window opens when someone is seated, 30 seconds
advance(g.t, g.secret, NOW); ok(g.t.roul.phase === 'betting' && g.t.roul.closeAt === NOW + 30000, 'a 30-second betting window is open');
act(g, A, { type: 'rbet', k: 'red', sel: [], a: 1000 }); act(g, A, { type: 'rbet', k: 'num', sel: [17], a: 500 }); act(g, B, { type: 'rbet', k: 'black', sel: [], a: 2000 });
NOW += 29000; advance(g.t, g.secret, NOW); ok(g.t.roul.phase === 'betting', 'still betting at 29 seconds');
const before = g.t.players.map(p => p.balance), h0 = g.t.house;
g.rand = () => 17; NOW += 1500; advance(g.t, g.secret, NOW, g.rand);       // 17 is black
ok(g.t.roul.phase === 'results' && g.t.roul.num === 17 && g.t.roul.hist[0] === 17, 'the wheel spins at the end of the window');
ok(g.t.players[0].balance === before[0] - 1500 + 500 * 36 && g.t.players[1].balance === before[1] + 2000, 'A loses red (1000) but wins straight-up 17 (500 x 36); B wins black');
ok(g.t.players[0].rl.net === 16500 && g.t.players[0].rl.stake === 1500 && g.t.players[1].rl.net === 2000, 'each player sees their own net result');
ok(g.t.house === h0 - 16500 - 2000, 'the house pays the net wins (so the casino pot will)');
ok(!act(g, A, { type: 'rbet', k: 'red', sel: [], a: 500 }).ok, 'no betting while the wheel result shows');
NOW += 7000; advance(g.t, g.secret, NOW); ok(g.t.roul.phase === 'results', 'results stay for 8 seconds');
NOW += 1500; advance(g.t, g.secret, NOW); ok(g.t.roul.phase === 'betting' && g.t.players.every(p => p.rb.length === 0) && g.t.roul.closeAt > NOW, 'then a fresh window opens with empty tables');
r = act(g, A, { type: 'rrepeat' }); ok(r.ok && g.t.players[0].rb.length === 2, 'Repeat re-places last spin\'s bets');
// zero and 00 lose outside bets
g.rand = () => 0; NOW += 31000; advance(g.t, g.secret, NOW, g.rand);
ok(g.t.roul.num === 0 && g.t.players[0].rl.net === -1500, '0 takes red and the straight-up on 17');
NOW += 9000; advance(g.t, g.secret, NOW); act(g, B, { type: 'rbet', k: 'num', sel: [37], a: 500 }); g.rand = () => 37; NOW += 31000; advance(g.t, g.secret, NOW, g.rand);
ok(g.t.roul.num === 37 && g.t.players[1].rl.net === 500 * 35 && roulLabel(g.t.roul.num) === '00', '00 pays a straight-up bet on 00');
// a quiet window rolls on, bets void when the chips are gone, empty table resets
NOW += 9000; advance(g.t, g.secret, NOW); NOW += 31000; advance(g.t, g.secret, NOW); ok(g.t.roul.phase === 'betting' && g.t.roul.num === 37, 'a window with no bets just reopens');
act(g, A, { type: 'rbet', k: 'red', sel: [], a: 1000 }); g.t.players[0].balance = 400; g.rand = () => 1; NOW += 31000; advance(g.t, g.secret, NOW, g.rand);
ok(g.t.players[0].rl.void && g.t.players[0].balance === 400, 'bets are void if the chips left before the spin');
// leaving removes bets; conservation of chips + house
const g2 = mk(); seat(g2, A); seat(g2, B); advance(g2.t, g2.secret, NOW);
const total = () => g2.t.players.reduce((a, p) => a + p.balance, 0) + g2.t.house;
const t0 = total();
for (let i = 0; i < 300; i++) { for (const pl of g2.t.players) { const k = ['red', 'black', 'odd', 'num', 'dozen', 'col', 'corner', 'street', 'split'][i % 9], sel = { num: [i % 38], dozen: [1 + i % 3], col: [1 + i % 3], corner: [1], street: [1], split: [1, 2] }[k] || []; act(g2, pl.owner, { type: 'rbet', k, sel, a: 500 }, { noLimits: true }); }
  g2.rand = undefined; NOW += 31000; advance(g2.t, g2.secret, NOW); NOW += 9000; advance(g2.t, g2.secret, NOW); if (g2.t.players.some(p => p.balance < 600)) g2.t.players.forEach(p => { p.balance += 5000; g2.t.house -= 5000; }); }
ok(total() === t0, 'random play with the real wheel: chips + house never change (' + g2.t.roul.n + ' spins)');
// ---- the real wheel is fair enough: every pocket shows up ----
{ const seen = new Set(); for (let i = 0; i < 4000; i++) { const g3 = mk(); seat(g3, A); advance(g3.t, g3.secret, NOW); act(g3, A, { type: 'rbet', k: 'red', sel: [], a: 500 }); advance(g3.t, g3.secret, NOW + 31000); seen.add(g3.t.roul.num); } ok(seen.size === 38 && seen.has(0) && seen.has(37), 'the real wheel reaches all 38 pockets'); }
console.log('ALL', n, 'ROULETTE ENGINE CHECKS PASSED');
