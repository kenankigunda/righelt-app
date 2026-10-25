import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {assertRematchSide,assertOpponentChoice,selectGamePanel,revealAccountControl,assertAccountEntry,waitForPlayableBoard} from '../scripts/validation/browser-navigation.mjs';
import {assertMovePreview} from '../scripts/validation/browser-move.mjs';

const navigation=({collapsed=false,wide=false}={})=>`<style>.game-shell-track-wrap{width:300px;height:100px;overflow:hidden}.game-shell-track{display:flex;width:900px;transition:transform 180ms linear}.panel{width:300px;flex:none;height:100px}[data-mobile-nav-controls][inert]{visibility:hidden}</style>
<div id="app" data-shell-layout-mode="${wide?'wide':'narrow'}"><div class="game-shell-track-wrap"><div class="game-shell-track">${['players','board','history'].map((key,index)=>`<div class="panel" data-mobile-panel="${key}" ${collapsed&&index?'inert':''}>${key}</div>`).join('')}</div></div>
${collapsed?'<button id="reveal" aria-label="Show game navigation">Reveal</button>':''}<nav ${collapsed?'data-mobile-nav-controls inert':''}>${['players','board','history'].map((key,index)=>`<button data-action="switch-game-panel" data-panel="${key}" aria-pressed="${!index}">${key}</button>`).join('')}</nav></div>`;

for (const first of ['route', 'recovery']) test(`computer proof waits for quiet local recovery and route entry (${first} first)`, async ({page}) => {
  await page.setContent(`<div id="app" data-shell-transition-phase="covering"><div data-testid="game-board-wrap" data-reconnecting="true" aria-busy="true"><button id="source">Piece</button><button id="destination" class="cell">Destination</button><p id="shell-board-preview-label">Preview</p></div></div>`);
  await page.evaluate(() => {
    window.sourceClicks = 0; window.writes = 0; window.previewed = false;
    window.readinessReads = 0;
    const app = document.querySelector('#app');
    const getAttribute = app.getAttribute.bind(app);
    app.getAttribute = name => {
      if (name === 'data-shell-transition-phase') window.readinessReads++;
      return getAttribute(name);
    };
    document.querySelector('#source').onclick = () => { window.sourceClicks++; };
    document.querySelector('#destination').onclick = event => {
      if (window.previewed) { window.writes++; return; }
      window.previewed = true;
      event.currentTarget.classList.add('target');
      event.currentTarget.innerHTML = '<span class="move-ghost">Piece</span>';
    };
  });
  let admitted = false;
  const ready = waitForPlayableBoard(page).then(() => { admitted = true; return page.locator('#source').click(); });
  await expect.poll(() => page.evaluate(() => window.readinessReads)).toBeGreaterThan(0);
  const release = gate => page.evaluate(async gate => {
    window.readinessReads = 0;
    if (gate === 'route') document.querySelector('#app').dataset.shellTransitionPhase = 'idle';
    else { const board = document.querySelector('[data-testid="game-board-wrap"]'); board.dataset.reconnecting = 'false'; board.setAttribute('aria-busy', 'false'); }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {clicks: window.sourceClicks, writes: window.writes};
  }, gate);
  expect(await release(first)).toEqual({clicks: 0, writes: 0});
  // Observe a fresh helper probe with exactly one gate released. Two frames
  // alone could finish before the polling helper had inspected that state.
  await expect.poll(() => page.evaluate(() => window.readinessReads)).toBeGreaterThan(0);
  expect(admitted).toBe(false);
  expect(await page.evaluate(() => ({clicks: window.sourceClicks, writes: window.writes}))).toEqual({clicks: 0, writes: 0});
  await release(first === 'route' ? 'recovery' : 'route');
  await ready;
  expect(await page.evaluate(() => window.sourceClicks)).toBe(1);
  await page.locator('#destination').click();
  await assertMovePreview(page, page.locator('#destination'));
  expect(await page.evaluate(() => window.writes)).toBe(0);
  await page.locator('#destination').click();
  expect(await page.evaluate(() => window.writes)).toBe(1);
});

for(const label of ['Play as both players','Play both sides'])test(`self-play proof uses the stable action with ${label} copy`,async({page})=>{
 await page.setContent(`<button data-action="create-self-play">${label}</button><button data-action="play-as-both-players" data-game-id="current">${label}</button>`);
 await page.evaluate(()=>{
  window.selfPlayClicks=0;window.otherClicks=0;
  document.querySelector('[data-action="create-self-play"]').onclick=()=>window.otherClicks++;
  document.querySelector('[data-action="play-as-both-players"]').onclick=event=>{window.selfPlayClicks++;event.currentTarget.remove();};
 });
 const control=page.locator('[data-action="play-as-both-players"]');await expect(control).toHaveCount(1);await control.click();await expect(control).toHaveCount(0);
 expect(await page.evaluate(()=>({selected:window.selfPlayClicks,other:window.otherClicks}))).toEqual({selected:1,other:0});
 await page.setContent('<button data-action="play-as-both-players">One</button><button data-action="play-as-both-players">Two</button>');
 await assert.rejects(()=>page.locator('[data-action="play-as-both-players"]').click(),/strict mode violation/);
});

async function mountNavigation(page,options){
  await page.setContent(navigation(options));
  await page.evaluate(({collapsed})=>{
    window.panelClicks=0;window.reveals=0;
    document.querySelector('#reveal')?.addEventListener('click',()=>{window.reveals++;const controls=document.querySelector('nav');controls.removeAttribute('inert');controls.animate([{opacity:0},{opacity:1}],{duration:120});});
    document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{
      window.panelClicks++;const index=['players','board','history'].indexOf(button.dataset.panel);
      document.querySelectorAll('[data-panel]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
      if(collapsed)document.querySelectorAll('[data-mobile-panel]').forEach(panel=>panel.inert=panel.dataset.mobilePanel!==button.dataset.panel);
      document.querySelector('.game-shell-track').style.transform=`translateX(${-300*index}px)`;
    }));
  },options);
}

for(const collapsed of [false,true])test(`released navigation selects and settles ${collapsed?'collapsed':'legacy always-visible'} panels`,async({page})=>{
  await mountNavigation(page,{collapsed});
  await selectGamePanel(page,'history');
  expect(await page.evaluate(()=>({clicks:window.panelClicks,reveals:window.reveals}))).toEqual({clicks:1,reveals:Number(collapsed)});
  expect(await page.locator('[data-mobile-panel="history"]').evaluate(panel=>{const rect=panel.getBoundingClientRect();return panel.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));})).toBe(true);
  expect(await page.locator('.game-shell-track').evaluate(track=>track.getAnimations().some(animation=>animation.playState==='running'))).toBe(false);
  await selectGamePanel(page,'board');
  await expect(page.locator('[data-panel="board"]')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>window.panelClicks)).toBe(2);
});

test('wide candidates do not receive narrow navigation actions',async({page})=>{
  await mountNavigation(page,{wide:true});await selectGamePanel(page,'history');
  expect(await page.evaluate(()=>window.panelClicks)).toBe(0);
});
test('a collapsed candidate without its accessible reveal control fails without clicking hidden tabs',async({page})=>{
  await mountNavigation(page,{collapsed:true});await page.locator('#reveal').evaluate(element=>element.remove());
  page.setDefaultTimeout(150);
  await assert.rejects(()=>selectGamePanel(page,'board'),/Show game navigation/);
  expect(await page.evaluate(()=>window.panelClicks)).toBe(0);
});

for(const menu of [false,true])test(`released account access supports ${menu?'narrow menu':'legacy direct'} entry`,async({page})=>{
  await page.setContent(`<style>#account-menu[aria-hidden="true"]{opacity:0;pointer-events:none;transform:translateY(12px)}</style>${menu?'<button id="menu" aria-label="Open navigation menu">Menu</button>':''}<div id="account-menu" ${menu?'aria-hidden="true"':''}><button data-testid="account-open" data-authenticated="false">Account</button></div>`);
  await page.evaluate(()=>{
    window.accountClicks=0;window.menuToggles=0;
    document.querySelector('[data-testid="account-open"]').onclick=()=>window.accountClicks++;
    document.querySelector('#menu')?.addEventListener('click',event=>{window.menuToggles++;const menu=document.querySelector('#account-menu'),closed=menu.getAttribute('aria-hidden')==='true';menu.setAttribute('aria-hidden',String(!closed));event.currentTarget.setAttribute('aria-label',closed?'Close navigation menu':'Open navigation menu');});
  });
  if(menu){
    expect(await page.getByTestId('account-open').isVisible()).toBe(true);
    await expect(page.getByRole('button',{name:'Account',exact:true})).toHaveCount(0);
  }
  await assertAccountEntry(page,{authenticated:false});
  expect(await page.evaluate(()=>window.menuToggles)).toBe(menu?2:0);
  if(menu)await expect(page.getByRole('button',{name:'Open navigation menu',exact:true})).toBeVisible();
  await(await revealAccountControl(page,page.getByTestId('account-open'))).click();expect(await page.evaluate(()=>window.accountClicks)).toBe(1);
});

for(const message of ['Preview. Activate this destination again to play.','Move from (1, 2) to (2, 2)'])test(`preview proof uses actual destination state with ${message.startsWith('Preview')?'legacy':'short'} copy`,async({page})=>{
  await page.setContent(`<p id="shell-board-preview-label">${message}</p><div id="target" class="cell target"><span class="move-ghost">Piece</span></div>`);
  await assertMovePreview(page,page.locator('#target'));
});

for(const cards of [false,true])test(`opponent proof asserts the exact ${cards?'native card':'legacy dropdown'} choice`,async({page})=>{
 await page.setContent(`<dialog open aria-label="Play again">${cards?'<fieldset><legend>Opponent</legend><label><input name="opponent" type="radio" value="babs" checked>Babs</label><label><input name="opponent" type="radio" value="friend">Friend</label></fieldset>':'<label>Opponent<select><option value="babs">Babs</option><option value="friend">Friend</option></select></label>'}</dialog>`);
 const dialog=page.getByRole('dialog',{name:'Play again',exact:true});
 await assertOpponentChoice(dialog,'babs');
 if(cards)await dialog.getByRole('radio',{name:'Friend',exact:true}).check();else await dialog.getByRole('combobox',{name:'Opponent',exact:true}).selectOption('friend');
 await assertOpponentChoice(dialog,'friend');
 // A visible wrong known choice must fail the proof in both UI contracts.
 await assert.rejects(()=>assertOpponentChoice(dialog,'babs',{assertionOptions:{timeout:100}}));
 await assert.rejects(()=>assertOpponentChoice(dialog,'unknown'),/Unknown opponent/);
});


for(const narrow of [false,true])test(`account entry waits for a cold ${narrow?'narrow':'wide'} toolbar before choosing its affordance`,async({page})=>{
 await page.setContent('<p role="status">Starting</p>');page.setDefaultTimeout(600);
 const pending=revealAccountControl(page).then(control=>({control}),error=>({error}));
 // This command follows the helper's first visibility check, while neither
 // toolbar affordance exists. Mount the actual public contract afterwards.
 await page.evaluate(narrow=>{
  window.menuClicks=0;window.accountClicks=0;
  document.body.innerHTML=narrow?'<button aria-label="Open navigation menu">Menu</button><div id="menu" aria-hidden="true" style="opacity:0;pointer-events:none"><button data-testid="account-open">Account</button></div>':'<button data-testid="account-open" disabled>Account</button>';
  document.querySelector('[aria-label="Open navigation menu"]')?.addEventListener('click',()=>{window.menuClicks++;const menu=document.querySelector('#menu');menu.removeAttribute('aria-hidden');menu.style.opacity='1';menu.style.pointerEvents='auto';});
  document.querySelector('[data-testid="account-open"]').onclick=()=>window.accountClicks++;
 },narrow);
 if(!narrow)await page.evaluate(()=>document.querySelector('[data-testid="account-open"]').disabled=false);
 const result=await pending;expect(result.error).toBeUndefined();await result.control.click();
 expect(await page.evaluate(()=>({menu:window.menuClicks,account:window.accountClicks}))).toEqual({menu:Number(narrow),account:1});
});


test('missing toolbar affordances fail with a bounded readiness explanation',async({page})=>{
 await page.setContent('<p role="status">Starting</p>');
 await assert.rejects(()=>revealAccountControl(page),/Account or Open navigation menu must be visible before account entry/);
});


for(const contract of ['legacy','colors-v1'])test(`rematch ${contract} requires semantic side identity and exact accessible copy`,async({page})=>{
 const label=contract==='legacy'?'Player 1 · Red':'Red';
 const self=contract==='legacy'?'Self-play':'Play both sides';
 const render=async(sideLabel=label,extra='')=>page.setContent(`<dialog open aria-label="Play again"><fieldset><legend>Your side</legend><label><input type="radio" name="rematch-side" value="p1" checked>${sideLabel}</label><label><input type="radio" name="rematch-side" value="p2">${contract==='legacy'?'Player 2 · Blue':'Blue'}</label>${extra}</fieldset><fieldset><legend>Opponent</legend><label><input type="radio" name="rematch-opponent" value="self" checked>${self}</label></fieldset></dialog>`);
 await render();const dialog=page.getByRole('dialog',{name:'Play again',exact:true});
 await assertRematchSide(dialog,'p1',{contract});await assertOpponentChoice(dialog,'self',{contract});
 await dialog.locator('[name="rematch-side"][value="p2"]').check();await assertRematchSide(dialog,'p2',{contract});
 await assert.rejects(()=>assertRematchSide(dialog,'p1',{contract,assertionOptions:{timeout:100}}));
 await render(contract==='legacy'?'Red':'Player 1 · Red');await assert.rejects(()=>assertRematchSide(dialog,'p1',{contract,assertionOptions:{timeout:100}}));
 await render(label,`<label><input type="radio" name="rematch-side" value="p1">${label}</label>`);await assert.rejects(()=>assertRematchSide(dialog,'p1',{contract,assertionOptions:{timeout:100}}));
 await render();await dialog.locator('[name="rematch-opponent"]').evaluate(input=>input.parentElement.lastChild.textContent='Wrong opponent');await assert.rejects(()=>assertOpponentChoice(dialog,'self',{contract,assertionOptions:{timeout:100}}));
 await render();await dialog.locator('[name="rematch-opponent"]').evaluate(input=>input.value='friend');await assert.rejects(()=>assertOpponentChoice(dialog,'self',{contract,assertionOptions:{timeout:100}}));
 await assert.rejects(()=>assertRematchSide(dialog,'p1',{contract:'future'}),/Unsupported/);
});


test('color-choice contract rejects wrong-name native controls and legacy dropdowns',async({page})=>{
 const dialog=page.getByRole('dialog',{name:'Play again',exact:true});
 await page.setContent('<dialog open aria-label="Play again"><fieldset><legend>Opponent</legend><label><input type="radio" name="unrelated-choice" value="self" checked>Play both sides</label></fieldset></dialog>');
 await assert.rejects(()=>assertOpponentChoice(dialog,'self',{contract:'colors-v1',assertionOptions:{timeout:100}}));
 await page.setContent('<dialog open aria-label="Play again"><label>Opponent<select><option value="self">Play both sides</option></select></label></dialog>');
 await assert.rejects(()=>assertOpponentChoice(dialog,'self',{contract:'colors-v1'}),/requires native opponent radios/);
});
