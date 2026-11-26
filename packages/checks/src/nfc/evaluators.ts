/** The evaluator of every government ID NFC check of PLAN §4.3 (C62), by id. */
import type { CheckResult } from '@openverify/core';
import type { NfcContext } from './context.js';
import { idNfcChipAuthenticationDetection } from './id-nfc-chip-authentication-detection.js';
import { idNfcMrzComparison } from './id-nfc-mrz-comparison.js';
import { idNfcPassiveAuthenticationDetection } from './id-nfc-passive-authentication-detection.js';
import { idNfcRepeatDetection } from './id-nfc-repeat-detection.js';
import { idNfcSelfieComparison } from './id-nfc-selfie-comparison.js';
import { nfcExpiredDetection } from './nfc-expired-detection.js';

export type NfcEvaluator = (context: NfcContext) => CheckResult;

export const NFC_EVALUATORS = Object.freeze({
  id_nfc_passive_authentication_detection: idNfcPassiveAuthenticationDetection,
  id_nfc_chip_authentication_detection: idNfcChipAuthenticationDetection,
  id_nfc_mrz_comparison: idNfcMrzComparison,
  id_nfc_selfie_comparison: idNfcSelfieComparison,
  id_nfc_repeat_detection: idNfcRepeatDetection,
  id_nfc_expired_detection: nfcExpiredDetection,
}) satisfies Readonly<Record<string, NfcEvaluator>>;
