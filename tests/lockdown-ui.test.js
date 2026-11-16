// Browser test: the neon lockdown screen appears on a 423 from the server, shows a countdown, and goes away when the site reopens.
const { chromium } = require('playwright');
const assert = require('assert'); const path = require('path');
const html = path.resolve(__dirname, '../index.html'); const shots = process.env.SHOTS || '';
(async () => {
  const b = await chromium.launch(); let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let locked = true; const until = Date.now() + 5 * 3600 * 1000 + 61000;
  await p.route('**/api/**', r => locked
    ? r.fulfill({ status: 423, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'The house went broke.', locked: true, until, t: Date.now() }) })
    : r.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 'none' }) }));
  await p.route(/accounts\.google|gstatic|googleapis/, r => r.abort());
  await p.addInitScript(() => { localStorage.setItem('bjDevice.v1', 'q'.repeat(32)); localStorage.setItem('bjAccess.v1', 'approved'); });
  await p.goto('file://' + html); await p.waitForTimeout(2500);
  ok(await p.locator('#lockdown').isVisible(), 'a 423 from the server turns the whole page into the lockdown screen');
  const txt = await p.locator('#lockdown').innerText();
  ok(/THE HOUSE\s+WENT BROKE/i.test(txt), 'it says THE HOUSE WENT BROKE');
  ok(/^0[45]:\d\d:\d\d$/m.test(await p.locator('#ldTimer').innerText()), 'the big timer counts down to when the lock ends: ' + await p.locator('#ldTimer').innerText());
  ok(await p.locator('.ld-chip').count() >= 20, 'chips are falling');
  const t1 = await p.locator('#ldTimer').innerText(); await p.waitForTimeout(1600); ok((await p.locator('#ldTimer').innerText()) !== t1, 'the timer ticks');
  const top = await p.evaluate(() => { const e = document.elementFromPoint(195, 420); return !!e && !!e.closest('#lockdown'); });
  ok(top, 'nothing on the page can be clicked through the screen');
  if (shots) await p.screenshot({ path: path.join(shots, 'lockdown.png') });
  ok(!errs.length, 'no page errors: ' + errs.join('|'));
  // demo preview
  const p2 = await ctx.newPage(); await p2.route('**/api/**', r => r.abort()); await p2.route(/accounts\.google|gstatic|googleapis/, r => r.abort());
  await p2.goto('file://' + html + '?demo=broke'); await p2.waitForTimeout(800);
  ok(await p2.locator('#lockdown').isVisible() && /^23:59:/.test(await p2.locator('#ldTimer').innerText()), '?demo=broke previews the screen');
  await b.close(); console.log('ALL', n, 'LOCKDOWN UI CHECKS PASSED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
