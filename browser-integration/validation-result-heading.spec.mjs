import {test} from '@playwright/test';
import assert from 'node:assert/strict';
import {assertResultHeading} from '../scripts/validation/result-heading.mjs';

for (const contract of ['legacy', 'perspective-v1']) {
  test(`released result assertion preserves exact ${contract} player, observer and draw headings`, async ({page}) => {
    const examples = contract === 'legacy'
      ? [['p1_win','p1','Win'],['p1_win','p2','Loss'],['p2_win','p2','Win'],['p2_win','p1','Loss']]
      : [['p1_win','p1','You won'],['p1_win','p2','Your opponent won'],['p2_win','p2','You won'],['p2_win','p1','Your opponent won']];
    for (const [outcome, viewerSide, title] of [...examples, ['p1_win',null,'Player 1 wins'], ['p2_win',null,'Player 2 wins'], ['draw',null,'Draw']]) {
      await page.setContent(`<section data-testid="result"><h2>${title}</h2><button>Play again</button></section>`);
      await assertResultHeading(page.getByTestId('result'), {contract, outcome, viewerSide});
    }
  });
}

test('a wrong contract, perspective or longer lookalike fails without accepting fallback copy', async ({page}) => {
  for (const [contract, title, viewerSide] of [['perspective-v1','Loss','p2'], ['legacy','Your opponent won','p2'], ['perspective-v1','You won','p2'], ['perspective-v1','Your opponent won again','p2']]) {
    await page.setContent(`<section data-testid="result"><h2>${title}</h2></section>`);
    await assert.rejects(() => assertResultHeading(page.getByTestId('result'), {contract, outcome:'p1_win', viewerSide}, {timeout:100}));
  }
});
