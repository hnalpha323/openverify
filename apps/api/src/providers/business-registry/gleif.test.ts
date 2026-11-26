/**
 * C61.1, C61.2: the GLEIF register against `MockAgent`, with synthetic answers shaped like the GLEIF
 * API's (JSON:API `lei-records`): by LEI, by the registration number GLEIF records, then by legal
 * name, the closest record kept; its status and detail for the C61.2 table; misses never
 * authoritative and no persons; the query cache, the pacing, encoded queries, and refusals.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { BusinessRegistryRequest } from '../../ports.js';
import { createInMemoryKeyValueCache } from '../../test-support/fakes.js';
import { ProviderError } from '../errors.js';
import { GLEIF_PACING, GLEIF_SEARCH_PAGE_SIZE, createGleifRegister } from './gleif.js';
import type { PacingRule, ProviderPacer } from './pacing.js';
import { createRegistryQueryCache, type RegistryQueryCache } from './query-cache.js';
import { createMockOutbound, jsonHeaders, type MockOutbound } from './testing.js';

const ORIGIN = 'https://api.gleif.org';
const LEI = '5493001KJTIIGC8Y1R12';
const OTHER_LEI = '5493000SYNTHETIC0099';
const JSON_API = jsonHeaders('application/vnd.api+json');

/** A synthetic GLEIF `lei-records` resource. */
function leiRecord(
  overrides: {
    lei?: string;
    name?: string;
    status?: string;
    entityStatus?: string;
    expirationReason?: string | null;
    registeredAs?: string | null;
    otherNames?: string[];
    transliterated?: string[];
  } = {},
) {
  const lei = overrides.lei ?? LEI;
  return {
    type: 'lei-records',
    id: lei,
    attributes: {
      lei,
      entity: {
        legalName: { name: overrides.name ?? 'UTOPIA SYNTHETIC WIDGETS LIMITED', language: 'en' },
        otherNames: (overrides.otherNames ?? ['UTOPIA WIDGETS']).map((name) => ({
          name,
          language: 'en',
          type: 'TRADING_OR_OPERATING_NAME',
        })),
        transliteratedOtherNames: (overrides.transliterated ?? ['UTOPIA SINTETICA']).map(
          (name) => ({ name, language: 'it', type: 'AUTO_ASCII_TRANSLITERATED_LEGAL_NAME' }),
        ),
        legalAddress: {
          language: 'en',
          addressLines: ['1 Placeholder Row'],
          addressNumber: null,
          addressNumberWithinBuilding: null,
          mailRouting: null,
          city: 'Utopia Town',
          region: 'GB-ENG',
          country: 'GB',
          postalCode: 'UT1 0ZZ',
        },
        headquartersAddress: {
          language: 'en',
          addressLines: ['2 Elsewhere Synthetic Road'],
          city: 'Utopia Town',
          region: 'GB-ENG',
          country: 'GB',
          postalCode: 'UT2 0ZZ',
        },
        registeredAt: { id: 'RA000585', other: null },
        registeredAs: overrides.registeredAs === undefined ? '01234567' : overrides.registeredAs,
        jurisdiction: 'GB',
        category: 'GENERAL',
        legalForm: { id: 'H0PO', other: null },
        status: overrides.entityStatus ?? 'ACTIVE',
        expiration: { date: null, reason: overrides.expirationReason ?? null },
      },
      registration: {
        initialRegistrationDate: '2014-03-04T00:00:00Z',
        lastUpdateDate: '2026-02-01T00:00:00Z',
        status: overrides.status ?? 'ISSUED',
        nextRenewalDate: '2027-03-04T00:00:00Z',
        managingLou: '5493001KJTIIGC8Y1R00',
        corroborationLevel: 'FULLY_CORROBORATED',
      },
    },
  };
}

const REQUEST: BusinessRegistryRequest = {
  country: 'GB',
  businessName: 'Utopia Synthetic Widgets Ltd',
};

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

/** A pacer that lets every request through, recording what it was asked. */
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

function register(queryCache: RegistryQueryCache = createRegistryQueryCache()) {
  outbound = createMockOutbound();
  const pacer = recordingPacer();
  return {
    pool: outbound.agent.get(ORIGIN),
    pacer,
    outbound,
    gleif: createGleifRegister({ outboundHttp: outbound, pacer, queryCache }),
  };
}

const searchPath = (path: string) => path.startsWith('/api/v1/lei-records?');
const urlsOf = (mock: MockOutbound) => mock.requests.map(({ request }) => new URL(request.url));

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

describe('the GLEIF register (C61.1)', () => {
  it('is a real register named gleif, through a client of its own', async () => {
    const { gleif, pool, outbound: mock } = register();
    pool
      .intercept({ path: `/api/v1/lei-records/${LEI}`, method: 'GET' })
      .reply(200, { data: leiRecord() }, JSON_API);

    await gleif.lookup({ ...REQUEST, lei: LEI });

    expect(gleif).toMatchObject({ id: 'gleif', sandbox: false, source: 'gleif' });
    expect(mock.clients).toEqual([
      {
        name: 'gleif',
        contentTypes: ['application/vnd.api+json', 'application/json'],
        timeoutMs: 10_000,
      },
    ]);
    expect(mock.requests[0]?.request.headers).toEqual({ accept: 'application/vnd.api+json' });
  });

  it('reads a business with an LEI by its LEI, as a record that is not authoritative and holds no persons', async () => {
    const { gleif, pool } = register();
    pool
      .intercept({ path: `/api/v1/lei-records/${LEI}`, method: 'GET' })
      .reply(200, { data: leiRecord() }, JSON_API);

    expect(await gleif.lookup({ ...REQUEST, lei: LEI })).toEqual({
      outcome: 'found',
      authoritative: false,
      personsAvailable: false,
      record: {
        source: 'gleif',
        recordId: LEI,
        legalName: 'UTOPIA SYNTHETIC WIDGETS LIMITED',
        otherNames: ['UTOPIA WIDGETS', 'UTOPIA SINTETICA'],
        status: 'ISSUED',
        statusDetail: 'ACTIVE',
        registeredAddress: {
          lines: ['1 Placeholder Row'],
          city: 'Utopia Town',
          region: 'GB-ENG',
          postalCode: 'UT1 0ZZ',
          country: 'GB',
        },
        jurisdiction: 'GB',
        registrationNumber: '01234567',
      },
    });
  });

  it('reports an entity expiration as INACTIVE, beside the registration status', async () => {
    const { gleif, pool } = register();
    pool
      .intercept({ path: `/api/v1/lei-records/${LEI}`, method: 'GET' })
      .reply(
        200,
        { data: leiRecord({ status: 'LAPSED', expirationReason: 'DISSOLVED' }) },
        JSON_API,
      );

    expect(await gleif.lookup({ ...REQUEST, lei: LEI })).toMatchObject({
      record: { status: 'LAPSED', statusDetail: 'INACTIVE' },
    });
  });

  it('answers an LEI GLEIF does not hold as not found, never authoritatively', async () => {
    const { gleif, pool } = register();
    pool.intercept({ path: `/api/v1/lei-records/${LEI}`, method: 'GET' }).reply(404, '');

    expect(await gleif.lookup({ ...REQUEST, lei: LEI })).toEqual({
      outcome: 'not_found',
      authoritative: false,
    });
  });

  it('searches by the registration number GLEIF records in the business’s country', async () => {
    const { gleif, pool, outbound: mock } = register();
    pool
      .intercept({ path: searchPath, method: 'GET' })
      .reply(200, { data: [leiRecord({ name: 'QUILLFEATHER TRADING LIMITED' })] }, JSON_API);

    const answer = await gleif.lookup({ ...REQUEST, registrationNumber: '01234567' });

    // A record GLEIF holds under that number is the business, whatever its name now.
    expect(answer).toMatchObject({ outcome: 'found', record: { recordId: LEI } });
    const [url] = urlsOf(mock);
    expect(url?.searchParams.get('filter[entity.registeredAs]')).toBe('01234567');
    expect(url?.searchParams.get('filter[entity.legalAddress.country]')).toBe('GB');
    expect(url?.searchParams.get('page[size]')).toBe(String(GLEIF_SEARCH_PAGE_SIZE));
  });

  it('then searches by legal name, and keeps the closest record at least partly matching', async () => {
    const { gleif, pool, outbound: mock } = register();
    pool.intercept({ path: searchPath, method: 'GET' }).reply(200, { data: [] }, JSON_API);
    pool.intercept({ path: searchPath, method: 'GET' }).reply(
      200,
      {
        data: [
          leiRecord({ lei: OTHER_LEI, name: 'MARROWSTONE PLACEHOLDER HOLDINGS' }),
          leiRecord(),
        ],
      },
      JSON_API,
    );

    const answer = await gleif.lookup({ ...REQUEST, registrationNumber: '07654321' });

    expect(answer).toMatchObject({ outcome: 'found', record: { recordId: LEI } });
    const [, byName] = urlsOf(mock);
    expect(byName?.searchParams.get('filter[entity.legalName]')).toBe(
      'Utopia Synthetic Widgets Ltd',
    );
    expect(byName?.searchParams.get('filter[entity.legalAddress.country]')).toBe('GB');
  });

  it('answers not found when no record of a name search matches the name', async () => {
    const { gleif, pool } = register();
    pool.intercept({ path: searchPath, method: 'GET' }).reply(
      200,
      {
        data: [
          leiRecord({
            name: 'MARROWSTONE PLACEHOLDER HOLDINGS',
            otherNames: ['MARROWSTONE TRADING'],
            transliterated: [],
          }),
        ],
      },
      JSON_API,
    );

    expect(await gleif.lookup(REQUEST)).toEqual({ outcome: 'not_found', authoritative: false });
  });

  it('encodes the name into the query, so no character of it changes the request', async () => {
    const { gleif, pool, outbound: mock } = register();
    pool.intercept({ path: searchPath, method: 'GET' }).reply(200, { data: [] }, JSON_API);

    await gleif.lookup({ ...REQUEST, businessName: 'Utopia & Sons / Widgets?page[size]=200#x' });

    const [sent] = mock.requests;
    expect(sent?.request.url).toContain(
      'filter%5Bentity.legalName%5D=Utopia+%26+Sons+%2F+Widgets%3Fpage%5Bsize%5D%3D200%23x',
    );
    expect(urlsOf(mock)[0]?.searchParams.getAll('page[size]')).toEqual([
      String(GLEIF_SEARCH_PAGE_SIZE),
    ]);
  });

  it('encodes an LEI into the path, and searches instead for one that is not an LEI', async () => {
    const { gleif, pool, outbound: mock } = register();
    pool.intercept({ path: searchPath, method: 'GET' }).reply(200, { data: [] }, JSON_API);

    await gleif.lookup({ ...REQUEST, lei: '../lei-records?x=1' });

    expect(urlsOf(mock)[0]?.pathname).toBe('/api/v1/lei-records');
  });

  it('paces every request at 60 a minute, install-wide', async () => {
    const { gleif, pool, pacer } = register();
    pool.intercept({ path: searchPath, method: 'GET' }).reply(200, { data: [] }, JSON_API);

    await gleif.lookup(REQUEST);

    expect(GLEIF_PACING).toEqual({ name: 'gleif', intervalMs: 1000 });
    expect(pacer.acquired).toEqual([[GLEIF_PACING, 'install']]);
  });

  it('remembers what a search found, and reads the record again by its LEI', async () => {
    const queryCache = createRegistryQueryCache(createInMemoryKeyValueCache());
    const first = register(queryCache);
    first.pool
      .intercept({ path: searchPath, method: 'GET' })
      .reply(200, { data: [leiRecord()] }, JSON_API);
    await first.gleif.lookup(REQUEST);
    await first.outbound.close();

    const second = register(queryCache);
    second.pool
      .intercept({ path: `/api/v1/lei-records/${LEI}`, method: 'GET' })
      .reply(200, { data: leiRecord() }, JSON_API);

    expect(await second.gleif.lookup(REQUEST)).toMatchObject({
      outcome: 'found',
      record: { recordId: LEI },
    });
    expect(urlsOf(second.outbound).map((url) => url.pathname)).toEqual([
      `/api/v1/lei-records/${LEI}`,
    ]);
  });

  it('remembers a miss, and asks nothing for it again within the hour', async () => {
    const queryCache = createRegistryQueryCache(createInMemoryKeyValueCache());
    const first = register(queryCache);
    first.pool.intercept({ path: searchPath, method: 'GET' }).reply(200, { data: [] }, JSON_API);
    await first.gleif.lookup(REQUEST);
    await first.outbound.close();

    const second = register(queryCache);

    expect(await second.gleif.lookup(REQUEST)).toEqual({
      outcome: 'not_found',
      authoritative: false,
    });
    expect(second.outbound.requests).toEqual([]);
  });

  it('refuses an answer that is not a GLEIF record, without retrying', async () => {
    const { gleif, pool } = register();
    pool
      .intercept({ path: `/api/v1/lei-records/${LEI}`, method: 'GET' })
      .reply(200, { data: { id: LEI, attributes: { entity: {} } } }, JSON_API);

    expect(await failure(gleif.lookup({ ...REQUEST, lei: LEI }))).toMatchObject({
      code: 'gleif_malformed',
      retryable: false,
    });
  });

  it('refuses a redirect and follows none; retries a 429', async () => {
    const { gleif, pool, outbound: mock } = register();
    pool
      .intercept({ path: `/api/v1/lei-records/${LEI}`, method: 'GET' })
      .reply(302, '', { headers: { location: 'https://elsewhere.example.test/' } });
    pool.intercept({ path: searchPath, method: 'GET' }).reply(429, '');

    expect(await failure(gleif.lookup({ ...REQUEST, lei: LEI }))).toMatchObject({
      code: 'gleif_redirect',
      retryable: false,
    });
    expect(mock.requests).toHaveLength(1);
    expect(await failure(gleif.lookup(REQUEST))).toMatchObject({
      code: 'gleif_rate_limited',
      retryable: true,
    });
  });

  it('refuses to look up without an outbound client', async () => {
    const gleif = createGleifRegister({
      pacer: recordingPacer(),
      queryCache: createRegistryQueryCache(),
    });

    expect(await failure(gleif.lookup(REQUEST))).toMatchObject({
      code: 'gleif_not_configured',
      retryable: false,
    });
  });
});
