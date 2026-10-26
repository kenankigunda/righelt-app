import {test, expect} from '@playwright/test';

const measure = (page, selector) => page.locator(selector).evaluate(host => {
  const cue = host.querySelector('.loading-pieces');
  const label = host.querySelector('.board-preview-label') ?? host;
  const text = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
  const range = document.createRange();
  range.setStart(text, text.textContent.lastIndexOf(' ') + 1);
  range.setEnd(text, text.textContent.length);
  const word = range.getBoundingClientRect();
  const rect = cue.getBoundingClientRect();
  const style = getComputedStyle(cue);
  const dot = getComputedStyle(cue.querySelector('i'));
  return {
    font: style.fontFamily, size:parseFloat(style.fontSize), width:rect.width, height:rect.height,
    gap:rect.left-word.right, center:rect.top+rect.height/2-word.top-word.height/2,
    dot:parseFloat(dot.width), pieceGap:parseFloat(style.gap), color:style.color,
    animation:dot.animationName, duration:dot.animationDuration, shape:dot.clipPath,
  };
});

for (const width of [320,390,1440]) for (const scale of [1,2]) {
  test(`approved current reference matches board and inline status at ${width}px and ${scale*100}%`, async ({page,context}, info) => {
    await page.setViewportSize({width,height:1000});
    await page.goto('/browser-integration/support/board-message.html');
    await page.waitForFunction(() => window.fixtureReady);
    await page.evaluate(async scale => {
      await window.boardFixture.setup('pass',false);
      document.documentElement.style.fontSize=`${scale*100}%`;
      window.boardFixture.message('Tau is thinking');
      window.updateComputerBoardLoading(document.querySelector('.board-message-activity'), {
        id:'reference-parity',computer:{seats:{p1:'tau',p2:null}},computerTurn:'tau',board:{state:{sideToMove:'P1'}},
      },{phase:'checking'},{scope:'parity-owner'});
      const status=document.createElement('p');status.id='inline-status';
      status.style.cssText=`font-size:1rem;line-height:1.5;width:${document.querySelector('.board-message-live').getBoundingClientRect().width}px`;status.dataset.activitySide='P1';
      status.innerHTML='<span data-loading-state="pending" data-loading-context="external" data-loading-key="inline-reference">Tau is thinking</span>';
      document.querySelector('#app').append(status);
      await document.fonts.ready;
    },scale);
    await expect(page.locator('#inline-status .loading-pieces')).toBeVisible();
    await expect(page.locator('.board-message-activity .loading-pieces')).toBeVisible();
    const reference=await context.newPage();
    try {
      await reference.setViewportSize({width,height:1000});
      await reference.goto('/browser-integration/support/loading-comparison/index.html');
      await reference.waitForFunction(() => window.studyReady);
      // Compare the same available text width, independent of the study card's padding.
      await reference.evaluate(async ({scale,available}) => {
        document.documentElement.style.fontSize=`${scale*100}%`;
        const panel=document.querySelector('.study-current');
        panel.style.cssText=`padding:0;border:0;width:${available}px;max-width:none`;
        await document.fonts.ready;
      },{scale,available:await page.locator('.board-message-live').evaluate(node=>node.getBoundingClientRect().width)});
      await expect(reference.locator('.study-current .board-message-activity').first()).toHaveAttribute('data-loading-phase',/visible|slow/);
      const actual=await measure(page,'.board-message-live');
      const approved=await measure(reference,'.study-current .actor-sample[data-activity-side="P1"] .board-message-live');
      const inline=await measure(page,'#inline-status > span');
      await info.attach('reference-metrics',{body:JSON.stringify({actual,approved,inline},null,2),contentType:'application/json'});
      for (const sample of [actual,inline]) {
        for (const key of ['size','width','height','gap','center','dot','pieceGap']) expect(sample[key],key).toBeCloseTo(approved[key],1);
        for (const key of ['font','color','animation','duration','shape']) expect(sample[key],key).toBe(approved[key]);
      }
      expect(actual.size).toBe(16*scale);
      expect(actual.gap).toBeCloseTo(actual.size*.3,1);
      expect(actual.dot).toBeCloseTo(actual.size*.3,1);
      expect(actual.pieceGap).toBe(3);
      await page.screenshot({path:info.outputPath(`actual-board-reference-${width}-${scale*100}.png`)});
      await reference.locator('.study-current').screenshot({path:info.outputPath(`approved-reference-${width}-${scale*100}.png`)});
      await page.emulateMedia({reducedMotion:'reduce'});
      expect(await page.locator('.board-message-activity i').first().evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
    } finally {await reference.close();}
  });
}
