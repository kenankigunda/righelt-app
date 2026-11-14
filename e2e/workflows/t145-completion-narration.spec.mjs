import {test,expect} from '@playwright/test';

const fixture={
 id:'t145-render',gameplayRevision:7,myRole:'Player 1',myRoles:['Player 1'],
 player1:{identityId:'me',profile:{displayName:'Horus'}},player2:{identityId:'other',profile:{displayName:'Guest'}},
 board:{state:{outcome:{status:'p1_win',reason:'p2_commander_destroyed'},pieces:[]}},
 terminalOutcome:{version:1,decisive:{action:{type:'push',actorId:'u1',from:{row:8,col:2},to:{row:9,col:2}},actorSide:'P1',decisionId:'final',clientCommandId:'v2:final',turnIndex:4},
  board:{outcome:{status:'p1_win',reason:'p2_commander_destroyed'},pieces:[]},result:{status:'p1_win',reason:'p2_commander_destroyed'},
  removals:[{pieceId:'c2',kind:'commander',position:{row:9,col:2},ownerSeat:'p2',supplied:false,commanded:false,reason:'commander_unsupplied'}],
  cause:{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},commit:{eventSeq:9,gameplayRevision:7,clientCommandId:'v2:final'},
  lineage:{version:1,complete:true,importedMoveCount:1,sources:[{gameId:'source',gameplayRevision:3,moveCount:1}]},activeActionCount:2,activeActionCountComplete:true},
 importedHistory:{version:1,complete:true,moveCount:1,sources:[{gameId:'source',gameplayRevision:3,moveCount:1}]},
 moves:[
  {moveId:'imported-one',index:0,turnIndex:3,turnMoveIndex:0,actorSide:'P2',action:{type:'pass'},destroyedPieces:[],importedFrom:{gameId:'source',decisionId:'source-one',gameplayRevision:3}},
  {moveId:'final',index:1,turnIndex:4,turnMoveIndex:0,actorSide:'P1',clientCommandId:'v2:final',action:{type:'push',actorId:'u1',from:{row:8,col:2},to:{row:9,col:2}},destroyedPieces:[{pieceId:'c2',kind:'commander',position:{row:9,col:2},ownerSeat:'p2',supplied:false,commanded:false,reason:'commander_unsupplied'}]},
 ],
};

for(const width of [390,1440])test(`production completion narration stays readable at 200 percent and ${width}px`,async({page},info)=>{
 test.skip(info.project.name!=='chromium','One production-rendered engine is proportionate for this presentation contract.');
 await page.setViewportSize({width,height:900});await page.goto('/shell/completion-narration.js');
 await page.setContent('<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/shell/shell.css"><link rel="stylesheet" href="/shell/board-ux.css"><link rel="stylesheet" href="/shell/incoming-narration.css"><main data-testid="t145-production-fixture"></main>');
 const text=await page.evaluate(async game=>{
  const [{completedOutcomeNarration},{renderBoardContext},{createBoardContextLayout}]=await Promise.all([
   import('/shell/completion-narration.js'),import('/shell/board-context.js'),import('/shell/board-context-layout.js'),
  ]);
  const message=completedOutcomeNarration(game,{identityId:'me'});
  document.documentElement.style.fontSize='200%';
  const host=document.querySelector('[data-testid="t145-production-fixture"]');
  host.innerHTML=renderBoardContext({key:'t145',gameId:game.id,message,mandatory:false});
  const layout=createBoardContextLayout(document);layout.sync();window.__t145Layout=layout;return message.text;
 },fixture);
 expect(text).toBe('You won in 2 moves. Their push to (9, 2) destroyed Guest’s commander.');
 const host=page.getByTestId('t145-production-fixture'),body=host.locator('.board-context-body');await expect(host).toBeVisible();await expect(body).toContainText('You won in 2 moves.');
 await expect(host.locator('.player-tone-p1')).toContainText('You won in 2 moves.');
 await expect(host.locator('.player-tone-p2')).toContainText('Guest’s commander');
 await expect(host.locator('.board-preview-coordinate-chip-neutral')).toHaveText('9, 2');
 const geometry=await body.evaluate(element=>({horizontal:element.scrollWidth-element.clientWidth,height:element.getBoundingClientRect().height,scrollable:element.scrollHeight>element.clientHeight,focusable:element.tabIndex===0}));
 expect(geometry.horizontal).toBeLessThanOrEqual(1);expect(geometry.height).toBeGreaterThan(0);expect(geometry.height).toBeLessThan(200);expect(geometry.focusable).toBe(geometry.scrollable);
 if(width===390){expect(geometry.scrollable).toBe(true);await expect(host.locator('.board-context-scroll-cue')).toBeVisible();}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 if(geometry.scrollable){await body.focus();await expect(body).toBeFocused();}
 else{const dismiss=host.getByRole('button',{name:'Dismiss Board context'});await dismiss.focus();await expect(dismiss).toBeFocused();}
 await host.screenshot({path:info.outputPath(`t145-completion-${width}-200-percent.png`)});
});
