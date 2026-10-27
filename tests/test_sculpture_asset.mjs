import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {POSES, morphWeights} from '../static/portrait-math.mjs';

// Decode the shipped asset independently of Three.js: a malformed sparse
// accessor must fail here even when a renderer silently displays the base pose.
const file=readFileSync(new URL('../static/models/sculpture-head.glb',import.meta.url));
assert.equal(file.readUInt32LE(0),0x46546c67,'GLB magic');
assert.equal(file.readUInt32LE(4),2,'glTF 2');
assert.equal(file.readUInt32LE(8),file.length,'complete GLB');
let document, binary;
for(let offset=12;offset<file.length;){
  const length=file.readUInt32LE(offset),kind=file.readUInt32LE(offset+4);
  assert(offset+8+length<=file.length,'chunk is in bounds');
  const chunk=file.subarray(offset+8,offset+8+length);
  if(kind===0x4e4f534a)document=JSON.parse(chunk.toString());
  if(kind===0x004e4942)binary=chunk;
  offset+=8+length;
}
assert(document&&binary,'JSON and BIN chunks');
const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
const components={5123:{bytes:2,read:'readUInt16LE'},5125:{bytes:4,read:'readUInt32LE'},5126:{bytes:4,read:'readFloatLE'}};
const decoded=new Map();
function readValues(viewIndex,offset,count,width,componentType){
  const view=document.bufferViews[viewIndex],component=components[componentType];
  assert(view&&component,'supported buffer view and component');
  assert.equal(view.buffer,0,'single embedded GLB buffer');
  const start=(view.byteOffset||0)+offset,stride=view.byteStride||width*component.bytes;
  assert(stride>=width*component.bytes,'element stride');
  assert(offset+(count?((count-1)*stride+width*component.bytes):0)<=view.byteLength,'accessor fits view');
  assert((view.byteOffset||0)+view.byteLength<=binary.length,'view fits BIN');
  const result=new Float64Array(count*width);
  for(let row=0;row<count;row++)for(let column=0;column<width;column++)
    result[row*width+column]=binary[component.read](start+row*stride+column*component.bytes);
  return result;
}
function accessor(index){
  if(decoded.has(index))return decoded.get(index);
  const a=document.accessors[index],width=widths[a.type];
  assert(width&&Number.isInteger(a.count)&&a.count>0,'accessor count and type');
  assert(!a.normalized,'export uses real coordinates, not normalized integer deltas');
  const values=a.bufferView===undefined?new Float64Array(a.count*width):readValues(a.bufferView,a.byteOffset||0,a.count,width,a.componentType);
  if(a.sparse){
    const sparse=a.sparse;
    assert(sparse.count>0&&sparse.count<=a.count,'sparse count');
    const indices=readValues(sparse.indices.bufferView,sparse.indices.byteOffset||0,sparse.count,1,sparse.indices.componentType);
    const patches=readValues(sparse.values.bufferView,sparse.values.byteOffset||0,sparse.count,width,a.componentType);
    let previous=-1;
    for(let row=0;row<indices.length;row++){
      const vertex=indices[row];
      assert(Number.isInteger(vertex)&&vertex>previous&&vertex<a.count,'ordered in-range sparse index');
      for(let c=0;c<width;c++)values[vertex*width+c]=patches[row*width+c];
      previous=vertex;
    }
  }
  for(const value of values)assert(Number.isFinite(value),'finite decoded value');
  decoded.set(index,values);return values;
}
const head=document.meshes.find(mesh=>mesh.name==='SculptureHead');
assert(head,'named face mesh');
const primitive=head.primitives[0],names=head.extras.targetNames;
const position=accessor(primitive.attributes.POSITION),normal=accessor(primitive.attributes.NORMAL),indices=accessor(primitive.indices);
const count=position.length/3;
const projection=document.scenes[document.scene||0].extras;
const point=(values,index)=>Array.from(values.subarray(index*3,index*3+3));
const norm=(x,y,z)=>Math.hypot(x,y,z);
function poseDelta(emotion){
  const out=new Float64Array(position.length);
  for(const [name,weight] of Object.entries(morphWeights({[emotion]:1}))){
    const target=primitive.targets[names.indexOf(name)],delta=accessor(target.POSITION);
    for(let i=0;i<out.length;i++)out[i]+=delta[i]*weight;
  }
  return out;
}

test('sculpture ships separate eyes and self-contained calibrated face geometry',()=>{
  assert.equal(document.asset.version,'2.0');
  assert.deepEqual(document.meshes.map(mesh=>mesh.name),['SculptureHead','EyeLeft','EyeRight']);
  assert(count>8000,'enough surface detail for the sculpture silhouette');
  assert.equal(normal.length,position.length);
  assert(indices.length>count*3&&indices.length%3===0);
  for(const index of indices)assert(Number.isInteger(index)&&index>=0&&index<count);
  assert.equal(document.images?.length||0,0,'audience photos remain runtime textures');
  assert.equal(document.buffers.length,1);assert(!document.buffers[0].uri,'no external binary dependency');
  const {left,right,top,bottom}=projection.bounds;
  assert([left,right,top,bottom].every(Number.isFinite));
  assert(left<0&&right>0&&bottom<0&&top>0&&top-bottom>2);
  assert.deepEqual(document.asset.extras.portrait.landmarks,projection.landmarks);
  for(let i=0;i<position.length;i+=3){
    assert(position[i]>=left-1e-5&&position[i]<=right+1e-5);
    assert(position[i+1]>=bottom-1e-5&&position[i+1]<=top+1e-5);
  }
});

test('photo anchors preserve viewer orientation and lie on the intended facial features',()=>{
  const {bounds,landmarks,landmarks3d,landmarkVertexIndices}=projection;
  for(const name of ['left_eye','right_eye','nose','mouth','mouth_left','mouth_right','mouth_upper_inner','mouth_lower_inner','mouth_upper_outer','mouth_lower_outer'])assert(name in landmarks,`missing anchor ${name}`);
  assert(landmarks.left_eye[0]<0&&landmarks.right_eye[0]>0);
  assert(Math.abs(landmarks.left_eye[1]-landmarks.right_eye[1])<.03,'level eye line');
  assert(landmarks.left_eye[1]>landmarks.nose[1]&&landmarks.nose[1]>landmarks.mouth[1]);
  assert(landmarks3d.nose[2]>landmarks3d.left_eye[2]+.25,'nose projects in front of eye sockets');
  const innerGap=landmarks.mouth_upper_inner[1]-landmarks.mouth_lower_inner[1];
  assert(innerGap>0&&innerGap<.035,'neutral lip sheets form a narrow correctly ordered slit');
  assert(landmarks.mouth_upper_outer[1]>landmarks.mouth_upper_inner[1]);
  assert(landmarks.mouth_lower_outer[1]<landmarks.mouth_lower_inner[1]);
  assert(landmarks.mouth_left[0]<-.15&&landmarks.mouth_right[0]>.15,'lip corners span the mouth');
  for(let axis=0;axis<2;axis++)assert(Math.abs(landmarks.mouth[axis]-(landmarks.mouth_upper_inner[axis]+landmarks.mouth_lower_inner[axis])/2)<1e-8,'mouth center is between lip sheets');
  for(const [name,[x,y]] of Object.entries(landmarks)){
    const u=(x-bounds.left)/(bounds.right-bounds.left),v=(bounds.top-y)/(bounds.top-bounds.bottom);
    assert(u>.05&&u<.95&&v>.05&&v<.95,`${name} projects inside the photo atlas`);
    const landmark=landmarks3d[name],index=landmarkVertexIndices[name];
    assert(Number.isInteger(index)&&index>=0&&index<count);
    const actual=point(position,index);
    assert(norm(...actual.map((value,c)=>value-landmark[c]))<.13,`${name} is near actual mesh surface`);
  }
});

test('neutral normals and front triangle winding point toward the viewer',()=>{
  for(let i=0;i<normal.length;i+=3)assert(Math.abs(norm(normal[i],normal[i+1],normal[i+2])-1)<1e-4,'unit base normal');
  let front=0,frontFacing=0,aligned=0,checked=0;
  for(let i=0;i<indices.length;i+=3){
    const [a,b,c]=Array.from(indices.subarray(i,i+3),index=>point(position,index));
    const ab=b.map((v,k)=>v-a[k]),ac=c.map((v,k)=>v-a[k]);
    const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    const length=norm(...cross);if(length<1e-12)continue;
    const vertexNormal=point(normal,indices[i]);
    if(cross.reduce((sum,v,k)=>sum+v*vertexNormal[k],0)>0)aligned++;
    checked++;
    const center=a.map((v,k)=>(v+b[k]+c[k])/3);
    if(Math.abs(center[0])<.55&&center[1]>.45&&center[2]>.15){front++;if(cross[2]>0)frontFacing++;}
  }
  assert(checked>10000&&aligned/checked>.99,'triangle winding agrees with outward vertex normals');
  assert(front>100&&frontFacing/front>.98,'forehead front is not reversed');
});

test('all required expressions decode from sparse deltas with valid changing normals',()=>{
  assert.equal(new Set(names).size,names.length);
  assert.equal(primitive.targets.length,names.length);
  const required=new Set(Object.values(POSES).flatMap(pose=>Object.keys(pose)));
  for(const name of required)assert(names.includes(name),`missing expression ${name}`);
  for(let targetIndex=0;targetIndex<names.length;targetIndex++){
    const target=primitive.targets[targetIndex],delta=accessor(target.POSITION),normalDelta=accessor(target.NORMAL);
    assert.equal(delta.length,position.length);assert.equal(normalDelta.length,normal.length);
    let moved=0,changedLight=0;
    for(let i=0;i<delta.length;i+=3){
      if(norm(delta[i],delta[i+1],delta[i+2])>.0001)moved++;
      if(norm(normalDelta[i],normalDelta[i+1],normalDelta[i+2])>.0001)changedLight++;
      assert(Math.abs(norm(normal[i]+normalDelta[i],normal[i+1]+normalDelta[i+1],normal[i+2]+normalDelta[i+2])-1)<.0001,
        `unit posed normal for ${names[targetIndex]}`);
    }
    assert(moved>10&&changedLight>10,`${names[targetIndex]} changes both shape and lighting`);
  }
});

test('joy, sadness, anger and fear produce distinct visible sculptural deformations',()=>{
  const emotions=['happiness','sadness','anger','fear'],deltas=emotions.map(poseDelta);
  for(let k=0;k<deltas.length;k++){
    const delta=deltas[k];let sum=0,max=0;
    for(let i=0;i<delta.length;i+=3){
      const displacement=norm(delta[i],delta[i+1],delta[i+2]);sum+=displacement*displacement;max=Math.max(max,displacement);
      for(let axis=0;axis<3;axis++)assert(Math.abs(position[i+axis]+delta[i+axis])<1.8,'bounded posed face');
    }
    assert(Math.sqrt(sum/count)>.008&&max>.04,`${emotions[k]} is visibly different from neutral`);
    for(let j=0;j<k;j++){
      const distance=Math.sqrt(delta.reduce((sum,value,i)=>sum+(value-deltas[j][i])**2,0)/count);
      assert(distance>.015,`${emotions[k]} and ${emotions[j]} are different shapes`);
    }
  }
});
