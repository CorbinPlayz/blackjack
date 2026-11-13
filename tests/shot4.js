const {chromium}=require('playwright');
const fs=require('fs');
const html='/home/claude/blackjack/index.html';
(async()=>{
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const p=await ctx.newPage(); const errs=[];
p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&!/net::|Failed to load|ERR_/.test(m.text())&&errs.push(m.text()));
const REFME='MEMEMEME', REFB='BBBBBBBB';
let table={players:[
 {id:1,name:'Cam',start:10000,balance:12500,added:0,takes:0,bet:0,hand:2000,doubled:false,out:false,trivia:0,triviaAt:-1,vin:0,vout:0,owner:REFME},
 {id:2,name:'Jordan',start:10000,balance:7000,added:0,takes:1,bet:1000,hand:0,doubled:false,out:false,trivia:0,triviaAt:-1,vin:0,vout:0,owner:REFB},
 {id:3,name:'Riley',start:5000,balance:5000,added:0,takes:0,bet:0,hand:0,doubled:false,out:false,trivia:0,triviaAt:-1,vin:0,vout:0,owner:'CCCCCCCC'}],
 history:[{id:1,pid:1,name:'Cam',outcome:'win',wager:2500,delta:2500},{id:2,pid:2,name:'Jordan',outcome:'loss',wager:3000,delta:-3000}],
 nextId:4,nextHid:3,round:{n:2,phase:'playing'},dealer:'',dealerReq:'BBBBBBBB',
 settings:{locked:false,maxBuyin:0,bankFee:10,bankLimit:3,triviaPct:10,rounds:true}};
await p.route('**/api/**',async r=>{
 const u=r.request().url(); const j=o=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(o)});
 if(u.includes('/access/status')) return j({status:'approved',ref:REFME});
 if(u.includes('/admin/devices')) return j({devices:[
  {ref:'AAAAAAAA',name:'Taylor Smith',email:'taylor.smith@gmail.com',status:'pending',requested:3},
  {ref:'BBBBBBBB',name:'Jordan',email:'jordan@gmail.com',status:'approved',requested:2},
  {ref:'CCCCCCCC',name:'Riley (name request)',status:'approved',requested:1},
  {ref:'DDDDDDDD',name:'Spammer',status:'blocked',requested:0}]});
 if(u.includes('/api/vault')) return j({balance:4200});
 if(u.includes('/api/rooms/')) return j({v:5,state:table});
 return j({});});
await p.addInitScript(()=>{localStorage.setItem('bjDevice.v1','a'.repeat(32));localStorage.setItem('bjAccess.v1','approved');
 localStorage.setItem('bjRef.v1','MEMEMEME');localStorage.setItem('bjName.v1','Cam');
 localStorage.setItem('bjOnline.v1',JSON.stringify({role:'viewer',code:'ABCDE',token:null}));
 localStorage.setItem('bjAdminKey.v1','k');});
await p.goto('file://'+html); await p.waitForTimeout(1500);
for(const t of ['table','board','me','admin']){ await p.click('#nav button[data-go='+t+']'); await p.waitForTimeout(500); await p.screenshot({path:'t_'+t+'.png',fullPage:false}); }
const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
console.log('horizontal overflow:',overflow,'| errors:',JSON.stringify(errs));
await b.close();})();
