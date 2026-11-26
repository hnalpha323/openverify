/**
 * Report resources (plan C69-C75, C79-C82): `report/<type>` with the shared attributes and
 * relationships of C70.2 and each type's results, the create, list, tag, dismiss, review and
 * monitoring bodies, the history (runs and actions), the dashboard documents, and
 * `PII_REPORT_ATTRIBUTES` (C70.3).
 *
 * Honesty (ADR 0005, C69.4) is part of the shape: a report is `errored` exactly when it carries
 * errors, `has-match` reads from its open matches, a type without review is never matched, a
 * field nobody could compute is `null` and named in `unavailable-fields` with its reason, and the
 * lists the business watchlist never searched are `null`, never empty arrays.
 *
 * Every member derived from the subject or from a matched entry is marked `.meta({ pii: true })`:
 * masked for a principal without `pii:view` (the `query` member by member), `null` once redacted.
 */
import {
  LIST_LIMITS,
  MATCH_LEVELS,
  REPORT_ORIGINS,
  REPORT_REGISTRY,
  listMatchMethodSchema,
  listMatchTierSchema,
  listProbeSourceSchema,
  REPORT_TYPES,
  reportActionTypeSchema,
  reportCoverageLimitSchema,
  reportDismissTypeSchema,
  reportErrorCodeSchema,
  reportMatchQualifierSchema,
  reportMatchStatusSchema,
  reportMatchTypeSchema,
  reportPausedReasonSchema,
  reportReviewStatusSchema,
  reportReviewTypeSchema,
  reportRiskLevelSchema,
  reportRunNoteSchema,
  reportRunStatusSchema,
  reportRunTypeSchema,
  reportStatusSchema,
  toReportResourceType,
  ADVERSE_MEDIA_CATEGORIES,
  BUSINESS_ENTITY_KINDS,
  type ReportActionType,
  type ReportCoverageLimit,
  type ReportErrorCode,
  type ReportOrigin,
  type ReportPausedReason,
  type ReportRunNote,
  type ReportRunStatus,
  type ReportRunType,
  type ReportStatus,
  type ReportType,
} from '@openverify/core';
import { countryCodeSchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { emptyActionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import {
  accountIdentifierSchema,
  inquiryIdentifierSchema,
  listItemIdentifierSchema,
  listResourceTypeSchema,
  referenceIdSchema,
  reportIdentifierSchema,
  reportTemplateIdentifierSchema,
  reportTemplateVersionIdentifierSchema,
  transactionIdentifierSchema,
} from './identifiers.js';
import {
  listDocumentSchema,
  pageSizeSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { booleanFilterSchema, filterListSchema, listQuerySchema } from './list-filters.js';
import {
  REPORT_QUERY_SCHEMAS,
  SERVED_REPORT_QUERY_SCHEMAS,
  reportQuerySourceSchema,
  type REPORT_QUERY_SOURCES,
} from './report-queries.js';
import { reportResourceTypeSchema } from './report-types.js';
import { reportTemplateVersionName } from './report-templates.js';
import { reportSourceIdSchema, watchlistSourceIdSchema } from './report-template-config.js';
import {
  listNotApplicableSchema,
  listUnscreenedSchema,
  reportListProvenanceSchema,
  type ReportListProvenance,
} from './lists.js';
import { clientAddressSourceSchema } from './networks.js';
import { signalEvidenceReasonSchema, type SignalNullReason } from './signals.js';
import { tagInputSchema, tagsSchema } from './tags.js';

/** Marks a member PII (C70.3): nullable, so a masked or redacted copy still parses. */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().meta({ pii: true });
}

// ---------------------------------------------------------------------------------------------
// Vocabularies (C69.3, C69.4, C79-C82)

/** Why a field is `null` and listed in `unavailable-fields` (C69.4). */
export const REPORT_UNAVAILABLE_REASONS = [
  'provider_not_configured',
  'not_confirmed',
  'not_linked',
  'line_type_undetermined',
  'unsupported_country',
  'list_not_configured',
  'undetermined',
  'execution_error',
  'no_adapter',
  'no_documented_method',
  // C106.1 (Phase 7, H07, V12): the network reasons, one for each C93 null reason a field of the
  // ip-address report can carry (IP_ADDRESS_REPORT_NULL_CAUSES).
  'list_stale',
  'list_unavailable',
  'ipv6_not_covered',
  'address_not_public',
  'not_in_known_ranges',
  'not_in_provider_data',
  'client_address_untrusted',
] as const;
export const reportUnavailableReasonSchema = z.enum(REPORT_UNAVAILABLE_REASONS);
export type ReportUnavailableReason = z.infer<typeof reportUnavailableReasonSchema>;

/** Statements a result always carries about what it cannot say (C79.2, C80.5, C81.5). */
export const REPORT_NOTICES = [
  'no_ownership_screening',
  'pep_coverage_uneven',
  'media_coverage_limited',
] as const;
export const reportNoticeSchema = z.enum(REPORT_NOTICES);

/** C72.1: `sync` waits for the result, bounded; `async` (the default) answers at once. */
export const REPORT_PROCESSING_MODES = ['async', 'sync'] as const;

/** C72.1, C72.5 (P09): how long a `sync` request waits, and how many may wait per environment. */
export const REPORT_SYNC_LIMITS = Object.freeze({ waitSeconds: 10, maxWaitingPerEnvironment: 20 });

/** C75.2, C75.5: the free-text caps of dismissals and reviews. */
export const REPORT_DISMISS_REASON_MAX_LENGTH = 500;
export const REPORT_REVIEW_COMMENT_MAX_LENGTH = 1000;

/** C79.3: the address formats of the crypto canonicaliser, by family. */
export const CRYPTO_ADDRESS_FORMATS = [
  'evm',
  'bitcoin',
  'cashaddr',
  'base58',
  'raw',
  'unclassified',
] as const;

// ---------------------------------------------------------------------------------------------
// Shared parts (C70.2)

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lower-case SHA-256');
const scoreSchema = z.number().min(0).max(1);
const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const name = z.string().min(1).max(300);
const isoDate = z.iso.date();

/** C69.3: one reason a report or run is `errored`, naming the source it is about if any. */
export const reportErrorSchema = z.strictObject({
  code: reportErrorCodeSchema,
  /** A watchlist source, or the list a custom-list run could not read (C106.2). */
  source: reportSourceIdSchema.optional(),
});

/** C69.4: a field left `null`, and why. */
export const reportUnavailableFieldSchema = z.strictObject({
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  field: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
  reason: reportUnavailableReasonSchema,
});

/** C78.5: how completely a run compared the subject's names; no names or scripts. */
export const reportCoverageSchema = z.strictObject({
  complete: z.boolean(),
  limits: z.array(reportCoverageLimitSchema),
});

/** C69.4, C76.2: one source a run screened, with its provenance. */
export const reportSourceProvenanceSchema = z.strictObject({
  'source-id': watchlistSourceIdSchema,
  /** The `watchlist_syncs` row that applied the data screened. */
  'sync-id': z.string().min(1).max(64),
  'published-at': timestampSchema,
  /** The last successful check (C76.3), which freshness counts from. */
  'checked-at': timestampSchema,
  sha256: sha256Schema,
  /** `import` for data an operator loaded from a file (P08), never cited as the publisher's. */
  origin: z.enum(['publisher', 'import']),
  /** The source's attribution line (C76.7). */
  attribution: z.string().min(1).max(500),
});

/** ADR 0002 §3d: the provider that answered, labelled when it is a sandbox. */
export const reportProviderSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  sandbox: z.boolean(),
});

const runId = idSchema('rpr');
const matchId = idSchema('rpm');
const actorId = z.union([idSchema('usr'), idSchema('key')]);

/**
 * C75, C78.5: one match as the review sees it. The matched names and list values are the
 * subject's and the entry's, so `matches` is PII as a whole.
 */
export const reportMatchSchema = z.strictObject({
  /** The match's `record-token` in a review (C75.5). */
  id: matchId,
  /** The readable entry key, as `dismiss` takes it (C75.2). */
  'entity-id': z.string().min(1).max(300),
  /** `null` for an article (the media types); a list id for a custom-list match (C106.2). */
  'source-id': reportSourceIdSchema.nullable(),
  /** The matched list name or article title. */
  name,
  status: reportMatchStatusSchema,
  'review-status': reportReviewStatusSchema,
  'risk-level': reportRiskLevelSchema.nullable(),
  'notify-on-change': z.boolean(),
  /** C75.8: false for an open match the last run did not find. */
  'present-in-last-run': z.boolean(),
  score: scoreSchema,
  'match-types': z.array(reportMatchTypeSchema),
  qualifiers: z.array(reportMatchQualifierSchema),
  /** The dismissed match this one lapsed from (C75.4). */
  'lapsed-from': matchId.nullable(),
  'delisted-at': timestampSchema.nullable(),
  'reviewed-at': timestampSchema.nullable(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
  'first-run': runId,
  'last-run': runId,
  /** C78.5: how the match was made, from the sealed snapshot. */
  components: z.strictObject({
    'subject-name': name.nullable(),
    'list-name': name.nullable(),
    'name-level': z.enum(MATCH_LEVELS).nullable(),
    methods: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
    preset: z
      .string()
      .regex(/^[a-z]+$/)
      .nullable(),
    'min-score': scoreSchema.nullable(),
  }),
});
export type ReportMatch = z.infer<typeof reportMatchSchema>;

/** C75.2: a dismissed match, with what it matched (the type's entry shape). */
function ignoreListEntrySchema<Entry extends z.ZodType>(entry: Entry) {
  return z.strictObject({
    'match-id': matchId,
    'ignored-at': timestampSchema,
    /** The run that found the match, and when it completed (public `run-history-completed-at`). */
    'run-id': runId.nullable(),
    'run-history-completed-at': timestampSchema.nullable(),
    match: entry,
    /** Who dismissed it: a user or an API key. */
    user: actorId,
    'ignore-reason': z.string().min(1).max(REPORT_DISMISS_REASON_MAX_LENGTH),
  });
}

const birthdateSchema = z.strictObject({
  day: z.int().min(1).max(31).nullable(),
  month: z.int().min(1).max(12).nullable(),
  year: z.int().min(1).max(9999).nullable(),
  granularity: z.enum(['day', 'month', 'year']),
});

/** The `has-match` rule (C70.2): some match is `open`. */
function hasMatchAgrees(value: unknown): boolean {
  const attributes = value as {
    readonly 'has-match': boolean;
    readonly matches?: readonly { readonly status: string }[] | null;
  };
  const matches = attributes.matches;
  return (
    matches === null ||
    matches === undefined ||
    attributes['has-match'] === matches.some((match) => match.status === 'open')
  );
}

/** C69.3: `errored` exactly when the report carries errors. */
function errorsAgree(value: unknown): boolean {
  const attributes = value as { readonly status: string; readonly errors: readonly unknown[] };
  return (attributes.status === 'errored') === attributes.errors.length > 0;
}

/** The attributes every report carries (C70.2), with the type's `query`. */
/**
 * C70.2, C166.5: how a report was created, as the resource says it. Since Workflow 9B Stage 1b (X)
 * core's `REPORT_ORIGINS` holds `bulk` itself (contracts B34), so this is that list, kept by name.
 */
export const REPORT_RESOURCE_ORIGINS = REPORT_ORIGINS;
export type ReportResourceOrigin = (typeof REPORT_RESOURCE_ORIGINS)[number];

function sharedAttributes(type: ReportType) {
  return {
    status: reportStatusSchema,
    'created-at': timestampSchema,
    'completed-at': timestampSchema.nullable(),
    'redacted-at': timestampSchema.nullable(),
    /** `v<N>` of the pinned template version (C71.1). */
    'report-template-version-name': z.string().regex(/^v[1-9][0-9]*$/),
    /** Some match is open; "no match" only beside `ready` (C69.4). */
    'has-match': REPORT_REGISTRY[type].review === 'matches' ? z.boolean() : z.literal(false),
    /** Ours (M7): more than one completed run. */
    'is-continuous': z.boolean(),
    /** Ours (M7): a next run is scheduled and not paused. */
    'is-recurring': z.boolean(),
    tags: tagsSchema,
    /** The inputs as sent, masked member by member (C70.3). */
    query: pii(SERVED_REPORT_QUERY_SCHEMAS[type]),
    /**
     * C70.2; C166.5 (Workflow 9B): `bulk` is a report a bulk job created. Core's `REPORT_ORIGINS`
     * gains it with the `report_origin` enum value in migration 0031 (`foundation-9b`).
     */
    origin: z.enum(REPORT_RESOURCE_ORIGINS),
    /** C173.1 (Workflow 9B; K15): the latest run's note codes (Phase 6 C74). Left out before. */
    'latest-run-notes': z.array(reportRunNoteSchema).max(20).optional(),
    errors: z.array(reportErrorSchema),
    'unavailable-fields': z.array(reportUnavailableFieldSchema),
    /** C78.5: `null` for the types that match no names. */
    coverage: reportCoverageSchema.nullable(),
    'next-run-at': timestampSchema.nullable(),
    'paused-at': timestampSchema.nullable(),
    'paused-reason': reportPausedReasonSchema.nullable(),
    sources: z.array(reportSourceProvenanceSchema),
    /** C84.2: where each query field came from. */
    'query-sources': z.record(z.string(), reportQuerySourceSchema),
    'matcher-version': z.string().min(1).max(200).nullable(),
    provider: reportProviderSchema.nullable(),
    /** ADR 0002 §3f: the preset and thresholds applied. */
    thresholds: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
    notices: z.array(reportNoticeSchema),
  };
}

/** C70.2: the public relationships plus the pinned version (ours). */
export const reportRelationshipsSchema = z.strictObject({
  inquiry: z.strictObject({ data: inquiryIdentifierSchema.nullable() }),
  /** The home account. */
  account: z.strictObject({ data: accountIdentifierSchema.nullable() }),
  /** Every linked account (expanding needs `accounts:read`). */
  accounts: z.strictObject({ data: z.array(accountIdentifierSchema) }),
  'report-template': z.strictObject({ data: reportTemplateIdentifierSchema }),
  'report-template-version': z.strictObject({ data: reportTemplateVersionIdentifierSchema }),
  /** C105.7: the latest transaction this report was attached to by `add-objects`, else `null`. */
  transaction: z.strictObject({ data: transactionIdentifierSchema.nullable() }),
});

function reportResource<const Type extends ReportType, const Shape extends z.ZodRawShape>(
  type: Type,
  shape: Shape,
) {
  return resourceWithRelationshipsSchema(
    toReportResourceType(type) as `report/${Type}`,
    'rep',
    z
      .strictObject({ ...sharedAttributes(type), ...shape })
      .refine(errorsAgree, {
        message: 'a report is errored exactly when it carries errors',
        path: ['errors'],
      })
      .refine(hasMatchAgrees, {
        message: 'has-match says whether some match is open',
        path: ['has-match'],
      }),
    reportRelationshipsSchema,
  );
}

// ---------------------------------------------------------------------------------------------
// Sanctions (C79)

/**
 * Owner decision 9 after 6B: an OFAC entry's lists other than the SDN List (a sectoral or other
 * non-blocking listing), with the programme tied to each or `null`. Absent, never empty, when the
 * entry is on none, so a listing there is never read as an SDN-level block.
 */
const listMembershipsSchema = z
  .array(
    z.strictObject({
      list: z.string().min(1).max(200),
      program: z.string().min(1).max(200).nullable(),
    }),
  )
  .min(1)
  .max(100);

const listEntryBase = {
  'entity-id': z.string().min(1).max(300),
  'match-id': matchId,
  name,
  /** `weak_aka` only with `screen-weak-aliases` (C78.4). */
  'alias-type': z.enum(['primary_name', 'aka', 'weak_aka']),
  'match-types': z.array(reportMatchTypeSchema),
  'list-memberships': listMembershipsSchema.optional(),
};

const personEntitySchema = z.strictObject({
  ...listEntryBase,
  birthdates: z.array(birthdateSchema),
  countries: z.array(countryCodeSchema),
  programs: z.array(z.string().min(1).max(200)),
  score: scoreSchema,
});

const identifierSchema = z.strictObject({
  kind: z.enum([
    'passport',
    'national_id',
    'tax_id',
    'registration_number',
    'lei',
    'swift_bic',
    'imo',
    'mmsi',
    'aircraft_serial',
    'aircraft_tail',
    'website',
    'email',
    'other',
  ]),
  value: z.string().min(1).max(100),
  country: countryCodeSchema.nullable(),
});

const businessEntitySchema = z.strictObject({
  ...listEntryBase,
  kind: z.enum(BUSINESS_ENTITY_KINDS),
  countries: z.array(countryCodeSchema),
  programs: z.array(z.string().min(1).max(200)),
  identifiers: z.array(identifierSchema),
  score: scoreSchema,
});

/** A list a run matched, in the public shape plus our `source-id` (T2). */
function matchedListSchema<Entity extends z.ZodType>(entity: Entity) {
  return z.strictObject({
    'source-id': watchlistSourceIdSchema,
    name: z.string().min(1).max(200),
    url: httpsUrl.nullable(),
    'list-type': z.enum(['sanction', 'pep', 'warning']),
    'list-types': z.array(z.enum(['sanction', 'pep', 'warning'])),
    slug: z.string().min(1).max(200),
    /** The publisher's country or union code (`US`, `EU`, `GB`, `UN`; `ZZ` for the sandbox). */
    'flag-code': z.string().regex(/^[A-Z]{2}$/),
    'match-types': z.array(reportMatchTypeSchema),
    entities: z.array(entity),
  });
}

const personMatchedList = matchedListSchema(personEntitySchema);
const businessMatchedList = matchedListSchema(businessEntitySchema);

const REVIEW = (entry: z.ZodType) => ({
  'ignore-list': pii(z.array(ignoreListEntrySchema(entry))),
  matches: pii(z.array(reportMatchSchema)),
});

export const watchlistReportResourceSchema = reportResource('watchlist', {
  'matched-lists': pii(z.array(personMatchedList)),
  ...REVIEW(personMatchedList),
});

const listReference = z.strictObject({
  name: z.string().min(1).max(200),
  url: httpsUrl.nullable(),
});

export const businessWatchlistReportResourceSchema = reportResource('business-watchlist', {
  'matched-lists': pii(z.array(businessMatchedList)),
  /** The public sanctions list of the matches. */
  'sanction-list': pii(z.array(listReference)),
  /** Not built in Phase 6 (decision 18): `null`, with `list_not_configured`, never `[]`. */
  'fitness-probity-list': pii(z.null()),
  'warning-list': pii(z.null()),
  /** The sources searched. */
  'lists-searched': z.array(watchlistSourceIdSchema),
  ...REVIEW(businessMatchedList),
});

const cryptoEntitySchema = z.strictObject({
  ...listEntryBase,
  birthdates: z.array(birthdateSchema),
  'crypto-addresses': z.array(
    z.strictObject({
      /** The list's ticker, as metadata (C79.3). */
      type: z.string().min(1).max(20),
      address: z.string().min(1).max(256),
      /** CAIP-2, or `unknown` when the format names no chain. */
      chain: z.string().min(1).max(64),
    }),
  ),
});

const cryptoResultSchema = matchedListSchema(cryptoEntitySchema).omit({
  'list-types': true,
  'match-types': true,
});

export const cryptoAddressWatchlistReportResourceSchema = reportResource(
  'crypto-address-watchlist',
  {
    result: pii(z.array(cryptoResultSchema)),
    /** C79.3: how the address was canonicalised. */
    'crypto-address-format': z.enum(CRYPTO_ADDRESS_FORMATS).nullable(),
    /** C83: the `cryptoExposure` provider's block, `null` without one. */
    exposure: pii(
      z.strictObject({
        'direct-sanctioned': z.boolean(),
        exposures: z.array(
          z.strictObject({
            category: z.string().min(1).max(100),
            share: scoreSchema,
            hops: z.int().min(0).max(100),
          }),
        ),
        'risk-score': scoreSchema.nullable(),
      }),
    ),
    ...REVIEW(cryptoResultSchema),
  },
);

// ---------------------------------------------------------------------------------------------
// Politically exposed persons (C80)

/** A Wikidata QID, or a fictional `Q-test-…` id of the synthetic lists (C89.1). */
const qidSchema = z.string().regex(/^Q(?:[1-9][0-9]{0,11}|-test-[a-z0-9-]{1,32})$/);

const pepEntitySchema = z
  .strictObject({
    'entity-id': z.string().min(1).max(300),
    'match-id': matchId,
    name,
    birthdates: z.array(birthdateSchema),
    /** Always empty: deceased persons are excluded (C80.4). */
    'death-dates': z.array(birthdateSchema).max(0),
    country: countryCodeSchema.nullable(),
    sex: z.enum(['female', 'male']).nullable(),
    'match-types': z.array(reportMatchTypeSchema),
    'pep-type': z.enum(['pep', 'relative']),
    score: scoreSchema,
    positions: z.array(
      z.strictObject({
        position: z.string().min(1).max(300),
        'pep-class': z.int().min(1).max(4).nullable(),
        country: countryCodeSchema.nullable(),
        start: isoDate.nullable(),
        end: z.union([isoDate, z.literal('unknown')]).nullable(),
        'in-office': z.enum(['yes', 'no', 'unknown']),
        'source-key': qidSchema,
      }),
    ),
    associates: z.array(
      z.strictObject({
        name,
        relationship: z.enum(['spouse', 'child', 'parent', 'sibling']),
      }),
    ),
    /** QID → its page. */
    sources: z.record(qidSchema, httpsUrl),
    /**
     * Owner decision 9 after 6B: on a relative, the class of the PEP it relates to (the most senior
     * when several), as the PEP build derived it; absent on a holder.
     */
    'relative-of-class': z.int().min(1).max(4).optional(),
  })
  .refine(
    (entity) => entity['relative-of-class'] === undefined || entity['pep-type'] === 'relative',
    {
      message: 'only a relative carries the class of the PEP it relates to',
      path: ['relative-of-class'],
    },
  );

export const politicallyExposedPersonReportResourceSchema = reportResource(
  'politically-exposed-person',
  {
    result: pii(z.array(pepEntitySchema)),
    ...REVIEW(pepEntitySchema),
  },
);

// ---------------------------------------------------------------------------------------------
// Adverse media (C81)

const articleSchema = z.strictObject({
  /** The article key, as `dismiss` takes it with `dismiss-type: media`. */
  'entity-id': z.string().min(1).max(300),
  'match-id': matchId,
  url: z.url({ protocol: /^https?$/ }).max(2048),
  domain: z.string().min(1).max(253),
  /** When GDELT saw it; GDELT returns no publication date (H13). */
  'seen-date': timestampSchema,
  language: z.string().regex(/^[a-z]{2,3}$/),
  'source-country': countryCodeSchema.nullable(),
  /** Capped at 200 characters, shown only as link text (decision 8). */
  title: z.string().min(1).max(200),
  categories: z.array(z.enum(ADVERSE_MEDIA_CATEGORIES)).min(1),
  'match-types': z.array(reportMatchTypeSchema),
  score: scoreSchema,
  /** H-tier, capped at 0.6 (C81.3). */
  confidence: z.number().min(0).max(0.6),
});

const MEDIA_ATTRIBUTES = {
  articles: pii(z.array(articleSchema)),
  /** The provider's citation and link (GDELT's required one), or the sandbox's note. */
  citation: z.string().min(1).max(500).nullable(),
  ...REVIEW(articleSchema),
};

export const adverseMediaReportResourceSchema = reportResource('adverse-media', MEDIA_ATTRIBUTES);
export const businessAdverseMediaReportResourceSchema = reportResource(
  'business-adverse-media',
  MEDIA_ATTRIBUTES,
);

// ---------------------------------------------------------------------------------------------
// Email, phone and address (C82)

const nullableBoolean = z.boolean().nullable();
const unsupported = z.null();

/** C82.1: why the email band is what it is. */
export const EMAIL_REPUTATION_REASONS = [
  'syntax_invalid',
  'domain_not_found',
  'domain_rejects_mail',
  'no_mail_server',
  'disposable_domain',
  'domain_recently_registered',
  'mx_of_disposable_service',
  'domain_typo_of_major_provider',
  'role_account',
  'young_domain',
  'recent_breach',
  'accepts_mail',
  'privacy_relay',
  'execution_error',
] as const;

export const emailAddressReportResourceSchema = reportResource('email-address', {
  /** PII: a vanity domain names its owner (P15); the console reads `email-domain-kind`. */
  'email-domain': pii(z.string().min(1).max(253)),
  'email-domain-kind': z.enum(['free_mail', 'relay', 'disposable', 'custom']).nullable(),
  'email-domain-exists': nullableBoolean,
  'email-is-valid-mx': nullableBoolean,
  'email-is-disposable': nullableBoolean,
  'email-domain-age-days': z.int().min(0).nullable(),
  'email-is-free-provider': nullableBoolean,
  'email-is-relay': nullableBoolean,
  'email-is-role-account': nullableBoolean,
  'email-mx-provider': z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .max(64)
    .nullable(),
  /** RFC 7208's `all` qualifier, informational only. */
  'email-spf-policy': z
    .enum(['pass', 'neutral', 'softfail', 'fail', 'no_all', 'no_record', 'invalid'])
    .nullable(),
  /** RFC 9989's policy, informational only. */
  'email-dmarc-policy': z.enum(['none', 'quarantine', 'reject', 'no_record', 'invalid']).nullable(),
  /** Only for a completion report whose inquiry confirmed this address by OTP (P05). */
  'email-is-deliverable': nullableBoolean,
  'email-domain-typo-suggestion': pii(z.string().min(1).max(253)),
  /** H-tier (beta): the worst band reached; `null` for a relay or a blocking DNS error. */
  'email-reputation': z.enum(['high', 'medium', 'low']).nullable(),
  /** True exactly when the band is `low`; `null` with a `null` band. */
  'email-is-suspicious': nullableBoolean,
  'email-reputation-confidence': scoreSchema.nullable(),
  'email-reputation-reasons': z.array(z.enum(EMAIL_REPUTATION_REASONS)),
  'email-credentials-leaked-recent': nullableBoolean,
  'email-breach-count': z.int().min(0).nullable(),
  /** No adapter in Phase 6: always `null`, in `unavailable-fields`. */
  'email-is-spam': unsupported,
  'email-malicious-activity-detected-recent': unsupported,
  'email-estimated-age-days': unsupported,
  /** No documented method: always `null`. */
  'age-estimated-13-plus': unsupported,
  'age-estimated-16-plus': unsupported,
  'age-estimated-18-plus': unsupported,
});

/** C82.2: the public line types; `OTHER`, `PREPAID` and `PAYPHONE` only from a provider. */
export const PHONE_TYPES = [
  'FIXED_LINE',
  'MOBILE',
  'PREPAID',
  'TOLL_FREE',
  'VOIP',
  'PAGER',
  'PAYPHONE',
  'INVALID',
  'RESTRICTED_PREMIUM',
  'PERSONAL',
  'VOICEMAIL',
  'OTHER',
] as const;

/** C82.2: the numbering plan's types, as libphonenumber names them. */
export const PHONE_NUMBERING_PLAN_TYPES = [
  'FIXED_LINE',
  'MOBILE',
  'FIXED_LINE_OR_MOBILE',
  'TOLL_FREE',
  'PREMIUM_RATE',
  'SHARED_COST',
  'VOIP',
  'PERSONAL_NUMBER',
  'PAGER',
  'UAN',
  'VOICEMAIL',
] as const;

/**
 * C82.2: why the phone risk level is what it is. `prepaid`, `payphone` and `other_line_type` come
 * only from a provider's line type (owner decision 14); `other_line_type` is stated and adds no
 * level.
 */
export const PHONE_RISK_REASONS = [
  'invalid_number',
  'high_risk_type',
  'voip',
  'prepaid',
  'payphone',
  'personal_number',
  'low_risk_type',
  'line_type_undetermined',
  'other_line_type',
  'sim_swap_24h',
  'sim_swap_7d',
  'ported_30d',
] as const;

export const phoneNumberReportResourceSchema = reportResource('phone-number', {
  'phone-country-code': countryCodeSchema.nullable(),
  'phone-is-possible': nullableBoolean,
  'phone-is-valid': nullableBoolean,
  /** `null` when the plan cannot tell (FIXED_LINE_OR_MOBILE) and no provider says (H08). */
  'phone-type': z.enum(PHONE_TYPES).nullable(),
  'phone-type-numbering-plan': z.enum(PHONE_NUMBERING_PLAN_TYPES).nullable(),
  'phone-network-line-type': z
    .string()
    .regex(/^[a-zA-Z]+$/)
    .max(32)
    .nullable(),
  'phone-carrier': z.string().min(1).max(200).nullable(),
  'phone-risk-level': z.enum(['low', 'medium-low', 'medium', 'medium-high', 'high']).nullable(),
  'phone-risk-recommendation': z.enum(['allow', 'flag', 'block']).nullable(),
  'phone-risk-confidence': scoreSchema.nullable(),
  'phone-risk-reasons': z.array(z.enum(PHONE_RISK_REASONS)),
  /** Never synthesised (decision 20). */
  'phone-risk-score': unsupported,
  'phone-risk-sim-swap': z.enum(['very-low', 'low', 'medium', 'high', 'N/A']).nullable(),
  'phone-ported-recently': nullableBoolean,
  /** Only for a completion report whose inquiry confirmed this number by OTP (P05). */
  'phone-reachable-at-otp': nullableBoolean,
});

const resolvedText = (max: number) => pii(z.string().min(1).max(max));

export const addressLookupReportResourceSchema = reportResource('address-lookup', {
  'resolved-street-1': resolvedText(200),
  'resolved-street-2': resolvedText(200),
  'resolved-city': resolvedText(100),
  'resolved-subdivision': resolvedText(100),
  'resolved-postal-code': resolvedText(20),
  'resolved-country-code': pii(countryCodeSchema),
  'postal-code-valid': nullableBoolean,
  'zip-state-consistent': nullableBoolean,
  'address-designators': z.array(z.enum(['po_box', 'military', 'pmb', 'general_delivery'])),
  /** H, ours: a CMRA keyword hint, never in a USPS-derived field (H08). */
  'cmra-hint': nullableBoolean,
  deliverability: z
    .enum([
      'confirmed',
      'confirmed_missing_secondary',
      'confirmed_secondary_invalid',
      'not_confirmed',
      'unknown',
    ])
    .nullable(),
  'metadata-record-type': z.string().min(1).max(8).nullable(),
  'metadata-zip-type': z.enum(['unique', 'military', 'po_box', 'standard']).nullable(),
  'metadata-county-fips': z
    .string()
    .regex(/^[0-9]{5}$/)
    .nullable(),
  'metadata-county-name': z.string().min(1).max(100).nullable(),
  'metadata-carrier-route': z.string().min(1).max(8).nullable(),
  'metadata-latitude': pii(z.number().min(-90).max(90)),
  'metadata-longitude': pii(z.number().min(-180).max(180)),
  'metadata-precision': z.string().min(1).max(32).nullable(),
  'metadata-residential-delivery-indicator': z.enum(['residential', 'commercial']).nullable(),
  'analysis-dpv-match-code': z.string().min(1).max(4).nullable(),
  'analysis-dpv-cmra': nullableBoolean,
  'analysis-dpv-vacant': nullableBoolean,
  'analysis-active': nullableBoolean,
  'analysis-lacs-link-code': z.string().min(1).max(8).nullable(),
  'analysis-lacs-link-indicator': z.string().min(1).max(8).nullable(),
  'analysis-suite-link-match': nullableBoolean,
  'analysis-dpv-footnotes': z.string().min(1).max(64).nullable(),
  'analysis-footnotes': z.string().min(1).max(64).nullable(),
});

// ---------------------------------------------------------------------------------------------
// The network facts of one address (C106.1, Phase 7)

/**
 * C106.1 (V12): the C93 null reasons each result field can carry, frozen with a golden test. Each
 * maps to the report reason of the same name ({@link ipAddressUnavailableReason}).
 */
export const IP_ADDRESS_REPORT_NULL_CAUSES = Object.freeze({
  'tor-exit-node': [
    'ipv6_not_covered',
    'address_not_public',
    'client_address_untrusted',
    'list_stale',
    'list_unavailable',
  ],
  'datacenter-ip': [
    'not_in_known_ranges',
    'address_not_public',
    'client_address_untrusted',
    'list_stale',
    'list_unavailable',
  ],
  'service-type': [
    'not_in_known_ranges',
    'address_not_public',
    'client_address_untrusted',
    'list_stale',
    'list_unavailable',
  ],
  'vpn-detected': [
    'not_in_known_ranges',
    'address_not_public',
    'client_address_untrusted',
    'list_stale',
    'list_unavailable',
  ],
  'proxy-detected': [
    'provider_not_configured',
    'not_in_provider_data',
    'address_not_public',
    'client_address_untrusted',
  ],
  isp: ['address_not_public', 'client_address_untrusted', 'list_stale', 'list_unavailable'],
  'country-code': [
    'address_not_public',
    'client_address_untrusted',
    'list_stale',
    'list_unavailable',
  ],
  'country-name': [
    'address_not_public',
    'client_address_untrusted',
    'list_stale',
    'list_unavailable',
  ],
  city: ['address_not_public', 'client_address_untrusted', 'list_stale', 'list_unavailable'],
  region: ['address_not_public', 'client_address_untrusted', 'list_stale', 'list_unavailable'],
  latitude: ['address_not_public', 'client_address_untrusted', 'list_stale', 'list_unavailable'],
  longitude: ['address_not_public', 'client_address_untrusted', 'list_stale', 'list_unavailable'],
} as const satisfies Readonly<Record<string, readonly SignalNullReason[]>>);

const IP_ADDRESS_CAUSES: ReadonlySet<string> = new Set(
  Object.values(IP_ADDRESS_REPORT_NULL_CAUSES).flat(),
);

/**
 * C106.1 (V12): the report reason of a C93 null reason a field carries.
 * @throws {RangeError} for a reason no field of the report can carry.
 */
export function ipAddressUnavailableReason(reason: string): ReportUnavailableReason {
  if (!IP_ADDRESS_CAUSES.has(reason)) {
    throw new RangeError(`no ip-address field is null for ${reason}`);
  }
  return reportUnavailableReasonSchema.parse(reason);
}

/** C106.1: the tier of one result field's evidence, with its confidence (H only) and reasons. */
const ipFieldDetailSchema = z.union([
  z.strictObject({
    tier: z.literal('H'),
    confidence: scoreSchema.nullable(),
    reasons: z.array(signalEvidenceReasonSchema),
  }),
  z.strictObject({
    tier: z.enum(['R', 'A']),
    reasons: z.array(signalEvidenceReasonSchema),
  }),
]);

type IpAddressAttributes = Readonly<Record<string, unknown>> & {
  readonly status: string;
  readonly query: Readonly<Record<string, unknown>> | null;
  readonly 'unavailable-fields': readonly { field: string }[];
};

/** C106.1 (H01): CLEARED only for an IPv4 address; no published exit list has IPv6 exits. */
function clearedOnlyForIpv4(value: unknown): boolean {
  const attributes = value as IpAddressAttributes;
  const address = attributes.query?.['ip-address'];
  return (
    attributes['tor-exit-node'] !== 'CLEARED' ||
    typeof address !== 'string' ||
    !address.includes(':')
  );
}

/** C106.1 (H01): a run that ended lists a null tor-exit-node in unavailable-fields. */
function nullTorListed(value: unknown): boolean {
  const attributes = value as IpAddressAttributes;
  return (
    attributes.status === 'pending' ||
    attributes['tor-exit-node'] !== null ||
    attributes['unavailable-fields'].some(({ field }) => field === 'tor-exit-node')
  );
}

/** Decision 42: `flagged` is exactly Tor, VPN, proxy or a provider-range datacenter. */
function flaggedAgrees(value: unknown): boolean {
  const attributes = value as IpAddressAttributes;
  const any =
    attributes['tor-exit-node'] === 'MATCHED' ||
    attributes['vpn-detected'] === true ||
    attributes['proxy-detected'] === true ||
    attributes['datacenter-ip'] === true;
  return attributes.flagged === any;
}

/**
 * C106.1: `report/ip-address`, review model `none`. The public result attributes, then ours:
 * `flagged` (decision 42), `hosting-asn` (H13: a hosting-ASN hit never reaches the public
 * datacenter fields), `client-address-source` for a completion report's session address, and
 * `field-details` with each field's tier, confidence (H only) and reasons. The sources read, with
 * each sync's id, publication time and SHA-256, are the shared `sources`.
 */
export const ipAddressReportResourceSchema = resourceWithRelationshipsSchema(
  'report/ip-address',
  'rep',
  z
    .strictObject({
      ...sharedAttributes('ip-address'),
      /** `DATACENTER` from provider ranges only, or `null`. */
      'service-type': z.literal('DATACENTER').nullable(),
      /** `true` from provider ranges only, or `null` (H13). */
      'datacenter-ip': z.literal(true).nullable(),
      'vpn-detected': z.literal(true).nullable(),
      /** `false` only when a bound adapter's file records a negative (C93.5). */
      'proxy-detected': z.boolean().nullable(),
      /** `CLEARED` only for a public IPv4 address checked against a fresh exit list. */
      'tor-exit-node': z.enum(['MATCHED', 'CLEARED']).nullable(),
      isp: z.string().min(1).max(200).nullable(),
      /** No permissive source answers it. */
      'mobile-ip': unsupported,
      'country-code': countryCodeSchema.nullable(),
      'country-name': z.string().min(1).max(200).nullable(),
      city: pii(z.string().min(1).max(200)),
      region: pii(z.string().min(1).max(200)),
      latitude: pii(z.number().min(-90).max(90)),
      longitude: pii(z.number().min(-180).max(180)),
      /** The code of the first error, as the public attribute names one; `errors` has them all. */
      error: reportErrorCodeSchema.nullable(),
      flagged: z.boolean(),
      'hosting-asn': z.literal(true).nullable(),
      'client-address-source': clientAddressSourceSchema.nullable(),
      'field-details': z.partialRecord(
        z.enum(['tor-exit-node', 'datacenter-ip', 'vpn-detected', 'proxy-detected', 'hosting-asn']),
        ipFieldDetailSchema,
      ),
    })
    .refine(errorsAgree, {
      message: 'a report is errored exactly when it carries errors',
      path: ['errors'],
    })
    .refine(hasMatchAgrees, {
      message: 'has-match says whether some match is open',
      path: ['has-match'],
    })
    .refine(clearedOnlyForIpv4, {
      message: 'CLEARED only for an IPv4 address: no exit list has IPv6 exits',
      path: ['tor-exit-node'],
    })
    .refine(nullTorListed, {
      message: 'a null tor-exit-node is listed in unavailable-fields with its reason',
      path: ['unavailable-fields'],
    })
    .refine(flaggedAgrees, {
      message: 'flagged is exactly Tor, VPN, proxy or a provider-range datacenter',
      path: ['flagged'],
    }),
  reportRelationshipsSchema,
);

// ---------------------------------------------------------------------------------------------
// The operator's lists (C106.2, Phase 7)

/** C106.2: one item a run matched, with the C99.1 evidence. */
const customListMatchedItemSchema = z.strictObject({
  'entity-id': z.string().min(1).max(300),
  'match-id': matchId,
  'list-item': listItemIdentifierSchema,
  /** Which part of the query matched. */
  source: listProbeSourceSchema,
  method: listMatchMethodSchema,
  /** C99.1 (H15): the tier of this match's evidence. */
  tier: listMatchTierSchema,
  /** H only. */
  confidence: scoreSchema.nullable(),
  approximate: z.boolean(),
  /** A fuzzy, face or background score. */
  score: scoreSchema.nullable(),
  'distance-meters': z.int().min(0).nullable(),
  'matched-value': z.string().min(1).max(1024).nullable(),
});

/** C106.2: a list a run matched. List names are not PII, but the items it matched are. */
const customListMatchedListSchema = z.strictObject({
  'list-id': idSchema('lst'),
  'list-type': listResourceTypeSchema,
  name: z.string().min(1).max(LIST_LIMITS.nameLength),
  version: z.int().min(1),
  items: z.array(customListMatchedItemSchema),
});

type CustomListAttributes = Readonly<Record<string, unknown>> & {
  readonly status: string;
  readonly errors: readonly { readonly code: string; readonly source?: string }[];
  readonly unscreened: readonly { readonly 'list-id': string }[];
};

/** C106.2 (H08, ADR 0005): a run with an unscreened list is errored, whatever it found. */
function neverReadyUnscreened(value: unknown): boolean {
  const attributes = value as CustomListAttributes;
  return attributes.status !== 'ready' || attributes.unscreened.length === 0;
}

/** C106.2: each unscreened list is named by a `list_unavailable` error. */
function unscreenedListsNamed(value: unknown): boolean {
  const attributes = value as CustomListAttributes;
  return attributes.unscreened.every(({ 'list-id': listId }) =>
    attributes.errors.some(({ code, source }) => code === 'list_unavailable' && source === listId),
  );
}

/**
 * C106.2: `report/custom-list`, reviewed match by match, keyed by the list item. `sources` holds
 * list provenance, never a sync. `unscreened` lists what the run could not read, which ends it
 * `errored` with `list_unavailable` naming each list, keeping the matches it found; `not-applicable`
 * lists what the subject had no value for, which is no error (H16).
 */
export const customListReportResourceSchema = resourceWithRelationshipsSchema(
  'report/custom-list',
  'rep',
  z
    .strictObject({
      ...sharedAttributes('custom-list'),
      sources: z.array(reportListProvenanceSchema),
      'matched-lists': pii(z.array(customListMatchedListSchema)),
      'lists-searched': z.array(idSchema('lst')),
      unscreened: z.array(listUnscreenedSchema),
      'not-applicable': z.array(listNotApplicableSchema),
      ...REVIEW(customListMatchedListSchema),
    })
    .refine(errorsAgree, {
      message: 'a report is errored exactly when it carries errors',
      path: ['errors'],
    })
    .refine(hasMatchAgrees, {
      message: 'has-match says whether some match is open',
      path: ['has-match'],
    })
    .refine(neverReadyUnscreened, {
      message: 'a run with an unscreened list is errored, never ready (ADR 0005)',
      path: ['unscreened'],
    })
    .refine(unscreenedListsNamed, {
      message: 'every unscreened list is named by a list_unavailable error',
      path: ['errors'],
    }),
  reportRelationshipsSchema,
);

// ---------------------------------------------------------------------------------------------
// Documents and bodies (C72)

/** Every report resource schema, in `REPORT_TYPES` order (C69.1). */
export const REPORT_RESOURCE_SCHEMAS = [
  watchlistReportResourceSchema,
  businessWatchlistReportResourceSchema,
  cryptoAddressWatchlistReportResourceSchema,
  politicallyExposedPersonReportResourceSchema,
  adverseMediaReportResourceSchema,
  businessAdverseMediaReportResourceSchema,
  emailAddressReportResourceSchema,
  phoneNumberReportResourceSchema,
  addressLookupReportResourceSchema,
  ipAddressReportResourceSchema,
  customListReportResourceSchema,
] as const;

export const reportResourceSchema = z.discriminatedUnion('type', REPORT_RESOURCE_SCHEMAS);
export type ReportResource = z.infer<typeof reportResourceSchema>;

/** `GET /api/v1/reports/:id`, `POST /api/v1/reports` and the actions. */
export const reportDocumentSchema = singleDocumentSchema(reportResourceSchema);
export type ReportDocument = z.infer<typeof reportDocumentSchema>;

/** `GET /api/v1/reports`. */
export const reportListDocumentSchema = listDocumentSchema(reportResourceSchema);

/**
 * `GET /api/v1/reports` query (C72.1). `filter[has-match]=false` returns only `ready` reports
 * (C69.4): an errored report is not screened, never "no match".
 */
export const listReportsQuerySchema = listQuerySchema('rep', {
  'filter[report-template-id]': filterListSchema(idSchema('rptp')).optional(),
  'filter[status]': filterListSchema(reportStatusSchema).optional(),
  'filter[has-match]': booleanFilterSchema.optional(),
  'filter[account-id]': filterListSchema(idSchema('acc')).optional(),
  'filter[inquiry-id]': filterListSchema(idSchema('inq')).optional(),
  /** The account's reference id; its values may contain commas. */
  'filter[reference-id]': referenceIdSchema.optional(),
  'filter[tag]': filterListSchema(tagInputSchema).optional(),
  'filter[type]': filterListSchema(reportResourceTypeSchema).optional(),
});

const createMetaSchema = z.strictObject({
  /** Default true, as the public body: a new account when none is named. */
  'auto-create-account': z.boolean().optional(),
  'auto-create-account-type-id': idSchema('acctp').optional(),
  /** Needs `accounts:read` whenever present (V14). */
  'auto-create-account-reference-id': referenceIdSchema.optional(),
  'processing-mode': z.enum(REPORT_PROCESSING_MODES).optional(),
});

function createVariant<const Type extends ReportType>(type: Type) {
  return z.strictObject({
    type: z.literal(toReportResourceType(type) as `report/${Type}`),
    attributes: z.strictObject({
      'report-template-id': idSchema('rptp'),
      /** PII (C70.3): masked in stored API logs, as every report query is. */
      query: REPORT_QUERY_SCHEMAS[type].meta({ pii: true }),
      /** Needs `accounts:read` (C72.2). */
      'account-id': idSchema('acc').optional(),
      /** Ours; needs `inquiries:write` (C72.2). */
      'inquiry-id': idSchema('inq').optional(),
    }),
  });
}

/**
 * `POST /api/v1/reports` (C72.1, H22): the public body; `reference-id` is refused. A body whose
 * only problems are under `/data/attributes/query` answers 422 `report_query_invalid`.
 */
export const createReportBodySchema = z.strictObject({
  data: z.discriminatedUnion('type', [
    createVariant('watchlist'),
    createVariant('business-watchlist'),
    createVariant('crypto-address-watchlist'),
    createVariant('politically-exposed-person'),
    createVariant('adverse-media'),
    createVariant('business-adverse-media'),
    createVariant('email-address'),
    createVariant('phone-number'),
    createVariant('address-lookup'),
    createVariant('ip-address'),
    createVariant('custom-list'),
  ]),
  meta: createMetaSchema.optional(),
});
export type CreateReportBody = z.infer<typeof createReportBodySchema>;

/** C75.2: `POST /api/v1/reports/:id/dismiss` (`reports:review`), under `data.attributes`. */
export const dismissReportBodySchema = z.strictObject({
  data: z.strictObject({
    attributes: z
      .strictObject({
        reason: z.string().min(1).max(REPORT_DISMISS_REASON_MAX_LENGTH).meta({ pii: true }),
        'dismiss-type': reportDismissTypeSchema.optional(),
        /** An entry key (or an article key with `dismiss-type: media`). */
        'entity-id': z.string().min(1).max(300).optional().meta({ pii: true }),
      })
      .refine(
        (attributes) =>
          attributes['dismiss-type'] !== 'media' || attributes['entity-id'] !== undefined,
        { message: 'a media dismissal names its article', path: ['entity-id'] },
      ),
  }),
});
export type DismissReportBody = z.infer<typeof dismissReportBodySchema>;

/** C75.5: `POST /api/v1/reports/:id/review` (`reports:review`), under `data.attributes`. */
export const reviewReportBodySchema = z.strictObject({
  data: z.strictObject({
    attributes: z
      .strictObject({
        'review-type': reportReviewTypeSchema,
        /** A match id (`rpm_`), required for a `record` review. */
        'record-token': matchId.optional(),
        'review-status': reportReviewStatusSchema,
        'risk-level': reportRiskLevelSchema.nullable().optional(),
        comment: z
          .string()
          .min(1)
          .max(REPORT_REVIEW_COMMENT_MAX_LENGTH)
          .optional()
          .meta({ pii: true }),
        'notify-on-change': z.boolean().optional(),
      })
      .superRefine((attributes, ctx) => {
        if (
          (attributes['review-type'] === 'record') !==
          (attributes['record-token'] !== undefined)
        ) {
          ctx.addIssue({
            code: 'custom',
            message: 'a record review names its record-token, and only a record review does',
            path: ['record-token'],
          });
        }
        if (attributes['review-status'] === 'false_positive' && attributes.comment === undefined) {
          ctx.addIssue({
            code: 'custom',
            message: 'a false_positive review is a dismissal and needs a comment',
            path: ['comment'],
          });
        }
      }),
  }),
});
export type ReviewReportBody = z.infer<typeof reviewReportBodySchema>;

/** C74.5: `pause`, `resume` and `run` take no parameters. */
export const pauseReportBodySchema = emptyActionBodySchema;
export const resumeReportBodySchema = emptyActionBodySchema;
export const runReportBodySchema = emptyActionBodySchema;

// ---------------------------------------------------------------------------------------------
// History (C74.2)

const reportLink = z.strictObject({ report: z.strictObject({ data: reportIdentifierSchema }) });

export const reportRunResourceSchema = resourceWithRelationshipsSchema(
  'report-run',
  'rpr',
  z.strictObject({
    'run-type': reportRunTypeSchema,
    status: reportRunStatusSchema,
    'scheduled-for': timestampSchema.nullable(),
    'started-at': timestampSchema.nullable(),
    'completed-at': timestampSchema.nullable(),
    'match-count': z.int().min(0),
    'new-match-count': z.int().min(0),
    notes: z.array(reportRunNoteSchema),
    errors: z.array(reportErrorSchema),
    coverage: reportCoverageSchema.nullable(),
    'created-at': timestampSchema,
  }),
  reportLink,
);
export type ReportRunResource = z.infer<typeof reportRunResourceSchema>;

export const reportActionResourceSchema = resourceWithRelationshipsSchema(
  'report-action',
  'ract',
  z.strictObject({
    'action-type': reportActionTypeSchema,
    /**
     * A user, an API key, a workflow run (C121.1), or the system (a pause on match, a retention
     * redaction). A run never reviews or dismisses, so the match's `user` stays `actorId`.
     */
    actor: z.union([actorId, idSchema('wfr'), z.literal('system')]),
    'created-at': timestampSchema,
    /** PII (C70.3, P04): shown only with `pii:view`; `null` once redacted. */
    reason: pii(z.string().min(1).max(REPORT_DISMISS_REASON_MAX_LENGTH)),
    comment: pii(z.string().min(1).max(REPORT_REVIEW_COMMENT_MAX_LENGTH)),
    /** The matches the action changed. */
    'match-ids': z.array(matchId),
    'review-status': reportReviewStatusSchema.nullable(),
    'risk-level': reportRiskLevelSchema.nullable(),
  }),
  reportLink,
);
export type ReportActionResource = z.infer<typeof reportActionResourceSchema>;

export const reportHistoryEntrySchema = z.discriminatedUnion('type', [
  reportRunResourceSchema,
  reportActionResourceSchema,
]);

/** `GET /api/v1/reports/:id/history`: runs and actions, newest first. */
export const reportHistoryDocumentSchema = listDocumentSchema(reportHistoryEntrySchema);

/** `GET /api/v1/reports/:id/history` query: pages after a run or an action. */
export const reportHistoryQuerySchema = z.strictObject({
  'page[after]': z.union([idSchema('rpr'), idSchema('ract')]).optional(),
  'page[size]': pageSizeSchema.optional(),
});

/** C72.3: `GET /api/v1/dashboard/reports/:id`, masked, with its runs and actions. */
export const dashboardReportDocumentSchema = z.strictObject({
  data: reportResourceSchema,
  included: z.array(reportHistoryEntrySchema).optional(),
});

/** C72.3: `GET /api/v1/dashboard/reports`, masked. */
export const dashboardReportListDocumentSchema = reportListDocumentSchema;

// ---------------------------------------------------------------------------------------------
// PII (C70.3)

function piiMembers(shape: Record<string, z.ZodType>): string[] {
  return Object.entries(shape)
    .filter(([, member]) => (member.meta() as { pii?: unknown } | undefined)?.pii === true)
    .map(([member]) => member);
}

function shapeOf(schema: z.ZodType): Record<string, z.ZodType> {
  let current: unknown = schema;
  while (!(current instanceof z.ZodObject)) {
    current =
      (current as { def: { in?: unknown; innerType?: unknown } }).def.in ??
      (current as { def: { innerType?: unknown } }).def.innerType;
  }
  const shape: Record<string, z.ZodType> = current.shape;
  return shape;
}

/**
 * C70.3: every attribute the report resources, their history and the create, dismiss and review
 * bodies mark PII, in the order they first name them. The API's masking lists consume it; the
 * collision test (`pii-collisions.test.ts`) keeps every name PII at every resource.
 */
export const PII_REPORT_ATTRIBUTES: readonly string[] = Object.freeze([
  ...new Set([
    ...REPORT_RESOURCE_SCHEMAS.flatMap((schema) => piiMembers(shapeOf(schema.shape.attributes))),
    ...piiMembers(shapeOf(reportActionResourceSchema.shape.attributes)),
    ...piiMembers(shapeOf(dismissReportBodySchema.shape.data.shape.attributes)),
    ...piiMembers(shapeOf(reviewReportBodySchema.shape.data.shape.attributes)),
  ]),
]);

// ---------------------------------------------------------------------------------------------
// Builders

/** C84.2: where a query field came from. */
export type ReportQuerySource = (typeof REPORT_QUERY_SOURCES)[number];

/** C69.4, C76.2: one source's provenance on a report. */
export interface ReportSourceRecord {
  sourceId: string;
  syncId: string;
  publishedAt: Date;
  checkedAt: Date;
  sha256: string;
  origin: 'publisher' | 'import';
  attribution: string;
}

/** A stored report as the builder takes it; `attributes` are the type's, already masked. */
export interface ReportRecord {
  id: string;
  type: ReportType;
  status: ReportStatus;
  origin: ReportOrigin;
  /**
   * C173.1 (Workflow 9B, `api-cases-reports`): the note codes of the latest finished run; left out
   * while no run has finished, and then not sent.
   */
  latestRunNotes?: readonly ReportRunNote[] | undefined;
  reportTemplateId: string;
  reportTemplateVersionId: string;
  versionNumber: number;
  inquiryId: string | null;
  accountId: string | null;
  accountIds: readonly string[];
  /** The inputs as sent (or as the completion hook built them), already masked; `null` once redacted. */
  query: Readonly<Record<string, unknown>> | null;
  /** C84.2: where each query field came from. */
  querySources: Readonly<Record<string, ReportQuerySource>>;
  hasMatch: boolean;
  completedRunCount: number;
  tags: readonly string[];
  errors: readonly { code: ReportErrorCode; source?: string }[];
  unavailableFields: readonly { field: string; reason: string }[];
  coverage: { complete: boolean; limits: readonly ReportCoverageLimit[] } | null;
  nextRunAt: Date | null;
  pausedAt: Date | null;
  pausedReason: ReportPausedReason | null;
  /** C69.4: the provenance of each source the latest run used. */
  sources: readonly ReportSourceRecord[];
  /** C105.7: the latest transaction it was attached to; left out, `null`. */
  transactionId?: string | null;
  /** C106.2: a custom-list run's provenance, served as `sources` in place of the above. */
  listSources?: readonly ReportListProvenance[];
  matcherVersion: string | null;
  provider: { id: string; sandbox: boolean } | null;
  thresholds: Readonly<Record<string, string | number | boolean>> | null;
  notices: readonly string[];
  /** The type's result attributes, as the run stored them and the principal may see them. */
  attributes: Readonly<Record<string, unknown>>;
  createdAt: Date;
  completedAt: Date | null;
  redactedAt: Date | null;
}

const SHARED_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(
  Object.keys(sharedAttributes('watchlist')),
);

/**
 * The type's result attributes before a run fills them: `null`, or an empty list where the
 * attribute is a list that cannot be null. A pending report serves every attribute (C70.2).
 */
function emptyTypeAttributes(type: ReportType): Record<string, unknown> {
  const schema = REPORT_RESOURCE_SCHEMAS[REPORT_TYPES.indexOf(type)];
  if (schema === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(shapeOf(schema.shape.attributes))
      .filter(([name]) => !SHARED_ATTRIBUTE_NAMES.has(name))
      .map(([name, member]) => [
        name,
        EMPTY_TYPE_VALUES.find((empty) => member.safeParse(empty).success) ?? null,
      ]),
  );
}

/**
 * What a type attribute holds before the first run, the first its schema takes: `null`, an empty
 * list, an empty record (`field-details`), or `false` for a flag that cannot be null (`flagged`,
 * as `has-match` is `false` before any run).
 */
const EMPTY_TYPE_VALUES: readonly unknown[] = [null, [], {}, false];

/**
 * Builds the report resource (C70.2). `is-continuous` and `is-recurring` are derived as M7
 * defines them; a type attribute the record leaves out (before the first run) is `null`, or an
 * empty list, an empty record or `false` where the attribute takes no `null`.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildReportResource(record: ReportRecord): ReportResource {
  return reportResourceSchema.parse({
    type: toReportResourceType(record.type),
    id: record.id,
    attributes: {
      status: record.status,
      'created-at': toTimestamp(record.createdAt),
      'completed-at': toNullableTimestamp(record.completedAt),
      'redacted-at': toNullableTimestamp(record.redactedAt),
      'report-template-version-name': reportTemplateVersionName(record.versionNumber),
      'has-match': record.hasMatch,
      'is-continuous': record.completedRunCount > 1,
      'is-recurring': record.nextRunAt !== null && record.pausedAt === null,
      tags: [...record.tags],
      query: record.query,
      origin: record.origin,
      ...(record.latestRunNotes === undefined
        ? {}
        : { 'latest-run-notes': [...record.latestRunNotes] }),
      errors: record.errors.map((error) => ({ ...error })),
      'unavailable-fields': record.unavailableFields.map((entry) => ({ ...entry })),
      coverage:
        record.coverage === null
          ? null
          : { complete: record.coverage.complete, limits: [...record.coverage.limits] },
      'next-run-at': toNullableTimestamp(record.nextRunAt),
      'paused-at': toNullableTimestamp(record.pausedAt),
      'paused-reason': record.pausedReason,
      sources:
        record.listSources ??
        record.sources.map((source) => ({
          'source-id': source.sourceId,
          'sync-id': source.syncId,
          'published-at': toTimestamp(source.publishedAt),
          'checked-at': toTimestamp(source.checkedAt),
          sha256: source.sha256,
          origin: source.origin,
          attribution: source.attribution,
        })),
      'query-sources': { ...record.querySources },
      'matcher-version': record.matcherVersion,
      provider: record.provider,
      thresholds: record.thresholds === null ? null : { ...record.thresholds },
      notices: [...record.notices],
      ...emptyTypeAttributes(record.type),
      ...record.attributes,
    },
    relationships: {
      inquiry: {
        data: record.inquiryId === null ? null : { type: 'inquiry', id: record.inquiryId },
      },
      account: {
        data: record.accountId === null ? null : { type: 'account', id: record.accountId },
      },
      accounts: { data: record.accountIds.map((id) => ({ type: 'account', id })) },
      'report-template': { data: { type: 'report-template', id: record.reportTemplateId } },
      'report-template-version': {
        data: { type: 'report-template-version', id: record.reportTemplateVersionId },
      },
      transaction: {
        data:
          record.transactionId === undefined || record.transactionId === null
            ? null
            : { type: 'transaction', id: record.transactionId },
      },
    },
  });
}

export interface ReportRunRecord {
  id: string;
  reportId: string;
  reportType: ReportType;
  runType: ReportRunType;
  status: ReportRunStatus;
  scheduledFor: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  matchCount: number;
  newMatchCount: number;
  notes: readonly ReportRunNote[];
  errors: readonly { code: ReportErrorCode; source?: string }[];
  coverage: { complete: boolean; limits: readonly ReportCoverageLimit[] } | null;
  createdAt: Date;
}

/**
 * Builds a history run (C74.2).
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildReportRunResource(record: ReportRunRecord): ReportRunResource {
  return reportRunResourceSchema.parse({
    type: 'report-run',
    id: record.id,
    attributes: {
      'run-type': record.runType,
      status: record.status,
      'scheduled-for': toNullableTimestamp(record.scheduledFor),
      'started-at': toNullableTimestamp(record.startedAt),
      'completed-at': toNullableTimestamp(record.completedAt),
      'match-count': record.matchCount,
      'new-match-count': record.newMatchCount,
      notes: [...record.notes],
      errors: record.errors.map((error) => ({ ...error })),
      coverage:
        record.coverage === null
          ? null
          : { complete: record.coverage.complete, limits: [...record.coverage.limits] },
      'created-at': toTimestamp(record.createdAt),
    },
    relationships: {
      report: { data: { type: toReportResourceType(record.reportType), id: record.reportId } },
    },
  });
}

export interface ReportActionRecord {
  id: string;
  reportId: string;
  reportType: ReportType;
  actionType: ReportActionType;
  /** A `usr_`, `key_` or `wfr_` id, or `system`. */
  actor: string;
  /** PII (C70.3): `null` when masked or redacted. */
  reason: string | null;
  comment: string | null;
  matchIds: readonly string[];
  reviewStatus: string | null;
  riskLevel: string | null;
  createdAt: Date;
}

/**
 * Builds a history action (C74.2).
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildReportActionResource(record: ReportActionRecord): ReportActionResource {
  return reportActionResourceSchema.parse({
    type: 'report-action',
    id: record.id,
    attributes: {
      'action-type': record.actionType,
      actor: record.actor,
      'created-at': toTimestamp(record.createdAt),
      reason: record.reason,
      comment: record.comment,
      'match-ids': [...record.matchIds],
      'review-status': record.reviewStatus,
      'risk-level': record.riskLevel,
    },
    relationships: {
      report: { data: { type: toReportResourceType(record.reportType), id: record.reportId } },
    },
  });
}

/** The types that review matches, for callers that need the list (C75). */
export const REPORT_TYPES_WITH_REVIEW: readonly ReportType[] = Object.freeze(
  REPORT_TYPES.filter((type) => REPORT_REGISTRY[type].review === 'matches'),
);
