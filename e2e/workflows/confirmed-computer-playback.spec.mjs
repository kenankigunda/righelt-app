import {test,expect} from '@playwright/test';
import {waitForOpponentReady,readProjectedGame} from '../support/computer-projection.mjs';
const pieces=page=>page.getByTestId('game-board').evaluate(board=>[...board.querySelectorAll('.cell .piece-token[data-piece-id]:not(.ghost):not(.destruction-piece)')].map(token=>({id:token.dataset.pieceId,row:Number(token.closest('.cell').dataset.row),col:Number(token.closest('.cell').dataset.col)})).sort((a,b)=>a.id.localeCompare(b.id)));
test('computer stays unprojected until confirmation then shows paced movement and releases human control',async({page,context},info)=>{
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push({frequency:this.frequency.value,at:performance.now()});return value;};});
 await page.setViewportSize({width:1440,height:1100});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await created).json()).game;
 await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');await expect(page.getByTestId('game-board')).toBeVisible();
 let release,seen;const held=new Promise(resolve=>release=resolve),submitted=new Promise(resolve=>seen=resolve);let command;
 await context.route('**/apply',async route=>{const body=route.request().postDataJSON();if(body?.payload?.computer&&!command){command=body;seen();await held;}await route.continue();});
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(command),{timeout:30000}).toBe(true);
  const before=await pieces(page);const read=()=>page.evaluate(readProjectedGame,{id:game.id,guest:true});const acknowledged=await read();expect(acknowledged.moves.filter(move=>move.computerProof)).toHaveLength(0);
  await page.evaluate(()=>window.moveNotes=[]);await expect(page.locator('#shell-board-preview-label')).toContainText('saving their move');expect(await pieces(page)).toEqual(before);await expect(page.locator('.computer-replay')).toHaveCount(0);expect(await page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===820))).toHaveLength(0);
  release();await expect(page.locator('.computer-replay')).toBeVisible({timeout:15000});await expect(page.locator('#shell-board-preview-label')).toContainText('making their move');await expect(page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.moveNotes.filter(note=>note.frequency===820).length)).toBe(1);await expect(page.locator('.computer-replay')).toHaveCount(0,{timeout:15000});
  await expect.poll(async()=> (await read()).moves.filter(move=>move.computerProof).length).toBeGreaterThan(0);
  await page.screenshot({path:info.outputPath('confirmed-computer-final.png')});await info.attach('confirmed-computer-command',{body:JSON.stringify({commandId:command.clientCommandId,attemptId:command.payload.computer.attemptId,before}),contentType:'application/json'});
 }finally{release();}
});

test('unseen update chime stays pending through History and Players and stops after live review',async({page,context},info)=>{
 test.setTimeout(90000); // Observe the real 30-second reminder both before and after seeing Live.
 const {switchGamePanel}=await import('../support/app.mjs');
 await page.addInitScript(()=>{window.WebSocket=undefined;window.moveNotes=[];const original=OscillatorNode.prototype.start;OscillatorNode.prototype.start=function(...args){const value=Reflect.apply(original,this,args);window.moveNotes.push({frequency:this.frequency.value,at:performance.now()});return value;};});
 await page.setViewportSize({width:390,height:900});await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();await waitForOpponentReady(page);
 const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');await page.getByRole('button',{name:'Play Babs',exact:true}).click();const game=(await(await created).json()).game;await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
 let release,command;const held=new Promise(resolve=>release=resolve);await context.route('**/apply',async route=>{const body=route.request().postDataJSON();if(body?.payload?.computer&&!command){command=body;await held;}await route.continue();});
 const notes=frequency=>page.evaluate(value=>window.moveNotes.filter(note=>note.frequency===value),frequency);
 try{
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).click();await expect.poll(()=>Boolean(command),{timeout:30000}).toBe(true);
  await switchGamePanel(page,'history');const moveId=await page.getByTestId('history-move-item').first().getAttribute('data-move-id');const row=page.locator(`[data-testid="history-move-item"][data-move-id="${moveId}"]`);await row.locator('.history-item-info').click();await expect(row).toHaveClass(/is-selected/);await page.evaluate(()=>window.moveNotes=[]);
  release();await expect.poll(async()=> (await notes(460)).length,{timeout:15000}).toBe(1);expect(await notes(820)).toHaveLength(0);await expect(page.locator('.computer-replay')).toHaveCount(0);await expect(row).toHaveClass(/is-selected/);
  await switchGamePanel(page,'players');expect(await notes(460)).toHaveLength(1);await expect.poll(async()=> (await notes(460)).length,{timeout:35000}).toBe(2);expect(await notes(820)).toHaveLength(0);
  await switchGamePanel(page,'board');await expect(page.locator('.computer-replay')).toHaveCount(0);const seen=await notes(460);await page.waitForTimeout(31000);expect(await notes(460)).toHaveLength(seen.length);expect(await notes(820)).toHaveLength(0);
  await info.attach('unseen-update-notes',{body:JSON.stringify(await page.evaluate(()=>window.moveNotes)),contentType:'application/json'});await page.screenshot({path:info.outputPath('unseen-update-seen-live.png')});
 }finally{release();}
});
