import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {candidateCapabilities} from '../scripts/validation/capabilities.mjs';
import {proof} from '../scripts/validation/proof.mjs';
import {historySnapshot,assertHistoryPreserved} from '../scripts/validation/history-continuity.mjs';
import {proveLegacyMutationDenied} from '../scripts/validation/legacy-account-proof.mjs';
import {proveResultsRematch} from '../scripts/validation/results-proof.mjs';
import {FRESH_ACCOUNT_WORKFLOW,RETAINED_ACCOUNT_WORKFLOW} from '../scripts/validation/account-evidence.mjs';

const root=process.env.RIGHELT_VALIDATION_TARGET_ROOT||process.cwd();
const capabilities=await candidateCapabilities(root);
if(!capabilities.accounts)throw Error('Account proof requires the candidate account UI and real credential services');
if(capabilities.separateAccountForms&&!capabilities.simplifiedAccounts)throw Error('Separate account forms require the simplified credential contract');
if(capabilities.usernameOnlySignup&&!capabilities.separateAccountForms)throw Error('Username-only signup requires separate account forms');
const createSubmitName=capabilities.simplifiedAccounts?'Create account & continue':'Create account';
// Browser contract shared by the reviewed account and UX stacks. Do not load
// candidate test helpers: that would load a second Playwright installation.
async function submitPlayableAction(page,action,info){
  const before=await count(page);let writes=0;
  const observe=r=>{if(r.method()==='POST'&&/\/api\/shell\/games\/[^/]+\/apply$/.test(new URL(r.url()).pathname))writes++;};
  page.on('request',observe);
  try{
  const cell=p=>page.locator(`[data-testid="game-board"] .cell[data-row="${p.row}"][data-col="${p.col}"]`);
  const target=cell(action.to);await cell(action.from).click();
  if(capabilities.movePreview){
    // Preview runtime: the first destination activation arms the preview on
    // both pointer types; a touch click is not a separate selection step.
    await target.click();
    await expect(page.locator('#shell-board-preview-label')).toBeVisible();
    await expect(page.locator('#shell-board-preview-label')).toContainText('Preview. Activate this destination again to play.');
    expect(writes).toBe(0);expect(await count(page)).toBe(before);
    await mobileNavigationClear(page);
    await proof(page,info,'move-preview-before-confirm',page.getByTestId('game-board'));
  }else{
    if(await page.locator('html').getAttribute('data-hover-capability')==='hover')await target.hover();
    else if(!/(?:^|\s)target(?:\s|$)/.test(await target.getAttribute('class')||''))await target.click();
    await expect(target).toHaveClass(/(?:^|\s)target(?:\s|$)/);expect(writes).toBe(0);
  }
  await target.click();await expect.poll(()=>count(page)).toBe(before+1);expect(writes).toBe(1);
  }finally{page.off('request',observe);}
}
const password='Synthetic proof password 482 longer';
const dialog=page=>page.getByTestId('account-dialog');
const session=page=>page.evaluate(async()=>{const r=await fetch('/api/auth/session',{cache:'no-store'});if(!r.ok)throw Error(`Session: ${r.status}`);return r.json();});
const count=page=>page.getByTestId('history-move-item').count();
const options=info=>({baseURL:'https://127.0.0.1:9988',ignoreHTTPSErrors:true,viewport:info.project.use.viewport,isMobile:info.project.use.isMobile,hasTouch:info.project.use.hasTouch});
async function fits(page,locator){
  await expect(locator).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  const box=await locator.boundingBox();expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width+1);
}
async function mobileNavigationClear(page){
  if(await page.locator('#app').getAttribute('data-shell-layout-mode')!=='narrow')return;
  await page.getByTestId('game-board').evaluate(element=>element.scrollIntoView({block:'start',behavior:'instant'}));
  // Both the expanded preview and the collapsed legacy help must leave the
  // navigation usable after the journey has scrolled the real document.
  await expect.poll(()=>page.evaluate(()=>{
    const help=document.querySelector('[data-zone="game-help"]');
    const navigation=document.querySelector('.shell-mobile-tabbar');
    const tabs=[...document.querySelectorAll('.shell-mobile-tabbar .shell-mobile-tab')];
    if(!help||!navigation)return false;
    const helpRect=help.getBoundingClientRect(),navRect=navigation.getBoundingClientRect();
    return tabs.length===3&&helpRect.bottom<=navRect.top+1&&tabs.every(tab=>{
      const rect=tab.getBoundingClientRect();
      return rect.top>=0&&rect.bottom<=innerHeight+1&&rect.left>=0&&rect.right<=innerWidth+1
        &&tab.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
    });
  }),{message:'Mobile help must leave all three navigation tabs visible and reachable'}).toBe(true);
}
async function settledHome(page){
  await expect(page.getByTestId('home-create-game')).toBeVisible();
  // The early account UI renders its start button inside the loading skeleton.
  // Wait for actual home content, not merely the actionable button.
  await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
  await expect(page.getByTestId('home-card-skeleton')).toHaveCount(0);
  if(capabilities.personalHome){
    await expect(page.getByTestId('resume-slot')).toBeVisible();
    await expect(page.getByTestId('resume-slot').locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  }else{
    await expect(page.locator('[data-home-section-root="my"]')).toBeVisible();
  }
}
async function accountOpen(page){await page.getByRole('button',{name:'Account',exact:true}).click();await expect(dialog(page)).toBeVisible();}
async function openSignedOutAccount(page){
  if(!capabilities.playAccountEntry){
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
  }else{
    await expect(page.getByTestId('account-open')).toHaveCount(0);
    if(new URL(page.url()).hash.startsWith('#/game/')){
      // A board click opens only account access, without a game or move intent.
      await page.getByTestId('game-board').locator('.cell').first().click();
    }else{
      await settledHome(page);
      await page.getByTestId('home-create-game').click();
    }
  }
  await expect(dialog(page)).toBeVisible();
}
async function login(page,name,secret=password){
  const sameGame=capabilities.playAccountEntry&&new URL(page.url()).hash.startsWith('#/game/');
  const previousURL=page.url();let writes=0;
  const observe=r=>{if(r.method()==='POST'&&(/^\/api\/shell\/games$|\/apply$/.test(new URL(r.url()).pathname)))writes++;};
  if(sameGame)page.on('request',observe);
  try{
    await openSignedOutAccount(page);
    await dialog(page).getByLabel('Username',{exact:true}).fill(name);
    await dialog(page).getByLabel('Password',{exact:true}).fill(secret);
    await dialog(page).getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(dialog(page)).not.toBeVisible();
    if(sameGame){expect(page.url()).toBe(previousURL);expect(writes).toBe(0);}
  }finally{if(sameGame)page.off('request',observe);}
}
async function gamePayload(page){return page.evaluate(async(protocol)=>{
  const s=await(await fetch('/api/auth/session')).json();
  const id=decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
  const r=await fetch(`/api/shell/games/${encodeURIComponent(id)}`,{headers:{'X-Righelt-Auth-Version':protocol,'X-Righelt-Session':s.contextId}});
  if(!r.ok)throw Error(`Game: ${r.status}`);return (await r.json()).game;
},capabilities.simplifiedAccounts?'2':'1');}
async function registerStandalone(page,username){
  await page.goto('/');await openSignedOutAccount(page);
  await dialog(page).getByRole('button',{name:'Create account',exact:true}).click();
  await dialog(page).getByLabel('Username',{exact:true}).fill(username);await dialog(page).getByLabel('Password',{exact:true}).fill(password);
  await dialog(page).getByRole('button',{name:createSubmitName,exact:true}).click();
  if(!capabilities.simplifiedAccounts){await dialog(page).getByLabel('I saved my recovery code').check();await dialog(page).getByRole('button',{name:'Continue',exact:true}).click();}
  await expect(dialog(page)).not.toBeVisible();
  if(capabilities.playAccountEntry)await expect(page.getByTestId('game-role')).toContainText('Player 1');
}
test.beforeAll(async({browser},info)=>{
  if(!capabilities.cutover)return;
  const context=await browser.newContext(options(info));
  try{
    const page=await context.newPage();await page.goto('/');
    if(!(await context.request.get('https://127.0.0.1:9988/api/profiles/validation_canary')).ok())await registerStandalone(page,'validation_canary');
    expect((await fetch('http://127.0.0.1:10088/activate-cutover',{method:'POST'})).status).toBe(200);
    expect((await fetch('http://127.0.0.1:10088/maintenance-off',{method:'POST'})).status).toBe(200);
  }finally{await context.close();}
});
test.beforeEach(async()=>{expect((await fetch('http://127.0.0.1:10088/reset-limits',{method:'POST'})).ok).toBe(true);});

test(FRESH_ACCOUNT_WORKFLOW,async({page,browser},info)=>{
  const username=`Proof_${Date.now().toString(36)}_${info.project.name.replaceAll('-','').slice(0,4)}`;
  let creates=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/shell/games')creates++;});
  await page.goto('/');
  await settledHome(page);
  await fits(page,page.getByTestId('home-create-game'));
  await proof(page,info,'account-home',page.locator(capabilities.personalHome?'[data-zone="home-start"]':'#app'));
  if(capabilities.personalHome){
    const start=page.locator('[data-zone="home-start"]');
    await start.getByRole('button',{name:'Self-play',exact:true}).scrollIntoViewIfNeeded();
    await proof(page,info,'personal-home-start-lower',start);
  }
  await page.getByTestId('home-create-game').click();
  await fits(page,dialog(page));
  const trigger=dialog(page).getByLabel('Username',{exact:true});
  await expect(trigger).toHaveAttribute('autocomplete','username');
  await proof(page,info,'sign-in',dialog(page));
  if(!capabilities.simplifiedAccounts||capabilities.separateAccountForms){
  await expect(dialog(page).getByLabel('Password',{exact:true})).toBeVisible();
  await expect(dialog(page).getByLabel('Password',{exact:true})).toBeEnabled();
  await dialog(page).getByLabel('Password',{exact:true}).fill('');
  await dialog(page).getByRole('button',{name:'Sign in',exact:true}).click();}
  else {await expect(dialog(page).getByLabel('Password',{exact:true})).not.toBeVisible();await expect(dialog(page).getByLabel('Password',{exact:true})).toBeDisabled();}
  await expect(dialog(page)).toBeVisible();expect(creates).toBe(0);
  expect((await new AxeBuilder({page}).include('[data-testid="account-dialog"]').analyze()).violations).toEqual([]);
  await dialog(page).getByRole('button',{name:'Create account',exact:true}).click();
  await dialog(page).getByLabel('Username',{exact:true}).fill(username);
  await dialog(page).getByLabel('Password',{exact:true}).fill(password);
  if(capabilities.simplifiedAccounts){
    if(capabilities.usernameOnlySignup){
      await expect(dialog(page).locator('[name="displayName"]')).toHaveCount(0);
      await dialog(page).getByRole('button',{name:'Back to sign in',exact:true}).click();
      await expect(dialog(page).getByLabel('Password',{exact:true})).toHaveAttribute('type','password');
      await expect(dialog(page).getByLabel('Password',{exact:true})).toHaveValue('');
      await dialog(page).getByRole('button',{name:'Create account',exact:true}).click();
      await dialog(page).getByLabel('Username',{exact:true}).fill(username);
      await dialog(page).getByLabel('Password',{exact:true}).fill(password);
      await expect(dialog(page).locator('[name="displayName"]')).toHaveCount(0);
    }else if(capabilities.separateAccountForms){
      const displayName=dialog(page).getByLabel('Display name (optional)',{exact:true});
      await expect(displayName).toBeVisible();await expect(displayName).not.toHaveAttribute('required','');
      await displayName.fill('Validation Signup');
    }
    await expect(dialog(page).getByLabel('Password',{exact:true})).toHaveAttribute('type','text');
    expect(creates).toBe(0);
    await fits(page,dialog(page));await proof(page,info,'account-creation',dialog(page),{mask:[dialog(page).getByLabel('Password',{exact:true})]});
    await dialog(page).getByRole('button',{name:createSubmitName,exact:true}).click();
  }else{
  await dialog(page).getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByTestId('recovery-code')).toBeVisible();
  expect(creates).toBe(0);
  await fits(page,dialog(page));await proof(page,info,'recovery-acknowledgment',dialog(page),{mask:[page.getByTestId('recovery-code')]});
  await dialog(page).getByRole('button',{name:'Continue',exact:true}).click();
  await expect(dialog(page)).toBeVisible();expect(creates).toBe(0);
  await dialog(page).getByLabel('I saved my recovery code').check();
  await dialog(page).getByRole('button',{name:'Continue',exact:true}).click();
  }
  await expect(dialog(page)).not.toBeVisible();await expect(page.getByTestId('game-role')).toContainText('Player 1');
  expect(creates).toBe(1);
  if(capabilities.separateAccountForms)expect((await session(page)).account.displayName).toBe(capabilities.usernameOnlySignup?username:'Validation Signup');
  const gameURL=page.url();
  const second=await browser.newContext(options(info));
  try{
    const other=await second.newPage();await other.goto(gameURL);await login(other,username);
    await expect(other.getByTestId('game-role')).toContainText('Player 1');
    const before=await count(page);const game=await gamePayload(other);
    expect(game.ownershipMode).toBe('account_v1');
    const action=game.legalActions.find(x=>x.from&&x.to);expect(action).toBeTruthy();
    await submitPlayableAction(other,action,info);
    await expect.poll(()=>count(page)).toBeGreaterThan(before);
    await fits(other,other.getByTestId('game-board'));await proof(other,info,'account-owned-move',other.getByTestId('game-board'));
    await page.reload();await expect.poll(()=>count(page)).toBeGreaterThan(before);
  }finally{await second.close();}
  await accountOpen(page);
  if(capabilities.profiles){
    await dialog(page).getByLabel('Display name',{exact:true}).fill('Validation Player');
    if(capabilities.separateAccountForms){
      await expect(dialog(page).getByLabel('View preference')).toHaveCount(0);
      await expect(dialog(page).getByTestId('tutorial-status')).toHaveCount(0);
      await expect(dialog(page).getByRole('button',{name:'Replay tutorial',exact:true})).toHaveCount(0);
      await expect(dialog(page).getByRole('button',{name:'Switch account',exact:true})).toHaveCount(0);
    }else await dialog(page).getByLabel('View preference').selectOption('explanatory');
    if(capabilities.accountAutosave){
      await expect(dialog(page).getByRole('button',{name:/^Save(?: account settings)?$/})).toHaveCount(0);
      // Blur through the keyboard, then prove the write through a fresh server
      // session read. Merely observing local form state would miss a failed save.
      await dialog(page).getByLabel('Display name',{exact:true}).press('Tab');
    }else await dialog(page).getByRole('button',{name:capabilities.separateAccountForms?'Save':'Save account settings',exact:true}).click();
    await expect.poll(async()=>(await session(page)).account.displayName).toBe('Validation Player');
    if(capabilities.separateAccountForms){
      // Preferences remain an account contract even when their controls leave
      // Account. Exercise the real authenticated API, then retain its values.
      const saved=await page.evaluate(async()=>{
        const current=await(await fetch('/api/auth/session',{cache:'no-store'})).json();
        const response=await fetch('/api/account',{method:'PATCH',headers:{'Content-Type':'application/json','X-Righelt-Auth':'1','X-Righelt-Session':current.contextId},body:JSON.stringify({preferences:{view:'explanatory',tutorial:'completed'}})});
        return {status:response.status,body:await response.json()};
      });
      expect(saved.status).toBe(200);expect(saved.body.account.preferences.view).toBe('explanatory');expect(saved.body.account.preferences.tutorial).toBe('completed');
    }
  }
  await fits(page,dialog(page));await proof(page,info,'account-settings',dialog(page));
  await dialog(page).getByRole('button',{name:'Sign out',exact:true}).click();
  if(capabilities.playAccountEntry){
    await expect(page.getByTestId('account-open')).toHaveCount(0);
    expect((await session(page)).authenticated).toBe(false);
  }else await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await expect(page.getByTestId('game-board')).toBeVisible();
  await login(page,username);await expect(page.getByTestId('game-role')).toContainText('Player 1');
  const savedSession=await session(page);expect(savedSession.authenticated).toBe(true);
  if(capabilities.profiles){expect(savedSession.account.displayName).toBe('Validation Player');expect(savedSession.account.preferences.view).toBe('explanatory');}
  if(capabilities.separateAccountForms)expect(savedSession.account.preferences.tutorial).toBe('completed');
  if(capabilities.personalHome){
    await page.getByRole('link',{name:'Righelt',exact:true}).click();
    await settledHome(page);
    await expect(page.locator('[data-zone="home-resume"]')).toContainText('Continue playing');
    await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
    await fits(page,page.locator('[data-zone="home-start"]'));await proof(page,info,'returning-personal-home',page.locator('[data-zone="home-resume"]'));
    const resume=page.locator('[data-zone="home-resume"]');
    const firstBoard=resume.locator('[data-mini-board-preview]').first();
    await expect(firstBoard.locator('.cell').last()).toBeAttached();
    await firstBoard.locator('.cell').last().scrollIntoViewIfNeeded();
    await proof(page,info,'returning-personal-home-lower',resume);
    // Restore the intentional top-of-panel view before opening a story.
    await page.getByTestId('resume-slot').evaluate(element=>{element.scrollTop=0;});
    if(capabilities.stories){
      const priorCreates=creates;const babs=page.locator('button[data-opponent="babs"]');await babs.click();
      const story=page.getByRole('dialog',{name:'Babs · Easy'});
      await expect(story.locator('[data-story-play]')).toBeDisabled();
      await expect(story.locator('[data-story-readiness]')).toContainText('Computer play is being prepared');
      await expect.poll(()=>story.locator('[data-story-image]').first().evaluate(img=>img.complete&&img.naturalWidth===960)).toBe(true);
      await fits(page,story);await proof(page,info,'unavailable-trained-story',story);
      await page.keyboard.press('Escape');await expect(story).not.toBeVisible();await expect(babs).toBeFocused();
      expect(creates).toBe(priorCreates);expect((await session(page)).account.preferences.introducedOpponents).toBe(0);
    }
  }
  if(capabilities.results)await proveResultsRematch({page,info,root});
  if(process.env.RIGHELT_LEGACY_CONTINUITY_INPUT){
    const legacy=JSON.parse(await readFile(process.env.RIGHELT_LEGACY_CONTINUITY_INPUT,'utf8'));
    expect(legacy.version,'Regenerate pre-upgrade guest evidence').toBe(2);
    await page.goto(`/${legacy.hash}`);
    await expect(page.getByTestId('game-board')).toBeVisible();
    await expect.poll(()=>count(page)).toBe(legacy.count);
    const oldGame=await gamePayload(page);
    assertHistoryPreserved(oldGame,legacy.history);
    expect(oldGame.ownershipMode).toBe('legacy_guest');expect(oldGame.myRoles).toEqual([]);expect(oldGame.canRecordMove).toBe(false);
    const denied=await page.evaluate(async(protocol)=>{
      const s=await(await fetch('/api/auth/session')).json();
      const id=decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
      const r=await fetch(`/api/shell/games/${encodeURIComponent(id)}/join`,{method:'POST',headers:{'Content-Type':'application/json','X-Righelt-Auth':'1','X-Righelt-Auth-Version':protocol,'X-Righelt-Session':s.contextId},body:JSON.stringify({mode:'player'})});
      return {status:r.status,body:await r.json()};
    },capabilities.simplifiedAccounts?'2':'1');
    expect(denied.status).toBeGreaterThanOrEqual(400);expect(denied.body.error).toBe('legacy_read_only');
    await proveLegacyMutationDenied({browser,legacy,oldGame,authProtocol:capabilities.simplifiedAccounts?2:1});
    expect(await count(page)).toBe(legacy.count);
    if(capabilities.movePreview){
      const help=page.locator('[data-zone="game-help"]');
      if(await help.getAttribute('data-expanded')==='true')await help.getByRole('button',{name:'Collapse',exact:true}).click();
      await expect(help).toHaveAttribute('data-expanded','false');
      // Collapsing the overlay reveals the board without changing the saved
      // explanatory preference whose continuity this journey must preserve.
      expect((await session(page)).account.preferences.view).toBe('explanatory');
    }
    const legacyBoard=page.getByTestId('game-board');
    await legacyBoard.evaluate(element=>element.scrollIntoView({block:'start',behavior:'instant'}));
    for(const cell of [legacyBoard.locator('.cell').first(),legacyBoard.locator('.cell').last()]){
      await expect.poll(()=>cell.evaluate(element=>{
        const rect=element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
      })).toBe(true);
    }
    if(capabilities.movePreview)await mobileNavigationClear(page);
    await proof(page,info,'legacy-history-preserved-no-account-takeover',page.getByTestId('game-board'));
  }
  if(process.env.RIGHELT_CONTINUITY_FILE){
    // A real self-play game keeps the retained account authorized on either turn.
    const retainedGame=await page.evaluate(async(protocol)=>{
      const s=await(await fetch('/api/auth/session')).json();
      const r=await fetch('/api/shell/games',{method:'POST',headers:{'Content-Type':'application/json','X-Righelt-Auth':'1','X-Righelt-Auth-Version':protocol,'X-Righelt-Session':s.contextId},body:JSON.stringify({selfPlayMode:true})});
      if(!r.ok)throw Error(`Retained fixture creation: ${r.status}`);return (await r.json()).game;
    },capabilities.simplifiedAccounts?'2':'1');
    expect(retainedGame.myRoles.slice().sort()).toEqual(['Player 1','Player 2']);
    await page.goto(`/#/game/${encodeURIComponent(retainedGame.id)}`);await expect(page.getByTestId('game-board')).toBeVisible();
    const action=(await gamePayload(page)).legalActions.find(x=>x.from&&x.to);expect(action).toBeTruthy();await submitPlayableAction(page,action,info);
    await writeFile(`${process.env.RIGHELT_CONTINUITY_FILE}.account-${info.project.name}`,JSON.stringify({version:2,username,password,gameURL:page.url(),historyCount:await count(page),history:historySnapshot(await gamePayload(page)),account:savedSession.account,storage:await page.context().storageState()}),{mode:0o600});
  }
});

test(RETAINED_ACCOUNT_WORKFLOW,async({browser},info)=>{
  const input=process.env.RIGHELT_ACCOUNT_CONTINUITY_INPUT;
  test.skip(!input,'First account-capable stage establishes retained account fixtures');
  const prior=JSON.parse(await readFile(`${input}.account-${info.project.name}`,'utf8'));
  expect(prior.version,'Regenerate pre-upgrade account evidence').toBe(2);
  const context=await browser.newContext({...options(info),storageState:prior.storage});
  try{
    const page=await context.newPage();await page.goto(prior.gameURL);
    const current=await session(page);expect(current.authenticated).toBe(true);
    expect(current.account.id).toBe(prior.account.id);expect(current.account.username).toBe(prior.username);
    expect(current.account.displayName).toBe(prior.account.displayName);
    for(const [key,value]of Object.entries(prior.account.preferences))expect(current.account.preferences[key],`Retained preference ${key}`).toEqual(value);
    if(capabilities.introductions&&!Object.hasOwn(prior.account.preferences,'introducedOpponents'))expect(current.account.preferences.introducedOpponents).toBe(0);
    await expect.poll(()=>count(page)).toBe(prior.historyCount);
    const retained=await gamePayload(page);assertHistoryPreserved(retained,prior.history);expect(retained.ownershipMode).toBe('account_v1');expect(retained.myRoles.slice().sort()).toEqual(['Player 1','Player 2']);
    const action=retained.legalActions.find(x=>x.from&&x.to);expect(action).toBeTruthy();await submitPlayableAction(page,action,info);
    await page.reload();await expect.poll(()=>count(page)).toBe(prior.historyCount+1);
    await page.getByTestId('game-board').scrollIntoViewIfNeeded();
    await fits(page,page.getByTestId('game-board'));await proof(page,info,'retained-account-upgrade',page.getByTestId('game-board'));
    await accountOpen(page);await dialog(page).getByRole('button',{name:'Sign out',exact:true}).click();
    await login(page,prior.username,prior.password);expect((await session(page)).account.id).toBe(prior.account.id);
    expect((await gamePayload(page)).myRoles.slice().sort()).toEqual(['Player 1','Player 2']);
  }finally{await context.close();}
});
