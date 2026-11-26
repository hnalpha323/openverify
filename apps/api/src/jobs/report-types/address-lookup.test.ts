/**
 * C82.3: the `address-lookup` report job over risk-logic's `evaluateAddressLookupReport` (the R and
 * H fields) and the bound `addressVerification` provider (the A fields). The provider receives
 * the normalised components of a US address only, and the addressee only with `send-addressee`
 * (P16); for any other country the A fields are `null` with `unsupported_country` and nothing is
 * sent. Every address is fictional.
 */
import { ADDRESS_DESIGNATORS, ADDRESS_VERIFICATION_FIELDS } from '@openverify/checks';
import { addressLookupReportResourceSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { createAddressVerificationProvider } from '../../providers/address-verification/index.js';
import { ProviderError } from '../../providers/errors.js';
import type { AddressVerificationProvider, AddressVerificationRequest } from '../../ports.js';
import { addressLookupReportJob } from './address-lookup.js';
import type { ReportRunResult, RunOutcome } from './job.js';
import { reportContext, servedReport, type ReportContextOptions } from './provider-testing.js';

const US = {
  addressee: 'Sandbox Tenant',
  'address-street-1': '1001 Synthetic Avenue',
  'address-city': 'Exampleton',
  'address-subdivision': 'KS',
  'address-postal-code': '66002',
  'address-country-code': 'US',
};

function completed(outcome: RunOutcome): ReportRunResult {
  if (outcome.kind !== 'completed') {
    throw new Error('the run did not complete');
  }
  return outcome.result;
}

const attributesOf = (result: ReportRunResult) => result.result as Record<string, unknown>;
const reasonOf = (result: ReportRunResult, field: string) =>
  result.unavailableFields.find((entry) => entry.field === field)?.reason;

function recording(): AddressVerificationProvider & { requests: AddressVerificationRequest[] } {
  const requests: AddressVerificationRequest[] = [];
  const sandbox = createAddressVerificationProvider('sandbox');
  return {
    requests,
    id: 'sandbox',
    sandbox: true,
    verify: (request) => {
      requests.push(request);
      return sandbox.verify(request);
    },
  };
}

function context(
  query: Record<string, string>,
  options: Omit<ReportContextOptions, 'type' | 'query'> = {},
) {
  return reportContext({ type: 'address-lookup', query, ...options });
}

function served(ctx: ReturnType<typeof context>, result: ReportRunResult) {
  expect(addressLookupReportResourceSchema.safeParse(servedReport(ctx, result)).success).toBe(true);
}

describe('the address-lookup report (C82.3)', () => {
  it('serves the R fields and the sandbox provider’s, sending no addressee by default', async () => {
    const provider = recording();
    const ctx = context(US, { providers: { addressVerification: provider } });
    const result = completed(await addressLookupReportJob.run(ctx));

    expect(result.errors).toEqual([]);
    expect(attributesOf(result)).toMatchObject({
      'resolved-street-1': '1001 Synthetic Avenue',
      'resolved-country-code': 'US',
      'postal-code-valid': true,
      'zip-state-consistent': true,
      deliverability: 'confirmed',
      'metadata-residential-delivery-indicator': 'commercial',
    });
    expect(provider.requests).toEqual([
      {
        street1: '1001 Synthetic Avenue',
        city: 'Exampleton',
        subdivision: 'KS',
        postalCode: '66002',
        countryCode: 'US',
      },
    ]);
    expect(result.provider).toEqual({ id: 'sandbox', sandbox: true });
    served(ctx, result);
  });

  it('sends the addressee only when the template sets send-addressee', async () => {
    const provider = recording();
    await addressLookupReportJob.run(
      context(US, {
        providers: { addressVerification: provider },
        config: { 'send-addressee': true },
      }),
    );

    expect(provider.requests[0]?.addressee).toBe('Sandbox Tenant');
  });

  it('sends nothing for another country: the provider fields are unsupported_country', async () => {
    const provider = recording();
    const ctx = context(
      {
        'address-street-1': '12 Synthetic Road',
        'address-city': 'Exampleford',
        'address-subdivision': 'Kent',
        'address-postal-code': 'ZZ1 1ZZ',
        'address-country-code': 'GB',
      },
      { providers: { addressVerification: provider } },
    );
    const result = completed(await addressLookupReportJob.run(ctx));

    expect(provider.requests).toEqual([]);
    for (const field of ADDRESS_VERIFICATION_FIELDS) {
      expect(attributesOf(result)[field], field).toBeNull();
      expect(reasonOf(result, field), field).toBe('unsupported_country');
    }
    served(ctx, result);
  });

  it('lists the provider fields as not configured without a provider', async () => {
    const ctx = context(US);
    const result = completed(await addressLookupReportJob.run(ctx));

    expect(reasonOf(result, 'deliverability')).toBe('provider_not_configured');
    expect(result.provider).toBeNull();
    served(ctx, result);
  });

  it('retries a provider failure while attempts remain, then records it', async () => {
    const failing: AddressVerificationProvider = {
      id: 'smarty',
      sandbox: false,
      verify: () =>
        Promise.reject(new ProviderError('smarty: down', { retryable: true, code: 'x' })),
    };
    await expect(
      addressLookupReportJob.run(context(US, { providers: { addressVerification: failing } })),
    ).rejects.toThrow(ProviderError);

    const ctx = context(US, { providers: { addressVerification: failing }, attempt: 5 });
    const result = completed(await addressLookupReportJob.run(ctx));
    expect(reasonOf(result, 'deliverability')).toBe('execution_error');
    served(ctx, result);
  });

  it('explains every provider field left null after an answer', async () => {
    const ctx = context(US, { providers: { addressVerification: recording() } });
    const result = completed(await addressLookupReportJob.run(ctx));

    for (const field of ADDRESS_VERIFICATION_FIELDS) {
      if (attributesOf(result)[field] === null) {
        expect(reasonOf(result, field), field).toBe('undetermined');
      }
    }
  });

  it('errors a query that is not the type’s with insufficient_input, sending nothing', async () => {
    const provider = recording();
    const ctx = context(
      { 'address-city': 'Exampleton' },
      { providers: { addressVerification: provider } },
    );
    const result = completed(await addressLookupReportJob.run(ctx));

    expect(result.errors).toEqual([{ code: 'insufficient_input' }]);
    expect(provider.requests).toEqual([]);
    served(ctx, result);
  });

  it('serves the contracts’ designators', () => {
    expect([...ADDRESS_DESIGNATORS]).toEqual(['po_box', 'military', 'pmb', 'general_delivery']);
  });
});
