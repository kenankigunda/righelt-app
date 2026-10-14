import { STORAGE_POLICY } from "../../shared-types/src/storage-policy";
import type { D1DatabaseLike,D1Statement } from "./shell-live-db";
import { AuthProblem } from "./auth-controls";

export type StorageBudgetEnv={DB:D1DatabaseLike;STORAGE_BUDGET_ENABLED?:string};
export function growthGuard(env:StorageBudgetEnv):{before:D1Statement[];after:D1Statement[]} {
  if(env.STORAGE_BUDGET_ENABLED!=="true")return {before:[],after:[]};
  const id=crypto.randomUUID();
  return {before:[env.DB.prepare("INSERT INTO storage_growth_guards(guard_id,valid) VALUES(?1,COALESCE((SELECT 1 FROM storage_budget WHERE singleton=1 AND healthy=1 AND observed_at>datetime('now','-1 day') AND d1_bytes+COALESCE((SELECT SUM(bytes) FROM storage_restore_reservations),0)<?2),0))").bind(id,STORAGE_POLICY.d1Bytes*STORAGE_POLICY.stopFraction)],after:[env.DB.prepare("DELETE FROM storage_growth_guards WHERE guard_id=?1").bind(id)]};
}
/** Reservations commit before external operations. Unknown results stay charged. */
export async function reserveArchiveOperation(env:StorageBudgetEnv,kind:"a"|"b",key="",bytes=0):Promise<void> {
  const id=crypto.randomUUID(),a=kind==="a"?1:0,b=kind==="b"?1:0;
  const added="CASE WHEN EXISTS(SELECT 1 FROM storage_objects WHERE object_key=?5) THEN 0 ELSE ?6 END";
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO account_transaction_guards(guard_id,valid) VALUES(?1,COALESCE((SELECT 1 FROM storage_budget WHERE singleton=1 AND healthy=1 AND observed_at>datetime('now','-1 day') AND (CASE WHEN period=strftime('%Y-%m','now') THEN class_a ELSE 0 END)+?2<=?3 AND (CASE WHEN period=strftime('%Y-%m','now') THEN class_b ELSE 0 END)+?4<=?7 AND archive_bytes+${added}<=?8),0))`).bind(id,a,STORAGE_POLICY.archiveClassA,b,key,bytes,STORAGE_POLICY.archiveClassB,STORAGE_POLICY.archiveBytes),
      env.DB.prepare(`UPDATE storage_budget SET class_a=(CASE WHEN period=strftime('%Y-%m','now') THEN class_a ELSE 0 END)+?1,class_b=(CASE WHEN period=strftime('%Y-%m','now') THEN class_b ELSE 0 END)+?2,period=strftime('%Y-%m','now'),archive_bytes=archive_bytes+CASE WHEN EXISTS(SELECT 1 FROM storage_objects WHERE object_key=?3) THEN 0 ELSE ?4 END WHERE singleton=1`).bind(a,b,key,bytes),
      ...(kind==="a"?[env.DB.prepare("INSERT OR IGNORE INTO storage_objects(object_key,bytes) VALUES(?1,?2)").bind(key,bytes)]:[]),
      env.DB.prepare("DELETE FROM account_transaction_guards WHERE guard_id=?1").bind(id),
    ]);
  } catch {throw new AuthProblem("storage_capacity",503);}
}

/** Conservative reservation for the whole restore, held across restarts. */
export async function reserveRestore(env:StorageBudgetEnv,gameId:string,bytes:number):Promise<void> {
  if(env.STORAGE_BUDGET_ENABLED!=="true")return;
  const budget=growthGuard(env);
  // Refresh actual size before reducing a resumed reservation. The room cursor
  // counts committed chunks, so only their remaining growth is reserved again.
  const probe=await env.DB.prepare("SELECT 1 AS healthy_probe").all();
  const size=probe.meta?.size_after;
  if(!Number.isSafeInteger(size))throw new AuthProblem("storage_capacity",503);
  try {await env.DB.batch([
    env.DB.prepare("UPDATE storage_budget SET d1_bytes=MAX(d1_bytes,?1) WHERE singleton=1").bind(size),
    env.DB.prepare("INSERT INTO storage_restore_reservations(game_id,bytes) VALUES(?1,?2) ON CONFLICT(game_id) DO UPDATE SET bytes=excluded.bytes").bind(gameId,bytes),
    ...budget.before,...budget.after,
  ]);}catch{throw new AuthProblem("storage_capacity",503);}
}
export async function observeRestore(env:StorageBudgetEnv,gameId:string,results:{meta?:{size_after?:number}}[],complete=false):Promise<void> {
  if(env.STORAGE_BUDGET_ENABLED!=="true")return;
  const size=results.at(-1)?.meta?.size_after;
  if(!Number.isSafeInteger(size))return; // Keep reservation until trustworthy observation.
  await env.DB.batch([
    env.DB.prepare("UPDATE storage_budget SET d1_bytes=?1 WHERE singleton=1").bind(size),
    ...(complete?[env.DB.prepare("DELETE FROM storage_restore_reservations WHERE game_id=?1").bind(gameId)]:[]),
  ]);
}
