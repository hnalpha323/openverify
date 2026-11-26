/**
 * Workflow 9A Stage 1b, checkpoint (F): what `foundation-9a` builds in the API for the flow server
 * and the embed (C157.2, C158, C174.4, C174.7):
 *
 * - the internal embed-policy route, out of the public OpenAPI document, taking only the flow
 *   server's token (the previous one too, during a rotation), compared in constant time, counted by
 *   `internal-embed-policy` before any lookup, and answering 501 until `flow-server-embed` builds
 *   the lookup (`embedPolicyFor`);
 * - `OPENVERIFY_FLOW_SERVER_TOKEN` and `_PREVIOUS`, each at least 32 bytes, checked at startup;
 * - a `redirect-uri` on `POST /inquiries`, refused until `flow-server-embed` builds its check;
 * - the stubs of `services/embed-origins.ts` keeping today's behaviour.
 *
 * Every value is synthetic.
 */
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_POLICY_WINDOWS } from '@openverify/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { matchFlowServerToken } from './auth/flow-server-token.js';
import { ConfigError, loadConfig } from './config.js';
import type { RateLimiter } from './ports.js';
import * as embedOrigins from './services/embed-origins.js';
import { createInquiryTestApi, type InquiryTestApi } from './services/inquiries.test-support.js';
import { bearer, createTemplate } from './test-support/harness.js';
import { syntheticEnv } from './test-support/env.js';

vi.mock('./services/embed-origins.js', { spy: true });

const CURRENT = 'synthetic-flow-server-token-current-0123456789';
const PREVIOUS = 'synthetic-flow-server-token-previous-012345678';
const INQUIRY_ID = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const POLICY_URL = `/api/v1/internal/embed-policies/${INQUIRY_ID}`;

/** Refuses only the keys of `policy`; every other count passes, as Valkey would. */
function refusing(policy: string): RateLimiter {
  return {
    consume: (key, rule) =>
      Promise.resolve({
        allowed: !key.startsWith(`${policy}:`),
        limit: rule.limit,
        remaining: 0,
        resetAt: new Date(0),
        retryAfterSeconds: key.startsWith(`${policy}:`) ? 30 : 0,
      }),
  };
}

let api: InquiryTestApi;
let unconfigured: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi({ flowServerTokens: { current: CURRENT, previous: PREVIOUS } });
  unconfigured = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
  await unconfigured.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

const lookup = (target: InquiryTestApi, authorization?: string, url = POLICY_URL) =>
  target.app.inject({
    method: 'GET',
    url,
    headers: authorization === undefined ? {} : { authorization },
  });

describe('the internal embed-policy route (C157.2)', () => {
  it('is left out of the public OpenAPI document', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, unknown>;
    }>();

    expect(Object.keys(document.paths).filter((path) => path.includes('/internal/'))).toEqual([]);
  });

  it('answers 401 without the token, with another one, and on a server with none configured', async () => {
    const answers = [
      await lookup(api),
      await lookup(api, `Bearer ${CURRENT}x`),
      await lookup(api, CURRENT),
      await lookup(unconfigured, `Bearer ${CURRENT}`),
    ];

    expect(answers.map((answer) => answer.statusCode)).toEqual([401, 401, 401, 401]);
    expect(embedOrigins.embedPolicyFor).not.toHaveBeenCalled();
  });

  it('takes the current and the previous token and looks the inquiry up (404: no such inquiry)', async () => {
    const current = await lookup(api, `Bearer ${CURRENT}`);
    const previous = await lookup(api, `Bearer ${PREVIOUS}`);

    expect([current.statusCode, previous.statusCode]).toEqual([404, 404]);
    expect(embedOrigins.embedPolicyFor).toHaveBeenCalledWith(api.database.db, INQUIRY_ID);
  });

  it('refuses a malformed inquiry id with 400 and makes no lookup', async () => {
    const response = await lookup(
      api,
      `Bearer ${CURRENT}`,
      '/api/v1/internal/embed-policies/inq_not-an-id',
    );

    expect(response.statusCode).toBe(400);
    expect(embedOrigins.embedPolicyFor).not.toHaveBeenCalled();
  });

  it('is counted by internal-embed-policy, 6,000 a minute per token, before any lookup', async () => {
    // Read by name: the policy joins the contract in the GREEN commit.
    const policy = 'internal-embed-policy';
    expect((RATE_LIMIT_DEFAULTS as Readonly<Record<string, number>>)[policy]).toBe(6000);
    expect((RATE_LIMIT_POLICY_WINDOWS as Readonly<Record<string, number>>)[policy]).toBe(60);
    const limited = await createInquiryTestApi({
      flowServerTokens: { current: CURRENT, previous: null },
      rateLimiter: refusing('internal-embed-policy'),
    });
    try {
      const response = await lookup(limited, `Bearer ${CURRENT}`);

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('30');
      expect(embedOrigins.embedPolicyFor).not.toHaveBeenCalled();
    } finally {
      await limited.close();
    }
  });
});

describe("the flow server's token (C157.2, review P31)", () => {
  const tokens = { current: CURRENT, previous: PREVIOUS };

  it('names which configured token a request presented, and refuses anything else', () => {
    expect(matchFlowServerToken(`Bearer ${CURRENT}`, tokens)).toBe('current');
    expect(matchFlowServerToken(`Bearer ${PREVIOUS}`, tokens)).toBe('previous');
    expect(matchFlowServerToken(`Bearer ${PREVIOUS}`, { current: CURRENT, previous: null })).toBe(
      null,
    );
    for (const header of [
      undefined,
      '',
      CURRENT,
      `Basic ${CURRENT}`,
      `Bearer ${CURRENT.slice(0, -1)}`,
      `Bearer ${CURRENT} `,
      'Bearer ',
    ]) {
      expect(matchFlowServerToken(header, tokens), String(header)).toBe(null);
    }
    expect(matchFlowServerToken(`Bearer ${CURRENT}`, null)).toBe(null);
  });
});

describe('OPENVERIFY_FLOW_SERVER_TOKEN and _PREVIOUS (C174.7)', () => {
  const issuesOf = (env: NodeJS.ProcessEnv): readonly string[] => {
    try {
      loadConfig(env);
    } catch (error) {
      if (error instanceof ConfigError) {
        return error.issues;
      }
      throw error;
    }
    return [];
  };

  it('leaves the flow server unconfigured when the token is unset', () => {
    expect(loadConfig(syntheticEnv()).flowServerTokens).toBeNull();
  });

  it('reads the token and the previous one', () => {
    expect(
      loadConfig(
        syntheticEnv({
          OPENVERIFY_FLOW_SERVER_TOKEN: CURRENT,
          OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS: PREVIOUS,
        }),
      ).flowServerTokens,
    ).toEqual({ current: CURRENT, previous: PREVIOUS });
  });

  it('refuses a token shorter than 32 bytes, a previous token alone, and a placeholder in production', () => {
    expect(issuesOf(syntheticEnv({ OPENVERIFY_FLOW_SERVER_TOKEN: 'too-short' }))).toContainEqual(
      expect.stringMatching(/^OPENVERIFY_FLOW_SERVER_TOKEN: .*32/),
    );
    expect(
      issuesOf(
        syntheticEnv({
          OPENVERIFY_FLOW_SERVER_TOKEN: CURRENT,
          OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS: 'x',
        }),
      ),
    ).toContainEqual(expect.stringMatching(/^OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS: .*32/));
    expect(
      issuesOf(syntheticEnv({ OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS: PREVIOUS })),
    ).toContainEqual(
      expect.stringMatching(
        /^OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS: .*OPENVERIFY_FLOW_SERVER_TOKEN/,
      ),
    );
    const placeholder = 'change-me-flow-server-token-at-least-32-chars';
    expect(
      issuesOf(
        syntheticEnv({
          OPENVERIFY_MODE: 'production',
          OPENVERIFY_FLOW_SERVER_TOKEN: placeholder,
        }),
      ),
    ).toContainEqual(
      'OPENVERIFY_FLOW_SERVER_TOKEN: still holds a change-me placeholder; set a real secret',
    );
    expect(
      issuesOf(syntheticEnv({ OPENVERIFY_FLOW_SERVER_TOKEN: placeholder })).join('\n'),
    ).not.toContain(placeholder);
  });
});

describe('a redirect-uri on POST /inquiries (C158.4)', () => {
  it('is refused with redirect_uri_not_allowed until flow-server-embed builds its check, and nothing is created', async () => {
    const templateId = await createTemplate(api);
    const create = (attributes: Record<string, unknown>) =>
      api.app.inject({
        method: 'POST',
        url: '/api/v1/inquiries',
        headers: bearer(api.token),
        payload: { data: { attributes: { 'inquiry-template-id': templateId, ...attributes } } },
      });

    const refused = await create({ 'redirect-uri': 'https://shop.example.com/done' });
    const plain = await create({});

    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({
      code: 'redirect_uri_not_allowed',
      errors: [{ pointer: '/data/attributes/redirect-uri' }],
    });
    expect(refused.body).not.toContain('shop.example.com');
    expect(embedOrigins.checkInquiryRedirectUri).toHaveBeenCalledTimes(1);
    expect(plain.statusCode, plain.body).toBe(201);
  });
});

describe('the embed-origins functions, built by flow-server-embed (C158.4, C158.5)', () => {
  it('serve no redirect for an inquiry that names none, and no policy for an unknown inquiry', async () => {
    const inquiry = { id: INQUIRY_ID } as Parameters<
      typeof embedOrigins.redirectUrlFor
    >[1]['inquiry'];
    await expect(
      embedOrigins.redirectUrlFor(api.database.db, {
        inquiry,
        environmentKind: 'sandbox',
        status: 'completed',
      }),
    ).resolves.toBeNull();
    await expect(embedOrigins.embedPolicyFor(api.database.db, INQUIRY_ID)).resolves.toBeNull();
  });
});
