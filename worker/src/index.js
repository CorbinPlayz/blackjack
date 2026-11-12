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

export function normalizeTable(t) {
  t = t && typeof t === 'object' ? t : {};
  const players = (Array.isArray(t.players) ? t.players : []).map(p => {
    const q = { id: p.id, name: String(p.name), start: p.start, balance: p.balance,
      added: Number.isInteger(p.added) && p.added > 0 ? p.added : 0 };    // chips added after the buy-in (so net profit is honest)
    if (typeof p.owner === 'string' && p.owner) q.owner = p.owner;
    return q;
  });
  const history = (Array.isArray(t.history) ? t.history : []).map(h => ({
    id: h.id, pid: h.pid, name: String(h.name), outcome: String(h.outcome), wager: h.wager, delta: h.delta }));
  const maxId = players.reduce((m, p) => Math.max(m, p.id), 0);
  const maxHid = history.reduce((m, h) => Math.max(m, h.id), 0);
  const st = t.settings && typeof t.settings === 'object' ? t.settings : {};
  return {
    players, history,
    nextId: Math.max(typeof t.nextId === 'number' ? t.nextId : 1, maxId + 1),
    nextHid: Math.max(typeof t.nextHid === 'number' ? t.nextHid : 1, maxHid + 1),
    settings: { locked: st.locked === true, maxBuyin: isCents(st.maxBuyin) ? st.maxBuyin : 0 },
  };
}

function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30); }

export function applyAction(t, actor, a) {
  const host = actor.role === 'host';
  const deny = error => ({ ok: false, error });
  const mine = p => !!actor.ref && p.owner === actor.ref;
  const find = id => t.players.find(p => p.id === id);
  const may = p => host || mine(p);                 // players may only touch their own seat
  const NOT_YOURS = 'You can only change your own chips.';
  if (!a || typeof a !== 'object') return deny('Unknown action.');
  if (!host && t.settings.locked) return deny('The host has paused the table.');
  const logHand = (p, outcome, wager, delta) => {
    t.history.push({ id: t.nextHid++, pid: p.id, name: p.name, outcome, wager, delta });
    if (t.history.length > HISTORY_MAX) t.history.shift();
  };
  const overMax = c => t.settings.maxBuyin && c > t.settings.maxBuyin ? 'The host set a max of ' + fmt(t.settings.maxBuyin) + ' per buy-in.' : null;

  switch (a.type) {
    case 'add': {                                    // host adds anyone
      if (!host) return deny('Only the host can add other players.');
      const name = cleanName(a.name);
      if (!name) return deny('Enter a player name.');
      if (!isCents(a.start)) return deny('Starting balance must be more than $0.');
      t.players.push({ id: t.nextId++, name, start: a.start, balance: a.start, added: 0 });
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
      t.players.push({ id: t.nextId++, name, start: a.buyin, balance: a.buyin, added: 0, owner: actor.ref });
      return { ok: true };
    }
    case 'settle': {
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (!Number.isInteger(a.wager) || a.wager <= 0) return deny('Wager must be more than $0.');
      if (a.wager > p.balance) return deny('Wager is more than balance (' + fmt(p.balance) + ').');
      let delta;
      if (a.outcome === 'win') delta = a.wager;                        // 1:1
      else if (a.outcome === 'blackjack') delta = Math.round(a.wager * 3 / 2); // 3:2
      else if (a.outcome === 'push') delta = 0;
      else if (a.outcome === 'loss') delta = -a.wager;
      else return deny('Unknown outcome.');
      p.balance += delta;
      logHand(p, a.outcome, a.wager, delta);
      return { ok: true, delta, balance: p.balance };
    }
    case 'insurance': {                              // side bet = half the main wager, pays 2:1
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (!Number.isInteger(a.wager) || a.wager <= 0) return deny('Wager must be more than $0.');
      if (a.result !== 'win' && a.result !== 'loss') return deny('Unknown insurance result.');
      const side = Math.floor(a.wager / 2);
      if (side <= 0) return deny('Wager is too small to insure.');
      if (a.wager + side > p.balance) return deny('Not enough chips to also insure (' + fmt(side) + ' on top of the bet).');
      const delta = a.result === 'win' ? side * 2 : -side;
      p.balance += delta;
      logHand(p, a.result === 'win' ? 'insurance_win' : 'insurance_loss', side, delta);
      return { ok: true, delta, balance: p.balance };
    }
    case 'rebuy': {                                  // adding chips is logged so everyone can see it
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      if (!isCents(a.amount)) return deny('Enter an amount of chips to add.');
      const m = overMax(a.amount); if (m) return deny(m);
      p.balance += a.amount;
      p.added += a.amount;
      logHand(p, 'rebuy', 0, a.amount);
      return { ok: true, delta: a.amount, balance: p.balance };
    }
    case 'undo': {
      let idx = -1;
      if (host) idx = t.history.length - 1;
      else {
        const seat = t.players.find(mine);
        if (!seat) return deny('You do not have a seat.');
        for (let i = t.history.length - 1; i >= 0; i--) if (t.history[i].pid === seat.id) { idx = i; break; }
      }
      if (idx < 0) return deny('No hands to undo.');
      const h = t.history.splice(idx, 1)[0];
      const p = find(h.pid);
      if (p) { p.balance -= h.delta; if (h.outcome === 'rebuy') p.added = Math.max(0, p.added - h.delta); } // newest entry of that seat, so the balance can't go negative
      return { ok: true, entry: h, playerFound: !!p };
    }
    case 'remove': {                                 // host removes anyone; a player can only leave their own seat
      const p = find(a.pid);
      if (!p) return deny('Player not found.');
      if (!may(p)) return deny(NOT_YOURS);
      t.players = t.players.filter(x => x.id !== p.id);
      return { ok: true };
    }
    case 'reset': {
      if (!host) return deny('Only the host can reset the table.');
      t.players.forEach(p => { p.balance = p.start; p.added = 0; });
      t.history = [];
      return { ok: true };
    }
    case 'settings': {
      if (!host) return deny('Only the host can change table settings.');
      if (a.locked !== undefined) { if (typeof a.locked !== 'boolean') return deny('Bad setting.'); t.settings.locked = a.locked; }
      if (a.maxBuyin !== undefined) {
        if (!Number.isInteger(a.maxBuyin) || a.maxBuyin < 0 || a.maxBuyin > MAX_CENTS) return deny('Bad max buy-in.');
        t.settings.maxBuyin = a.maxBuyin;
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
    if (url.pathname.startsWith('/api/admin/')) {
      if (!adminOk(request, env)) return json({ error: 'unauthorized' }, 401);
      if (url.pathname === '/api/admin/devices' && request.method === 'GET') return withCors(await reg(env, '/list'));
      if (url.pathname === '/api/admin/self' && request.method === 'POST') {
        const b = await readJson(request);
        if (!ID_RE.test(String(b.deviceId || ''))) return json({ error: 'bad device' }, 400);
        return withCors(await reg(env, '/self', { deviceId: b.deviceId }));
      }
      const am = url.pathname.match(/^\/api\/admin\/devices\/([A-Za-z0-9]+)$/);
      if (am && request.method === 'POST') {
        const b = await readJson(request);
        if (!REF_RE.test(am[1]) || !['approve', 'block', 'remove'].includes(b.action)) return json({ error: 'bad request' }, 400);
        return withCors(await reg(env, '/action', { ref: am[1], action: b.action }));
      }
      return json({ error: 'not found' }, 404);
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
  constructor(state) { this.state = state; }

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
      const res = applyAction(table, { role: isHost ? 'host' : 'player', ref: request.headers.get('X-Ref') || '' }, body && body.action);
      if (!res.ok) return json({ ok: false, error: res.error }, 400);
      const v = live.v + 1;
      await this.state.storage.put('table', table);
      await this.state.storage.put('meta', { token: live.token, v, updated: now });
      return json({ ok: true, v, state: table, delta: res.delta, balance: res.balance, entry: res.entry, playerFound: res.playerFound });
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
      players: body.state.players.map(p => ({ id: p.id, name: p.name, start: p.start, balance: p.balance, added: p.added })), // no owners
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
      return json({ status: d ? d.status : 'none', ref: d ? d.ref : undefined });
    }

    if (path === '/request') {
      const name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);
      if (!name) return json({ error: 'name required' }, 400);
      const key = 'd:' + b.deviceId;
      const existing = await s.get(key);
      if (existing) return json({ status: existing.status }); // blocked stays blocked
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
      for (const v of all.values()) devices.push({ ref: v.ref, name: v.name, status: v.status, requested: v.requested });
      devices.sort((x, y) => y.requested - x.requested);
      return json({ devices });
    }

    if (path === '/action') {
      const id = await s.get('r:' + b.ref);
      const d = id && await s.get('d:' + id);
      if (!d) return json({ error: 'not found' }, 404);
      if (b.action === 'remove') { await s.delete('d:' + id); await s.delete('r:' + b.ref); }
      else { d.status = b.action === 'approve' ? 'approved' : 'blocked'; await s.put('d:' + id, d); }
      return json({ ok: true });
    }

    if (path === '/self') { // the admin's own device
      const key = 'd:' + b.deviceId;
      const existing = await s.get(key);
      if (existing) { existing.status = 'approved'; await s.put(key, existing); return json({ status: 'approved' }); }
      let ref;
      do { ref = randomString(8, ALNUM); } while (await s.get('r:' + ref));
      await s.put(key, { ref, name: 'Admin', status: 'approved', requested: Date.now() });
      await s.put('r:' + ref, b.deviceId);
      return json({ status: 'approved' });
    }

    return json({ error: 'not found' }, 404);
  }
}
