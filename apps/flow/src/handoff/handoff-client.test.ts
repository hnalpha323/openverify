/**
 * C96.3 (Workflow 7A): the phone's preview, decline and redemption. Each carries the `ovh_` token
 * in its JSON body and no other credential, and a refusal is the uniform 410.
 */
import { describe, expect, it, vi } from 'vitest';
import { FlowApiError } from '../api/flow-api-client';
import { INQUIRY_ID, SESSION_TOKEN } from '../testing/flow-fixtures';
import {
  HANDOFF_DECLINE_PATH,
  HANDOFF_PREVIEW_PATH,
  HANDOFF_REDEEM_PATH,
  declineHandoff,
  previewHandoff,
  redeemHandoff,
} from './handoff-client';

const BASE_URL = 'https://api.example.com';
const HANDOFF_TOKEN = `ovh_${'H'.repeat(43)}`;
const CREDENTIALS = { inquiryId: INQUIRY_ID, handoffToken: HANDOFF_TOKEN };
const PREVIEW = {
  'organization-display-name': 'Example Verification Ltd',
  method: 'qr',
  'confirmation-code-required': false,
  context: {
    steps: ['government_id', 'selfie'],
    'started-at': '2026-10-21T12:00:00.000Z',
    'issuing-country-code': null,
    attribution: null,
  },
};

function json(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

function stub(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    const next = responses.shift();
    return next === undefined
      ? Promise.reject(new Error('unexpected request'))
      : Promise.resolve(next);
  });
  return { options: { baseUrl: BASE_URL, fetch: fetchStub }, calls, fetch: fetchStub };
}

const bodyOf = (init: RequestInit) =>
  JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>;

describe('the phone’s handoff calls (C96.3)', () => {
  it('previews with the token in the body and no credential, and reads the context', async () => {
    const { options, calls } = stub(json(PREVIEW));

    expect(await previewHandoff(options, CREDENTIALS)).toEqual(PREVIEW);
    expect(calls[0]?.url).toBe(`${BASE_URL}${HANDOFF_PREVIEW_PATH}`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(new Headers(calls[0]?.init.headers).has('authorization')).toBe(false);
    expect(bodyOf(calls[0]?.init ?? {})).toEqual({
      'inquiry-id': INQUIRY_ID,
      'handoff-token': HANDOFF_TOKEN,
    });
  });

  it('sends the confirmation code when it is given', async () => {
    const { options, calls } = stub(
      json(PREVIEW),
      json({ 'session-token': SESSION_TOKEN, 'expires-at': '2026-10-21T12:00:00.000Z' }),
    );

    await previewHandoff(options, CREDENTIALS, '123456');
    const redeemed = await redeemHandoff(options, CREDENTIALS, '123456');

    expect(bodyOf(calls[0]?.init ?? {})).toMatchObject({ 'confirmation-code': '123456' });
    expect(calls[1]?.url).toBe(`${BASE_URL}${HANDOFF_REDEEM_PATH}`);
    expect(bodyOf(calls[1]?.init ?? {})).toMatchObject({ 'confirmation-code': '123456' });
    expect(redeemed).toEqual({
      sessionToken: SESSION_TOKEN,
      expiresAt: '2026-10-21T12:00:00.000Z',
    });
  });

  it('declines, reading the JSON null', async () => {
    const { options, calls } = stub(json(null));

    await expect(declineHandoff(options, CREDENTIALS)).resolves.toBeUndefined();
    expect(calls[0]?.url).toBe(`${BASE_URL}${HANDOFF_DECLINE_PATH}`);
  });

  it('surfaces the uniform 410 as an HTTP error', async () => {
    const { options } = stub(
      json(
        {
          type: 'about:blank',
          title: 'Gone',
          status: 410,
          detail: 'The handoff link is not valid or has expired.',
          instance: HANDOFF_REDEEM_PATH,
          requestId: 'req-1',
          code: 'handoff_token_invalid',
        },
        410,
        'application/problem+json',
      ),
    );

    const error = await redeemHandoff(options, CREDENTIALS).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FlowApiError);
    expect(error).toMatchObject({ status: 410 });
  });

  it('refuses malformed credentials without sending them', async () => {
    const { options, fetch } = stub();

    await expect(
      previewHandoff(options, { inquiryId: INQUIRY_ID, handoffToken: 'ovh_short' }),
    ).rejects.toThrow(TypeError);
    await expect(redeemHandoff(options, CREDENTIALS, '12')).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
