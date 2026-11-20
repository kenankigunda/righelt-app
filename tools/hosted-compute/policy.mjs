import { cashPlan } from './cash.mjs';
import {EXPLORATORY_PURPOSE,validateExploratoryManifest} from './exploratory-policy.mjs';
// Operational limits are independent of model/search configuration.
import policy from './policy.json' with { type: 'json' };
export const POLICY = Object.freeze(policy);
export const reserveCents = (cap) => Math.min(POLICY.shutdownReserveCents, Math.ceil(cap * POLICY.reserveBasisPoints / 10000));
export const TERMINAL = new Set(['complete', 'failed', 'cancelled', 'cleared']);
export const safeName = (s) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(s);
export const safeRunPath = (s) => typeof s === 'string' && s.startsWith('.ai-runs/') && s.split('/').every(p => /^[a-zA-Z0-9_.-]+$/.test(p) && p !== '.' && p !== '..');
export const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
export const encode = (s) => new TextEncoder().encode(s);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(v => canonical(v) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export class ContractError extends Error {}
export function assert(condition, message) { if (!condition) throw new ContractError(message); }
export function artifact(a) {
  assert(a && safeName(a.name) && /^[a-f0-9]{64}$/.test(a.sha256), 'invalid artifact identity');
  assert(Number.isSafeInteger(a.bytes) && a.bytes >= 0 && a.bytes <= POLICY.maxObjectBytes, 'invalid artifact size');
  return { name: a.name, sha256: a.sha256, bytes: a.bytes };
}
export function validateManifest(m) {
  assert(m?.schema === 1 && safeName(m.id) && m.id.length <= 40, 'invalid campaign identity');
  const publicTiming=m.purpose===POLICY.publicTiming.purpose;
  for (const key of ['sourceRevision','dependencySha256','recipeSha256','executionRecipeSha256',...(publicTiming?[]:['checkpointSha256','corpusSha256'])]) {
    assert(new RegExp(key === 'sourceRevision' ? '^[a-f0-9]{40}$' : '^[a-f0-9]{64}$').test(m[key]), `missing ${key}`);
  }
  assert(typeof m.authorizationReference === 'string' && m.authorizationReference.length >= 8, 'explicit spending authorization reference required');
  assert(Number.isSafeInteger(m.seed) && ['reliability-pilot','scientific-comparison',POLICY.publicTiming.purpose,EXPLORATORY_PURPOSE].includes(m.purpose), 'explicit supported campaign purpose required');
  assert(m.exploratory===undefined||m.purpose===EXPLORATORY_PURPOSE,'exploratory metadata requires its explicit purpose');
  assert(Number.isSafeInteger(m.maxCents) && m.maxCents > 0 && m.maxCents <= POLICY.pilotCents, 'invalid pilot cap');
  assert(['supervised-qualification','unattended'].includes(m.mode),'explicit pilot mode required');
  cashPlan(m.cash,m.maxCents);
  assert(Number.isSafeInteger(m.deadline) && m.deadline > 0, 'absolute deadline required');
  assert(Array.isArray(m.inputs) && m.inputs.length && m.inputs.length <= POLICY.maxArtifacts, 'input inventory required');
  if(m.externalControl !== undefined) assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(m.externalControl.repository) && /^[a-f0-9]{40}$/.test(m.externalControl.commit) && /^control\/prearms\/[a-f0-9]{32}\.json$/.test(m.externalControl.path) && /^[a-f0-9]{64}$/.test(m.externalControl.sha256), 'immutable private cleanup reference required');
  m.inputs.forEach(a => { artifact(a); assert(safeRunPath(a.path), 'input must have an explicit run-relative path'); });
  assert(new Set(m.inputs.map(a => a.path)).size === m.inputs.length, 'duplicate input path');
  assert(new Set(m.inputs.map(a => a.name)).size === m.inputs.length, 'duplicate input name');
  if(!publicTiming)assert(m.inputs.some(a => a.sha256 === m.checkpointSha256) && m.inputs.some(a => a.sha256 === m.corpusSha256) && m.inputs.some(a => a.sha256 === m.recipeSha256), 'checkpoint, corpus and recipe must be in input inventory');
  assert(m.inputs.some(a => a.sha256 === m.executionRecipeSha256), 'execution recipe input required');
  if(m.portableClosureSha256!==undefined) assert(/^[a-f0-9]{64}$/.test(m.portableClosureSha256)&&m.inputs.some(a=>a.sha256===m.portableClosureSha256),'portable closure must be a frozen input');
  if(m.purpose==='scientific-comparison'){
    const s=m.scientific;
    assert(s?.schema===1 && ['calibration','teacher-screen','training','evaluation','export'].includes(s.stage) && ['control','treatment','shared'].includes(s.arm),'scientific stage and arm required');
    for(const key of ['experimentSha256','methodSha256','familyInventorySha256'])assert(/^[a-f0-9]{64}$/.test(s[key])&&m.inputs.some(a=>a.sha256===s[key]),'scientific method, freeze and family inventories must be frozen inputs');
    assert(s.stage!=='evaluation'||/^[a-f0-9]{64}$/.test(s.candidateSha256)&&['validation','final'].includes(s.evaluationScope),'frozen evaluated model and validation/final scope required');
    assert(s.stage==='evaluation'&&s.evaluationScope==='final'||m.inputs.every(a=>a.role!=='protected-final'),'raw final material forbidden before candidate lock');
    const allowed={calibration:['training','evaluation','benchmark'], 'teacher-screen':['teacher'],training:['training'],evaluation:['evaluation'],export:['export']}[s.stage];
    const commands={training:'training',teacher:'teacher',evaluation:'evaluation'};
    assert(Array.isArray(m.phases)&&m.phases.length>0,'scientific phases required');
    for(const phase of m.phases){
      assert(allowed.includes(phase.kind),'scientific stage and executable phase differ');
      const command=commands[phase.kind];
      assert(command,'scientific phase requires an implemented audited adapter');
      const plan=m.inputs.find(a=>a.sha256===phase.planSha256);
      assert(/^[a-f0-9]{64}$/.test(phase.planSha256)&&plan,'scientific phase plan must be a frozen input');
      for(const [index,argv] of [phase.argv,phase.resumeArgv].entries()){
        assert(Array.isArray(argv)&&argv[0]==='tools/ai-trainer/.venv/bin/python'&&argv[1]==='-m'&&argv[2]==='righelt_training.hosted_science'&&argv[3]===command,'scientific command must use the admitted phase adapter');
        const expected=['tools/ai-trainer/.venv/bin/python','-m','righelt_training.hosted_science',command,'--plan',plan.path,'--run-dir',phase.runDir,'--seconds',String(phase.seconds),...(index===1?['--resume']:[])];
        assert(canonical(argv)===canonical(expected),'scientific plan, directory and runtime argv must match the frozen phase');
      }
      assert(phase.outputs?.length>0&&phase.outputs.every(name=>phase.expect?.[name]?.allWorkComplete===true),'automatic scientific transition requires all work complete');
    }
  }
  if (m.developmentEvidence !== undefined) {
    assert(m.developmentEvidence?.schema===1 && Object.keys(m.developmentEvidence).sort().join(',')==='contractSha256,packetSha256,receiptSha256,schema', 'invalid development evidence binding');
    for(const key of ['contractSha256','packetSha256','receiptSha256']) assert(/^[a-f0-9]{64}$/.test(m.developmentEvidence[key]) && m.inputs.some(a=>a.sha256===m.developmentEvidence[key]),'development evidence must be a frozen input');
  }
  if(m.mode==='unattended'){assert(/^[a-f0-9]{64}$/.test(m.runtimeSha256),'qualified runtime required');assert(/^[a-f0-9]{64}$/.test(m.readinessSha256)&&m.inputs.some(a=>a.sha256===m.readinessSha256),'supervised readiness input required');}
  assert(Array.isArray(m.phases) && m.phases.length > 0 && m.phases.length <= POLICY.maxPhases, 'bounded phases required');
  assert(new Set(m.phases.map(p => p.id)).size === m.phases.length, 'duplicate phase');
  for (const p of m.phases) {
    assert(Array.isArray(p.workIds) && p.workIds.length > 0 && p.workIds.every(safeName) && new Set(p.workIds).size === p.workIds.length, 'scheduled work identities required');
    assert(safeName(p.id) && ['rehearsal', 'training', 'evaluation', 'export', 'benchmark', 'teacher'].includes(p.kind), 'invalid phase');
    assert(['cpu', 'cuda'].includes(p.device), 'hosted device must be explicit');
    assert(Number.isSafeInteger(p.seconds) && p.seconds > 0 && p.seconds <= 86400, 'invalid phase runtime');
    for (const argv of [p.argv, p.resumeArgv]) assert(Array.isArray(argv) && argv.length && argv.every(v => typeof v === 'string' && v.length < 4096 && !v.includes('\0')), 'explicit command and recovery argv required');
    assert(Array.isArray(p.outputs) && p.outputs.length && p.outputs.every(safeName), 'required phase evidence outputs missing');
    assert(safeRunPath(p.runDir), 'phase run directory required');
    for (const name of p.outputs) {
      assert(safeRunPath(p.outputPaths?.[name]) && p.outputPaths[name].startsWith(p.runDir + '/'), 'output path outside phase run');
      assert(p.expect?.[name] && Object.keys(p.expect[name]).length > 0, 'output acceptance predicates required');
    }
    const h = p.host;
    assert(h?.provider === 'runpod', 'only Runpod is supported');
    assert(typeof h.image === 'string' && /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(h.image), 'container image must be digest-pinned');
    assert(Number.isSafeInteger(h.hourlyCents) && h.hourlyCents > 0 && h.hourlyCents <= 500, 'all-in hourly quote required');
    assert(Number.isSafeInteger(h.quoteExpires) && Number.isSafeInteger(h.diskGb) && h.diskGb >= 80, 'fresh quote and disk required');
    assert((p.device === 'cuda' || p.kind==='rehearsal' && p.device==='cpu') && typeof h.gpu === 'string' && Number.isSafeInteger(h.minVcpu) && h.minVcpu >= 8 && Number.isSafeInteger(h.minRamGb) && h.minRamGb >= (m.purpose===EXPLORATORY_PURPOSE?24:48), 'CPU-rich Runpod configuration required');
    assert(typeof h.dataCenterId==='string' && (m.purpose===EXPLORATORY_PURPOSE?/^[A-Z]{2,3}-[A-Z0-9-]+$/:/^(US|EU)-[A-Z0-9-]+$/).test(h.dataCenterId), 'approved data center required');
    assert(typeof h.minCudaVersion==='string' && /^\d+\.\d+$/.test(h.minCudaVersion),'explicit compatible minimum CUDA driver capability required');
    assert(typeof h.quoteReference==='string' && h.quoteReference.length>=8 && Number.isSafeInteger(h.quoteObservedAt) && h.quoteObservedAt<h.quoteExpires, 'actual quote evidence required');
  }
  if(publicTiming)validatePublicTimingManifest(m);
  if(m.purpose===EXPLORATORY_PURPOSE)validateExploratoryManifest(m);
  return structuredClone(m);
}


function validatePublicTimingManifest(m){
  const t=m.publicTiming,fields=['schema','modelSha256','profilesSha256','planSha256','producerSha256','qualifiedRuntimeSha256'];
  assert(t&&Object.keys(t).sort().join(',')===fields.sort().join(',')&&t.schema===POLICY.publicTiming.schema&&fields.filter(k=>k!=='schema').every(k=>/^[a-f0-9]{64}$/.test(t[k])),'typed public timing identity required');
  assert(m.mode==='supervised-qualification'&&m.scientific===undefined&&m.developmentEvidence===undefined&&m.portableClosureSha256===undefined&&m.checkpointSha256===undefined&&m.corpusSha256===undefined,'public timing cannot carry scientific or training inputs');
  assert(t.modelSha256===POLICY.publicTiming.incumbent.sha256&&m.inputs.some(a=>a.role==='public-incumbent-model'&&a.bytes===POLICY.publicTiming.incumbent.bytes),'frozen original public incumbent required');
  const roles={'public-incumbent-model':t.modelSha256,'public-timing-plan':t.planSha256,'public-timing-execution':m.executionRecipeSha256};
  assert(m.inputs.length===3&&m.inputs.every(a=>roles[a.role]===a.sha256)&&new Set(m.inputs.map(a=>a.role)).size===3&&m.recipeSha256===t.planSha256,'exact public-only timing input inventory required');
  assert(m.phases.length===1,'one bounded public timing phase required');
  const p=m.phases[0],plan=m.inputs.find(a=>a.role==='public-timing-plan');
  assert(p.kind==='benchmark'&&p.device==='cuda'&&p.planSha256===t.planSha256&&p.outputs.length===1,'public timing benchmark phase required');
  for(const [index,argv]of[p.argv,p.resumeArgv].entries())assert(canonical(argv)===canonical(['tools/ai-trainer/.venv/bin/python','-m','righelt_training.public_timing','--plan',plan.path,'--run-dir',p.runDir,'--seconds',String(p.seconds),...(index?['--resume']:[])]),'public timing must use its exact admitted entrypoint');
  const name=p.outputs[0];assert(p.outputPaths[name]===p.runDir+'/result.json'&&canonical(p.expect[name])===canonical({accountingComplete:true,strengthEstablished:false,scientificAdmission:false}),'public timing acceptance must preserve partial scope accounting');
}
