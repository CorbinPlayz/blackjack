// Online table service for the Blackjack Chip Tracker.
// The dealer's phone is the only writer; everyone else polls read-only.
// One Durable Object per table code keeps each table isolated and consistent.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const MAX_BODY = 200 * 1024;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const IDLE_CLOSE_MS = 5 * 60 * 1000;        // an online dealer table where nobody has played for 5 minutes closes and cashes everybody out

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Device-Id, X-Admin-Key',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

function randomString(len, chars) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

// Reject anything that is not a plausible chip-tracker table.
export function validState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.players)) return false;
  if (s.players.length > 100) return false;
  if (s.history !== undefined && (!Array.isArray(s.history) || s.history.length > 200)) return false;
  const playersOk = s.players.every(p =>
    p && typeof p.id === 'number' && typeof p.name === 'string' && p.name.length <= 60 &&
    Number.isInteger(p.start) && Number.isInteger(p.balance));
  const historyOk = (s.history || []).every(h =>
    h && Number.isInteger(h.id) && Number.isInteger(h.pid) && typeof h.name === 'string' && typeof h.outcome === 'string' &&
    Number.isInteger(h.wager) && Number.isInteger(h.delta));
  return playersOk && historyOk;
}

/* ================= ONLINE DEALER =================
   The server deals: a 6-deck shoe (crypto shuffle), dealer stands on every 17, blackjack pays 3:2, split once, double on two cards,
   insurance pays 2:1. The shoe and the hole card live under the separate storage key 'secret', so they can never be sent to a client.
   Cards are 0..51 (rank = c % 13: 0 = ace, 1..8 = 2..9, 9..12 = 10/J/Q/K). Time moves lazily: advance() is called on every request. */
const POT_START = 10000000, MAX_BET_PCT = 2, CUT_PCT = 5, DEFAULT_MAX_BET = 200000;   // casino pot $100,000; max bet = 2% of the pot (so one round pays at most 4 bets = 8%); dealer cut 5%
const LOCK_MS = 24 * 60 * 60 * 1000, BROKE_BELOW = 100;   // when the pot falls under $1 the whole site locks for exactly 24 hours, then a new casino opens
const maxBetFor = pot => Math.max(0, Math.floor(pot * MAX_BET_PCT / 100));
const BET_MS = 20000, MIN_BET_MS = 6000, FIRST_BET_MS = 8000, ACT_MS = 15000, INS_MS = 10000, RESULT_MS = 7000, IDLE_LIMIT = 2;
export const cardValue = c => { const r = c % 13; return r === 0 ? 11 : r >= 9 ? 10 : r + 1; };
export function handTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { const v = cardValue(c); total += v; if (v === 11) aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isBlackjack = cards => cards.length === 2 && handTotal(cards).total === 21;
export function randInt(n) {                         // unbiased random integer in [0, n)
  const lim = Math.floor(4294967296 / n) * n, b = new Uint32Array(1);
  do { crypto.getRandomValues(b); } while (b[0] >= lim);
  return b[0] % n;
}
export function newShoe(rand) {
  rand = rand || randInt;
  const s = [];
  for (let d = 0; d < 6; d++) for (let c = 0; c < 52; c++) s.push(c);
  for (let i = s.length - 1; i > 0; i--) { const j = rand(i + 1); const x = s[i]; s[i] = s[j]; s[j] = x; }
  return s;
}
export function normalizeSecret(x) {
  x = x && typeof x === 'object' ? x : {};
  const ok = c => Number.isInteger(c) && c >= 0 && c < 52;
  return { shoe: (Array.isArray(x.shoe) ? x.shoe : []).filter(ok), hole: ok(x.hole) ? x.hole : -1 };
}
function histPush(t, p, outcome, wager, delta) {
  t.history.push({ id: t.nextHid++, pid: p.id, name: p.name, outcome, wager, delta });
  if (t.history.length > HISTORY_MAX) t.history.shift();
}

export function advance(t, secret, now, rand) {
  if (!t.settings.auto) return false;
  const D = t.deal;
  let changed = false;
  const draw = () => { if (!secret.shoe.length) secret.shoe = newShoe(rand); return secret.shoe.pop(); };
  const eligible = () => t.players.filter(p => !p.out && p.balance > 0);

  const afterInsurance = () => {                     // the dealer peeks for blackjack, then the players act
    const dbj = isBlackjack([D.cards[0], secret.hole]);
    t.players.forEach(p => {
      p.hands.forEach(h => { h.bj = isBlackjack(h.cards); h.done = dbj || h.bj; });
      p.until = 0;                                   // no clocks: the table waits for everyone
    });
    D.phase = 'acting';
  };
  const deal = bettors => {
    if (secret.shoe.length < 78) secret.shoe = newShoe(rand);
    D.cards = []; D.dealerBJ = false;
    t.players.forEach(p => { p.hands = []; p.ins = 0; p.insDone = true; p.until = 0; if (!bettors.includes(p)) p.bet = 0; });
    bettors.forEach(p => { p.hands = [{ cards: [draw()], bet: p.bet, doubled: false, done: false, bj: false, res: '', net: 0 }]; p.hand = p.bet; p.last = p.bet; p.bet = 0; });
    D.cards.push(draw());
    bettors.forEach(p => p.hands[0].cards.push(draw()));
    secret.hole = draw(); D.hole = true;
    if (cardValue(D.cards[0]) === 11) {              // an ace shows: offer insurance
      bettors.forEach(p => { const side = Math.floor(p.hands[0].bet / 2); p.insDone = !(side > 0 && p.balance - p.hand >= side); });
      D.phase = 'insurance'; D.deadline = 0;
    } else afterInsurance();
  };
  const settle = () => {
    const dt = handTotal(D.cards).total, dbj = isBlackjack(D.cards), dbust = dt > 21;
    D.dealerBJ = dbj;
    t.players.forEach(p => {
      if (!p.hands.length) return;
      p.hands.forEach(h => {
        const pt = handTotal(h.cards).total;
        let res;
        if (pt > 21) res = 'bust';
        else if (h.bj) res = dbj ? 'push' : 'blackjack';
        else if (dbj) res = 'loss';
        else if (dbust || pt > dt) res = 'win';
        else if (pt === dt) res = 'push';
        else res = 'loss';
        const n = res === 'win' ? h.bet : res === 'blackjack' ? Math.round(h.bet * 3 / 2) : res === 'push' ? 0 : -h.bet;
        h.res = res; h.net = n;
        p.balance += n; t.house -= n;
        histPush(t, p, res === 'bust' ? 'loss' : res, h.bet, n);
      });
      if (p.ins > 0) {
        const n = dbj ? p.ins * 2 : -p.ins;
        p.balance += n; t.house -= n;
        histPush(t, p, dbj ? 'insurance_win' : 'insurance_loss', p.ins, n);
      }
      p.hand = 0; p.until = 0;
      if (p.bet > p.balance) p.bet = p.balance;
    });
    D.phase = 'results'; D.deadline = 0; D.next = false;      // the results stay up until a player presses Next round (or places a bet)
  };
  const dealerPlay = () => {
    D.cards.push(secret.hole); secret.hole = -1; D.hole = false;
    const needed = t.players.some(p => p.hands.some(h => handTotal(h.cards).total <= 21 && !h.bj));
    if (needed) while (handTotal(D.cards).total < 17) D.cards.push(draw());
    settle();
  };

  for (let guard = 0; guard < 12; guard++) {
    let moved = false;
    if (D.phase === 'betting') {
      if (!D.startedAt) {
        D.startedAt = now; D.deadline = 0; moved = true;
        if (t.settings.autoBet) t.players.forEach(p => { if (!p.out && p.last > 0 && p.balance > 0 && !(p.bet > 0)) p.bet = Math.min(p.last, p.balance, t.maxBet); });
      } else {
        const el = eligible(), bet = el.filter(p => p.bet > 0 && p.bet <= p.balance);
        if (bet.length && bet.length === el.length) { deal(bet); moved = true; }      // everyone who can play has locked in a wager
      }
    } else if (D.phase === 'insurance') {
      const waiting = t.players.filter(p => p.hands.length && !p.insDone);
      if (!waiting.length) { afterInsurance(); moved = true; }
    } else if (D.phase === 'acting') {
      if (!t.players.some(p => p.hands.some(h => !h.done))) { dealerPlay(); moved = true; }
    } else if (D.phase === 'results' && D.next) {
      t.players.forEach(p => { p.hands = []; p.ins = 0; p.insDone = false; if (p.idle >= IDLE_LIMIT) { p.out = true; p.idle = 0; p.bet = 0; } });   // asleep for two rounds: sit out
      D.cards = []; D.hole = false; D.dealerBJ = false; D.phase = 'betting'; D.startedAt = 0; D.deadline = 0; D.next = false; t.round.n += 1; moved = true;
    }
    if (!moved) break;
    changed = true;
  }
  D.shoeLeft = secret.shoe.length;
  return changed;
}

// A player's own decision. p must be the acting player's seat; returns { ok } or { ok:false, error }.
function playerAct(t, secret, p, a, now, rand) {
  const D = t.deal, no = error => ({ ok: false, error });
  const draw = () => { if (!secret.shoe.length) secret.shoe = newShoe(rand); return secret.shoe.pop(); };
  if (a.type === 'insure') {
    if (D.phase !== 'insurance') return no('Insurance is not being offered right now.');
    if (!p.hands.length) return no('You are not in this round.');
    if (p.insDone) return no('You already answered.');
    if (a.take === true) {
      const side = Math.floor(p.hands[0].bet / 2);
      if (!(side > 0) || p.balance - p.hand < side) return no('Not enough chips to insure.');
      p.ins = side; p.hand += side;
    }
    p.insDone = true; p.idle = 0;
    return { ok: true };
  }
  if (D.phase !== 'acting') return no('Wait for the dealer.');
  const h = p.hands.find(x => !x.done);
  if (!h) return no('You have no hand to play.');
  const bust = () => { if (handTotal(h.cards).total > 21) h.res = 'bust'; };
  if (a.type === 'hit') {
    h.cards.push(draw());
    if (handTotal(h.cards).total >= 21) h.done = true;
    bust();
  } else if (a.type === 'stand') {
    h.done = true;
  } else if (a.type === 'double') {
    if (h.cards.length !== 2 || h.doubled) return no('You can only double on your first two cards.');
    if (p.balance - p.hand < h.bet) return no('Not enough chips to double (' + fmt(h.bet) + ' more needed).');
    p.hand += h.bet; h.bet *= 2; h.doubled = true;
    h.cards.push(draw()); h.done = true; bust();
  } else if (a.type === 'split') {
    if (p.hands.length !== 1 || h.cards.length !== 2 || cardValue(h.cards[0]) !== cardValue(h.cards[1])) return no('You can only split a pair, once.');
    if (p.balance - p.hand < h.bet) return no('Not enough chips to split (' + fmt(h.bet) + ' more needed).');
    p.hand += h.bet;
    const second = h.cards.pop(), aces = cardValue(second) === 11;
    h.cards.push(draw());
    const h2 = { cards: [second, draw()], bet: h.bet, doubled: false, done: false, bj: false, res: '', net: 0 };
    p.hands.push(h2);
    [h, h2].forEach(x => { if (aces || handTotal(x.cards).total === 21) x.done = true; });   // split aces get one card each
  } else return no('Unknown action.');
  p.idle = 0; p.until = 0;
  return { ok: true };
}

/* ================= TABLE RULES =================
   The server is the referee. Everyone (host and players) sends "actions"; this function decides.
   Every player bets alone against the dealer: an action only ever changes the seat it names.
   actor = { role: 'host' | 'player', ref: <public id of the acting device> }                  */
const HISTORY_MAX = 100;
const MAX_CENTS = 100000000000;
const isCents = n => Number.isInteger(n) && n > 0 && n <= MAX_CENTS;

function fmt(cents) {
  const neg = cents < 0; if (neg) cents = -cents;
  const dollars = Math.floor(cents / 100), rem = cents % 100;
  const d = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + '$' + d + (rem ? '.' + (rem < 10 ? '0' : '') + rem : '');
}

const nn = n => Number.isInteger(n) && n > 0 ? n : 0;
const isCard = c => Number.isInteger(c) && c >= 0 && c < 52;
const newPlayer = (id, name, start, owner) => {
  const p = { id, name, start, balance: start, added: 0, takes: 0, bet: 0, hand: 0, doubled: false, out: false, last: 0, trivia: 0, triviaAt: -1, vin: 0, vout: 0, hands: [], ins: 0, insDone: false, until: 0, idle: 0 };
  if (owner) p.owner = owner;
  return p;
};

export function normalizeTable(t) {
  t = t && typeof t === 'object' ? t : {};
  const players = (Array.isArray(t.players) ? t.players : []).map(p => {
    const q = { id: p.id, name: String(p.name), start: p.start, balance: p.balance,
      added: nn(p.added),                                    // chips taken from the bank after the buy-in (so net profit is honest)
      takes: nn(p.takes),                                    // how many times they went to the bank
      bet: nn(p.bet), hand: nn(p.hand), doubled: p.doubled === true, out: p.out === true, last: nn(p.last),   // round play: next wager, wager in play, sitting out, last round's wager (for auto-repeat)
      trivia: nn(p.trivia), triviaAt: Number.isInteger(p.triviaAt) ? p.triviaAt : -1,        // trivia winnings so far, and the match they last answered in
      vin: nn(p.vin), vout: nn(p.vout),                      // chips moved in from / out to the savings vault
      hands: (Array.isArray(p.hands) ? p.hands : []).slice(0, 2).map(h => ({     // online dealer: this seat's cards (public: everyone sees them)
        cards: (Array.isArray(h && h.cards) ? h.cards : []).filter(isCard).slice(0, 12), bet: nn(h && h.bet), doubled: !!h && h.doubled === true,
        done: !!h && h.done === true, bj: !!h && h.bj === true, res: h && typeof h.res === 'string' ? h.res.slice(0, 12) : '', net: h && Number.isInteger(h.net) ? h.net : 0 })),
      ins: nn(p.ins), insDone: p.insDone === true, until: nn(p.until), idle: nn(p.idle) };
    if (typeof p.owner === 'string' && p.owner) q.owner = p.owner;
    return q;
  });
  const history = (Array.isArray(t.history) ? t.history : []).map(h => ({
    id: h.id, pid: h.pid, name: String(h.name), outcome: String(h.outcome), wager: h.wager, delta: h.delta }));
  const maxId = players.reduce((m, p) => Math.max(m, p.id), 0);
  const maxHid = history.reduce((m, h) => Math.max(m, h.id), 0);
  const st = t.settings && typeof t.settings === 'object' ? t.settings : {};
  const rd = t.round && typeof t.round === 'object' ? t.round : {};
  const dl = t.deal && typeof t.deal === 'object' ? t.deal : {};
  return {
    players, history,
    house: Number.isInteger(t.house) ? t.house : 0,       // chips the table's house holds (fees, player losses); negative = the house owes (until the casino pot exists)
    sn: typeof t.sn === 'string' ? t.sn.slice(0, 2000) : '',     // what the bank last heard about the chips on the seats (for the leaderboard)
    hs: Number.isInteger(t.hs) ? t.hs : 0,               // part of `house` already moved into the casino pot (online dealer tables keep house == hs after every request)
    hostRef: typeof t.hostRef === 'string' && REF_RE.test(t.hostRef) ? t.hostRef : '',   // the account that opened the table: earns the dealer cut
    potStart: Number.isInteger(t.potStart) && t.potStart > 0 ? t.potStart : 0, epoch: Number.isInteger(t.epoch) && t.epoch > 0 ? t.epoch : 0,   // casino pot and casino number when the shift began
    maxBet: Number.isInteger(t.maxBet) && t.maxBet >= 0 ? t.maxBet : DEFAULT_MAX_BET,   // 2% of the casino pot, refreshed on every bank call
    funded: Number.isInteger(t.funded) ? t.funded : 0,   // money that came in from bank accounts (net): chips on seats + house always add up to this
    nextId: Math.max(typeof t.nextId === 'number' ? t.nextId : 1, maxId + 1),
    nextHid: Math.max(typeof t.nextHid === 'number' ? t.nextHid : 1, maxHid + 1),
    deal: { phase: ['betting', 'insurance', 'acting', 'results'].includes(dl.phase) ? dl.phase : 'betting', startedAt: nn(dl.startedAt), deadline: nn(dl.deadline), next: dl.next === true,
      cards: (Array.isArray(dl.cards) ? dl.cards : []).filter(isCard).slice(0, 12), hole: dl.hole === true, shoeLeft: nn(dl.shoeLeft), dealerBJ: dl.dealerBJ === true },   // the dealer's PUBLIC cards (the hole card is not here)
    round: { n: Number.isInteger(rd.n) && rd.n > 0 ? rd.n : 1, phase: rd.phase === 'playing' ? 'playing' : 'betting' },
    dealer: typeof t.dealer === 'string' && REF_RE.test(t.dealer) ? t.dealer : '',          // '' = the host deals
    dealerReq: typeof t.dealerReq === 'string' && REF_RE.test(t.dealerReq) ? t.dealerReq : '',
    settings: { locked: st.locked === true, maxBuyin: isCents(st.maxBuyin) ? st.maxBuyin : 0,
      bankFee: Number.isInteger(st.bankFee) && st.bankFee >= 0 && st.bankFee <= 50 ? st.bankFee : 10,        // % kept by the bank when chips are taken
      bankLimit: Number.isInteger(st.bankLimit) && st.bankLimit >= 0 && st.bankLimit <= 20 ? st.bankLimit : 3,   // max bank trips per player (0 = no limit)
      triviaPct: Number.isInteger(st.triviaPct) && st.triviaPct >= 0 && st.triviaPct <= 20 ? st.triviaPct : 10, // trivia can pay up to this % of each player's buy-in
      rounds: st.rounds === false ? false : true,
      auto: st.auto === true,                                // the server deals (online dealer table)
      autoBet: st.autoBet === false ? false : true },        // repeat each player's last wager for the next round (they can still change it)          // rounds: wagers -> dealer Start -> hands -> next round
  };
}

function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30); }

// ctx.funded = an online table: every chip comes from (and goes back to) a bank account. res.ops lists the account moves.
export function applyAction(t, actor, a, ctx) {
  const ops = [];
  const res = applyCore(t, actor, a, ctx, ops);
  if (res.ok && ops.length) res.ops = ops;
  return res;
}

function applyCore(t, actor, a, ctx, ops) {
  ctx = ctx || {};
  const funded = ctx.funded === true;
  const account = Number.isInteger(ctx.account) ? ctx.account : (ctx.vault || 0);
  const bankOp = (ref, delta, kind, note, mint) => { const o = { ref, delta, kind, note }; if (mint) o.mint = mint; ops.push(o); };
  const host = actor.role === 'host';
  const deny = error => ({ ok: false, error });
  const dealerRef = !!actor.ref && !!t.dealer && actor.ref === t.dealer;
  const dealerPower = host || dealerRef;                // the host can always act as dealer; so can the player they handed the deck to
  const mine = p => !!actor.ref && p.owner === actor.ref;
  const find = id => t.players.find(p => p.id === id);
  const may = p => dealerPower || mine(p);              // players may only touch their own seat
  const dealerSeat = p => !!t.dealer && p.owner === t.dealer;
  const rounds = t.settings.rounds;
  const auto = t.settings.auto === true;
  const now = Number.isInteger(ctx.now) ? ctx.now : Date.now();
  if (auto && !ctx.secret) ctx.secret = normalizeSecret(null);
  const NOT_YOURS = 'You can only change your own chips.';
  if (!a || typeof a !== 'object') return deny('Unknown action.');
  if (!dealerPower && t.settings.locked) return deny('The host has paused the table.');
  if (auto) {
    advance(t, ctx.secret, now, ctx.rand);
    if (['start', 'finish', 'settle', 'insurance', 'undo', 'add', 'dealer_request', 'dealer_cancel', 'dealer_reject', 'dealer_accept', 'dealer_set'].includes(a.type)) return deny('The online dealer runs this table.');
    if (a.type === 'next') {                         // any seated player can close the results and open the next round
      if (!t.players.some(mine)) return deny('Take a seat first.');
      if (t.deal.phase !== 'results') return deny('The round is not over yet.');
      t.deal.next = true; advance(t, ctx.secret, now, ctx.rand);
      return { ok: true };
    }
    if (a.type === 'bet' && t.deal.phase === 'results' && t.players.some(mine)) {      // wagering for the next round also closes the results
      const ab = t.settings.autoBet; t.settings.autoBet = false;                      // the wager being placed replaces this player's auto-repeat; the others still get theirs
      t.deal.next = true; advance(t, ctx.secret, now, ctx.rand); t.settings.autoBet = ab;
      if (ab) t.players.forEach(q => { if (!mine(q) && !q.out && q.last > 0 && q.balance > 0 && !(q.bet > 0)) q.bet = Math.min(q.last, q.balance, t.maxBet); });
    }
    if (['hit', 'stand', 'double', 'split', 'insure'].includes(a.type)) {
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!mine(p)) return deny('Only you can play your own hand.');
      const r = playerAct(t, ctx.secret, p, a, now, ctx.rand);
      if (!r.ok) return deny(r.error);
      advance(t, ctx.secret, now, ctx.rand);
      return { ok: true };
    }
  } else if (['hit', 'stand', 'split', 'insure'].includes(a.type)) return deny('This is not an online dealer table.');
  const logHand = (p, outcome, wager, delta) => {
    t.history.push({ id: t.nextHid++, pid: p.id, name: p.name, outcome, wager, delta });
    if (t.history.length > HISTORY_MAX) t.history.shift();
  };
  const overMax = c => t.settings.maxBuyin && c > t.settings.maxBuyin ? 'The host set a max of ' + fmt(t.settings.maxBuyin) + ' per buy-in.' : null;
  const matchKey = () => rounds ? t.round.n : t.nextHid;       // trivia: one question per round (or per hand in quick mode)
  const autoBets = () => {
    if (!t.settings.autoBet) return;
    t.players.forEach(p => { if (!p.out && !dealerSeat(p) && p.last > 0 && p.balance > 0 && !(p.bet > 0)) p.bet = Math.min(p.last, p.balance); });
  };
  const roundOver = () => {
    if (rounds && t.round.phase === 'playing' && !t.players.some(p => p.hand > 0)) { t.round.phase = 'betting'; t.round.n += 1; autoBets(); }
  };
  const handsInPlay = () => t.players.some(p => p.hand > 0);

  switch (a.type) {
    case 'add': {                                    // host adds anyone
      if (!host) return deny('Only the host can add other players.');
      if (funded) return deny('Every seat is paid for from a bank account. Ask the player to take their own seat.');
      const name = cleanName(a.name);
      if (!name) return deny('Enter a player name.');
      if (!isCents(a.start)) return deny('Starting balance must be more than $0.');
      t.players.push(newPlayer(t.nextId++, name, a.start));
      return { ok: true };
    }
    case 'seat': {                                   // a player takes their own seat
      if (host && !auto) return deny('Use Add Player to seat someone as host.');
      if (!actor.ref) return deny('Your device is not recognised.');
      if (t.players.some(mine)) return deny('You already have a seat.');
      const name = funded && cleanName(ctx.name) ? cleanName(ctx.name) : cleanName(a.name);     // online: you ARE your signed-in account, the name comes from it
      if (!name) return deny('Enter your name.');
      if (!isCents(a.buyin)) return deny('Starting balance must be more than $0.');
      const m = overMax(a.buyin); if (m) return deny(m);
      if (t.players.length >= 100) return deny('The table is full.');
      if (funded) {
        if (account < a.buyin) return deny('Not enough money in your bank account (' + fmt(account) + ').');
        t.players.push(newPlayer(t.nextId++, name, a.buyin, actor.ref));
        t.funded += a.buyin;
        bankOp(actor.ref, -a.buyin, 'buyin', 'Bought in at a table');
        return { ok: true, vault: -a.buyin, vaultRef: actor.ref };
      }
      if (a.fromVault && (ctx.vault || 0) < a.buyin) return deny('Not enough chips in your vault (' + fmt(ctx.vault || 0) + ').');
      t.players.push(newPlayer(t.nextId++, name, a.buyin, actor.ref));
      return a.fromVault ? { ok: true, vault: -a.buyin, vaultRef: actor.ref } : { ok: true };
    }
    case 'bet': {                                    // next round's wager (changeable until the dealer starts)
      if (!rounds) return deny('Quick mode: wagers are entered when the hand is settled.');
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (auto && !mine(p)) return deny(NOT_YOURS);
      if (auto && t.deal.phase !== 'betting') return deny('Bets are closed. Wait for the next round.');
      if (dealerSeat(p)) return deny('The dealer does not bet.');
      if (p.out) return deny('Sit back in before wagering.');
      if (p.hand > 0) return deny('Your hand is in play. Wager for the next round after it ends.');
      if (!Number.isInteger(a.amount) || a.amount < 0) return deny('Wager must be more than $0.');
      if (a.amount > p.balance) return deny('Wager is more than balance (' + fmt(p.balance) + ').');
      if (auto) {
        if (Number.isInteger(ctx.pot)) t.maxBet = maxBetFor(ctx.pot);
        if (a.amount > 0 && !(t.maxBet > 0)) return deny('The casino cannot cover any bets right now.');
        if (a.amount > t.maxBet) return deny('The max bet is ' + fmt(t.maxBet) + ' (' + MAX_BET_PCT + '% of the casino pot).');
      }
      const others = t.players.some(q => q !== p && q.bet > 0);
      p.bet = a.amount;
      if (auto) {
        p.idle = 0;
        advance(t, ctx.secret, now, ctx.rand);
      }
      return { ok: true, bet: p.bet };
    }
    case 'start': {                                  // dealer starts the round once every wager is in
      if (!rounds) return deny('Rounds are off.');
      if (!dealerPower) return deny('Only the dealer can start the round.');
      if (t.round.phase !== 'betting') return deny('A round is already in play.');
      const eligible = t.players.filter(p => !p.out && p.balance > 0 && !dealerSeat(p));
      if (!eligible.length) return deny('Nobody can play yet: players need chips and must not be sitting out.');
      const waiting = eligible.filter(p => !(p.bet > 0));
      let ready = eligible;
      if (waiting.length) {                          // "start anyway": players without a wager just skip this round
        if (a.force !== true) return deny('Waiting for wagers from: ' + waiting.map(p => p.name).join(', ') + '.');
        ready = eligible.filter(p => p.bet > 0);
        if (!ready.length) return deny('Nobody has locked in a wager yet.');
      }
      const over = ready.find(p => p.bet > p.balance);
      if (over) return deny(over.name + ' wagered more than their balance.');
      ready.forEach(p => { p.hand = p.bet; p.last = p.bet; p.bet = 0; p.doubled = false; });
      t.players.forEach(p => { if (!ready.includes(p)) p.bet = 0; });
      t.round.phase = 'playing';
      return { ok: true, n: t.round.n, players: ready.length, skipped: waiting.length && a.force === true ? waiting.length : 0 };
    }
    case 'finish': {                                 // dealer: close out the round, every unsettled hand is a push
      if (!rounds) return deny('Rounds are off.');
      if (!dealerPower) return deny('Only the dealer can do that.');
      if (t.round.phase !== 'playing') return deny('No round in play.');
      let n = 0;
      t.players.forEach(p => { if (p.hand > 0) { logHand(p, 'push', p.hand, 0); p.hand = 0; p.doubled = false; n++; } });
      roundOver();
      return { ok: true, n };
    }
    case 'double': {                                 // double the wager mid-hand
      if (!rounds) return deny('Rounds are off.');
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (!(p.hand > 0)) return deny('No hand in play.');
      if (p.doubled) return deny('Already doubled this hand.');
      if (p.hand * 2 > p.balance) return deny('Not enough chips to double (' + fmt(p.hand * 2) + ' needed, you have ' + fmt(p.balance) + ').');
      p.hand *= 2; p.doubled = true;
      return { ok: true, hand: p.hand };
    }
    case 'sitout': {                                 // skip rounds without blocking the Start button
      if (!rounds) return deny('Rounds are off.');
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (auto && !mine(p)) return deny(NOT_YOURS);
      if (p.hand > 0) return deny('Your hand is in play.');
      p.out = a.out === true; p.idle = 0;
      if (p.out) p.bet = 0;
      else if (!auto && t.round.phase === 'betting' && !(p.bet > 0) && !dealerSeat(p) && t.settings.autoBet && p.last > 0 && p.balance > 0) p.bet = Math.min(p.last, p.balance);
      if (auto) advance(t, ctx.secret, now, ctx.rand);      // nobody is waiting on a player who sat out
      return { ok: true };
    }
    case 'settle': {
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (funded && mine(p)) return deny('You cannot settle your own hand. Someone else deals and settles it.');
      let wager = a.wager;
      if (rounds) {
        if (!(p.hand > 0)) return deny('No hand in play for ' + p.name + '. Wait for the dealer to start the round.');
        wager = p.hand;
      } else {
        if (!Number.isInteger(a.wager) || a.wager <= 0) return deny('Wager must be more than $0.');
        if (a.wager > p.balance) return deny('Wager is more than balance (' + fmt(p.balance) + ').');
      }
      let delta;
      if (a.outcome === 'win') delta = wager;                        // 1:1
      else if (a.outcome === 'blackjack') delta = Math.round(wager * 3 / 2); // 3:2
      else if (a.outcome === 'push') delta = 0;
      else if (a.outcome === 'loss') delta = -wager;
      else return deny('Unknown outcome.');
      if (funded && delta > 0 && t.house < delta) return deny('This friendly table only pays out chips it has won: the house holds ' + fmt(Math.max(0, t.house)) + '. Casino money is only at online dealer tables.');
      p.balance += delta;
      if (funded) t.house -= delta;
      logHand(p, a.outcome, wager, delta);
      if (rounds) { p.hand = 0; p.doubled = false; }
      if (p.bet > p.balance) p.bet = p.balance;
      roundOver();
      return { ok: true, delta, balance: p.balance };
    }
    case 'insurance': {                              // side bet = half the main wager, pays 2:1
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (funded && mine(p)) return deny('You cannot settle your own insurance. Someone else deals and settles it.');
      let wager = a.wager;
      if (rounds) { if (!(p.hand > 0)) return deny('No hand in play.'); wager = p.hand; }
      else if (!Number.isInteger(a.wager) || a.wager <= 0) return deny('Wager must be more than $0.');
      if (a.result !== 'win' && a.result !== 'loss') return deny('Unknown insurance result.');
      const side = Math.floor(wager / 2);
      if (side <= 0) return deny('Wager is too small to insure.');
      if (wager + side > p.balance) return deny('Not enough chips to also insure (' + fmt(side) + ' on top of the bet).');
      const delta = a.result === 'win' ? side * 2 : -side;
      if (funded && delta > 0 && t.house < delta) return deny('This friendly table only pays out chips it has won: the house holds ' + fmt(Math.max(0, t.house)) + '.');
      p.balance += delta;
      if (funded) t.house -= delta;
      logHand(p, a.result === 'win' ? 'insurance_win' : 'insurance_loss', side, delta);
      return { ok: true, delta, balance: p.balance };
    }
    case 'rebuy': {                                  // taking chips from the bank is logged so everyone can see it
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (!isCents(a.amount)) return deny('Enter an amount of chips to add.');
      if (funded) {
        if (!mine(p)) return deny('Only the player can take money from their own bank account.');
        if (account < a.amount) return deny('Not enough money in your bank account (' + fmt(account) + ').');
      }
      const m = overMax(a.amount); if (m) return deny(m);
      if (t.settings.bankLimit && p.takes >= t.settings.bankLimit) return deny('The bank has cut you off: ' + p.takes + ' of ' + t.settings.bankLimit + ' trips used.');
      const fee = Math.ceil(a.amount * t.settings.bankFee / 100);   // taking chips from the bank costs a fee
      const got = a.amount - fee;
      if (got < 1) return deny('Too small: the ' + t.settings.bankFee + '% bank fee would take all of it.');
      p.balance += got;
      if (funded) { t.house += fee; t.funded += a.amount; bankOp(actor.ref, -a.amount, 'buyin', 'Bank trip to a table'); }
      p.added += a.amount; p.takes += 1;                    // you took the full amount out, so the fee shows up as a loss
      logHand(p, 'rebuy', fee, got);                        // wager column = the fee
      return { ok: true, delta: got, fee, balance: p.balance };
    }
    case 'trivia': {                                 // a correct answer pays a slice of the trivia allowance, once per match
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!(host || mine(p))) return deny(NOT_YOURS);
      const pct = t.settings.triviaPct;
      if (!pct) return deny('The host turned trivia off.');
      if (p.triviaAt === matchKey()) return deny('You already answered a trivia question this ' + (rounds ? 'round' : 'hand') + '.');
      const allowance = Math.floor(p.start * pct / 100);
      const remaining = allowance - p.trivia;
      if (remaining < 1) return deny('You have used all your trivia winnings (' + fmt(allowance) + ' max).');
      const reward = Math.min(remaining, Math.max(1, Math.floor(allowance / 5)));
      if (funded && !p.owner) return deny('That seat has no bank account.');
      p.balance += reward; p.trivia += reward;
      if (funded) { t.funded += reward; bankOp(p.owner, 0, 'trivia', 'Trivia winnings', reward); }   // the only new money besides the grant and admin mint
      logHand(p, 'trivia', 0, reward);
      p.triviaAt = matchKey();                       // after logging so quick mode's per-hand key stays put
      return { ok: true, delta: reward, balance: p.balance, remaining: remaining - reward };
    }
    case 'vault_deposit': {                          // move chips from the table into your savings vault
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!mine(p)) return deny('You can only use your own vault.');
      if (!isCents(a.amount)) return deny('Enter an amount to save.');
      if (a.amount > p.balance - p.hand) return deny('You can only save chips that are not in play (' + fmt(p.balance - p.hand) + ' available).');
      p.balance -= a.amount; p.vout += a.amount;
      if (p.bet > p.balance) p.bet = p.balance;
      logHand(p, 'vault_out', 0, -a.amount);
      if (funded) { t.funded -= a.amount; bankOp(actor.ref, a.amount, 'cashout', 'Chips saved from a table'); }
      return { ok: true, balance: p.balance, vault: a.amount, vaultRef: actor.ref };
    }
    case 'vault_withdraw': {                         // bring saved chips back to the table (no fee, not a bank trip)
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!mine(p)) return deny('You can only use your own vault.');
      if (!isCents(a.amount)) return deny('Enter an amount to withdraw.');
      const m = overMax(a.amount); if (m) return deny(m);
      if (funded ? account < a.amount : (ctx.vault || 0) < a.amount) return deny('Not enough money in your bank account (' + fmt(funded ? account : (ctx.vault || 0)) + ').');
      p.balance += a.amount; p.vin += a.amount;
      logHand(p, 'vault_in', 0, a.amount);
      if (funded) { t.funded += a.amount; bankOp(actor.ref, -a.amount, 'buyin', 'Chips taken to a table'); }
      return { ok: true, balance: p.balance, vault: -a.amount, vaultRef: actor.ref };
    }
    case 'undo': {
      if (funded && !dealerPower) return deny('Only the dealer can undo a hand.');
      let idx = -1;
      if (dealerPower) idx = t.history.length - 1;
      else {
        const seat = t.players.find(mine);
        if (!seat) return deny('You do not have a seat.');
        for (let i = t.history.length - 1; i >= 0; i--) if (t.history[i].pid === seat.id) { idx = i; break; }
      }
      if (idx < 0) return deny('No hands to undo.');
      const h = t.history[idx];
      if (h.outcome === 'vault_in' || h.outcome === 'vault_out') return deny('Vault moves can not be undone.');
      if (funded) {
        if (h.outcome === 'rebuy' || h.outcome === 'trivia') return deny('Bank moves can not be undone.');
        const hp = find(h.pid);
        if (!hp) return deny('That player has already left the table.');
        if (mine(hp)) return deny('You cannot undo hands on your own seat.');
      }
      if (funded && t.house + h.delta < 0) return deny('The house cannot give those chips back.');
      const hand = ['win', 'loss', 'blackjack', 'push'].includes(h.outcome);
      if (rounds && hand && t.round.phase !== 'playing') {
        if (idx !== t.history.length - 1 || t.round.n < 2) return deny('That round is over, so its hands can no longer be undone.');
        t.round.n -= 1; t.round.phase = 'playing';   // the last hand of the round was a mistake: reopen the round
        t.players.forEach(x => { x.bet = 0; });
      }
      t.history.splice(idx, 1);
      const p = find(h.pid);
      if (p) {
        p.balance -= h.delta;                       // newest entry of that seat, so the balance can't go negative
        if (h.outcome === 'rebuy') { p.added = Math.max(0, p.added - h.delta - h.wager); p.takes = Math.max(0, p.takes - 1); }
        if (h.outcome === 'trivia') { p.trivia = Math.max(0, p.trivia - h.delta); p.triviaAt = -1; }
        if (funded) t.house += h.delta;
        if (rounds && hand) { p.hand = h.wager; p.doubled = true; }      // the hand is back in play
      }
      return { ok: true, entry: h, playerFound: !!p };
    }
    case 'remove': {                                 // host removes anyone; a player can only leave their own seat
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!(host || mine(p))) return deny(NOT_YOURS);
      if ((funded || auto) && p.hand > 0) return deny('Finish the hand first. Then the chips go back to the bank account.');
      if (funded && p.owner && p.balance > 0) { t.funded -= p.balance; bankOp(p.owner, p.balance, 'cashout', 'Left a table'); }
      t.players = t.players.filter(x => x.id !== p.id);
      if (p.owner && t.dealerReq === p.owner) t.dealerReq = '';
      roundOver();
      if (auto) advance(t, ctx.secret, now, ctx.rand);      // the table no longer waits for the player who left
      return { ok: true };
    }
    case 'reset': {
      if (!host) return deny('Only the host can reset the table.');
      if (auto && t.deal.phase !== 'betting') return deny('Wait until the round is over.');
      if (funded) {                                  // chips are real money: nothing is refunded, created or destroyed; only the round and recent hands restart
        t.players.forEach(p => { p.bet = 0; p.hand = 0; p.doubled = false; p.out = false; p.last = 0; p.hands = []; p.ins = 0; p.idle = 0; });
        t.history = []; t.round = { n: 1, phase: 'betting' }; if (auto) t.deal.startedAt = 0;
        return { ok: true };
      }
      t.players.forEach(p => { p.balance = p.start; p.added = 0; p.takes = 0; p.bet = 0; p.hand = 0; p.doubled = false; p.out = false; p.last = 0; p.trivia = 0; p.triviaAt = -1; p.vin = 0; p.vout = 0; });
      t.history = [];
      t.round = { n: 1, phase: 'betting' };
      return { ok: true };
    }
    case 'dealer_request': {                         // ask to take over dealing
      if (!rounds) return deny('Rounds are off.');
      if (host) return deny('The host can just take the deck back.');
      if (!t.players.some(mine)) return deny('Take a seat first.');
      if (dealerRef) return deny('You are already the dealer.');
      if (t.dealerReq) return deny(t.dealerReq === actor.ref ? 'Your request is already waiting.' : 'Someone else already asked to deal.');
      if (t.round.phase !== 'betting' || handsInPlay()) return deny('Finish the round first.');
      t.dealerReq = actor.ref;
      return { ok: true };
    }
    case 'dealer_cancel': {
      if (!(dealerPower || (actor.ref && actor.ref === t.dealerReq))) return deny('Nothing to cancel.');
      t.dealerReq = '';
      return { ok: true };
    }
    case 'dealer_reject': {
      if (!dealerPower) return deny('Only the dealer can answer.');
      if (!t.dealerReq) return deny('No request to answer.');
      t.dealerReq = '';
      return { ok: true };
    }
    case 'dealer_accept': {
      if (!dealerPower) return deny('Only the dealer can answer.');
      if (!t.dealerReq) return deny('No request to answer.');
      if (t.round.phase !== 'betting' || handsInPlay()) return deny('Finish the round first.');
      t.dealer = t.dealerReq; t.dealerReq = '';
      t.players.forEach(p => { if (dealerSeat(p)) p.bet = 0; });
      return { ok: true };
    }
    case 'dealer_set': {                             // host: hand the deck to a seat's owner, or take it back ('')
      if (!host) return deny('Only the host can assign the dealer.');
      if (t.round.phase !== 'betting' || handsInPlay()) return deny('Finish the round first.');
      const ref = typeof a.ref === 'string' ? a.ref : '';
      if (ref && !t.players.some(p => p.owner === ref)) return deny('That player has no seat.');
      t.dealer = ref; t.dealerReq = '';
      t.players.forEach(p => { if (dealerSeat(p)) p.bet = 0; });
      return { ok: true };
    }
    case 'settings': {
      if (!host) return deny('Only the host can change table settings.');
      if (a.locked !== undefined) { if (typeof a.locked !== 'boolean') return deny('Bad setting.'); t.settings.locked = a.locked; }
      if (a.maxBuyin !== undefined) {
        if (!Number.isInteger(a.maxBuyin) || a.maxBuyin < 0 || a.maxBuyin > MAX_CENTS) return deny('Bad max buy-in.');
        t.settings.maxBuyin = a.maxBuyin;
      }
      if (a.bankFee !== undefined) {
        if (!Number.isInteger(a.bankFee) || a.bankFee < 0 || a.bankFee > 50) return deny('Bank fee must be a whole number from 0 to 50.');
        t.settings.bankFee = a.bankFee;
      }
      if (a.bankLimit !== undefined) {
        if (!Number.isInteger(a.bankLimit) || a.bankLimit < 0 || a.bankLimit > 20) return deny('Bank limit must be a whole number from 0 to 20.');
        t.settings.bankLimit = a.bankLimit;
      }
      if (a.triviaPct !== undefined) {
        if (!Number.isInteger(a.triviaPct) || a.triviaPct < 0 || a.triviaPct > 20) return deny('Trivia bonus must be a whole number from 0 to 20 (percent of the starting chips).');
        t.settings.triviaPct = a.triviaPct;
      }
      if (a.autoBet !== undefined) {
        if (typeof a.autoBet !== 'boolean') return deny('Bad setting.');
        t.settings.autoBet = a.autoBet;
      }
      if (a.auto !== undefined) {
        if (typeof a.auto !== 'boolean') return deny('Bad setting.');
        if (a.auto !== auto) {
          if (handsInPlay() || (auto && t.deal.phase !== 'betting')) return deny('Wait until the round is over.');
          t.settings.auto = a.auto;
          if (a.auto) { t.settings.rounds = true; t.dealer = ''; t.dealerReq = ''; t.round.phase = 'betting'; }
          t.deal = normalizeTable({}).deal;
          t.players.forEach(p => { p.bet = 0; p.hands = []; p.ins = 0; p.idle = 0; });
        }
      }
      if (a.rounds !== undefined) {
        if (typeof a.rounds !== 'boolean') return deny('Bad setting.');
        if (auto && a.rounds === false) return deny('The online dealer always plays in rounds.');
        t.settings.rounds = a.rounds;
        if (!a.rounds) { t.players.forEach(p => { p.hand = 0; p.bet = 0; p.doubled = false; }); t.round.phase = 'betting'; t.dealerReq = ''; }
      }
      return { ok: true };
    }
    default: return deny('Unknown action.');
  }
}

const ID_RE = /^[A-Za-z0-9]{32}$/;
const REF_RE = /^[A-Za-z0-9]{8}$/;
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MAX_PENDING = 50;

function reg(env, path, body) {
  const stub = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
  return stub.fetch('https://registry' + path, { method: 'POST', body: JSON.stringify(body || {}) });
}

// Admins: whoever holds the ADMIN_KEY secret, plus any Google account listed in the ADMIN_EMAILS secret
// (comma-separated). The emails live in a secret so they never end up in the public repo.
function adminEmails(env) {
  return String(env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
}
function keyOk(request, env) {
  const k = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && timingSafeEqual(k, env.ADMIN_KEY);
}

// Who is calling? Google is required: only a device signed in to an approved Google account gets in.
// 'ref' is the account's public id; it is what marks which seat a player owns.
async function identify(request, env) {
  const key = keyOk(request, env);
  const id = request.headers.get('X-Device-Id') || '';
  let ok = false, ref = '', email = '', name = '';
  if (ID_RE.test(id)) {
    const d = await (await reg(env, '/status', { deviceId: id })).json();
    if (d.status === 'approved') { ok = true; ref = d.ref || ''; email = d.email || ''; name = d.name || ''; }
  }
  const admin = key || (ok && !!email && adminEmails(env).includes(email));
  return { ok: ok || key, ref, email, name, admin };
}
async function isAdmin(request, env) { return (await identify(request, env)).admin; }

async function readJson(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- Google sign-in: verify a Google ID token (RS256) ---------- */
const GOOGLE_CLIENT_ID = '355335461593-qtlhcosgt9a5dssu9lnnfp81t7pnbrbv.apps.googleusercontent.com';
const b64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const b64uText = s => new TextDecoder().decode(b64u(s));

// Pure check: returns { email, name } or null. keys = Google's JWKS list.
export async function verifyIdToken(token, keys, clientId, nowSec) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(b64uText(parts[0])), payload = JSON.parse(b64uText(parts[1]));
    if (header.alg !== 'RS256') return null;
    const jwk = (keys || []).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    if (payload.aud !== clientId) return null;
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') return null;
    if (!(payload.exp > nowSec) || (payload.iat && payload.iat > nowSec + 300)) return null;
    if (payload.email_verified !== true && payload.email_verified !== 'true') return null;
    const email = String(payload.email || '').toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email) || email.length > 120) return null;
    return { email, name: String(payload.name || email.split('@')[0]).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30) || email.split('@')[0].slice(0, 30) };
  } catch (e) { return null; }
}

let certCache = { t: 0, keys: null };
async function googleKeys() {
  if (certCache.keys && Date.now() - certCache.t < 3600000) return certCache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('certs');
  certCache = { t: Date.now(), keys: (await r.json()).keys || [] };
  return certCache.keys;
}

let lockCache = { locked: false, until: 0, checked: 0 };
export function resetLockCache() { lockCache = { locked: false, until: 0, checked: 0 }; }
async function lockState(env) {                      // asks the bank at most every 2 seconds per worker instance
  const now = Date.now();
  if (lockCache.locked && now < lockCache.until && now - lockCache.checked < 2000) return lockCache;
  if (!lockCache.locked && now - lockCache.checked < 2000) return lockCache;
  try {
    const c = await (await reg(env, '/casino/get', {})).json();
    lockCache = { locked: !!c.locked, until: c.until || 0, checked: now };
  } catch (e) { lockCache = { locked: false, until: 0, checked: now }; }
  return lockCache;
}
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);

    // ---- bankruptcy lockdown: checked on EVERY call, on the server, so the page cannot be edited or refreshed around it ----
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/casino') {
      const lk = await lockState(env);
      if (lk.locked) return json({ error: 'The house went broke.', locked: true, until: lk.until, t: Date.now() }, 423);
    }

    // ---- access control ----
    if (url.pathname === '/api/access/status' && request.method === 'GET') {
      const id = request.headers.get('X-Device-Id') || '';
      if (!ID_RE.test(id)) return json({ status: 'none' });
      const d = await (await reg(env, '/status', { deviceId: id })).json();
      const admin = !!d.email && adminEmails(env).includes(d.email);
      if (admin && d.status === 'pending') {                       // an admin email is let in as soon as it shows up
        await reg(env, '/preapprove', { email: d.email });
        d.status = 'approved';
      }
      return json({ status: d.status, ref: d.ref, admin });
    }
    if (url.pathname === '/api/access/request' && request.method === 'POST') {
      return json({ error: 'Sign in with Google to ask for access.' }, 403);   // the name-only request is retired
    }
    if (url.pathname === '/api/access/google' && request.method === 'POST') {     // sign in with Google: links this device to the account
      const b = await readJson(request);
      if (!ID_RE.test(String(b.deviceId || ''))) return json({ error: 'bad device' }, 400);
      let who;
      try { who = await verifyIdToken(b.idToken, await googleKeys(), GOOGLE_CLIENT_ID, Math.floor(Date.now() / 1000)); }
      catch (e) { return json({ error: 'Could not reach Google. Try again.' }, 502); }
      if (!who) return json({ error: 'Google sign-in could not be verified.' }, 401);
      const r = await (await reg(env, '/google', { deviceId: b.deviceId, email: who.email, name: who.name })).json();
      if (adminEmails(env).includes(who.email) && r.status === 'pending') { await reg(env, '/preapprove', { email: who.email }); r.status = 'approved'; }
      return json({ status: r.status, ref: r.ref });
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!(await isAdmin(request, env))) return json({ error: 'unauthorized' }, 401);
      if (url.pathname === '/api/admin/devices' && request.method === 'GET') return withCors(await reg(env, '/list'));
      if (url.pathname === '/api/admin/self' && request.method === 'POST') {
        const b = await readJson(request);
        if (!ID_RE.test(String(b.deviceId || ''))) return json({ error: 'bad device' }, 400);
        return withCors(await reg(env, '/self', { deviceId: b.deviceId }));
      }
      if (url.pathname === '/api/admin/email' && request.method === 'POST') {     // pre-approve a Google email
        const b = await readJson(request);
        const email = String(b.email || '').trim().toLowerCase();
        if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email) || email.length > 120) return json({ error: 'bad email' }, 400);
        return withCors(await reg(env, '/preapprove', { email }));
      }
      if (url.pathname === '/api/admin/mint' && request.method === 'POST') {
        const b = await readJson(request);
        return withCors(await reg(env, '/bank/mint', { ref: String(b.ref || ''), amount: b.amount, note: String(b.note || '').slice(0, 60) }));
      }
      if (url.pathname === '/api/admin/loans/forgive' && request.method === 'POST') {
        const b = await readJson(request);
        return withCors(await reg(env, '/loan/forgive', { ref: String(b.ref || '') }));
      }
      const am = url.pathname.match(/^\/api\/admin\/devices\/([A-Za-z0-9]+)$/);
      if (am && request.method === 'POST') {
        const b = await readJson(request);
        if (!REF_RE.test(am[1]) || !['approve', 'block', 'remove'].includes(b.action)) return json({ error: 'bad request' }, 400);
        return withCors(await reg(env, '/action', { ref: am[1], action: b.action }));
      }
      return json({ error: 'not found' }, 404);
    }

    if (url.pathname === '/api/vault' && request.method === 'GET') {          // my saved chips (kept between games)
      const me = await identify(request, env);
      if (!me.ok || !me.ref) return json({ error: 'not approved' }, 403);
      return withCors(await reg(env, '/bank/get', { ref: me.ref }));
    }

    if (url.pathname.startsWith('/api/loans')) {                                // bank and friend loans (all rules live in the Registry)
      const me = await identify(request, env);
      if (!me.ok || !me.ref) return json({ error: 'not approved' }, 403);
      const sub = url.pathname.slice('/api/loans'.length).replace(/^[/]/, '');
      if (request.method === 'GET' && sub === '') return withCors(await reg(env, '/loan/status', { ref: me.ref }));
      if (request.method === 'POST' && ['bank', 'offer', 'cancel', 'accept', 'repay'].includes(sub)) {
        const b = await readJson(request);
        return withCors(await reg(env, '/loan/' + sub, { ref: me.ref, amount: b.amount, ratePct: b.ratePct, days: b.days, toName: typeof b.toName === 'string' ? b.toName.slice(0, 40) : '', id: typeof b.id === 'string' ? b.id.slice(0, 16) : '' }));
      }
      return json({ error: 'not found' }, 404);
    }
    if (url.pathname === '/api/leaderboard' && request.method === 'GET') {      // net worth ranking: accounts + own chips on tables, never the casino pot
      const me = await identify(request, env);
      if (!me.ok) return json({ error: 'not approved' }, 403);
      const lr = await reg(env, '/leaderboard', { ref: me.ref || '' });
      return withCors(lr);
    }
    if (url.pathname === '/api/casino' && request.method === 'GET') {         // the casino pot everyone is playing against
      const me = await identify(request, env);
      if (!me.ok) return json({ error: 'not approved' }, 403);
      return withCors(await reg(env, '/casino/get', {}));
    }

    const m = url.pathname.match(/^\/api\/rooms(?:\/([A-Za-z0-9]{4,6})(\/act)?)?$/);
    if (!m) return json({ error: 'not found' }, 404);
    const who = await identify(request, env);
    if (!who.ok) return json({ error: 'not approved' }, 403);

    // Create a table: find an unused code, claim it, return the host's secret token.
    if (!m[1]) {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      for (let i = 0; i < 8; i++) {
        const code = randomString(5, CODE_CHARS);
        const token = randomString(32, 'abcdefghijklmnopqrstuvwxyz0123456789');
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await stub.fetch('https://room/init', { method: 'POST', headers: { 'X-Ref': who.ref || '' }, body: JSON.stringify({ token }) });
        if (r.status === 200) return json({ code, token });
      }
      return json({ error: 'could not allocate a table' }, 503);
    }

    const code = m[1].toUpperCase();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    if (m[2]) {                                       // POST /api/rooms/CODE/act
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      const body = await request.text();
      if (body.length > 4096) return json({ error: 'too large' }, 413);
      return withCors(await stub.fetch('https://room/act', {
        method: 'POST',
        headers: { Authorization: request.headers.get('Authorization') || '', 'X-Ref': who.ref, 'X-Name': encodeURIComponent(who.name || ''), 'X-Code': code },
        body,
      }));
    }
    if (request.method === 'GET') return withCors(await stub.fetch('https://room/state', { headers: { 'X-Code': code } }));
    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > MAX_BODY) return json({ error: 'too large' }, 413);
      return withCors(await stub.fetch('https://room/state', {
        method: 'PUT',
        headers: { Authorization: request.headers.get('Authorization') || '', 'X-Code': code },
        body,
      }));
    }
    return json({ error: 'method not allowed' }, 405);
  },
};

function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  h.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, headers: h });
}

export class Room {
  constructor(state, env) { this.state = state; this.env = env; this.q = Promise.resolve(); }

  // Account moves and the casino pot, applied together (all or nothing, once per opId). On an online dealer table everything the house won or paid
  // since the last call (house - hs) moves in or out of the casino pot. If the pot cannot cover a payout, the pot pays what is left (it goes broke)
  // and the missing part is taken back from the seats, so no chip is ever created.
  async bankSync(table, opId, ops, code) {
    const auto = table.settings.auto === true;
    const potDelta = auto ? table.house - table.hs : 0;
    const map = {}; table.players.forEach(p => { if (p.owner && p.balance > 0) map[p.owner] = (map[p.owner] || 0) + p.balance; });
    const snap = JSON.stringify(Object.entries(map).sort());
    const snapChanged = snap !== table.sn;
    if (!ops.length && !potDelta && !snapChanged) return { ok: true, balances: {} };
    const body = { opId, ops };
    if (potDelta) body.potDelta = potDelta;
    if (snapChanged && code) body.seats = { code, map };
    if (!ops.length && !potDelta && !body.seats) return { ok: true, balances: {} };      // nothing the bank needs to hear
    const r = await reg(this.env, '/bank/apply', body);
    if (!r.ok) return { ok: false };
    const j = await r.json();
    table.sn = snap;
    if (auto) {
      let short = Number.isInteger(j.short) ? j.short : 0, taken = 0;
      if (short > 0) {
        const order = table.players.slice().sort((x, y) => (y.balance - y.hand) - (x.balance - x.hand));
        for (const p of order) { const free = Math.max(0, p.balance - p.hand), n = Math.min(short, free); p.balance -= n; short -= n; taken += n; }
        for (const p of order) { const n = Math.min(short, p.balance); p.balance -= n; short -= n; taken += n; if (p.bet > p.balance) p.bet = p.balance; }
        table.house += taken;
      }
      table.hs = table.house;
      if (Number.isInteger(j.pot)) table.maxBet = maxBetFor(j.pot);
    }
    return { ok: true, balances: j.balances || {} };
  }

  fetch(request) {                                   // one request at a time: the dealer's clock and the players' actions must never interleave
    const run = this.q.then(() => this.handle(request));
    this.q = run.catch(() => {});
    return run;
  }

  async handle(request) {
    const path = new URL(request.url).pathname;
    const now = Date.now();
    const meta = await this.state.storage.get('meta');
    let expired = meta && now - meta.updated > ROOM_TTL_MS, idleClosed = false, old0 = null;
    if (meta && !expired && now - meta.updated > IDLE_CLOSE_MS) {      // nobody has acted for 5 minutes (polling does not count): a table with seated players closes
      old0 = normalizeTable(await this.state.storage.get('table'));
      if (old0.settings.auto && old0.players.length) { expired = true; idleClosed = true; }
    }
    const code = request.headers.get('X-Code') || '';
    if (expired) {                                   // a closing table pays every seat back into its owner's bank account first (a hand in play is void: the wager was never taken from the seat)
      const old = old0 || normalizeTable(await this.state.storage.get('table'));
      const back = old.players.filter(p => p.owner && p.balance > 0).map(p => ({ ref: p.owner, delta: p.balance, kind: 'cashout', forced: true, note: idleClosed ? 'Table closed: nobody played for 5 minutes' : 'Table closed' }));
      const pend = old.house - old.hs;               // house chips not yet in the casino pot
      if (back.length || pend || old.settings.auto) {   // online dealer table: the rest goes to the pot and the host may earn the dealer cut; a friendly table's house leaves the supply
        const body = { opId: 'exp:' + code + ':' + meta.updated, ops: back, seatsClear: code };
        if (old.settings.auto) {
          if (pend) body.potDelta = pend;
          if (old.hostRef) body.cut = { ref: old.hostRef, base: Math.max(0, old.house), potStart: old.potStart, epoch: old.epoch };
        } else if (pend) body.supplyDelta = -pend;
        if (!body.ops.length && !body.potDelta && !body.supplyDelta && !body.cut && !old.players.length) body.skip = true;
        const r = body.skip ? { ok: true } : await reg(this.env, '/bank/apply', body);
        if (!r.ok) return json({ error: 'Try again in a moment.' }, 503);
      }
      await this.state.storage.deleteAll();
    }
    const live = meta && !expired ? meta : null;

    if (path === '/init') {
      if (live) return json({ error: 'taken' }, 409);
      const { token } = await request.json();
      await this.state.storage.put('meta', { token, v: 0, updated: now, born: now });
      let ci = {}; try { ci = await (await reg(this.env, '/casino/get', {})).json(); } catch (e) { ci = {}; }
      const hostRef = REF_RE.test(request.headers.get('X-Ref') || '') ? request.headers.get('X-Ref') : '';
      await this.state.storage.put('table', { players: [], history: [], hostRef, potStart: ci.pot || 0, epoch: ci.epoch || 0, maxBet: maxBetFor(ci.pot || 0) || DEFAULT_MAX_BET, settings: { auto: true, rounds: true } });   // new tables are online dealer tables
      return json({ ok: true });
    }

    if (!live) return json({ error: 'no such table' }, 404);

    const isHost = timingSafeEqual((request.headers.get('Authorization') || '').replace(/^Bearer /, ''), live.token);

    if (path === '/act') {                           // everyone: host (token) or an approved player
      let body;
      try { body = JSON.parse(await request.text()); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400); }
      const table = normalizeTable(await this.state.storage.get('table'));
      const secret = normalizeSecret(await this.state.storage.get('secret'));
      const ref = request.headers.get('X-Ref') || '';
      let accName = ''; try { accName = decodeURIComponent(request.headers.get('X-Name') || ''); } catch (e) { accName = ''; }
      const act = body && body.action;
      let account;                                     // bank account balance, only fetched when an action spends from it
      if (act && ref && ['seat', 'rebuy', 'vault_withdraw', 'vault_deposit', 'bet', 'remove'].includes(act.type)) {      // an overdue loan freezes the account: no playing, no cashing out, repaying is still allowed
        let fz = false; try { fz = (await (await reg(this.env, '/vault/get', { ref })).json()).frozen === true; } catch (e) { fz = false; }
        if (fz) return json({ ok: false, error: 'Your account is frozen until your loan is repaid. Repay it on the Me tab.' }, 400);
      }
      if (act && ref && ['seat', 'rebuy', 'vault_withdraw'].includes(act.type)) account = (await (await reg(this.env, '/vault/get', { ref })).json()).balance;
      let pot; if (act && act.type === 'bet' && table.settings.auto) { try { pot = (await (await reg(this.env, '/casino/get', {})).json()).pot; } catch (e) { pot = undefined; } }
      const res = applyAction(table, { role: isHost ? 'host' : 'player', ref }, act, { funded: true, account, secret, now, name: accName, pot });
      if (!res.ok) return json({ ok: false, error: res.error }, 400);
      let vaultBalance;
      {                                                // accounts and the casino pot are updated first (all or nothing, once per table version): if the bank refuses, the table is not saved
        const sy = await this.bankSync(table, code + '.' + (live.born || 0) + ':' + (live.v + 1), res.ops || [], code);
        if (!sy.ok) return json({ ok: false, error: 'The bank could not complete that. Nothing was changed.' }, 400);
        if (ref && typeof sy.balances[ref] === 'number') vaultBalance = sy.balances[ref];
      }
      const v = live.v + 1;
      await this.state.storage.put('table', table);
      await this.state.storage.put('secret', secret);
      await this.state.storage.put('meta', { token: live.token, v, updated: now, born: live.born });
      return json({ ok: true, v, t: now, state: table, delta: res.delta, balance: res.balance, entry: res.entry, playerFound: res.playerFound, fee: res.fee, hand: res.hand, n: res.n, skipped: res.skipped, vaultBalance });
    }

    if (request.method === 'GET') {
      const table = normalizeTable(await this.state.storage.get('table'));
      if (!table.settings.auto) return json({ v: live.v, state: table, t: now });
      const secret = normalizeSecret(await this.state.storage.get('secret'));
      if (!advance(table, secret, now)) return json({ v: live.v, state: table, t: now });      // the online dealer's clock moved on: save it (without keeping an idle table alive)
      const v = live.v + 1;
      const sy = await this.bankSync(table, code + '.' + (live.born || 0) + ':' + v, [], code);
      if (!sy.ok) return json({ v: live.v, state: normalizeTable(await this.state.storage.get('table')), t: now });   // the bank is busy: show the old state, the clock moves on next time
      await this.state.storage.put('table', table);
      await this.state.storage.put('secret', secret);
      await this.state.storage.put('meta', { token: live.token, v, updated: live.updated, born: live.born });
      return json({ v, state: table, t: now });
    }

    // PUT: host only, and only once, to start the table from the host's local game
    if (!isHost) return json({ error: 'unauthorized' }, 401);
    let body;
    try { body = JSON.parse(await request.text()); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!body || !validState(body.state)) return json({ error: 'bad state' }, 400);
    if (live.v !== 0) return json({ error: 'This table has already started.' }, 409);
    const seed = normalizeTable(Object.assign({}, body.state, {
      settings: Object.assign({}, body.state.settings, { rounds: true, auto: true }),   // online tables play in rounds, dealt by the server
      round: undefined, dealer: '', dealerReq: '',
      players: [], history: [], house: 0, hs: 0, funded: 0,       // no free chips: everyone sits down with money from their own bank account
    }));
    const cur = normalizeTable(await this.state.storage.get('table'));
    seed.hostRef = cur.hostRef; seed.potStart = cur.potStart; seed.epoch = cur.epoch; seed.maxBet = cur.maxBet;
    await this.state.storage.put('table', seed);
    await this.state.storage.put('meta', { token: live.token, v: 1, updated: now, born: live.born });
    return json({ ok: true, v: 1 });
  }
}

// Single instance holding every device that has asked for access.
// status: 'pending' (asked) -> 'approved' | 'blocked'. 'remove' deletes the record.
const START_GRANT = 100000;                      // $1,000 in cents, once per account
const LEDGER_MAX = 100;
// Running totals per account for the leaderboard: `free` = money that was handed out (welcome grant, admin mint, trivia), `cut` = dealer cuts.
// Profit on the leaderboard = net worth - free - cut, so neither free money nor the dealer's pay counts as winning. First use starts from the saved ledger.
async function addTotals(s, ref, type, amount, ledger) {
  if (!['grant', 'mint', 'trivia', 'dealercut'].includes(type)) return;
  let p = await s.get('p:' + ref);
  if (!p) { p = { free: 0, cut: 0 }; for (const e of ledger) { if (e.type === 'dealercut') p.cut += e.amount; else if (['grant', 'mint', 'trivia'].includes(e.type)) p.free += e.amount; } }
  if (type === 'dealercut') p.cut += amount; else p.free += amount;
  await s.put('p:' + ref, p);
}
async function ledgerAdd(s, ref, type, amount, balance, note) {
  const k = 'l:' + ref;
  const l = (await s.get(k)) || [];
  await addTotals(s, ref, type, amount, l);
  l.push({ t: Date.now(), type, amount, balance, note: String(note || '').slice(0, 60) });
  while (l.length > LEDGER_MAX) l.shift();
  await s.put(k, l);
}
// The one-time $1,000 welcome grant: every way of reaching an account goes through here, so it can never be skipped or repeated.
async function ensureGrant(s, ref) {
  const bk = 'b:' + ref;
  const meta = (await s.get(bk)) || {};
  let bal = (await s.get('v:' + ref)) || 0;
  if (!meta.granted) {
    meta.granted = true; bal += START_GRANT;
    await s.put(bk, meta); await s.put('v:' + ref, bal);
    await s.put('supply', ((await s.get('supply')) || 0) + START_GRANT);
    await ledgerAdd(s, ref, 'grant', START_GRANT, bal, 'Welcome grant');
  }
  return bal;
}
// ---------- loans ----------
// The bank lends from the casino pot at 5% a day for 3 days; friends lend each other at a rate they choose (max 10% a day) for a time they choose.
// Simple interest, counted to the second. An overdue loan freezes the borrower (no new buy-ins, no cashing out of a table, nothing sent) until it is repaid.
const DAY_MS = 86400000, BANK_RATE_BP = 500, BANK_DAYS = 3, LOAN_NET_PCT = 50, BANK_LOAN_POT_PCT = 5, MAX_FRIEND_BP = 1000, MAX_FRIEND_DAYS = 14, MIN_LOAN = 100, MAX_OPEN_OFFERS = 3, OFFER_TTL_MS = DAY_MS;
const owedAt = (ln, t) => ln.principal + Math.floor(ln.principal * ln.rateBp * Math.max(0, t - ln.start) / (DAY_MS * 10000));
async function onTableOf(s, ref) { let n = 0; for (const m of (await s.list({ prefix: 'ts:' })).values()) n += (m && m[ref]) || 0; return n; }
async function acctRec(s, ref) { const k = await s.get('r:' + ref); if (!k) return null; return (String(k).startsWith('g:') ? await s.get(k) : await s.get('d:' + k)) || null; }
async function isFrozen(s, ref) { const ln = await s.get('ln:' + ref); return !!ln && Date.now() > ln.due; }
async function moveMoney(s, ref, delta, type, note) {   // one account move with its ledger line; null if the account cannot take it
  const bal = await ensureGrant(s, ref), next = bal + delta;
  if (next < 0 || next > MAX_CENTS) return null;
  await s.put('v:' + ref, next); await ledgerAdd(s, ref, type, delta, next, note); return next;
}
const LEDGER_KINDS = ['buyin', 'cashout', 'trivia', 'fee', 'dealercut'];
// The casino: one pot for the whole site (starts at $100,000, created from nothing as part of the supply, which is why it is counted there).
async function getCasino(s) {
  let c = await s.get('casino');
  if (!c) {
    c = { pot: POT_START, epoch: 1, brokeAt: 0 };
    await s.put('casino', c);
    await s.put('supply', ((await s.get('supply')) || 0) + POT_START);
  } else if (c.brokeAt && Date.now() >= c.brokeAt + LOCK_MS) {   // 24 hours after the crash: a new casino opens, the old pot is gone (it was never anyone's personal money)
    await s.put('supply', ((await s.get('supply')) || 0) - c.pot + POT_START);
    c = { pot: POT_START, epoch: c.epoch + 1, brokeAt: 0 };
    await s.put('casino', c);
  }
  return c;
}
export class Registry {
  constructor(state) { this.state = state; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const s = this.state.storage;
    const b = await readJson(request);

    if (path === '/status') {
      const d = await s.get('d:' + b.deviceId);
      if (d && d.google) {                           // a device signed in with Google follows its account
        const a = await s.get('g:' + d.google);
        return json({ status: a ? a.status : 'none', ref: a ? a.ref : undefined, email: d.google, name: a ? a.name : undefined });
      }
      if (d && d.owner === true) return json({ status: d.status, ref: d.ref, name: d.name });          // the owner's own device, approved with the admin key
      return json({ status: 'none' });                                                    // old name-only approvals no longer count: Google is required
    }

    if (path === '/google') {
      const dk = 'd:' + b.deviceId, old = await s.get(dk);
      if (old && !old.google && old.status === 'blocked') return json({ status: 'blocked' });   // can not dodge a block by signing in
      const key = 'g:' + b.email;
      let a = await s.get(key);
      if (!a) {
        const all = await s.list({ prefix: 'g:' });
        let pending = 0;
        for (const v of all.values()) if (v.status === 'pending') pending++;
        if (pending >= MAX_PENDING) return json({ error: 'too many pending requests' }, 429);
        let ref;
        do { ref = randomString(8, ALNUM); } while (await s.get('r:' + ref));
        a = { ref, name: b.name, email: b.email, status: 'pending', requested: Date.now() };
        await s.put(key, a);
        await s.put('r:' + ref, key);
      }
      await s.put(dk, { google: b.email, requested: Date.now() });
      return json({ status: a.status, ref: a.ref });
    }

    if (path === '/preapprove') {
      const key = 'g:' + b.email;
      const a = await s.get(key);
      if (a) { a.status = 'approved'; await s.put(key, a); return json({ ok: true, ref: a.ref }); }
      let ref;
      do { ref = randomString(8, ALNUM); } while (await s.get('r:' + ref));
      await s.put(key, { ref, name: b.email.split('@')[0].slice(0, 30), email: b.email, status: 'approved', requested: Date.now() });
      await s.put('r:' + ref, key);
      return json({ ok: true, ref });
    }

    if (path === '/request') {
      const name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);
      if (!name) return json({ error: 'name required' }, 400);
      const key = 'd:' + b.deviceId;
      const existing = await s.get(key);
      if (existing) return json({ status: existing.google ? 'none' : existing.status }); // blocked stays blocked
      const all = await s.list({ prefix: 'd:' });
      let pending = 0;
      for (const v of all.values()) if (v.status === 'pending') pending++;
      if (pending >= MAX_PENDING) return json({ error: 'too many pending requests' }, 429);
      let ref;
      do { ref = randomString(8, ALNUM); } while (await s.get('r:' + ref));
      await s.put(key, { ref, name, status: 'pending', requested: Date.now() });
      await s.put('r:' + ref, b.deviceId);
      return json({ status: 'pending' });
    }

    if (path === '/list') {
      const all = await s.list({ prefix: 'd:' });
      const devices = [];
      for (const v of all.values()) if (!v.google) devices.push({ ref: v.ref, name: v.name, status: v.status, requested: v.requested });
      const accts = await s.list({ prefix: 'g:' });
      for (const v of accts.values()) devices.push({ ref: v.ref, name: v.name, email: v.email, status: v.status, requested: v.requested });
      devices.sort((x, y) => y.requested - x.requested);
      return json({ devices });
    }

    if (path === '/action') {
      const id = await s.get('r:' + b.ref);
      const g = typeof id === 'string' && id.startsWith('g:');          // Google account, or a plain device
      const d = id && await s.get(g ? id : 'd:' + id);
      if (!d) return json({ error: 'not found' }, 404);
      const key = g ? id : 'd:' + id;
      if (b.action === 'remove') { await s.delete(key); await s.delete('r:' + b.ref); }
      else { d.status = b.action === 'approve' ? 'approved' : 'blocked'; await s.put(key, d); }
      return json({ ok: true });
    }

    if (path === '/bank/get') {                      // my account: one-time $1,000 grant, then balance + ledger
      if (!REF_RE.test(String(b.ref || ''))) return json({ error: 'bad request' }, 400);
      const bal = await ensureGrant(s, b.ref);
      return json({ balance: bal, granted: true, ledger: ((await s.get('l:' + b.ref)) || []).slice().reverse() });
    }
    if (path === '/bank/mint') {                     // admin only (checked by the worker): new money, always logged
      if (!REF_RE.test(String(b.ref || '')) || !Number.isInteger(b.amount) || b.amount <= 0 || b.amount > 100000000) return json({ error: 'bad request' }, 400);
      if (!(await s.get('r:' + b.ref))) return json({ error: 'not found' }, 404);
      const bal = ((await s.get('v:' + b.ref)) || 0) + b.amount;
      await s.put('v:' + b.ref, bal);
      await s.put('supply', ((await s.get('supply')) || 0) + b.amount);
      await ledgerAdd(s, b.ref, 'mint', b.amount, bal, b.note || 'Admin mint');
      return json({ ok: true, balance: bal });
    }
    if (path === '/vault/get') {
      if (!REF_RE.test(String(b.ref || '')) || !(await s.get('r:' + b.ref))) return json({ balance: 0 });
      return json({ balance: await ensureGrant(s, b.ref), frozen: await isFrozen(s, b.ref) });
    }
    if (path === '/loan/forgive') {                  // admin: wipe a loan (the money already lent is simply gone; nothing is created)
      if (!REF_RE.test(String(b.ref || ''))) return json({ error: 'bad request' }, 400);
      const had = !!(await s.get('ln:' + b.ref)); await s.delete('ln:' + b.ref); return json({ ok: true, had });
    }
    if (path.startsWith('/loan/')) {
      const ref = String(b.ref || ''), now = Date.now();
      const me = REF_RE.test(ref) ? await acctRec(s, ref) : null;
      if (!me || me.status !== 'approved') return json({ error: 'not approved' }, 403);
      const bal0 = await ensureGrant(s, ref);
      const net0 = bal0 + await onTableOf(s, ref);
      const nameOf = async r => String(((await acctRec(s, r)) || {}).name || 'Player').slice(0, 30);
      const fail = (msg, code) => json({ error: msg }, code || 409);
      if (path === '/loan/status') {
        const ln = await s.get('ln:' + ref), c = await getCasino(s);
        const limit = ln ? 0 : Math.floor(net0 * LOAN_NET_PCT / 100);
        const offers = [], myOffers = [], lent = [];
        for (const [k, o] of (await s.list({ prefix: 'lo:' })).entries()) {
          if (now - o.created > OFFER_TTL_MS) { await s.delete(k); continue; }
          if (o.lender === ref) myOffers.push({ id: o.id, amount: o.amount, rateBp: o.rateBp, days: o.days, to: o.toRef ? await nameOf(o.toRef) : '' });
          else if (!o.toRef || o.toRef === ref) offers.push({ id: o.id, lender: await nameOf(o.lender), amount: o.amount, rateBp: o.rateBp, days: o.days, forMe: !!o.toRef });
        }
        for (const [k, l] of (await s.list({ prefix: 'ln:' })).entries()) if (l.lender === ref) lent.push({ borrower: await nameOf(k.slice(3)), principal: l.principal, rateBp: l.rateBp, due: l.due, owed: owedAt(l, now), overdue: now > l.due });
        return json({ loan: ln ? { kind: ln.kind, principal: ln.principal, rateBp: ln.rateBp, start: ln.start, due: ln.due, owed: owedAt(ln, now), overdue: now > ln.due, lender: ln.lender ? await nameOf(ln.lender) : 'The bank' } : null,
          frozen: !!ln && now > ln.due, balance: bal0, limit, bankMax: ln ? 0 : Math.max(0, Math.min(limit, Math.floor(c.pot * BANK_LOAN_POT_PCT / 100))),
          bankRateBp: BANK_RATE_BP, bankDays: BANK_DAYS, maxFriendBp: MAX_FRIEND_BP, maxFriendDays: MAX_FRIEND_DAYS, minLoan: MIN_LOAN, offers, myOffers, lent, t: now });
      }
      if (path === '/loan/bank') {
        const amount = b.amount;
        if (!Number.isInteger(amount) || amount < MIN_LOAN) return fail('The smallest loan is ' + fmt(MIN_LOAN) + '.', 400);
        if (await s.get('ln:' + ref)) return fail('You already have a loan. Repay it first.');
        if (amount > Math.floor(net0 * LOAN_NET_PCT / 100)) return fail('You can borrow at most ' + LOAN_NET_PCT + '% of your net worth: ' + fmt(Math.floor(net0 * LOAN_NET_PCT / 100)) + '.');
        const c = await getCasino(s);
        if (c.brokeAt) return fail('The casino is closed.', 423);
        if (amount > Math.floor(c.pot * BANK_LOAN_POT_PCT / 100)) return fail('The casino cannot lend more than ' + fmt(Math.floor(c.pot * BANK_LOAN_POT_PCT / 100)) + ' right now.');
        if (bal0 + amount > MAX_CENTS) return fail('That would take your account over the limit.');
        c.pot -= amount; if (c.pot < BROKE_BELOW && !c.brokeAt) c.brokeAt = now;      // loans come out of the casino pot, so they can bankrupt it
        const nb = await moveMoney(s, ref, amount, 'loan', 'Bank loan: ' + (BANK_RATE_BP / 100) + '% a day');
        await s.put('casino', c);
        await s.put('ln:' + ref, { kind: 'bank', lender: '', principal: amount, rateBp: BANK_RATE_BP, start: now, due: now + BANK_DAYS * DAY_MS });
        return json({ ok: true, balance: nb });
      }
      if (path === '/loan/offer') {
        if (await isFrozen(s, ref)) return fail('Your account is frozen until your loan is repaid.', 403);
        const amount = b.amount, rateBp = Math.round(Number(b.ratePct) * 100), days = b.days;
        if (!Number.isInteger(amount) || amount < MIN_LOAN) return fail('The smallest loan is ' + fmt(MIN_LOAN) + '.', 400);
        if (!Number.isFinite(rateBp) || rateBp < 0 || rateBp > MAX_FRIEND_BP) return fail('The interest can be 0% to ' + (MAX_FRIEND_BP / 100) + '% a day.', 400);
        if (!Number.isInteger(days) || days < 1 || days > MAX_FRIEND_DAYS) return fail('The loan can last 1 to ' + MAX_FRIEND_DAYS + ' days.', 400);
        if (amount > bal0) return fail('You only have ' + fmt(bal0) + ' in your bank account.');
        let open = 0; for (const o of (await s.list({ prefix: 'lo:' })).values()) if (o.lender === ref && now - o.created <= OFFER_TTL_MS) open++;
        if (open >= MAX_OPEN_OFFERS) return fail('You can have ' + MAX_OPEN_OFFERS + ' open offers. Cancel one first.');
        let toRef = '';
        const want = String(b.toName || '').trim().toLowerCase();
        if (want) {
          const hits = [];
          for (const k of (await s.list({ prefix: 'r:' })).keys()) { const r = k.slice(2), a = await acctRec(s, r); if (a && a.status === 'approved' && String(a.name || '').toLowerCase() === want && r !== ref) hits.push(r); }
          if (hits.length !== 1) return fail(hits.length ? 'More than one player has that name. Leave the name empty to offer it to everyone.' : 'No player has that name.', 404);
          toRef = hits[0];
        }
        let id; do { id = randomString(8, ALNUM); } while (await s.get('lo:' + id));
        await s.put('lo:' + id, { id, lender: ref, amount, rateBp, days, toRef, created: now });
        return json({ ok: true, id });
      }
      if (path === '/loan/cancel') {
        const o = await s.get('lo:' + String(b.id || ''));
        if (!o || o.lender !== ref) return fail('No such offer.', 404);
        await s.delete('lo:' + o.id); return json({ ok: true });
      }
      if (path === '/loan/accept') {
        const o = await s.get('lo:' + String(b.id || ''));
        if (!o || now - o.created > OFFER_TTL_MS) return fail('That offer is gone.', 404);
        if (o.lender === ref) return fail('You cannot borrow from yourself.');
        if (o.toRef && o.toRef !== ref) return fail('That offer is for somebody else.', 403);
        if (await s.get('ln:' + ref)) return fail('You already have a loan. Repay it first.');
        if (o.amount > Math.floor(net0 * LOAN_NET_PCT / 100)) return fail('You can borrow at most ' + LOAN_NET_PCT + '% of your net worth: ' + fmt(Math.floor(net0 * LOAN_NET_PCT / 100)) + '.');
        if (await isFrozen(s, o.lender)) return fail('The lender\'s account is frozen right now.');
        if (!(await s.get('r:' + o.lender)) || (await ensureGrant(s, o.lender)) < o.amount) return fail('The lender no longer has that much.');
        if (bal0 + o.amount > MAX_CENTS) return fail('That would take your account over the limit.');
        const lname = await nameOf(o.lender);
        await moveMoney(s, o.lender, -o.amount, 'lend', 'Loan to ' + (me.name || 'a player') + ': ' + (o.rateBp / 100) + '% a day');
        const nb = await moveMoney(s, ref, o.amount, 'loan', 'Loan from ' + lname + ': ' + (o.rateBp / 100) + '% a day');
        await s.put('ln:' + ref, { kind: 'friend', lender: o.lender, principal: o.amount, rateBp: o.rateBp, start: now, due: now + o.days * DAY_MS });
        await s.delete('lo:' + o.id);
        return json({ ok: true, balance: nb });
      }
      if (path === '/loan/repay') {
        const ln = await s.get('ln:' + ref);
        if (!ln) return fail('You have no loan.', 404);
        const owed = owedAt(ln, now);
        if (bal0 < owed) return fail('You need ' + fmt(owed) + ' in your bank account to repay (you have ' + fmt(bal0) + ').');
        const lenderOk = ln.lender && (await s.get('r:' + ln.lender)) && ((await ensureGrant(s, ln.lender)) + owed <= MAX_CENTS);
        const nb = await moveMoney(s, ref, -owed, 'repay', 'Loan repaid (' + fmt(owed - ln.principal) + ' interest)');
        if (lenderOk) await moveMoney(s, ln.lender, owed, 'repaid', 'Loan repaid by ' + (me.name || 'a player') + ' (' + fmt(owed - ln.principal) + ' interest)');
        else { const c = await getCasino(s); c.pot += owed; await s.put('casino', c); }      // the bank's loans (and a lender who is gone) pay back into the casino pot
        await s.delete('ln:' + ref);
        return json({ ok: true, balance: nb, paid: owed });
      }
      return json({ error: 'not found' }, 404);
    }
    if (path === '/leaderboard') {                   // personal net worth: bank account + own chips on tables. The casino pot is never counted.
      const onTable = {};
      for (const m of (await s.list({ prefix: 'ts:' })).values()) for (const [r, v] of Object.entries(m || {})) onTable[r] = (onTable[r] || 0) + v;
      const debt = {}, claim = {};                   // loans: what you owe is subtracted, what a friend owes you is added (the bank's loans are a debt of the borrower only)
      for (const l of (await s.list({ prefix: 'ln:' })).entries()) { const o = owedAt(l[1], Date.now()); debt[l[0].slice(3)] = o; if (l[1].lender) claim[l[1].lender] = (claim[l[1].lender] || 0) + o; }
      const rows = [];
      for (const [k, devId] of (await s.list({ prefix: 'r:' })).entries()) {
        const ref = k.slice(2);
        if (!(await s.get('b:' + ref) || {}).granted) continue;
        const d = (String(devId).startsWith('g:') ? await s.get(devId) : await s.get('d:' + devId)) || {};      // Google accounts live under g:<email>, the owner's device under d:<id>
        if (d.status !== 'approved') continue;
        const net = ((await s.get('v:' + ref)) || 0) + (onTable[ref] || 0) - (debt[ref] || 0) + (claim[ref] || 0);
        const p = (await s.get('p:' + ref)) || null;
        let free = START_GRANT, cut = 0;
        if (p) { free = p.free; cut = p.cut; } else { for (const e of (await s.get('l:' + ref)) || []) { if (e.type === 'dealercut') cut += e.amount; else if (e.type === 'mint' || e.type === 'trivia') free += e.amount; } }
        rows.push({ ref, name: String(d.name || 'Player').slice(0, 30), net, profit: net - free - cut });
      }
      rows.sort((x, y) => y.net - x.net);
      return json({ rows: rows.slice(0, 25).map((r, i) => ({ rank: i + 1, name: r.name, net: r.net, profit: r.profit, you: !!b.ref && r.ref === b.ref })), t: Date.now() });
    }
    if (path === '/casino/get') { const c = await getCasino(s); return json({ frozen: REF_RE.test(String(b.ref || '')) ? await isFrozen(s, b.ref) : false, pot: c.pot, epoch: c.epoch, brokeAt: c.brokeAt, locked: c.brokeAt > 0, until: c.brokeAt > 0 ? c.brokeAt + LOCK_MS : 0, t: Date.now() }); }
    if (path === '/bank/apply') {                    // a batch of account moves from a table, all or nothing, applied once per opId
      const ops = Array.isArray(b.ops) ? b.ops : [];
      const opId = typeof b.opId === 'string' && b.opId.length > 0 && b.opId.length <= 80 ? b.opId : '';
      const supplyDelta = b.supplyDelta === undefined ? 0 : b.supplyDelta;
      const potDelta = b.potDelta === undefined ? 0 : b.potDelta;
      const cutReq = b.cut && typeof b.cut === 'object' ? b.cut : null;
      const seatsReq = b.seats && typeof b.seats === 'object' && typeof b.seats.code === 'string' && b.seats.code.length <= 12 && b.seats.map && typeof b.seats.map === 'object' ? b.seats : null;   // chips each account holds at a table, for the leaderboard
      if (!opId || (!ops.length && !supplyDelta && !potDelta && !cutReq && !seatsReq && !b.seatsClear) || ops.length > 200 || !Number.isInteger(supplyDelta) || !Number.isInteger(potDelta)) return json({ error: 'bad request' }, 400);
      const done = await s.get('o:' + opId);
      if (done) return json({ ok: true, dup: true, balances: done.balances, pot: done.pot, short: done.short });
      // the casino pot: pays out at most what it holds (the rest is `short`, the caller takes it back from the seats)
      const c = await getCasino(s);
      let applied = potDelta, short = 0;
      if (c.pot + applied < 0) { short = -(c.pot + applied); applied = -c.pot; }
      c.pot += applied;
      if (c.pot < BROKE_BELOW && !c.brokeAt && applied < 0) c.brokeAt = Date.now();   // the house went broke: the lockdown starts now
      if (cutReq && REF_RE.test(String(cutReq.ref || '')) && Number.isInteger(cutReq.base) && cutReq.base > 0 && Number.isInteger(cutReq.potStart) && cutReq.epoch === c.epoch && c.pot > cutReq.potStart && await s.get('r:' + cutReq.ref)) {
        const cut = Math.floor(Math.min(cutReq.base, c.pot - cutReq.potStart) * CUT_PCT / 100);   // 5% of the casino's profit, only if the pot ended above where the shift began
        if (cut > 0) { c.pot -= cut; ops.push({ ref: cutReq.ref, delta: cut, kind: 'dealercut', note: 'Dealer cut (' + CUT_PCT + '% of the shift profit)' }); }
      }
      const exists = {}, total = {};
      for (const o of ops) {
        const mint = o.mint === undefined ? 0 : o.mint;
        if (!o || !REF_RE.test(String(o.ref || '')) || !Number.isInteger(o.delta) || !Number.isInteger(mint) || mint < 0 || !LEDGER_KINDS.includes(o.kind)) return json({ error: 'bad request' }, 400);
        if (exists[o.ref] === undefined) exists[o.ref] = !!(await s.get('r:' + o.ref));
        if (!exists[o.ref] && o.delta < 0) return json({ error: 'no such account' }, 404);
      }
      for (const o of ops) {                           // a frozen account (overdue loan) cannot start playing or cash out of a table by itself; a table closing still pays it back
        if (exists[o.ref] && ((o.kind === 'buyin' && o.delta < 0) || (o.kind === 'cashout' && o.forced !== true)) && await isFrozen(s, o.ref)) return json({ error: 'frozen' }, 403);
      }
      const bal = {};
      for (const o of ops) {
        if (!exists[o.ref]) continue;
        if (bal[o.ref] === undefined) bal[o.ref] = await ensureGrant(s, o.ref);
        total[o.ref] = (total[o.ref] || 0) + o.delta;
      }
      for (const r of Object.keys(total)) if (bal[r] + total[r] < 0 || bal[r] + total[r] > MAX_CENTS) return json({ error: 'balance limit' }, 409);
      let supply = ((await s.get('supply')) || 0) + supplyDelta;
      for (const o of ops) {
        if (!exists[o.ref]) { supply -= o.delta; continue; }      // the account was deleted: that money leaves circulation, it is not kept anywhere
        bal[o.ref] += o.delta; supply += o.mint || 0;
        await s.put('v:' + o.ref, bal[o.ref]);
        await ledgerAdd(s, o.ref, o.kind, o.mint ? o.mint : o.delta, bal[o.ref], o.note);
      }
      await s.put('supply', supply);
      await s.put('casino', c);
      if (seatsReq) { const m = {}; for (const [r, v] of Object.entries(seatsReq.map)) if (REF_RE.test(r) && Number.isInteger(v) && v > 0) m[r] = v; await s.put('ts:' + seatsReq.code, m); }
      if (typeof b.seatsClear === 'string' && b.seatsClear.length <= 12) await s.delete('ts:' + b.seatsClear);
      await s.put('o:' + opId, { t: Date.now(), balances: bal, pot: c.pot, short });
      const lastPrune = (await s.get('oprune')) || 0;
      if (Date.now() - lastPrune > 86400000) {
        await s.put('oprune', Date.now());
        for (const [k, v] of (await s.list({ prefix: 'o:' })).entries()) if (v && v.t && Date.now() - v.t > 3 * 86400000) await s.delete(k);
      }
      return json({ ok: true, balances: bal, pot: c.pot, short });
    }

    if (path === '/vault/add') {                     // credit (+) or debit (-); never below zero
      if (!REF_RE.test(String(b.ref || '')) || !Number.isInteger(b.delta)) return json({ error: 'bad request' }, 400);
      if (b.delta && await isFrozen(s, b.ref)) return json({ error: 'frozen' }, 403);
      const next = ((await s.get('v:' + b.ref)) || 0) + b.delta;
      if (next < 0 || next > MAX_CENTS) return json({ error: 'vault limit' }, 409);
      await s.put('v:' + b.ref, next);
      if (b.delta) await ledgerAdd(s, b.ref, b.delta > 0 ? 'cashout' : 'buyin', b.delta, next, b.delta > 0 ? 'Chips saved from a table' : 'Chips taken to a table');
      return json({ balance: next });
    }

    if (path === '/self') { // the admin's own device
      const key = 'd:' + b.deviceId;
      const existing = await s.get(key);
      if (existing) { existing.status = 'approved'; existing.owner = true; delete existing.google; await s.put(key, existing); return json({ status: 'approved' }); }
      let ref;
      do { ref = randomString(8, ALNUM); } while (await s.get('r:' + ref));
      await s.put(key, { ref, name: 'Admin', status: 'approved', owner: true, requested: Date.now() });
      await s.put('r:' + ref, b.deviceId);
      return json({ status: 'approved' });
    }

    return json({ error: 'not found' }, 404);
  }
}
