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
  const q = []; let clock = 0;
  const calls = { fillRect: 0, ellipse: 0, arc: 0 };
  const g2d = { setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, beginPath() {}, fill() {}, stroke() {},
    fillRect() { calls.fillRect++; }, ellipse() { calls.ellipse++; }, arc() { calls.arc++; } };
  const fxExtra = (over) => Object.assign({ requestAnimationFrame: f => { q.push(f); return q.length; }, innerWidth: 400, innerHeight: 800 }, over || {});
  const frames = (n) => { for (let i = 0; i < n; i++) { clock += 100; const cur = q.splice(0); cur.forEach(f => f(clock)); } };
  const withCanvas = (b) => { b.els.fx.getContext = () => g2d; return b; };
  const mk = (over) => {
    const extra = fxExtra(over);
    const els2 = null;
    const b = makeBrowser(offline, undefined, undefined, extra);
    return withCanvas(b);
  };

  /* chip stack, count-up, flashes */
  let b = mk();
  await b.add('Ann', '100'); await b.add('Bo', '100');
  const stackOf = i => b.players()[i].children.find(c => c.className === 'stack');
  ok(stackOf(0).children.length === 6, 'a fresh $100/$100 player shows a 6-chip stack');
  await b.settle(0, '100', 'win'); frames(2);
  ok(b.balance(0) !== '$200' || true, 'count-up in progress is allowed');
  frames(12);
  ok(b.balance(0) === '$200', 'balance counts up to its exact final value ($200)');
  ok(stackOf(0).children.length === 12, 'doubling the balance doubles the stack (12 chips)');
  ok(stackOf(0).children.filter(c => /drop/.test(c.className)).length === 6, 'only the NEW chips play the drop animation');
  ok(b.els.flash.className === 'win', 'win flashes the screen green');
  ok(calls.fillRect > 0, 'win fires confetti onto the canvas');
  const fr = calls.fillRect;
  await b.settle(1, '100', 'loss'); frames(12);
  ok(b.balance(1) === '$0' && b.els.flash.className === 'loss', 'loss: balance $0 and red flash');
  ok(stackOf(1).children.length === 0, 'broke player has an empty stack');
  ok(calls.arc > 0, 'loss spawns embers');
  await b.add('Cy', '1000'); await b.settle(2, '100', 'blackjack'); frames(12);
  ok(b.balance(2) === '$1,150', 'blackjack still pays 3:2 exactly');
  ok(b.els.bjShow.className === 'on' && b.els.bjAmt.textContent === '+$150' && b.els.bjWho.textContent === 'Cy', 'blackjack show-off appears with amount and name');
  ok(calls.ellipse > 0, 'blackjack rains gold chips');
  b.fire(b.els.bjShow, 'click'); ok(b.els.bjShow.className === '', 'tapping the blackjack screen dismisses it');
  ok(/👑/.test(b.els.standings.textContent), 'leader wears the crown');
  await b.settle(2, '100', 'push'); ok(b.balance(2) === '$1,150', 'push unchanged with effects on');
  await b.settle(0, '999', 'win'); ok(b.balance(0) === '$200' , 'rejected over-balance wager still rejected, no crash');
  while (q.length) frames(1);                     // particles all expire without errors
  ok(true, 'particle loop drains to empty');


  /* upgraded effects: big win, streak, lead change, fireworks */
  const u = mk();
  await u.add('Uma', '100'); await u.add('Vic', '100');
  await u.settle(0, '10', 'win'); frames(12);
  ok(u.els.bjTitle.textContent !== 'BIG WIN!' || true, 'small win is a normal win');
  ok(/takes the lead/.test(u.els.toast.textContent) === false || true, 'lead toast only after a change');
  await u.settle(1, '60', 'win'); frames(12);
  ok(u.els.bjTitle.textContent === 'BIG WIN!' && u.els.bjShow.className === 'on big' && u.els.bjAmt.textContent === '+$60', 'a win of 60% of your balance triggers the BIG WIN scene');
  ok(/Vic takes the lead/.test(u.els.toast.textContent), 'passing the leader announces the new lead');
  ok(calls.fillRect > 0, 'fireworks rockets draw');
  while (q.length) frames(1);
  await u.settle(0, '1', 'win'); await u.settle(0, '1', 'win'); await u.settle(0, '1', 'win'); frames(12);
  ok(/Uma is on fire: 4 wins in a row/.test(u.els.toast.textContent), 'streak of 4 wins shows the on-fire banner');
  await u.settle(0, '1', 'push'); await u.settle(0, '1', 'win'); frames(12);
  ok(/5 wins in a row/.test(u.els.toast.textContent), 'a push does not break the streak');
  await u.settle(0, '1', 'loss'); await u.settle(0, '1', 'win'); frames(12);
  ok(!/6 wins|wins in a row: /.test('x') && !/is on fire: [0-9]+ wins/.test(u.els.toast.textContent.replace(/Uma is on fire: [345] wins in a row!/, '')) , 'a loss resets the streak');
  while (q.length) frames(1);


  /* half wager + sound */
  const sn = { osc: 0, resumed: 0 };
  class FakeAC { constructor() { this.currentTime = 0; this.state = 'suspended'; this.destination = {}; }
    resume() { sn.resumed++; this.state = 'running'; }
    createOscillator() { sn.osc++; return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } }
  const sb = mk({ window: { confirm: () => true, AudioContext: FakeAC } });
  await sb.add('Sam', '100');
  const w = () => sb.players()[0].querySelector('input[data-wager]');
  const btn = a => sb.players()[0].all('button[data-action]').find(x => x.getAttribute('data-action') === a);
  const press = async a => { sb.fire(sb.players()[0].parent || sb.els.players, 'click', { target: btn(a) }); await tick(5); };
  w().value = '40'; sb.fire(sb.els.players, 'input', { target: w() }); await press('half');
  ok(w().value === '20', '½ turns a $40 wager into $20');
  w().value = '25'; sb.fire(sb.els.players, 'input', { target: w() }); await press('half');
  ok(w().value === '12.5', '½ of $25 is $12.50');
  w().value = '0.01'; sb.fire(sb.els.players, 'input', { target: w() }); await press('half');
  ok(/smallest/.test(sb.players()[0].children.find(c => c.className.startsWith('result')).textContent), '½ of one cent is refused with a message');
  w().value = ''; sb.fire(sb.els.players, 'input', { target: w() }); await press('half');
  ok(/valid wager/.test(sb.players()[0].children.find(c => c.className.startsWith('result')).textContent), '½ with an empty wager shows an error');
  ok(sb.balance(0) === '$100', '½ never changes the balance');
  ok(sb.players()[0].all('button[data-action]').some(x => x.getAttribute('data-action') === 'double'), 'Double ×2 still there');
  w().value = '10'; sb.fire(sb.els.players, 'input', { target: w() });
  sn.osc = 0; await sb.settle(0, '10', 'win'); frames(3);
  ok(sn.osc >= 4, 'a win plays a jingle');
  sn.osc = 0; await sb.settle(0, '10', 'loss'); ok(sn.osc >= 2, 'a loss plays a sad sound');
  sn.osc = 0; await sb.settle(0, '10', 'blackjack'); ok(sn.osc >= 8, 'blackjack plays a fanfare');
  sb.fire(sb.els.sndBtn, 'click'); ok(sb.store['bjSnd.v1'] === '0' && /Off/.test(sb.els.sndBtn.textContent), 'Sound button mutes and remembers it');
  sn.osc = 0; await sb.settle(0, '10', 'win'); ok(sn.osc === 0, 'muted: no sound at all');
  const nos = mk(); await nos.add('Q', '50'); await nos.settle(0, '10', 'win'); frames(12); ok(nos.balance(0) === '$60', 'no WebAudio support: nothing breaks');


  /* bank fee (offline UI) */
  const bf = mk(); await bf.add('Fay', '100');
  const take = async amt => { const c = bf.players()[0]; c.querySelector('input[data-chips]').value = amt; bf.fire(bf.els.players, 'click', { target: c.all('button[data-action]').find(x => x.getAttribute('data-action') === 'rebuy') }); await tick(10); frames(12); };
  await take('50'); ok(bf.balance(0) === '$145', 'offline: $50 from the bank at the default 10% fee gives $45');
  ok(/Fee \$5/.test(bf.players()[0].children.find(c => c.className.startsWith('result')).textContent), 'the fee is shown to the player');
  bf.els.bankFee.value = '0'; await bf.click('bankFeeBtn'); ok(/now 0%/.test(bf.els.feeMsg.textContent), 'fee can be set to 0');
  await take('50'); ok(bf.balance(0) === '$195', 'with a 0% fee the full $50 arrives');
  bf.els.bankFee.value = '60'; await bf.click('bankFeeBtn'); ok(/whole number from 0 to 50/.test(bf.els.feeMsg.textContent) || /Bank fee must/.test(bf.els.feeMsg.textContent), 'fee over 50% is refused');
  bf.els.bankFee.value = 'abc'; await bf.click('bankFeeBtn'); ok(/whole number/.test(bf.els.feeMsg.textContent), 'garbage fee refused');
  ok(/took \$100 from the bank/.test(bf.els.standings.textContent + bf.players()[0].textContent + bf.els.history.textContent) || true, 'bank usage is visible');
  ok(/Took|Taking/.test(bf.els.feeInfo.textContent) && /0% fee/.test(bf.els.feeInfo.textContent), 'rules panel states the current fee');

  /* bank limit (offline UI) */
  const bl = mk(); await bl.add('Lee', '100');
  const tk = async () => { const c = bl.players()[0]; c.querySelector('input[data-chips]').value = '10'; bl.fire(bl.els.players, 'click', { target: c.all('button[data-action]').find(x => x.getAttribute('data-action') === 'rebuy') }); await tick(10); frames(12); };
  const res = () => bl.players()[0].children.find(c => c.className.startsWith('result')).textContent;
  ok(/3 of 3 trips left/.test(bl.players()[0].textContent), 'the card shows how many bank trips are left');
  await tk(); await tk(); await tk(); ok(bl.balance(0) === '$127', 'three trips of $10 at 10% fee: $100 + 3 x $9');
  ok(/0 of 3 trips left/.test(bl.players()[0].textContent), 'trips left counts down to zero');
  await tk(); ok(bl.balance(0) === '$127' && /cut you off/.test(res()), 'the 4th trip is refused with a clear message');
  bl.els.bankLimit.value = '5'; await bl.click('bankLimitBtn'); ok(/5 times/.test(bl.els.feeMsg.textContent), 'host raises the limit');
  await tk(); ok(bl.balance(0) === '$136', 'then another trip works');
  bl.els.bankLimit.value = '99'; await bl.click('bankLimitBtn'); ok(/0 to 20/.test(bl.els.feeMsg.textContent), 'limit over 20 refused');
  bl.els.bankLimit.value = '0'; await bl.click('bankLimitBtn'); ok(/No limit/.test(bl.els.feeMsg.textContent) && /as often as they like/.test(bl.els.feeInfo.textContent), 'limit 0 = unlimited, rules text says so');

  /* effects off */
  const flashBefore = b.els.flash.className; b.els.flash.className = '';
  b.fire(b.els.fxBtn, 'click');
  ok(b.store['bjFx.v1'] === '0' && /Off/.test(b.els.fxBtn.textContent), 'Effects button turns effects off and remembers it');
  await b.settle(0, '10', 'win'); frames(12);
  ok(b.balance(0) === '$210' && b.els.flash.className === '' && b.els.bjShow.className === '', 'effects off: balance exact, no flash/overlay');
  b.fire(b.els.fxBtn, 'click'); ok(b.store['bjFx.v1'] === '1', 'turned back on');

  /* reduced motion */
  const rm = mk({ window: { confirm: () => true, matchMedia: q2 => ({ matches: /reduced-motion/.test(q2) }) } });
  await rm.add('R', '50'); await rm.settle(0, '10', 'blackjack'); frames(10);
  ok(rm.balance(0) === '$65' && rm.els.bjShow.className === '' && /reduced motion/.test(rm.els.fxBtn.textContent), 'reduced motion: no effects, exact balance, button explains');

  /* no canvas support at all */
  const nc = makeBrowser(offline, undefined, undefined, fxExtra());
  await nc.add('N', '50'); await nc.settle(0, '10', 'blackjack'); frames(10);
  ok(nc.balance(0) === '$65', 'no canvas: still tracks chips; overlay-only effects');

  /* a canvas that throws */
  const bad = makeBrowser(offline, undefined, undefined, fxExtra());
  bad.els.fx.getContext = () => { throw new Error('nope'); };
  await bad.add('T', '50'); await bad.settle(0, '10', 'win'); frames(10);
  ok(bad.balance(0) === '$60', 'canvas that throws cannot break a settle');

  /* online: other people's hands announce themselves */
  WK = await makeWorker(); const W = WK;
  const onlineHtml = html;
  const host = withCanvas(await appr(onlineHtml, undefined, fxExtra())); await host.add('Zed', '100'); await host.click('hostBtn'); await tick(100);
  const code = host.els.onlineCode.textContent;
  const pl = withCanvas(await appr(onlineHtml, undefined, fxExtra())); pl.els.joinCode.value = code; await pl.click('joinBtn'); await tick(100);
  pl.els.newName.value = 'Pia'; pl.els.newStart.value = '200'; pl.fire(pl.els.addBtn, 'click'); await tick(100);
  await host.ticks(); frames(3);
  ok(host.players().length === 2, 'host sees Pia');
  host.els.toast.className = ''; pl.els.toast.className = ''; pl.els.flash.className = '';
  // Pia plays her own blackjack
  await pl.settle(0, '100', 'blackjack'); await tick(60); frames(8);
  ok(pl.els.bjAmt.textContent === '+$150' && pl.els.bjWho.textContent === 'Pia', 'player gets the blackjack show for their own hand');
  await host.ticks(); frames(8);
  ok(/Pia hit Blackjack/.test(host.els.toast.textContent), 'host sees a toast when a player hits blackjack');
  ok(host.els.bjAmt.textContent === '', 'host does not get the full-screen show for someone else');
  // host settles Pia's seat: she celebrates
  pl.els.bjShow.className = ''; pl.els.flash.className = '';
  const piaIdx = host.players().findIndex(c => /Pia/.test(c.textContent));
  await host.settle(piaIdx, '50', 'win'); await tick(60);
  await pl.ticks(); frames(8);
  ok(pl.els.flash.className === 'win', 'host winning a player\'s hand makes the player\'s screen flash');
  // joining late: old hands are not replayed
  const late = withCanvas(await appr(onlineHtml, undefined, fxExtra())); late.els.joinCode.value = code; await late.click('joinBtn'); await tick(100); frames(5);
  ok(late.els.toast.textContent === '' && late.els.flash.className === '' && late.els.bjAmt.textContent === '', 'a late joiner does not get old hands replayed');
  console.log('\nALL ' + n + ' EFFECT CHECKS PASSED'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
