import { test, expect } from "@playwright/test";
import {writeFile} from 'node:fs/promises';

import {
  closeContextQuietly,
  createGamesViaApi,
  createIsolatedPage,
  getHistoryMoveCount,
  makeAnyLegalMove,
} from "../support/app.mjs";

const assertPagingFits = async controls => {
  await expect(controls).toHaveCount(1);
  await expect.poll(()=>controls.evaluate(element=>{
    const bounds=element.getBoundingClientRect(),panel=element.closest('.panel').getBoundingClientRect();
    const parts=[...element.children].map(child=>child.getBoundingClientRect());
    const centers=parts.map(rect=>rect.top+rect.height/2);
    return {count:parts.length,aligned:Math.max(...centers)-Math.min(...centers)<1,
      contained:parts.every(rect=>rect.left>=bounds.left-.1&&rect.right<=bounds.right+.1&&rect.left>=panel.left-.1&&rect.right<=panel.right+.1),
      touchTargets:[parts[0],parts[2]].every(rect=>rect.width>=44&&rect.height>=44)};
  })).toEqual({count:3,aligned:true,contained:true,touchTargets:true});
};

test("home pagination refreshes correctly when a moved game reorders onto an earlier page", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    const createdGameIds = await createGamesViaApi(page, 5);
    const oldestGameId = createdGameIds[0];
    await page.goto("/");

    const mySection = page.locator('[data-home-section-root="my"]');
    await expect(mySection).toBeVisible();
    await expect(mySection).toContainText("Page 1 of 2");

    await mySection.locator('[data-action="home-page-next"]').click();
    await expect(mySection).toContainText("Page 2 of 2");
    const pageTwoCard = page.locator(`[data-game-id="${oldestGameId}"]`).first();
    await expect(pageTwoCard).toBeVisible();

    await pageTwoCard.click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await page.getByRole("button", {name:"Play both sides",exact:true}).click();
    const initialHistoryCount = await getHistoryMoveCount(page);
    await makeAnyLegalMove(page, "p1");
    await expect
      .poll(async () => getHistoryMoveCount(page), {
        message: "Expected the reordered game to record a move before returning home",
      })
      .toBeGreaterThan(initialHistoryCount);

    await page.getByRole("link", { name: "Righelt" }).click();
    await expect(mySection).toContainText("Page 2 of 2");
    await expect(page.locator(`[data-game-id="${oldestGameId}"]`)).toHaveCount(0);

    await mySection.locator('[data-action="home-page-prev"]').click();
    await expect(mySection).toContainText("Page 1 of 2");
    const reorderedCard = page.locator(`[data-game-id="${oldestGameId}"]`).first();
    await expect(reorderedCard).toBeVisible();
    await expect(reorderedCard).toContainText("Move 2");
    await expect(reorderedCard.locator(".mini-board-preview-status")).toContainText("Blue to play");
  } finally {
    await closeContextQuietly(context);
  }
});

test("home header pagination is visible at narrow viewport with a multi-column grid", async ({ browser }) => {
  const { context, page } = await createIsolatedPage(browser);

  try {
    await page.setViewportSize({ width: 850, height: 1100 });
    await createGamesViaApi(page, 5);
    await page.goto("/");

    const mySection = page.locator('[data-home-section-root="my"]');
    await expect(mySection).toBeVisible();

    const headerPaging = mySection.locator(".home-games-section-controls-header");
    await expect(headerPaging).toBeVisible();
    await expect(headerPaging).toContainText("Page 1 of 2");
    await expect(mySection.locator(".home-games-section-controls-footer")).toHaveCount(0);
  } finally {
    await closeContextQuietly(context);
  }
});

test("home pagination keeps both arrows and its label on one line across layouts", async ({ browser }, testInfo) => {
  const { context, page } = await createIsolatedPage(browser);
  try {
    await createGamesViaApi(page, 49);
    await page.goto("/");
    const section = page.locator('[data-home-section-root="my"]');
    for (const scale of [100,200])for (const width of [1440, 1100, 901, 900, 850, 600, 390, 320]) {
      await page.evaluate(scale=>{document.documentElement.style.fontSize=`${scale}%`;},scale);
      await page.setViewportSize({ width, height: 1100 });
      const controls = section.locator('.home-games-section-controls:visible');
      await assertPagingFits(controls);
      await expect(controls).toHaveCount(1);
      await expect.poll(() => controls.evaluate(element => {
        const parts = [...element.children].map(child => child.getBoundingClientRect());
        const centers = parts.map(rect => rect.top + rect.height / 2);
        return Math.max(...centers) - Math.min(...centers);
      }), { message: `Pagination must share a line at ${width}px` }).toBeLessThan(1);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      if (width === 1440 || width === 390) {
        await section.screenshot({ path: testInfo.outputPath(`pagination-${width}-${scale}.png`) });
      }
    }
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const controls = section.locator('.home-games-section-controls:visible');
    await assertPagingFits(controls);
    await expect.poll(() => controls.evaluate(element => {
      const centers = [...element.children].map(child => { const r = child.getBoundingClientRect(); return r.top + r.height / 2; });
      return Math.max(...centers) - Math.min(...centers);
    })).toBeLessThan(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    let releasePage,completePage,heldRequests=0;
    const pageHandled=new Promise(resolve=>{completePage=resolve;});
    const pageGate=new Promise(resolve=>{releasePage=resolve;});
    const pagePattern=/\/api\/shell\/games\?/;
    const holdPage=async route=>{
      const url=new URL(route.request().url());
      const held=url.searchParams.get('section')==='my'&&url.searchParams.get('page')!=='0';
      if(held){heldRequests++;await pageGate;}
      try{await route.continue();}finally{if(held)completePage();}
    };
    await page.route(pagePattern,holdPage);
    try{
      await controls.locator('[data-action="home-page-next"]').click();
      await expect.poll(()=>heldRequests).toBeGreaterThan(0);
      const next=controls.locator('[data-action="home-page-next"]');
      await expect(next).toBeDisabled();await expect(next).toHaveAttribute('data-loading-phase',/visible|slow/);
      await expect(next.locator('.loading-icon-slot > svg')).toHaveCount(1);
      await expect(next.locator('.loading-icon-slot > .loading-pieces')).toBeVisible();
      await assertPagingFits(controls);
      await controls.screenshot({path:testInfo.outputPath('pagination-pending-390-200.png')});
    }finally{releasePage();if(heldRequests)await pageHandled;await page.unroute(pagePattern,holdPage);}
    await expect(section).toContainText('Page 2 of 17');
    await expect(controls.locator('[data-action="home-page-next"]')).toBeEnabled();
    for(let number=3;number<=17;number++){
      await controls.locator('[data-action="home-page-next"]').click();
      await expect(section).toContainText(`Page ${number} of 17`);
      await expect(controls.locator('[data-action="home-page-prev"]')).toBeEnabled();
    }
    await assertPagingFits(controls);
    await controls.screenshot({path:testInfo.outputPath('pagination-last-page-390-200.png')});

    let releaseFont,fontSeen=false;
    const fontGate=new Promise(resolve=>{releaseFont=resolve;});
    await page.route('**/shell/refresh.css',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('../assets/fonts/Manrope-variable.ttf','../assets/fonts/Manrope-variable.ttf?pagination-zoom-cold')+'\n:root{font-size:200%}'});});
    await page.route(url=>url.pathname.endsWith('/Manrope-variable.ttf')&&url.searchParams.has('pagination-zoom-cold'),async route=>{fontSeen=true;await fontGate;await route.continue();});
    const fontProof={};
    try{
      await page.reload({waitUntil:'domcontentloaded'});await expect.poll(()=>fontSeen).toBe(true);
      await expect(section).toContainText('Page 1 of 17');
      expect(await page.evaluate(()=>document.fonts.status)).toBe('loading');
      await assertPagingFits(controls);
      fontProof.cold=await controls.evaluate(element=>({font:document.fonts.status,buttons:[...element.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect();return {width:rect.width,height:rect.height};})}));
      releaseFont();await page.evaluate(()=>document.fonts.ready);await assertPagingFits(controls);
      fontProof.loaded=await controls.evaluate(element=>({font:document.fonts.status,buttons:[...element.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect();return {width:rect.width,height:rect.height};})}));
      expect(fontProof.loaded.buttons).toEqual(fontProof.cold.buttons);
      await controls.screenshot({path:testInfo.outputPath('pagination-loaded-390-200.png')});
    }finally{releaseFont();const path=testInfo.outputPath('pagination-font-proof.json');await writeFile(path,JSON.stringify(fontProof,null,2));await testInfo.attach('cold and loaded pager geometry',{path,contentType:'application/json'});}
  } finally {
    await closeContextQuietly(context);
  }
});
