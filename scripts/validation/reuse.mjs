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
export async function saveSuccessfulEvidence(file,{provenance,result,artifacts=[],expiresAt}){
 if(result?.status!=='passed')throw Error('Only explicit successful evidence can be cached');
 if(!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now())throw Error('A future evidence expiry is required');
 const hashes=[];for(const artifact of artifacts){const absolute=path.resolve(artifact);hashes.push({path:absolute,sha256:await fileDigest(absolute)});}
 const receipt={version:1,key:evidenceKey(provenance),provenance,result,artifacts:hashes,expiresAt};
 receipt.integrity=evidenceKey(receipt);await saveJSON(file,receipt);return receipt;
}
export async function loadSuccessfulEvidence(file,provenance,{now=Date.now()}={}){
 try{
  if(!Number.isFinite(now))return null;
  const receipt=await readJSON(file);const {integrity,...body}=receipt;
  if(receipt.version!==1||receipt.key!==evidenceKey(provenance)||integrity!==evidenceKey(body)||receipt.result?.status!=='passed'||!Number.isFinite(Date.parse(receipt.expiresAt))||Date.parse(receipt.expiresAt)<=now||!Array.isArray(receipt.artifacts))return null;
  for(const artifact of receipt.artifacts)if(await fileDigest(artifact.path)!==artifact.sha256)return null;
  return receipt.result;
 }catch{return null;}
}
export function installSignature({lockHash,packageHash,nodeVersion,pnpmVersion,platform,arch}){
 const values={lockHash,packageHash,nodeVersion,pnpmVersion,platform,arch};
 if(Object.values(values).some(value=>typeof value!=='string'||!value))throw Error('Complete dependency and runtime identity is required');
 return evidenceKey(values);
}
