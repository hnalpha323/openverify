/**
 * The chip trust store's vocabulary in words (C62.7, C62.10): what a sync attempt ended with and
 * why, how fresh a CRL is, the sources an operator may sync, the countries by name, and the
 * install settings the page cannot show yet.
 *
 * The test (`trust-store-words.test.ts`) reads the reason codes from the code that records them
 * (the sync, the trust-store repository, the master-list check) and the sources from
 * `trust-anchors/manifest.json`, so a code or source added there without words here fails it.
 * A code the console does not know yet is shown as itself.
 */
import type { TRUST_ANCHOR_SYNC_OUTCOMES, TRUST_CRL_FRESHNESS } from '@openverify/contracts';

export type TrustSyncOutcome = (typeof TRUST_ANCHOR_SYNC_OUTCOMES)[number];
export type TrustCrlFreshness = (typeof TRUST_CRL_FRESHNESS)[number];

export const SYNC_OUTCOME_LABELS: Readonly<Record<TrustSyncOutcome, string>> = Object.freeze({
  accepted: 'Accepted',
  refused: 'Refused',
  failed: 'Failed',
});

export const CRL_FRESHNESS_LABELS: Readonly<Record<TrustCrlFreshness, string>> = Object.freeze({
  current: 'Current',
  expired: 'Expired',
});

/** Why a sync was refused or failed (`trust_anchor_syncs.reason`). */
export const SYNC_REASON_WORDS: Readonly<Record<string, string>> = Object.freeze({
  // The source and its pinned root.
  source_unknown: 'The source is not in the manifest',
  source_disabled: 'The source is disabled',
  root_malformed: 'The root certificate could not be read',
  root_pin_mismatch: 'The root certificate does not match its pin',
  fetch_failed: 'The list or a CRL could not be fetched',
  self_test_failed: 'The platform self-test failed',
  // The master list.
  list_malformed: 'The master list could not be read',
  signing_time_missing: 'The master list has no signing time',
  list_signing_time_rollback: 'Older than the list already held (rollback)',
  signer_revoked: 'A current CRL revokes the list’s signer',
  content_type_invalid: 'The list’s content type is not a master list',
  signer_missing: 'The list has no signer certificate',
  signer_profile_invalid: 'The list signer’s profile is invalid',
  signer_not_issued_by_root: 'The list signer is not issued by the pinned root',
  message_digest_mismatch: 'The list’s digest does not match its content',
  signature_invalid: 'The list’s signature does not verify',
  signer_expired: 'The list signer has expired',
  // A CRL.
  crl_number_rollback: 'A CRL number went backwards',
  crl_not_current: 'A CRL is not current',
  unknown: 'Not recorded',
});

/** The sources an operator may sync (`trust-anchors/manifest.json`), the seed's and imports. */
export const TRUST_SOURCE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'bsi-de': 'Germany’s master list (BSI)',
  'npkd-nl': 'The Netherlands’ master list',
  ita: 'Italy’s master list',
  che: 'Switzerland’s master list',
  'openverify-sandbox': 'The sandbox anchor seed:dev inserts',
  'operator-import': 'Lists the operator imported',
});

/**
 * The two install settings of the store, as the API reports them (C62.7, C66; Workflow 5C
 * review K13): the words of each value, then what it means, naming its variable.
 */
export const TRUST_STORE_SETTING_WORDS = Object.freeze({
  refresh: Object.freeze({
    on: 'On',
    off: 'Off',
    explanation: {
      on: 'The worker syncs every enabled source every six hours (OPENVERIFY_TRUST_ANCHOR_REFRESH=true).',
      off: 'The store changes only when an operator runs trust-anchors:sync (OPENVERIFY_TRUST_ANCHOR_REFRESH is false).',
    },
  }),
  icaoCrls: Object.freeze({
    on: 'Fetched',
    off: 'Not fetched',
    explanation: {
      on: 'The sync also reads CRLs from ICAO PKD hosts (OPENVERIFY_NFC_ALLOW_ICAO_CRLS=true).',
      off: 'Only national CRLs are read; a chip whose CSCA publishes none goes to review under strict revocation (OPENVERIFY_NFC_ALLOW_ICAO_CRLS is false).',
    },
  }),
});

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' });

/** A country's name in English from its ISO 3166 alpha-2 code; Utopia is the test issuer. */
export function countryName(code: string): string {
  if (code === 'UT') {
    return 'Utopia (test issuer)';
  }
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}
