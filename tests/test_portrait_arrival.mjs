import test from 'node:test';
import assert from 'node:assert/strict';
import {FragmentArrival,blendLinearPixels} from '../static/portrait-arrival.mjs';

test('arrival begins with unique valid regions and leaves an empty request idle',()=>{
  const arrival=new FragmentArrival();
  assert.deepEqual(arrival.snapshot(),{slots:[],mix:1,glow:0,active:false,elapsed:0,phase:'idle'});
  assert.deepEqual(arrival.begin([4,4,10,-1,32,2.5,'3',NaN]),
    {slots:[4,10],mix:0,glow:0,active:true,elapsed:0,phase:'waiting'});
  const snapshot=arrival.snapshot();snapshot.slots.push(9);
  assert.deepEqual(arrival.snapshot().slots,[4,10]);
  assert.equal(arrival.begin([]).active,false);
  assert.equal(arrival.begin(null).mix,1);
});

test('an unseen arrival remains at its first frame and resumes without skipping',()=>{
  const arrival=new FragmentArrival();const waiting=arrival.begin([4]);
  assert.deepEqual(arrival.advance(120,{visible:false}),waiting);
  const progress=arrival.advance(1);
  assert.equal(progress.phase,'revealing');assert(progress.mix>0&&progress.mix<1);
  assert.deepEqual(arrival.advance(300,{visible:false}),progress);
  assert.equal(arrival.advance(.5).elapsed,1.5);
});

test('normal reveal is monotonic, settles after 2.4 seconds and ends at 3.2',()=>{
  const arrival=new FragmentArrival();arrival.begin([10]);
  let prior=0;
  for(let i=0;i<24;i++) {
    const frame=arrival.advance(.1);
    assert(frame.mix>=prior);assert(frame.mix<=1);assert(frame.glow>=0&&frame.glow<=1);prior=frame.mix;
  }
  const settled=arrival.advance(1e-10);
  assert.equal(settled.mix,1);assert.equal(settled.phase,'settling');assert(settled.glow>0);
  const done=arrival.advance(2);
  assert.equal(done.elapsed,3.2);assert.equal(done.mix,1);assert.equal(done.glow,0);
  assert.equal(done.active,false);assert.equal(done.phase,'idle');
  assert.deepEqual(arrival.advance(600),done);
});

test('glow gently rises, holds and recedes independently of the reveal',()=>{
  const arrival=new FragmentArrival();arrival.begin([4]);
  const middle=arrival.advance(.225);assert(Math.abs(middle.glow-.5)<1e-12);
  assert.equal(arrival.advance(.225).glow,1);
  assert.equal(arrival.advance(1.35).glow,1);
  const leaving=arrival.advance(.7);assert(Math.abs(leaving.glow-.5)<1e-12);
  assert.equal(arrival.advance(.7).glow,0);
});

test('invalid deltas cannot reverse time or contaminate render values',()=>{
  const arrival=new FragmentArrival();arrival.begin([1]);const expected=arrival.advance(.4);
  for(const delta of [-1,NaN,Infinity,-Infinity,undefined,'1',0])assert.deepEqual(arrival.advance(delta),expected);
});

test('clear cancels all motion and a rapid new arrival owns only its new regions',()=>{
  const arrival=new FragmentArrival();arrival.begin([4]);arrival.advance(2);
  const fresh=arrival.begin([10]);
  assert.deepEqual(fresh,{slots:[10],mix:0,glow:0,active:true,elapsed:0,phase:'waiting'});
  arrival.advance(1);const cleared=arrival.clear();
  assert.deepEqual(cleared,{slots:[],mix:1,glow:0,active:false,elapsed:0,phase:'idle'});
  assert.deepEqual(arrival.advance(10),cleared);
});

test('reduced motion uses a short dissolve with no glow and still pauses offscreen',()=>{
  const arrival=new FragmentArrival();const start=arrival.begin([4],{reducedMotion:true});
  assert.deepEqual(arrival.advance(20,{visible:false}),start);
  const half=arrival.advance(.325);
  assert(Math.abs(half.mix-.5)<1e-12);assert.equal(half.glow,0);
  const done=arrival.advance(.325);
  assert.equal(done.mix,1);assert.equal(done.glow,0);assert.equal(done.active,false);assert.equal(done.elapsed,.65);
});

test('enabling reduced motion midflight never rewinds and finishes quietly',()=>{
  const arrival=new FragmentArrival();arrival.begin([4]);const before=arrival.advance(1.3);
  const switched=arrival.advance(0,{reducedMotion:true});
  assert.equal(switched.mix,before.mix);assert.equal(switched.glow,0);
  const paused=arrival.advance(200,{visible:false});assert.deepEqual(paused,switched);
  const next=arrival.advance(.3);assert(next.mix>=before.mix);assert.equal(next.glow,0);
  const done=arrival.advance(.35);
  assert.equal(done.mix,1);assert.equal(done.glow,0);assert.equal(done.active,false);
  // Switching while only the halo remains removes it immediately.
  arrival.begin([10]);assert.equal(arrival.advance(2.6).phase,'settling');
  assert.equal(arrival.advance(0,{reducedMotion:true}).active,false);
});

test('pixel snapshots preserve exact endpoint colours and produce opaque output',()=>{
  const from=new Uint8ClampedArray([0,1,255,20,54,132,198,0]);
  const to=new Uint8ClampedArray([255,253,2,40,187,41,9,128]);
  assert.deepEqual([...blendLinearPixels(from,to,0)],[0,1,255,255,54,132,198,255]);
  assert.deepEqual([...blendLinearPixels(from,to,1)],[255,253,2,255,187,41,9,255]);
  assert.deepEqual(blendLinearPixels(from,to,-5),blendLinearPixels(from,to,0));
  assert.deepEqual(blendLinearPixels(from,to,5),blendLinearPixels(from,to,1));
  assert.deepEqual([...from],[0,1,255,20,54,132,198,0]);
});

test('pixel blending uses linear light rather than darkening an interrupted dissolve',()=>{
  const black=new Uint8ClampedArray([0,0,0,255]),white=new Uint8ClampedArray([255,255,255,255]);
  assert.deepEqual([...blendLinearPixels(black,white,.5)],[188,188,188,255]);
  assert.deepEqual([...blendLinearPixels(black,white,.25)],[137,137,137,255]);
  const red=new Uint8ClampedArray([255,0,0,255]),blue=new Uint8ClampedArray([0,0,255,255]);
  assert.deepEqual([...blendLinearPixels(red,blue,.5)],[188,0,188,255]);
});

test('pixel snapshots reuse either input buffer safely and reject malformed lengths',()=>{
  const from=new Uint8ClampedArray([10,70,220,1,200,150,100,1]);
  const to=new Uint8ClampedArray([200,50,30,2,30,70,100,2]);
  const expected=blendLinearPixels(from,to,.4);
  assert.equal(blendLinearPixels(from,to,.4,from),from);assert.deepEqual(from,expected);
  const other=new Uint8ClampedArray([0,0,0,0]);
  assert.equal(blendLinearPixels(new Uint8ClampedArray([255,255,255,0]),other,.5,other),other);
  assert.deepEqual([...other],[188,188,188,255]);
  for(const args of [[new Uint8Array(4),new Uint8Array(8),.5],
    [new Uint8Array(3),new Uint8Array(3),.5],
    [new Uint8Array(4),new Uint8Array(4),.5,new Uint8Array(8)]])
    assert.throws(()=>blendLinearPixels(...args),RangeError);
  assert.equal(blendLinearPixels(new Uint8Array(0),new Uint8Array(0),.5).length,0);
});
