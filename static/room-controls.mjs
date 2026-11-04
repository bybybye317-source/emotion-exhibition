import {RoomClient, DEFAULT_ROOM_API} from './room-client.mjs?v=20261104-tencent';
import {createRoomInvitation, parseRoomInvitation, ROOM_ENTRY_VERSION} from './room-invitation.mjs?v=20261104-tencent';
import {roomLifetime, shouldAutoCreateHost} from './room-lifetime.mjs?v=20261104-tencent';
import {readHostSession,writeHostSession,forgetHostSession} from './room-host-storage.mjs?v=20261104-tencent';
import qrcode from './vendor/qrcode-generator.mjs';
export const ROOM_API=DEFAULT_ROOM_API;
export function createRoomControls({onState=()=>{},onError=()=>{},isBusy=()=>false}={}){
 const root=document.createElement('details');root.className='room-controls';root.id='room-controls';root.open=true;
 root.innerHTML=`<summary>共享讲台 <span>扫码，共同改变一件作品</span></summary><div class="room-body">
  <div class="room-intro" data-local><div><p class="room-eyebrow">ONE SCREEN · MANY PEOPLE</p><h2>把这台电脑，变成大家的讲台。</h2><p class="room-note">打开综合展厅后自动生成一个有效 5 小时的二维码。大家用手机扫码加入，共同改变大屏上的人脸、音乐与气味。</p></div><div class="room-actions"><button type="button" class="room-primary" data-create>开启共享讲台 · 5 小时</button><button type="button" data-host-link>复制电脑端入口</button><button type="button" data-personal>个人体验</button></div><p class="room-start-note">综合展厅会自动开启或恢复讲台；也可以返回个人体验。</p><details class="room-manual"><summary>已有讲台邀请？粘贴链接加入</summary><div class="room-actions"><input type="text" data-link aria-label="讲台邀请链接" placeholder="粘贴讲台邀请链接"><button type="button" data-join>加入讲台</button></div></details></div>
  <div class="room-opening" hidden><span class="room-loading-dot" aria-hidden="true"></span><div><strong data-opening-title>正在连接共享讲台</strong><p data-opening-detail>正在连接共享服务，确认后即可扫码。</p></div></div><p class="room-status" role="status">当前：个人体验</p><p class="room-detail" role="status" hidden></p>
  <div class="room-share" hidden><div class="room-qr" aria-label="共享讲台二维码"></div><div class="room-share-copy"><p class="room-eyebrow">SCAN TO BECOME PART OF THE WORK</p><h2>扫码，加入这个共享讲台。</h2><p class="room-note">每个人贡献六片照片，同一份群体情绪驱动大屏的三种感官。手机加入后勾选照片共享同意，再开启摄像头即可自动采集。</p><div class="room-lifetime"><div><span>二维码剩余有效时间</span><strong data-countdown>—</strong></div><p data-deadline></p></div><button type="button" data-copy>复制手机邀请链接</button><details class="room-manual room-link-details"><summary>查看完整邀请链接</summary><p class="room-join-url"></p></details><p class="room-start-note">保持这台电脑的展厅开启。需要音乐时点击一次“开启声音”。</p></div></div>
  <div class="room-participant" hidden><p>你已进入同一个共享讲台。勾选下方同意后，开启摄像头，照片会自动加入共同作品。</p><p data-participant-deadline></p></div>
  <div class="room-actions" data-active hidden><button type="button" data-retry hidden>重新连接讲台</button><button type="button" data-leave>返回个人体验</button><button type="button" class="room-danger" data-close hidden>结束讲台并删除照片</button></div>
  <label class="room-consent" hidden><input type="checkbox" data-consent><span>我同意将本次照片和表情分数发送到这个共享讲台，供持有邀请链接的人与大屏共同查看。最多保留最近 32 条记录，<span data-consent-deadline>到讲台截止时间后失效</span>；主持人可提前清空或结束。请勿转发含照片的讲台链接。</span></label>
 </div>`;
 document.getElementById('room-startup')?.remove();
 document.querySelector('main')?.prepend(root);
 const $=s=>root.querySelector(s);
 let busy=false,connectionTask=false,taskEpoch=0,pendingInvitation=null,ownId=null,connection=null,notice='',disposed=false,expiryRequested=false,creatingRoom=false,openingStarted=0,creationFailed=false;
 const legacyOrigin='https://empathy-gallery-classroom.bybybye317.chatgpt.site';
 const forgetHost=()=>{try{forgetHostSession(sessionStorage,ROOM_API,{legacyOrigin});}catch{}};
 const rememberHost=()=>{if(client.role==='host'&&client.roomInfo)try{writeHostSession(sessionStorage,ROOM_API,{...client.credentials,expiresAt:client.roomInfo.expiresAt});}catch{}};
 const status=$('.room-status'),detail=$('.room-detail'),consent=$('[data-consent]');
 const parse=text=>parseRoomInvitation(text,location.href);
 const invitation=credentials=>createRoomInvitation(location.href,credentials);
 const requested=()=>!!client.credentials||!!pendingInvitation||!!parse(location.href);
 const lifetime=()=>roomLifetime(client.roomInfo?.expiresAt);
 const confirmed=()=>!!client.credentials&&!!client.roomInfo&&lifetime().known&&!lifetime().expired;
 const ready=()=>confirmed()&&!!client.snapshot;
 const deadlineLabel=expiry=>new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(expiry));
 const hostEntry=()=>{const url=new URL(location.href);url.search='';url.searchParams.set('v',ROOM_ENTRY_VERSION);url.searchParams.set('mode','host');url.hash='gallery-panel';return url.href;};
 const client=new RoomClient({baseUrl:ROOM_API,pollIntervalMs:1500,
  onRoomInfo:()=>{rememberHost();paint();},
  onSnapshot:()=>{expiryRequested=false;rememberHost();paint();onState();},
  onStatus:s=>{
   connection=s;
   if(s.status==='connected'){notice='';rememberHost();onError('');}
   if(s.status==='offline')notice='';
   if(s.status==='expired'){forgetHost();ownId=null;consent.checked=false;pendingInvitation=null;notice='';}
   paint();onState();
  },
 });
 function paint(){
  if(disposed)return;
  const active=!!client.credentials,invited=requested(),connected=confirmed(),life=lifetime();
  root.dataset.active=String(active);root.dataset.connection=connection?.status||'local';root.dataset.role=connected?client.role:'local';
  $('[data-local]').hidden=active||invited||connectionTask;
  $('[data-active]').hidden=!active&&!invited&&!connectionTask;
  $('.room-consent').hidden=!ready();
  $('.room-opening').hidden=!connectionTask||connected;
  $('[data-opening-title]').textContent=creatingRoom?'正在生成讲台二维码':'正在恢复共享讲台';
  if(connectionTask&&!connected){const seconds=Math.max(0,Math.floor((Date.now()-openingStarted)/1000));$('[data-opening-detail]').textContent=seconds<8?`正在连接共享服务 · 已等待 ${seconds} 秒`:`网络连接较慢 · 已等待 ${seconds} 秒。你可以取消或等待结果。`;}
  $('[data-create]').textContent=creationFailed?'重试生成二维码':'开启共享讲台 · 5 小时';
  $('.room-share').hidden=!connected||client.role!=='host';
  $('.room-participant').hidden=!connected||client.role!=='participant';
  $('[data-close]').hidden=!connected||client.role!=='host';
  $('[data-retry]').hidden=!invited||busy||connection?.status==='expired'||life.expired||(connected&&connection?.status==='connected');
  $('[data-leave]').textContent=connectionTask?'取消连接':'返回个人体验';
  const candidate=client.credentials||pendingInvitation||parse(location.href);
  if(connected){
   const deadline=deadlineLabel(client.roomInfo.expiresAt);
   status.textContent=`共享讲台 · ${client.role==='host'?'电脑大屏':'参与者'} · ${client.roomInfo.participant_count||0} 位观众 · 讲台 ${client.credentials.roomId.slice(0,6)}`;
   $('[data-countdown]').textContent=life.clock;
   $('[data-deadline]').textContent=`有效至 ${deadline}（本地时间）`;
   $('[data-participant-deadline]').textContent=`讲台有效至 ${deadline} · 剩余 ${life.clock}`;
   $('[data-consent-deadline]').textContent=`于 ${deadline} 后失效`;
   if(client.role==='host'){
    const url=invitation(client.credentials);
    if(url&&$('.room-join-url').textContent!==url){
     $('.room-join-url').textContent=url;const qr=qrcode(0,'M');qr.addData(url);qr.make();
     $('.room-qr').innerHTML=qr.createSvgTag({cellSize:4,margin:16,scalable:true});
    }
   }
  }else if(candidate)status.textContent=`共享讲台 ${candidate.roomId.slice(0,6)} · ${connection?.status==='expired'||life.expired?'已结束或过期':'等待连接确认'}`;
  else status.textContent=connectionTask?'正在开启共享讲台…':creationFailed?'共享服务连接失败 · 二维码尚未生成':connection?.status==='expired'?'共享讲台已过期，可以开启新的 5 小时讲台。':'当前：个人体验';
  // A stale QR must not remain scannable while the room is expired or unknown.
  if(!connected){$('.room-qr').replaceChildren();$('.room-join-url').textContent='';$('[data-countdown]').textContent='—';}
  const needsDetail=['connecting','offline','expired'].includes(connection?.status);
  detail.textContent=needsDetail?connection.detail:notice;detail.hidden=!detail.textContent;
  for(const button of root.querySelectorAll('button'))button.disabled=busy;
  if(connectionTask)$('[data-leave]').disabled=false;
 }
 function messageFor(error,{creating=false}={}){
  if(creating&&(error?.code==='TIMEOUT'||error?.code==='NETWORK'||error?.serviceResponse))return '共享讲台服务暂时无法访问，二维码尚未生成。请点击“重试生成二维码”；持续失败时，需要检查房间服务的访问限制。';
  if(error?.code==='TIMEOUT'||error?.name==='TimeoutError'||/timed?\s*out|timeout/i.test(error?.message||''))return '连接讲台服务超时。请保持页面打开等待重连，或点击“重新连接讲台”。';
  if(error?.code==='NETWORK'||/fetch|network|load failed/i.test(error?.message||''))return '暂时无法连接讲台服务。请检查手机网络；页面会自动尝试重连。';
  return error?.message||'讲台连接未完成，请重试。';
 }
 async function task(fn,{connecting=false,creating=false}={}){
  if(busy||isBusy()){onError('请先完成当前采集或提交，再切换讲台。');return;}
  const epoch=++taskEpoch;busy=true;connectionTask=connecting;creatingRoom=creating;openingStarted=Date.now();creationFailed=false;notice='';onError('');paint();onState();
  try{await fn();if(epoch===taskEpoch)onError('');}
  catch(error){if(epoch===taskEpoch&&error?.code!=='CANCELLED'){const message=messageFor(error,{creating:creatingRoom});creationFailed=creatingRoom&&!client.credentials;onError(message);if(!client.credentials)notice=message;}}
  finally{if(epoch===taskEpoch){busy=false;connectionTask=false;paint();onState();}}
 }
 function showPersonalUrl(){
  const url=new URL(location.href);url.searchParams.set('mode','personal');url.hash='gallery-panel';
  history.replaceState(null,'',url.href);window.dispatchEvent(new HashChangeEvent('hashchange'));
 }
 function leave(){
  if(!connectionTask&&isBusy()){onError('请先完成当前采集或提交，再切换讲台。');return;}
  ++taskEpoch;busy=false;connectionTask=false;creationFailed=false;pendingInvitation=null;ownId=null;consent.checked=false;forgetHost();
  client.leave();connection=null;notice='';onError('');showPersonalUrl();paint();onState();
 }
 async function join(credentials){
  if(!credentials)throw new Error('请粘贴完整的讲台邀请链接。');
  pendingInvitation=credentials;consent.checked=false;ownId=null;root.open=true;
  await client.join(credentials);onState();
 }
 async function create(){
  creatingRoom=true;
  await client.createRoom();pendingInvitation=null;ownId=null;consent.checked=false;rememberHost();
  root.open=true;history.replaceState(null,'',hostEntry());
  window.dispatchEvent(new HashChangeEvent('hashchange'));onState();
 }
 const start=()=>task(create,{connecting:true,creating:true});
 $('[data-create]').onclick=start;
 $('[data-host-link]').onclick=async()=>{
  try{await navigator.clipboard.writeText(hostEntry());notice='电脑端入口已复制。在同一标签页刷新会恢复当前讲台。';paint();}
  catch{onError('无法自动复制，请使用电脑端入口地址打开讲台。');}
 };
 $('[data-join]').onclick=()=>task(()=>join(parse($('[data-link]').value)),{connecting:true});
 $('[data-retry]').onclick=()=>task(()=>join(client.credentials||pendingInvitation||parse(location.href)),{connecting:true});
 $('[data-leave]').onclick=leave;
 $('[data-personal]').onclick=leave;
 $('[data-close]').onclick=()=>task(async()=>{
  if(!confirm('结束这个共享讲台并删除所有参与照片？同学将不能再加入。'))return;
  await client.close();pendingInvitation=null;ownId=null;forgetHost();consent.checked=false;connection=null;notice='讲台已结束，照片已删除。';showPersonalUrl();onState();
 });
 $('[data-copy]').onclick=async()=>{
  try{await navigator.clipboard.writeText(invitation(client.credentials));notice='手机邀请链接已复制。';paint();}
  catch{onError('请展开“查看完整邀请链接”后手动复制。');}
 };
 // Incoming invitations always win over desktop mode or saved host credentials.
 const incoming=parse(location.href),hostMode=shouldAutoCreateHost(location.href);
 let saved=null;
 try{if(new URL(location.href).searchParams.get('mode')!=='personal')saved=readHostSession(sessionStorage,ROOM_API,{legacyOrigin});}catch{}
 if(incoming){pendingInvitation=incoming;$('[data-link]').value=location.href;queueMicrotask(()=>task(()=>join(incoming),{connecting:true}));}
 else if(saved){
  pendingInvitation=saved;
  queueMicrotask(()=>task(async()=>{
   try{await join(saved);}
   catch(error){
    // Only a confirmed invalid/expired saved room may be replaced automatically.
    // A network failure must keep the original invitation and retry it.
    if(hostMode&&error.invalidatesRoom){pendingInvitation=null;forgetHost();await create();}
    else throw error;
   }
  },{connecting:true}));
 }else if(shouldAutoCreateHost(location.href,{hasInvitation:!!incoming,hasSavedHost:!!saved}))queueMicrotask(start);
 consent.addEventListener('change',()=>onState());paint();
 const clock=setInterval(()=>{
  paint();
  if(client.credentials&&client.roomInfo&&lifetime().expired&&!expiryRequested){
   expiryRequested=true;void client.refresh().catch(()=>{});
  }
 },1000);
 return {
  get roomId(){return client.credentials?.roomId||null;},get snapshot(){return client.snapshot;},get active(){return !!client.credentials;},
  get requested(){return requested();},get ready(){return ready();},get sharingConsent(){return consent.checked;},
  reveal(){root.open=true;root.scrollIntoView({behavior:'smooth',block:'start'});},
  revealConsent(){root.open=true;$('.room-consent').scrollIntoView({behavior:'smooth',block:'center'});consent.focus({preventScroll:true});},
  get role(){return client.role;},get busy(){return busy;},get ownId(){return ownId;},
  async submit(data){if(!consent.checked)throw new Error('请先在“共享讲台”中勾选照片共享同意，再加入作品。');const result=await client.submit({...data,consent:true});ownId=result.recordId;return result.recordId;},
  async reset(){await client.reset();ownId=null;onState();},dispose(){disposed=true;clearInterval(clock);++taskEpoch;client.leave();},paint,
 };
}
