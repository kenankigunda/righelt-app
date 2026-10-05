import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Read-only: never changes a subscription or prints credential values.
export function classifyWorkersPlan(subscriptions) {
  if (!Array.isArray(subscriptions)) return 'unknown';
  if (subscriptions.some(s => typeof s?.rate_plan?.id !== 'string' || !s.rate_plan.id)) return 'unknown';
  const workers = subscriptions.filter((s) => /workers/i.test(`${s?.rate_plan?.id ?? ''} ${s?.rate_plan?.public_name ?? ''}`));
  if (workers.length === 0) return 'free'; // Workers Free is the default without a Workers subscription.
  return workers.every((s) => /^workers[_ -]free$/i.test(s.rate_plan.id)) ? 'free' : 'not_verified_free';
}

export async function preflight({ token, accountId, fetchImpl = fetch }) {
  if (!token || !/^[a-f0-9]{32}$/i.test(accountId ?? '')) {
    return { passed: false, reason: 'missing_cloudflare_configuration' };
  }
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const subscriptions = [];
  for (let page = 1; page <= 100; page++) {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/subscriptions?page=${page}&per_page=50`, { headers });
    const body = await response.json();
    if (!response.ok || body.success !== true || !Array.isArray(body.result)) {
      return { passed: false, reason: 'subscriptions_read_unavailable', httpStatus: response.status, errorCodes: body.errors?.map((e) => e.code) ?? [] };
    }
    subscriptions.push(...body.result);
    const totalPages = body.result_info?.total_pages;
    if ((Number.isInteger(totalPages) && page >= totalPages) || (!totalPages && body.result.length < 50)) break;
    if (page === 100) return { passed: false, reason: 'subscriptions_pagination_incomplete' };
  }
  const plan = classifyWorkersPlan(subscriptions);
  if (plan !== 'free') return { passed: false, reason: 'workers_free_plan_not_verified', plan };
  const response = await fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers,
    body: JSON.stringify({ query: 'query { __schema { types { name } } }' }),
  });
  const body = await response.json();
  const types = body.data?.__schema?.types;
  if (!response.ok || body.errors?.length || !Array.isArray(types)) {
    return { passed: false, reason: 'analytics_schema_unavailable', plan, httpStatus: response.status };
  }
  return { passed: true, plan, planSource: 'account_subscriptions_api', analyticsTypes: types.map((t) => t.name).filter((name) => /DurableObjects|WorkersInvocations/i.test(name)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    result = await preflight({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID });
  } catch {
    result = { passed: false, reason: 'cloudflare_preflight_unavailable' };
  }
  await mkdir('artifacts/t108-feasibility', { recursive: true });
  await writeFile('artifacts/t108-feasibility/preflight.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
