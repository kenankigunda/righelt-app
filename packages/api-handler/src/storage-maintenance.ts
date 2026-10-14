import { STORAGE_POLICY,STORAGE_GENERATION_HEADER } from "../../shared-types/src/storage-policy";
import type { ArchiveEnv } from "./storage-archive";
import { storageRoomName } from "./storage-generation";

type MaintenanceEnv=ArchiveEnv & {GAME_ROOMS:{idFromName:(name:string)=>unknown;get:(id:unknown)=>{fetch:(request:Request)=>Promise<Response>}}};
export async function runStorageMaintenance(env:MaintenanceEnv):Promise<void> {
  if(!env.ARCHIVES)return;
  // This account currently has no R2 consumers. Activation must attest exclusive
  // use of the private bucket; all operations then pass through our reservations.
  if(env.STORAGE_EXCLUSIVE_R2==="true") {
    const probe=await env.DB.prepare("SELECT 1 AS healthy_probe").all();
    if(Number.isSafeInteger(probe.meta?.size_after))await env.DB.prepare("UPDATE storage_budget SET d1_bytes=?1,observed_at=datetime('now'),healthy=1 WHERE singleton=1").bind(probe.meta!.size_after).run();
    else await env.DB.prepare("UPDATE storage_budget SET healthy=0 WHERE singleton=1").run();
  }
  const rows=await env.DB.prepare("SELECT g.game_id FROM live_games g LEFT JOIN game_archives a USING(game_id) WHERE (a.status='restoring' OR (?3=1 AND (a.status='archiving' OR (g.retention_activity_at<strftime('%Y-%m-%dT%H:%M:%fZ','now',?1) AND (a.game_id IS NULL OR EXISTS(SELECT 1 FROM live_command_receipts r WHERE r.game_id=g.game_id) OR EXISTS(SELECT 1 FROM live_legacy_command_tombstones t WHERE t.game_id=g.game_id) OR EXISTS(SELECT 1 FROM live_events e WHERE e.game_id=g.game_id)))))) ORDER BY CASE WHEN a.status='restoring' THEN 0 WHEN a.status='archiving' THEN 1 ELSE 2 END,g.retention_activity_at,g.game_id LIMIT ?2").bind(`-${STORAGE_POLICY.coldDays} days`,STORAGE_POLICY.sweepGames,env.STORAGE_ARCHIVES_ENABLED==="true"?1:0).all<{game_id:string}>();
  // Sequential requests keep scheduler concurrency and free subrequests bounded.
  for(const row of rows.results??[]){
    try {
      const response=await env.GAME_ROOMS.get(env.GAME_ROOMS.idFromName(storageRoomName(env,row.game_id))).fetch(new Request("https://game-room/_storage/tick",{method:"POST",headers:{"x-game-id":row.game_id,...(env.STORAGE_GENERATION?{[STORAGE_GENERATION_HEADER]:env.STORAGE_GENERATION}:{})}}));
      if(!response.ok)console.warn(JSON.stringify({event:"storage_sweep_deferred",status:response.status}));
      await response.body?.cancel();
    } catch{console.warn(JSON.stringify({event:"storage_sweep_deferred",status:503}));}
  }
  const now="CAST(unixepoch('subsec')*1000 AS INTEGER)";
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM account_sessions WHERE token_hash IN (SELECT token_hash FROM account_sessions WHERE expires_at<=${now} LIMIT ?1)`).bind(STORAGE_POLICY.cleanupRows),
    env.DB.prepare(`DELETE FROM account_rate_limits WHERE bucket_key IN (SELECT bucket_key FROM account_rate_limits WHERE expires_at<=${now} LIMIT ?1)`).bind(STORAGE_POLICY.cleanupRows),
    env.DB.prepare(`DELETE FROM account_revocation_outbox WHERE notification_id IN (SELECT notification_id FROM account_revocation_outbox WHERE delivered_at<=${now}-?1 OR (delivered_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_sessions s WHERE s.token_hash=account_revocation_outbox.session_hash AND s.expires_at>${now})) LIMIT ?2)`).bind(STORAGE_POLICY.coldDays*86400000,STORAGE_POLICY.cleanupRows),
  ]);
  // Old object references are released only after a checksummed live payload exists.
  const restored=await env.DB.prepare("SELECT DISTINCT c.game_id FROM storage_archive_chunks c JOIN live_games g USING(game_id) WHERE NOT EXISTS(SELECT 1 FROM game_archives a WHERE a.game_id=c.game_id) LIMIT ?1").bind(STORAGE_POLICY.maintenanceObjects).all<{game_id:string}>();
  const {loadGameProjection}=await import("./shell-live-db");
  for(const row of restored.results??[])if((await loadGameProjection(env,row.game_id))?.kind==="ok")await env.DB.batch([env.DB.prepare("DELETE FROM storage_archive_chunks WHERE game_id=?1").bind(row.game_id),env.DB.prepare("DELETE FROM storage_restore_reservations WHERE game_id=?1").bind(row.game_id)]);
  if(env.ARCHIVES){
    const garbage=await env.DB.prepare("SELECT object_key,bytes FROM storage_objects o WHERE created_at<datetime('now','-1 day') AND NOT EXISTS(SELECT 1 FROM storage_archive_chunks c WHERE c.object_key=o.object_key) AND NOT EXISTS(SELECT 1 FROM game_archives a WHERE o.object_key LIKE substr(a.manifest_key,1,length(a.manifest_key)-11)||'%') LIMIT ?1").bind(STORAGE_POLICY.maintenanceObjects).all<{object_key:string;bytes:number}>();
    for(const object of garbage.results??[]){await env.ARCHIVES.delete(object.object_key);await env.DB.batch([env.DB.prepare("UPDATE storage_budget SET archive_bytes=MAX(0,archive_bytes-COALESCE((SELECT bytes FROM storage_objects WHERE object_key=?1),0)) WHERE singleton=1").bind(object.object_key),env.DB.prepare("DELETE FROM storage_objects WHERE object_key=?1").bind(object.object_key)]);}
  }
}
