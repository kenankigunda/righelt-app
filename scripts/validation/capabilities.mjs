import {access,readFile} from 'node:fs/promises';
import path from 'node:path';
// Source capabilities select explicit contracts before tests run. A failed
// assertion never changes contracts or downgrades account proof to guest proof.
export async function candidateCapabilities(root) {
  const has = async file => { try { await access(path.join(root,file)); return true; } catch(e) { if(e.code==='ENOENT') return false; throw e; } };
  let alwaysVisibleAccount=false, separateAccountForms=false, usernameOnlySignup=false, playAccountEntry=false, friendIntroduction=false;
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
  return {
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
