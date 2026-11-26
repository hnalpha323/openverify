/**
 * C82.3, C82.4, C83: the `addressVerification` providers. `smarty` asks Smarty's US Street API
 * for one candidate of the normalised components (never an addressee unless the request carries
 * one), here against `MockAgent` with fixtures-6's synthetic candidates, and maps its metadata and
 * DPV analysis onto the public field names; an empty answer means Smarty knows no such delivery
 * point. The sandbox calls nothing and answers house numbers 1000-1006. Every address is fictional.
 */
import {
  smartyCandidate,
  smartyScenarioAnswer,
  smartyStreetAnswer,
  smartyUnauthorizedAnswer,
  type StubAnswer,
} from '@openverify/watchlist/testing';
import { ADDRESS_VERIFICATION_FIELDS } from '@openverify/checks';
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressVerificationRequest } from '../../ports.js';
import { createMockOutbound, type MockOutbound } from '../business-registry/testing.js';
import { ProviderError } from '../errors.js';
import { createAddressVerificationProvider, SMARTY_US_STREET_ORIGIN } from './index.js';

const CREDENTIALS = {
  gdeltAcknowledged: false,
  hibp: null,
  twilioLookup: null,
  smarty: { authId: 'change-me-smarty-id', authToken: 'change-me-smarty-token' },
};
const REQUEST: AddressVerificationRequest = {
  street1: '1000 Synthetic Avenue',
  street2: 'Apt 4',
  city: 'Exampleton',
  subdivision: 'KS',
  postalCode: '66002',
  countryCode: 'US',
};
const INPUT = {
  street: '1000 Synthetic Avenue',
  secondary: 'Apt 4',
  city: 'Exampleton',
  state: 'KS',
  zipcode: '66002',
};

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function smarty(answer: StubAnswer) {
  outbound = createMockOutbound();
  outbound.agent
    .get(SMARTY_US_STREET_ORIGIN)
    .intercept({ path: (path) => path.startsWith('/street-address?'), method: 'GET' })
    .reply(answer.status, answer.body, { headers: answer.headers });
  return {
    outbound,
    provider: createAddressVerificationProvider('smarty', {
      credentials: CREDENTIALS,
      outboundHttp: outbound,
    }),
  };
}

const sentQuery = (requests: MockOutbound) =>
  Object.fromEntries(
    new URL(requests.requests[0]?.request.url ?? 'https://x.example').searchParams,
  );

async function failureOf(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProviderError);
  expect(String(error) + JSON.stringify(error)).not.toMatch(/Synthetic Avenue|change-me/u);
  return error as ProviderError;
}

describe('the smarty adapter (C82.3, C83)', () => {
  it('sends the normalised components with the credentials, and maps the candidate', async () => {
    const { provider, outbound: requests } = smarty(
      smartyStreetAnswer([smartyCandidate(INPUT, { residential: true })]),
    );

    const { fields } = await provider.verify(REQUEST);

    expect(provider).toMatchObject({ id: 'smarty', sandbox: false });
    expect(sentQuery(requests)).toEqual({
      'auth-id': 'change-me-smarty-id',
      'auth-token': 'change-me-smarty-token',
      street: '1000 Synthetic Avenue',
      secondary: 'Apt 4',
      city: 'Exampleton',
      state: 'KS',
      zipcode: '66002',
      candidates: '1',
    });
    expect(Object.keys(fields).sort()).toEqual([...ADDRESS_VERIFICATION_FIELDS].sort());
    expect(fields).toEqual({
      deliverability: 'confirmed',
      'metadata-record-type': 'S',
      'metadata-zip-type': 'standard',
      'metadata-county-fips': '00000',
      'metadata-county-name': 'Synthetic',
      'metadata-carrier-route': 'C001',
      'metadata-latitude': 0,
      'metadata-longitude': 0,
      'metadata-precision': 'Zip9',
      'metadata-residential-delivery-indicator': 'residential',
      'analysis-dpv-match-code': 'Y',
      'analysis-dpv-cmra': false,
      'analysis-dpv-vacant': false,
      'analysis-active': true,
      'analysis-lacs-link-code': null,
      'analysis-lacs-link-indicator': null,
      'analysis-suite-link-match': null,
      'analysis-dpv-footnotes': 'AABB',
      'analysis-footnotes': null,
    });
    expect(requests.clients[0]).toMatchObject({
      name: 'smarty',
      contentTypes: ['application/json'],
    });
  });

  it('sends the addressee only when the request carries one', async () => {
    const { provider, outbound: requests } = smarty(smartyStreetAnswer([]));

    await provider.verify({ ...REQUEST, addressee: 'Sandbox Tenant' });

    expect(sentQuery(requests)).toMatchObject({ addressee: 'Sandbox Tenant' });
  });

  it('reads the DPV codes: a missing or invalid secondary, and no candidate at all', async () => {
    const read = async (answer: StubAnswer) =>
      (await smarty(answer).provider.verify(REQUEST)).fields;

    expect(
      (
        await read(
          smartyStreetAnswer([smartyCandidate(INPUT, { deliverability: 'missing_secondary' })]),
        )
      ).deliverability,
    ).toBe('confirmed_missing_secondary');
    await outbound?.close();
    expect(
      await read(
        smartyStreetAnswer([
          smartyCandidate(INPUT, {
            deliverability: 'invalid_secondary',
            residential: false,
            cmra: true,
            vacant: true,
          }),
        ]),
      ),
    ).toMatchObject({
      deliverability: 'confirmed_secondary_invalid',
      'metadata-residential-delivery-indicator': 'commercial',
      'analysis-dpv-cmra': true,
      'analysis-dpv-vacant': true,
    });
    await outbound?.close();
    const unmatched = await read(smartyStreetAnswer([]));
    expect(unmatched.deliverability).toBe('not_confirmed');
    expect(
      Object.entries(unmatched).filter(
        ([field, value]) => field !== 'deliverability' && value !== null,
      ),
    ).toEqual([]);
  });

  it('serves no value Smarty gave in another shape', async () => {
    const candidate = smartyCandidate(INPUT);
    const { provider } = smarty(
      smartyStreetAnswer([
        {
          ...candidate,
          metadata: {
            record_type: 'TOO-LONG-RECORD',
            zip_type: 'Odd',
            county_fips: '12',
            latitude: 900,
            rdi: '',
          },
          analysis: { dpv_match_code: '', dpv_cmra: 'maybe' },
        },
      ]),
    );

    const { fields } = await provider.verify(REQUEST);

    expect(fields).toMatchObject({
      deliverability: 'unknown',
      'metadata-record-type': null,
      'metadata-zip-type': null,
      'metadata-county-fips': null,
      'metadata-latitude': null,
      'metadata-residential-delivery-indicator': null,
      'analysis-dpv-match-code': null,
      'analysis-dpv-cmra': null,
    });
  });

  it('fails refused credentials for good, a rate limit and an outage for a retry', async () => {
    expect(
      await failureOf(smarty(smartyUnauthorizedAnswer()).provider.verify(REQUEST)),
    ).toMatchObject({
      retryable: false,
      code: 'smarty_unauthorized',
    });
    await outbound?.close();
    expect(
      await failureOf(smarty({ status: 429, headers: {}, body: '' }).provider.verify(REQUEST)),
    ).toMatchObject({ retryable: true, code: 'smarty_rate_limited' });
    await outbound?.close();
    expect(
      await failureOf(smarty({ status: 500, headers: {}, body: '' }).provider.verify(REQUEST)),
    ).toMatchObject({ retryable: true, code: 'smarty_unavailable' });
  });

  it('refuses an answer that is not a list of candidates, for good', async () => {
    const { provider } = smarty({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidates: [] }),
    });

    expect(await failureOf(provider.verify(REQUEST))).toMatchObject({
      retryable: false,
      code: 'smarty_malformed',
    });
  });

  it('is never built without its credentials, naming the variables and not a value', () => {
    expect(() =>
      createAddressVerificationProvider('smarty', {
        credentials: { ...CREDENTIALS, smarty: null },
      }),
    ).toThrow(/^smarty needs its credentials \(OPENVERIFY_SMARTY_AUTH_ID, _AUTH_TOKEN\)$/u);
  });

  it('agrees with fixtures-6’s sandbox scenario stub for every magic house number', async () => {
    const sandbox = createAddressVerificationProvider('sandbox');
    for (const house of ['1000', '1001', '1002', '1003', '1004', '1005', '1006']) {
      const input = { ...INPUT, street: `${house} Synthetic Avenue` };
      const real = await smarty(smartyScenarioAnswer(input)).provider.verify({
        ...REQUEST,
        street1: input.street,
      });
      await outbound?.close();
      outbound = undefined;
      const fake = await sandbox.verify({ ...REQUEST, street1: input.street });
      for (const field of [
        'deliverability',
        'metadata-residential-delivery-indicator',
        'analysis-dpv-cmra',
        'analysis-dpv-vacant',
      ] as const) {
        expect(fake.fields[field], `${house} ${field}`).toBe(real.fields[field]);
      }
    }
  });
});

describe('the sandbox address verification provider (C82.4)', () => {
  const provider = createAddressVerificationProvider('sandbox');

  it('is labelled a sandbox and answers 1000 as a confirmed residential address', async () => {
    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
    const { fields } = await provider.verify(REQUEST);

    expect(Object.keys(fields).sort()).toEqual([...ADDRESS_VERIFICATION_FIELDS].sort());
    expect(fields).toMatchObject({
      deliverability: 'confirmed',
      'metadata-residential-delivery-indicator': 'residential',
      'analysis-dpv-match-code': 'Y',
      'analysis-dpv-cmra': false,
      'analysis-dpv-vacant': false,
      'analysis-active': true,
      // The sandbox places nothing: no coordinates are made up.
      'metadata-latitude': null,
      'metadata-longitude': null,
    });
  });

  it('answers any other house number as unknown, with nothing else', async () => {
    const { fields } = await provider.verify({ ...REQUEST, street1: '12 Synthetic Avenue' });

    expect(fields.deliverability).toBe('unknown');
    expect(
      Object.entries(fields).filter(
        ([field, value]) => field !== 'deliverability' && value !== null,
      ),
    ).toEqual([]);
  });
});
