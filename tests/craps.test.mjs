// Craps: roll rules, odds, one-roll bets, timing, limits and money conservation.
import { crapsRoll, crapsMaxWin, normalizeTable, normalizeSecret, applyAction, advance, _setStartGrant } from './w.mjs';
_setStartGrant(100000);
import assert from 'node:assert';
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };
const net = (bets, phase, point, total) => crapsRoll(bets, phase, point, total).items.map(i => i.done ? i.net : 'stay');
const B = (k, a = 100) => ({ k, a });
// ---- come-out ----
ok(net([B('pass')], 'come', 0, 7)[0] === 100 && net([B('pass')], 'come', 0, 11)[0] === 100, 'pass wins on a come-out 7 or 11');
ok([2, 3, 12].every(d => net([B('pass')], 'come', 0, d)[0] === -100), 'pass loses on come-out 2, 3, 12');
ok([2, 3].every(d => net([B('dp')], 'come', 0, d)[0] === 100) && [7, 11].every(d => net([B('dp')], 'come', 0, d)[0] === -100) && net([B('dp')], 'come', 0, 12)[0] === 0, "don't pass: wins on 2/3, loses on 7/11, pushes on 12");
let r = crapsRoll([B('pass'), B('dp')], 'come', 0, 6);
ok(r.phase === 'point' && r.point === 6 && r.items.every(i => !i.done), 'a 6 on the come-out sets the point and the line bets stay');
ok(crapsRoll([], 'come', 0, 7).phase === 'come' && crapsRoll([], 'come', 0, 2).phase === 'come', 'come-out 7 or craps keeps the come-out');
// ---- point ----
ok(net([B('pass')], 'point', 6, 6)[0] === 100 && net([B('pass')], 'point', 6, 7)[0] === -100 && net([B('pass')], 'point', 6, 9)[0] === 'stay', 'pass at the point: point wins, 7 loses, else stays');
ok(net([B('dp')], 'point', 6, 7)[0] === 100 && net([B('dp')], 'point', 6, 6)[0] === -100 && net([B('dp')], 'point', 6, 12)[0] === 'stay', "don't pass at the point: 7 wins, point loses (12 no longer matters)");
ok(crapsRoll([], 'point', 6, 6).phase === 'come' && crapsRoll([], 'point', 6, 7).phase === 'come' && crapsRoll([], 'point', 6, 8).phase === 'point' && crapsRoll([], 'point', 6, 8).point === 6, 'the point ends on the point or a 7 only');
// ---- odds pay true odds ----
ok(net([B('odds_pass', 100)], 'point', 4, 4)[0] === 200 && net([B('odds_pass', 100)], 'point', 5, 5)[0] === 150 && net([B('odds_pass', 100)], 'point', 8, 8)[0] === 120, 'pass odds: 4/10 pay 2:1, 5/9 pay 3:2, 6/8 pay 6:5');
ok(net([B('odds_dp', 100)], 'point', 10, 7)[0] === 50 && net([B('odds_dp', 100)], 'point', 9, 7)[0] === 66 && net([B('odds_dp', 100)], 'point', 6, 7)[0] === 83, "don't pass odds pay the reverse (rounded down in the casino's favor)");
ok(net([B('odds_pass')], 'point', 6, 7)[0] === -100 && net([B('odds_dp')], 'point', 6, 6)[0] === -100, 'odds lose with the line bet');
// ---- one-roll bets ----
ok([3, 4, 9, 10, 11].every(d => net([B('field')], 'come', 0, d)[0] === 100) && net([B('field')], 'come', 0, 2)[0] === 200 && net([B('field')], 'come', 0, 12)[0] === 300 && [5, 6, 7, 8].every(d => net([B('field')], 'come', 0, d)[0] === -100), 'field: 2 pays double, 12 triple, 3/4/9/10/11 even, others lose');
ok(net([B('any7')], 'come', 0, 7)[0] === 400 && net([B('any7')], 'come', 0, 8)[0] === -100, 'any 7 pays 4:1');
ok([2, 3, 12].every(d => net([B('anycraps')], 'come', 0, d)[0] === 700) && net([B('anycraps')], 'come', 0, 7)[0] === -100, 'any craps pays 7:1');
// house edge sanity: probabilities of totals (1,2,3,4,5,6,5,4,3,2,1)/36
const ways = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
const ev = f => { let e = 0; for (let d = 2; d <= 12; d++) e += ways[d] * f(d); return e / 36; };
ok(Math.abs(ev(d => net([B('any7')], 'come', 0, d)[0]) - (-16.67)) < 0.1 && Math.abs(ev(d => net([B('field')], 'come', 0, d)[0]) - (-2.78)) < 0.1, 'any 7 loses 16.7% and field 2.8% (the real house edges)');
ok(crapsMaxWin([B('field', 100), B('any7', 100)], 'come', 0) === 400 && crapsMaxWin([B('field', 100)], 'come', 0) === 300, 'max win is the best single total');

// ---- engine ----
let NOW = 1700000000000; const A = 'AAAAAAAA', Bb = 'BBBBBBBB';
const mk = () => ({ t: normalizeTable({ settings: { auto: true, game: 'craps' }, maxBet: 200000 }), secret: normalizeSecret(null) });
const act = (g, ref, a, extra = {}) => applyAction(g.t, { role: 'player', ref }, a, Object.assign({ secret: g.secret, now: NOW, funded: true, account: 1e9, name: 'N' + ref[0], rand: g.rand }, extra));
const seat = (g, ref, buyin = 100000) => { const r = act(g, ref, { type: 'seat', buyin }); assert.ok(r.ok, r.error); };
const g = mk(); seat(g, A); seat(g, Bb);
const total = () => g.t.players.reduce((s, p) => s + p.balance, 0) + g.t.house;
const T0 = total();
ok(g.t.settings.game === 'craps' && g.t.players.every(p => !p.out && !p.fresh), 'craps seats are active at once');
ok(!act(g, A, { type: 'bet', pid: 1, amount: 500 }).ok && !act(g, A, { type: 'vdeal', a: 500 }).ok && !act(g, A, { type: 'rbet', k: 'red', sel: [], a: 500 }).ok, 'other games\' actions are refused');
g.t.craps.phase = 'point'; g.t.craps.point = 6;
ok(/before the point/.test(act(g, A, { type: 'cbet', k: 'pass', a: 500 }).error), 'no pass line bets once the point is set');
g.t.craps.phase = 'come'; g.t.craps.point = 0;
ok(/once a point/.test(act(g, A, { type: 'cbet', k: 'odds_pass', a: 500 }).error), 'no odds before a point');
ok(!act(g, A, { type: 'cbet', k: 'nonsense', a: 500 }).ok, 'junk bets are refused');
ok(/smallest/.test(act(g, A, { type: 'cbet', k: 'field', a: 100 }).error), '$5 minimum');
ok(/at most 25%/.test(act(g, A, { type: 'cbet', k: 'field', a: 30000 }).error), '25% of chips on the table');
ok(/pays at most/.test(act(g, A, { type: 'cbet', k: 'any7', a: 20000 }, { pot: 100000 }).error), 'a bet that could win over 2% of the pot is refused');
g.t.maxBet = 200000;
ok(act(g, A, { type: 'cbet', k: 'pass', a: 1000 }).ok && act(g, A, { type: 'cbet', k: 'field', a: 500 }).ok && act(g, Bb, { type: 'cbet', k: 'dp', a: 1000 }).ok, 'bets accepted');
ok(act(g, A, { type: 'cundo' }).ok && g.t.players[0].cb.length === 1 && g.t.players[0].cb[0].k === 'pass', 'undo removes the last bet');
act(g, A, { type: 'cbet', k: 'any7', a: 500 });
// roll: window is 20s, dice 3+3 = 6 -> point 6
advance(g.t, g.secret, NOW); ok(g.t.craps.closeAt === NOW + 20000, 'a 20-second betting window opens');
let seqv = [3, 3]; g.rand = () => seqv.shift() - 1;
NOW += 20001; advance(g.t, g.secret, NOW, g.rand);
const pa = g.t.players[0], pb = g.t.players[1];
ok(g.t.craps.stage === 'results' && g.t.craps.dice.join() === '3,3' && g.t.craps.phase === 'point' && g.t.craps.point === 6, 'rolled 3+3: the point is 6');
ok(pa.cb.length === 1 && pa.cb[0].k === 'pass' && pb.cb.length === 1 && pb.cb[0].k === 'dp', 'line bets stay on the table; one-roll bets are gone');
ok(pa.cl.net === -500 && pa.balance === 100000 - 500 && pb.balance === 100000 && pb.cl.net === 0, 'A lost any 7 (the field bet was undone); B has nothing resolved');
ok(total() === T0, 'money conserved after the roll');
ok(!act(g, A, { type: 'cbet', k: 'field', a: 500 }).ok, 'no betting during the results');
NOW += 6001; advance(g.t, g.secret, NOW); ok(g.t.craps.stage === 'betting' && g.t.craps.closeAt > NOW, 'the next window opens');
ok(act(g, A, { type: 'cundo' }).ok && g.t.players[0].cb.length === 1, 'a live pass bet cannot be undone');
ok(act(g, A, { type: 'cclear' }).ok && g.t.players[0].cb.length === 1, 'nor cleared');
ok(/at most 3 times/.test(act(g, A, { type: 'cbet', k: 'odds_pass', a: 4000 }).error), 'odds are limited to 3x the line bet');
ok(act(g, A, { type: 'cbet', k: 'odds_pass', a: 2000 }).ok && !act(g, Bb, { type: 'cbet', k: 'odds_pass', a: 500 }).ok, 'A bets odds behind the pass; B has no pass bet to back');
ok(act(g, Bb, { type: 'cbet', k: 'odds_dp', a: 1000 }).ok, 'B lays odds behind the don\'t pass');
// roll a 6: point made. A: pass +1000, odds 6:5 on 2000 = +2400. B: dp -1000, odds -1000
seqv = [2, 4]; NOW += 20001; advance(g.t, g.secret, NOW, g.rand);
ok(g.t.craps.phase === 'come' && g.t.craps.point === 0, 'the point was made: back to the come-out');
ok(pa.balance === 99500 + 1000 + 2400 && pb.balance === 100000 - 2000, 'A wins pass and odds (6:5); B loses both');
ok(pa.cb.length === 0 && pb.cb.length === 0 && total() === T0, 'all resolved, money conserved');
// seven out: pass loses
NOW += 6001; advance(g.t, g.secret, NOW);
act(g, A, { type: 'cbet', k: 'pass', a: 1000 }); seqv = [4, 1]; NOW += 20001; advance(g.t, g.secret, NOW, g.rand);       // point 5
NOW += 6001; advance(g.t, g.secret, NOW); seqv = [3, 4]; NOW += 20001; advance(g.t, g.secret, NOW, g.rand);
ok(g.t.craps.phase === 'come' && pa.cl.net === -1000, 'seven-out: the pass bet loses');
ok(total() === T0, 'conserved');
// nobody betting: no roll, window just reopens
NOW += 6001; advance(g.t, g.secret, NOW); const dice0 = g.t.craps.dice.join(); NOW += 20001; advance(g.t, g.secret, NOW, g.rand);
ok(g.t.craps.stage === 'betting' && g.t.craps.dice.join() === dice0, 'no bets: the dice are not rolled');
// random play conservation
g.rand = undefined; let rolls = 0;
for (let i = 0; i < 300; i++) {
  for (const ref of [A, Bb]) {
    const p = g.t.players.find(q => q.owner === ref || q.ref === ref); if (!p) continue;
    if (p.balance < 3000) { act(g, ref, { type: 'rebuy', buyin: 50000 }); }
    const T = g.t.craps, kinds = T.phase === 'come' ? ['pass', 'dp', 'field', 'any7', 'anycraps'] : ['odds_pass', 'odds_dp', 'field', 'any7', 'anycraps'];
    act(g, ref, { type: 'cbet', k: kinds[Math.floor(Math.random() * kinds.length)], a: 500 });
  }
  NOW += 20001; advance(g.t, g.secret, NOW); rolls++; NOW += 6001; advance(g.t, g.secret, NOW);
}
const tt = g.t.players.reduce((s, p) => s + p.balance, 0) + g.t.house;
ok(g.t.craps.n > 100 && tt >= 0, 'played ' + (g.t.craps.n - 1) + ' rolls of random bets');
console.log('ALL', n, 'CRAPS CHECKS PASSED');
