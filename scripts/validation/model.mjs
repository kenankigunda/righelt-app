import crypto from 'node:crypto';
export const VERSION = 1;
export const viewports = [
  {name:'mobile', width:390, height:844, isMobile:true, hasTouch:true},
  {name:'mid-wide', width:1366, height:900},
  {name:'full-wide', width:1920, height:1080},
];
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function parseCommands(text) {
  const commands = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(>|On .+wrote:|From:|Sent:|--\s*$|-{2,}\s*(Original|Forwarded))/i.test(line)) break;
    if (!line) continue;
    const m = /^(merge|cancel\s+merge)\s+((?:#?[1-9]\d*)(?:\s+#?[1-9]\d*)*)$/i.exec(line);
    if (m) commands.push({action:/^cancel/i.test(m[1])?'cancel':'merge', prs:[...new Set(m[2].split(/\s+/).map(n=>Number(n.replace('#',''))))]});
    else if (/^(merge|cancel\s+merge)\b/i.test(line)) throw new Error(`Ambiguous command: ${line}`);
  }
  return commands;
}
// Accept provenance supplied by the authenticated connector, never a message-body claim.
// In v1 the monitored mailbox must be the approving account; SENT proves account origin.
export function applyReply(run, message, recipient, mailbox) {
  if (run.processedMessages?.includes(message.id)) return false;
  if (!message.id || !run.emailThreads?.includes(message.threadId) || mailbox.toLowerCase() !== recipient.toLowerCase() || message.from?.toLowerCase() !== recipient.toLowerCase() || !message.labels?.includes('SENT') || !Number.isFinite(Date.parse(message.internalDate)) || Date.parse(message.internalDate) < Date.parse(run.startedAt)) throw new Error('Reply provenance or conversation is not verified');
  const commands = parseCommands(message.text);
  for (const command of commands) for (const number of command.prs) {
    const pr = run.prs.find(p=>p.number===number);
    if (!pr || pr.merged || pr.closed) throw new Error(`PR ${number} is not an active member of this run`);
  }
  for (const command of commands) for (const number of command.prs) {
    const pr = run.prs.find(p=>p.number===number);
    if (pr.authorization?.at && (Date.parse(message.internalDate) < Date.parse(pr.authorization.at) || (Date.parse(message.internalDate) === Date.parse(pr.authorization.at) && command.action !== 'cancel'))) continue;
    pr.authorization = {state:command.action==='merge'?'authorized':'cancelled', messageId:message.id, target:pr.base, at:message.internalDate};
  }
  (run.processedMessages ??= []).push(message.id);
  return commands.length > 0;
}
export function readiness(pr, stage, currentBase) {
  const waiting=[];
  if(pr.nativeStack)waiting.push('Native GitHub stacks are unsupported; individual authorization cannot include predecessors');
  if (!stage || stage.head !== pr.head || stage.base !== currentBase || stage.status !== 'passed') waiting.push('Current integrated validation');
  if (stage?.unmapped?.length) waiting.push('Coverage gaps');
  if (stage?.sourceClean !== true) waiting.push('Clean reproducible source tree');
  if (!stage?.visualReviewed) waiting.push('Agent screenshot inspection');
  if (pr.independentReview?.status !== 'passed' || pr.independentReview?.head !== pr.head) waiting.push('Independent review of current head');
  if (pr.gatesHead !== pr.head || pr.gatesBase !== currentBase) waiting.push('Fresh PR gate provenance');
  if (pr.checks !== 'passed') waiting.push('Required CI checks');
  if (pr.review !== 'passed') waiting.push('Required reviews');
  if ((pr.preview === 'passed' && (pr.previewHead !== pr.head || !pr.previewUrl)) || (pr.preview === 'not-configured' && pr.previewCheckedHead !== pr.head)) waiting.push('Current preview provenance');
  if (pr.preview !== 'passed' && pr.preview !== 'not-configured') waiting.push('Current preview verification');
  if (pr.conflicts !== false) waiting.push('Mergeability confirmation');
  if (pr.open !== true || pr.draft) waiting.push('Open, non-draft PR');
  if (pr.scopeDecision) waiting.push('Product or structural decision');
  const deps=pr.waitingFor ?? [];
  if (deps.length) waiting.push(`Prerequisites: ${deps.join(', ')}`);
  const unverified=!stage||stage.head!==pr.head||stage.base!==currentBase||['stale','running','unverified'].includes(stage.status);
  return {status:unverified?'unverified/stale':waiting.length?(waiting.length===1&&deps.length?'validated but waiting on prerequisites':'not merge-ready'):'merge-ready', waiting};
}
export function canMerge(pr, stage, base) {
  return pr.authorization?.state==='authorized' && pr.authorization.target===pr.base && readiness(pr,stage,base).status==='merge-ready';
}
export function invalidate(run, base, heads) {
  const changed = run.base !== base ? 0 : run.prs.findIndex((p,i)=>p.head !== heads[i])+1;
  if (changed===0 && run.base===base) return [];
  const stale=[];
  for (const s of run.stages) if (s.index>=changed) { s.status='stale'; s.visualReviewed=false; stale.push(s.id); }
  return stale;
}
export const coreFiles=['e2e/smoke/live-smoke.spec.mjs','e2e/workflows/reload-persistence.spec.mjs','e2e/workflows/reconnect-recovery.spec.mjs','e2e/workflows/approval-and-history.spec.mjs'];
export function coverage(files) {
  const areas = new Set(['core']); const unmapped=[];
  for(const file of files) {
    if (/^(apps\/|packages\/|db\/|e2e\/)/.test(file)) areas.add('app');
    else if (/^tools\/ai-trainer\//.test(file)) { areas.add('tooling'); areas.add('ai-trainer'); }
    else if (/^tools\/ai-benchmark\//.test(file)) { areas.add('tooling'); areas.add('ai-benchmark'); }
    else if (/^tools\/t108-feasibility\//.test(file)) areas.add('tooling');
    else if (/^(\.npmrc|validation-e2e\/|scripts\/|skills\/|\.agents\/|docs\/|\.github\/|AGENTS\.md|README\.md|package\.json|pnpm-|playwright|tsconfig|\.gitignore)/.test(file)) areas.add('tooling');
    else unmapped.push(file);
  }
  return {areas:[...areas],unmapped,files:areas.has('app')?[]:coreFiles};
}
export function publicRun(run) {
  // Explicit allowlist: logs, connector envelopes, notes and recipient are never published.
  return {version:VERSION,id:run.id,startedAt:run.startedAt,base:run.base,revision:run.revision,fingerprint:run.fingerprint,harnessRevision:run.harnessRevision,harnessFingerprint:run.harnessFingerprint,
    risks:run.risks??[], findings:run.findings??[], prs:(run.prs??[]).map((p,index)=>{const stage=run.mode==='local'?run.stages?.[0]:run.stages?.find(s=>s.index===index+1);const current=readiness(p,stage,run.base);return {number:p.number,title:p.title,url:p.url,head:p.head,readiness:p.merged?'merged':current.status,waiting:p.merged?[]:current.waiting,authorization:p.authorization?.state};}),
    stages:(run.stages??[]).map(s=>({id:s.id,index:s.index,title:s.title,status:s.status,head:s.head,base:s.base,fingerprint:s.fingerprint,harnessRevision:s.harnessRevision,harnessFingerprint:s.harnessFingerprint,visualReviewed:s.visualReviewed,unmapped:s.unmapped??[],checks:(s.checks??[]).map(c=>({name:c.name,status:c.status,duration:c.duration})),items:s.items??[]}))};
}
