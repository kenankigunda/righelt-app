import AxeBuilder from '@axe-core/playwright';
import {test,expect} from '@playwright/test';
import {buildAppUrl,closeContextQuietly,createIsolatedPage} from '../support/app.mjs';
import {completeLesson} from '../support/tutorial.mjs';
test('hosted lesson completes with real board input and no game-action network requests',async({browser,baseURL})=>{
 const {context,page}=await createIsolatedPage(browser);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1366,height:1000});
 try {
  await page.goto(buildAppUrl(baseURL,'#/tutorial'));await expect(page.getByTestId('tutorial-board')).toBeVisible();
  const actions=[];page.on('request',r=>{if(/\/api\/games\/.*\/(apply|moves|end-turn)/.test(r.url()))actions.push(r.url());});
  await page.screenshot({path:'test-results/tutorial-initial-wide.png'});
  expect((await new AxeBuilder({page}).include('[data-tutorial-root]').analyze()).violations).toEqual([]);
  await completeLesson(page);await expect(page.locator('[data-lesson-prompt]')).toContainText('well-earned');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'test-results/tutorial-wide.png'});
  await page.locator('[data-lesson-continue]').click();await expect(page).toHaveURL(/#\/$/);
  expect(actions).toEqual([]);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('righelt.lesson.progress.v1')).result)).toBe('completed');
 }finally{await closeContextQuietly(context);}
});
test('phone hints, chapter replay, reduced motion and leaving preserve progress',async({browser,baseURL})=>{
 const {context,page}=await createIsolatedPage(browser);await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 try {await page.goto(buildAppUrl(baseURL,'#/tutorial'));await expect(page.locator('.lesson-host img')).toBeVisible();await expect(page.locator('[data-lesson-hint]')).toBeVisible({timeout:6000});await expect(page.locator('.lesson-target')).toHaveCount(1);
  await expect(page.locator('[data-lesson-skip]')).toBeVisible();await page.locator('[data-lesson-skip]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-lesson-title]')).toBeFocused();
  await page.locator('.lesson-chapters summary').click();await page.locator('[data-lesson-chapter="4"]').click();await expect(page.locator('[data-tutorial-root]')).toHaveAttribute('data-exercise','pass');
  await page.screenshot({path:'test-results/tutorial-phone.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('[data-lesson-skip-all]').click();await expect(page).toHaveURL(/#\/$/);
  await page.goto(buildAppUrl(baseURL,'#/tutorial'));await expect(page.locator('[data-tutorial-root]')).toHaveAttribute('data-exercise','meet');
 }finally{await closeContextQuietly(context);}
});
