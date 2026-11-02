import {test,expect} from '@playwright/test';

const readWordmark = page => page.locator('[data-brand-wordmark]').evaluate(mark => ({
  connected: mark.isConnected,
  cells: [...mark.querySelectorAll('[data-brand-cell]')].map(cell => ({id:cell.dataset.brandCell,path:cell.getAttribute('d')})),
  depth: mark.querySelectorAll('.brand-cell-depth').length,
  light: mark.querySelectorAll('.brand-cell-light').length,
  geometry: mark.getBoundingClientRect().toJSON(),
}));
const expectMotif = async page => {
  await expect(page.locator('.brand-grid')).toHaveCount(0);
  await expect(page.getByRole('img',{name:'Righelt',exact:true})).toBeVisible();
  const mark=await readWordmark(page);
  expect(mark.connected).toBe(true);
  expect(mark.cells.map(cell=>cell.id)).toEqual(['0','1','2']);
  expect(mark.depth).toBe(1);expect(mark.light).toBe(1);
  expect(mark.geometry.width).toBeGreaterThan(0);
  expect(mark.geometry.x).toBeGreaterThanOrEqual(0);
  expect(mark.geometry.right).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
  return mark;
};

test('removed page grid stays absent while retained inset wordmark survives updates and resize',async({page})=>{
  await page.goto('/');
  await expect(page.getByTestId('home-create-game')).toBeVisible();
  await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
  const before=await expectMotif(page);
  await page.locator('[data-brand-wordmark]').evaluate(mark=>window.retainedWordmark=mark);
  await page.evaluate(async()=>{
    const marker=document.createElement('span');marker.hidden=true;
    try {
      document.getElementById('app').append(marker);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    } finally {marker.remove();}
  });
  expect(await page.evaluate(()=>window.retainedWordmark===document.querySelector('[data-brand-wordmark]'))).toBe(true);
  expect((await expectMotif(page)).cells).toEqual(before.cells);
  await page.setViewportSize({width:375,height:812});
  expect((await expectMotif(page)).cells).toEqual(before.cells);
});

test('retained wordmark preserves geometry across activity and reduced motion without a page grid',async({page})=>{
  await page.goto('/');
  await expect(page.getByTestId('home-create-game')).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
  const initial=await expectMotif(page);
  for (const event of ['blur','focus']) {
    await page.evaluate(type=>window.dispatchEvent(new Event(type)),event);
    expect((await expectMotif(page)).geometry).toEqual(initial.geometry);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('[data-brand-wordmark]')).toHaveAttribute('data-player','red');
  await expect(page.locator('[data-brand-wordmark]')).toHaveAttribute('data-cell','0');
  expect((await expectMotif(page)).geometry).toEqual(initial.geometry);
  await page.emulateMedia({reducedMotion:'no-preference'});
  expect((await expectMotif(page)).geometry).toEqual(initial.geometry);
});
