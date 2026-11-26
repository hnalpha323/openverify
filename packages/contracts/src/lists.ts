/**
 * Lists (plan C97, C99): the thirteen list kinds and their items, list matches, `list-config`, the
 * on-demand match and the C106.2 list provenance. The kinds and vocabularies live in
 * `@openverify/core` (`packages/core/src/lists.ts`), because the tables and the key inputs read
 * them too; this file gives them their wire shapes.
 *
 * JSON:API `type` is `list/<kind>`, `list-item/<kind>`: paths are plural and types singular, as in
 * the public API (H18). Every item value is PII except `country-code`, masked without `pii:view`
 * and `null` once redacted (C97.6); list names are not PII, and the docs warn against putting
 * personal data in them. Nothing here says "no match" for a list that was not read: a match answer
 * carries `unscreened` and `not-applicable` beside `matches` (H02), and only a list in neither was
 * compared.
 *
 * Routes (C97.1, frozen by `foundation-7b`, built by `api-lists`, scopes `lists:read` and
 * `lists:write`):
 * - `POST /api/v1/list/<plural>`, `GET /api/v1/lists`, `GET` and `DELETE` (archive)
 *   `/api/v1/lists/:id`, and, ours, `PATCH /api/v1/lists/:id`;
 * - `POST /api/v1/list-item/<plural>`, `GET` and `DELETE` (archive)
 *   `/api/v1/list-item/<plural>/:id`, and, ours, `GET /api/v1/list-items?filter[list-id]=`;
 * - `POST /api/v1/lists/match` (ours; `lists:read` and `pii:view`, P11; policy `lists-match`);
 * - `GET /api/v1/list-matches`, `GET /:id` and `POST /:id/dismiss` (`lists:write`).
 *
 * Face and background items also need `pii:view` to create, and need
 * `biometric-lists-basis` set (C97.3, C97.4).
 */
import {
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  LIST_LIMITS,
  idClassSchema,
  listEmailMatchTypeSchema,
  listItemStatusSchema,
  listKindSchema,
  listMatchMethodSchema,
  listMatchStatusSchema,
  listMatchTierSchema,
  listNotApplicableReasonSchema,
  listProbeSourceSchema,
  listStatusSchema,
  listUnscreenedReasonSchema,
  toListItemResourceType,
  toListResourceType,
  type ListItemResourceType,
  type ListItemStatus,
  type ListKind,
  type ListMatchMethod,
  type ListMatchStatus,
  type ListMatchTier,
  type ListProbeSource,
  type ListResourceType,
  type ListStatus,
  DEFAULT_LIST_PURPOSE,
  listPurposeSchema,
  type ListPurpose,
} from '@openverify/core';
import { countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { blindIndexKeyIdSchema } from './devices.js';
import { idSchema, type IdPrefix } from './ids.js';
import {
  accountIdentifierSchema,
  inquiryIdentifierSchema,
  listIdentifierSchema,
  listItemCreatorIdentifierSchema,
  listItemIdentifierSchema,
  type ListItemCreator,
} from './identifiers.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  resourceSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';

export {
  IMPORTER_LIST_KINDS,
  LIST_EMAIL_MATCH_TYPES,
  LIST_ITEM_STATUSES,
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  LIST_LIMITS,
  LIST_MATCH_CONSTANTS,
  LIST_MATCH_METHODS,
  LIST_MATCH_STATUSES,
  LIST_MATCH_TIERS,
  LIST_NOT_APPLICABLE_REASONS,
  LIST_PROBE_SOURCES,
  LIST_REVIEW_CAUSES,
  LIST_SCREENING_STATUSES,
  LIST_STATUSES,
  LIST_UNSCREENED_REASONS,
  listKindSchema,
  listReviewCauseSchema,
  listScreeningStatusSchema,
  type ListKind,
} from '@openverify/core';

/** Marks a member PII (C97.6): nullable, so a masked or redacted copy still parses. */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().meta({ pii: true });
}

/** The same mark on a required request member. */
function piiBody<Schema extends z.ZodType>(schema: Schema) {
  return schema.meta({ pii: true });
}

const noControls = /^\P{Cc}+$/u;
const text = (max: number) =>
  z.string().min(1).max(max).regex(noControls, 'must not contain control characters');

/** C97.2: a list's name; not PII, and the docs warn against putting personal data in it. */
export const listNameSchema = text(LIST_LIMITS.nameLength);

const fieldKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'must be a key of the inquiry fields')
  .max(64);

const itemRetentionDays = z.int().min(1).max(LIST_LIMITS.itemRetentionDays);

/** C97.2, the members every list has. */
const LIST_ATTRIBUTES = {
  name: listNameSchema,
  status: listStatusSchema,
  'archived-at': timestampSchema.nullable(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  /** Ours: the items that count against the limits. */
  'item-count': z.int().min(0),
  /** Ours: every item write bumps it; a report's provenance names it (C106.2). */
  version: z.int().min(1),
  /** Ours (C98.4): null keeps items until they are removed. */
  'item-retention-days': itemRetentionDays.nullable(),
  /** Ours (C99.5): whether `list-config.screen: all` reads this list. */
  'screen-at-completion': z.boolean(),
  /** Ours (C122.1): an add to a `block` list is an adverse step, gated and recorded (C128). */
  purpose: listPurposeSchema,
};

/** C97.2: the members only one kind has. */
const LIST_KIND_ATTRIBUTES = {
  'browser-fingerprint': {},
  'device-fingerprint': {},
  country: {},
  'email-address': {},
  face: {},
  geolocation: {},
  /** C99.9: opt in to `id_compromised_detection`, the one list a match can fail a check on. */
  'government-id-number': { 'use-for-compromised-ids': z.boolean() },
  /** Ours: which key of the inquiry's `fields` the list compares. */
  field: { 'field-key': fieldKeySchema },
  'ip-address': {},
  name: { 'allow-fuzzy-name-first': z.boolean() },
  'phone-number': { 'default-region': countryCodeSchema.nullable() },
  'selfie-background': {},
  string: { 'case-sensitive': z.boolean() },
} as const satisfies Record<ListKind, z.ZodRawShape>;

function listResource<const Kind extends ListKind>(kind: Kind) {
  return resourceSchema(
    toListResourceType(kind) as `list/${Kind}`,
    'lst',
    z.strictObject({ ...LIST_ATTRIBUTES, ...LIST_KIND_ATTRIBUTES[kind] }),
  );
}

/** Every list resource schema, in `LIST_KINDS` order. */
export const LIST_RESOURCE_SCHEMAS = [
  listResource('browser-fingerprint'),
  listResource('device-fingerprint'),
  listResource('country'),
  listResource('email-address'),
  listResource('face'),
  listResource('geolocation'),
  listResource('government-id-number'),
  listResource('field'),
  listResource('ip-address'),
  listResource('name'),
  listResource('phone-number'),
  listResource('selfie-background'),
  listResource('string'),
] as const;

export const listResourceSchema = z.discriminatedUnion('type', LIST_RESOURCE_SCHEMAS);
export type ListResource = z.infer<typeof listResourceSchema>;

/** The limits a list resource serves (C97.5), in the document's `meta`. */
export const listLimitsMetaSchema = z.strictObject({
  'active-lists-per-environment': z.int().min(1),
  'items-per-list': z.int().min(1),
});

/** C97.5: the limits of `kind`, as the document's `meta` states them. */
export function listLimitsMeta(kind: ListKind): z.infer<typeof listLimitsMetaSchema> {
  return {
    'active-lists-per-environment': LIST_LIMITS.activeListsPerEnvironment,
    'items-per-list': LIST_KIND_REGISTRY[kind].biometric
      ? LIST_LIMITS.itemsPerBiometricList
      : LIST_LIMITS.itemsPerList,
  };
}

export const listResourceDocumentSchema = z.strictObject({
  data: listResourceSchema,
  meta: listLimitsMetaSchema,
});
export type ListDocument = z.infer<typeof listResourceDocumentSchema>;

export const listResourceListDocumentSchema = listDocumentSchema(listResourceSchema);
export type ListResourceListDocument = z.infer<typeof listResourceListDocumentSchema>;

/** `GET /api/v1/lists`: newest first; `filter[type]` is ours. */
export const listListsQuerySchema = listQuerySchema('lst', {
  'filter[status]': filterListSchema(listStatusSchema).optional(),
  'filter[type]': filterListSchema(listKindSchema, LIST_KINDS.length).optional(),
});

const BASE_CREATE = {
  name: listNameSchema,
  'item-retention-days': itemRetentionDays.nullable().optional(),
  'screen-at-completion': z.boolean().optional(),
  /** C122.1: `block` by default, which fails closed. */
  purpose: listPurposeSchema.optional(),
};

/** What only one kind's create body takes, each optional with the default of C97.2. */
const CREATE_ATTRIBUTES = {
  'browser-fingerprint': {},
  'device-fingerprint': {},
  country: {},
  'email-address': {},
  /** C97.2 (P08): required, at most the environment's `face-template-retention-days`. */
  face: { 'item-retention-days': itemRetentionDays },
  geolocation: {},
  'government-id-number': { 'use-for-compromised-ids': z.boolean().optional() },
  field: { 'field-key': fieldKeySchema },
  'ip-address': {},
  name: { 'allow-fuzzy-name-first': z.boolean().optional() },
  'phone-number': { 'default-region': countryCodeSchema.nullable().optional() },
  'selfie-background': { 'item-retention-days': itemRetentionDays },
  string: { 'case-sensitive': z.boolean().optional() },
} as const satisfies Record<ListKind, z.ZodRawShape>;

function createListBody<const Kind extends ListKind>(kind: Kind) {
  return z.strictObject({
    data: z.strictObject({
      type: z.literal(toListResourceType(kind) as `list/${Kind}`).optional(),
      attributes: z.strictObject({ ...BASE_CREATE, ...CREATE_ATTRIBUTES[kind] }),
    }),
  });
}

/** `POST /api/v1/list/<plural>` (`lists:write`), per kind. */
export const LIST_CREATE_BODY_SCHEMAS = Object.freeze({
  'browser-fingerprint': createListBody('browser-fingerprint'),
  'device-fingerprint': createListBody('device-fingerprint'),
  country: createListBody('country'),
  'email-address': createListBody('email-address'),
  face: createListBody('face'),
  geolocation: createListBody('geolocation'),
  'government-id-number': createListBody('government-id-number'),
  field: createListBody('field'),
  'ip-address': createListBody('ip-address'),
  name: createListBody('name'),
  'phone-number': createListBody('phone-number'),
  'selfie-background': createListBody('selfie-background'),
  string: createListBody('string'),
} as const satisfies Record<ListKind, z.ZodType>);

/**
 * `PATCH /api/v1/lists/:id` (ours): the four members C97.1 names. The route refuses a member the
 * list's kind does not have, and `allow-fuzzy-name-first` and `case-sensitive` never change: a
 * list's stored keys depend on them.
 */
export const updateListBodySchema = z.strictObject({
  data: z.strictObject({
    attributes: z
      .strictObject({
        name: listNameSchema.optional(),
        'item-retention-days': itemRetentionDays.nullable().optional(),
        'screen-at-completion': z.boolean().optional(),
        'use-for-compromised-ids': z.boolean().optional(),
        purpose: listPurposeSchema.optional(),
      })
      .refine((attributes) => Object.keys(attributes).length > 0, {
        message: 'names at least one member',
      }),
  }),
});
export type UpdateListBody = z.infer<typeof updateListBodySchema>;

// ---------------------------------------------------------------------------------------------
// Items (C97.1, C97.2)

const fingerprintValue = z
  .string()
  .regex(/^\s*[0-9a-fA-F]{64}\s*$/, 'must be a device resource fingerprint: 64 hex characters');

const ID_NUMBER_MAX_LENGTH = 100;
const NAME_MAX_LENGTH = 300;
const EMAIL_MAX_LENGTH = 254;
const IP_VALUE_MAX_LENGTH = 64;
const PHONE_MAX_LENGTH = 32;
const FIELD_VALUE_MAX_LENGTH = 1024;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const radiusMeters = z.number().min(1).max(LIST_LIMITS.radiusMeters);

const ITEM_ATTRIBUTES = {
  status: listItemStatusSchema,
  'archived-at': timestampSchema.nullable(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  'redacted-at': timestampSchema.nullable(),
  'match-count': z.int().min(0),
};

/** C97.1: the values an item serves, PII except `country-code` and `id-class` (a class of ID). */
const ITEM_KIND_ATTRIBUTES = {
  'browser-fingerprint': {
    value: pii(fingerprintValue),
    /** C94.4 (P09): the blind-index key the value was keyed under. */
    'key-id': blindIndexKeyIdSchema,
  },
  'device-fingerprint': { value: pii(fingerprintValue), 'key-id': blindIndexKeyIdSchema },
  country: { 'country-code': countryCodeSchema.nullable() },
  'email-address': {
    value: pii(z.string().min(1).max(EMAIL_MAX_LENGTH)),
    'match-type': listEmailMatchTypeSchema,
  },
  /** Ours: the model of the sealed template, and the inquiry it came from (C99.7). */
  face: {
    model: z.string().min(1).max(64).nullable(),
    'source-inquiry-id': idSchema('inq').nullable(),
  },
  geolocation: {
    latitude: pii(latitude),
    longitude: pii(longitude),
    'radius-meters': pii(radiusMeters),
  },
  'government-id-number': {
    'id-number': pii(z.string().min(1).max(ID_NUMBER_MAX_LENGTH)),
    /** The C31 class, or `null` for any class. */
    'id-class': idClassSchema.nullable(),
  },
  field: { 'field-value': pii(z.string().min(1).max(FIELD_VALUE_MAX_LENGTH)) },
  /** An address or a CIDR range (public). */
  'ip-address': { value: pii(z.string().min(1).max(IP_VALUE_MAX_LENGTH)) },
  name: {
    'name-first': pii(z.string().min(1).max(NAME_MAX_LENGTH)),
    'name-last': pii(z.string().min(1).max(NAME_MAX_LENGTH)),
  },
  'phone-number': { value: pii(z.string().min(1).max(PHONE_MAX_LENGTH)) },
  'selfie-background': { 'source-inquiry-id': idSchema('inq').nullable() },
  string: { value: pii(z.string().min(1).max(LIST_LIMITS.stringValueLength)) },
} as const satisfies Record<ListKind, z.ZodRawShape>;

/** C97.2: the list an item belongs to, and who created it (`null` once unknown). */
export const listItemRelationshipsSchema = z.strictObject({
  list: z.strictObject({ data: listIdentifierSchema }),
  creator: z.strictObject({ data: listItemCreatorIdentifierSchema.nullable() }),
});

function itemResource<const Kind extends ListKind>(kind: Kind) {
  return resourceWithRelationshipsSchema(
    toListItemResourceType(kind) as `list-item/${Kind}`,
    LIST_KIND_REGISTRY[kind].itemPrefix as IdPrefix,
    z.strictObject({ ...ITEM_ATTRIBUTES, ...ITEM_KIND_ATTRIBUTES[kind] }),
    listItemRelationshipsSchema,
  );
}

/** Every item resource schema, in `LIST_KINDS` order. */
export const LIST_ITEM_RESOURCE_SCHEMAS = [
  itemResource('browser-fingerprint'),
  itemResource('device-fingerprint'),
  itemResource('country'),
  itemResource('email-address'),
  itemResource('face'),
  itemResource('geolocation'),
  itemResource('government-id-number'),
  itemResource('field'),
  itemResource('ip-address'),
  itemResource('name'),
  itemResource('phone-number'),
  itemResource('selfie-background'),
  itemResource('string'),
] as const;

export const listItemResourceSchema = z.discriminatedUnion('type', LIST_ITEM_RESOURCE_SCHEMAS);
export type ListItemResource = z.infer<typeof listItemResourceSchema>;

export const listItemDocumentSchema = singleDocumentSchema(listItemResourceSchema);
export type ListItemDocument = z.infer<typeof listItemDocumentSchema>;
export const listItemListDocumentSchema = listDocumentSchema(listItemResourceSchema);

/**
 * `GET /api/v1/list-items` (ours): the list is required (the route answers 400
 * `filter_required`), newest first; `page[after]` is the last item's id.
 */
export const listListItemsQuerySchema = z.strictObject({
  'filter[list-id]': idSchema('lst').optional(),
  'filter[status]': filterListSchema(listItemStatusSchema).optional(),
  'page[after]': z.string().min(1).max(64).optional(),
  'page[size]': z.coerce.number().int().min(1).max(100).optional(),
});

/** C97.1: what a create body takes per kind, under `data.attributes`, each marked PII. */
const ITEM_CREATE_ATTRIBUTES = {
  'browser-fingerprint': { value: piiBody(fingerprintValue) },
  'device-fingerprint': { value: piiBody(fingerprintValue) },
  country: { 'country-code': countryCodeSchema },
  'email-address': {
    value: piiBody(z.string().min(3).max(EMAIL_MAX_LENGTH)),
    /** The whole address by default. */
    'match-type': listEmailMatchTypeSchema.optional(),
  },
  /** C99.7: added from an inquiry, needing its `consent.biometric-matching`. */
  face: { 'inquiry-id': idSchema('inq') },
  geolocation: {
    latitude: piiBody(latitude),
    longitude: piiBody(longitude),
    'radius-meters': piiBody(radiusMeters),
  },
  'government-id-number': {
    'id-number': piiBody(z.string().min(1).max(ID_NUMBER_MAX_LENGTH)),
    'id-class': idClassSchema.optional(),
  },
  field: { 'field-value': piiBody(z.string().min(1).max(FIELD_VALUE_MAX_LENGTH)) },
  'ip-address': { value: piiBody(z.string().min(1).max(IP_VALUE_MAX_LENGTH)) },
  name: {
    'name-first': piiBody(z.string().min(1).max(NAME_MAX_LENGTH)),
    'name-last': piiBody(z.string().min(1).max(NAME_MAX_LENGTH)),
  },
  'phone-number': { value: piiBody(z.string().min(1).max(PHONE_MAX_LENGTH)) },
  'selfie-background': { 'inquiry-id': idSchema('inq') },
  string: { value: piiBody(z.string().min(1).max(LIST_LIMITS.stringValueLength)) },
} as const satisfies Record<ListKind, z.ZodRawShape>;

function createItemBody<const Kind extends ListKind>(kind: Kind) {
  return z.strictObject({
    data: z.strictObject({
      type: z.literal(toListItemResourceType(kind) as `list-item/${Kind}`).optional(),
      attributes: z.strictObject({ 'list-id': idSchema('lst'), ...ITEM_CREATE_ATTRIBUTES[kind] }),
    }),
  });
}

/** `POST /api/v1/list-item/<plural>` (`lists:write`), per kind. */
export const LIST_ITEM_CREATE_BODY_SCHEMAS = Object.freeze({
  'browser-fingerprint': createItemBody('browser-fingerprint'),
  'device-fingerprint': createItemBody('device-fingerprint'),
  country: createItemBody('country'),
  'email-address': createItemBody('email-address'),
  face: createItemBody('face'),
  geolocation: createItemBody('geolocation'),
  'government-id-number': createItemBody('government-id-number'),
  field: createItemBody('field'),
  'ip-address': createItemBody('ip-address'),
  name: createItemBody('name'),
  'phone-number': createItemBody('phone-number'),
  'selfie-background': createItemBody('selfie-background'),
  string: createItemBody('string'),
} as const satisfies Record<ListKind, z.ZodType>);

// ---------------------------------------------------------------------------------------------
// Matching (C99)

/** C99.1: one list a run could not read, and why; never "no match". */
export const listUnscreenedSchema = z.strictObject({
  'list-id': idSchema('lst'),
  reason: listUnscreenedReasonSchema,
});
export type ListUnscreened = z.infer<typeof listUnscreenedSchema>;

/** C99.1 (H16): a list the subject has no value for: screened, with nothing to compare. */
export const listNotApplicableSchema = z.strictObject({
  'list-id': idSchema('lst'),
  reason: listNotApplicableReasonSchema,
});
export type ListNotApplicable = z.infer<typeof listNotApplicableSchema>;

const scoreSchema = z.number().min(0).max(1);

const MATCH_EVIDENCE = {
  method: listMatchMethodSchema,
  /** C99.1 (H15): the tier of the evidence. */
  tier: listMatchTierSchema,
  /** H only; the score for a fuzzy name (C99.2). */
  confidence: scoreSchema.nullable(),
  /** IP-derived probes are approximate (C93.3). */
  approximate: z.boolean(),
  /** C99.1: a fuzzy, face or background score; `null` for the exact, CIDR and radius methods. */
  score: scoreSchema.nullable(),
  /** C99.2: the haversine distance of a radius match, in whole meters. */
  'distance-meters': z.int().min(0).nullable(),
};

interface MatchEvidence {
  readonly method: ListMatchMethod;
  readonly tier: ListMatchTier;
  readonly confidence: number | null;
  readonly score: number | null;
  readonly 'distance-meters': number | null;
}

/** C99.1 (H15): an H-tier match carries its confidence, and an R-tier one never does. */
const confidenceFitsTier = (match: MatchEvidence) =>
  (match.tier === 'H') === (match.confidence !== null);

const SCORED_METHODS: readonly ListMatchMethod[] = ['fuzzy_name', 'face_cosine', 'background'];

/** C99.1, C99.2: a scored method carries its score, and a radius match its distance. */
const evidenceFitsMethod = (match: MatchEvidence) =>
  SCORED_METHODS.includes(match.method) === (match.score !== null) &&
  (match.method === 'radius') === (match['distance-meters'] !== null);

const CONFIDENCE_RULE = {
  message: 'an H-tier match carries its confidence, and an R-tier match has none (H15)',
  path: ['confidence'],
};
const METHOD_RULE = {
  message: 'a fuzzy, face or background match carries a score, and a radius match its distance',
  path: ['score'],
};

/** C99.4: one on-demand match: which item, never the value compared. */
export const listMatchResultSchema = z
  .strictObject({
    'list-id': idSchema('lst'),
    'list-item': listItemIdentifierSchema,
    'list-version': z.int().min(1),
    source: listProbeSourceSchema,
    ...MATCH_EVIDENCE,
  })
  .refine(confidenceFitsTier, CONFIDENCE_RULE)
  .refine(evidenceFitsMethod, METHOD_RULE);

const probeValue = (max: number) => z.string().min(1).max(max);

/** C99.4: one probe of an on-demand match. */
export const listProbeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('browser-fingerprint'), value: fingerprintValue }),
  z.strictObject({ kind: z.literal('device-fingerprint'), value: fingerprintValue }),
  z.strictObject({ kind: z.literal('country'), 'country-code': countryCodeSchema }),
  z.strictObject({ kind: z.literal('email-address'), value: probeValue(EMAIL_MAX_LENGTH) }),
  z.strictObject({ kind: z.literal('geolocation'), latitude, longitude }),
  z.strictObject({
    kind: z.literal('government-id-number'),
    'id-number': probeValue(ID_NUMBER_MAX_LENGTH),
    'id-class': idClassSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('field'),
    'field-key': fieldKeySchema,
    'field-value': probeValue(FIELD_VALUE_MAX_LENGTH),
  }),
  z.strictObject({ kind: z.literal('ip-address'), value: probeValue(IP_VALUE_MAX_LENGTH) }),
  z.strictObject({
    kind: z.literal('name'),
    'name-first': probeValue(NAME_MAX_LENGTH),
    'name-last': probeValue(NAME_MAX_LENGTH),
  }),
  z.strictObject({ kind: z.literal('phone-number'), value: probeValue(PHONE_MAX_LENGTH) }),
  z.strictObject({ kind: z.literal('string'), value: probeValue(LIST_LIMITS.stringValueLength) }),
]);
export type ListProbe = z.infer<typeof listProbeSchema>;

/**
 * `POST /api/v1/lists/match` (ours; `lists:read` and `pii:view`, P11; policy `lists-match`). The
 * probes are PII, so a stored API log keeps none of them (C107.5). Fuzzy, face and background
 * lists answer as `unscreened` with `method_not_on_demand` (P25). `list-ids` selects the lists;
 * without it, every active list of the probes' kinds.
 */
export const matchListsBodySchema = z.strictObject({
  data: z.strictObject({
    attributes: z.strictObject({
      probes: z.array(listProbeSchema).min(1).max(LIST_LIMITS.matchProbes).meta({ pii: true }),
      'list-ids': z
        .array(idSchema('lst'))
        .min(1)
        .max(LIST_LIMITS.screenedLists)
        .refine(hasDistinctValues, 'must not contain duplicates')
        .optional(),
    }),
  }),
});
export type MatchListsBody = z.infer<typeof matchListsBodySchema>;

/** C99.4 (H02): the answer writes no records, and says what it could not read. */
export const matchListsResponseSchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('list-match-result'),
    attributes: z.strictObject({
      /** PII by name, as a report's `matches` is; it names items, never a value. */
      matches: z.array(listMatchResultSchema).meta({ pii: true }),
      unscreened: z.array(listUnscreenedSchema),
      'not-applicable': z.array(listNotApplicableSchema),
    }),
  }),
});
export type MatchListsResponse = z.infer<typeof matchListsResponseSchema>;

/** C99.3 (V14): a list match resolves through its inquiry for the strict webhook filters. */
export const listMatchRelationshipsSchema = z.strictObject({
  list: z.strictObject({ data: listIdentifierSchema }),
  /** `null` once the item was redacted. */
  'list-item': z.strictObject({ data: listItemIdentifierSchema.nullable() }),
  inquiry: z.strictObject({ data: inquiryIdentifierSchema }),
  account: z.strictObject({ data: accountIdentifierSchema.nullable() }),
});

/**
 * C99.3: `list-match` (`lmt_`, ours). `matched-value` is the value compared, sealed at rest and
 * shown only with `pii:view`; `reason` is the dismissal's free text. A `list-match.created` event
 * carries neither (the event contract refuses them).
 */
export const listMatchAttributesSchema = z
  .strictObject({
    status: listMatchStatusSchema,
    source: listProbeSourceSchema,
    ...MATCH_EVIDENCE,
    'list-version': z.int().min(1),
    'matched-value': pii(z.string().min(1).max(FIELD_VALUE_MAX_LENGTH)),
    'dismissed-at': timestampSchema.nullable(),
    reason: pii(z.string().min(1).max(LIST_LIMITS.dismissReasonLength)),
    'created-at': timestampSchema,
    'redacted-at': timestampSchema.nullable(),
  })
  .refine(confidenceFitsTier, CONFIDENCE_RULE)
  .refine(evidenceFitsMethod, METHOD_RULE)
  .refine((attributes) => attributes.status === 'dismissed' || attributes.reason === null, {
    message: 'only a dismissed match carries a reason',
    path: ['reason'],
  })
  .refine(
    (attributes) => (attributes.status === 'dismissed') === (attributes['dismissed-at'] !== null),
    { message: 'a dismissed match says when', path: ['dismissed-at'] },
  );

export const listMatchResourceSchema = resourceWithRelationshipsSchema(
  'list-match',
  'lmt',
  listMatchAttributesSchema,
  listMatchRelationshipsSchema,
);
export type ListMatchResource = z.infer<typeof listMatchResourceSchema>;

export const listMatchDocumentSchema = singleDocumentSchema(listMatchResourceSchema);
export type ListMatchDocument = z.infer<typeof listMatchDocumentSchema>;
export const listMatchListDocumentSchema = listDocumentSchema(listMatchResourceSchema);

/** `GET /api/v1/list-matches`: newest first. */
export const listListMatchesQuerySchema = listQuerySchema('lmt', {
  'filter[inquiry-id]': filterListSchema(idSchema('inq')).optional(),
  'filter[account-id]': filterListSchema(idSchema('acc')).optional(),
  'filter[list-id]': filterListSchema(idSchema('lst')).optional(),
  'filter[status]': filterListSchema(listMatchStatusSchema).optional(),
});

/** `POST /api/v1/list-matches/:id/dismiss` (`lists:write`), under `data.attributes`. */
export const dismissListMatchBodySchema = z.strictObject({
  data: z.strictObject({
    attributes: z.strictObject({
      reason: piiBody(z.string().min(1).max(LIST_LIMITS.dismissReasonLength)),
    }),
  }),
});
export type DismissListMatchBody = z.infer<typeof dismissListMatchBodySchema>;

// ---------------------------------------------------------------------------------------------
// Template configuration (C99.5)

/** C99.5: `all` (the default), `none`, or up to 50 named lists. */
export const listConfigScreenSchema = z.union([
  z.enum(['all', 'none']),
  z
    .array(idSchema('lst'))
    .max(LIST_LIMITS.screenedLists)
    .refine(hasDistinctValues, 'must not contain duplicates'),
]);

/**
 * C99.5: the `list-config` member of an inquiry template version, pinned per version like
 * `report-config`. Publish refuses a named list of a kind the environment does not collect (422
 * `kind_not_collected`).
 */
export const listConfigSchema = z.strictObject({
  screen: listConfigScreenSchema.optional(),
  /** C99.6 (ours, off by default): only `completed -> needs_review`. */
  'on-list-match': z.enum(['none', 'needs_review']).optional(),
});
export type ListConfig = z.infer<typeof listConfigSchema>;

/** The configuration a version serves, every member resolved. */
export const resolvedListConfigSchema = z.strictObject({
  screen: listConfigScreenSchema,
  'on-list-match': z.enum(['none', 'needs_review']),
});
export type ResolvedListConfig = z.infer<typeof resolvedListConfigSchema>;

/** The defaults of C99.5 applied to a stored configuration. */
export function resolveListConfig(config: ListConfig): ResolvedListConfig {
  return { screen: config.screen ?? 'all', 'on-list-match': config['on-list-match'] ?? 'none' };
}

// ---------------------------------------------------------------------------------------------
// Report provenance (C106.2)

/** C106.2 (a C70.2 amendment): the provenance of one list a custom-list run read. */
export const reportListProvenanceSchema = z.strictObject({
  'list-id': idSchema('lst'),
  version: z.int().min(1),
  /** `LIST_KEYS_VERSION` when the run read the list. */
  'normaliser-version': z.string().min(1).max(200),
  'item-count': z.int().min(0),
  'screened-at': timestampSchema,
});
export type ReportListProvenance = z.infer<typeof reportListProvenanceSchema>;

// ---------------------------------------------------------------------------------------------
// PII (C97.6, C107.5)

function piiMembers(shape: Record<string, z.ZodType>): string[] {
  return Object.entries(shape)
    .filter(([, member]) => (member.meta() as { pii?: unknown } | undefined)?.pii === true)
    .map(([member]) => member);
}

/**
 * C107.5: the PII names of the list resources and request bodies, joined to the masking lists and
 * the API-log set by `foundation-7b`. The collision test keeps every name PII at every resource.
 */
export const PII_LIST_ATTRIBUTES: readonly string[] = Object.freeze([
  ...new Set([
    ...Object.values(ITEM_KIND_ATTRIBUTES).flatMap((shape) => piiMembers(shape)),
    ...Object.values(ITEM_CREATE_ATTRIBUTES).flatMap((shape) => piiMembers(shape)),
    ...piiMembers(matchListsBodySchema.shape.data.shape.attributes.shape),
    ...piiMembers(dismissListMatchBodySchema.shape.data.shape.attributes.shape),
    'matched-value',
    'reason',
    'matches',
  ]),
]);

/**
 * C127.12, outcome 25 (Workflow 8A): what changed a list: its items, one write path each, or the
 * list itself (`archived`, which ends a monitored report's reads of it).
 */
export const LIST_UPDATE_CHANGE_KINDS = [
  'items-added',
  'items-archived',
  'items-rewritten',
  'items-redacted',
  'archived',
] as const;
export const listUpdateChangeKindSchema = z.enum(LIST_UPDATE_CHANGE_KINDS);
export type ListUpdateChangeKind = z.infer<typeof listUpdateChangeKindSchema>;

/** C127.12: `payload.meta` of `list.updated`: counts and the new version, never a value (C107.5). */
export const listUpdatedMetaSchema = z.strictObject({
  'change-kind': listUpdateChangeKindSchema,
  counts: z.strictObject({ 'items-changed': z.int().min(0) }),
  'list-version': z.int().min(1),
});
export type ListUpdatedMeta = z.infer<typeof listUpdatedMetaSchema>;

// ---------------------------------------------------------------------------------------------
// Builders

export interface ListRecord {
  id: string;
  kind: ListKind;
  name: string;
  status: ListStatus;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  version: number;
  itemRetentionDays: number | null;
  screenAtCompletion: boolean;
  /** C122.1: left out, the default, which fails closed. */
  purpose?: ListPurpose;
  /** The kind's own members (C97.2), kebab-case, as stored. */
  attributes: Readonly<Record<string, unknown>>;
}

/**
 * Builds a list resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildListResource(record: ListRecord): ListResource {
  return listResourceSchema.parse({
    type: toListResourceType(record.kind) satisfies ListResourceType,
    id: record.id,
    attributes: {
      name: record.name,
      status: record.status,
      'archived-at': toNullableTimestamp(record.archivedAt),
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'item-count': record.itemCount,
      version: record.version,
      'item-retention-days': record.itemRetentionDays,
      'screen-at-completion': record.screenAtCompletion,
      purpose: record.purpose ?? DEFAULT_LIST_PURPOSE,
      ...record.attributes,
    },
  });
}

export interface ListItemRecord {
  id: string;
  kind: ListKind;
  listId: string;
  status: ListItemStatus;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  redactedAt: Date | null;
  matchCount: number;
  creator: ListItemCreator | null;
  /** The kind's values (C97.1), kebab-case, as the principal may see them. */
  attributes: Readonly<Record<string, unknown>>;
}

/**
 * Builds a list item resource. A redacted item's values are `null`, whatever the record holds.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildListItemResource(record: ListItemRecord): ListItemResource {
  return listItemResourceSchema.parse({
    type: toListItemResourceType(record.kind) satisfies ListItemResourceType,
    id: record.id,
    attributes: {
      status: record.status,
      'archived-at': toNullableTimestamp(record.archivedAt),
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
      'redacted-at': toNullableTimestamp(record.redactedAt),
      'match-count': record.matchCount,
      ...record.attributes,
    },
    relationships: {
      list: { data: { type: toListResourceType(record.kind), id: record.listId } },
      creator: { data: record.creator },
    },
  });
}

export interface ListMatchRecord {
  id: string;
  status: ListMatchStatus;
  source: ListProbeSource;
  method: ListMatchMethod;
  tier: ListMatchTier;
  confidence: number | null;
  approximate: boolean;
  score: number | null;
  distanceMeters: number | null;
  listVersion: number;
  /** `null` when masked or redacted, and always in an event's payload. */
  matchedValue: string | null;
  dismissedAt: Date | null;
  reason: string | null;
  createdAt: Date;
  redactedAt: Date | null;
  listKind: ListKind;
  listId: string;
  listItemId: string | null;
  inquiryId: string;
  accountId: string | null;
}

/**
 * Builds a list match resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildListMatchResource(record: ListMatchRecord): ListMatchResource {
  return listMatchResourceSchema.parse({
    type: 'list-match',
    id: record.id,
    attributes: {
      status: record.status,
      source: record.source,
      method: record.method,
      tier: record.tier,
      confidence: record.confidence,
      approximate: record.approximate,
      score: record.score,
      'distance-meters': record.distanceMeters,
      'list-version': record.listVersion,
      'matched-value': record.matchedValue,
      'dismissed-at': toNullableTimestamp(record.dismissedAt),
      reason: record.reason,
      'created-at': toTimestamp(record.createdAt),
      'redacted-at': toNullableTimestamp(record.redactedAt),
    },
    relationships: {
      list: { data: { type: toListResourceType(record.listKind), id: record.listId } },
      'list-item': {
        data:
          record.listItemId === null
            ? null
            : { type: toListItemResourceType(record.listKind), id: record.listItemId },
      },
      inquiry: { data: { type: 'inquiry', id: record.inquiryId } },
      account: {
        data: record.accountId === null ? null : { type: 'account', id: record.accountId },
      },
    },
  });
}
