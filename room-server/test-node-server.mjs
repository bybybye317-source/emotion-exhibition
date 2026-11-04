import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer,resolveClientIp,optionsFromEnv} from './node-server.mjs';
import {openRoomDatabase} from './sqlite-store.mjs';
import {ROOM_TTL_MS,MAX_BODY_BYTES,digest} from './core.mjs';

const ORIGIN='https://bybybye317-source.github.io';
const scores=key=>Object.fromEntries(['happiness','neutral','sadness','surprise','anger','fear','disgust','contempt'].map(k=>[k,k===key?1:0]));
const photo=Buffer.from([255,216,255,224,0,4,255,217]);
const payload=(key='happiness',requestId=crypto.randomUUID())=>({
 requestId,generation:0,consent:true,scores:scores(key),photoDataUrl:'data:image/jpeg;base64,'+photo.toString('base64'),
 anchors:{left_eye:[.3,.4],right_eye:[.7,.4],nose:[.5,.5],mouth:[.5,.7]},
});
async function fixture(t,options={}){
 const directory=await mkdtemp(join(tmpdir(),'empathy-node-relay-')),databasePath=join(directory,'classroom.sqlite');
 let relay;
 const start=async()=>{relay=createServer({databasePath,port:0,...options});const address=await relay.listen();return `http://127.0.0.1:${address.port}`;};
 let base=await start();
 t.after(async()=>{await relay.close();await rm(directory,{recursive:true,force:true});});
 return {
  databasePath,get base(){return base;},
  async restart(){await relay.close();base=await start();},
  async close(){await relay.close();},
  call(path,method='GET',token,body,extraHeaders={}){
   return fetch(base+path,{method,headers:{Origin:ORIGIN,...(token?{Authorization:`Bearer ${token}`}:{}) ,...(body!==undefined?{'Content-Type':'application/json'}:{}),...extraHeaders},body:body===undefined?undefined:JSON.stringify(body)});
  },
 };
}
function queryFile(path,sql){const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare(sql).get();}finally{db.close();}}
function rawRequest(base,{method='POST',path='/api/rooms',headers={},chunks=[],end=true}={}){
 return new Promise((resolveRequest,reject)=>{
  let received=false;
  const request=httpRequest(base+path,{method,headers:{Origin:ORIGIN,...headers}},response=>{
   received=true;const data=[];response.on('data',chunk=>data.push(chunk));response.on('error',reject);
   response.on('end',()=>{request.destroy();resolveRequest({status:response.statusCode,headers:response.headers,body:Buffer.concat(data).toString()});});
  });
  request.on('error',error=>{if(!received)reject(error);});
  request.flushHeaders();for(const chunk of chunks)request.write(chunk);if(end)request.end();
 });
}

test('SQLite adapter persists WAL data, enforces foreign keys and rolls back a failed batch',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'empathy-sqlite-')),path=join(directory,'test.sqlite');
 const db=openRoomDatabase(path);t.after(async()=>{db.close();await rm(directory,{recursive:true,force:true});});
 assert.equal(db.checkReady(),true);
 assert.equal((await db.prepare('PRAGMA journal_mode').first()).journal_mode,'wal');
 assert.equal((await db.prepare('PRAGMA busy_timeout').first()).timeout,5000);
 assert.equal((await stat(path)).mode&0o777,0o600);
 const insert=key=>db.prepare('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,2)').bind(key);
 await assert.rejects(db.batch([insert('atomic'),insert('atomic')]));
 assert.equal(await db.prepare('SELECT * FROM rate_limits WHERE key=?').bind('atomic').first(),null);
 await assert.rejects(db.prepare('INSERT INTO receipts(room_id,request_id,record_id,generation) VALUES(?,?,?,0)').bind('missing','request','record').run());
 await insert('persists').run();db.close();
 const reopened=openRoomDatabase(path);try{assert.equal((await reopened.prepare('SELECT count FROM rate_limits WHERE key=?').bind('persists').first()).count,1);}finally{reopened.close();}
});

test('real HTTP rooms share averages and photos, enforce auth, and survive a server restart',async t=>{
 const f=await fixture(t);
 const health=await f.call('/api/health');assert.equal(health.status,200);assert.equal(health.headers.get('access-control-allow-origin'),ORIGIN);
 assert.deepEqual(await health.json(),{ok:true,storage:'sqlite',roomTtlSeconds:18000});
 const response=await f.call('/api/rooms','POST');assert.equal(response.status,201);const room=await response.json(),path='/api/rooms/'+room.roomId;
 assert.equal((await f.call(path)).status,401);
 assert.equal((await f.call(path,'GET','x'.repeat(32))).status,403);
 const first=payload('happiness');
 const receipts=await Promise.all([first,first,payload('sadness')].map(body=>f.call(path+'/contributions','POST',room.joinToken,body).then(r=>r.json())));
 assert.equal(receipts[0].recordId,receipts[1].recordId);
 const snapshot=await(await f.call(path,'GET',room.joinToken)).json();
 assert.equal(snapshot.session.participant_count,2);assert.equal(snapshot.revision,2);
 assert.equal(snapshot.session.group_scores.happiness,.5);assert.equal(snapshot.session.group_scores.sadness,.5);
 const photoPath=path+'/photos/'+receipts[0].recordId;
 assert.equal((await f.call(photoPath)).status,401);
 assert.deepEqual(Buffer.from(await(await f.call(photoPath,'GET',room.joinToken)).arrayBuffer()),photo);
 assert.equal((await f.call(path+'/reset','POST',room.joinToken)).status,403);
 assert.equal((await f.call(path,'DELETE',room.joinToken)).status,403);
 const stored=queryFile(f.databasePath,'SELECT * FROM rooms LIMIT 1');
 assert.equal(stored.expires_at-stored.created_at,ROOM_TTL_MS);assert.equal(stored.join_hash,await digest(room.joinToken));
 assert.equal(stored.host_hash,await digest(room.hostToken));assert.equal(stored.join_hash.includes(room.joinToken),false);
 await f.restart();
 const restored=await(await f.call(path,'GET',room.joinToken)).json();
 assert.equal(restored.expiresAt,room.expiresAt);assert.equal(restored.session.participant_count,2);
 assert.equal((await f.call(photoPath,'GET',room.joinToken)).status,200);
 assert.equal((await f.call(path+'/reset','POST',room.hostToken)).status,200);
 assert.equal((await f.call(path+'/contributions','POST',room.joinToken,first)).status,409);
 assert.equal((await f.call(path,'DELETE',room.hostToken)).status,200);
 assert.equal((await f.call(path,'GET',room.joinToken)).status,404);
});

test('the CLI handles SIGTERM and a fresh Node process restores the same room', {timeout:10000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'empathy-node-process-')),databasePath=join(directory,'classroom.sqlite'),children=[];
 const stop=async(child,signal='SIGTERM')=>{
  if(child.exitCode!==null||child.signalCode!==null)return [child.exitCode,child.signalCode];
  const exited=once(child,'exit');child.kill(signal);return exited;
 };
 t.after(async()=>{for(const child of children)await stop(child,'SIGKILL');await rm(directory,{recursive:true,force:true});});
 const start=async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./node-server.mjs',import.meta.url))],{env:{ROOM_DB_PATH:databasePath,ROOM_HOST:'127.0.0.1',PORT:'0',ROOM_ALLOWED_ORIGINS:ORIGIN},stdio:['ignore','pipe','pipe']});
  children.push(child);
  const base=await new Promise((resolveBase,reject)=>{
   let output='';const timer=setTimeout(()=>reject(new Error('CLI did not start')),3000);timer.unref();
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',()=>{clearTimeout(timer);reject(new Error('CLI exited before listening'));});
   child.stderr.resume();
   child.stdout.on('data',chunk=>{output=(output+chunk).slice(-1000);const match=output.match(/Listening on 127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolveBase('http://127.0.0.1:'+match[1]);}});
  });
  return {child,base};
 };
 const first=await start();const response=await fetch(first.base+'/api/rooms',{method:'POST',headers:{Origin:ORIGIN}});assert.equal(response.status,201);
 const room=await response.json();assert.deepEqual(await stop(first.child),[0,null]);
 const second=await start();const restored=await fetch(second.base+'/api/rooms/'+room.roomId,{headers:{Origin:ORIGIN,Authorization:'Bearer '+room.joinToken}});
 assert.equal(restored.status,200);assert.equal((await restored.json()).expiresAt,room.expiresAt);assert.deepEqual(await stop(second.child),[0,null]);
});

test('HTTP expiry is exactly five hours, is unchanged by restart, and scheduled cleanup removes expired photos',async t=>{
 let now=Date.now();const f=await fixture(t,{now:()=>now,cleanupIntervalMs:25});
 const room=await(await f.call('/api/rooms','POST')).json(),path='/api/rooms/'+room.roomId;
 const contribution=await(await f.call(path+'/contributions','POST',room.joinToken,payload())).json();
 now=room.expiresAt-1;await f.restart();assert.equal((await f.call(path,'GET',room.joinToken)).status,200);
 assert.equal((await(await f.call(path,'GET',room.joinToken)).json()).expiresAt,room.expiresAt);
 now=room.expiresAt;
 // No further API request triggers this deletion: it must happen on the timer.
 const until=Date.now()+2000;
 while(queryFile(f.databasePath,'SELECT COUNT(*) AS count FROM rooms').count&&Date.now()<until)await delay(20);
 for(const table of ['rooms','contributions','receipts'])assert.equal(queryFile(f.databasePath,`SELECT COUNT(*) AS count FROM ${table}`).count,0);
 assert.equal((await f.call(path,'GET',room.joinToken)).status,404);
 assert.equal((await f.call(path+'/photos/'+contribution.recordId,'GET',room.joinToken)).status,404);
 assert.equal((await f.call(path+'/contributions','POST',room.joinToken,payload())).status,404);
});

test('CORS preflight allows only the configured origin and never returns wildcard credentials',async t=>{
 const f=await fixture(t,{allowedOrigins:[ORIGIN,'https://class.example.test']});
 const preflight=await f.call('/api/rooms','OPTIONS',undefined,undefined,{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Authorization, Content-Type'});
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),ORIGIN);
 assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
 const forbidden=await f.call('/api/rooms','POST',undefined,undefined,{Origin:'https://evil.example'});
 assert.equal(forbidden.status,403);assert.equal(forbidden.headers.get('access-control-allow-origin'),null);
 assert.equal(queryFile(f.databasePath,'SELECT COUNT(*) AS count FROM rooms').count,0);
});

test('oversized declared or chunked bodies are rejected without reaching room creation',async t=>{
 const f=await fixture(t);
 const declared=await rawRequest(f.base,{headers:{'Content-Type':'application/json','Content-Length':String(MAX_BODY_BYTES+1)},end:false});
 assert.equal(declared.status,413);assert.equal(declared.headers.connection,'close');
 const chunked=await rawRequest(f.base,{headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'},chunks:[Buffer.alloc(MAX_BODY_BYTES,32),Buffer.from('x')]});
 assert.equal(chunked.status,413);
 assert.equal(queryFile(f.databasePath,'SELECT COUNT(*) AS count FROM rooms').count,0);
 assert.equal((await f.call('/api/health')).status,200);
});

test('a stalled upload times out and does not leave the server or database unusable',async t=>{
 const f=await fixture(t,{requestTimeoutMs:100});
 const response=await rawRequest(f.base,{headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'},chunks:['{'],end:false});
 assert.equal(response.status,408);assert.match(response.body,/超时/);
 assert.equal(queryFile(f.databasePath,'SELECT COUNT(*) AS count FROM rooms').count,0);
 assert.equal((await f.call('/api/health')).status,200);
});

test('readiness detects a missing database table and returns only a generic error',async t=>{
 const f=await fixture(t);const db=new DatabaseSync(f.databasePath);try{db.exec('DROP TABLE receipts');}finally{db.close();}
 const response=await f.call('/api/health');assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'共享讲台服务暂时不可用，请稍后重试'});
});

test('only a single valid X-Real-IP from a loopback proxy controls the rate-limit address',()=>{
 const req=(remoteAddress,headers)=>({socket:{remoteAddress},headers});
 assert.equal(resolveClientIp(req('127.0.0.1',{'x-real-ip':'203.0.113.7'})),'203.0.113.7');
 assert.equal(resolveClientIp(req('::ffff:127.0.0.1',{'x-real-ip':'2001:db8::42'})),'2001:db8::42');
 for(const value of ['203.0.113.7, 203.0.113.8','garbage','fe80::1%en0',['203.0.113.7','203.0.113.8']])assert.equal(resolveClientIp(req('127.0.0.1',{'x-real-ip':value})),'127.0.0.1');
 assert.equal(resolveClientIp(req('198.51.100.4',{'x-real-ip':'203.0.113.7','x-forwarded-for':'203.0.113.8','cf-connecting-ip':'203.0.113.9'})),'198.51.100.4');
 assert.equal(resolveClientIp(req('127.0.0.1',{'x-forwarded-for':'203.0.113.8','cf-connecting-ip':'203.0.113.9'})),'127.0.0.1');
 assert.equal(resolveClientIp(req('127.0.0.1',{'x-real-ip':'203.0.113.7'}),{trustLoopbackProxy:false}),'127.0.0.1');
});

test('spoofing forwarded headers in real HTTP requests cannot evade creation limits',async t=>{
 const f=await fixture(t);
 for(let i=0;i<7;i++){
  const response=await f.call('/api/rooms','POST',undefined,undefined,{'X-Forwarded-For':`203.0.113.${i+1}`,'CF-Connecting-IP':`198.51.100.${i+1}`});
  assert.equal(response.status,i<6?201:429);
 }
 assert.equal(queryFile(f.databasePath,'SELECT COUNT(*) AS count FROM rooms').count,6);
});

test('environment defaults bind only loopback and invalid origins/configuration fail closed',()=>{
 const options=optionsFromEnv({});assert.equal(options.host,'127.0.0.1');assert.equal(options.port,8787);
 for(const allowedOrigins of [[],['*'],['https://example.test/secret'],['null']])assert.throws(()=>createServer({databasePath:':memory:',allowedOrigins}));
 assert.throws(()=>createServer({databasePath:':memory:',port:70000}));
 assert.throws(()=>createServer({databasePath:':memory:',requestTimeoutMs:0}));
});
