import {createComputerReplay} from './computer-replay.js';

export function createConfirmedFramePresenter({getRoot,getGameId,createAdapter,reducedMotion,createReplay=createComputerReplay}){
 let visual=null;
 return {
  present(frame,{signal,onDisplayed}){
   return new Promise((resolve,reject)=>{
    const rootEl=getRoot();if(!rootEl){reject(Error('board_unavailable'));return;}
    visual?.destroy();
    const abort=()=>visual?.stop('scope-changed');
    const finish=({reason})=>{
     signal.removeEventListener('abort',abort);
     if(reason==='completed'||signal.aborted)resolve();else reject(Error(`confirmed_presentation_${reason}`));
    };
    visual=createReplay({rootEl,createAdapter,automatic:true,reducedMotion,onFrame:onDisplayed,onFinish:finish});
    if(signal.aborted){visual.destroy();resolve();return;}
    signal.addEventListener('abort',abort,{once:true});
    void visual.play({gameId:getGameId(),frames:[frame]}).catch(error=>{signal.removeEventListener('abort',abort);reject(error);});
   });
  },
  destroy(){visual?.destroy();visual=null;},
 };
}
