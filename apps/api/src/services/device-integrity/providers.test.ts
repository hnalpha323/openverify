/**
 * C211.4 (Workflow 10B, `api-integrity`): the two `deviceIntegrity` providers.
 *
 * - `sandbox` answers each magic token deterministically and refuses any other token.
 * - `play-integrity` signs an RS256 assertion with `node:crypto` for the operator's service account,
 *   trades it for an access token, posts the device's token to
 *   `playintegrity.googleapis.com/v1/<package>:decodeIntegrityToken` through the outbound client
 *   (15 s), checks the package name, the request hash, the timestamp within 10 minutes, the app
 *   recognition and the configured certificate digest, and keeps only C211.4's projection: a decoded
 *   payload carrying every optional member keeps none of them (review P12).
 *
 * Google is a fake outbound client here, in process: no test reaches the network. The service
 * account's key is generated for the run; every token is synthetic.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { SANDBOX_INTEGRITY_TOKENS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpClientOptions,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
} from '../../http/index.js';
import { fixedClock } from '../../test-support/fakes.js';
import {
  createDeviceIntegrityProvider,
  DeviceIntegrityDecodeError,
  sandboxVerdict,
} from './index.js';
import {
  createPlayIntegrityDecoder,
  projectPlayIntegrityVerdict,
  serviceAccountAssertion,
  type PlayIntegritySettings,
} from './play-integrity.js';
import { integrityVerdictProjectionSchema } from './projection.js';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const HASH = 'Q2hhbGxlbmdlLWhhc2gtZm9yLWEtc3ludGhldGljLXQ';
const PACKAGE = 'com.example.synthetic.app';
const DIGEST = 'c3ludGhldGljLWNlcnRpZmljYXRlLWRpZ2VzdC0wMDAx';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SETTINGS: PlayIntegritySettings = {
  packageName: PACKAGE,
  certificateDigests: [DIGEST],
  serviceAccount: {
    clientEmail: 'synthetic-decoder@example.com',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  },
};

describe('the sandbox provider (C211.4)', () => {
  const at = (token: string) => sandboxVerdict(token, NOW);

  it('answers every magic token with a projection, deterministically', () => {
    for (const token of SANDBOX_INTEGRITY_TOKENS) {
      const answer = at(token);
      expect(integrityVerdictProjectionSchema.parse(answer), token).toEqual(answer);
      expect(at(token)).toEqual(answer);
      expect(answer['decoded-at']).toBe(NOW.toISOString());
    }
  });

  it('gives each token its level, app recognition and checks', () => {
    expect(at('sandbox-strong')).toMatchObject({
      outcome: 'decoded',
      'device-recognition': [
        'MEETS_STRONG_INTEGRITY',
        'MEETS_DEVICE_INTEGRITY',
        'MEETS_BASIC_INTEGRITY',
      ],
      'app-recognition': 'PLAY_RECOGNIZED',
    });
    expect(at('sandbox-device')['device-recognition']).toEqual([
      'MEETS_DEVICE_INTEGRITY',
      'MEETS_BASIC_INTEGRITY',
    ]);
    expect(at('sandbox-basic')['device-recognition']).toEqual(['MEETS_BASIC_INTEGRITY']);
    expect(at('sandbox-none')).toMatchObject({
      'device-recognition': [],
      'app-recognition': 'UNEVALUATED',
    });
    expect(at('sandbox-unrecognized-app')).toMatchObject({
      'app-recognition': 'UNRECOGNIZED_VERSION',
      checks: { 'app-recognized': false, 'certificate-digest': false },
    });
    expect(at('sandbox-replayed').checks).toMatchObject({ 'request-hash': false });
    expect(at('sandbox-strong').checks).toEqual({
      'package-name': true,
      'request-hash': true,
      timestamp: true,
      'app-recognized': true,
      'certificate-digest': true,
    });
  });

  it('refuses any other token, without naming it', () => {
    let thrown: unknown;
    try {
      at('synthetic-unknown-token');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DeviceIntegrityDecodeError);
    expect(thrown).toMatchObject({ code: 'sandbox_token_unknown', retryable: false });
    expect(String(thrown)).not.toContain('synthetic-unknown-token');
  });

  it('is what createDeviceIntegrityProvider binds for the sandbox', async () => {
    const provider = createDeviceIntegrityProvider('sandbox', { clock: fixedClock(NOW) });

    expect(provider).toMatchObject({ id: 'sandbox', name: 'sandbox', sandbox: true });
    await expect(
      provider.decode({ token: 'sandbox-basic', requestHash: HASH }),
    ).resolves.toMatchObject({ 'device-recognition': ['MEETS_BASIC_INTEGRITY'] });
  });
});

/** A decoded payload carrying every member Play Integrity may send, optional ones included. */
function fullPayload(overrides: Record<string, unknown> = {}) {
  return {
    requestDetails: {
      requestPackageName: PACKAGE,
      requestHash: HASH,
      timestampMillis: String(NOW.getTime() - 30_000),
    },
    appIntegrity: {
      appRecognitionVerdict: 'PLAY_RECOGNIZED',
      packageName: PACKAGE,
      certificateSha256Digest: [DIGEST],
      versionCode: '4021',
    },
    deviceIntegrity: {
      deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'],
      recentDeviceActivity: { deviceActivityLevel: 'LEVEL_2' },
      deviceAttributes: { sdkVersion: 34 },
      legacyDeviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
    },
    accountDetails: { appLicensingVerdict: 'LICENSED' },
    environmentDetails: {
      playProtectVerdict: 'NO_ISSUES',
      appAccessRiskVerdict: { appsDetected: ['KNOWN_INSTALLED'] },
    },
    deviceRecall: { values: { bitFirst: true, bitSecond: false, bitThird: true } },
    testingDetails: { isTestingResponse: false },
    ...overrides,
  };
}

const expectation = {
  packageName: PACKAGE,
  certificateDigests: [DIGEST],
  requestHash: HASH,
  now: NOW,
};

describe('the play-integrity checks and projection (C211.4, review P12)', () => {
  it('keeps only the projection of a payload carrying every optional member', () => {
    const projection = projectPlayIntegrityVerdict(fullPayload(), expectation);

    expect(projection).toEqual({
      outcome: 'decoded',
      'device-recognition': ['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'],
      'app-recognition': 'PLAY_RECOGNIZED',
      checks: {
        'package-name': true,
        'request-hash': true,
        timestamp: true,
        'app-recognized': true,
        'certificate-digest': true,
      },
      'decoded-at': NOW.toISOString(),
    });
    const kept = JSON.stringify(projection);
    for (const dropped of [
      'LEVEL_2',
      'LICENSED',
      'NO_ISSUES',
      'KNOWN_INSTALLED',
      'bitFirst',
      'sdkVersion',
      '4021',
      DIGEST,
      PACKAGE,
      HASH,
    ]) {
      expect(kept).not.toContain(dropped);
    }
  });

  it('fails each check on its own field', () => {
    const checks = (payload: Record<string, unknown>) =>
      projectPlayIntegrityVerdict(payload, expectation).checks;
    const details = fullPayload().requestDetails;

    expect(
      checks(
        fullPayload({ requestDetails: { ...details, requestPackageName: 'com.example.other' } }),
      ),
    ).toMatchObject({ 'package-name': false });
    expect(
      checks(fullPayload({ requestDetails: { ...details, requestHash: 'A'.repeat(43) } })),
    ).toMatchObject({ 'request-hash': false });
    expect(
      checks(
        fullPayload({
          requestDetails: { ...details, timestampMillis: String(NOW.getTime() - 600_001) },
        }),
      ),
    ).toMatchObject({ timestamp: false });
    expect(
      checks(
        fullPayload({
          requestDetails: { ...details, timestampMillis: String(NOW.getTime() - 600_000) },
        }),
      ),
    ).toMatchObject({ timestamp: true });
    expect(
      checks(
        fullPayload({
          appIntegrity: { ...fullPayload().appIntegrity, appRecognitionVerdict: 'UNEVALUATED' },
        }),
      ),
    ).toMatchObject({ 'app-recognized': false });
    expect(
      checks(
        fullPayload({
          appIntegrity: { ...fullPayload().appIntegrity, certificateSha256Digest: ['b3RoZXI'] },
        }),
      ),
    ).toMatchObject({ 'certificate-digest': false });
  });

  it('reads a payload missing its members as failed checks and no label, never a pass', () => {
    expect(projectPlayIntegrityVerdict({}, expectation)).toEqual({
      outcome: 'decoded',
      'device-recognition': [],
      'app-recognition': null,
      checks: {
        'package-name': false,
        'request-hash': false,
        timestamp: false,
        'app-recognized': false,
        'certificate-digest': false,
      },
      'decoded-at': NOW.toISOString(),
    });
  });
});

describe('the service account assertion (C211.4)', () => {
  it('is an RS256 JWT for the play integrity scope, signed by the configured key', () => {
    const jwt = serviceAccountAssertion(SETTINGS.serviceAccount, NOW);
    const [header = '', claims = '', signature = ''] = jwt.split('.');
    const decode = (part: string) =>
      JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(claims)).toEqual({
      iss: 'synthetic-decoder@example.com',
      scope: 'https://www.googleapis.com/auth/playintegrity',
      aud: 'https://oauth2.googleapis.com/token',
      iat: NOW.getTime() / 1000,
      exp: NOW.getTime() / 1000 + 3600,
    });
    expect(
      createVerify('RSA-SHA256')
        .update(`${header}.${claims}`)
        .verify(publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true);
  });
});

/** Google, faked in process: the OAuth token endpoint and decodeIntegrityToken. */
function fakeGoogle(
  answers: {
    token?: () => OutboundHttpResponse;
    decode?: () => OutboundHttpResponse | Promise<OutboundHttpResponse>;
  } = {},
) {
  const calls: { client: OutboundHttpClientOptions; request: OutboundHttpRequest }[] = [];
  const json = (value: unknown): OutboundHttpResponse => ({
    status: 200,
    contentType: 'application/json',
    body: new TextEncoder().encode(JSON.stringify(value)),
  });
  const outboundHttp: OutboundHttp = {
    client: (client) => ({
      request: (request) => {
        calls.push({ client, request });
        if (request.url === 'https://oauth2.googleapis.com/token') {
          return Promise.resolve(
            answers.token?.() ??
              json({
                access_token: 'synthetic-access-token',
                expires_in: 3599,
                token_type: 'Bearer',
              }),
          );
        }
        return Promise.resolve(answers.decode?.() ?? json({ tokenPayloadExternal: fullPayload() }));
      },
    }),
    close: () => Promise.resolve(),
  };
  return { outboundHttp, calls };
}

describe('the play-integrity decode (C211.4)', () => {
  const DEVICE_TOKEN = 'synthetic-device-integrity-token';

  it('trades the assertion for an access token, then decodes through Google with it', async () => {
    const google = fakeGoogle();
    const decode = createPlayIntegrityDecoder(SETTINGS, google.outboundHttp, fixedClock(NOW));

    const projection = await decode({ token: DEVICE_TOKEN, requestHash: HASH });

    expect(projection).toMatchObject({ outcome: 'decoded', 'app-recognition': 'PLAY_RECOGNIZED' });
    const [oauth, decoded] = google.calls;
    expect(oauth?.request.method).toBe('POST');
    expect(oauth?.request.headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
    });
    const form = new URLSearchParams(String(oauth?.request.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('assertion')?.split('.')).toHaveLength(3);
    expect(decoded?.request).toMatchObject({
      method: 'POST',
      url: `https://playintegrity.googleapis.com/v1/${PACKAGE}:decodeIntegrityToken`,
      headers: { authorization: 'Bearer synthetic-access-token' },
    });
    expect(JSON.parse(String(decoded?.request.body))).toEqual({ integrityToken: DEVICE_TOKEN });
    for (const { client } of google.calls) {
      expect(client.timeoutMs).toBe(15_000);
      expect(client.allowPrivateNetworks).not.toBe(true);
      expect(client.allowPlainHttp).not.toBe(true);
    }
  });

  it('keeps the access token until it nearly expires', async () => {
    const google = fakeGoogle();
    const clock = fixedClock(NOW);
    const decode = createPlayIntegrityDecoder(SETTINGS, google.outboundHttp, clock);

    await decode({ token: DEVICE_TOKEN, requestHash: HASH });
    await decode({ token: DEVICE_TOKEN, requestHash: HASH });
    clock.advance(3_600_000);
    await decode({ token: DEVICE_TOKEN, requestHash: HASH });

    expect(google.calls.map(({ request }) => request.url.includes('oauth2'))).toEqual([
      true,
      false,
      false,
      true,
      false,
    ]);
  });

  it('retries a 5xx, a 429 or the network, and refuses a token Google refuses', async () => {
    const status = (code: number) => () => ({
      status: code,
      contentType: null,
      body: new Uint8Array(),
    });
    const failure = async (answers: Parameters<typeof fakeGoogle>[0]) => {
      const decode = createPlayIntegrityDecoder(
        SETTINGS,
        fakeGoogle(answers).outboundHttp,
        fixedClock(NOW),
      );
      return decode({ token: DEVICE_TOKEN, requestHash: HASH }).then(
        () => null,
        (error: unknown) => error,
      );
    };

    expect(await failure({ decode: status(503) })).toMatchObject({ retryable: true });
    expect(await failure({ decode: status(429) })).toMatchObject({ retryable: true });
    expect(await failure({ token: status(500) })).toMatchObject({ retryable: true });
    expect(
      await failure({
        decode: () => Promise.reject(new OutboundHttpError('play-integrity', 'timeout')),
      }),
    ).toMatchObject({ retryable: true });
    expect(await failure({ decode: status(400) })).toMatchObject({
      code: 'token_refused',
      retryable: false,
    });
    expect(await failure({ decode: status(403) })).toMatchObject({ retryable: false });
    const unreadable = await failure({
      decode: () => ({ status: 200, contentType: 'application/json', body: new Uint8Array([123]) }),
    });
    expect(unreadable).toMatchObject({ retryable: false });
    for (const error of [unreadable, await failure({ decode: status(400) })]) {
      expect(String(error)).not.toContain(DEVICE_TOKEN);
    }
  });

  it('is what createDeviceIntegrityProvider binds, and refuses without its settings', async () => {
    const google = fakeGoogle();
    const bound = createDeviceIntegrityProvider('play-integrity', {
      outboundHttp: google.outboundHttp,
      clock: fixedClock(NOW),
      playIntegrity: SETTINGS,
    });
    expect(bound).toMatchObject({ id: 'play-integrity', name: 'play-integrity', sandbox: false });
    await expect(bound.decode({ token: DEVICE_TOKEN, requestHash: HASH })).resolves.toMatchObject({
      outcome: 'decoded',
    });

    const unconfigured = createDeviceIntegrityProvider('play-integrity', {
      outboundHttp: google.outboundHttp,
      clock: fixedClock(NOW),
    });
    await expect(
      unconfigured.decode({ token: DEVICE_TOKEN, requestHash: HASH }),
    ).rejects.toMatchObject({ code: 'not_configured', retryable: false });
  });
});
