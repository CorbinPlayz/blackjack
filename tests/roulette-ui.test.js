// Browser test: the real index.html at a roulette table, talking to the real worker code (in-process Room + Registry).
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
  const made = await call('POST', '/api/rooms', devH, { game: 'roulette' }); assert.strictEqual(made.game, 'roulette'); assert.ok(made.code && made.token, 'host creates a table');
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

  // take a seat
  ok(/Roulette/.test(await p.locator('#roundPanel').innerText()), 'the table shows the roulette panel');
  await p.fill('#newStart', '500'); await p.click('#addBtn'); await p.waitForTimeout(1500);
  ok(await p.locator('#roundPanel .rou-board button').count() === 38 && await p.locator('button[data-pick="37"]').count() === 1, 'the betting board has 36 numbers plus 0 and 00');
  ok(/Bets close in \d+s/.test(await p.locator('#roundPanel').innerText()), 'a countdown shows when bets close');
  ok(await p.locator('#players .qbets').count() === 0, 'no blackjack wager buttons on the seat');
  await shot('r1-board');
  await p.locator('[data-rchip="1000"]').click(); await p.waitForTimeout(200);
  await p.locator('button[data-pick="17"]').click(); await p.waitForTimeout(300);
  const pick = await p.locator('.rou-pick').innerText();
  ok(/Straight up 17/.test(pick) && /Split 16 \/ 17/.test(pick) && /Street 16-18/.test(pick) && /Corner 13-14-16-17/.test(pick), 'tapping a number offers every bet that touches it');
  await shot('r2-pick');
  await p.locator('.rou-pick [data-rbet="num:17"]').click(); await p.waitForTimeout(900);
  ok(/\$10/.test(await p.locator('button[data-pick="17"] .cb').innerText()), 'the $10 chip sits on 17');
  await p.locator('[data-k="red"]').click(); await p.waitForTimeout(900);
  ok(await p.locator('[data-k="red"] .cb').count() === 1, 'and a chip on Red');
  ok(/Your bets: \$20 of \$500/.test(await p.locator('#roundPanel').innerText()), 'the total on the table shows');
  await p.locator('[data-rop="rundo"]').click(); await p.waitForTimeout(700);
  ok(await p.locator('[data-k="red"] .cb').count() === 0 && await p.locator('button[data-pick="17"] .cb').count() === 1, 'Undo takes the last chip back');
  await p.locator('[data-rchip="5000"]').click();
  for (const nn of [5, 6, 7]) { await p.locator('button[data-pick="' + nn + '"]').click(); await p.locator('.rou-pick [data-rbet="num:' + nn + '"]').click(); await p.waitForTimeout(900); }
  ok(/at most 25%/.test(await p.locator('#rouMsg').innerText()), 'a bet over 25% of your chips is refused with a clear message');
  await shot('r3-bets');
  const before = (await call('GET', '/api/rooms/' + code, devP)).state.players[0].balance;
  skew += 31000; await p.waitForTimeout(2600);
  ok(await p.locator('#roundPanel .rou-result .rn').count() === 1, 'after the window the wheel result shows');
  const st = (await call('GET', '/api/rooms/' + code, devP)).state; const me = st.players[0];
  ok(st.roul.num >= 0 && me.rl && me.balance === before + me.rl.net, 'the seat balance moved by the net result: ' + me.rl.net);
  ok(/You (won|lost)/.test(await p.locator('#roundPanel').innerText()), 'the player is told whether they won');
  await shot('r4-result');
  ok(await p.locator('[data-k="red"]').first().isDisabled(), 'no betting while the result shows');
  skew += 9000; await p.waitForTimeout(2600);
  ok(await p.locator('[data-k="red"]').first().isEnabled() && /Bets close in/.test(await p.locator('#roundPanel').innerText()), 'then the next betting window opens');
  await p.locator('[data-rop="rrepeat"]').click(); await p.waitForTimeout(900);
  ok(/at most 25%/.test(await p.locator('#rouMsg').innerText()), 'Repeat last obeys the 25% limit (your chips went down, so the old bets no longer fit)');
  await p.locator('[data-rchip="1000"]').click(); await p.locator('button[data-pick="17"]').click(); await p.locator('.rou-pick [data-rbet="num:17"]').click(); await p.waitForTimeout(900);
  ok(await p.locator('button[data-pick="17"] .cb').count() === 1, 'and a smaller bet goes through');
  ok(!errs.length, 'no page errors: ' + errs.join('|'));
  Date.now = realNow;
  await b.close(); console.log('ALL', n, 'ROULETTE UI CHECKS PASSED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
