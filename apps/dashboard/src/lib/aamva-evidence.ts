/**
 * C59.4–C59.6, C66: what a `verification/aamva` answer records, shaped for its evidence: where
 * the values came from, the provider, the three results, and how the issuing jurisdiction's
 * record answered each field. Read from the verification answer alone (C53.7).
 *
 * A field's answer comes only from what the results say. AAMVA's DLDV answers per field
 * (`mismatched-fields`, `ignored-mismatches`); a failed identity that names no field differs
 * somewhere the answer does not say, so every field is "not recorded" then, never "no
 * difference". Without the identity result, the name check's `name-first-match` and
 * `name-last-match` and the number check's status stand in for their fields.
 */
import {
  AAMVA_VERIFICATION_ATTRIBUTES,
  type VerificationCheck,
  type VerificationResource,
} from '@openverify/contracts';
import {
  resultOf,
  sourceOf,
  textListOf,
  checkOutcomeOf,
  type CheckOutcome,
  type EvidenceSource,
} from './database-evidence';

export type AamvaVerification = Extract<VerificationResource, { type: 'verification/aamva' }>;

/** Where an AAMVA attempt's values came from (C52.8): the form, or the server's copy. */
export type AamvaSource = NonNullable<AamvaVerification['attributes']['source']>;

/**
 * How the issuer's record answered one field: no difference reported, a difference, a difference
 * the template ignores, no record at all, not compared (the jurisdiction does not take part, or a
 * value or the provider was missing), not recorded (the result does not say), or the field that
 * only picks the jurisdiction asked (`issuing-authority`).
 */
export type AamvaFieldAnswer =
  | 'no-difference'
  | 'differs'
  | 'ignored'
  | 'no-record'
  | 'not-compared'
  | 'not-recorded'
  | 'routing';

export interface AamvaFieldEvidence {
  readonly member: string;
  /** `null` before the checks ran. */
  readonly answer: AamvaFieldAnswer | null;
}

export interface AamvaEvidenceData {
  /** Whether any check has a result yet. */
  readonly ran: boolean;
  /** The verification was skipped (C50.7): it is never compared. */
  readonly skipped: boolean;
  /** The attribute `source`: `form`, `government_id`, or `null` before either. */
  readonly source: AamvaSource | null;
  readonly provider: EvidenceSource | null;
  readonly identity: CheckOutcome | null;
  readonly fields: readonly AamvaFieldEvidence[];
  /** `aamva_identity_comparison`'s `ignored-fields` threshold. */
  readonly ignoredFields: readonly string[];
  /** Its `on-jurisdiction-not-participating` threshold, or `null` when not recorded. */
  readonly onNonParticipation: string | null;
}

/** The AAMVA value attributes (C52.8), in contract order. */
export const AAMVA_VALUE_MEMBERS: readonly string[] = Object.freeze(
  Object.keys(AAMVA_VERIFICATION_ATTRIBUTES).filter((name) => name !== 'source'),
);

/** The value that only picks the jurisdiction DLDV asks: never compared. */
const ROUTING = 'issuing-authority';

/** The name check's metadata member for each name field (C59.5). */
const NAME_MATCHES: ReadonlyMap<string, string> = new Map([
  ['name-first', 'name-first-match'],
  ['name-last', 'name-last-match'],
]);

/** What a result without a per-field answer says of every field it covers. */
function outcomeAnswer(check: VerificationCheck): AamvaFieldAnswer {
  if (check.reasons.includes('record_not_found')) {
    return 'no-record';
  }
  return check.status === 'not_applicable' ? 'not-compared' : 'not-recorded';
}

/** The identity's answer for `member`. */
function identityAnswer(identity: VerificationCheck, member: string): AamvaFieldAnswer {
  if (identity.status !== 'passed' && identity.status !== 'failed') {
    return outcomeAnswer(identity);
  }
  if (identity.reasons.includes('record_not_found')) {
    return 'no-record';
  }
  const mismatched = textListOf(identity.metadata, 'mismatched-fields');
  if (textListOf(identity.metadata, 'ignored-mismatches').includes(member)) {
    return 'ignored';
  }
  if (mismatched.includes(member)) {
    return 'differs';
  }
  // A failure naming no field: the record differs where the answer does not say.
  return identity.status === 'failed' && mismatched.length === 0 ? 'not-recorded' : 'no-difference';
}

/** The name or number check's answer for `member`, when the identity did not run. */
function standInAnswer(
  member: string,
  name: VerificationCheck | undefined,
  number: VerificationCheck | undefined,
): AamvaFieldAnswer {
  const key = NAME_MATCHES.get(member);
  if (key !== undefined && name !== undefined) {
    const matched = name.metadata[key];
    return typeof matched === 'boolean'
      ? matched
        ? 'no-difference'
        : 'differs'
      : outcomeAnswer(name);
  }
  if (member === 'identification-number' && number !== undefined) {
    if (number.status === 'passed') {
      return 'no-difference';
    }
    return number.reasons.includes('identification_number_mismatch')
      ? 'differs'
      : outcomeAnswer(number);
  }
  return 'not-recorded';
}

/** An AAMVA verification's evidence. */
export function aamvaEvidenceOf(verification: AamvaVerification): AamvaEvidenceData {
  const { checks, status, source } = verification.attributes;
  const identity = resultOf(checks, 'aamva_identity_comparison');
  const name = resultOf(checks, 'aamva_name_comparison');
  const number = resultOf(checks, 'aamva_identification_number_comparison');
  const ran = checks.length > 0;
  const thresholds = identity?.provenance?.thresholds ?? {};
  const choice = thresholds['on-jurisdiction-not-participating'];
  return {
    ran,
    skipped: status === 'skipped',
    source: source ?? null,
    provider: sourceOf(checks),
    identity: checkOutcomeOf(identity),
    fields: AAMVA_VALUE_MEMBERS.map((member) => {
      let answer: AamvaFieldAnswer | null = null;
      if (member === ROUTING) {
        answer = 'routing';
      } else if (ran) {
        answer =
          identity === undefined
            ? standInAnswer(member, name, number)
            : identityAnswer(identity, member);
      }
      return { member, answer };
    }),
    ignoredFields: textListOf(thresholds, 'ignored-fields'),
    onNonParticipation: typeof choice === 'string' ? choice : null,
  };
}
