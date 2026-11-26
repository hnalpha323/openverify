/**
 * C58, C59, C66: what a `verification/database` answer records, shaped for its evidence: the
 * entered values beside each match field's level, methods and flags, each match group's result,
 * the source and its authority, the inquiry comparison and the PO box patterns. Everything is read
 * from the verification answer alone, as the API masked it (C53.7); nothing is fetched. The
 * helpers that read a check result (`resultOf`, `recordedMatchOf`, `recordedGroupsOf`, …) serve
 * the AAMVA and business evidence too.
 *
 * Metadata is untyped (`Record<string, unknown>`), so every member is checked before it is read: a
 * malformed or older answer (the golden API fixture predates the evaluators) shows less, never
 * something it does not say. When `database_identity_comparison` records no field comparisons,
 * the per-field results stand in for the name, birth date and address, and the template's match
 * groups (the `match-groups` threshold) stand in for the recorded groups, without an outcome.
 */
import type { VerificationCheck, VerificationResource } from '@openverify/contracts';
import { comparisonSourceOf, type ComparisonSourceKind } from './comparison-source';
import {
  DATABASE_MATCH_FIELDS,
  MATCH_LEVELS,
  MATCH_REQUIREMENTS,
  type CheckStatus,
  type MatchLevel,
  type MatchRequirement,
} from '@openverify/core';

export type DatabaseVerification = Extract<VerificationResource, { type: 'verification/database' }>;

/** A field a database match group names (C51.3). */
export type DatabaseMatchField = (typeof DATABASE_MATCH_FIELDS)[number];

/** A match group's outcome (C58.1). */
export type GroupOutcome = 'met' | 'unmet' | 'undecidable';

/** One field's comparison as a result records it (C58.1): never a value. */
export interface RecordedMatch {
  readonly level: MatchLevel;
  readonly methods: readonly string[];
  readonly flags: readonly string[];
  /** An address's components (C58.4), each with how it compared, in the result's order. */
  readonly components: readonly (readonly [component: string, match: string])[];
}

/** One match group: each field it names with the level it needs, and its outcome. */
export interface RecordedGroup {
  readonly fields: readonly (readonly [field: string, requirement: MatchRequirement])[];
  /** `null` when the result records only the template's groups, not how each came out. */
  readonly outcome: GroupOutcome | null;
}

/** A check's result, as the evidence says it. */
export interface CheckOutcome {
  readonly name: string;
  readonly status: CheckStatus;
  readonly required: boolean;
  readonly reasons: readonly string[];
}

/** The provider a result names (ADR 0002 §3d, §3f). */
export interface EvidenceSource {
  readonly id: string;
  readonly sandbox: boolean;
}

/** One match field: the attributes holding what was entered for it, and how it compared. */
export interface FieldEvidence<Field extends string = string> {
  readonly field: Field;
  readonly members: readonly string[];
  readonly match: RecordedMatch | null;
}

/** `database_inquiry_comparison`: the entered values against the inquiry's prefilled fields. */
export interface InquiryComparisonEvidence {
  readonly outcome: CheckOutcome;
  readonly fields: readonly (readonly [field: string, match: RecordedMatch])[];
  /** C149.4 (K9-16): where each compared field's value came from; `null` when not recorded. */
  readonly sources: Readonly<Record<string, ComparisonSourceKind | null>>;
  readonly mismatched: readonly string[];
  readonly notRequested: readonly string[];
}

/** `database_po_box_detection`: the PO box patterns the street address matched. */
export interface PoBoxEvidence {
  readonly outcome: CheckOutcome;
  readonly patterns: readonly string[];
}

export interface DatabaseEvidenceData {
  /** Whether any check has a result yet. */
  readonly ran: boolean;
  readonly identity: CheckOutcome | null;
  readonly source: EvidenceSource | null;
  /** `database_identity_comparison`'s `authoritative`, or `null` when it records none. */
  readonly authoritative: boolean | null;
  readonly fields: readonly FieldEvidence<DatabaseMatchField>[];
  readonly groups: readonly RecordedGroup[];
  /** The fields a group names that the step did not collect (`not-requested-fields`). */
  readonly notRequested: readonly string[];
  readonly inquiry: InquiryComparisonEvidence | null;
  readonly poBox: PoBoxEvidence | null;
}

/** The attributes holding each database match field's entered values (C52.3, C52.8). */
export const DATABASE_VALUE_MEMBERS: Readonly<Record<DatabaseMatchField, readonly string[]>> =
  Object.freeze({
    name: ['name-first', 'name-middle', 'name-last'],
    birthdate: ['birthdate'],
    address: [
      'address-street-1',
      'address-street-2',
      'address-city',
      'address-subdivision',
      'address-postal-code',
      'address-country-code',
    ],
    'identification-number': ['identification-number'],
    'phone-number': ['phone-number'],
    'email-address': ['email-address'],
  });

/** The per-field results that stand in for the identity's own field comparisons. */
const FIELD_CHECKS: Readonly<Partial<Record<DatabaseMatchField, string>>> = {
  name: 'database_name_comparison',
  birthdate: 'database_birthdate_comparison',
  address: 'database_address_comparison',
};

type Metadata = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Metadata =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const LEVELS: readonly unknown[] = MATCH_LEVELS;
const REQUIREMENTS: readonly unknown[] = MATCH_REQUIREMENTS;
const OUTCOMES: readonly unknown[] = ['met', 'unmet', 'undecidable'] satisfies GroupOutcome[];

const isLevel = (value: unknown): value is MatchLevel => LEVELS.includes(value);
const isRequirement = (value: unknown): value is MatchRequirement => REQUIREMENTS.includes(value);
const isOutcome = (value: unknown): value is GroupOutcome => OUTCOMES.includes(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The result of the check named `name`, if it ran. */
export function resultOf(
  checks: readonly VerificationCheck[],
  name: string,
): VerificationCheck | undefined {
  return checks.find((check) => check.name === name);
}

const outcomeOf = (check: VerificationCheck): CheckOutcome => ({
  name: check.name,
  status: check.status,
  required: check.requirement === 'required',
  reasons: [...check.reasons],
});

/** A result as the evidence says it, or `null` without one. */
export function checkOutcomeOf(check: VerificationCheck | undefined): CheckOutcome | null {
  return check === undefined ? null : outcomeOf(check);
}

/** The provider the first of `checks` with one names. */
export function sourceOf(
  checks: readonly (VerificationCheck | undefined)[],
): EvidenceSource | null {
  for (const check of checks) {
    const provider = check?.provenance?.provider;
    if (provider !== undefined) {
      return { id: provider.id, sandbox: provider.sandbox };
    }
  }
  return null;
}

/** A field comparison as a result records it, or `null` for anything else. */
export function recordedMatchOf(value: unknown): RecordedMatch | null {
  if (!isRecord(value) || !isLevel(value.level)) {
    return null;
  }
  const components = isRecord(value.components)
    ? Object.entries(value.components).flatMap(([component, match]) =>
        typeof match === 'string' ? [[component, match] as const] : [],
      )
    : [];
  return {
    level: value.level,
    methods: strings(value.methods),
    flags: strings(value.flags),
    components,
  };
}

/** A group's fields with the level each needs; a field with an unknown level is left out. */
function groupFieldsOf(value: unknown): (readonly [string, MatchRequirement])[] {
  return isRecord(value)
    ? Object.entries(value).flatMap(([field, requirement]) =>
        isRequirement(requirement) ? [[field, requirement] as const] : [],
      )
    : [];
}

/**
 * The match groups a result records with their outcomes, else the template's groups (its
 * `match-groups` threshold) with no outcome.
 */
export function recordedGroupsOf(check: VerificationCheck | undefined): RecordedGroup[] {
  if (check === undefined) {
    return [];
  }
  const groups: unknown = check.metadata.groups;
  const recorded = (Array.isArray(groups) ? (groups as unknown[]) : []).flatMap(
    (group): RecordedGroup[] => {
      if (!isRecord(group) || !isOutcome(group.outcome)) {
        return [];
      }
      const fields = groupFieldsOf(group.fields);
      return fields.length === 0 ? [] : [{ fields, outcome: group.outcome }];
    },
  );
  if (recorded.length > 0) {
    return recorded;
  }
  const configured = check.provenance?.thresholds['match-groups'];
  return (Array.isArray(configured) ? (configured as unknown[]) : []).flatMap(
    (group): RecordedGroup[] => {
      const fields = groupFieldsOf(group);
      return fields.length === 0 ? [] : [{ fields, outcome: null }];
    },
  );
}

/** The strings of a metadata list, or none. */
export function textListOf(metadata: Metadata, key: string): string[] {
  return strings(metadata[key]);
}

/** The field comparisons a result records under `fields`, in its order. */
function recordedFieldsOf(metadata: Metadata): (readonly [string, RecordedMatch])[] {
  const fields = metadata.fields;
  return isRecord(fields)
    ? Object.entries(fields).flatMap(([field, value]) => {
        const match = recordedMatchOf(value);
        return match === null ? [] : [[field, match] as const];
      })
    : [];
}

/** A database verification's evidence. */
export function databaseEvidenceOf(verification: DatabaseVerification): DatabaseEvidenceData {
  const { checks } = verification.attributes;
  const identity = resultOf(checks, 'database_identity_comparison');
  const metadata: Metadata = identity?.metadata ?? {};
  const recorded = new Map(recordedFieldsOf(metadata));
  const fields = DATABASE_MATCH_FIELDS.map((field) => {
    const stand = FIELD_CHECKS[field];
    const match =
      recorded.get(field) ??
      (stand === undefined ? null : recordedMatchOf(resultOf(checks, stand)?.metadata));
    return { field, members: DATABASE_VALUE_MEMBERS[field], match };
  });
  const inquiry = resultOf(checks, 'database_inquiry_comparison');
  const poBox = resultOf(checks, 'database_po_box_detection');
  return {
    ran: checks.length > 0,
    identity: checkOutcomeOf(identity),
    source: sourceOf(checks),
    authoritative: typeof metadata.authoritative === 'boolean' ? metadata.authoritative : null,
    fields,
    groups: recordedGroupsOf(identity),
    notRequested: textListOf(metadata, 'not-requested-fields'),
    inquiry:
      inquiry === undefined
        ? null
        : {
            outcome: outcomeOf(inquiry),
            fields: recordedFieldsOf(inquiry.metadata),
            sources: Object.fromEntries(
              recordedFieldsOf(inquiry.metadata).map(([field]) => [
                field,
                comparisonSourceOf(inquiry.metadata, field),
              ]),
            ),
            mismatched: textListOf(inquiry.metadata, 'mismatched-fields'),
            notRequested: textListOf(inquiry.metadata, 'not-requested-fields'),
          },
    poBox:
      poBox === undefined
        ? null
        : { outcome: outcomeOf(poBox), patterns: textListOf(poBox.metadata, 'matched-patterns') },
  };
}
