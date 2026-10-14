import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {STORAGE_POLICY} from "../packages/shared-types/src/storage-policy.js";
import {INVESTIGATION_WRANGLER} from "./storage-reset.mjs";

export function storageUsageSql(){return "SELECT (SELECT COUNT(*) FROM live_games) games,(SELECT COUNT(*) FROM game_archives WHERE status='archived') archived,(SELECT COUNT(*) FROM game_archives WHERE status!='archived') pending,period,class_a,class_b,archive_bytes,d1_bytes,observed_at,healthy FROM storage_budget WHERE singleton=1;";}
export async function inspectStorageUsage({database="DB",apply=false,exclusive=false}={},run=args=>execFileSync("pnpm",["dlx",INVESTIGATION_WRANGLER,...args],{encoding:"utf8",env:{...process.env,CI:"true"},stdio:["ignore","pipe","pipe"]})){
  const query=sql=>JSON.parse(run(["d1","execute",database,"--config","apps/api/wrangler.toml","--remote","--json","--command",sql]));
  const result=query(storageUsageSql()),size=result[0].meta?.size_after;
  if(!Number.isSafeInteger(size)||size<0)throw Error("D1 size observation unavailable");
  if(apply){
    if(!exclusive)throw Error("Usage refresh requires --exclusive-bucket after confirming no other R2 consumers");
    query(`UPDATE storage_budget SET d1_bytes=${size},observed_at=datetime('now'),healthy=1 WHERE singleton=1;`);
  }
  const row=result[0].results[0];
  return {...row,d1_bytes:size,warnings:[...(size>=STORAGE_POLICY.d1Bytes*STORAGE_POLICY.warnFraction?["d1_capacity"]:[]),...(row.archive_bytes>=STORAGE_POLICY.archiveBytes*STORAGE_POLICY.warnFraction?["archive_capacity"]:[]),...(row.class_a>=STORAGE_POLICY.archiveClassA*STORAGE_POLICY.warnFraction?["archive_writes"]:[]),...(row.class_b>=STORAGE_POLICY.archiveClassB*STORAGE_POLICY.warnFraction?["archive_reads"]:[])]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{console.log(JSON.stringify(await inspectStorageUsage({database:process.env.CLOUDFLARE_D1_DB_NAME||"DB",apply:process.argv.includes("--apply"),exclusive:process.argv.includes("--exclusive-bucket")})));}catch(error){console.error(error.message);process.exitCode=1;}}
