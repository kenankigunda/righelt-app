// Written into a disposable Wrangler entrypoint only by the local E2E stack.
// Neither this entrypoint nor its controls are included in the production Worker.
export function storageFixtureSource(entry) {
  return `import app,{GameRoomDO} from ${JSON.stringify(entry)};
export {GameRoomDO};
export default {async fetch(request,env){
 if(new URL(request.url).pathname!=="/__storage_fixture")return app.fetch(request,env);
 if(request.method!=="POST"||request.headers.get("x-fixture-secret")!==env.STORAGE_FIXTURE_SECRET)return new Response(null,{status:404});
 const {action,gameId}=await request.json();
 if(typeof gameId!=="string"||!/^game-[a-zA-Z0-9-]+$/.test(gameId))return new Response(null,{status:400});
 if(action==="age")await env.DB.prepare("UPDATE live_games SET retention_activity_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-8 days') WHERE game_id=?1").bind(gameId).run();
 else if(action==="tick"){
  const id=env.GAME_ROOMS.idFromName(env.STORAGE_GENERATION+":"+gameId);
  return env.GAME_ROOMS.get(id).fetch(new Request("https://game-room/_storage/tick",{method:"POST",headers:{"x-game-id":gameId,"X-Righelt-Storage-Generation":env.STORAGE_GENERATION}}));
 }else if(action!=="status")return new Response(null,{status:400});
 return Response.json({archive:await env.DB.prepare("SELECT status FROM game_archives WHERE game_id=?1").bind(gameId).first(),payload:!!await env.DB.prepare("SELECT 1 FROM game_payloads WHERE game_id=?1").bind(gameId).first(),receipts:(await env.DB.prepare("SELECT COUNT(*) n FROM live_command_receipts WHERE game_id=?1").bind(gameId).first()).n});
}};`;
}
