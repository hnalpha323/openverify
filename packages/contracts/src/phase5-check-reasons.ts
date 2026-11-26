/**
 * Every Phase 5 check's reason codes (C51.2), merged from the per-area files, and the frozen
 * user-behaviour failure reasons a retry hint can carry (in
 * `contracts/fixtures/flow/retry-hint-reasons.json`, with English and Spanish texts in both
 * clients).
 */
import { BUSINESS_CHECK_OUTCOMES, BUSINESS_CHECK_REASONS } from './business-check-reasons.js';
import { retryHintReasonsOf } from './check-outcome-reasons.js';
import { CONTACT_CHECK_OUTCOMES, CONTACT_CHECK_REASONS } from './contact-check-reasons.js';
import {
  CRYPTO_WALLET_CHECK_OUTCOMES,
  CRYPTO_WALLET_CHECK_REASONS,
} from './crypto-wallet-check-reasons.js';
import { DATABASE_CHECK_OUTCOMES, DATABASE_CHECK_REASONS } from './database-check-reasons.js';
import { DOCUMENT_CHECK_OUTCOMES, DOCUMENT_CHECK_REASONS } from './document-check-reasons.js';
import { NFC_CHECK_OUTCOMES, NFC_CHECK_REASONS } from './nfc-check-reasons.js';

export const PHASE5_CHECK_REASONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ...DOCUMENT_CHECK_REASONS,
  ...DATABASE_CHECK_REASONS,
  ...CONTACT_CHECK_REASONS,
  ...CRYPTO_WALLET_CHECK_REASONS,
  ...BUSINESS_CHECK_REASONS,
  ...NFC_CHECK_REASONS,
});

/** C51.2, frozen in Stage 1a: the failure reasons of the Phase 5 user-behaviour checks, sorted. */
export const PHASE5_RETRY_HINT_REASONS: readonly string[] = Object.freeze(
  [
    ...new Set(
      [
        DOCUMENT_CHECK_OUTCOMES,
        DATABASE_CHECK_OUTCOMES,
        CONTACT_CHECK_OUTCOMES,
        CRYPTO_WALLET_CHECK_OUTCOMES,
        BUSINESS_CHECK_OUTCOMES,
        NFC_CHECK_OUTCOMES,
      ].flatMap((table) => retryHintReasonsOf(table)),
    ),
  ].sort(),
);
