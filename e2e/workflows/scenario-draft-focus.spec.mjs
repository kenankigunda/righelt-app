import {test,expect} from '@playwright/test';
import {createGameFromHome,makeAnyLegalMove} from '../support/app.mjs';
import {viewports,hash} from '../../scripts/validation/model.mjs';
import {proof} from '../../scripts/validation/proof.mjs';
import {readJSON,saveJSON} from '../../scripts/validation/io.mjs';

for(const size of viewports)test.describe(`scenario draft / ${size.name}`,()=>{
 test.use({viewport:{width:size.width,height:size.height},isMobile:Boolean(size.isMobile),hasTouch:Boolean(size.hasTouch)});
 for(const field of ['title','description'])test(`${field} keeps focus and selection when the underlying game panel changes`,async({page},info)=>{
  await createGameFromHome(page);
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  const menu=page.getByRole('button',{name:'Open navigation menu'});if(await menu.isVisible())await menu.click();
  await page.getByRole('button',{name:'Scenarios',exact:true}).click();
  const input=page.locator(`[data-scenario-save-field="${field}"]`);
  await input.fill('Original draft');
  await input.evaluate(e=>e.setSelectionRange(0,8));
  const originalInput=await input.elementHandle();
  // Change the underlying panel without deliberately moving keyboard focus away from the draft.
  await page.evaluate(()=>{const [route,query='']=location.hash.split('?');const params=new URLSearchParams(query);params.set('panel','history');location.hash=`${route}?${params}`;});
  await expect(page).toHaveURL(/panel=history/);
  await expect.poll(()=>originalInput.evaluate(e=>e.isConnected)).toBe(false);
  await expect(page.locator('.shell-flyout')).toHaveCount(1);
  await expect(input).toBeFocused();
  await page.keyboard.insertText('Updated');
  await expect(input).toHaveValue('Updated draft');
  // The flyout scrolls independently on mobile; capture its visible form row.
  await input.locator('..').scrollIntoViewIfNeeded();
  const images=await proof(page,{project:{name:size.name,use:size},attach:info.attach.bind(info)},`scenario-${field}-focus`,input.locator('..'));
  if(images&&process.env.RIGHELT_EVIDENCE_JSON){
   const file=process.env.RIGHELT_EVIDENCE_JSON+'.adjacent';const items=await readJSON(file,[]);
   const assertions=['Draft focus and selection survive panel reconstruction; continued typing replaces selected text without losing the draft.'];
   items.push({id:`scenario-${size.name}-${field}`,title:`Scenario ${field} focus and draft preservation`,viewport:size.name,status:'passed',assertions,images,revision:hash({assertions,images})});await saveJSON(file,items);
  }
 });
});

for(const size of viewports)test.describe(`scenario live draft / ${size.name}`,()=>{
 test.use({viewport:{width:size.width,height:size.height},isMobile:Boolean(size.isMobile),hasTouch:Boolean(size.hasTouch)});
 for(const field of ['title','description'])test(`${field} keeps focus and selection during a live game update`,async({page},info)=>{
  const {gameHash}=await createGameFromHome(page);
  const players=page.locator('[data-action="switch-game-panel"][data-panel="players"]');if(await players.isVisible())await players.click();
  await page.getByRole('button',{name:'Play as both players',exact:true}).click();
  await expect(page.getByRole('button',{name:'Play as both players',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  const other=await page.context().newPage();
  try{
   await other.goto('/'+gameHash);await expect(other.getByTestId('game-board')).toBeVisible();
   const menu=page.getByRole('button',{name:'Open navigation menu'});if(await menu.isVisible())await menu.click();
   await page.getByRole('button',{name:'Scenarios',exact:true}).click();
   const input=page.locator(`[data-scenario-save-field="${field}"]`);
   await input.fill('Original draft');await input.evaluate(e=>e.setSelectionRange(0,8));
   const original=await input.elementHandle();
   await makeAnyLegalMove(other);
   await expect.poll(()=>original.evaluate(e=>e.isConnected)).toBe(false);
   await expect(input).toBeFocused();await page.keyboard.insertText('Updated');await expect(input).toHaveValue('Updated draft');
   await input.locator('..').scrollIntoViewIfNeeded();
   const images=await proof(page,{project:{name:size.name,use:size},attach:info.attach.bind(info)},`scenario-live-${field}`,input.locator('..'));
   if(images&&process.env.RIGHELT_EVIDENCE_JSON){const file=process.env.RIGHELT_EVIDENCE_JSON+'.adjacent';const items=await readJSON(file,[]);const assertions=['A real second client move rebuilds the flyout; active draft focus, selection and continued typing survive the live update.'];items.push({id:`scenario-live-${size.name}-${field}`,title:`Live update preserves scenario ${field}`,viewport:size.name,status:'passed',assertions,images,revision:hash({assertions,images})});await saveJSON(file,items);}
  }finally{await other.close();}
 });
});
