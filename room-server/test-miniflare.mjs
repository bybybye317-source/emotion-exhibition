import {Miniflare} from '../../empathy-classroom-service/node_modules/miniflare/dist/src/index.js';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const directory=fileURLToPath(new URL('.',import.meta.url));
const mf=new Miniflare({modules:true,scriptPath:directory+'worker.mjs',modulesRules:[{type:'ESModule',include:['**/*.mjs']}],compatibilityDate:'2026-01-01',d1Databases:{DB:'empathy-test'}});
try{
 const db=await mf.getD1Database('DB');
 const statements=fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8').split(';').map(s=>s.trim()).filter(Boolean);
 await db.batch(statements.map(s=>db.prepare(s)));
 const call=(path,method='GET',token,body)=>mf.dispatchFetch('http://local.test'+path,{method,headers:{Origin:'https://bybybye317-source.github.io',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const r=await(await call('/api/rooms','POST')).json();assert.ok(r.hostToken);
 const url='/api/rooms/'+r.roomId;
 const photo='data:image/jpeg;base64,'+btoa(String.fromCharCode(255,216,255,224,0,4,255,217));
 const body={requestId:crypto.randomUUID(),generation:0,consent:true,photoDataUrl:photo,anchors:{left_eye:[.3,.4],right_eye:[.7,.4],nose:[.5,.5],mouth:[.5,.7]},scores:{happiness:1,neutral:0,sadness:0,surprise:0,anger:0,fear:0,disgust:0,contempt:0}};
 const results=await Promise.all(Array.from({length:6},(_,i)=>call(url+'/contributions','POST',r.joinToken,{...body,requestId:i<3?body.requestId:crypto.randomUUID()}).then(r=>r.json())));
 const snap=await(await call(url,'GET',r.joinToken)).json();assert.equal(snap.session.participant_count,4);assert.equal(snap.revision,4);assert.equal(new Set(snap.session.participants.map(p=>p.slot)).size,4);
 assert.equal((await call(url+'/reset','POST',r.joinToken)).status,403);
 assert.equal((await call(url+'/reset','POST',r.hostToken)).status,200);
 assert.equal((await call(url+'/contributions','POST',r.joinToken,body)).status,409);
 assert.equal((await call(url+'/photos/'+results[0].recordId,'GET',r.joinToken)).status,404);
 assert.equal((await call(url,'DELETE',r.hostToken)).status,200);
 assert.equal((await call(url,'GET',r.joinToken)).status,404);
 console.log('Miniflare D1 PASS: 6 concurrent submissions => 4 unique records; sequential unique slots, auth, reset, stale rejection and photo deletion.');
}finally{await mf.dispose();}
