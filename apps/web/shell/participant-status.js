const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[character]));

export const renderConnectionStatusIcon = (status, label) =>
  `<span class="connection-status-icon is-${escape(status)}" role="img" aria-label="${escape(label)}" title="${escape(label)}"></span>`;
