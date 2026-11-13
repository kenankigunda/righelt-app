import {expect} from '@playwright/test';
export const readSideCardAnchors = page => page.evaluate(()=>Object.fromEntries(['summary','join','history'].map(key=>{
 const card=document.querySelector(`[data-game-panel="${key}"]`);if(!card)return [key,null];
 const rectangle=node=>{const r=node.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};};
 const rect=rectangle(card);return [key,{...rect,heading:rectangle(card.querySelector('h2')),
  rows:[...card.querySelectorAll('.section-stack p.small,.participant-list > li,.history-list > li')].map(node=>{const r=rectangle(node);return {y:r.y-rect.y,height:r.height};})}];
})));
const close=(actual,expected,label)=>expect(Math.abs(actual-expected),label).toBeLessThanOrEqual(1);
const sameRelativeRows=(held,loaded,{offset=0,label})=>{
 expect(loaded,`${label} row count`).toHaveLength(held.length);
 for(let index=0;index<held.length;index++){
  close(loaded[index].height,held[index].height,`${label} row${index} height`);
  close(loaded[index].y-held[index].y,offset,`${label} row${index} offset`);
 }
};
export const expectSideCardColumns = (held,loaded) => {
 for(const key of ['summary','join','history']){
  expect(held[key],`${key} loading card`).toBeTruthy();expect(loaded[key],`${key} loaded card`).toBeTruthy();
  close(loaded[key].x,held[key].x,`${key} x`);close(loaded[key].width,held[key].width,`${key} width`);
  close(loaded[key].heading.x,held[key].heading.x,`${key} heading x`);close(loaded[key].heading.width,held[key].heading.width,`${key} heading width`);
 }
 // A real matchup title can wrap to more lines than the identity-free loading
 // title at 200% text. Classify that one truthful growth and require every
 // downstream Summary/Players measurement to move by exactly the same amount.
 const summaryGrowth=loaded.summary.height-held.summary.height;
 expect(summaryGrowth,'summary growth').toBeGreaterThanOrEqual(0);
 close(loaded.summary.y,held.summary.y,'summary y');
 close(loaded.summary.heading.y,held.summary.heading.y,'summary heading y');
 close(loaded.summary.heading.height-held.summary.heading.height,summaryGrowth,'summary heading growth');
 sameRelativeRows(held.summary.rows,loaded.summary.rows,{offset:summaryGrowth,label:'summary'});
 close(loaded.join.y-held.join.y,summaryGrowth,'players card offset');
 close(loaded.join.heading.y-loaded.join.y,held.join.heading.y-held.join.y,'players heading relative y');
 close(loaded.join.height,held.join.height,'players height');
 sameRelativeRows(held.join.rows,loaded.join.rows,{label:'players'});
 // History loading contains only the truthful live row. Its geometry now maps
 // one-to-one to an untouched hydrated game instead of inventing a first turn.
 for(const property of ['y','height'])close(loaded.history[property],held.history[property],`history ${property}`);
 for(const property of ['y','height'])close(loaded.history.heading[property],held.history.heading[property],`history heading ${property}`);
 sameRelativeRows(held.history.rows,loaded.history.rows,{label:'history'});
};
