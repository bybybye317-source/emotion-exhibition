import test from 'node:test';
import assert from 'node:assert/strict';
import {VISUAL_EMOTIONS, visualProfile, liveAudioTargets, createMatterState, advanceMatterState} from '../static/music-visual-math.mjs';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
const sound={playing:true,rms:.04,peak:.15,bass:.08,mid:.03,treble:.012,flux:.02,layers:{strings:.03,brass:.015,melody:.004,synth:.02}};

test('the full emotion distribution mixes geometry and pigment continuously',()=>{
 const a=visualProfile({happiness:1}),b=visualProfile({sadness:1}),mix=visualProfile({happiness:3,sadness:1});
 for(const key of ['shape','colorA','colorB'])mix[key].forEach((v,i)=>near(v,a[key][i]*.75+b[key][i]*.25));
 assert.notDeepEqual(mix.shape,a.shape);
});
test('eight emotions have distinct geometry and palette',()=>{
 const profiles=VISUAL_EMOTIONS.map(emotion=>visualProfile({[emotion]:1}));
 assert.equal(new Set(profiles.map(p=>JSON.stringify(p.shape))).size,8);
 assert.equal(new Set(profiles.map(p=>JSON.stringify([p.colorA,p.colorB]))).size,8);
 assert.ok(profiles[0].shape[0]>profiles[2].shape[0]);assert.ok(profiles[2].shape[1]>profiles[0].shape[1]);
 assert.ok(profiles[4].shape[2]>profiles[5].shape[2]);assert.ok(profiles[5].shape[3]>profiles[4].shape[3]);
});
test('invalid and empty scores fall back to a neutral idle form',()=>{
 for(const scores of [undefined,null,{}, {joy:1},{anger:NaN,sadness:Infinity,fear:-1},{__proto__:{happiness:Infinity}}]){
  const p=visualProfile(scores);assert.equal(p.idle,true);assert.equal(p.dominant,'neutral');assert.ok(p.shape.every(Number.isFinite));
 }
});
test('normalization is scale invariant and does not overflow',()=>{
 assert.deepEqual(visualProfile({happiness:Number.MAX_VALUE,sadness:Number.MAX_VALUE}),visualProfile({happiness:1,sadness:1}));
});
test('post-output silence closes every visual drive even when pre-master layers are loud',()=>{
 const silent=liveAudioTargets({...sound,rms:0,layers:{strings:1,brass:1,melody:1,synth:1}});
 assert.equal(silent.audible,false);for(const [key,value]of Object.entries(silent))if(key!=='audible')assert.equal(value,0);
 const paused=liveAudioTargets({...sound,playing:false});assert.deepEqual(paused,silent);
});
test('missing and malformed audio cannot introduce NaN, movement or out-of-range values',()=>{
 for(const audio of [undefined,null,{}, {playing:true,rms:NaN,bass:Infinity},{playing:true,rms:-1},{playing:true,rms:3,bass:Infinity,mid:2,treble:-1,layers:{strings:NaN}}]){
  const targets=liveAudioTargets(audio);
  for(const [key,value]of Object.entries(targets))if(key!=='audible')assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
 }
});
test('pause immediately freezes phase and quickly releases residual displacement',()=>{
 const profile=visualProfile({anger:1}),state=createMatterState(profile);
 for(let i=0;i<30;i++)advanceMatterState(state,profile,sound,1/30);
 assert.ok(state.drive>.1);const phase=state.phase;
 for(let i=0;i<30;i++)advanceMatterState(state,profile,{...sound,playing:false},1/30);
 assert.equal(state.phase,phase);assert.equal(state.drive,0);assert.equal(state.bass,0);assert.equal(state.strings,0);
});
test('emotion changes ease without replacing a mixed mood with its dominant label',()=>{
 const a=visualProfile({happiness:1}),b=visualProfile({sadness:1}),state=createMatterState(a);
 advanceMatterState(state,b,null,1/30);
 assert.ok(state.shape[0]<a.shape[0]&&state.shape[0]>b.shape[0]);
 assert.ok(state.shape[1]>a.shape[1]&&state.shape[1]<b.shape[1]);
 const phase=state.phase;advanceMatterState(state,b,null,1/30);assert.equal(state.phase,phase);
});
test('reduced motion preserves audio correspondence at lower amplitude and speed',()=>{
 const full=liveAudioTargets(sound),reduced=liveAudioTargets(sound,true);
 assert.ok(reduced.drive>0&&reduced.drive<full.drive/2);assert.ok(reduced.bass<full.bass/2);
 const p=visualProfile({fear:1}),a=createMatterState(p),b=createMatterState(p);
 advanceMatterState(a,p,sound,.1,false);advanceMatterState(b,p,sound,.1,true);
 assert.ok(b.phase>7.5&&b.phase<a.phase);
});
test('long or invalid frame gaps do not jump or poison the visual state',()=>{
 const p=visualProfile({neutral:1}),a=createMatterState(p),b=createMatterState(p);
 advanceMatterState(a,p,sound,3600);advanceMatterState(b,p,sound,.1);near(a.phase,b.phase);
 const phase=a.phase;advanceMatterState(a,p,sound,NaN);advanceMatterState(a,p,sound,-2);assert.equal(a.phase,phase);
});
