import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
import {sourceFile,stringContract,currentModelContract,historyUndoLabelContract,actionVersionContract} from './source-contract.mjs';
// Source capabilities select explicit contracts before tests run. A failed
// assertion never changes contracts or downgrades account proof to guest proof.
export async function candidateCapabilities(root) {
  const has = async file => { try { await access(path.join(root,file)); return true; } catch(e) { if(e.code==='ENOENT') return false; throw e; } };
  let alwaysVisibleAccount=false, separateAccountForms=false, usernameOnlySignup=false, playAccountEntry=false, friendIntroduction=false;
  let trainedComputerPlay=false;
  let resultHeadingContract='legacy', rematchChoicesContract='legacy';
  try {
    const result=await readFile(path.join(root,'apps/web/shell/game-result.js'),'utf8');
    const source=sourceFile('game-result.js',result);
    const selectContract=(name,allowed,label)=>stringContract(source,name,allowed,label);
    resultHeadingContract=selectContract('RESULT_HEADING_CONTRACT',['perspective-v1','perspective-v2'],'result heading');
    rematchChoicesContract=selectContract('REMATCH_CHOICES_CONTRACT',['colors-v1'],'rematch choices');
  } catch(error) { if(error.code!=='ENOENT') throw error; }
  try {
    const runtime=await readFile(path.join(root,'apps/web/shell/computer-runtime.js'),'utf8');
    trainedComputerPlay=/^export const TRAINED_COMPUTER_PLAY\s*=\s*['"]enabled['"];?$/m.test(runtime);
  } catch(error) { if(error.code!=='ENOENT') throw error; }
  try {
    const stories=await readFile(path.join(root,'apps/web/shell/opponent-stories.js'),'utf8');
    friendIntroduction=/^export const FRIEND_STORY\s*=/m.test(stories);
  } catch(error) { if(error.code!=='ENOENT') throw error; }
  try {
    const dialog=await readFile(path.join(root,'apps/web/shell/account-dialog.js'),'utf8');
    alwaysVisibleAccount=/^export const ACCOUNT_HEADER_ENTRY\s*=\s*['"]always['"];?$/m.test(dialog);
    playAccountEntry=/^export const ACCOUNT_ENTRY_POINTS\s*=\s*['"]play['"];?$/m.test(dialog);
    usernameOnlySignup=/^export const ACCOUNT_SIGNUP_PROFILE\s*=\s*['"]username-only['"];?$/m.test(dialog);
    separateAccountForms=/^export const ACCOUNT_ENTRY_LAYOUT\s*=\s*['"]separate['"];?$/m.test(dialog);
  } catch(error) { if(error.code!=='ENOENT') throw error; }
  let actionContractVersion=null;
  try { actionContractVersion=actionVersionContract(await readFile(path.join(root,'packages/shared-types/src/sync-protocol.ts'),'utf8')); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  let historyUndoLabel=null;
  try { historyUndoLabel=historyUndoLabelContract(await readFile(path.join(root,'apps/web/shell/app.js'),'utf8')); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  let currentComputerModel=null;
  if(trainedComputerPlay) currentComputerModel=currentModelContract(await readFile(path.join(root,'packages/shared-types/src/computer-play.ts'),'utf8'));
  return {
    currentComputerModel,
    actionContractVersion,
    historyUndoLabel,
    resultHeadingContract,
    rematchChoicesContract,
    trainedComputerPlay,
    alwaysVisibleAccount,
    friendIntroduction,
    separateAccountForms,
    usernameOnlySignup,
    playAccountEntry,
    simplifiedAccounts: await has('db/migrations/0015_remove_account_recovery.sql'),
    accounts: await has('apps/web/shell/account-controller.js'),
    accountAutosave: await has('apps/web/shell/account-autosave.js'),
    profiles: await has('apps/web/shell/public-profile.js'),
    personalHome: await has('apps/web/shell/personal-home.js'),
    stories: await has('apps/web/shell/opponent-stories.js'),
    results: await has('apps/web/shell/game-result.js'),
    movePreview: await has('apps/web/board/action-preview.js'),
    cutover: await has('db/migrations/0013_account_cutover.sql'),
    introductions: await has('db/migrations/0014_opponent_introductions.sql'),
  };
}
