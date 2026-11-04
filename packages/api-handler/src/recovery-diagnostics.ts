import { RECOVERY_DIAGNOSTICS, validateRecoveryDiagnosticBatch, type RecoveryDiagnosticEvent } from '../../shared-types/src/recovery-diagnostics.js';
import { readSyncBody, SyncBodyError } from './sync-body';

type DiagnosticLog = {
  event: 'client_recovery_diagnostics';
  source: 'untrusted_client';
  schemaVersion: 1;
  receivedAt: number;
  events: RecoveryDiagnosticEvent[];
};
const json = (body: unknown, status: number, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

/** No DB, authentication, game-room or storage-generation dependencies. Reports
 * describe client claims and cannot acknowledge, authorize or mutate a game.
 * The fixed-window budget is per Worker isolate, not a distributed abuse cap.
 * Provider log access/retention remains under the existing observability policy. */
export function createRecoveryDiagnosticsHandler({
  now = Date.now,
  log = (record: DiagnosticLog) => console.info(JSON.stringify(record)),
}: { now?: () => number; log?: (record: DiagnosticLog) => void } = {}) {
  let windowStartedAt: number | null = null;
  let intakeCount = 0;
  return async (request: Request, { allowedOrigins = '' }: { allowedOrigins?: string } = {}): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== RECOVERY_DIAGNOSTICS.path) return null;
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    const origin = request.headers.get('Origin');
    // Local Pages forwards to a distinct loopback API port while retaining the
    // browser's Origin. Only explicit local configuration can bridge that hop;
    // deployed requests still require the request URL's exact origin.
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const configuredOrigin = loopback && allowedOrigins.split(',').map(value => value.trim()).some(value => {
      try { return Boolean(origin && value === origin && new URL(value).origin === value); }
      catch { return false; }
    });
    if ((!origin || origin !== url.origin && !configuredOrigin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ ok: false, error: 'invalid_origin' }, 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ ok: false, error: 'invalid_content_type' }, 415);
    const receivedAt = now();
    if (windowStartedAt === null || receivedAt - windowStartedAt >= RECOVERY_DIAGNOSTICS.intakeWindowMs) {
      windowStartedAt = receivedAt;
      intakeCount = 0;
    }
    if (++intakeCount > RECOVERY_DIAGNOSTICS.intakePerWindow) return json({ ok: false, error: 'diagnostics_rate_limited' }, 429, { 'Retry-After': String(Math.max(1, Math.ceil((windowStartedAt + RECOVERY_DIAGNOSTICS.intakeWindowMs - receivedAt) / 1000))) });
    let body: Record<string, unknown>;
    try { body = await readSyncBody(request, RECOVERY_DIAGNOSTICS.maximumBytes); }
    catch (error) {
      return json({ ok: false, error: error instanceof SyncBodyError ? error.message : 'invalid_diagnostics' }, error instanceof SyncBodyError ? error.status : 400);
    }
    if (!validateRecoveryDiagnosticBatch(body)) return json({ ok: false, error: 'invalid_diagnostics' }, 400);
    try {
      log({ event: 'client_recovery_diagnostics', source: 'untrusted_client', schemaVersion: 1, receivedAt, events: body.events });
    } catch { return json({ ok: false, error: 'diagnostics_unavailable' }, 503); }
    return json({ ok: true, accepted: body.events.length }, 202);
  };
}

export const handleRecoveryDiagnosticsRequest = createRecoveryDiagnosticsHandler();

/** Log route structure, never dynamic path segments such as invitation tokens.
 * Unknown paths are categorical too, since they can contain arbitrary secrets. */
export function diagnosticRoute(pathname: string): string {
  if (pathname === RECOVERY_DIAGNOSTICS.path) return RECOVERY_DIAGNOSTICS.path;
  if (pathname === '/api/health' || pathname === '/api/shell/bootstrap' || pathname === '/api/shell/games' || pathname === '/api/commands/validate') return pathname;
  if (/^\/api\/shell\/invites\/[^/]+$/.test(pathname)) return '/api/shell/invites/:token';
  const game = /^\/api\/shell\/games\/[^/]+(?:\/([^/]+))?$/.exec(pathname);
  if (game) {
    if (!game[1]) return '/api/shell/games/:gameId';
    const operations = ['apply', 'end-turn', 'reconcile', 'shared', 'position', 'join', 'computer-control', 'decision-history', 'decision-snapshot', 'decision-notes', 'decision-attempt', 'decision-attempts', 'approve', 'history', 'live', 'play-as-both', 'presence', 'legal', 'piece-moves', 'revert-request', 'revert-approve', 'revert-reject', 'revert-rescind', 'ws'];
    return operations.includes(game[1]) ? `/api/shell/games/:gameId/${game[1]}` : '/api/shell/games/:gameId/:unknown';
  }
  const auth = /^\/api\/(auth|account)(?:\/([^/]+))?$/.exec(pathname);
  if (auth) {
    const operations = ['register', 'login', 'logout', 'session', 'username', 'password', 'profile', 'recovery', 'recover', 'preferences', 'tutorial'];
    return auth[2] && operations.includes(auth[2]) ? `/api/${auth[1]}/${auth[2]}` : `/api/${auth[1]}/:unknown`;
  }
  return 'unknown';
}
