/**
 * C61, C66: what a `verification/database-business` answer records, shaped for its evidence: the
 * register and its authority, how the status was read and its flags, the entered business beside
 * each match field's level, the match groups, the associated persons' results, and the country and
 * service checks. Read from the verification answer alone (C53.7); the register's own record id,
 * legal name and status are the verification's attributes (C52.8), shown by the component.
 *
 * How the status was read comes from `database_business_active_business_detection`'s answer: a
 * pass is active, `business_inactive` inactive, `status_not_available` not available and
 * `no_registry_record` no usable record (C61.2). Anything else (an execution error, no register)
 * says nothing of the status, so it is `null`.
 */
import type { VerificationCheck, VerificationResource } from '@openverify/contracts';
import { BUSINESS_MATCH_FIELDS } from '@openverify/core';
import {
  checkOutcomeOf,
  recordedGroupsOf,
  recordedMatchOf,
  resultOf,
  sourceOf,
  textListOf,
  type CheckOutcome,
  type EvidenceSource,
  type FieldEvidence,
  type RecordedGroup,
} from './database-evidence';

export type DatabaseBusinessVerification = Extract<
  VerificationResource,
  { type: 'verification/database-business' }
>;

/** A field a business match group names (C51.3). */
export type BusinessMatchField = (typeof BUSINESS_MATCH_FIELDS)[number];

/** How the active check read the register's status (C61.2). */
export type StatusReading = 'active' | 'inactive' | 'not-available' | 'no-record';

/** `database_business_associated_persons_comparison`'s counts, when it compared persons. */
export interface PersonsEvidence {
  readonly outcome: CheckOutcome | null;
  readonly persons: number | null;
  readonly matched: number | null;
  readonly unmatched: number | null;
  readonly undecided: number | null;
}

export interface DatabaseBusinessEvidenceData {
  /** Whether any check has a result yet. */
  readonly ran: boolean;
  readonly provider: EvidenceSource | null;
  /** The identity's `authoritative`, or `null` when it records none. */
  readonly authoritative: boolean | null;
  readonly identity: CheckOutcome | null;
  readonly active: CheckOutcome | null;
  readonly reading: StatusReading | null;
  /** The active and service checks' flags (`lei-lapsed`, `country-not-covered`, …). */
  readonly flags: readonly string[];
  readonly fields: readonly FieldEvidence<BusinessMatchField>[];
  readonly groups: readonly RecordedGroup[];
  readonly persons: PersonsEvidence;
  readonly country: CheckOutcome | null;
  readonly service: CheckOutcome | null;
}

/** The attributes holding each business match field's entered values (C52.3, C52.8). */
export const BUSINESS_VALUE_MEMBERS: Readonly<Record<BusinessMatchField, readonly string[]>> =
  Object.freeze({
    name: ['business-name'],
    'registration-number': ['registration-number'],
    address: [
      'address-street-1',
      'address-street-2',
      'address-city',
      'address-subdivision',
      'address-postal-code',
      'address-country-code',
    ],
  });

/** The active check's answer as a status reading, or `null` when it says nothing of one. */
function readingOf(active: VerificationCheck | undefined): StatusReading | null {
  if (active === undefined) {
    return null;
  }
  if (active.status === 'passed') {
    return 'active';
  }
  if (active.reasons.includes('business_inactive')) {
    return 'inactive';
  }
  if (active.reasons.includes('status_not_available')) {
    return 'not-available';
  }
  return active.reasons.includes('no_registry_record') ? 'no-record' : null;
}

const countOf = (metadata: Readonly<Record<string, unknown>>, key: string): number | null => {
  const value = metadata[key];
  return typeof value === 'number' ? value : null;
};

/** A business registry verification's evidence. */
export function databaseBusinessEvidenceOf(
  verification: DatabaseBusinessVerification,
): DatabaseBusinessEvidenceData {
  const { checks } = verification.attributes;
  const identity = resultOf(checks, 'database_business_identity_comparison');
  const active = resultOf(checks, 'database_business_active_business_detection');
  const persons = resultOf(checks, 'database_business_associated_persons_comparison');
  const service = resultOf(checks, 'database_business_service_available_detection');
  const metadata = identity?.metadata ?? {};
  const fields = metadata.fields;
  const recorded: Readonly<Record<string, unknown>> =
    typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>) : {};
  const counted = persons?.metadata ?? {};
  return {
    ran: checks.length > 0,
    provider: sourceOf(checks),
    authoritative: typeof metadata.authoritative === 'boolean' ? metadata.authoritative : null,
    identity: checkOutcomeOf(identity),
    active: checkOutcomeOf(active),
    reading: readingOf(active),
    flags: [
      ...new Set([
        ...textListOf(active?.metadata ?? {}, 'flags'),
        ...textListOf(service?.metadata ?? {}, 'flags'),
      ]),
    ],
    fields: BUSINESS_MATCH_FIELDS.map((field) => ({
      field,
      members: BUSINESS_VALUE_MEMBERS[field],
      match: recordedMatchOf(recorded[field]),
    })),
    groups: recordedGroupsOf(identity),
    persons: {
      outcome: checkOutcomeOf(persons),
      persons: countOf(counted, 'persons'),
      matched: countOf(counted, 'matched'),
      unmatched: countOf(counted, 'unmatched'),
      undecided: countOf(counted, 'undecided'),
    },
    country: checkOutcomeOf(resultOf(checks, 'database_business_enabled_country_detection')),
    service: checkOutcomeOf(service),
  };
}
