import test from 'node:test';
import assert from 'node:assert/strict';
import {hostStorageKey,readHostSession,writeHostSession,forgetHostSession} from '../static/room-host-storage.mjs';

const oldOrigin='https://empathy-gallery-classroom.bybybye317.chatgpt.site';
const newOrigin='https://classroom.example.test';
const legacyKey='empathy-classroom-host-v1';
const now=1_800_000_000_000;
const saved={roomId:'r'.repeat(32),joinToken:'j'.repeat(32),hostToken:'h'.repeat(32),expiresAt:now+18_000_000};
function storage(entries=[]){const values=new Map(entries);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};}

test('host storage normalizes only public API origin, without serializing credentials or query',()=>{
 assert.equal(hostStorageKey('https://CLASSROOM.example.test:443/api?token=secret#fragment'),hostStorageKey(newOrigin));
 assert.notEqual(hostStorageKey(newOrigin),hostStorageKey(newOrigin+':8443'));
 assert.notEqual(hostStorageKey(newOrigin),hostStorageKey('http://classroom.example.test'));
 for(const url of ['invalid','file:///tmp/room','https://user:secret@classroom.example.test'])assert.throws(()=>hostStorageKey(url),/服务地址无效/);
 assert.ok(!hostStorageKey(newOrigin).includes(saved.hostToken));
});

test('different API origins cannot restore or clear each other’s host session',()=>{
 const store=storage();assert.equal(writeHostSession(store,oldOrigin,saved,{now}),true);
 assert.equal(readHostSession(store,newOrigin,{legacyOrigin:oldOrigin,now}),null);
 const newer={...saved,roomId:'n'.repeat(32)};
 assert.equal(writeHostSession(store,newOrigin,newer,{now}),true);
 assert.deepEqual(readHostSession(store,oldOrigin,{now}),saved);
 assert.deepEqual(readHostSession(store,newOrigin,{now}),newer);
 forgetHostSession(store,newOrigin);
 assert.equal(readHostSession(store,newOrigin,{now}),null);
 assert.deepEqual(readHostSession(store,oldOrigin,{now}),saved);
});

test('legacy migration is opt-in and restricted to the explicitly designated old origin',()=>{
 const store=storage([[legacyKey,JSON.stringify(saved)]]);
 assert.equal(readHostSession(store,newOrigin,{legacyOrigin:oldOrigin,now}),null);
 assert.equal(readHostSession(store,oldOrigin,{now}),null);
 assert.ok(store.values.has(legacyKey));
 assert.deepEqual(readHostSession(store,oldOrigin,{legacyOrigin:oldOrigin,now}),saved);
 assert.ok(!store.values.has(legacyKey));
 assert.deepEqual(JSON.parse(store.getItem(hostStorageKey(oldOrigin))),saved);
 assert.equal(readHostSession(store,newOrigin,{legacyOrigin:oldOrigin,now}),null);
});

test('expired or malformed scoped data removes only its own key and never falls back to legacy',()=>{
 for(const raw of ['bad JSON','null','{}',JSON.stringify({...saved,expiresAt:now})]){
  const store=storage([[hostStorageKey(newOrigin),raw],[hostStorageKey(oldOrigin),JSON.stringify(saved)],[legacyKey,JSON.stringify(saved)],['unrelated','keep']]);
  assert.equal(readHostSession(store,newOrigin,{legacyOrigin:oldOrigin,now}),null);
  assert.equal(store.values.has(hostStorageKey(newOrigin)),false);
  assert.ok(store.values.has(hostStorageKey(oldOrigin)));assert.ok(store.values.has(legacyKey));assert.equal(store.getItem('unrelated'),'keep');
 }
 for(const raw of ['bad JSON',JSON.stringify({...saved,expiresAt:now})]){
  const store=storage([[hostStorageKey(oldOrigin),raw],[legacyKey,JSON.stringify(saved)],[hostStorageKey(newOrigin),JSON.stringify(saved)]]);
  assert.equal(readHostSession(store,oldOrigin,{legacyOrigin:oldOrigin,now}),null);
  assert.ok(!store.values.has(legacyKey));
  assert.equal(readHostSession(store,oldOrigin,{legacyOrigin:oldOrigin,now}),null);
  assert.deepEqual(readHostSession(store,newOrigin,{now}),saved);
 }
});

test('expired legacy cache is discarded only when the matching old relay reads it',()=>{
 const store=storage([[legacyKey,JSON.stringify({...saved,expiresAt:now})]]);
 assert.equal(readHostSession(store,newOrigin,{legacyOrigin:oldOrigin,now}),null);
 assert.ok(store.values.has(legacyKey));
 assert.equal(readHostSession(store,oldOrigin,{legacyOrigin:oldOrigin,now}),null);
 assert.ok(!store.values.has(legacyKey));
});

test('disabled sessionStorage fails safely without throwing or leaking token values',()=>{
 const disabled={getItem(){throw new Error('disabled');},setItem(){throw new Error('disabled');},removeItem(){throw new Error('disabled');}};
 assert.equal(readHostSession(disabled,newOrigin,{now}),null);
 assert.equal(writeHostSession(disabled,newOrigin,saved,{now}),false);
 assert.doesNotThrow(()=>forgetHostSession(disabled,newOrigin));
 assert.equal(readHostSession(null,newOrigin,{now}),null);
 assert.equal(writeHostSession(null,newOrigin,saved,{now}),false);
});

test('failed migration write preserves recoverable legacy data without changing another relay',()=>{
 const store=storage([[legacyKey,JSON.stringify(saved)]]);
 store.setItem=()=>{throw new Error('quota exceeded');};
 assert.deepEqual(readHostSession(store,oldOrigin,{legacyOrigin:oldOrigin,now}),saved);
 assert.ok(store.values.has(legacyKey));assert.equal(store.values.has(hostStorageKey(newOrigin)),false);
});

test('leaving after a failed migration removes the old relay legacy copy on every later read',()=>{
 const store=storage([[legacyKey,JSON.stringify(saved)],[hostStorageKey(newOrigin),JSON.stringify(saved)]]);
 store.setItem=()=>{throw new Error('quota exceeded');};
 assert.deepEqual(readHostSession(store,oldOrigin,{legacyOrigin:oldOrigin,now}),saved);
 forgetHostSession(store,oldOrigin,{legacyOrigin:oldOrigin});
 assert.ok(!store.values.has(legacyKey));
 assert.equal(readHostSession(store,oldOrigin,{legacyOrigin:oldOrigin,now}),null);
 assert.equal(readHostSession(store,oldOrigin,{legacyOrigin:oldOrigin,now}),null);
 assert.deepEqual(readHostSession(store,newOrigin,{now}),saved);
});

test('forgetting another origin never removes legacy, and removing legacy requires explicit ownership',()=>{
 const store=storage([[legacyKey,JSON.stringify(saved)],[hostStorageKey(oldOrigin),JSON.stringify(saved)],[hostStorageKey(newOrigin),JSON.stringify(saved)]]);
 forgetHostSession(store,newOrigin,{legacyOrigin:oldOrigin});
 assert.ok(store.values.has(legacyKey));assert.ok(store.values.has(hostStorageKey(oldOrigin)));
 assert.ok(!store.values.has(hostStorageKey(newOrigin)));
 forgetHostSession(store,oldOrigin);
 assert.ok(store.values.has(legacyKey));
 forgetHostSession(store,oldOrigin,{legacyOrigin:oldOrigin});
 assert.ok(!store.values.has(legacyKey));
});

test('storage writes keep only validated host fields and reject expired or participant values',()=>{
 const store=storage();
 assert.equal(writeHostSession(store,newOrigin,{...saved,photo:'do not store',extraSecret:'do not store'},{now}),true);
 assert.deepEqual(JSON.parse(store.getItem(hostStorageKey(newOrigin))),saved);
 for(const invalid of [null,{}, {...saved,hostToken:undefined},{...saved,expiresAt:now}])assert.equal(writeHostSession(store,newOrigin,invalid,{now}),false);
 assert.deepEqual(readHostSession(store,newOrigin,{now}),saved);
});
