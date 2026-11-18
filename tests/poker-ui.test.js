// Browser test: the real index.html at a video poker table, talking to the real worker code (in-process Room + Registry).
// Needs ./w.mjs (copy of worker/src/index.js) and Playwright. Takes about a minute (the dealer's timers are real).
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const html = path.resolve(__dirname, '../index.html');
const shots = process.env.SHOTS || '';
(async () => {
  const W = await import('./w.mjs');
  W._setStartGrant(100000);
  const mkStore = () => { const m = new Map(); return { storage: { get: async k => m.get(k), put: async (k, v) => void m.set(k, v), delete: async k => void m.delete(k), deleteAll: async () => m.clear(), list: async ({ prefix }) => new Map([...m].filter(([k]) => k.startsWith(prefix))) } }; };
  const registry = new W.Registry({ storage: mkStore().storage });
  const rooms = {};
  const env = {
    ADMIN_KEY: 'k', ADMIN_EMAILS: '',
    REGISTRY: { idFromName: () => 'main', get: () => ({ fetch: (u, i) => registry.fetch(new Request(u, i)) }) },
    ROOM: { idFromName: n => n, get: n => ({ fetch: (u, i) => (rooms[n] || (rooms[n] = new W.Room({ storage: mkStore().storage }, env))).fetch(new Request(u, i)) }) },
  };
  const reg = async (p, b) => (await registry.fetch(new Request('https://x' + p, { method: 'POST', body: JSON.stringify(b) }))).json();
  const devH = 'h'.repeat(32), devP = 'p'.repeat(32);
  await reg('/self', { deviceId: devH }); await reg('/self', { deviceId: devP });
  const refH = (await reg('/status', { deviceId: devH })).ref, refP = (await reg('/status', { deviceId: devP })).ref;
  const call = async (method, url, dev, body, extra) => {
    const r = await W.default.fetch(new Request('https://w.test' + url, { method, headers: Object.assign({ 'X-Device-Id': dev, 'Content-Type': 'application/json' }, extra || {}), body: body ? JSON.stringify(body) : undefined }), env);
    return Object.assign(await r.json(), { _s: r.status });
  };
  const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;     // the worker's clock can be pushed forward so the 30-second windows pass at once
  const made = await call('POST', '/api/rooms', devH, { game: 'poker' }); assert.strictEqual(made.game, 'poker'); assert.ok(made.code && made.token, 'host creates a table');
  const code = made.code;
  assert.ok((await call('PUT', '/api/rooms/' + code, devH, { state: { players: [], history: [] } }, { Authorization: 'Bearer ' + made.token })).ok, 'host starts the table');

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => m.type() === 'error' && !/net::|Failed to load|ERR_|favicon|accounts\.google/.test(m.text()) && errs.push(m.text()));
  await p.route('**/api/**', async r => {
    const q = r.request(); const u = new URL(q.url());
    const res = await W.default.fetch(new Request('https://w.test' + u.pathname + u.search, { method: q.method(), headers: q.headers(), body: q.postData() || undefined }), env);
    const h = {}; res.headers.forEach((v, k) => { h[k] = v; });
    await r.fulfill({ status: res.status, headers: h, body: await res.text() });
  });
  await p.route(/accounts\.google|gstatic|googleapis/, r => r.abort());
  await p.addInitScript(([dev, ref, c]) => {
    localStorage.setItem('bjDevice.v1', dev); localStorage.setItem('bjAccess.v1', 'approved'); localStorage.setItem('bjRef.v1', ref); localStorage.setItem('bjName.v1', 'Pat');
    localStorage.setItem('bjOnline.v1', JSON.stringify({ role: 'viewer', code: c, token: null }));
  }, [devP, refP, code]);
  await p.goto('file://' + html); await p.waitForTimeout(2500);
  const shot = async n => { if (shots) await p.screenshot({ path: path.join(shots, n + '.png') }); };
  const txt = async () => (await p.locator('body').innerText());
  let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };

  ok(/Video poker/.test(await p.locator('#roundPanel').innerText()), 'the table shows the video poker panel');
  await p.fill('#newStart', '500'); await p.click('#addBtn'); await p.waitForTimeout(1500);
  ok(await p.locator('#vpGo').isVisible() && /Deal \$5/.test(await p.locator('#vpGo').innerText()), 'a Deal button is ready');
  ok(/Royal flush/.test(await p.locator('#roundPanel').innerText()) && /100 to 1/.test(await p.locator('#roundPanel').innerText()), 'the pay table is shown');
  ok(await p.locator('#players .qbets').count() === 0, 'no blackjack wager buttons on the seat');
  await shot('v1-start');
  await p.locator('[data-vpchip="1000"]').click(); await p.waitForTimeout(200);
  ok(/Deal \$10/.test(await p.locator('#vpGo').innerText()), 'picking the $10 chip changes the deal');
  await p.locator('#vpGo').click(); await p.waitForTimeout(1200);
  ok(await p.locator('.vp-hand button').count() === 5 && /Draw/.test(await p.locator('#vpGo').innerText()), 'five cards are dealt and the button becomes Draw');
  const st1 = (await call('GET', '/api/rooms/' + code, devP)).state; const hand = st1.players[0].vp.hand.slice();
  ok(st1.players[0].balance === 50000 - 1000, 'the $10 stake left the chips');
  await p.locator('[data-vpcard="0"]').click(); await p.locator('[data-vpcard="3"]').click(); await p.waitForTimeout(300);
  ok(await p.locator('.vp-hand button.held').count() === 2 && /HELD/.test(await p.locator('.vp-hand').innerText()), 'tapping cards holds them');
  await p.locator('[data-vpcard="3"]').click(); await p.waitForTimeout(200);
  ok(await p.locator('.vp-hand button.held').count() === 1, 'tapping again lets go');
  await shot('v2-hold');
  await p.locator('#vpGo').click(); await p.waitForTimeout(1200);
  const st2 = (await call('GET', '/api/rooms/' + code, devP)).state; const me = st2.players[0];
  ok(me.vp.phase === 'idle' && me.vp.hand[0] === hand[0] && me.vp.res, 'the held card stayed, the hand was paid: ' + me.vp.res.k);
  ok(me.balance === 50000 - 1000 + me.vp.res.pay, 'the balance matches the pay');
  ok(await p.locator('#vpRes').count() === 1 && /Deal/.test(await p.locator('#vpGo').innerText()), 'the result shows and Deal is back');
  await shot('v3-result');
  ok(!JSON.stringify(st2).includes('"deck"'), 'no deck in the table data');
  await p.locator('[data-vpchip="10000"]').click(); await p.locator('#vpGo').click(); await p.waitForTimeout(1000);
  ok(/at most|pays at most/.test(await p.locator('#vpMsg').innerText()), 'a bet that is too big is refused with a message');
  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  await b.close(); Date.now = realNow; console.log('ALL', n, 'POKER UI CHECKS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
