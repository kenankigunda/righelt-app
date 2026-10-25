const identity = node => node.nodeType === 1
  ? node.getAttribute('data-key') || node.id || (node.hasAttribute('data-action')
    ? `action:${node.getAttribute('data-action')}:${node.getAttribute('data-incident-id') ?? ''}` : null)
  : null;
const compatible = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

// Keep notification surfaces and focused controls mounted. Patching attributes
// only when changed also preserves CSS animation timelines across heartbeat ticks.
export const patchNotificationTree = (current, next) => {
  for (const attr of [...current.attributes]) if (!(current.tagName === "DETAILS" && attr.name === "open") && !next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  for (const attr of next.attributes) if (!(current.tagName === "DETAILS" && attr.name === "open") && current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  const old = [...current.childNodes];
  const used = new Set();
  for (const [index, child] of [...next.childNodes].entries()) {
    const key = identity(child);
    let existing = key ? old.find(node => !used.has(node) && identity(node) === key && compatible(node, child)) : null;
    if (!key) {
      const atIndex = current.childNodes[index];
      existing = atIndex && !used.has(atIndex) && !identity(atIndex) && compatible(atIndex, child) ? atIndex
        : old.find(node => !used.has(node) && !identity(node) && compatible(node, child));
    }
    if (!existing) existing = child.cloneNode(true);
    used.add(existing);
    if (current.id === "shell-game-alerts") {
      // Stack depth is expressed through data-stack-index, not DOM order.
      // Keeping existing cards in place preserves focus and CSS animations.
      if (existing.parentNode !== current) current.append(existing);
    } else if (current.childNodes[index] !== existing) {
      // Moving an existing DOM subtree via insertBefore cancels its animations
      // in some engines. Preserve their timelines when stack ordering changes.
      const animations = existing.getAnimations?.({ subtree: true }).map(animation => [animation, animation.currentTime, animation.playState]) ?? [];
      current.insertBefore(existing, current.childNodes[index] ?? null);
      for (const [animation, time, state] of animations) if (time !== null && state !== 'finished') {
        animation.currentTime = time;
        if (state === 'running') animation.play();
      }
    }
    if (child.nodeType === 3) {
      if (existing.textContent !== child.textContent) existing.textContent = child.textContent;
    } else if (child.nodeType === 1) patchNotificationTree(existing, child);
  }
  for (const child of [...current.childNodes]) if (!used.has(child)) child.remove();
};

export const patchNotificationHtml = (current, html) => {
  const next = current.cloneNode(false);
  next.innerHTML = html;
  patchNotificationTree(current, next);
};

// Keep the header AND its parent mounted when gates/results replace game content.
export const replaceMainPreservingHeader = (current, next) => {
  const header = current.querySelector(':scope > .shell-header');
  const nextHeader = next.querySelector(':scope > .shell-header');
  if (!header || !nextHeader) return false;
  patchNotificationTree(header, nextHeader);
  for (const child of [...current.childNodes]) if (child !== header) child.remove();
  for (const child of [...next.childNodes]) if (child !== nextHeader) current.append(child.cloneNode(true));
  return true;
};
