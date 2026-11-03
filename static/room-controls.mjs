import {RoomClient, DEFAULT_ROOM_API} from './room-client.mjs?v=20261103-reconnect';
import {createRoomInvitation, parseRoomInvitation} from './room-invitation.mjs?v=20261103-reconnect';
import qrcode from './vendor/qrcode-generator.mjs';
export const ROOM_API=DEFAULT_ROOM_API;
export function createRoomControls({onState=()=>{},onError=()=>{},isBusy=()=>false}={}){
 const root=document.createElement('details');root.className='room-controls';root.id='room-controls';
 root.innerHTML=`<summary>跨设备教室房间 · 创建或加入（可选）</summary><div class="room-body"><p class="room-note">在同一台大屏电脑依次采集，就能共同改变一件作品，无需创建房间。手机等多台设备共同参与时，再使用教室房间。</p><p class="room-status" role="status">当前：个人体验</p><div class="room-actions" data-local><button type="button" data-create>在这台电脑创建教室大屏</button><input type="text" data-link aria-label="房间邀请链接" placeholder="粘贴老师分享的房间链接"><button type="button" data-join>加入房间</button></div><p class="room-detail" role="status" hidden></p><div class="room-actions" data-active hidden><button type="button" data-retry hidden>重新连接房间</button><button type="button" data-leave>返回个人体验</button><button type="button" class="room-danger" data-close hidden>结束房间并删除照片</button></div><label class="room-consent" hidden><input type="checkbox" data-consent><span>我同意将本次照片和表情分数发送到这个教室房间，供持有房间链接的人与大屏共同查看。房间最多保留最近 32 条记录，2 小时后失效；主持人可提前清空或结束。请勿转发含照片的房间链接。</span></label><div class="room-share" hidden><div class="room-qr" aria-label="教室房间二维码"></div><div><p>让同学扫描这个<strong>房间专用二维码</strong>，或发送邀请链接。大家的加入会更新这台大屏。大屏开启声音一次即可，后续不会自动重新播放。</p><button type="button" data-copy>复制房间邀请链接</button><p class="room-join-url"></p></div></div></div>`;
 document.querySelector('main')?.prepend(root);
 const $=s=>root.querySelector(s);
 let busy=false,connectionTask=false,taskEpoch=0,pendingInvitation=null,ownId=null,connection=null,notice='';
 const storedKey='empathy-classroom-host-v1';
 const forgetHost=()=>{try{sessionStorage.removeItem(storedKey);}catch{}};
 const status=$('.room-status'),detail=$('.room-detail'),consent=$('[data-consent]');
 const parse=text=>parseRoomInvitation(text,location.href);
 const invitation=credentials=>createRoomInvitation(location.href,credentials);
 const requested=()=>!!client.credentials||!!pendingInvitation||!!parse(location.href);
 const ready=()=>!!client.credentials&&!!client.snapshot;
 const client=new RoomClient({baseUrl:ROOM_API,pollIntervalMs:1500,
  onSnapshot:()=>{paint();onState();},
  onStatus:s=>{
   connection=s;
   if(s.status==='connected'){notice='';onError('');}
   if(s.status==='offline')notice='';
   if(s.status==='expired'){forgetHost();ownId=null;consent.checked=false;pendingInvitation=null;notice='';}
   paint();onState();
  },
 });
 function paint(){
  const active=!!client.credentials,invited=requested(),connected=ready();
  root.dataset.active=String(active);root.dataset.connection=connection?.status||'local';
  $('[data-local]').hidden=active||invited||connectionTask;
  $('[data-active]').hidden=!active&&!invited&&!connectionTask;
  $('.room-consent').hidden=!connected;
  $('.room-share').hidden=!connected||client.role!=='host';
  $('[data-close]').hidden=!connected||client.role!=='host';
  $('[data-retry]').hidden=!invited||busy||(connected&&connection?.status==='connected');
  $('[data-leave]').textContent=connectionTask?'取消连接':'返回个人体验';
  const candidate=client.credentials||pendingInvitation||parse(location.href);
  if(connected){
   status.textContent=`教室共同作品 · ${client.role==='host'?'大屏主持人':'参与者'} · ${client.snapshot.session.participant_count||0} 位观众 · 房间 ${client.credentials.roomId.slice(0,6)} · 约 ${new Date(client.snapshot.expiresAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 失效`;
   if(client.role==='host'){
    const url=invitation(client.credentials);
    if(url&&$('.room-join-url').textContent!==url){
     $('.room-join-url').textContent=url;const qr=qrcode(0,'M');qr.addData(url);qr.make();
     $('.room-qr').innerHTML=qr.createSvgTag({cellSize:3,margin:12,scalable:true});
    }
   }
  }else if(candidate)status.textContent=`教室 ${candidate.roomId.slice(0,6)} · ${connection?.status==='expired'?'房间不可用':'等待连接确认'}`;
  else status.textContent=connectionTask?'正在创建教室房间…':'当前：个人体验';
  const needsDetail=['connecting','offline','expired'].includes(connection?.status);
  detail.textContent=needsDetail?connection.detail:notice;detail.hidden=!detail.textContent;
  for(const button of root.querySelectorAll('button'))button.disabled=busy;
  // A waiting network request must always be cancellable, including creation.
  if(connectionTask)$('[data-leave]').disabled=false;
 }
 function messageFor(error,{creating=false}={}){
  if(creating&&(error?.code==='TIMEOUT'||error?.code==='NETWORK'))return '未能确认教室创建成功。请稍后再次点击“在这台电脑创建教室大屏”。';
  if(error?.code==='TIMEOUT'||error?.name==='TimeoutError'||/timed?\s*out|timeout/i.test(error?.message||''))return '连接教室服务超时。请保持页面打开等待重连，或点击“重新连接房间”。';
  if(error?.code==='NETWORK'||/fetch|network|load failed/i.test(error?.message||''))return '暂时无法连接教室服务。请检查手机网络；页面会自动尝试重连。';
  return error?.message||'教室连接未完成，请重试。';
 }
 async function task(fn,{connecting=false,creating=false}={}){
  if(busy||isBusy()){onError('请先完成当前采集或提交，再切换房间。');return;}
  const epoch=++taskEpoch;busy=true;connectionTask=connecting;notice='';onError('');paint();onState();
  try{await fn();if(epoch===taskEpoch)onError('');}
  catch(error){if(epoch===taskEpoch&&error?.code!=='CANCELLED'){const message=messageFor(error,{creating});onError(message);if(!client.credentials)notice=message;}}
  finally{if(epoch===taskEpoch){busy=false;connectionTask=false;paint();onState();}}
 }
 function leave(){
  if(!connectionTask&&isBusy()){onError('请先完成当前采集或提交，再切换房间。');return;}
  ++taskEpoch;busy=false;connectionTask=false;pendingInvitation=null;ownId=null;consent.checked=false;forgetHost();
  client.leave();connection=null;notice='';onError('');
  history.replaceState(null,'',location.pathname+location.search+'#gallery-panel');
  window.dispatchEvent(new HashChangeEvent('hashchange'));paint();onState();
 }
 async function join(credentials){
  if(!credentials)throw new Error('请粘贴完整的房间邀请链接。');
  pendingInvitation=credentials;consent.checked=false;ownId=null;root.open=true;
  await client.join(credentials);onState();
 }
 $('[data-create]').onclick=()=>task(async()=>{
  await client.createRoom();pendingInvitation=null;ownId=null;consent.checked=false;
  try{sessionStorage.setItem(storedKey,JSON.stringify(client.credentials));}catch{}
  root.open=true;history.replaceState(null,'',location.pathname+location.search+'#gallery-panel');
  window.dispatchEvent(new HashChangeEvent('hashchange'));onState();
 },{connecting:true,creating:true});
 $('[data-join]').onclick=()=>task(()=>join(parse($('[data-link]').value)),{connecting:true});
 $('[data-retry]').onclick=()=>task(()=>join(client.credentials||pendingInvitation||parse(location.href)),{connecting:true});
 $('[data-leave]').onclick=leave;
 $('[data-close]').onclick=()=>task(async()=>{
  if(!confirm('结束这个教室房间并删除所有参与照片？同学将不能再加入。'))return;
  await client.close();pendingInvitation=null;ownId=null;forgetHost();consent.checked=false;connection=null;notice='房间已结束，照片已删除。';onState();
 });
 $('[data-copy]').onclick=async()=>{
  try{await navigator.clipboard.writeText(invitation(client.credentials));notice='房间邀请链接已复制。';paint();}
  catch{onError('请手动复制二维码旁的完整链接。');}
 };
 // Incoming invitations never inherit another tab's host role.
 const incoming=parse(location.href);
 if(incoming){pendingInvitation=incoming;root.open=true;$('[data-link]').value=location.href;queueMicrotask(()=>task(()=>join(incoming),{connecting:true}));}
 else{try{
  const saved=JSON.parse(sessionStorage.getItem(storedKey)||'null');
  if(['roomId','joinToken','hostToken'].every(key=>typeof saved?.[key]==='string'&&/^[-_A-Za-z0-9]{32}$/.test(saved[key]))){pendingInvitation=saved;root.open=true;queueMicrotask(()=>task(()=>join(saved),{connecting:true}));}else if(saved)forgetHost();
 }catch{forgetHost();}}
 consent.addEventListener('change',()=>onState());paint();
 return {
  get roomId(){return client.credentials?.roomId||null;},get snapshot(){return client.snapshot;},get active(){return !!client.credentials;},
  get requested(){return requested();},get ready(){return ready();},get sharingConsent(){return consent.checked;},
  reveal(){root.open=true;root.scrollIntoView({behavior:'smooth',block:'start'});},
  revealConsent(){root.open=true;$('.room-consent').scrollIntoView({behavior:'smooth',block:'center'});consent.focus({preventScroll:true});},
  get role(){return client.role;},get busy(){return busy;},get ownId(){return ownId;},
  async submit(data){if(!consent.checked)throw new Error('请先在“教室共同作品”中勾选照片共享同意，再加入作品。');const result=await client.submit({...data,consent:true});ownId=result.recordId;return result.recordId;},
  async reset(){await client.reset();ownId=null;onState();},dispose(){++taskEpoch;client.leave();},paint,
 };
}
