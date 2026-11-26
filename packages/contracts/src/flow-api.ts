/**
 * Flow API (contract C3), called by `apps/flow` and the Android SDK with a session token.
 * Responses expose the flow and the user's own progress, never the template's check
 * configuration or fraud check details.
 */
import { idClassSchema, inquiryStatusSchema, type InquiryStatus } from '@openverify/core';
import {
  CAPTURE_METHODS,
  clientStepViewSchema,
  countryCodeSchema,
  flowProjectionSchema,
  flowSchema,
  i18nKeySchema,
  stepIdSchema,
} from '@openverify/flow-spec';
import { z } from 'zod';
import { connectSideSchema, organizationNameSchema } from './connect.js';
import { flowDecisionContestRouteSchema } from './decisions.js';
import { environmentKindSchema } from './environments.js';
import { CAPTURE_TRIGGERS, fileKindSchema } from './files.js';
import { flowSessionIntegritySchema } from './flow-integrity.js';
import { flowSessionSignalsSchema } from './flow-signals.js';
import { flowThemeSchema } from './flow-theme.js';
import {
  flowHandoffSchema,
  handoffContextSchema,
  organizationDisplayNameSchema,
} from './handoffs.js';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';
import { templateCopySchema, templateLocaleSchema } from './template-fields.js';
import {
  CLIENT_ELAPSED_MS_FIELD,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_NONCE_FIELD,
  clientElapsedMsFieldSchema,
  faceTemplateRetentionDaysSchema,
  selfieCaptureNonceSchema,
} from './selfie-captures.js';
import { oneTimeLinkTokenSchema, sessionTokenSchema } from './tokens.js';
import { flowVerificationResourceSchema } from './verifications.js';

export const flowSessionInquirySchema = z.strictObject({
  id: idSchema('inq'),
  status: inquiryStatusSchema,
});

export const flowConsentSchema = z.strictObject({ 'accepted-at': timestampSchema });

/**
 * C151.5 (Workflow 9A): where the inquiry is. `previous-step-id` names only a person-visible step
 * (never a branch or an action, review P14); `retry-after-ms` comes with `waiting`.
 */
export const FLOW_POSITION_STATES = ['active', 'waiting', 'halted', 'ended'] as const;
export const flowSessionPositionSchema = z.strictObject({
  'step-id': stepIdSchema.nullable(),
  state: z.enum(FLOW_POSITION_STATES),
  'previous-step-id': stepIdSchema.nullable(),
  'retry-after-ms': z.int().min(0).max(30_000).optional(),
});

/**
 * C151.5 (review P16): the values of the fields bound on the current screen only (or a verification
 * step's `prefillFrom` field). A `masked_text` or write-once value is never sent back: `{ set: true }`.
 */
export const flowSessionValueSchema = z.union([
  z.string().max(10_000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(10_000)).max(1000),
  z.strictObject({ set: z.literal(true) }),
]);

/**
 * C151.6 (decisions 2 and 73): the `flow` member. A Phase 9 server sends the v1 projection to every
 * client (`flowProjectionSchema`); the union keeps a v1 flow with its transitions valid while
 * `api-flow-engine` builds the projection, and `integration-9a` narrows it once it is served.
 */
export const flowSessionFlowSchema = z.union([flowProjectionSchema, flowSchema]);

/** C158.5: an `https:` URL or a custom scheme the version allows; never `javascript:` or `data:`. */
const redirectUrlSchema = z
  .string()
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return !['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:'].includes(
        url.protocol,
      );
    } catch {
      return false;
    }
  }, 'must be an allowed redirect URL');

/**
 * `GET /api/v1/flow/session`. The first call moves the inquiry from `created` to `pending`.
 * `verifications` lists every attempt, oldest first; `consent` is null until accepted.
 * `environment` (C19) lets sandbox show a banner and the selfie upload fallback; servers since
 * Phase 2 always send it.
 */
/**
 * C162.3 (Workflow 9B, (F); 9A Stage 3 amendment 47): the version's link fields, which a `link`
 * button names and the help slot shows after every step; `null` when the version sets none.
 */
export const flowSessionLinksSchema = z.strictObject({
  'help-url': z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable(),
  'privacy-url': z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable(),
});
export type FlowSessionLinks = z.infer<typeof flowSessionLinksSchema>;

/**
 * C237.6 (Phase 11, Workflow 11A; verification V02): one of this session's accepted, unwithdrawn
 * `share_consent` records, by the step that recorded it. Both clients render one "withdraw"
 * affordance per entry on every later step and on the completion screen. No token, connection or
 * consent-record id is served (C238.5).
 */
export const flowWithdrawableShareConsentSchema = z.strictObject({
  'step-id': stepIdSchema,
  side: connectSideSchema,
  'recipient-name': organizationNameSchema,
});
export type FlowWithdrawableShareConsent = z.infer<typeof flowWithdrawableShareConsentSchema>;

export const flowSessionResponseSchema = z.strictObject({
  inquiry: flowSessionInquirySchema,
  /** C151.6 (Workflow 9A): the v1 projection, for every client (`flowSessionFlowSchema`). */
  flow: flowSessionFlowSchema,
  verifications: z.array(flowVerificationResourceSchema),
  consent: flowConsentSchema.nullable(),
  environment: z.strictObject({ kind: environmentKindSchema }).optional(),
  /**
   * C42.3, C42.6: the environment's `face-template-retention-days`, which fills `{{days}}` in the
   * optional matching consent text. Servers since Phase 4 send it.
   */
  'face-template-retention-days': faceTemplateRetentionDaysSchema.optional(),
  /**
   * C94.6 (Phase 7): the collector tiers of this session once it may collect, `null` before
   * consent (and on a handoff session until it records its own). Servers since Workflow 7A send it.
   */
  signals: flowSessionSignalsSchema.nullable().optional(),
  /** C211.3 (Workflow 10B): whether the SDK asks its host's integrity provider for a token; absent or null when not. */
  integrity: flowSessionIntegritySchema.nullable().optional(),
  /**
   * C96.3 (Phase 7, F01, V05): the handoff step's state, kept per inquiry and step, or `null` when
   * the flow has no `device_handoff` step. Servers since Workflow 7A send it.
   */
  handoff: flowHandoffSchema.nullable().optional(),
  /** C96.3 (F30): for a session a redemption created, what the phone's context screen shows. */
  'handoff-context': handoffContextSchema.nullable().optional(),
  /**
   * C128.7 (a C3 amendment, Phase 8): how the person contests a decline. Served for a declined
   * inquiry whose decision record holds a route, and left out otherwise.
   */
  'decision-contest-route': flowDecisionContestRouteSchema.nullable().optional(),
  // C151.5-C151.8, C158.5, C159.4, C160.7, C162.6 (Workflow 9A; a C3 amendment): every member optional.
  position: flowSessionPositionSchema.optional(),
  /** The current step's client view, sent only to a client that declared spec 2 (C151.7). */
  step: clientStepViewSchema.optional(),
  values: z.record(z.string().max(64), flowSessionValueSchema).optional(),
  theme: flowThemeSchema.optional(),
  /** C162.6: the built-in overrides and the current step's component texts, per enabled locale. */
  copy: templateCopySchema.optional(),
  locales: z
    .strictObject({
      enabled: z.array(templateLocaleSchema).min(1).max(5),
      default: templateLocaleSchema,
    })
    .optional(),
  /** C159.4: the origins the embed bridge accepts a hello from. */
  embed: z.strictObject({ 'allowed-origins': z.array(z.string().max(300)).max(50) }).optional(),
  /** C158.5: the redirect, `null` when none is allowed. */
  completion: z.strictObject({ 'redirect-url': redirectUrlSchema.nullable() }).optional(),
  /** C151.7: the flow-spec version served. */
  'spec-version': z.union([z.literal(1), z.literal(2)]).optional(),
  /** C162.3 (Workflow 9B): the version's help and privacy links. Left out by earlier servers. */
  links: flowSessionLinksSchema.optional(),
  /**
   * C200.2, C221.12 (Workflow 10A Stage 1a; 10A decision 6): the environment's display name, served
   * NFC-normalised, which fills `{organization}` in operator copy and in the consent digests; `null`
   * when the environment sets none. Additive: no built-in text uses it. Left out by earlier servers.
   */
  'organization-display-name': organizationDisplayNameSchema.nullable().optional(),
  /**
   * C237.6 (Workflow 11A Stage 1a (K); V02): the session's withdrawable share consents, the one new
   * member of the session for Connect. Left out by earlier servers and when there is none.
   */
  'withdrawable-share-consents': z.array(flowWithdrawableShareConsentSchema).max(20).optional(),
});
export type FlowSessionResponse = z.infer<typeof flowSessionResponseSchema>;

/** BCP 47 language tag such as `en`, `es` or `es-419`. */
export const localeSchema = z
  .string()
  .max(35)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'must be a BCP 47 language tag');

/**
 * `POST /api/v1/flow/consent` body. The server records it with the user agent, IP and time;
 * uploads before consent get 409.
 */
export const flowConsentBodySchema = z.strictObject({
  accepted: z.literal(true),
  /** Keys of the consent texts the user was shown (the consent step's `textKeys`). */
  'text-keys': z.array(i18nKeySchema).min(1).max(20),
  /**
   * C42.3: the optional consent texts the user ticked (a subset of the step's
   * `optionalTextKeys`), such as `consent.biometric-matching`. Left out, none was.
   */
  'optional-text-keys': z.array(i18nKeySchema).max(20).optional(),
  locale: localeSchema,
  /**
   * C162.9 (reviews P04, H10, V01; Workflow 9A): the SHA-256 of each NFC-normalised text exactly as
   * shown (placeholders filled), in the order of `text-keys` then `optional-text-keys`; where its
   * copy came from; and the client's catalog version. The server checks them and stores none of
   * them; a client that sends none is not checked (the Android SDK computes and sends them,
   * `FlowCoordinator.kt`). KP11-73 (Workflow 11F).
   */
  'text-sha256': z
    .array(z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 digest'))
    .max(40)
    .optional(),
  'copy-source': z.enum(['custom', 'built-in']).optional(),
  'catalog-version': z
    .string()
    .regex(/^[0-9A-Za-z.+-]{1,40}$/, 'must be a catalog version')
    .optional(),
});
export type FlowConsentBody = z.infer<typeof flowConsentBodySchema>;

export const flowConsentResponseSchema = z.strictObject({ consent: flowConsentSchema });

/** `POST /api/v1/flow/verifications` body; the response is a flow verification document. */
export const createFlowVerificationBodySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('government-id'),
    country: countryCodeSchema.optional(),
    'id-class': idClassSchema.optional(),
  }),
  z.strictObject({ type: z.literal('selfie') }),
  // C52.2: every Phase 5 type is created by its type alone.
  z.strictObject({ type: z.literal('document') }),
  z.strictObject({ type: z.literal('database') }),
  z.strictObject({ type: z.literal('aamva') }),
  z.strictObject({ type: z.literal('phone-number') }),
  z.strictObject({ type: z.literal('email-address') }),
  z.strictObject({ type: z.literal('government-id-nfc') }),
  z.strictObject({ type: z.literal('crypto-wallet') }),
  z.strictObject({ type: z.literal('database-business') }),
  z.strictObject({ type: z.literal('business-website') }),
]);
export type CreateFlowVerificationBody = z.infer<typeof createFlowVerificationBodySchema>;

/**
 * Non-file multipart fields of `POST /api/v1/flow/verifications/:id/files`. The image goes in
 * the `file` field; its type is sniffed from its bytes (`detectImageMimeType`).
 */
export const flowFileUploadFieldsSchema = z.strictObject({
  kind: fileKindSchema,
  /** C40.3: the capture a selfie pose belongs to, its nonce, and the client's elapsed time. */
  [SELFIE_CAPTURE_ID_FIELD]: idSchema('self').optional(),
  [SELFIE_CAPTURE_NONCE_FIELD]: selfieCaptureNonceSchema.optional(),
  [CLIENT_ELAPSED_MS_FIELD]: clientElapsedMsFieldSchema.optional(),
  /** C153.2 (Workflow 9A): how the client says it captured the file; labelled client-reported. */
  'capture-method': z.enum(CAPTURE_METHODS).optional(),
  /** C206.2 (Workflow 10B): whether the shutter or the auto-capture fired; client-reported. */
  'capture-trigger': z.enum(CAPTURE_TRIGGERS).optional(),
});

/** Data that flow transition conditions (JSONLogic) are evaluated against. */
export interface FlowConditionContext {
  inquiry: { status: InquiryStatus };
}

/** Builds the condition context from the latest session response. */
export function flowConditionContext(session: FlowSessionResponse): FlowConditionContext {
  return { inquiry: { status: session.inquiry.status } };
}

/**
 * `POST /api/v1/flow/one-time-links/redeem` body (C10). No auth; rate-limited per IP. It
 * succeeds once; every failure answers the same generic 401.
 */
export const flowRedeemOneTimeLinkBodySchema = z.strictObject({
  'inquiry-id': idSchema('inq'),
  'one-time-token': oneTimeLinkTokenSchema,
});
export type FlowRedeemOneTimeLinkBody = z.infer<typeof flowRedeemOneTimeLinkBodySchema>;

/** The session token, which the client keeps in memory only. */
export const flowRedeemOneTimeLinkResponseSchema = z.strictObject({
  'session-token': sessionTokenSchema,
  'expires-at': timestampSchema,
});
export type FlowRedeemOneTimeLinkResponse = z.infer<typeof flowRedeemOneTimeLinkResponseSchema>;

// The share-consent exits (Phase 11, Workflow 11A Stage 1a (K); C238.4, C237.6) ------------------

/** The path parameter of the three share-consent exits, as the screen exit's (`:stepId`). */
export const flowShareConsentParamsSchema = z.strictObject({ stepId: stepIdSchema });

/**
 * `POST /api/v1/flow/share-consents/:stepId/accept` (the current step only, else 409
 * `flow_step_not_current`): the SHA-256 of the logical text the client displayed (and of the
 * biometric text, when one was served) and the separate biometric tick. The server compares the
 * digests with what it served at this position (422 `consent_text_mismatch`), requires the tick
 * when the share carries biometric data (422 `explicit_consent_required`), records the `flow`
 * consent record and answers the session at the next step; on the destination side it also starts
 * the client-side redemption (`fill-inquiry`) and the session waits until the job ends.
 */
export const flowShareConsentAcceptBodySchema = z.strictObject({
  'text-sha256': z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 digest'),
  'biometric-text-sha256': z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 digest')
    .optional(),
  'explicit-biometric': z.boolean(),
});
export type FlowShareConsentAcceptBody = z.infer<typeof flowShareConsentAcceptBodySchema>;

/**
 * `POST /api/v1/flow/share-consents/:stepId/decline` (the current step only): records a declined
 * `flow` record (C236.11) and continues the flow; declining never ends it.
 */
export const flowShareConsentDeclineBodySchema = z.strictObject({});

/**
 * `POST /api/v1/flow/share-consents/:stepId/withdraw` (C237.6): withdraws this session's accepted
 * record of a step listed in `withdrawable-share-consents` (else 409 `flow_step_not_current`), with
 * `withdrawn-via: flow`. The one flow action on a step already passed; it never moves the position,
 * and the answer is the session where it was.
 */
export const flowShareConsentWithdrawBodySchema = z.strictObject({});
