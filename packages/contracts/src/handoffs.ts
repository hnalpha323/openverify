/**
 * Device handoff (plan C96): moving a desktop flow to a phone by QR, or by email or SMS to a
 * destination the inquiry confirmed. Every flow route is session-authenticated except the
 * phone's preview, decline and redeem, which carry the `ovh_` token and answer every failure with
 * one uniform 410 `handoff_token_invalid` (P28).
 *
 * - `flowHandoffSchema` and `handoffContextSchema`: the `handoff` and `handoff-context` members of
 *   `GET /api/v1/flow/session` (F01, F30). The handoff state is kept per inquiry and step, not per
 *   session (V05): `redeemed`, `continued_here` and `skipped` are done; after `rejected` or
 *   `declined` the step shows again.
 * - The bodies and answers of `POST /flow/handoffs`, `/continue-here`, `/preview`, `/decline`,
 *   `/redeem`, `GET /flow/handoffs/current` and `POST /flow/handoffs/current/reject`.
 * - `SESSION_HANDOFF_ATTRIBUTE_SHAPE`: the handoff fields of the session the phone redeemed (C91.1,
 *   C96.4, C96.7).
 *
 * The destination of an email or SMS handoff is PII: used only to send, never stored (C96.3).
 */
import {
  DEVICE_HANDOFF_METHODS,
  STEP_TYPES,
  countryCodeSchema,
  stepIdSchema,
} from '@openverify/flow-spec';
import { z } from 'zod';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';
import { HANDOFF_TOKEN_PREFIX, handoffTokenSchema, sessionTokenSchema } from './tokens.js';

export const HANDOFF_METHODS = DEVICE_HANDOFF_METHODS;
export const handoffMethodSchema = z.enum(HANDOFF_METHODS);
export type HandoffMethod = z.infer<typeof handoffMethodSchema>;

/** C96.3 (V05): the state of an inquiry's handoff step. */
export const HANDOFF_STATES = [
  'pending',
  'issued',
  'redeemed',
  'continued_here',
  'skipped',
  'rejected',
  'declined',
] as const;
export const handoffStateSchema = z.enum(HANDOFF_STATES);
export type HandoffState = z.infer<typeof handoffStateSchema>;

/** C96.3 (F01): the states in which the web flow and the Android coordinator treat the step as done. */
export const HANDOFF_DONE_STATES: readonly HandoffState[] = Object.freeze([
  'redeemed',
  'continued_here',
  'skipped',
]);

/** Whether a handoff step in `state` is done (F01, V05). */
export function isHandoffDone(state: HandoffState): boolean {
  return HANDOFF_DONE_STATES.includes(state);
}

/**
 * C96.3: `GET /api/v1/flow/session` `handoff`, or `null` when the flow has no handoff step.
 * `handed-off` is `true` for the issuing session while the phone's session is active, so a reloaded
 * desktop stays on the step's waiting screen, where its writes are refused anyway; left out
 * otherwise.
 */
export const flowHandoffSchema = z.strictObject({
  'step-id': stepIdSchema,
  state: handoffStateSchema,
  'handed-off': z.boolean().optional(),
});
export type FlowHandoff = z.infer<typeof flowHandoffSchema>;

/** C96.1 (F30): the organisation name a phone shows, at most 100 characters (C107.7). */
export const organizationDisplayNameSchema = z.string().min(1).max(100);

/** C92.8: the DB-IP attribution line beside a country the context screen shows. */
const attributionSchema = z.string().min(1).max(200);

/**
 * C96.3 (F30): `handoff-context`, for a session created by a redemption: what the phone shows on
 * its context screen before any capture or collection.
 */
export const handoffContextSchema = z.strictObject({
  'organization-display-name': organizationDisplayNameSchema,
  /** The remaining step types, to say what will be verified. */
  steps: z.array(z.enum(STEP_TYPES)).max(64),
  'started-at': timestampSchema,
  /** The issuing session's country, when network data is configured; with its attribution. */
  'issuing-country-code': countryCodeSchema.nullable(),
  attribution: attributionSchema.nullable(),
});
export type HandoffContext = z.infer<typeof handoffContextSchema>;

/** C96.5: the six digits the desktop shows when `confirmationCode` is on. */
export const handoffConfirmationCodeSchema = z.string().regex(/^[0-9]{6}$/, 'must be six digits');

/** C96.3: an email or SMS destination: PII, used only to send, never stored. */
const destinationSchema = z.string().min(3).max(254).meta({ pii: true });

/** C96.3: `POST /api/v1/flow/handoffs` (session authentication). */
export const createHandoffBodySchema = z
  .strictObject({
    method: handoffMethodSchema,
    destination: destinationSchema.optional(),
  })
  .refine((body) => (body.method === 'qr') === (body.destination === undefined), {
    message: 'an email or SMS handoff names its destination; a QR handoff none',
    path: ['destination'],
  });
export type CreateHandoffBody = z.infer<typeof createHandoffBodySchema>;

/** The handoff id (`hnd_`), naming the issued token row; never the token. */
export const handoffIdSchema = idSchema('hnd');

const HANDOFF_FRAGMENT = new RegExp(
  `^#inquiry-id=inq_[0-7][0-9A-HJKMNP-TV-Z]{25}&handoff-token=${HANDOFF_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`,
);

/**
 * C96.3: the answer of `POST /api/v1/flow/handoffs`. A QR handoff carries the fragment the flow
 * builds the QR and the short link from (`#inquiry-id=<id>&handoff-token=ovh_…`); an email or SMS
 * handoff answers no token. C96.5 (Workflow 7A Stage 1b (H)): with `confirmationCode` on, the six
 * digits the desktop shows and the phone types; the server keeps only a digest over the token and
 * the code.
 */
export const createHandoffResponseSchema = z
  .strictObject({
    id: handoffIdSchema,
    method: handoffMethodSchema,
    'expires-at': timestampSchema,
    'url-fragment': z.string().regex(HANDOFF_FRAGMENT).optional(),
    'confirmation-code': handoffConfirmationCodeSchema.optional(),
  })
  .refine((answer) => (answer.method === 'qr') === (answer['url-fragment'] !== undefined), {
    message: 'only a QR handoff answers its fragment',
    path: ['url-fragment'],
  });
export type CreateHandoffResponse = z.infer<typeof createHandoffResponseSchema>;

/** `#inquiry-id=<id>&handoff-token=ovh_…`: the fragment of a handoff link (C96.3). */
export function handoffUrlFragment(inquiryId: string, handoffToken: string): string {
  const fragment = `#inquiry-id=${inquiryId}&handoff-token=${handoffToken}`;
  if (!HANDOFF_FRAGMENT.test(fragment)) {
    throw new TypeError('Malformed inquiry ID or handoff token');
  }
  return fragment;
}

/** The credentials of a handoff fragment, or `null` for any other fragment. */
export function parseHandoffFragment(
  hash: string,
): { inquiryId: string; handoffToken: string } | null {
  if (!HANDOFF_FRAGMENT.test(hash)) {
    return null;
  }
  const params = new URLSearchParams(hash.slice(1));
  return {
    inquiryId: params.get('inquiry-id') ?? '',
    handoffToken: params.get('handoff-token') ?? '',
  };
}

/** The token-bearing bodies of the phone's unauthenticated routes (C96.3). */
const tokenBody = {
  'inquiry-id': idSchema('inq'),
  'handoff-token': handoffTokenSchema,
};

/** C96.3 (P15): `POST /api/v1/flow/handoffs/preview`, which consumes nothing. */
export const previewHandoffBodySchema = z.strictObject({
  ...tokenBody,
  'confirmation-code': handoffConfirmationCodeSchema.optional(),
});

/**
 * C96.3 (P15, V16): the preview's answer. For a destination the inquiry never confirmed (only
 * with `confirmationCode` on), `context` is `null` until a correct code: only the organisation's
 * name and the method's advice are disclosed.
 */
export const previewHandoffResponseSchema = z.strictObject({
  'organization-display-name': organizationDisplayNameSchema,
  method: handoffMethodSchema,
  'confirmation-code-required': z.boolean(),
  context: handoffContextSchema.omit({ 'organization-display-name': true }).nullable(),
});
export type PreviewHandoffResponse = z.infer<typeof previewHandoffResponseSchema>;

/** C96.3 (V04): `POST /api/v1/flow/handoffs/decline`, the phone's decline before redemption. */
export const declineHandoffBodySchema = z.strictObject(tokenBody);

/** C96.3: `POST /api/v1/flow/handoffs/redeem`, on Continue, never at boot. */
export const redeemHandoffBodySchema = z.strictObject({
  ...tokenBody,
  'confirmation-code': handoffConfirmationCodeSchema.optional(),
});

/** The new session's token, which the phone keeps in memory only (as a redeemed one-time link). */
export const redeemHandoffResponseSchema = z.strictObject({
  'session-token': sessionTokenSchema,
  'expires-at': timestampSchema,
});

/** C96.3 (F01): `POST /api/v1/flow/handoffs/continue-here` takes no member. */
export const continueHandoffHereBodySchema = z.strictObject({});
/** C96.3 (P15, V02): `POST /api/v1/flow/handoffs/current/reject` ("this was not me"). */
export const rejectHandoffBodySchema = z.strictObject({});

/**
 * C96.3: `GET /api/v1/flow/handoffs/current` for the issuing session: the state and, after
 * redemption, when and the phone's OS and browser names only.
 */
export const currentHandoffResponseSchema = z
  .strictObject({
    status: handoffStateSchema,
    'redeemed-at': timestampSchema.nullable(),
    'os-name': z.string().min(1).max(64).nullable(),
    'browser-name': z.string().min(1).max(64).nullable(),
  })
  .refine(
    (answer) =>
      answer.status === 'redeemed' ||
      (answer['redeemed-at'] === null &&
        answer['os-name'] === null &&
        answer['browser-name'] === null),
    { message: 'only a redeemed handoff names its time and the phone', path: ['redeemed-at'] },
  );
export type CurrentHandoffResponse = z.infer<typeof currentHandoffResponseSchema>;

/**
 * C91.1, C96.4, C96.7: the handoff fields of an inquiry session. `device-handoff-method` is `qr` for
 * both the QR and its copied short link (they cannot be told apart); the distance facts compare
 * the phone with the issuing session (R-tier, review signals only; `null` when either side is
 * unknown, the distance without City Lite). `handoff-rejected-at` (C96.3) is when the desktop
 * said "this was not me", so a reviewer can read the rejected phone session as such.
 */
export const SESSION_HANDOFF_ATTRIBUTE_SHAPE = {
  'device-handoff-method': handoffMethodSchema.nullable(),
  'handoff-from-session-id': idSchema('iqse').nullable(),
  'handoff-redeemed-at': timestampSchema.nullable(),
  'handoff-rejected-at': timestampSchema.nullable(),
  'handoff-distance-meters': z.int().min(0).nullable(),
  'handoff-country-changed': z.boolean().nullable(),
  'handoff-asn-changed': z.boolean().nullable(),
} as const;

/** The handoff fields of a session, as the API records them. */
export interface SessionHandoffRecord {
  method: HandoffMethod | null;
  fromSessionId: string | null;
  redeemedAt: Date | null;
  rejectedAt: Date | null;
  distanceMeters: number | null;
  countryChanged: boolean | null;
  asnChanged: boolean | null;
}

/** The session attributes of {@link SESSION_HANDOFF_ATTRIBUTE_SHAPE}. */
export function sessionHandoffAttributes(record: SessionHandoffRecord): Record<string, unknown> {
  return {
    'device-handoff-method': record.method,
    'handoff-from-session-id': record.fromSessionId,
    'handoff-redeemed-at': record.redeemedAt === null ? null : record.redeemedAt.toISOString(),
    'handoff-rejected-at': record.rejectedAt === null ? null : record.rejectedAt.toISOString(),
    'handoff-distance-meters': record.distanceMeters,
    'handoff-country-changed': record.countryChanged,
    'handoff-asn-changed': record.asnChanged,
  };
}

/** C107.5: the handoff body members marked PII (the destination). */
export const PII_HANDOFF_ATTRIBUTES: readonly string[] = Object.freeze(['destination']);
