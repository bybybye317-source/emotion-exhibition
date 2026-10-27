import test from 'node:test';
import assert from 'node:assert/strict';
import {VISUAL_EMOTIONS, visualProfile, liveAudioTargets, createMatterState, advanceMatterState} from '../static/music-visual-math.mjs';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
const sound={playing:true,rms:.04,peak:.15,bass:.08,mid:.03,treble:.012,flux:.02,layers:{strings:.03,brass:.015,melody:.004,synth:.02}};

test('the full emotion distribution mixes geometry and pigment continuously',()=>{
 const a=visualProfile({happiness:1}),b=visualProfile({sadness:1}),mix=visualProfile({happiness:3,sadness:1});
 for(const key of ['shape','form','material','colorA','colorB'])mix[key].forEach((v,i)=>near(v,a[key][i]*.75+b[key][i]*.25));
 assert.notDeepEqual(mix.shape,a.shape);
});
test('eight emotions have distinct geometry and palette',()=>{
 const profiles=VISUAL_EMOTIONS.map(emotion=>visualProfile({[emotion]:1}));
 assert.equal(new Set(profiles.map(p=>JSON.stringify(p.shape))).size,8);
 assert.equal(new Set(profiles.map(p=>JSON.stringify([p.colorA,p.colorB]))).size,8);
 assert.ok(profiles[0].shape[0]>profiles[2].shape[0]);assert.ok(profiles[2].shape[1]>profiles[0].shape[1]);
 assert.ok(profiles[4].shape[2]>profiles[5].shape[2]);assert.ok(profiles[5].shape[3]>profiles[4].shape[3]);
});
test('four principal moods remain distinguishable by silhouette and surface without color',()=>{
 const [happy,sad,angry,fear]=['happiness','sadness','anger','fear'].map(key=>visualProfile({[key]:1}));
 const reach=p=>p.form[1]/p.form[0];
 // These ratios are intentional perceptual separation, not exact preset values.
 assert.ok(happy.form[0]>fear.form[0]*2,'an opening sheet is over twice the spread of a curled one');
 assert.ok(reach(sad)>reach(angry)*2.5,'drooping sadness reads vertical against compressed anger');
 assert.ok(happy.form[3]<fear.form[3]*.7,'happy sheet visibly opens where fear almost coils shut');
 assert.ok(fear.form[2]-sad.form[2]>.25,'fear has an opposing asymmetric lean');
 assert.ok(angry.material[0]>happy.material[0]*3,'angry folds have broad dense highlights');
 assert.ok(fear.material[3]>sad.material[3]*3,'fear retains shifting cold edge light while sadness is subdued');
 assert.ok(sad.speed<happy.speed/3,'a sad trailing sheet moves substantially more slowly');
});
test('all eight mood weights contribute to continuous bounded form and material, including near ties',()=>{
 const profiles=VISUAL_EMOTIONS.map(key=>visualProfile({[key]:1}));
 const mix=visualProfile(Object.fromEntries(VISUAL_EMOTIONS.map((key,i)=>[key,i+1]))),sum=36;
 for(const key of ['form','material'])mix[key].forEach((value,j)=>{
  near(value,profiles.reduce((total,p,i)=>total+p[key][j]*(i+1)/sum,0));
  assert.ok(value>=Math.min(...profiles.map(p=>p[key][j]))&&value<=Math.max(...profiles.map(p=>p[key][j])));
 });
 const left=visualProfile({happiness:.5001,fear:.4999}),right=visualProfile({happiness:.4999,fear:.5001});
 assert.notEqual(left.dominant,right.dominant);
 for(const key of ['shape','form','material'])left[key].forEach((value,j)=>assert.ok(Math.abs(value-right[key][j])<.001,'dominant label cannot switch the form'));
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
test('fixed loudness mapping keeps quiet, ordinary and strong passages visibly separated',()=>{
 const levels=[0,.001,.005,.01,.02,.04,.1,1].map(rms=>liveAudioTargets({...sound,rms}).breath);
 levels.forEach((level,i)=>{assert.ok(level>=0&&level<=1);if(i)assert.ok(level>levels[i-1]);});
 assert.ok(levels[2]<.1,'a quiet passage stays gathered');
 assert.ok(levels[4]>.4&&levels[4]<.6,'ordinary output leaves headroom for a swell');
 assert.ok(levels[5]>.8&&levels[5]<.9,'strong sound opens substantially further');
 const same=liveAudioTargets({...sound,rms:.02,layers:{strings:1},bass:1,flux:1});
 near(same.breath,levels[4]);
});
test('the whole-surface envelope rises gently then gathers over several seconds of silence',()=>{
 const profile=visualProfile({happiness:1}),state=createMatterState(profile),target=liveAudioTargets(sound).breath;
 advanceMatterState(state,profile,sound,1/30);
 assert.ok(state.breath>0&&state.breath<target*.07,'one frame cannot snap the surface open');
 for(let i=1;i<15;i++)advanceMatterState(state,profile,sound,1/30);
 assert.ok(state.breath>target*.5&&state.breath<target*.7,'opening should register in roughly half a second');
 for(let i=0;i<105;i++)advanceMatterState(state,profile,sound,1/30);
 const open=state.breath,phase=state.phase;
 for(let i=0;i<30;i++)advanceMatterState(state,profile,{playing:false,rms:0},1/30);
 assert.equal(state.phase,phase);assert.equal(state.drive,0);
 assert.ok(state.breath>open*.5&&state.breath<open*.7,'silence keeps a visible, smoothly receding after-motion');
 let previous=state.breath;
 for(let i=0;i<390;i++){
  advanceMatterState(state,profile,{playing:false,rms:0},1/30);
  assert.ok(state.breath<=previous);previous=state.breath;
 }
 assert.equal(state.breath,0,'contraction completes inside the controller settle window');
});
test('brief transients cannot pump the whole form and envelope timing is frame-rate independent',()=>{
 const profile=visualProfile({fear:1}),a=createMatterState(profile),b=createMatterState(profile);
 for(let i=0;i<3;i++)advanceMatterState(a,profile,sound,1/30);
 assert.ok(a.breath<.15,'a 100ms transient is smoothed rather than making a full-size hit');
 for(let i=0;i<6;i++)advanceMatterState(b,profile,sound,1/60);
 near(a.breath,b.breath);
 for(let i=0;i<60;i++)advanceMatterState(a,profile,{playing:true,rms:.001},1/30);
 for(let i=0;i<120;i++)advanceMatterState(b,profile,{playing:true,rms:.001},1/60);
 near(a.breath,b.breath);
 const before=a.breath;advanceMatterState(a,profile,sound,0);near(a.breath,before);
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
 for(const key of ['form','material'])state[key].forEach((value,i)=>{
  assert.ok(value>=Math.min(a[key][i],b[key][i])-1e-6&&value<=Math.max(a[key][i],b[key][i])+1e-6);
  assert.ok(Math.abs(value-a[key][i])<Math.abs(b[key][i]-a[key][i])*.04+1e-6,'all new geometry and surface coordinates ease rather than jump');
 });
 const phase=state.phase;advanceMatterState(state,b,null,1/30);assert.equal(state.phase,phase);
});
test('reduced motion preserves audio correspondence at lower amplitude and speed',()=>{
 const full=liveAudioTargets(sound),reduced=liveAudioTargets(sound,true);
 assert.ok(reduced.drive>0&&reduced.drive<full.drive/2);assert.ok(reduced.bass<full.bass/2);
 assert.ok(reduced.breath>0&&reduced.breath<full.breath/4);
 const p=visualProfile({fear:1}),a=createMatterState(p),b=createMatterState(p);
 advanceMatterState(a,p,sound,.1,false);advanceMatterState(b,p,sound,.1,true);
 assert.ok(b.phase>7.5&&b.phase<a.phase);
});
test('long or invalid frame gaps do not jump or poison the visual state',()=>{
 const p=visualProfile({neutral:1}),a=createMatterState(p),b=createMatterState(p);
 advanceMatterState(a,p,sound,3600);advanceMatterState(b,p,sound,.1);near(a.phase,b.phase);
 const phase=a.phase;advanceMatterState(a,p,sound,NaN);advanceMatterState(a,p,sound,-2);assert.equal(a.phase,phase);
});
