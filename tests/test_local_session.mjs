import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalSession,normalizedScores} from '../static/session-state.mjs';
import {fragmentSlot,planPatchAssignments} from '../static/portrait-math.mjs?v=20261027-fragments';
test('observations average equally while a score distribution normalizes scale',()=>{const session=new LocalSession();session.add({scores:{happiness:30},photoUrl:'blob:first'});session.add({scores:{sadness:1},photoUrl:'blob:second'});const snap=session.snapshot();assert.equal(snap.participant_count,2);assert.equal(snap.group_scores.happiness,.5);assert.equal(snap.group_scores.sadness,.5);snap.participants[0].scores.happiness=0;assert.equal(session.snapshot().group_scores.happiness,.5);});
test('last twenty local photos release the oldest and clear releases remaining photos',()=>{const released=[];const session=new LocalSession({onRelease:url=>released.push(url)});for(let i=0;i<22;i++)session.add({scores:{neutral:1},photoUrl:`blob:${i}`});assert.equal(session.snapshot().participant_count,20);assert.deepEqual(released,['blob:0','blob:1']);session.reset();assert.equal(released.length,22);assert.deepEqual(session.snapshot().group_scores,{});});
test('invalid results cannot create participants and huge finite scores remain normalized',()=>{const session=new LocalSession();assert.throws(()=>session.add({scores:{happiness:NaN},photoUrl:'blob:test'}));assert.throws(()=>session.add({scores:{happiness:1},photoUrl:'https://example.com/photo.jpg'}));assert.equal(session.snapshot().participant_count,0);assert.equal(normalizedScores({fear:Number.MAX_VALUE,surprise:Number.MAX_VALUE}).fear,.5);assert.equal(normalizedScores({neutral:'1'}),null);});

const addPerson=(session,index)=>session.add({scores:{neutral:1},photoUrl:`blob:visitor-${index}`});
const patchOwners=session=>planPatchAssignments(session.snapshot().participants).map(patch=>patch.participantId);

test('first, second and twentieth contributions retain unique slots in snapshots',()=>{
  const session=new LocalSession();
  for(let index=0;index<20;index++) {
    const earlier=session.snapshot().participants;
    const id=addPerson(session,index);
    const snapshot=session.snapshot();
    assert.equal(snapshot.participant_count,index+1);
    assert.equal(snapshot.participants.at(-1).id,id);
    assert.equal(snapshot.participants.at(-1).slot,fragmentSlot(index));
    assert.deepEqual(snapshot.participants.slice(0,-1),earlier);
    assert.equal(new Set(snapshot.participants.map(person=>person.slot)).size,index+1);
  }
  const detached=session.snapshot();
  detached.participants[0].slot=999;
  assert.equal(session.snapshot().participants[0].slot,fragmentSlot(0));
});

test('twenty-first contribution and later rotations reuse only the oldest retained slot',()=>{
  const released=[],session=new LocalSession({onRelease:url=>released.push(url)});
  for(let index=0;index<20;index++)addPerson(session,index);
  for(let index=20;index<45;index++) {
    const oldest=session.snapshot().participants[0];
    const before=patchOwners(session);
    const id=addPerson(session,index),after=patchOwners(session);
    assert.equal(session.snapshot().participant_count,20);
    assert.equal(session.snapshot().participants.at(-1).slot,oldest.slot);
    assert.equal(after[oldest.slot],id);
    assert.deepEqual(before.flatMap((owner,slot)=>owner===after[slot]?[]:[slot]),[oldest.slot]);
    assert.equal(released.at(-1),oldest.image_url);
  }
  assert.equal(released.length,25);
});

test('reset removes all observations and restarts fragment order without seed participants',()=>{
  const released=[],session=new LocalSession({onRelease:url=>released.push(url)});
  for(let index=0;index<4;index++)addPerson(session,index);
  session.reset();
  assert.deepEqual(session.snapshot(),{participants:[],participant_count:0,group_scores:{}});
  assert.equal(released.length,4);
  assert.equal(session.sequence,0);
  addPerson(session,100);
  assert.equal(session.snapshot().participants[0].slot,fragmentSlot(0));
  assert.equal(session.snapshot().participant_count,1);
});

test('invalid observations do not consume a fragment position',()=>{
  const session=new LocalSession();
  assert.throws(()=>session.add({scores:{neutral:NaN},photoUrl:'blob:invalid'}));
  assert.throws(()=>session.add({scores:{neutral:1},photoUrl:'https://example.com/photo.jpg'}));
  assert.equal(session.sequence,0);
  addPerson(session,0);
  assert.equal(session.snapshot().participants[0].slot,fragmentSlot(0));
});

test('custom capacity preserves its retention and release behavior without expanding beyond twenty',()=>{
  const released=[],session=new LocalSession({limit:3,onRelease:url=>released.push(url)});
  for(let index=0;index<6;index++)addPerson(session,index);
  const snapshot=session.snapshot();
  assert.equal(snapshot.participant_count,3);
  assert.deepEqual(released,['blob:visitor-0','blob:visitor-1','blob:visitor-2']);
  assert.deepEqual(snapshot.participants.map(person=>person.slot),[3,4,5].map(index=>fragmentSlot(index)));
  assert.deepEqual(snapshot.participants.map(person=>person.image_url),['blob:visitor-3','blob:visitor-4','blob:visitor-5']);
  const capped=new LocalSession({limit:100});
  for(let index=0;index<21;index++)addPerson(capped,index);
  assert.equal(capped.snapshot().participant_count,20);
});
