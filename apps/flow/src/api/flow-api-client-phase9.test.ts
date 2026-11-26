import { FLOW_SPEC_HEADER } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { extendedCapture, positionedSession, at } from '../testing/flow-renderer';
import {
  SESSION_TOKEN,
  VERIFICATION_IDS,
  fileResource,
  flowSession,
  pngFile,
} from '../testing/flow-fixtures';
import { createFlowApiClient, type FlowApiClient } from './flow-api-client';

// Workflow 9A (flow-renderer): the client calls of C148.5, C151.7, C153.2 and C171.4.

const BASE_URL = 'https://api.example.com';
const CAPTURE_ID = 'self_01M5CK3288G5K9T8DC51K68DDZ';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function clientAnswering(...bodies: unknown[]): { client: FlowApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...bodies];
  const fetchStub = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      init,
    });
    return Promise.resolve(
      new Response(JSON.stringify(queue.shift() ?? null), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  return {
    client: createFlowApiClient({
      baseUrl: BASE_URL,
      sessionToken: SESSION_TOKEN,
      fetch: fetchStub,
    }),
    calls,
  };
}

const headersOf = (call: Call | undefined) => new Headers(call?.init.headers);

describe('the flow-spec versions the web flow renders (C151.7)', () => {
  it('declares spec 1 and 2 on every request', async () => {
    const { client, calls } = clientAnswering(flowSession(), {
      consent: { 'accepted-at': '2026-10-20T12:00:00.000Z' },
    });

    await client.getSession();
    await client.acceptConsent({
      accepted: true,
      'text-keys': ['consent.biometric'],
      locale: 'en',
    });

    expect(calls.map((call) => headersOf(call).get(FLOW_SPEC_HEADER))).toEqual(['1, 2', '1, 2']);
  });
});

describe('submitScreen (C148.5)', () => {
  it('posts the values and the button key to the screen, and answers the session', async () => {
    const next = positionedSession({ position: at('done') });
    const { client, calls } = clientAnswering(next);

    const session = await client.submitScreen('about_you', {
      values: { name_first: 'Sam', age: 42 },
      button: 'skip',
    });

    expect(session).toEqual(next);
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/v1/flow/screens/about_you/submit`);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      values: { name_first: 'Sam', age: 42 },
      button: 'skip',
    });
    expect(headersOf(calls[0]).get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('refuses a step id that could change the path, before any request', async () => {
    const { client, calls } = clientAnswering();

    await expect(client.submitScreen('../consent', { values: {} })).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });
});

describe('extendSelfieCapture (C171.4)', () => {
  it('posts to the capture and answers it with its new expiry', async () => {
    const extended = extendedCapture(CAPTURE_ID, '2026-10-20T12:06:00.000Z');
    const { client, calls } = clientAnswering({ data: extended });

    await expect(client.extendSelfieCapture(CAPTURE_ID)).resolves.toEqual(extended);
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/v1/flow/selfie-captures/${CAPTURE_ID}/extend`);
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('refuses a malformed capture id, before any request', async () => {
    const { client, calls } = clientAnswering();

    await expect(client.extendSelfieCapture('self_x/../y')).rejects.toThrow(TypeError);
    expect(calls).toEqual([]);
  });
});

describe('the upload capture method (C153.2)', () => {
  it('sends the client-reported capture method before the file', async () => {
    const id = VERIFICATION_IDS.governmentId;
    const { client, calls } = clientAnswering({ data: fileResource(id, 'front') });

    await client.uploadFile(id, 'front', pngFile(), undefined, undefined, 'camera');

    const form = calls[0]?.init.body;
    expect(form).toBeInstanceOf(FormData);
    expect([...(form as FormData).keys()]).toEqual(['kind', 'capture-method', 'file']);
    expect((form as FormData).get('capture-method')).toBe('camera');
  });

  it('sends none when the step says nothing about it', async () => {
    const id = VERIFICATION_IDS.governmentId;
    const { client, calls } = clientAnswering({ data: fileResource(id, 'front') });

    await client.uploadFile(id, 'front', pngFile());

    expect([...(calls[0]?.init.body as FormData).keys()]).toEqual(['kind', 'file']);
  });
});

describe('getThemeAsset (C160.6, C160.9; Workflow 9B)', () => {
  it('reads a theme asset of the session’s environment with the session token', async () => {
    const calls: Call[] = [];
    const client = createFlowApiClient({
      baseUrl: BASE_URL,
      sessionToken: SESSION_TOKEN,
      fetch: vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
        return Promise.resolve(
          new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        );
      }),
    });

    const asset = await client.getThemeAsset('tsa_01M5CK16P0D13FXHZSS4TCFBVH');

    expect(calls[0]?.url).toBe(
      `${BASE_URL}/api/v1/flow/theme-assets/tsa_01M5CK16P0D13FXHZSS4TCFBVH`,
    );
    expect(headersOf(calls[0]).get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(asset.mediaType).toBe('image/png');
    expect(new Uint8Array(asset.bytes)[0]).toBe(0x89);
  });
});
