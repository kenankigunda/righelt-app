import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const publisherRoot=fileURLToPath(new URL('../../',import.meta.url));
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {command} from './io.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
function deploymentURLs(output,project){
 const clean=output.replace(/\x1b\[[0-9;]*m/g,'');
 const deployment=clean.match(/Deployment complete! Take a peek over at (https:\/\/\S+)/)?.[1];
 const alias=clean.match(/Deployment alias URL: (https:\/\/\S+)/)?.[1];
 const trusted=value=>{
  try{const url=new URL(value);const suffix=`.${project}.pages.dev`;const label=url.hostname.slice(0,-suffix.length);
   if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.pathname==='/'&&!url.search&&!url.hash&&url.hostname.endsWith(suffix)&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))return url.origin;
  }catch{}
  throw Error('Upload returned no trusted project deployment URL');
 };
 return {immutable:trusted(deployment),stable:alias?trusted(alias):trusted(deployment)};
}
export async function publish(run,dir,config,{execute=command,fetchImpl=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(config?.publicationEnabled!==true){run.publication={status:'disabled',reason:'Publishing is paused; review the local evidence summary in Codex.'};return run.publication;}
 const project=config.pagesProject;
 if(!project||!/^[a-z0-9-]+$/.test(project))throw Error('Configure a dedicated pagesProject first');
 const branch=`run-${run.id}`.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,60);
 const expected=await readFile(path.join(dir,'index.html'));
 const data=expected.toString('utf8').match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
 let reportId;try{reportId=JSON.parse(data).id;}catch{}
 if(!data||reportId!==run.id)throw Error('Local report identity does not match publication run');
 let result;try{result=await execute([process.execPath,path.join(publisherRoot,'scripts/validation/publisher/node_modules/wrangler/bin/wrangler.js'),'pages','deploy',path.resolve(dir),'--project-name',project,'--branch',branch,'--commit-dirty=true'],{cwd:publisherRoot});}catch(cause){throw Error('Report upload failed',{cause});}
 if(result.code)throw Error('Report upload failed');
 const {immutable,stable}=deploymentURLs(result.output,project);
 const expectedDigest=digest(expected);
 for(const url of new Set([immutable,stable])){let ready=false;for(let attempt=0;attempt<12;attempt++){try{const response=await fetchImpl(url,{signal:AbortSignal.timeout(5000),redirect:'error'});if(response.ok&&digest(Buffer.from(await response.arrayBuffer()))===expectedDigest){ready=true;break;}}catch{}if(attempt<11)await wait(2000);}if(!ready)throw Error(`Published report verification failed: ${url}`);}
 run.publication={status:'published',url:immutable,reviewUrl:stable,at:new Date().toISOString()};return run.publication;
}
