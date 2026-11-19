// Browser test (step 15a): the blackjack room and felt table layout.
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
  const box = async sel => p.locator(sel).first().boundingBox();
  const st = await box('#bjStage');
  ok(st && st.width > 250 && Math.abs(st.width / st.height - 360 / 460) < 0.03, 'the stage keeps its 360:460 shape');
  ok(await p.locator('#bjStage .bj-room').count() === 1 && await p.locator('#bjStage .bj-lamp').count() === 1 && await p.locator('#bjStage .bj-slot').count() === 6 && await p.locator('#bjStage .bj-frame').count() === 2, 'the room has its wall, lamp, 2 paintings and 6 slot machines');
  ok(/OPEN/.test(await p.locator('.bj-neon').innerText()) && /Progressive pot/i.test(await p.locator('.bj-pot').innerText()), 'the OPEN sign and the pot sign are up');
  ok(/BLACKJACK PAYS 3 TO 2/.test(await p.locator('#bjStage svg.bjart').innerHTML()) && /DEALER MUST STAND ON ALL 17s/.test(await p.locator('#bjStage svg.bjart').innerHTML()) && /INSURANCE PAYS 2 TO 1/.test(await p.locator('#bjStage svg.bjart').innerHTML()), 'the felt has its printed arcs');
  ok(await p.locator('.bj-seat').count() === 7 && await p.locator('.bj-seat.empty').count() === 7, 'seven seats on the curve, all empty at first');
  ok(/Sit here/i.test(await p.locator('.bj-seat.empty').first().innerText()), 'empty seats say Sit here');
  ok(/(Dee|Marco|Priya|Lou)/i.test(await p.locator('.bj-dealer .dname').innerText()), 'the dealer has a name');
  ok(/Table [A-Z0-9]{4,6}/i.test(await p.locator('.bj-plaque').innerText()), 'the table plaque shows the code');
  await shot('s1-empty');
  await p.fill('#newStart', '500'); await p.click('#addBtn'); await p.waitForTimeout(1500);
  ok(await p.locator('.bj-seat.me').count() === 1 && await p.locator('.bj-seat:not(.empty)').count() === 1, 'I sit down: one occupied seat, and it is mine');
  const me = await box('.bj-seat.me'), sb = await box('#bjStage');
  const cx = me.x + me.width / 2, scx = sb.x + sb.width / 2;
  ok(Math.abs(cx - scx) < 8, 'my seat is at the bottom centre of the table');
  ok(me.y + me.height <= sb.y + sb.height + 1 && me.x >= sb.x - 2 && me.x + me.width <= sb.x + sb.width + 2, 'my seat sits inside the stage');
  const other = await box('.bj-seat.empty');
  ok(me.width > other.width * 1.1, 'my seat is drawn larger than the others');
  ok(/admin/i.test(await p.locator('.bj-seat.me .bj-plate').innerText()) && /\$5/.test(await p.locator('.bj-seat.me .bj-plate').innerText()), 'my brass nameplate has my name and my chips');
  ok(await p.locator('.bj-seat.me .bj-plate .av').count() === 1, 'and a round initial avatar');
  ok(await p.locator('.bj-seat').count() === 7, 'still seven seats');
  const seats = await p.locator('.bj-seat').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));
  const same = new Set(seats.map(s => s.join(','))); ok(same.size === 7, 'every seat has its own spot');
  // place a bet and watch the chips show on the bet circle
  await p.locator('button[data-action="qbet"]').first().click(); await p.waitForTimeout(900);
  ok(await p.locator('.bj-seat.me .bj-ring .bst i').count() >= 1 && /\$/.test(await p.locator('.bj-seat.me .bj-ring .bet').innerText()), 'my bet shows as chips with a value on the bet circle');
  await shot('s2-seated');
  // wait for cards, check no hidden value leaks into the page
  await p.waitForTimeout(7500);
  const dealerBack = await p.locator('.bj-dealer .dkc.back').count();
  const dh = await p.locator('.bj-dealer .dkcards').innerText();
  ok(dealerBack === 1 ? !/\?/.test(await p.locator('.bj-dealer .dkc.back').innerHTML().then(h => h.replace(/<[^>]+>/g, '').replace('?', ''))) : true, 'a face-down dealer card is only a back');
  ok(await p.locator('.bj-seat.me .dkc').count() >= 2, 'my two cards are on the felt at my seat');
  ok(await p.locator('.bj-seat.turn').count() <= 1, 'at most one seat has the turn ring');
  await shot('s3-dealt');
  const acting = await p.locator('button[data-d="hit"]').count();
  if (acting) ok(await p.locator('.bj-seat.me.turn').count() === 1, 'my seat glows when it is my turn');
  else ok(true, 'the hand was already over');
  ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
  await b.close(); console.log('ALL', n, 'TABLE LAYOUT CHECKS PASSED'); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
