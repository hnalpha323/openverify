/**
 * Connect (Phase 11, Workflow 11A Stage 1a; C230-C233): sharing a verified person's data between
 * two organisations of one install. Frozen here: the connection (`connect/connection`, `cxn_`) as
 * each side sees it, the versioned share policy (`cxnp_`, ours), the share token
 * (`connect/share-token`, `cnst_`) as each side sees it, the peek envelope
 * (`connect/source-data/<subtype>`) and the bodies and queries of their routes.
 *
 * The public names are kept where a public one exists (`destination-organization-id`,
 * `expires-in-seconds`, `peek-source-data`, `{visibility, value}`); every member the comments call
 * "ours" has none. A share token's id is a handle, not a secret (C232.8): it may be logged, and
 * every call is bound to its recipient.
 */
import { SHARE_CATEGORIES } from '@openverify/core';
import { z } from 'zod';
import { environmentKindSchema } from './environments.js';
import {
  accountIdentifierSchema,
  inquiryIdentifierSchema,
  transactionIdentifierSchema,
  verificationIdentifierSchema,
} from './identifiers.js';
import { anyIdSchema, idSchema } from './ids.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  requestDocumentSchema,
  resourceIdentifierSchema,
  singleDocumentSchema,
  timestampSchema,
  toOneRelationshipSchema,
} from './json-api.js';
import { booleanFilterSchema, filterListSchema, listQuerySchema } from './list-filters.js';
import { lastUpdaterSchema, sha256HexSchema } from './template-fields.js';

// The share policy (C230.3) --------------------------------------------------------------------

/** C230.3: the closed list of purposes; one value in this release. */
export const SHARE_PURPOSES = ['share.reuse-kyc'] as const;
export const sharePurposeSchema = z.enum(SHARE_PURPOSES);
export type SharePurpose = z.infer<typeof sharePurposeSchema>;

/** C230.3, C232.1: what a share token's source can be, by its id's prefix. */
export const SHARE_SOURCE_TYPES = ['inquiry', 'account', 'transaction', 'verification'] as const;
export const shareSourceTypeSchema = z.enum(SHARE_SOURCE_TYPES);
export type ShareSourceType = z.infer<typeof shareSourceTypeSchema>;

/** The id prefix of each source type (C232.1). A report id (`rep_`) is refused, C286. */
export const SHARE_SOURCE_ID_PREFIX = Object.freeze({
  inquiry: 'inq',
  account: 'acc',
  transaction: 'txn',
  verification: 'ver',
} as const satisfies Record<ShareSourceType, string>);

/** C230.3, C234.3: the six verification types a clone copies (the public list). */
export const SHARE_VERIFICATION_TYPES = [
  'government-id',
  'selfie',
  'database',
  'document',
  'email-address',
  'phone-number',
] as const;
export const shareVerificationTypeSchema = z.enum(SHARE_VERIFICATION_TYPES);
export type ShareVerificationType = z.infer<typeof shareVerificationTypeSchema>;

/** C230.3 (review P03): which shares an attested source consent may authorise. */
export const ATTESTED_CONSENT_MODES = ['none', 'non-biometric', 'all'] as const;
export const attestedConsentModeSchema = z.enum(ATTESTED_CONSENT_MODES);
export type AttestedConsentMode = z.infer<typeof attestedConsentModeSchema>;
export const ATTESTED_CONSENT_DEFAULT: AttestedConsentMode = 'non-biometric';

/** C233.2: an attribute is shown in full, or only as "the source holds a value". */
export const PEEK_VISIBILITIES = ['full', 'presence'] as const;
export const peekVisibilitySchema = z.enum(PEEK_VISIBILITIES);
export type PeekVisibility = z.infer<typeof peekVisibilitySchema>;

/** C233.2: the subtypes of the peek envelope, `connect/source-data/<subtype>`. */
export const SOURCE_DATA_SUBTYPES = [
  'inquiry',
  'account',
  'transaction',
  ...SHARE_VERIFICATION_TYPES.map((type) => `verification/${type}` as const),
] as const;
export const sourceDataSubtypeSchema = z.enum(SOURCE_DATA_SUBTYPES);
export type SourceDataSubtype = z.infer<typeof sourceDataSubtypeSchema>;

/** C230.3 (provisional, ours): 200 field keys per object type, 400 peek paths. */
export const SHARE_POLICY_LIMITS = Object.freeze({ fieldsPerType: 200, peekPaths: 400 });

/**
 * A field key of an inquiry, an account or a transaction. The three spell their keys differently
 * (kebab-case, snake_case, either), so the allowlist takes the union: 1 to 64 characters.
 */
export const shareFieldKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'must be a field key');

const FIELD_SUBTYPES = ['inquiry', 'account', 'transaction'] as const;
type FieldSubtype = (typeof FIELD_SUBTYPES)[number];
const PEEK_FIELD_MARK = 'fields.';
/**
 * `<subtype>.<attribute>` for every subtype (an attribute is never named `fields`), or
 * `<subtype>.fields.<key>` for the three subtypes with a `fields` bucket (C233.2).
 */
const PEEK_PATH_PATTERN = new RegExp(
  `^(?:(?:${FIELD_SUBTYPES.join('|')})\\.fields\\.[a-z0-9][a-z0-9_-]{0,63}` +
    `|(?:${SOURCE_DATA_SUBTYPES.join('|')})\\.(?!fields$)[a-z][a-z0-9-]{0,63})$`,
);

/**
 * C230.3, C233.2: a peek path, `<subtype>.<attribute>` or, for an inquiry, an account or a
 * transaction, `<subtype>.fields.<key>`: for example
 * `inquiry.status`, `account.fields.name-first`, `verification/government-id.name-first`. A path the
 * policy does not list is served as `presence`.
 */
export const sharePeekPathSchema = z
  .string()
  .max(160)
  .regex(PEEK_PATH_PATTERN, 'must be <subtype>.<attribute> or <subtype>.fields.<key>');

/** The subtype and the rest of a peek path. */
export function parsePeekPath(path: string): {
  readonly subtype: SourceDataSubtype;
  readonly fieldKey: string | null;
  readonly attribute: string | null;
} {
  const subtype = SOURCE_DATA_SUBTYPES.find((candidate) => path.startsWith(`${candidate}.`));
  if (subtype === undefined) {
    throw new TypeError('Not a peek path');
  }
  const rest = path.slice(subtype.length + 1);
  return rest.startsWith(PEEK_FIELD_MARK)
    ? { subtype, fieldKey: rest.slice(PEEK_FIELD_MARK.length), attribute: null }
    : { subtype, fieldKey: null, attribute: rest };
}

const fieldAllowlistSchema = z
  .array(shareFieldKeySchema)
  .max(SHARE_POLICY_LIMITS.fieldsPerType)
  .refine(hasDistinctValues, 'must not contain duplicates');

const sharePolicyShape = {
  /** The one purpose a share serves; a consent record names the same one. */
  purpose: sharePurposeSchema,
  'source-types': z
    .array(shareSourceTypeSchema)
    .min(1)
    .refine(hasDistinctValues, 'must not contain duplicates'),
  verifications: z.strictObject({
    types: z
      .array(shareVerificationTypeSchema)
      .refine(hasDistinctValues, 'must not contain duplicates'),
    /** Names, dates, numbers and addresses read from the evidence. */
    'extracted-data': z.boolean(),
    'check-results': z.boolean(),
    /** Document images and other uploads. */
    files: z.boolean(),
  }),
  /** Allowlists of field keys; there is no wildcard. */
  fields: z.strictObject({
    inquiry: fieldAllowlistSchema,
    account: fieldAllowlistSchema,
    transaction: fieldAllowlistSchema,
  }),
  /** Selfie images, ID portraits, and liveness and face-match results. Never a face template. */
  biometric: z.boolean(),
  /** Only paths the policy shares; a shared attribute it does not name is `presence`. */
  peek: z.record(sharePeekPathSchema, peekVisibilitySchema),
};

type SharePolicyBody = z.infer<z.ZodObject<typeof sharePolicyShape>>;

/** C230.3's rules, each issue at the member it is about (422 `share_policy_invalid`). */
function checkSharePolicy(policy: SharePolicyBody, ctx: z.RefinementCtx): void {
  const types = policy.verifications.types;
  const selfie = types.indexOf('selfie');
  if (selfie !== -1 && !policy.biometric) {
    ctx.addIssue({
      code: 'custom',
      message: 'selfie needs biometric: true',
      path: ['verifications', 'types', selfie],
    });
  }
  if (policy['source-types'].includes('verification') && types.length === 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'the verification source type needs at least one verification type',
      path: ['verifications', 'types'],
    });
  }
  const paths = Object.keys(policy.peek);
  if (paths.length > SHARE_POLICY_LIMITS.peekPaths) {
    ctx.addIssue({
      code: 'custom',
      message: `at most ${String(SHARE_POLICY_LIMITS.peekPaths)} peek paths`,
      path: ['peek'],
    });
  }
  for (const path of paths) {
    if (!sharePeekPathSchema.safeParse(path).success) {
      continue;
    }
    const { subtype, fieldKey } = parsePeekPath(path);
    const shared = (FIELD_SUBTYPES as readonly string[]).includes(subtype)
      ? policy['source-types'].includes(subtype as FieldSubtype) &&
        (fieldKey === null || policy.fields[subtype as FieldSubtype].includes(fieldKey))
      : fieldKey === null &&
        (types as readonly string[]).includes(subtype.slice('verification/'.length));
    if (!shared) {
      ctx.addIssue({
        code: 'custom',
        message: 'the policy does not share this path',
        path: ['peek', path],
      });
    }
  }
}

/**
 * C230.3 (ours): the body of one share-policy version, as a source sends it. `attested-consent`
 * defaults to `non-biometric`. What the policy states is what the platform will copy; it says
 * nothing about what the destination does with a copy (C230.6).
 */
export const sharePolicySchema = z
  .strictObject({
    ...sharePolicyShape,
    'attested-consent': attestedConsentModeSchema.default(ATTESTED_CONSENT_DEFAULT),
  })
  .superRefine(checkSharePolicy);
export type SharePolicyInput = z.input<typeof sharePolicySchema>;
export type SharePolicy = z.infer<typeof sharePolicySchema>;

/** A stored version's body: `attested-consent` is always present. */
export const storedSharePolicySchema = z
  .strictObject({ ...sharePolicyShape, 'attested-consent': attestedConsentModeSchema })
  .superRefine(checkSharePolicy);

/** C230.2: a connection's current policy version, frozen once written (`cxnp_`). */
export const sharePolicyVersionSchema = z.strictObject({
  id: idSchema('cxnp'),
  version: z.int().min(1),
  'created-at': timestampSchema,
  body: storedSharePolicySchema,
});
export type SharePolicyVersion = z.infer<typeof sharePolicyVersionSchema>;

// Connections (C230.2, C231) -------------------------------------------------------------------

/** C230.2: `archived` is in the enum for parity; nothing sets it in this release. */
export const CONNECTION_STATUSES = ['pending', 'active', 'inactive', 'archived'] as const;
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

/** The two sides of a connection, a share and a consent record. */
export const CONNECT_SIDES = ['source', 'destination'] as const;
export const connectSideSchema = z.enum(CONNECT_SIDES);
export type ConnectSide = z.infer<typeof connectSideSchema>;

/**
 * Ours: which side the caller is. `self` is a self-connection (C230.2), whose one organisation is
 * both and sees both sides' members.
 */
export const CONNECTION_DIRECTIONS = ['outbound', 'inbound', 'self'] as const;
export const connectionDirectionSchema = z.enum(CONNECTION_DIRECTIONS);
export type ConnectionDirection = z.infer<typeof connectionDirectionSchema>;

/** An organisation's display name, NFC, as it is shown. */
export const organizationNameSchema = z.string().min(1).max(255);

/** C231.3: the destination's reference to the agreement between the two organisations. */
export const agreementReferenceSchema = z.string().min(1).max(500);

export const connectionIdentifierSchema = resourceIdentifierSchema('connect/connection', 'cxn');
export const shareTokenIdentifierSchema = resourceIdentifierSchema('connect/share-token', 'cnst');

export const connectionAttributesSchema = z.strictObject({
  status: connectionStatusSchema,
  /** Ours: the caller's side. */
  direction: connectionDirectionSchema,
  'source-organization-id': idSchema('org'),
  'destination-organization-id': idSchema('org'),
  /** Ours. The destination always sees it: it needs the name to decide. */
  'source-organization-name': organizationNameSchema,
  /** Ours; `null` to the source until the connection is first activated (review P09). */
  'destination-organization-name': organizationNameSchema.nullable(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  'activated-at': timestampSchema.nullable(),
  'deactivated-at': timestampSchema.nullable(),
  'deactivated-by': connectSideSchema.nullable(),
  /** Ours: the current policy version, whether or not the destination accepted it yet. */
  'share-policy': sharePolicyVersionSchema,
  /** Ours: the version the destination last accepted, or `null`. */
  'accepted-policy-version': z.int().min(1).nullable(),
  /**
   * C231.3: served to the destination only (and to a self-connection's organisation). It is the
   * operator's reference, not personal data, so `pii:view` is not needed to read it.
   */
  'agreement-reference': agreementReferenceSchema.nullable().optional(),
});

const connectionRelationshipsSchema = z.strictObject({
  /** The user or API key that created the connection; the source only. */
  creator: toOneRelationshipSchema(
    z.discriminatedUnion('type', [
      ...lastUpdaterSchema.options,
      // C243.1 (integration-11a): a token a workflow step made names its run.
      z.strictObject({ type: z.literal('workflow-run'), id: idSchema('wfr') }),
    ]),
  ).optional(),
});

/**
 * C230.2: the connection as the caller sees it. The source sees `creator` and no agreement
 * reference; the destination sees the agreement reference and no creator (review P26: the other
 * controller's staff are not disclosed); a self-connection's organisation sees both.
 */
export const connectionResourceSchema = z
  .strictObject({
    type: z.literal('connect/connection'),
    id: idSchema('cxn'),
    attributes: connectionAttributesSchema,
    relationships: connectionRelationshipsSchema,
  })
  .superRefine((resource, ctx) => {
    const { direction } = resource.attributes;
    const hasReference = Object.hasOwn(resource.attributes, 'agreement-reference');
    const hasCreator = resource.relationships.creator !== undefined;
    if (hasReference !== (direction !== 'outbound')) {
      ctx.addIssue({
        code: 'custom',
        message: 'the agreement reference is served to the destination only',
        path: ['attributes', 'agreement-reference'],
      });
    }
    if (hasCreator !== (direction !== 'inbound')) {
      ctx.addIssue({
        code: 'custom',
        message: 'the creator is served to the source only',
        path: ['relationships', 'creator'],
      });
    }
  });
export type ConnectionResource = z.infer<typeof connectionResourceSchema>;

export const connectionDocumentSchema = singleDocumentSchema(connectionResourceSchema);
export const connectionListDocumentSchema = listDocumentSchema(connectionResourceSchema);

/** `POST /api/v1/connect/connections` (`connect-connections:write`, the source; C231.1). */
export const createConnectionBodySchema = requestDocumentSchema(
  'connect/connection',
  z.strictObject({
    'destination-organization-id': idSchema('org'),
    /** Ours, required (decision 17): version 1 of the connection's policy. */
    'share-policy': sharePolicySchema,
  }),
);
export type CreateConnectionBody = z.infer<typeof createConnectionBodySchema>;

/** `GET /api/v1/connect/connections` (`connect-connections:read`; C231.2): both directions. */
export const listConnectionsQuerySchema = listQuerySchema('cxn', {
  'filter[status]': filterListSchema(connectionStatusSchema, CONNECTION_STATUSES.length).optional(),
  'filter[destination-organization-id]': filterListSchema(idSchema('org')).optional(),
});
export type ListConnectionsQuery = z.infer<typeof listConnectionsQuerySchema>;

/**
 * `POST /api/v1/dashboard/connect/connections/:id/activate` (C231.3): a user session only, the
 * operator permission `connect-connections:activate`, and a second factor verified within the
 * step-up window. `policy-version` must be the current one (409 `share_policy_changed`).
 */
export const activateConnectionBodySchema = requestDocumentSchema(
  'connect/connection',
  z.strictObject({
    'policy-version': z.int().min(1),
    'agreement-reference': agreementReferenceSchema,
    acknowledged: z.literal(true),
  }),
);
export type ActivateConnectionBody = z.infer<typeof activateConnectionBodySchema>;

/** `POST /api/v1/connect/connections/:id/share-policy` (the source; C231.6): version n + 1. */
export const changeSharePolicyBodySchema = requestDocumentSchema(
  'connect/connection',
  z.strictObject({ 'share-policy': sharePolicySchema }),
);
export type ChangeSharePolicyBody = z.infer<typeof changeSharePolicyBodySchema>;

/** The path parameter of every connection route. */
export const connectionParamsSchema = z.strictObject({ id: idSchema('cxn') });

// Share tokens (C232) --------------------------------------------------------------------------

/** C232.6: the public statuses, without `ready` (no prefetched copy exists, decision 21). */
export const SHARE_TOKEN_STATUSES = [
  'created',
  'pending',
  'redeemed',
  'expired',
  'failed',
] as const;
export const shareTokenStatusSchema = z.enum(SHARE_TOKEN_STATUSES);
export type ShareTokenStatus = z.infer<typeof shareTokenStatusSchema>;
/** C232.6: nothing leaves these. */
export const SHARE_TOKEN_FINAL_STATUSES = ['redeemed', 'expired', 'failed'] as const;

export const SHARE_TOKEN_DIRECTIONS = ['outbound', 'inbound'] as const;
export const shareTokenDirectionSchema = z.enum(SHARE_TOKEN_DIRECTIONS);
export type ShareTokenDirection = z.infer<typeof shareTokenDirectionSchema>;

/** C232.6: the four public failure reasons, then ours. Every failure is final. */
export const SHARE_TOKEN_FAILURE_REASONS = [
  'source_not_found',
  'source_redacted',
  'import_failed',
  'unrecoverable_error',
  'connection_inactive',
  'consent_withdrawn',
  'consent_expired',
  'consent_scope_exceeded',
  'source_is_copy',
] as const;
export const shareTokenFailureReasonSchema = z.enum(SHARE_TOKEN_FAILURE_REASONS);
export type ShareTokenFailureReason = z.infer<typeof shareTokenFailureReasonSchema>;

/** C232.6 (ours): why a token expired. */
export const SHARE_TOKEN_EXPIRY_REASONS = [
  'time',
  'source_expired',
  'connection_deactivated',
  'consent_withdrawn',
] as const;
export const shareTokenExpiryReasonSchema = z.enum(SHARE_TOKEN_EXPIRY_REASONS);
export type ShareTokenExpiryReason = z.infer<typeof shareTokenExpiryReasonSchema>;

/**
 * C234.1, C234.11: `clone` and `hydrate` are the route's; `fill-inquiry` (ours) is the internal
 * mode of client-side redemption and is never accepted on the redeem route.
 */
export const SHARE_REDEEM_MODES = ['clone', 'hydrate', 'fill-inquiry'] as const;
export const shareRedeemModeSchema = z.enum(SHARE_REDEEM_MODES);
export type ShareRedeemMode = z.infer<typeof shareRedeemModeSchema>;

/**
 * C232.1 (the public range and default; decision 20): 60 s to 21 days, 14 days by default. The
 * environment's `share-token-max-seconds` (the same range, 21 days by default) caps it.
 */
export const SHARE_TOKEN_EXPIRES_IN_SECONDS = Object.freeze({
  min: 60,
  max: 1_814_400,
  default: 1_209_600,
});
export const shareTokenExpiresInSecondsSchema = z
  .int()
  .min(SHARE_TOKEN_EXPIRES_IN_SECONDS.min)
  .max(SHARE_TOKEN_EXPIRES_IN_SECONDS.max);

/** C233.5 (provisional, ours): a token is peeked at most ten times. */
export const SHARE_TOKEN_PEEK_LIMIT = 10;

export const shareCategorySchema = z.enum(SHARE_CATEGORIES);
/** C230.4: the closed set a share carries, fixed when the token is created (review H04). */
export const shareCategoriesSchema = z
  .array(shareCategorySchema)
  .max(SHARE_CATEGORIES.length)
  .refine(hasDistinctValues, 'must not contain duplicates');

/** C236.1: how a consent was recorded; `flow` is witnessed, `attested` is not. */
export const CONSENT_METHODS = ['flow', 'attested'] as const;
export const consentMethodSchema = z.enum(CONSENT_METHODS);
export type ConsentMethod = z.infer<typeof consentMethodSchema>;

/**
 * C232.3 (ours, review P03): what both sides see of the consent a share rests on. No evidence and
 * no subject: only that it is a flow record or an attestation, what it covers and its text's digest.
 */
export const shareTokenSourceConsentSchema = z
  .strictObject({
    method: consentMethodSchema,
    witnessed: z.boolean(),
    categories: shareCategoriesSchema,
    'explicit-biometric': z.boolean(),
    'text-sha256': sha256HexSchema,
  })
  .refine((consent) => consent.witnessed === (consent.method === 'flow'), {
    message: 'only a flow record is witnessed',
    path: ['witnessed'],
  });
export type ShareTokenSourceConsent = z.infer<typeof shareTokenSourceConsentSchema>;

/**
 * C234.8 (ours): what a redemption copied, as counts and keys, never a value. `peek-count` is how
 * often the token was peeked (C233.5).
 */
export const redeemSummarySchema = z.strictObject({
  'policy-version': z.int().min(1),
  verifications: z.int().min(0),
  checks: z.int().min(0),
  files: z.int().min(0),
  fields: z.int().min(0),
  /** The keys of the fields a hydrate dropped (C234.5); keys only. */
  'dropped-fields': z.array(shareFieldKeySchema).max(3 * SHARE_POLICY_LIMITS.fieldsPerType),
  'peek-count': z.int().min(0).max(SHARE_TOKEN_PEEK_LIMIT),
});
export type RedeemSummary = z.infer<typeof redeemSummarySchema>;

/**
 * C233 (rule 11): a peek holds the source's values, so `source-data` is masked by name at every
 * exit that masks (a stored API log read without `pii:view`, a run's trigger view).
 */
export const PII_SHARE_TOKEN_ATTRIBUTES: readonly string[] = Object.freeze(['source-data']);

/**
 * C231.3 (rule 11): the agreement reference is the operator's own reference and is served to the
 * destination without `pii:view` (C242.1), so it is not in the list every exit masks; an API log
 * read without `pii:view` masks it through this list.
 */
export const CONNECT_LOG_MASKED_ATTRIBUTES: readonly string[] = Object.freeze([
  'agreement-reference',
]);

/**
 * A source attribute's value as the source holds it: any JSON value. Written without recursion, so
 * the OpenAPI document needs no shared definition for it.
 */
const peekValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

/** C233.2: one exposed attribute. `presence` says only whether the source holds a non-null value. */
export const peekableAttributeSchema = z.discriminatedUnion('visibility', [
  z.strictObject({ visibility: z.literal('full'), value: peekValueSchema }).meta({ pii: true }),
  z.strictObject({ visibility: z.literal('presence'), value: z.boolean() }),
]);
export type PeekableAttribute = z.infer<typeof peekableAttributeSchema>;

const peekAttributeNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const peekAttributesSchema = z.record(peekAttributeNameSchema, peekableAttributeSchema);
const peekFieldsSchema = z.record(shareFieldKeySchema, peekableAttributeSchema);

/**
 * C233.3 (ours): a file or an image in a peek is at most "the source holds one". No byte, image or
 * face data is ever in a peek.
 */
export const peekFilePresenceSchema = z.strictObject({
  visibility: z.literal('presence'),
  value: z.boolean(),
});

const sourceDataVerification = <const Type extends ShareVerificationType>(type: Type) =>
  z.strictObject({
    type: z.literal(`connect/source-data/verification/${type}`),
    attributes: peekAttributesSchema,
    /** Whether the source holds files for the verification; never their content. */
    files: peekFilePresenceSchema.optional(),
  });

const sourceDataVerificationSchemas = [
  sourceDataVerification('government-id'),
  sourceDataVerification('selfie'),
  sourceDataVerification('database'),
  sourceDataVerification('document'),
  sourceDataVerification('email-address'),
  sourceDataVerification('phone-number'),
] as const;

/** C233.2: a shareable verification inside an inquiry's peek, its own filtered snapshot. */
export const sourceDataVerificationSchema = z.discriminatedUnion('type', [
  ...sourceDataVerificationSchemas,
]);

const sourceDataWithFields = <const Subtype extends 'inquiry' | 'account' | 'transaction'>(
  subtype: Subtype,
) => ({
  type: z.literal(`connect/source-data/${subtype}`),
  attributes: peekAttributesSchema,
  fields: peekFieldsSchema,
});

/**
 * C233.2 (the public shape): `source-data` of a peek, by subtype. Every exposed attribute is
 * `{visibility, value}`; an attribute the policy does not share is absent; inquiries, accounts and
 * transactions add a `fields` bucket; an inquiry adds `related-objects`, its shareable
 * verifications. Built at read time from the source's current rows: nothing is cached (C233.4).
 */
export const sourceDataSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...sourceDataWithFields('inquiry'),
    'related-objects': z.array(sourceDataVerificationSchema).max(50),
  }),
  z.strictObject(sourceDataWithFields('account')),
  z.strictObject(sourceDataWithFields('transaction')),
  ...sourceDataVerificationSchemas,
]);
export type SourceData = z.infer<typeof sourceDataSchema>;

/** The resource type of a peek's `source-data` for `subtype`. */
export function sourceDataType(subtype: SourceDataSubtype): `connect/source-data/${string}` {
  return `connect/source-data/${subtype}`;
}

export const shareTokenAttributesSchema = z.strictObject({
  status: shareTokenStatusSchema,
  direction: shareTokenDirectionSchema,
  /** Ours. */
  'source-type': shareSourceTypeSchema,
  /** Ours: sandbox only to sandbox, production only to production (C232.1). */
  'environment-kind': environmentKindSchema,
  /** Ours: the policy version the token was created under and redeems under (C231.6). */
  'share-policy-version': z.int().min(1),
  /** C230.4 (ours): what the share carries, computed when the token was created. */
  'data-categories': shareCategoriesSchema,
  /** C232.3 (ours). */
  'source-consent': shareTokenSourceConsentSchema,
  'redeem-mode': shareRedeemModeSchema.nullable(),
  /** C234.8 (ours); `null` until a redemption ends. */
  'redeem-summary': redeemSummarySchema.nullable(),
  /** C233.5 (ours): how often the destination peeked, of {@link SHARE_TOKEN_PEEK_LIMIT}. */
  'peek-count': z.int().min(0).max(SHARE_TOKEN_PEEK_LIMIT),
  'failure-reason': shareTokenFailureReasonSchema.nullable(),
  /** Ours. */
  'expiry-reason': shareTokenExpiryReasonSchema.nullable(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  'expires-at': timestampSchema,
  'pending-at': timestampSchema.nullable(),
  'redeemed-at': timestampSchema.nullable(),
  /** Ours. */
  'expired-at': timestampSchema.nullable(),
  'failed-at': timestampSchema.nullable(),
  /** C233: only in the destination's answer to `peek-source-data=true`, never in a list. */
  'source-data': sourceDataSchema.optional(),
});

/** What a share can be made from, and what a redemption can fill. */
export const shareObjectIdentifierSchema = z.union([
  inquiryIdentifierSchema,
  accountIdentifierSchema,
  transactionIdentifierSchema,
  verificationIdentifierSchema,
]);

export const consentRecordIdentifierSchema = resourceIdentifierSchema('consent-record', 'cnsr');

const shareTokenRelationshipsSchema = z.strictObject({
  connection: toOneRelationshipSchema(connectionIdentifierSchema),
  /** The source only (public: the destination sees neither `creator` nor `source`). */
  creator: toOneRelationshipSchema(
    z.discriminatedUnion('type', [
      ...lastUpdaterSchema.options,
      // C243.1 (integration-11a): a token a workflow step made names its run.
      z.strictObject({ type: z.literal('workflow-run'), id: idSchema('wfr') }),
    ]),
  ).optional(),
  source: toOneRelationshipSchema(shareObjectIdentifierSchema).optional(),
  /** The source only (ours): the source-side consent record the token cites. */
  'consent-record': toOneRelationshipSchema(consentRecordIdentifierSchema).optional(),
  /** The destination only, after redemption: the object the redemption made or filled. */
  destination: toOneRelationshipSchema(shareObjectIdentifierSchema).optional(),
});

const SOURCE_ONLY_RELATIONSHIPS = ['creator', 'source', 'consent-record'] as const;

/**
 * C232.3: the token as the caller sees it. An `outbound` token (the source's view) carries
 * `creator`, `source` and `consent-record`; an `inbound` one (the destination's) carries none of
 * them, and `destination` once redeemed. A self-connection's token is served as `outbound` with
 * `destination` as well, because its one organisation is both sides.
 */
export const shareTokenResourceSchema = z
  .strictObject({
    type: z.literal('connect/share-token'),
    id: idSchema('cnst'),
    attributes: shareTokenAttributesSchema,
    relationships: shareTokenRelationshipsSchema,
  })
  .superRefine((resource, ctx) => {
    const outbound = resource.attributes.direction === 'outbound';
    for (const name of SOURCE_ONLY_RELATIONSHIPS) {
      if ((resource.relationships[name] !== undefined) !== outbound) {
        ctx.addIssue({
          code: 'custom',
          message: `${name} is served to the source only`,
          path: ['relationships', name],
        });
      }
    }
    if (
      resource.relationships.destination !== undefined &&
      resource.attributes.status !== 'redeemed'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'the destination is known once the token is redeemed',
        path: ['relationships', 'destination'],
      });
    }
    if (
      resource.attributes['source-data'] !== undefined &&
      resource.attributes.status !== 'created'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'only a created token is peeked',
        path: ['attributes', 'source-data'],
      });
    }
  });
export type ShareTokenResource = z.infer<typeof shareTokenResourceSchema>;

export const shareTokenDocumentSchema = singleDocumentSchema(shareTokenResourceSchema);
export const shareTokenListDocumentSchema = listDocumentSchema(shareTokenResourceSchema);

/**
 * `POST /api/v1/connect/share-tokens` (`connect-share-tokens:write`, in the source environment;
 * C232.1). The source type follows `source-id`'s prefix; any id is accepted here so that a report id
 * answers 422 `share_source_not_supported` and not a validation error.
 */
export const createShareTokenBodySchema = requestDocumentSchema(
  'connect/share-token',
  z.strictObject({
    'connection-id': idSchema('cxn'),
    'source-id': anyIdSchema,
    'expires-in-seconds': shareTokenExpiresInSecondsSchema.optional(),
    /** Ours, required (decision 19): the source-side consent record the share rests on. */
    'consent-record-id': idSchema('cnsr'),
  }),
);
export type CreateShareTokenBody = z.infer<typeof createShareTokenBodySchema>;

/** `GET /api/v1/connect/share-tokens` (`connect-share-tokens:read`; C232.2); never `source-data`. */
export const listShareTokensQuerySchema = listQuerySchema('cnst', {
  'filter[connection-id]': filterListSchema(idSchema('cxn')).optional(),
  'filter[status]': filterListSchema(
    shareTokenStatusSchema,
    SHARE_TOKEN_STATUSES.length,
  ).optional(),
  'filter[direction]': shareTokenDirectionSchema.optional(),
});
export type ListShareTokensQuery = z.infer<typeof listShareTokensQuerySchema>;

/**
 * `GET /api/v1/connect/share-tokens/:id` (C232.3). `peek-source-data=true` (the public parameter)
 * is the destination's alone, under `connect-share-tokens:peek`, and for a user also `pii:view`
 * (C233.1).
 */
export const getShareTokenQuerySchema = z.strictObject({
  'peek-source-data': booleanFilterSchema.optional(),
});
export type GetShareTokenQuery = z.infer<typeof getShareTokenQuerySchema>;

/** The path parameter of every share-token route. */
export const shareTokenParamsSchema = z.strictObject({ id: idSchema('cnst') });

// Redemption (C234) ----------------------------------------------------------------------------

/** C234.1: the modes the redeem route reads from its body; `fill-inquiry` is never one of them. */
export const SHARE_REDEEM_ROUTE_MODES = ['clone', 'hydrate'] as const;
export type ShareRedeemRouteMode = (typeof SHARE_REDEEM_ROUTE_MODES)[number];

/** C234.5 (provisional, ours): at most 600 mappings, three allowlists' worth. */
export const SHARE_FIELD_MAPPINGS_MAX = 3 * SHARE_POLICY_LIMITS.fieldsPerType;

/** A destination field name: a field key, with dot notation for a nested destination (C234.1). */
export const shareDestinationFieldNameSchema = z
  .string()
  .max(320)
  .regex(
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    /^[a-z0-9][a-z0-9_-]{0,63}(?:\.[a-z0-9][a-z0-9_-]{0,63}){0,4}$/,
    'must be a field key, with dots for a nested field',
  );

/** C234.1 (the public `meta.field-mappings`): hydrate only; names, never values. */
export const shareFieldMappingSchema = z.strictObject({
  'source-field-name': shareFieldKeySchema,
  'destination-field-name': shareDestinationFieldNameSchema,
});
export type ShareFieldMapping = z.infer<typeof shareFieldMappingSchema>;

/**
 * C234.1: the redeem body's `meta`. The public members first: `field-mappings` (hydrate),
 * `account-id`, `auto-create-account-reference-id` and `auto-create-account-type-id` (account
 * linking for a clone of an inquiry). Ours, labelled: `inquiry-template-id` and optional
 * `inquiry-template-version-id` (a clone of an inquiry: every inquiry here is pinned to a template
 * version), `inquiry-id` (a clone of a verification attaches to an open destination inquiry) and
 * `destination-consent-record-id`, the destination-side consent record, required (decision 24).
 * Conflicts between members are the route's 422 `share_redeem_meta_conflict`
 * ({@link shareRedeemMetaConflicts}), not a validation error.
 */
export const redeemShareTokenMetaSchema = z.strictObject({
  'field-mappings': z.array(shareFieldMappingSchema).max(SHARE_FIELD_MAPPINGS_MAX).optional(),
  'account-id': idSchema('acc').optional(),
  'auto-create-account-reference-id': z.string().min(1).max(255).optional(),
  'auto-create-account-type-id': idSchema('acctp').optional(),
  'inquiry-template-id': idSchema('itmpl').optional(),
  'inquiry-template-version-id': idSchema('itmplv').optional(),
  'inquiry-id': idSchema('inq').optional(),
  'destination-consent-record-id': idSchema('cnsr'),
});
export type RedeemShareTokenMeta = z.infer<typeof redeemShareTokenMetaSchema>;

/**
 * `POST /api/v1/connect/share-tokens/:id/redeem` (`connect-share-tokens:redeem`, the destination;
 * C234.1): `data.attributes.destination-id` (public, optional: without it a clone, with it a
 * hydrate of that account, inquiry or transaction) and `meta`. Any id is accepted as the
 * destination so that a wrong pairing answers 422 `share_redeem_mode_invalid`
 * ({@link shareRedeemPairAllowed}). No body member names a mode: `fill-inquiry` (C234.11) is
 * internal. The answer is 202 with the token `pending`.
 */
export const redeemShareTokenBodySchema = z.strictObject({
  data: z
    .strictObject({
      type: z.literal('connect/share-token').optional(),
      attributes: z.strictObject({ 'destination-id': anyIdSchema.optional() }),
    })
    .optional(),
  meta: redeemShareTokenMetaSchema,
});
export type RedeemShareTokenBody = z.infer<typeof redeemShareTokenBodySchema>;

/** C234.1: without `destination-id` a clone, with it a hydrate. */
export function shareRedeemModeOf(body: RedeemShareTokenBody): ShareRedeemRouteMode {
  return body.data?.attributes['destination-id'] === undefined ? 'clone' : 'hydrate';
}

/**
 * C234.1 (the public rule): `account-id`, the `auto-create-*` pair and `destination-id` exclude each
 * other, and `auto-create-account-reference-id` needs `auto-create-account-type-id` (there is no
 * default account type). Returns the JSON pointer of each member in conflict, in body order; empty
 * when there is none. The route answers 422 `share_redeem_meta_conflict` with them.
 */
export function shareRedeemMetaConflicts(body: RedeemShareTokenBody): string[] {
  const { meta } = body;
  const hydrate = body.data?.attributes['destination-id'] !== undefined;
  const autoCreate =
    meta['auto-create-account-reference-id'] !== undefined ||
    meta['auto-create-account-type-id'] !== undefined;
  const conflicts: string[] = [];
  if (meta['account-id'] !== undefined && hydrate) {
    conflicts.push('/meta/account-id');
  }
  if (autoCreate && (hydrate || meta['account-id'] !== undefined)) {
    for (const member of [
      'auto-create-account-reference-id',
      'auto-create-account-type-id',
    ] as const) {
      if (meta[member] !== undefined) {
        conflicts.push(`/meta/${member}`);
      }
    }
  }
  if (
    meta['auto-create-account-reference-id'] !== undefined &&
    meta['auto-create-account-type-id'] === undefined
  ) {
    conflicts.push('/meta/auto-create-account-type-id');
  }
  return conflicts;
}

/** What a hydrate fills (C234.5, C234.6), by the destination id's resource type. */
export const SHARE_HYDRATE_DESTINATION_TYPES = ['account', 'inquiry', 'transaction'] as const;

/**
 * C234.1, C234.11: whether a source type may be redeemed in a mode into a destination type
 * (`null` for a clone, which makes its own object). A clone takes an inquiry or a verification; a
 * hydrate fills an account, an inquiry or a transaction from an inquiry, an account or a
 * transaction; `fill-inquiry` fills the reserved inquiry from an inquiry or a verification. Any
 * other pairing is 422 `share_redeem_mode_invalid`.
 */
export function shareRedeemPairAllowed(
  sourceType: string,
  mode: ShareRedeemMode,
  destinationType: string | null,
): boolean {
  switch (mode) {
    case 'clone':
      return (
        destinationType === null && (sourceType === 'inquiry' || sourceType === 'verification')
      );
    case 'hydrate':
      return (
        (sourceType === 'inquiry' || sourceType === 'account' || sourceType === 'transaction') &&
        (SHARE_HYDRATE_DESTINATION_TYPES as readonly (string | null)[]).includes(destinationType)
      );
    case 'fill-inquiry':
      return (
        destinationType === 'inquiry' && (sourceType === 'inquiry' || sourceType === 'verification')
      );
  }
}

/**
 * C234.11 (ours, internal; reviews H01, F23): client-side redemption into the open inquiry the token
 * is reserved for (C238.5), which `api-consent`'s destination-side accept hands `api-redeem`'s
 * `connect-redeem` job. Never a route body: no route accepts `fill-inquiry`.
 */
export const fillInquiryRedemptionSchema = z.strictObject({
  'share-token-id': idSchema('cnst'),
  'inquiry-id': idSchema('inq'),
  'destination-consent-record-id': idSchema('cnsr'),
});
export type FillInquiryRedemption = z.infer<typeof fillInquiryRedemptionSchema>;
