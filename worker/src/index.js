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
  return s.players.every(p =>
    p && typeof p.id === 'number' && typeof p.name === 'string' && p.name.length <= 60 &&
    Number.isInteger(p.start) && Number.isInteger(p.balance));
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

// A request may use tables only if it comes from an approved device (or the admin).
async function allowed(request, env) {
  if (adminOk(request, env)) return true;
  const id = request.headers.get('X-Device-Id') || '';
  if (!ID_RE.test(id)) return false;
  const r = await reg(env, '/status', { deviceId: id });
  return (await r.json()).status === 'approved';
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

    const m = url.pathname.match(/^\/api\/rooms(?:\/([A-Za-z0-9]{4,6}))?$/);
    if (!m) return json({ error: 'not found' }, 404);
    if (!(await allowed(request, env))) return json({ error: 'not approved' }, 403);

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
      return json({ status: d ? d.status : 'none' });
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
