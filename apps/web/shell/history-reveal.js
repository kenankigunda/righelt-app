export function historyRevealScrollDelta({top,bottom,visibleBottom,topInset=12}) {
  if(top<topInset)return top-topInset;
  if(bottom>visibleBottom)return bottom-visibleBottom;
  return 0;
}
