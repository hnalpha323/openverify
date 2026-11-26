import { describe, expect, it } from 'vitest';
import type { BusinessRegistryProvider, RateLimiter } from '../ports.js';
import { createInMemoryKeyValueCache, fixedClock } from '../test-support/fakes.js';
import { createMockOutbound, jsonHeaders } from './business-registry/testing.js';
import {
  NO_PROVIDERS,
  PROCESS_PROVIDER_KINDS,
  PROVIDER_ENV_PREFIXES,
  PROVIDER_KINDS,
  PROVIDER_NAMES_BY_KIND,
  ProviderError,
  createProviderBindings,
  providerVariable,
  readProviderSettings,
} from './index.js';

/** C61.1: unset or empty binds GLEIF and RDAP, so an empty environment reads them. */
const ON_BY_DEFAULT = { businessRegistry: ['gleif'], domainAge: 'rdap' };

describe('readProviderSettings (C35)', () => {
  it('names one variable per check and environment kind', () => {
    expect(PROVIDER_ENV_PREFIXES).toEqual({
      aamva: 'OPENVERIFY_PROVIDER_AAMVA',
      publicFigure: 'OPENVERIFY_PROVIDER_PUBLIC_FIGURE',
      ageEstimate: 'OPENVERIFY_PROVIDER_AGE_ESTIMATE',
      selfieAgeEstimate: 'OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE',
      selfiePublicFigure: 'OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE',
      suspiciousEntity: 'OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY',
      sms: 'OPENVERIFY_PROVIDER_SMS',
      database: 'OPENVERIFY_PROVIDER_DATABASE',
      evmRpc: 'OPENVERIFY_PROVIDER_EVM_RPC',
      businessRegistry: 'OPENVERIFY_PROVIDER_BUSINESS_REGISTRY',
      domainAge: 'OPENVERIFY_PROVIDER_DOMAIN_AGE',
      maliciousWebsite: 'OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE',
      backlink: 'OPENVERIFY_PROVIDER_BACKLINK',
      // C83 (Phase 6).
      adverseMedia: 'OPENVERIFY_PROVIDER_ADVERSE_MEDIA',
      emailIntelligence: 'OPENVERIFY_PROVIDER_EMAIL_INTELLIGENCE',
      phoneIntelligence: 'OPENVERIFY_PROVIDER_PHONE_INTELLIGENCE',
      addressVerification: 'OPENVERIFY_PROVIDER_ADDRESS_VERIFICATION',
      cryptoExposure: 'OPENVERIFY_PROVIDER_CRYPTO_EXPOSURE',
      // C93.5 (Phase 7).
      ipReputation: 'OPENVERIFY_PROVIDER_IP_REPUTATION',
      // C126.3, C135.5 (Phase 8).
      slack: 'OPENVERIFY_PROVIDER_SLACK',
      attachmentScanner: 'OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER',
      // C211.4 (Workflow 10B).
      deviceIntegrity: 'OPENVERIFY_PROVIDER_DEVICE_INTEGRITY',
    });
    expect(PROVIDER_KINDS).toEqual([
      'aamva',
      'publicFigure',
      'ageEstimate',
      'selfieAgeEstimate',
      'selfiePublicFigure',
      'suspiciousEntity',
      'sms',
      'database',
      'evmRpc',
      'businessRegistry',
      'domainAge',
      'maliciousWebsite',
      'backlink',
      'adverseMedia',
      'emailIntelligence',
      'phoneIntelligence',
      'addressVerification',
      'cryptoExposure',
      'ipReputation',
      'slack',
      'attachmentScanner',
      'deviceIntegrity',
    ]);
    expect(providerVariable('ageEstimate', 'production')).toBe(
      'OPENVERIFY_PROVIDER_AGE_ESTIMATE_PRODUCTION',
    );
  });

  it('reads nothing bound from an empty environment, but the two kinds on by default (C61.1)', () => {
    expect(readProviderSettings({})).toEqual({
      settings: {
        sandbox: { ...NO_PROVIDERS.sandbox, ...ON_BY_DEFAULT },
        production: { ...NO_PROVIDERS.production, ...ON_BY_DEFAULT },
      },
      issues: [],
    });
    expect(NO_PROVIDERS.production).toEqual({
      aamva: null,
      publicFigure: null,
      ageEstimate: null,
      selfieAgeEstimate: null,
      selfiePublicFigure: null,
      suspiciousEntity: null,
      sms: null,
      database: null,
      evmRpc: null,
      businessRegistry: null,
      domainAge: null,
      maliciousWebsite: null,
      backlink: null,
      adverseMedia: null,
      emailIntelligence: null,
      phoneIntelligence: null,
      addressVerification: null,
      cryptoExposure: null,
      ipReputation: null,
      slack: null,
      attachmentScanner: null,
      deviceIntegrity: null,
    });
  });

  it('reads the C44 selfie bindings for sandbox environments', () => {
    const read = readProviderSettings({
      OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_SANDBOX: ' Sandbox ',
      OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_SANDBOX: 'sandbox',
    });

    expect(read.issues).toEqual([]);
    expect(read.settings.sandbox).toMatchObject({
      selfieAgeEstimate: 'sandbox',
      selfiePublicFigure: 'sandbox',
      suspiciousEntity: 'sandbox',
    });
  });

  it.each([
    'OPENVERIFY_PROVIDER_SELFIE_AGE_ESTIMATE_PRODUCTION',
    'OPENVERIFY_PROVIDER_SELFIE_PUBLIC_FIGURE_PRODUCTION',
    'OPENVERIFY_PROVIDER_SUSPICIOUS_ENTITY_PRODUCTION',
  ])('refuses the sandbox selfie provider for production (%s)', (variable) => {
    const read = readProviderSettings({ [variable]: 'sandbox' });

    expect(read.issues).toEqual([
      `${variable}: a sandbox provider cannot be bound to production environments`,
    ]);
    expect(read.settings.production).toEqual({ ...NO_PROVIDERS.production, ...ON_BY_DEFAULT });
  });

  it('reads every sandbox binding, case-insensitively, and reports each problem at once', () => {
    const read = readProviderSettings({
      OPENVERIFY_PROVIDER_AAMVA_SANDBOX: 'SANDBOX',
      OPENVERIFY_PROVIDER_PUBLIC_FIGURE_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_AGE_ESTIMATE_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_AAMVA_PRODUCTION: 'sandbox',
      OPENVERIFY_PROVIDER_AGE_ESTIMATE_PRODUCTION: 'vendor',
    });

    expect(read.settings.sandbox).toEqual({
      ...NO_PROVIDERS.sandbox,
      ...ON_BY_DEFAULT,
      aamva: 'sandbox',
      publicFigure: 'sandbox',
      ageEstimate: 'sandbox',
    });
    expect(read.settings.production).toEqual({ ...NO_PROVIDERS.production, ...ON_BY_DEFAULT });
    expect(read.issues).toEqual([
      'OPENVERIFY_PROVIDER_AAMVA_PRODUCTION: a sandbox provider cannot be bound to production environments',
      'OPENVERIFY_PROVIDER_AGE_ESTIMATE_PRODUCTION: must be sandbox, the only provider this version ships, or unset',
    ]);
  });
});

describe('createProviderBindings (C35)', () => {
  it('binds the sandbox providers where configured, and nothing elsewhere', () => {
    const bindings = createProviderBindings({
      sandbox: { aamva: 'sandbox', publicFigure: null, ageEstimate: 'sandbox' },
      production: { aamva: null, publicFigure: null, ageEstimate: null },
    });

    expect(bindings.sandbox.aamva).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.sandbox.publicFigure).toBeUndefined();
    expect(bindings.sandbox.ageEstimate).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.production).toEqual({});
  });

  it('binds the C44 selfie sandbox providers, each labelled sandbox', () => {
    const bindings = createProviderBindings({
      sandbox: {
        ...NO_PROVIDERS.sandbox,
        selfieAgeEstimate: 'sandbox',
        selfiePublicFigure: 'sandbox',
        suspiciousEntity: 'sandbox',
      },
      production: NO_PROVIDERS.production,
    });

    expect(bindings.sandbox.selfieAgeEstimate).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.sandbox.selfiePublicFigure).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.sandbox.suspiciousEntity).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.sandbox.aamva).toBeUndefined();
    expect(bindings.production).toEqual({});
  });

  it('refuses a selfie sandbox provider for production even when called directly', () => {
    expect(() =>
      createProviderBindings({
        sandbox: NO_PROVIDERS.sandbox,
        production: { ...NO_PROVIDERS.production, suspiciousEntity: 'sandbox' },
      }),
    ).toThrow('a sandbox provider cannot be bound to production environments');
  });

  it('refuses a sandbox provider for production even when called directly', () => {
    expect(() =>
      createProviderBindings({
        sandbox: NO_PROVIDERS.sandbox,
        production: { aamva: 'sandbox', publicFigure: null, ageEstimate: null },
      }),
    ).toThrow('a sandbox provider cannot be bound to production environments');
  });
});

describe('ProviderError', () => {
  it('says whether a retry can help', () => {
    const error = new ProviderError('DLDV answered 503', { retryable: true });
    expect(error).toMatchObject({ name: 'ProviderError', retryable: true });
  });
});

describe('C63 provider kinds, per process (V10)', () => {
  it('reads only the kinds each process uses: the API sms, database and aamva, the worker every other', () => {
    const env = {
      OPENVERIFY_PROVIDER_SMS_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_DATABASE_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_AAMVA_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_PUBLIC_FIGURE_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX: 'sandbox',
    };

    // C93.5 (Phase 7): ipReputation is read by both processes; C211.4 (Workflow 10B):
    // deviceIntegrity too (the session's integrity member, the decode).
    expect(PROCESS_PROVIDER_KINDS.api).toEqual([
      'sms',
      'database',
      'aamva',
      'ipReputation',
      'deviceIntegrity',
    ]);
    expect(PROCESS_PROVIDER_KINDS.worker).toEqual([...PROVIDER_KINDS]);
    expect(readProviderSettings(env, 'api').settings).toEqual({
      sandbox: {
        sms: 'sandbox',
        database: 'sandbox',
        aamva: 'sandbox',
        ipReputation: null,
        deviceIntegrity: null,
      },
      production: {
        sms: null,
        database: null,
        aamva: null,
        ipReputation: null,
        deviceIntegrity: null,
      },
    });
    expect(readProviderSettings(env, 'worker').settings.sandbox).toEqual({
      ...Object.fromEntries(PROCESS_PROVIDER_KINDS.worker.map((kind) => [kind, null])),
      ...ON_BY_DEFAULT,
      // C126.6, decision 76: the worker reads sms too.
      sms: 'sandbox',
      database: 'sandbox',
      aamva: 'sandbox',
      publicFigure: 'sandbox',
      evmRpc: 'sandbox',
    });
  });

  it('never reads a kind of the other process, so its mistakes stop only that process', () => {
    expect(
      readProviderSettings({ OPENVERIFY_PROVIDER_PUBLIC_FIGURE_PRODUCTION: 'sandbox' }, 'api')
        .issues,
    ).toEqual([]);
    expect(
      readProviderSettings({ OPENVERIFY_PROVIDER_SLACK_PRODUCTION: 'sandbox' }, 'api').issues,
    ).toEqual([]);
  });

  it('holds the worker to sms now it reads it, so a mistake there stops it too (C126.6)', () => {
    expect(
      readProviderSettings({ OPENVERIFY_PROVIDER_SMS_PRODUCTION: 'sandbox' }, 'worker').issues,
    ).toHaveLength(1);
  });

  it('takes each kind its own names, and a real provider may bind production environments', () => {
    const read = readProviderSettings({
      OPENVERIFY_PROVIDER_SMS_SANDBOX: 'Sandbox',
      OPENVERIFY_PROVIDER_SMS_PRODUCTION: ' twilio ',
      OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX: 'sandbox',
      OPENVERIFY_PROVIDER_EVM_RPC_PRODUCTION: 'JSON-RPC',
    });

    expect(read.issues).toEqual([]);
    expect(read.settings.sandbox).toMatchObject({ sms: 'sandbox', evmRpc: 'sandbox' });
    expect(read.settings.production).toMatchObject({ sms: 'twilio', evmRpc: 'json-rpc' });
    expect(PROVIDER_NAMES_BY_KIND).toMatchObject({
      sms: ['twilio', 'sandbox'],
      database: ['sandbox'],
      evmRpc: ['json-rpc', 'sandbox'],
    });
  });

  it.each([
    [
      'OPENVERIFY_PROVIDER_SMS_PRODUCTION',
      'sandbox',
      'a sandbox provider cannot be bound to production environments',
    ],
    [
      'OPENVERIFY_PROVIDER_DATABASE_PRODUCTION',
      'sandbox',
      'a sandbox provider cannot be bound to production environments',
    ],
    [
      'OPENVERIFY_PROVIDER_EVM_RPC_PRODUCTION',
      'sandbox',
      'a sandbox provider cannot be bound to production environments',
    ],
    ['OPENVERIFY_PROVIDER_SMS_SANDBOX', 'vendor-secret-1', 'must be twilio or sandbox, or unset'],
    [
      'OPENVERIFY_PROVIDER_EVM_RPC_SANDBOX',
      'https://rpc.example.test/key-1',
      'must be json-rpc or sandbox, or unset',
    ],
    [
      'OPENVERIFY_PROVIDER_DATABASE_SANDBOX',
      'twilio',
      'must be sandbox, the only provider this version ships, or unset',
    ],
  ])('refuses %s=%s without echoing the value', (variable, value, problem) => {
    const read = readProviderSettings({ [variable]: value });

    expect(read.issues).toEqual([`${variable}: ${problem}`]);
    expect(read.issues.join('\n')).not.toContain(value === 'sandbox' ? '=sandbox' : value);
  });
});

const TWILIO = {
  accountSid: `AC${'0'.repeat(32)}`,
  apiKeySid: `SK${'1'.repeat(32)}`,
  // Synthetic and low-entropy on purpose: never a real secret.
  apiKeySecret: 's'.repeat(40),
  messagingServiceSid: `MG${'2'.repeat(32)}`,
  from: null,
};
const EVM_RPC = {
  urls: new Map([['eip155:1', 'https://rpc.example.test/synthetic-key']]),
  allowPrivateNetworks: false,
};

describe('createProviderBindings (C63)', () => {
  it('binds the SMS sender, the database and the EVM RPC per environment kind, real ones in production', () => {
    const bindings = createProviderBindings(
      {
        sandbox: { sms: 'sandbox', database: 'sandbox', evmRpc: 'sandbox' },
        production: { sms: 'twilio', database: null, evmRpc: 'json-rpc' },
      },
      { twilio: TWILIO, evmRpc: EVM_RPC },
    );

    expect(bindings.sandbox.sms).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.sandbox.database).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.sandbox.evmRpc).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.production.sms).toMatchObject({ id: 'twilio', sandbox: false });
    expect(bindings.production.database).toBeUndefined();
    expect(bindings.production.evmRpc).toMatchObject({ id: 'json-rpc', sandbox: false });
  });

  it('hands the GCRA limiter to the registers and RDAP, which pace through it (Workflow 5C review K4)', async () => {
    const clock = fixedClock();
    const names: string[] = [];
    const rateLimiter: RateLimiter = {
      consume: (_key, rule) => {
        names.push(rule.name);
        return Promise.resolve({
          allowed: true,
          limit: rule.limit,
          remaining: 0,
          resetAt: new Date(0),
          retryAfterSeconds: 0,
        });
      },
    };
    const outbound = createMockOutbound();
    try {
      outbound.agent
        .get('https://api.gleif.org')
        .intercept({ path: (path) => path.startsWith('/api/v1/lei-records?'), method: 'GET' })
        .reply(200, { data: [] }, jsonHeaders('application/vnd.api+json'));
      outbound.agent
        .get('https://data.iana.org')
        .intercept({ path: '/rdap/dns.json', method: 'GET' })
        .reply(
          200,
          { services: [[['example'], ['https://rdap.registry-one.example.test/']]] },
          jsonHeaders(),
        );
      outbound.agent
        .get('https://rdap.registry-one.example.test')
        .intercept({ path: '/domain/utopia.example', method: 'GET' })
        .reply(404, '');
      const bindings = createProviderBindings(
        { sandbox: {}, production: { businessRegistry: ['gleif'], domainAge: 'rdap' } },
        {
          outboundHttp: outbound,
          cache: createInMemoryKeyValueCache(clock),
          rateLimiter,
          clock,
        },
      );

      const registers = bindings.production.businessRegistry;
      expect(Array.isArray(registers)).toBe(true);
      const [gleif] = Array.isArray(registers)
        ? (registers as readonly BusinessRegistryProvider[])
        : [];
      await gleif?.lookup({ country: 'GB', businessName: 'Utopia Synthetic' });
      await bindings.production.domainAge?.age({ host: 'utopia.example' });

      expect(names).toEqual(['pacing:gleif', 'pacing:rdap']);
    } finally {
      await outbound.close();
    }
  });

  it.each([{ sms: 'sandbox' }, { database: 'sandbox' }, { evmRpc: 'sandbox' }] as const)(
    'refuses a sandbox provider for production even when called directly: %o',
    (production) => {
      expect(() => createProviderBindings({ sandbox: NO_PROVIDERS.sandbox, production })).toThrow(
        'a sandbox provider cannot be bound to production environments',
      );
    },
  );

  it('refuses a name its kind does not take, and a real provider without its credentials', () => {
    expect(() =>
      createProviderBindings({ sandbox: { database: 'twilio' }, production: {} }),
    ).toThrow('database cannot be bound to twilio');
    expect(() => createProviderBindings({ sandbox: { sms: 'twilio' }, production: {} })).toThrow(
      'twilio needs its credentials',
    );
    expect(() =>
      createProviderBindings({ sandbox: {}, production: { evmRpc: 'json-rpc' } }),
    ).toThrow('json-rpc needs its node URLs');
  });
});
