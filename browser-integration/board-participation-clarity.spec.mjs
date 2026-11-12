import {test,expect} from '@playwright/test';

const point=(row,col)=>({row,col});
const piece=(id,row,col)=>({id,owner:'P1',kind:'unit',position:point(row,col),supplied:true,commanded:true});

async function open(page,{scale=100}={}){
 await page.setViewportSize({width:1000,height:1000});
 await page.goto('/browser-integration/support/board-message.html');
 await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async scale=>{document.documentElement.style.fontSize=`${scale}%`;await document.fonts.ready;await window.boardFixture.setup('follow',false);},scale);
}

const floor=locator=>locator.evaluate(node=>({
 image:getComputedStyle(node).backgroundImage,
 color:getComputedStyle(node).backgroundColor,
 transition:getComputedStyle(node).transitionDuration,
}));

test('marble Board visibly distinguishes remaining Rush and Push/Follow participants',async({page})=>{
 await open(page);
 const configure=continuation=>page.evaluate(async({continuation})=>{
  const p=(id,row,col)=>({id,owner:'P1',kind:'unit',position:{row,col},supplied:true,commanded:true});
  const snapshot={boardSize:10,sideToMove:'P1',turnIndex:0,outcome:{status:'ongoing'},pieces:[p('A',4,2),p('B',4,4),p('C',4,6)],continuation};
  const type=continuation.type==='rush'?'rush':'follow';
  const actions=['B','C'].map((actorId,index)=>({type,actorId,from:{row:4,col:4+index*2},to:{row:5,col:4+index*2}}));
  await window.boardFixture.configure(snapshot,actions);
 },{continuation});
 const cell=(row,col)=>page.locator(`.cell[data-row="${row}"][data-col="${col}"]`);
 const ordinary=cell(0,0);

 await configure({type:'rush',owner:'P1',rushedPieceIds:['A'],rushChainPieceIds:['A']});
 await expect(page.locator('.continuation-moved')).toHaveCount(1);
 await expect(page.locator('.continuation-pending')).toHaveCount(2);
 const [plain,rushed,remaining]=await Promise.all([floor(ordinary),floor(cell(4,2)),floor(cell(4,4))]);
 expect(rushed.image).not.toBe(plain.image);
 expect(remaining.image).not.toBe(plain.image);
 expect(remaining.image).not.toBe(rushed.image);
 for(const painted of [rushed,remaining])expect(painted.image).toContain('marble-white-raster-v2.webp');

 await configure({type:'push',phase:'follow',followGroupPieceIds:['A','B','C']});
 await expect(page.locator('.group-member')).toHaveCount(3);
 await expect(page.locator('.continuation-pending')).toHaveCount(2);
 const [waiting,eligible]=await Promise.all([floor(cell(4,2)),floor(cell(4,4))]);
 expect(waiting.image).not.toBe(plain.image);
 expect(eligible.image).not.toBe(waiting.image);
 for(const painted of [waiting,eligible])expect(painted.image).toContain('marble-white-raster-v2.webp');

 // Regression control: the old opaque marble layer made both participation
 // washes compute to the ordinary square image even though classes were right.
 await page.addStyleTag({content:'.cell:is(.group-member,.continuation-moved,.continuation-pending){--cell-floor-image:var(--marble-face,none)!important}'});
 expect((await floor(cell(4,4))).image).toBe(plain.image);

 await page.emulateMedia({reducedMotion:'reduce'});
 expect((await floor(cell(4,4))).transition).toBe('0s');
 await page.emulateMedia({forcedColors:'active'});
 await expect(cell(4,2)).toHaveCSS('border-style','dashed');
 await expect(cell(4,4)).toHaveCSS('outline-style','solid');
});

for(const scale of [100,200])test(`selected coordinate labels use a fixed readable box at ${scale}% text`,async({page})=>{
 await open(page,{scale});
 const selected=page.locator('.cell[data-row="4"][data-col="2"]');
 const adjacentRow=page.locator('.row-axis').nth(5),adjacentCol=page.locator('.col-axis').nth(3);
 const before=await Promise.all([adjacentRow.boundingBox(),adjacentCol.boundingBox()]);
 await selected.click();
 const row=page.locator('.axis-strong.row-axis'),col=page.locator('.axis-strong.col-axis');
 await expect(row).toHaveCount(1);await expect(col).toHaveCount(1);
 const geometry=await page.evaluate(()=>{
  const selected=document.querySelector('.cell.selected-piece').getBoundingClientRect();
  const row=document.querySelector('.axis-strong.row-axis'),col=document.querySelector('.axis-strong.col-axis');
  const normalRow=[...document.querySelectorAll('.row-axis')].find(node=>node!==row),normalCol=[...document.querySelectorAll('.col-axis')].find(node=>node!==col);
  const read=node=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return{x:box.x,y:box.y,width:box.width,height:box.height,fontSize:parseFloat(style.fontSize),fontWeight:style.fontWeight,centerX:box.x+box.width/2,centerY:box.y+box.height/2};};
  return{selected:{centerX:selected.x+selected.width/2,centerY:selected.y+selected.height/2},row:read(row),col:read(col),normalRow:read(normalRow),normalCol:read(normalCol)};
 });
 expect(geometry.row.fontWeight).toBe('400');expect(geometry.col.fontWeight).toBe('400');
 expect(geometry.row.fontSize).toBeGreaterThan(geometry.normalRow.fontSize);expect(geometry.col.fontSize).toBeGreaterThan(geometry.normalCol.fontSize);
 expect({width:geometry.row.width,height:geometry.row.height}).toEqual({width:geometry.normalRow.width,height:geometry.normalRow.height});
 expect({width:geometry.col.width,height:geometry.col.height}).toEqual({width:geometry.normalCol.width,height:geometry.normalCol.height});
 expect(Math.abs(geometry.row.centerY-geometry.selected.centerY)).toBeLessThanOrEqual(.5);
 expect(Math.abs(geometry.col.centerX-geometry.selected.centerX)).toBeLessThanOrEqual(.5);
 const after=await Promise.all([adjacentRow.boundingBox(),adjacentCol.boundingBox()]);
 expect(after).toEqual(before);
});
