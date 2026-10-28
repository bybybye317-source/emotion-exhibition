import test from 'node:test';
import assert from 'node:assert/strict';
import {balancePhotoLighting,estimateIllumination,illuminationGain} from '../static/portrait-lighting.mjs';

const size=256,target={left_eye:[82,88],right_eye:[174,88],nose:[128,141],mouth:[128,184]};
const decode=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
const encode=v=>255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055);
function photo({colour=[.35,.18,.11],x=0,y=0,texture=false}={}){
  const data=new Uint8ClampedArray(size*size*4);
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const gain=Math.exp(x*(col/size-.5)+y*(row/size-.48))*(texture?1+((row+col)%2?.06:-.06):1),i=(row*size+col)*4;
    for(let k=0;k<3;k++)data[i+k]=encode(colour[k]*gain);data[i+3]=255;
  }
  return data;
}
const rgb=(data,x,y)=>Array.from(data.slice((y*size+x)*4,(y*size+x)*4+3),decode);
const luma=p=>p[0]*.2126+p[1]*.7152+p[2]*.0722;
test('directional lighting is reduced while an individual face keeps its own reference brightness',()=>{
  for(const direction of [{x:1,y:0},{x:0,y:.8},{x:-.8,y:-.5}]){
    const before=photo(direction),after=before.slice();balancePhotoLighting(after,size,size,target);
    const field=estimateIllumination(after,size,size,target),original=estimateIllumination(before,size,size,target);
    assert(Math.hypot(field.x,field.y)<Math.hypot(original.x,original.y)*.6);
    const point=[128,123],ratio=luma(rgb(after,...point))/luma(rgb(before,...point));
    assert(Math.abs(ratio-1)<.04,'no shared lightening or whitening target');
  }
});
test('uniform dark, light, warm and cool complexions remain byte-for-byte distinct',()=>{
  for(const colour of [[.07,.035,.018],[.6,.38,.25],[.29,.15,.1],[.28,.23,.22]]){
    const before=photo({colour}),after=before.slice();balancePhotoLighting(after,size,size,target);assert.deepEqual(after,before);
  }
});
test('linear colour ratios and local texture survive correction',()=>{
  const before=photo({x:1,texture:true}),after=before.slice();balancePhotoLighting(after,size,size,target);
  for(const x of [60,120,195]){
    const a=rgb(before,x,140),b=rgb(after,x,140);
    assert(Math.abs(a[0]/a[1]-b[0]/b[1])<.045);assert(Math.abs(a[1]/a[2]-b[1]/b[2])<.045);
    const contrast=data=>luma(rgb(data,x,140))/luma(rgb(data,x,141));
    assert(Math.abs(contrast(before)-contrast(after))<.02,'pores and fine variations must not be blurred');
  }
});
test('outlying features do not dominate the broad skin illumination estimate',()=>{
  const data=photo({x:.9}),original=estimateIllumination(data,size,size,target);
  for(const [x,y] of [target.left_eye,target.right_eye,target.nose,target.mouth]){
    for(let yy=y-5;yy<=y+5;yy++)for(let xx=x-12;xx<=x+12;xx++){
      const i=(yy*size+xx)*4;data[i]=data[i+1]=data[i+2]=0;
    }
  }
  const changed=estimateIllumination(data,size,size,target);
  assert(Math.abs(original.x-changed.x)<.02);assert(Math.abs(original.y-changed.y)<.02);
});
test('correction is bounded and never modifies alpha or transparent pixels',()=>{
  const before=photo({x:2,y:1}),after=before.slice();
  for(let i=0;i<64;i++)after[i*4+3]=0;
  const transparent=after.slice(0,256),field=balancePhotoLighting(after,size,size,target);
  assert.deepEqual(after.slice(0,256),transparent);
  for(let y=0;y<=1;y+=.1)for(let x=0;x<=1;x+=.1){const gain=illuminationGain(field,x,y);assert(gain>=1/1.32&&gain<=1.32);}
  assert(after.every((v,i)=>i%4!==3||v===(i<256?0:255)));
});
test('invalid, untracked and fully transparent photos have no inferred correction',()=>{
  for(const data of [new Uint8ClampedArray(size*size*4),new Uint8ClampedArray(1)])assert.equal(estimateIllumination(data,size,size,target).samples,0);
  const data=photo(),before=data.slice();balancePhotoLighting(data,size,size,{...target,left_eye:[NaN,0]});assert.deepEqual(data,before);
  assert.equal(illuminationGain(null,0,0),1);
});
