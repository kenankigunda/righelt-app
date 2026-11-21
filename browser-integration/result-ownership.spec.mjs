import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/browser-integration/support/result-ownership.html');await page.waitForFunction(()=>window.fixture);});
for(const entry of [
 {name:'self win',values:{},status:'p1_win',automatic:true},
 {name:'self loss',values:{},status:'p2_win',automatic:true},
 {name:'self draw',values:{},status:'draw',automatic:true},
 {name:'opposing human',values:{author:'other'},automatic:false},
 {name:'computer under current owner',values:{kind:'computer'},automatic:false},
 {name:'spectator',values:{viewer:'viewer'},automatic:false},
])test(`${entry.name} uses confirmed author rather than winner for result entry`,async({page})=>{
 await page.evaluate(values=>fixture.setup(values),entry.values);
 await page.evaluate(status=>fixture.finish(status),entry.status??'p1_win');
 if(entry.automatic){await expect(page.locator('h1')).not.toContainText('on Turn');await expect(page.locator('h1')).toBeFocused();}
 else{await expect(page.getByRole('heading',{name:/on Turn 7$/})).toBeVisible();await page.getByRole('button',{name:'View result',exact:true}).click();await expect(page.locator('h1')).not.toContainText('on Turn');await expect(page.locator('h1')).toBeFocused();}
});
test('dialog defers a self result and an account change retires the pending entry',async({page})=>{
 await page.evaluate(()=>{fixture.setup({options:{dialogOpen:true}});fixture.finish();});await expect(page.getByRole('heading',{name:/on Turn 7$/})).toBeVisible();
 await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.getByRole('heading',{name:'You won'})).toBeFocused();
 await page.evaluate(()=>{fixture.setup({options:{dialogOpen:true}});fixture.finish();fixture.identity('other');});
 await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.getByRole('heading',{name:/on Turn 7$/})).toBeVisible();
});
