const TOKEN=/^[-_A-Za-z0-9]{32}$/;

// The server expiry is authoritative. Legacy rooms retain their original expiry.
export function roomLifetime(expiresAt,now=Date.now()){
 if(!Number.isFinite(expiresAt)||!Number.isFinite(now))return {known:false,expired:false,remainingMs:0,clock:'—'};
 const remainingMs=Math.max(0,expiresAt-now),seconds=Math.ceil(remainingMs/1000);
 const parts=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60];
 return {known:true,expired:remainingMs===0,remainingMs,clock:parts.map(n=>String(n).padStart(2,'0')).join(':')};
}

export function validHostSession(saved,now=Date.now()){
 return !!saved&&['roomId','joinToken','hostToken'].every(key=>typeof saved[key]==='string'&&TOKEN.test(saved[key]))
  &&(!Object.prototype.hasOwnProperty.call(saved,'expiresAt')||(Number.isFinite(saved.expiresAt)&&saved.expiresAt>now));
}

// Opening the gallery is the shared-screen entry. Camera-only and personal
// entries stay local; any invitation fields suppress creating another room.
export function shouldAutoCreateHost(url,{hasInvitation=false,hasSavedHost=false}={}){
 if(hasInvitation||hasSavedHost)return false;
 try{
  const target=new URL(url),question=target.hash.indexOf('?');
  const fragment=new URLSearchParams(question<0?'':target.hash.slice(question+1));
  if(!['http:','https:'].includes(target.protocol))return false;
  if(['room','join'].some(key=>fragment.has(key)||target.searchParams.has(key)))return false;
  const modes=target.searchParams.getAll('mode');
  if(modes.length>1||modes.length===1&&!['host',''].includes(modes[0]))return false;
  if(modes[0]==='host')return true;
  const view=(question<0?target.hash:target.hash.slice(0,question)).replace(/^#/,'');
  return view===''||view==='gallery-panel';
 }catch{return false;}
}
