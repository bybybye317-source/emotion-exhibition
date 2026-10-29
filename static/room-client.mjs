// Classroom transport. Photo upload happens only after explicit consent in submit().
// Credentials are held in memory; UI owns optional sessionStorage and fragment links.
export const DEFAULT_ROOM_API='https://empathy-gallery-classroom.bybybye317.chatgpt.site';
export class RoomError extends Error {constructor(message,status){super(message);this.status=status;}}
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
 constructor({baseUrl=DEFAULT_ROOM_API,onSnapshot=()=>{},onStatus=()=>{},pollIntervalMs=1500,fetchImpl=globalThis.fetch.bind(globalThis)}={}){
  const url=new URL(baseUrl);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('房间服务需要 HTTPS');
  this.baseUrl=url.origin;this.onSnapshot=onSnapshot;this.onStatus=onStatus;this.pollIntervalMs=Math.max(1000,pollIntervalMs);this.fetchImpl=fetchImpl;
  this.snapshot=null;this.role=null;this.credentials=null;this._epoch=0;this._timer=null;this._photos=new Map();this._pendingRefresh=null;this._pendingSubmit=null;this._applyTail=Promise.resolve();this._abort=new AbortController();
 }
 _status(status,detail){this.onStatus({status,detail});}
 async _request(path,{method='GET',body,host=false}={}){
  const headers={};const token=host?this.credentials?.hostToken:this.credentials?.joinToken;
  if(token)headers.Authorization=`Bearer ${token}`;
  if(body!==undefined)headers['Content-Type']='application/json';
  const response=await this.fetchImpl(this.baseUrl+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.any([this._abort.signal,AbortSignal.timeout(20000)])});
  if(!response.ok){let payload;try{payload=await response.json();}catch{}throw new RoomError(payload?.error||`房间连接失败 (${response.status})`,response.status);}
  return response;
 }
 async createRoom(){
  this.leave(false);const epoch=this._epoch;this._status('connecting','正在创建教室房间…');
  try{
   const value=await (await this._request('/api/rooms',{method:'POST'})).json();
   if(epoch!==this._epoch)throw new Error('房间操作已取消');
   this.credentials={roomId:value.roomId,joinToken:value.joinToken,hostToken:value.hostToken};this.role='host';
   await this._apply(value.snapshot,epoch);this._status('connected','教室房间已连接');this._schedule();return {...this.credentials,expiresAt:value.expiresAt,snapshot:this.snapshot};
  }catch(error){
   if(epoch===this._epoch){this.leave(false);this.onSnapshot(null);this._status('offline',error.message);}
   throw error;
  }
 }
 async join({roomId,joinToken,hostToken}){
  if(![roomId,joinToken].every(v=>typeof v==='string'&&/^[-_A-Za-z0-9]{32}$/.test(v))||(hostToken&&!/^[-_A-Za-z0-9]{32}$/.test(hostToken)))throw new Error('房间链接无效');
  this.leave(false);this.credentials={roomId,joinToken,...(hostToken?{hostToken}:{})};this.role=hostToken?'host':'participant';
  this._status('connecting','正在连接教室展厅…');
  try{await this.refresh();this._schedule();return this.snapshot;}catch(error){this.leave(false);this.onSnapshot(null);this._status('offline',error.message);throw error;}
 }
 async _apply(value,epoch){
  const run=this._applyTail.catch(()=>{}).then(()=>this._hydrate(value,epoch));this._applyTail=run;return run;
 }
 async _hydrate(value,epoch){
  if(epoch!==this._epoch||!value||value.unchanged)return;
  if(this.snapshot&&value.revision<=this.snapshot.revision)return;
  const next=new Map(),added=[];
  try{
   const rows=value.session.participants;let cursor=0;
   const loader=async()=>{while(cursor<rows.length){const row=rows[cursor++];let photo=this._photos.get(row.id);
    if(!photo){let response;try{response=await this._request(row.photo_path);}catch(error){if(error.status===404)throw new RoomError('照片已更新，正在重新同步',409);throw error;}const blob=await response.blob();if(epoch!==this._epoch)throw new Error('房间操作已取消');photo=URL.createObjectURL(blob);added.push(photo);}
    next.set(row.id,photo);
   }};
   const outcomes=await Promise.allSettled(Array.from({length:Math.min(4,rows.length)},loader));
   const failure=outcomes.find(r=>r.status==='rejected');if(failure)throw failure.reason;
   if(epoch!==this._epoch||this.snapshot&&value.revision<this.snapshot.revision){added.forEach(u=>URL.revokeObjectURL(u));return;}
   const previous=this._photos;this._photos=next;
   this.snapshot={...value,session:{...value.session,participants:rows.map(r=>({...r,image_url:next.get(r.id)}))}};
   this.onSnapshot(this.snapshot);
   for(const [id,url] of previous)if(next.get(id)!==url)URL.revokeObjectURL(url);
  }catch(error){added.forEach(u=>URL.revokeObjectURL(u));throw error;}
 }
 async refresh(){
  if(!this.credentials)return null;
  // Enforce expiry on this device even when the service is temporarily unreachable.
  if(Number.isFinite(this.snapshot?.expiresAt)&&this.snapshot.expiresAt<=Date.now()){
   this.leave(false);this.onSnapshot(null);this._status('expired','房间已过期，房间照片已从本机移除');throw new RoomError('房间已过期',404);
  }
  if(this._pendingRefresh)return this._pendingRefresh;
  const epoch=this._epoch,room=this.credentials.roomId;
  const run=(async()=>{
   try{
    const since=this.snapshot?`?since=${this.snapshot.revision}`:'';const value=await(await this._request(`/api/rooms/${room}${since}`)).json();
    await this._apply(value,epoch);if(epoch===this._epoch)this._status('connected','教室展厅已同步');return this.snapshot;
   }catch(error){if(epoch===this._epoch){if([401,403,404].includes(error.status)){this.leave(false);this.onSnapshot(null);this._status('expired','房间已结束、过期或链接无效，房间照片已从本机移除');}else this._status('offline','连接中断，保留当前画面并自动重试');}throw error;}
  })();this._pendingRefresh=run;try{return await run;}finally{if(this._pendingRefresh===run)this._pendingRefresh=null;}
 }
 _schedule(){clearTimeout(this._timer);if(!this.credentials)return;this._timer=setTimeout(async()=>{try{await this.refresh();}catch(e){if([401,403,404].includes(e.status))return;}this._schedule();},this.pollIntervalMs);}
 async submit({blob,scores,anchors,consent,requestId}={}){
  if(consent!==true)throw new Error('请先同意将照片与表情分数提交到教室展厅');
  if(!this.credentials||!this.snapshot)throw new Error('请先连接教室房间');
  const epoch=this._epoch,generation=this.snapshot.generation;
  // Retrying the same Blob after a network timeout reuses an idempotency key.
  const prior=this._pendingSubmit;
  const id=requestId||(prior?.blob===blob&&prior.generation===generation?prior.id:crypto.randomUUID());
  this._pendingSubmit={blob,generation,id};const photoDataUrl=await photoForRoom(blob);
  if(epoch!==this._epoch)throw new Error('房间操作已取消');
  const value=await(await this._request(`/api/rooms/${this.credentials.roomId}/contributions`,{method:'POST',body:{requestId:id,generation,scores,anchors,photoDataUrl,consent:true}})).json();
  await this._apply(value.snapshot,epoch);return {recordId:value.recordId,snapshot:this.snapshot};
 }
 async reset(){if(this.role!=='host')throw new Error('只有教室大屏可以清空本轮');const epoch=this._epoch;const value=await(await this._request(`/api/rooms/${this.credentials.roomId}/reset`,{method:'POST',host:true})).json();this._pendingSubmit=null;await this._apply(value,epoch);return this.snapshot;}
 async close(){if(this.role!=='host')throw new Error('只有教室大屏可以结束房间');await this._request(`/api/rooms/${this.credentials.roomId}`,{method:'DELETE',host:true});this.leave();}
 leave(notify=true){++this._epoch;clearTimeout(this._timer);this._timer=null;this._abort.abort();this._abort=new AbortController();this._pendingRefresh=null;this._pendingSubmit=null;for(const url of this._photos.values())URL.revokeObjectURL(url);this._photos.clear();this.snapshot=null;this.credentials=null;this.role=null;if(notify)this._status('left','已离开教室房间');}
}
