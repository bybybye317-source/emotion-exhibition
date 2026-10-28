import test from 'node:test';
import assert from 'node:assert/strict';
import {blendCoveredPixels} from '../static/portrait-arrival.mjs';
import {anatomicalFragmentCells,PORTRAIT_REGION_COUNT,REGION_NAMES} from '../static/portrait-regions.mjs';
import {sourceLabel,createSourceThumbnail} from '../static/portrait-sources.mjs';
const rgba=values=>new Uint8ClampedArray(values);
test('first photograph fades over blank sculpture without baking grey into its skin',()=>{
 const from=rgba([170,170,170,255]),to=rgba([182,93,54,255]),oldMask=rgba([0,0,0,255]),newMask=rgba([255,255,255,255]);
 blendCoveredPixels(from,to,oldMask,newMask,.4);assert.deepEqual(from,to);assert.equal(oldMask[0],102);
});
test('a second interrupted arrival preserves already visible photo colour and coverage',()=>{
 const from=rgba([80,47,28,255,210,140,92,255]),to=rgba([170,170,170,255,210,140,92,255]),oldMask=rgba([255,255,255,255,80,80,80,255]),next=rgba([0,0,0,255,255,255,255,255]);
 const before=from.slice();blendCoveredPixels(from,to,oldMask,next,.5);assert.deepEqual(from,before);assert.equal(oldMask[0],128);assert.equal(oldMask[4],168);
});
test('empty regions stay unoccupied through any interruption and malformed buffers fail explicitly',()=>{
 for(const mix of [0,.3,1,NaN]){
  const from=rgba([170,170,170,255]),mask=rgba([0,0,0,255]);blendCoveredPixels(from,rgba([255,1,1,255]),mask,mask.slice(),mix);assert.equal(mask[0],0);
 }
 assert.throws(()=>blendCoveredPixels(rgba([1]),rgba([]),rgba([]),rgba([]),.5),RangeError);
});
test('32 named regions preserve recognisable features while finer skin pieces remain smaller',()=>{
 const cells=anatomicalFragmentCells(),area=cell=>Math.abs(cell.reduce((a,p,i)=>{const q=cell[(i+1)%cell.length];return a+p[0]*q[1]-q[0]*p[1];},0)/2);
 assert.equal(PORTRAIT_REGION_COUNT,32);assert.equal(REGION_NAMES.length,32);assert.equal(new Set(REGION_NAMES).size,32);
 const eyeArea=area(cells[4]);assert(cells.slice(20).every(cell=>area(cell)<eyeArea));
});
test('source labels retain stable participant numbers after older photos leave',()=>{
 assert.equal(sourceLabel({number:33},0),'观众 33');assert.equal(sourceLabel({},1),'观众 02');
});
test('source references crop without stretching faces in square, wide or tall inputs',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');let args;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({getContext:()=>({drawImage:(...a)=>args=a})})}});
 try{for(const [width,height] of [[280,281],[1280,720],[400,1000]]){
  createSourceThumbnail({width,height},{left_eye:[.3,.35],right_eye:[.7,.35],mouth:[.5,.7]});
  const [,x,y,w,h,,,dw,dh]=args;assert(Math.abs(w/h-dw/dh)<1e-10);assert(x>=0&&y>=0&&x+w<=width+1e-8&&y+h<=height+1e-8);
 }}finally{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;}
});
