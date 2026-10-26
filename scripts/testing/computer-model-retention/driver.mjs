// Dedicated candidate-owned E2E. NOT an integrated CLI checkpoint or permission to promote.
import assert from 'node:assert/strict';
import {readFile,realpath,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {fork} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {admitManifest,readRef,sha,verifySource} from './manifest.mjs';
import {writePrivate,inventory,copyStoppedState,assertHistoryPrefix} from './state-fixture.mjs';
import {flowTools,passiveWorkerIdentity,restoreSession,session,pendingJournal,waitValue} from './browser-flows.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
async function ownerGuard(m) {
 const run=process.env.RIGHELT_RESOURCE_RUN;assert.match(run??'',/^[-a-zA-Z0-9]{1,100}$/,'Actual released supervision required');
 const registry=await realpath(path.join(homedir(),'.local/state/righelt/resources'));assert.ok(!process.env.RIGHELT_RESOURCE_REGISTRY||process.env.RIGHELT_RESOURCE_REGISTRY===registry);
 const record=JSON.parse(await readFile(path.join(registry,run+'.json'),'utf8'));assert.equal(record.id,run);assert.equal(record.kind,'heavy');assert.equal(record.status,'running');assert.equal(record.cwd,m.prospective.checkout);
 const {processTable}=await import(pathToFileURL(path.join(m.guardian.checkout,'scripts/resources/system.mjs')).href);const rows=await processTable(),byPid=new Map(rows.map(row=>[row.pid,row]));
 const supervisor=byPid.get(record.supervisor.pid);assert.ok(supervisor&&supervisor.start===record.supervisor.start&&!supervisor.state.startsWith('Z'));
 let row=byPid.get(process.pid);const seen=new Set();while(row&&row.pid!==supervisor.pid){assert.ok(!seen.has(row.pid)&&seen.size<64&&!row.state.startsWith('Z'));seen.add(row.pid);row=byPid.get(row.ppid);}assert.ok(row&&row.start===supervisor.start,'Copied resource environment outside owner tree rejected');
 return {resourceRunId:run,supervisor:record.supervisor,driverPid:process.pid};
}
async function portsFree() {
 for(const port of [9988,9987,10088,9997,9998])await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(error=>error?reject(error):resolve()));});
 return true;
}
async function launchStack(m,spec,persist,role) {
 await portsFree();const log=createWriteStream(path.join(m.output,role+'-stack.log'),{flags:'wx',mode:0o600});
 const child=fork(path.join(here,'stack-child.mjs'),[spec.checkout,persist,spec.sourceRevision,spec.tree],{cwd:spec.checkout,env:{...process.env,RIGHELT_VALIDATION_TARGET_ROOT:spec.checkout,RIGHELT_ACCOUNT_CANDIDATE_ROOT:spec.checkout},stdio:['ignore','pipe','pipe','ipc']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 let stopReady=false,readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{log.end();readyReject(Error(`Stack exited before readiness: ${code}/${signal}`));resolve({code,signal});}));
 child.on('message',message=>{if(message?.type==='ready'){try{assert.equal(message.origin,m.origin);assert.equal(message.root,spec.checkout);readyResolve(message);}catch(error){readyReject(error);}}if(message?.type==='error')readyReject(Error(message.message));if(message?.type==='stopped')stopReady=true;});
 const timer=setTimeout(()=>readyReject(Error('Canonical stack readiness exceeded120s')),120000);
 const waitExit=async()=>{let timer;try{return await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned stack cleanup did not acknowledge exit within30s; outer guardian must finish cleanup')),30000);})]);}finally{clearTimeout(timer);}};
 try{await ready;}catch(error){if(child.connected)child.send({type:'stop'});try{await waitExit();}catch(cleanup){error.cleanupError=cleanup.message;}throw error;}finally{clearTimeout(timer);}
 return {child,async stop(){if(child.connected)child.send({type:'stop'});const result=await waitExit();assert.equal(result.code,0,'Owned stack cleanup must succeed');assert.equal(result.signal,null);assert.equal(stopReady,true);await portsFree();return {kind:'owned-retention-stack-stop-v1',role,pid:child.pid,...result,stackStopped:true,portsFree:true};}};
}
function apiTraffic(page,events) {
 page.on('request',request=>{const url=new URL(request.url());if(url.origin!==page.context()._retentionOrigin||!url.pathname.startsWith('/api/'))return;let body;try{body=request.postDataJSON();}catch{}events.push({at:new Date().toISOString(),type:'request',method:request.method(),path:url.pathname,body});});
 page.on('response',response=>{const url=new URL(response.url());if(url.pathname.startsWith('/api/'))events.push({at:new Date().toISOString(),type:'response',status:response.status(),path:url.pathname});});
}
async function main() {
 const [manifestFile,manifestSha,...extra]=process.argv.slice(2);assert.ok(manifestFile&&manifestSha&&!extra.length,'Explicit root manifest and exact SHA required; no skip/default gate');
 const admitted=await admitManifest(manifestFile,manifestSha),m=admitted.manifest;const ownership=await ownerGuard(m);
 const dependencies=await readRef(m.dependencies);assert.ok(Object.keys(dependencies.inputs??{}).length);
 const required=[...['manifest.mjs','state-fixture.mjs','stack-child.mjs','browser-flows.mjs','driver.mjs'].map(file=>path.join(here,file)),...['e2e/support/app.mjs','e2e/support/computer-projection.mjs','e2e/support/command-observations.mjs','scripts/validation/results-proof.mjs'].map(file=>path.join(m.prospective.checkout,file)),...['old','prospective'].map(role=>path.join(m[role].checkout,'scripts/validation/account-stack.mjs')),m.playwrightEntry.path,m.browserExecutable.path];for(const file of required)assert.ok(dependencies.inputs[file],`Missing effective dependency: ${file}`);
 for(const [file,digest] of Object.entries(dependencies.inputs)){assert.ok(path.isAbsolute(file));assert.equal(sha(await readFile(file)),digest);}
 const require=createRequire(path.join(m.prospective.checkout,'package.json'));const entry=await realpath(require.resolve('@playwright/test'));assert.equal(entry,m.playwrightEntry.path);assert.equal(sha(await readFile(entry)),m.playwrightEntry.sha256);assert.equal(dependencies.inputs[entry],m.playwrightEntry.sha256);assert.equal(await realpath(m.browserExecutable.path),m.browserExecutable.path);assert.equal(sha(await readFile(m.browserExecutable.path)),m.browserExecutable.sha256);assert.equal(dependencies.inputs[m.browserExecutable.path],m.browserExecutable.sha256);
 assert.equal(await realpath(path.dirname(m.output)),path.dirname(m.output));await mkdir(m.output,{mode:0o700});
 await writePrivate(path.join(m.output,'root-manifest.json'),m);await writePrivate(path.join(m.output,'owner-admission.json'),ownership);
 const {chromium,expect}=require(entry),appHelpers=await import(pathToFileURL(path.join(m.prospective.checkout,'e2e/support/app.mjs')).href),projection=await import(pathToFileURL(path.join(m.prospective.checkout,'e2e/support/computer-projection.mjs')).href),requests=await import(pathToFileURL(path.join(m.prospective.checkout,'scripts/validation/results-proof.mjs')).href),observations=await import(pathToFileURL(path.join(m.prospective.checkout,'e2e/support/command-observations.mjs')).href);
 const check=async()=>{const auth=await readRef(m.authorization);assert.deepEqual(auth,admitted.authorization);assert.equal(auth.active,true);assert.ok(Date.now()<Date.parse(m.phaseDeadline)&&Date.now()<Date.parse(auth.expiresAt),'Finite root proof grant expired');};
 const tools=flowTools({appHelpers,projection,requests,expect,check,output:m.output});
 let stack,browser,context,page,saved,primary,oldStop,afterStop;const pageErrors=[],traffic=[],screenshots=[],results={kind:'real-cross-version-computer-retention-result-v1',complete:false,manifestSha256:manifestSha,old:m.old,prospective:m.prospective,trainingClosure:m.trainingClosure,numericProof:m.numericProof,noProductionWrites:true,noDeletion:true,checkpointClaim:false};
 async function openBrowser(storage,sessionValues){
  await check();browser=await chromium.launch({headless:true,executablePath:m.browserExecutable.path});context=await browser.newContext({baseURL:m.origin,viewport:{width:1440,height:1100},ignoreHTTPSErrors:true,...(storage?{storageState:storage}:{})});context._retentionOrigin=m.origin;
  await context.addInitScript(observations.installPassiveCommandObservations);await context.addInitScript(passiveWorkerIdentity);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==m.origin&&!['data:','blob:','about:'].includes(url.protocol))return route.abort('blockedbyclient');return route.continue();});
  context.on('page',p=>{p.setDefaultTimeout(15000);p.on('pageerror',error=>pageErrors.push({url:p.url(),message:error.message}));apiTraffic(p,traffic);});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});page=await context.newPage();if(sessionValues)await page.addInitScript(restoreSession,{origin:m.origin,values:sessionValues});return page;
 }
 async function capture(label){const file=path.join(m.output,label+'.png');await page.screenshot({path:file,fullPage:true});screenshots.push({label,path:file});}
 async function closeBrowser(label){
  if(!browser)return;let failure;try{if(page&&!page.isClosed())await observations.attachCommandObservations(page,{outputPath:name=>path.join(m.output,label+'-'+name),attach:async()=>{}});}catch(error){failure=error;}
  try{await context?.tracing.stop({path:path.join(m.output,label+'-trace.zip')});}catch(error){failure??=error;}finally{await browser.close();browser=null;context=null;page=null;}if(failure)throw failure;
 }
 try {
  stack=await launchStack(m,m.old,path.join(m.output,'old-account-state'),'old026');await openBrowser();await tools.register(page);const created=await tools.createComputer(page,m.old);
  const oldProof=await tools.humanThenComputer(page,created.id,m.old.modelId,m.old.assetSha256);saved=await tools.snapshot(page,oldProof,m.old);await capture('old026-real1554-accepted');results.seed={gameId:saved.gameId,accountId:saved.account.id,acceptedMoveId:saved.acceptedDecision.moveId,modelId:saved.modelId};
  await closeBrowser('old026');oldStop=await stack.stop();stack=null;await writePrivate(path.join(m.output,'old026-stop.json'),oldStop);
  const copied=await copyStoppedState({source:path.join(m.output,'old-account-state'),destination:path.join(m.output,'prospective-account-state'),assertStopped:async()=>{assert.ok(oldStop?.stackStopped);return portsFree();}});await writePrivate(path.join(m.output,'stopped-copy-inventory.json'),copied);
  await admitManifest(manifestFile,manifestSha);stack=await launchStack(m,m.prospective,path.join(m.output,'prospective-account-state'),'prospective');await openBrowser(saved.storage,saved.sessionStorage);
  const retained=await tools.retained(page,saved,m.old,m.prospective);await capture('prospective-same1554-game');await writePrivate(path.join(m.output,'retained1554-extra-proof.json'),retained);results.retained1554={gameId:saved.gameId,newAcceptedMoveId:retained.decision.moveId,modelId:retained.game.computer.modelId};
  const fresh=await tools.createComputer(page,m.prospective);const freshProof=await tools.humanThenComputer(page,fresh.id,m.prospective.modelId,m.prospective.assetSha256);await capture('prospective-newCURRENT-game');await writePrivate(path.join(m.output,'newCURRENT-proof.json'),freshProof);
  const branched=await tools.branch(page,saved,m.prospective);await writePrivate(path.join(m.output,'newCURRENT-branch.json'),branched);
  const rematched=await tools.rematch(page,m.prospective,m.prospective.checkout);await writePrivate(path.join(m.output,'newCURRENT-rematch.json'),rematched);await capture('prospective-newCURRENT-rematch');
  for(const [id,modelId] of [[saved.gameId,m.old.modelId],[fresh.id,m.prospective.modelId],[branched.created.id,m.prospective.modelId],[rematched.game.id,m.prospective.modelId]]){await tools.navigate(page,id);await page.reload();const game=await tools.game(page,id);assert.equal(game.computer.modelId,modelId);assert.equal((await session(page)).account.id,saved.account.id);if(id===saved.gameId)assertHistoryPrefix(game,saved);}
  assert.deepEqual(await pendingJournal(page),[]);assert.deepEqual(pageErrors,[]);
  const modelChanges=traffic.filter(e=>e.type==='request'&&e.path===`/api/shell/games/${saved.gameId}/shared`&&e.body?.payload?.operation==='computer-control'&&e.body?.payload?.values?.action==='upgrade');assert.deepEqual(modelChanges,[],'Retained game must not be implicitly upgraded');
  const keepCurrent=traffic.filter(e=>e.type==='request'&&e.path===`/api/shell/games/${saved.gameId}/shared`&&e.body?.payload?.operation==='computer-control'&&e.body?.payload?.values?.action==='decline-upgrade');assert.ok(keepCurrent.length,'Keep current must travel through canonical durable transport');assert.equal(new Set(keepCurrent.map(e=>e.body.clientCommandId)).size,1);assert.ok(keepCurrent.every(e=>e.body.clientCommandId&&e.body.fingerprint===keepCurrent[0].body.fingerprint));results.retainedControl={action:'decline-upgrade',clientCommandId:keepCurrent[0].body.clientCommandId,fingerprint:keepCurrent[0].body.fingerprint};
  results.newGames={fresh:fresh.id,branch:branched.created.id,rematch:rematched.game.id};results.newModelId=m.prospective.modelId;
  await closeBrowser('prospective');afterStop=await stack.stop();stack=null;await writePrivate(path.join(m.output,'prospective-stop.json'),afterStop);
  assert.deepEqual(await inventory(path.join(m.output,'old-account-state')),copied,'Sealed old private state must stay unchanged');await admitManifest(manifestFile,manifestSha);
  results.complete=true;
 }catch(error){primary=error;results.error={name:error.name,message:error.message,stack:error.stack};}
 finally{
  const cleanup=[];try{await closeBrowser('failure');}catch(error){cleanup.push({name:error.name,message:error.message});}
  if(stack)try{afterStop=await stack.stop();}catch(error){cleanup.push({name:error.name,message:error.message});}
  results.cleanup={browserClosed:browser===null,oldStackStopped:oldStop?.stackStopped===true,prospectiveStackStopped:afterStop?.stackStopped===true,errors:cleanup};if(cleanup.length)results.complete=false;
  results.pageErrors=pageErrors;results.screenshots=screenshots;await writePrivate(path.join(m.output,'raw-traffic.json'),traffic);await writePrivate(path.join(m.output,'result.json'),results);
 }
 assert.equal(results.complete,true,primary?.message??'Cross-version proof incomplete');if(primary)throw primary;console.log(JSON.stringify({output:m.output,complete:true,oldGameId:saved.gameId,oldModelId:m.old.modelId,newModelId:m.prospective.modelId}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
