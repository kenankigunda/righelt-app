import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {publish,publisherRoot} from '../publish.mjs';
test('external harness publishes without candidate dependencies and preserves upload failures',async()=>{
 const caller=await mkdtemp(path.join(os.tmpdir(),'validation-publish-caller-'));const site=path.join(caller,'site');await mkdir(site);await writeFile(path.join(site,'index.html'),'synthetic evidence');
 const run={id:'portable-run'};const requests=[];
 const result=await publish(run,site,{pagesProject:'proof'},{cwd:caller,execute:async(argv,options)=>{assert.equal(options.cwd,publisherRoot);assert.equal(argv[0],process.execPath);assert.equal(argv[1],path.join(publisherRoot,'scripts/validation/publisher/node_modules/wrangler/bin/wrangler.js'));assert.equal(argv[4],site);return {output:'Uploaded https://abc123.proof.pages.dev',code:0};},fetchImpl:async url=>{requests.push(url);return new Response('portable-run');}});
 assert.equal(result.status,'published');assert.deepEqual(requests,['https://abc123.proof.pages.dev','https://run-portable-run.proof.pages.dev']);
 await assert.rejects(publish({id:'failed'},site,{pagesProject:'proof'},{cwd:caller,execute:async()=>{throw Error('upload unavailable');}}),/upload unavailable/);
 assert.equal(await readFile(path.join(site,'index.html'),'utf8'),'synthetic evidence');
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
