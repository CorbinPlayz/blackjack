import assert from 'assert';
const { applyAction, normalizeTable } = await import('./worker.mjs');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const H = { role: 'host', ref: '' }, A = { role: 'player', ref: 'AAAAAAAA' }, B = { role: 'player', ref: 'BBBBBBBB' };
const t = normalizeTable({});
ok(applyAction(t, H, { type: 'add', name: 'Dealer-added', start: 10000 }).ok, 'host adds a player');
ok(applyAction(t, A, { type: 'seat', name: 'Ann', buyin: 10000 }).ok, 'player takes own seat with own buy-in');
ok(applyAction(t, B, { type: 'seat', name: 'Bob', buyin: 50000 }).ok, 'second player takes a seat');
const [d, ann, bob] = t.players;
ok(ann.owner === 'AAAAAAAA' && bob.owner === 'BBBBBBBB' && !d.owner, 'seats are owned by their device; host-added seat has no owner');
ok(!applyAction(t, A, { type: 'seat', name: 'Ann2', buyin: 100 }).ok, 'one seat per device');
ok(!applyAction(t, A, { type: 'add', name: 'X', start: 100 }).ok, 'players cannot add other players');
ok(!applyAction(t, A, { type: 'reset' }).ok && !applyAction(t, A, { type: 'settings', locked: true }).ok, 'players cannot reset or change settings');

// own money only
let r = applyAction(t, A, { type: 'settle', pid: ann.id, wager: 1000, outcome: 'win' });
ok(r.ok && ann.balance === 11000 && bob.balance === 50000 && d.balance === 10000, 'player wins own hand; nobody else changes');
r = applyAction(t, A, { type: 'settle', pid: bob.id, wager: 1000, outcome: 'loss' });
ok(!r.ok && /only change your own/.test(r.error) && bob.balance === 50000, "player CANNOT settle someone else's seat");
ok(!applyAction(t, A, { type: 'settle', pid: d.id, wager: 100, outcome: 'win' }).ok, "player cannot touch the host-added seat");
ok(!applyAction(t, A, { type: 'rebuy', pid: bob.id, amount: 100 }).ok, "player cannot add chips to someone else");
ok(!applyAction(t, A, { type: 'remove', pid: bob.id }).ok && t.players.length === 3, "player cannot remove someone else");
ok(!applyAction(t, { role: 'player', ref: '' }, { type: 'settle', pid: ann.id, wager: 100, outcome: 'win' }).ok, 'device with no ref cannot claim a seat');
ok(!applyAction(t, { role: 'player', ref: 'ZZZZZZZZ' }, { type: 'settle', pid: ann.id, wager: 100, outcome: 'win' }).ok, 'stranger ref cannot touch Ann');

// payouts
applyAction(t, B, { type: 'settle', pid: bob.id, wager: 10000, outcome: 'blackjack' });
ok(bob.balance === 65000, 'player $100 blackjack pays exactly +$150');
applyAction(t, B, { type: 'settle', pid: bob.id, wager: 500, outcome: 'push' });
ok(bob.balance === 65000, 'push unchanged');
applyAction(t, H, { type: 'settle', pid: d.id, wager: 10000, outcome: 'win' }); ok(d.balance === 20000, 'host can settle any seat');
ok(!applyAction(t, B, { type: 'settle', pid: bob.id, wager: 65001, outcome: 'win' }).ok, 'wager over balance rejected');
for (const w of [0, -5, 1.5, '100', null, NaN]) ok(!applyAction(t, B, { type: 'settle', pid: bob.id, wager: w, outcome: 'win' }).ok, 'bad wager rejected: ' + String(w));
ok(!applyAction(t, B, { type: 'settle', pid: bob.id, wager: 100, outcome: 'jackpot' }).ok, 'unknown outcome rejected');

// rebuy + max buy-in
r = applyAction(t, B, { type: 'rebuy', pid: bob.id, amount: 2500 }); ok(r.ok && r.fee === 250 && r.delta === 2250 && bob.balance === 67250 && t.history.at(-1).outcome === 'rebuy' && t.history.at(-1).wager === 250, 'taking $25 from the bank costs a 10% fee ($2.50), logged in history');
applyAction(t, H, { type: 'settings', maxBuyin: 5000 });
ok(!applyAction(t, B, { type: 'rebuy', pid: bob.id, amount: 5001 }).ok && applyAction(t, B, { type: 'rebuy', pid: bob.id, amount: 5000 }).ok, 'max buy-in enforced on rebuys');
ok(!applyAction(t, { role: 'player', ref: 'CCCCCCCC' }, { type: 'seat', name: 'Cy', buyin: 5001 }).ok, 'max buy-in enforced on new seats');
applyAction(t, H, { type: 'settings', maxBuyin: 0 });

// undo own
const before = ann.balance;
applyAction(t, A, { type: 'settle', pid: ann.id, wager: 500, outcome: 'loss' });
applyAction(t, B, { type: 'settle', pid: bob.id, wager: 500, outcome: 'win' });   // newer hand by someone else
r = applyAction(t, A, { type: 'undo' });
ok(r.ok && ann.balance === before, "player undoes THEIR last hand even though Bob's hand is newer");
ok(t.history.at(-1).pid === bob.id, "Bob's hand untouched by Ann's undo");
ok(!applyAction(t, { role: 'player', ref: 'DDDDDDDD' }, { type: 'undo' }).ok, 'player with no seat cannot undo');
r = applyAction(t, H, { type: 'undo' }); ok(r.ok && r.entry.pid === bob.id, 'host undo reverses the newest hand overall');

// pause
applyAction(t, H, { type: 'settings', locked: true });
ok(!applyAction(t, A, { type: 'settle', pid: ann.id, wager: 100, outcome: 'win' }).ok, 'paused table: player actions refused');
ok(!applyAction(t, { role: 'player', ref: 'CCCCCCCC' }, { type: 'seat', name: 'Cy', buyin: 100 }).ok, 'paused table: no new seats');
ok(applyAction(t, H, { type: 'settle', pid: ann.id, wager: 100, outcome: 'win' }).ok, 'paused table: host still can act');
applyAction(t, H, { type: 'settings', locked: false });
ok(applyAction(t, A, { type: 'settle', pid: ann.id, wager: 100, outcome: 'win' }).ok, 'resumed: player acts again');

// leave / remove / reset
ok(applyAction(t, A, { type: 'remove', pid: ann.id }).ok && !t.players.some(p => p.id === ann.id), 'player can leave their own seat');
ok(applyAction(t, A, { type: 'seat', name: 'Ann', buyin: 100 }).ok, '...and can sit again');
ok(applyAction(t, H, { type: 'remove', pid: d.id }).ok, 'host can remove any seat');
const ids = t.players.map(p => p.id); ok(new Set(ids).size === ids.length && !ids.includes(ann.id), 'player ids never reused');
applyAction(t, H, { type: 'reset' }); ok(t.players.every(p => p.balance === p.start) && t.history.length === 0, 'host reset restores buy-ins, clears history');
// naming
const t2 = normalizeTable({}); applyAction(t2, A, { type: 'seat', name: '  <b>Zed</b>\n', buyin: 100 }); ok(!/[<>\n]/.test(t2.players[0].name), 'names are sanitised');
ok(!applyAction(t2, B, { type: 'seat', name: '   ', buyin: 100 }).ok, 'blank name rejected');
ok(!applyAction(t2, H, { type: 'nope' }).ok && !applyAction(t2, H, null).ok, 'unknown / null action rejected');
console.log('\nALL ' + n + ' RULE CHECKS PASSED');

// ---- bank fee ----
{
  const t2 = normalizeTable({}); const H2 = { role: 'host' }; const B2 = { role: 'player', ref: 'BBBBBBBB' };
  ok(t2.settings.bankFee === 10, 'default bank fee is 10%');
  const seat = applyAction(t2, B2, { type: 'seat', name: 'Bo', buyin: 10000 }); const bo = t2.players[0];
  let r2 = applyAction(t2, B2, { type: 'rebuy', pid: bo.id, amount: 1 }); ok(!r2.ok && /too small/i.test(r2.error), 'a 1-cent withdrawal is eaten by the fee and refused');
  ok(!applyAction(t2, B2, { type: 'settings', bankFee: 0 }).ok, 'players cannot change the bank fee');
  ok(!applyAction(t2, H2, { type: 'settings', bankFee: 51 }).ok && !applyAction(t2, H2, { type: 'settings', bankFee: -1 }).ok && !applyAction(t2, H2, { type: 'settings', bankFee: 1.5 }).ok, 'bad fee values rejected');
  ok(applyAction(t2, H2, { type: 'settings', bankFee: 0 }).ok && t2.settings.bankFee === 0, 'host sets fee to 0');
  r2 = applyAction(t2, B2, { type: 'rebuy', pid: bo.id, amount: 5000 }); ok(r2.ok && r2.fee === 0 && bo.balance === 15000 && bo.added === 5000, 'with no fee the full amount is credited');
  applyAction(t2, H2, { type: 'settings', bankFee: 50 });
  r2 = applyAction(t2, B2, { type: 'rebuy', pid: bo.id, amount: 1001 }); ok(r2.ok && r2.fee === 501 && r2.delta === 500, '50% fee rounds the fee up (the bank wins ties)');
  ok(bo.balance - bo.start - bo.added === -501 - 0, 'the fee shows up as a loss in net profit');
  const u = applyAction(t2, B2, { type: 'undo' }); ok(u.ok && bo.balance === 15000 && bo.added === 5000, 'undoing a fee withdrawal restores balance and chips-taken exactly');
  const norm = normalizeTable({ settings: { bankFee: 999 } }); ok(norm.settings.bankFee === 10, 'corrupt fee values fall back to 10%');
}
{
  const t3 = normalizeTable({}); const H3 = { role: 'host' }; const P3 = { role: 'player', ref: 'DDDDDDDD' };
  ok(t3.settings.bankLimit === 3, 'default: 3 bank trips per player');
  applyAction(t3, P3, { type: 'seat', name: 'Di', buyin: 10000 }); const di = t3.players[0];
  for (let i = 0; i < 3; i++) ok(applyAction(t3, P3, { type: 'rebuy', pid: di.id, amount: 1000 }).ok, 'bank trip ' + (i + 1) + ' of 3 allowed');
  let rr = applyAction(t3, P3, { type: 'rebuy', pid: di.id, amount: 1000 }); ok(!rr.ok && /cut you off/.test(rr.error) && di.takes === 3, 'the 4th trip is refused');
  ok(!applyAction(t3, P3, { type: 'settings', bankLimit: 0 }).ok, 'players cannot raise their own limit');
  ok(applyAction(t3, H3, { type: 'settings', bankLimit: 5 }).ok && applyAction(t3, P3, { type: 'rebuy', pid: di.id, amount: 1000 }).ok, 'host raising the limit lets them go again');
  ok(!applyAction(t3, H3, { type: 'settings', bankLimit: 21 }).ok && !applyAction(t3, H3, { type: 'settings', bankLimit: -1 }).ok && !applyAction(t3, H3, { type: 'settings', bankLimit: 2.5 }).ok, 'bad limits rejected');
  applyAction(t3, P3, { type: 'undo' }); ok(di.takes === 3, 'undoing a withdrawal gives the trip back');
  applyAction(t3, H3, { type: 'settings', bankLimit: 0 }); for (let i = 0; i < 10; i++) applyAction(t3, P3, { type: 'rebuy', pid: di.id, amount: 1000 }); ok(di.takes === 13, 'limit 0 means unlimited');
  applyAction(t3, H3, { type: 'reset' }); ok(di.takes === 0 && di.added === 0, 'reset clears trips');
}
console.log('ALL BANK FEE CHECKS PASSED');
