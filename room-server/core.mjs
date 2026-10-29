export const EMOTIONS=['happiness','neutral','sadness','surprise','anger','fear','disgust','contempt'];
export const ROOM_TTL_MS=2*60*60*1000;
export const MAX_PHOTO_BYTES=240*1024;
export const MAX_BODY_BYTES=MAX_PHOTO_BYTES*4/3+18000;
export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export const secret=()=>{const a=crypto.getRandomValues(new Uint8Array(24));return btoa(String.fromCharCode(...a)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
export function normalizeScores(scores){
 if(!scores||typeof scores!=='object'||Array.isArray(scores)||EMOTIONS.some(k=>typeof scores[k]!=='number'||!Number.isFinite(scores[k])||scores[k]<0||scores[k]>1))throw new HttpError(400,'表情分数无效');
 const sum=EMOTIONS.reduce((s,k)=>s+scores[k],0);if(sum<=0)throw new HttpError(400,'表情分数不能为空');
 return Object.fromEntries(EMOTIONS.map(k=>[k,scores[k]/sum]));
}
export function validateContribution(body){
 if(body?.consent!==true)throw new HttpError(400,'请先同意将照片与表情分数提交到教室展厅');
 if(typeof body.requestId!=='string'||!/^[-_A-Za-z0-9]{16,80}$/.test(body.requestId))throw new HttpError(400,'提交标识无效');
 if(!Number.isSafeInteger(body.generation)||body.generation<0)throw new HttpError(400,'本轮版本无效，请重新连接');
 const scores=normalizeScores(body.scores);
 const photo=body.photoDataUrl;
 if(typeof photo!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))throw new HttpError(400,'照片必须是 JPEG');
 const b64=photo.slice(23);let raw;try{raw=atob(b64);}catch{throw new HttpError(400,'照片编码无效');}
 if(raw.length<4||raw.length>MAX_PHOTO_BYTES||raw.charCodeAt(0)!==255||raw.charCodeAt(1)!==216||raw.charCodeAt(2)!==255)throw new HttpError(400,'照片无效或超过 240 KB');
 // Only finite normalized landmarks, with hard bounds on key/array lengths.
 const anchors={};const source=body.anchors;
 if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).length>40)throw new HttpError(400,'照片定位点无效');
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=-.25&&v<=1.25);
 for(const [key,value] of Object.entries(source)){
  if(!/^[a-z_]{1,40}$/.test(key))throw new HttpError(400,'照片定位点名称无效');
  if(point(value))anchors[key]=value.slice();
  else if(Array.isArray(value)&&value.length<=24&&value.every(point))anchors[key]=value.map(p=>p.slice());
  else throw new HttpError(400,'照片定位点数据无效');
 }
 for(const key of ['left_eye','right_eye','nose','mouth'])if(!point(anchors[key]))throw new HttpError(400,'缺少五官定位点');
 return {requestId:body.requestId,generation:body.generation,scores,anchors,photo};
}
export function snapshotFromRows(room,rows){
 const participants=rows.map(r=>{const scores=typeof r.scores==='string'?JSON.parse(r.scores):r.scores;return {id:r.id,time:new Date(r.created_at).toISOString(),scores,emotion:EMOTIONS.reduce((a,b)=>scores[a]>=scores[b]?a:b),photo_anchors:typeof r.anchors==='string'?JSON.parse(r.anchors):r.anchors,slot:r.sequence%32,number:r.sequence+1,photo_path:`/api/rooms/${room.id}/photos/${r.id}`};});
 const group_scores=participants.length?Object.fromEntries(EMOTIONS.map(k=>[k,participants.reduce((s,p)=>s+p.scores[k],0)/participants.length])):{};
 return {roomId:room.id,revision:room.revision,generation:room.generation,expiresAt:room.expires_at,session:{participants,participant_count:participants.length,group_scores}};
}
export async function readBody(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'请使用 JSON');
 const declared=Number(request.headers.get('content-length'));if(declared>MAX_BODY_BYTES)throw new HttpError(413,'提交内容过大');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'缺少提交内容');let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();throw new HttpError(413,'提交内容过大');}chunks.push(value);}
 const merged=new Uint8Array(size);let at=0;for(const chunk of chunks){merged.set(chunk,at);at+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(merged));}catch{throw new HttpError(400,'JSON 格式错误');}
}
export async function handleRequest(request,store,{origins=[],now=Date.now(),ip='unknown'}={}){
 const origin=request.headers.get('Origin');
 const allowed=!origin||origins.includes(origin);
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
 if(origin&&allowed)headers['Access-Control-Allow-Origin']=origin;
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
 try{
  if(!allowed)throw new HttpError(403,'来源未获允许');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
  const path=new URL(request.url).pathname;
  if(path==='/api/health')return json({ok:true,storage:'d1',roomTtlSeconds:ROOM_TTL_MS/1000});
  // Delete expired rooms/photos/receipts opportunistically. Access checks also enforce TTL.
  await store.cleanup(now);
  if(path==='/api/rooms'&&request.method==='POST'){
   if(!await store.rate(`create:${await digest(ip)}`,6,60*60*1000,now))throw new HttpError(429,'创建房间过于频繁，请稍后再试');
   const room={id:secret(),join_hash:'',host_hash:'',created_at:now,expires_at:now+ROOM_TTL_MS,sequence:0,revision:0,generation:0};
   const joinToken=secret(),hostToken=secret();room.join_hash=await digest(joinToken);room.host_hash=await digest(hostToken);
   await store.create(room);return json({roomId:room.id,joinToken,hostToken,expiresAt:room.expires_at,snapshot:snapshotFromRows(room,[])},201);
  }
  const match=path.match(/^\/api\/rooms\/([-_A-Za-z0-9]{32})(?:\/(contributions|reset|photos)(?:\/([-_A-Za-z0-9]{32}))?)?$/);
  if(!match)throw new HttpError(404,'地址不存在');
  const [,id,action,photoId]=match;const token=request.headers.get('Authorization')?.match(/^Bearer ([-_A-Za-z0-9]{32})$/)?.[1];
  if(!token)throw new HttpError(401,'需要房间凭证');
  const room=await store.get(id);if(!room||room.expires_at<=now)throw new HttpError(404,'房间已结束或过期');
  const hash=await digest(token),host=hash===room.host_hash;if(!host&&hash!==room.join_hash)throw new HttpError(403,'房间凭证无效');
  if(!action&&request.method==='GET'){
   const since=new URL(request.url).searchParams.get('since');if(since!==null&&Number(since)===room.revision)return json({unchanged:true,revision:room.revision,generation:room.generation,expiresAt:room.expires_at});
   return json(await store.snapshot(id));
  }
  if(!action&&request.method==='DELETE'){if(!host)throw new HttpError(403,'仅教室大屏可结束房间');await store.close(id);return json({closed:true});}
  if(action==='reset'&&request.method==='POST'){if(!host)throw new HttpError(403,'仅教室大屏可清空本轮');await store.reset(id,now);return json(await store.snapshot(id));}
  if(action==='photos'&&photoId&&request.method==='GET'){
   const photo=await store.photo(id,photoId);if(!photo)throw new HttpError(404,'这份照片已移除');
   const bytes=Uint8Array.from(atob(photo.slice(23)),c=>c.charCodeAt(0));return new Response(bytes,{headers:{...headers,'Content-Type':'image/jpeg'}});
  }
  if(action==='contributions'&&request.method==='POST'){
   // A classroom may share one NAT address; allow a full class to join together.
   if(!await store.rate(`submit:${id}:${await digest(ip)}`,90,60*1000,now))throw new HttpError(429,'提交过于频繁，请稍后再试');
   const value=validateContribution(await readBody(request));
   if(value.generation!==room.generation)throw new HttpError(409,'本轮已清空，请重新确认后提交');
   if(room.sequence>=1000)throw new HttpError(409,'本轮参与次数已达上限，请创建新房间');
   const receipt=await store.add(id,value,now);
   if(!receipt)throw new HttpError(409,'本轮已变化，请刷新后重试');
   return json({recordId:receipt.record_id,snapshot:await store.snapshot(id)},201);
  }
  throw new HttpError(405,'不支持此操作');
 }catch(e){return json({error:e instanceof HttpError?e.message:'房间服务暂时不可用，请稍后重试'},e instanceof HttpError?e.status:500);}
}
