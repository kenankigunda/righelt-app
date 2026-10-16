import { commandFingerprint } from "../apps/web/generated/packages/shared-types/src/sync-protocol.js";
import { STORAGE_GENERATION_HEADER,STORAGE_GENERATION_QUERY } from "../packages/shared-types/src/storage-policy.js";
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

export const INVESTIGATION_WRANGLER="wrangler@4.149.0";
const root=path.resolve(import.meta.dirname,"..");
export function parseResetArgs(argv){
  const [action,...args]=argv;
  if(!["report","prepare","fence","bind","verify","reopen","retire"].includes(action))throw Error("Choose report, prepare, fence, bind, verify, reopen or retire");
  const read=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  const oldName=read("--old"),newName=read("--new"),receipt=read("--receipt"),origin=read("--origin");
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(oldName??"")||!/^[A-Za-z0-9_-]{1,64}$/.test(newName??"")||oldName===newName)throw Error("Provide distinct explicit --old and --new database names");
  if(!receipt)throw Error("Provide a private --receipt path");
  if(origin){const url=new URL(origin);if(url.protocol!=="https:"||url.pathname!=="/"||url.search||url.hash)throw Error("Origin must be one HTTPS origin");}
  if(action!=="report"&&action!=="verify"&&!args.includes("--apply"))throw Error("Mutating reset actions require --apply");
  return {action,oldName,newName,receipt:path.resolve(receipt),origin,apply:args.includes("--apply")};
}
export function bindingConfig(source,name,id,generation){
  if(!/^[a-f0-9-]{36}$/.test(id))throw Error("Invalid new database ID");
  const binding=source.replace(/database_name = "[^"]+"/,`database_name = "${name}"`).replace(/database_id = "[^"]+"/,`database_id = "${id}"`);
  if(!generation)return binding;
  if(!/^[A-Za-z0-9_-]{1,96}$/.test(generation)||!binding.includes("[vars]"))throw Error("Missing or invalid storage generation configuration");
  return /^STORAGE_GENERATION\s*=/m.test(binding)?binding.replace(/^STORAGE_GENERATION\s*=\s*"[^"]*"/m,`STORAGE_GENERATION = "${generation}"`):binding.replace("[vars]",`[vars]\nSTORAGE_GENERATION = "${generation}"`);
}
export async function recoverySocketSnapshot({origin,gameId,identityId,generation,socketFactory=url=>new WebSocket(url),timeoutMs=15000}){
  const url=new URL(`/api/shell/games/${gameId}/ws`,origin);url.protocol="wss:";
  for(const [key,value] of Object.entries({identityId,sessionId:crypto.randomUUID(),lastEventSeq:"0",[STORAGE_GENERATION_QUERY]:generation}))url.searchParams.set(key,value);
  const socket=socketFactory(url.href);
  try{return await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("Recovery socket timed out")),timeoutMs);
    const fail=()=>{clearTimeout(timer);reject(Error("Recovery socket failed"));};
    socket.addEventListener("error",fail,{once:true});socket.addEventListener("close",fail,{once:true});
    socket.addEventListener("message",event=>{try{
      const frame=JSON.parse(event.data);
      if(frame.storageGeneration!==generation||frame.gameId!==gameId)throw Error("Recovery socket generation mismatch");
      if(frame.game){clearTimeout(timer);resolve(frame);}
    }catch(error){clearTimeout(timer);reject(error);}});
  });}finally{socket.close();}
}
export async function runStorageReset(options,{run,fetcher=fetch,socketFactory,read=readFileSync,write=writeFileSync}={}){
  run??=(args)=>execFileSync("pnpm",["dlx",INVESTIGATION_WRANGLER,...args],{cwd:root,encoding:"utf8",env:{...process.env,CI:"true"},stdio:["ignore","pipe","pipe"]});
  const config=path.join(root,"apps/api/wrangler.toml");
  let receipt;
  const execute=(name,sql,configPath=(receipt ? path.join(path.dirname(options.receipt),name===options.oldName?"old-database.wrangler.toml":"new-database.wrangler.toml") : config))=>JSON.parse(run(["d1","execute",name,"--config",configPath,"--remote","--json","--command",sql]));
  const save=receipt=>{mkdirSync(path.dirname(options.receipt),{recursive:true});write(options.receipt,JSON.stringify(receipt,null,2)+"\n",{mode:0o600});};
  const oldPolicy=()=>execute(options.oldName,"SELECT activated_at,maintenance,canary_account_id IS NOT NULL AS has_canary FROM account_cutover;")[0].results[0];
  if(options.action==="report")return {databases:JSON.parse(run(["d1","list","--json"])),policy:oldPolicy(),counts:execute(options.oldName,"SELECT COUNT(*) AS games,SUM(LENGTH(state_json)) AS projection_bytes FROM live_games;")[0].results};
  if(options.action==="prepare"){
    let existing;try{existing=JSON.parse(read(options.receipt,"utf8"));}catch{}
    if(existing && (existing.oldName!==options.oldName || existing.newName!==options.newName))throw Error("Receipt belongs to a different reset");
    if(existing?.prepared)return existing;
    const listed=JSON.parse(run(["d1","list","--json"]));
    if(existing)receipt=existing;
    else {
      const old=listed.find(row=>row.name===options.oldName);
      if(!old)throw Error("Old database does not exist");
      if(listed.some(row=>row.name===options.newName))throw Error("New database already exists without this task's receipt");
      const output=run(["d1","create",options.newName,"--config",config,"--update-config=false"]);
      const id=/database_id"?\s*[:=]\s*"([a-f0-9-]{36})"/.exec(output)?.[1];
      if(!id)throw Error("Creation outcome uncertain. Inspect D1 list before retrying");
      receipt={version:1,oldName:options.oldName,oldId:old.uuid,newName:options.newName,newId:id,generation:`reset-${crypto.randomUUID()}`,createdAt:new Date().toISOString(),fenced:false,verified:false};
    }
    save(receipt); // Preserve identity before any subsequent remote operation.
    const temp=path.join(path.dirname(options.receipt),"new-database.wrangler.toml");
    const source=bindingConfig(read(config,"utf8"),options.newName,receipt.newId).replace(/main = "[^"]+"/,`main = "${path.join(root,"apps/api/index.js")}"`).replace(/migrations_dir = "[^"]+"/,`migrations_dir = "${path.join(root,"db/migrations")}"`);
    write(temp,source,{mode:0o600});
    write(path.join(path.dirname(options.receipt),"old-database.wrangler.toml"),bindingConfig(source,options.oldName,receipt.oldId),{mode:0o600});
    run(["d1","migrations","apply",options.newName,"--config",temp,"--remote"]);
    execute(options.newName,"UPDATE account_cutover SET maintenance=1 WHERE singleton=1;",temp);
    receipt.prepared=true;save(receipt);return receipt;
  }
  receipt=JSON.parse(read(options.receipt,"utf8"));
  if(receipt.oldName!==options.oldName||receipt.newName!==options.newName||!receipt.prepared)throw Error("Receipt does not identify a prepared reset");
  if(options.action==="fence"){
    const policy=oldPolicy();
    if(policy.activated_at!==null)throw Error("Activated account cutover requires a separate reviewed reset procedure");
    receipt.bookmark=JSON.parse(run(["d1","time-travel","info",options.oldName,"--config",path.join(path.dirname(options.receipt),"old-database.wrangler.toml"),"--json"]));save(receipt);
    execute(options.oldName,"UPDATE account_cutover SET maintenance=1 WHERE singleton=1;");
    if(oldPolicy().maintenance!==1)throw Error("Old database was not fenced");
    receipt.fenced=true;save(receipt);return {fenced:true};
  }
  if(options.action==="bind"){
    // Binding preparation does not deploy or reopen production.
    const source=bindingConfig(read(config,"utf8"),options.newName,receipt.newId,receipt.generation);
    write(config,source);receipt.bindingPrepared=true;save(receipt);return {database:receipt.newName,generation:receipt.generation};
  }
  if(!options.origin)throw Error("Provide --origin for deployed verification");
  const bootstrap=await fetcher(new URL("/api/shell/bootstrap",options.origin),{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});
  const body=await bootstrap.json();
  if(!bootstrap.ok||body.storageGeneration!==receipt.generation)throw Error("Production is not serving the prepared storage generation");
  if(options.action==="reopen"){
    if(!receipt.fenced||oldPolicy().maintenance!==1)throw Error("Old writers must remain fenced before reopening");
    execute(options.newName,"UPDATE account_cutover SET maintenance=0 WHERE singleton=1 AND activated_at IS NULL;");
    return {reopened:true};
  }
  if(body.maintenance)throw Error("Production is still in maintenance");
  if(options.action==="verify"){
    if(!options.apply)return {generation:receipt.generation,maintenance:body.maintenance,verified:false,next:"Pass --apply to run the disposable gameplay canary"};
    if(body.accountsRequired)throw Error("This recovery canary is limited to the reviewed guest-mode reset");
    const headers={"content-type":"application/json",[STORAGE_GENERATION_HEADER]:receipt.generation};
    const request=async(route,payload)=>{
      const response=await fetcher(new URL(route,options.origin),{method:payload===undefined?"GET":"POST",headers,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15000),...(payload===undefined?{}:{body:JSON.stringify(payload)})});
      const result=await response.json();if(!response.ok||result.ok===false)throw Error("Recovery gameplay canary failed");return result;
    };
    const gameId=`game-${crypto.randomUUID().replaceAll("-","")}`,identityId="smoke-player";
    const created=await request("/api/shell/games",{gameId,identityId,selfPlayMode:true,protocolVersion:2});
    const command={protocolVersion:2,gameId,identityId,clientCommandId:`v2:${crypto.randomUUID()}`,kind:"action",payload:{action:{type:"pass"}},expectedState:created.game.board.state,expectedGameplayRevision:created.game.gameplayRevision};
    command.fingerprint=await commandFingerprint(command);
    const accepted=await request(`/api/shell/games/${gameId}/apply`,command),duplicate=await request(`/api/shell/games/${gameId}/apply`,command);
    if(!accepted.accepted||!duplicate.duplicate||duplicate.game.moves.length!==1||duplicate.game.gameplayRevision!==1)throw Error("Recovery canary did not preserve exactly-once play");
    const loaded=await request(`/api/shell/games/${gameId}?identityId=${identityId}`);
    if(loaded.game.moves.length!==1)throw Error("Recovery canary reload lost history");
    const history=await request(`/api/shell/games/${gameId}/history`,{identityId,moveIndex:0});
    const live=await request(`/api/shell/games/${gameId}/live`,{identityId});
    if(!history.game.inHistoryMode||live.game.inHistoryMode)throw Error("Recovery canary history transition failed");
    const invite=await request(`/api/shell/invites/${created.game.inviteTokens.viewer}`);
    if(invite.gameId!==gameId)throw Error("Recovery canary invitation changed");
    const initial=await recoverySocketSnapshot({origin:options.origin,gameId,identityId,generation:receipt.generation,socketFactory});
    const reconnect=await recoverySocketSnapshot({origin:options.origin,gameId,identityId,generation:receipt.generation,socketFactory});
    if(initial.game.moves.length!==1||reconnect.game.moves.length!==1||reconnect.eventSeq<initial.eventSeq)throw Error("Recovery reconnect lost gameplay");
    receipt.verified=true;receipt.verifiedAt=new Date().toISOString();receipt.canaryGameId=gameId;save(receipt);return {verified:true,generation:receipt.generation};
  }
  if(options.action==="retire"){
    if(!receipt.verified||!receipt.fenced||Date.now()-Date.parse(receipt.verifiedAt)>3600000||oldPolicy().maintenance!==1)throw Error("Verify new production and retain the old fence before retirement");
    run(["d1","delete",options.oldName,"--skip-confirmation"]);receipt.retired=true;save(receipt);return {retired:true};
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await runStorageReset(parseResetArgs(process.argv.slice(2)))));}catch(error){console.error(error instanceof Error?error.message:"Storage reset failed");process.exitCode=1;}
}
