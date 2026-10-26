import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {candidateCapabilities} from '../capabilities.mjs';
import {ACTION_CONTRACT_VERSION} from '../../../packages/shared-types/src/sync-protocol.ts';

test('result headings select an explicit source contract before execution and fail closed on unknown declarations',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'result-heading-capability-'));
 try{
  const directory=path.join(root,'apps/web/shell');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'game-result.js');
  assert.equal((await candidateCapabilities(root)).resultHeadingContract,'legacy');
  await writeFile(file,'// export const RESULT_HEADING_CONTRACT = "perspective-v1";\nconst title="You won";');
  assert.equal((await candidateCapabilities(root)).resultHeadingContract,'legacy');
  for(const inactive of ['/*\nexport const RESULT_HEADING_CONTRACT = "perspective-v1";\n*/','const example=`\nexport const RESULT_HEADING_CONTRACT = "perspective-v1";\n`;','function nested(){const RESULT_HEADING_CONTRACT="perspective-v1";}']){
   await writeFile(file,inactive);
   assert.equal((await candidateCapabilities(root)).resultHeadingContract,'legacy');
  }
  await writeFile(file,'export const RESULT_HEADING_CONTRACT = "perspective-v1";\nthrow Error("Never execute candidate source");');
  assert.equal((await candidateCapabilities(root)).resultHeadingContract,'perspective-v1');
  for(const declaration of ['"future-v2"','""','someFunction()']){
   await writeFile(file,`export const RESULT_HEADING_CONTRACT = ${declaration};`);
   await assert.rejects(()=>candidateCapabilities(root),/Unsupported result heading contract/);
  }
  for(const invalid of ['export let RESULT_HEADING_CONTRACT="perspective-v1";','export const RESULT_HEADING_CONTRACT="perspective-v1";\nexport const RESULT_HEADING_CONTRACT="perspective-v1";']){
   await writeFile(file,invalid);
   await assert.rejects(()=>candidateCapabilities(root),/Unsupported result heading contract/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('trained play is selected before execution by an explicit source contract',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'computer-capabilities-'));
 try {
  const directory=path.join(root,'apps/web/shell');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'computer-runtime.js');
  assert.equal((await candidateCapabilities(root)).trainedComputerPlay,false);
  await writeFile(file,'// export const TRAINED_COMPUTER_PLAY = "enabled";');
  assert.equal((await candidateCapabilities(root)).trainedComputerPlay,false);
  await mkdir(path.join(root,'packages/shared-types/src'),{recursive:true});
  await writeFile(path.join(root,'packages/shared-types/src/computer-play.ts'), `export const CURRENT_COMPUTER_MODEL=Object.freeze({id:'initial-1554',sha256:'${'a'.repeat(64)}',bytes:411327,checkpoint:'${'b'.repeat(64)}',url:'/computer/models/initial-1554.onnx',experimental:true});`);
  await writeFile(file,'export const TRAINED_COMPUTER_PLAY = "enabled";\nthrow Error("Never execute candidate source");');
  assert.equal((await candidateCapabilities(root)).trainedComputerPlay,true);
  await writeFile(file,'export const TRAINED_COMPUTER_PLAY = "disabled";');
  assert.equal((await candidateCapabilities(root)).trainedComputerPlay,false);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('account capabilities distinguish recovery, progressive, separate, minimal signup and play-gated forms without executing candidate code',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'account-capabilities-'));
 try {
  await mkdir(path.join(root,'apps/web/shell'),{recursive:true});
  await mkdir(path.join(root,'db/migrations'),{recursive:true});
  await writeFile(path.join(root,'apps/web/shell/account-controller.js'),'throw Error("candidate must not execute");');
  const old=await candidateCapabilities(root);
  assert.equal(old.accounts,true);assert.equal(old.accountAutosave,false);assert.equal(old.simplifiedAccounts,false);assert.equal(old.separateAccountForms,false);assert.equal(old.usernameOnlySignup,false);assert.equal(old.playAccountEntry,false);
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
  await writeFile(path.join(root,'apps/web/shell/account-autosave.js'),"throw Error('candidate must not execute');");
  const autosave=await candidateCapabilities(root);
  assert.equal(autosave.accountAutosave,true);assert.equal(autosave.playAccountEntry,true);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('Friend introduction is an explicit source capability, independent of computer stories',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'friend-capabilities-'));
 try{
  const directory=path.join(root,'apps/web/shell');await mkdir(directory,{recursive:true});
  assert.equal((await candidateCapabilities(root)).friendIntroduction,false);
  const file=path.join(directory,'opponent-stories.js');
  await writeFile(file,'export const OPPONENT_STORIES = {};\n// export const FRIEND_STORY = {};');
  assert.equal((await candidateCapabilities(root)).stories,true);
  assert.equal((await candidateCapabilities(root)).friendIntroduction,false);
  await writeFile(file,'export const FRIEND_STORY = {};\nthrow Error("Do not execute candidate code");');
  assert.equal((await candidateCapabilities(root)).friendIntroduction,true);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('always-visible Account header is an explicit independent capability',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'account-header-capability-'));
 try{
  const directory=path.join(root,'apps/web/shell');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'account-dialog.js');
  assert.equal((await candidateCapabilities(root)).alwaysVisibleAccount,false);
  await writeFile(file,'// export const ACCOUNT_HEADER_ENTRY = "always";');
  assert.equal((await candidateCapabilities(root)).alwaysVisibleAccount,false);
  await writeFile(file,'export const ACCOUNT_HEADER_ENTRY = "always";\nexport const ACCOUNT_ENTRY_POINTS = "play";\nthrow Error("Never execute candidate source");');
  const result=await candidateCapabilities(root);
  assert.equal(result.alwaysVisibleAccount,true);assert.equal(result.playAccountEntry,true);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('named heading and color-choice contracts are independent, source-only and fail closed',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'named-result-capability-'));
 try {
  const directory=path.join(root,'apps/web/shell');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'game-result.js');
  assert.equal((await candidateCapabilities(root)).rematchChoicesContract,'legacy');
  await writeFile(file,'export const RESULT_HEADING_CONTRACT="perspective-v2";\nexport const REMATCH_CHOICES_CONTRACT="colors-v1";\nthrow Error("Never execute candidate source");');
  const selected=await candidateCapabilities(root);
  assert.equal(selected.resultHeadingContract,'perspective-v2');assert.equal(selected.rematchChoicesContract,'colors-v1');
  await writeFile(file,'export const REMATCH_CHOICES_CONTRACT="colors-v1";');
  assert.equal((await candidateCapabilities(root)).resultHeadingContract,'legacy');
  for(const invalid of ['export const REMATCH_CHOICES_CONTRACT="future";','export let REMATCH_CHOICES_CONTRACT="colors-v1";','export const REMATCH_CHOICES_CONTRACT=choose();','export const REMATCH_CHOICES_CONTRACT="colors-v1";\nexport const REMATCH_CHOICES_CONTRACT="colors-v1";']) {
   await writeFile(file,invalid);await assert.rejects(()=>candidateCapabilities(root),/Unsupported rematch choices contract/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});


test('trained-enabled candidate requires an explicit valid authoritative model contract',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'required-model-capability-'));
 try {
  await mkdir(path.join(root,'apps/web/shell'),{recursive:true});
  await writeFile(path.join(root,'apps/web/shell/computer-runtime.js'),'export const TRAINED_COMPUTER_PLAY="enabled";');
  await assert.rejects(()=>candidateCapabilities(root),{code:'ENOENT'});
  const directory=path.join(root,'packages/shared-types/src');await mkdir(directory,{recursive:true});
  for(const source of ['', 'export const CURRENT_COMPUTER_MODEL=choose();', 'export const CURRENT_COMPUTER_MODEL=Object.freeze({id:"promoted"});']) {
   await writeFile(path.join(directory,'computer-play.ts'),source);
   await assert.rejects(()=>candidateCapabilities(root),/Unsupported current computer model contract/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});


test('history undo selects exactly the supported source row label without evaluating candidate code',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'history-label-capability-'));
 try{
  const directory=path.join(root,'apps/web/shell');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'app.js');
  assert.equal((await candidateCapabilities(root)).historyUndoLabel,null);
  for(const [label,icon]of [['Undo back to this move',''],['Undo before this move','${icon("back")}']]){
   const template='<button data-action="revert-to-move" data-game-id="${escapeHtml(game.id)}" data-move-id="${escapeHtml(move.moveId)}">'+icon+label+'</button>';
   await writeFile(file,'// `<button data-action="revert-to-move">Unknown</button>`\nconst revertButton=`'+template+'`; const inspector=`<button data-action="revert-to-move">Undo before this decision</button>`; throw Error("Never evaluate candidate source");');
   assert.equal((await candidateCapabilities(root)).historyUndoLabel,label);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

test('history undo source label rejects missing, ambiguous, unknown and dynamic templates',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'history-label-negative-'));
 try{
  const directory=path.join(root,'apps/web/shell');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'app.js'),row='<button data-action="revert-to-move">Undo before this move</button>';
  for(const source of [
   '// `'+row+'`',
   'const revertButton=`'+row+'`; function duplicateScope(){const revertButton=`'+row+'`;} ',
   'const revertButton=`<button data-action="revert-to-move">Undo something else</button>`;',
   'const revertButton=`<button data-action="revert-to-move">${label}</button>`;',
   'const revertButton=`<button data-action="revert-to-move">${icon("future")}Undo before this move</button>`;',
   'const revertButton=`<button data-action="revert-to-move">${arbitrary()}Undo before this move</button>`;',
  ]){
   await writeFile(file,source);
   await assert.rejects(()=>candidateCapabilities(root),/Unsupported history undo row label contract/);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});


test('actual tracked app history row selects a literal supported label without importing candidate code',async()=>{
 const root=path.resolve(import.meta.dirname,'../../..');
 const source=await readFile(path.join(root,'apps/web/shell/app.js'),'utf8');
 const selected=(await candidateCapabilities(root)).historyUndoLabel;
 assert.ok(['Undo back to this move','Undo before this move'].includes(selected));
 assert.ok(source.includes(selected+'</button>'),'Chosen row label is literally present in actual candidate source');
});

test('candidate action version is selected from a supported literal without evaluating source',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'righelt-action-contract-'));
 try{
  assert.equal((await candidateCapabilities(root)).actionContractVersion,null);
  const dir=path.join(root,'packages/shared-types/src');await mkdir(dir,{recursive:true});
  const file=path.join(dir,'sync-protocol.ts');
  for(const version of [2,3])for(const assertion of ['', ' as const']){await writeFile(file,`export const ACTION_CONTRACT_VERSION = ${version}${assertion};`);assert.equal((await candidateCapabilities(root)).actionContractVersion,version);}
  const tracked=await readFile(new URL('../../../packages/shared-types/src/sync-protocol.ts',import.meta.url),'utf8');
  await writeFile(file,tracked);assert.equal((await candidateCapabilities(root)).actionContractVersion,ACTION_CONTRACT_VERSION);
  for(const invalid of [
   'export let ACTION_CONTRACT_VERSION=3;',
   'export const ACTION_CONTRACT_VERSION=999;',
   'export const ACTION_CONTRACT_VERSION="3";',
   'export const ACTION_CONTRACT_VERSION=1+2;',
   'export const ACTION_CONTRACT_VERSION=3 as number;',
   'export const ACTION_CONTRACT_VERSION=(1+2) as const;',
   'export const ACTION_CONTRACT_VERSION=3; export const ACTION_CONTRACT_VERSION=2;',
   'export const ACTION_CONTRACT_VERSION=(()=>{throw Error("must not execute")})();',
  ]){await writeFile(file,invalid);await assert.rejects(()=>candidateCapabilities(root),/Unsupported action version contract/);}
  await writeFile(file,'// export const ACTION_CONTRACT_VERSION=999;');assert.equal((await candidateCapabilities(root)).actionContractVersion,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
