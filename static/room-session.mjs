// Start the room connection independently of camera, model and artwork modules.
import {createRoomControls} from './room-controls.mjs?v=20261104-mobile-model';
let hooks={},lastError='';
function showError(message){
 lastError=message;
 const banner=document.getElementById('action-error');
 if(banner&&(message||banner.dataset.source==='room')){banner.dataset.source='room';banner.hidden=!message;banner.textContent=message;}
 hooks.onError?.(message);
}
export const room=createRoomControls({
 onState:()=>hooks.onState?.(),onError:showError,isBusy:()=>hooks.isBusy?.()||false,
});
export function attachRoomApp(next){hooks=next;if(lastError)hooks.onError?.(lastError);}
