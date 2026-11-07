import {test,expect} from '@playwright/test';
for(const scale of [100,200])test(`controlled heading owns unchanged leading inset at ${scale}%`,async({page},info)=>{
 await page.setViewportSize({width:390,height:740});
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 const samples=await page.evaluate(async scale=>{
  const {renderBoardHeadingSlot}=await import('/apps/web/shell/board-message-layout.js');document.documentElement.style.fontSize=`${scale}%`;await document.fonts.ready;await window.boardFixture.setup('pass',false);
  const target=document.querySelector('main > h2');target.outerHTML=renderBoardHeadingSlot({loading:true});
  const heading=document.querySelector('.board-heading:not([aria-hidden])'),slot=heading.parentElement;
  // Disable ONLY the candidate declarations: the pinned original cascade, including UA styles, supplies the baseline.
  const selector='main > .board-heading-slot > .board-heading';
  const rules=[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]).filter(rule=>rule.selectorText===selector);
  if(rules.length!==1)throw Error('Exact candidate owned-rule inventory');
  const owned=rules[0],originalCssText=owned.style.cssText;
  if(owned.style.length!==2||owned.style.getPropertyValue('margin-block-start')!=='0px'||owned.style.getPropertyValue('padding-block-start')!=='0.83em')throw Error('Candidate declaration binding');
  const read=()=>{const h=heading.getBoundingClientRect(),s=slot.getBoundingClientRect(),board=document.querySelector('#board').getBoundingClientRect(),range=document.createRange();range.selectNodeContents(heading);const text=range.getBoundingClientRect();return {heading:h.toJSON(),slot:s.toJSON(),board:board.toJSON(),textTop:text.top,font:getComputedStyle(heading).fontSize,line:getComputedStyle(heading).lineHeight,margin:getComputedStyle(heading).marginTop,padding:getComputedStyle(heading).paddingTop};};
  let before;try{
   owned.style.removeProperty('margin-block-start');owned.style.removeProperty('padding-block-start');
   if(owned.style.length!==0)throw Error('Old cascade not restored');
   before=read();
  }finally{owned.style.cssText=originalCssText;}
  if(owned.style.cssText!==originalCssText)throw Error('Candidate declaration restore mismatch');
  const after=read();
  // Deliberate physical regressions must be rejected by the same exact oracles.
  const negativeControls=[];
  for(const [name,property,value] of [['heading-margin','margin-block-start','1px'],['heading-padding','padding-block-start','calc(0.83em + 1px)']]){
   let perturbed;try{owned.style.setProperty(property,value);perturbed=read();}
   finally{owned.style.cssText=originalCssText;}
   if(owned.style.cssText!==originalCssText)throw Error('Negative control declaration restore mismatch');
   negativeControls.push({name,perturbed,restored:read(),restoredCssText:owned.style.cssText});
  }
  // A production .panel descendant must retain its separate zero-margin contract.
  const panel=document.createElement('section');panel.className='panel';panel.innerHTML=renderBoardHeadingSlot({loading:true});document.body.append(panel);const ph=panel.querySelector('.board-heading'),style=getComputedStyle(ph),production={margin:style.marginTop,padding:style.paddingTop};panel.remove();
  return {before,after,negativeControls,production,baseline:{mode:'pinned-original-cascade-candidate-declarations-disabled',originalCssText,restoredCssText:owned.style.cssText}};
 },scale);
 await info.attach('Controlled leading inset old and owned',{body:JSON.stringify(samples),contentType:'application/json'});
 expect(samples.after.heading.bottom).toBe(samples.after.slot.bottom);
 expect(samples.after.slot).toEqual(samples.before.slot);expect(samples.after.board).toEqual(samples.before.board);
 expect(samples.after.textTop).toBe(samples.before.textTop);expect(samples.after.font).toBe(samples.before.font);expect(samples.after.line).toBe(samples.before.line);
 // CSSOM may expose a used UA margin and a computed padding at different stages.
 // Compare the owned physical box directly, with exact text/Board anchors above.
 expect(samples.after.margin).toBe('0px');expect(samples.after.heading).toEqual(samples.after.slot);
 expect(samples.negativeControls.map(control=>control.name)).toEqual(['heading-margin','heading-padding']);
 for(const control of samples.negativeControls){
  if(control.name==='heading-margin')expect(control.perturbed.heading).not.toEqual(control.perturbed.slot);
  else{expect(control.perturbed.textTop).not.toBe(samples.after.textTop);expect(control.perturbed.board).not.toEqual(samples.after.board);}
  expect(control.restored).toEqual(samples.after);
  expect(control.restoredCssText).toBe(samples.baseline.originalCssText);
 }
 expect(samples.production).toEqual({margin:'0px',padding:'0px'});
});
