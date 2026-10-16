import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {STORAGE_POLICY} from '../packages/shared-types/src/storage-policy.js';

export const ARCHIVE_RESOURCES=Object.freeze({bucket:'righelt-archives',database:'righelt-db-prod',databaseId:'4ce7cf1e-627e-427d-99c8-438f34d51aeb'});
export const ARCHIVE_MODES=Object.freeze(['disabled','canary','active','drain']);
export function archiveSettings(mode='disabled',canaryGameId=''){
 if(!ARCHIVE_MODES.includes(mode))throw Error('Invalid archive mode');
 if(mode==='canary'?!/^game-[a-f0-9]{32}$/.test(canaryGameId):canaryGameId!=='')throw Error('Canary mode requires one explicit disposable game; other modes require no canary');
 return {mode,canaryGameId,archives:mode==='active'||mode==='canary',guards:mode!=='disabled',crons:mode==='disabled'?[]:[mode==='canary'?STORAGE_POLICY.archiveCanaryCron:STORAGE_POLICY.archiveCron]};
}
const variable=(source,key,value)=>{
 const line=`${key} = ${JSON.stringify(String(value))}`;
 return new RegExp(`^${key}\\s*=.*$`,'m').test(source)?source.replace(new RegExp(`^${key}\\s*=.*$`,'m'),line):source.replace('[vars]',`[vars]\n${line}`);
};
export function archiveConfig(source,bucket,{mode='disabled',canaryGameId=''}={}){
 if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket||''))throw Error('Provide the verified private archive bucket name');
 if(!source.includes('[vars]'))throw Error('Missing variables table');
 const settings=archiveSettings(mode,canaryGameId);
 const blocks=source.match(/\[\[r2_buckets\]\][\s\S]*?(?=\n\[|$)/g)??[];
 if(blocks.length){
  if(blocks.length!==1||!/^binding\s*=\s*"ARCHIVES"$/m.test(blocks[0])||!blocks[0].includes(`bucket_name = "${bucket}"`))throw Error('Existing resource bindings require explicit reconciliation');
 }else source+=`\n[[r2_buckets]]\nbinding = "ARCHIVES"\nbucket_name = "${bucket}"\n`;
 for(const [key,value] of Object.entries({STORAGE_ARCHIVE_MODE:settings.mode,STORAGE_ARCHIVE_CANARY_GAME_ID:settings.canaryGameId,STORAGE_ARCHIVES_ENABLED:settings.archives,STORAGE_BUDGET_ENABLED:settings.guards,STORAGE_EXCLUSIVE_R2:settings.guards}))source=variable(source,key,value);
 const triggers=`[triggers]\ncrons = ${JSON.stringify(settings.crons)}\n`;
 if(/\[triggers\]/.test(source))source=source.replace(/\[triggers\][\s\S]*?(?=\n\[|$)/,triggers);
 else source+='\n'+triggers;
 return source;
}
export function archiveDeploymentConfig(env,source){
 const bucket=/\[\[r2_buckets\]\][\s\S]*?bucket_name\s*=\s*"([^"]+)"/.exec(source)?.[1];
 const database=/database_name\s*=\s*"([^"]+)"/.exec(source)?.[1];
 const id=/database_id\s*=\s*"([^"]+)"/.exec(source)?.[1];
 if(bucket!==ARCHIVE_RESOURCES.bucket||database!==ARCHIVE_RESOURCES.database||id!==ARCHIVE_RESOURCES.databaseId)throw Error('Archive resources differ from approved production resources');
 if(!['true','false'].includes(env.RIGHELT_STORAGE_ARCHIVE_ACTIVATED||'false'))throw Error('Invalid archive activation latch');
 const mode=env.RIGHELT_STORAGE_ARCHIVE_MODE||'disabled';
 if(env.RIGHELT_STORAGE_ARCHIVE_ACTIVATED==='true'&&mode==='disabled')throw Error('Activated archives require active, canary or drain mode');
 return archiveConfig(source,bucket,{mode,canaryGameId:env.RIGHELT_STORAGE_ARCHIVE_CANARY_GAME_ID||''});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2),read=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  if(!args.includes('--exclusive-bucket'))throw Error('Confirm account-wide R2 usage is exclusively tracked by this bucket');
  const path='apps/api/wrangler.toml',result=archiveConfig(readFileSync(path,'utf8'),read('--bucket'),{mode:read('--mode')||'disabled',canaryGameId:read('--canary-game')||''});
  if(args.includes('--apply'))writeFileSync(path,result);else console.log(result);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
