export const patchSectionContent = (current,next) => {
  // The preview controller owns these children and runtime attributes. Its
  // reconciliation step supplies updated data after the surrounding card patch.
  if(current.hasAttribute('data-mini-board-preview') && next.hasAttribute('data-mini-board-preview')) {
    current.setAttribute('data-preview-id', next.getAttribute('data-preview-id'));
    return;
  }
  const persistent = current.hasAttribute('data-persist') && next.hasAttribute('data-persist');
  if (persistent && (current.dataset.decisionId !== next.dataset.decisionId || current.dataset.version !== next.dataset.version)) { current.replaceWith(next.cloneNode(true)); return; }
  // Loading feedback owns its mounted cue. A fresh render of the same pending
  // operation must not disconnect that child and restart its native animation.
  const samePendingKey = current.dataset.loadingState === 'pending' && next.dataset.loadingState === 'pending'
    && current.dataset.loadingKey && current.dataset.loadingKey === next.dataset.loadingKey;
  const cues = samePendingKey ? [...current.children].filter(child => child.matches('.loading-pieces')) : [];
  const retainedCue = cues.length === 1 && ![...next.children].some(child => child.matches('.loading-pieces')) ? cues[0] : null;
  const retainedHistoryPress = current.matches?.('.history-undone-toggle.is-pressing')
    && next.matches?.('.history-undone-toggle') && current.dataset.groupKey === next.dataset.groupKey;
  for(const attr of [...current.attributes])if(!(persistent && attr.name === 'open') && !(retainedCue && attr.name === 'data-loading-phase') && !next.hasAttribute(attr.name))current.removeAttribute(attr.name);
  for(const attr of next.attributes){
    const value=attr.name==='class'&&retainedHistoryPress ? `${attr.value} is-pressing` : attr.value;
    if(current.getAttribute(attr.name)!==value)current.setAttribute(attr.name,value);
  }
  if (persistent && (current.tagName === 'TEXTAREA' || current.tagName === 'INPUT' || current.isContentEditable)) return;
  const staticChildren = () => [...current.childNodes].filter(child => child !== retainedCue);
  const staticChildAt = index => retainedCue ? staticChildren()[index] : current.childNodes[index];
  const old=[...current.childNodes].filter(child => child !== retainedCue),fresh=[...next.childNodes];
  const freshKeys=new Set(fresh.filter(child=>child.nodeType===Node.ELEMENT_NODE).map(child=>child.getAttribute('data-key')).filter(Boolean));
  for(const child of old){
    const key=child.nodeType===Node.ELEMENT_NODE?child.getAttribute('data-key'):null;
    if(key&&!freshKeys.has(key))child.remove();
  }
  fresh.forEach((child,index)=>{
    const key = child.nodeType === Node.ELEMENT_NODE ? child.getAttribute('data-key') : null;
    const existing = key ? old.find(node => node.nodeType === Node.ELEMENT_NODE && node.getAttribute('data-key') === key) : staticChildAt(index);
    if (existing && staticChildAt(index) !== existing) current.insertBefore(existing, staticChildAt(index) ?? retainedCue);
    if(!existing){current.insertBefore(child.cloneNode(true), staticChildAt(index) ?? retainedCue);return;}
    if(existing.nodeType===child.nodeType && existing.nodeName===child.nodeName){
      if(child.nodeType===Node.TEXT_NODE){if(existing.textContent!==child.textContent)existing.textContent=child.textContent;}
      else if(child instanceof Element)patchSectionContent(existing,child);
    }else existing.replaceWith(child.cloneNode(true));
  });
  if (retainedCue) { for (const child of staticChildren().slice(fresh.length)) child.remove(); }
  else while (current.childNodes.length > fresh.length) current.lastChild.remove();
};
