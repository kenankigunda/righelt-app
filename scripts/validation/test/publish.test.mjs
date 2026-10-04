import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {publish,publisherRoot} from '../publish.mjs';
test('external harness publishes without candidate dependencies and preserves upload failures',async()=>{
 const caller=await mkdtemp(path.join(os.tmpdir(),'validation-publish-caller-'));const site=path.join(caller,'site');await mkdir(site);await writeFile(path.join(site,'index.html'),'<script id="report-data" type="application/json">{"id":"portable-run"}</script>');
 const run={id:'portable-run'};const requests=[];
 const result=await publish(run,site,{pagesProject:'proof'},{cwd:caller,execute:async(argv,options)=>{assert.equal(options.cwd,publisherRoot);assert.equal(argv[0],process.execPath);assert.equal(argv[1],path.join(publisherRoot,'scripts/validation/publisher/node_modules/wrangler/bin/wrangler.js'));assert.equal(argv[4],site);return {output:'Deployment complete! Take a peek over at https://abc123.proof.pages.dev\nDeployment alias URL: https://run-portable-run.proof.pages.dev',code:0};},fetchImpl:async url=>{requests.push(url);return new Response(await readFile(path.join(site,'index.html')));}});
 assert.equal(result.status,'published');assert.deepEqual(requests,['https://abc123.proof.pages.dev','https://run-portable-run.proof.pages.dev']);
 await assert.rejects(publish({id:'portable-run'},site,{pagesProject:'proof'},{cwd:caller,execute:async()=>{throw Error('upload unavailable');}}),/Report upload failed/);
 assert.equal(await readFile(path.join(site,'index.html'),'utf8'),'<script id="report-data" type="application/json">{"id":"portable-run"}</script>');
});

test('publisher installation leaves the app Wrangler executable on its own pinned runtime',async()=>{
 const rootPackage=JSON.parse(await readFile(path.join(publisherRoot,'package.json'),'utf8'));
 const appRuntime=JSON.parse(await readFile(path.join(publisherRoot,'node_modules/wrangler/package.json'),'utf8'));
 const publisherPackage=JSON.parse(await readFile(path.join(publisherRoot,'scripts/validation/publisher/package.json'),'utf8'));
 const publishRuntime=JSON.parse(await readFile(path.join(publisherRoot,'scripts/validation/publisher/node_modules/wrangler/package.json'),'utf8'));
 assert.equal(appRuntime.version,rootPackage.devDependencies.wrangler);
 assert.equal(publishRuntime.version,publisherPackage.dependencies.wrangler);
 assert.notEqual(appRuntime.version,publishRuntime.version);
 const shim=await readFile(path.join(publisherRoot,'node_modules/.bin/wrangler'),'utf8');
 assert.ok(shim.includes(`wrangler@${appRuntime.version}`),'app command must resolve to the app runtime');
 assert.ok(!shim.includes(`wrangler@${publishRuntime.version}`),'publisher must not replace the app executable');
});

test('publisher follows the returned normalized alias instead of guessing the requested branch',async()=>{
 const site=await mkdtemp(path.join(os.tmpdir(),'validation-publish-alias-'));
 const run={id:'focused-account-upgrade-c3a5c9e'};
 const html=`<script id="report-data" type="application/json">${JSON.stringify(run)}</script>`;
 await writeFile(path.join(site,'index.html'),html);
 const requests=[];
 const result=await publish(run,site,{pagesProject:'proof'},{
  execute:async()=>({code:0,output:'✨ Deployment complete! Take a peek over at https://a1b2c3d4.proof.pages.dev\n✨ Deployment alias URL: https://run-focused-account-upgrade.proof.pages.dev'}),
  fetchImpl:async url=>{requests.push(url);return new Response(html);},
 });
 assert.equal(result.url,'https://a1b2c3d4.proof.pages.dev');
 assert.equal(result.reviewUrl,'https://run-focused-account-upgrade.proof.pages.dev');
 assert.deepEqual(requests,[result.url,result.reviewUrl]);
});

test('publisher accepts immutable-only output but rejects wrong hosts, redirects and stale report bytes',async()=>{
 const site=await mkdtemp(path.join(os.tmpdir(),'validation-publish-verify-'));
 const html='<script id="report-data" type="application/json">{"id":"verified"}</script>';
 await writeFile(path.join(site,'index.html'),html);
 const output='Deployment complete! Take a peek over at https://abcdef12.proof.pages.dev';
 const requests=[];
 const result=await publish({id:'verified'},site,{pagesProject:'proof'},{execute:async()=>({code:0,output}),fetchImpl:async(url,options)=>{requests.push(url);assert.equal(options.redirect,'error');return new Response(html);}});
 assert.equal(result.url,result.reviewUrl);assert.equal(requests.length,1);
 for(const bad of [
  'Uploaded https://abcdef12.proof.pages.dev',
  output.replace('.proof.pages.dev','.other.pages.dev'),
  output.replace('.proof.pages.dev','.proof.pages.dev.evil.example'),
  output.replace('abcdef12.proof','nested.abcdef12.proof'),
  output+'\nDeployment alias URL: https://run-verified.other.pages.dev',
  output+'\nDeployment alias URL: https://run-verified.proof.pages.dev/?secret=not-logged',
 ]){
  const run={id:'verified'};
  await assert.rejects(publish(run,site,{pagesProject:'proof'},{execute:async()=>({code:0,output:bad}),fetchImpl:async()=>{assert.fail('untrusted output must not be fetched');}}),/trusted project deployment URL/);
  assert.equal(run.publication,undefined);
 }
 for(const fetchImpl of [async()=>new Response(html+'stale'),async()=>{throw Error('redirect refused');},async()=>new Response(html,{status:503})]){
  const run={id:'verified'};
  await assert.rejects(publish(run,site,{pagesProject:'proof'},{execute:async()=>({code:0,output}),fetchImpl,wait:async()=>{}}),/Published report verification failed/);
  assert.equal(run.publication,undefined);
 }
 await assert.rejects(publish({id:'verified'},site,{pagesProject:'proof'},{execute:async()=>({code:1,output}),fetchImpl:async()=>{assert.fail('failed upload must not verify');}}),/Report upload failed/);
 await assert.rejects(publish({id:'verified'},site,{pagesProject:'proof'},{execute:async()=>{throw Error('private credential payload');}}),error=>{assert.equal(error.message,'Report upload failed');assert.equal(error.cause.message,'private credential payload');return true;});
 await assert.rejects(publish({id:'different'},site,{pagesProject:'proof'},{execute:async()=>{assert.fail('wrong local identity must not upload');}}),/Local report identity/);
});
