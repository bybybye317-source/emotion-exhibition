// Classroom transport. Photo upload happens only after explicit consent in submit().
// Credentials are held in memory; UI owns optional sessionStorage and fragment links.
export const DEFAULT_ROOM_API='https://43.161.198.80';
export class RoomError extends Error {constructor(message,status,{invalidatesRoom=false,serviceResponse=false,retryable=false,code}={}){super(message);this.status=status;this.invalidatesRoom=invalidatesRoom;this.serviceResponse=serviceResponse;this.retryable=retryable;this.code=code;}}
// These are the relay's room-auth/expiry responses. A gateway can return the same
// HTTP status, so status alone must never discard a connected room's credentials.
const ROOM_INVALIDATION_ERRORS={401:'需要房间凭证',403:'房间凭证无效',404:'房间已结束或过期'};
export async function photoForRoom(blob){
 if(!(blob instanceof Blob))throw new Error('缺少可提交的照片');
 const bitmap=await createImageBitmap(blob);
 try{
  const canvas=document.createElement('canvas');let scale=Math.min(1,960/Math.max(bitmap.width,bitmap.height));
  for(let attempt=0;attempt<3;attempt++){
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   for(const quality of [.85,.7,.55]){const data=canvas.toDataURL('image/jpeg',quality);if((data.length-23)*.75<=240*1024)return data;}
   scale*=.7;
  }
  throw new Error('照片压缩后仍过大，请换一张照片');
 }finally{bitmap.close();}
}
export class RoomClient {
 constructor({baseUrl=DEFAULT_ROOM_API,onSnapshot=()=>{},onRoomInfo=()=>{},onStatus=()=>{},pollIntervalMs=1500,requestTimeoutMs=30000,fetchImpl=globalThis.fetch.bind(globalThis)}={}){
  const url=new URL(baseUrl);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('房间服务需要 HTTPS');
  this.baseUrl=url.origin;this.onSnapshot=onSnapshot;this.onRoomInfo=onRoomInfo;this.onStatus=onStatus;this.pollIntervalMs=Math.max(1000,pollIntervalMs);this.requestTimeoutMs=Number.isFinite(requestTimeoutMs)&&requestTimeoutMs>0?requestTimeoutMs:30000;this.fetchImpl=fetchImpl;
  this.snapshot=null;this.roomInfo=null;this.role=null;this.credentials=null;this._epoch=0;this._timer=null;this._photos=new Map();this._pendingRefresh=null;this._pendingSubmit=null;this._applyTail=Promise.resolve();this._abort=new AbortController();this._failures=0;this._retryAllowed=true;
 }
 _status(status,detail){this.onStatus({status,detail});}
 async _request(path,{method='GET',body,host=false,responseType='json'}={}){
  const headers={};const token=host?this.credentials?.hostToken:this.credentials?.joinToken;
  if(token)headers.Authorization=`Bearer ${token}`;
  if(body!==undefined)headers['Content-Type']='application/json';
  // Plain AbortController works on mobile browsers without AbortSignal.any.
  // Include body reads in the deadline; receiving headers is not completion.
  const parent=this._abort.signal,controller=new AbortController();let timer,cancel;
  const cancelled=()=>new RoomError('房间操作已取消',0,{code:'CANCELLED'});
  if(parent.aborted)throw cancelled();
  const stopped=new Promise((_,reject)=>{
   cancel=()=>{controller.abort();reject(cancelled());};
   parent.addEventListener('abort',cancel,{once:true});
   timer=setTimeout(()=>{controller.abort();reject(new RoomError('连接教室服务超时，请检查网络后重试。',0,{retryable:true,code:'TIMEOUT'}));},this.requestTimeoutMs);
  });
  try{
   return await Promise.race([stopped,(async()=>{
    const response=await this.fetchImpl(this.baseUrl+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
    const contentType=response.headers.get('Content-Type')||'',isJson=/^application\/json\b/i.test(contentType);
    const serviceError=()=>new RoomError(`教室服务返回了无法识别的响应（HTTP ${response.status}），暂时无法确认房间状态。`,response.status,{serviceResponse:true,retryable:true});
    if(!response.ok){let payload;if(isJson){try{payload=await response.json();}catch{}}
     if(typeof payload?.error!=='string')throw serviceError();
     const invalidatesRoom=payload.error===ROOM_INVALIDATION_ERRORS[response.status];
     throw new RoomError(payload.error,response.status,{invalidatesRoom,retryable:!invalidatesRoom&&(response.status>=500||[408,409,425,429].includes(response.status))});
    }
    if(responseType==='photo'?!/^image\/jpeg\b/i.test(contentType):!isJson)throw serviceError();
    try{return await(responseType==='photo'?response.blob():response.json());}
    catch(error){if(controller.signal.aborted)throw error;throw serviceError();}
   })()]);
  }catch(error){
   if(error instanceof RoomError)throw error;
   if(parent.aborted)throw cancelled();
   throw new RoomError('暂时无法连接教室服务，请检查网络后重试。',0,{retryable:true,code:'NETWORK'});
  }finally{clearTimeout(timer);parent.removeEventListener('abort',cancel);}
 }
 async createRoom(){
  this.leave(false);const epoch=this._epoch;this._status('connecting','正在创建教室房间…');
  try{
   const value=await this._request('/api/rooms',{method:'POST'});
   if(epoch!==this._epoch)throw new Error('房间操作已取消');
   this.credentials={roomId:value.roomId,joinToken:value.joinToken,hostToken:value.hostToken};this.role='host';
   await this._apply(value.snapshot,epoch);if(epoch!==this._epoch)throw new Error('房间操作已取消');this._status('connected','教室房间已连接');this._schedule();return {...this.credentials,expiresAt:value.expiresAt,snapshot:this.snapshot};
  }catch(error){
   if(epoch===this._epoch){this.leave(false);this.onSnapshot(null);this._status('offline',error.message);}
   throw error;
  }
 }
 async join({roomId,joinToken,hostToken}){
  if(![roomId,joinToken].every(v=>typeof v==='string'&&/^[-_A-Za-z0-9]{32}$/.test(v))||(hostToken&&!/^[-_A-Za-z0-9]{32}$/.test(hostToken)))throw new Error('房间链接无效');
  this.leave(false);const epoch=this._epoch;
  this.credentials={roomId,joinToken,...(hostToken?{hostToken}:{})};this.role=hostToken?'host':'participant';
  this._status('connecting','正在连接教室展厅…');
  try{
   await this.refresh();if(epoch!==this._epoch)throw new Error('房间操作已取消');
   this._schedule();return this.snapshot;
  }catch(error){
   // A slow first request is not a bad invitation. Keep the room and reconnect
   // in the background; never let an old join tear down a newer room.
   if(epoch===this._epoch&&this.credentials)this._schedule();
   throw error;
  }
 }
 async _apply(value,epoch){
  this._publishRoomInfo(value,epoch);
  const run=this._applyTail.catch(()=>{}).then(()=>this._hydrate(value,epoch));this._applyTail=run;return run;
 }
 _publishRoomInfo(value,epoch){
  if(epoch!==this._epoch||!this.credentials||!value||value.unchanged)return;
  const count=value.session?.participant_count;
  if(value.roomId!==this.credentials.roomId||!Number.isFinite(value.expiresAt)||!Number.isSafeInteger(value.revision)||value.revision<0||!Number.isSafeInteger(value.generation)||value.generation<0||!Number.isSafeInteger(count)||count<0||!Array.isArray(value.session?.participants)||count!==value.session.participants.length){
   throw new RoomError('讲台信息不完整，暂时无法确认房间状态。',200,{serviceResponse:true,retryable:true});
  }
  if(this.roomInfo&&value.revision<this.roomInfo.revision)return;
  // Metadata can reveal a verified invitation before photos finish downloading.
  // It deliberately does not publish an incomplete artwork snapshot.
  this.roomInfo=Object.freeze({roomId:value.roomId,expiresAt:value.expiresAt,participant_count:count,revision:value.revision,generation:value.generation});
  this._checkExpiry();this.onRoomInfo(this.roomInfo);
 }
 _checkExpiry(){
  const deadlines=[this.snapshot?.expiresAt,this.roomInfo?.expiresAt].filter(Number.isFinite);
  if(deadlines.some(expiry=>expiry<=Date.now())){
   this.leave(false);this.onSnapshot(null);this._status('expired','房间已过期，房间照片已从本机移除');throw new RoomError('房间已过期',404,{invalidatesRoom:true});
  }
 }
 async _hydrate(value,epoch){
  if(epoch!==this._epoch||!value||value.unchanged)return;
  if(this.snapshot&&value.revision<=this.snapshot.revision)return;
  const next=new Map(),added=[];
  try{
   const rows=value.session.participants;let cursor=0;
   const loader=async()=>{while(cursor<rows.length){const row=rows[cursor++];let photo=this._photos.get(row.id);
    if(!photo){let blob;try{blob=await this._request(row.photo_path,{responseType:'photo'});}catch(error){if(error.status===404&&error.message==='这份照片已移除')throw new RoomError('照片已更新，正在重新同步',409,{retryable:true});throw error;}if(epoch!==this._epoch)throw new Error('房间操作已取消');photo=URL.createObjectURL(blob);added.push(photo);}
    next.set(row.id,photo);
   }};
   const outcomes=await Promise.allSettled(Array.from({length:Math.min(4,rows.length)},loader));
   const failure=outcomes.find(r=>r.status==='rejected');if(failure)throw failure.reason;
   if(epoch!==this._epoch||this.snapshot&&value.revision<this.snapshot.revision){added.forEach(u=>URL.revokeObjectURL(u));return;}
   this._checkExpiry();
   const previous=this._photos;this._photos=next;
   this.snapshot={...value,session:{...value.session,participants:rows.map(r=>({...r,image_url:next.get(r.id)}))}};
   this.onSnapshot(this.snapshot);
   for(const [id,url] of previous)if(next.get(id)!==url)URL.revokeObjectURL(url);
  }catch(error){added.forEach(u=>URL.revokeObjectURL(u));throw error;}
 }
 async refresh(){
  if(!this.credentials)return null;
  // Enforce expiry on this device even when the service is temporarily unreachable.
  this._checkExpiry();
  if(this._pendingRefresh)return this._pendingRefresh;
  const epoch=this._epoch,room=this.credentials.roomId;
  const run=(async()=>{
   try{
    const since=this.snapshot?`?since=${this.snapshot.revision}`:'';const value=await this._request(`/api/rooms/${room}${since}`);
    await this._apply(value,epoch);if(epoch!==this._epoch)throw new Error('房间操作已取消');this._failures=0;this._retryAllowed=true;this._status('connected','教室展厅已同步');return this.snapshot;
   }catch(error){if(epoch===this._epoch){if(error.invalidatesRoom){this.leave(false);this.onSnapshot(null);this._status('expired','房间已结束、过期或链接无效，房间照片已从本机移除');}else{this._failures++;this._retryAllowed=error.retryable!==false;const recovery=this._retryAllowed?(this.snapshot?'保留当前画面，正在自动重连。':'保留房间邀请，正在自动重连；也可点击重新连接。'):'请检查房间地址，或点击重新连接。';this._status('offline',`${error.message} ${recovery}`);}}throw error;}
  })();this._pendingRefresh=run;try{return await run;}finally{if(this._pendingRefresh===run)this._pendingRefresh=null;}
 }
 _schedule(){clearTimeout(this._timer);if(!this.credentials||!this._retryAllowed)return;const epoch=this._epoch,delay=Math.min(15000,this.pollIntervalMs*2**Math.min(4,Math.max(0,this._failures-1)));this._timer=setTimeout(async()=>{if(epoch!==this._epoch)return;try{await this.refresh();}catch{}if(epoch===this._epoch)this._schedule();},delay);}
 async submit({blob,scores,anchors,consent,requestId}={}){
  if(consent!==true)throw new Error('请先同意将照片与表情分数提交到教室展厅');
  if(!this.credentials||!this.snapshot)throw new Error('请先连接教室房间');
  const epoch=this._epoch,generation=this.snapshot.generation,roomId=this.credentials.roomId;
  const assertCurrent=()=>{
   if(epoch!==this._epoch||this.credentials?.roomId!==roomId)throw new Error('房间操作已取消');
   if(this.snapshot?.generation!==generation)throw new Error('本轮已更新，请重新采集后提交');
  };
  // Retrying the same Blob after a network timeout reuses an idempotency key.
  const prior=this._pendingSubmit;
  const id=requestId||(prior?.blob===blob&&prior.generation===generation?prior.id:crypto.randomUUID());
  this._pendingSubmit={blob,generation,id};const photoDataUrl=await photoForRoom(blob);
  assertCurrent();
  const value=await this._request(`/api/rooms/${roomId}/contributions`,{method:'POST',body:{requestId:id,generation,scores,anchors,photoDataUrl,consent:true}});
  // Polling may expire or reset this room while the request or photo hydration
  // is in flight. A stale receipt must never become current-scope success UI.
  assertCurrent();
  if(value.snapshot?.generation!==generation)throw new Error('本轮已更新，请重新采集后提交');
  await this._apply(value.snapshot,epoch);assertCurrent();return {recordId:value.recordId,snapshot:this.snapshot};
 }
 async reset(){if(this.role!=='host')throw new Error('只有教室大屏可以清空本轮');const epoch=this._epoch;const value=await this._request(`/api/rooms/${this.credentials.roomId}/reset`,{method:'POST',host:true});this._pendingSubmit=null;await this._apply(value,epoch);return this.snapshot;}
 async close(){if(this.role!=='host')throw new Error('只有教室大屏可以结束房间');await this._request(`/api/rooms/${this.credentials.roomId}`,{method:'DELETE',host:true});this.leave();}
 leave(notify=true){++this._epoch;clearTimeout(this._timer);this._timer=null;this._abort.abort();this._abort=new AbortController();this._pendingRefresh=null;this._pendingSubmit=null;this._failures=0;this._retryAllowed=true;for(const url of this._photos.values())URL.revokeObjectURL(url);this._photos.clear();this.snapshot=null;this.credentials=null;this.role=null;const hadInfo=this.roomInfo!==null;this.roomInfo=null;if(hadInfo)this.onRoomInfo(null);if(notify)this._status('left','已离开教室房间');}
}
