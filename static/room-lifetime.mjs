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

// Explicit desktop entry alone can create a room; an invitation always wins.
export function shouldAutoCreateHost(url,{hasInvitation=false,hasSavedHost=false}={}){
 if(hasInvitation||hasSavedHost)return false;
 try{
  const target=new URL(url),fragment=new URLSearchParams(target.hash.split('?')[1]||'');
  return target.searchParams.get('mode')==='host'&&!fragment.has('room')&&!fragment.has('join');
 }catch{return false;}
}
