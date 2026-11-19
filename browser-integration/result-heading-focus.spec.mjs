import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.goto('/browser-integration/support/result-heading-focus.html');
 await page.waitForFunction(()=>window.fixtureReady);
});

test('a focused result heading survives repeated same-result replacements',async({page})=>{
 const heading=page.getByRole('heading',{name:'You won as Red',exact:true});
 await heading.focus();
 for(let i=0;i<2;i++){
  const old=await heading.elementHandle();
  await page.evaluate(()=>window.resultFocusFixture.replace());
  expect(await old.evaluate(node=>node.isConnected)).toBe(false);
  await expect(heading).toBeFocused();
 }
});

test('a result redraw respects later pointer and keyboard focus intent',async({page})=>{
 const heading=page.getByRole('heading',{name:'You won as Red',exact:true}),outside=page.getByRole('button',{name:'Outside the result',exact:true});
 await heading.focus();await page.evaluate(()=>window.resultFocusFixture.begin());
 await outside.click();await page.evaluate(()=>window.resultFocusFixture.commit());await expect(outside).toBeFocused();
 await heading.focus();await page.evaluate(()=>window.resultFocusFixture.begin());
 await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Review game',exact:true})).toBeFocused();
 await page.evaluate(()=>window.resultFocusFixture.commit());await expect(heading).not.toBeFocused();
});

test('account, game and finish changes retire old result-heading focus',async({page})=>{
 const heading=page.getByRole('heading',{name:'You won as Red',exact:true});
 for(const scope of ['account2/game1/finish1','account1/game2/finish1','account1/game1/finish2']){
  await page.evaluate(()=>window.resultFocusFixture.setScope('account1/game1/finish1'));
  await heading.focus();await page.evaluate(scope=>window.resultFocusFixture.replace(scope),scope);
  await expect(heading).not.toBeFocused();
 }
});
