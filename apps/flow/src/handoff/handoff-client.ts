/**
 * C96.3 (Workflow 7A): the phone's three handoff calls, made before it has a session: the preview
 * (`POST /api/v1/flow/handoffs/preview`, which consumes nothing), the decline (`/decline`) and the
 * redemption on Continue (`/redeem`). They carry no credentials: the `ovh_` token in the body is
 * the credential, and every refusal is the same 410 `handoff_token_invalid`. The caller keeps the
 * token and the redeemed session token in memory only; nothing here logs or stores either.
 */
import {
  declineHandoffBodySchema,
  previewHandoffBodySchema,
  previewHandoffResponseSchema,
  redeemHandoffBodySchema,
  redeemHandoffResponseSchema,
  type PreviewHandoffResponse,
} from '@openverify/contracts';
import { z } from 'zod';
import { createFlowTransport, type FlowTransportOptions } from '../api/flow-transport';
import type { HandoffFragment } from './handoff';

export const HANDOFF_PREVIEW_PATH = '/api/v1/flow/handoffs/preview';
export const HANDOFF_DECLINE_PATH = '/api/v1/flow/handoffs/decline';
export const HANDOFF_REDEEM_PATH = '/api/v1/flow/handoffs/redeem';

export interface RedeemedHandoff {
  readonly sessionToken: string;
  readonly expiresAt: string;
}

/** The body of a call, checked before anything is sent (a malformed one is never sent). */
function bodyOf<Schema extends z.ZodType>(
  schema: Schema,
  credentials: HandoffFragment,
  code: string | undefined,
): z.infer<Schema> {
  const parsed = schema.safeParse({
    'inquiry-id': credentials.inquiryId,
    'handoff-token': credentials.handoffToken,
    ...(code === undefined ? {} : { 'confirmation-code': code }),
  });
  if (!parsed.success) {
    throw new TypeError('Malformed handoff link or code');
  }
  return parsed.data;
}

/** The context screen's facts; with `code`, the code is checked too (a wrong one counts). */
export async function previewHandoff(
  options: FlowTransportOptions,
  credentials: HandoffFragment,
  code?: string,
  signal?: AbortSignal,
): Promise<PreviewHandoffResponse> {
  const json = bodyOf(previewHandoffBodySchema, credentials, code);
  return createFlowTransport(options).send(previewHandoffResponseSchema, {
    method: 'POST',
    path: HANDOFF_PREVIEW_PATH,
    json,
    signal,
  });
}

/** Declines the handoff before redemption; the desktop shows its step again. */
export async function declineHandoff(
  options: FlowTransportOptions,
  credentials: HandoffFragment,
  signal?: AbortSignal,
): Promise<void> {
  const json = bodyOf(declineHandoffBodySchema, credentials, undefined);
  await createFlowTransport(options).send(z.null(), {
    method: 'POST',
    path: HANDOFF_DECLINE_PATH,
    json,
    signal,
  });
}

/** Redeems the handoff for a new session token, once; sent on Continue only (P15). */
export async function redeemHandoff(
  options: FlowTransportOptions,
  credentials: HandoffFragment,
  code?: string,
  signal?: AbortSignal,
): Promise<RedeemedHandoff> {
  const json = bodyOf(redeemHandoffBodySchema, credentials, code);
  const answer = await createFlowTransport(options).send(redeemHandoffResponseSchema, {
    method: 'POST',
    path: HANDOFF_REDEEM_PATH,
    json,
    signal,
  });
  return { sessionToken: answer['session-token'], expiresAt: answer['expires-at'] };
}
