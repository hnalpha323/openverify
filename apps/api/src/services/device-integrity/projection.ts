/**
 * C211.4 (Workflow 10B, `api-integrity`): the fixed projection of a Play Integrity verdict, the only
 * thing stored of it (sealed for the inquiry's row): the device recognition labels, the app
 * recognition, the boolean of each server check, and when it was decoded. Every other member of
 * Google's answer (`accountDetails`, `recentDeviceActivity`, `deviceRecall`, `environmentDetails`,
 * `playProtectVerdict`, `deviceAttributes`, the version code, the certificate digests themselves) is
 * dropped after the checks and never stored or logged (review P12).
 *
 * The schema is strict, so a projection that carried any other member is refused before it is
 * stored, and the stored one is parsed again when it is read.
 */
import {
  INTEGRITY_APP_RECOGNITIONS,
  INTEGRITY_DEVICE_LABELS,
  type IntegrityVerdictProjection,
} from '@openverify/checks';
import { z } from 'zod';

const checksSchema = z.strictObject({
  'package-name': z.boolean(),
  'request-hash': z.boolean(),
  timestamp: z.boolean(),
  'app-recognized': z.boolean(),
  'certificate-digest': z.boolean(),
});

export const integrityVerdictProjectionSchema = z.strictObject({
  outcome: z.enum(['decoded', 'failed']),
  'device-recognition': z.array(z.enum(INTEGRITY_DEVICE_LABELS)).max(4),
  'app-recognition': z.enum(INTEGRITY_APP_RECOGNITIONS).nullable(),
  checks: checksSchema,
  'decoded-at': z.iso.datetime(),
}) satisfies z.ZodType<IntegrityVerdictProjection>;

export type { IntegrityVerdictProjection };

/** The projection of a decode that gave no verdict: every check false, nothing recognised. */
export function failedProjection(decodedAt: Date): IntegrityVerdictProjection {
  return {
    outcome: 'failed',
    'device-recognition': [],
    'app-recognition': null,
    checks: {
      'package-name': false,
      'request-hash': false,
      timestamp: false,
      'app-recognized': false,
      'certificate-digest': false,
    },
    'decoded-at': decodedAt.toISOString(),
  };
}

/** The labels a projection keeps, each once, in Play Integrity's order of strength. */
export function knownDeviceLabels(
  labels: unknown,
): IntegrityVerdictProjection['device-recognition'] {
  const given = new Set(Array.isArray(labels) ? labels : []);
  return INTEGRITY_DEVICE_LABELS.filter((label) => given.has(label));
}

/** An app recognition verdict the projection keeps, or `null` for anything else. */
export function knownAppRecognition(
  verdict: unknown,
): IntegrityVerdictProjection['app-recognition'] {
  return INTEGRITY_APP_RECOGNITIONS.find((known) => known === verdict) ?? null;
}
