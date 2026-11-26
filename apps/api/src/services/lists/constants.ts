/**
 * C99.1 (H15): the provisional confidences of the H-tier list evidence that no other constant
 * answers. A match on these is an advisory record, never a decision: nothing reads the value but a
 * person. Each is unmeasured, and no threshold was tuned on test data (ADR 0002 §3f).
 */
import type { ConfigDefault } from '@openverify/core';

const provisional = (value: number, source: string): ConfigDefault =>
  Object.freeze({ value, basis: 'provisional', source });

const NO_CALIBRATION = 'no calibration report exists (ADR 0002 §3f); not tuned on any test data';

export const LIST_EVIDENCE_CONSTANTS: Readonly<Record<string, ConfigDefault>> = Object.freeze({
  'ip-point-confidence': provisional(
    0.5,
    `C99.1 (H15): the confidence of a match on a session's IP city point; DB-IP publishes no accuracy for its Lite city edition, and a point is wrong for VPNs, roaming and corporate egress; ${NO_CALIBRATION}`,
  ),
  'same-device-confidence': provisional(
    0.7,
    `C99.1 (H15), C94.4: the confidence that an equal fingerprint is the same device; a strict browser hash is shared by identical configurations, and an ANDROID_ID resets with a factory reset; ${NO_CALIBRATION}`,
  ),
});
