/**
 * Webhooks (contracts C2, C5 and C14). The signing secret is write-once: only the creation,
 * clone and rotate-secret responses carry `secret`; every other response shows `secret-last4`,
 * and the read schemas reject a `secret` member so a leak fails serialization instead of
 * reaching the client. Custom header values are write-only in the same way.
 */
import { z } from 'zod';
import { actionBodySchema, emptyActionBodySchema, optionalActionBodySchema } from './actions.js';
import { apiVersionSchema, type ApiVersion } from './api-versions.js';
import { eventNameSchema, type EventName } from './event-names.js';
import { safeUrl } from './flow-url.js';
import { idSchema } from './ids.js';
import {
  hasDistinctValues,
  listDocumentSchema,
  pageSizeSchema,
  requestDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toTimestamp,
} from './json-api.js';
import { filterTimestampSchema } from './list-filters.js';
import { REDACTED_VALUE } from './redaction.js';
import { webhookSecretSchema } from './tokens.js';

/**
 * Signature header: `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. While a
 * rotated secret is still valid, a second `v1=` follows: `t=<t>,v1=<new> v1=<old>` (C14).
 */
export const WEBHOOK_SIGNATURE_HEADER = 'openverify-signature';
export const WEBHOOK_EVENT_ID_HEADER = 'openverify-event-id';
/**
 * C169.5 (Workflow 9B; ours, mirroring the public ones): every delivery attempt says how many
 * attempts were made with this one, how many are left, and when the first was made (ISO 8601).
 * `deliveryAttemptHeaders` (`webhooks/attempt-headers.ts`, `api-keys-webhooks`) sets them.
 */
export const WEBHOOK_ATTEMPTS_MADE_HEADER = 'openverify-webhook-attempts-made';
export const WEBHOOK_ATTEMPTS_LEFT_HEADER = 'openverify-webhook-attempts-left';
export const WEBHOOK_FIRST_ATTEMPTED_AT_HEADER = 'openverify-webhook-first-attempted-at';
export const WEBHOOK_USER_AGENT = 'OpenVerify-Webhooks/1';
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * When each attempt is due, in seconds after the first (C14): +0, 1 min, 5 min, 30 min, 2 h,
 * 6 h, 12 h and 24 h, each with ±10% jitter. This replaces Phase 1's 5 attempts.
 */
export const WEBHOOK_RETRY_OFFSETS_SECONDS = Object.freeze([
  0, 60, 300, 1800, 7200, 21_600, 43_200, 86_400,
] as const);
export const WEBHOOK_RETRY_JITTER_RATIO = 0.1;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_OFFSETS_SECONDS.length;

/** After `rotate-secret`, the previous secret signs too for this long (C14). */
export const WEBHOOK_PREVIOUS_SECRET_DEFAULT_TTL_SECONDS = 24 * 60 * 60;
export const WEBHOOK_PREVIOUS_SECRET_MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

/** `replay` takes at most 100 event ids, and at most 1,000 events in total. */
export const WEBHOOK_REPLAY_MAX_EVENT_IDS = 100;
export const WEBHOOK_REPLAY_MAX_EVENTS = 1000;

export const MAX_WEBHOOK_CUSTOM_HEADERS = 10;
export const MAX_WEBHOOK_CUSTOM_HEADER_VALUE_LENGTH = 1024;
export const MAX_WEBHOOK_ATTRIBUTE_BLOCKLIST = 100;

/** `archived` is terminal: the webhook never delivers again and refuses changes (409). */
export const WEBHOOK_STATUSES = ['enabled', 'disabled', 'archived'] as const;
export const webhookStatusSchema = z.enum(WEBHOOK_STATUSES);
export type WebhookStatus = z.infer<typeof webhookStatusSchema>;

/** Statuses `PATCH` may set; archiving goes through `POST /webhooks/:id/archive`. */
export const WEBHOOK_UPDATABLE_STATUSES = ['enabled', 'disabled'] as const;
export const webhookUpdatableStatusSchema = z.enum(WEBHOOK_UPDATABLE_STATUSES);

/** Subscribes a webhook to every event. */
export const WILDCARD_EVENT = '*';

/**
 * Absolute http(s) URL without credentials or fragment. This is only the format: the
 * dispatcher still applies the SSRF guard (resolve, block private ranges, connect to the
 * resolved IP) on every delivery.
 */
export const webhookUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .refine(
    (value) => {
      const url = safeUrl(value);
      return url !== null && url.username === '' && url.password === '' && url.hash === '';
    },
    { message: 'must not contain credentials or a fragment' },
  );

/** `["*"]`, or a non-empty list of distinct event names. */
export const enabledEventsSchema = z.union([
  z.tuple([z.literal(WILDCARD_EVENT)]),
  z
    .array(eventNameSchema)
    .min(1)
    .refine((names) => new Set(names).size === names.length, 'must not contain duplicates'),
]);
export type EnabledEvents = z.infer<typeof enabledEventsSchema>;

/** Whether a webhook subscribed to `enabledEvents` receives `name`. */
export function webhookWantsEvent(enabledEvents: readonly string[], name: EventName): boolean {
  return enabledEvents.includes(WILDCARD_EVENT) || enabledEvents.includes(name);
}

/** RFC 7230 token: the characters an HTTP header name may use. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Header names a custom header may not use (C14): the ones the dispatcher sets, every
 * `openverify-*` name, the RFC 7230 hop-by-hop headers (plus the de facto `proxy-connection`),
 * and `expect`, which changes how the request is sent.
 */
const RESERVED_HEADER_NAMES: ReadonlySet<string> = new Set([
  'content-type',
  'content-length',
  'host',
  'user-agent',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
]);

function isReservedHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED_HEADER_NAMES.has(lower) || lower.startsWith('openverify-');
}

export const customHeaderNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(HEADER_NAME_PATTERN, 'must be an HTTP header name')
  .refine((name) => !isReservedHeaderName(name), 'is reserved by the webhook dispatcher');

/**
 * A custom header value: at most 1,024 printable ASCII characters, spaces and tabs. CR, LF and
 * other control characters could inject headers, and HTTP clients refuse non-ASCII values, so
 * such a webhook would fail at every delivery. The redacted placeholder is refused so a
 * response sent back unchanged cannot overwrite the stored value with it.
 */
export const customHeaderValueSchema = z
  .string()
  .max(MAX_WEBHOOK_CUSTOM_HEADER_VALUE_LENGTH)
  .regex(/^[\t\x20-\x7E]*$/, 'must be printable ASCII on one line')
  .refine((value) => value !== REDACTED_VALUE, `must not be ${REDACTED_VALUE}`);

function uniqueIgnoringCase(names: readonly string[]): boolean {
  return new Set(names.map((name) => name.toLowerCase())).size === names.length;
}

/** `custom-headers` as sent: name to value, at most 10, names unique ignoring case. */
export const customHeadersInputSchema = z
  .record(customHeaderNameSchema, customHeaderValueSchema)
  .refine(
    (headers) => Object.keys(headers).length <= MAX_WEBHOOK_CUSTOM_HEADERS,
    `at most ${String(MAX_WEBHOOK_CUSTOM_HEADERS)} custom headers are allowed`,
  )
  .refine(
    (headers) => uniqueIgnoringCase(Object.keys(headers)),
    'header names must be unique, ignoring case',
  );
export type CustomHeadersInput = z.infer<typeof customHeadersInputSchema>;

/** `custom-headers` in responses: the names, each with the value `[REDACTED]`. */
export const customHeadersResponseSchema = z
  .record(customHeaderNameSchema, z.literal(REDACTED_VALUE))
  .refine(
    (headers) => Object.keys(headers).length <= MAX_WEBHOOK_CUSTOM_HEADERS,
    `at most ${String(MAX_WEBHOOK_CUSTOM_HEADERS)} custom headers are allowed`,
  );

function distinctIds(prefix: 'itmpl' | 'acctp' | 'wfl' | 'lst' | 'ctmpl') {
  return z
    .array(idSchema(prefix))
    .min(1)
    .max(100)
    .refine(hasDistinctValues, 'must not contain duplicates');
}

/**
 * Delivery filters (C14): an event is delivered only if its subject matches every present
 * filter; a subject without the attribute is not filtered (`matchesWebhookFilters` in core).
 */
export const webhookFiltersSchema = z.strictObject({
  'inquiry-template-ids': distinctIds('itmpl').optional(),
  'account-type-ids': distinctIds('acctp').optional(),
  /** C143.4 (Workflow 8A): a workflow, version or run event by its workflow, a list event by its list. */
  'workflow-ids': distinctIds('wfl').optional(),
  'list-ids': distinctIds('lst').optional(),
  /**
   * C143.4 (Workflow 8B): a case event by its template. A case also passes `inquiry-template-ids`
   * only when every inquiry it holds is of a listed template, and a comment follows its case.
   */
  'case-template-ids': distinctIds('ctmpl').optional(),
});
export type WebhookFilters = z.infer<typeof webhookFiltersSchema>;

/**
 * Attribute names removed from every resource in a delivery before signing
 * (`applyAttributeBlocklist` in core). `fields` removes the whole fields object.
 */
export const attributeBlocklistSchema = z
  .array(
    z
      .string()
      .max(100)
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'must be a kebab-case attribute name'),
  )
  .max(MAX_WEBHOOK_ATTRIBUTE_BLOCKLIST)
  .refine(hasDistinctValues, 'must not contain duplicates');

/** C169.5 (Workflow 9B; public): a webhook's name and description, optional in the API. */
export const webhookNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters');
export const webhookDescriptionSchema = z.string().max(1000);

/**
 * C169.6 (S6, public; Workflow 9B): alert the users who opted in when at least `threshold` first
 * attempts failed within `window-minutes`, at most once per window. It counts failed first attempts
 * and says so.
 */
export const webhookFailureAlertSchema = z.strictObject({
  enabled: z.boolean(),
  threshold: z.int().min(1).max(10_000),
  'window-minutes': z.int().min(5).max(1440),
});
export type WebhookFailureAlert = z.infer<typeof webhookFailureAlertSchema>;

/**
 * Webhook attributes. The Phase 2 members (C12, C14) are optional so Phase 1 documents still
 * validate; servers since Phase 2 always send them.
 */
export const webhookAttributesSchema = z.strictObject({
  url: webhookUrlSchema,
  'enabled-events': enabledEventsSchema,
  status: webhookStatusSchema,
  'secret-last4': z.string().regex(/^[A-Za-z0-9_-]{4}$/),
  /** The version of the event documents this webhook receives; deliveries send it as a header. */
  'api-version': apiVersionSchema.optional(),
  'custom-headers': customHeadersResponseSchema.optional(),
  filters: webhookFiltersSchema.optional(),
  'attribute-blocklist': attributeBlocklistSchema.optional(),
  // C169.5, C169.6 (Workflow 9B): optional, since earlier servers send none.
  name: webhookNameSchema.nullable().optional(),
  description: webhookDescriptionSchema.nullable().optional(),
  'failure-alert': webhookFailureAlertSchema.nullable().optional(),
  /** C169.5: when the previous secret stops signing after a rotation; `null` when none signs. */
  'previous-secret-expires-at': timestampSchema.nullable().optional(),
  'created-at': timestampSchema,
  'updated-at': timestampSchema,
});

export const createdWebhookAttributesSchema = z
  .strictObject({ ...webhookAttributesSchema.shape, secret: webhookSecretSchema })
  .refine((attributes) => attributes.secret.endsWith(attributes['secret-last4']), {
    message: 'secret-last4 must be the end of the secret',
    path: ['secret-last4'],
  });

export const webhookResourceSchema = resourceSchema('webhook', 'wbh', webhookAttributesSchema);
export type WebhookResource = z.infer<typeof webhookResourceSchema>;

/** The `POST /api/v1/webhooks` response resource: the only one that carries `secret`. */
export const createdWebhookResourceSchema = resourceSchema(
  'webhook',
  'wbh',
  createdWebhookAttributesSchema,
);
export type CreatedWebhookResource = z.infer<typeof createdWebhookResourceSchema>;

export const webhookDocumentSchema = singleDocumentSchema(webhookResourceSchema);
export const createdWebhookDocumentSchema = singleDocumentSchema(createdWebhookResourceSchema);
export const webhookListDocumentSchema = listDocumentSchema(webhookResourceSchema);

const configurableAttributes = {
  /** Defaults to the latest version. */
  'api-version': apiVersionSchema.optional(),
  'custom-headers': customHeadersInputSchema.optional(),
  filters: webhookFiltersSchema.optional(),
  'attribute-blocklist': attributeBlocklistSchema.optional(),
  // C169.5, C169.6 (Workflow 9B).
  name: webhookNameSchema.nullable().optional(),
  description: webhookDescriptionSchema.nullable().optional(),
  'failure-alert': webhookFailureAlertSchema.nullable().optional(),
};

export const createWebhookAttributesSchema = z.strictObject({
  url: webhookUrlSchema,
  'enabled-events': enabledEventsSchema,
  ...configurableAttributes,
});
export const createWebhookBodySchema = requestDocumentSchema(
  'webhook',
  createWebhookAttributesSchema,
);
export type CreateWebhookBody = z.infer<typeof createWebhookBodySchema>;

/** `custom-headers`, `filters` and `attribute-blocklist` replace the stored values. */
export const updateWebhookAttributesSchema = z
  .strictObject({
    url: webhookUrlSchema.optional(),
    'enabled-events': enabledEventsSchema.optional(),
    status: webhookUpdatableStatusSchema.optional(),
    ...configurableAttributes,
  })
  .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update');
/** `PATCH /api/v1/webhooks/:id` body. */
export const updateWebhookBodySchema = requestDocumentSchema(
  'webhook',
  updateWebhookAttributesSchema,
);
export type UpdateWebhookBody = z.infer<typeof updateWebhookBodySchema>;

/** `GET /api/v1/webhooks` query. */
export const listWebhooksQuerySchema = z.strictObject({
  'page[after]': idSchema('wbh').optional(),
  'page[size]': pageSizeSchema.optional(),
});

/**
 * A webhook as the API stores it. The Phase 2 members are optional so Phase 1 callers keep
 * compiling; a member that is left out is not sent.
 */
export interface WebhookRecord {
  id: string;
  url: string;
  enabledEvents: readonly string[];
  status: WebhookStatus;
  secretLast4: string;
  createdAt: Date;
  updatedAt: Date;
  apiVersion?: ApiVersion;
  /** Names only: values never leave the server. */
  customHeaderNames?: readonly string[];
  filters?: WebhookFilters;
  attributeBlocklist?: readonly string[];
  /** C169.5, C169.6 (Workflow 9B). Each left out is not sent. */
  name?: string | null;
  description?: string | null;
  failureAlert?: WebhookFailureAlert | null;
  previousSecretExpiresAt?: Date | null;
}

function attributesOf(record: WebhookRecord) {
  return {
    url: record.url,
    'enabled-events': [...record.enabledEvents],
    status: record.status,
    'secret-last4': record.secretLast4,
    ...(record.apiVersion === undefined ? {} : { 'api-version': record.apiVersion }),
    ...(record.customHeaderNames === undefined
      ? {}
      : {
          'custom-headers': Object.fromEntries(
            record.customHeaderNames.map((name) => [name, REDACTED_VALUE]),
          ),
        }),
    ...(record.filters === undefined ? {} : { filters: record.filters }),
    ...(record.attributeBlocklist === undefined
      ? {}
      : { 'attribute-blocklist': [...record.attributeBlocklist] }),
    ...(record.name === undefined ? {} : { name: record.name }),
    ...(record.description === undefined ? {} : { description: record.description }),
    ...(record.failureAlert === undefined ? {} : { 'failure-alert': record.failureAlert }),
    ...(record.previousSecretExpiresAt === undefined
      ? {}
      : {
          'previous-secret-expires-at':
            record.previousSecretExpiresAt === null
              ? null
              : toTimestamp(record.previousSecretExpiresAt),
        }),
    'created-at': toTimestamp(record.createdAt),
    'updated-at': toTimestamp(record.updatedAt),
  };
}

/**
 * Builds the webhook resource for every response except creation.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWebhookResource(record: WebhookRecord): WebhookResource {
  return webhookResourceSchema.parse({
    type: 'webhook',
    id: record.id,
    attributes: attributesOf(record),
  });
}

/**
 * Builds the creation response resource, which carries the secret once.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildCreatedWebhookResource(
  record: WebhookRecord,
  secret: string,
): CreatedWebhookResource {
  return createdWebhookResourceSchema.parse({
    type: 'webhook',
    id: record.id,
    attributes: { ...attributesOf(record), secret },
  });
}

/** `POST /api/v1/webhooks/:id/enable`. */
export const enableWebhookBodySchema = emptyActionBodySchema;
/** `POST /api/v1/webhooks/:id/disable`. */
export const disableWebhookBodySchema = emptyActionBodySchema;
/** `POST /api/v1/webhooks/:id/archive`: terminal. */
export const archiveWebhookBodySchema = emptyActionBodySchema;
/**
 * `POST /api/v1/webhooks/:id/clone`: same configuration, new secret, status `disabled`. The
 * response is a `createdWebhookDocumentSchema`, with the new secret once.
 */
export const cloneWebhookBodySchema = emptyActionBodySchema;

/** `POST /api/v1/webhooks/:id/rotate-secret`. */
export const rotateWebhookSecretBodySchema = optionalActionBodySchema(
  z.strictObject({
    /** Defaults to 24 hours; 0 retires the previous secret at once. */
    'previous-secret-expires-in-seconds': z
      .int()
      .min(0)
      .max(WEBHOOK_PREVIOUS_SECRET_MAX_TTL_SECONDS)
      .optional(),
  }),
);
export type RotateWebhookSecretBody = z.infer<typeof rotateWebhookSecretBodySchema>;

/** The rotate-secret response: the new secret once, and until when the previous one signs. */
export const rotateWebhookSecretDocumentSchema = z.strictObject({
  data: createdWebhookResourceSchema,
  meta: z.strictObject({ 'previous-secret-expires-at': timestampSchema }),
});

/**
 * `POST /api/v1/webhooks/:id/simulate`: builds a sample event (`simulated: true`) from the
 * golden fixtures, stores it and delivers it to this webhook only.
 */
export const simulateWebhookBodySchema = actionBodySchema(
  z.strictObject({ 'event-name': eventNameSchema }),
);
export type SimulateWebhookBody = z.infer<typeof simulateWebhookBodySchema>;

export const simulateWebhookDocumentSchema = z.strictObject({
  data: webhookResourceSchema,
  meta: z.strictObject({ 'event-id': idSchema('evt') }),
});

const replayByIdsSchema = z.strictObject({
  'event-ids': z
    .array(idSchema('evt'))
    .min(1)
    .max(WEBHOOK_REPLAY_MAX_EVENT_IDS)
    .refine(hasDistinctValues, 'must not contain duplicates'),
});

const replayByRangeSchema = z
  .strictObject({
    'created-at-start': filterTimestampSchema,
    'created-at-end': filterTimestampSchema,
    /** Only events whose delivery to this webhook failed. */
    status: z.literal('failed').optional(),
  })
  .refine((range) => Date.parse(range['created-at-start']) < Date.parse(range['created-at-end']), {
    message: 'created-at-end must be after created-at-start',
    path: ['created-at-end'],
  });

/**
 * `POST /api/v1/webhooks/:id/replay`: new deliveries for events this webhook subscribes to,
 * named by id or by time range (inclusive start, exclusive end), at most 1,000.
 */
export const replayWebhookBodySchema = actionBodySchema(
  z.union([replayByIdsSchema, replayByRangeSchema]),
);
export type ReplayWebhookBody = z.infer<typeof replayWebhookBodySchema>;

export const replayWebhookDocumentSchema = z.strictObject({
  data: webhookResourceSchema,
  meta: z.strictObject({ 'replayed-count': z.int().min(0).max(WEBHOOK_REPLAY_MAX_EVENTS) }),
});
