/**
 * C235.1, C237.6 (Phase 11, Workflow 11A Stage 2; `connect-logic` checkpoint 3): the `provenance`
 * builders. Their output is `@openverify/contracts`' `provenanceSchema` (`connectCloneProvenanceSchema`,
 * `connectHydrateProvenanceSchema`).
 */

/** C235.1: on every cloned inquiry, verification, check and file. */
export interface CloneProvenanceRecord {
  readonly kind: 'connect-clone';
  readonly 'share-token-id': string;
  readonly 'source-organization-name': string;
  readonly 'source-environment-kind': 'sandbox' | 'production';
  readonly 'source-created-at': string;
  readonly 'source-status': string;
  readonly 'cloned-at': string;
  readonly 'consent-withdrawn-at'?: string | null;
}

/** C235.1: on a hydrated account, inquiry or transaction; the filled keys, never their values. */
export interface HydrateProvenanceRecord {
  readonly kind: 'connect-hydrate';
  readonly 'share-token-id': string;
  readonly 'source-organization-name': string;
  readonly 'hydrated-at': string;
  readonly fields: readonly string[];
  readonly 'consent-withdrawn-at'?: string | null;
}

export type ConnectProvenanceRecord = CloneProvenanceRecord | HydrateProvenanceRecord;

export interface CloneProvenanceInput {
  readonly shareTokenId: string;
  readonly sourceOrganizationName: string;
  readonly sourceEnvironmentKind: 'sandbox' | 'production';
  /** When the source created the object the copy is made from. */
  readonly sourceCreatedAt: Date;
  /** The source object's status when it was copied. */
  readonly sourceStatus: string;
  readonly clonedAt: Date;
}

export interface HydrateProvenanceInput {
  readonly shareTokenId: string;
  readonly sourceOrganizationName: string;
  readonly hydratedAt: Date;
  /** The destination names written (dotted for a nested field). */
  readonly fields: readonly string[];
}

/** `provenanceSchema`'s bounds (contracts `provenance.ts`). */
const NAME_MAX = 255;
const STATUS_MAX = 64;
const FIELDS_MAX = 1000;
const FIELD_NAME = /^[a-z0-9][a-z0-9_.-]{0,127}$/;
const SHARE_TOKEN_ID = /^cnst_[0-9A-HJKMNP-TV-Z]{26}$/;

function tokenId(id: string): string {
  if (!SHARE_TOKEN_ID.test(id)) {
    throw new RangeError('provenance names a share token id');
  }
  return id;
}

function organizationName(name: string): string {
  const normalized = name.normalize('NFC');
  if (normalized.length === 0 || normalized.length > NAME_MAX) {
    throw new RangeError(`an organisation name is 1 to ${String(NAME_MAX)} characters`);
  }
  return normalized;
}

function timestamp(at: Date): string {
  if (Number.isNaN(at.getTime())) {
    throw new RangeError('provenance needs a valid time');
  }
  return at.toISOString();
}

/**
 * C235.1 (ours): a clone's provenance, on every cloned inquiry, verification, check and file: the
 * token, the source organisation's name (NFC) and environment kind, the source object's creation
 * time and its status when copied, and when the copy was made. The source's object ids are never
 * in it (least disclosure: the token links the two sides' audit). Throws `RangeError` for a value
 * `connectCloneProvenanceSchema` would refuse.
 */
export function cloneProvenance(input: CloneProvenanceInput): CloneProvenanceRecord {
  if (input.sourceStatus.length === 0 || input.sourceStatus.length > STATUS_MAX) {
    throw new RangeError(`a source status is 1 to ${String(STATUS_MAX)} characters`);
  }
  return {
    kind: 'connect-clone',
    'share-token-id': tokenId(input.shareTokenId),
    'source-organization-name': organizationName(input.sourceOrganizationName),
    'source-environment-kind': input.sourceEnvironmentKind,
    'source-created-at': timestamp(input.sourceCreatedAt),
    'source-status': input.sourceStatus,
    'cloned-at': timestamp(input.clonedAt),
  };
}

/**
 * C235.1 (ours): a hydrate's provenance, on a hydrated account, inquiry or transaction: the token,
 * the source organisation's name, when, and the destination keys filled (distinct, sorted), never
 * their values. Throws `RangeError` for a value `connectHydrateProvenanceSchema` would refuse.
 */
export function hydrateProvenance(input: HydrateProvenanceInput): HydrateProvenanceRecord {
  const fields = [...new Set(input.fields)].sort();
  if (fields.length > FIELDS_MAX || fields.some((name) => !FIELD_NAME.test(name))) {
    throw new RangeError(
      `provenance names at most ${String(FIELDS_MAX)} field keys, each a field name`,
    );
  }
  return {
    kind: 'connect-hydrate',
    'share-token-id': tokenId(input.shareTokenId),
    'source-organization-name': organizationName(input.sourceOrganizationName),
    'hydrated-at': timestamp(input.hydratedAt),
    fields,
  };
}

/**
 * C237.6 (2): the copy's destination-side consent was withdrawn at `at`; from then on the copy no
 * longer counts under `accept-cloned-results` (C235.4). The first withdrawal's time is kept; the
 * input is never changed.
 */
export function withConsentWithdrawn<Record extends ConnectProvenanceRecord>(
  provenance: Record,
  at: Date,
): Record {
  const earlier = provenance['consent-withdrawn-at'];
  return {
    ...provenance,
    'consent-withdrawn-at': earlier ?? timestamp(at),
  };
}
