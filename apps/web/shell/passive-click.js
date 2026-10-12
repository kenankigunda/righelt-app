const interactive = '.shell-header,.shell-flyout,#shell-board,dialog,button,a,input,select,textarea,label,[role="button"],[data-action],[tabindex],[contenteditable="true"]';
// A renderer may detach a clicked child before bubbling reaches the shell.
// The original dispatch path still identifies the interaction's owning surface.
export const isPassivePageClick = event => !event.composedPath().some(node =>
  typeof node?.matches === 'function' && node.matches(interactive));
