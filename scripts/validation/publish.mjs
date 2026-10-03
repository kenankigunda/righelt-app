import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const publisherRoot=fileURLToPath(new URL('../../',import.meta.url));
import {command,saveJSON} from './io.mjs';
export async function publish(run,dir,config,{execute=command,fetchImpl=fetch}={}){
 const project=config.pagesProject;
 if(!project||!/^[a-z0-9-]+$/.test(project))throw Error('Configure a dedicated pagesProject first');
 const branch=`run-${run.id}`.toLowerCase().replace(/[^a-z0-9-]/g,'-').slice(0,60);
 const result=await execute([process.execPath,path.join(publisherRoot,'node_modules/wrangler/bin/wrangler.js'),'pages','deploy',path.resolve(dir),'--project-name',project,'--branch',branch,'--commit-dirty=true'],{cwd:publisherRoot});
 const urls=result.output.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/g)||[];
 const immutable=urls.find(u=>new URL(u).hostname.split('.')[0]!==branch);
 if(!immutable)throw Error('Upload returned no verifiable deployment URL');
 const stable=`https://${branch}.${project}.pages.dev`;
 for(const url of [immutable,stable]){let ready=false;for(let attempt=0;attempt<12;attempt++){try{const response=await fetchImpl(url,{signal:AbortSignal.timeout(5000)});if(response.ok&&(await response.text()).includes(run.id)){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,2000));}if(!ready)throw Error(`Published report verification failed: ${url}`);}
 run.publication={status:'published',url:immutable,reviewUrl:stable,at:new Date().toISOString()};return run.publication;
}
