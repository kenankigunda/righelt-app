// Display only. Preserve the transport's full viewer records for expansion.
const nameOf = viewer => viewer?.profile?.displayName?.trim() || viewer?.profile?.username?.trim() || null;
const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;
const join = parts => parts.length < 3 ? parts.join(' and ') : `${parts.slice(0,-1).join(', ')}, and ${parts.at(-1)}`;

export function viewerSummary(viewers = [], {identityId} = {}) {
  // Presence updates may briefly repeat an identity. It is still one viewer.
  const seen = new Set();
  const entries = viewers.filter(viewer => {
    const key = viewer?.identityId;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);return true;
  });
  if (!entries.length) return {text:'No viewers',entries:[],count:0};
  const own = identityId ? entries.find(viewer => viewer?.identityId === identityId) : null;
  const named = entries.filter(viewer => viewer !== own && nameOf(viewer));
  const guests = entries.filter(viewer => viewer !== own && !nameOf(viewer)).length;
  const names = [...(own ? ['You'] : []),...named.map(nameOf)];
  const parts = names.slice(0,2);
  if (names.length > 2) parts.push(plural(names.length-2,'other'));
  if (guests) parts.push(plural(guests,'guest'));
  const ordered = [...(own ? [own] : []),...named,...entries.filter(viewer => viewer !== own && !nameOf(viewer))];
  return {text:join(parts),entries:ordered,count:entries.length};
}
