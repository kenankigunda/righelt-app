export const fixture = `import { GameRoomDO as ActualGameRoom } from './packages/api-handler/src/game-room-do.ts';
export class GameRoomDO extends ActualGameRoom {
 constructor(state, env) {
  let lose = false; let failAt = null;
  super(state, { ...env, DB: { prepare: (...args) => env.DB.prepare(...args), batch: async (...args) => {
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
  this.lose = () => { lose = true; }; this.fail = (index) => { failAt = index; };
 }
 fetch(request) { if (request.headers.get('x-harness-lose-response')) this.lose(); if (request.headers.has('x-harness-fail-at')) this.fail(Number(request.headers.get('x-harness-fail-at'))); return super.fetch(request); }
}
export default { async fetch(request, env) {
 const gameId = request.headers.get('x-game-id');
 return env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(gameId)).fetch(request);
}};`;
