import {createBoardRuntime} from '../board/runtime/board-runtime.js';
import {createEngineBoardAdapter} from '../board-adapters/engine-board-adapter.js';
import {createTutorialBoardHost} from '../board/hosts/tutorial-host.js';
import {listLegalActions} from '../generated/packages/game-engine/src/legal.js';
import {HOST_LINES} from './tutorial-lessons.js';
import {icon} from './ui.js';
import {renderPieceSymbol} from '../piece-symbols.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const renderHostGuidance = host => `<div class="lesson-host"><img src="/assets/opponents/${host}-portrait.webp" width="174" height="116" alt="${esc(host[0].toUpperCase()+host.slice(1))}, your teacher"><div><p class="lesson-host-name">${esc(host[0].toUpperCase()+host.slice(1))}</p><p class="lesson-host-line">${esc(HOST_LINES[host].welcome)}</p></div></div>`;
export const renderChapterNavigation = value => `<details class="lesson-chapters"><summary>Chapter ${value.chapter+1} of ${value.chapters.length}: ${esc(value.chapters[value.chapter].title)}</summary><nav aria-label="Tutorial chapters">${value.chapters.map((c,i)=>`<button class="secondary" data-lesson-chapter="${i}" ${!value.replay&&i>value.unlockedChapter&&!value.completed.includes(c.id)?'disabled':''} aria-current="${i===value.chapter?'step':'false'}">${value.completed.includes(c.id)?icon('check'):''}${esc(c.title)}</button>`).join('')}</nav></details>`;
export const createTutorialView = ({controller,onFinish,onExit,onRetry=()=>{},onSound=()=>{},supportsHover=()=>false}) => {
 let root=null,runtime=null,key='',snapshot=null,accountStage=false,boardApplying=false;
 const mount=element=>{
  if(root===element)return;
  destroy();root=element;key='';snapshot=null;accountStage=false;
  root.innerHTML=`<div class="lesson-layout"><section class="panel lesson-guidance" aria-label="Your lesson"><div data-lesson-host></div><div data-lesson-navigation></div><div class="lesson-instruction" aria-live="polite" aria-atomic="true"><h2 data-lesson-title tabindex="-1"></h2><p data-lesson-prompt></p><p class="lesson-feedback" data-lesson-feedback></p><p class="lesson-hint" data-lesson-hint hidden></p></div><div class="lesson-actions"><button data-lesson-continue hidden>${icon('right')}Continue</button><button class="secondary" data-lesson-skip hidden>Skip step</button><button class="secondary" data-lesson-skip-all>Skip tutorial</button><button class="secondary" data-lesson-exit>${icon('back')}Back</button></div><label class="lesson-host-picker" hidden>Teacher <select data-lesson-host-picker><option value="horus">Horus</option><option value="babs">Babs</option><option value="tau">Tau</option></select></label></section><section class="panel lesson-board" data-shell-panel="board" data-turn-side="red"><h2>Practice board <span data-lesson-turn></span></h2><p class="board-preview-label" data-lesson-preview></p><div class="board-wrap"><div class="board" data-testid="tutorial-board"></div><svg class="overlay-lines" aria-hidden="true"></svg></div><div class="overlay-key" aria-label="Board legend"><span><i class="swatch commander-key">${renderPieceSymbol('commander')}</i>Commander</span><span><i class="swatch supply-point">${renderPieceSymbol('supply')}</i>Supply point</span><span data-legend-entry="command" hidden><i class="swatch command"></i>Command line</span><span data-legend-entry="supply" hidden><i class="swatch supply"></i>Supply line</span><span data-legend-entry="group" hidden><i class="swatch group"></i>Group strength</span></div><div class="lesson-board-actions"><button class="secondary" data-lesson-pass>Pass</button><button class="secondary" data-lesson-end>End turn</button></div></section></div><section class="panel lesson-account" data-lesson-account hidden><div data-account-host></div><div data-account-form></div><p role="status" data-lesson-account-status></p><button class="secondary" data-lesson-account-retry hidden>Try again</button><button class="secondary" data-lesson-exit>${icon('back')}Back</button></section>`;
  const host=createTutorialBoardHost(controller);
  const apply=host.applyAction;
  host.applyAction=async (...args)=>{boardApplying=true;try{return await apply(...args);}finally{boardApplying=false;}};
  runtime=createBoardRuntime({boardAdapter:createEngineBoardAdapter(),host,controls:{getSupportsHover:supportsHover,getAllowFreeSelection:()=>false,onInteractionSound:event=>{if(['select','preview','cancel'].includes(event.kind))controller.activity();onSound(event);},onActionResult:value=>{if(value?.accepted)onSound({kind:'move'});},onStateUpdated:value=>{queueMicrotask(()=>controller.inspect(value));highlight();},onVisualsUpdated:value=>{for(const name of ['command','supply','group'])root.querySelector(`[data-legend-entry="${name}"]`).hidden=!value[name];}}});
  runtime.bindElements({boardEl:root.querySelector('.board'),overlayLinesEl:root.querySelector('.overlay-lines'),boardPreviewLabelEl:root.querySelector('[data-lesson-preview]'),boardTurnIndicatorEl:root.querySelector('[data-lesson-turn]')});
  root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('keydown',keydown);update();root.querySelector('[data-lesson-title]').focus({preventScroll:true});
 };
 const click=event=>{
  if(event.target.closest('.cell'))controller.activity();
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-lesson-pass'))controller.handleAction({type:'pass'});
  if(button.hasAttribute('data-lesson-end'))controller.handleEndTurn();
  if(button.hasAttribute('data-lesson-chapter')){onSound({kind:'cancel'});controller.selectChapter(Number(button.dataset.lessonChapter));root.querySelector('.lesson-chapters summary').focus({preventScroll:true});}
  if(button.hasAttribute('data-lesson-continue')){if(controller.current().phase==='complete')onFinish('completed');else {controller.next();root.querySelector('[data-lesson-title]').focus({preventScroll:true});}}
  if(button.hasAttribute('data-lesson-skip')&&controller.skip())root.querySelector('[data-lesson-title]').focus({preventScroll:true});
  if(button.hasAttribute('data-lesson-skip-all'))onFinish('skipped');
  if(button.hasAttribute('data-lesson-exit'))onExit();
  if(button.hasAttribute('data-lesson-account-retry'))onRetry();
 };
 const keydown=event=>{if(accountStage&&event.key==='Escape'){event.preventDefault();onExit();}};
 const change=event=>{if(event.target.hasAttribute('data-lesson-host-picker'))controller.setHost(event.target.value);};
 const highlight=()=>{if(!root||!runtime)return;const value=controller.current();root.querySelectorAll('.lesson-target').forEach(n=>n.classList.remove('lesson-target'));if(!value.hint)return;const target=value.exercise.action?.to||value.state.pieces.find(p=>p.id===value.exercise.inspect)?.position;if(target)root.querySelector(`.cell[data-row="${target.row}"][data-col="${target.col}"]`)?.classList.add('lesson-target');};
 const update=()=>{
  if(!root||accountStage)return;
  const v=controller.current();root.dataset.exercise=v.exercise.id;root.dataset.phase=v.phase;const nextKey=`${v.chapter}:${v.index}:${v.host}`;
  if(key!==nextKey){key=nextKey;root.querySelector('[data-lesson-host]').innerHTML=renderHostGuidance(v.host);root.querySelector('[data-lesson-navigation]').innerHTML=renderChapterNavigation(v);root.querySelector('[data-lesson-title]').textContent=v.chapters[v.chapter].title;root.querySelector('[data-lesson-host-picker]').value=v.host;}
  root.querySelector('.lesson-host-line').textContent=v.phase==='complete'?HOST_LINES[v.host].finish:v.phase==='success'?HOST_LINES[v.host].success:HOST_LINES[v.host].welcome;
  root.querySelector('.lesson-host-picker').hidden=!v.replay;
  root.querySelector('[data-lesson-prompt]').textContent=v.phase==='complete'?HOST_LINES[v.host].finish:v.exercise.prompt;
  const feedback=root.querySelector('[data-lesson-feedback]');feedback.textContent=v.error||(v.phase==='success'?v.exercise.success:'');feedback.hidden=!feedback.textContent;feedback.dataset.state=v.error?'error':'success';
  const hint=root.querySelector('[data-lesson-hint]');hint.hidden=!v.hint;hint.textContent=v.exercise.hint;
  const next=root.querySelector('[data-lesson-continue]');next.hidden=!(v.phase==='complete'||v.phase==='success'&&v.exercise.hold);next.innerHTML=`${icon('right')}${v.phase==='complete'?'Start playing':'Continue'}`;
  root.querySelector('[data-lesson-skip]').hidden=!v.skipAvailable;
  root.querySelector('[data-lesson-skip-all]').hidden=v.phase==='complete';
  for(const n of root.querySelectorAll('[data-lesson-pass],[data-lesson-end]'))n.disabled=v.phase!=='exercise';
  root.querySelector('[data-lesson-pass]').hidden=v.exercise.action?.type!=='pass';root.querySelector('[data-lesson-end]').hidden=!v.exercise.endTurn;
  
  root.querySelector('.lesson-board').dataset.turnSide=v.state.sideToMove==='P2'?'blue':'red';
  if(snapshot!==v.state){snapshot=v.state;if(!boardApplying)void runtime.loadSnapshot(v.state,{legalActions:listLegalActions(v.state),resetSelection:true});}
  highlight();
 };
 const showAccount=element=>{accountStage=true;controller.pause();root.querySelector('.lesson-layout').hidden=true;root.querySelector('[data-lesson-account]').hidden=false;root.querySelector('[data-account-host]').innerHTML=renderHostGuidance(controller.current().host);if(element)root.querySelector('[data-account-form]').append(element);globalThis.scrollTo?.({top:0,behavior:'instant'});};
 const accountStatus=(text,retry=false)=>{root.querySelector('[data-lesson-account-status]').textContent=text;root.querySelector('[data-lesson-account-retry]').hidden=!retry;};
 const destroy=()=>{if(root){root.removeEventListener('click',click);root.removeEventListener('change',change);root.removeEventListener('keydown',keydown);}runtime?.destroy();runtime=null;root=null;};
 return {mount,update,destroy,showAccount,accountStatus};
};
