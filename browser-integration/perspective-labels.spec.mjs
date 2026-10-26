import {test,expect} from '@playwright/test';

for(const width of [320,390])for(const zoom of [1,2])test(`perspective turn labels retain geometry and full names at ${width}px and ${zoom*100}% text`,async({page})=>{
 await page.setViewportSize({width,height:800});
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async zoom=>{
  const {renderBoardHeadingSlot}=await import('/apps/web/shell/board-message-layout.js');
  const {boardTurnCaption}=await import('/apps/web/shell/perspective-labels.js');
  const {createBoardRuntime}=await import('/apps/web/board/runtime/board-runtime.js');
  document.documentElement.style.fontSize=`${16*zoom}px`;document.body.style.padding='0';document.querySelector('#app').classList.add('app-root');await document.fonts.ready;await window.boardFixture.setup('pass',false);
  document.querySelector('main > h2').outerHTML=renderBoardHeadingSlot({loading:true});
  window.captionGeometry=()=>{const r=document.querySelector('#board').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
  window.loadingCaptionGeometry=window.captionGeometry();
  document.querySelector('.board-heading-slot').outerHTML=renderBoardHeadingSlot();
  let game,identityId;
  const runtime=createBoardRuntime({boardAdapter:{mount(){},render(){},getSelectedPieceSummary:()=>null},host:{canInteract:()=>false},controls:{getTurnIndicator:state=>boardTurnCaption(game,state,{identityId})}});
  runtime.bindElements({boardEl:document.querySelector('#board'),overlayLinesEl:document.querySelector('#lines'),boardTurnIndicatorEl:document.querySelector('#shell-board-turn-indicator')});
  window.showPerspective=async(kind,side)=>{
   game={myRole:kind==='spectator'?'Viewer':'Player 1',player1:{identityId:'red'},player2:{identityId:kind==='self'?'red':'blue'},selfPlayMode:kind==='self'};identityId='red';
   if(kind==='spectator')game.player1.profile={displayName:'石と風 Éléonore Λόγος 🌒 '.repeat(5)};
   await runtime.loadSnapshot({sideToMove:side,pieces:[],outcome:{status:'ongoing'}},{legalActions:[]});
  };
 },zoom);
 for(const [kind,side,caption] of [['player','P1','Your turn to play'],['player','P2','Opponent to play'],['self','P2','Your turn to play'],['spectator','P1','石と風']]){
  await page.evaluate(([kind,side])=>window.showPerspective(kind,side),[kind,side]);
  await expect(page.locator('#shell-board-turn-indicator')).toContainText(caption);
  expect(await page.evaluate(()=>window.captionGeometry())).toEqual(await page.evaluate(()=>window.loadingCaptionGeometry));
  const overflow=await page.evaluate(()=>({boxes:['html','body','#app','main','.board-heading-slot','.board-heading','#shell-board-turn-indicator'].map(selector=>{const e=document.querySelector(selector),c=getComputedStyle(e),r=e.getBoundingClientRect();return {selector,x:r.x,width:r.width,scroll:e.scrollWidth,display:c.display,padding:c.padding,margin:c.margin,widthCss:c.width,min:c.minWidth,boxSizing:c.boxSizing,grid:c.gridTemplateColumns};}),width:innerWidth,scroll:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width,display:getComputedStyle(el).display,min:getComputedStyle(el).minWidth,whiteSpace:getComputedStyle(el).whiteSpace})).slice(0,8)}));
  expect(overflow.scroll,JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
 }
 const name=page.locator('.board-turn-name');
 await expect(name).toHaveAttribute('title',await name.textContent());
 expect(await name.evaluate(element=>element.scrollWidth>element.clientWidth)).toBe(true);
 const suffix=page.locator('#shell-board-turn-indicator > :last-child');await expect(suffix).toHaveText(' to play');
 expect(await suffix.evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})).toBe(true);
 await expect(page.locator('#shell-board-turn-indicator')).toHaveClass(/player-tone-p1/);
 const screenshotPath=test.info().outputPath('long-name-perspective.png');await page.screenshot({path:screenshotPath});await test.info().attach('long-name-perspective',{path:screenshotPath,contentType:'image/png'});
});
