import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('existing fallback and placeholder routes share marble without starting a game or saving progress', async ({page}, info) => {
 const writes=[];const observe=request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(request.method()))writes.push({method:request.method(),path:url.pathname});};
 page.on('request',observe);
 const samples=[];
 const inspect=async(name,{forced=false}={})=>{
  const panel=page.locator('.shell-main-content > section.panel');await expect(panel).toHaveCount(1);await expect(panel).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  const state=await panel.evaluate(element=>{const rect=element.getBoundingClientRect(),style=getComputedStyle(element),face=getComputedStyle(element,'::before'),edge=getComputedStyle(element,'::after');return{rect:rect.toJSON(),viewport:{width:innerWidth,height:innerHeight},radius:style.borderRadius,background:style.backgroundColor,face:{content:face.content,clip:face.clipPath,image:face.backgroundImage,color:face.backgroundColor},edge:{content:edge.content,clip:edge.clipPath,image:edge.backgroundImage}};});
  samples.push({name,forced,...state});
  const metrics=info.outputPath('root-panel-native.json');await writeFile(metrics,JSON.stringify({samples,writes},null,2),{mode:0o600});await info.attach('root panel native paint',{path:metrics,contentType:'application/json'});
  expect(state.radius).toBe('0px');expect(state.background).toBe('rgba(0, 0, 0, 0)');expect(state.face.clip.startsWith('polygon(')).toBe(true);expect(state.edge.clip.startsWith('polygon(')).toBe(true);expect(state.rect.left).toBeGreaterThanOrEqual(-1);expect(state.rect.right).toBeLessThanOrEqual(state.viewport.width+1);
  if(forced){expect(state.face.image).toBe('none');expect(state.edge.image).toBe('none');}else expect(state.face.image).toContain('url(');
  const image=info.outputPath(name+'.png');await page.screenshot({path:image});await info.attach(name,{path:image,contentType:'image/png'});
 };
 try{
  await page.setViewportSize({width:390,height:844});await page.goto('/#/marble-acceptance-missing');
  await expect(page.getByRole('heading',{name:'Start something new',exact:true})).toBeVisible();await expect(page).toHaveURL(/#\/$/);
  // Startup canonicalizes unknown hashes. Once mounted, a native same-document
  // navigation reaches the existing app fallback without changing product routing.
  expect(await page.goto('/#/marble-acceptance-missing')).toBeNull();
  await expect(page.getByRole('heading',{name:'Route not found',exact:true})).toBeVisible();await inspect('root-not-found-marble');
  const home=page.getByRole('link',{name:'Return home',exact:true});const box=await home.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);await home.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Start something new',exact:true})).toBeVisible();
  await page.goto('/#/tutorial');await expect(page.getByRole('heading',{name:/Tutorial/})).toBeVisible();await expect(page.getByText('Not yet implemented',{exact:true})).toBeVisible();await expect(page.getByText('Step 1 of 5',{exact:true})).toBeVisible();await expect(page.getByText('Select your role',{exact:true})).toBeVisible();await inspect('root-existing-placeholder-marble');
  // View the existing unimplemented lesson shell only; do not invoke its progress actions.
  await page.emulateMedia({forcedColors:'active'});await page.goto('/#/marble-acceptance-missing');await expect(page.getByRole('heading',{name:'Route not found',exact:true})).toBeVisible();await inspect('root-not-found-forced-colors',{forced:true});
  const exit=page.getByRole('link',{name:'Return home',exact:true});await exit.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Start something new',exact:true})).toBeVisible();expect(writes).toEqual([]);
 }finally{page.off('request',observe);}
});
