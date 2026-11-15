import {test,expect} from '@playwright/test';

const tolerance = 1;

for (const sample of [
  {name:'narrow',width:390,height:900,layout:'narrow'},
  {name:'wide',width:900,height:900,layout:'wide'},
]) test(`previous-turn key shares reserved guidance space and previews changed squares at ${sample.name} width`,async({page,browserName},info)=>{
  await page.setViewportSize({width:sample.width,height:sample.height});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async layout=>{
    await window.boardFixture.setup('pass',false);
    const app=document.querySelector('#app'),board=document.querySelector('#board'),cells=[...board.querySelectorAll('.cell')];
    app.dataset.shellLayoutMode=layout;app.dataset.hoverCapability=layout==='wide'?'hover':'none';
    board.id='shell-board';board.dataset.presentationContext='previous-turn';board.dataset.previousTurnEpisode='visit:g:2:move-2';
    cells[0].classList.add('previous-turn-source','previous-turn-side-p2');
    cells[1].classList.add('previous-turn-target','previous-turn-side-p2');
    cells[2].classList.add('previous-turn-deletion','previous-turn-side-p1');
    const [{updatePreviousTurnLegend},{createPreviousTurnKeyInteraction}]=await Promise.all([import('/apps/web/legend.js'),import('/apps/web/shell/previous-turn-key.js')]);
    window.replayDescriptor={turnIndex:2,moveIds:['move-2']};window.replayCalls=[];
    window.previousTurnInteraction=createPreviousTurnKeyInteraction(app,{getReplayDescriptor:()=>window.replayDescriptor,onReplay:request=>{window.replayCalls.push(request);return true;}});
    window.syncPreviousTurnKey=context=>{
      board.dataset.presentationContext=context;
      return updatePreviousTurnLegend(document.querySelector('[data-shell-panel="board"]'),board,{sideToMove:'P1'},false);
    };
    window.syncPreviousTurnKey('previous-turn');
    await document.fonts.ready;
  },sample.layout);

  const key=page.locator('[data-previous-turn-key]');
  await expect(key).toBeVisible();
  await expect(key).toHaveAccessibleName(/^Changes by opponent/);
  if(sample.layout==='narrow')await expect(key).toHaveAttribute('aria-pressed','false');
  else await expect(key).not.toHaveAttribute('aria-pressed',/.+/);
  await expect(page.locator('[data-legend-entry="previousTurn"]')).toHaveCount(1);

  const initial=await page.evaluate(()=>{
    const rect=node=>node.getBoundingClientRect().toJSON(),board=document.querySelector('#shell-board'),key=document.querySelector('[data-previous-turn-key]'),host=key.closest('.previous-turn-key-host'),slot=document.querySelector('.board-message-slot'),cells=[...board.querySelectorAll('.cell')];
    const playerColor=name=>{const node=document.createElement('span');node.style.color=`var(${name})`;document.body.append(node);const color=getComputedStyle(node).color;node.remove();return color;};
    return {board:rect(board),key:rect(key),host:rect(host),slot:rect(slot),source:rect(cells[0]),target:rect(cells[1]),sourceBackground:getComputedStyle(cells[0]).backgroundImage,targetBackground:getComputedStyle(cells[1]).backgroundImage,keyColor:getComputedStyle(key).color,p1:playerColor('--player-p1'),p2:playerColor('--player-p2')};
  });
  await info.attach('Previous-turn key geometry',{body:JSON.stringify(initial),contentType:'application/json'});
  expect(Math.abs(initial.key.right-initial.board.right),JSON.stringify(initial)).toBeLessThanOrEqual(tolerance);
  expect(initial.key.bottom).toBeLessThanOrEqual(initial.slot.bottom+tolerance);
  expect(initial.slot.bottom).toBeLessThanOrEqual(initial.board.top+tolerance);
  expect(initial.keyColor).toBe(initial.p2);

  if(sample.layout==='narrow')await key.click();else await key.hover();
  const hovered=await page.evaluate(()=>{
    const cells=[...document.querySelectorAll('#shell-board .cell')],read=cell=>({rect:cell.getBoundingClientRect().toJSON(),outlineStyle:getComputedStyle(cell).outlineStyle,outlineWidth:getComputedStyle(cell).outlineWidth,outlineColor:getComputedStyle(cell).outlineColor,background:getComputedStyle(cell).backgroundImage});
    return {source:read(cells[0]),target:read(cells[1]),deletion:read(cells[2])};
  });
  expect(hovered.source.outlineStyle).toBe('dashed');
  expect(hovered.target.outlineStyle).toBe('solid');
  expect(hovered.source.outlineWidth).toBe('2px');
  expect(hovered.target.outlineWidth).toBe('2px');
  expect(hovered.deletion.outlineStyle).toBe('dashed');
  expect(hovered.source.outlineColor).toBe(initial.p2);
  expect(hovered.target.outlineColor).toBe(initial.p2);
  expect(hovered.deletion.outlineColor).toBe(initial.p1);
  expect(hovered.source.rect).toEqual(initial.source);
  expect(hovered.target.rect).toEqual(initial.target);
  expect(hovered.source.background).toBe(initial.sourceBackground);
  expect(hovered.target.background).toBe(initial.targetBackground);
  if(browserName==='chromium')await page.screenshot({path:info.outputPath(`previous-turn-key-${sample.name}.png`),fullPage:true});

  if(sample.layout==='narrow'){
    await expect(key).toHaveAttribute('aria-pressed','true');
    await expect(key).toHaveAttribute('data-mobile-stage','replay');
    await expect(key).toHaveAccessibleName('Replay previous opponent turn');
    await expect(key.locator('[data-previous-turn-key-label]')).toHaveText('Replay');
    await expect(key.locator('.previous-turn-key-replay')).toBeVisible();
    await key.click();
    expect(await page.evaluate(()=>window.replayCalls.length)).toBe(1);
    expect(await page.evaluate(()=>window.replayCalls[0].descriptor.moveIds)).toEqual(['move-2']);
    await page.keyboard.press('Escape');
    await expect(key).toHaveAttribute('aria-pressed','false');
    await expect(key.locator('[data-previous-turn-key-label]')).toHaveText('Changes by opponent');
    await key.click();
    await page.evaluate(()=>{const board=document.querySelector('#shell-board');window.replayDescriptor={turnIndex:4,moveIds:['move-4']};board.dataset.previousTurnEpisode='visit:g:4:move-4';window.syncPreviousTurnKey('previous-turn');});
    await expect(key).toHaveAttribute('aria-pressed','false');
    await expect(key).toHaveAttribute('data-hover-retired','true');
    await key.click();await expect(key).toHaveAttribute('aria-pressed','true');
    await page.evaluate(()=>{window.boardActivations=0;document.querySelector('#shell-board .cell:nth-child(5)').addEventListener('click',()=>window.boardActivations++);});
    await page.locator('#shell-board .cell').nth(4).click();
    expect(await page.evaluate(()=>window.boardActivations)).toBe(1);
  } else {
    await key.focus();
    await expect(key).toBeFocused();
    expect(await page.locator('#shell-board .cell').nth(0).evaluate(cell=>getComputedStyle(cell).outlineStyle)).toBe('dashed');
  }

  await page.evaluate(()=>window.syncPreviousTurnKey('history'));
  await expect(key).toBeHidden();
  expect(await page.locator('.previous-turn-key-host').evaluate(host=>host.getBoundingClientRect().height)).toBe(0);
  if(sample.layout==='narrow')await expect(page.locator('[data-previous-turn-key]')).toHaveAttribute('aria-pressed','false');
});

test('previous-turn key grows naturally at 200% text and honors forced colors and reduced motion',async({page,browserName})=>{
  test.skip(browserName!=='chromium');
  await page.setViewportSize({width:390,height:900});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async()=>{
    document.documentElement.style.fontSize='200%';
    await window.boardFixture.setup('pass',false);
    const app=document.querySelector('#app'),board=document.querySelector('#board'),cells=[...board.querySelectorAll('.cell')],details=document.querySelector('[data-board-context-details]');
    app.dataset.shellLayoutMode='narrow';app.dataset.hoverCapability='none';
    board.id='shell-board';board.dataset.presentationContext='default';
    details.textContent='Opponent completed a long multi-step turn whose context remains readable without overlapping the contextual key.';
    const [{updatePreviousTurnLegend},{createPreviousTurnKeyInteraction}]=await Promise.all([import('/apps/web/legend.js'),import('/apps/web/shell/previous-turn-key.js')]);
    window.syncPreviousTurnKey=context=>{board.dataset.presentationContext=context;updatePreviousTurnLegend(document.querySelector('[data-shell-panel="board"]'),board,{sideToMove:'P1'},false);};
    await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    board.dataset.previousTurnEpisode='visit:g:2:move-2';
    cells[0].classList.add('previous-turn-source','previous-turn-side-p2');
    cells[1].classList.add('previous-turn-target','previous-turn-side-p2');
    window.previousTurnInteraction=createPreviousTurnKeyInteraction(app,{getReplayDescriptor:()=>({turnIndex:2,moveIds:['move-2']}),onReplay:()=>true});
    window.syncPreviousTurnKey('previous-turn');
  });
  await page.waitForFunction(()=>document.querySelector('.board-message-slot').getAnimations().some(animation=>animation.effect?.getTiming?.().duration===260));
  const transition=await page.locator('.board-message-slot').evaluate(slot=>slot.getAnimations().map(animation=>animation.effect.getTiming().duration));
  expect(transition).toContain(260);
  await page.waitForFunction(()=>document.querySelector('[data-previous-turn-key]').getBoundingClientRect().bottom<=document.querySelector('#shell-board .cell').getBoundingClientRect().top);
  await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
  await page.locator('[data-previous-turn-key]').click();
  await expect(page.locator('[data-previous-turn-key-label]')).toHaveText('Replay');
  const result=await page.evaluate(()=>{
    const key=document.querySelector('[data-previous-turn-key]'),slot=document.querySelector('.board-message-slot'),details=document.querySelector('[data-board-context-details]'),firstCell=document.querySelector('#shell-board .cell'),rect=node=>node.getBoundingClientRect().toJSON();
    return {key:rect(key),slot:rect(slot),details:rect(details),firstCell:rect(firstCell),fontSize:Number.parseFloat(getComputedStyle(key).fontSize),lineHeight:Number.parseFloat(getComputedStyle(key).lineHeight)};
  });
  expect(result.fontSize).toBe(32);
  expect(result.key.height).toBeGreaterThan(44);
  expect(result.key.height).toBeGreaterThanOrEqual(result.lineHeight);
  expect(result.details.bottom,JSON.stringify(result)).toBeLessThanOrEqual(result.key.top+tolerance);
  expect(result.key.bottom,JSON.stringify(result)).toBeLessThanOrEqual(result.firstCell.top+tolerance);
  await page.emulateMedia({forcedColors:'active'});
  await page.getByRole('button',{name:'Replay previous opponent turn'}).focus();
  for(const index of [0,1]){
    const boundary=await page.locator('#shell-board .cell').nth(index).evaluate(cell=>({style:getComputedStyle(cell).outlineStyle,width:getComputedStyle(cell).outlineWidth,color:getComputedStyle(cell).outlineColor}));
    expect(boundary.style).toBe(index===0?'dashed':'solid');expect(boundary.width).toBe('2px');expect(boundary.color).not.toBe('rgba(0, 0, 0, 0)');
  }
  await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});
  await page.evaluate(()=>window.syncPreviousTurnKey('history'));
  await expect(page.getByRole('button',{name:/^Changes by opponent/})).toBeHidden();
  await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
  expect(await page.locator('.board-message-slot').evaluate(slot=>slot.getAnimations().length)).toBe(0);
});
