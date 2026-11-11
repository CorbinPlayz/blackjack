// Online table service for the Blackjack Chip Tracker.
// The dealer's phone is the only writer; everyone else polls read-only.
// One Durable Object per table code keeps each table isolated and consistent.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const MAX_BODY = 200 * 1024;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
  return s.players.every(p =>
    p && typeof p.id === 'number' && typeof p.name === 'string' && p.name.length <= 60 &&
    Number.isInteger(p.start) && Number.isInteger(p.balance));
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
    const m = url.pathname.match(/^\/api\/rooms(?:\/([A-Za-z0-9]{4,6}))?$/);
    if (!m) return json({ error: 'not found' }, 404);

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

    if (request.method === 'GET') {
      const table = await this.state.storage.get('table');
      return json({ v: live.v, state: table });
    }

    // PUT: host only
    const auth = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (!timingSafeEqual(auth, live.token)) return json({ error: 'unauthorized' }, 401);
    let body;
    try { body = JSON.parse(await request.text()); } catch (e) { return json({ error: 'bad json' }, 400); }
    if (!body || !validState(body.state)) return json({ error: 'bad state' }, 400);
    const v = live.v + 1;
    await this.state.storage.put('table', body.state);
    await this.state.storage.put('meta', { token: live.token, v, updated: now });
    return json({ ok: true, v });
  }
}
