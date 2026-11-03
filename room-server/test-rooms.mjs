import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {D1RoomStore} from './d1-store.mjs';
import {handleRequest,ROOM_TTL_MS,digest,validateContribution} from './core.mjs';
function database(){const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));return {
 prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async run(){return this._run();},async first(){return sqlite.prepare(sql).get(...this.args)||null;},_run(){const stmt=sqlite.prepare(sql);return /^\s*(SELECT|WITH)/i.test(sql)?{results:stmt.all(...this.args)}:{results:[],meta:stmt.run(...this.args)};}};},
 async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const r=statements.map(s=>s._run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
 };}
const scores=key=>Object.fromEntries(['happiness','neutral','sadness','surprise','anger','fear','disgust','contempt'].map(e=>[e,e===key?1:0]));
const anchors={left_eye:[.3,.4],right_eye:[.7,.4],nose:[.5,.5],mouth:[.5,.7]};
const photo='data:image/jpeg;base64,'+btoa(String.fromCharCode(255,216,255,224,0,4,255,217));
const payload=(id=crypto.randomUUID(),key='happiness',generation=0)=>({requestId:id,generation,scores:scores(key),anchors,photoDataUrl:photo,consent:true});
function fixture(){const store=new D1RoomStore(database());let now=10000;return {store,get now(){return now;},advance:n=>now+=n,call:async(path,method='GET',token,body,origin='https://bybybye317-source.github.io')=>{const request=new Request('https://example.test'+path,{method,headers:{Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{}) ,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return handleRequest(request,store,{origins:['https://bybybye317-source.github.io'],now,ip:'test'});}};}
const create=async f=>(await f.call('/api/rooms','POST')).json();
test('capability auth, CORS, consent, host-only clear and close',async()=>{
 const f=fixture(),r=await create(f),url=`/api/rooms/${r.roomId}`;
 assert.equal((await f.call(url)).status,401);
 assert.equal((await f.call(url,'GET','x'.repeat(32))).status,403);
 assert.equal((await f.call(url,'GET',r.joinToken,undefined,'https://evil.test')).status,403);
 assert.equal((await f.call(url+'/contributions','POST',r.joinToken,{...payload(),consent:false})).status,400);
 assert.equal((await f.call(url+'/reset','POST',r.joinToken)).status,403);
 assert.equal((await f.call(url,'DELETE',r.joinToken)).status,403);
 assert.equal((await f.call(url,'DELETE',r.hostToken)).status,200);
 assert.equal((await f.call(url,'GET',r.joinToken)).status,404);
});
test('two devices share authoritative average and authenticated photo',async()=>{
 const f=fixture(),r=await create(f),url=`/api/rooms/${r.roomId}`;
 const a=await(await f.call(url+'/contributions','POST',r.joinToken,payload(undefined,'happiness'))).json();
 await f.call(url+'/contributions','POST',r.joinToken,payload(undefined,'sadness'));
 const s=await(await f.call(url,'GET',r.joinToken)).json();
 assert.equal(s.session.participant_count,2);assert.equal(s.session.group_scores.happiness,.5);assert.equal(s.session.group_scores.sadness,.5);
 assert.equal((await f.call(url+'/photos/'+a.recordId)).status,401);
 assert.equal((await f.call(url+'/photos/'+a.recordId,'GET',r.joinToken)).headers.get('content-type'),'image/jpeg');
 assert.equal((await(await f.call(url+'?since=2','GET',r.joinToken)).json()).unchanged,true);
});
test('atomic slots, 32-photo bound, durable idempotency after eviction',async()=>{
 const f=fixture(),r=await create(f),value=validateContribution(payload());
 const first=await f.store.add(r.roomId,value,f.now);
 await Promise.all(Array.from({length:40},()=>f.store.add(r.roomId,validateContribution(payload()),f.now)));
 const s=await f.store.snapshot(r.roomId);assert.equal(s.session.participant_count,32);assert.equal(s.revision,41);
 assert.equal(new Set(s.session.participants.map(p=>p.slot)).size,32);
 assert.equal(await f.store.photo(r.roomId,first.record_id),null);
 const again=await f.store.add(r.roomId,value,f.now);assert.equal(again.record_id,first.record_id);
 assert.equal((await f.store.snapshot(r.roomId)).revision,41);
});
test('duplicate retry increments only once; reset rejects late contributions',async()=>{
 const f=fixture(),r=await create(f),url=`/api/rooms/${r.roomId}`,p=payload();
 const submissions=await Promise.all(Array.from({length:3},()=>f.call(url+'/contributions','POST',r.joinToken,p).then(r=>r.json())));
 assert.equal(new Set(submissions.map(s=>s.recordId)).size,1);
 assert.equal((await f.store.snapshot(r.roomId)).revision,1);
 await f.call(url+'/reset','POST',r.hostToken);
 assert.equal((await f.call(url+'/contributions','POST',r.joinToken,p)).status,409);
 assert.equal((await f.store.snapshot(r.roomId)).session.participant_count,0);
 assert.equal(await f.store.photo(r.roomId,submissions[0].recordId),null);
 const newer=await(await f.call(url+'/contributions','POST',r.joinToken,payload(undefined,'fear',1))).json();
 assert.equal(newer.snapshot.session.participants[0].slot,0);
});
test('room expiry removes stored photo and receipt',async()=>{
 const f=fixture(),r=await create(f),url=`/api/rooms/${r.roomId}`;await f.call(url+'/contributions','POST',r.joinToken,payload());
 f.advance(ROOM_TTL_MS+1);assert.equal((await f.call(url,'GET',r.joinToken)).status,404);assert.equal(await f.store.get(r.roomId),null);
});
test('new classroom expires at exactly five hours, including photo and write access',async()=>{
 const f=fixture(),createdAt=f.now,r=await create(f),url=`/api/rooms/${r.roomId}`;
 const fiveHours=18_000_000;
 assert.equal(ROOM_TTL_MS,fiveHours);
 assert.equal(r.expiresAt,createdAt+fiveHours);
 assert.equal(r.snapshot.expiresAt,r.expiresAt);
 assert.equal((await(await f.call('/api/health')).json()).roomTtlSeconds,18_000);
 const contribution=await(await f.call(url+'/contributions','POST',r.joinToken,payload())).json();
 const photoUrl=url+'/photos/'+contribution.recordId;
 f.advance(4*60*60*1000+59*60*1000);
 assert.equal((await f.call(url,'GET',r.joinToken)).status,200);
 assert.equal((await f.call(photoUrl,'GET',r.joinToken)).status,200);
 f.advance(59_999);
 assert.equal((await f.call(url,'GET',r.joinToken)).status,200);
 f.advance(1);
 assert.equal(f.now,createdAt+fiveHours);
 assert.equal((await f.call(photoUrl,'GET',r.joinToken)).status,404);
 assert.equal((await f.call(url,'GET',r.joinToken)).status,404);
 assert.equal((await f.call(url+'/contributions','POST',r.joinToken,payload())).status,404);
 assert.equal((await f.call(url+'/reset','POST',r.hostToken)).status,404);
 assert.equal(await f.store.get(r.roomId),null);
 assert.equal(await f.store.photo(r.roomId,contribution.recordId),null);
 assert.equal((await f.store.q('SELECT COUNT(*) AS count FROM receipts WHERE room_id=?',r.roomId).first()).count,0);
});
test('refreshing, polling and resetting do not extend the five-hour classroom deadline',async()=>{
 const f=fixture(),createdAt=f.now,r=await create(f),url=`/api/rooms/${r.roomId}`;
 await f.call(url+'/contributions','POST',r.joinToken,payload());
 f.advance(60*60*1000);
 const refresh=await(await f.call(url,'GET',r.joinToken)).json();
 const unchanged=await(await f.call(url+'?since='+refresh.revision,'GET',r.joinToken)).json();
 assert.equal(unchanged.unchanged,true);assert.equal(unchanged.expiresAt,r.expiresAt);
 f.advance(60*60*1000);
 const reset=await(await f.call(url+'/reset','POST',r.hostToken)).json();
 assert.equal(reset.generation,1);assert.equal(reset.expiresAt,r.expiresAt);
 const stored=await f.store.get(r.roomId);
 assert.equal(stored.created_at,createdAt);assert.equal(stored.expires_at,createdAt+18_000_000);
 f.advance(3*60*60*1000);
 assert.equal((await f.call(url,'GET',r.joinToken)).status,404);
});
test('legacy two-hour classroom keeps its stored deadline while new classroom lasts five hours',async()=>{
 const f=fixture(),createdAt=f.now,roomId='l'.repeat(32),joinToken='j'.repeat(32),hostToken='h'.repeat(32);
 const legacyExpiry=createdAt+2*60*60*1000;
 await f.store.create({id:roomId,join_hash:await digest(joinToken),host_hash:await digest(hostToken),created_at:createdAt,expires_at:legacyExpiry});
 const newer=await create(f),url=`/api/rooms/${roomId}`;
 f.advance(119*60*1000);
 const oldSnapshot=await(await f.call(url,'GET',joinToken)).json();
 assert.equal(oldSnapshot.expiresAt,legacyExpiry);
 const reset=await(await f.call(url+'/reset','POST',hostToken)).json();
 assert.equal(reset.expiresAt,legacyExpiry);
 assert.equal((await f.store.get(roomId)).expires_at,legacyExpiry);
 f.advance(60*1000);
 assert.equal((await f.call(url,'GET',joinToken)).status,404);
 assert.equal((await f.call(`/api/rooms/${newer.roomId}`,'GET',newer.joinToken)).status,200);
 assert.equal((await f.store.get(newer.roomId)).expires_at,createdAt+18_000_000);
});
test('malformed, oversized and invalid score/anchor payloads are rejected',async()=>{
 const f=fixture(),r=await create(f),url=`/api/rooms/${r.roomId}/contributions`;
 for(const invalid of [{...payload(),scores:{happiness:1}},{...payload(),anchors:{...anchors,nose:[99,1]}},{...payload(),photoDataUrl:'data:image/svg+xml;base64,abcd'},{...payload(),photoDataUrl:'data:image/jpeg;base64,'+'A'.repeat(400000)}]){
  assert.ok([400,413].includes((await f.call(url,'POST',r.joinToken,invalid)).status));
 }
 assert.equal((await f.store.snapshot(r.roomId)).session.participant_count,0);
});
test('rate limit prevents repeated creation and recovers after window',async()=>{
 const f=fixture();for(let i=0;i<6;i++)assert.equal((await f.call('/api/rooms','POST')).status,201);
 assert.equal((await f.call('/api/rooms','POST')).status,429);f.advance(3600001);assert.equal((await f.call('/api/rooms','POST')).status,201);
});
