// Browser test: the Loans panel on the Me tab (borrow, repay, offers, frozen banner).
const { chromium } = require('playwright'); const assert = require('assert'); const path = require('path');
const html = path.resolve(__dirname, '../index.html'); const shots = process.env.SHOTS || '';
(async () => {
  const b = await chromium.launch(); let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
  const ctx = await b.newContext({ viewport: { width: 390, height: 1400 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const J = o => ({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  let loan = null, posts = [];
  const status = () => ({ loan, frozen: !!loan && loan.overdue, balance: 100000, limit: 50000, bankMax: 40000, bankRateBp: 500, bankDays: 3, maxFriendBp: 1000, maxFriendDays: 14, minLoan: 100,
    offers: [{ id: 'off1', lender: 'Casey', amount: 20000, rateBp: 300, days: 4, forMe: false }], myOffers: [], lent: [], t: Date.now() });
  await p.route('**/api/**', r => { const u = new URL(r.request().url()).pathname;
    if (u === '/api/loans') return r.fulfill(J(status()));
    if (u.startsWith('/api/loans/')) { const body = r.request().postData(); posts.push(u + ' ' + body);
      if (u.endsWith('/bank')) loan = { kind: 'bank', principal: 10000, rateBp: 500, start: Date.now(), due: Date.now() + 3 * 86400000, owed: 10000, overdue: false, lender: 'The bank' };
      if (u.endsWith('/repay')) loan = null;
      return r.fulfill(J({ ok: true })); }
    if (u === '/api/vault') return r.fulfill(J({ balance: 100000, ledger: [{ t: Date.now(), type: 'loan', amount: 10000, balance: 110000 }] }));
    if (u === '/api/access/status') return r.fulfill(J({ status: 'approved', ref: 'abcd1234', admin: false }));
    return r.fulfill(J({})); });
  await p.route(/accounts\.google|gstatic|googleapis/, r => r.abort());
  await p.addInitScript(() => { localStorage.setItem('bjDevice.v1', 'q'.repeat(32)); localStorage.setItem('bjAccess.v1', 'approved'); localStorage.setItem('bjRef.v1', 'abcd1234'); localStorage.setItem('bjName.v1', 'Pat'); });
  await p.goto('file://' + html); await p.waitForTimeout(1500);
  await p.locator('#nav button[data-go="me"]').click(); await p.waitForTimeout(1000);
  let t = await p.locator('#loanPanel').innerText();
  ok(/5% a day/.test(t) && /\$400/.test(t), 'shows the bank rate and how much you can borrow');
  ok(/Casey offers \$200 at 3% a day for 4 days/.test(t), 'lists a friend offer');
  await p.fill('#loanAmt', '100'); await p.locator('#loanBorrow').click(); await p.waitForTimeout(800);
  ok(posts.some(x => /loans\/bank \{"amount":10000/.test(x)), 'Borrow posts the amount in cents');
  t = await p.locator('#loanPanel').innerText();
  ok(/You owe \$100/.test(t) && /Repay/.test(t) && !(await p.locator('#loanNew').isVisible()), 'an active loan shows what you owe and hides the borrow box');
  await p.locator('#loanRepay').click(); await p.waitForTimeout(800);
  ok(posts.some(x => /loans\/repay/.test(x)) && await p.locator('#loanNew').isVisible(), 'repaying brings the borrow box back');
  await p.locator('[data-accept="off1"]').click(); await p.waitForTimeout(500);
  ok(posts.some(x => /loans\/accept \{.*"id":"off1"/.test(x)), 'Accept sends the offer id');
  await p.fill('#offAmt', '50'); await p.fill('#offRate', '2.5'); await p.fill('#offDays', '3'); await p.fill('#offTo', 'Sam'); await p.locator('#offerBtn').click(); await p.waitForTimeout(500);
  ok(posts.some(x => /loans\/offer \{"amount":5000,"ratePct":2.5,"days":3,"toName":"Sam"/.test(x)), 'posting an offer sends amount, rate, days and friend name');
  loan = { kind: 'bank', principal: 10000, rateBp: 500, start: 0, due: Date.now() - 1000, owed: 17500, overdue: true, lender: 'The bank' };
  await p.evaluate(() => { document.querySelector('#nav button[data-go="board"]').click(); }); await p.locator('#nav button[data-go="me"]').click(); await p.waitForTimeout(1000);
  ok(/FROZEN/.test(await p.locator('#loanBanner').innerText()) && /OVERDUE/.test(await p.locator('#loanInfo').innerText()), 'an overdue loan shows the frozen banner');
  if (shots) await p.screenshot({ path: path.join(shots, 'loans.png'), fullPage: true });
  ok(!errs.length, 'no page errors: ' + errs.join('|'));
  await b.close(); console.log('ALL', n, 'LOANS UI CHECKS PASSED');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
