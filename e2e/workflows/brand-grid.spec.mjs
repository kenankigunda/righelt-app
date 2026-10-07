import {test,expect} from '@playwright/test';

test('grid keeps its paint inputs stable across unrelated app updates and realigns on resize',async({page})=>{
  await page.goto('/');
  await expect(page.getByTestId('home-create-game')).toBeVisible();
  await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
  const aligned=()=>page.evaluate(()=>{
    const r=document.querySelector('[data-brand-wordmark]').getBoundingClientRect();
    const pattern=document.querySelector('.brand-grid pattern');
    return {width:Number(pattern.getAttribute('width')),x:Number(pattern.getAttribute('x')),y:Number(pattern.getAttribute('y')),expectedWidth:74*r.width/755,expectedX:r.left+525*r.width/755,expectedY:r.top+44*r.width/755};
  });
  const assertAligned=async()=>{
    const value=await aligned();
    expect(value.width).toBeCloseTo(value.expectedWidth,8);
    expect(value.x).toBeCloseTo(value.expectedX,8);
    expect(value.y).toBeCloseTo(value.expectedY,8);
  };
  await expect(assertAligned).toPass();
  const mutations=await page.evaluate(async()=>{
    const changes=[], grid=document.querySelector('.brand-grid');
    const observer=new MutationObserver(records=>changes.push(...records.map(record=>record.attributeName)));
    observer.observe(grid,{attributes:true,subtree:true});
    const marker=document.createElement('span');marker.hidden=true;
    try{
      document.getElementById('app').append(marker);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      marker.remove();
      window.dispatchEvent(new Event('resize'));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return changes;
    }finally{observer.disconnect();marker.remove();}
  });
  expect(mutations).toEqual([]);
  await page.setViewportSize({width:375,height:812});
  await expect(assertAligned).toPass();
});


test('grid stays static across activity and motion preferences without moving geometry',async({page})=>{
  await page.goto('/');
  await expect(page.getByTestId('home-create-game')).toBeVisible();
  const read=()=>page.locator('.brand-grid').evaluate(grid=>{
    const style=getComputedStyle(grid);
    return {animations:grid.getAnimations().length,opacity:style.opacity,willChange:style.willChange,mask:style.maskImage,geometry:grid.getBoundingClientRect().toJSON()};
  });
  const initial=await read();
  expect(initial.animations).toBe(0);
  expect(initial.opacity).toBe('1');
  expect(initial.willChange).toBe('auto');
  expect(initial.mask).toContain('radial-gradient');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  expect(await read()).toEqual(initial);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  expect(await read()).toEqual(initial);
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await read()).toEqual(initial);
  await page.emulateMedia({reducedMotion:'no-preference'});
  expect(await read()).toEqual(initial);
});
