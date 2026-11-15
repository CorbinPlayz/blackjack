// Browser test: the real index.html talks to the real worker code (in-process Room + Registry) at an online dealer table.
// Needs ./w.mjs (copy of worker/src/index.js) and Playwright. Takes about a minute (the dealer's timers are real).
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const html = path.resolve(__dirname, '../index.html');
const shots = process.env.SHOTS || '';
(async () => {
  const W = await import('./w.mjs');
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
  const made = await call('POST', '/api/rooms', devH); assert.ok(made.code && made.token, 'host creates a table');
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

  ok(/online dealer/i.test(await p.locator('#roundPanel').innerText()), 'the table shows the online dealer panel');
  ok(/waiting for players|dealing once/i.test(await p.locator('#roundPanel').innerText()), 'with nobody seated it waits for players');
  await shot('1-empty');
  // take a seat from the bank account
  await p.fill('#newName', 'Pat'); await p.fill('#newStart', '500'); await p.click('#addBtn'); await p.waitForTimeout(1200);
  ok(/Pat/.test(await p.locator('#roundPanel').innerText()), 'the new seat shows on the dealer table');
  ok((await call('GET', '/api/vault', devP))._s === 200 && (await call('GET', '/api/vault', devP)).balance === 50000, 'the $500 buy-in came out of the $1,000 bank account');
  ok(await p.locator('#hostFundHint').isHidden(), 'players do not see the host-only hint');
  // wager
  await p.waitForTimeout(500);
  await p.locator('button[data-action="qbet"]').first().click(); await p.waitForTimeout(800);
  ok(/wager/i.test(await p.locator('#roundPanel').innerText()), 'the locked-in wager shows on the table');
  ok((await p.locator('#dealTimer').innerText()).length > 0, 'a countdown is shown');
  await shot('2-betting');
  // the dealer deals by itself once everyone has bet
  await p.waitForFunction(() => document.querySelectorAll('#roundPanel .dkc').length >= 3, null, { timeout: 30000 });
  await p.waitForTimeout(600);
  const cards = await p.locator('#roundPanel .dkc').count();
  const backs = await p.locator('#roundPanel .dkc.back').count(), early = await p.locator('#roundPanel .chip-res').count();
  ok(cards >= 3 && (backs === 1 || (backs === 0 && early >= 1)), 'cards are dealt: the player\'s two and the dealer\'s up card, plus one face-down hole card (or a natural blackjack already ended the round)');
  await shot('3-dealt');
  const panel = await p.locator('#roundPanel').innerText();
  if (/insurance/i.test(panel) && await p.locator('button[data-d="insure"]').count()) { await p.locator('button[data-d="insure"][data-take="0"]').click(); await p.waitForTimeout(800); }
  const done0 = await p.locator('#roundPanel .chip-res').count();
  if (!done0) {
    ok(await p.locator('button[data-d="hit"]').isVisible() && await p.locator('button[data-d="stand"]').isVisible(), 'Hit and Stand buttons are there on my turn');
    await p.locator('button[data-d="hint"]').click(); ok(/Basic strategy says: (Hit|Stand|Double|Split)/.test(await p.locator('#dealMsg').innerText()), 'the hint button gives a basic-strategy answer');
    await shot('4-acting');
    await p.locator('button[data-d="stand"]').click(); await p.waitForTimeout(1200);
  }
  ok(await p.locator('#roundPanel .chip-res').count() >= 1 && await p.locator('#roundPanel .dkc.back').count() === 0, 'the round ends with a result chip and the hole card turned face up');
  await shot('5-results');
  const after = await call('GET', '/api/rooms/' + code, devP);
  ok(after.state.deal.cards.length >= 2 && !JSON.stringify(after).includes('"shoe"'), 'what the page was sent has no shoe');
  // by itself, the next round opens
  await p.waitForFunction(() => /place your wagers/i.test(document.getElementById('roundPanel').innerText), null, { timeout: 20000 });
  ok(true, 'the next round opens by itself after the results');
  ok(!errs.length, 'no page errors: ' + errs.join(' | '));
  await b.close();
  console.log('ALL', n, 'DEALER UI CHECKS PASSED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
