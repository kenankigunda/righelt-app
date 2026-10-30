const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Runtime prompts and invisible sizing replicas use identical chip metrics.
export const renderCoordinateChip=(coordinate,className='board-preview-coordinate-chip-neutral')=>coordinate
 ? `<span class="board-preview-coordinate-chip ${escape(className)}">${escape(`${coordinate.row}, ${coordinate.col}`)}</span>` : '';
