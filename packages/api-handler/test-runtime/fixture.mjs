export const fixture = `import {runStorageMaintenance} from './packages/api-handler/src/storage-maintenance.ts';
import { GameRoomDO as ActualGameRoom } from './packages/api-handler/src/game-room-do.ts';
export class GameRoomDO extends ActualGameRoom {
 constructor(state, env) {
  let lose = false; let failAt = null; let lastBatchSize = 0; let r2Fault = null; let failOn = null; let loseOn = null; const queryText = new WeakMap();
  super(state, { ...env, ...(env.ARCHIVES ? { ARCHIVES: {
   async put(...args) { if(r2Fault==='put'){r2Fault=null;throw Error('harness_r2_upload');} const result=await env.ARCHIVES.put(...args);if(r2Fault==='put_lost'){r2Fault=null;throw Error('harness_r2_response_lost');}return result; },
   async get(...args) { if(r2Fault==='missing'){r2Fault=null;return null;}const result=await env.ARCHIVES.get(...args);if(r2Fault==='corrupt' && result){r2Fault=null;const bytes=new Uint8Array(await result.arrayBuffer());bytes[0]^=1;return {body:new Blob([bytes]).stream()};}return result; },
   delete(...args){return env.ARCHIVES.delete(...args);}
  } } : {}), DB: { prepare: (...args) => {const statement=env.DB.prepare(...args);queryText.set(statement,args[0]);const bind=statement.bind.bind(statement);statement.bind=(...values)=>{const bound=bind(...values);queryText.set(bound,args[0]);return bound;};return statement;}, batch: async (...args) => {
   lastBatchSize = args[0].length;
   if(failOn && args[0].some(statement=>String(queryText.get(statement)).includes(failOn))) {failAt=0;failOn=null;}
   if(loseOn && args[0].some(statement=>String(queryText.get(statement)).includes(loseOn))) {lose=true;loseOn=null;}
   if (failAt !== null) {
    const statements = [...args[0]];
    const index = failAt; failAt = null;
    if (index >= statements.length) throw new Error('harness_stage_out_of_range');
    statements[index] = env.DB.prepare("SELECT * FROM harness_missing_table");
    return env.DB.batch(statements);
   }
   const result = await env.DB.batch(...args);
   if (lose) { lose = false; throw new Error('harness_lost_commit_response'); }
   return result;
  } } });
  this.objectFault = value => {r2Fault=value;}; this.failMatching = value => {failOn=value;}; this.loseMatching = value => {loseOn=value;}; this.batchSize = () => lastBatchSize; this.lose = () => { lose = true; }; this.fail = (index) => { failAt = index; };
 }
 async fetch(request) { if(request.headers.get("x-harness-r2-fault"))this.objectFault(request.headers.get("x-harness-r2-fault")); if(request.headers.get("x-harness-fail-on"))this.failMatching(request.headers.get("x-harness-fail-on")); if(request.headers.get("x-harness-lose-on"))this.loseMatching(request.headers.get("x-harness-lose-on")); if (request.headers.get('x-harness-lose-response')) this.lose(); if (request.headers.has('x-harness-fail-at')) this.fail(Number(request.headers.get('x-harness-fail-at'))); let response; try { response = await super.fetch(request); } catch(error) { response = Response.json({error:String(error)}, {status:500}); } if(response.status!==101)response.headers.set("x-harness-batch-size",String(this.batchSize())); return response; }
}
export default { async fetch(request, env) {
 if(new URL(request.url).pathname==='/_maintenance'){await runStorageMaintenance({...env,STORAGE_ARCHIVES_ENABLED:request.headers.get('x-harness-archive-flag')??env.STORAGE_ARCHIVES_ENABLED});return Response.json({ok:true});}
 const gameId = request.headers.get('x-game-id');
 return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(gameId)).fetch(request);
}};`;
