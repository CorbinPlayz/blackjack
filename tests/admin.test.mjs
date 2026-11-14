import W, {Registry as R} from './w.mjs';
import assert from 'node:assert';
const store=new Map(); const st={storage:{get:async k=>store.get(k),put:async(k,v)=>void store.set(k,v),delete:async k=>void store.delete(k),list:async({prefix})=>new Map([...store].filter(([k])=>k.startsWith(prefix)))}};
const reg=new R(st);
const env={ADMIN_KEY:'secretkey',ADMIN_EMAILS:'Boss@Gmail.com, other@x.com',REGISTRY:{idFromName:()=>1,get:()=>({fetch:(u,o)=>reg.fetch(new Request(u,o))})}};
const call=(path,{method='GET',dev,key,body}={})=>W.fetch(new Request('https://w'+path,{method,headers:{...(dev?{'X-Device-Id':dev}:{}),...(key?{'X-Admin-Key':key}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env).then(async r=>({s:r.status,j:await r.json()}));
const D=c=>c.repeat(32); let n=0; const ok=(x,m)=>{assert.ok(x,m);n++;console.log('PASS',m)};
const rc=(path,body)=>reg.fetch(new Request('https://r'+path,{method:'POST',body:JSON.stringify(body)})).then(r=>r.json());
// legacy name-only approval no longer works
await rc('/request',{deviceId:D('a'),name:'Old'}); const legacy=(await rc('/list')).devices[0]; await rc('/action',{ref:legacy.ref,action:'approve'});
ok((await call('/api/access/status',{dev:D('a')})).j.status==='none','old name-only approval no longer lets anyone in');
ok((await call('/api/access/request',{method:'POST',body:{deviceId:D('a'),name:'x'}})).s===403,'name-only request is refused');
ok((await call('/api/rooms',{method:'POST',dev:D('a')})).s===403,'old device can not use tables');
// google friend: pending until approved
await rc('/google',{deviceId:D('b'),email:'friend@gmail.com',name:'Friend'});
ok((await call('/api/access/status',{dev:D('b')})).j.status==='pending','new Google account waits for approval');
ok((await call('/api/admin/devices',{dev:D('b')})).s===401,'a normal player is not an admin');
// admin by google email (case-insensitive, secret list)
await rc('/google',{deviceId:D('c'),email:'boss@gmail.com',name:'Boss'});
let s=(await call('/api/access/status',{dev:D('c')})).j; ok(s.status==='approved'&&s.admin===true,'admin email is approved at once and flagged admin');
let l=await call('/api/admin/devices',{dev:D('c')}); ok(l.s===200&&l.j.devices.length>=2,'Google admin can open the admin list without a key');
const fr=l.j.devices.find(d=>d.email==='friend@gmail.com');
ok((await call('/api/admin/devices/'+fr.ref,{method:'POST',dev:D('c'),body:{action:'approve'}})).s===200,'Google admin approves a friend');
ok((await call('/api/access/status',{dev:D('b')})).j.status==='approved','friend is in after approval');
ok((await call('/api/access/status',{dev:D('b')})).j.admin===false,'friend is not an admin');
ok((await call('/api/admin/devices',{key:'secretkey'})).s===200,'the admin key still works');
ok((await call('/api/admin/devices',{key:'wrong'})).s===401,'wrong key refused');
await call('/api/admin/self',{method:'POST',key:'secretkey',body:{deviceId:D('d')}});
ok((await call('/api/access/status',{dev:D('d')})).j.status==='approved','owner device approved with the key still works');
console.log('ALL',n,'ADMIN CHECKS PASSED');
