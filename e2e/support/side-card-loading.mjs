import {expect} from '@playwright/test';
export const readSideCardAnchors = page => page.evaluate(()=>Object.fromEntries(['summary','join','history'].map(key=>{
 const card=document.querySelector(`[data-game-panel="${key}"]`);if(!card)return [key,null];
 const rectangle=node=>{const r=node.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};};
 const rect=rectangle(card);return [key,{...rect,heading:rectangle(card.querySelector('h2')),
  rows:[...card.querySelectorAll('.section-stack p.small,.participant-list > li,.history-list > li')].map(node=>{const r=rectangle(node);return {y:r.y-rect.y,height:r.height};})}];
})));
export const expectSideCardAnchors = (held,loaded) => {
 for(const key of ['summary','join','history']){
  expect(held[key],`${key} loading card`).toBeTruthy();expect(loaded[key],`${key} loaded card`).toBeTruthy();
  for(const property of ['x','y','width','height'])expect(Math.abs(held[key][property]-loaded[key][property]),`${key} ${property}`).toBeLessThanOrEqual(1);
  expect(loaded[key].rows,`${key} row count`).toHaveLength(held[key].rows.length);
  for(let i=0;i<held[key].rows.length;i++)for(const property of ['y','height'])expect(Math.abs(held[key].rows[i][property]-loaded[key].rows[i][property]),`${key} row${i} ${property}`).toBeLessThanOrEqual(1);
 }
};
