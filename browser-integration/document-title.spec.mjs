import {expect,test} from '@playwright/test';

test('browser title uses concise self-play identity and the local game start date',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');
 const titles=await page.evaluate(async()=>{
  const {documentTitleForRoute}=await import('/apps/web/shell/document-title.js');
  const person=(identityId,displayName)=>({identityId,profile:{displayName},connected:true});
  const started='2026-11-12T20:00:00Z';
  const ordinary={id:'ordinary',createdAt:started,myRole:'Player 1',player1:person('owner','Owner'),player2:person('tau','Tau')};
  const self={id:'self',createdAt:started,myRole:'Both Players',selfPlayMode:true,player1:person('owner','Owner'),player2:person('owner','Owner')};
  const guestSelf={id:'guest-self',createdAt:started,myRole:'Viewer',selfPlayMode:true,player1:{identityId:'guest-owner',connected:true},player2:{identityId:'guest-owner',connected:true}};
  return [
   documentTitleForRoute({routeName:'game',game:ordinary,identityId:'owner'}),
   documentTitleForRoute({routeName:'game',game:self,identityId:'owner'}),
   documentTitleForRoute({routeName:'game',game:guestSelf,identityId:'viewer'}),
  ];
 });
 expect(titles).toEqual([
  'You vs. Tau | Nov 12 | Righelt',
  'You | Nov 12 | Righelt',
  'Guest 1 | Nov 12 | Righelt',
 ]);
 for(const title of titles){await page.evaluate(value=>{document.title=value;},title);await expect(page).toHaveTitle(title);}
});
