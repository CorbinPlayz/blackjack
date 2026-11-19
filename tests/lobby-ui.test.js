// Browser test: the casino floor lists open tables and Sit down joins one.
const { chromium } = require('playwright'); const assert = require('assert'); const path = require('path');
const html = path.resolve(__dirname, '../index.html');
(async () => {
  const b = await chromium.launch(); let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const J = o => ({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  let tables = [], joined = '';
  await p.route('**/api/**', r => { const u = new URL(r.request().url()).pathname;
    if (u === '/api/access/status') return r.fulfill(J({ status: 'approved', ref: 'abcd1234', admin: false }));
    if (u === '/api/lobby') return r.fulfill(J({ tables, t: Date.now() }));
    if (/^\/api\/rooms\/[A-Z0-9]+/.test(u)) { joined = u; return r.fulfill(J({ error: 'x' })); }
    if (u === '/api/vault') return r.fulfill(J({ balance: 250000, ledger: [] }));
    return r.fulfill(J({})); });
  await p.route(/accounts\.google|gstatic|googleapis/, r => r.abort());
  await p.addInitScript(() => { localStorage.setItem('bjDevice.v1', 'q'.repeat(32)); localStorage.setItem('bjAccess.v1', 'approved'); localStorage.setItem('bjRef.v1', 'abcd1234'); localStorage.setItem('bjName.v1', 'Pat'); localStorage.setItem('bjWelcome.v1', '1'); });
  await p.goto('file://' + html); await p.waitForTimeout(1200);
  ok(await p.locator('#lobbyEmpty').isVisible(), 'an empty casino floor says so');
  tables = [{ code: 'ABC123', game: 'roulette', host: 'Sam', seats: 3, maxBet: 50000, since: 1 }, { code: 'XYZ789', game: 'blackjack', host: 'Lee', seats: 1, maxBet: 0, since: 2 }];
  await p.locator('#nav button[data-go="me"]').click(); await p.waitForTimeout(300);
  await p.locator('#nav button[data-go="table"]').click(); await p.waitForTimeout(800);
  ok(await p.locator('.lobby-row').count() === 2, 'two open tables are listed');
  ok(await p.locator('#lobbyEmpty').isHidden(), 'the empty note hides');
  const t = await p.locator('#lobbyRows').innerText();
  ok(/Roulette/.test(t) && /Sam/.test(t) && /3 players/.test(t) && /1 player\b/.test(t), 'rows show game, host and player count');
  const r0 = await p.locator('.lobby-row').first().boundingBox(), lt = await p.locator('.lobby-row .lt').first().boundingBox(), bt = await p.locator('.lobby-row button').first().boundingBox();
  ok(lt.width > 110, 'the table name column is wide enough to read (' + Math.round(lt.width) + 'px)');
  ok(bt.width < r0.width * 0.6 && !(bt.y < lt.y + lt.height - 2 && bt.x < lt.x + lt.width - 2 && bt.x + bt.width > lt.x), 'the Sit down button does not cover the text');
  ok(r0.height < 130, 'a row stays compact (' + Math.round(r0.height) + 'px)');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/lobby.png' });
  await p.locator('[data-lobby="ABC123"]').click(); await p.waitForTimeout(500);
  ok(/ABC123/.test(joined), 'Sit down tries to join that table');
  ok(!errs.length, 'no page errors: ' + errs.join('|'));
  await b.close(); console.log('ALL', n, 'LOBBY UI CHECKS PASSED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
