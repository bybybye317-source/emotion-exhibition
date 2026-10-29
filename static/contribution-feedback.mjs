import {musicParameters, groupDiversity} from './music-math.mjs?v=20261028-gallery192';
import {recipeForScores, CHANNELS, EMOTION_LABELS} from './scent-math.mjs?v=20261028-gallery192';

const MUSIC_CONTROLS = Object.freeze([
  {key:'brightness',label:'音色亮度',up:'更明亮',down:'更暗'},
  {key:'energy',label:'声景活跃度',up:'更活跃',down:'更舒缓'},
  {key:'tension',label:'和声张力',up:'更紧张',down:'更舒展'},
  {key:'space',label:'空间扩散',up:'更开阔',down:'更靠近'},
  {key:'strings',label:'弦乐权重',up:'弦乐更突出',down:'弦乐更收敛'},
  {key:'brass',label:'铜管权重',up:'铜管更突出',down:'铜管更收敛'},
  {key:'synth',label:'合成器权重',up:'合成器更突出',down:'合成器更收敛'},
]);
const safeRecords = session => Array.isArray(session?.participants) ? session.participants.filter(p=>p && typeof p.id==='string') : [];
const finite = value => Number.isFinite(value) ? value : 0;
const round = value => Math.round((value + Number.EPSILON) * 10) / 10;
const signed = value => `${value>0?'+':''}${Math.abs(value)<.05?'0':value.toFixed(1)}`;

/** Describe the committed arrivals; deletions alone and bulk resets are not contributions. */
export function arrivalBatch(before, after) {
  if(!before || !after) return null;
  const previous=safeRecords(before),next=safeRecords(after);
  const oldIds=new Set(previous.map(p=>p.id)),newIds=new Set(next.map(p=>p.id));
  const additions=next.filter(p=>!oldIds.has(p.id));
  const removals=previous.filter(p=>!newIds.has(p.id));
  return additions.length && removals.length<=additions.length ? {additions,removals} : null;
}

/** Single-person convenience: never relabel a multi-user poll as one person's impact. */
export function joinedParticipant(before, after) {
  const batch=arrivalBatch(before,after);
  return batch?.additions.length===1 ? batch.additions[0] : null;
}

/** The room generation changes after reset, so snapshots from separate works never compare. */
export function feedbackCohort({scope='local',cohortId}={}) {
  return `${scope==='room'?'room':'local'}:${cohortId??'default'}`;
}

export function createFeedbackTracker() {
  let previous=null,cohort=null;
  return {
    get cohort(){return cohort;},
    observe(session,context={}){
      const next=feedbackSnapshot(session);if(!next)return null;
      const key=feedbackCohort(context),changedCohort=cohort!==key;
      const impact=changedCohort?null:contributionImpact(previous,next);
      previous=next;cohort=key;
      return {changedCohort,impact,session:next};
    }
  };
}

/** Compare committed group targets, never claim these are measured loudness or physical scent concentrations. */
export function contributionImpact(before, after, participantId) {
  const batch=arrivalBatch(before,after);if(!batch)return null;
  const participant=participantId?batch.additions.find(p=>p.id===participantId):batch.additions.at(-1);
  if(!participant)return null;
  participantId=participant.id;
  const previous=safeRecords(before),next=safeRecords(after);
  const first=previous.length===0;
  const beforeMusic=musicParameters(before.group_scores,{idle:first,diversity:groupDiversity(previous)});
  const afterMusic=musicParameters(after.group_scores,{idle:false,diversity:groupDiversity(next)});
  if(afterMusic.idle) return null;
  const beforeScent=recipeForScores(before.group_scores),afterScent=recipeForScores(after.group_scores);
  if(!afterScent || (!first && (!beforeScent || beforeMusic.idle))) return null;
  const music=MUSIC_CONTROLS.map(control=>{
    const from=finite(beforeMusic[control.key])*100,to=finite(afterMusic[control.key])*100;
    return {...control,from:round(from),to:round(to),delta:round(to-from),exactDelta:to-from};
  }).sort((a,b)=>Math.abs(b.exactDelta)-Math.abs(a.exactDelta));
  const scent=CHANNELS.map(channel=>{
    const from=beforeScent?.percentages[channel.key]??0,to=afterScent.percentages[channel.key];
    return {key:channel.key,label:channel.label,color:channel.color,from,to,delta:to-from};
  }).sort((a,b)=>first?b.to-a.to:Math.abs(b.delta)-Math.abs(a.delta));
  return {participantId,number:participant.number,slot:participant.slot,first,
    joint:batch.additions.length>1,joinCount:batch.additions.length,participantIds:batch.additions.map(p=>p.id),
    replaced:batch.removals.length>0,removedCount:batch.removals.length,count:next.length,
    music:music.filter(p=>Math.abs(p.delta)>=.1).slice(0,2),
    scent:first?scent.slice(0,2):scent.filter(p=>p.delta!==0).slice(0,2),
    musicUnchanged:music.every(p=>Math.abs(p.delta)<.1),
    scentUnchanged:!first && scent.every(p=>p.delta===0),
    beforeRecipe:beforeScent,afterRecipe:afterScent,
    dominant:EMOTION_LABELS[participant.emotion]||'混合表情'};
}

/** Lightweight tracker keeps scores/IDs only: never retain participant photos here. */
export function feedbackSnapshot(session) {
  if(!session || !Array.isArray(session.participants))return null;
  return {group_scores:{...session.group_scores},participant_count:session.participants.length,
    participants:safeRecords(session).map(({id,number,slot,emotion,scores})=>({id,number,slot,emotion,scores:{...scores}}))};
}

export function createContributionFeedback({root=document,events=window}={}) {
  if(root.getElementById('contribution-feedback'))return null;
  const anchor=root.getElementById('gallery-emotions');if(!anchor)return null;
  const el=(tag,className,text)=>{const node=root.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const panel=el('section','contribution-feedback');panel.id='contribution-feedback';panel.hidden=true;panel.setAttribute('aria-labelledby','contribution-feedback-title');
  const heading=el('div','contribution-feedback-heading');
  const titles=el('div');const eyebrow=el('p','contribution-feedback-eyebrow','YOUR CONTRIBUTION');
  const title=el('h2',null,'你为作品留下的变化');title.id='contribution-feedback-title';
  const context=el('p','contribution-feedback-context');titles.append(eyebrow,title,context);
  const replay=el('button','button compact contribution-feedback-replay','定位这六片 ↗');replay.type='button';
  heading.append(titles,replay);
  const body=el('div','contribution-feedback-grid');
  const portrait=el('article','contribution-feedback-card');const portraitTitle=el('h3',null,'六片，成为共同面孔的一部分');portrait.append(el('span','contribution-feedback-index','01 / PORTRAIT'),portraitTitle);
  const steps=el('ol','contribution-feedback-steps');const stepNodes=['选出六片','慢慢融入','留在大脸'].map((name,i)=>{const li=el('li',null,name);li.dataset.step=String(i);steps.append(li);return li;});
  const status=el('p','contribution-feedback-status','照片正在对齐；准备好后将显示六个位置。');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  portrait.append(steps,status);
  const music=el('article','contribution-feedback-card');const musicTitle=el('h3',null,'加入前 → 加入后的音乐目标');music.append(el('span','contribution-feedback-index','02 / SOUND'),musicTitle);
  const musicRows=el('div','contribution-feedback-values');const musicNote=el('p','contribution-feedback-note');music.append(musicRows,musicNote);
  const scent=el('article','contribution-feedback-card');scent.append(el('span','contribution-feedback-index','03 / SCENT'),el('h3',null,'下一轮配方的变化'));
  const scentRows=el('div','contribution-feedback-values');const scentNote=el('p','contribution-feedback-note','目标会平滑过渡；正在调配的批次保持不变。开启模拟后进入后续批次。');scent.append(scentRows,scentNote);
  body.append(portrait,music,scent);
  const foot=el('p','contribution-feedback-foot');panel.append(heading,body,foot);anchor.insertAdjacentElement('afterend',panel);
  const tracker=createFeedbackTracker();
  let impact=null,preview='group',isOwn=false,scope='local',disposed=false;
  const rows=(holder,values,isScent=false)=>{
    holder.replaceChildren();
    for(const value of values){const row=el('p','contribution-feedback-value');const name=el('span',null,value.label);const number=el('strong');
      number.textContent=isScent&&impact.first?`${value.to}%`:`${value.from}${isScent?'%':''} → ${value.to}${isScent?'%':''}`;
      const delta=el('small',null,isScent&&impact.first?'首份配方':`${signed(value.delta)} ${isScent?'个百分点':'点'}`);
      row.append(name,number,delta);holder.append(row);
    }
  };
  const updateReplay=()=>{
    const phase=panel.dataset.phase;
    replay.disabled=phase==='error'||phase==='unavailable';
    replay.textContent=panel.dataset.arrivalActive==='true'||phase==='waiting'?'查看六片融入 ↓':isOwn?'再次定位我的六片 ↗':'再次定位这六片 ↗';
  };
  const updateNotes=()=>{
    if(!impact)return;
    const playing=root.getElementById('music-toggle')?.getAttribute('aria-pressed')==='true';
    musicNote.textContent=preview!=='group'?'当前为情绪预览；切回「跟随群体」后使用这些目标。':playing?'目标按群体更新，音色平滑变化；新声部按乐谱逐步进入。':'声音尚未开启；点击「开启声音」听见新的群体目标。';
    foot.textContent=`${impact.joint?`这一轮检测到 ${impact.joinCount} 位观众加入，音乐与气味的数值是大家共同带来的变化，不能单独归因于某一位。`:impact.first?'音乐从待机状态开始；气味形成首份目标配方。':'数值比较本次加入前后的群体目标。'}${impact.replaced?`本轮也替换了 ${impact.removedCount} 条较早记录，变化包含这次替换。`:''}音乐为 0–100 控制值；气味为虚拟配比，${impact.count} 位观众等权汇合。`;
  };
  const show=(data,{own=false,room=false}={})=>{
    if(!data)return;const changed=impact?.participantId!==data.participantId;impact=data;isOwn=own;scope=room?'room':'local';
    panel.hidden=false;panel.dataset.participantId=data.participantId;panel.dataset.scope=scope;
    const label=Number.isFinite(data.number)?`#${String(data.number).padStart(2,'0')}`:'';
    title.textContent=data.joint?(own?'你的六片，加入这一轮共同变化':`${data.joinCount} 位观众共同留下的变化`):own?'你的加入，留下了这些变化':`新观众 ${label} 留下的变化`;
    eyebrow.textContent=data.joint?'A SHARED ARRIVAL':own?'YOUR CONTRIBUTION':'NEW CONTRIBUTION';
    context.textContent=(room?'共同展厅 · 同一份群体数据正在驱动教室大屏':'本轮作品 · 同一份群体数据驱动三种感官')+(data.joint?` · 本轮 ${data.joinCount} 人加入`:'');
    portraitTitle.textContent=data.joint?(own?'定位你的六片，看见自己的位置':`定位最新观众 ${label} 的六片`):'六片，成为共同面孔的一部分';
    musicTitle.textContent=data.joint?'这一轮前 → 后的共同音乐目标':'加入前 → 加入后的音乐目标';
    if(changed){stepNodes.forEach(n=>n.className='');status.textContent='照片正在对齐；点击「查看六片融入」可前往这六个位置。';replay.disabled=false;replay.textContent='查看六片融入 ↓';panel.dataset.phase='waiting';}
    rows(musicRows,data.music);if(data.musicUnchanged)musicRows.append(el('p','contribution-feedback-unchanged','主要音乐目标几乎不变（小于 0.1 点）；六片照片仍会留下。'));
    rows(scentRows,data.scent,true);if(data.scentUnchanged)scentRows.append(el('p','contribution-feedback-unchanged','取整后的八种原料比例保持不变。'));
    scentNote.textContent=preview!=='group'?'当前为情绪预览；此处保留本次加入带来的群体目标对比。':'目标会平滑过渡；当前批次保持不变。开启模拟后用于后续批次。';
    updateReplay();updateNotes();
  };
  const clear=()=>{impact=null;isOwn=false;panel.hidden=true;};
  const stateListener=event=>{
    const d=event.detail??{};const tracked=tracker.observe(d.state?.session,d);if(!tracked)return;
    const next=tracked.session;
    if(tracked.changedCohort||!next.participants.length)clear();
    else if(impact&&!next.participants.some(p=>p.id===impact.participantId))clear();
    // Keep a visitor's receipt readable while other phones join. The host, which has no
    // personal receipt selected, continues to show the newest shared arrival.
    if(tracked.impact&&!(isOwn&&scope==='room'))show(tracked.impact,{room:d.scope==='room'});
    updateNotes();
  };
  const contributionListener=event=>{
    const d=event.detail??{};
    if(tracker.cohort&&tracker.cohort!==feedbackCohort(d))return;
    const data=contributionImpact(feedbackSnapshot(d.before),feedbackSnapshot(d.after),d.participantId);
    if(data)show(data,{own:d.isOwn===true,room:d.scope==='room'});
  };
  const progressListener=event=>{
    const d=event.detail??{};if(!impact||d.participantId!==impact.participantId)return;
    const phase=d.phase??'waiting';panel.dataset.phase=phase;
    const index=['source','waiting'].includes(phase)?0:['travelling','revealing','merging'].includes(phase)?1:2;
    stepNodes.forEach((n,i)=>n.className=i<index?'complete':i===index?'active':'');
    const messages={waiting:isOwn?'正在准备你的六个照片碎片。':'正在准备这位观众的六个照片碎片。',source:'这六片来自同一张照片；连线指向大脸上的对应位置。',travelling:'六片正在沿各自的位置进入共同面孔。',revealing:'六片正在逐一浮现，其他人的位置保持不变。',merging:'照片正在与大脸融合；柔光标出这次改变的位置。',settling:'六片已经贴合，定位柔光正在淡出。',settled:'六片已留在大脸里。你可以随时重新定位这次贡献。',idle:'六片已留在大脸里。你可以随时重新定位这次贡献。',error:'照片还未准备好；请稍后重试定位。',unavailable:'这次贡献已离开当前保留的 32 条记录，无法继续定位。'};
    const message=messages[phase]||messages.waiting;if(status.textContent!==message)status.textContent=message;
    panel.dataset.arrivalActive=String(d.active===true);updateReplay();
  };
  const previewListener=event=>{preview=event.detail?.value??'group';if(impact)show(impact,{own:isOwn,room:scope==='room'});};
  const replayListener=()=>{if(!impact)return;events.dispatchEvent(new CustomEvent('portrait:show-contribution',{detail:{participantId:impact.participantId}}));};
  replay.addEventListener('click',replayListener);
  events.addEventListener('emotion:state',stateListener);events.addEventListener('emotion:contribution',contributionListener);
  events.addEventListener('portrait:contribution-progress',progressListener);events.addEventListener('emotion:preview',previewListener);
  const observer=typeof MutationObserver==='function'?new MutationObserver(updateNotes):null;
  const musicButton=root.getElementById('music-toggle');if(musicButton)observer?.observe(musicButton,{attributes:true,attributeFilter:['aria-pressed']});
  events.dispatchEvent(new Event('emotion:state-request'));
  return {dispose(){if(disposed)return;disposed=true;observer?.disconnect();events.removeEventListener('emotion:state',stateListener);events.removeEventListener('emotion:contribution',contributionListener);events.removeEventListener('portrait:contribution-progress',progressListener);events.removeEventListener('emotion:preview',previewListener);replay.removeEventListener('click',replayListener);panel.remove();}};
}

if(typeof window!=='undefined'&&typeof document!=='undefined')createContributionFeedback();
