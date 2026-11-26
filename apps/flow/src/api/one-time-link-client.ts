/**
 * `POST /api/v1/flow/one-time-links/redeem` (contracts C10 and C19): trades a one-time link
 * for a session token. The request carries no credentials, because the one-time token in its
 * body is the credential. It succeeds once; every refusal is the same generic 401.
 *
 * The caller keeps the session token in memory only, never in storage or a URL.
 */
import {
  flowRedeemOneTimeLinkBodySchema,
  flowRedeemOneTimeLinkResponseSchema,
  type OneTimeLinkCredentials,
} from '@openverify/contracts';
import { createFlowTransport, type FlowTransportOptions } from './flow-transport';

export const REDEEM_PATH = '/api/v1/flow/one-time-links/redeem';

export interface RedeemedSession {
  readonly sessionToken: string;
  readonly expiresAt: string;
}

/**
 * Redeems a one-time link.
 * @throws {TypeError} for malformed credentials, without sending them (or echoing the token).
 * @throws {FlowApiError} when the request fails; a used, expired or unknown link is a 401.
 */
export async function redeemOneTimeLink(
  options: FlowTransportOptions,
  link: OneTimeLinkCredentials,
  signal?: AbortSignal,
): Promise<RedeemedSession> {
  const body = flowRedeemOneTimeLinkBodySchema.safeParse({
    'inquiry-id': link.inquiryId,
    'one-time-token': link.oneTimeToken,
  });
  if (!body.success) {
    throw new TypeError('Malformed one-time link');
  }
  const answer = await createFlowTransport(options).send(flowRedeemOneTimeLinkResponseSchema, {
    method: 'POST',
    path: REDEEM_PATH,
    json: body.data,
    signal,
  });
  return { sessionToken: answer['session-token'], expiresAt: answer['expires-at'] };
}
