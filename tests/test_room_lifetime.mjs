import test from 'node:test';
import assert from 'node:assert/strict';
import {roomLifetime,validHostSession,shouldAutoCreateHost} from '../static/room-lifetime.mjs';
const now=1_800_000_000_000;
const saved={roomId:'r'.repeat(32),joinToken:'j'.repeat(32),hostToken:'h'.repeat(32)};

test('five-hour countdown follows the server deadline and ends at its exact boundary',()=>{
 const expiry=now+5*60*60*1000;
 assert.equal(roomLifetime(expiry,now).clock,'05:00:00');
 assert.equal(roomLifetime(expiry,expiry-1).clock,'00:00:01');
 assert.equal(roomLifetime(expiry,expiry-1).expired,false);
 assert.deepEqual(roomLifetime(expiry,expiry),{known:true,expired:true,remainingMs:0,clock:'00:00:00'});
 assert.equal(roomLifetime(expiry,expiry+1).clock,'00:00:00');
});
test('older two-hour rooms are never relabeled as five-hour rooms',()=>{
 assert.equal(roomLifetime(now+2*60*60*1000,now).clock,'02:00:00');
 assert.equal(roomLifetime(now+70*60*1000,now).clock,'01:10:00');
});
test('unknown expiry is not treated as a live five-hour invitation',()=>{
 for(const expiresAt of [undefined,null,NaN,Infinity,'future'])assert.equal(roomLifetime(expiresAt,now).known,false);
});
test('saved host roles require all credentials and an unexpired known deadline',()=>{
 assert.equal(validHostSession(saved,now),true); // Legacy format has no cached deadline.
 assert.equal(validHostSession({...saved,expiresAt:now+1},now),true);
 for(const expiresAt of [now,now-1,null,NaN,Infinity,'later'])assert.equal(validHostSession({...saved,expiresAt},now),false);
 for(const candidate of [null,{}, {...saved,roomId:'short'}, {...saved,hostToken:undefined}])assert.equal(validHostSession(candidate,now),false);
});
test('ordinary gallery links start a shared lecture including old versioned bookmarks',()=>{
 const base='https://example.test/emotion-exhibition/';
 for(const suffix of ['', '#', '#gallery-panel', '?v=20261029-contribution#gallery-panel', '?v=20261103-lectern5h']){
  assert.equal(shouldAutoCreateHost(base+suffix),true,suffix);
 }
});
test('camera-only and individual artwork entries do not silently create rooms',()=>{
 const base='https://example.test/emotion-exhibition/';
 for(const view of ['capture','portrait','music','scent']){
  assert.equal(shouldAutoCreateHost(base+`#${view}-panel`),false,view);
  assert.equal(shouldAutoCreateHost(base+`?mode=host#${view}-panel`),true,view);
 }
});
test('personal mode remains an explicit opt-out after leaving and refreshing',()=>{
 const base='https://example.test/emotion-exhibition/';
 for(const suffix of ['?mode=personal','?mode=personal#gallery-panel','?v=old&mode=personal#gallery-panel','?mode=host&mode=personal#gallery-panel']){
  assert.equal(shouldAutoCreateHost(base+suffix),false,suffix);
 }
});
test('incoming or saved rooms always prevent creating a second room',()=>{
 for(const url of ['https://example.test/','https://example.test/?mode=host#gallery-panel']){
  assert.equal(shouldAutoCreateHost(url,{hasInvitation:true}),false);
  assert.equal(shouldAutoCreateHost(url,{hasSavedHost:true}),false);
 }
});
test('valid and malformed invitation fields never become host entries',()=>{
 const base='https://example.test/';
 for(const query of [`room=${saved.roomId}&join=${saved.joinToken}`, 'room=invalid&join=invalid', 'room=', 'join=', 'room=a&room=b']){
  for(const prefix of ['', '?mode=host']){
   assert.equal(shouldAutoCreateHost(base+prefix+'#gallery-panel?'+query),false,query);
  }
  assert.equal(shouldAutoCreateHost(base+'?mode=host&'+query+'#gallery-panel'),false,query);
 }
});
test('invalid URLs and unrecognized or ambiguous modes do not create rooms',()=>{
 for(const url of ['invalid','javascript:alert(1)','file:///tmp/gallery.html','https://example.test/?mode=unknown','https://example.test/?mode=host&mode=host']){
  assert.equal(shouldAutoCreateHost(url),false,url);
 }
});
