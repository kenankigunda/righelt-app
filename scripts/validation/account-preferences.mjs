import { STORAGE_GENERATION_HEADER } from '../../packages/shared-types/src/storage-policy.js';

// Raw fixture writes must use the same generation fence as application writes.
export const patchAccountPreferences = (page, preferences) => page.evaluate(async ({ generationHeader, preferences }) => {
  const sessionResponse = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!sessionResponse.ok) throw new Error(`Session read failed: ${sessionResponse.status}`);
  const current = await sessionResponse.json();
  const generation = sessionResponse.headers.get(generationHeader);
  const response = await fetch('/api/account', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Righelt-Auth': '1',
      'X-Righelt-Session': current.contextId,
      ...(generation ? { [generationHeader]: generation } : {}),
    },
    body: JSON.stringify({ preferences }),
  });
  return { status: response.status, body: await response.json() };
}, { generationHeader: STORAGE_GENERATION_HEADER, preferences });
