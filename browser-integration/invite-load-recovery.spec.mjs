import { test, expect } from '@playwright/test';

for (const width of [320,390,900]) test(`invitation recovery remains stable and usable at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  await page.goto('/browser-integration/support/invite-history-polish.html');
  await page.waitForFunction(()=>window.fixtureReady);
  for(const scale of [100,200]){
    await page.evaluate(scale=>{document.documentElement.style.fontSize=`${scale}%`;window.renderInviteRecovery({pending:false});},scale);
    const surface=page.getByTestId('invite-load-recovery'),card=page.locator('.invite-gate-modal');
    const geometry=()=>card.evaluate(element=>{const r=element.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});
    const before=await geometry();
    await expect(surface.getByRole('status')).toHaveText('We couldn’t load your invitation');
    const retry=surface.getByRole('button',{name:'Retry',exact:true}),home=surface.getByRole('link',{name:'Home',exact:true});
    await retry.focus();await page.keyboard.press(info.project.name==='webkit'?'Alt+Tab':'Tab');await expect(home).toBeFocused();
    for(const control of [retry,home]){
      await expect(control.locator('svg')).toHaveAttribute('aria-hidden','true');await expect(control.locator('svg path')).toHaveAttribute('d',/.+/);
      const r=await control.boundingBox();expect(r.height).toBeGreaterThanOrEqual(44);expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.evaluate(()=>window.renderInviteRecovery({pending:true}));
    await expect(surface).toHaveAttribute('aria-busy','true');await expect(surface.getByRole('button',{name:'Retry',exact:true})).toBeDisabled();await expect(home).toBeEnabled();
    expect(await geometry()).toEqual(before);
    if(width===390&&scale===200)await page.screenshot({path:info.outputPath('invite-retrying-390-200.png'),fullPage:true});
    for(const kind of ['unavailable','expired']){
      await page.evaluate(kind=>window.renderInviteRecovery({kind}),kind);
      await expect(surface.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);await expect(home).toBeVisible();
      await expect(surface.getByRole('status')).toHaveText(kind==='expired'?'This invitation has expired':'This invitation is no longer available');
    }
  }
});
