import { TUTORIAL_CHAPTERS, HOST_LINES } from './tutorial-lessons.js';
import { readTutorialProgress, writeTutorialProgress } from './tutorial-progress.js';
import { applyAction } from '../generated/packages/game-engine/src/apply.js';
import { listLegalActions, validateAction } from '../generated/packages/game-engine/src/legal.js';
import { resolveToStability } from '../generated/packages/game-engine/src/resolve.js';
export const TUTORIAL_TIMING = Object.freeze({hint:4000,skip:7000,advance:1600});
const sameCoordinate=(a,b)=>!a&&!b||a?.row===b?.row&&a?.col===b?.col;
export const matchesLessonAction=(actual,expected)=>Boolean(expected && actual?.type===expected.type && (!expected.actorId || actual.actorId===expected.actorId) && sameCoordinate(actual.from,expected.from) && sameCoordinate(actual.to,expected.to));
export const createTutorialController = ({chapters=TUTORIAL_CHAPTERS, storage, timers=globalThis, onChange=()=>{}, onComplete=()=>{}}={}) => {
 let chapter=0,unlockedChapter=0,index=0,state=null,host='horus',phase='exercise',hint=false,skipAvailable=false,error='',replay=false,active=false,revision=0;
 let progress=readTutorialProgress(storage),handles=[];
 const exercise=()=>chapters[chapter].exercises[index];
 const clear=()=>{revision++;handles.forEach(id=>timers.clearTimeout(id));handles=[];};
 const current=()=>({chapter,unlockedChapter,index,chapters,total:chapters[chapter].exercises.length,exercise:exercise(),state,host,phase,hint,skipAvailable,error,replay,completed:progress.completed,progress,revision});
 const publish=()=>onChange(current());
 const schedule=(ms,fn)=>{const marker=revision;handles.push(timers.setTimeout(()=>{if(active&&marker===revision)fn();},ms));};
 const arm=()=>{clear();if(!active)return;if(phase==='success'&&!exercise().hold)schedule(TUTORIAL_TIMING.advance,()=>next());else if(phase==='exercise'){schedule(TUTORIAL_TIMING.hint,()=>{hint=true;publish();});schedule(TUTORIAL_TIMING.skip,()=>{skipAvailable=true;publish();});}};
 const load=()=>{if(exercise().position)state=exercise().position();phase='exercise';hint=false;skipAvailable=false;error='';arm();publish();};
 const completeExercise=()=>{phase='success';error='';hint=false;skipAvailable=false;arm();publish();};
 const next=()=>{
  if(phase!=='success')return false;
  clear();
  if(index<chapters[chapter].exercises.length-1){index++;load();return true;}
  progress.completed=[...new Set([...progress.completed,chapters[chapter].id])];writeTutorialProgress(storage,progress);
  if(chapter<chapters.length-1){chapter++;unlockedChapter=Math.max(unlockedChapter,chapter);index=0;load();return true;}
  phase='complete';publish();return true;
 };
 const reject=message=>{error=message||HOST_LINES[host].error;publish();return {ok:true,accepted:false,state,legalActions:listLegalActions(state),validation:{ok:false,code:'LESSON_OBJECTIVE',message:error}};};
 const response=()=>({ok:true,accepted:true,state,legalActions:listLegalActions(state),outcome:state.outcome});
 return {
  current,next,
  start({host:nextHost='horus',replay:manual=false}={}){clear();host=HOST_LINES[nextHost]?nextHost:'horus';replay=manual;progress=readTutorialProgress(storage);chapter=manual?0:Math.max(0,chapters.findIndex(c=>!progress.completed.includes(c.id)));unlockedChapter=chapter;index=0;active=true;load();},
  reset(){chapter=0;index=0;load();},
  selectChapter(value){if(!Number.isInteger(value)||value<0||value>=chapters.length||(!replay&&value>unlockedChapter&&!progress.completed.includes(chapters[value].id)))return false;chapter=value;index=0;load();return true;},
  setHost(value){if(!HOST_LINES[value])return;host=value;publish();},
  handleAction(action){if(!active||phase!=='exercise')return reject('Wait for the next instruction.');if(!matchesLessonAction(action,exercise().action))return reject();const validation=validateAction(state,action);if(!validation.ok)return reject('That move is unavailable. Restart this chapter to try again.');state=resolveToStability(applyAction(state,action).state,{artifactMode:'full'});completeExercise();return response();},
  handleEndTurn(){if(!active||phase!=='exercise'||!exercise().endTurn)return reject();const validation=validateAction(state,{type:'pass'});if(!validation.ok)return reject('Reconnect the group’s supply before ending the turn.');state=resolveToStability(applyAction(state,{type:'pass'}).state,{artifactMode:'full'});completeExercise();return response();},
  inspect({selectedPieceId,overlay,state:observed}){if(observed&&JSON.stringify(observed)!==JSON.stringify(state))return;if(active&&phase==='exercise'&&exercise().inspect===selectedPieceId&&overlay?.phase==='supplyCommand')completeExercise();},
  activity(){if(phase!=='exercise')return;hint=false;skipAvailable=false;error='';arm();publish();},
  pause(){active=false;clear();},resume(){active=true;arm();},
  skip(){if(!skipAvailable||phase!=='exercise')return false;if(exercise().action)return this.handleAction(exercise().action);if(exercise().endTurn)return this.handleEndTurn();completeExercise();return true;},
  finish(result='completed'){if(result==='completed'&&phase!=='complete')return false;clear();active=false;progress.result=progress.result==='completed'?'completed':result;writeTutorialProgress(storage,progress);onComplete(result);return true;},
  destroy(){active=false;clear();}
 };
};
