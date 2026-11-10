import {test,expect} from '@playwright/test';

test('native note focus, typing and reopen preserve the displayed decision owner',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');
 await page.evaluate(async()=>{
  const {mountDecisionNoteEditor}=await import('/apps/web/shell/decision-note-editor.js');
  const {patchSectionContent}=await import('/apps/web/shell/dom-patch.js');
  const {renderDecisionDebug}=await import('/apps/web/shell/computer-view.js');
  const state={drafts:new Map(),notes:[],attempts:new Map(),open:new Set(['notes']),items:[]};
  let game={id:'g',moves:[{moveId:'prior',action:{type:'pass'}}],currentSnapshot:{sideToMove:'P1'}};
  const root=document.createElement('div');document.body.replaceChildren(root);
  const render=()=>{const next=root.cloneNode(false);next.innerHTML=renderDecisionDebug({game,status:{},state,signedIn:true});patchSectionContent(root,next);};
  mountDecisionNoteEditor({document,getCurrentViewedGameId:()=>game.id,getDecisionDebugState:()=>state,updateComputerUi:render});
  render();
  window.advanceDisplayedDecision=()=>{game={...game,moves:[...game.moves,{moveId:'next',action:{type:'pass'}}]};render();};
 });
 const notes=page.locator('[data-debug-section="notes"]');
 const draft=notes.locator('[data-debug-note="text"]');
 await draft.focus();
 await page.evaluate(()=>window.advanceDisplayedDecision());
 await expect(draft).toHaveAttribute('data-decision-id','prior');
 await expect(draft).toBeFocused();
 await draft.fill('Keep this with the prior decision');
 await expect(notes.locator('[data-action="debug-save-note"]')).toHaveAttribute('data-decision-id','prior');
 await notes.locator('summary').click();
 await expect(notes).not.toHaveAttribute('open');
 await notes.locator('summary').click();
 await expect(draft).toHaveAttribute('data-decision-id','next');
 await expect(draft).toHaveValue('');
});
