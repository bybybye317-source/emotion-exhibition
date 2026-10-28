import {LABELS,normalizeScores} from './portrait-math.mjs?v=20261028-gallery192';
const $=id=>document.getElementById(id);
const colors={happiness:'#d2b884',neutral:'#b8b5ac',sadness:'#839fc1',surprise:'#84b8b1',anger:'#c67f78',fear:'#a396c4',disgust:'#8aab8e',contempt:'#ad9f8c'};
let session={participants:[],participant_count:0,group_scores:{}},preview='group';
const rows=Object.entries(LABELS).map(([key,label])=>{
 const row=document.createElement('div');row.className='gallery-meter';row.dataset.emotion=key;
 const text=document.createElement('span');text.textContent=label;
 const value=document.createElement('output');value.textContent='—';const track=document.createElement('i'),fill=document.createElement('b');fill.style.background=colors[key];track.append(fill);row.append(text,value,track);$('gallery-spectrum').append(row);return {key,value,fill};
});
function render(){
 const scores=normalizeScores(preview==='group'?session.group_scores:{[preview]:1}),has=Object.keys(scores).length>0;
 $('gallery-count').textContent=`${session.participant_count||0} 位观众`;
 $('gallery-emotion-heading').textContent=preview==='group'?'群体情绪':'情绪预览';
 $('gallery-emotion-note').textContent=preview!=='group'?`正在预览${LABELS[preview]} · 未写入群体记录`:(session.participant_count?`本轮 ${session.participant_count} 位观众等权汇合 · 三种感官共同响应`:'等待第一位观众 · 三种感官共享本轮数据');
 for(const row of rows){const percent=(scores[row.key]||0)*100;row.fill.style.width=`${percent}%`;row.value.textContent=has?`${percent.toFixed(0)}%`:'—';}
}
window.addEventListener('emotion:state',event=>{if(event.detail?.state?.session){session=event.detail.state.session;render();}});
window.addEventListener('emotion:preview',event=>{preview=event.detail?.value||'group';render();});
$('gallery-fullscreen').addEventListener('click',async()=>{
 try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
 catch{$('action-error').hidden=false;$('action-error').textContent='当前浏览器未能进入全屏，仍可在页面中体验。';}
});
document.addEventListener('fullscreenchange',()=>{$('gallery-fullscreen').querySelector('span').textContent=document.fullscreenElement?'退出全屏':'全屏展厅';});
render();window.dispatchEvent(new Event('emotion:state-request'));
