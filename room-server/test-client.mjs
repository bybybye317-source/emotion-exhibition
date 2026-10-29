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
 const states=[];const c=new RoomClient({onSnapshot:s=>states.push(s),fetchImpl:async()=>response({error:'Gone'},404)});
 await assert.rejects(c.join(credentials));assert.equal(c.role,null);assert.equal(c.credentials,null);assert.equal(c.snapshot,null);assert.equal(states.at(-1),null);c.leave(false);
});
test('expiry clears all local room data and notifies state consumer',async()=>{
 let expired=false;const states=[],statuses=[];const c=new RoomClient({onSnapshot:s=>states.push(s),onStatus:s=>statuses.push(s.status),fetchImpl:async u=>expired?response({error:'Expired'},404):u.endsWith('/a')?new Response(new Blob(['image'],{type:'image/jpeg'})):response(withPhoto)});
 await c.join(credentials);assert.equal(c._photos.size,1);expired=true;
 await assert.rejects(c.refresh());assert.equal(c._photos.size,0);assert.equal(c.snapshot,null);assert.equal(c.credentials,null);assert.equal(states.at(-1),null);assert.ok(statuses.includes('expired'));c.leave(false);
});
test('local expiry clears photos even while the service cannot be reached',async()=>{
 let offline=false;const states=[],statuses=[];const c=new RoomClient({onSnapshot:s=>states.push(s),onStatus:s=>statuses.push(s.status),fetchImpl:async u=>{if(offline)throw new Error('offline');return u.endsWith('/a')?new Response(new Blob(['image'])):response(withPhoto);}});
 await c.join(credentials);offline=true;c.snapshot.expiresAt=Date.now()-1;
 await assert.rejects(c.refresh(),e=>e.status===404);assert.equal(c._photos.size,0);assert.equal(c.credentials,null);assert.equal(states.at(-1),null);assert.equal(statuses.at(-1),'expired');c.leave(false);
});
test('same revision hydration serializes and loads each photo once',async()=>{
 let loads=0;const c=new RoomClient({fetchImpl:async u=>{if(u.endsWith('/a')){loads++;await new Promise(r=>setTimeout(r,10));return new Response(new Blob(['image']));}return response(empty);}});
 await c.join(credentials);await Promise.all([c._apply(withPhoto,c._epoch),c._apply(withPhoto,c._epoch)]);
 assert.equal(loads,1);assert.equal(c._photos.size,1);c.leave(false);
});
test('an evicted photo does not incorrectly end a valid room',async()=>{
 let updated=false;const c=new RoomClient({fetchImpl:async u=>u.endsWith('/a')?response({error:'Photo removed'},404):response(updated?withPhoto:empty)});
 await c.join(credentials);updated=true;await assert.rejects(c.refresh(),e=>e.status===409);
 assert.equal(c.role,'participant');assert.ok(c.credentials);c.leave(false);
});
