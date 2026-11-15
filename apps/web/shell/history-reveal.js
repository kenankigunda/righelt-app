export function historyRevealScrollDelta({top,bottom,visibleBottom,topInset=12}) {
  if(top<topInset)return top-topInset;
  if(bottom>visibleBottom)return bottom-visibleBottom;
  return 0;
}

export function scheduleHistoryReveal({requestFrame,isCurrent=()=>true,reveal}) {
  if (typeof requestFrame !== 'function' || typeof reveal !== 'function') return false;
  requestFrame(() => requestFrame(() => { if (isCurrent()) reveal(isCurrent); }));
  return true;
}
