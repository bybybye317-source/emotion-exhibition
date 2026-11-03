import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomClient} from '../static/room-client.mjs';
const credentials={roomId:'r'.repeat(32),joinToken:'j'.repeat(32)};
const empty={roomId:credentials.roomId,revision:0,generation:0,expiresAt:Date.now()+100000,session:{participants:[],participant_count:0,group_scores:{}}};
const withPhoto={...empty,revision:1,session:{participants:[{id:'a',slot:0,number:1,photo_path:'/api/photo/a',scores:{happiness:1}}],participant_count:1,group_scores:{happiness:1}}};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
test('default browser fetch retains its global receiver',async()=>{
 const original=globalThis.fetch;let c,calls=0;
 try{
  globalThis.fetch=function(){assert.equal(this,globalThis,'browser fetch must be invoked on Window');calls++;return Promise.resolve(response(empty));};
  c=new RoomClient();await c.join(credentials);assert.equal(calls,1);assert.equal(c.role,'participant');
 }finally{c?.leave(false);globalThis.fetch=original;}
});
test('failed creation rolls back state and reports offline instead of connecting',async()=>{
 const states=[],statuses=[];const c=new RoomClient({onSnapshot:s=>states.push(s),onStatus:s=>statuses.push(s.status),fetchImpl:async()=>{throw new TypeError('Network unavailable');}});
 await assert.rejects(c.createRoom());assert.equal(c.role,null);assert.equal(c.credentials,null);assert.equal(c.snapshot,null);assert.equal(states.at(-1),null);assert.equal(statuses.at(-1),'offline');c.leave(false);
});
test('failed join rolls back role, credentials and snapshot',async()=>{
 const states=[];const c=new RoomClient({onSnapshot:s=>states.push(s),fetchImpl:async()=>response({error:'房间已结束或过期'},404)});
 await assert.rejects(c.join(credentials));assert.equal(c.role,null);assert.equal(c.credentials,null);assert.equal(c.snapshot,null);assert.equal(states.at(-1),null);c.leave(false);
});
test('expiry clears all local room data and notifies state consumer',async()=>{
 let expired=false;const states=[],statuses=[];const c=new RoomClient({onSnapshot:s=>states.push(s),onStatus:s=>statuses.push(s.status),fetchImpl:async u=>expired?response({error:'房间已结束或过期'},404):u.endsWith('/a')?new Response(new Blob(['image'],{type:'image/jpeg'})):response(withPhoto)});
 await c.join(credentials);assert.equal(c._photos.size,1);expired=true;
 await assert.rejects(c.refresh());assert.equal(c._photos.size,0);assert.equal(c.snapshot,null);assert.equal(c.credentials,null);assert.equal(states.at(-1),null);assert.ok(statuses.includes('expired'));c.leave(false);
});
test('local expiry clears photos even while the service cannot be reached',async()=>{
 let offline=false;const states=[],statuses=[];const c=new RoomClient({onSnapshot:s=>states.push(s),onStatus:s=>statuses.push(s.status),fetchImpl:async u=>{if(offline)throw new Error('offline');return u.endsWith('/a')?new Response(new Blob(['image'],{type:'image/jpeg'})):response(withPhoto);}});
 await c.join(credentials);offline=true;c.snapshot.expiresAt=Date.now()-1;
 await assert.rejects(c.refresh(),e=>e.status===404);assert.equal(c._photos.size,0);assert.equal(c.credentials,null);assert.equal(states.at(-1),null);assert.equal(statuses.at(-1),'expired');c.leave(false);
});
test('same revision hydration serializes and loads each photo once',async()=>{
 let loads=0;const c=new RoomClient({fetchImpl:async u=>{if(u.endsWith('/a')){loads++;await new Promise(r=>setTimeout(r,10));return new Response(new Blob(['image'],{type:'image/jpeg'}));}return response(empty);}});
 await c.join(credentials);await Promise.all([c._apply(withPhoto,c._epoch),c._apply(withPhoto,c._epoch)]);
 assert.equal(loads,1);assert.equal(c._photos.size,1);c.leave(false);
});
test('an evicted photo does not incorrectly end a valid room',async()=>{
 let updated=false;const c=new RoomClient({fetchImpl:async u=>u.endsWith('/a')?response({error:'这份照片已移除'},404):response(updated?withPhoto:empty)});
 await c.join(credentials);updated=true;await assert.rejects(c.refresh(),e=>e.status===409);
 assert.equal(c.role,'participant');assert.ok(c.credentials);c.leave(false);
});
for(const status of [403,200])test(`provider HTML ${status} preserves the current room and photos until local TTL`,async()=>{
 let blocked=false;const statuses=[];
 const c=new RoomClient({onStatus:s=>statuses.push(s),fetchImpl:async u=>blocked?new Response('<html>Access verification</html>',{status,headers:{'Content-Type':'text/html'}}):u.endsWith('/a')?new Response(new Blob(['image'],{type:'image/jpeg'})):response(withPhoto)});
 try{
  await c.join(credentials);const snapshot=c.snapshot,photo=c._photos.get('a');blocked=true;
  await assert.rejects(c.refresh(),e=>e.status===status&&e.serviceResponse&&!e.invalidatesRoom);
  assert.equal(c.snapshot,snapshot);assert.equal(c._photos.get('a'),photo);assert.deepEqual(c.credentials,credentials);
  assert.equal(statuses.at(-1).status,'offline');assert.match(statuses.at(-1).detail,/无法确认房间状态/);assert.match(statuses.at(-1).detail,/自动重试/);
  c.snapshot.expiresAt=Date.now()-1;
  await assert.rejects(c.refresh(),e=>e.invalidatesRoom);
  assert.equal(c.snapshot,null);assert.equal(c._photos.size,0);assert.equal(c.credentials,null);assert.equal(statuses.at(-1).status,'expired');
 }finally{c.leave(false);}
});
test('polling retries a provider 403 and recovers without requiring a new invitation',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let blocked=false,calls=0;const statuses=[];
 const c=new RoomClient({pollIntervalMs:1000,onStatus:s=>statuses.push(s.status),fetchImpl:async()=>{calls++;return blocked?new Response('<html>Blocked</html>',{status:403,headers:{'Content-Type':'text/html'}}):response(empty);}});
 try{
  await c.join(credentials);blocked=true;t.mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);assert.equal(statuses.at(-1),'offline');assert.deepEqual(c.credentials,credentials);
  blocked=false;t.mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,3);assert.equal(statuses.at(-1),'connected');assert.deepEqual(c.credentials,credentials);
 }finally{c.leave(false);t.mock.timers.reset();}
});
test('an HTML photo response keeps the previous complete snapshot and is not stored as a photo',async()=>{
 let updated=false;const next={...withPhoto,revision:2,session:{...withPhoto.session,participants:[{...withPhoto.session.participants[0],id:'b',photo_path:'/api/photo/b'}]}};
 const c=new RoomClient({fetchImpl:async u=>u.endsWith('/a')?new Response(new Blob(['image'],{type:'image/jpeg'})):u.endsWith('/b')?new Response('<html>Verification</html>',{headers:{'Content-Type':'text/html'}}):response(updated?next:withPhoto)});
 try{
  await c.join(credentials);const snapshot=c.snapshot,photo=c._photos.get('a');updated=true;
  await assert.rejects(c.refresh(),e=>e.serviceResponse&&!e.invalidatesRoom);
  assert.equal(c.snapshot,snapshot);assert.equal(c._photos.size,1);assert.equal(c._photos.get('a'),photo);assert.deepEqual(c.credentials,credentials);
 }finally{c.leave(false);}
});
test('structured relay credential errors still invalidate the room, but an origin-config error does not',async()=>{
 for(const [status,message,invalidates] of [[401,'需要房间凭证',true],[403,'房间凭证无效',true],[404,'房间已结束或过期',true],[403,'来源未获允许',false]]){
  let rejected=false;const c=new RoomClient({fetchImpl:async()=>rejected?response({error:message},status):response(empty)});
  try{await c.join(credentials);rejected=true;await assert.rejects(c.refresh(),e=>e.invalidatesRoom===invalidates);assert.equal(c.credentials===null,invalidates);assert.equal(c.snapshot===null,invalidates);}finally{c.leave(false);}
 }
});

function stubPhotoEncoding(t){
 const originals=new Map(['createImageBitmap','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>({width:1,height:1,close(){}})});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,/9j/2Q=='})}});
 t.after(()=>{for(const [key,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const submission=()=>({blob:new Blob(['photo'],{type:'image/jpeg'}),scores:{happiness:1},anchors:{},consent:true});
test('a submit receipt arriving after room expiry cannot report success or restore the room',async t=>{
 stubPhotoEncoding(t);const post=deferred(),started=deferred();let expired=false;
 const c=new RoomClient({fetchImpl:async(u,options)=>{if(options.method==='POST'){started.resolve();return post.promise;}return expired?response({error:'房间已结束或过期'},404):response(empty);}});
 try{
  await c.join(credentials);const pending=c.submit(submission());await started.promise;
  expired=true;await assert.rejects(c.refresh(),e=>e.invalidatesRoom);
  // Model a response already in transit whose transport completes despite abort.
  post.resolve(response({recordId:'submitted',snapshot:{...empty,revision:1}}));
  await assert.rejects(pending,/房间操作已取消/);
  assert.equal(c.credentials,null);assert.equal(c.snapshot,null);
 }finally{c.leave(false);}
});
test('a reset observed during submission rejects the old receipt and preserves the new generation',async t=>{
 stubPhotoEncoding(t);const post=deferred(),started=deferred();const reset={...empty,revision:2,generation:1};let current=empty;
 const c=new RoomClient({fetchImpl:async(u,options)=>{if(options.method==='POST'){started.resolve();return post.promise;}return response(current);}});
 try{
  await c.join(credentials);const pending=c.submit(submission());await started.promise;
  current=reset;await c.refresh();post.resolve(response({recordId:'old',snapshot:{...empty,revision:1}}));
  await assert.rejects(pending,/本轮已更新/);
  assert.equal(c.snapshot.generation,1);assert.equal(c.snapshot.revision,2);assert.equal(c.snapshot.session.participant_count,0);
 }finally{c.leave(false);}
});
test('a receipt containing a newer reset generation is not accepted as a successful contribution',async t=>{
 stubPhotoEncoding(t);
 const c=new RoomClient({fetchImpl:async(u,options)=>response(options.method==='POST'?{recordId:'old',snapshot:{...empty,revision:2,generation:1}}:empty)});
 try{
  await c.join(credentials);await assert.rejects(c.submit(submission()),/本轮已更新/);
  assert.equal(c.snapshot.generation,0);assert.equal(c.snapshot.revision,0);
 }finally{c.leave(false);}
});
test('submission rechecks its room after snapshot listeners run during hydration',async t=>{
 stubPhotoEncoding(t);let leaveAfterApply=false;
 const c=new RoomClient({onSnapshot:()=>{if(leaveAfterApply)c.leave(false);},fetchImpl:async(u,options)=>response(options.method==='POST'?{recordId:'submitted',snapshot:{...empty,revision:1}}:empty)});
 try{
  await c.join(credentials);leaveAfterApply=true;await assert.rejects(c.submit(submission()),/房间操作已取消/);
  assert.equal(c.credentials,null);assert.equal(c.snapshot,null);
 }finally{c.leave(false);}
});
