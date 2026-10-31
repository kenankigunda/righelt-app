import {test,expect} from '@playwright/test';

for(const width of [390,1440])test(`Players audience hierarchy, native disclosure and focus at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/browser-integration/support/players-viewers.html');await page.waitForFunction(()=>window.fixtureReady);
 const section=page.getByTestId('viewers-section'),summary=section.locator('summary'),rows=section.getByTestId('participant-viewer');
 for(const kind of ['open','guests','bot','finished'])for(const count of [0,1,2,18]){
  await page.evaluate(({count,kind})=>window.viewerFixture.show(count,kind),{count,kind});
  await expect(section.getByRole('heading',{name:'Viewers',exact:true})).toHaveCount(1);
  expect(await page.evaluate(()=>{const h2=document.querySelector('h2'),h3=document.querySelector('h3');return Number.parseFloat(getComputedStyle(h2).fontSize)>Number.parseFloat(getComputedStyle(h3).fontSize)&&Number.parseFloat(getComputedStyle(h3).fontSize)>Number.parseFloat(getComputedStyle(document.body).fontSize);})).toBe(true);
  if(count<2){await expect(summary).toHaveCount(0);await expect(rows).toHaveCount(count);if(!count)await expect(section).toContainText('None');}
  else{
   await expect(section.locator('details')).not.toHaveAttribute('open','');await expect(summary).toContainText(count===2?'Amara Nwosu-Alexander and Jules':'Amara Nwosu-Alexander, Jules and 16 others');
   expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
   await summary.focus();await page.keyboard.press('Enter');await expect(section.locator('details')).toHaveAttribute('open','');await expect(summary).toHaveText(`${count} viewers`,{useInnerText:true});await expect(summary).toHaveAccessibleName(`${count} viewers`);await expect(summary).toBeFocused();
   await expect(rows).toHaveCount(count);await page.evaluate(count=>window.viewerFixture.refresh(count),count);await expect(section.locator('details')).toHaveAttribute('open','');await expect(summary).toBeFocused();
   const invite=section.getByRole('button',{name:'Invite someone to view'});await invite.scrollIntoViewIfNeeded();await expect(invite).toBeInViewport();
   expect(await section.evaluate(el=>{const last=el.querySelector('.viewer-roster li:last-child'),invite=el.querySelector('button.invite-action');return last.getBoundingClientRect().bottom<=invite.getBoundingClientRect().top;})).toBe(true);
   await summary.focus();await page.keyboard.press('Space');await expect(section.locator('details')).not.toHaveAttribute('open','');await expect(summary).toBeFocused();
  }
  await expect.poll(()=>section.getByRole('button',{name:'Invite someone to view'}).locator('.loading-icon-slot .righelt-icon').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(112, 72, 165)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.evaluate(()=>window.viewerFixture.show(18));await summary.focus();await page.keyboard.press('Enter');await page.evaluate(()=>window.viewerFixture.refresh(0));await expect(section.locator('h3')).toBeFocused();await expect(summary).toHaveCount(0);
 await page.getByRole('button',{name:'Other control'}).focus();await page.evaluate(()=>window.viewerFixture.refresh(1));await expect(page.getByRole('button',{name:'Other control'})).toBeFocused();
 const invite=section.getByRole('button',{name:'Invite someone to view'});await invite.focus();await page.evaluate(()=>window.viewerFixture.refresh(0,{disabledInvite:true}));await expect(invite).toBeEnabled();await expect(invite).toBeFocused();
 await page.evaluate(()=>window.viewerFixture.show(18,'bot','other-game'));await expect(section.locator('details')).not.toHaveAttribute('open','');
 await page.screenshot({path:info.outputPath(`players-viewers-compact-${width}.png`),fullPage:true});await summary.click();await page.screenshot({path:info.outputPath(`players-viewers-expanded-${width}.png`),fullPage:true});
});
