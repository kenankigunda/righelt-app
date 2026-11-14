import {expect,test} from '@playwright/test';

const open=async page=>{
 await page.goto('/browser-integration/support/board-message.html');
 await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>window.boardFixture.setup('pass',false));
};

const publishHistoryMessage=async(page,{completed})=>page.evaluate(async completed=>{
 const {historyBoardRuntimeMessage}=await import('/apps/web/shell/playback-presentation.js');
 const terminal={sideToMove:'P2',turnIndex:5,outcome:{status:'p1_win',reason:'p2_commander_destroyed'},pieces:[]};
 const action={type:'push',actorId:'winner',from:{row:8,col:2},to:{row:9,col:2}};
 const decisive={moveId:'final',index:0,displayMoveNumber:18,turnIndex:4,turnMoveIndex:0,actorSide:'P1',clientCommandId:'v2:final',action,selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:terminal,destroyedPieces:[{pieceId:'c2',kind:'commander',position:{row:9,col:2},ownerSeat:'p2'}]};
 const game={id:'completed',gameplayRevision:7,inHistoryMode:true,historyIndex:null,historyTurnIndex:completed?4:null,historyTurnMoves:completed?[decisive]:[],inspectedDecision:null,moves:completed?[decisive]:[],turns:completed?[{index:4,playerSeat:'Player 1',status:'complete',endedAt:'terminal',moveIndexes:[0]}]:[],player1:{identityId:'me'},player2:{identityId:'other'},board:{state:completed?terminal:{...terminal,outcome:{status:'ongoing'}}},currentSnapshot:terminal,terminalOutcome:completed?{version:1,decisive:{action,actorSide:'P1',decisionId:'final',clientCommandId:'v2:final',turnIndex:4},board:structuredClone(terminal),result:terminal.outcome,removals:structuredClone(decisive.destroyedPieces),cause:{kind:'relevant-continuation-finality',endpointCount:2,optionalEndpointCount:1},commit:{eventSeq:9,gameplayRevision:7,clientCommandId:'v2:final'},lineage:{version:1,complete:true,importedMoveCount:0,sources:[]},activeActionCount:18,activeActionCountComplete:true}:null};
 window.boardFixture.message(historyBoardRuntimeMessage(game,{}, {identityId:'me'}));
},completed);

test('completed decisive History renders one semantic Board message',async({page})=>{
 await open(page);
 await publishHistoryMessage(page,{completed:true});
 await expect(page.getByText('You won in 18 moves',{exact:false})).toBeVisible();
 await expect(page.locator('#preview')).toBeHidden();
 expect(await page.locator('body').ariaSnapshot()).not.toContain('Choose a move in History');
});

test('empty History retains actionable guidance when it has no semantic owner',async({page})=>{
 await open(page);
 await publishHistoryMessage(page,{completed:false});
 await expect(page.locator('#preview')).toBeVisible();
 await expect(page.locator('#preview')).toHaveText('Choose a move in History');
 await expect(page.locator('#fixture-context .board-context-notice')).toHaveCount(0);
});
