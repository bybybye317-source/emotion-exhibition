import {secret,snapshotFromRows} from './core.mjs';
export class D1RoomStore {
 constructor(db){this.db=db;}
 q(sql,...args){return this.db.prepare(sql).bind(...args);}
 async cleanup(now){const due=await this.q('SELECT EXISTS(SELECT 1 FROM rooms WHERE expires_at<=?) OR EXISTS(SELECT 1 FROM rate_limits WHERE reset_at<=?) AS due',now,now).first();if(!due?.due)return;await this.db.batch([
  this.q('DELETE FROM contributions WHERE room_id IN (SELECT id FROM rooms WHERE expires_at <= ?)',now),
  this.q('DELETE FROM receipts WHERE room_id IN (SELECT id FROM rooms WHERE expires_at <= ?)',now),
  this.q('DELETE FROM rooms WHERE expires_at <= ?',now),
  this.q('DELETE FROM rate_limits WHERE reset_at <= ?',now),
 ]);}
 async rate(key,limit,window,now){const r=await this.db.batch([
  this.q('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',key,now+window),
  this.q('SELECT count FROM rate_limits WHERE key=?',key)
 ]);return (r[1].results[0]?.count??limit+1)<=limit;}
 async create(room){await this.q('INSERT INTO rooms(id,join_hash,host_hash,created_at,expires_at) VALUES(?,?,?,?,?)',room.id,room.join_hash,room.host_hash,room.created_at,room.expires_at).run();}
 async get(id){return this.q('SELECT * FROM rooms WHERE id=?',id).first();}
 async snapshot(id){const r=await this.db.batch([this.q('SELECT * FROM rooms WHERE id=?',id),this.q('SELECT id,request_id,generation,sequence,created_at,scores,anchors FROM contributions WHERE room_id=? ORDER BY sequence',id)]);const room=r[0].results[0];return room?snapshotFromRows(room,r[1].results):null;}
 async add(id,v,now){
  // D1 batch is transactional: insert using current sequence, update the counter only
  // for that inserted sequence, retain a receipt, and evict old photos atomically.
  const recordId=secret();
  await this.db.batch([
   this.q(`INSERT INTO contributions(id,room_id,request_id,generation,sequence,created_at,scores,anchors,photo)
    SELECT ?,id,?,generation,sequence,?,?,?,? FROM rooms
    WHERE id=? AND generation=? AND expires_at>? AND sequence<1000
    AND NOT EXISTS(SELECT 1 FROM receipts WHERE room_id=? AND request_id=?)`,recordId,v.requestId,now,JSON.stringify(v.scores),JSON.stringify(v.anchors),v.photo,id,v.generation,now,id,v.requestId),
   this.q(`UPDATE rooms SET sequence=sequence+1,revision=revision+1 WHERE id=?
    AND EXISTS(SELECT 1 FROM contributions c WHERE c.room_id=rooms.id AND c.id=? AND c.sequence=rooms.sequence)`,id,recordId),
   this.q(`INSERT OR IGNORE INTO receipts(room_id,request_id,record_id,generation)
    SELECT room_id,request_id,id,generation FROM contributions WHERE id=?`,recordId),
   this.q(`DELETE FROM contributions WHERE room_id=? AND sequence < (SELECT sequence-32 FROM rooms WHERE id=?)`,id,id)
  ]);
  return this.q('SELECT * FROM receipts WHERE room_id=? AND request_id=? AND generation=?',id,v.requestId,v.generation).first();
 }
 async photo(id,recordId){return (await this.q('SELECT photo FROM contributions WHERE room_id=? AND id=?',id,recordId).first())?.photo??null;}
 async reset(id,now){await this.db.batch([
  this.q('DELETE FROM contributions WHERE room_id=?',id),this.q('DELETE FROM receipts WHERE room_id=?',id),
  this.q('UPDATE rooms SET sequence=0,revision=revision+1,generation=generation+1 WHERE id=? AND expires_at>?',id,now)
 ]);}
 async close(id){await this.db.batch([this.q('DELETE FROM contributions WHERE room_id=?',id),this.q('DELETE FROM receipts WHERE room_id=?',id),this.q('DELETE FROM rooms WHERE id=?',id)]);}
}
