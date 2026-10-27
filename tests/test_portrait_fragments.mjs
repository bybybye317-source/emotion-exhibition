import test from 'node:test';
import assert from 'node:assert/strict';
import {fragmentSlot, planPatchAssignments, PATCH_SEEDS} from '../static/portrait-math.mjs';
import {paintCollage} from '../static/portrait-collage.mjs';

const person=sequence=>({id:`visitor-${sequence}`,slot:fragmentSlot(sequence)});
const owners=records=>planPatchAssignments(records).map(patch=>patch.participantId);
const changedSlots=(before,after)=>before.flatMap((id,index)=>id===after[index]?[]:[index]);

test('empty face is a complete set of twenty distinct seed regions',()=>{
  const patches=planPatchAssignments([]);
  assert.equal(patches.length,20);
  assert.deepEqual(patches.map(patch=>patch.seedIndex),Array.from({length:20},(_,i)=>i));
  assert(patches.every(patch=>patch.recordIndex===null));
  assert(PATCH_SEEDS.every(([x,y])=>x>=.2 && x<=.8 && y>=.1 && y<=.9));
});

test('each arriving participant changes exactly one region without moving earlier fragments',()=>{
  const records=[];
  for(let sequence=0;sequence<20;sequence++) {
    const before=owners(records);
    records.push(person(sequence));
    const after=owners(records);
    assert.deepEqual(changedSlots(before,after),[fragmentSlot(sequence)]);
    for(const record of records) assert.equal(after.filter(id=>id===record.id).length,1);
  }
  assert.equal(new Set(records.map(record=>record.slot)).size,20);
  assert.equal(fragmentSlot(0),4,'first visitor contributes the visible left eye region');
});

test('rolling twenty-person capacity replaces only the oldest fragment for multiple cycles',()=>{
  const records=Array.from({length:20},(_,sequence)=>person(sequence));
  for(let sequence=20;sequence<65;sequence++) {
    const before=owners(records), removed=records.shift(), added=person(sequence);
    records.push(added);
    const after=owners(records);
    assert.equal(added.slot,removed.slot);
    assert.deepEqual(changedSlots(before,after),[removed.slot]);
    assert.equal(after[added.slot],added.id);
    assert.equal(new Set(after).size,20);
  }
});

test('reordering or removing explicit-slot records cannot redistribute surviving people',()=>{
  const records=Array.from({length:9},(_,sequence)=>person(sequence));
  const before=owners(records);
  assert.deepEqual(owners([...records].reverse()),before);
  const deleted=records[3];
  const after=owners(records.filter(record=>record!==deleted));
  assert.deepEqual(changedSlots(before,after),[deleted.slot]);
  assert.equal(after[deleted.slot],null);
});

test('newest duplicate slot or participant record wins without assigning a person twice',()=>{
  const records=[{id:'A',slot:1},{id:'B',slot:2},{id:'A',slot:3},{id:'C',slot:2}];
  const plan=planPatchAssignments(records);
  assert.equal(plan[1].recordIndex,null);
  assert.equal(plan[2].participantId,'C');
  assert.equal(plan[3].participantId,'A');
  assert.equal(plan.filter(patch=>patch.participantId==='A').length,1);
  assert.equal(plan.filter(patch=>patch.participantId==='B').length,0);
});

test('invalid explicit slots do not leak a photo into an unrelated region',()=>{
  const records=[null,{id:'negative',slot:-1},{id:'outside',slot:20},{id:'fraction',slot:1.5},{id:'text',slot:'4'}];
  assert(planPatchAssignments(records).every(patch=>patch.recordIndex===null));
  assert.throws(()=>fragmentSlot(-1),RangeError);
  assert.throws(()=>fragmentSlot(Infinity),RangeError);
  assert.throws(()=>fragmentSlot(.5),RangeError);
  assert.throws(()=>planPatchAssignments([],0),RangeError);
});

// The painter needs only Canvas 2D operations. Recording source-image draws
// verifies the real compositing path without a GPU or photographed fixture.
function paintedSources(photos,records,seeds) {
  const draws=[];
  const context=()=>({
    save(){},restore(){},setTransform(){},fillRect(){},clearRect(){},
    beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},
    drawImage(image){if(image?.sourceLabel)draws.push(image.sourceLabel);},
  });
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{
    createElement(){return {width:0,height:0,getContext:context};},
  }});
  try {paintCollage(context(),photos,128,'#aaa',{records,seedImages:seeds});}
  finally {
    if(previous)Object.defineProperty(globalThis,'document',previous);
    else delete globalThis.document;
  }
  return draws;
}

const seeds=Array.from({length:20},(_,i)=>({sourceLabel:`seed-${i}`}));

test('one live portrait is painted once while nineteen distinct seed photos remain',()=>{
  const record=person(0);
  const draws=paintedSources([{sourceLabel:'live-A'}],[record],seeds);
  assert.equal(draws.length,20);
  assert.equal(draws.filter(source=>source==='live-A').length,1);
  assert.equal(draws[record.slot],'live-A');
  for(let slot=0;slot<20;slot++) if(slot!==record.slot)assert.equal(draws[slot],`seed-${slot}`);
});

test('failed middle photo restores only its seed and does not shift adjacent contributors',()=>{
  const records=[person(0),person(1),person(2)];
  const draws=paintedSources([{sourceLabel:'live-A'},null,{sourceLabel:'live-C'}],records,seeds);
  assert.equal(draws.length,20);
  assert.equal(draws[records[0].slot],'live-A');
  assert.equal(draws[records[1].slot],`seed-${records[1].slot}`);
  assert.equal(draws[records[2].slot],'live-C');
  assert.equal(draws.filter(source=>source.startsWith('live-')).length,2);
});

test('missing seed photos use clay rather than repeating any live participant',()=>{
  const draws=paintedSources([{sourceLabel:'live-A'}],[person(0)],[]);
  assert.deepEqual(draws,['live-A']);
  assert.deepEqual(paintedSources([],[],seeds),seeds.map(seed=>seed.sourceLabel));
});
