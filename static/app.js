import {BrowserEmotionAnalyzer} from './browser-inference.mjs?v=20261027-sculpture';
import {LocalSession, EMOTION_KEYS} from './session-state.mjs?v=20261027-fragments';

const $=id=>document.getElementById(id);
const labels={happiness:'快乐',neutral:'中性',sadness:'悲伤',surprise:'惊讶',anger:'愤怒',fear:'恐惧',disgust:'厌恶',contempt:'轻蔑'};
const video=$('camera-stream');
const analyzer=new BrowserEmotionAnalyzer();
const session=new LocalSession({onRelease:url=>URL.revokeObjectURL(url)});
const state={camera:{status:'off'},model:{status:'unloaded',detail:'浏览器内推理 · 点击后加载'},live:{status:'waiting',scores:{}},capture:{status:'idle',detail:'开启摄像头，或使用下方照片参与。',progress:0},session:session.snapshot()};
let disposed=false,initPromise=null,cameraGeneration=0,stream=null,loopTimer=null,captureTimer=null,captureRun=null;
let testingImage=false,testedImage=null,testPreviewUrl=null,recordSignature='';
const frame=document.createElement('canvas');
const frameContext=frame.getContext('2d',{willReadFrequently:true});
const pending=()=>state.camera.status==='starting'||testingImage;
const emit=()=>window.dispatchEvent(new CustomEvent('emotion:state',{detail:{state:structuredClone(state),connected:true}}));
function error(message='') {$('action-error').hidden=!message;$('action-error').textContent=message;}
function makeRows(id) {
  const root=$(id);root.replaceChildren();const rows={};
  for(const key of EMOTION_KEYS){const row=document.createElement('div');row.className='score-row';const label=document.createElement('span');label.className='score-label';label.textContent=labels[key];const track=document.createElement('div');track.className='score-track';const fill=document.createElement('div');fill.className='score-fill';track.append(fill);const value=document.createElement('span');value.className='score-number';value.textContent='—';row.append(label,track,value);root.append(row);rows[key]={row,fill,value};}return rows;
}
const liveRows=makeRows('live-scores'), groupRows=makeRows('group-scores'), imageRows=makeRows('image-scores');
function scoresToRows(rows,scores={}) {
  const valid=EMOTION_KEYS.some(key=>Number.isFinite(scores?.[key]));
  const top=valid?EMOTION_KEYS.reduce((a,b)=>(scores[a]||0)>=(scores[b]||0)?a:b):null;
  for(const key of EMOTION_KEYS){const p=Math.max(0,Math.min(1,scores?.[key]||0));rows[key].fill.style.width=`${p*100}%`;rows[key].value.textContent=valid?`${(p*100).toFixed(1)}%`:'—';rows[key].row.classList.toggle('highest',key===top);}
}
function controls(){
  const running=state.camera.status==='running', capturing=Boolean(captureRun);
  $('start-camera').disabled=running||pending();$('stop-camera').disabled=!running&&state.camera.status!=='starting';
  $('capture').disabled=!running||state.model.status!=='ready'||capturing||state.live.status!=='ok';
  $('reset-session').disabled=!session.records.length||capturing;
  $('test-file').disabled=testingImage||capturing;
  $('test-image').disabled=testingImage||capturing||!$('test-file').files.length;
  $('add-image').disabled=testingImage||!testedImage;
  $('start-camera').querySelector('span').textContent=state.camera.status==='starting'?'正在准备…':running?'摄像头已开启':'开启摄像头';
  $('capture-label').textContent=capturing?'正在采集…':state.capture.status==='completed'?'采集下一位':'采集 3 秒';
  $('test-image').textContent=testingImage?'正在分析…':'分析图片';
}
function render(){
  if(disposed)return;
  state.session=session.snapshot();
  const running=state.camera.status==='running', starting=state.camera.status==='starting';
  $('connection').classList.toggle('connected',running);$('connection').classList.toggle('problem',state.camera.status==='error');
  $('connection-text').textContent=running?'浏览器摄像头运行中':starting?'正在准备识别':state.camera.status==='error'?'摄像头不可用':'浏览器本地体验';
  video.hidden=!stream;$('camera-placeholder').hidden=Boolean(stream);
  $('camera-placeholder-title').textContent=starting?'正在准备摄像头与模型':state.camera.status==='error'?'摄像头暂不可用':'摄像头尚未开启';
  $('camera-placeholder-detail').textContent=state.camera.detail||'照片在你的浏览器内处理，也可以使用下方照片参与';
  const valid=running&&state.live.status==='ok';scoresToRows(liveRows,valid?state.live.scores:{});
  $('top-emotion').textContent=valid?labels[state.live.top_emotion]||'':'';
  $('live-detail').textContent=state.model.status==='loading'?state.model.detail:state.live.detail||'等待开启摄像头';
  $('performance').textContent=valid?`浏览器推断 ${Math.round(state.live.inference_ms)} ms`:'';
  $('preview-badge').hidden=!running;$('preview-badge').textContent=valid?'检测到一张人脸':'等待有效人脸';
  $('capture-detail').textContent=state.capture.detail;$('capture-detail').className=state.capture.status;
  $('capture-progress').hidden=!captureRun;$('capture-progress').setAttribute('aria-valuenow',String(Math.round(state.capture.progress*100)));$('capture-progress-fill').style.width=`${state.capture.progress*100}%`;
  $('model-status').textContent=state.model.status==='ready'?'enet_b0_8_best_afew · 浏览器 WASM · 照片不上传':state.model.detail;
  const count=state.session.participant_count;$('participant-count').textContent=`${count} 人`;$('records-empty').hidden=Boolean(count);$('participant-list').hidden=!count;$('group-empty').hidden=Boolean(count);$('group-scores').hidden=!count;scoresToRows(groupRows,state.session.group_scores);
  const signature=session.records.map(p=>p.id).join('|');
  if(signature!==recordSignature){recordSignature=signature;$('participant-list').replaceChildren(...session.records.slice().reverse().map((p,i)=>{const li=document.createElement('li');li.className='participant-item';const img=document.createElement('img');img.className='participant-image';img.alt=`本轮参与者 ${count-i}`;img.src=p.image_url;const text=document.createElement('p');text.textContent=`#${String(count-i).padStart(2,'0')} · ${labels[p.emotion]}`;const time=document.createElement('time');time.textContent=new Date(p.time).toLocaleTimeString('zh-CN');li.append(img,text,time);return li;}));}
  controls();emit();
}
async function ensureModel(){
  if(state.model.status==='ready')return;
  if(!initPromise){state.model={status:'loading',detail:'正在准备浏览器识别模型…'};render();
    initPromise=analyzer.init(message=>{if(!disposed){state.model.detail=String(message);render();}}).then(()=>{state.model={status:'ready',detail:'模型就绪'};}).catch(e=>{state.model={status:'error',detail:`识别加载失败：${e.message}。仍可使用情绪联动预览。`};throw e;}).finally(()=>{initPromise=null;render();});}
  return initPromise;
}
const blobFromCanvas=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('照片生成失败')),'image/jpeg',.86));
function cancelCapture(detail='采集已停止。'){
  clearTimeout(captureTimer);captureTimer=null;captureRun=null;
  if(state.capture.status==='capturing')state.capture={status:'idle',detail,progress:0};
}
function stopCamera(detail='摄像头已停止，照片记录仍保留在本轮。'){
  ++cameraGeneration;clearTimeout(loopTimer);loopTimer=null;cancelCapture(detail);
  if(stream)for(const track of stream.getTracks())track.stop();stream=null;video.srcObject=null;
  state.camera={status:'off'};state.live={status:'waiting',scores:{},detail:'等待开启摄像头'};render();
}
async function cameraLoop(generation){
  if(disposed||generation!==cameraGeneration||!stream||state.camera.status!=='running')return;
  const started=performance.now();
  try{
    if(video.readyState<2||!video.videoWidth){loopTimer=setTimeout(()=>cameraLoop(generation),100);return;}
    const scale=Math.min(1,960/video.videoWidth);frame.width=Math.round(video.videoWidth*scale);frame.height=Math.round(video.videoHeight*scale);frameContext.drawImage(video,0,0,frame.width,frame.height);
    const result=await analyzer.analyze(frame);
    if(disposed||generation!==cameraGeneration)return;
    state.live={...result,last_update:Date.now()/1000};
    const run=captureRun;
    if(run&&result.status==='ok'){
      run.scores.push(result.scores);
      if(!run.best||result.quality>run.best.quality){const blob=await blobFromCanvas(frame);if(captureRun===run&&generation===cameraGeneration)run.best={blob,anchors:result.photo_anchors,quality:result.quality};}
    }
    render();
  }catch(e){if(generation===cameraGeneration){state.live={status:'error',scores:{},detail:`识别失败：${e.message}`};render();}}
  if(!disposed&&generation===cameraGeneration)loopTimer=setTimeout(()=>cameraLoop(generation),Math.max(40,250-(performance.now()-started)));
}
$('start-camera').addEventListener('click',async()=>{
  if(pending()||stream)return;error();const generation=++cameraGeneration;state.camera={status:'starting',detail:'请允许浏览器使用摄像头。若一直等待，可检查系统权限或停止后用照片参与。'};render();
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('当前环境不支持摄像头，请使用 HTTPS 页面或照片参与。');
    const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:720}},audio:false});
    if(disposed||generation!==cameraGeneration){next.getTracks().forEach(track=>track.stop());return;}
    stream=next;video.srcObject=stream;await video.play();render();await ensureModel();
    if(disposed||generation!==cameraGeneration)return;
    state.camera={status:'running'};state.live={status:'waiting',scores:{},detail:'正在寻找人脸'};
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(generation===cameraGeneration)stopCamera('摄像头连接已结束。');});
    render();cameraLoop(generation);
  }catch(e){if(generation!==cameraGeneration||disposed)return;stopCamera();const detail=['NotAllowedError','PermissionDeniedError'].includes(e.name)?'未获得摄像头权限。可以用照片参与，或允许权限后重试。':e.message;state.camera={status:'error',detail};error(detail);render();}
});
$('stop-camera').addEventListener('click',()=>stopCamera());
$('capture').addEventListener('click',()=>{
  if(captureRun||state.camera.status!=='running'||state.live.status!=='ok')return;
  const run={started:performance.now(),scores:[],best:null};captureRun=run;state.capture={status:'capturing',detail:'请保持一位观众正对镜头，采集 3 秒。',progress:0};render();
  captureTimer=setTimeout(()=>{
    if(captureRun!==run||disposed)return;captureRun=null;captureTimer=null;
    if(run.scores.length<6||!run.best){state.capture={status:'rejected',progress:0,detail:`有效画面 ${run.scores.length} 帧，至少需要 6 帧。请保持稳定重试，或用照片参与。`};render();return;}
    const scores=Object.fromEntries(EMOTION_KEYS.map(key=>[key,run.scores.reduce((sum,p)=>sum+(p[key]||0),0)/run.scores.length]));
    session.add({scores,photoUrl:URL.createObjectURL(run.best.blob),anchors:run.best.anchors});state.capture={status:'completed',progress:1,detail:'采集完成，正在展示你贡献的片段。'};revealContribution();
  },3000);
});
$('reset-session').addEventListener('click',()=>{if(!session.records.length)return;if(confirm('清空当前浏览器本轮照片与记录？')){cancelCapture();session.reset();state.capture={status:'idle',detail:'本轮已清空，可以重新参与。',progress:0};render();}});
function clearTest(){testedImage=null;$('add-image').disabled=true;if(testPreviewUrl)URL.revokeObjectURL(testPreviewUrl);testPreviewUrl=null;$('test-preview').removeAttribute('src');$('image-test-result').hidden=true;scoresToRows(imageRows,{});}
$('test-file').addEventListener('change',()=>{clearTest();controls();});
$('image-test-form').addEventListener('submit',async event=>{
  event.preventDefault();const file=$('test-file').files[0];if(!file||testingImage||captureRun)return;
  if(file.size>8*1024*1024){error('请选择 8 MB 以内的 JPG、PNG 或 WebP 图片。');return;}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){error('请选择 JPG、PNG 或 WebP 图片。');return;}
  stopCamera();clearTest();testingImage=true;error();$('image-test-result').hidden=false;$('image-test-detail').textContent='正在准备识别并分析图片…';render();
  let bitmap;
  try{
    bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>20_000_000)throw new Error('图片分辨率过大，请先缩小到 2000 万像素以内。');
    const canvas=document.createElement('canvas');const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;
    const blob=await blobFromCanvas(canvas);testPreviewUrl=URL.createObjectURL(blob);$('test-preview').src=testPreviewUrl;
    await ensureModel();const result=await analyzer.analyze(canvas);if(disposed)return;
    scoresToRows(imageRows,result.scores);$('image-test-detail').textContent=result.status==='ok'?`已识别一张人脸 · 最高分：${labels[result.top_emotion]}。点击下方按钮加入作品。`:result.detail||'未找到可用的人脸，请换一张正面照片。';
    if(result.status==='ok')testedImage={blob,scores:result.scores,anchors:result.photo_anchors};
  }catch(e){$('image-test-detail').textContent=`图片分析未完成：${e.message}`;}
  finally{bitmap?.close();testingImage=false;controls();render();}
});
$('add-image').addEventListener('click',()=>{
  if(!testedImage)return;session.add({scores:testedImage.scores,photoUrl:URL.createObjectURL(testedImage.blob),anchors:testedImage.anchors});testedImage=null;$('image-test-detail').textContent='已加入当前群体作品，可以继续添加下一位。';state.capture={status:'completed',progress:1,detail:'照片已加入作品，正在展示你贡献的片段。'};revealContribution();
});
const views=['portrait','music','scent','capture'];const viewTitles={portrait:'群体肖像',music:'群体声景',scent:'群体气味',capture:'参与作品'};
function selectView(name,focus=false){if(!views.includes(name))name='portrait';for(const view of views){const active=name===view;const tab=$(`nav-${view}`);tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(`${view}-panel`).hidden=!active;if(active&&focus)tab.focus();}$('page-title').textContent=viewTitles[name];document.title=`${viewTitles[name]} · 机器如何理解人类的情绪`;window.dispatchEvent(new Event('resize'));if(location.hash!==`#${name}-panel`)history.replaceState(null,'',`#${name}-panel`);}
function revealContribution(){
  // Publish the new record before revealing the stage so its arrival can be
  // prepared while hidden, then begin once the audience can actually see it.
  render();
  const preview=$('artwork-preview');
  if(preview.value!=='group'||$('portrait-preview').value!=='group'){
    preview.value='group';
    preview.dispatchEvent(new Event('change'));
  }
  selectView('portrait',true);
  $('portrait-workspace').scrollIntoView({behavior:'instant',block:'center'});
  window.dispatchEvent(new Event('portrait:reveal'));
}
function selectHashView(){const name=location.hash.replace(/^#/, '').replace(/-panel$/, '');selectView(views.includes(name)?name:'portrait');}
window.addEventListener('hashchange',selectHashView);
for(const [i,name] of views.entries()){
  $(`nav-${name}`).addEventListener('click',()=>selectView(name));
  $(`nav-${name}`).addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=views[(i+1)%views.length];if(event.key==='ArrowLeft')next=views[(i+views.length-1)%views.length];if(event.key==='Home')next=views[0];if(event.key==='End')next=views.at(-1);if(next){event.preventDefault();selectView(next,true);}});
}
document.querySelectorAll('a[href="#scent-panel"]').forEach(link=>link.addEventListener('click',()=>selectView('scent')));
window.addEventListener('emotion:state-request',emit);
const tick=setInterval(()=>{if(captureRun){state.capture.progress=Math.min(1,(performance.now()-captureRun.started)/3000);render();}},100);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(stream||state.camera.status==='starting'))stopCamera('页面离开前台，摄像头和本次采集已停止。');});
window.addEventListener('pagehide',event=>{stopCamera();if(event.persisted)return;disposed=true;clearInterval(tick);session.reset();clearTest();analyzer.dispose?.();});
selectHashView();render();
