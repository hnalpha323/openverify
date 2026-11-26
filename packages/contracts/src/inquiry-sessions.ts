/**
 * Inquiry sessions (contract C10): a flow session opened by `resume` or a one-time link. The
 * token itself is never readable; `ip-address` and `user-agent` come from the first flow
 * call, are encrypted at rest, and are null for a user without `pii:view` (C15).
 */
import { i18nKeySchema } from '@openverify/flow-spec';
import { z } from 'zod';
import { actionBodySchema, emptyActionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import {
  deviceIdentifierSchema,
  inquiryIdentifierSchema,
  networkIdentifierSchema,
} from './identifiers.js';
import {
  listDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import {
  SESSION_NETWORK_ATTRIBUTE_SHAPE,
  networkResourceSchema,
  sessionNetworkAttributes,
  type SessionNetworkRecord,
} from './networks.js';
import type { Permission } from '@openverify/core';
import {
  SESSION_HANDOFF_ATTRIBUTE_SHAPE,
  sessionHandoffAttributes,
  type SessionHandoffRecord,
} from './handoffs.js';
import {
  SESSION_DEVICE_ATTRIBUTE_SHAPE,
  deviceResourceSchema,
  sessionDeviceAttributes,
  type SessionDeviceRecord,
} from './devices.js';

export const INQUIRY_SESSION_STATUSES = ['active', 'expired', 'canceled'] as const;
export const inquirySessionStatusSchema = z.enum(INQUIRY_SESSION_STATUSES);
export type InquirySessionStatus = z.infer<typeof inquirySessionStatusSchema>;

/** A client address as the API recorded it (IPv4, IPv6 or IPv4-mapped IPv6). */
export const ipAddressSchema = z.string().min(1).max(64);
export const userAgentSchema = z.string().max(1024);

export const inquirySessionAttributesSchema = z.strictObject({
  status: inquirySessionStatusSchema,
  'created-at': timestampSchema,
  /** The first successful flow API call; null until then. */
  'started-at': timestampSchema.nullable(),
  'expires-at': timestampSchema,
  /** PII (C15, C91.6): masked without `pii:view`, `null` after redaction. */
  'ip-address': ipAddressSchema.nullable().meta({ pii: true }),
  'user-agent': userAgentSchema.nullable().meta({ pii: true }),
  /**
   * C42.3, C47: what the user accepted, without the client address: the step's required text
   * keys and the optional ones ticked. Null before consent; optional so earlier answers parse.
   */
  consent: z
    .strictObject({
      'accepted-at': timestampSchema,
      'text-keys': z.array(i18nKeySchema).max(20),
      'optional-text-keys': z.array(i18nKeySchema).max(20),
      locale: z.string().max(35),
    })
    .nullable()
    .optional(),
  /**
   * C91.1 (Phase 7): the network facts of the session's address (C93), optional so payloads from
   * before Phase 7 still parse; servers since Workflow 7A send them.
   */
  ...optionalMembers(SESSION_NETWORK_ATTRIBUTE_SHAPE),
  /** C91.1 (Phase 7): the parsed device fields and the collection tiers that applied (C94.5). */
  ...optionalMembers(SESSION_DEVICE_ATTRIBUTE_SHAPE),
  /** C91.1, C96.4 (Phase 7): how a phone's session was reached, and how far it moved (C96.7). */
  ...optionalMembers(SESSION_HANDOFF_ATTRIBUTE_SHAPE),
});

/** Each member optional, keeping its nullability and PII mark. */
function optionalMembers<Shape extends Record<string, z.ZodType>>(shape: Shape) {
  return Object.fromEntries(
    Object.entries(shape).map(([name, member]) => {
      const meta = member.meta();
      return [name, meta === undefined ? member.optional() : member.optional().meta(meta)];
    }),
  ) as { [Name in keyof Shape]: z.ZodOptional<Shape[Name]> };
}

export const inquirySessionRelationshipsSchema = z.strictObject({
  inquiry: toOneRelationshipSchema(inquiryIdentifierSchema),
  /** C91.2: the device the device-recognition tier recorded; `null` without one. */
  device: toOneRelationshipSchema(deviceIdentifierSchema.nullable()).optional(),
  /** C91.3: the network row of the session's address; `null` before the first flow call. */
  network: toOneRelationshipSchema(networkIdentifierSchema.nullable()).optional(),
});

export const inquirySessionResourceSchema = resourceWithRelationshipsSchema(
  'inquiry-session',
  'iqse',
  inquirySessionAttributesSchema,
  inquirySessionRelationshipsSchema,
);
export type InquirySessionResource = z.infer<typeof inquirySessionResourceSchema>;

export const inquirySessionDocumentSchema = singleDocumentSchema(inquirySessionResourceSchema);

/** C91.1: what `GET /api/v1/inquiry-sessions/:id` can include (`?include=device,network`). */
export const INQUIRY_SESSION_INCLUDES = ['device', 'network'] as const;
export const inquirySessionIncludeSchema = z.enum(INQUIRY_SESSION_INCLUDES);
export type InquirySessionInclude = z.infer<typeof inquirySessionIncludeSchema>;

/**
 * C107.6: what each include needs beyond `inquiry-sessions:read`. The network is the session's own
 * view, masked as the session is, so it needs nothing more.
 */
export const INQUIRY_SESSION_INCLUDE_PERMISSIONS: Readonly<
  Record<InquirySessionInclude, readonly Permission[]>
> = Object.freeze({ device: ['inquiry-sessions:read'], network: ['inquiry-sessions:read'] });

/** `GET /api/v1/inquiry-sessions/:id` query. */
export const getInquirySessionQuerySchema = z.strictObject({
  include: filterListSchema(
    inquirySessionIncludeSchema,
    INQUIRY_SESSION_INCLUDES.length,
  ).optional(),
});

/** `GET /api/v1/inquiry-sessions/:id` with an include; also a session webhook's `included`. */
export const inquirySessionIncludeDocumentSchema = z.strictObject({
  data: inquirySessionResourceSchema,
  included: z
    .array(z.discriminatedUnion('type', [deviceResourceSchema, networkResourceSchema]))
    .optional(),
});
export type InquirySessionIncludeDocument = z.infer<typeof inquirySessionIncludeDocumentSchema>;
export const inquirySessionListDocumentSchema = listDocumentSchema(inquirySessionResourceSchema);

/** `GET /api/v1/inquiry-sessions` query (scope `inquiry-sessions:read`). */
export const listInquirySessionsQuerySchema = listQuerySchema('iqse', {
  'filter[inquiry-id]': filterListSchema(idSchema('inq')).optional(),
  'filter[status]': filterListSchema(inquirySessionStatusSchema).optional(),
});

/** `POST /api/v1/inquiry-sessions/:id/expire`. */
export const expireInquirySessionBodySchema = emptyActionBodySchema;

/** `POST /api/v1/inquiry-sessions/expire-all`: every active session of one inquiry. */
/** C91.5 (Workflow 7A): the most inquiries one `expire-all` names with `meta.inquiry-ids`. */
export const EXPIRE_ALL_MAX_INQUIRIES = 100;

/**
 * `POST /api/v1/inquiry-sessions/expire-all`: `meta.inquiry-id` (C10), or the public
 * `meta.inquiry-ids` (1-100, distinct; C91.5). The answer keeps `meta.expired-count`.
 */
export const expireAllInquirySessionsBodySchema = actionBodySchema(
  z.union([
    z.strictObject({ 'inquiry-id': idSchema('inq') }),
    z.strictObject({
      'inquiry-ids': z
        .array(idSchema('inq'))
        .min(1)
        .max(EXPIRE_ALL_MAX_INQUIRIES)
        .refine((ids) => new Set(ids).size === ids.length, 'must not repeat an inquiry'),
    }),
  ]),
);
export type ExpireAllInquirySessionsBody = z.infer<typeof expireAllInquirySessionsBodySchema>;

export const expireAllInquirySessionsResponseSchema = z.strictObject({
  meta: z.strictObject({ 'expired-count': z.int().min(0) }),
});

export interface InquirySessionRecord {
  id: string;
  inquiryId: string;
  status: InquirySessionStatus;
  createdAt: Date;
  startedAt: Date | null;
  expiresAt: Date;
  /** `null` when unknown or masked. */
  ipAddress: string | null;
  userAgent: string | null;
  /**
   * C42.3, C47 (Workflow 4A Stage 3): the consent recorded on the session, `null` before it.
   * Left out, the attribute is not sent.
   */
  consent?: InquirySessionConsentRecord | null;
  /**
   * C91.1 (Phase 7): the session's network facts (C93), already masked. Left out, the attributes
   * are not sent, so records and payloads from before Phase 7 still build and parse.
   */
  network?: SessionNetworkRecord | null;
  /** C91.3: the network row of the session's address; left out, the relationship is not sent. */
  networkId?: string | null;
  /** C91.1 (Phase 7): the parsed device fields; left out, the attributes are not sent. */
  device?: SessionDeviceRecord | null;
  /** C91.2: the session's device; left out, the relationship is not sent. */
  deviceId?: string | null;
  /** C96.4 (Phase 7): the handoff fields; left out, the attributes are not sent. */
  handoff?: SessionHandoffRecord | null;
}

/** What the user accepted on a session: never the client address (C42.3, C47). */
export interface InquirySessionConsentRecord {
  acceptedAt: Date;
  textKeys: readonly string[];
  /** The optional texts ticked; empty for a consent recorded before Phase 4. */
  optionalTextKeys: readonly string[];
  locale: string;
}

/**
 * Builds the inquiry-session resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildInquirySessionResource(record: InquirySessionRecord): InquirySessionResource {
  return inquirySessionResourceSchema.parse({
    type: 'inquiry-session',
    id: record.id,
    attributes: {
      status: record.status,
      'created-at': toTimestamp(record.createdAt),
      'started-at': toNullableTimestamp(record.startedAt),
      'expires-at': toTimestamp(record.expiresAt),
      'ip-address': record.ipAddress,
      'user-agent': record.userAgent,
      ...(record.consent === undefined
        ? {}
        : {
            consent:
              record.consent === null
                ? null
                : {
                    'accepted-at': toTimestamp(record.consent.acceptedAt),
                    'text-keys': [...record.consent.textKeys],
                    'optional-text-keys': [...record.consent.optionalTextKeys],
                    locale: record.consent.locale,
                  },
          }),
      ...(record.network === undefined || record.network === null
        ? {}
        : sessionNetworkAttributes(record.network)),
      ...(record.device === undefined || record.device === null
        ? {}
        : sessionDeviceAttributes(record.device)),
      ...(record.handoff === undefined || record.handoff === null
        ? {}
        : sessionHandoffAttributes(record.handoff)),
    },
    relationships: {
      inquiry: { data: { type: 'inquiry', id: record.inquiryId } },
      ...(record.deviceId === undefined
        ? {}
        : {
            device: {
              data: record.deviceId === null ? null : { type: 'device', id: record.deviceId },
            },
          }),
      ...(record.networkId === undefined
        ? {}
        : {
            network: {
              data: record.networkId === null ? null : { type: 'network', id: record.networkId },
            },
          }),
    },
  });
}

function piiMembers(shape: Record<string, z.ZodType>): string[] {
  return Object.entries(shape)
    .filter(([, member]) => (member.meta() as { pii?: unknown } | undefined)?.pii === true)
    .map(([member]) => member);
}

/** C91.6, C107.5: every inquiry-session attribute marked PII. */
export const PII_INQUIRY_SESSION_ATTRIBUTES: readonly string[] = Object.freeze(
  piiMembers(inquirySessionAttributesSchema.shape),
);

/**
 * C91.5 (Workflow 7A): `POST /api/v1/inquiry-sessions/:id/generate-one-time-link`, the public path
 * with the scope of `POST /inquiries/:id/generate-one-time-link`: a C10 one-time link for the
 * session's inquiry. `one-time-link-short` is always `null`: OpenVerify has no link shortener.
 */
export const generateSessionOneTimeLinkDocumentSchema = z.strictObject({
  data: inquirySessionResourceSchema,
  meta: z.strictObject({
    'one-time-link': z.url({ protocol: /^https?$/ }),
    'one-time-link-short': z.null(),
    'expires-at': timestampSchema,
  }),
});
export type GenerateSessionOneTimeLinkDocument = z.infer<
  typeof generateSessionOneTimeLinkDocumentSchema
>;
