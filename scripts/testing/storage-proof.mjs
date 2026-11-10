import fs from 'node:fs/promises';import path from 'node:path';import{fileURLToPath}from'node:url';
import{sourceIdentity}from'./receipts.mjs';import{storageHash,validateStorageEvidence,validateStorageJobExecution}from'./storage-evidence.mjs';
export async function readStorageProof(root,project){
 const directory=path.join(root,'storage-lifecycle',project);
 return{proof:JSON.parse(await fs.readFile(path.join(directory,'proof.json'),'utf8')),xml:await fs.readFile(path.join(directory,'results.xml')),observations:await fs.readFile(path.join(directory,'observations.json'))};
}
export async function verifyStorageDirectory(root,identity,{runId,maximumAttempt,artifacts,lanes,jobMetadata}){
 if(!jobMetadata||jobMetadata.runId!==runId||jobMetadata.head!==identity.revision||jobMetadata.runAttempt!==maximumAttempt
  ||!Array.isArray(jobMetadata.jobs)||jobMetadata.total_count!==jobMetadata.jobs.length
  ||new Set(jobMetadata.jobs.map(j=>j.id)).size!==jobMetadata.jobs.length
  ||jobMetadata.jobs.some(j=>!Number.isSafeInteger(j.id)||j.id<1||j.run_id!==runId||j.head_sha!==identity.revision||!Number.isSafeInteger(j.run_attempt)||j.run_attempt<1||j.run_attempt>maximumAttempt))
  throw Error('Incomplete or foreign aggregate job metadata');
 const results=[];
 for(const project of['chromium','firefox','webkit']){
  const guest=lanes.filter(l=>l.suite==='e2e'),index=guest.findIndex(l=>l.project===project&&l.shard===1);
  if(index<0)throw Error('Storage lane missing');
  const selected=artifacts.filter(a=>new RegExp(`^suite-e2e-${index}-[1-9][0-9]*$`).test(a.name));
  if(selected.length!==1||selected[0].workflow_run?.id!==runId||selected[0].workflow_run?.head_sha!==identity.revision)throw Error('Storage artifact provenance missing');
  const exactAttempt=Number(selected[0].name.split('-').at(-1));
  const data=await readStorageProof(root,project),attempt=data.proof.attempt;
  if(attempt!==exactAttempt)throw Error('Storage proof differs from selected job attempt');
  if(!Number.isSafeInteger(attempt)||attempt<1||attempt>maximumAttempt)throw Error('Invalid storage job attempt');
  const evidence=validateStorageEvidence(data.proof,data.xml,data.observations,{runId,head:identity.revision,attempt,project,identity});
  results.push({...evidence,execution:validateStorageJobExecution(data.proof,jobMetadata.jobs)});
 }
 return results;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const project=process.env.PROJECT,directory=path.join('test-results','storage-lifecycle',project??'invalid');
 if(!['chromium','firefox','webkit'].includes(project))throw Error('Exact storage browser required');
 const xml=await fs.readFile(path.join(directory,'results.xml')),observations=await fs.readFile(path.join(directory,'observations.json')),source=sourceIdentity(process.cwd());
 const proof={version:1,runId:Number(process.env.GITHUB_RUN_ID),attempt:Number(process.env.GITHUB_RUN_ATTEMPT),head:process.env.RIGHELT_STORAGE_HEAD,job:process.env.GITHUB_JOB,sealedAt:new Date().toISOString(),project,shard:1,source,xmlSHA256:storageHash(xml),observationsSHA256:storageHash(observations)};
 if(!Number.isSafeInteger(proof.runId)||proof.runId<1||!Number.isSafeInteger(proof.attempt)||proof.attempt<1||proof.head!==source.revision||!source.sourceClean)throw Error('Storage CI/source identity missing');
 validateStorageEvidence(proof,xml,observations,{runId:proof.runId,head:source.revision,attempt:proof.attempt,project,identity:source});
 await fs.writeFile(path.join(directory,'proof.json'),JSON.stringify(proof,null,2)+'\n');
}
