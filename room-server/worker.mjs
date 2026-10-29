import {handleRequest} from './core.mjs';
import {D1RoomStore} from './d1-store.mjs';
export const ORIGINS=['https://bybybye317-source.github.io','http://127.0.0.1:8770','http://127.0.0.1:8766','http://127.0.0.1:8765','http://localhost:8766','http://localhost:8765'];
export async function fetchRoomRequest(request,env){
 return handleRequest(request,new D1RoomStore(env.DB),{origins:ORIGINS,ip:request.headers.get('CF-Connecting-IP')||'unknown'});
}
export default {fetch:fetchRoomRequest,async scheduled(_event,env){await new D1RoomStore(env.DB).cleanup(Date.now());}};
