/**
 * Workflow 10B (`api-integrity`; C211.1, C211.3, C211.4): Play Integrity on the flow API.
 *
 * - `GET /flow/session` leaves `integrity` out where no `deviceIntegrity` provider is bound (off by
 *   default) and otherwise serves `{ request }`: true only after consent under the session-integrity
 *   tier that also showed `notice.play-integrity` (C211.9 at run time; Workflow 10D review A001),
 *   while the inquiry is in progress, has no verdict and took no token (one per inquiry).
 * - `POST /flow/integrity-challenges` draws a challenge only while the session asks: an `ich_` id,
 *   the `request-hash` (base64url of SHA-256 over `openverify/play-integrity/v1`, the session id and
 *   16 random bytes, drawn on the server) and an expiry 600 s on; otherwise 409
 *   `integrity_challenge_invalid`.
 * - `POST /flow/integrity-tokens` takes the token for the session's open challenge (202, no body),
 *   sealed for the challenge's row, once per inquiry, and enqueues the `integrity-decode` job with ids
 *   only once the token is committed; a challenge unknown, used, expired or another session's answers
 *   409 `integrity_challenge_invalid`. No answer echoes the token.
 *
 * Every token is synthetic; no test reaches a Google endpoint.
 */
import { createHash } from 'node:crypto';
import {
  defaultInquiryTemplateAttributes,
  flowIntegrityChallengeSchema,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { storeInquiryIntegrityVerdict } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeviceIntegrityProvider, IntegrityDecodeJob, ProviderBindings } from '../../ports.js';
import {
  INTEGRITY_CHALLENGE_TTL_SECONDS,
  INTEGRITY_REQUEST_HASH_CONTEXT,
  integrityRequestHash,
} from '../../services/device-integrity/challenges.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  resumeInquiry,
  type TestTenant,
} from '../../test-support/harness.js';

const NOTICE = 'notice.session-integrity';
/** C211.9: the notice that names Google as a recipient. */
const PLAY_NOTICE = 'notice.play-integrity';
/** The consent of a session that is asked for a token: both notices shown. */
const ASKED = ['consent.processing', NOTICE, PLAY_NOTICE];
const CHALLENGES = '/api/v1/flow/integrity-challenges';
const TOKENS = '/api/v1/flow/integrity-tokens';
const SYNTHETIC_TOKEN = 'synthetic-integrity-token-route-0001';

const sandboxProvider: DeviceIntegrityProvider = {
  id: 'sandbox',
  name: 'sandbox',
  sandbox: true,
  decode: () => Promise.reject(new Error('the route never decodes')),
};

const jobs: IntegrityDecodeJob[] = [];
let bound: InquiryTestApi;
let unbound: InquiryTestApi;
let elsewhere: TestTenant;

beforeAll(async () => {
  bound = await createInquiryTestApi({
    providers: {
      sandbox: { deviceIntegrity: sandboxProvider },
      production: {},
    } satisfies ProviderBindings,
    integrityDecodes: {
      enqueueIntegrityDecode: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
  });
  unbound = await createInquiryTestApi();
  elsewhere = await bound.newTenant();
});

afterAll(async () => {
  await bound.close();
  await unbound.close();
});

function templateWith(textKeys: string[]): DefaultInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.flow.steps = attributes.flow.steps.map((step) =>
    step.type === 'consent' ? { ...step, textKeys } : step,
  );
  return attributes;
}

interface Opened {
  inquiryId: string;
  sessionToken: string;
}

async function open(
  api: InquiryTestApi,
  textKeys: string[] = ASKED,
  token: string = api.token,
): Promise<Opened> {
  const templateId = await createTemplate(api, token, templateWith(textKeys));
  const inquiryId = await createInquiry(api, { token, templateId });
  return { inquiryId, sessionToken: await resumeInquiry(api, inquiryId, token) };
}

async function consent(api: InquiryTestApi, sessionToken: string, textKeys: string[] = ASKED) {
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(sessionToken),
      payload: { accepted: true, 'text-keys': textKeys, locale: 'en' },
    }),
    201,
  );
}

async function session(api: InquiryTestApi, sessionToken: string) {
  return expectStatus(
    await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
    200,
  ) as unknown as Record<string, unknown>;
}

const post = (api: InquiryTestApi, url: string, sessionToken: string, payload: unknown) =>
  api.app.inject({
    method: 'POST',
    url,
    headers: bearer(sessionToken),
    payload: payload as Record<string, unknown>,
  });

async function challengeFor(sessionToken: string) {
  return flowIntegrityChallengeSchema.parse(
    expectStatus(await post(bound, CHALLENGES, sessionToken, {}), 201),
  );
}

async function consented(): Promise<Opened> {
  const opened = await open(bound);
  await consent(bound, opened.sessionToken);
  await session(bound, opened.sessionToken);
  return opened;
}

function expectInvalid(response: { statusCode: number; body: string }) {
  expect(response.statusCode).toBe(409);
  expect(JSON.parse(response.body)).toMatchObject({
    status: 409,
    code: 'integrity_challenge_invalid',
  });
  expect(response.body).not.toContain(SYNTHETIC_TOKEN);
}

describe('the session member (C211.1, C211.3)', () => {
  it('is left out where no deviceIntegrity provider is bound', async () => {
    const { sessionToken } = await open(unbound);
    await consent(unbound, sessionToken);

    expect(await session(unbound, sessionToken)).not.toHaveProperty('integrity');
  });

  it('asks for a token only after consent under the session-integrity tier', async () => {
    const { sessionToken } = await open(bound);
    expect(await session(bound, sessionToken)).toMatchObject({ integrity: { request: false } });

    await consent(bound, sessionToken);

    expect(await session(bound, sessionToken)).toMatchObject({ integrity: { request: true } });
  });

  it('never asks a session whose consent did not show the session-integrity notice', async () => {
    const { sessionToken } = await open(bound, ['consent.processing']);
    await consent(bound, sessionToken, ['consent.processing']);

    expect(await session(bound, sessionToken)).toMatchObject({ integrity: { request: false } });
  });

  it('never asks a session whose consent did not show the notice naming Google (A001)', async () => {
    const keys = ['consent.processing', NOTICE];
    const { sessionToken } = await open(bound, keys);
    await consent(bound, sessionToken, keys);

    expect(await session(bound, sessionToken)).toMatchObject({ integrity: { request: false } });
  });

  it('asks a session whose consent showed both notices', async () => {
    const keys = ['consent.processing', NOTICE, PLAY_NOTICE];
    const { sessionToken } = await open(bound, keys);
    await consent(bound, sessionToken, keys);

    expect(await session(bound, sessionToken)).toMatchObject({ integrity: { request: true } });
  });

  it('stops asking once the inquiry has a verdict', async () => {
    const { inquiryId, sessionToken } = await consented();
    await storeInquiryIntegrityVerdict(bound.database.db, bound.environmentId, {
      inquiryId,
      provider: 'sandbox',
      verdict: { outcome: 'decoded' },
      decodedAt: bound.clock.now(),
    });

    expect(await session(bound, sessionToken)).toMatchObject({ integrity: { request: false } });
  });
});

describe('POST /api/v1/flow/integrity-challenges (C211.3)', () => {
  it('draws a challenge bound to the session, expiring in 600 s', async () => {
    const { sessionToken } = await consented();

    const first = await challengeFor(sessionToken);
    const second = await challengeFor(sessionToken);

    expect(first.id).toMatch(/^ich_/);
    expect(first['request-hash']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second['request-hash']).not.toBe(first['request-hash']);
    expect(Date.parse(first['expires-at'])).toBe(
      bound.clock.now().getTime() + INTEGRITY_CHALLENGE_TTL_SECONDS * 1000,
    );
    const rows = await bound.database.client.query<{ session_id: string; request_hash: string }>(
      'select session_id, request_hash from inquiry_integrity_challenges where id = $1',
      [first.id],
    );
    expect(rows.rows[0]?.request_hash).toBe(first['request-hash']);
    expect(rows.rows[0]?.session_id).toMatch(/^iqse_/);
  });

  it('answers 409 where nothing is bound, before consent, and once the inquiry took a token', async () => {
    const unboundSession = await open(unbound);
    await consent(unbound, unboundSession.sessionToken);
    expectInvalid(await post(unbound, CHALLENGES, unboundSession.sessionToken, {}));

    const early = await open(bound);
    expectInvalid(await post(bound, CHALLENGES, early.sessionToken, {}));

    const { sessionToken } = await consented();
    const challenge = await challengeFor(sessionToken);
    expect(
      (
        await post(bound, TOKENS, sessionToken, {
          'challenge-id': challenge.id,
          token: SYNTHETIC_TOKEN,
        })
      ).statusCode,
    ).toBe(202);
    expectInvalid(await post(bound, CHALLENGES, sessionToken, {}));
  });
});

describe('POST /api/v1/flow/integrity-challenges without the notice naming Google (A001)', () => {
  it('answers 409 and stores no challenge, whatever the session read said', async () => {
    const keys = ['consent.processing', NOTICE];
    const { inquiryId, sessionToken } = await open(bound, keys);
    await consent(bound, sessionToken, keys);

    expectInvalid(await post(bound, CHALLENGES, sessionToken, {}));

    const rows = await bound.database.client.query<{ id: string }>(
      'select id from inquiry_integrity_challenges where inquiry_id = $1',
      [inquiryId],
    );
    expect(rows.rows).toEqual([]);
  });
});

describe('POST /api/v1/flow/integrity-tokens (C211.3, C211.4)', () => {
  it('takes the token once, sealed, and enqueues the decode with ids only', async () => {
    const { inquiryId, sessionToken } = await consented();
    const challenge = await challengeFor(sessionToken);
    const before = jobs.length;

    const response = await post(bound, TOKENS, sessionToken, {
      'challenge-id': challenge.id,
      token: SYNTHETIC_TOKEN,
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('null');
    expect(jobs.slice(before)).toEqual([
      { environmentId: bound.environmentId, challengeId: challenge.id },
    ]);
    const row = await bound.database.client.query<{ token: string }>(
      'select token from inquiry_integrity_challenges where id = $1',
      [challenge.id],
    );
    expect(row.rows[0]?.token).toMatch(/^ov1\./);
    expect(row.rows[0]?.token).not.toContain(SYNTHETIC_TOKEN);
    expectInvalid(
      await post(bound, TOKENS, sessionToken, {
        'challenge-id': challenge.id,
        token: SYNTHETIC_TOKEN,
      }),
    );
    expect(await session(bound, sessionToken)).toMatchObject({ integrity: { request: false } });
    expect(jobs.slice(before)).toHaveLength(1);
    expect(inquiryId).toMatch(/^inq_/);
  });

  it('refuses an unknown, expired or other session’s challenge with one answer', async () => {
    const { sessionToken } = await consented();
    const other = await consented();
    const mine = await challengeFor(sessionToken);
    const theirs = await challengeFor(other.sessionToken);

    const unknown = await post(bound, TOKENS, sessionToken, {
      'challenge-id': 'ich_01M5CK16P0D13FXHZSS4TCFBVH',
      token: SYNTHETIC_TOKEN,
    });
    expectInvalid(unknown);
    expect(JSON.parse(unknown.body)).toMatchObject({
      detail:
        'The integrity challenge is unknown, used or expired; the session may ask for a new one.',
    });
    expectInvalid(
      await post(bound, TOKENS, sessionToken, {
        'challenge-id': theirs.id,
        token: SYNTHETIC_TOKEN,
      }),
    );
    bound.clock.advance(INTEGRITY_CHALLENGE_TTL_SECONDS * 1000);
    try {
      expectInvalid(
        await post(bound, TOKENS, sessionToken, {
          'challenge-id': mine.id,
          token: SYNTHETIC_TOKEN,
        }),
      );
    } finally {
      bound.clock.advance(-INTEGRITY_CHALLENGE_TTL_SECONDS * 1000);
    }
  });

  it("refuses another environment's session its challenge", async () => {
    const { sessionToken } = await consented();
    const challenge = await challengeFor(sessionToken);
    const theirs = await open(bound, ASKED, elsewhere.token);
    await consent(bound, theirs.sessionToken);

    expectInvalid(
      await post(bound, TOKENS, theirs.sessionToken, {
        'challenge-id': challenge.id,
        token: SYNTHETIC_TOKEN,
      }),
    );
  });
});

describe('the request hash (C211.3)', () => {
  it('is base64url, unpadded, of SHA-256 over the context, the session id and the nonce', () => {
    const nonce = new Uint8Array(16).fill(7);
    const expected = createHash('sha256')
      .update(`${INTEGRITY_REQUEST_HASH_CONTEXT}\n`)
      .update('iqse_01M5CK16P0D13FXHZSS4TCFBVH\n')
      .update(nonce)
      .digest('base64url');

    expect(integrityRequestHash('iqse_01M5CK16P0D13FXHZSS4TCFBVH', nonce)).toBe(expected);
    expect(expected).toHaveLength(43);
    expect(integrityRequestHash('iqse_01M5CK16P0D13FXHZSS4TCFBVJ', nonce)).not.toBe(expected);
  });
});
