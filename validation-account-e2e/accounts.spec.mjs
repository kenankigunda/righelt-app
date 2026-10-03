import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {candidateCapabilities} from '../scripts/validation/capabilities.mjs';
import {proof} from '../scripts/validation/proof.mjs';
import {proveLegacyMutationDenied} from '../scripts/validation/legacy-account-proof.mjs';
import {FRESH_ACCOUNT_WORKFLOW,RETAINED_ACCOUNT_WORKFLOW} from '../scripts/validation/account-evidence.mjs';

const root=process.env.RIGHELT_VALIDATION_TARGET_ROOT||process.cwd();
const capabilities=await candidateCapabilities(root);
if(!capabilities.accounts)throw Error('Account proof requires the candidate account UI and real credential services');
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
    expect(writes).toBe(0);expect(await count(page)).toBe(before);
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
async function accountOpen(page){await page.getByRole('button',{name:'Account',exact:true}).click();await expect(dialog(page)).toBeVisible();}
async function login(page,name,secret=password){
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await dialog(page).getByLabel('Username',{exact:true}).fill(name);
  await dialog(page).getByLabel('Password',{exact:true}).fill(secret);
  await dialog(page).getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(dialog(page)).not.toBeVisible();
}
async function gamePayload(page){return page.evaluate(async()=>{
  const s=await(await fetch('/api/auth/session')).json();
  const id=decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
  const r=await fetch(`/api/shell/games/${encodeURIComponent(id)}`,{headers:{'X-Righelt-Auth-Version':'1','X-Righelt-Session':s.contextId}});
  if(!r.ok)throw Error(`Game: ${r.status}`);return (await r.json()).game;
});}
async function registerStandalone(page,username){
  await page.goto('/');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Create account',exact:true}).click();
  await dialog(page).getByLabel('Username',{exact:true}).fill(username);await dialog(page).getByLabel('Password',{exact:true}).fill(password);
  await dialog(page).getByRole('button',{name:'Create account',exact:true}).click();
  await dialog(page).getByLabel('I saved my recovery code').check();await dialog(page).getByRole('button',{name:'Continue',exact:true}).click();
  await expect(dialog(page)).not.toBeVisible();
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
  await fits(page,page.getByTestId('home-create-game'));
  await proof(page,info,'account-home',page.locator(capabilities.personalHome?'[data-zone="home-start"]':'#app'));
  await page.getByTestId('home-create-game').click();
  await fits(page,dialog(page));
  const trigger=dialog(page).getByLabel('Username',{exact:true});
  await expect(trigger).toHaveAttribute('autocomplete','username');
  await dialog(page).getByLabel('Password',{exact:true}).fill('');
  await dialog(page).getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(dialog(page)).toBeVisible();expect(creates).toBe(0);
  await proof(page,info,'sign-in',dialog(page));
  expect((await new AxeBuilder({page}).include('[data-testid="account-dialog"]').analyze()).violations).toEqual([]);
  await dialog(page).getByRole('button',{name:'Create account',exact:true}).click();
  await dialog(page).getByLabel('Username',{exact:true}).fill(username);
  await dialog(page).getByLabel('Password',{exact:true}).fill(password);
  await dialog(page).getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByTestId('recovery-code')).toBeVisible();
  expect(creates).toBe(0);
  await fits(page,dialog(page));await proof(page,info,'recovery-acknowledgment',dialog(page),{mask:[page.getByTestId('recovery-code')]});
  await dialog(page).getByRole('button',{name:'Continue',exact:true}).click();
  await expect(dialog(page)).toBeVisible();expect(creates).toBe(0);
  await dialog(page).getByLabel('I saved my recovery code').check();
  await dialog(page).getByRole('button',{name:'Continue',exact:true}).click();
  await expect(dialog(page)).not.toBeVisible();await expect(page.getByTestId('game-role')).toContainText('Player 1');
  expect(creates).toBe(1);const gameURL=page.url();
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
    await dialog(page).getByLabel('View preference').selectOption('explanatory');
    await dialog(page).getByRole('button',{name:'Save account settings'}).click();
    await expect(dialog(page).locator('[data-account-status]')).toHaveText('Account settings saved.');
  }
  await fits(page,dialog(page));await proof(page,info,'account-settings',dialog(page));
  await dialog(page).getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await expect(page.getByTestId('game-board')).toBeVisible();
  await login(page,username);await expect(page.getByTestId('game-role')).toContainText('Player 1');
  const savedSession=await session(page);expect(savedSession.authenticated).toBe(true);
  if(capabilities.profiles){expect(savedSession.account.displayName).toBe('Validation Player');expect(savedSession.account.preferences.view).toBe('explanatory');}
  if(capabilities.personalHome){
    await page.getByRole('link',{name:'Righelt',exact:true}).click();
    await expect(page.locator('[data-zone="home-resume"]')).toContainText('Continue playing');
    await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
    await fits(page,page.locator('[data-zone="home-start"]'));await proof(page,info,'returning-personal-home',page.locator('[data-zone="home-resume"]'));
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
  if(process.env.RIGHELT_LEGACY_CONTINUITY_INPUT){
    const legacy=JSON.parse(await readFile(process.env.RIGHELT_LEGACY_CONTINUITY_INPUT,'utf8'));
    await page.goto(`/${legacy.hash}`);
    await expect(page.getByTestId('game-board')).toBeVisible();
    await expect.poll(()=>count(page)).toBe(legacy.count);
    const oldGame=await gamePayload(page);
    expect(oldGame.ownershipMode).toBe('legacy_guest');expect(oldGame.myRoles).toEqual([]);expect(oldGame.canRecordMove).toBe(false);
    const denied=await page.evaluate(async()=>{
      const s=await(await fetch('/api/auth/session')).json();
      const id=decodeURIComponent(location.hash.match(/^#\/game\/([^?]+)/)[1]);
      const r=await fetch(`/api/shell/games/${encodeURIComponent(id)}/join`,{method:'POST',headers:{'Content-Type':'application/json','X-Righelt-Auth':'1','X-Righelt-Auth-Version':'1','X-Righelt-Session':s.contextId},body:JSON.stringify({mode:'player'})});
      return {status:r.status,body:await r.json()};
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);expect(denied.body.error).toBe('legacy_read_only');
    await proveLegacyMutationDenied({browser,legacy,oldGame});
    expect(await count(page)).toBe(legacy.count);
    await proof(page,info,'legacy-history-preserved-no-account-takeover',page.getByTestId('game-board'));
  }
  if(process.env.RIGHELT_CONTINUITY_FILE){
    // A real self-play game keeps the retained account authorized on either turn.
    const retainedGame=await page.evaluate(async()=>{
      const s=await(await fetch('/api/auth/session')).json();
      const r=await fetch('/api/shell/games',{method:'POST',headers:{'Content-Type':'application/json','X-Righelt-Auth':'1','X-Righelt-Auth-Version':'1','X-Righelt-Session':s.contextId},body:JSON.stringify({selfPlayMode:true})});
      if(!r.ok)throw Error(`Retained fixture creation: ${r.status}`);return (await r.json()).game;
    });
    expect(retainedGame.myRoles.slice().sort()).toEqual(['Player 1','Player 2']);
    await page.goto(`/#/game/${encodeURIComponent(retainedGame.id)}`);await expect(page.getByTestId('game-board')).toBeVisible();
    const action=(await gamePayload(page)).legalActions.find(x=>x.from&&x.to);expect(action).toBeTruthy();await submitPlayableAction(page,action,info);
    await writeFile(`${process.env.RIGHELT_CONTINUITY_FILE}.account-${info.project.name}`,JSON.stringify({version:1,username,password,gameURL:page.url(),historyCount:await count(page),account:savedSession.account,storage:await page.context().storageState()}),{mode:0o600});
  }
});

test(RETAINED_ACCOUNT_WORKFLOW,async({browser},info)=>{
  const input=process.env.RIGHELT_ACCOUNT_CONTINUITY_INPUT;
  test.skip(!input,'First account-capable stage establishes retained account fixtures');
  const prior=JSON.parse(await readFile(`${input}.account-${info.project.name}`,'utf8'));
  const context=await browser.newContext({...options(info),storageState:prior.storage});
  try{
    const page=await context.newPage();await page.goto(prior.gameURL);
    const current=await session(page);expect(current.authenticated).toBe(true);
    expect(current.account.id).toBe(prior.account.id);expect(current.account.username).toBe(prior.username);
    expect(current.account.displayName).toBe(prior.account.displayName);
    for(const [key,value]of Object.entries(prior.account.preferences))expect(current.account.preferences[key],`Retained preference ${key}`).toEqual(value);
    if(capabilities.introductions&&!Object.hasOwn(prior.account.preferences,'introducedOpponents'))expect(current.account.preferences.introducedOpponents).toBe(0);
    await expect.poll(()=>count(page)).toBe(prior.historyCount);
    const retained=await gamePayload(page);expect(retained.ownershipMode).toBe('account_v1');expect(retained.myRoles.slice().sort()).toEqual(['Player 1','Player 2']);
    const action=retained.legalActions.find(x=>x.from&&x.to);expect(action).toBeTruthy();await submitPlayableAction(page,action,info);
    await page.reload();await expect.poll(()=>count(page)).toBe(prior.historyCount+1);
    await fits(page,page.getByTestId('game-board'));await proof(page,info,'retained-account-upgrade',page.getByTestId('game-board'));
    await accountOpen(page);await dialog(page).getByRole('button',{name:'Sign out',exact:true}).click();
    await login(page,prior.username,prior.password);expect((await session(page)).account.id).toBe(prior.account.id);
    expect((await gamePayload(page)).myRoles.slice().sort()).toEqual(['Player 1','Player 2']);
  }finally{await context.close();}
});
