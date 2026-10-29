import test from 'node:test';
import assert from 'node:assert/strict';
import {contributionImpact, joinedParticipant, feedbackSnapshot, createFeedbackTracker, arrivalBatch} from '../static/contribution-feedback.mjs';
import {musicParameters,groupDiversity} from '../static/music-math.mjs';
import {recipeForScores} from '../static/scent-math.mjs';
const person=(id,scores,slot=0)=>({id,scores,slot,number:slot+1,emotion:Object.keys(scores)[0],image_url:'blob:private'});
const snap=records=>({participants:records,participant_count:records.length,group_scores:Object.fromEntries(['happiness','neutral','sadness','surprise','anger','fear','disgust','contempt'].map(e=>[e,records.reduce((s,p)=>s+(p.scores[e]||0),0)/(records.length||1)]))});

test('one visitor has equal-weight, unamplified deltas matching production music and recipe targets',()=>{
 const before=snap([person('a',{sadness:1})]),after=snap([...before.participants,person('b',{happiness:1},1)]);
 const change=contributionImpact(before,after,'b');
 assert.equal(change.count,2);assert.equal(change.first,false);assert.equal(change.replaced,false);
 const p=musicParameters(after.group_scores,{diversity:groupDiversity(after.participants)}),old=musicParameters(before.group_scores,{diversity:0});
 for(const row of change.music){assert.ok(Math.abs(row.delta-(p[row.key]-old[row.key])*100)<.051);}
 assert.deepEqual(change.afterRecipe,recipeForScores(after.group_scores));
 for(const row of change.scent)assert.equal(row.delta,change.afterRecipe.percentages[row.key]-change.beforeRecipe.percentages[row.key]);
});

test('first contribution uses idle music but marks scent as initial recipe, not a measured increase',()=>{
 const change=contributionImpact(snap([]),snap([person('a',{happiness:1})]),'a');
 assert.equal(change.first,true);assert.equal(change.beforeRecipe,null);
 assert.equal(change.afterRecipe.percentages.bergamot,32);
 assert.ok(change.music.every(row=>row.from===Math.round(musicParameters(null)[row.key]*1000)/10));
});

test('same scores preserve honest unchanged state instead of inventing a musical response',()=>{
 const before=snap([person('a',{neutral:1})]),after=snap([...before.participants,person('b',{neutral:1},1)]);
 const change=contributionImpact(before,after,'b');
 assert.equal(change.musicUnchanged,true);assert.equal(change.scentUnchanged,true);assert.deepEqual(change.music,[]);assert.deepEqual(change.scent,[]);
});

test('hydration, duplicate events, removals, malformed input and multi-join catch-up are not one person',()=>{
 const one=snap([person('a',{happiness:1})]),two=snap([...one.participants,person('b',{sadness:1},1)]);
 assert.equal(joinedParticipant(null,two),null);
 assert.equal(joinedParticipant(one,one),null);
 assert.equal(joinedParticipant(two,one),null);
 assert.equal(joinedParticipant(snap([]),two),null);
 assert.equal(contributionImpact(one,two,'not-b'),null);
 assert.equal(contributionImpact(snap([]),snap([person('x',{happiness:NaN})]),'x'),null);
});

test('slot replacement is explicitly marked and compared to full prior group, not omission baseline',()=>{
 const before=snap([person('a',{sadness:1}),person('b',{neutral:1},1)]);
 const after=snap([before.participants[1],person('c',{happiness:1})]);
 const change=contributionImpact(before,after,'c');
 assert.equal(change.replaced,true);assert.equal(change.count,2);
 assert.deepEqual(change.beforeRecipe,recipeForScores(before.group_scores));
});

test('tiny group impact stays small, recipes may remain identical after rounding',()=>{
 const people=Array.from({length:31},(_,i)=>person(String(i),{neutral:1},i));
 const before=snap(people),after=snap([...people,person('new',{neutral:.99,happiness:.01},31)]);
 const change=contributionImpact(before,after,'new');
 assert.equal(change.musicUnchanged,true);assert.equal(change.scentUnchanged,true);
});

test('feedback snapshots never retain image URLs or facial landmarks',()=>{
 const original=snap([{...person('a',{happiness:1}),photo_anchors:{private:1}}]);
 const copy=feedbackSnapshot(original);
 assert.equal(copy.participants[0].image_url,undefined);assert.equal(copy.participants[0].photo_anchors,undefined);
 original.participants[0].scores.happiness=.2;assert.equal(copy.participants[0].scores.happiness,1);
});


test('concurrent arrivals preserve exact shared deltas and explicitly identify a batch',()=>{
 const before=snap([person('a',{neutral:1})]);
 const after=snap([...before.participants,person('mine',{happiness:1},1),person('remote',{fear:1},2)]);
 const change=contributionImpact(before,after,'mine');
 assert.equal(change.participantId,'mine');assert.equal(change.joint,true);assert.equal(change.joinCount,2);
 assert.deepEqual(change.participantIds,['mine','remote']);
 assert.equal(joinedParticipant(before,after),null);
 assert.deepEqual(change.beforeRecipe,recipeForScores(before.group_scores));
 assert.deepEqual(change.afterRecipe,recipeForScores(after.group_scores));
 const automaticallySelected=contributionImpact(before,after);
 assert.equal(automaticallySelected.participantId,'remote');assert.equal(automaticallySelected.joint,true);
 assert.deepEqual(automaticallySelected.music,change.music);
});

test('a batched poll at capacity includes all replacements without calling it one-person impact',()=>{
 const before=snap([person('a',{sadness:1}),person('b',{neutral:1},1),person('c',{neutral:1},2)]);
 const after=snap([before.participants[2],person('d',{happiness:1}),person('e',{anger:1},1)]);
 const change=contributionImpact(before,after,'d');
 assert.equal(change.joinCount,2);assert.equal(change.removedCount,2);assert.equal(change.replaced,true);
 assert.equal(change.count,3);assert.equal(change.joint,true);
 const deletionAndOne=snap([person('d',{happiness:1})]);
 assert.equal(arrivalBatch(before,deletionAndOne),null);
});

test('cohort changes hydrate a fresh baseline instead of reporting local records as room arrivals',()=>{
 const tracker=createFeedbackTracker();
 const local=snap([person('local',{sadness:1})]),room=snap([person('remote',{happiness:1})]);
 assert.equal(tracker.observe(local,{scope:'local',cohortId:'local'}).impact,null);
 const connected=tracker.observe(room,{scope:'room',cohortId:'r1:0'});
 assert.equal(connected.changedCohort,true);assert.equal(connected.impact,null);
 const joined=snap([...room.participants,person('next',{fear:1},1)]);
 const arrival=tracker.observe(joined,{scope:'room',cohortId:'r1:0'});
 assert.equal(arrival.changedCohort,false);assert.equal(arrival.impact.participantId,'next');
 assert.equal(tracker.observe(joined,{scope:'room',cohortId:'r1:0'}).impact,null);
 assert.equal(tracker.observe(local,{scope:'local',cohortId:'local'}).impact,null);
});

test('switching rooms or resetting a room generation never mixes unrelated cohort scores',()=>{
 const tracker=createFeedbackTracker();
 const first=snap([person('a',{sadness:1})]),second=snap([person('b',{happiness:1})]);
 tracker.observe(first,{scope:'room',cohortId:'r1:0'});
 assert.equal(tracker.observe(second,{scope:'room',cohortId:'r2:0'}).impact,null);
 assert.equal(tracker.observe(first,{scope:'room',cohortId:'r2:1'}).impact,null);
 const next=tracker.observe(snap([...first.participants,person('c',{anger:1},1)]),{scope:'room',cohortId:'r2:1'});
 assert.equal(next.impact.participantId,'c');assert.deepEqual(next.impact.beforeRecipe,recipeForScores(first.group_scores));
});
