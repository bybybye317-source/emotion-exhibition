import test from 'node:test';
import assert from 'node:assert/strict';
import {photoWarpGeometry} from '../static/portrait-collage.mjs';
import {affineFromTriangles} from '../static/portrait-math.mjs';

const source={left_eye:[.30,.35],right_eye:[.70,.35],nose:[.50,.55],mouth:[.50,.75],
  mouth_left:[.32,.72],mouth_right:[.68,.72],mouth_upper_outer:[.50,.66],mouth_upper_inner:[.50,.70],mouth_lower_inner:[.50,.80],mouth_lower_outer:[.50,.84]};
const target={left_eye:[320,330],right_eye:[704,330],nose:[512,540],mouth:[512,701],
  mouth_left:[355,700],mouth_right:[669,700],mouth_upper_outer:[512,680],mouth_upper_inner:[512,699],mouth_lower_inner:[512,703],mouth_lower_outer:[512,724]};
const area=([a,b,c])=>((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;

test('lip-aware warp covers the full atlas without triangle overlaps or a duplicate mouth center',()=>{
  const warp=photoWarpGeometry(source,1000,1000,target,1024);
  assert(warp.denseMouth);assert.equal(warp.source.length,13);assert.equal(warp.triangles.length,20);
  const areas=warp.triangles.map(triangle=>area(triangle.map(index=>warp.target[index])));
  assert(areas.every(value=>value>0));
  assert.equal(areas.reduce((sum,value)=>sum+value,0),1024*1024);
  assert(!warp.target.includes(target.mouth));
  for(const triangle of warp.triangles) {
    const matrix=affineFromTriangles(triangle.map(i=>warp.source[i]),triangle.map(i=>warp.target[i]));
    assert(matrix&&matrix.every(Number.isFinite));
    for(const index of triangle) {
      const [x,y]=warp.source[index],[u,v]=warp.target[index];
      assert(Math.abs(matrix[0]*x+matrix[2]*y+matrix[4]-u)<1e-8);
      assert(Math.abs(matrix[1]*x+matrix[3]*y+matrix[5]-v)<1e-8);
    }
  }
});

test('photographed opening compresses independently from the upper and lower lip tissue',()=>{
  const warp=photoWarpGeometry(source,1000,1000,target,1024);
  assert.equal(warp.source[11][1]-warp.source[10][1],100);
  assert.equal(warp.target[11][1]-warp.target[10][1],4);
  assert.equal(warp.target[10][1]-warp.target[9][1],19);
  assert.equal(warp.target[12][1]-warp.target[11][1],21);
  const closed={...target,mouth_lower_inner:target.mouth_upper_inner};
  const collapsed=photoWarpGeometry(source,1000,1000,closed,1024);
  assert.equal(collapsed.triangles.reduce((sum,triangle)=>sum+area(triangle.map(i=>collapsed.target[i])),0),1024*1024);
  for(const triangle of collapsed.triangles)assert(affineFromTriangles(triangle.map(i=>collapsed.source[i]),triangle.map(i=>collapsed.target[i])).every(Number.isFinite));
});

test('existing four-point photos still use their original nose and mouth alignment',()=>{
  const old={left_eye:source.left_eye,right_eye:source.right_eye,nose:source.nose,mouth:source.mouth};
  const warp=photoWarpGeometry(old,1000,1000,target,1024);
  assert.equal(warp.denseMouth,false);assert.equal(warp.triangles.length,10);
  assert.deepEqual(warp.source[7],[500,750]);assert.deepEqual(warp.target[7],target.mouth);
  assert.equal(photoWarpGeometry({...old,nose:[NaN,.5]},1000,1000,target,1024),null);
});

const contour=(middle)=>Array.from({length:11},(_,i)=>{
  const t=i/10;return [.335+.33*t,.72+4*t*(1-t)*(middle-.72)];
});
const contourSource={...source,mouth_upper_contour:contour(.70),mouth_lower_contour:contour(.80)};

test('full lip contours preserve curved smile shoulders inside the narrow opening',()=>{
  const warp=photoWarpGeometry(contourSource,1000,1000,target,1024);
  assert.equal(warp.contourMouth,true);assert.equal(warp.triangles.length,88);
  let total=0;
  for(const triangle of warp.triangles) {
    const sourceArea=area(triangle.map(i=>warp.source[i])),targetArea=area(triangle.map(i=>warp.target[i]));
    assert(sourceArea>=0);assert(targetArea>=0);total+=targetArea;
  }
  assert(Math.abs(total-1024*1024)<1e-6);
  for(const triangle of warp.triangles.slice(warp.openingTriangleStart)) {
    for(const index of triangle)assert(warp.target[index][1]>=699&&warp.target[index][1]<=703);
  }
  assert.equal(new Set(warp.target.map(point=>point.join(','))).size,warp.target.length);
});

test('closed source contours stay finite and missing contours retain the six-point fallback',()=>{
  const closed={...contourSource,mouth_lower_contour:contourSource.mouth_upper_contour,mouth_lower_inner:contourSource.mouth_upper_inner};
  const warp=photoWarpGeometry(closed,1000,1000,target,1024);
  assert.equal(warp.denseMouth,true);
  for(const triangle of warp.triangles) {
    const matrix=affineFromTriangles(triangle.map(i=>warp.source[i]),triangle.map(i=>warp.target[i]));
    assert(matrix===null||matrix.every(Number.isFinite));
  }
  const fallback=photoWarpGeometry({...contourSource,mouth_upper_contour:[]},1000,1000,target,1024);
  assert.equal(fallback.denseMouth,true);assert.equal(fallback.contourMouth,undefined);assert.equal(fallback.triangles.length,20);
});
