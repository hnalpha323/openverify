/**
 * C211.4 (Workflow 10B, `api-integrity`): the `play-integrity` provider: our REST client over the
 * outbound client, no Google library (owner decision P3: OpenVerify ships no Google code).
 *
 * 1. **The access token.** An RS256 JWT signed with `node:crypto` for the operator's service account
 *    (scope `playintegrity`, audience Google's token endpoint, an hour), traded at
 *    `oauth2.googleapis.com/token` for an access token kept until a minute before it expires. The
 *    endpoints are fixed, never read from the key file, so a key never signs for another host.
 * 2. **The decode.** `POST playintegrity.googleapis.com/v1/<package>:decodeIntegrityToken` with the
 *    device's token, through the outbound client: 15 s, no redirect followed, HTTPS only, public
 *    addresses only. It runs in the `integrity-decode` job, never in a request.
 * 3. **The checks** (C211.4): `requestPackageName` is the configured package; `requestHash` is the
 *    challenge's; `timestampMillis` lies within 10 minutes of now; `appRecognitionVerdict` is
 *    `PLAY_RECOGNIZED`; a certificate digest of `appIntegrity` is one the operator configured.
 * 4. **The projection** (`projection.ts`): only the device labels, the app recognition, the five
 *    booleans and the decode time are kept; every other member is dropped here and never stored or
 *    logged (review P12).
 *
 * Failures carry a code only, never the token or an answer's body: `retryable` for the network, a
 * timeout, a 5xx or a 429 (the job retries); not for a 4xx (the token or the credentials were
 * refused) or an unreadable answer (the job stores a failed decode).
 */
import { createSign } from 'node:crypto';
import type { IntegrityVerdictProjection } from '@openverify/checks';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpResponse,
} from '../../http/index.js';
import type { Clock, DeviceIntegrityDecodeRequest } from '../../ports.js';
import { DeviceIntegrityDecodeError } from './errors.js';
import { knownAppRecognition, knownDeviceLabels } from './projection.js';

/** C211.4: what the operator configures for `play-integrity` (`OPENVERIFY_PLAY_INTEGRITY_*`). */
export interface PlayIntegritySettings {
  /** The host app's package name, which every token must name. */
  packageName: string;
  /** The host app's signing certificate digests (SHA-256, as Play Integrity encodes them). */
  certificateDigests: readonly string[];
  /** The operator's service account: its e-mail and its RSA private key (PEM); a secret. */
  serviceAccount: { clientEmail: string; privateKey: string };
}

/** What the provider checks a decoded token against. */
export interface PlayIntegrityExpectation {
  packageName: string;
  certificateDigests: readonly string[];
  requestHash: string;
  now: Date;
}

/** Google's OAuth token endpoint, the assertion's audience. */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** The Play Integrity API's scope. */
export const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
/** The Play Integrity API. */
export const PLAY_INTEGRITY_API = 'https://playintegrity.googleapis.com/v1';
/** C211.4: each call's deadline. */
export const PLAY_INTEGRITY_TIMEOUT_MS = 15_000;
/** C211.4: how far a token's timestamp may lie from now. */
export const PLAY_INTEGRITY_TIMESTAMP_WINDOW_MS = 10 * 60 * 1000;
/** The assertion's lifetime, Google's maximum. */
const ASSERTION_SECONDS = 3600;
/** An access token is renewed this long before it expires. */
const RENEW_BEFORE_MS = 60_000;
/** Google's answers are small; a larger one is refused. */
const MAX_RESPONSE_BYTES = 64 * 1024;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** C211.4: the five checks and the fixed projection of a decoded payload (`tokenPayloadExternal`). */
export function projectPlayIntegrityVerdict(
  payload: unknown,
  expectation: PlayIntegrityExpectation,
): IntegrityVerdictProjection {
  const decoded = record(payload);
  const request = record(decoded.requestDetails);
  const app = record(decoded.appIntegrity);
  const device = record(decoded.deviceIntegrity);
  const timestamp = Number(request.timestampMillis);
  const appRecognition = knownAppRecognition(app.appRecognitionVerdict);
  const digests = Array.isArray(app.certificateSha256Digest) ? app.certificateSha256Digest : [];
  return {
    outcome: 'decoded',
    'device-recognition': knownDeviceLabels(device.deviceRecognitionVerdict),
    'app-recognition': appRecognition,
    checks: {
      'package-name': request.requestPackageName === expectation.packageName,
      'request-hash': request.requestHash === expectation.requestHash,
      timestamp:
        Number.isFinite(timestamp) &&
        Math.abs(expectation.now.getTime() - timestamp) <= PLAY_INTEGRITY_TIMESTAMP_WINDOW_MS,
      'app-recognized': appRecognition === 'PLAY_RECOGNIZED',
      'certificate-digest': digests.some(
        (digest) => typeof digest === 'string' && expectation.certificateDigests.includes(digest),
      ),
    },
    'decoded-at': expectation.now.toISOString(),
  };
}

const base64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

/** C211.4: the OAuth assertion of the service account (RS256, `node:crypto`). */
export function serviceAccountAssertion(
  account: PlayIntegritySettings['serviceAccount'],
  now: Date,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: PLAY_INTEGRITY_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat,
      exp: iat + ASSERTION_SECONDS,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.privateKey);
  return `${header}.${claims}.${base64url(signature)}`;
}

/** A non-2xx answer as a decode error: 5xx and 429 may pass, any other refusal will not. */
function refusal(stage: 'oauth' | 'decode', status: number): DeviceIntegrityDecodeError {
  if (status >= 500 || status === 429) {
    return new DeviceIntegrityDecodeError(`${stage}_unavailable`, true);
  }
  if (stage === 'decode' && status === 400) {
    return new DeviceIntegrityDecodeError('token_refused', false);
  }
  return new DeviceIntegrityDecodeError(`${stage}_refused`, false);
}

function jsonOf(response: OutboundHttpResponse, stage: 'oauth' | 'decode'): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(response.body)) as unknown;
  } catch {
    throw new DeviceIntegrityDecodeError(`${stage}_unreadable`, false);
  }
}

/** C211.4: the decode through Google's endpoint, through the outbound client. */
export function createPlayIntegrityDecoder(
  settings: PlayIntegritySettings,
  outboundHttp: OutboundHttp,
  clock: Clock,
): (request: DeviceIntegrityDecodeRequest) => Promise<IntegrityVerdictProjection> {
  const client = outboundHttp.client({
    name: 'play-integrity',
    contentTypes: ['application/json'],
    maxResponseBytes: MAX_RESPONSE_BYTES,
    timeoutMs: PLAY_INTEGRITY_TIMEOUT_MS,
  });
  let access: { token: string; renewAt: number } | null = null;

  const send = async (
    stage: 'oauth' | 'decode',
    request: Parameters<typeof client.request>[0],
  ): Promise<unknown> => {
    let response: OutboundHttpResponse;
    try {
      response = await client.request(request);
    } catch (error) {
      throw new DeviceIntegrityDecodeError(
        `${stage}_unavailable`,
        error instanceof OutboundHttpError ? error.retryable : true,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw refusal(stage, response.status);
    }
    return jsonOf(response, stage);
  };

  const accessToken = async (): Promise<string> => {
    const now = clock.now();
    if (access !== null && now.getTime() < access.renewAt) {
      return access.token;
    }
    const answer = record(
      await send('oauth', {
        method: 'POST',
        url: GOOGLE_TOKEN_URL,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: serviceAccountAssertion(settings.serviceAccount, now),
        }).toString(),
      }),
    );
    const token = answer.access_token;
    const expiresIn = Number(answer.expires_in);
    if (typeof token !== 'string' || token === '' || !Number.isFinite(expiresIn)) {
      throw new DeviceIntegrityDecodeError('oauth_unreadable', false);
    }
    access = { token, renewAt: now.getTime() + expiresIn * 1000 - RENEW_BEFORE_MS };
    return token;
  };

  return async ({ token, requestHash }) => {
    const bearer = await accessToken();
    const answer = record(
      await send('decode', {
        method: 'POST',
        url: `${PLAY_INTEGRITY_API}/${encodeURIComponent(settings.packageName)}:decodeIntegrityToken`,
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({ integrityToken: token }),
      }),
    );
    if (typeof answer.tokenPayloadExternal !== 'object' || answer.tokenPayloadExternal === null) {
      throw new DeviceIntegrityDecodeError('decode_unreadable', false);
    }
    return projectPlayIntegrityVerdict(answer.tokenPayloadExternal, {
      packageName: settings.packageName,
      certificateDigests: settings.certificateDigests,
      requestHash,
      now: clock.now(),
    });
  };
}
