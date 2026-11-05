import {icon} from '../icons.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

/** Shared icon-only dismissal. The existing owner keeps activation and focus. */
export function renderDismissButton({label, className = '', attributes = {}, disabled = false} = {}) {
  if (typeof label !== 'string' || !label.trim()) throw new Error('Dismiss button requires an accessible label');
  const extra = Object.entries(attributes).map(([name, value]) => {
    if (!/^(?:data|aria)-[a-z][a-z0-9-]*$/.test(name) || ['aria-label','aria-labelledby'].includes(name)) {
      throw new Error(`Unsupported dismiss attribute: ${name}`);
    }
    if (value === undefined || value === null || value === false && name.startsWith('data-')) return '';
    if (value === true && name.startsWith('data-')) return ` ${name}`;
    return ` ${name}="${escape(value)}"`;
  }).join('');
  return `<button type="button" class="ui-icon-button ui-dismiss-button${className ? ` ${escape(className)}` : ''}" aria-label="${escape(label)}"${disabled ? ' disabled' : ''}${extra}>${icon('close')}</button>`;
}
