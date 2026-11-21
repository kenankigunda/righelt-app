import {isCloudRepair} from './cloud-repair-policy.mjs';
import {programWindowBinding,amendProgramWindow} from './program-window.mjs';
import { validateOperatorAttestation } from './operator-attestation.mjs';
import { qualifyPilot } from './report.mjs';
import { qualificationIdentity } from './qualification.mjs';
import { cashPlan,cloudflareCoverage } from './cash.mjs';
import { validateScientificAdmission } from './experiment.mjs';
import { verifyResult } from './result.mjs';
import { providerFailureDiagnostic } from './providers.mjs';
import {prepareManual,attachManual,checkManualLiability} from './manual-admission.mjs';
import {operatorAttemptBinding,manualStartupUntil} from './manual-authority.mjs';
import {spendBinding,reconcileActualSpend,knownManualCost} from './actual-spend.mjs';
import {providerRefusalBinding,resolveProviderRefusal} from './provider-refusal.mjs';
import {refusalFor,latchRefusalContradiction} from './refusal-state.mjs';
import {EXPLORATORY_PURPOSE} from './exploratory-policy.mjs';
import {sealExploratoryEndpoint,currentSealedEndpoint} from './exploratory-result.mjs';
import { POLICY, TERMINAL, assert, artifact, canonical, encode, safeName, sha256, validateManifest, reserveCents } from './policy.mjs';

const stopping = new Set(['stopping', 'cleanup-uncertain']);
export class Controller {
  constructor({ storage, bucket, providers, config, externalControl, now = Date.now, token }) {
    Object.assign(this, { storage, bucket, providers, config, externalControl, now, token });
  }
  async load() { return await this.storage.get('ledger') ?? { schema: 1, campaigns: {}, months: {} }; }
  async save(db) { await this.storage.put('ledger', db); }
  manualPrepare(id,intent){return prepareManual(this,id,intent);}
  manualAttach(id,body){return attachManual(this,id,body);}
  async programWindowBinding(){return programWindowBinding(await this.load());}
  amendProgramWindow(id,reference){return amendProgramWindow(this,id,reference);}
  async actualSpendBinding(){return spendBinding(await this.load());}
  reconcileActualSpend(id,reference){return reconcileActualSpend(this,id,reference);}
  providerRefusalBinding(id){return providerRefusalBinding(this,id);}
  resolveProviderRefusal(id,reference){return resolveProviderRefusal(this,id,reference);}
  sealExploratoryEndpoint(id,generation,body){return sealExploratoryEndpoint(this,id,generation,body);}
  async attemptBinding(id){const db=await this.load();return operatorAttemptBinding(this.campaign(db,id));}
  async manualReady(id,generation,claim){
    const db=await this.load(),c=this.campaign(db,id);
    assert(c.manual&&c.generation===generation,'manual bootstrap owner differs');
    let until=manualStartupUntil(c);
    if(c.manual.intent.startup){
      assert(claim&&Object.keys(claim).sort().join(',')==='intentSha256,podId,sessionId'&&typeof claim.podId==='string'&&typeof claim.intentSha256==='string'&&typeof claim.sessionId==='string'&&/^[A-Za-z0-9_-]+$/.test(claim.podId)&&/^[a-f0-9]{64}$/.test(claim.intentSha256)&&/^[a-f0-9]{32}$/.test(claim.sessionId)&&claim.intentSha256===c.manual.intentSha256,'typed startup claim differs');
      if(!['manual-pending','provisioning','running'].includes(c.status)||c.attempts.at(-1)?.workStartedAt)return {ready:false,until:Math.min(until,this.now())};
      if(!c.manual.attached)return {ready:false,until:c.manual.intent.expiresAt};
      const a=c.attempts.at(-1);
      assert(claim.podId===c.manual.attached.podId&&claim.podId===a.resourceId&&a.placement?.id===claim.podId,'startup Pod identity differs');
      if(this.now()>=until)return {ready:false,until};
      if(c.manual.startupSession)assert(c.manual.startupSession.sessionId===claim.sessionId,'startup session already bound');
      this.fence(c,generation,{allowStartupClaim:true});checkManualLiability(this,db,c);
      if(!c.manual.startupSession){c.manual.startupSession={...claim,generation,verifiedAt:this.now(),deadline:until};this.event(c,'manual-startup-confirmed',{deadline:until});await this.save(db);}
      return {ready:true,until};
    }
    assert(claim===undefined,'legacy startup does not accept a cold-start claim');
    let ready=false;
    if(c.manual.attached&&c.attempts.at(-1)?.placement&&this.now()<until){
      this.fence(c,generation);checkManualLiability(this,db,c);ready=true;
    }
    return {ready,until};
  }
  campaign(db, id) { assert(safeName(id) && db.campaigns[id], 'campaign not found'); return db.campaigns[id]; }
  workerSession(c,session){
    if(c.manual?.intent.startup)assert(typeof session==='string'&&session===c.manual.startupSession?.sessionId,'startup process differs');
  }
  event(c, type, detail = {}) {
    const last = c.events.at(-1);
    if (type === 'provider-unavailable' && last?.type === type) { last.count = (last.count ?? 1) + 1; last.lastAt = this.now(); last.diagnostic=detail.diagnostic; return; }
    c.events.push({ at: this.now(), type, ...detail });
  }
  status(c) {
    return { id: c.manifest.id, manifestSha256: c.manifestSha256, status: c.status, phase: c.manifest.phases[c.phase]?.id,
      phaseIndex: c.phase, generation: c.generation, estimatedCents: this.cost(c), capCents: c.manifest.maxCents,
      deadline: c.manifest.deadline, failure: c.failure, cleanupVerified: !!c.cleanupVerified,
      programAnchor:c.programAnchor??null, snapshot: c.snapshot ?? null, latestLog: c.latestLog ?? null, outputs: c.outputs, events: c.events, cleared: !!c.cleared,
      ...(c.manual?{manual:{intentSha256:c.manual.intentSha256,campaignDeadline:c.manual.campaignDeadline??null,acceptedAt:c.manual.attached?.acceptedAt??null,priorCampaignId:c.manual.intent.priorCampaignId}}:{}) };
  }
  cost(c) {
    if(c.manual?.actualSpendBasisSha256)return knownManualCost(c,this.now());
    return Math.ceil(c.attempts.reduce((sum, a) => sum + Math.max(0, (a.endedAt ?? this.now()) - a.startedAt) * a.hourlyCents / 3600000, 0));
  }
  async stage(manifest) {
    const m = validateManifest(manifest), hash = await sha256(encode(canonical(m))), db = await this.load();
    if (db.campaigns[m.id]) { assert(db.campaigns[m.id].manifestSha256 === hash, 'campaign identity already used'); return this.status(db.campaigns[m.id]); }
    assert(Object.keys(db.campaigns).length < 100, 'controller campaign inventory full');
    db.campaigns[m.id] = { manifest: m, manifestSha256: hash, status: 'staged', phase: 0, generation: 0,
      objects: {}, outputs: {}, attempts: [], events: [], cleanupVerified: true };
    await this.save(db); return this.status(db.campaigns[m.id]);
  }
  async start(id) {
    const db = await this.load(), c = this.campaign(db, id), now = this.now();
    if (c.status !== 'staged') return this.status(c);
    assert(c.manifest.purpose!==POLICY.publicTiming.purpose,'public timing requires explicit manual funding and qualification');
    assert(c.manifest.purpose!==EXPLORATORY_PURPOSE,'exploratory training requires the explicit new window');
    assert(!db.actualSpendBasis,'actual-spend mode requires explicit manual funding');
    if(db.manualProgram){assert(c.manifest.deadline<=db.manualProgram.deadline&&now<db.manualProgram.deadline,'overall actual program deadline exceeded');c.programAnchor=structuredClone(db.manualProgram);}
    assert(this.config.enabled === true && this.config.authorizedCents >= c.manifest.maxCents, 'paid compute is not activated or authorized');
    assert(c.manifest.deadline > now && c.manifest.deadline - now <= POLICY.campaignMs, 'pilot deadline must be within 24 hours');
    assert(!Object.values(db.campaigns).some(x => x !== c && !TERMINAL.has(x.status) && x.status !== 'staged'), 'another campaign owns compute');
    for (const input of c.manifest.inputs) assert(c.objects[input.sha256]?.bytes === input.bytes, 'input upload incomplete');
    if(c.manifest.purpose==='scientific-comparison')await validateScientificAdmission(c.manifest,{read:async input=>{
      const object=await this.bucket.get(`${id}/${input.sha256}`);assert(object,'scientific prerequisite missing');
      return object.arrayBuffer();
    }});
    for (const p of c.manifest.phases) assert(p.host.quoteObservedAt<=now && p.host.quoteExpires > now, 'host quote expired or unknown');
    assert(this.externalControl, 'external cleanup prearm unavailable');
    const authority=await this.externalControl(c.manifest).authorizeLaunch(c.manifest, { phaseIndex: 0, generation: 1 });
    cloudflareCoverage(c.manifest.cash,{now,deadline:c.manifest.deadline,forecastUntil:authority.forecastUntil});
    if(c.manifest.mode==='unattended'){
      const raw=await this.bucket.get(`${id}/${c.manifest.readinessSha256}`);assert(raw,'readiness evidence missing');
      const report=JSON.parse(new TextDecoder().decode(await raw.arrayBuffer()));
      assert((await qualifyPilot(report)).qualified,'supervised reliability qualification is incomplete');
      assert(c.manifest.phases.every(p=>p.device==='cuda' && canonical(qualificationIdentity(c.manifest,p.host,c.manifest.runtimeSha256))===canonical(qualificationIdentity(report,report.host,report.runtimeSha256))),'readiness source, runtime, backend or host differs');
    }
    const cash=cashPlan(c.manifest.cash,c.manifest.maxCents);
    const {computeUsageCapCents,cloudflareUsageCapCents,...funding}=c.manifest.cash;
    assert(!db.cashFunding || canonical(db.cashFunding)===canonical(funding),'pilot funding plan is frozen');
    assert((db.creditAllocatedCents??0)+c.manifest.maxCents<=cash.fundedCreditCents,'allocated credit exhausted');
    assert((db.cloudflareAllocatedCents??0)+cloudflareUsageCapCents<=cash.cloudflareReservedCents,'Cloudflare allocated funding exhausted');
    db.cashFunding=funding;db.cashCommittedCents=cash.cashCommittedCents;
    db.creditAllocatedCents=(db.creditAllocatedCents??0)+c.manifest.maxCents;
    db.cloudflareAllocatedCents=(db.cloudflareAllocatedCents??0)+cloudflareUsageCapCents;
    assert((db.pilotReservedCents ?? 0) + c.manifest.maxCents <= this.config.authorizedCents, 'pilot authorization exhausted');
    db.pilotReservedCents = (db.pilotReservedCents ?? 0) + c.manifest.maxCents;
    c.status = 'queued'; this.event(c, 'authorized', { reference: c.manifest.authorizationReference });
    await this.save(db); return this.status(c);
  }
  async putObject(id, descriptor, bytes, generation = null) {
    const a = artifact(descriptor), db = await this.load(), c = this.campaign(db, id);
    assert(!c.cleared && (!TERMINAL.has(c.status) || (generation === null && c.pendingObjects?.[a.sha256])), 'artifact writes closed');
    if (generation !== null) this.fence(c, generation);
    else assert(c.status === 'staged' || c.pendingObjects?.[a.sha256], 'input writes closed');
    assert(bytes.byteLength === a.bytes && await sha256(bytes) === a.sha256, 'artifact checksum mismatch');
    assert(Object.keys(c.objects).length < POLICY.maxArtifacts || c.objects[a.sha256], 'artifact inventory full');
    if (generation === null && !c.pendingObjects?.[a.sha256]) assert(c.manifest.inputs.some(x => x.sha256 === a.sha256 && x.bytes === a.bytes), 'unlisted input');
    // Identical committed bytes still pass every authorization and integrity
    // check, but need no pending/commit writes of the growing ledger.
    if (c.objects[a.sha256]?.bytes === a.bytes && !c.pendingObjects?.[a.sha256]) return a;
    const key = `${id}/${a.sha256}`;
    c.pendingObjects ??= {};
    c.pendingObjects[a.sha256] = { bytes: a.bytes }; await this.save(db);
    if (!c.objects[a.sha256]) await this.bucket.put(key, bytes, { sha256: a.sha256 });
    c.objects[a.sha256] = { bytes: a.bytes }; delete c.pendingObjects[a.sha256]; await this.save(db); return a;
  }
  fence(c, generation,{allowStartupClaim=false}={}) {
    const a = c.attempts.at(-1);
    assert(c.generation === generation && ['provisioning', 'running'].includes(c.status) && a &&
      this.now() < (a.leaseExpires ?? (c.manual?.intent.startup?manualStartupUntil(c):a.startedAt + POLICY.startupMs)) && this.now() < c.manifest.deadline &&
      (!c.phaseDeadline || this.now() < c.phaseDeadline), 'worker fenced');
    assert(!c.manual||c.manual.attached&&this.now()<c.manual.campaignDeadline,'manual worker fenced');
    assert(!c.manual||a.workStartedAt||this.now()<manualStartupUntil(c),'manual startup expired');
    assert(!c.manual?.intent.startup||allowStartupClaim||c.manual.startupSession?.podId===a.resourceId&&c.manual.startupSession.generation===generation,'confirmed startup session required');
    assert(!c.manual||this.config.enabled===true&&this.config.authorizedCents>=c.manual.requiredAuthorizationCents,'manual authorization revoked');
    assert(!a.cutoff || this.now() < a.cutoff, 'external funded cutoff reached');
  }
  durabilityAt(c, attempt) {
    return Math.max(attempt.workStartedAt, c.snapshot?.phaseIndex === c.phase ? c.snapshot.capturedAt : attempt.workStartedAt);
  }
  recoveryReady(c) {
    return c.manifest.phases[c.phase].kind !== 'training' || c.snapshot?.phaseIndex === c.phase;
  }
  async qualifyAttempt(db,c) {
    checkManualLiability(this,db,c);
    const a=c.attempts.at(-1),phase=c.manifest.phases[c.phase];
    if(!a.placement){
      const record=await this.providers.inspect(a.provider,a.resourceId);
      try{a.placement=this.providers.qualify(record,phase.host,a.name);await this.save(db);}
      catch(error){c.status='stopping';c.nextStatus='failed';c.failure='unapproved-placement';await this.save(db);throw error;}
    }
  }
  async work(id, generation) {
    const db = await this.load(), c = this.campaign(db, id); this.fence(c, generation);
    await this.qualifyAttempt(db,c);
    if(isCloudRepair(c.manifest)){
      const attempt=c.attempts.at(-1);
      assert(c.generation===1&&!attempt.recovery&&!c.snapshot&&!attempt.workGrantedAt,'new cloud episode permits no worker restart or same-allocation resume');
      attempt.workGrantedAt=this.now();this.event(c,'cloud-repair-work-granted');await this.save(db);
    }
    return { manifest: c.manifest, manifestSha256: c.manifestSha256, phaseIndex: c.phase, generation,
      phase: c.manifest.phases[c.phase], resume: c.attempts.at(-1)?.recovery === true, snapshot: c.snapshot ?? null, previousOutputs: c.outputs,sealedEndpoint:c.sealedEndpoint??null,knownObjects:Object.entries(c.objects).map(([sha256,record])=>({name:sha256,sha256,bytes:record.bytes})),
      leaseExpires: this.now() + POLICY.leaseMs,...(c.manifest.purpose===POLICY.publicTiming.purpose?{lifecycle:{acceptedAt:c.manual?.attached?.acceptedAt??null,startupVerifiedAt:c.manual?.startupSession?.verifiedAt??null,controllerWorkGrantedAt:this.now()}}:{}) };
  }
  async heartbeat(id, generation, proof = {}) {
    const db = await this.load(), c = this.campaign(db, id); this.fence(c, generation);
    assert(c.manifest.deadline > this.now(), 'campaign expired');
    const phase = c.manifest.phases[c.phase], a = c.attempts.at(-1);
    await this.qualifyAttempt(db,c);
    const reserve = Math.ceil(phase.host.hourlyCents * POLICY.startupMs / 3600000);
    assert(this.cost(c) + reserve < c.manifest.maxCents - reserveCents(c.manifest.maxCents), 'compute budget exhausted');
    assert(!c.phaseDeadline || this.now() < c.phaseDeadline, 'phase deadline exceeded');
    if (phase.kind === 'training' && a.workStartedAt&&!currentSealedEndpoint(c)) assert(this.now() - this.durabilityAt(c, a) < POLICY.checkpointMs, 'remote checkpoint overdue');
    if (a.recovery && !a.workStartedAt && c.snapshot) assert(proof.restoredSnapshotId === c.snapshot.id, 'restored bundle verification required');
    if (c.recovering) {
      assert(this.repairAvailable(c), 'repair allowance exhausted');
      c.repairSpentMs = (c.repairSpentMs ?? 0) + this.now() - c.repairStartedAt;
      c.repairSpentCents = (c.repairSpentCents ?? 0) + this.cost(c) - c.repairStartCents;
      delete c.repairStartedAt; delete c.repairStartCents; c.recovering = false;
      this.event(c, 'recovery-complete');
    }
    c.lastHeartbeat = this.now(); c.status = 'running';
    a.workStartedAt ??= this.now(); c.phaseDeadline ??= Math.min(this.now() + phase.seconds * 1000,c.manual?.campaignDeadline??Infinity);
    a.leaseExpires = Math.min(this.now() + POLICY.leaseMs, c.manifest.deadline, c.phaseDeadline, a.cutoff ?? Infinity); await this.save(db);
    return { leaseExpires: a.leaseExpires, phaseDeadline:c.phaseDeadline };
  }
  async claim(id, generation, body) {
    const db = await this.load(), c = this.campaign(db, id); this.fence(c, generation);
    assert(/^[a-f0-9]{64}$/.test(body?.key), 'invalid work claim');
    assert(body.allowCreate===undefined||typeof body.allowCreate==='boolean','invalid claim creation policy');
    c.claims ??= {};
    assert(Object.keys(c.claims).length < POLICY.maxArtifacts || c.claims[body.key], 'claim inventory full');
    if (c.claims[body.key]) return { created: false, record: c.claims[body.key] };
    if (body.allowCreate===false) return {created:false,unclaimed:true};
    c.claims[body.key] = { generation, at: this.now(), phaseIndex: c.phase };
    await this.save(db); return { created: true };
  }
  async counter(id, generation, body) {
    const db = await this.load(), c = this.campaign(db, id); this.fence(c, generation);
    assert(/^[a-f0-9]{64}$/.test(body?.key) && Number.isSafeInteger(body.minimum) && body.minimum >= 0, 'invalid work counter');
    c.counters ??= {};
    assert(Object.keys(c.counters).length < 100 || body.key in c.counters, 'counter inventory full');
    const value = Math.max(body.minimum, c.counters[body.key] ?? 0);
    c.counters[body.key] = value + 1; await this.save(db); return { value };
  }
  async settle(id, generation, body) {
    const db = await this.load(), c = this.campaign(db, id); this.fence(c, generation);
    const claim = c.claims?.[body?.key];
    assert(claim?.generation === generation, 'attempt settlement owner mismatch');
    const result = artifact(body.result);
    assert(c.objects[result.sha256]?.bytes === result.bytes, 'attempt evidence not uploaded');
    assert(!claim.result || claim.result.sha256 === result.sha256, 'attempt result already settled');
    claim.result = result; await this.save(db); return { settled: true };
  }
  async progress(id, generation, body) {
    const db = await this.load(), c = this.campaign(db, id); this.fence(c, generation);
    const log = artifact(body.log); assert(c.objects[log.sha256]?.bytes === log.bytes, 'progress log not uploaded');
    c.latestLog = { ...log, observedAt: this.now(), generation }; await this.save(db); return { accepted: true };
  }
  async snapshot(id, generation, snapshot) {
    const db = await this.load(), c = this.campaign(db, id); this.fence(c, generation);
    const requestSha256=await sha256(encode(canonical(snapshot)));
    if(c.snapshot?.id===snapshot?.id&&c.snapshot.generation===generation){
      assert(c.snapshot.requestSha256===requestSha256,'snapshot ID already bound to different bytes');return {accepted:true,replayed:true};
    }
    assert(!c.sealedEndpoint,'sealed exploratory endpoint cannot be replaced');
    assert(snapshot && safeName(snapshot.id) && Number.isSafeInteger(snapshot.capturedAt) && snapshot.capturedAt <= this.now() && this.now() - snapshot.capturedAt < POLICY.checkpointMs, 'invalid checkpoint time');
    assert(Array.isArray(snapshot.files) && snapshot.files.length && snapshot.files.length <= POLICY.maxArtifacts, 'checkpoint files required');
    const paths = new Set();
    for (const file of snapshot.files) {
      artifact(file); assert(safePath(file.path) && !paths.has(file.path), 'unsafe or duplicate recovery path'); paths.add(file.path);
      assert(c.objects[file.sha256]?.bytes === file.bytes, 'checkpoint upload incomplete');
    }
    assert(snapshot.files.some(f => f.path.endsWith('/latest.json')), 'recovery checkpoint pointer missing');
    const files = snapshot.files.map(file => {
      const prior = c.snapshot?.phaseIndex === c.phase && c.snapshot.files.find(f => f.path === file.path && f.sha256 === file.sha256 && f.bytes === file.bytes);
      return { ...file, originGeneration: prior ? (prior.originGeneration ?? c.snapshot.generation) : generation };
    });
    if(c.snapshot?.phaseIndex===c.phase && c.snapshot.files.find(f=>f.path.endsWith('/latest.json'))?.sha256 !== snapshot.files.find(f=>f.path.endsWith('/latest.json'))?.sha256)c.previousSnapshot=c.snapshot;
    c.snapshot = { ...snapshot, files, phaseIndex: c.phase, generation,requestSha256 }; this.event(c, 'checkpoint-published', { id: snapshot.id });
    await this.save(db); return { accepted: true };
  }
  async finish(id, generation, result) {
    const db = await this.load(), c = this.campaign(db, id); this.fence(c, generation);
    const phase = c.manifest.phases[c.phase];
    if (result?.files?.length) {
      for (const file of result.files) { artifact(file); assert(safePath(file.path) && c.objects[file.sha256]?.bytes === file.bytes, 'incomplete run file inventory'); }
      c.fileHistory ??= []; c.fileHistory.push({ phase: phase.id, generation, files: result.files }); c.files = result.files;
    }
    assert(['complete', 'infrastructure', 'correctness'].includes(result?.kind), 'invalid result');
    if (result.kind === 'complete') {
      if(c.manifest.exploratory)assert(c.sealedEndpoint?.generation===generation&&c.sealedEndpoint.phaseIndex===c.phase,'completed exploratory result requires its sealed endpoint');
      for (const name of phase.outputs) {
        const a = artifact(result.outputs?.[name]); assert(c.objects[a.sha256]?.bytes === a.bytes, 'required output not uploaded');
        const raw = new Uint8Array(await (await this.bucket.get(`${id}/${a.sha256}`)).arrayBuffer());
        await verifyResult(JSON.parse(new TextDecoder().decode(raw)), { manifest: c.manifest, manifestSha256: c.manifestSha256, phase, generation,phaseDeadline:c.phaseDeadline,snapshot: c.snapshot,sealedEndpoint:c.sealedEndpoint, expect: phase.expect[name], rawSha256: a.sha256, read: async record => {
          assert(result.files?.some(f => f.path === record.path && f.sha256 === record.sha256 && f.bytes === record.bytes), 'result missing from run inventory');
          return new Uint8Array(await (await this.bucket.get(`${id}/${record.sha256}`)).arrayBuffer());
        } });
        c.outputs[`${phase.id}/${name}`] = a;
      }
      assert(Array.isArray(result.files), 'completed run file inventory required');
      for (const file of result.files) { artifact(file); assert(safePath(file.path) && c.objects[file.sha256]?.bytes === file.bytes, 'incomplete run file inventory'); }
      c.nextStatus = c.phase + 1 === c.manifest.phases.length ? 'complete' : 'queued';
      this.event(c, 'phase-complete', { phase: phase.id });
    } else {
      c.failure = result.kind;
      if (result.kind === 'infrastructure') {
        if(!c.manual?.publicWork){c.repairStartedAt ??= this.now(); c.repairStartCents ??= this.cost(c);}
        // Never restart an attempted evaluation game. Its runner must consume
        // its durable claims; a missing durable claim set requires agent repair.
        c.nextStatus = !c.manual?.publicWork&&this.recoveryReady(c) ? 'repairing' : 'failed';
      } else c.nextStatus = 'failed';
      this.event(c, 'phase-failed', { kind: result.kind, phase: phase.id });
    }
    c.status = 'stopping'; await this.save(db); return this.status(c);
  }
  async cancel(id) {
    const db = await this.load(), c = this.campaign(db, id);
    if (TERMINAL.has(c.status)) return this.status(c);
    if (c.status === 'staged') { c.status = 'cancelled'; c.cleanupVerified = true; }
    else { c.status = 'stopping'; c.nextStatus = 'cancelled'; }
    this.event(c, 'cancel-requested'); await this.save(db); return this.status(c);
  }
  repairAvailable(c) {
    return (c.repairSpentMs ?? 0) + (c.repairStartedAt ? this.now() - c.repairStartedAt : 0) < POLICY.repairMs &&
      (c.repairSpentCents ?? 0) + (c.repairStartCents !== undefined ? this.cost(c) - c.repairStartCents : 0) < POLICY.repairCents;
  }
  async reconcile() {
    const db = await this.load();
    for (const c of Object.values(db.campaigns)) {
      if (c.status === 'staged') continue;
      try {
        if(TERMINAL.has(c.status)){
          if(!refusalFor(db,c))continue;
          const a=c.attempts.at(-1),matches=await this.providers.find(a.provider,a.name);
          if(!latchRefusalContradiction(this,db,c,{source:'resolved-owner-inventory',evidenceSha256:null,resourceIds:matches.map(r=>r.id)}))continue;
          // A resolved label cannot suppress fresh contradictory ownership.
          // Persist the hold before the normal stopping path may remove it.
          await this.save(db);
        }
        await this.step(db, c);
      }
      catch(error) { this.event(c, 'provider-unavailable',{diagnostic:providerFailureDiagnostic(error)}); await this.save(db); }
    }
  }
  async step(db, c) {
    const now = this.now(), phase = c.manifest.phases[c.phase], a = c.attempts.at(-1);
    if(c.manual){
      try{checkManualLiability(this,db,c);}catch{c.status='stopping';c.nextStatus='failed';c.failure='manual-liability-or-repair-exhausted';}
      if(c.status==='manual-pending'&&now<c.manual.intent.expiresAt&&now<a.cutoff)return;
      if(c.status==='manual-pending'){c.status='stopping';c.nextStatus='failed';c.failure='manual-admission-expired';}
      if(c.manual.campaignDeadline&&now>=c.manual.campaignDeadline){c.status='stopping';c.nextStatus='failed';c.failure='manual-program-deadline';}
    }
    if (now >= c.manifest.deadline || (a?.cutoff && now >= a.cutoff) || this.cost(c) >= c.manifest.maxCents - reserveCents(c.manifest.maxCents) || !this.config.enabled) {
      c.status = 'stopping'; c.nextStatus = 'failed'; c.failure = 'deadline-budget-or-disabled';
    }
    if (['provisioning', 'running'].includes(c.status)) {
      const limit = c.status === 'provisioning' ? POLICY.startupMs : POLICY.leaseMs;
      const expired = (c.manual?.intent.startup&&!a.workStartedAt?now>=manualStartupUntil(c):now - (c.lastHeartbeat ?? a.startedAt) >= limit) ||
        (a.workStartedAt && (now >= c.phaseDeadline || (phase.kind === 'training'&&!currentSealedEndpoint(c) && now - this.durabilityAt(c, a) >= POLICY.checkpointMs)));
      if (expired) {
        c.status = 'stopping'; c.failure = 'worker-or-checkpoint-timeout';
        if(!c.manual?.publicWork){c.repairStartedAt ??= now; c.repairStartCents ??= this.cost(c);}
        c.nextStatus = !c.manual?.publicWork&&this.recoveryReady(c) ? 'repairing' : 'failed';
        this.event(c, 'worker-expired');
      } else return;
    }
    if (stopping.has(c.status)) {
      // Persist the fence before touching a provider. No new host until deletion
      // has been verified by a complete inventory, including uncertain creates.
      await this.save(db);
      if (!a) { c.cleanupVerified = true; c.status = c.nextStatus ?? 'failed'; await this.save(db); return; }
      const matches = await this.providers.find(a.provider, a.name);
      if(matches.length&&refusalFor(db,c)){
        latchRefusalContradiction(this,db,c,{source:'owned-inventory',evidenceSha256:null,resourceIds:matches.map(r=>r.id)});await this.save(db);
      }else if (matches.length && a.uncertain) { a.uncertain = false; await this.save(db); }
      for (const resource of matches) await this.providers.remove(a.provider, resource.id, a.name);
      if (matches.length) { c.cleanupVerified = false; await this.save(db); return; }
      if (a.resourceId) {
        const remaining = await this.providers.inspect(a.provider, a.resourceId);
        if (remaining) {
          await this.providers.remove(a.provider, a.resourceId, a.name);
          c.cleanupVerified = false; await this.save(db); return;
        }
      }
      if (a.uncertain) { c.status = 'cleanup-uncertain'; c.failure = 'uncertain-create-requires-reconciliation'; await this.save(db); return; }
      a.endedAt ??= now; c.cleanupVerified = true;
      c.status = c.nextStatus ?? 'failed'; delete c.nextStatus;
      if (c.status === 'queued') { c.phase++; delete c.phaseDeadline; }
      this.event(c, 'cleanup-verified'); await this.save(db); return;
    }
    if (c.status === 'repairing') {
      if (!this.repairAvailable(c) || (c.replacementAttempts ?? 0) >= POLICY.maxReplacementAttempts) { c.status = 'failed'; c.failure = 'repair-allowance-exhausted'; await this.save(db); return; }
      c.status = 'queued'; c.recovering = true;
    }
    if (c.status !== 'queued') return;
    assert(!c.manual,'manual campaign cannot create a provider resource');
    if (!this.config.enabled || phase.host.quoteExpires <= now || (c.phaseDeadline && now >= c.phaseDeadline)) {
      c.status = 'failed'; c.failure = 'admission-quote-or-deadline'; await this.save(db); return;
    }
    const projected = Math.ceil(phase.host.hourlyCents * (phase.seconds * 1000 + POLICY.startupMs) / 3600000);
    if (this.cost(c) + projected > c.manifest.maxCents - reserveCents(c.manifest.maxCents)) {
      c.status = 'failed'; c.failure = 'insufficient-phase-budget'; await this.save(db); return;
    }
    if (c.recovering) assert(this.repairAvailable(c) && (c.replacementAttempts ?? 0) < POLICY.maxReplacementAttempts, 'repair allowance exhausted');
    assert(this.externalControl, 'external cleanup prearm unavailable');
    const authority = await this.externalControl(c.manifest).authorizeLaunch(c.manifest, { phaseIndex: c.phase, generation: c.generation + 1 });
    assert(typeof authority?.name === 'string' && Number.isSafeInteger(authority.cutoff) && now < authority.cutoff && this.now() < authority.cutoff, 'external cleanup fence or cutoff');
    if (c.recovering) c.replacementAttempts = (c.replacementAttempts ?? 0) + 1;
    c.generation++; c.lastHeartbeat = null; c.cleanupVerified = false; c.status = 'provisioning';
    const launch = { quote: structuredClone(phase.host), name: authority.name, prearmSha256: authority.prearmSha256, cutoff: authority.cutoff, provider: phase.host.provider, startedAt: now,
      hourlyCents: phase.host.hourlyCents, recovery: c.recovering === true, uncertain: true };
    c.attempts.push(launch); this.event(c, 'launch-requested', { generation: c.generation }); await this.save(db);
    let createStage='worker-token';
    try {
      const workerToken=await this.token(c.manifest.id,c.generation);
      createStage='provider-request';
      const resource = await this.providers.create(phase.host, launch.name, {
        COMPUTE_URL: this.config.url, COMPUTE_ID: c.manifest.id, COMPUTE_GENERATION: String(c.generation),
        COMPUTE_WORKER_TOKEN: workerToken,
      });
      createStage='response-identity';
      assert(resource?.id && resource.name === launch.name, 'provider create identity mismatch');
      createStage='launch-persistence';
      launch.resourceId = resource.id; launch.uncertain = false; await this.save(db);
    } catch (error) {
      launch.createFailure=createStage==='worker-token'
        ?{schema:1,provider:'runpod',operation:'create-pod',category:'worker-token',dispatch:'not-dispatched',httpStatus:null}
        :['response-identity','launch-persistence'].includes(createStage)
          ?{schema:1,provider:'runpod',operation:'create-pod',category:createStage,dispatch:'response-received',httpStatus:null}
          :providerFailureDiagnostic(error);
      this.event(c,'create-failed',{generation:c.generation,diagnostic:launch.createFailure});
      // Diagnostics do not settle a create, stop billing, authorize retry or
      // clear ownership. Even empty inventories still require reconciliation.
      c.status = 'stopping'; c.nextStatus = 'failed'; c.failure = 'uncertain-create'; await this.save(db);
    }
  }
  async reconcileUncertain(id) {
    const db = await this.load(), c = this.campaign(db, id), a = c.attempts.at(-1);
    if (a?.uncertain) {
      const matches = await this.providers.find(a.provider, a.name);
      if(matches.length&&refusalFor(db,c)){
        latchRefusalContradiction(this,db,c,{source:'uncertain-inventory',evidenceSha256:null,resourceIds:matches.map(r=>r.id)});await this.save(db);
      }else if (matches.length) { a.uncertain = false; await this.save(db); }
    }
  }
  async inventory(id) {
    const db = await this.load(), c = this.campaign(db, id);
    assert(TERMINAL.has(c.status) && c.cleanupVerified, 'collect only after verified compute cleanup');
    for (const [hash, a] of Object.entries(c.pendingObjects ?? {})) {
      const object = await this.bucket.get(`${id}/${hash}`);
      if (!object) {
        c.missingUploads ??= {};
        c.missingUploads[hash] = { bytes: a.bytes, status: 'incomplete-upload-after-worker-cleanup', observedAt: this.now() };
      }
      if (object) {
        const bytes = await object.arrayBuffer();
        assert(bytes.byteLength === a.bytes && await sha256(bytes) === hash, 'pending artifact changed');
        c.objects[hash] = a;
      }
      delete c.pendingObjects[hash];
    }
    // R2 is strongly consistent. Reconcile the whole private campaign prefix,
    // including any put that completed after its caller lost the response.
    let cursor;
    do {
      const page = await this.bucket.list({ prefix: `${id}/`, cursor });
      for (const entry of page.objects) {
        const hash = entry.key.slice(id.length + 1);
        assert(/^[a-f0-9]{64}$/.test(hash), 'unexpected campaign artifact key');
        if (!c.objects[hash]) {
          const object = await this.bucket.get(entry.key); assert(object, 'artifact inventory changed');
          const bytes = await object.arrayBuffer(); assert(await sha256(bytes) === hash, 'unregistered artifact checksum mismatch');
          c.objects[hash] = { bytes: bytes.byteLength }; delete c.missingUploads?.[hash];
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
      assert(!page.truncated || cursor, 'incomplete artifact inventory');
    } while (cursor);
    await this.save(db);
    return { id, manifestSha256: c.manifestSha256, manifest: c.manifest, status: this.status(c), claims: c.claims ?? {}, counters:c.counters??{}, recoveryPoints:[c.previousSnapshot,c.snapshot].filter(Boolean), attempts: c.attempts, files: c.files ?? [], fileHistory: c.fileHistory ?? [], missingUploads: c.missingUploads ?? {},
      objects: Object.entries(c.objects).map(([hash, value]) => ({ name: hash, sha256: hash, bytes: value.bytes })) };
  }
  async clear(id, receipt) {
    const prior = this.campaign(await this.load(), id);
    if (prior.cleared) { assert(canonical(prior.collection) === canonical(receipt), 'collection receipt differs'); return this.status(prior); }
    const inventory = await this.inventory(id), db = await this.load(), c = this.campaign(db, id);
    assert(receipt?.manifestSha256 === c.manifestSha256 && receipt.inventorySha256 === await sha256(encode(canonical(inventory))) && receipt.verified === true, 'verified collection receipt required');
    validateOperatorAttestation(receipt.backup, { campaign: id, manifestSha256: c.manifestSha256,
      inventorySha256: receipt.inventorySha256, recoveryPoints: inventory.recoveryPoints });
    // Keep the inventory and hashes until every deletion succeeds. Interrupted
    // clearing is repeatable and can never re-open artifact writes.
    for (const a of inventory.objects) await this.bucket.delete(`${id}/${a.sha256}`);
    c.cleared = true; c.status = 'cleared'; c.objects = {}; c.snapshot = null; c.latestLog = null;
    c.collection = receipt; this.event(c, 'artifacts-cleared'); await this.save(db);
    return this.status(c);
  }
}
export function safePath(path) {
  return typeof path === 'string' && path.startsWith('.ai-runs/') && path.split('/').every(p => /^[a-zA-Z0-9_.-]+$/.test(p) && p !== '.' && p !== '..');
}
