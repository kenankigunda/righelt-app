// Dedicated operator credentials only. Never extract the GitHub CLI's own
// credential, inherit it into a subprocess, or print secret values.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {operatorVaultFromCredentials} from './operator-backup.mjs';
import {AgeEncryption} from './lineage-backup.mjs';
import {assert} from './policy.mjs';
const exec=promisify(execFile);
export async function operatorSecret(name,{execute=exec}={}) {
  assert(['admin-token','backup-access-key-id','backup-secret-access-key','lineage-age-identity'].includes(name),'unknown dedicated operator credential');
  let output;
  try {output=await execute('security',['find-generic-password','-w','-s',`com.righelt.hosted-compute.${name}`,'-a','operator'],{encoding:'buffer',maxBuffer:65536,env:{PATH:process.env.PATH},timeout:10000});}
  catch {throw Error(`dedicated ${name} credential unavailable`);}
  const value=Buffer.from(output.stdout);if(Buffer.isBuffer(output.stdout))output.stdout.fill(0);assert(value.length>0&&value.length<65536,'invalid dedicated operator credential');
  return value.at(-1)===10?value.subarray(0,-1):value;
}
export async function operatorVault(env=process.env,{readSecret=operatorSecret,...options}={}) {
  const access=await readSecret('backup-access-key-id');let secret;
  try {secret=await readSecret('backup-secret-access-key');return operatorVaultFromCredentials({endpoint:env.COMPUTE_BACKUP_ENDPOINT,bucket:env.COMPUTE_BACKUP_BUCKET,accessKeyId:access.toString(),secretAccessKey:secret.toString()},options);}
  finally {access.fill(0);secret?.fill(0);}
}
export async function operatorEncryption(env=process.env,{readSecret=operatorSecret}={}) {
  assert(typeof env.COMPUTE_LINEAGE_RECIPIENT==='string','public lineage recipient configuration required');
  const identity=await readSecret('lineage-age-identity');
  return {encryption:new AgeEncryption({binary:env.COMPUTE_AGE_BINARY??'age',recipient:env.COMPUTE_LINEAGE_RECIPIENT,identityBytes:identity}),release:()=>identity.fill(0)};
}
