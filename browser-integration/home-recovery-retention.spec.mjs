import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../apps/web/shell/app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('const patchHomeAroundCreateControl ='),app.indexOf('const updateMountedHeader ='));

async function mount(page){
  await page.goto('/browser-integration/support/panel-loading.html');
  await page.evaluate(async source=>{
    const {patchSectionContent}=await import('/apps/web/shell/dom-patch.js');
    document.body.innerHTML='<div id="retention-root"></div>';
    const appEl=document.getElementById('retention-root');
    const markup=(disabled=false,label='Friend',action='create-game',wrapped=false)=>`<div class="shell-page-shell"><div class="shell-main-content"><section data-home-section-root="my"><article data-key="retained-card"><a href="#/game/owned">Owned game</a></article></section>${wrapped?'<div>':''}<section class="home-start"><button data-action="${action}" ${disabled?'disabled':''}>${label}</button><button data-action="create-self-play" ${disabled?'disabled':''}>Play both sides</button></section>${wrapped?'</div>':''}</div></div>`;
    appEl.innerHTML=markup();
    const control=appEl.querySelector('.home-start'),card=appEl.querySelector('article'),button=appEl.querySelector('button');
    let clicks=0;button.addEventListener('click',()=>clicks++);
    const patch=new Function('appEl','pressedControlEl','patchNotificationTree','patchSectionContent','updateMountedFlyouts',`${source};return patchHomeAroundCreateControl;`)(appEl,null,()=>{},patchSectionContent,()=>{});
    window.retention={apply:(...args)=>patch(markup(...args)),snapshot:()=>({control:appEl.querySelector('.home-start')===control,card:appEl.querySelector('article')===card,button:appEl.querySelector('button')===button,disabled:button.disabled,clicks})};
  },source);
}

test('Home availability toggles preserve cached cards and native controls',async({page})=>{
  await mount(page);const friend=page.getByRole('button',{name:'Friend',exact:true});
  await friend.click();expect(await page.evaluate(()=>window.retention.snapshot())).toMatchObject({clicks:1,disabled:false});
  expect(await page.evaluate(()=>window.retention.apply(true))).toBe(true);
  await expect(friend).toBeDisabled();
  expect(await page.evaluate(()=>window.retention.snapshot())).toEqual({control:true,card:true,button:true,disabled:true,clicks:1});
  expect(await page.evaluate(()=>window.retention.apply(false))).toBe(true);
  await expect(friend).toBeEnabled();await friend.click();
  expect(await page.evaluate(()=>window.retention.snapshot())).toEqual({control:true,card:true,button:true,disabled:false,clicks:2});
});

for(const change of ['label','action','ancestor'])test(`unrelated ${change} change still falls back without mutating availability`,async({page})=>{
  await mount(page);
  const result=await page.evaluate(change=>({patched:window.retention.apply(true,change==='label'?'Changed':'Friend',change==='action'?'other-action':'create-game',change==='ancestor'),snapshot:window.retention.snapshot()}),change);
  expect(result.patched).toBe(false);
  expect(result.snapshot).toEqual({control:true,card:true,button:true,disabled:false,clicks:0});
});
