export function isLiveBoardVisible({document,currentRoute,inHistoryMode,replaying,layout,appEl,window}) {

  if(document.hidden||!document.hasFocus()||currentRoute.name!=='game'||inHistoryMode
    ||currentRoute.scenarios||replaying||(appEl.dataset.shellTransitionPhase??'idle')!=='idle'
    ||layout==='narrow'&&(currentRoute.panel??'board')!=='board')return false;
  const board=appEl.querySelector('[data-testid="game-board"]'),rect=board?.getBoundingClientRect();
  if(!rect||rect.width<=0||rect.height<=0)return false;
  const left=Math.max(0,rect.left),right=Math.min(window.innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(window.innerHeight,rect.bottom);
  // A drawer/dialog can cover a still-mounted Board. Test the visible region,
  // while allowing a docked utility beside a genuinely visible Live Board.
  return right>left&&bottom>top&&Boolean(board.closest('[data-testid="game-board-wrap"]')?.contains(document.elementFromPoint((left+right)/2,(top+bottom)/2)));

}
