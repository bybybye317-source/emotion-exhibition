import {validHostSession} from './room-lifetime.mjs?v=20261104-tencent';

const PREFIX='empathy-classroom-host-v2:';
const LEGACY_KEY='empathy-classroom-host-v1';

function apiOrigin(baseUrl){
 let url;
 try{url=new URL(baseUrl);}catch{throw new TypeError('讲台服务地址无效');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new TypeError('讲台服务地址无效');
 return url.origin;
}

// The key contains the public API origin only, never a room or host capability.
export function hostStorageKey(baseUrl){return PREFIX+apiOrigin(baseUrl);}

function selectedFields(value){
 return {roomId:value.roomId,joinToken:value.joinToken,hostToken:value.hostToken,
  ...(Object.prototype.hasOwnProperty.call(value,'expiresAt')?{expiresAt:value.expiresAt}:{})};
}
function remove(storage,key){try{storage.removeItem(key);}catch{}}
function ownsLegacy(baseUrl,legacyOrigin){
 try{return !!legacyOrigin&&apiOrigin(baseUrl)===apiOrigin(legacyOrigin);}catch{return false;}
}
function parseSaved(storage,key,raw,now){
 try{const value=JSON.parse(raw);if(validHostSession(value,now))return selectedFields(value);}catch{}
 remove(storage,key);return null;
}

export function readHostSession(storage,baseUrl,{legacyOrigin,now=Date.now()}={}){
 let key,raw;
 try{key=hostStorageKey(baseUrl);raw=storage.getItem(key);}catch{return null;}
 // Remove both old-origin representations when invalidating its scoped value.
 // Otherwise a second read could resurrect the older global session.
 if(raw!==null){
  const saved=parseSaved(storage,key,raw,now);
  if(!saved&&ownsLegacy(baseUrl,legacyOrigin))remove(storage,LEGACY_KEY);
  return saved;
 }
 try{
  // The caller must opt in with the old relay's literal origin. A replacement
  // relay can never inherit the old global credentials merely by sharing a tab.
  if(!ownsLegacy(baseUrl,legacyOrigin))return null;
  raw=storage.getItem(LEGACY_KEY);if(raw===null)return null;
 }catch{return null;}
 const saved=parseSaved(storage,LEGACY_KEY,raw,now);if(!saved)return null;
 try{storage.setItem(key,JSON.stringify(saved));remove(storage,LEGACY_KEY);}catch{}
 return saved;
}

export function writeHostSession(storage,baseUrl,value,{now=Date.now()}={}){
 if(!validHostSession(value,now))return false;
 try{storage.setItem(hostStorageKey(baseUrl),JSON.stringify(selectedFields(value)));return true;}catch{return false;}
}

export function forgetHostSession(storage,baseUrl,{legacyOrigin}={}){
 try{remove(storage,hostStorageKey(baseUrl));}catch{}
 // A failed migration write can leave valid data under the global key. Leaving
 // the old relay must clear that copy too, while a new relay must never touch it.
 if(ownsLegacy(baseUrl,legacyOrigin))remove(storage,LEGACY_KEY);
}
