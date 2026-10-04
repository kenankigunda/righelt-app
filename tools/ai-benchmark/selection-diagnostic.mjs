// Engineering workload only: synthetic fixed logits, no training or strength claims.
import { readFile, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const options=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,args)=>
  index%2 ? pairs : [...pairs,[value.replace(/^--/,''),args[index+1]]],[]));

if(options.child){
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const job=JSON.parse(input),start=performance.now();
  const engine=await import(pathToFileURL(path.join(job.root,'packages/game-engine/src/index.ts')));
  const player=await import(pathToFileURL(path.join(job.root,'packages/computer-player/src/index.ts')));
  const initializationMs=performance.now()-start,state=job.row.state;
  const bound=operation=>{
    let expansions=0;const deadline=performance.now()+3000;
    return engine.withEngineComputationGuard(expansion=>{
      if(performance.now()>deadline)throw new Error('diagnostic-deadline');
      if(expansion&&++expansions>16384)throw new Error('diagnostic-expansion-limit');
    },operation);
  };
  const timed=operation=>{const began=performance.now();try{return{status:'completed',value:operation(),ms:performance.now()-began};}
    catch(error){if(!/^(diagnostic-|node-limit$)/.test(error.message))throw error;return{status:'unfinished',reason:error.message,ms:performance.now()-began};}};
  const legal=timed(()=>bound(()=>engine.listLegalActions(state)));
  if(legal.value){legal.count=legal.value.length;legal.hash=createHash('sha256').update(JSON.stringify(legal.value)).digest('hex');delete legal.value;}
  const counters={},unique=new Set(),supplyStack=[];let supplyMs=0,inferenceMs=0,inferences=0;
  const observeEngine=event=>{
    counters[event.type]=(counters[event.type]??0)+1;
    if(event.type==='continuation-key')unique.add(createHash('sha256').update(event.key).digest('hex'));
    if(event.type==='supply-start')supplyStack.push(performance.now());
    if(event.type==='supply-end')supplyMs+=performance.now()-supplyStack.pop();
    if(event.type==='candidate-result')counters['candidate-'+event.status]=(counters['candidate-'+event.status]??0)+1;
  };
  const began=performance.now();
  const result=await player.selectMove({state,seed:107,simulations:32,decisionCache:job.cache,deadlineMs:began+5000,
    ...(job.instrument ? {observeEngine} : {})},async()=>{
    const tick=performance.now(),policyLogits=new Float32Array(2801);
    for(let i=0;i<policyLogits.length;i++)policyLogits[i]=Math.sin(i*1.7)*.25;
    inferences++;inferenceMs+=performance.now()-tick;return{policyLogits,value:.125};
  });
  const searchMs=performance.now()-began;let recording,replay,nextHash;
  if(result.status==='ready'){
    const next=result.nextState??bound(()=>player.transition(state,result.action));nextHash=engine.deterministicStateHash(next);
    let record;
    recording=timed(()=>{
      record={controller:state.sideToMove,action:result.action,beforeHash:engine.deterministicStateHash(state),afterHash:nextHash,
        legal:result.legality?.indices??[...bound(()=>player.legalActionMap(state)).keys()],policy:result.policy,
        policyMask:result.policyMask,fallback:result.fallback,...(result.legality?{legality:result.legality}:{})};
      return Buffer.byteLength(JSON.stringify(record));
    });
    if(recording.status==='completed'){
      const {replayDecision}=await import('./../ai-trainer/decision-replay.mjs');
      const {createEngineOperationBudget}=await import('./../ai-trainer/engine-operation-budget.mjs');
      const budget=createEngineOperationBudget('replay',2048,()=>{});
      replay=timed(()=>engine.deterministicStateHash(replayDecision(state,record,budget.bounded)));
      if(replay.status==='completed'&&replay.value!==nextHash)throw new Error('Replay parity mismatch');
    }
  }
  const {nextState,...compact}=result;
  process.stdout.write(JSON.stringify({id:job.row.id,mode:job.mode,iteration:job.iteration,initializationMs,legal,
    result:compact,nextHash,searchMs,recording,replay,inferences,inferenceMs,
    ...(job.instrument?{instrumentation:{counters,uniqueContinuationStates:unique.size,supplyMs}}:{}),
    peakRssKiB:process.resourceUsage().maxRSS,heapUsedBytes:process.memoryUsage().heapUsed}));
}else{
  if(!options.corpus||!options.output||!options['baseline-root'])throw new Error('Required: --corpus FILE --output FILE --baseline-root DIR [--repetitions 3]');
  const bytes=await readFile(options.corpus),corpus=JSON.parse(bytes),repetitions=Number(options.repetitions??3);
  if(!Number.isSafeInteger(repetitions)||repetitions<1||repetitions>10||corpus.states.some(row=>row.partition==='final'))throw new Error('Invalid diagnostic workload');
  const rows=[],script=fileURLToPath(import.meta.url);
  async function run(job){
    const start=performance.now();
    return await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--import','tsx',script,'--child','true'],{cwd:root,stdio:['pipe','pipe','pipe']});
      let output='',error='';let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},15000);
      child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>error+=data);
      child.on('error',reject);child.on('close',code=>{clearTimeout(timer);
        if(timedOut)return resolve({id:job.row.id,mode:job.mode,iteration:job.iteration,status:'watchdog',wallMs:performance.now()-start});
        if(code!==0)return reject(new Error(`${job.row.id}/${job.mode}: ${error}\n${output}`));
        resolve({...JSON.parse(output),wallMs:performance.now()-start});});
      child.stdin.end(JSON.stringify(job));
    });
  }
  for(let iteration=0;iteration<repetitions;iteration++)for(const row of corpus.states){
    // Alternate ordering to reduce systematic warm-machine bias. Separate processes
    // include startup and prevent any accidental cache sharing between decisions.
    const modes=iteration%2?['cache-on','cache-off','baseline']:['baseline','cache-off','cache-on'];
    for(const mode of modes){
      rows.push(await run({row,mode,iteration,cache:mode==='cache-on',root:mode==='baseline'?path.resolve(options['baseline-root']):root}));
    }
    process.stderr.write(`Completed diagnostic ${iteration+1}/${repetitions}: ${row.id}\n`);
  }
  const profiles=[];
  for(const row of corpus.states)profiles.push(await run({row,mode:'instrumented-cache-off',iteration:0,root,cache:false,instrument:true}));
  const report={schema:1,kind:'engineering-selection-diagnostic',createdAt:new Date().toISOString(),
    sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    sourceDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
    baselineRoot:path.resolve(options['baseline-root']),corpusSha256:createHash('sha256').update(bytes).digest('hex'),
    evaluator:'Fixed synthetic policy logits and value; no trained model or strength measurement',
    cacheEnabledByDefault:false,actualPhone:false,trainingRestarted:false,repetitions,rows,profiles};
  await writeFile(options.output,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({output:options.output,decisions:rows.length,profiles:profiles.length}));
}
