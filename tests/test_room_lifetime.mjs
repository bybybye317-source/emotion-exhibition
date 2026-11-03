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
test('only the explicit desktop host entry starts a new lecture',()=>{
 const base='https://example.test/emotion-exhibition/';
 assert.equal(shouldAutoCreateHost(base),false);
 assert.equal(shouldAutoCreateHost(base+'?mode=host#gallery-panel'),true);
 assert.equal(shouldAutoCreateHost(base+'?mode=host',{hasInvitation:true}),false);
 assert.equal(shouldAutoCreateHost(base+'?mode=host',{hasSavedHost:true}),false);
 assert.equal(shouldAutoCreateHost(base+'?mode=host#capture-panel?room=invalid&join=invalid'),false);
 assert.equal(shouldAutoCreateHost('invalid'),false);
});
