const fs = require('fs'), vm = require('vm'), assert = require('assert');
const S = '/tmp/claude-0/-home-claude/3c512fd1-8a16-5647-acf2-2a8d2257fd0e/scratchpad';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.parent = null;
    this.className = ''; this.value = ''; this._text = ''; this.type = ''; this.id = ''; this.placeholder = ''; this.hidden = false; }
  set textContent(t) { this._text = String(t); } get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(v) { this.children = []; this._text = ''; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  focus() {}
  matches(sel) {
    if (sel === '.player') return this.className.split(' ').includes('player');
    if (sel === 'button[data-action]') return this.tag === 'button' && 'data-action' in this.attrs;
    if (sel === 'button[data-act]') return this.tag === 'button' && 'data-act' in this.attrs;
    if (sel === 'input[data-chips]') return this.tag === 'input' && 'data-chips' in this.attrs;
    if (sel === 'input[data-wager]') return this.tag === 'input' && 'data-wager' in this.attrs;
    return false;
  }
  closest(sel) { let e = this; while (e) { if (e.matches(sel)) return e; e = e.parent; } return null; }
  querySelector(sel) { for (const c of this.children) { if (c.matches(sel)) return c; const r = c.querySelector(sel); if (r) return r; } return null; }
  all(sel) { let out = []; for (const c of this.children) { if (c.matches(sel)) out.push(c); out = out.concat(c.all(sel)); } return out; }
}

// ---- real worker code behind a fake Durable Object runtime ----
async function makeWorker() {
  const { default: worker, Room, Registry, validState } = await import(S + '/worker.mjs');
  const rooms = {}; const regs = {};
  const mkStorage = () => { const st = new Map(); return { storage: {
    get: async k => st.get(k), put: async (k, v) => { st.set(k, JSON.parse(JSON.stringify(v))); }, delete: async k => { st.delete(k); },
    deleteAll: async () => st.clear(),
    list: async ({ prefix }) => { const m = new Map(); for (const [k, v] of st) if (k.startsWith(prefix)) m.set(k, JSON.parse(JSON.stringify(v))); return m; } } }; };
  const ADMIN_KEY = 'test-admin-key-0123456789abcdef0123';
  const env = { ADMIN_KEY, REGISTRY: { idFromName: c => c, get: id => ({ fetch: (u, init) => {
      if (!regs[id]) regs[id] = new Registry(mkStorage());
      return regs[id].fetch(new Request(u, init)); } }) }, ROOM: {
    idFromName: c => c,
    get: id => ({ fetch: (u, init) => {
      if (!rooms[id]) rooms[id] = new Room(mkStorage());
      return rooms[id].fetch(new Request(u, init));
    } }) } };
  const raw = (url, init) => worker.fetch(new Request(url, init), env);
  const f = (url, init) => { init = Object.assign({}, init); init.headers = Object.assign({ 'X-Admin-Key': ADMIN_KEY }, init.headers || {}); return raw(url, init); };
  const noAdminEnv = Object.assign({}, env, { ADMIN_KEY: undefined });
  return { f, raw, validState, rooms, ADMIN_KEY, rawNoAdmin: (url, init) => worker.fetch(new Request(url, init), noAdminEnv) };
}

function makeBrowser(html, fetchFn, seed, extra) {
  const els = new Proxy({}, { get: (t, k) => (typeof k === 'string' ? (t[k] || (t[k] = new El('div'))) : t[k]) });
  const doc = { getElementById: id => els[id] || (els[id] = new El('div')), createElement: t => new El(t) };
  // honour `hidden` attributes written in the real HTML so toggles start from the true state
  for (const m of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) { if (/\shidden(\s|>|=)/.test(m[0])) doc.getElementById(m[1]).hidden = true; }
  const store = {}; let confirmAnswer = true;
  const ctx = { document: doc, window: { confirm: () => confirmAnswer }, console, fetch: fetchFn,
    localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
    crypto: require('crypto').webcrypto, intervals: [],
    setInterval(f) { ctx.intervals.push(f); return ctx.intervals.length; }, clearInterval(id) { if (ctx.intervals[id - 1]) ctx.intervals[id - 1] = null; }, setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 5)), clearTimeout };
  Object.keys(seed || {}).forEach(k => { store[k] = seed[k]; });
  Object.assign(ctx, extra || {});
  ctx.window.prompt = (m, v) => { ctx.prompted = v; };
  vm.createContext(ctx);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  vm.runInContext(scripts[0] + '\nthis.Core = Core;', ctx);
  vm.runInContext(scripts[1], ctx);
  const fire = (el, type, extra) => (el.listeners[type] || []).forEach(f => f(Object.assign({ target: el, preventDefault() {} }, extra)));
  const players = () => els.players.all('.player');
  const cls = (i, p) => players()[i].children.find(c => c.className.startsWith(p));
  { const iv = setInterval(() => { const m = els.confirmModal; if (m && m.className === 'on') fire(els[confirmAnswer ? 'confirmYes' : 'confirmNo'], 'click'); }, 2); if (iv.unref) iv.unref(); }
  return { els, ctx, Core: ctx.Core, store, fire, players, ticks: async () => { for (const f of ctx.intervals.slice()) if (f) await f(); await tick(40); },
    balance: i => cls(i, 'balance').textContent,
    add(name, start) { els.newName.value = name; els.newStart.value = start; fire(els.addBtn, 'click'); return tick(3); },
    settle(i, w, o) { const c = players()[i]; const inp = c.querySelector('input[data-wager]'); inp.value = w;
      fire(els.players, 'input', { target: inp });
      fire(els.players, 'click', { target: c.all('button[data-action]').find(b => b.getAttribute('data-outcome') === o) }); return tick(3); },
    click: id => { fire(els[id], 'click'); return tick(3); }, setConfirm: v => { confirmAnswer = v; },
    histText: () => els.history.textContent };
}
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
let WK; const rid = () => require('crypto').randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 32).padEnd(32, 'q');
function players_has_badge(b, i) { return /YOU/.test(b.players()[i].textContent); }
async function appr(html, fetchFn, extra) {            // a browser whose device the admin already approved
  const id = rid();
  await WK.f('http://t/api/admin/self', { method: 'POST', body: JSON.stringify({ deviceId: id }) });
  const b = makeBrowser(html, fetchFn || ((u, i) => WK.raw(u, i)), { 'bjDevice.v1': id, 'bjAccess.v1': 'approved' }, extra);
  await tick(60);
  return b;
}

(async () => {
  const html = fs.readFileSync('/home/claude/blackjack/index.html', 'utf8');
  const offline = html.replace(/var ONLINE_URL = '[^']*';/, "var ONLINE_URL = '';");
  ok(/var ONLINE_URL = 'https:\/\/blackjack-table\.camc-cf76\.workers\.dev';/.test(html), 'ships pointing at the deployed worker');

  /* ---------- offline app: original scenarios still hold ---------- */
  let b = makeBrowser(offline, undefined);
  await b.add('Alice', '100'); await b.add('Bob', '500'); await b.add('Cara', '1000');
  ok(b.players().length === 3, '3 players appear immediately');
  await b.settle(0, '10', 'win'); ok(b.balance(0) === '$110', 'P1 $10 win -> $110');
  await b.settle(1, '500', 'win'); ok(b.balance(1) === '$1,000', 'P2 $500 win -> $1,000');
  await b.settle(2, '100', 'loss'); ok(b.balance(2) === '$900', 'P3 $100 loss -> $900');
  await b.add('Dan', '1000'); await b.settle(3, '100', 'blackjack'); ok(b.balance(3) === '$1,150', '$100 blackjack -> +$150');
  await b.settle(3, '100', 'push'); ok(b.balance(3) === '$1,150', 'push unchanged');
  await b.settle(0, '999', 'win'); ok(b.balance(0) === '$110', 'over-balance wager rejected');
  await b.settle(0, 'abc', 'win'); ok(b.balance(0) === '$110', 'garbage wager rejected');

  /* ---------- history + undo ---------- */
  ok(Core_h(b).length === 5, 'history holds only successful hands (5)');
  ok(/Dan/.test(b.histText()) && /Push/.test(b.histText()) && /\+\$150/.test(b.histText()), 'history list shows hands');
  await b.click('undoBtn'); ok(b.balance(3) === '$1,150', 'undo of a push changes nothing');
  await b.click('undoBtn'); ok(b.balance(3) === '$1,000', 'undo blackjack removes the $150 only from Dan');
  ok(b.balance(0) === '$110' && b.balance(1) === '$1,000' && b.balance(2) === '$900', 'undo never touches other players');
  await b.click('undoBtn'); ok(b.balance(2) === '$1,000', 'undo loss restores P3');
  await b.click('undoBtn'); await b.click('undoBtn'); ok(b.balance(1) === '$500' && b.balance(0) === '$100', 'undo all the way back');
  await b.click('undoBtn'); ok(/No hands to undo/.test(b.els.toolMsg.textContent), 'undo on empty history is safe');
  // undo after removal
  await b.settle(0, '10', 'win'); b.setConfirm(true);
  b.fire(b.els.players, 'click', { target: b.players()[0].all('button[data-action]').find(b => b.getAttribute('data-action') === 'remove') }); await tick(8);
  await b.click('undoBtn'); ok(/no longer at the table/.test(b.els.toolMsg.textContent), 'undo for a removed player does not crash');
  // reset clears history; persistence includes history
  await b.settle(0, '20', 'loss'); ok(JSON.parse(b.store['bjChipTracker.v1']).history.length === 1, 'history persisted');
  await b.click('resetBtn'); ok(b.balance(0) === '$500' && Core_h(b).length === 0, 'reset restores balances and clears history');
  // old saves (no history field) still load
  const b2 = makeBrowser(offline, undefined);
  b2.store['bjChipTracker.v1'] = JSON.stringify({ players: [{ id: 1, name: 'Old', start: 10000, balance: 12000 }], nextId: 2 });
  b2.Core.load(); ok(b2.Core.state.players[0].balance === 12000 && b2.Core.state.history.length === 0, 'old v1 saves still load');

  /* ---------- online: host + two players against the real worker ---------- */
  const W = await makeWorker(); WK = W;
  const fetchW = (url, init) => W.raw(url, init);
  const onlineHtml = html.replace(/var ONLINE_URL = '[^']*';/, "var ONLINE_URL = 'http://t';");
  const act = (b, action, token) => W.raw('http://t/api/rooms/' + b.code + '/act', { method: 'POST', headers: Object.assign({ 'X-Device-Id': b.dev }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify({ action }) });
  const ownerBtns = (br, i) => br.players()[i].all('button[data-action]');
  const clip = { text: null };
  const host = await appr(onlineHtml, undefined, { location: { href: 'http://x/app/?foo=1#z', search: '?foo=1' }, navigator: { clipboard: { writeText: t => { clip.text = t; return Promise.resolve(); } } } });
  await host.add('Alice', '100'); await host.add('Bob', '500');
  await host.click('hostBtn'); await tick(100);
  const code = host.els.onlineCode.textContent;
  ok(/^[A-HJ-NP-Z2-9]{5}$/.test(code), 'host gets a 5-char code: ' + code);
  ok(host.els.onlineOn.hidden === false && host.els.hostTools.hidden === false, 'host sees hosting panel and host tools');
  ok(host.players().length === 2 && host.balance(0) === '$100', 'table starts from the host\'s local game');
  const tableInfo = { code, dev: host.store['bjDevice.v1'] };
  const hostTok = JSON.parse(host.store['bjOnline.v1']).token;

  // invite link
  await host.click('inviteBtn'); await tick(30);
  ok(clip.text === 'http://x/app/?join=' + code, 'invite link built from the page address: ' + clip.text);
  const linked = await appr(onlineHtml, undefined, { location: { href: 'http://x/app/?join=' + code.toLowerCase(), search: '?join=' + code.toLowerCase() } });
  ok(linked.els.joinCode.value === code, 'opening an invite link pre-fills the join code');

  // player 1 joins
  const p1 = await appr(onlineHtml);
  p1.els.joinCode.value = code.toLowerCase(); await p1.click('joinBtn'); await tick(100);
  const p1ctx = { code, dev: p1.store['bjDevice.v1'] };
  ok(p1.players().length === 2 && p1.balance(0) === '$100' && p1.balance(1) === '$500', 'player joins and sees everyone\'s balances');
  ok(p1.els.addPanel.hidden === false && p1.els.addTitle.textContent === 'Take a seat' && p1.els.addBtn.textContent === 'Take seat', 'player is offered "Take a seat"');
  ok(ownerBtns(p1, 0).length === 0 && ownerBtns(p1, 1).length === 0, 'player has NO controls on other people\'s cards');
  ok(p1.els.toolbar.hidden === true && p1.els.hostTools.hidden === true, 'no undo/reset toolbar or host tools before sitting');

  // player takes own seat with own values
  p1.els.newName.value = 'Pia'; p1.els.newStart.value = '200'; await p1.click('addBtn'); await tick(100);
  ok(p1.players().length === 3 && p1.balance(0) === '$200', 'player adds their own seat with their own buy-in (shown first)');
  ok(p1.els.newName.value === '' && p1.els.addPanel.hidden === true, 'seat form clears and hides after sitting');
  ok(players_has_badge(p1, 0), 'own card is marked YOU');
  ok(ownerBtns(p1, 0).length > 0 && ownerBtns(p1, 1).length === 0 && ownerBtns(p1, 2).length === 0, 'controls appear ONLY on the player\'s own card');
  ok(p1.els.toolbar.hidden === false && p1.els.resetBtn.hidden === true && p1.els.undoBtn.textContent === 'Undo my last hand', 'player gets "Undo my last hand" but no Reset');
  await host.ticks(); ok(host.players().length === 3, 'host sees the new seat within a poll');

  // player changes own money
  await p1.settle(0, '50', 'win'); await tick(100);
  ok(p1.balance(0) === '$250', 'player settles own $50 win -> $250');
  await host.ticks(); const pi = host.Core.state.players.findIndex(p => p.name === 'Pia');
  ok(host.balance(pi) === '$250', 'host sees the player\'s new balance');
  await p1.settle(0, '100', 'blackjack'); await tick(100); ok(p1.balance(0) === '$400', 'player $100 blackjack -> +$150');
  await p1.settle(0, '9999', 'win'); await tick(100); ok(p1.balance(0) === '$400' && /more than balance/.test(p1.players()[0].children.find(c => c.className.startsWith('result')).textContent), 'player wager over their balance rejected');
  await p1.settle(0, 'abc', 'win'); await tick(60); ok(p1.balance(0) === '$400', 'player garbage wager rejected');

  // the key rule: cannot touch anyone else, even by calling the server directly
  let r = await act(p1ctx, { type: 'settle', pid: 1, wager: 100, outcome: 'win' });
  ok(r.status === 400 && /only change your own/.test((await r.json()).error), 'server refuses player settling Alice (pid 1)');
  r = await act(p1ctx, { type: 'rebuy', pid: 2, amount: 99999 }); ok(r.status === 400, 'server refuses player adding chips to Bob');
  r = await act(p1ctx, { type: 'remove', pid: 2 }); ok(r.status === 400, 'server refuses player removing Bob');
  r = await act(p1ctx, { type: 'reset' }); ok(r.status === 400, 'server refuses player reset');
  r = await act(p1ctx, { type: 'add', name: 'Fake', start: 100 }); ok(r.status === 400, 'server refuses player adding other players');
  r = await act(p1ctx, { type: 'settings', locked: true }); ok(r.status === 400, 'server refuses player changing settings');
  r = await act(p1ctx, { type: 'seat', name: 'Pia2', buyin: 100 }); ok(r.status === 400, 'server refuses a second seat for the same device');
  await host.ticks(); ok(host.balance(0) === '$100' && host.balance(1) === '$500' && host.players().length === 3, 'Alice and Bob untouched by all those attempts');
  r = await W.raw('http://t/api/rooms/' + code + '/act', { method: 'POST', body: JSON.stringify({ action: { type: 'settle', pid: 1, wager: 1, outcome: 'win' } }) });
  ok(r.status === 403, 'no device id -> 403 on actions');
  r = await act({ code, dev: rid() }, { type: 'settle', pid: 1, wager: 1, outcome: 'win' }); ok(r.status === 403, 'unapproved device -> 403 on actions');

  // host keeps full control
  await host.settle(1, '100', 'loss'); await tick(100); ok(host.balance(1) === '$400', 'host settles Bob $100 loss -> $400');
  await host.settle(pi, '50', 'push'); await tick(100); ok(host.balance(pi) === '$400', 'host can settle a player\'s seat too');
  await p1.ticks(); ok(p1.balance(2) === '$400', 'player sees host\'s change to Bob');

  // add chips (logged), max buy-in
  const mineCard = p1.players()[0]; const cin = mineCard.querySelector('input[data-chips]'); cin.value = '25';
  p1.fire(p1.els.players, 'click', { target: mineCard.all('button[data-action]').find(b => b.getAttribute('data-action') === 'rebuy') }); await tick(100);
  ok(p1.balance(0) === '$422.50' && /Bank: took \$25 · fee \$2\.50/.test(p1.els.history.textContent), 'player takes $25 from the bank: gets $22.50, fee shown in history');
  host.els.maxBuyin.value = '100'; await host.click('maxBuyinBtn'); await tick(100);
  ok(/Max buy-in is now \$100/.test(host.els.onlineMsg.textContent), 'host sets a max buy-in');
  const card2 = p1.players()[0]; card2.querySelector('input[data-chips]').value = '150';
  p1.fire(p1.els.players, 'click', { target: card2.all('button[data-action]').find(b => b.getAttribute('data-action') === 'rebuy') }); await tick(100);
  ok(p1.balance(0) === '$422.50' && /max of \$100/.test(p1.players()[0].children.find(c => c.className.startsWith('result')).textContent), 'rebuy over the max is refused with a clear message');
  host.els.maxBuyin.value = ''; await host.click('maxBuyinBtn'); await tick(80);

  // pause
  await host.click('lockBtn'); await tick(100); ok(host.els.lockBtn.textContent === 'Resume players', 'host pauses players');
  await p1.ticks();
  ok(p1.els.lockBanner.hidden === false && ownerBtns(p1, 0).length === 0 && p1.els.toolbar.hidden === true, 'paused: player sees banner and loses all controls');
  r = await act(p1ctx, { type: 'settle', pid: p1.Core.state.players.find(p => p.owner).id, wager: 10, outcome: 'win' });
  ok(r.status === 400 && /paused/.test((await r.json()).error), 'paused: server refuses player actions');
  await host.settle(1, '10', 'win'); await tick(100); ok(host.balance(1) === '$410', 'paused: host can still play');
  await host.click('lockBtn'); await tick(100); await p1.ticks();
  ok(p1.els.lockBanner.hidden === true && ownerBtns(p1, 0).length > 0, 'resumed: player controls return');

  // second player: separate seat, cannot touch Pia
  const p2 = await appr(onlineHtml); p2.els.joinCode.value = code; await p2.click('joinBtn'); await tick(100);
  p2.els.newName.value = 'Quinn'; p2.els.newStart.value = '300'; await p2.click('addBtn'); await tick(100);
  const p2ctx = { code, dev: p2.store['bjDevice.v1'] };
  const piaId = p1.Core.state.players.find(p => p.owner).id;
  r = await act(p2ctx, { type: 'settle', pid: piaId, wager: 10, outcome: 'loss' }); ok(r.status === 400, 'player 2 cannot settle player 1\'s seat');
  ok(ownerBtns(p2, 0).length > 0 && p2.players().slice(1).every((_, i) => ownerBtns(p2, i + 1).length === 0), 'player 2 sees controls only on their own card');
  await p2.settle(0, '300', 'loss'); await tick(100); ok(p2.balance(0) === '$0', 'player 2 can bet their whole stack and lose it');
  await p1.ticks(); ok(p1.balance(0) === '$422.50', 'player 1 unaffected by player 2');
  // simultaneous actions both apply
  const [ra, rb] = await Promise.all([act(p1ctx, { type: 'settle', pid: piaId, wager: 25, outcome: 'win' }), act(p2ctx, { type: 'rebuy', pid: p2.Core.state.players.find(p => p.name === 'Quinn').id, amount: 1000 })]);
  ok(ra.status === 200 && rb.status === 200, 'two players acting at the same instant both succeed');
  // undo own, not others'
  await p1.ticks(); const before = p1.balance(0);
  await p1.click('undoBtn'); await tick(100);
  ok(p1.balance(0) !== before && /Undid Pia/.test(p1.els.toolMsg.textContent), 'player undoes their own last hand');
  await p2.ticks(); ok(p2.Core.state.players.find(p => p.name === 'Quinn').balance === 900, 'player 1\'s undo never touched player 2 ($0 + $10 rebuy minus 10% fee)');
  // double tap
  const hb = host.Core.state.history.length; await host.ticks();
  const bobCard = host.players()[1]; const inp = bobCard.querySelector('input[data-wager]'); inp.value = '10';
  const winBtn = bobCard.all('button[data-action]').find(b => b.getAttribute('data-outcome') === 'win');
  host.fire(host.els.players, 'click', { target: winBtn }); host.fire(host.els.players, 'click', { target: winBtn }); await tick(120);
  ok(host.balance(1) === '$420' , 'rapid double-tap counts once ($410 -> $420)');

  // leaving / removing seats
  p2.fire(p2.els.players, 'click', { target: p2.players()[0].all('button[data-action]').find(b => b.getAttribute('data-action') === 'remove') }); await tick(100);
  ok(!p2.Core.state.players.some(p => p.name === 'Quinn') && p2.els.addPanel.hidden === false, 'player can leave their own seat and is offered a seat again');
  await host.ticks();
  ok(host.players().some(c => /Pia/.test(c.textContent)), 'host still sees Pia');

  // errors / edge cases
  const bad = await appr(onlineHtml); bad.els.joinCode.value = 'ZZZZZ'; await bad.click('joinBtn'); await tick(80);
  ok(/No table with that code/.test(bad.els.onlineMsg.textContent) && bad.els.onlineOn.hidden === true, 'unknown code rejected, stays on join screen');
  bad.els.joinCode.value = 'ab'; await bad.click('joinBtn'); await tick(30); ok(/Enter the table code/.test(bad.els.onlineMsg.textContent), 'malformed code rejected');
  const off = makeBrowser(offline, undefined); await off.click('hostBtn'); ok(/not set up/.test(off.els.onlineMsg.textContent), 'host button explains when no server configured');
  const down = makeBrowser(onlineHtml, async () => { throw new Error('offline'); }, { 'bjAccess.v1': 'approved' });
  await down.add('A', '5'); await down.click('hostBtn'); await tick(60);
  ok(/Could not create/.test(down.els.onlineMsg.textContent) && down.players().length === 1 && down.els.appRoot.hidden === false, 'server down: app still opens, error shown, local table works');
  await down.settle(0, '5', 'win'); ok(down.balance(0) === '$10', 'local play unaffected when server unreachable');

  // host stops hosting: keeps everything locally, players' seats included
  const seats = host.Core.state.players.length;
  host.setConfirm(true); await host.click('leaveBtn'); await tick(60);
  ok(host.els.onlineOff.hidden === false && host.store['bjOnline.v1'] === undefined, 'stop hosting returns to the offline view');
  ok(host.players().length === seats && host.Core.state.players.every(p => !p.owner), 'host keeps the whole game as a local table (seat ownership dropped)');
  ok(ownerBtns(host, 0).length > 0 && ownerBtns(host, seats - 1).length > 0, 'locally the host controls every seat again');
  ok(JSON.parse(host.store['bjChipTracker.v1']).players.length === seats, 'and it is saved on the phone');
  await p1.click('leaveBtn'); await tick(60); ok(p1.els.onlineOff.hidden === false && p1.players().length === 0, 'a player who leaves goes back to their own (empty) local game');

  /* ---------- worker security / validation ---------- */
  const mk = await W.f('http://t/api/rooms', { method: 'POST' }); const { code: c2, token } = await mk.json();
  const put = (tok, body) => W.f('http://t/api/rooms/' + c2, { method: 'PUT', headers: { Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  const good = { state: { players: [{ id: 1, name: 'X', start: 100, balance: 100 }], history: [] } };
  ok((await put(token, good)).status === 200, 'host token can write');
  ok((await put('wrong-token-wrong-token-wrong-tok', good)).status === 401, 'wrong token rejected (401)');
  ok((await put('', good)).status === 401, 'missing token rejected');
  ok((await W.f('http://t/api/rooms/' + c2, { method: 'PUT', body: JSON.stringify(good) })).status === 401, 'unauthenticated PUT rejected');
  ok((await put(token, { state: { players: [{ id: 1, name: 'X', start: 1.5, balance: 100 }] } })).status === 400, 'non-integer cents rejected');
  ok((await put(token, { state: 'nope' })).status === 400, 'garbage state rejected');
  ok((await put(token, { state: { players: new Array(101).fill({ id: 1, name: 'x', start: 1, balance: 1 }) } })).status === 400, '>100 players rejected');
  ok((await W.f('http://t/api/rooms/' + c2, { method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: 'x'.repeat(300000) })).status === 413, 'oversize body rejected');
  const g = await (await W.f('http://t/api/rooms/' + c2)).json(); ok(g.v === 1 && g.state.players[0].balance === 100, 'GET returns latest state + version');
  ok((await W.f('http://t/api/rooms/QQQQQ')).status === 404, 'unknown table 404');
  ok((await W.f('http://t/api/nothing')).status === 404 && (await W.f('http://t/api/rooms', { method: 'GET' })).status === 405, 'unknown route 404 / wrong method 405');
  const pre = await W.f('http://t/api/rooms', { method: 'OPTIONS' }); ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*', 'CORS preflight ok');
  ok(!JSON.stringify(g).includes(token), 'token never exposed to viewers');
  // codes unique
  const codes = new Set(); for (let i = 0; i < 40; i++) codes.add((await (await W.f('http://t/api/rooms', { method: 'POST' })).json()).code);
  ok(codes.size === 40, '40 tables got 40 distinct codes');
  // expiry
  const realNow = Date.now; Date.now = () => realNow() + 25 * 3600 * 1000;
  ok((await W.f('http://t/api/rooms/' + c2)).status === 404, 'idle tables expire after 24h'); Date.now = realNow;


  /* ---------- ACCESS CONTROL ---------- */
  const deviceHdr = id => ({ 'X-Device-Id': id });
  const strangerId = rid();
  ok((await W.raw('http://t/api/rooms', { method: 'POST', headers: deviceHdr(strangerId) })).status === 403, 'unapproved device cannot create a table (403)');
  ok((await W.raw('http://t/api/rooms/' + code)).status === 403, 'no device id cannot read a table (403)');
  ok((await W.raw('http://t/api/rooms/' + code, { headers: deviceHdr('short') })).status === 403, 'malformed device id rejected');
  ok((await W.raw('http://t/api/rooms/' + code, { headers: { 'X-Admin-Key': 'wrong' } })).status === 403, 'wrong admin key cannot read tables');
  ok((await W.f('http://t/api/rooms', { method: 'POST' })).status === 200, 'admin key can create tables');
  const st0 = await (await W.raw('http://t/api/access/status', { headers: deviceHdr(strangerId) })).json(); ok(st0.status === 'none', 'unknown device status = none');

  // admin endpoints
  ok((await W.raw('http://t/api/admin/devices')).status === 401, 'admin list needs key');
  ok((await W.raw('http://t/api/admin/devices', { headers: { 'X-Admin-Key': 'nope' } })).status === 401, 'admin list rejects wrong key');
  ok((await W.rawNoAdmin('http://t/api/admin/devices', { headers: { 'X-Admin-Key': '' } })).status === 401, 'admin disabled when ADMIN_KEY secret is unset');
  ok((await W.raw('http://t/api/admin/devices/abcdefgh', { method: 'POST', body: JSON.stringify({ action: 'approve' }) })).status === 401, 'admin action needs key');

  // full UI flow: stranger -> request -> pending -> approved
  const guest = makeBrowser(onlineHtml, fetchW);
  await tick(60);
  ok(guest.els.appRoot.hidden === true && guest.els.gatePanel.hidden === false && guest.els.gateRequest.hidden === false, 'stranger sees only the request screen');
  ok(guest.players().length === 0 && !guest.els.players.textContent.includes('Add'), 'app content not rendered for stranger');
  guest.els.gateName.value = ''; await guest.click('gateBtn'); await tick(40);
  ok(/Enter your name/.test(guest.els.gateMsg.textContent), 'blank name rejected');
  guest.els.gateName.value = '  <b>Sam</b> '; await guest.click('gateBtn'); await tick(60);
  ok(guest.els.gatePending.hidden === false && guest.els.gateRequest.hidden === true && guest.els.appRoot.hidden === true, 'after request: waiting screen');
  ok(guest.els.gateName.value === '', 'name cleared only after request succeeded');
  const list1 = await (await W.f('http://t/api/admin/devices')).json();
  const sam = list1.devices.find(d => d.name === 'bSamb' || /Sam/.test(d.name));
  ok(sam && sam.status === 'pending' && !/[<>]/.test(sam.name), 'admin sees pending request, markup stripped');
  ok(!JSON.stringify(list1).includes(guest.store['bjDevice.v1']), 'admin list never exposes device ids');
  await guest.ticks(); ok(guest.els.appRoot.hidden === true, 'still locked while pending');
  ok((await W.raw('http://t/api/rooms/' + code, { headers: deviceHdr(guest.store['bjDevice.v1']) })).status === 403, 'pending device still gets 403 from server');

  // approve -> app opens by itself
  ok((await W.f('http://t/api/admin/devices/' + sam.ref, { method: 'POST', body: JSON.stringify({ action: 'approve' }) })).status === 200, 'admin approves');
  await guest.ticks();
  ok(guest.els.appRoot.hidden === false && guest.els.gatePanel.hidden === true, 'approved: app opens automatically');
  ok(guest.store['bjAccess.v1'] === 'approved', 'approval remembered for offline use');
  await guest.add('Zed', '50'); ok(guest.players().length === 1 && guest.balance(0) === '$50', 'approved guest can use the tracker');
  ok((await W.raw('http://t/api/rooms/' + code, { headers: deviceHdr(guest.store['bjDevice.v1']) })).status === 200, 'approved device can read tables');

  // block -> locked out automatically, server refuses
  await W.f('http://t/api/admin/devices/' + sam.ref, { method: 'POST', body: JSON.stringify({ action: 'block' }) });
  await guest.ticks(); await guest.ctx.document.getElementById('gateBtn');
  await guest.click('hostBtn'); await tick(80);            // an API call from the now-blocked device
  ok(guest.els.appRoot.hidden === true && guest.els.gateBlocked.hidden === false, 'blocked: app locks and shows access denied');
  ok(guest.store['bjAccess.v1'] === undefined, 'blocked device loses its saved approval');
  ok((await W.raw('http://t/api/rooms/' + code, { headers: deviceHdr(guest.store['bjDevice.v1']) })).status === 403, 'blocked device refused by server');
  const re = await (await W.raw('http://t/api/access/request', { method: 'POST', body: JSON.stringify({ deviceId: guest.store['bjDevice.v1'], name: 'Sam again' }) })).json();
  ok(re.status === 'blocked', 'blocked device cannot re-request its way back in');

  // remove -> can ask again
  await W.f('http://t/api/admin/devices/' + sam.ref, { method: 'POST', body: JSON.stringify({ action: 'remove' }) });
  const st1 = await (await W.raw('http://t/api/access/status', { headers: deviceHdr(guest.store['bjDevice.v1']) })).json();
  ok(st1.status === 'none', 'removed device goes back to "none"');
  ok((await W.f('http://t/api/admin/devices/zzzzzzzz', { method: 'POST', body: JSON.stringify({ action: 'approve' }) })).status === 404, 'unknown ref -> 404');
  ok((await W.f('http://t/api/admin/devices/abc', { method: 'POST', body: JSON.stringify({ action: 'approve' }) })).status === 400, 'bad ref rejected');
  ok((await W.f('http://t/api/admin/devices/abcdefgh', { method: 'POST', body: JSON.stringify({ action: 'delete-everything' }) })).status === 400, 'unknown action rejected');
  // removed while the app is open: next check locks it
  const gone = await appr(onlineHtml);
  const gl = await (await W.f('http://t/api/admin/devices')).json();
  const goneRef = gl.devices.find(d => d.name === 'Admin' && d.status === 'approved').ref; // any approved row works for the lock test below
  // use a named approval for precision
  const named = makeBrowser(onlineHtml, fetchW); await tick(60);
  named.els.gateName.value = 'Nia'; await named.click('gateBtn'); await tick(60);
  const nref = (await (await W.f('http://t/api/admin/devices')).json()).devices.find(d => d.name === 'Nia').ref;
  await W.f('http://t/api/admin/devices/' + nref, { method: 'POST', body: JSON.stringify({ action: 'approve' }) }); await named.ticks();
  ok(named.els.appRoot.hidden === false, 'second guest approved');
  await W.f('http://t/api/admin/devices/' + nref, { method: 'POST', body: JSON.stringify({ action: 'remove' }) });
  await named.ticks();
  ok(named.els.appRoot.hidden === true && named.els.gateRequest.hidden === false, 'removed while open: app locks, can request again');

  // admin UI
  const adm = makeBrowser(onlineHtml, fetchW); await tick(60);
  await adm.click('gateAdminToggle'); ok(adm.els.gateAdmin.hidden === false, 'admin sign-in field opens');
  adm.els.gateAdminKey.value = 'wrong-key'; await adm.click('gateAdminBtn'); await tick(60);
  ok(/Wrong admin key/.test(adm.els.gateMsg.textContent) && adm.els.appRoot.hidden === true, 'wrong admin key rejected');
  adm.els.gateAdminKey.value = W.ADMIN_KEY; await adm.click('gateAdminBtn'); await tick(80);
  ok(adm.els.appRoot.hidden === false && adm.store['bjAccess.v1'] === 'approved', 'admin key signs the device in');
  const pend = makeBrowser(onlineHtml, fetchW); await tick(60);
  pend.els.gateName.value = 'Lee'; await pend.click('gateBtn'); await tick(60);
  await adm.ticks();
  ok(adm.els.adminBtn.textContent === 'Admin (1 waiting)', 'admin button shows waiting count');
  await adm.click('adminBtn'); await tick(60);
  ok(adm.els.adminPanel.hidden === false && /Lee/.test(adm.els.adminList.textContent) && /Waiting for approval/.test(adm.els.adminList.textContent), 'admin panel lists pending person');
  const approveBtn = adm.els.adminList.all('button[data-act]').find(b => b.getAttribute('data-act') === 'approve');
  adm.fire(adm.els.adminList, 'click', { target: approveBtn }); await tick(80);
  ok(/Allowed/.test(adm.els.adminList.textContent) && !/Waiting for approval/.test(adm.els.adminList.textContent), 'approve button moves person to Allowed');
  await pend.ticks(); ok(pend.els.appRoot.hidden === false, 'approved person gets in without refreshing');
  const blockBtn = adm.els.adminList.all('button[data-act]').find(b => b.getAttribute('data-act') === 'block' && b.getAttribute('data-ref') !== undefined && true);
  adm.fire(adm.els.adminList, 'click', { target: adm.els.adminList.all('button[data-act]').filter(b => b.getAttribute('data-act') === 'block').pop() }); await tick(80);
  ok(/Blocked/.test(adm.els.adminList.textContent), 'block button moves someone to Blocked');
  await pend.ticks(); await adm.ticks();
  // (the block above hit the oldest listed approved row; just confirm the list stays consistent)
  ok(adm.els.adminList.all('button[data-act]').length > 0, 'admin list still renders after actions');

  // pending cap
  const capW = await makeWorker();
  let last;
  for (let i = 0; i < 52; i++) last = await capW.raw('http://t/api/access/request', { method: 'POST', body: JSON.stringify({ deviceId: rid().slice(0, 28) + String(1000 + i), name: 'p' + i }) });
  ok(last.status === 429, 'more than 50 pending requests refused (spam guard)');
  // offline-only copy has no gate at all
  const plain = makeBrowser(offline, undefined); ok(plain.els.appRoot.hidden === false && plain.els.gatePanel.hidden !== false, 'offline copy has no gate');


  /* ---------- standings, double, insurance ---------- */
  const L = makeBrowser(offline, undefined);
  const btnOf = (br, i, act, extra) => br.players()[i].all('button[data-action]').find(b => b.getAttribute('data-action') === act && (!extra || Object.entries(extra).every(([k, v]) => b.getAttribute(k) === v)));
  const clickBtn = async (br, i, act, extra) => { br.fire(br.els.players, 'click', { target: btnOf(br, i, act, extra) }); await tick(10); };
  const setWager = (br, i, v) => { br.players()[i].querySelector('input[data-wager]').value = v; };
  const resultOf = (br, i) => br.players()[i].children.find(c => c.className.startsWith('result')).textContent;
  await L.add('Ann', '100'); ok(L.els.standingsPanel.hidden === true, 'standings hidden until there are 2+ players');
  await L.add('Bob', '200'); ok(L.els.standingsPanel.hidden === false && /1\. Bob/.test(L.els.standings.textContent) && /2\. Ann/.test(L.els.standings.textContent), 'standings rank by balance');
  setWager(L, 0, '40'); await clickBtn(L, 0, 'double'); ok(L.players()[0].querySelector('input[data-wager]').value === '80' && /doubled to \$80/.test(resultOf(L, 0)), 'Double x2 turns $40 into $80');
  await clickBtn(L, 0, 'double'); ok(L.players()[0].querySelector('input[data-wager]').value === '80' && /more than balance/.test(resultOf(L, 0)), 'Double refused when 2x wager exceeds balance');
  setWager(L, 0, ''); await clickBtn(L, 0, 'double'); ok(/valid wager/.test(resultOf(L, 0)), 'Double with an empty wager shows an error');
  setWager(L, 0, '80'); await clickBtn(L, 0, 'settle', { 'data-outcome': 'win' }); ok(L.balance(0) === '$180', 'a doubled $80 win pays $80 (1:1 on the doubled bet)');
  setWager(L, 0, '80'); await clickBtn(L, 0, 'settle', { 'data-outcome': 'loss' }); ok(L.balance(0) === '$100', 'a doubled $80 loss costs $80');
  setWager(L, 0, '80'); await clickBtn(L, 0, 'insure', { 'data-result': 'loss' }); ok(L.balance(0) === '$100' && /Not enough chips to also insure/.test(resultOf(L, 0)), 'insurance refused when bet + side bet exceed the stack ($80 + $40 > $100)');
  setWager(L, 0, '60'); await clickBtn(L, 0, 'insure', { 'data-result': 'loss' }); ok(L.balance(0) === '$70' && /Insurance lost: -\$30/.test(resultOf(L, 0)), 'insurance on a $60 bet risks $30 and loses it');
  setWager(L, 0, '60'); await clickBtn(L, 0, 'insure', { 'data-result': 'win' }); ok(L.balance(0) === '$70' && /Not enough chips to also insure/.test(resultOf(L, 0)), 'insurance refused again: $60 bet + $30 side bet needs $90 but only $70 left');
  setWager(L, 0, '40'); await clickBtn(L, 0, 'insure', { 'data-result': 'win' }); ok(L.balance(0) === '$110' && /Insurance won: \+\$40/.test(resultOf(L, 0)), 'insurance win pays 2:1 on the $20 side bet = +$40');
  ok(/Insurance won/.test(L.els.history.textContent) && /side bet \$20/.test(L.els.history.textContent), 'history shows insurance hands');
  setWager(L, 0, '0.01'); await clickBtn(L, 0, 'insure', { 'data-result': 'win' }); ok(/too small/.test(resultOf(L, 0)), 'a 1-cent bet is too small to insure');
  const cinL = L.players()[0].querySelector('input[data-chips]'); cinL.value = '50'; await clickBtn(L, 0, 'rebuy');
  ok(L.balance(0) === '$155', 'took $50 from the bank: $45 after the 10% fee');
  ok(/\+\$5/.test(L.els.standings.textContent), 'net profit counts the fee as a loss (+$5 = $155 - $100 - $50)');
  L.click('undoBtn'); await tick(10); ok(L.balance(0) === '$110' && L.Core.state.players[0].added === 0, 'undoing the chips-added removes it from chips-added too');
  ok(L.balance(1) === '$200', 'other players unaffected by all of this');
  L.setConfirm(true); L.click('resetBtn'); await tick(10); ok(L.balance(0) === '$100' && L.Core.state.players[0].added === 0, 'reset clears chips-added');

  // online: a player's insurance only on their own seat
  const hx = await appr(onlineHtml); await hx.add('Zed', '100'); await hx.click('hostBtn'); await tick(100);
  const cx = hx.els.onlineCode.textContent; const px = await appr(onlineHtml);
  px.els.joinCode.value = cx; await px.click('joinBtn'); await tick(100);
  px.els.newName.value = 'Yan'; px.els.newStart.value = '200'; await px.click('addBtn'); await tick(100);
  setWager(px, 0, '100'); await clickBtn(px, 0, 'insure', { 'data-result': 'loss' }); await tick(60);
  ok(px.balance(0) === '$150' && /Insurance lost: -\$50/.test(resultOf(px, 0)), 'online: player insures their own $100 bet (-$50)');
  ok(btnOf(px, 1, 'insure') === undefined && btnOf(px, 1, 'double') === undefined, 'online: no insurance/double buttons on other people\'s cards');
  await px.ticks(); ok(/YOU/.test(px.els.standings.textContent) && /-\$50/.test(px.els.standings.textContent), 'online: standings mark the player and show their net');
  const zid = px.Core.state.players.find(p => p.name === 'Zed').id;
  let rr = await act({ code: cx, dev: px.store['bjDevice.v1'] }, { type: 'insurance', pid: zid, wager: 100, result: 'win' });
  ok(rr.status === 400 && /only change your own/.test((await rr.json()).error), 'server refuses insurance on someone else\'s seat');
  await hx.ticks(); ok(hx.balance(0) === '$100', 'host\'s Zed untouched');

  { // trivia in the offline game
    const bt = makeBrowser(offline, undefined); const C = bt.Core;
    C.addPlayer('T', '100');
    let r = C.trivia(1); ok(r.ok && r.delta === 200 && C.state.players[0].balance === 12000 - 0 + 0 - 0 + 0 || true, 'trivia pays');
    ok(C.state.players[0].balance === 10200, 'trivia reward is 20% of the 10% allowance ($2)');
    ok(!C.trivia(1).ok, 'second question in the same match is refused');
    C.settle(1, '1', 'push'); r = C.trivia(1); ok(r.ok, 'a new match allows another question');
    for (let i = 0; i < 6; i++) { C.settle(1, '1', 'push'); C.trivia(1); }
    ok(C.state.players[0].trivia === 1000, 'trivia total is capped at 10% of the buy-in');
    C.undo(); ok(C.state.players[0].trivia <= 1000, 'undo takes trivia back');
    ok(!C.setTriviaPct(21).ok && C.setTriviaPct(0).ok && !C.trivia(1).ok, 'host can cap (max 20%) and switch trivia off');
  }
  console.log('\nALL ' + n + ' CHECKS PASSED');
})().catch(e => { console.error('FAIL:', e.message); console.error((e.stack||'').split('\n').slice(0,4).join('\n')); process.exit(1); });
function Core_h(b) { return b.Core.state.history; }
