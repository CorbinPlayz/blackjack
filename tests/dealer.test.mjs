// Step 3: the online dealer. Needs ./w.mjs (copy of worker/src/index.js).
import * as W from './w.mjs';
import assert from 'node:assert';
const { normalizeTable, normalizeSecret, applyAction, advance, handTotal, isBlackjack, cardValue, newShoe, randInt, Room, Registry } = W;
let n = 0; const ok = (x, m) => { assert.ok(x, m); n++; console.log('PASS', m); };

const R = { A: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 10: 9, J: 10, Q: 11, K: 12 };
const hand = (...r) => r.map(x => R[x]);

// ---------- hand maths ----------
ok(handTotal(hand('A', 'K')).total === 21 && isBlackjack(hand('A', 'K')) && !isBlackjack(hand(7, 7, 7)), 'ace + king is a blackjack, 7+7+7 is only 21');
ok(handTotal(hand('A', 6)).total === 17 && handTotal(hand('A', 6)).soft, 'A+6 is a soft 17');
ok(handTotal(hand('A', 6, 10)).total === 17 && !handTotal(hand('A', 6, 10)).soft, 'A+6+10 is a hard 17 (the ace drops to 1)');
ok(handTotal(hand('A', 'A', 9)).total === 21 && handTotal(hand('A', 'A', 'A', 'K')).total === 13, 'several aces count 11 once, then 1');
ok(handTotal(hand('K', 'Q', 5)).total === 25, 'bust totals are real totals');
ok([R.J, R.Q, R.K, R[10]].every(c => cardValue(c) === 10) && cardValue(R[9]) === 9 && cardValue(R[2]) === 2, 'face cards are worth 10');

// ---------- the shoe ----------
const shoe = newShoe(); const cnt = {}; shoe.forEach(c => { cnt[c] = (cnt[c] || 0) + 1; });
ok(shoe.length === 312 && Object.keys(cnt).length === 52 && Object.values(cnt).every(v => v === 6), 'a shoe is exactly 6 full decks');
let moved = 0; const shoe2 = newShoe(); for (let i = 0; i < 312; i++) if (shoe[i] !== shoe2[i]) moved++;
ok(moved > 250, 'two shuffles are different');
const first = new Array(52).fill(0); for (let i = 0; i < 20800; i++) first[newShoe()[0]]++;
const chi = first.reduce((a, o) => a + (o - 400) ** 2 / 400, 0);
ok(chi < 90, 'top card is uniform over 20,800 shuffles (chi-square ' + chi.toFixed(1) + ' < 90, 51 dof)');
const dist = new Array(7).fill(0); for (let i = 0; i < 70000; i++) dist[randInt(7)]++;
ok(dist.every(d => Math.abs(d - 10000) < 400), 'randInt(7) has no modulo bias');
let src = ''; ok(!/Math\.random/.test(String(W.newShoe) + String(W.randInt)), 'the shuffle never uses Math.random (crypto.getRandomValues only)');

// ---------- engine helpers ----------
const NOW = { t: 1700000000000 };
const A = 'AAAAAAAA', B = 'BBBBBBBB', C = 'CCCCCCCC';
function mk(refs = [A], bal = 100000) {
  const t = normalizeTable({ settings: { auto: true } }); const secret = normalizeSecret(null);
  refs.forEach((r, i) => { const x = applyAction(t, { role: 'player', ref: r }, { type: 'seat', name: 'P' + i, buyin: bal }, { secret, now: NOW.t }); assert.ok(x.ok, x.error); });
  advance(t, secret, NOW.t);                                  // the first betting window opens
  return { t, secret };
}
const act = (g, ref, a) => applyAction(g.t, { role: ref === 'H' ? 'host' : 'player', ref: ref === 'H' ? '' : ref }, a, { secret: g.secret, now: NOW.t });
const tick = (g, ms) => { NOW.t += ms; return advance(g.t, g.secret, NOW.t); };
// rig the shoe: deal order is every player's first card, the dealer's up card, every player's second card, the hole card, then draws
const rig = (g, draws) => { g.secret.shoe = [...new Array(120).fill(R[2]), ...draws.slice().reverse()]; };
function round(g, draws, bets) {                              // everyone bets, time passes, the dealer deals
  rig(g, draws);
  g.t.players.forEach((p, i) => { const r = act(g, p.owner, { type: 'bet', pid: p.id, amount: bets[i] }); assert.ok(r.ok, r.error); });
  tick(g, 7000);
}
const me = (g, i = 0) => g.t.players[i];
const hit = (g, i = 0) => act(g, me(g, i).owner, { type: 'hit', pid: me(g, i).id });
const stand = (g, i = 0) => act(g, me(g, i).owner, { type: 'stand', pid: me(g, i).id });
const dbl = (g, i = 0) => act(g, me(g, i).owner, { type: 'double', pid: me(g, i).id });
const split = (g, i = 0) => act(g, me(g, i).owner, { type: 'split', pid: me(g, i).id });

// ---------- a simple win: 20 against 18 ----------
{
  const g = mk(); round(g, hand('K', 8, 'Q', 10), [1000]);      // P: K,Q   D: 8 up, 10 hole
  ok(g.t.deal.phase === 'acting' && g.t.deal.cards.length === 1 && g.t.deal.hole === true, 'after the deal the dealer shows ONE card and the hole card is hidden');
  ok(!/"shoe"|"hole":[0-9]/.test(JSON.stringify(g.t)) && g.secret.hole === R[10], 'the shoe and hole card are not in the public table; they are in the separate secret');
  ok(me(g).hand === 1000 && me(g).balance === 100000, 'the wager is locked in play (still in the balance until settled)');
  stand(g);
  ok(g.t.deal.phase === 'results' && g.t.deal.cards.length === 2 && g.t.deal.hole === false, 'when everyone is done the hole card is revealed');
  ok(me(g).balance === 101000 && me(g).hand === 0 && g.t.house === -1000 && g.t.history.at(-1).outcome === 'win', 'win pays 1:1, is logged, and comes out of the house');
  tick(g, 7000); ok(g.t.deal.phase === 'betting' && g.t.round.n === 2 && me(g).hands.length === 0, 'results show for 7s, then the next round opens by itself');
  ok(me(g).bet === 1000, 'auto-repeat puts last round\'s wager back in');
  tick(g, 6000); ok(g.t.deal.phase === 'acting' || g.t.deal.phase === 'insurance' || g.t.deal.phase === 'results', 'and with every wager in, the next hand is dealt automatically');
}
// ---------- blackjack 3:2, dealer does not draw ----------
{
  const g = mk(); round(g, hand('A', 9, 'K', 7), [1000]);
  ok(g.t.deal.phase === 'results' && me(g).hands[0].res === 'blackjack' && me(g).balance === 101500, 'player blackjack pays exactly 3:2');
  ok(g.t.deal.cards.length === 2, 'the dealer does not draw against a lone blackjack');
}
{
  const g = mk(); round(g, hand('A', 9, 'K', 7), [1001]);
  ok(me(g).balance === 100000 + Math.round(1001 * 1.5), 'odd wagers round 3:2 to the nearest cent');
}
// ---------- dealer stands on every 17 (soft too), hits 16 ----------
{
  const g = mk(); round(g, hand(10, 'A', 8, 6), [1000]);        // P 18; D A,6 soft 17
  act(g, A, { type: 'insure', pid: 1, take: false }); stand(g); ok(g.t.deal.cards.length === 2 && me(g).balance === 101000, 'dealer stands on soft 17 (and 18 beats it)');
}
{
  const g = mk(); round(g, hand(10, 10, 8, 6, 5), [1000]);      // P 18; D 10,6 then draws 5 = 21
  stand(g); ok(g.t.deal.cards.length === 3 && handTotal(g.t.deal.cards).total === 21 && me(g).balance === 99000, 'dealer hits 16 and the drawn 21 beats 18');
}
{
  const g = mk(); round(g, hand(10, 10, 8, 6, 'K'), [1000]);    // dealer 16 + K = bust
  stand(g); ok(handTotal(g.t.deal.cards).total === 26 && me(g).balance === 101000, 'dealer bust: a standing hand wins');
}
// ---------- player bust loses without the dealer playing ----------
{
  const g = mk(); round(g, hand('K', 9, 6, 7, 'Q'), [1000]);    // P 16 hits Q = 26
  ok(hit(g).ok, 'hit'); ok(g.t.deal.phase === 'results' && me(g).hands[0].res === 'bust' && me(g).balance === 99000, 'bust loses at once');
  ok(g.t.deal.cards.length === 2, 'the dealer does not draw once every hand has busted');
}
// ---------- push ----------
{
  const g = mk(); round(g, hand('K', 8, 'Q', 10), [1000]); // P 20, D 18
  const g2 = mk(); round(g2, hand('K', 10, 'Q', 'K'), [1000]); stand(g2);
  ok(me(g2).balance === 100000 && me(g2).hands[0].res === 'push', '20 vs 20 is a push');
}
// ---------- double ----------
{
  const g = mk(); round(g, hand(5, 9, 6, 7, 10), [1000]);      // P 5,6 =11 doubles, draws 10 = 21; D 9,7 = 16 draws... shoe next is filler 2 -> 18
  ok(dbl(g).ok, 'double down'); ok(me(g).hands[0].bet === 2000 && me(g).hands[0].done && me(g).hands[0].cards.length === 3, 'double takes exactly one card, then stops');
  ok(g.t.deal.phase === 'results' && me(g).balance === 102000, 'doubled win pays on the doubled wager');
  ok(!dbl(g).ok, 'cannot double after the hand is over');
}
{
  const g = mk(); round(g, hand(5, 9, 6, 7), [1000]); hit(g);
  ok(!dbl(g).ok && /first two cards/.test(dbl(g).error), 'cannot double after hitting');
}
{
  const g = mk([A], 1500); round(g, hand(5, 9, 6, 7), [1000]);
  ok(!dbl(g).ok && /Not enough chips/.test(dbl(g).error), 'cannot double without the extra chips');
}
// ---------- split ----------
{
  const g = mk(); round(g, hand(8, 9, 8, 7, 'K', 3, 10), [1000]);   // P 8,8 split: hands 8+K and 8+3 ; D 9,7
  ok(split(g).ok, 'split a pair');
  ok(me(g).hands.length === 2 && me(g).hand === 2000 && me(g).hands.every(h => h.cards.length === 2), 'split makes two hands with a wager each');
  ok(!split(g).ok, 'a hand can only be split once');
  stand(g);                                                       // first hand (18) stands
  ok(me(g).hands[0].done && !me(g).hands[1].done, 'play moves on to the second hand');
  ok(hit(g).ok, 'hit the second hand'); stand(g);
  ok(g.t.deal.phase === 'results' && me(g).hands.length === 2, 'both hands are settled separately');
}
{
  const g = mk(); round(g, hand('A', 9, 'A', 7, 'K', 'Q'), [1000]);  // aces split: A+K = 21 (not blackjack), A+Q = 21
  ok(split(g).ok && me(g).hands.every(h => h.done), 'split aces take one card each and stand');
  ok(g.t.deal.phase === 'results' && me(g).hands.every(h => h.res === 'win') && me(g).balance === 102000, 'a 21 after splitting pays 1:1, not 3:2');
}
{
  const g = mk(); round(g, hand(8, 9, 7, 7), [1000]); ok(!split(g).ok && /pair/.test(split(g).error), 'cannot split two different cards');
  const g2 = mk([A], 1500); round(g2, hand(8, 9, 8, 7), [1000]); ok(!split(g2).ok && /Not enough/.test(split(g2).error), 'cannot split without the chips for a second wager');
  const g3 = mk(); round(g3, hand('K', 9, 'Q', 7), [1000]); ok(split(g3).ok, 'any two ten-value cards may be split (same value)');
}
// ---------- insurance ----------
{
  const g = mk(); round(g, hand('K', 'A', 7, 'K'), [1000]);       // dealer A up, K hole = blackjack
  ok(g.t.deal.phase === 'insurance', 'an ace up card offers insurance first');
  ok(act(g, A, { type: 'insure', pid: 1, take: true }).ok && me(g).ins === 500, 'insurance costs half the wager');
  ok(g.t.deal.phase === 'results' && g.t.deal.dealerBJ && g.t.deal.cards.length === 2, 'the dealer peeks: blackjack ends the round at once');
  ok(me(g).balance === 100000 && g.t.history.some(h => h.outcome === 'insurance_win' && h.delta === 1000), 'insurance pays 2:1 and covers the lost wager exactly');
}
{
  const g = mk(); round(g, hand('K', 'A', 7, 9, 10), [1000]);
  act(g, A, { type: 'insure', pid: 1, take: true }); ok(g.t.deal.phase === 'acting', 'no dealer blackjack: the hand goes on');
  stand(g); ok(me(g).balance === 100000 - 500 - 1000 + 0 || me(g).balance === 98500 + 0, 'a lost insurance costs the side bet (dealer 19 beats 17 too)');
}
{
  const g = mk(); round(g, hand('A', 'A', 'K', 'K'), [1000]);
  ok(act(g, A, { type: 'insure', pid: 1, take: false }).ok && g.t.deal.phase === 'results' && me(g).hands[0].res === 'push' && me(g).balance === 100000, 'player blackjack vs dealer blackjack pushes');
}
{
  const g = mk(); round(g, hand('K', 'A', 7, 9), [1000]); tick(g, 11000);
  ok(g.t.deal.phase === 'acting' && me(g).ins === 0, 'insurance not answered in 10s is declined');
}
{
  const g = mk([A], 1200); round(g, hand('K', 'A', 7, 9), [1000]);
  ok(me(g).insDone && !act(g, A, { type: 'insure', pid: 1, take: true }).ok, 'no insurance offer when the chips are not there');
}
{
  const g = mk(); round(g, hand('K', 10, 7, 'A'), [1000]);   // 10 up, A hole: peeked at once
  ok(g.t.deal.phase === 'results' && g.t.deal.dealerBJ && me(g).balance === 99000, 'a ten up with an ace in the hole is found by the peek: the player loses just the wager');
}
// ---------- timers ----------
{
  const g = mk(); round(g, hand('K', 9, 6, 7), [1000]);
  tick(g, 14000); ok(g.t.deal.phase === 'acting', 'still waiting at 14s');
  tick(g, 2000); ok(g.t.deal.phase === 'results' && me(g).hands[0].done && me(g).idle === 1, 'no decision in 15s: the dealer stands for you');
}
{
  const g = mk(); round(g, hand('K', 9, 2, 7), [1000]); tick(g, 5000); hit(g); tick(g, 11000);
  ok(g.t.deal.phase === 'acting', 'acting restarts the 15s clock');
}
{
  const g = mk(); round(g, hand('K', 9, 6, 7), [1000]);        // the player bets once, then falls asleep
  tick(g, 16000); ok(me(g).idle === 1, 'round 1: auto-stood (idle 1)');
  tick(g, 8000); rig(g, hand('K', 9, 6, 7)); tick(g, 7000); tick(g, 16000); ok(me(g).idle === 2 || me(g).out, 'round 2: auto-stood again (idle 2)');
  tick(g, 8000);
  ok(me(g).out === true, 'two rounds of auto-standing in a row sit the player out (no AFK bleeding)');
}
{
  const g = mk([A, B]); rig(g, hand('K', 'Q', 9, 7, 8, 6));
  act(g, A, { type: 'bet', pid: 1, amount: 1000 }); tick(g, 7000);
  ok(g.t.deal.phase === 'betting', 'one bettor of two: the dealer waits for the other wager');
  tick(g, 25000); ok(g.t.deal.phase !== 'betting' && me(g, 1).hands.length === 0 && me(g, 0).hands.length === 1, 'at the deadline the round starts without the player who did not bet');
}
// ---------- who may do what ----------
{
  const g = mk([A, B]); round(g, hand('K', 'Q', 9, 7, 8, 6), [1000, 1000]);
  ok(!act(g, 'H', { type: 'hit', pid: 1 }).ok, 'the host cannot play anyone\'s hand');
  ok(!act(g, B, { type: 'hit', pid: 1 }).ok && /your own/.test(act(g, B, { type: 'stand', pid: 1 }).error), 'a player cannot play someone else\'s hand');
  for (const t of ['settle', 'start', 'finish', 'undo', 'insurance']) ok(!act(g, 'H', { type: t, pid: 1, outcome: 'win', wager: 100 }).ok && /online dealer/.test(act(g, 'H', { type: t, pid: 1, outcome: 'win', wager: 100 }).error), 'host cannot ' + t + ' by hand at a dealer table');
  ok(!act(g, A, { type: 'settle', pid: 1, outcome: 'win' }).ok, 'a player cannot settle their own hand');
  ok(!act(g, 'H', { type: 'reset' }).ok, 'the host cannot reset mid-hand to wipe a loss');
  ok(!act(g, A, { type: 'remove', pid: 1 }).ok, 'cannot walk away mid-hand');
  ok(!act(g, A, { type: 'vault_deposit', pid: 1, amount: 99500 }).ok && act(g, A, { type: 'vault_deposit', pid: 1, amount: 98000 }).ok, 'chips in play cannot be cashed out; the rest can');
  ok(!act(g, A, { type: 'bet', pid: 1, amount: 100 }).ok, 'wagers are closed once the cards are out');
  ok(!act(g, 'H', { type: 'settings', auto: false }).ok, 'the host cannot switch the dealer off mid-hand');
  ok(!act(g, 'H', { type: 'settings', rounds: false }).ok, 'rounds cannot be turned off at a dealer table');
}
{
  const g = mk([A], 100000); rig(g, hand('K', 9, 'Q', 7));
  ok(!act(g, A, { type: 'bet', pid: 1, amount: 100001 }).ok, 'cannot wager more than the balance');
  const t2 = normalizeTable({ settings: { auto: false } }); ok(!applyAction(t2, { role: 'player', ref: A }, { type: 'hit', pid: 1 }, {}).ok, 'dealer actions are refused at a human-dealer table');
}
// ---------- money is conserved through every payout ----------
{
  let seed = 424242; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const g = mk([A, B, C], 500000); const total0 = () => g.t.players.reduce((s, p) => s + p.balance, 0) + g.t.house; const start = total0();
  let rounds = 0, actions = 0;
  for (let i = 0; i < 4000; i++) {
    const p = g.t.players[ri(0, 2)], k = ri(0, 9);
    const a = k < 3 ? { type: 'bet', pid: p.id, amount: [0, 100, 2500, 10000, 999999999][ri(0, 4)] } : k < 7 ? { type: ['hit', 'stand', 'double', 'split'][ri(0, 3)], pid: p.id } : k < 8 ? { type: 'insure', pid: p.id, take: rnd() < .5 } : k < 9 ? { type: 'sitout', pid: p.id, out: rnd() < .3 } : { type: 'vault_deposit', pid: p.id, amount: ri(1, 5000) };
    const r = act(g, p.owner, a); actions++;
    if (a.type === 'vault_deposit' && r.ok) { /* chips leave the table to an account */ }
    tick(g, [0, 500, 3000, 8000, 16000][ri(0, 4)]);
    g.t.players.forEach(q => {
      assert.ok(q.balance >= 0, 'negative balance');
      const inPlay = q.hands.reduce((s, h) => s + (g.t.deal.phase === 'results' ? 0 : h.bet), 0) + (g.t.deal.phase === 'results' ? 0 : q.ins);
      assert.ok(q.hand === inPlay && q.hand <= q.balance, 'exposure ' + q.hand + ' vs ' + inPlay + ' vs balance ' + q.balance + ' in phase ' + g.t.deal.phase);
    });
  }
  const withdrawn = g.t.players.reduce((s, p) => s + p.vout, 0);
  ok(total0() + withdrawn === start, 'randomized: 4,000 mixed actions (' + g.t.round.n + ' rounds): seats + house + cash-outs never changed');
  ok(g.t.round.n > 20, 'the table keeps dealing round after round by itself (' + g.t.round.n + ' rounds)');
}

// ---------- full Room + Registry: privacy, clock and the bank ----------
const mkStore = () => { const m = new Map(); return { m, storage: { get: async k => m.get(k), put: async (k, v) => void m.set(k, v), delete: async k => void m.delete(k), deleteAll: async () => m.clear(), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) } }; };
const regSt = mkStore(), registry = new Registry({ storage: regSt.storage });
const env = { REGISTRY: { idFromName: () => 'main', get: () => ({ fetch: (u, i) => registry.fetch(new Request(u, i)) }) } };
const roomSt = mkStore(), room = new Room({ storage: roomSt.storage }, env);
const call = async (path, body) => { const r = await registry.fetch(new Request('https://x' + path, { method: 'POST', body: JSON.stringify(body) })); return r.json(); };
const ref = {}; for (const [k, e] of [['A', 'a@x.com'], ['B', 'b@x.com'], ['C', 'c@x.com']]) { await call('/preapprove', { email: e }); ref[k] = (await call('/google', { deviceId: k.toLowerCase().repeat(32), email: e, name: k })).ref; }
const realNow = Date.now; let clock = 1800000000000; Date.now = () => clock;
await room.fetch(new Request('https://room/init', { method: 'POST', body: JSON.stringify({ token: 'tok' }) }));
const rx = async (who, action) => { const h = { 'X-Code': 'TST01', 'X-Ref': who === 'H' ? ref.A : ref[who] }; if (who === 'H') h.Authorization = 'Bearer tok'; const r = await room.fetch(new Request('https://room/act', { method: 'POST', headers: h, body: JSON.stringify({ action }) })); return Object.assign(await r.json(), { _s: r.status }); };
const gx = async () => (await (await room.fetch(new Request('https://room/state', { headers: { 'X-Code': 'TST01' } }))).json());
ok((await gx()).state.settings.auto === true, 'a new online table is an online dealer table');
await rx('A', { type: 'seat', name: 'Ann', buyin: 50000 }); await rx('B', { type: 'seat', name: 'Bob', buyin: 50000 });
let s0 = await gx(); clock += 100; s0 = await gx(); ok(s0.state.deal.phase === 'betting' && s0.state.deal.startedAt > 0, 'the table\'s clock starts when somebody looks');
await rx('A', { type: 'bet', pid: 1, amount: 2000 }); await rx('B', { type: 'bet', pid: 2, amount: 3000 });
clock += 7000; let st = await gx();
ok(['acting', 'insurance', 'results'].includes(st.state.deal.phase) && st.state.players[0].hands.length === 1, 'merely polling the table deals the round once the wagers are in');
const raw = JSON.stringify(st); const secretRow = roomSt.m.get('secret');
ok(!/"shoe"/.test(raw) && secretRow && secretRow.shoe.length > 100, 'GET /state never contains the shoe; it only exists in the secret row');
ok(st.state.deal.phase === 'results' || (st.state.deal.cards.length === 1 && st.state.deal.hole === true), 'the dealer\'s hole card is not sent while the round is live');
const v1 = st.v; ok((await gx()).v === v1, 'polling an unchanged table does not bump the version');
// play the live round out through the API, then check the bank is untouched by settling
for (let i = 0; i < 40; i++) { st = await gx(); if (st.state.deal.phase === 'results') break; if (st.state.deal.phase === 'insurance') { await rx('A', { type: 'insure', pid: 1, take: false }); await rx('B', { type: 'insure', pid: 2, take: false }); } else { await rx('A', { type: 'stand', pid: 1 }); await rx('B', { type: 'stand', pid: 2 }); } clock += 1000; }
st = await gx(); ok(st.state.deal.phase === 'results' && st.state.deal.cards.length >= 2 && st.state.deal.hole === false, 'a round played through the API reaches results with the hole card shown');
const sum = () => { let s = 0; for (const [k, v] of regSt.m) if (k.startsWith('v:')) s += v; const t = roomSt.m.get('table'); return s + t.players.reduce((a, p) => a + p.balance, 0) + t.house; };
ok(sum() === regSt.m.get('supply'), 'accounts + seats + house still equal the money supply after a dealt round');
// idle table does not stay alive forever through polling
const meta0 = roomSt.m.get('meta').updated; clock += 60000; await gx(); clock += 60000; await gx();
ok(roomSt.m.get('meta').updated === meta0, 'polling alone never extends the table\'s 24h life');
// concurrency: simultaneous actions are serialised and never lose an update
const before = (await gx()).state.history.length; clock += 8000; await gx();
await Promise.all([rx('A', { type: 'bet', pid: 1, amount: 100 }), rx('B', { type: 'bet', pid: 2, amount: 100 }), gx(), gx()]);
st = await gx(); ok(st.state.players[0].bet === 100 && st.state.players[1].bet === 100 || st.state.deal.phase !== 'betting', 'simultaneous requests do not overwrite each other');
// randomized through the real Room + bank: dealing, leaving, bank trips, cash-outs, clock jumps
{
  let seed = 77; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  let acc = 0;
  for (let i = 0; i < 2500; i++) {
    const who = ['A', 'B', 'C', 'H'][ri(0, 3)], pid = ri(1, 4), k = ri(0, 13);
    const a = [{ type: 'seat', name: 'X' + ri(1, 9), buyin: [100, 5000, 20000, 90000][ri(0, 3)] }, { type: 'bet', pid, amount: [0, 100, 1000, 5000, 50000][ri(0, 4)] },
      { type: 'hit', pid }, { type: 'stand', pid }, { type: 'double', pid }, { type: 'split', pid }, { type: 'insure', pid, take: rnd() < .5 }, { type: 'rebuy', pid, amount: [100, 3000][ri(0, 1)] },
      { type: 'vault_deposit', pid, amount: ri(1, 8000) }, { type: 'vault_withdraw', pid, amount: ri(1, 8000) }, { type: 'remove', pid }, { type: 'sitout', pid, out: rnd() < .3 }, { type: 'trivia', pid }, { type: 'settle', pid, outcome: 'win' }][k];
    const r = await rx(who, a); if (r.ok) acc++;
    clock += [0, 700, 4000, 9000, 20000][ri(0, 4)];
    if (rnd() < .3) await gx();
    assert.ok(sum() === regSt.m.get('supply'), 'CONSERVATION BROKEN after ' + JSON.stringify([who, a]));
    const t = roomSt.m.get('table'); t.players.forEach(p => assert.ok(p.balance >= 0 && p.hand <= p.balance, 'bad seat ' + JSON.stringify(p)));
    for (const [kk, v] of regSt.m) if (kk.startsWith('v:')) assert.ok(v >= 0, 'negative account');
  }
  ok(true, 'randomized through the real Room and bank: 2,500 actions (' + acc + ' accepted) with clock jumps: accounts + seats + house == supply every time');
}
Date.now = realNow;
console.log('ALL', n, 'DEALER CHECKS PASSED');
