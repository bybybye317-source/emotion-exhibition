import test from 'node:test';
import assert from 'node:assert/strict';
import {organicFragmentCells, voronoiCells, PATCH_SEEDS} from '../static/portrait-math.mjs';

const signedArea=points=>points.reduce((sum,[x,y],i)=>{
  const [u,v]=points[(i+1)%points.length];return sum+x*v-u*y;
},0)/2;
const pointKey=point=>point.join(',');
const onFrame=([x,y],[u,v])=>(x===u&&(x===0||x===1))||(y===v&&(y===0||y===1));
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);

test('curved fragments form one complete frame with exactly shared reversed seams',()=>{
  const cells=organicFragmentCells(),edges=new Map();
  assert.equal(cells.length,20);
  for(const [cellIndex,cell] of cells.entries())for(let i=0;i<cell.length;i++) {
    const a=cell[i],b=cell[(i+1)%cell.length];
    assert.notDeepEqual(a,b,'no zero-length edge');
    assert(a.every(value=>Number.isFinite(value)&&value>=0&&value<=1));
    const forward=pointKey(a)<pointKey(b);
    const key=forward?`${pointKey(a)}|${pointKey(b)}`:`${pointKey(b)}|${pointKey(a)}`;
    const occurrences=edges.get(key)||[];
    occurrences.push({cellIndex,forward,a,b});edges.set(key,occurrences);
  }
  let internal=0;
  for(const occurrences of edges.values()) {
    const first=occurrences[0];
    if(onFrame(first.a,first.b))assert.equal(occurrences.length,1);
    else {
      internal++;
      assert.equal(occurrences.length,2,'every interior segment has two owners');
      assert.notEqual(occurrences[0].cellIndex,occurrences[1].cellIndex);
      assert.notEqual(occurrences[0].forward,occurrences[1].forward);
      assert.deepEqual(occurrences[0].a,occurrences[1].b);
      assert.deepEqual(occurrences[0].b,occurrences[1].a);
    }
  }
  assert(internal>100,'seams are sampled curves rather than single straight edges');
  const areas=cells.map(signedArea);
  assert(areas.every(area=>area>1e-6),'all cells retain their orientation and positive area');
  assert(Math.abs(areas.reduce((sum,area)=>sum+area,0)-1)<1e-10);
});

const distanceToSegment=(p,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};

test('mask curvature is small and deterministic while the original partition stays unchanged',()=>{
  const seeds=structuredClone(PATCH_SEEDS),straight=voronoiCells(),curved=organicFragmentCells();
  let maximumDeviation=0;
  for(const [index,cell] of curved.entries())for(const point of cell) {
    const original=straight[index];
    const deviation=Math.min(...original.map((a,i)=>distanceToSegment(point,a,original[(i+1)%original.length])));
    maximumDeviation=Math.max(maximumDeviation,deviation);
    assert(deviation<=3.6/1024+1e-10,'curvature never displaces the patch into distant facial anatomy');
  }
  assert(maximumDeviation>.001,'the boundary visibly departs from a straight cut');
  assert.deepEqual(organicFragmentCells(),curved);
  assert.deepEqual(voronoiCells(),straight);
  assert.deepEqual(PATCH_SEEDS,seeds);
});

test('curved cells have no self intersections or collapsed boundary segments',()=>{
  for(const cell of organicFragmentCells())for(let i=0;i<cell.length;i++) {
    const a=cell[i],b=cell[(i+1)%cell.length];
    assert(Math.hypot(b[0]-a[0],b[1]-a[1])>1e-9);
    for(let j=i+2;j<cell.length;j++) {
      if(i===0&&j===cell.length-1)continue;
      const c=cell[j],d=cell[(j+1)%cell.length];
      assert(!(cross(a,b,c)*cross(a,b,d)<-1e-18 && cross(c,d,a)*cross(c,d,b)<-1e-18),
        'opposite edges may not cross');
    }
  }
});

test('a custom simple partition preserves its outer frame and ownership count',()=>{
  for(const seeds of [[[.5,.5]],[[.25,.5],[.75,.5]],[[.2,.2],[.8,.2],[.5,.8]]]) {
    const cells=organicFragmentCells(seeds);
    assert.equal(cells.length,seeds.length);
    assert(Math.abs(cells.reduce((sum,cell)=>sum+signedArea(cell),0)-1)<1e-10);
    assert(cells.flat().every(point=>point.every(value=>value>=0&&value<=1)));
  }
});
