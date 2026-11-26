/**
 * `id_nfc_expired_detection` (R, fraud): the expiration date read from the chip's data group DG1
 * has passed (plus `grace-days`). Logic only: the NFC verification that reads DG1 arrives in
 * Phase 5, and the worker wires this check then. Without a chip expiry, `input_missing`.
 */
import type { CheckResult } from '@openverify/core';
import { judgeExpiry } from './id-expired-detection.js';

export interface IdNfcExpiredInput {
  /** `YYYY-MM-DD`, from DG1. */
  expirationDate?: string | null | undefined;
}

export interface IdNfcExpiredOptions {
  graceDays?: number | undefined;
  now?: Date | undefined;
}

export function idNfcExpiredDetection(
  input: IdNfcExpiredInput,
  options: IdNfcExpiredOptions = {},
): CheckResult {
  return judgeExpiry({
    checkId: 'id_nfc_expired_detection',
    expirationDate: input.expirationDate,
    graceDays: options.graceDays ?? 0,
    now: options.now ?? new Date(),
    missing: 'input_missing',
    metadata: (daysPast) => ({ 'days-past-expiration': daysPast }),
  });
}
