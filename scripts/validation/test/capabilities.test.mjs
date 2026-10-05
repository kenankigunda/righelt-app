import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {candidateCapabilities} from '../capabilities.mjs';

test('account capabilities distinguish recovery, progressive, separate, minimal signup and play-gated forms without executing candidate code',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'account-capabilities-'));
 try {
  await mkdir(path.join(root,'apps/web/shell'),{recursive:true});
  await mkdir(path.join(root,'db/migrations'),{recursive:true});
  await writeFile(path.join(root,'apps/web/shell/account-controller.js'),'throw Error("candidate must not execute");');
  const old=await candidateCapabilities(root);
  assert.equal(old.accounts,true);assert.equal(old.simplifiedAccounts,false);assert.equal(old.separateAccountForms,false);assert.equal(old.usernameOnlySignup,false);assert.equal(old.playAccountEntry,false);
  await writeFile(path.join(root,'db/migrations/0015_remove_account_recovery.sql'),'-- synthetic capability fixture');
  await writeFile(path.join(root,'apps/web/shell/account-dialog.js'),'// ACCOUNT_ENTRY_LAYOUT = "separate"\nexport const createAccountDialog=()=>{};');
  const progressive=await candidateCapabilities(root);
  assert.equal(progressive.simplifiedAccounts,true);assert.equal(progressive.separateAccountForms,false);assert.equal(progressive.usernameOnlySignup,false);
  await writeFile(path.join(root,'apps/web/shell/account-dialog.js'),`export const ACCOUNT_ENTRY_LAYOUT = 'separate';\nthrow Error('candidate must not execute');`);
  const separate=await candidateCapabilities(root);
  assert.equal(separate.simplifiedAccounts,true);assert.equal(separate.separateAccountForms,true);assert.equal(separate.usernameOnlySignup,false);
  await writeFile(path.join(root,'apps/web/shell/account-dialog.js'),`export const ACCOUNT_ENTRY_LAYOUT = 'separate';\n// export const ACCOUNT_SIGNUP_PROFILE = "username-only";`);
  assert.equal((await candidateCapabilities(root)).usernameOnlySignup,false);
  await writeFile(path.join(root,'apps/web/shell/account-dialog.js'),`export const ACCOUNT_ENTRY_LAYOUT = 'separate';\nexport const ACCOUNT_SIGNUP_PROFILE = "username-only";\nthrow Error('candidate must not execute');`);
  const minimal=await candidateCapabilities(root);
  assert.equal(minimal.simplifiedAccounts,true);assert.equal(minimal.separateAccountForms,true);assert.equal(minimal.usernameOnlySignup,true);assert.equal(minimal.playAccountEntry,false);
  await writeFile(path.join(root,'apps/web/shell/account-dialog.js'),`// export const ACCOUNT_ENTRY_POINTS = "play";`);
  assert.equal((await candidateCapabilities(root)).playAccountEntry,false);
  await writeFile(path.join(root,'apps/web/shell/account-dialog.js'),`export const ACCOUNT_ENTRY_LAYOUT = 'separate';\nexport const ACCOUNT_SIGNUP_PROFILE = "username-only";\nexport const ACCOUNT_ENTRY_POINTS = "play";\nthrow Error('candidate must not execute');`);
  const play=await candidateCapabilities(root);
  assert.equal(play.simplifiedAccounts,true);assert.equal(play.separateAccountForms,true);assert.equal(play.usernameOnlySignup,true);assert.equal(play.playAccountEntry,true);
 } finally {await rm(root,{recursive:true,force:true});}
});
