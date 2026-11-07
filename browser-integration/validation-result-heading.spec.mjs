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


test('named observer heading is exact and never falls back to numbered, wrong-name or longer copy',async({page})=>{
 const result=page.getByTestId('result');
 for(const winnerName of ['Guest 1','Guest 2','Horus','名字 שלום']) {
  await page.setContent('<section data-testid="result"><h2></h2></section>');
  await result.getByRole('heading').evaluate((node,text)=>node.textContent=text,`${winnerName} won`);
  await assertResultHeading(result,{contract:'perspective-v2',outcome:'p2_win',winnerName});
 }
 for(const title of ['Player 2 wins','Guest 1 won','Horus won again']) {
  await page.setContent(`<section data-testid="result"><h2>${title}</h2></section>`);
  await assert.rejects(()=>assertResultHeading(result,{contract:'perspective-v2',outcome:'p2_win',winnerName:'Horus'},{timeout:100}));
 }
});

const namedHeading = async (page,{actor,color,selfPlay=false}) => {
 await page.setContent('<style>.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}</style><section data-testid="result"><h1><span class="owner"><bdi dir="auto"></bdi></span></h1></section>');
 await page.getByTestId('result').getByRole('heading').evaluate((heading,{actor,color,selfPlay})=>{
  const owner=heading.querySelector('.owner');
  if(!selfPlay){const prefix=document.createElement('span');prefix.className='sr-only';prefix.textContent=`${color}: `;owner.prepend(prefix);}
  owner.querySelector('bdi').textContent=selfPlay?`${actor} won as ${color}`:actor;
  if(!selfPlay)heading.append(document.createTextNode(' won'));
 },{actor,color,selfPlay});
};

test('named v3 headings include exact native nonvisual color and isolated canonical identity',async({page})=>{
 const result=page.getByTestId('result');
 for(const [outcome,winner,color]of[['p1_win','p1','Red'],['p2_win','p2','Blue']]){
  for(const winnerName of ['Guest 1','Horus','Red <&> שלום']){
   await namedHeading(page,{actor:winnerName,color});
   await assertResultHeading(result,{contract:'named-perspective-v3',outcome,winnerName});
   await assertResultHeading(result,{contract:'named-perspective-v3',outcome,winnerName,viewerSide:winner==='p1'?'p2':'p1'});
  }
  await namedHeading(page,{actor:'You',color});
  await assertResultHeading(result,{contract:'named-perspective-v3',outcome,viewerSide:winner});
  for(const [actor,controlsBothSides]of[['You',true],['Same name',false]]){
   await namedHeading(page,{actor,color,selfPlay:true});
   await assertResultHeading(result,{contract:'named-perspective-v3',outcome,winnerName:actor,selfPlay:true,controlsBothSides});
  }
 }
});

test('named v3 rejects wrong owner, wrong name, missing qualifier and longer copy without fallback',async({page})=>{
 const result=page.getByTestId('result'),options={contract:'named-perspective-v3',outcome:'p1_win',winnerName:'Horus'};
 for(const [actor,color]of[['Horus','Blue'],['Guest 1','Red'],['Horus again','Red']]){
  await namedHeading(page,{actor,color});
  await assert.rejects(()=>assertResultHeading(result,options,{timeout:100}));
 }
 await page.setContent('<section data-testid="result"><h1>Horus won</h1></section>');
 await assert.rejects(()=>assertResultHeading(result,options,{timeout:100}));
 await namedHeading(page,{actor:'You',color:'Blue',selfPlay:true});
 await assert.rejects(()=>assertResultHeading(result,{...options,controlsBothSides:true,selfPlay:true},{timeout:100}));
});
