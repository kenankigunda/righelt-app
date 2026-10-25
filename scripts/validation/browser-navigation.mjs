import {expect} from '@playwright/test';

const settled = locator => locator.evaluate(async element => {
  element.getBoundingClientRect();
  await Promise.all(element.getAnimations({subtree:true})
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => {})));
});

// These helpers belong to the released harness. Candidate test helpers must
// never select the validation contract or supply another Playwright instance.
export async function revealGameNavigation(page) {
  const controls=page.locator('[data-mobile-nav-controls]');
  if(await controls.count()) {
    if(await controls.getAttribute('inert')!==null) {
      await page.getByRole('button',{name:'Show game navigation',exact:true}).click();
    }
    await expect(controls).not.toHaveAttribute('inert','');
    await settled(controls);
  }
}

export async function selectGamePanel(page,key) {
  if(!['players','board','history'].includes(key))throw Error(`Unknown game panel: ${key}`);
  const layout=await page.locator('#app').getAttribute('data-shell-layout-mode');
  if(layout==='wide')return;
  const tab=page.locator(`[data-action="switch-game-panel"][data-panel="${key}"]`);
  if(layout!=='narrow'&&!await tab.isVisible())return;
  await revealGameNavigation(page);
  await expect(tab).toBeVisible();
  if(await tab.getAttribute('aria-pressed')!=='true')await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed','true');
  const panel=page.locator(`[data-mobile-panel="${key}"]`);
  await expect(panel).not.toHaveAttribute('inert','');
  const track=page.locator('.game-shell-track');
  await settled(track);
  await expect.poll(()=>panel.evaluate(element=>Math.abs(element.getBoundingClientRect().left-element.closest('.game-shell-track-wrap').getBoundingClientRect().left)),{message:'Selected game panel must settle into the visible track'}).toBeLessThanOrEqual(1);
}

export async function revealAccountControl(page,control=page.getByRole('button',{name:'Account',exact:true})) {
  if(!await control.isVisible())await page.getByRole('button',{name:'Open navigation menu',exact:true}).click();
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  return control;
}

export async function assertAccountEntry(page,{authenticated=false}={}) {
  const control=await revealAccountControl(page,page.getByTestId('account-open'));
  await expect(control).toHaveAttribute('data-authenticated',String(authenticated));
  const close=page.getByRole('button',{name:'Close navigation menu',exact:true});
  if(await close.isVisible())await close.click();
}
