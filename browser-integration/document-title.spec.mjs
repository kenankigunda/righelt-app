import {expect,test} from '@playwright/test';

test('browser title uses approved participant identities and canonical local dayparts',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');
 const titles=await page.evaluate(async()=>{
  const {documentTitleForRoute}=await import('/apps/web/shell/document-title.js');
  const person=(identityId,displayName)=>({identityId,profile:{displayName},connected:true});
  const started='2026-11-12T20:00:00Z';
  const ordinary={id:'ordinary',createdAt:started,myRole:'Player 1',player1:person('owner','Owner'),player2:person('tau','Tau')};
  const self={id:'self',createdAt:started,myRole:'Both Players',selfPlayMode:true,player1:person('owner','Owner'),player2:person('owner','Owner')};
  const guestSelf={id:'guest-self',createdAt:started,myRole:'Viewer',selfPlayMode:true,player1:{identityId:'guest-owner',connected:true},player2:{identityId:'guest-owner',connected:true}};
  return [
   documentTitleForRoute({routeName:'game',game:ordinary,identityId:'owner',timeZone:'UTC'}),
   documentTitleForRoute({routeName:'game',game:self,identityId:'owner',timeZone:'UTC'}),
   documentTitleForRoute({routeName:'game',game:guestSelf,identityId:'viewer',timeZone:'UTC'}),
  ];
 });
 expect(titles).toEqual([
  'vs. Tau | Nov 12 evening | Righelt',
  'You | Nov 12 evening | Righelt',
  'Guest 1 | Nov 12 evening | Righelt',
 ]);
 for(const title of titles){await page.evaluate(value=>{document.title=value;},title);await expect(page).toHaveTitle(title);}
});

test('focus after a timezone change refreshes title and visible game date together',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');
 await page.evaluate(async()=>{
  const [{documentTitleForRoute},{createViewerTimeZoneRefresh,renderGameDateInlay}]=await Promise.all([import('/apps/web/shell/document-title.js'),import('/apps/web/shell/game-date-inlay.js')]);
  const person=(identityId,displayName)=>({identityId,profile:{displayName},connected:true}),game={id:'ordinary',createdAt:'2026-11-14T07:30:00Z',myRole:'Player 1',player1:person('owner','Owner'),player2:person('tau','Tau')};
  let zone='America/Los_Angeles';
  const publish=()=>{document.title=documentTitleForRoute({routeName:'game',game,identityId:'owner',timeZone:zone});document.querySelector('main').insertAdjacentHTML('afterbegin',`<div id="date-refresh">${renderGameDateInlay(game.createdAt,{locale:'en-US',timeZone:zone})}</div>`);};
  publish();
  const owner=createViewerTimeZoneRefresh({readTimeZone:()=>zone,onChange:()=>{document.querySelector('#date-refresh').remove();publish();}});
  window.addEventListener('focus',()=>owner.reconcile());
  window.setTitleZone=value=>{zone=value;window.dispatchEvent(new Event('focus'));};
 });
 await expect(page).toHaveTitle('vs. Tau | Nov 13 night | Righelt');
 await expect(page.locator('#date-refresh svg')).toHaveAttribute('aria-label',/November 13, 2026.*night/);
 await page.evaluate(()=>window.setTitleZone('Asia/Tokyo'));
 await expect(page).toHaveTitle('vs. Tau | Nov 14 afternoon | Righelt');
 await expect(page.locator('#date-refresh svg')).toHaveAttribute('aria-label',/November 14, 2026.*afternoon/);
});
