/**
 * C82.1, C82.4, C83: the `emailIntelligence` providers. `hibp` asks Have I Been Pwned's API v3
 * (`breachedaccount`, untruncated, the operator's key and a descriptive User-Agent) through the
 * outbound client, here against `MockAgent` with fixtures-6's synthetic answers; the sandbox calls
 * nothing and answers by the local part. Errors never carry the address or the key. Every address
 * is synthetic, under a reserved domain.
 */
import {
  hibpBreach,
  hibpBreachedAccountAnswer,
  hibpNotFoundAnswer,
  hibpRateLimitedAnswer,
  hibpUnauthorizedAnswer,
  type StubAnswer,
} from '@openverify/watchlist/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock, T0 } from '../../test-support/fakes.js';
import { createMockOutbound, type MockOutbound } from '../business-registry/testing.js';
import { ProviderError } from '../errors.js';
import { createEmailIntelligenceProvider, HIBP_API_ORIGIN } from './index.js';

const KEY = 'change-me-hibp-api-key';
const ADDRESS = 'pat+tag@synthetic-owner.example';
const PATH = `/api/v3/breachedaccount/${encodeURIComponent(ADDRESS)}?truncateResponse=false`;

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function hibp(answer: StubAnswer) {
  outbound = createMockOutbound();
  outbound.agent
    .get(HIBP_API_ORIGIN)
    .intercept({ path: PATH, method: 'GET' })
    .reply(answer.status, answer.body, { headers: answer.headers });
  return {
    outbound,
    provider: createEmailIntelligenceProvider('hibp', {
      credentials: {
        gdeltAcknowledged: false,
        hibp: { apiKey: KEY },
        twilioLookup: null,
        smarty: null,
      },
      outboundHttp: outbound,
      clock: fixedClock(),
    }),
  };
}

async function failureOf(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProviderError);
  expect(String(error) + JSON.stringify(error)).not.toMatch(/pat|synthetic-owner|change-me/u);
  return error as ProviderError;
}

describe('the hibp adapter (C82.1, C83)', () => {
  it('asks for the address’s untruncated breaches with the key and a User-Agent', async () => {
    const { provider, outbound: requests } = hibp(
      hibpBreachedAccountAnswer(
        [
          hibpBreach({ name: 'SyntheticForum', breachDate: '2026-03-02' }),
          hibpBreach({ name: 'SyntheticShop', breachDate: '2019-07-30' }),
        ],
        { truncate: false },
      ),
    );

    await expect(provider.breaches({ emailAddress: ADDRESS })).resolves.toEqual({
      breachCount: 2,
      latestBreachAt: new Date('2026-03-02T00:00:00.000Z'),
    });
    expect(provider).toMatchObject({ id: 'hibp', sandbox: false });
    const [sent] = requests.requests;
    expect(sent?.client).toBe('hibp');
    expect(sent?.request).toMatchObject({ method: 'GET', url: `${HIBP_API_ORIGIN}${PATH}` });
    expect(sent?.request.headers).toMatchObject({ 'hibp-api-key': KEY });
    expect(sent?.request.headers?.['user-agent']).toMatch(/^OpenVerify\b/u);
    expect(requests.clients[0]).toMatchObject({ name: 'hibp', contentTypes: ['application/json'] });
  });

  it('reads a 404 as no breach', async () => {
    const { provider } = hibp(hibpNotFoundAnswer());

    await expect(provider.breaches({ emailAddress: ADDRESS })).resolves.toEqual({
      breachCount: 0,
      latestBreachAt: null,
    });
  });

  it('keeps the count but no date when any breach is undated', async () => {
    const { provider } = hibp(
      hibpBreachedAccountAnswer(
        [
          hibpBreach({ name: 'One', breachDate: '2026-01-01' }),
          hibpBreach({ name: 'Two', breachDate: '' }),
        ],
        { truncate: false },
      ),
    );

    await expect(provider.breaches({ emailAddress: ADDRESS })).resolves.toEqual({
      breachCount: 2,
      latestBreachAt: null,
    });
  });

  it('fails a refused key for good, a rate limit and an outage for a retry', async () => {
    expect(
      await failureOf(hibp(hibpUnauthorizedAnswer()).provider.breaches({ emailAddress: ADDRESS })),
    ).toMatchObject({ retryable: false, code: 'hibp_unauthorized' });
    await outbound?.close();
    expect(
      await failureOf(hibp(hibpRateLimitedAnswer(2)).provider.breaches({ emailAddress: ADDRESS })),
    ).toMatchObject({ retryable: true, code: 'hibp_rate_limited' });
    await outbound?.close();
    expect(
      await failureOf(
        hibp({ status: 503, headers: {}, body: '' }).provider.breaches({ emailAddress: ADDRESS }),
      ),
    ).toMatchObject({ retryable: true, code: 'hibp_unavailable' });
  });

  it('refuses an answer that is not a list of breaches', async () => {
    const { provider } = hibp({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Name: 'NotAList' }),
    });

    expect(await failureOf(provider.breaches({ emailAddress: ADDRESS }))).toMatchObject({
      retryable: false,
      code: 'hibp_malformed',
    });
  });

  it('is never built without its key, naming the variable and not a value', () => {
    expect(() =>
      createEmailIntelligenceProvider('hibp', {
        credentials: { gdeltAcknowledged: false, hibp: null, twilioLookup: null, smarty: null },
        outboundHttp: createMockOutbound(),
      }),
    ).toThrow(/^hibp needs its key \(OPENVERIFY_HIBP_API_KEY\)$/u);
  });
});

describe('the sandbox email intelligence provider (C82.4)', () => {
  const provider = createEmailIntelligenceProvider('sandbox', { clock: fixedClock() });

  it('is labelled a sandbox and gives a breach 90 days ago for sandbox-breached', async () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
    await expect(
      provider.breaches({ emailAddress: 'kim.sandbox-breached@old.example' }),
    ).resolves.toEqual({
      breachCount: 1,
      latestBreachAt: new Date(T0.getTime() - 90 * 86_400_000),
    });
  });

  it('gives no breach for any other address, sandbox-spam included (no spam adapter)', async () => {
    for (const emailAddress of ['kim@old.example', 'kim.sandbox-spam@old.example']) {
      await expect(provider.breaches({ emailAddress })).resolves.toEqual({
        breachCount: 0,
        latestBreachAt: null,
      });
    }
  });

  it('reads the token in the local part only', async () => {
    await expect(
      provider.breaches({ emailAddress: 'kim@sandbox-breached.example' }),
    ).resolves.toMatchObject({ breachCount: 0 });
  });
});

describe('the hibp adapter without the outbound client', () => {
  it('fails its call for good', async () => {
    const provider = createEmailIntelligenceProvider('hibp', {
      credentials: {
        gdeltAcknowledged: false,
        hibp: { apiKey: KEY },
        twilioLookup: null,
        smarty: null,
      },
    });

    expect(await failureOf(provider.breaches({ emailAddress: ADDRESS }))).toMatchObject({
      retryable: false,
      code: 'hibp_not_configured',
    });
  });
});
