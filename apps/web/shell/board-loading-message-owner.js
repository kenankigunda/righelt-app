import {createMessageHeightController} from '../board/message-height.js';

// Loading and live prompts use the same finite-grammar controller. The shell
// owns only the loading label, then releases it before the runtime binds live.
export function createBoardLoadingMessageOwner(root,{createController=createMessageHeightController}={}) {
 let label=null,controller=null,disposed=false;
 const release=()=>{const previous=controller;controller=null;label=null;previous?.destroy();};
 return {
  sync(){
   if(disposed)return;
   const next=root.querySelector('[data-game-shell-root] .board-loading-preview .board-message-live > .board-preview-label');
   if(next===label&&(!next||next.isConnected))return;
   release();
   if(next?.isConnected){controller=createController(next);label=next;}
  },
  release,
  destroy(){disposed=true;release();},
 };
}
