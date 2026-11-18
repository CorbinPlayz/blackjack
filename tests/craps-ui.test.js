// Browser test: the real index.html at a craps table, talking to the real worker code (in-process Room + Registry).
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
  const made = await call('POST', '/api/rooms', devH, { game: 'craps' }); assert.strictEqual(made.game, 'craps'); assert.ok(made.code && made.token, 'host creates a table');
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

  ok(/Craps/.test(await p.locator('#roundPanel').innerText()), 'the table shows the craps panel');
  await p.fill('#newStart', '500'); await p.click('#addBtn'); await p.waitForTimeout(1500);
  ok(/COME OUT/.test(await p.locator('#crPuck').innerText()), 'the puck says come out');
  ok(/Bets close in \d+s/.test(await p.locator('#roundPanel').innerText()), 'a countdown shows when bets close');
  ok(await p.locator('#players .qbets').count() === 0, 'no blackjack wager buttons on the seat');
  ok(await p.locator('[data-crbet="odds_pass"]').isDisabled() && await p.locator('[data-crbet="pass"]').isEnabled(), 'odds are off until a point; pass is on');
  await shot('c1-start');
  await p.locator('[data-crchip="1000"]').click(); await p.waitForTimeout(200);
  await p.locator('[data-crbet="pass"]').click(); await p.waitForTimeout(900);
  ok(/\$10/.test(await p.locator('[data-crbet="pass"] .cb').innerText()), 'a $10 chip sits on the Pass Line');
  await p.locator('[data-crbet="field"]').click(); await p.waitForTimeout(900);
  ok(/On the table: \$20 of \$500/.test(await p.locator('#roundPanel').innerText()), 'the total on the table shows');
  await p.locator('[data-crop="cundo"]').click(); await p.waitForTimeout(800);
  ok(await p.locator('[data-crbet="field"] .cb').count() === 0 && await p.locator('[data-crbet="pass"] .cb').count() === 1, 'Undo takes the last chip back');
  await p.locator('[data-crchip="10000"]').click(); await p.locator('[data-crbet="any7"]').click(); await p.waitForTimeout(900); await p.locator('[data-crbet="any7"]').click(); await p.waitForTimeout(900);
  ok(/at most 25%/.test(await p.locator('#crMsg').innerText()), 'a bet over 25% of your chips is refused with a message');
  await shot('c2-bets');
  skew += 21000; await p.waitForTimeout(2800);
  ok(await p.locator('#crDice .cr-die').count() === 2, 'after the window the dice show');
  const st = (await call('GET', '/api/rooms/' + code, devP)).state; const R = st.craps;
  ok(R.dice.length === 2 && R.hist[0] === R.dice[0] + R.dice[1], 'the roll was ' + R.hist[0]);
  const settled = R.phase === 'come';
  ok(settled ? (await p.locator('#crRes').count()) === 1 : /POINT/.test(await p.locator('#crPuck').innerText()), settled ? 'a come-out result is shown' : 'the point puck turned on');
  await shot('c3-roll');
  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  await b.close(); Date.now = realNow; console.log('ALL', n, 'CRAPS UI CHECKS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
