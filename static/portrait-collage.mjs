import {affineFromTriangles, photoTriangle, organicFragmentCells, planPatchAssignments} from './portrait-math.mjs?v=20261027-collage';

const DEFAULT_COLOR = '#aaa69e';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const makeCanvas = size => Object.assign(document.createElement('canvas'), {width:size, height:size});
const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const MOUTH_KEYS = ['mouth_left','mouth_right','mouth_upper_outer','mouth_upper_inner','mouth_lower_inner','mouth_lower_outer'];

// Constrained anatomical triangulation, ordered from the outside inward.
// Distinct inner/outer lip rows preserve the lip tissue while mapping an open
// photographed mouth into the neutral sculpture's much narrower mouth gap.
const MOUTH_TRIANGLES = [
  [0,1,5],[0,5,4],[0,4,3],[1,2,5],
  [3,4,7],[4,6,7],[4,5,6],[5,8,6],[5,2,8],
  [3,7,12],[3,12,2],[2,12,8],
  [6,8,9],[6,9,7],
  [7,9,10],[9,8,10],[7,11,12],[11,8,12],
  [7,10,11],[10,8,11],
];

const signedArea = (a,b,c) => ((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
const mixPoint = (a,b,t) => a.map((value,i)=>value*(1-t)+b[i]*t);

// Arc through both corners and the exact middle landmark. The two inner arcs
// share endpoints, so the mouth opening tapers continuously at both sides.
function mouthArcPoint(left, middle, right, t) {
  const line=mixPoint(left,right,t),center=mixPoint(left,right,.5);
  return line.map((value,axis)=>value+4*t*(1-t)*(middle[axis]-center[axis]));
}
function mouthArc(left, middle, right, count) {
  return Array.from({length:count},(_,i)=>mouthArcPoint(left,middle,right,i/(count-1)));
}

// Build a strip outside a measured inner contour, constrained by the true
// outer corners and outer mid-lip. Following the curved inner contour avoids
// a fan triangle cutting across teeth near a smile's corners.
function outerLipGuide(inner, left, middle, right) {
  const last=inner.length-1,mid=Math.floor(last/2);
  const leftOffset=left.map((v,i)=>v-inner[0][i]),rightOffset=right.map((v,i)=>v-inner[last][i]);
  const centerOffset=mixPoint(leftOffset,rightOffset,.5);
  return inner.map((point,index)=>{
    const t=index/last,offset=mixPoint(leftOffset,rightOffset,t);
    return point.map((value,axis)=>value+offset[axis]+4*t*(1-t)*(middle[axis]-inner[mid][axis]-centerOffset[axis]));
  });
}

function contourMouthWarp(src,dst,anchors,target,width,height) {
  const contours=[anchors.mouth_upper_contour,anchors.mouth_lower_contour];
  if(!contours.every(points=>Array.isArray(points)&&points.length===11&&points.every((point,i)=>validPoint(point)&&point.every(v=>v>=0&&v<=1)&&(!i||point[0]>points[i-1][0])))) return null;
  const [upper,lower]=contours.map(points=>points.map(([x,y])=>[x*width,y*height]));
  // Corresponding contour ends represent the same inner commissures.
  if(Math.hypot(upper[0][0]-lower[0][0],upper[0][1]-lower[0][1])>1 || Math.hypot(upper[10][0]-lower[10][0],upper[10][1]-lower[10][1])>1)return null;
  // Insets follow the middle arc, rather than a straight corner-to-center line;
  // this keeps the narrow lower-lip strip from folding at an upturned seam.
  const middle=mixPoint(target.mouth_upper_inner,target.mouth_lower_inner,.5);
  const innerLeft=mouthArcPoint(target.mouth_left,middle,target.mouth_right,.0275);
  const innerRight=mouthArcPoint(target.mouth_left,middle,target.mouth_right,.9725);
  const targetUpper=mouthArc(innerLeft,target.mouth_upper_inner,innerRight,11);
  const targetLower=mouthArc(innerLeft,target.mouth_lower_inner,innerRight,11);
  const sourceLeft=anchors.mouth_left.map((v,i)=>v*(i?height:width)),sourceRight=anchors.mouth_right.map((v,i)=>v*(i?height:width));
  const sourceOuterUpper=anchors.mouth_upper_outer.map((v,i)=>v*(i?height:width)),sourceOuterLower=anchors.mouth_lower_outer.map((v,i)=>v*(i?height:width));
  const outerUpper=outerLipGuide(upper,sourceLeft,sourceOuterUpper,sourceRight);
  const outerLower=outerLipGuide(lower,sourceLeft,sourceOuterLower,sourceRight);
  const targetOuterUpper=outerLipGuide(targetUpper,target.mouth_left,target.mouth_upper_outer,target.mouth_right);
  const targetOuterLower=outerLipGuide(targetLower,target.mouth_left,target.mouth_lower_outer,target.mouth_right);
  const source=src.slice(),destination=dst.slice();
  const add=(a,b)=>{const index=source.length;source.push(a);destination.push(b);return index;};
  const left=add(sourceLeft,target.mouth_left),right=add(sourceRight,target.mouth_right);
  const append=(a,b,endpoints)=>a.map((point,i)=>i===0?endpoints[0]:i===a.length-1?endpoints[1]:add(point,b[i]));
  const ou=append(outerUpper,targetOuterUpper,[left,right]);
  const ol=append(outerLower,targetOuterLower,[left,right]);
  const iu=upper.map((point,i)=>add(point,targetUpper[i]));
  const il=append(lower,targetLower,[iu[0],iu[10]]);
  const triangles=[[0,1,5],[0,5,4],[0,4,3],[1,2,5],[3,4,left],[4,6,left],[4,5,6],[5,right,6],[5,2,right],[3,ol[5],2]];
  const appendTriangle=(a,b,c)=>{if(new Set([a,b,c]).size===3)triangles.push([a,b,c]);};
  for(let i=0;i<10;i++) {
    appendTriangle(6,ou[i+1],ou[i]);
    appendTriangle(i<5?3:2,ol[i],ol[i+1]);
    appendTriangle(ou[i],ou[i+1],iu[i]);appendTriangle(ou[i+1],iu[i+1],iu[i]);
    appendTriangle(il[i],il[i+1],ol[i]);appendTriangle(il[i+1],ol[i+1],ol[i]);
  }
  const openingTriangleStart=triangles.length;
  for(let i=0;i<10;i++) {
    appendTriangle(iu[i],iu[i+1],il[i]);appendTriangle(iu[i+1],il[i+1],il[i]);
  }
  // Do not fold a badly tracked lip over itself. Closed source openings may
  // degenerate to a line; those triangles are skipped by the affine solver.
  if(triangles.some(triangle=>{
    const a=signedArea(...triangle.map(i=>source[i])),b=signedArea(...triangle.map(i=>destination[i]));
    return a < -1e-5 || b < -1e-5;
  }))return null;
  return {source,target:destination,triangles,denseMouth:true,contourMouth:true,openingTriangleStart};
}

/** Pure warp geometry, shared by rendering and tests. Target points are pixels. */
export function photoWarpGeometry(anchors, width, height, target, size) {
  const source=photoTriangle(anchors,width,height);
  const targetTriangle=[target.left_eye,target.right_eye,target.mouth];
  const inverse=affineFromTriangles(targetTriangle,source);
  if(!inverse) return null;
  const corners=[[0,0],[size,0],[size,size],[0,size]];
  const toSource=([x,y])=>[inverse[0]*x+inverse[2]*y+inverse[4],inverse[1]*x+inverse[3]*y+inverse[5]];
  const normalized=point=>validPoint(point)&&point.every(v=>v>=0&&v<=1);
  if(!normalized(anchors?.nose)||!validPoint(target.nose))return null;
  const src=[...corners.map(toSource),source[0],source[1],[anchors.nose[0]*width,anchors.nose[1]*height]];
  const dst=[...corners,target.left_eye,target.right_eye,target.nose];
  const denseMouth=MOUTH_KEYS.every(key=>normalized(anchors?.[key])&&validPoint(target[key]))
    && anchors.mouth_left[0]<anchors.mouth_right[0] && target.mouth_left[0]<target.mouth_right[0];
  if(denseMouth) {
    const contourWarp=contourMouthWarp(src,dst,anchors,target,width,height);
    if(contourWarp)return contourWarp;
    src.push(...MOUTH_KEYS.map(key=>[anchors[key][0]*width,anchors[key][1]*height]));
    dst.push(...MOUTH_KEYS.map(key=>target[key]));
    return {source:src,target:dst,triangles:MOUTH_TRIANGLES,denseMouth:true};
  }
  src.push(source[2]);dst.push(target.mouth);
  return {source:src,target:dst,denseMouth:false,triangles:[[0,1,5],[0,5,4],[0,4,3],[1,2,5],[2,7,5],[2,3,7],[3,4,7],[4,5,6],[5,7,6],[7,4,6]]};
}

function polygon(ctx, points, expansion = 0) {
  const center = points.reduce((sum, p) => [sum[0]+p[0]/points.length,sum[1]+p[1]/points.length], [0,0]);
  ctx.beginPath();
  points.forEach(([x,y], index) => {
    const length = Math.max(1,Math.hypot(x-center[0],y-center[1]));
    x += (x-center[0])/length*expansion; y += (y-center[1])/length*expansion;
    if(index) ctx.lineTo(x,y); else ctx.moveTo(x,y);
  });
  ctx.closePath();
}

// Only nudge obvious under/over-exposure. A single common mean would erase
// differences between people's skin; the broad untouched band avoids that.
export function exposureGain(upperLuminance) {
  if(!Number.isFinite(upperLuminance) || upperLuminance <= 0) return 1;
  if(upperLuminance < 135) return clamp(Math.sqrt(135/upperLuminance),1,1.14);
  if(upperLuminance > 235) return clamp(Math.sqrt(235/upperLuminance),.90,1);
  return 1;
}

function normalizeExposure(output, target) {
  const ctx=output.getContext('2d',{willReadFrequently:true}), size=output.width;
  const pixels=ctx.getImageData(0,0,size,size), data=pixels.data;
  const left=clamp(Math.floor(target.left_eye[0]-.13*size),0,size-1);
  const right=clamp(Math.ceil(target.right_eye[0]+.13*size),left+1,size);
  const top=clamp(Math.floor(target.left_eye[1]-.12*size),0,size-1);
  const bottom=clamp(Math.ceil(target.mouth[1]+.10*size),top+1,size);
  const histogram=new Uint32Array(256); let count=0;
  for(let y=top;y<bottom;y+=4) for(let x=left;x<right;x+=4) {
    const i=(y*size+x)*4;
    if(data[i+3]<200) continue;
    const luma=Math.round(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);
    histogram[luma]++;count++;
  }
  let cumulative=0, upper=128;
  for(let i=0;i<256;i++) {cumulative+=histogram[i];if(cumulative>=count*.85){upper=i;break;}}
  const gain=exposureGain(upper);
  for(let i=0;i<data.length;i+=4) {
    // Preserve the person's original skin colour and local texture; only
    // guard extreme exposure, without pulling all fragments toward grey.
    for(let channel=0;channel<3;channel++) {
      data[i+channel]=clamp(data[i+channel]*gain,0,255);
    }
  }
  ctx.putImageData(pixels,0,0);
}

/**
 * Warp a local photo into the face's front projection. `landmarks` contains
 * model-space left_eye/right_eye/nose/mouth [x,y] coordinates, optionally the
 * six mouth_* landmarks for lip-aware alignment. `bounds` uses
 * left/right/top/bottom in that same space, with Y up. Source anchors remain
 * normalized image coordinates. The returned canvas owns no external URLs.
 */
export function createAlignedPhoto(image, anchors, {size=1024,bounds,landmarks,baseColor=DEFAULT_COLOR}={}) {
  if(!Number.isInteger(size) || size<32 || size>4096) throw new RangeError('Invalid portrait atlas size');
  if(!bounds || ![bounds.left,bounds.right,bounds.top,bounds.bottom].every(Number.isFinite) || bounds.right<=bounds.left || bounds.top<=bounds.bottom) throw new RangeError('Invalid portrait projection bounds');
  if(!['left_eye','right_eye','mouth'].every(key=>validPoint(landmarks?.[key]))) throw new TypeError('Missing model facial landmarks');
  const project=([x,y])=>[(x-bounds.left)/(bounds.right-bounds.left)*size,(bounds.top-y)/(bounds.top-bounds.bottom)*size];
  const target=Object.fromEntries(Object.entries(landmarks).filter(([,point])=>validPoint(point)).map(([key,point])=>[key,project(point)]));
  const output=makeCanvas(size), ctx=output.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle=baseColor;ctx.fillRect(0,0,size,size);
  const source=photoTriangle(anchors,image.width,image.height);
  const targetTriangle=[target.left_eye,target.right_eye,target.mouth];
  const transform=affineFromTriangles(source,targetTriangle);
  if(!transform) return output;
  // The affine underpaint prevents pale hairline cracks at triangle joins.
  ctx.save();ctx.setTransform(...transform);ctx.drawImage(image,0,0);ctx.restore();
  const warp=photoWarpGeometry(anchors,image.width,image.height,target,size);
  if(warp) {
    for(const [triangleIndex,triangle] of warp.triangles.entries()) {
      const matrix=affineFromTriangles(triangle.map(i=>warp.source[i]),triangle.map(i=>warp.target[i]));
      if(!matrix) continue;
      // Never expand the photographed opening across the physical lip boundary.
      const mouthInterior=warp.contourMouth?triangleIndex>=warp.openingTriangleStart:warp.denseMouth&&triangle.includes(10)&&triangle.includes(11);
      ctx.save();polygon(ctx,triangle.map(i=>warp.target[i]),mouthInterior?0:.35);ctx.clip();
      ctx.setTransform(...matrix);ctx.drawImage(image,0,0);ctx.restore();
    }
  }
  normalizeExposure(output,target);
  return output;
}

/**
 * Paint one region per person over an already assembled seed face. Preserve
 * null entries in alignedImages: their original slots use their own seed, so
 * a failed load cannot move another person's fragment. No photo is repeated
 * across vacant cells or enlarged into the whole face.
 */
export function paintCollage(ctx, alignedImages, size=1024, baseColor=DEFAULT_COLOR, {records,seedImages=[]}={}) {
  const photos=Array.isArray(alignedImages)?alignedImages:[];
  const assignments=planPatchAssignments(records ?? photos.map((_,index)=>({id:`photo-${index}`})));
  const sources=assignments.map(({recordIndex,seedIndex})=>(recordIndex===null?null:photos[recordIndex]) || seedImages[seedIndex] || null);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;ctx.filter='none';
  ctx.fillStyle=baseColor;ctx.fillRect(0,0,size,size);
  if(!sources.some(Boolean)){ctx.restore();return;}
  const cells=organicFragmentCells().map(cell=>cell.map(([x,y])=>[x*size,y*size]));
  // Blurred partition masks still sum to one in the interior. Add their
  // premultiplied colours instead of stacking transparent layers, which would
  // reveal the stone underpaint or leave an order-dependent hard seam.
  ctx.clearRect(0,0,size,size);ctx.globalCompositeOperation='lighter';
  const mask=makeCanvas(size), maskCtx=mask.getContext('2d');
  const layer=makeCanvas(size), layerCtx=layer.getContext('2d');
  const feather=Math.max(.6,4.5*size/1024);
  cells.forEach((cell,index)=>{
    maskCtx.clearRect(0,0,size,size);maskCtx.filter=`blur(${feather}px)`;
    maskCtx.fillStyle='#fff';polygon(maskCtx,cell);maskCtx.fill();maskCtx.filter='none';
    layerCtx.globalCompositeOperation='source-over';layerCtx.clearRect(0,0,size,size);
    if(sources[index]) layerCtx.drawImage(sources[index],0,0,size,size);
    else {layerCtx.fillStyle=baseColor;layerCtx.fillRect(0,0,size,size);}
    layerCtx.globalCompositeOperation='destination-in';layerCtx.drawImage(mask,0,0);
    ctx.drawImage(layer,0,0);
  });
  ctx.globalCompositeOperation='destination-over';ctx.fillStyle=baseColor;ctx.fillRect(0,0,size,size);
  // Release large scratch stores immediately; the final atlas stays in memory.
  mask.width=mask.height=layer.width=layer.height=1;
  ctx.restore();
}
