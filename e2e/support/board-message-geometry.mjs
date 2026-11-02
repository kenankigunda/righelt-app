import {expect} from '@playwright/test';
import {edgeDelta,settledMessage} from '../../browser-integration/support/message-semantic-geometry.mjs';
export {settledMessage};

export const measureBoardMessageGeometry=page=>page.evaluate(()=>{
 const board=document.getElementById('shell-board'),panel=board.closest('[data-shell-panel="board"]'),slot=panel.querySelector('.board-message-slot');
 const rect=node=>node.getBoundingClientRect().toJSON();
 const bounds=rect(board),message=rect(slot);
 return{board:bounds,slot:message,panel:rect(panel),boardLayoutHeight:getComputedStyle(board).height,
  documentBoard:{x:bounds.x+scrollX,y:bounds.y+scrollY,width:bounds.width,height:bounds.height},
  documentSlotTop:message.top+scrollY,viewport:{width:document.documentElement.clientWidth,height:innerHeight},
  message:document.getElementById('shell-board-preview-label')?.textContent};
});

export const assertSettledBoardMessageGrowth=(before,after)=>{
 expect({x:after.board.x,width:after.board.width,layoutHeight:after.boardLayoutHeight}).toEqual({x:before.board.x,width:before.board.width,layoutHeight:before.boardLayoutHeight});
 expect(after.documentSlotTop).toBe(before.documentSlotTop);
 for(const sample of [before,after])for(const rect of [sample.board,sample.slot])expect(rect.bottom).toBe(rect.top+rect.height);
 const movement=edgeDelta(after.board.top,before.board.top,after.slot.bottom,before.slot.bottom,
  [after.board.top,before.board.top,after.slot.top,after.slot.height,before.slot.top,before.slot.height],
  'Accepted narration may move the board only by its measured slot growth');
 expect(after.board.top).toBeGreaterThanOrEqual(after.slot.bottom);
 expect(after.board.left).toBeGreaterThanOrEqual(-1);expect(after.board.right).toBeLessThanOrEqual(after.viewport.width+1);
 expect(after.board.top).toBeGreaterThanOrEqual(-1);expect(after.board.bottom).toBeLessThanOrEqual(after.viewport.height+1);
 return movement;
};
