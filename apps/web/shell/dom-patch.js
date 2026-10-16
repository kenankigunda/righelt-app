export const patchSectionContent = (current,next) => {
  // The preview controller owns these children and runtime attributes. Its
  // reconciliation step supplies updated data after the surrounding card patch.
  if(current.hasAttribute('data-mini-board-preview') && next.hasAttribute('data-mini-board-preview')) {
    current.setAttribute('data-preview-id', next.getAttribute('data-preview-id'));
    return;
  }
  const persistent = current.hasAttribute('data-persist') && next.hasAttribute('data-persist');
  if (persistent && (current.dataset.decisionId !== next.dataset.decisionId || current.dataset.version !== next.dataset.version)) { current.replaceWith(next.cloneNode(true)); return; }
  for(const attr of [...current.attributes])if(!(persistent && attr.name === 'open') && !next.hasAttribute(attr.name))current.removeAttribute(attr.name);
  for(const attr of next.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
  if (persistent && (current.tagName === 'TEXTAREA' || current.tagName === 'INPUT' || current.isContentEditable)) return;
  const old=[...current.childNodes],fresh=[...next.childNodes];
  fresh.forEach((child,index)=>{
    const key = child.nodeType === Node.ELEMENT_NODE ? child.getAttribute('data-key') : null;
    const existing = key ? old.find(node => node.nodeType === Node.ELEMENT_NODE && node.getAttribute('data-key') === key) : current.childNodes[index];
    if (existing && current.childNodes[index] !== existing) current.insertBefore(existing, current.childNodes[index] ?? null);
    if(!existing){current.insertBefore(child.cloneNode(true), current.childNodes[index] ?? null);return;}
    if(existing.nodeType===child.nodeType && existing.nodeName===child.nodeName){
      if(child.nodeType===Node.TEXT_NODE){if(existing.textContent!==child.textContent)existing.textContent=child.textContent;}
      else if(child instanceof Element)patchSectionContent(existing,child);
    }else existing.replaceWith(child.cloneNode(true));
  });
  while (current.childNodes.length > fresh.length) current.lastChild.remove();
};
