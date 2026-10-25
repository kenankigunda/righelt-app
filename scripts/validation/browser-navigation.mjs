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
  // An opacity-zero menu can still have geometric visibility. Role queries
  // honor aria-hidden and prove the entry is actually exposed to the user.
  const accessible=page.getByRole('button',{name:'Account',exact:true});
  const menu=page.getByRole('button',{name:'Open navigation menu',exact:true});
  // A cold document can expose neither entry yet. Choose from the mounted
  // accessible toolbar, rather than guessing its layout before it exists.
  await expect.poll(async()=>await accessible.isVisible() || await menu.isVisible(),{message:'Account or Open navigation menu must be visible before account entry'}).toBe(true);
  if(!await accessible.isVisible())await menu.click();
  await expect(accessible).toBeVisible();
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

// Rematch and branch choices may use the older select or native mini cards.
// Assert the selected opponent in either public contract; preparation checks
// stay with the caller and must still reach actual readiness before Start.
export async function assertOpponentChoice(dialog, opponent) {
  const labels={babs:'Babs',tau:'Tau',horus:'Horus',friend:'Friend',self:'Self-play'};
  if(!Object.hasOwn(labels,opponent))throw Error(`Unknown opponent: ${opponent}`);
  const legacy=dialog.getByRole('combobox',{name:'Opponent',exact:true});
  if(await legacy.count())await expect(legacy).toHaveValue(opponent);
  else {
    const group=dialog.getByRole('group',{name:'Opponent',exact:true});
    await expect(group.getByRole('radio',{name:labels[opponent],exact:true})).toBeChecked();
    await expect(group.locator('input[type="radio"]:checked')).toHaveCount(1);
  }
}
