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
    const reveal=page.getByRole('button',{name:'Show game navigation',exact:true});
    // Refresh the real idle window before a nonselected tab interaction, even
    // when the controls are still expanded but about to disappear.
    if(await reveal.count() || await controls.getAttribute('inert')!==null)await reveal.click();
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
  if(await tab.getAttribute('aria-pressed')!=='true'){
    await revealGameNavigation(page);
    await expect(tab).toBeVisible();
    await tab.click();
  }
  await expect(tab).toHaveAttribute('aria-pressed','true');
  const panel=page.locator(`[data-mobile-panel="${key}"]`);
  await expect(panel).not.toHaveAttribute('inert','');
  const track=page.locator('.game-shell-track');
  await settled(track);
  await expect.poll(()=>panel.evaluate(element=>Math.abs(element.getBoundingClientRect().left-element.closest('.game-shell-track-wrap').getBoundingClientRect().left)),{message:'Selected game panel must settle into the visible track'}).toBeLessThanOrEqual(1);
}

// A mounted game can still be covered by route entry or quietly recovering
// its command authority. Read this page's admission markers, not a separate
// server projection that cannot describe the local recovery gate.
export async function waitForPlayableBoard(page) {
  await expect.poll(() => page.evaluate(() => {
    const app = document.querySelector('#app');
    const board = document.querySelector('[data-testid="game-board-wrap"]');
    return app?.getAttribute('data-shell-transition-phase') === 'idle'
      && board?.getAttribute('data-reconnecting') === 'false'
      && board?.getAttribute('aria-busy') === 'false';
  }), {message: 'Board entry and local recovery must settle before selecting a piece'}).toBe(true);
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
export async function assertOpponentChoice(dialog, opponent, {contract='legacy',assertionOptions}={}) {
  if(!['legacy','colors-v1'].includes(contract))throw Error('Unsupported rematch choices contract');
  const labels={babs:'Babs',tau:'Tau',horus:'Horus',friend:'Friend',self:contract==='colors-v1'?'Play both sides':'Self-play'};
  if(!Object.hasOwn(labels,opponent))throw Error(`Unknown opponent: ${opponent}`);
  const legacy=dialog.getByRole('combobox',{name:'Opponent',exact:true});
  if(await legacy.count()){
    if(contract==='colors-v1')throw Error('Color-choice contract requires native opponent radios');
    await expect(legacy).toHaveValue(opponent,assertionOptions);
    await expect(legacy.locator('option:checked')).toHaveText(labels[opponent],assertionOptions);
  }
  else {
    const group=dialog.getByRole('group',{name:'Opponent',exact:true});
    const name=contract==='colors-v1'?'[name="rematch-opponent"]':'';
    const selected=group.locator(`input[type="radio"]${name}[value="${opponent}"]`);
    await expect(selected).toHaveCount(1,assertionOptions);
    await expect(selected).toHaveAccessibleName(labels[opponent],assertionOptions);
    await expect(selected).toBeChecked(assertionOptions);
    await expect(group.locator('input[type="radio"]:checked')).toHaveCount(1,assertionOptions);
  }
}

// Identity and accessible copy must both match the source-selected contract.
export async function assertRematchSide(dialog, side, {contract='legacy',assertionOptions}={}) {
  if(!['legacy','colors-v1'].includes(contract))throw Error('Unsupported rematch choices contract');
  if(!['p1','p2'].includes(side))throw Error('Unknown rematch side');
  const color=side==='p1'?'Red':'Blue';
  const selected=dialog.locator(`input[type="radio"][name="rematch-side"][value="${side}"]`);
  await expect(selected).toHaveCount(1,assertionOptions);
  await expect(selected).toHaveAccessibleName(contract==='colors-v1'?color:`Player ${side==='p1'?'1':'2'} · ${color}`,assertionOptions);
  await expect(selected).toBeChecked(assertionOptions);
  await expect(dialog.locator('input[type="radio"][name="rematch-side"]:checked')).toHaveCount(1,assertionOptions);
}

export async function assertRematchControlTargets(dialog,{contract='legacy',opponent,assertionOptions}={}) {
  if(!['legacy','colors-v1'].includes(contract))throw Error('Unsupported rematch choices contract');
  // Side controls keep their existing native-radio geometry contract. The
  // opponent cards have smaller glyphs inside separate full-size click targets.
  const sides=dialog.getByRole('group',{name:'Your side',exact:true}).getByRole('radio');
  await expect(sides).toHaveCount(2,assertionOptions);
  for(const side of await sides.all()){
    const box=await side.boundingBox();expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(16);expect(box.width).toBeLessThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(16);expect(box.height).toBeLessThanOrEqual(24);
  }
  if(contract==='legacy')return;
  const group=dialog.getByRole('group',{name:'Opponent',exact:true});
  await expect(group.getByRole('radio')).toHaveCount(5,assertionOptions);
  const choices=['babs','tau','horus','friend','self'];
  if(!choices.includes(opponent))throw Error('Expected opponent must identify a native rematch choice');
  const labelFor=value=>group.locator('label').filter({has:dialog.page().locator(`input[type="radio"][name="rematch-opponent"][value="${value}"]`)});
  for(const value of choices){
    const label=labelFor(value);await expect(label).toHaveCount(1,assertionOptions);
    expect(await label.evaluate((element,value)=>element.control?.name==='rematch-opponent'&&element.control.value===value,value)).toBe(true);
    const box=await label.boundingBox();expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
    await label.click();
    await assertOpponentChoice(dialog,value,{contract,assertionOptions});
  }
  // Preserve the caller's intended rematch instead of starting the last tested choice.
  await labelFor(opponent).click();
  await assertOpponentChoice(dialog,opponent,{contract,assertionOptions});
}
