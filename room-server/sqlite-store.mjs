import {DatabaseSync} from 'node:sqlite';
import {chmodSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

const schema=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
const readinessQueries=[
 'SELECT id,join_hash,host_hash,created_at,expires_at,sequence,revision,generation FROM rooms LIMIT 0',
 'SELECT id,room_id,request_id,generation,sequence,created_at,scores,anchors,photo FROM contributions LIMIT 0',
 'SELECT room_id,request_id,record_id,generation FROM receipts LIMIT 0',
 'SELECT key,count,reset_at FROM rate_limits LIMIT 0',
];

// A small D1-compatible adapter lets the HTTP relay use the already-tested SQL
// store. A batch executes synchronously inside one SQLite transaction: there is
// no await between BEGIN and COMMIT, even when callers submit concurrently.
export function openRoomDatabase(filename,{busyTimeoutMs=5000}={}){
 if(typeof filename!=='string'||!filename.trim())throw new Error('ROOM_DB_PATH is required');
 if(!Number.isSafeInteger(busyTimeoutMs)||busyTimeoutMs<1||busyTimeoutMs>30000)throw new Error('Invalid SQLite busy timeout');
 const path=filename===':memory:'?filename:resolve(filename);
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const sqlite=new DatabaseSync(path);
 let closed=false;
 try{
  if(path!==':memory:')chmodSync(path,0o600);
  sqlite.exec(`PRAGMA busy_timeout=${busyTimeoutMs}; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`);
  sqlite.exec(schema);
 }catch(error){sqlite.close();throw error;}
 const owned=new WeakSet();
 function prepare(sql){
  const statement=sqlite.prepare(sql);
  function bound(args){
   const execute=()=>statement.columns().length?{results:statement.all(...args)}:{results:[],meta:statement.run(...args)};
   const wrapper={
    bind(...values){return bound(values);},
    async run(){return execute();},
    async all(){return {results:statement.all(...args)};},
    async first(column){const row=statement.get(...args);return row?(column===undefined?row:row[column]??null):null;},
    _execute:execute,
   };
   owned.add(wrapper);return wrapper;
  }
  return bound([]);
 }
 return {
  prepare,
  async batch(statements){
   if(!Array.isArray(statements)||statements.some(statement=>!owned.has(statement)))throw new TypeError('Invalid database batch');
   sqlite.exec('BEGIN IMMEDIATE');
   try{const results=statements.map(statement=>statement._execute());sqlite.exec('COMMIT');return results;}
   catch(error){sqlite.exec('ROLLBACK');throw error;}
  },
  checkReady(){
   if(closed)throw new Error('Database is closed');
   // Check every required table/column on each probe, rather than only reporting
   // that the process exists. Missing/corrupt schema therefore yields HTTP 503.
   for(const sql of readinessQueries)sqlite.prepare(sql).all();
   if(sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys!==1)throw new Error('Foreign keys are disabled');
   sqlite.prepare('SELECT 1 FROM rooms LIMIT 1').get();
   return true;
  },
  close(){if(!closed){closed=true;sqlite.close();}},
 };
}
