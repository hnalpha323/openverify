/**
 * C83: `createProviderBindings` hands each report provider factory (owned by `api-providers`) the
 * name bound and the same options: the credentials the worker read, its outbound client, its
 * cache, its GCRA limiter (the shared GDELT budget, C81.2) and its clock. The factories are
 * replaced here, so only what they receive is under test.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReportProviderCredentials } from '../config.js';
import {
  createInMemoryKeyValueCache,
  createRefusingOutboundHttp,
  fixedClock,
} from '../test-support/fakes.js';
import { createProviderBindings, readProviderSettings } from './index.js';

const factories = vi.hoisted(() => {
  const identity = (name: string) => ({ id: name, sandbox: name === 'sandbox' });
  return {
    adverseMedia: vi.fn(identity),
    emailIntelligence: vi.fn(identity),
    phoneIntelligence: vi.fn(identity),
    addressVerification: vi.fn(identity),
    cryptoExposure: vi.fn(identity),
  };
});
vi.mock('./adverse-media/index.js', () => ({
  createAdverseMediaProvider: factories.adverseMedia,
}));
vi.mock('./email-intelligence/index.js', () => ({
  createEmailIntelligenceProvider: factories.emailIntelligence,
}));
vi.mock('./phone-intelligence/index.js', () => ({
  createPhoneIntelligenceProvider: factories.phoneIntelligence,
}));
vi.mock('./address-verification/index.js', () => ({
  createAddressVerificationProvider: factories.addressVerification,
}));
vi.mock('./crypto-exposure/index.js', () => ({
  createCryptoExposureProvider: factories.cryptoExposure,
}));

const CREDENTIALS: ReportProviderCredentials = {
  gdeltAcknowledged: true,
  hibp: { apiKey: 'synthetic-hibp-key' },
  twilioLookup: null,
  smarty: null,
};

describe('the report provider factories (C83)', () => {
  it('each get the bound name and the worker’s credentials, clients and clock', () => {
    const clock = fixedClock();
    const outboundHttp = createRefusingOutboundHttp();
    const cache = createInMemoryKeyValueCache(clock);
    const rateLimiter = { consume: vi.fn() };
    const settings = readProviderSettings(
      {
        OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: 'gdelt-doc',
        OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_PRODUCTION: 'hibp',
        OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_SANDBOX: 'sandbox',
      },
      'worker',
    ).settings;

    createProviderBindings(settings, {
      reportProviders: CREDENTIALS,
      outboundHttp,
      cache,
      rateLimiter,
      clock,
    });

    const options = { credentials: CREDENTIALS, outboundHttp, cache, rateLimiter, clock };
    expect(factories.adverseMedia.mock.calls).toEqual([['gdelt-doc', options]]);
    expect(factories.emailIntelligence.mock.calls).toEqual([
      ['sandbox', options],
      ['hibp', options],
    ]);
    expect(factories.phoneIntelligence.mock.calls).toEqual([['sandbox', options]]);
    expect(factories.addressVerification.mock.calls).toEqual([['sandbox', options]]);
    expect(factories.cryptoExposure.mock.calls).toEqual([['sandbox', options]]);
  });
});
