import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {anatomicalFragmentCells} from '../static/portrait-regions.mjs';
import {calibratedProjection} from '../static/portrait-features.mjs';
import {photoWarpGeometry} from '../static/portrait-collage.mjs';
import {contributionMotion,FragmentArrival} from '../static/portrait-arrival.mjs';
const file=fs.readFileSync(new URL('../static/models/sculpture-head.glb',import.meta.url));
const size=file.readUInt32LE(12),doc=JSON.parse(file.subarray(20,20+size)),binary=file.subarray(28+size);
const mesh=doc.meshes.find(m=>m.name==='SculptureHead'),accessor=doc.accessors[mesh.primitives[0].attributes.POSITION],view=doc.bufferViews[accessor.bufferView];
const pointAt=i=>[0,1,2].map(k=>binary.readFloatLE((view.byteOffset||0)+(accessor.byteOffset||0)+i*12+k*4));
const projection=calibratedProjection(doc.scenes[0].extras,pointAt);
const {left,right,top,bottom}=projection.bounds;
const normalized=([x,y])=>[(x-left)/(right-left),(top-y)/(top-bottom)];
const target=Object.fromEntries(Object.entries(projection.landmarks).map(([k,p])=>[k,normalized(p).map(v=>v*1024)]));
const area=(a,b,c)=>((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
function inside(p,polygon){let answer=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
 const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])answer=!answer;
}return answer;}
test('whole eyelids, brows, nose and lips belong to their own anatomical region',()=>{
 const cells=anatomicalFragmentCells();
 for(const [name,p] of Object.entries(projection.landmarks)){
  const slot=name.startsWith('left_')?4:name.startsWith('right_')?5:name.startsWith('mouth')?14:name==='nose'?9:null;
  if(slot!==null)assert(inside(normalized(p),cells[slot]),`${name} is cut by a seam`);
 }
});
test('real fictional-source feature warps keep full coverage, finite coordinates and positive orientation',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../static/portrait-seeds/manifest.json',import.meta.url)));
 for(const face of manifest.faces){
  const warp=photoWarpGeometry(face.photo_anchors,face.rect[2],face.rect[3],target,1024);
  assert(warp.featureCount>=10,`${face.id} needs local eye/brow alignment`);
  let total=0;
  for(const tri of warp.triangles){
   const src=tri.map(i=>warp.source[i]),dst=tri.map(i=>warp.target[i]);
   assert(src.flat().every(Number.isFinite));assert(area(...src)>=-1e-5,`${face.id} folds source`);
   assert(area(...dst)>=-1e-5,`${face.id} folds destination`);total+=area(...dst);
  }
  assert(Math.abs(total-1024*1024)<1e-5,`${face.id} has an uncovered/overlapping warp`);
 }
});
test('bad feature tracking cannot invert the baseline lip-constrained warp',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../static/portrait-seeds/manifest.json',import.meta.url)));
 const anchors={...manifest.faces[0].photo_anchors,left_eye_outer:[.99,.99],left_brow_middle:[NaN,0]};
 const warp=photoWarpGeometry(anchors,280,281,target,1024);
 assert(warp.triangles.every(t=>area(...t.map(i=>warp.source[i]))>=-1e-5));
});
test('contribution remains readable at source, travels before merging, and fades out at its destination',()=>{
 const begin=contributionMotion(.4);assert.equal(begin.travel,0);assert.equal(begin.opacity,1);assert.equal(begin.stage,'source');
 const flight=contributionMotion(1);assert(flight.travel>0&&flight.travel<1);assert.equal(flight.stage,'travelling');
 assert.equal(contributionMotion(1.5).travel,1);assert.equal(contributionMotion(2).opacity,0);
 assert.equal(contributionMotion(3.2).line,0);
 const arrival=new FragmentArrival();arrival.begin([4]);assert.equal(arrival.advance(.65).mix,0,'do not replace face before source has been shown');assert(arrival.advance(.6).mix>0);
});
test('hidden, cleared and reduced-motion contributions cannot leave a flying photograph behind',()=>{
 for(const state of [{active:false},{reduced:true}]){
  const motion=contributionMotion(1,state);assert.equal(motion.opacity,0);assert.equal(motion.line,0);
 }
 const arrival=new FragmentArrival();arrival.begin([4]);const before=arrival.advance(.5);assert.deepEqual(arrival.advance(60,{visible:false}),before);
 arrival.clear();assert.equal(contributionMotion(arrival.snapshot().elapsed,{active:arrival.snapshot().active}).opacity,0);
});
