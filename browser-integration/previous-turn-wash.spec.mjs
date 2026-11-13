import {test,expect} from '@playwright/test';

const floor=locator=>locator.evaluate(node=>({
 image:getComputedStyle(node).backgroundImage,
 color:getComputedStyle(node).backgroundColor,
 border:getComputedStyle(node).borderTopStyle,
 weight:getComputedStyle(node).getPropertyValue('--previous-turn-weight').trim(),
}));

test('native Board paints previous-turn source, target and deletion washes above marble',async({page},info)=>{
 await page.goto('/browser-integration/support/board-message.html');
 await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  await window.boardFixture.setup('pass',false);
  const {createEngineBoardAdapter}=await import('/apps/web/board-adapters/engine-board-adapter.js');
  const adapter=createEngineBoardAdapter(),boardEl=document.querySelector('#board');
  const legend=document.createElement('div');legend.className='overlay-key';legend.setAttribute('aria-label','Board legend');legend.innerHTML='<span data-legend-entry="previousTurn" hidden><i class="previous-turn-key-swatch" aria-hidden="true"></i><span>Previous turn</span></span>';document.querySelector('main').append(legend);
  adapter.mount({boardEl,overlayLinesEl:document.querySelector('#lines'),onCellClick:()=>{}});
  adapter.render({
   snapshot:{boardSize:10,sideToMove:'P2',turnIndex:1,continuation:null,outcome:{status:'ongoing'},pieces:[]},
   selection:{selectedPieceId:null,source:null,target:null},
   overlay:{mode:'previous-turn',presentationContext:'previous-turn',previousTurnCells:[
    {row:4,col:2,source:true,target:false,side:'P1',deletionSide:null},
    {row:4,col:3,source:false,target:true,side:'P1',deletionSide:null},
    {row:4,col:4,source:false,target:false,side:'P1',deletionSide:'P2'},
   ]},
   legalActions:[],selectedPieceMoves:[],interactionMode:'interactive',
  });
 });
 await page.evaluate(async()=>{const {updatePreviousTurnLegend}=await import('/apps/web/legend.js');updatePreviousTurnLegend(document.querySelector('.overlay-key'),document.querySelector('#board'),{sideToMove:'P2'},true);});
 const key=page.locator('.overlay-key [data-legend-entry="previousTurn"]'),swatch=key.locator('.previous-turn-key-swatch');
 await expect(key).toBeVisible();await expect(key).toHaveText('Previous turn');await expect(swatch).toHaveAttribute('aria-hidden','true');
 const keyPaint=await swatch.evaluate(node=>{const style=getComputedStyle(node),root=getComputedStyle(document.documentElement),rect=node.getBoundingClientRect();return {width:rect.width,height:rect.height,weight:style.getPropertyValue('--previous-turn-weight').trim(),owner:style.getPropertyValue('--previous-turn-color').trim(),expectedOwner:root.getPropertyValue('--player-p1').trim(),image:style.backgroundImage,shadow:style.boxShadow};});
 expect(keyPaint).toMatchObject({width:20,height:20,weight:'17%'});expect(keyPaint.owner).toBe(keyPaint.expectedOwner);expect(keyPaint.image).toContain('linear-gradient');expect(keyPaint.image).toContain('marble-white-raster-v2.webp');expect(keyPaint.shadow).not.toBe('none');
 const cell=(row,col)=>page.locator(`#board .cell[data-row="${row}"][data-col="${col}"]`);
 const [plain,source,target,deletion]=await Promise.all([floor(cell(0,0)),floor(cell(4,2)),floor(cell(4,3)),floor(cell(4,4))]);
 for(const painted of [source,target,deletion]){
  expect(painted.image).toContain('linear-gradient');
  expect(painted.image).toContain('marble-white-raster-v2.webp');
  expect(painted.image).not.toBe(plain.image);
  expect(painted.border).toBe(plain.border);
 }
 expect(source.weight).toBe('7%');expect(deletion.weight).toBe('7%');expect(target.weight).toBe('17%');expect(plain.weight).toBe('');
 expect(source.image).not.toBe(target.image);
 expect(source.image).not.toBe(deletion.image);
 await page.screenshot({path:info.outputPath('previous-turn-washes.png')});

 const weakened=await page.addStyleTag({content:'[data-presentation-context="previous-turn"] .cell.previous-turn-target{--previous-turn-weight:7%!important}'});
 expect((await floor(cell(4,3))).image).toBe((await floor(cell(4,2))).image);
 await weakened.evaluate(node=>node.remove());
 expect((await floor(cell(4,3))).weight).toBe('17%');

 await page.emulateMedia({forcedColors:'active'});const forced=await swatch.evaluate(node=>{const style=getComputedStyle(node);return {border:style.borderTopStyle,borderWidth:style.borderTopWidth,shadow:style.boxShadow};});expect(forced).toMatchObject({border:'solid',borderWidth:'1px',shadow:'none'});await page.emulateMedia({forcedColors:'none'});

 // Regression control: an opaque marble-only top layer makes all four floors
 // compute identically even though the semantic role classes remain present.
 await page.addStyleTag({content:'[data-presentation-context="previous-turn"] .cell.previous-turn-source,[data-presentation-context="previous-turn"] .cell.previous-turn-target,[data-presentation-context="previous-turn"] .cell.previous-turn-deletion{--cell-floor-image:var(--marble-face,none)!important}'});
 expect((await floor(cell(4,2))).image).toBe(plain.image);
 expect((await floor(cell(4,3))).image).toBe(plain.image);
 expect((await floor(cell(4,4))).image).toBe(plain.image);
 await page.evaluate(async()=>{document.querySelector('#board').setAttribute('data-presentation-context','default');const {updatePreviousTurnLegend}=await import('/apps/web/legend.js');updatePreviousTurnLegend(document.querySelector('.overlay-key'),document.querySelector('#board'),{sideToMove:'P2'},true);});
 await expect(key).toBeHidden();
});
