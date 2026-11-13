// Online table service for the Blackjack Chip Tracker.
// The dealer's phone is the only writer; everyone else polls read-only.
// One Durable Object per table code keeps each table isolated and consistent.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const MAX_BODY = 200 * 1024;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

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
const newPlayer = (id, name, start, owner) => {
  const p = { id, name, start, balance: start, added: 0, takes: 0, bet: 0, hand: 0, doubled: false, out: false, trivia: 0, triviaAt: -1, vin: 0, vout: 0 };
  if (owner) p.owner = owner;
  return p;
};

export function normalizeTable(t) {
  t = t && typeof t === 'object' ? t : {};
  const players = (Array.isArray(t.players) ? t.players : []).map(p => {
    const q = { id: p.id, name: String(p.name), start: p.start, balance: p.balance,
      added: nn(p.added),                                    // chips taken from the bank after the buy-in (so net profit is honest)
      takes: nn(p.takes),                                    // how many times they went to the bank
      bet: nn(p.bet), hand: nn(p.hand), doubled: p.doubled === true, out: p.out === true,   // round play: next wager, wager in play, sitting out
      trivia: nn(p.trivia), triviaAt: Number.isInteger(p.triviaAt) ? p.triviaAt : -1,        // trivia winnings so far, and the match they last answered in
      vin: nn(p.vin), vout: nn(p.vout) };                    // chips moved in from / out to the savings vault
    if (typeof p.owner === 'string' && p.owner) q.owner = p.owner;
    return q;
  });
  const history = (Array.isArray(t.history) ? t.history : []).map(h => ({
    id: h.id, pid: h.pid, name: String(h.name), outcome: String(h.outcome), wager: h.wager, delta: h.delta }));
  const maxId = players.reduce((m, p) => Math.max(m, p.id), 0);
  const maxHid = history.reduce((m, h) => Math.max(m, h.id), 0);
  const st = t.settings && typeof t.settings === 'object' ? t.settings : {};
  const rd = t.round && typeof t.round === 'object' ? t.round : {};
  return {
    players, history,
    nextId: Math.max(typeof t.nextId === 'number' ? t.nextId : 1, maxId + 1),
    nextHid: Math.max(typeof t.nextHid === 'number' ? t.nextHid : 1, maxHid + 1),
    round: { n: Number.isInteger(rd.n) && rd.n > 0 ? rd.n : 1, phase: rd.phase === 'playing' ? 'playing' : 'betting' },
    dealer: typeof t.dealer === 'string' && REF_RE.test(t.dealer) ? t.dealer : '',          // '' = the host deals
    dealerReq: typeof t.dealerReq === 'string' && REF_RE.test(t.dealerReq) ? t.dealerReq : '',
    settings: { locked: st.locked === true, maxBuyin: isCents(st.maxBuyin) ? st.maxBuyin : 0,
      bankFee: Number.isInteger(st.bankFee) && st.bankFee >= 0 && st.bankFee <= 50 ? st.bankFee : 10,        // % kept by the bank when chips are taken
      bankLimit: Number.isInteger(st.bankLimit) && st.bankLimit >= 0 && st.bankLimit <= 20 ? st.bankLimit : 3,   // max bank trips per player (0 = no limit)
      triviaPct: Number.isInteger(st.triviaPct) && st.triviaPct >= 0 && st.triviaPct <= 20 ? st.triviaPct : 10, // trivia can pay up to this % of each player's buy-in
      rounds: st.rounds === false ? false : true },          // rounds: wagers -> dealer Start -> hands -> next round
  };
}

function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30); }

export function applyAction(t, actor, a, ctx) {
  ctx = ctx || {};
  const host = actor.role === 'host';
  const deny = error => ({ ok: false, error });
  const dealerRef = !!actor.ref && !!t.dealer && actor.ref === t.dealer;
  const dealerPower = host || dealerRef;                // the host can always act as dealer; so can the player they handed the deck to
  const mine = p => !!actor.ref && p.owner === actor.ref;
  const find = id => t.players.find(p => p.id === id);
  const may = p => dealerPower || mine(p);              // players may only touch their own seat
  const dealerSeat = p => !!t.dealer && p.owner === t.dealer;
  const rounds = t.settings.rounds;
  const NOT_YOURS = 'You can only change your own chips.';
  if (!a || typeof a !== 'object') return deny('Unknown action.');
  if (!dealerPower && t.settings.locked) return deny('The host has paused the table.');
  const logHand = (p, outcome, wager, delta) => {
    t.history.push({ id: t.nextHid++, pid: p.id, name: p.name, outcome, wager, delta });
    if (t.history.length > HISTORY_MAX) t.history.shift();
  };
  const overMax = c => t.settings.maxBuyin && c > t.settings.maxBuyin ? 'The host set a max of ' + fmt(t.settings.maxBuyin) + ' per buy-in.' : null;
  const matchKey = () => rounds ? t.round.n : t.nextHid;       // trivia: one question per round (or per hand in quick mode)
  const roundOver = () => {
    if (rounds && t.round.phase === 'playing' && !t.players.some(p => p.hand > 0)) { t.round.phase = 'betting'; t.round.n += 1; }
  };
  const handsInPlay = () => t.players.some(p => p.hand > 0);

  switch (a.type) {
    case 'add': {                                    // host adds anyone
      if (!host) return deny('Only the host can add other players.');
      const name = cleanName(a.name);
      if (!name) return deny('Enter a player name.');
      if (!isCents(a.start)) return deny('Starting balance must be more than $0.');
      t.players.push(newPlayer(t.nextId++, name, a.start));
      return { ok: true };
    }
    case 'seat': {                                   // a player takes their own seat
      if (host) return deny('Use Add Player to seat someone as host.');
      if (!actor.ref) return deny('Your device is not recognised.');
      if (t.players.some(mine)) return deny('You already have a seat.');
      const name = cleanName(a.name);
      if (!name) return deny('Enter your name.');
      if (!isCents(a.buyin)) return deny('Starting balance must be more than $0.');
      const m = overMax(a.buyin); if (m) return deny(m);
      if (t.players.length >= 100) return deny('The table is full.');
      if (a.fromVault && (ctx.vault || 0) < a.buyin) return deny('Not enough chips in your vault (' + fmt(ctx.vault || 0) + ').');
      t.players.push(newPlayer(t.nextId++, name, a.buyin, actor.ref));
      return a.fromVault ? { ok: true, vault: -a.buyin, vaultRef: actor.ref } : { ok: true };
    }
    case 'bet': {                                    // next round's wager (changeable until the dealer starts)
      if (!rounds) return deny('Quick mode: wagers are entered when the hand is settled.');
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (dealerSeat(p)) return deny('The dealer does not bet.');
      if (p.out) return deny('Sit back in before wagering.');
      if (p.hand > 0) return deny('Your hand is in play. Wager for the next round after it ends.');
      if (!Number.isInteger(a.amount) || a.amount < 0) return deny('Wager must be more than $0.');
      if (a.amount > p.balance) return deny('Wager is more than balance (' + fmt(p.balance) + ').');
      p.bet = a.amount;
      return { ok: true, bet: p.bet };
    }
    case 'start': {                                  // dealer starts the round once every wager is in
      if (!rounds) return deny('Rounds are off.');
      if (!dealerPower) return deny('Only the dealer can start the round.');
      if (t.round.phase !== 'betting') return deny('A round is already in play.');
      const ready = t.players.filter(p => !p.out && p.balance > 0 && !dealerSeat(p));
      if (!ready.length) return deny('Nobody can play yet: players need chips and must not be sitting out.');
      const waiting = ready.filter(p => !(p.bet > 0));
      if (waiting.length) return deny('Waiting for wagers from: ' + waiting.map(p => p.name).join(', ') + '.');
      const over = ready.find(p => p.bet > p.balance);
      if (over) return deny(over.name + ' wagered more than their balance.');
      ready.forEach(p => { p.hand = p.bet; p.bet = 0; p.doubled = false; });
      t.players.forEach(p => { if (!ready.includes(p)) p.bet = 0; });
      t.round.phase = 'playing';
      return { ok: true, n: t.round.n, players: ready.length };
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
      if (p.hand > 0) return deny('Your hand is in play.');
      p.out = a.out === true;
      if (p.out) p.bet = 0;
      return { ok: true };
    }
    case 'settle': {
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
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
      p.balance += delta;
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
      let wager = a.wager;
      if (rounds) { if (!(p.hand > 0)) return deny('No hand in play.'); wager = p.hand; }
      else if (!Number.isInteger(a.wager) || a.wager <= 0) return deny('Wager must be more than $0.');
      if (a.result !== 'win' && a.result !== 'loss') return deny('Unknown insurance result.');
      const side = Math.floor(wager / 2);
      if (side <= 0) return deny('Wager is too small to insure.');
      if (wager + side > p.balance) return deny('Not enough chips to also insure (' + fmt(side) + ' on top of the bet).');
      const delta = a.result === 'win' ? side * 2 : -side;
      p.balance += delta;
      logHand(p, a.result === 'win' ? 'insurance_win' : 'insurance_loss', side, delta);
      return { ok: true, delta, balance: p.balance };
    }
    case 'rebuy': {                                  // taking chips from the bank is logged so everyone can see it
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (!isCents(a.amount)) return deny('Enter an amount of chips to add.');
      const m = overMax(a.amount); if (m) return deny(m);
      if (t.settings.bankLimit && p.takes >= t.settings.bankLimit) return deny('The bank has cut you off: ' + p.takes + ' of ' + t.settings.bankLimit + ' trips used.');
      const fee = Math.ceil(a.amount * t.settings.bankFee / 100);   // taking chips from the bank costs a fee
      const got = a.amount - fee;
      if (got < 1) return deny('Too small: the ' + t.settings.bankFee + '% bank fee would take all of it.');
      p.balance += got;
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
      p.balance += reward; p.trivia += reward;
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
      return { ok: true, balance: p.balance, vault: a.amount, vaultRef: actor.ref };
    }
    case 'vault_withdraw': {                         // bring saved chips back to the table (no fee, not a bank trip)
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!mine(p)) return deny('You can only use your own vault.');
      if (!isCents(a.amount)) return deny('Enter an amount to withdraw.');
      const m = overMax(a.amount); if (m) return deny(m);
      if ((ctx.vault || 0) < a.amount) return deny('Not enough chips in your vault (' + fmt(ctx.vault || 0) + ').');
      p.balance += a.amount; p.vin += a.amount;
      logHand(p, 'vault_in', 0, a.amount);
      return { ok: true, balance: p.balance, vault: -a.amount, vaultRef: actor.ref };
    }
    case 'undo': {
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
      const hand = ['win', 'loss', 'blackjack', 'push'].includes(h.outcome);
      if (rounds && hand && t.round.phase !== 'playing') return deny('That round is over, so its hands can no longer be undone.');
      t.history.splice(idx, 1);
      const p = find(h.pid);
      if (p) {
        p.balance -= h.delta;                       // newest entry of that seat, so the balance can't go negative
        if (h.outcome === 'rebuy') { p.added = Math.max(0, p.added - h.delta - h.wager); p.takes = Math.max(0, p.takes - 1); }
        if (h.outcome === 'trivia') { p.trivia = Math.max(0, p.trivia - h.delta); p.triviaAt = -1; }
        if (rounds && hand) { p.hand = h.wager; p.doubled = true; }      // the hand is back in play
      }
      return { ok: true, entry: h, playerFound: !!p };
    }
    case 'remove': {                                 // host removes anyone; a player can only leave their own seat
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!(host || mine(p))) return deny(NOT_YOURS);
      t.players = t.players.filter(x => x.id !== p.id);
      if (p.owner && t.dealerReq === p.owner) t.dealerReq = '';
      roundOver();
      return { ok: true };
    }
    case 'reset': {
      if (!host) return deny('Only the host can reset the table.');
      t.players.forEach(p => { p.balance = p.start; p.added = 0; p.takes = 0; p.bet = 0; p.hand = 0; p.doubled = false; p.out = false; p.trivia = 0; p.triviaAt = -1; p.vin = 0; p.vout = 0; });
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
      if (a.rounds !== undefined) {
        if (typeof a.rounds !== 'boolean') return deny('Bad setting.');
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

// Admin = holder of the ADMIN_KEY secret. If the secret is not set, admin is disabled.
function adminOk(request, env) {
  const k = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && timingSafeEqual(k, env.ADMIN_KEY);
}

// Who is calling? Tables may only be used by an approved device (or the admin key).
// 'ref' is the device's public id; it is what marks which seat a player owns.
async function identify(request, env) {
  const admin = adminOk(request, env);
  const id = request.headers.get('X-Device-Id') || '';
  let ok = false, ref = '';
  if (ID_RE.test(id)) {
    const d = await (await reg(env, '/status', { deviceId: id })).json();
    if (d.status === 'approved') { ok = true; ref = d.ref || ''; }
  }
  return { ok: ok || admin, ref };
}

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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);

    // ---- access control ----
    if (url.pathname === '/api/access/status' && request.method === 'GET') {
      const id = request.headers.get('X-Device-Id') || '';
      if (!ID_RE.test(id)) return json({ status: 'none' });
      return withCors(await reg(env, '/status', { deviceId: id }));
    }
    if (url.pathname === '/api/access/request' && request.method === 'POST') {
      const b = await readJson(request);
      if (!ID_RE.test(String(b.deviceId || ''))) return json({ error: 'bad device' }, 400);
      return withCors(await reg(env, '/request', { deviceId: b.deviceId, name: b.name }));
    }
    if (url.pathname === '/api/access/google' && request.method === 'POST') {     // sign in with Google: links this device to the account
      const b = await readJson(request);
      if (!ID_RE.test(String(b.deviceId || ''))) return json({ error: 'bad device' }, 400);
      let who;
      try { who = await verifyIdToken(b.idToken, await googleKeys(), GOOGLE_CLIENT_ID, Math.floor(Date.now() / 1000)); }
      catch (e) { return json({ error: 'Could not reach Google. Try again.' }, 502); }
      if (!who) return json({ error: 'Google sign-in could not be verified.' }, 401);
      return withCors(await reg(env, '/google', { deviceId: b.deviceId, email: who.email, name: who.name }));
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!adminOk(request, env)) return json({ error: 'unauthorized' }, 401);
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
      return withCors(await reg(env, '/vault/get', { ref: me.ref }));
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
        const r = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ token }) });
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
        headers: { Authorization: request.headers.get('Authorization') || '', 'X-Ref': who.ref },
        body,
      }));
    }
    if (request.method === 'GET') return withCors(await stub.fetch('https://room/state'));
    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > MAX_BODY) return json({ error: 'too large' }, 413);
      return withCors(await stub.fetch('https://room/state', {
        method: 'PUT',
        headers: { Authorization: request.headers.get('Authorization') || '' },
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
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    const now = Date.now();
    const meta = await this.state.storage.get('meta');
    const expired = meta && now - meta.updated > ROOM_TTL_MS;
    if (expired) { await this.state.storage.deleteAll(); }
    const live = meta && !expired ? meta : null;

    if (path === '/init') {
      if (live) return json({ error: 'taken' }, 409);
      const { token } = await request.json();
      await this.state.storage.put('meta', { token, v: 0, updated: now });
      await this.state.storage.put('table', { players: [], history: [] });
      return json({ ok: true });
    }

    if (!live) return json({ error: 'no such table' }, 404);

    const isHost = timingSafeEqual((request.headers.get('Authorization') || '').replace(/^Bearer /, ''), live.token);

    if (path === '/act') {                           // everyone: host (token) or an approved player
      let body;
      try { body = JSON.parse(await request.text()); } catch (e) { return json({ ok: false, error: 'Bad request.' }, 400); }
      const table = normalizeTable(await this.state.storage.get('table'));
      const ref = request.headers.get('X-Ref') || '';
      const act = body && body.action;
      let vault;                                       // savings vault balance, only fetched when an action needs it
      if (act && (act.type === 'vault_withdraw' || (act.type === 'seat' && act.fromVault)) && ref) vault = (await (await reg(this.env, '/vault/get', { ref })).json()).balance;
      const res = applyAction(table, { role: isHost ? 'host' : 'player', ref }, act, { vault });
      if (!res.ok) return json({ ok: false, error: res.error }, 400);
      let vaultBalance;
      if (res.vault) {                                 // the vault is updated first: if it refuses, the table is not saved
        const vr = await reg(this.env, '/vault/add', { ref: res.vaultRef, delta: res.vault });
        if (!vr.ok) return json({ ok: false, error: 'Not enough chips in your vault.' }, 400);
        vaultBalance = (await vr.json()).balance;
      }
      const v = live.v + 1;
      await this.state.storage.put('table', table);
      await this.state.storage.put('meta', { token: live.token, v, updated: now });
      return json({ ok: true, v, state: table, delta: res.delta, balance: res.balance, entry: res.entry, playerFound: res.playerFound, fee: res.fee, vaultBalance });
    }

    if (request.method === 'GET') {
      const table = normalizeTable(await this.state.storage.get('table'));
      return json({ v: live.v, state: table });
    }

    // PUT: host only, and only once, to start the table from the host's local game
    if (!isHost) return json({ error: 'unauthorized' }, 401);
    let body;
    try { body = JSON.parse(await request.text()); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!body || !validState(body.state)) return json({ error: 'bad state' }, 400);
    if (live.v !== 0) return json({ error: 'This table has already started.' }, 409);
    const seed = normalizeTable(Object.assign({}, body.state, {
      settings: Object.assign({}, body.state.settings, { rounds: true }),   // online tables play in rounds
      round: undefined, dealer: '', dealerReq: '',
      players: body.state.players.map(p => ({ id: p.id, name: p.name, start: p.start, balance: p.balance, added: p.added, takes: p.takes })), // no owners
    }));
    await this.state.storage.put('table', seed);
    await this.state.storage.put('meta', { token: live.token, v: 1, updated: now });
    return json({ ok: true, v: 1 });
  }
}

// Single instance holding every device that has asked for access.
// status: 'pending' (asked) -> 'approved' | 'blocked'. 'remove' deletes the record.
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
        return json({ status: a ? a.status : 'none', ref: a ? a.ref : undefined, email: d.google });
      }
      return json({ status: d ? d.status : 'none', ref: d ? d.ref : undefined });
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

    if (path === '/vault/get') {
      return json({ balance: (await s.get('v:' + b.ref)) || 0 });
    }

    if (path === '/vault/add') {                     // credit (+) or debit (-); never below zero
      if (!REF_RE.test(String(b.ref || '')) || !Number.isInteger(b.delta)) return json({ error: 'bad request' }, 400);
      const next = ((await s.get('v:' + b.ref)) || 0) + b.delta;
      if (next < 0 || next > MAX_CENTS) return json({ error: 'vault limit' }, 409);
      await s.put('v:' + b.ref, next);
      return json({ balance: next });
    }

    if (path === '/self') { // the admin's own device
      const key = 'd:' + b.deviceId;
      const existing = await s.get(key);
      if (existing) { existing.status = 'approved'; delete existing.google; await s.put(key, existing); return json({ status: 'approved' }); }
      let ref;
      do { ref = randomString(8, ALNUM); } while (await s.get('r:' + ref));
      await s.put(key, { ref, name: 'Admin', status: 'approved', requested: Date.now() });
      await s.put('r:' + ref, b.deviceId);
      return json({ status: 'approved' });
    }

    return json({ error: 'not found' }, 404);
  }
}
