// Session-only reading position. Draft values remain in their owning stores.
export function createUtilityMemory({ root, getScope }) {
  const saved = new Map();
  let mounted = new WeakMap();
  const pathTo = (node, pane) => {
    const parts = [];
    for (let item = node; item && item !== pane; item = item.parentElement) {
      const key = item.getAttribute('data-key');
      const identity = item.getAttribute('data-decision-id');
      const decision = identity !== null ? `[data-decision-id="${CSS.escape(identity)}"]` : '';
      parts.unshift((item.id ? `#${CSS.escape(item.id)}` : key !== null
        ? `[data-key="${CSS.escape(key)}"]`
        : `${item.localName}:nth-child(${[...item.parentElement.children].indexOf(item) + 1})`) + decision);
    }
    return parts.join(' > ');
  };
  const rememberFocus = target => {
    const pane = target?.closest?.('[data-flyout]');
    const record = pane && saved.get(pane.dataset.flyout);
    if (!record || mounted.get(pane) !== record.scope) return;
    record.focus = { selector: pathTo(target, pane), selection: typeof target.selectionStart === 'number'
      ? [target.selectionStart, target.selectionEnd, target.selectionDirection] : null };
  };
  root.addEventListener('focusout', event => rememberFocus(event.target));
  return {
    capture() {
      for (const pane of root.querySelectorAll('[data-flyout]')) {
        const scope = mounted.get(pane);
        if (scope === undefined) continue;
        const previous = saved.get(pane.dataset.flyout);
        saved.set(pane.dataset.flyout, { scope, focus: previous?.scope === scope ? previous.focus : null,
          top: pane.querySelector('.shell-flyout-scroll')?.scrollTop ?? 0,
          details: [...pane.querySelectorAll('details')].map(el => [pathTo(el, pane), el.open]),
        });
        if (pane.contains(root.ownerDocument.activeElement)) rememberFocus(root.ownerDocument.activeElement);
      }
    },
    restore() {
      for (const pane of root.querySelectorAll('[data-flyout]')) {
        const scope = getScope(pane.dataset.flyout), reopened = mounted.get(pane) !== scope;
        mounted.set(pane, scope);
        const record = saved.get(pane.dataset.flyout);
        if (record?.scope !== scope) { saved.set(pane.dataset.flyout, { scope }); continue; }
        for (const [selector, open] of record.details ?? []) {
          const detail = pane.querySelector(selector); if (detail?.localName === 'details') detail.open = open;
        }
        if (reopened && record.focus) {
          const target = pane.querySelector(record.focus.selector);
          if (target && !target.disabled && target.getClientRects().length) {
            target.focus({ preventScroll: true });
            if (record.focus.selection) target.setSelectionRange?.(...record.focus.selection);
          }
        }
        const scroll = pane.querySelector('.shell-flyout-scroll');
        if (scroll && record.top !== undefined) scroll.scrollTop = record.top;
      }
    },
    clear() { saved.clear(); mounted = new WeakMap(); },
  };
}
