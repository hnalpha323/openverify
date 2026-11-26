/**
 * C61.1, C61.2, C61.7: the Companies House register against `MockAgent`, with synthetic answers
 * shaped like the public data API's: GB only; a company number read directly (a miss there is
 * authoritative), else a name search keeping the closest company; the profile, previous names and
 * status for the C61.2 table; active officers and individual PSCs with their month and year of
 * birth, read on every lookup; HTTP Basic with the key, which no error carries; the host of the
 * environment kind, the query cache and the pacing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { BusinessRegistryRequest, EnvironmentKind } from '../../ports.js';
import { createInMemoryKeyValueCache } from '../../test-support/fakes.js';
import { ProviderError } from '../errors.js';
import {
  COMPANIES_HOUSE_BASE_URLS,
  COMPANIES_HOUSE_PACING,
  createCompaniesHouseRegister,
} from './companies-house.js';
import type { PacingRule, ProviderPacer } from './pacing.js';
import { createRegistryQueryCache, type RegistryQueryCache } from './query-cache.js';
import { createMockOutbound, jsonHeaders, type MockOutbound } from './testing.js';

const KEY = 'synthetic-companies-house-key-0001';
const NUMBER = '01234567';
const JSON_REPLY = jsonHeaders();

const PROFILE = {
  company_name: 'UTOPIA SYNTHETIC WIDGETS LIMITED',
  company_number: NUMBER,
  company_status: 'active',
  company_status_detail: 'active-proposal-to-strike-off',
  date_of_creation: '2001-02-03',
  jurisdiction: 'england-wales',
  type: 'ltd',
  registered_office_address: {
    premises: '1',
    address_line_1: 'Placeholder Row',
    address_line_2: 'Synthetic Quarter',
    locality: 'Utopia Town',
    region: 'Utopiashire',
    postal_code: 'UT1 0ZZ',
    country: 'England',
  },
  previous_company_names: [
    { name: 'UTOPIA WIDGETS LIMITED', ceased_on: '2010-01-01', effective_from: '2001-02-03' },
  ],
  etag: 'synthetic-etag',
  links: { self: `/company/${NUMBER}` },
};

const OFFICERS = {
  items: [
    {
      name: 'PLACEHOLDER, Ada',
      officer_role: 'director',
      appointed_on: '2015-01-01',
      date_of_birth: { month: 4, year: 1980 },
    },
    {
      name: 'FORMERLY, Ezra Synthetic',
      officer_role: 'secretary',
      appointed_on: '2002-01-01',
      resigned_on: '2019-06-30',
      date_of_birth: { month: 12, year: 1960 },
    },
    { name: 'SYNTHETIC NOMINEES LIMITED', officer_role: 'corporate-director' },
  ],
  active_count: 2,
  resigned_count: 1,
  total_results: 3,
};

const PSCS = {
  items: [
    {
      name: 'Mr Robin Testerton',
      kind: 'individual-person-with-significant-control',
      date_of_birth: { month: 9, year: 1975 },
      natures_of_control: ['ownership-of-shares-75-to-100-percent'],
      notified_on: '2016-04-06',
    },
    {
      name: 'Mrs Former Synthetic Owner',
      kind: 'individual-person-with-significant-control',
      date_of_birth: { month: 1, year: 1950 },
      ceased_on: '2018-01-01',
    },
    { name: 'Synthetic Holdings Ltd', kind: 'corporate-entity-person-with-significant-control' },
  ],
  active_count: 2,
  ceased_count: 1,
};

const REQUEST: BusinessRegistryRequest = {
  country: 'GB',
  businessName: 'Utopia Synthetic Widgets Ltd',
  registrationNumber: NUMBER,
};
/** The same lookup for a step that collects associated persons (Workflow 5C review K6). */
const WITH_PERSONS: BusinessRegistryRequest = { ...REQUEST, withPersons: true };

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

function register(
  environment: EnvironmentKind = 'production',
  queryCache: RegistryQueryCache = createRegistryQueryCache(),
) {
  outbound = createMockOutbound();
  const pacer = recordingPacer();
  return {
    pool: outbound.agent.get(COMPANIES_HOUSE_BASE_URLS[environment]),
    pacer,
    outbound,
    house: createCompaniesHouseRegister({
      apiKey: KEY,
      environment,
      outboundHttp: outbound,
      pacer,
      queryCache,
    }),
  };
}

/** The profile, officers and PSCs of the company. */
function answersCompany(pool: ReturnType<typeof register>['pool']) {
  pool.intercept({ path: `/company/${NUMBER}`, method: 'GET' }).reply(200, PROFILE, JSON_REPLY);
  pool
    .intercept({ path: `/company/${NUMBER}/officers?items_per_page=100`, method: 'GET' })
    .reply(200, OFFICERS, JSON_REPLY);
  pool
    .intercept({
      path: `/company/${NUMBER}/persons-with-significant-control?items_per_page=100`,
      method: 'GET',
    })
    .reply(200, PSCS, JSON_REPLY);
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProviderError)) {
    throw new Error(`expected a ProviderError, got ${String(error)}`);
  }
  expect(error.message).not.toContain(KEY);
  return error;
}

describe('the Companies House register (C61.1)', () => {
  it('covers GB only, asking nothing about another country', async () => {
    const { house, outbound: mock } = register();

    expect(await house.lookup({ ...REQUEST, country: 'IE' })).toEqual({
      outcome: 'unsupported_country',
    });
    expect(mock.requests).toEqual([]);
    expect(house).toMatchObject({
      id: 'companies-house',
      sandbox: false,
      source: 'companies-house',
    });
  });

  it('reads a company by its number, with its active officers and individual PSCs', async () => {
    const { house, pool } = register();
    answersCompany(pool);

    expect(await house.lookup(WITH_PERSONS)).toEqual({
      outcome: 'found',
      authoritative: true,
      personsAvailable: true,
      record: {
        source: 'companies-house',
        recordId: NUMBER,
        legalName: 'UTOPIA SYNTHETIC WIDGETS LIMITED',
        otherNames: ['UTOPIA WIDGETS LIMITED'],
        status: 'active',
        statusDetail: 'active-proposal-to-strike-off',
        registeredAddress: {
          lines: ['1 Placeholder Row', 'Synthetic Quarter'],
          city: 'Utopia Town',
          region: 'Utopiashire',
          postalCode: 'UT1 0ZZ',
          country: 'GB',
        },
        jurisdiction: 'england-wales',
        registrationNumber: NUMBER,
        persons: [
          { name: 'PLACEHOLDER, Ada', birthMonth: '1980-04', role: 'officer', active: true },
          {
            name: 'FORMERLY, Ezra Synthetic',
            birthMonth: '1960-12',
            role: 'officer',
            active: false,
          },
          { name: 'Mr Robin Testerton', birthMonth: '1975-09', role: 'psc', active: true },
          {
            name: 'Mrs Former Synthetic Owner',
            birthMonth: '1950-01',
            role: 'psc',
            active: false,
          },
        ],
      },
    });
  });

  it('asks for no officer or PSC when the lookup does not ask for persons (Workflow 5C review K6)', async () => {
    const { house, pool, outbound: mock } = register();
    pool
      .intercept({ path: `/company/${NUMBER}`, method: 'GET' })
      .reply(200, PROFILE, JSON_REPLY)
      .times(2);

    const answer = await house.lookup(REQUEST);

    expect(answer).toMatchObject({
      outcome: 'found',
      personsAvailable: true,
      record: { recordId: NUMBER, legalName: 'UTOPIA SYNTHETIC WIDGETS LIMITED' },
    });
    expect(answer.outcome === 'found' ? answer.record.persons : null).toBeUndefined();
    expect(mock.requests.map(({ request }) => new URL(request.url).pathname)).toEqual([
      `/company/${NUMBER}`,
    ]);
    expect(await house.lookup({ ...REQUEST, withPersons: false })).toMatchObject({
      outcome: 'found',
    });
    expect(mock.requests).toHaveLength(2);
  });

  it('authenticates with the key as the Basic user name and a blank password', async () => {
    const { house, pool, outbound: mock } = register();
    answersCompany(pool);

    await house.lookup(WITH_PERSONS);

    const expected = `Basic ${Buffer.from(`${KEY}:`).toString('base64')}`;
    expect(mock.requests.map(({ request }) => request.headers)).toEqual([
      { authorization: expected, accept: 'application/json' },
      { authorization: expected, accept: 'application/json' },
      { authorization: expected, accept: 'application/json' },
    ]);
    expect(mock.clients).toEqual([
      { name: 'companies-house', contentTypes: ['application/json'], timeoutMs: 10_000 },
    ]);
  });

  it('answers a number the register lacks as an authoritative miss, remembered for the hour', async () => {
    const queryCache = createRegistryQueryCache(createInMemoryKeyValueCache());
    const first = register('production', queryCache);
    first.pool.intercept({ path: `/company/${NUMBER}`, method: 'GET' }).reply(404, '');

    expect(await first.house.lookup(REQUEST)).toEqual({
      outcome: 'not_found',
      authoritative: true,
    });
    await first.outbound.close();

    const second = register('production', queryCache);
    expect(await second.house.lookup(REQUEST)).toEqual({
      outcome: 'not_found',
      authoritative: true,
    });
    expect(second.outbound.requests).toEqual([]);
  });

  it('reads a number written in lower case as the register writes it', async () => {
    const { house, pool, outbound: mock } = register();
    pool.intercept({ path: '/company/SC123456', method: 'GET' }).reply(404, '');

    await house.lookup({ ...REQUEST, registrationNumber: 'sc123456' });

    expect(new URL(mock.requests[0]?.request.url ?? '').pathname).toBe('/company/SC123456');
  });

  it('searches by name without a number, and keeps the closest company', async () => {
    const { house, pool, outbound: mock } = register();
    pool.intercept({ path: (path) => path.startsWith('/search/companies?'), method: 'GET' }).reply(
      200,
      {
        items: [
          { company_number: '07654321', title: 'MARROWSTONE PLACEHOLDER HOLDINGS LIMITED' },
          { company_number: NUMBER, title: 'UTOPIA SYNTHETIC WIDGETS LIMITED' },
        ],
        total_results: 2,
        kind: 'search#companies',
      },
      JSON_REPLY,
    );
    answersCompany(pool);

    expect(
      await house.lookup({ country: 'GB', businessName: 'Utopia Synthetic Widgets Ltd' }),
    ).toMatchObject({ outcome: 'found', authoritative: true, record: { recordId: NUMBER } });
    const search = new URL(mock.requests[0]?.request.url ?? '');
    expect(search.pathname).toBe('/search/companies');
    expect(search.searchParams.get('q')).toBe('Utopia Synthetic Widgets Ltd');
    expect(search.searchParams.get('items_per_page')).toBe('20');
  });

  it('keeps no company of a search whose names do not match the name', async () => {
    const { house, pool } = register();
    pool.intercept({ path: (path) => path.startsWith('/search/companies?'), method: 'GET' }).reply(
      200,
      {
        items: [{ company_number: '07654321', title: 'MARROWSTONE PLACEHOLDER HOLDINGS LIMITED' }],
      },
      JSON_REPLY,
    );

    expect(
      await house.lookup({ country: 'GB', businessName: 'Utopia Synthetic Widgets Ltd' }),
    ).toEqual({ outcome: 'not_found', authoritative: false });
  });

  it('answers a name the search does not find as a miss that is not authoritative', async () => {
    const { house, pool } = register();
    pool
      .intercept({ path: (path) => path.startsWith('/search/companies?'), method: 'GET' })
      .reply(200, { items: [] }, JSON_REPLY);

    expect(await house.lookup({ country: 'GB', businessName: 'Utopia Synthetic' })).toEqual({
      outcome: 'not_found',
      authoritative: false,
    });
  });

  it('reads a company whose officers or PSCs the register does not list as having none', async () => {
    const { house, pool } = register();
    pool.intercept({ path: `/company/${NUMBER}`, method: 'GET' }).reply(200, PROFILE, JSON_REPLY);
    pool.intercept({ path: (path) => path.includes('/officers'), method: 'GET' }).reply(404, '');
    pool
      .intercept({
        path: (path) => path.includes('/persons-with-significant-control'),
        method: 'GET',
      })
      .reply(404, '');

    expect(await house.lookup(WITH_PERSONS)).toMatchObject({
      outcome: 'found',
      personsAvailable: true,
      record: { persons: [] },
    });
  });

  it('uses the Companies House sandbox host for sandbox environments', async () => {
    const { house, pool, outbound: mock } = register('sandbox');
    pool.intercept({ path: `/company/${NUMBER}`, method: 'GET' }).reply(404, '');

    await house.lookup(REQUEST);

    expect(mock.requests[0]?.request.url).toBe(
      `https://api-sandbox.company-information.service.gov.uk/company/${NUMBER}`,
    );
  });

  it('paces every request at 600 per five minutes, per environment kind', async () => {
    const { house, pool, pacer } = register();
    answersCompany(pool);

    await house.lookup(WITH_PERSONS);

    expect(COMPANIES_HOUSE_PACING).toEqual({ name: 'companies-house', intervalMs: 500 });
    expect(pacer.acquired).toEqual([
      [COMPANIES_HOUSE_PACING, 'production'],
      [COMPANIES_HOUSE_PACING, 'production'],
      [COMPANIES_HOUSE_PACING, 'production'],
    ]);
  });

  it('refuses a refused key, an answer that is not a company, and a redirect, without the key', async () => {
    const { house, pool } = register();
    pool.intercept({ path: `/company/${NUMBER}`, method: 'GET' }).reply(401, '');
    pool
      .intercept({ path: `/company/${NUMBER}`, method: 'GET' })
      .reply(200, { company_status: 'active' }, JSON_REPLY);
    pool
      .intercept({ path: `/company/${NUMBER}`, method: 'GET' })
      .reply(301, '', { headers: { location: 'https://elsewhere.example.test/' } });

    expect(await failure(house.lookup(REQUEST))).toMatchObject({
      code: 'companies_house_unauthorized',
      retryable: false,
    });
    expect(await failure(house.lookup(REQUEST))).toMatchObject({
      code: 'companies_house_malformed',
      retryable: false,
    });
    expect(await failure(house.lookup(REQUEST))).toMatchObject({
      code: 'companies_house_redirect',
      retryable: false,
    });
  });

  it('refuses to look up without an outbound client', async () => {
    const house = createCompaniesHouseRegister({
      apiKey: KEY,
      environment: 'production',
      pacer: recordingPacer(),
      queryCache: createRegistryQueryCache(),
    });

    expect(await failure(house.lookup(REQUEST))).toMatchObject({
      code: 'companies_house_not_configured',
      retryable: false,
    });
  });
});
