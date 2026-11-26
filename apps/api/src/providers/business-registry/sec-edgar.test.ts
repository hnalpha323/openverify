/**
 * C61.1, C61.2: SEC EDGAR against `MockAgent`, with synthetic answers shaped like `data.sec.gov`'s
 * submissions and `company_tickers.json`: US only; a numeric registration number is the CIK, else
 * the closest listed company by name; never authoritative, no status and no persons; the
 * operator's User-Agent on every request; the tickers kept in memory for a day; the pacing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { BusinessRegistryRequest } from '../../ports.js';
import { fixedClock, type TestClock } from '../../test-support/fakes.js';
import { ProviderError } from '../errors.js';
import type { PacingRule, ProviderPacer } from './pacing.js';
import { createRegistryQueryCache } from './query-cache.js';
import {
  SEC_EDGAR_PACING,
  SEC_EDGAR_TICKERS_TTL_MS,
  SEC_EDGAR_URLS,
  createSecEdgarRegister,
} from './sec-edgar.js';
import { createMockOutbound, jsonHeaders, type MockOutbound } from './testing.js';

const USER_AGENT = 'Utopia Synthetic Compliance admin@example.test';
const JSON_REPLY = jsonHeaders();

const SUBMISSIONS = {
  cik: '1234567',
  entityType: 'operating',
  sic: '3990',
  sicDescription: 'Miscellaneous Manufacturing Industries',
  name: 'Utopia Synthetic Widgets Inc.',
  tickers: ['UTSW'],
  exchanges: ['Nasdaq'],
  ein: '000000000',
  stateOfIncorporation: 'DE',
  formerNames: [
    {
      name: 'Utopia Widgets Corp',
      from: '2001-01-01T00:00:00.000Z',
      to: '2010-01-01T00:00:00.000Z',
    },
  ],
  addresses: {
    mailing: {
      street1: 'PO Box 1000',
      street2: null,
      city: 'Utopia City',
      stateOrCountry: 'CA',
      zipCode: '90001',
    },
    business: {
      street1: '1 Placeholder Way',
      street2: 'Suite 2',
      city: 'Utopia City',
      stateOrCountry: 'CA',
      zipCode: '90001',
      stateOrCountryDescription: 'CA',
    },
  },
  filings: { recent: { form: ['10-K'] } },
};

const TICKERS = {
  '0': { cik_str: 7654321, ticker: 'MPHX', title: 'Marrowstone Placeholder Holdings Inc.' },
  '1': { cik_str: 1234567, ticker: 'UTSW', title: 'Utopia Synthetic Widgets Inc.' },
};

const REQUEST: BusinessRegistryRequest = {
  country: 'US',
  businessName: 'Utopia Synthetic Widgets Inc',
  registrationNumber: '1234567',
};

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function recordingPacer(): ProviderPacer & { acquired: [PacingRule, string][] } {
  const acquired: [PacingRule, string][] = [];
  return {
    acquired,
    acquire: (rule, key) => {
      acquired.push([rule, key]);
      return Promise.resolve();
    },
  };
}

function register(clock: TestClock = fixedClock()) {
  outbound = createMockOutbound();
  const pacer = recordingPacer();
  return {
    data: outbound.agent.get('https://data.sec.gov'),
    www: outbound.agent.get('https://www.sec.gov'),
    pacer,
    outbound,
    edgar: createSecEdgarRegister({
      userAgent: USER_AGENT,
      outboundHttp: outbound,
      pacer,
      queryCache: createRegistryQueryCache(),
      clock,
    }),
  };
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProviderError)) {
    throw new Error(`expected a ProviderError, got ${String(error)}`);
  }
  return error;
}

describe('the SEC EDGAR register (C61.1)', () => {
  it('covers US registrants only, asking nothing about another country', async () => {
    const { edgar, outbound: mock } = register();

    expect(await edgar.lookup({ ...REQUEST, country: 'CA' })).toEqual({
      outcome: 'unsupported_country',
    });
    expect(mock.requests).toEqual([]);
    expect(edgar).toMatchObject({ id: 'sec-edgar', sandbox: false, source: 'sec-edgar' });
    expect(SEC_EDGAR_URLS).toEqual({
      submissions: 'https://data.sec.gov/submissions/',
      tickers: 'https://www.sec.gov/files/company_tickers.json',
    });
  });

  it('reads a numeric registration number as the CIK, with the operator’s User-Agent', async () => {
    const { edgar, data, outbound: mock } = register();
    data
      .intercept({ path: '/submissions/CIK0001234567.json', method: 'GET' })
      .reply(200, SUBMISSIONS, JSON_REPLY);

    expect(await edgar.lookup(REQUEST)).toEqual({
      outcome: 'found',
      authoritative: false,
      personsAvailable: false,
      record: {
        source: 'sec-edgar',
        recordId: '1234567',
        legalName: 'Utopia Synthetic Widgets Inc.',
        otherNames: ['Utopia Widgets Corp'],
        status: null,
        statusDetail: null,
        registeredAddress: {
          lines: ['1 Placeholder Way', 'Suite 2'],
          city: 'Utopia City',
          region: 'US-CA',
          postalCode: '90001',
          country: 'US',
        },
        jurisdiction: 'DE',
        registrationNumber: '1234567',
      },
    });
    expect(mock.requests[0]?.request.headers).toEqual({
      'user-agent': USER_AGENT,
      accept: 'application/json',
    });
  });

  it('keeps the CIK as entered when it was written with its leading zeros', async () => {
    const { edgar, data } = register();
    data
      .intercept({ path: '/submissions/CIK0001234567.json', method: 'GET' })
      .reply(200, SUBMISSIONS, JSON_REPLY);

    expect(await edgar.lookup({ ...REQUEST, registrationNumber: '0001234567' })).toMatchObject({
      record: { recordId: '1234567', registrationNumber: '0001234567' },
    });
  });

  it('answers a CIK EDGAR does not hold as a miss that is not authoritative', async () => {
    const { edgar, data } = register();
    data.intercept({ path: '/submissions/CIK0001234567.json', method: 'GET' }).reply(404, '');

    expect(await edgar.lookup(REQUEST)).toEqual({ outcome: 'not_found', authoritative: false });
  });

  it('finds a business entered without a CIK among the listed companies, by the closest name', async () => {
    const { edgar, data, www, outbound: mock } = register();
    www
      .intercept({ path: '/files/company_tickers.json', method: 'GET' })
      .reply(200, TICKERS, JSON_REPLY);
    data
      .intercept({ path: '/submissions/CIK0001234567.json', method: 'GET' })
      .reply(200, SUBMISSIONS, JSON_REPLY);

    expect(
      await edgar.lookup({ country: 'US', businessName: 'Utopia Synthetic Widgets Inc' }),
    ).toMatchObject({ outcome: 'found', record: { recordId: '1234567' } });
    expect(mock.clients.map((client) => client.name)).toEqual(['sec-edgar', 'sec-edgar']);
    expect(mock.clients[1]).toMatchObject({ maxResponseBytes: 8 * 1024 * 1024 });
  });

  it('answers a name no listed company holds as a miss (listed companies only)', async () => {
    const { edgar, www } = register();
    www
      .intercept({ path: '/files/company_tickers.json', method: 'GET' })
      .reply(200, TICKERS, JSON_REPLY);

    expect(
      await edgar.lookup({ country: 'US', businessName: 'Quillfeather Family Bakery' }),
    ).toEqual({ outcome: 'not_found', authoritative: false });
  });

  it('keeps the tickers in memory for a day', async () => {
    const clock = fixedClock();
    const { edgar, www } = register(clock);
    www
      .intercept({ path: '/files/company_tickers.json', method: 'GET' })
      .reply(200, TICKERS, JSON_REPLY)
      .times(2);
    const unlisted = { country: 'US', businessName: 'Quillfeather Family Bakery' };

    await edgar.lookup(unlisted);
    await edgar.lookup(unlisted);
    const fetches = () =>
      outbound?.requests.filter(({ request }) => request.url.endsWith('company_tickers.json'))
        .length;
    expect(fetches()).toBe(1);
    clock.advance(SEC_EDGAR_TICKERS_TTL_MS + 1);
    await edgar.lookup(unlisted);
    expect(fetches()).toBe(2);
  });

  it('paces every request at 10 a second, for the whole install', async () => {
    const { edgar, data, pacer } = register();
    data
      .intercept({ path: '/submissions/CIK0001234567.json', method: 'GET' })
      .reply(200, SUBMISSIONS, JSON_REPLY);

    await edgar.lookup(REQUEST);

    expect(SEC_EDGAR_PACING).toEqual({ name: 'sec-edgar', intervalMs: 100 });
    expect(pacer.acquired).toEqual([[SEC_EDGAR_PACING, 'install']]);
  });

  it('refuses an answer that is not a submissions record, and a 403 from a missing User-Agent', async () => {
    const { edgar, data } = register();
    data
      .intercept({ path: '/submissions/CIK0001234567.json', method: 'GET' })
      .reply(200, { cik: '1234567' }, JSON_REPLY);
    data.intercept({ path: '/submissions/CIK0001234567.json', method: 'GET' }).reply(403, '');

    expect(await failure(edgar.lookup(REQUEST))).toMatchObject({
      code: 'sec_edgar_malformed',
      retryable: false,
    });
    expect(await failure(edgar.lookup(REQUEST))).toMatchObject({
      code: 'sec_edgar_unauthorized',
      retryable: false,
    });
  });

  it('refuses to look up without an outbound client', async () => {
    const edgar = createSecEdgarRegister({
      userAgent: USER_AGENT,
      pacer: recordingPacer(),
      queryCache: createRegistryQueryCache(),
    });

    expect(await failure(edgar.lookup(REQUEST))).toMatchObject({
      code: 'sec_edgar_not_configured',
      retryable: false,
    });
  });
});
