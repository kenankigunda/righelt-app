import { withCutoverPolicy } from "./account-cutover";
import { archiveRow } from "./storage-archive";
import type { LiveGameEnv } from "./shell-live-db";

/** Request-local reads only. The caller must apply policy guards before archive errors. */
export async function beginPersistencePreflight(env: LiveGameEnv, gameId: string) {
  const policy = withCutoverPolicy(env);
  // Capture synchronous failures too, and handle rejection even if policy denies
  // the request before the caller needs this independent archive result.
  const archive = Promise.resolve().then(() => archiveRow(env, gameId)).then(
    value => ({ status: "fulfilled", value } as const),
    reason => ({ status: "rejected", reason } as const),
  );
  return { env: await policy, archive };
}
