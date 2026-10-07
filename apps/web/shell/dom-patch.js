export const patchSectionContent = (current,next) => {
  // The preview controller owns these children and runtime attributes. Its
  // reconciliation step supplies updated data after the surrounding card patch.
  if(current.hasAttribute('data-mini-board-preview') && next.hasAttribute('data-mini-board-preview')) {
    current.setAttribute('data-preview-id', next.getAttribute('data-preview-id'));
    return;
  }
  for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
  for(const attr of next.attributes)if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
  const old=[...current.childNodes],fresh=[...next.childNodes];
  fresh.forEach((child,index)=>{
    const existing=old[index];
    if(!existing){current.append(child.cloneNode(true));return;}
    if(existing.nodeType===child.nodeType && existing.nodeName===child.nodeName){
      if(child.nodeType===Node.TEXT_NODE){if(existing.textContent!==child.textContent)existing.textContent=child.textContent;}
      else if(child instanceof Element)patchSectionContent(existing,child);
    }else existing.replaceWith(child.cloneNode(true));
  });
  old.slice(fresh.length).forEach(child=>child.remove());
};
