/**
 * C83 (a C63 amendment): the five report provider kinds. The worker reads all five; the API none.
 * Each is unbound unless named (its report fields are then `null` with `provider_not_configured`,
 * or the media types error), a sandbox provider never binds a production environment, and no
 * value is ever echoed. `api-providers` builds the adapters behind the factories.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_PROVIDERS,
  PHASE6_PROVIDER_KINDS,
  PROCESS_PROVIDER_KINDS,
  PROVIDER_ENV_PREFIXES,
  PROVIDER_KINDS,
  PROVIDER_NAMES_BY_KIND,
  createProviderBindings,
  readProviderSettings,
} from './index.js';

const UNBOUND = {
  adverseMedia: null,
  emailIntelligence: null,
  phoneIntelligence: null,
  addressVerification: null,
  cryptoExposure: null,
};

/** Every kind bound: the sandbox providers for sandbox environments, the real adapters otherwise. */
const BOUND_ENV: NodeJS.ProcessEnv = {
  OPENVERIFY_PROVIDER_ADVERSE_MEDIA_SANDBOX: 'sandbox',
  OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: 'gdelt-doc',
  OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_SANDBOX: 'Sandbox',
  OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_PRODUCTION: 'hibp',
  OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_SANDBOX: ' sandbox ',
  OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_PRODUCTION: 'twilio-lookup',
  OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_SANDBOX: 'sandbox',
  OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION_PRODUCTION: 'smarty',
  OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_SANDBOX: 'sandbox',
};

describe('the C83 report provider kinds', () => {
  it('are kinds of their own, each with its variable and names, read by the worker only', () => {
    expect(PHASE6_PROVIDER_KINDS).toEqual([
      'adverseMedia',
      'emailIntelligence',
      'phoneIntelligence',
      'addressVerification',
      'cryptoExposure',
    ]);
    // C93.5 (Phase 7): ipReputation follows them.
    // Workflow 10B: deviceIntegrity follows Phase 8's kinds, so each earlier group moves by one.
    expect(PROVIDER_KINDS.slice(-9, -4)).toEqual([...PHASE6_PROVIDER_KINDS]);
    expect(PROVIDER_ENV_PREFIXES).toMatchObject({
      adverseMedia: 'OPENVERIFY_PROVIDER_ADVERSE_MEDIA',
      emailIntelligence: 'OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE',
      phoneIntelligence: 'OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE',
      addressVerification: 'OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION',
      cryptoExposure: 'OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE',
    });
    expect(PROVIDER_NAMES_BY_KIND).toMatchObject({
      adverseMedia: ['gdelt-doc', 'sandbox'],
      emailIntelligence: ['hibp', 'sandbox'],
      phoneIntelligence: ['twilio-lookup', 'sandbox'],
      addressVerification: ['smarty', 'sandbox'],
      cryptoExposure: ['sandbox'],
    });
    for (const kind of PHASE6_PROVIDER_KINDS) {
      expect(PROCESS_PROVIDER_KINDS.worker, kind).toContain(kind);
      expect(PROCESS_PROVIDER_KINDS.api, kind).not.toContain(kind);
    }
    expect(NO_PROVIDERS.production).toMatchObject(UNBOUND);
  });

  it('are unbound unless named: none is on by default', () => {
    const read = readProviderSettings({}, 'worker');

    expect(read.issues).toEqual([]);
    expect(read.settings.sandbox).toMatchObject(UNBOUND);
    expect(read.settings.production).toMatchObject(UNBOUND);
  });

  it('read each name the kind takes, for either environment kind, case-insensitively', () => {
    const read = readProviderSettings(BOUND_ENV, 'worker');

    expect(read.issues).toEqual([]);
    expect(read.settings.sandbox).toMatchObject({
      adverseMedia: 'sandbox',
      emailIntelligence: 'sandbox',
      phoneIntelligence: 'sandbox',
      addressVerification: 'sandbox',
      cryptoExposure: 'sandbox',
    });
    expect(read.settings.production).toMatchObject({
      adverseMedia: 'gdelt-doc',
      emailIntelligence: 'hibp',
      phoneIntelligence: 'twilio-lookup',
      addressVerification: 'smarty',
      cryptoExposure: null,
    });
  });

  it('refuse a sandbox provider for production and a name the kind does not take, echoing neither', () => {
    const read = readProviderSettings(
      {
        OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_PRODUCTION: 'sandbox',
        OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: 'sandbox',
        OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_SANDBOX: 'secret-vendor-key-123',
        // The API's SMS provider is not the worker's Lookup adapter (C83, decision 32).
        OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_PRODUCTION: 'twilio',
        OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_SANDBOX: 'chainalysis',
      },
      'worker',
    );

    expect(read.issues).toEqual([
      'OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE_SANDBOX: must be hibp or sandbox, or unset',
      'OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_SANDBOX: must be sandbox, the only provider this version ships, or unset',
      'OPENVERIFY_PROVIDER_ADVERSE_MEDIA_PRODUCTION: a sandbox provider cannot be bound to production environments',
      'OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE_PRODUCTION: must be twilio-lookup or sandbox, or unset',
      'OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_PRODUCTION: a sandbox provider cannot be bound to production environments',
    ]);
    expect(read.issues.join('\n')).not.toContain('secret-vendor-key-123');
    expect(read.settings.production).toMatchObject(UNBOUND);
  });

  it('are left to the worker: the API reads none of them, and so refuses none', () => {
    const read = readProviderSettings(
      { ...BOUND_ENV, OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE_PRODUCTION: 'sandbox' },
      'api',
    );

    expect(read.issues).toEqual([]);
    for (const kind of PHASE6_PROVIDER_KINDS) {
      expect(read.settings.sandbox, kind).not.toHaveProperty(kind);
    }
  });

  it('build each bound provider through its factory, with its identity', () => {
    const bindings = createProviderBindings(readProviderSettings(BOUND_ENV, 'worker').settings, {
      reportProviders: {
        gdeltAcknowledged: true,
        hibp: { apiKey: 'synthetic-hibp-key' },
        twilioLookup: {
          accountSid: `AC${'a'.repeat(32)}`,
          apiKeySid: `SK${'b'.repeat(32)}`,
          apiKeySecret: 'synthetic-lookup-secret',
        },
        smarty: { authId: 'synthetic-smarty-id', authToken: 'synthetic-smarty-token' },
      },
    });

    expect(bindings.sandbox).toMatchObject({
      adverseMedia: { id: 'sandbox', sandbox: true },
      emailIntelligence: { id: 'sandbox', sandbox: true },
      phoneIntelligence: { id: 'sandbox', sandbox: true },
      addressVerification: { id: 'sandbox', sandbox: true },
      cryptoExposure: { id: 'sandbox', sandbox: true },
    });
    expect(bindings.production).toMatchObject({
      adverseMedia: { id: 'gdelt-doc', sandbox: false },
      emailIntelligence: { id: 'hibp', sandbox: false },
      phoneIntelligence: { id: 'twilio-lookup', sandbox: false },
      addressVerification: { id: 'smarty', sandbox: false },
    });
    expect(bindings.production.cryptoExposure).toBeUndefined();
    expect(createProviderBindings(NO_PROVIDERS).sandbox.adverseMedia).toBeUndefined();
  });
});
