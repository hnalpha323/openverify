/**
 * Government ID NFC check config (C51.3, C62). Owned by the 5B `emrtd` agent once Workflow 5B
 * starts; amendments to these keys are recorded in the plan.
 */
import { z } from 'zod';
import {
  FACE_MATCH_DEFAULTS,
  defaultsTable,
  faceThresholdSchema,
  graceDaysSchema,
  provisionalDefault,
} from './basis.js';

/** Whether a missing current CRL leaves passive authentication undetermined (C62.3). */
export const REVOCATION_POLICIES = ['strict', 'best-effort'] as const;

/** What a selfie-bound sighting of the chip on another account answers (C62.6). */
export const SIGHTING_OUTCOMES = ['review', 'fail'] as const;

export const idNfcPassiveAuthenticationDetectionConfigSchema = z.strictObject({
  revocation: z.enum(REVOCATION_POLICIES).optional(),
  /** Accept SHA-1 data group hashes and signatures, with a flag. */
  'accept-sha1': z.boolean().optional(),
});

export const idNfcChipAuthenticationDetectionConfigSchema = z.strictObject({
  /** A chip whose signed SOD lists no DG15 goes to review instead of passing non-blocking. */
  'require-active-authentication': z.boolean().optional(),
});

export const idNfcRepeatDetectionConfigSchema = z.strictObject({
  'sighting-outcome': z.enum(SIGHTING_OUTCOMES).optional(),
});

export const idNfcSelfieComparisonConfigSchema = z.strictObject({
  threshold: faceThresholdSchema.optional(),
});

export const idNfcExpiredDetectionConfigSchema = z.strictObject({
  'grace-days': graceDaysSchema.optional(),
});

/** C51.3: the NFC check defaults. */
export const NFC_CHECK_CONFIG_DEFAULTS = defaultsTable({
  id_nfc_passive_authentication_detection: {
    revocation: provisionalDefault(
      'strict',
      'ICAO Doc 9303-12 App. D.1.2 and BSI TR-03135: a DSC is checked against a current CRL',
    ),
    'accept-sha1': provisionalDefault(
      true,
      'C51.3: 36 of 609 DE CSCAs are SHA-1 signed (the Phase 5 NFC spike); accepted with a flag',
    ),
  },
  id_nfc_chip_authentication_detection: {
    'require-active-authentication': provisionalDefault(
      false,
      'decision 33: the selfie and MRZ bindings already stop a different person, and many passports carry no AA key',
    ),
  },
  id_nfc_repeat_detection: {
    'sighting-outcome': provisionalDefault(
      'review',
      'decision 35: one person on two accounts is an operator policy; a sighting is review-level',
    ),
  },
  id_nfc_selfie_comparison: {
    threshold: provisionalDefault(
      FACE_MATCH_DEFAULTS.threshold,
      `FACE_MATCH_DEFAULTS (${FACE_MATCH_DEFAULTS.basis} by C49 on studio portrait pairs), not calibrated for chip portraits, so provisional here`,
    ),
  },
  id_nfc_expired_detection: {
    'grace-days': provisionalDefault(0, 'ours: as id_expired_detection (C29.5), no grace'),
  },
});
