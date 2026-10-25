import {test,expect} from '@playwright/test';
import {waitForLegacyIdentity} from '../support/app.mjs';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';

test('fresh Home cards retain configured computer identity through manual control on either side',async({page},info)=>{
 await page.goto('/');await waitForLegacyIdentity(page);
 const games=await page.evaluate(async header=>{
  const bootstrap=await fetch('/api/shell/bootstrap');if(!bootstrap.ok)throw Error(`Bootstrap ${bootstrap.status}`);
  const generation=bootstrap.headers.get(header),identityId=localStorage.getItem('righelt.identity.id.v1');
  const post=async(path,body)=>{
   const response=await fetch(`/api/shell/${path}`,{method:'POST',headers:{'content-type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({...body,identityId,protocolVersion:2})});
   if(!response.ok)throw Error(`Identity fixture ${path}: ${response.status}`);return (await response.json()).game;
  };
  const result=[];
  for(const side of ['p1','p2']){
   let game=await post('games',{computer:{p1:null,p2:null,[side]:'horus'}});
   game=await post(`games/${game.id}/computer-control`,{action:'acquire',generation:game.computer.generation,deviceId:'home-identity-proof'});
   game=await post(`games/${game.id}/computer-control`,{action:'manual',generation:game.computer.generation,deviceId:'home-identity-proof'});
   if(!game.computer.manual||game.computerTurn!==null||game.moves.length!==0)throw Error('Expected unchanged manually controlled computer game');
   result.push({id:game.id,side});
  }
  return result;
 },STORAGE_GENERATION_HEADER);
 // A fresh page uses the actual Home list projection, not the create response.
 await page.reload();
 for(const width of [390,1440])for(const text of [100,200]){
  await page.setViewportSize({width,height:900});await page.evaluate(text=>document.documentElement.style.fontSize=`${text}%`,text);
  for(const {id,side} of games){
   const card=page.locator(`.mini-board-card-link-surface[data-game-id="${id}"]`),matchup=card.locator('.home-card-matchup');
   await expect(matchup).toHaveText('You vs. Horus');
   await expect(matchup.locator(`.player-tone-${side}`)).toHaveText('Horus');
   await expect(matchup.locator(`.player-tone-${side==='p1'?'p2':'p1'}`)).toHaveText('You');
   await expect(matchup.getByRole('img',{name:'Computer player',exact:true})).toHaveCount(1);
   await expect(matchup.locator('.is-disconnected')).toHaveCount(0);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.locator(`.mini-board-card-link-surface[data-game-id="${games[0].id}"]`).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath(`home-manual-${width}-${text}.png`)});
 }
});
