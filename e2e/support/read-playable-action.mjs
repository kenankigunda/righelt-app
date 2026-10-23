// Self-contained for page.evaluate; diagnostic messages exclude identities and raw bodies.
export async function readPlayableAction() {
  const identityId = window.localStorage.getItem('righelt.identity.id.v1');
  const match = new URL(window.location.href).hash.match(/^#\/game\/([^?]+)/);
  if (!identityId || !match) return null;
  let response;
  try {
    response = await fetch(`/api/shell/games/${encodeURIComponent(decodeURIComponent(match[1]))}?identityId=${encodeURIComponent(identityId)}`);
  } catch { throw new Error('Game-state read failed: transport'); }
  const id = response.headers.get('x-request-id');
  const correlation = /^[a-f0-9-]{36}$/i.test(id ?? '') ? ` requestId=${id}` : '';
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`Game-state read failed: HTTP ${response.status}, invalid JSON${correlation}`); }
  if (!response.ok) {
    const code = ['local_api_unavailable','internal_error','storage_reset'].includes(body?.error) ? ` ${body.error}` : '';
    throw new Error(`Game-state read failed: HTTP ${response.status}${code}${correlation}`);
  }
  if (!Array.isArray(body?.game?.legalActions)) throw new Error(`Game-state read failed: invalid game payload${correlation}`);
  return body.game.legalActions.find(action => action?.from && action?.to) ?? null;
}
