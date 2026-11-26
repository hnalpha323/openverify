/**
 * C52.8, C54.1: the `government-id-nfc` verification's attributes:
 *
 * - DG1's fields (`name-first`, `name-last`, `birthdate`, `sex`, `expiration-date`,
 *   `identification-number`, `nationality`: PII), the class (`id-class`) and the issuing country
 *   (ISO alpha-2, `UT` for Utopia), from the sealed chip read the job writes once the chip's
 *   integrity was established; `null` before, without integrity, and once redacted (C53.6);
 * - `passive-authentication` (`outcome`, `integrity`, `anchor-source`, `hash-algorithm`,
 *   `revocation`) and `active-authentication` (`outcome`), from the checks the job wrote and the
 *   read's non-PII summary; `null` before the job judged the verification;
 * - `sandbox-chip` (Phase 10 C208.4): the scenario of the sandbox test chip the verification was
 *   read from, left out for every other chip.
 *
 * The PII members are masked for a principal without `pii:view` (C53.7).
 */
import { nfcIssuerCountry } from '@openverify/checks';
import {
  CHIP_INTEGRITY_OUTCOMES,
  CHIP_REVOCATION_OUTCOMES,
  SANDBOX_CHIP_LABEL_MEMBER,
} from '@openverify/contracts';
import { getChipRead, openChipReadEvidence, type VerificationWithChecks } from '@openverify/db';
import { sandboxChipLabelOf } from '../sandbox-chip.js';
import type { VerificationAttributeHook } from './index.js';

/** DG1's members the attributes serve, by name (C52.8). */
const DG1_ATTRIBUTES = [
  'name-first',
  'name-last',
  'birthdate',
  'sex',
  'expiration-date',
  'identification-number',
  'nationality',
  'id-class',
] as const;

const PASSIVE = 'id_nfc_passive_authentication_detection';
const ACTIVE = 'id_nfc_chip_authentication_detection';

const oneOf = <Value extends string>(
  values: readonly Value[],
  value: unknown,
  fallback: Value,
): Value => (values.includes(value as Value) ? (value as Value) : fallback);

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

function checkOf(verification: VerificationWithChecks, name: string) {
  return verification.checks.find((check) => check.name === name);
}

export const governmentIdNfcAttributes: VerificationAttributeHook = {
  async load(db, verification) {
    const { environmentId } = verification;
    const read = await getChipRead(db, environmentId, verification.id);
    const evidence =
      read === null ? null : await openChipReadEvidence(db, environmentId, verification.id);
    const fields = evidence?.fields ?? {};
    const passive = checkOf(verification, PASSIVE);
    const active = checkOf(verification, ACTIVE);
    // A redaction clears check metadata; the read's non-PII summary keeps the PA states.
    const summary = read?.paSummary ?? {};
    const metadata = passive?.metadata ?? {};
    const stated = (key: string, summaryKey: string): unknown =>
      metadata[key] ?? summary[summaryKey];
    // C208.1, C208.4 (Workflow 10C, contracts-10c's hook): the sandbox test chip's scenario, from
    // api-nfc's `sandboxChipLabelOf`; left out for a verification read from any other chip.
    const sandboxChip = await sandboxChipLabelOf(db, verification);
    return {
      ...(sandboxChip === null ? {} : { [SANDBOX_CHIP_LABEL_MEMBER]: sandboxChip }),
      ...Object.fromEntries(DG1_ATTRIBUTES.map((name) => [name, fields[name] ?? null])),
      'issuing-country':
        evidence === null || read?.issuingCountry == null
          ? null
          : nfcIssuerCountry(read.issuingCountry),
      'passive-authentication':
        passive === undefined
          ? null
          : {
              outcome: passive.status,
              integrity: oneOf(
                CHIP_INTEGRITY_OUTCOMES,
                stated('integrity', 'integrity'),
                'not_established',
              ),
              'anchor-source': textOrNull(summary.anchorSource),
              'hash-algorithm': textOrNull(stated('hash-algorithm', 'hashAlgorithm')),
              revocation: oneOf(
                CHIP_REVOCATION_OUTCOMES,
                stated('revocation', 'revocation'),
                'undetermined',
              ),
            },
      'active-authentication': active === undefined ? null : { outcome: active.status },
    };
  },
  mask: (attributes, mask) => mask.attributes(attributes),
};
