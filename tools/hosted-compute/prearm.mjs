import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildPrearm } from './external-control.mjs';
import { GhCliControlWriter } from './gh-cli-control.mjs';

export async function prearmCampaign(manifest,config,{store,clock=Date.now}={}) {
  const record=await buildPrearm(manifest,{...config,createdAt:clock()});
  // The reviewed GitHub allocation covers the whole offline campaign, finite
  // late-cleanup window and a separately funded owner-response margin. Its
  // evidence timestamp is not a requirement to refresh a billing screenshot
  // during the run. Unfunded coverage is rejected before any control write.
  const reference=await store.prearm(record);
  // No submission/create is performed. The operator must set the exact pinned
  // reference and arming flag, and verify workflow health, before paid launch.
  return {record,externalControl:reference};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [manifestPath,configPath,outPath]=process.argv.slice(2);
  if(!manifestPath || !configPath || !outPath) throw Error('Usage: prearm.mjs MANIFEST CONFIG NEW_PRIVATE_OUTPUT');
  const env=process.env,manifest=JSON.parse(await fs.readFile(manifestPath,'utf8')),config=JSON.parse(await fs.readFile(configPath,'utf8'));
  const store=new GhCliControlWriter({repository:env.COMPUTE_CONTROL_REPOSITORY,branch:env.COMPUTE_CONTROL_BRANCH??'main'});
  const result=await prearmCampaign(manifest,{...config,controlRepository:env.COMPUTE_CONTROL_REPOSITORY},{store});
  await fs.writeFile(outPath,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
}
