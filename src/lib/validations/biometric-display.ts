/**
 * What the attendance-reader screen needs in the browser. **No imports**:
 * `biometric.ts` beside it begins `import { z }`, and one import here would
 * make this file the thing it was split from (rule 15).
 */

/**
 * `staff.biometric_code`'s CHECK, character for character, so a code is
 * refused in the row before a round trip. The CHECK is the gate; this is the
 * courtesy, and `tests/hr/biometric.test.ts` fails when the two drift.
 */
export const BIOMETRIC_CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** The largest batch `biometric_ingest` accepts in one call. */
export const BIOMETRIC_BATCH_LIMIT = 500;

/** The example request shown beside a newly registered reader. */
export function exampleRequest(endpoint: string, deviceId: string, secret: string): string {
  return [
    `curl -X POST ${endpoint} \\`,
    `  -H "Authorization: Bearer ${secret}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"device_id":"${deviceId}","punches":[{"code":"17","at":"2026-09-23T09:02:11+05:30"}]}'`,
  ].join("\n");
}
