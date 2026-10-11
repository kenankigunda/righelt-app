import {expect} from '@playwright/test';
import {TUTORIAL_CHAPTERS} from '../../apps/web/shell/tutorial-lessons.js';
const cell=(page,p)=>page.locator(`[data-testid="tutorial-board"] .cell[data-row="${p.row}"][data-col="${p.col}"]`);
export async function completeLesson(page){
 for(const chapter of TUTORIAL_CHAPTERS)for(const e of chapter.exercises){
  await expect(page.locator('[data-tutorial-root]')).toHaveAttribute('data-exercise',e.id);
  await expect(page.locator('[data-tutorial-root]')).toHaveAttribute('data-phase','exercise');
  if(e.inspect){const s=e.position(),p=s.pieces.find(p=>p.id===e.inspect);await cell(page,p.position).click();await cell(page,p.position).click();}
  else if(e.endTurn)await page.locator('[data-lesson-end]').click();
  else if(e.action.type==='pass')await page.locator('[data-lesson-pass]').click();
  else {if(!await cell(page,e.action.from).evaluate(n=>n.classList.contains("selected-piece")))await cell(page,e.action.from).click();await cell(page,e.action.to).click();if(await page.locator('[data-tutorial-root]').getAttribute('data-phase')==='exercise')await cell(page,e.action.to).click();}
  await expect(page.locator('[data-tutorial-root]')).toHaveAttribute('data-phase','success');
  if(e.hold)await page.locator('[data-lesson-continue]').click();
 }
 await expect(page.locator('[data-tutorial-root]')).toHaveAttribute('data-phase','complete');
}
