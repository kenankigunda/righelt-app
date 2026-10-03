import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {publish,publisherRoot} from '../publish.mjs';
test('external harness publishes without candidate dependencies and preserves upload failures',async()=>{
 const caller=await mkdtemp(path.join(os.tmpdir(),'validation-publish-caller-'));const site=path.join(caller,'site');await mkdir(site);await writeFile(path.join(site,'index.html'),'synthetic evidence');
 const run={id:'portable-run'};const requests=[];
 const result=await publish(run,site,{pagesProject:'proof'},{cwd:caller,execute:async(argv,options)=>{assert.equal(options.cwd,publisherRoot);assert.equal(argv[0],process.execPath);assert.equal(argv[1],path.join(publisherRoot,'node_modules/wrangler/bin/wrangler.js'));assert.equal(argv[4],site);return {output:'Uploaded https://abc123.proof.pages.dev',code:0};},fetchImpl:async url=>{requests.push(url);return new Response('portable-run');}});
 assert.equal(result.status,'published');assert.deepEqual(requests,['https://abc123.proof.pages.dev','https://run-portable-run.proof.pages.dev']);
 await assert.rejects(publish({id:'failed'},site,{pagesProject:'proof'},{cwd:caller,execute:async()=>{throw Error('upload unavailable');}}),/upload unavailable/);
 assert.equal(await readFile(path.join(site,'index.html'),'utf8'),'synthetic evidence');
});
