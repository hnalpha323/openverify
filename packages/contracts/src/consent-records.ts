/**
 * Consent records (Phase 11, Workflow 11A Stage 1a; C236, C237; ours): the record a share rests
 * on, on both sides (`consent-record`, `cnsr_`). A source-side record is consent to disclose to a
 * named recipient; a destination-side record is consent to receive and use the data.
 *
 * Honesty (ADR 0010): a `flow` record is witnessed only in what the platform saw: the server
 * served the text whose digest it holds, the client reported showing it, and an affirmative act
 * happened in that session. It does not prove who held the device or that the text was read. An
 * `attested` record is the operator's own statement and is served as `witnessed: false`.
 */
import { z } from 'zod';
import {
  CONNECT_SIDES,
  SHARE_TOKEN_EXPIRES_IN_SECONDS,
  connectSideSchema,
  connectionIdentifierSchema,
  consentMethodSchema,
  consentRecordIdentifierSchema,
  organizationNameSchema,
  shareCategoriesSchema,
  shareObjectIdentifierSchema,
  sharePurposeSchema,
  shareTokenIdentifierSchema,
} from './connect.js';
import { anyIdSchema, idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  singleDocumentSchema,
  timestampSchema,
  toOneRelationshipSchema,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import { sha256HexSchema } from './template-fields.js';

/** C236.11: a decline is a record too, which nothing can cite. */
export const CONSENT_OUTCOMES = ['accepted', 'declined'] as const;
export const consentOutcomeSchema = z.enum(CONSENT_OUTCOMES);
export type ConsentOutcome = z.infer<typeof consentOutcomeSchema>;

/** C236.1 (review H27): derived, never stored. */
export const CONSENT_RECORD_STATUSES = [
  'active',
  'expired',
  'withdrawn',
  'redacted',
  'declined',
] as const;
export const consentRecordStatusSchema = z.enum(CONSENT_RECORD_STATUSES);
export type ConsentRecordStatus = z.infer<typeof consentRecordStatusSchema>;

/** C237.1, C237.6: the API route, the console's action, or the person in the flow. */
export const CONSENT_WITHDRAWN_VIA = ['api', 'operator', 'flow'] as const;
export const consentWithdrawnViaSchema = z.enum(CONSENT_WITHDRAWN_VIA);
export type ConsentWithdrawnVia = z.infer<typeof consentWithdrawnViaSchema>;

/** C237.1: the closed list of withdrawal reasons. */
export const CONSENT_WITHDRAWAL_REASONS = [
  'subject-request',
  'operator-decision',
  'other',
] as const;
export const consentWithdrawalReasonSchema = z.enum(CONSENT_WITHDRAWAL_REASONS);
export type ConsentWithdrawalReason = z.infer<typeof consentWithdrawalReasonSchema>;

/** C236.5: an attested text is the operator's own words, 1 to 20,000 characters. */
export const ATTESTED_TEXT_MAX_LENGTH = 20_000;
/** C236.5: an attestation is of an act at most 30 days old. */
export const ATTESTED_AT_MAX_AGE_DAYS = 30;
/** C236.5, C238.1: a record lives 60 s to 21 days (the token's range). */
export const CONSENT_VALID_SECONDS = SHARE_TOKEN_EXPIRES_IN_SECONDS;

const consentLocaleSchema = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
  .max(35);

/** C236.3: which text was presented: its locale, its copy keys and the digest of its logical form. */
export const consentRecordTextSchema = z.strictObject({
  locale: consentLocaleSchema,
  /** The copy keys the text was built from; empty for an attested text and after redaction. */
  keys: z.array(z.string().min(1).max(200)).max(50),
  sha256: sha256HexSchema,
});

/** What the platform saw of a `flow` record (session and time), or was told of an `attested` one. */
export const consentRecordEvidenceSchema = z.union([
  z.strictObject({
    'session-id': idSchema('iqse'),
    /** `null` on a declined record. */
    'accepted-at': timestampSchema.nullable(),
    /** Ours: when the person declined; `null` on an accepted record. */
    'declined-at': timestampSchema.nullable(),
  }),
  z.strictObject({ 'attested-at': timestampSchema }),
]);

/**
 * The members served only with `pii:view`: each is `null` without it, on a declined record (which
 * keeps no address, user agent or text copy, C236.11) and after redaction (C241.3).
 */
export const PII_CONSENT_RECORD_ATTRIBUTES: readonly string[] = Object.freeze([
  'evidence-reference',
  'text-body',
]);

export const consentRecordAttributesSchema = z
  .strictObject({
    side: connectSideSchema,
    outcome: consentOutcomeSchema,
    /** Derived (review H27). */
    status: consentRecordStatusSchema,
    purpose: sharePurposeSchema,
    'recipient-organization-id': idSchema('org'),
    /** The recipient's name as it was shown. */
    'recipient-name': organizationNameSchema,
    'data-categories': shareCategoriesSchema,
    'explicit-biometric': z.boolean(),
    text: consentRecordTextSchema,
    /** The digest of the separate biometric text, when one was shown and ticked. */
    'biometric-text-sha256': sha256HexSchema.nullable(),
    method: consentMethodSchema,
    /** True only for `flow`. */
    witnessed: z.boolean(),
    /** `null` after redaction. */
    evidence: consentRecordEvidenceSchema.nullable(),
    /** The attested reference; `pii:view`. */
    'evidence-reference': z.string().min(1).max(500).nullable().meta({ pii: true }),
    /** The session's address and user agent, as the session record serves them; `pii:view`. */
    'ip-address': z.string().max(64).nullable().meta({ pii: true }),
    'user-agent': z.string().max(1024).nullable().meta({ pii: true }),
    /** The stored copy of the text that was presented; `pii:view`. */
    'text-body': z.string().min(1).max(ATTESTED_TEXT_MAX_LENGTH).nullable().meta({ pii: true }),
    'expires-at': timestampSchema,
    'withdrawn-at': timestampSchema.nullable(),
    'withdrawn-via': consentWithdrawnViaSchema.nullable(),
    'withdrawal-reason': consentWithdrawalReasonSchema.nullable(),
    'redacted-at': timestampSchema.nullable(),
    'created-at': timestampSchema,
  })
  .superRefine((attributes, ctx) => {
    if (attributes.witnessed !== (attributes.method === 'flow')) {
      ctx.addIssue({
        code: 'custom',
        message: 'only a flow record is witnessed',
        path: ['witnessed'],
      });
    }
    if (attributes.evidence !== null) {
      const attested = 'attested-at' in attributes.evidence;
      if (attested !== (attributes.method === 'attested')) {
        ctx.addIssue({
          code: 'custom',
          message: 'the evidence does not match the method',
          path: ['evidence'],
        });
      }
    }
    if (attributes.outcome === 'declined' && attributes.method !== 'flow') {
      ctx.addIssue({
        code: 'custom',
        message: 'only a flow record is declined',
        path: ['outcome'],
      });
    }
    if ((attributes.status === 'declined') !== (attributes.outcome === 'declined')) {
      ctx.addIssue({
        code: 'custom',
        message: 'a declined record has the status declined, whatever else happened to it',
        path: ['status'],
      });
    }
    if ((attributes['withdrawn-at'] === null) !== (attributes['withdrawn-via'] === null)) {
      ctx.addIssue({
        code: 'custom',
        message: 'withdrawn-at and withdrawn-via go together',
        path: ['withdrawn-via'],
      });
    }
  });

const consentRecordRelationshipsSchema = z.strictObject({
  /**
   * Source side: the inquiry, account or transaction the consent is about. Destination side: the
   * share token until redemption, then the object the redemption made or filled (C236.10). `null`
   * after redaction.
   */
  subject: toOneRelationshipSchema(
    z.union([shareObjectIdentifierSchema, shareTokenIdentifierSchema]).nullable(),
  ),
  connection: toOneRelationshipSchema(connectionIdentifierSchema),
  /** The token that cites the record; `null` until one does, and always on a declined record. */
  'share-token': toOneRelationshipSchema(shareTokenIdentifierSchema.nullable()),
});

export const consentRecordResourceSchema = z.strictObject({
  type: z.literal('consent-record'),
  id: idSchema('cnsr'),
  attributes: consentRecordAttributesSchema,
  relationships: consentRecordRelationshipsSchema,
});
export type ConsentRecordResource = z.infer<typeof consentRecordResourceSchema>;

export const consentRecordDocumentSchema = singleDocumentSchema(consentRecordResourceSchema);
export const consentRecordListDocumentSchema = listDocumentSchema(consentRecordResourceSchema);

export { consentRecordIdentifierSchema };

/** `GET /api/v1/connect/consent-records` (`connect-share-tokens:read`; C236.2). */
export const listConsentRecordsQuerySchema = listQuerySchema('cnsr', {
  'filter[subject-id]': filterListSchema(anyIdSchema).optional(),
  'filter[side]': connectSideSchema.optional(),
  'filter[status]': filterListSchema(
    consentRecordStatusSchema,
    CONSENT_RECORD_STATUSES.length,
  ).optional(),
  'filter[connection-id]': filterListSchema(idSchema('cxn')).optional(),
});
export type ListConsentRecordsQuery = z.infer<typeof listConsentRecordsQuerySchema>;

/**
 * `POST /api/v1/connect/consent-records` (`connect-consent-records:attest`; C236.5, decision 27):
 * an attested record. The subject is `subject-id` on the source side and `share-token-id` (a token
 * inbound to the caller) on the destination side. `attested-at` is at most
 * {@link ATTESTED_AT_MAX_AGE_DAYS} days old and not in the future, which the server checks on its
 * own clock. The server computes the text's digest and seals the text on the record.
 */
export const attestConsentRecordBodySchema = requestDocumentSchema(
  'consent-record',
  z
    .strictObject({
      side: connectSideSchema,
      'connection-id': idSchema('cxn'),
      'subject-id': z.union([idSchema('inq'), idSchema('acc'), idSchema('txn')]).optional(),
      'share-token-id': idSchema('cnst').optional(),
      'data-categories': shareCategoriesSchema.min(1),
      'explicit-biometric': z.boolean(),
      'expires-in-seconds': z.int().min(CONSENT_VALID_SECONDS.min).max(CONSENT_VALID_SECONDS.max),
      'evidence-reference': z.string().min(1).max(500).meta({ pii: true }),
      'attested-at': timestampSchema,
      'text-locale': consentLocaleSchema,
      'text-body': z.string().min(1).max(ATTESTED_TEXT_MAX_LENGTH).meta({ pii: true }),
    })
    .superRefine((attributes, ctx) => {
      const [wanted, refused] =
        attributes.side === CONNECT_SIDES[0]
          ? (['subject-id', 'share-token-id'] as const)
          : (['share-token-id', 'subject-id'] as const);
      if (attributes[wanted] === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `a ${attributes.side}-side record names its ${wanted}`,
          path: [wanted],
        });
      }
      if (attributes[refused] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `a ${attributes.side}-side record takes no ${refused}`,
          path: [refused],
        });
      }
    }),
);
export type AttestConsentRecordBody = z.infer<typeof attestConsentRecordBodySchema>;

/**
 * `POST /api/v1/connect/consent-records/:id/withdraw` (`connect-share-tokens:write`; C237.1), and
 * the console's action. A second withdrawal answers 409 `consent_already_withdrawn`.
 */
export const withdrawConsentRecordBodySchema = requestDocumentSchema(
  'consent-record',
  // Named as the resource names it: `reason` alone is a name every exit masks (a dismissal's).
  z.strictObject({ 'withdrawal-reason': consentWithdrawalReasonSchema.optional() }),
);
export type WithdrawConsentRecordBody = z.infer<typeof withdrawConsentRecordBodySchema>;

/** The path parameter of every consent-record route. */
export const consentRecordParamsSchema = z.strictObject({ id: idSchema('cnsr') });
