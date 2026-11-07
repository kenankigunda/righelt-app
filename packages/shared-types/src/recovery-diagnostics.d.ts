export const RECOVERY_DIAGNOSTICS: Readonly<{
  schemaVersion: 1;
  path: string;
  maximumBytes: number;
  maximumEvents: number;
  maximumAgeMs: number;
  intakeWindowMs: number;
  intakePerWindow: number;
}>;
export const RECOVERY_DIAGNOSTIC_ENUMS: Readonly<Record<string, readonly string[]>>;
export const RECOVERY_DIAGNOSTIC_FLAGS: readonly string[];
export const RECOVERY_DIAGNOSTIC_COUNTERS: readonly string[];
export type RecoveryDiagnosticEvent = {
  eventId: string;
  type: string;
  at: number;
  commandId?: string;
  requestRelationship?: 'latest_observed' | 'failure' | 'unknown';
  [key: string]: string | number | boolean | undefined;
};
export function sanitizeRecoveryDiagnosticEvent(input: unknown): RecoveryDiagnosticEvent | null;
export function validateRecoveryDiagnosticEvent(input: unknown): input is RecoveryDiagnosticEvent;
export function validateRecoveryDiagnosticBatch(input: unknown): input is { schemaVersion: 1; events: RecoveryDiagnosticEvent[] };
