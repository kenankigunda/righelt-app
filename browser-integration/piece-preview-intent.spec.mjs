import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

for(const kind of ['unit','commander','late-unique'])test(`deferred ${kind} previews retain native selection intent and reuse exact queries`,async({page},info)=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async kind=>{
  const {createBoardRuntime}=await import('/apps/web/board/runtime/board-runtime.js');
  const {createEngineBoardAdapter}=await import('/apps/web/board-adapters/engine-board-adapter.js');
  const piece={id:'A',owner:'P1',kind:kind==='unit'?'unit':'commander',position:{row:4,col:2},supplied:true,commanded:true};
  const state={boardSize:10,sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[piece]};
  if(kind==='commander'){
   state.pieces.push({...piece,id:'B',kind:'unit',position:{row:4,col:3}});
   state.artifacts={command:{shortestPathToCommanderByPieceId:{B:[{row:4,col:3},piece.position]}}};
  }
  const blocked={type:'move',actorId:'A',from:piece.position,to:{row:5,col:2},legal:false,blockedReason:'SUPPLY_DESTINATION_UNSUPPLIED'};
  let release,queries=0,phase,started=null;const pending=new Promise(resolve=>{release=resolve;});
  const applied=[],messages=[],adapter=createEngineBoardAdapter(),label=document.querySelector('#preview');
  document.querySelector('#board').addEventListener('pointerdown',()=>{started??=performance.now();},{capture:true});
  const observer=new MutationObserver(()=>{if(started!==null)messages.push({elapsedMs:performance.now()-started,text:label.textContent});});
  observer.observe(label,{childList:true,subtree:true,characterData:true});
  const runtime=createBoardRuntime({boardAdapter:{...adapter,render:view=>{phase=view.selectedPieceOverlayPhase;adapter.render(view);}},
   host:{asyncPieceMoves:true,canSelect:()=>true,canInteract:()=>true,
    loadPieceMoves:()=>{queries++;return pending;},applyAction:async(_state,action)=>{applied.push(action);return{accepted:false};}}});
  runtime.bindElements({boardEl:document.querySelector('#board'),overlayLinesEl:document.querySelector('#lines'),boardPreviewLabelEl:label});
  await runtime.loadSnapshot(state,{legalActions:[]});
  const result=kind==='late-unique'?{state,actions:[{...blocked,legal:true}],previewActions:[{...blocked,legal:true}]}:{state,actions:[],previewActions:[blocked]};
  window.previewIntent={resolve:()=>release(result),
   refresh:()=>runtime.loadSnapshot(structuredClone(state),{legalActions:[],resetSelection:false}),
   repeat:()=>{void runtime.reloadSelectedPieceMoves();},
   read:()=>({queries,phase,selection:runtime.getSelection(),inspection:runtime.getInspection(),applied,messages:structuredClone(messages)})};
 },kind);
 const source=page.locator('#board .cell[data-row="4"][data-col="2"]'),message=page.locator('#preview');
 await source.click();await expect(message).toContainText('Select a move for piece at');
 await expect(message).toHaveAttribute('aria-busy','true');
 await page.evaluate(async()=>{await window.previewIntent.refresh();window.previewIntent.repeat();});
 expect((await page.evaluate(()=>window.previewIntent.read())).queries).toBe(1);
 await expect(message).toContainText('Select a move for piece at');
 const first=await page.evaluate(()=>window.previewIntent.read());
 expect(first.messages.some(row=>row.text.includes('Select a move for piece at'))).toBe(true);
 expect(first.messages.some(row=>/No moves|Supply and command lines/.test(row.text))).toBe(false);
 if(kind==='late-unique'){
  await page.evaluate(()=>window.previewIntent.resolve());await expect(message).not.toHaveAttribute('aria-busy','true');
  await page.evaluate(async()=>{await window.previewIntent.refresh();window.previewIntent.repeat();});
  await expect(message).toContainText('Select a move for piece at');
  const proof=await page.evaluate(()=>window.previewIntent.read());expect(proof.selection.target).toBeNull();expect(proof.queries).toBe(1);expect(proof.applied).toEqual([]);
  const path=info.outputPath('native-preview-intent-proof.json');await writeFile(path,JSON.stringify(proof,null,2));
  await info.attach('late unique result preserves native move intent',{path,contentType:'application/json'});return;
 }
 await source.click();await expect(message).toContainText('Supply and command lines for piece at');
 if(kind==='commander'){
  await source.click();await expect(message).toHaveText('Command lines');
 }
 await page.evaluate(()=>window.previewIntent.resolve());await expect(message).not.toHaveAttribute('aria-busy','true');
 await expect(message).toContainText(kind==='commander'?'Command lines':'Supply and command lines for piece at');
 await source.click();await expect(message).toContainText('Select a move for piece at');
 await page.locator('#board .cell[data-row="0"][data-col="0"]').click();
 await source.click();await expect(message).toContainText('Select a move for piece at');
 const proof=await page.evaluate(()=>window.previewIntent.read());expect(proof.queries).toBe(1);expect(proof.applied).toEqual([]);
 const path=info.outputPath('native-preview-intent-proof.json');await writeFile(path,JSON.stringify(proof,null,2));
 await info.attach('native deferred intent, click-to-message timings and query count',{path,contentType:'application/json'});
});
