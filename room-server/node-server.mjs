import {createServer as createHttpServer} from 'node:http';
import {isIP} from 'node:net';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleRequest,MAX_BODY_BYTES,ROOM_TTL_MS} from './core.mjs';
import {D1RoomStore} from './d1-store.mjs';
import {openRoomDatabase} from './sqlite-store.mjs';

export const DEFAULT_ALLOWED_ORIGINS=['https://bybybye317-source.github.io'];
const genericError='共享讲台服务暂时不可用，请稍后重试';
class RequestError extends Error {constructor(status,message){super(message);this.status=status;}}
const validIp=value=>typeof value==='string'&&value.length<=45&&!value.includes('%')&&isIP(value)!==0;
const isLoopback=ip=>ip==='::1'||/^127\./.test(ip)||/^::ffff:127\./i.test(ip);

export function resolveClientIp(request,{trustLoopbackProxy=true}={}){
 const peer=request.socket?.remoteAddress;
 // Only a reverse proxy on this machine may assert a single X-Real-IP. A
 // forwarded chain or an arbitrary CF-Connecting-IP is never trusted here.
 const real=request.headers?.['x-real-ip'];
 if(trustLoopbackProxy&&validIp(peer)&&isLoopback(peer)&&validIp(real))return real;
 return validIp(peer)?peer:'unknown';
}

function originsFrom(value){
 const origins=typeof value==='string'?value.split(',').map(x=>x.trim()).filter(Boolean):value;
 if(!Array.isArray(origins)||!origins.length)throw new Error('At least one allowed origin is required');
 return [...new Set(origins.map(origin=>{
  const url=new URL(origin);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid allowed origin');
  return url.origin;
 }))];
}
function numberOption(value,fallback,min,max,name){
 const result=value===undefined?fallback:Number(value);
 if(!Number.isSafeInteger(result)||result<min||result>max)throw new Error(`Invalid ${name}`);
 return result;
}
function responseHeaders(request,origins){
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
 const origin=request.headers.origin;
 if(typeof origin==='string'&&origins.includes(origin))headers['Access-Control-Allow-Origin']=origin;
 return headers;
}
function readBody(request,limit,signal){
 return new Promise((resolveBody,reject)=>{
  let size=0,settled=false;const chunks=[];
  const cleanup=()=>{request.off('data',onData);request.off('end',onEnd);request.off('error',onError);request.off('aborted',onAborted);signal.removeEventListener('abort',onAbort);};
  const fail=error=>{if(settled)return;settled=true;cleanup();reject(error);};
  const onData=chunk=>{size+=chunk.length;if(size>limit){fail(new RequestError(413,'提交内容过大'));return;}chunks.push(chunk);};
  const onEnd=()=>{if(settled)return;settled=true;cleanup();resolveBody(chunks.length?Buffer.concat(chunks,size):undefined);};
  const onError=()=>fail(new RequestError(400,'请求未完整接收'));
  const onAborted=()=>fail(new RequestError(400,'请求已中断'));
  const onAbort=()=>fail(new RequestError(408,'请求接收超时，请重试'));
  if(signal.aborted){onAbort();return;}
  signal.addEventListener('abort',onAbort,{once:true});
  request.on('data',onData);request.on('end',onEnd);request.on('error',onError);request.on('aborted',onAborted);
 });
}

export function createServer({
 databasePath='./data/classroom.sqlite',host='127.0.0.1',port=8787,
 allowedOrigins=DEFAULT_ALLOWED_ORIGINS,requestTimeoutMs=15000,cleanupIntervalMs=60000,
 maxRequestBytes=MAX_BODY_BYTES,trustLoopbackProxy=true,now=Date.now,
 logger=message=>console.error(message),
}={}){
 const origins=originsFrom(allowedOrigins);
 port=numberOption(port,8787,0,65535,'port');
 requestTimeoutMs=numberOption(requestTimeoutMs,15000,50,120000,'request timeout');
 cleanupIntervalMs=numberOption(cleanupIntervalMs,60000,10,86400000,'cleanup interval');
 maxRequestBytes=numberOption(maxRequestBytes,MAX_BODY_BYTES,1,MAX_BODY_BYTES,'request body limit');
 if(typeof host!=='string'||!host.trim()||typeof now!=='function')throw new Error('Invalid server configuration');
 const database=openRoomDatabase(databasePath),store=new D1RoomStore(database);
 let closing=false,closePromise,cleanupTimer;
 const report=()=>logger('[room-relay] An internal operation failed.');
 const server=createHttpServer({maxHeaderSize:16384},async(request,response)=>{
  const controller=new AbortController();
  request.on('error',()=>{}); // A disconnected upload must not crash the process.
  const fail=(status,message)=>{
   if(response.writableEnded||response.destroyed)return;
   if(response.headersSent){response.destroy();return;}
   response.writeHead(status,{...responseHeaders(request,origins),'Connection':'close'});
   // Drain no more application data into buffers. Close after the response has
   // been written, including when the client is still streaming a large body.
   request.resume();response.once('finish',()=>request.destroy());
   response.end(JSON.stringify({error:message}));
  };
  const deadline=setTimeout(()=>{controller.abort();fail(408,'请求接收超时，请重试');},requestTimeoutMs);deadline.unref();
  const clear=()=>clearTimeout(deadline);response.once('finish',clear);response.once('close',clear);
  try{
   if(closing)throw new RequestError(503,genericError);
   const origin=request.headers.origin;
   if(origin&&!origins.includes(origin))throw new RequestError(403,'来源未获允许');
   const declared=request.headers['content-length'];
   if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxRequestBytes))throw new RequestError(413,'提交内容过大');
   if(typeof request.url!=='string'||request.url.length>8192||!request.url.startsWith('/'))throw new RequestError(400,'请求地址无效');
   const url=new URL('http://room.internal'+request.url);
   const body=await readBody(request,maxRequestBytes,controller.signal);
   if(controller.signal.aborted||response.destroyed)return;
   if(body&&['GET','HEAD'].includes(request.method))throw new RequestError(400,'此请求不能包含正文');
   let result;
   if(url.pathname==='/api/health'&&request.method!=='OPTIONS'){
    if(!['GET','HEAD'].includes(request.method))throw new RequestError(405,'不支持此操作');
    try{database.checkReady();}catch{throw new RequestError(503,genericError);}
    result=new Response(JSON.stringify({ok:true,storage:'sqlite',roomTtlSeconds:ROOM_TTL_MS/1000}),{headers:responseHeaders(request,origins)});
   }else{
    const headers=new Headers();
    for(const [name,value] of Object.entries(request.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
    // The application uses paths only; neither Host nor proxy-forwarded URLs
    // influence routing, capabilities or redirects.
    const webRequest=new Request(url,{method:request.method,headers,body});
    result=await handleRequest(webRequest,store,{origins,now:now(),ip:resolveClientIp(request,{trustLoopbackProxy})});
   }
   const bytes=Buffer.from(await result.arrayBuffer());
   if(controller.signal.aborted||response.writableEnded||response.destroyed)return;
   response.writeHead(result.status,Object.fromEntries(result.headers));
   response.end(request.method==='HEAD'?undefined:bytes);
  }catch(error){
   if(!(error instanceof RequestError))report();
   fail(error instanceof RequestError?error.status:503,error instanceof RequestError?error.message:genericError);
  }
 });
 server.requestTimeout=requestTimeoutMs;
 server.headersTimeout=Math.min(10000,requestTimeoutMs);
 server.keepAliveTimeout=5000;
 server.on('clientError',(_error,socket)=>{if(socket.writable)socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');else socket.destroy();});
 server.once('close',()=>{clearInterval(cleanupTimer);database.close();});
 return {
  server,
  async listen(){
   if(closing)throw new Error('Server is closing');
   if(server.listening)return server.address();
   database.checkReady();await store.cleanup(now());
   await new Promise((resolveListen,reject)=>{
    const onError=error=>{server.off('listening',onListening);reject(error);};
    const onListening=()=>{server.off('error',onError);resolveListen();};
    server.once('error',onError);server.once('listening',onListening);server.listen(port,host);
   });
   cleanupTimer=setInterval(()=>{void store.cleanup(now()).catch(report);},cleanupIntervalMs);cleanupTimer.unref();
   return server.address();
  },
  close(){
   if(closePromise)return closePromise;
   closing=true;clearInterval(cleanupTimer);
   closePromise=new Promise(resolveClose=>{
    if(!server.listening){database.close();resolveClose();return;}
    const force=setTimeout(()=>server.closeAllConnections(),5000);force.unref();
    server.close(()=>{clearTimeout(force);database.close();resolveClose();});
    server.closeIdleConnections();
   });
   return closePromise;
  },
 };
}

export function optionsFromEnv(env=process.env){
 return {
  databasePath:env.ROOM_DB_PATH||'./data/classroom.sqlite',host:env.ROOM_HOST||'127.0.0.1',
  port:env.PORT||8787,allowedOrigins:env.ROOM_ALLOWED_ORIGINS||DEFAULT_ALLOWED_ORIGINS,
  requestTimeoutMs:env.ROOM_REQUEST_TIMEOUT_MS||15000,cleanupIntervalMs:env.ROOM_CLEANUP_INTERVAL_MS||60000,
  trustLoopbackProxy:env.ROOM_TRUST_LOOPBACK_PROXY!=='0',
 };
}
function isCliEntry(){
 if(!process.argv[1])return false;
 try{
  // Release deployments invoke /opt/.../current/node-server.mjs through a
  // symlink, while Node normally resolves import.meta.url to the real file.
  return realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url));
 }catch{return false;} // Imports from eval/REPL or a missing argv path stay inert.
}
if(isCliEntry()){
 let relay;
 try{
  relay=createServer(optionsFromEnv());const address=await relay.listen();
  console.log(`[room-relay] Listening on ${address.address}:${address.port}`);
  const shutdown=()=>{void relay.close().catch(()=>{console.error('[room-relay] Shutdown failed.');process.exitCode=1;});};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
 }catch{
  console.error('[room-relay] Startup failed. Check configuration, database permissions and port availability.');
  await relay?.close();process.exitCode=1;
 }
}
