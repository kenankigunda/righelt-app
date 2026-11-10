import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {readJSON,saveJSON} from './io.mjs';

const canonical=value=>{
 if(value===null || typeof value==='string' || typeof value==='boolean')return value;
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(Array.isArray(value))return value.map(canonical);
 if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 throw Error('Provenance must contain only explicit JSON values');
};
export const evidenceKey=provenance=>{
 if(!provenance||Array.isArray(provenance)||!Object.keys(provenance).length)throw Error('Explicit provenance is required');
 return createHash('sha256').update(JSON.stringify(canonical(provenance))).digest('hex');
};
export async function fileDigest(file){
 const info=await lstat(file);
 if(!info.isFile()||info.isSymbolicLink()||await realpath(file)!==path.resolve(file))throw Error('Evidence must be a regular file without symlinks');
 const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');
}
export async function saveSuccessfulEvidence(file,{provenance,result,artifacts=[],expiresAt,immutable=false}){
 if(result?.status!=='passed')throw Error('Only explicit successful evidence can be cached');
 if(!immutable&&(!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now()))throw Error('A future evidence expiry is required');
 if(immutable&&(result.code!==0||result.incomplete||result.signal||result.items?.length))throw Error('Immutable reuse requires a completed stateless check');
 const hashes=[];for(const artifact of artifacts){const absolute=path.resolve(artifact);hashes.push({path:absolute,sha256:await fileDigest(absolute)});}
 const receipt={version:immutable?2:1,key:evidenceKey(provenance),provenance,result,artifacts:hashes,...(immutable?{validity:'inputs-and-artifacts'}:{expiresAt})};
 receipt.integrity=evidenceKey(receipt);await saveJSON(file,receipt);return receipt;
}
export async function loadSuccessfulEvidence(file,provenance,{now=Date.now()}={}){
 return (await inspectSuccessfulEvidence(file,provenance,{now})).result??null;
}
export async function inspectSuccessfulEvidence(file,provenance,{now=Date.now()}={}){
 try{
  if(!Number.isFinite(now))return {reason:'invalid-clock'};
  const receipt=await readJSON(file);const {integrity,...body}=receipt;
  if(![1,2].includes(receipt.version)||integrity!==evidenceKey(body)||receipt.result?.status!=='passed'||!Array.isArray(receipt.artifacts))return {reason:'invalid-receipt'};
  if(receipt.key!==evidenceKey(provenance))return {reason:'incompatible-inputs'};
  if(receipt.version===1&&(!Number.isFinite(Date.parse(receipt.expiresAt))||Date.parse(receipt.expiresAt)<=now))return {reason:'expired-legacy-evidence'};
  if(receipt.version===2&&(receipt.validity!=='inputs-and-artifacts'||receipt.result.code!==0||receipt.result.incomplete||receipt.result.signal||receipt.result.items?.length))return {reason:'incomplete-or-stateful-evidence'};
  for(const artifact of receipt.artifacts)if(await fileDigest(artifact.path)!==artifact.sha256)return {reason:'artifact-integrity'};
  return {reason:'compatible-inputs-and-verified-artifacts',result:receipt.result};
 }catch(error){return {reason:error.code==='ENOENT'?'missing-evidence':'unreadable-evidence'};}
}
export function installSignature({lockHash,packageHash,nodeVersion,pnpmVersion,platform,arch}){
 const values={lockHash,packageHash,nodeVersion,pnpmVersion,platform,arch};
 if(Object.values(values).some(value=>typeof value!=='string'||!value))throw Error('Complete dependency and runtime identity is required');
 return evidenceKey(values);
}
