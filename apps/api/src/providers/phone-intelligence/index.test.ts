/**
 * C82.2, C82.4, C83: the `phoneIntelligence` providers. `twilio-lookup` asks Lookup v2 for the
 * line type and SIM swap packages with the operator's API key (HTTP Basic), here against
 * `MockAgent` with fixtures-6's synthetic answers; the sandbox calls nothing and answers NANP
 * fictional numbers (`+1 NPA 555 01xx`) by their last two digits. Each answer says what was
 * checked, so a date that is absent never reads as "no swap". Errors never carry the number or the
 * key. Every number is fictional.
 */
import {
  twilioErrorAnswer,
  twilioLookupAnswer,
  type StubAnswer,
} from '@openverify/watchlist/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock, T0 } from '../../test-support/fakes.js';
import { createMockOutbound, type MockOutbound } from '../business-registry/testing.js';
import { ProviderError } from '../errors.js';
import {
  createPhoneIntelligenceProvider,
  phoneIntelligenceLookupOf,
  TWILIO_LOOKUP_ORIGIN,
  type PhoneIntelligenceAnswer,
} from './index.js';

const NUMBER = '+12025550103';
const PATH = `/v2/PhoneNumbers/${encodeURIComponent(NUMBER)}?Fields=line_type_intelligence%2Csim_swap`;
const CREDENTIALS = {
  gdeltAcknowledged: false,
  hibp: null,
  twilioLookup: {
    accountSid: `AC${'0'.repeat(32)}`,
    apiKeySid: `SK${'0'.repeat(32)}`,
    apiKeySecret: 'change-me-lookup-secret',
  },
  smarty: null,
};
const HOUR_MS = 3_600_000;

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function lookup(answer: StubAnswer) {
  outbound = createMockOutbound();
  outbound.agent
    .get(TWILIO_LOOKUP_ORIGIN)
    .intercept({ path: PATH, method: 'GET' })
    .reply(answer.status, answer.body, { headers: answer.headers });
  return {
    outbound,
    provider: createPhoneIntelligenceProvider('twilio-lookup', {
      credentials: CREDENTIALS,
      outboundHttp: outbound,
      clock: fixedClock(),
    }),
  };
}

async function failureOf(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProviderError);
  expect(String(error) + JSON.stringify(error)).not.toMatch(/2025550103|change-me/u);
  return error as ProviderError;
}

const answerOf = (result: unknown) => result as PhoneIntelligenceAnswer;

describe('the twilio-lookup adapter (C82.2, C83)', () => {
  it('asks for line type and SIM swap with the API key, and says what each answered', async () => {
    const { provider, outbound: requests } = lookup(
      twilioLookupAnswer({
        phoneNumber: NUMBER,
        lineType: 'mobile',
        simSwap: { hoursAgo: 6 },
        now: T0,
      }),
    );

    const result = answerOf(await provider.lookup({ phoneNumber: NUMBER }));

    expect(provider).toMatchObject({ id: 'twilio-lookup', sandbox: false });
    expect(result.lookup).toEqual({
      lineType: 'mobile',
      carrier: 'Synthetic Test Carrier',
      simSwap: { checked: true, lastSwapAt: new Date(T0.getTime() - 6 * HOUR_MS) },
      porting: { checked: false },
    });
    expect(result).toMatchObject({
      carrier: 'Synthetic Test Carrier',
      lineType: 'mobile',
      simSwappedAt: new Date(T0.getTime() - 6 * HOUR_MS),
      portedAt: null,
      reachable: null,
    });
    const [sent] = requests.requests;
    expect(sent?.request).toMatchObject({ method: 'GET', url: `${TWILIO_LOOKUP_ORIGIN}${PATH}` });
    const basic = Buffer.from(
      `${CREDENTIALS.twilioLookup.apiKeySid}:${CREDENTIALS.twilioLookup.apiKeySecret}`,
    ).toString('base64');
    expect(sent?.request.headers).toMatchObject({ authorization: `Basic ${basic}` });
    expect(requests.clients[0]).toMatchObject({
      name: 'twilio-lookup',
      contentTypes: ['application/json'],
    });
  });

  it('says SIM swap was not checked when the package gave no date', async () => {
    const { provider } = lookup(
      twilioLookupAnswer({
        phoneNumber: NUMBER,
        lineType: 'landline',
        simSwap: { hoursAgo: null },
      }),
    );

    const result = answerOf(await provider.lookup({ phoneNumber: NUMBER }));

    expect(result.lookup.simSwap).toEqual({ checked: false });
    expect(result.lookup.lineType).toBe('landline');
  });

  it('says nothing was checked when neither package answered, or the number is not valid', async () => {
    const { provider } = lookup(
      twilioLookupAnswer({ phoneNumber: NUMBER, valid: false, lineType: null, simSwap: null }),
    );

    const result = answerOf(await provider.lookup({ phoneNumber: NUMBER }));

    expect(result.lookup).toEqual({
      lineType: null,
      carrier: null,
      simSwap: { checked: false },
      porting: { checked: false },
    });
  });

  it('keeps Lookup’s full line type for the rule, and the port’s narrower one', async () => {
    const { provider } = lookup(
      twilioLookupAnswer({ phoneNumber: NUMBER, lineType: 'tollFree', simSwap: null }),
    );

    const result = answerOf(await provider.lookup({ phoneNumber: NUMBER }));

    expect(result.lookup.lineType).toBe('tollFree');
    // The port has no toll-free type: it reads none, so the numbering plan's type stands.
    expect(result.lineType).toBeNull();
  });

  it('fails a refused key for good, a rate limit and an outage for a retry', async () => {
    expect(
      await failureOf(
        lookup(twilioErrorAnswer(401, 20003, 'Authenticate (synthetic)')).provider.lookup({
          phoneNumber: NUMBER,
        }),
      ),
    ).toMatchObject({ retryable: false, code: 'twilio_lookup_unauthorized' });
    await outbound?.close();
    expect(
      await failureOf(
        lookup(twilioErrorAnswer(429, 20429, 'Too many requests (synthetic)')).provider.lookup({
          phoneNumber: NUMBER,
        }),
      ),
    ).toMatchObject({ retryable: true, code: 'twilio_lookup_rate_limited' });
    await outbound?.close();
    expect(
      await failureOf(
        lookup({ status: 503, headers: {}, body: '' }).provider.lookup({ phoneNumber: NUMBER }),
      ),
    ).toMatchObject({ retryable: true, code: 'twilio_lookup_unavailable' });
  });

  it('refuses an answer that is not Lookup’s, for good', async () => {
    const { provider } = lookup({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ line_type_intelligence: 'not an object' }),
    });

    expect(await failureOf(provider.lookup({ phoneNumber: NUMBER }))).toMatchObject({
      retryable: false,
      code: 'twilio_lookup_malformed',
    });
  });

  it('is never built without its credentials, naming the variables and not a value', () => {
    expect(() =>
      createPhoneIntelligenceProvider('twilio-lookup', {
        credentials: { ...CREDENTIALS, twilioLookup: null },
      }),
    ).toThrow(
      /^twilio-lookup needs its credentials \(OPENVERIFY_TWILIO_LOOKUP_ACCOUNT_SID, _API_KEY_SID, _API_KEY_SECRET\)$/u,
    );
  });
});

describe('the sandbox phone intelligence provider (C82.4)', () => {
  const provider = createPhoneIntelligenceProvider('sandbox', { clock: fixedClock() });
  const sandbox = async (ending: string) =>
    answerOf(await provider.lookup({ phoneNumber: `+1202555${ending}` }));

  it('is labelled a sandbox and answers 00 as a mobile line with nothing recent', async () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
    const result = await sandbox('0100');

    expect(result.lookup).toEqual({
      lineType: 'mobile',
      carrier: 'Sandbox Carrier',
      simSwap: { checked: true, lastSwapAt: null },
      porting: { checked: true, lastPortedAt: null },
    });
    expect(result.reachable).toBe(true);
  });

  it('answers each magic ending as C82.4 lists it', async () => {
    expect((await sandbox('0101')).lookup.lineType).toBe('nonFixedVoip');
    expect((await sandbox('0102')).lookup.lineType).toBe('prepaid');
    expect((await sandbox('0103')).lookup.simSwap).toEqual({
      checked: true,
      lastSwapAt: new Date(T0.getTime() - 6 * HOUR_MS),
    });
    expect((await sandbox('0104')).lookup.porting).toEqual({
      checked: true,
      lastPortedAt: new Date(T0.getTime() - 10 * 24 * HOUR_MS),
    });
    const unreachable = await sandbox('0105');
    expect(unreachable.reachable).toBe(false);
    expect(unreachable.lookup.lineType).toBe('unknown');
    expect((await sandbox('0106')).lookup.lineType).toBe('fixedVoip');
  });

  it('checks nothing for any other number', async () => {
    for (const phoneNumber of ['+12025550107', '+12025550199', '+447700900123']) {
      const result = answerOf(await provider.lookup({ phoneNumber }));
      expect(result.lookup, phoneNumber).toEqual({
        lineType: null,
        carrier: null,
        simSwap: { checked: false },
        porting: { checked: false },
      });
      expect(result.reachable, phoneNumber).toBeNull();
    }
  });
});

describe('phoneIntelligenceLookupOf', () => {
  it('reads an answer that carries what was checked as it is', () => {
    const lookupOf = {
      lineType: 'pager',
      carrier: 'Carrier',
      simSwap: { checked: true, lastSwapAt: null },
      porting: { checked: false },
    } as const;
    expect(
      phoneIntelligenceLookupOf({
        carrier: 'Carrier',
        lineType: null,
        simSwappedAt: null,
        portedAt: null,
        reachable: null,
        lookup: lookupOf,
      }),
    ).toEqual(lookupOf);
  });

  it('reads a bare port answer conservatively: a date is checked, an absent one is not', () => {
    const swapped = new Date(T0.getTime() - HOUR_MS);
    expect(
      phoneIntelligenceLookupOf({
        carrier: null,
        lineType: 'fixedVoip',
        simSwappedAt: swapped,
        portedAt: null,
        reachable: null,
      }),
    ).toEqual({
      lineType: 'fixedVoip',
      carrier: null,
      simSwap: { checked: true, lastSwapAt: swapped },
      porting: { checked: false },
    });
  });
});
