import {test,expect} from '@playwright/test';
import {settledMessage,measureSemanticGeometry,assertSemanticGeometry} from './support/message-semantic-geometry.mjs';
import {readFileSync} from 'node:fs';
const state=JSON.parse(readFileSync('apps/web/scenarios/catalog.json','utf8')).scenarios.find(s=>s.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState;

async function open(page, {width=1200, hold=false}={}) {
  await page.setViewportSize({width,height:1000});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async({state,hold})=>{
    const {listLegalActions,analyzeRushSupplyGuidance}=await import('/apps/web/generated/packages/game-engine/src/index.js');
    const options=hold?{rushGuidanceClient:{
      analyze(snapshot){return new Promise((resolve,reject)=>{window.finishGuidance=()=>resolve(analyzeRushSupplyGuidance(snapshot));window.failGuidance=()=>reject(new Error('unavailable'));});},cancel(){},destroy(){},
    }}:{};
    await window.boardFixture.setup('rush',false,options);
    await window.boardFixture.configure(state,listLegalActions(state));
  },{state,hold});
}

for (const width of [390,1200]) test(`obligatory supply guidance preserves choices and fits at ${width}px`,async({page},info)=>{
  await open(page,{width});
  const pill=page.locator('#preview .board-obligatory-pill');
  await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await expect(page.locator('.cell.selected-piece')).toHaveAttribute('data-row','6');
  await expect(page.locator('.cell.selected-piece')).toHaveAttribute('data-col','4');
  await expect(pill).toHaveCount(0);
  const target=page.locator('.rush-guidance-target');
  await expect(target).toHaveCount(1);await expect(target).toHaveAttribute('data-row','7');await expect(target).toHaveAttribute('data-col','5');
  await target.click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Restores required supply');
  await expect(pill).toHaveCount(0);
  await expect(page.locator('#preview .board-message-row')).toHaveCount(0);
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Restores required supply');
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>innerWidth).map(el=>({tag:el.tagName,id:el.id,cls:el.className,right:el.getBoundingClientRect().right})).slice(0,10)}));
  expect(geometry.scroll,JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.width);
  await page.screenshot({path:info.outputPath(`obligatory-supply-${width}.png`)});
  // Selecting another legal actor reveals its destinations without claiming
  // those moves are necessary for supply restoration.
  await page.locator('.cell[data-row="4"][data-col="6"]').click();
  await expect(page.locator('.rush-guidance-other')).toHaveCount(1);
  await expect(page.locator('.rush-guidance-target')).toHaveCount(0);
  await expect(page.locator('.rush-guidance-other')).toHaveAttribute('aria-label',/Other legal rush/);
  const applied=await page.evaluate(()=>window.boardFixture.applied().length);
  await page.locator('.rush-guidance-other').click();
  await expect.poll(()=>page.evaluate(()=>window.boardFixture.applied().length)).toBe(applied+1);
});

test('background completion preserves manual selection and failure restores existing guidance',async({page})=>{
  await open(page,{hold:true});
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Finding rushes that restore supply');
  const globalCopy=await page.locator('#preview').textContent();
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  expect(await page.locator('#preview .board-obligatory-pill').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(117, 69, 6)');
  await page.locator('.cell[data-row="4"][data-col="6"]').hover();
  await expect(page.locator('.cell.selected-piece')).toHaveCount(0);
  await expect(page.locator('#preview')).toHaveText(globalCopy);
  await page.locator('.cell[data-row="4"][data-col="6"]').click();
  await page.evaluate(()=>window.finishGuidance());
  await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await expect(page.locator('.cell.selected-piece')).toHaveAttribute('data-row','4');
  await expect(page.locator('.cell.selected-piece')).toHaveAttribute('data-col','6');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveCount(0);
  await open(page,{hold:true});await page.evaluate(()=>window.failGuidance());
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Rush to restore supply for piece at 7, 1');
  await expect(page.locator('[data-board-context] .board-context-body .board-preview-coordinate-chip')).toHaveText('7, 1');
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Hints unavailable');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await expect(page.locator('.continuation-pending')).toHaveCount(5);
  await page.evaluate(()=>{window.previousFinishGuidance=window.finishGuidance;});
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.finishGuidance!==window.previousFinishGuidance)).toBe(true);
  await page.evaluate(()=>window.finishGuidance());
  await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await expect(page.locator('.cell.selected-piece')).toHaveCount(1);
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveCount(0);
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
});

for (const [width,fontScale] of [[390,100],[390,200],[1200,100]]) test(`multiple useful sources and multi-step previews at ${width}px / ${fontScale}%`,async({page},info)=>{
  await open(page,{width});
  await page.evaluate(async scale=>{document.documentElement.style.fontSize=`${scale}%`;await document.fonts.ready;},fontScale);
  await page.evaluate(async()=>{
    const piece=(id,owner,kind,row,col)=>({id,owner,kind,position:{row,col},supplied:true,commanded:true});
    const pieces=[piece('C1','P1','commander',2,8),piece('C2','P2','commander',9,0),piece('X','P1','unit',7,1),piece('Y','P1','unit',8,2),piece('A','P1','unit',4,5),piece('B','P1','unit',3,5),piece('C','P1','unit',4,7),...[[0,4],[9,4],[5,0],[5,9],[4,4],[5,8]].map(([r,c],i)=>piece(`E${i}`,'P2','unit',r,c))];
    const snapshot={boardSize:10,sideToMove:'P1',turnIndex:1,outcome:{status:'ongoing'},pieces,continuation:{type:'rush',owner:'P1',chainLength:1,frozenOwner:'P1',rushedPieceIds:['X'],rushChainPieceIds:['X','Y'],frozenPieceStatesById:Object.fromEntries(pieces.filter(p=>p.owner==='P1').map(p=>[p.id,{supplied:true,commanded:p.id!=='C1'}]))}};
    const {listLegalActions}=await import('/apps/web/generated/packages/game-engine/src/index.js');
    await window.boardFixture.configure(snapshot,listLegalActions(snapshot));
  });
  await expect(page.locator('.rush-guidance-source')).toHaveCount(3);
  await expect(page.locator('.cell.selected-piece')).toHaveCount(0);
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('pieces at 7, 1, 8, 2');
  await settledMessage(page,{publishedManagedHeight:info.project.name==='webkit'});const before=await measureSemanticGeometry(page);
  await page.locator('.cell[data-row="4"][data-col="5"]').click();
  await expect(page.locator('.rush-guidance-target')).toHaveCount(3);
  await page.locator('.cell[data-row="3"][data-col="4"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Restores required supply after further rushes');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveCount(0);
  await settledMessage(page,{publishedManagedHeight:info.project.name==='webkit'});assertSemanticGeometry(before,await measureSemanticGeometry(page));
  await page.screenshot({path:info.outputPath('multiple-supply-options.png')});
  await page.locator('.cell[data-row="0"][data-col="0"]').click();
  await expect(page.locator('.cell.selected-piece')).toHaveCount(0);
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('pieces at 7, 1, 8, 2');
  await settledMessage(page,{publishedManagedHeight:info.project.name==='webkit'});expect(await measureSemanticGeometry(page)).toEqual(before);
});

test('obligatory message retains inactive-piece and blocked-destination explanations',async({page})=>{
  await open(page);await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await page.locator('.cell[data-row="6"][data-col="0"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Cannot move: no command at start of rush');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await expect(page.locator('[data-board-context] .board-preview-coordinate-chip-rush-blocker')).toHaveText('7, 1');
  await expect(page.locator('[data-board-context] .board-context-dismiss')).toHaveCount(0);
  await page.locator('.cell[data-row="6"][data-col="4"]').click();
  await page.locator('.cell[data-row="7"][data-col="3"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Destination would have no supply');
  await expect(page.locator('#preview .board-obligatory-pill')).toHaveText('Obligatory');
  await expect(page.locator('[data-board-context] .board-preview-coordinate-chip-rush-blocker')).toHaveText('7, 1');
  await expect(page.locator('[data-board-context] .board-context-dismiss')).toHaveCount(0);
  expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
});

for (const fontScale of [100,200]) test(`touch confirmation stays put across guidance choices at ${fontScale}% text`,async({page})=>{
  await open(page,{width:390});
  await page.evaluate(async fontScale=>{
    document.documentElement.style.fontSize=`${fontScale}%`;await document.fonts.ready;
    const {scenarios}=await(await fetch('/apps/web/scenarios/catalog.json')).json();
    const snapshot=structuredClone(scenarios.find(s=>s.id==='bc6fb68f-7b20-4be5-a717-086ff15ec15f').initialState);
    const {listLegalActions}=await import('/apps/web/generated/packages/game-engine/src/index.js');
    await window.boardFixture.configure(snapshot,listLegalActions(snapshot));
  },fontScale);
  await expect(page.locator('.rush-guidance-source')).toHaveCount(1);
  await settledMessage(page);const before=await measureSemanticGeometry(page);
  await page.locator('.cell[data-row="6"][data-col="0"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Cannot move: no command at start of rush');
  await settledMessage(page);assertSemanticGeometry(before,await measureSemanticGeometry(page));
  await page.locator('.cell[data-row="6"][data-col="4"]').click();
  await page.locator('.cell[data-row="7"][data-col="3"]').click();
  await expect(page.locator('[data-board-context] .board-context-body')).toContainText('Destination would have no supply');
  await settledMessage(page);assertSemanticGeometry(before,await measureSemanticGeometry(page));
});
