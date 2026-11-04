import assert from 'node:assert/strict';
import { RECOVERY_DIAGNOSTICS, validateRecoveryDiagnosticBatch } from '../../packages/shared-types/src/recovery-diagnostics.js';

// This is one log-only endpoint, not a general POST exemption. The body must
// satisfy the same strict contract as server ingestion, including its byte cap.
export function isLogOnlyDiagnosticWrite(write) {
  try {
    if (write?.method !== 'POST' || write.path !== RECOVERY_DIAGNOSTICS.path
      || write.contentType?.split(';')[0].trim().toLowerCase() !== 'application/json'
      || typeof write.rawBody !== 'string'
      || Buffer.byteLength(write.rawBody, 'utf8') > RECOVERY_DIAGNOSTICS.maximumBytes
      || !validateRecoveryDiagnosticBatch(write.body)) return false;
    const encoded = JSON.stringify(write.body);
    if (Buffer.byteLength(encoded, 'utf8') > RECOVERY_DIAGNOSTICS.maximumBytes) return false;
    const parsed = JSON.parse(write.rawBody);
    if (!validateRecoveryDiagnosticBatch(parsed)) return false;
    assert.deepEqual(parsed, write.body);
    return true;
  } catch { return false; }
}

export function assertOnlyDiagnosticWrites(writes) {
  for (const write of writes) assert.equal(isLogOnlyDiagnosticWrite(write), true,
    'read-only inspection permits only the exact schema-valid bounded recovery diagnostic POST');
}
