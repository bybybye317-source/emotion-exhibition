import test from 'node:test';
import assert from 'node:assert/strict';
import {FRAGMENT_COUNT,OWNER_COUNT,FRAGMENTS_PER_PERSON,microFragmentCells,fragmentsForOwner,fragmentCenter,fragmentReveal} from '../static/portrait-fragments.mjs';
import {planPatchAssignments} from '../static/portrait-math.mjs';
import {LocalSession} from '../static/session-state.mjs';
import {blendCoveredPixels} from '../static/portrait-arrival.mjs';
const area=p=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
const cells=microFragmentCells();
test('192 small organic cells cover exactly the portrait atlas',()=>{
 assert.equal(cells.length,FRAGMENT_COUNT);assert.equal(FRAGMENT_COUNT,192);
 assert(Math.abs(cells.reduce((sum,p)=>sum+area(p),0)-1)<1e-9);
 for(const p of cells){assert(area(p)>.001);assert(area(p)<.05);assert(p.flat().every(x=>Number.isFinite(x)&&x>=0&&x<=1));}
});
test('every internal microedge is paired, without cracks or overlaps',()=>{
 const edges=new Map(),key=p=>p.map(x=>x.toFixed(10)).join(',');
 for(const p of cells)for(let i=0;i<p.length;i++){const a=key(p[i]),b=key(p[(i+1)%p.length]),k=[a,b].sort().join('|');edges.set(k,(edges.get(k)||0)+1);}
 for(const [edge,count] of edges){assert(count===1||count===2);if(count===1){const [a,b]=edge.split('|').map(x=>x.split(',').map(Number));assert(a[0]===b[0]&&(a[0]===0||a[0]===1)||a[1]===b[1]&&(a[1]===0||a[1]===1));}}
});
test('32 owners receive exactly six unique pieces in six distinct zones',()=>{
 const assigned=[];
 for(let owner=0;owner<OWNER_COUNT;owner++){
  const ids=fragmentsForOwner(owner);assert.equal(ids.length,FRAGMENTS_PER_PERSON);assigned.push(...ids);
  const zones=new Set(ids.map(i=>Math.floor((i%12)/4)+3*Math.floor(Math.floor(i/12)/8)));assert.equal(zones.size,6);
  const centers=ids.map(fragmentCenter);assert(Math.max(...centers.map(p=>p[0]))-Math.min(...centers.map(p=>p[0]))>.35);
 }
 assert.equal(new Set(assigned).size,192);assert.deepEqual(fragmentsForOwner(-1),[]);assert.deepEqual(fragmentsForOwner(32),[]);
});
test('visitor 33 replaces exactly the oldest six pieces and preserves group capacity',()=>{
 const s=new LocalSession();for(let i=0;i<32;i++)s.add({scores:{neutral:1},photoUrl:`blob:${i}`});
 const before=planPatchAssignments(s.records),old=s.records[0];s.add({scores:{happiness:1},photoUrl:'blob:33'});const after=planPatchAssignments(s.records);
 const changed=before.filter(p=>p.participantId!==after[p.slot].participantId).flatMap(p=>fragmentsForOwner(p.slot));
 assert.equal(s.records.length,32);assert.deepEqual(changed,fragmentsForOwner(old.slot));assert.equal(s.records.at(-1).slot,old.slot);
});
test('six reveals start successively and settle to the exact final photo',()=>{
 const values=Array.from({length:6},(_,i)=>fragmentReveal(.3,i));assert(values[0]>values[2]);assert.equal(values[5],0);
 for(let i=0;i<6;i++){assert.equal(fragmentReveal(0,i),0);assert.equal(fragmentReveal(1,i),1);}
});
test('interrupted joins snapshot per-fragment coverage instead of a single global blend',()=>{
 const from=new Uint8ClampedArray([100,100,100,255,100,100,100,255]);const to=new Uint8ClampedArray([230,180,140,255,230,180,140,255]);
 const old=new Uint8ClampedArray([0,0,0,255,0,0,0,255]),next=new Uint8ClampedArray([255,255,255,255,255,255,255,255]);
 blendCoveredPixels(from,to,old,next,.3,new Uint8ClampedArray([0,255,0,255,0,255,255,255]));assert(old[0]>0);assert.equal(old[4],0);assert.deepEqual([...from.slice(0,3)],[230,180,140]);
});
