// Display only. Preserve the transport's full viewer records for expansion.
const nameOf = viewer => viewer?.profile?.displayName?.trim() || viewer?.profile?.username?.trim() || null;

export function viewerSummary(viewers = [], {identityId} = {}) {
  // Presence updates may briefly repeat an identity. It is still one viewer.
  const seen = new Set();
  const entries = viewers.filter(viewer => {
    const key = viewer?.identityId;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);return true;
  });
  if (!entries.length) return {text:'None',entries:[],count:0};
  const own = identityId ? entries.find(viewer => viewer?.identityId === identityId) : null;
  const named = entries.filter(viewer => viewer !== own && nameOf(viewer));
  const ordered = [...(own ? [own] : []),...named,...entries.filter(viewer => viewer !== own && !nameOf(viewer))];
  const names=ordered.map(viewer=>viewer===own?'You':nameOf(viewer)||'Guest');
  const text=names.length<3?names.join(' and '):`${names[0]}, ${names[1]} and ${names.length-2} ${names.length===3?'other':'others'}`;
  return {text,entries:ordered,count:entries.length};
}
