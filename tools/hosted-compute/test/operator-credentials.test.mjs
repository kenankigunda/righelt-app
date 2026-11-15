import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {operatorSecret,operatorVault} from '../operator-credentials.mjs';
import {main} from '../cli.mjs';

test('dedicated Keychain lookup never puts a value in arguments and erases captured stdout',async()=>{
 const original=Buffer.from('new-dedicated-secret\n');let observed;
 const value=await operatorSecret('backup-secret-access-key',{execute:async(...args)=>{observed=args;return {stdout:original};}});
 assert.equal(value.toString(),'new-dedicated-secret');assert(original.every(x=>x===0));assert(!JSON.stringify(observed.slice(0,2)).includes('new-dedicated-secret'));
 await assert.rejects(operatorSecret('github-token'),/unknown/);
 await assert.rejects(operatorSecret('backup-secret-access-key',{execute:async()=>{throw Error('sensitive output');}}),/dedicated.*unavailable/);
});
test('first secret is erased even if the second lookup fails',async()=>{
 const first=Buffer.from('access');await assert.rejects(operatorVault({}, {readSecret:async name=>{if(name==='backup-access-key-id')return first;throw Error('missing');}}),/missing/);assert(first.every(x=>x===0));
});
test('operator CLI keeps key alive across asynchronous restore and erases it on completion or failure',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'righelt-operator-cli-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const proof=path.join(root,'proof.json');await fs.writeFile(proof,'{}',{mode:0o600});
 for(const failed of [false,true]){
  const key=Buffer.from('test-private-key');let releaseOperation,started;
  const ready=new Promise(r=>{started=r;});const pending=new Promise(r=>{releaseOperation=r;});
  const operation=main(['restore','pilot','--root','root1','--download',path.join(root,'download'),'--out',path.join(root,'out'),'--lineage-version','v1','--recovery-evidence',proof],{}, {
   operatorVault:async()=>({}),operatorEncryption:async()=>({encryption:{key},release:()=>key.fill(0)}),
   restoreBackup:async(_v,_id,_d,_o,options)=>{started();await pending;assert.equal(options.lineageRecovery.encryption.key.toString(),'test-private-key');if(failed)throw Error('restore rejected');return {verified:true};}
  });await ready;assert.equal(key.toString(),'test-private-key');releaseOperation();if(failed)await assert.rejects(operation,/rejected/);else assert.deepEqual(await operation,{verified:true});assert(key.every(x=>x===0));
 }
 await fs.chmod(proof,0o644);await assert.rejects(main(['restore','pilot','--root','r','--download','d','--out','o','--lineage-version','v1','--recovery-evidence',proof],{}, {operatorVault:async()=>({}),operatorEncryption:async()=>({encryption:{},release:()=>{}})}),/private regular/);
});
