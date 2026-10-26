import test from 'node:test';
import assert from 'node:assert/strict';
import {HEAD_ANCHORS,HEAD_MORPHS,faceSurface,headGeometryData,headMorphDelta,expressionDetails} from '../static/procedural-head.mjs';
import {POSES,morphWeights} from '../static/portrait-math.mjs';
const data=headGeometryData(48,40);

test('original head is a finite, indexed full mesh with valid front projection UVs',()=>{
  assert.equal(data.positions.length,49*41*3);
  assert.equal(data.uv.length,49*41*2);
  for(const value of [...data.positions,...data.uv])assert(Number.isFinite(value));
  assert([...data.indices].every(index=>index>=0&&index<data.positions.length/3));
  assert([...data.uv].every(value=>value>=0&&value<=1.05));
  const z=Array.from({length:data.positions.length/3},(_,i)=>data.positions[i*3+2]);
  assert(Math.min(...z)<-.9); assert(Math.max(...z)>.8);
});

test('front triangle winding points outwards rather than into the sculpture',()=>{
  let checked=0;
  for(let i=0;i<data.indices.length;i+=3) {
    const points=Array.from(data.indices.subarray(i,i+3),j=>data.positions.subarray(j*3,j*3+3));
    const [a,b,c]=points;
    if(points.some(p=>p[2]<.3||Math.abs(p[0])>.4))continue;
    const nz=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    assert(nz>0); checked++;
  }
  assert(checked>20);
});

test('sculpted nose and recessed eye positions agree with the four photo anchors',()=>{
  assert.deepEqual(Object.keys(HEAD_ANCHORS),['left_eye','right_eye','nose','mouth']);
  assert.equal(HEAD_ANCHORS.left_eye[1],HEAD_ANCHORS.right_eye[1]);
  assert(faceSurface(...HEAD_ANCHORS.nose)>faceSurface(...HEAD_ANCHORS.left_eye)+.3);
  assert(Math.abs(faceSurface(...HEAD_ANCHORS.left_eye)-faceSurface(...HEAD_ANCHORS.right_eye))<.0001);
});

test('every requested artistic expression has real, finite surface deformation',()=>{
  const used=new Set(Object.values(POSES).flatMap(p=>Object.keys(p)));
  for(const name of used) {
    assert(HEAD_MORPHS.includes(name),name);
    assert.equal(data.morphs[name].length,data.positions.length);
    assert([...data.morphs[name]].every(Number.isFinite));
    assert([...data.morphs[name]].some(v=>Math.abs(v)>.0001),name);
  }
  assert.equal(new Set(HEAD_MORPHS).size,HEAD_MORPHS.length);
});

test('jaw opens at the face but leaves the back of the head stationary',()=>{
  const delta=headMorphDelta('jawOpen',0,-.65,.45);
  assert(delta[1]<-.1);assert(delta[2]<0);
  assert.deepEqual(headMorphDelta('jawOpen',0,-.65,-.7),[0,0,0]);
});

for(const emotion of Object.keys(POSES))test(`${emotion} pose keeps bounded finite sculpture and attached details`,()=>{
  const weights=morphWeights({[emotion]:1}), details=expressionDetails(weights);
  assert(details.mouthHeight>0&&details.mouthHeight<.2);
  assert(details.mouthWidth>.15&&details.mouthWidth<.4);
  for(let i=0;i<data.positions.length;i++) {
    let value=data.positions[i];
    for(const [name,weight] of Object.entries(weights))value+=data.morphs[name][i]*weight;
    assert(Number.isFinite(value)&&Math.abs(value)<1.5);
  }
  for(const side of details.sides)assert(side.eye>=.16&&side.eye<=1.35);
});

test('neutral, joy, sadness and surprise retain distinct mouth and eye gestures',()=>{
  const state=emotion=>expressionDetails(morphWeights({[emotion]:1}));
  assert(state('surprise').mouthHeight>state('neutral').mouthHeight*4);
  assert(state('surprise').sides[0].eye>state('neutral').sides[0].eye);
  assert(state('happiness').sides[0].smile>.8);
  assert(state('sadness').sides[0].frown>.8);
  assert(state('contempt').sides[0].smile>state('contempt').sides[1].smile);
});

test('external detail weights and mesh resolution cannot create non-finite buffers',()=>{
  const d=expressionDetails({jawOpen:Infinity,mouthFunnel:NaN,eyeWide_L:100,eyeBlink_R:-1});
  assert.equal(d.jaw,0);assert.equal(d.funnel,0);assert(Number.isFinite(d.sides[0].eye));
  for(const dimensions of [[0,0],[-4,50],[161,40],[40,NaN]])assert.throws(()=>headGeometryData(...dimensions),RangeError);
});
