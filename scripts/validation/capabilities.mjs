import {access} from 'node:fs/promises';
import path from 'node:path';
// Source capabilities select explicit contracts before tests run. A failed
// assertion never changes contracts or downgrades account proof to guest proof.
export async function candidateCapabilities(root) {
  const has = async file => { try { await access(path.join(root,file)); return true; } catch(e) { if(e.code==='ENOENT') return false; throw e; } };
  return {
    simplifiedAccounts: await has('db/migrations/0015_remove_account_recovery.sql'),
    accounts: await has('apps/web/shell/account-controller.js'),
    profiles: await has('apps/web/shell/public-profile.js'),
    personalHome: await has('apps/web/shell/personal-home.js'),
    stories: await has('apps/web/shell/opponent-stories.js'),
    results: await has('apps/web/shell/game-result.js'),
    movePreview: await has('apps/web/board/action-preview.js'),
    cutover: await has('db/migrations/0013_account_cutover.sql'),
    introductions: await has('db/migrations/0014_opponent_introductions.sql'),
  };
}
