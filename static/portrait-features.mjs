// Calibrated neutral eyelid boundaries in the shipped, fixed SculptureHead.
// Indices are on its actual open eye loops (not on the separate eyeballs).
export const EYE_VERTICES=Object.freeze({
 left:{outer:10993,inner:1089,upper:10870,lower:2813},
 right:{outer:18017,inner:1081,upper:18113,lower:4573},
});
export function calibratedProjection(projection,pointAt){
 const landmarks=structuredClone(projection.landmarks);
 for(const side of ['left','right']){
  for(const [name,index] of Object.entries(EYE_VERTICES[side]))landmarks[`${side}_eye_${name}`]=pointAt(index).slice(0,2);
  const outer=landmarks[`${side}_eye_outer`],inner=landmarks[`${side}_eye_inner`],upper=landmarks[`${side}_eye_upper`];
  landmarks[`${side}_eye`]=outer.map((v,i)=>(v+inner[i])/2);
  landmarks[`${side}_brow_outer`]=[outer[0],upper[1]+.12];
  landmarks[`${side}_brow_middle`]=[(outer[0]+inner[0])/2,upper[1]+.17];
  landmarks[`${side}_brow_inner`]=[inner[0],upper[1]+.12];
 }
 return {...projection,landmarks};
}
const area=(a,b,c)=>((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
// Locally improve triangle shape without changing the protected lip mesh.
function refineTriangles(warp,baseCount){
 const allowed=i=>i<7||i>=baseCount;
 for(let pass=0;pass<500;pass++){
  const edges=new Map();let flipped=false;
  for(let i=0;i<warp.triangles.length&&!flipped;i++){
   const tri=warp.triangles[i];if(!tri.every(allowed))continue;
   for(let j=0;j<3;j++){
    const a=tri[j],b=tri[(j+1)%3],c=tri[(j+2)%3],key=[a,b].sort((x,y)=>x-y).join(':');
    if(!edges.has(key)){edges.set(key,{i,a,b,c});continue;}
    const other=edges.get(key),d=other.c,p=warp.target;
    const next=[[c,d,b],[d,c,a]];
    if(next.some(t=>area(...t.map(k=>p[k]))<1e-6||area(...t.map(k=>warp.source[k]))<1e-6))continue;
    const [ax,ay]=p[a].map((v,k)=>v-p[d][k]),[bx,by]=p[b].map((v,k)=>v-p[d][k]),[cx,cy]=p[c].map((v,k)=>v-p[d][k]);
    const determinant=(ax*ax+ay*ay)*(bx*cy-by*cx)-(bx*bx+by*by)*(ax*cy-ay*cx)+(cx*cx+cy*cy)*(ax*by-ay*bx);
    if(determinant<=1e-3)continue;
    warp.triangles[i]=next[0];warp.triangles[other.i]=next[1];flipped=true;break;
   }
  }
  if(!flipped)break;
 }
}
/** Add eye/brow constraints to the existing lip-aware mesh. Improve triangle
 * aspect before moving landmarks, then jointly limit correction to keep every
 * source triangle upright. This avoids thin triangles dragging an eyebrow.
 */
export function refineFeatureWarp(base,anchors,target,width,height){
 if(!base||!point(anchors?.left_eye)||!point(anchors?.right_eye))return base;
 const warp={...base,source:base.source.map(p=>p.slice()),target:base.target.map(p=>p.slice()),triangles:base.triangles.map(t=>t.slice()),featureCount:0};
 const span=Math.hypot((anchors.right_eye[0]-anchors.left_eye[0])*width,(anchors.right_eye[1]-anchors.left_eye[1])*height),wanted=new Map();
 for(const side of ['left','right'])for(const feature of ['eye_outer','eye_inner','eye_upper','eye_lower','brow_outer','brow_middle','brow_inner']){
  const key=`${side}_${feature}`,a=anchors[key],dst=target[key];
  if(!point(a)||a.some(v=>v<0||v>1)||!point(dst)||span<=0)continue;
  if(warp.target.some(p=>Math.hypot(p[0]-dst[0],p[1]-dst[1])<.01))continue;
  const matches=[];
  for(let i=0;i<warp.triangles.length;i++){
   const tri=warp.triangles[i],t=tri.map(j=>warp.target[j]),total=area(...t);
   if(total<=1e-7)continue;
   const weights=[area(dst,t[1],t[2]),area(t[0],dst,t[2]),area(t[0],t[1],dst)].map(v=>v/total);
   if(weights.every(v=>v>=-1e-8))matches.push({i,tri,weights});
  }
  if(!matches.length)continue;
  const {tri,weights}=matches[0],source=[0,1].map(axis=>tri.reduce((sum,j,i)=>sum+warp.source[j][axis]*weights[i],0));
  const desired=[a[0]*width,a[1]*height];
  if(Math.hypot(desired[0]-source[0],desired[1]-source[1])>span*.45)continue;
  const index=warp.source.length,newTriangles=[];
  for(const match of matches)for(let i=0;i<3;i++){
   const t=[match.tri[i],match.tri[(i+1)%3],index];
   if(area(warp.target[t[0]],warp.target[t[1]],dst)>1e-7)newTriangles.push(t);
  }
  warp.source.push(source);warp.target.push(dst.slice());wanted.set(index,desired);
  const removed=new Set(matches.map(m=>m.i)),replacement=[];
  for(let i=0;i<warp.triangles.length;i++){
   if(i===matches[0].i)replacement.push(...newTriangles);
   if(!removed.has(i))replacement.push(warp.triangles[i]);
  }
  if(warp.openingTriangleStart!==undefined)warp.openingTriangleStart+=newTriangles.length-matches.length;
  warp.triangles=replacement;warp.featureCount++;
 }
 refineTriangles(warp,base.source.length);
 const original=warp.source.map(p=>p.slice());let amount=1;
 for(let attempt=0;attempt<12;attempt++){
  for(const [i,desired] of wanted)warp.source[i]=original[i].map((v,k)=>v+(desired[k]-v)*amount);
  if(warp.triangles.every(t=>area(...t.map(i=>warp.source[i]))>=-1e-6))break;
  amount*=.5;
 }
 if(warp.triangles.some(t=>area(...t.map(i=>warp.source[i])) < -1e-6)){warp.source=original;amount=0;}
 warp.featureStrength=amount;return warp;
}
