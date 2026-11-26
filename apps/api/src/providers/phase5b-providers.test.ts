/**
 * C61, C63 (V10): the Workflow 5B provider kinds. The worker reads all four; the API none.
 * `businessRegistry` and `domainAge` are on by default (unset or empty means `gleif`, plus the
 * national registers whose credentials are set, and `rdap`), so they take `none` to be unbound;
 * `maliciousWebsite` and `backlink` are unbound unless named. A sandbox provider never binds a
 * production environment, and no value is ever echoed.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_PROVIDERS,
  PHASE5B_PROVIDER_KINDS,
  PROCESS_PROVIDER_KINDS,
  PROVIDER_ENV_PREFIXES,
  PROVIDER_KINDS,
  PROVIDER_NAMES_BY_KIND,
  bindsMaliciousFeedList,
  createProviderBindings,
  readProviderSettings,
} from './index.js';

const REGISTRY_SANDBOX = 'OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_SANDBOX';
const REGISTRY_PRODUCTION = 'OPENVERIFY_PROVIDER_BUSINESS_REGISTRY_PRODUCTION';

describe('the Workflow 5B provider kinds (C63)', () => {
  it('are kinds of their own, each with its variable and names, read by the worker only', () => {
    expect(PHASE5B_PROVIDER_KINDS).toEqual([
      'businessRegistry',
      'domainAge',
      'maliciousWebsite',
      'backlink',
    ]);
    // C83: the Phase 6 report kinds come after them.
    // Followed by the five Phase 6 kinds and (C93.5, Phase 7) ipReputation.
    // Workflow 10B: deviceIntegrity follows Phase 8's kinds, so each earlier group moves by one.
    expect(PROVIDER_KINDS.slice(-13, -9)).toEqual([...PHASE5B_PROVIDER_KINDS]);
    expect(PROVIDER_ENV_PREFIXES).toMatchObject({
      businessRegistry: 'OPENVERIFY_PROVIDER_BUSINESS_REGISTRY',
      domainAge: 'OPENVERIFY_PROVIDER_DOMAIN_AGE',
      maliciousWebsite: 'OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE',
      backlink: 'OPENVERIFY_PROVIDER_BACKLINK',
    });
    expect(PROVIDER_NAMES_BY_KIND).toMatchObject({
      businessRegistry: ['gleif', 'companies-house', 'sec-edgar', 'sandbox'],
      domainAge: ['rdap', 'sandbox'],
      maliciousWebsite: ['feed-list', 'sandbox'],
      backlink: ['sandbox'],
    });
    for (const kind of PHASE5B_PROVIDER_KINDS) {
      expect(PROCESS_PROVIDER_KINDS.worker, kind).toContain(kind);
      expect(PROCESS_PROVIDER_KINDS.api, kind).not.toContain(kind);
    }
    expect(NO_PROVIDERS.production).toMatchObject({
      businessRegistry: null,
      domainAge: null,
      maliciousWebsite: null,
      backlink: null,
    });
  });

  it('binds GLEIF and RDAP when unset or empty, and no feed or backlink source (C61.1, F11)', () => {
    const read = readProviderSettings({ [REGISTRY_PRODUCTION]: '  ' }, 'worker');

    expect(read.issues).toEqual([]);
    for (const environment of ['sandbox', 'production'] as const) {
      expect(read.settings[environment]).toMatchObject({
        businessRegistry: ['gleif'],
        domainAge: 'rdap',
        maliciousWebsite: null,
        backlink: null,
      });
    }
  });

  it('adds Companies House with its key for that environment kind, and EDGAR with its contact', () => {
    const read = readProviderSettings(
      {
        OPENVERIFY_COMPANIES_HOUSE_API_KEY: 'synthetic-live-key',
        OPENVERIFY_SEC_EDGAR_USER_AGENT: 'Utopia Widgets admin@example.test',
      },
      'worker',
    );
    expect(read.settings.production.businessRegistry).toEqual([
      'gleif',
      'companies-house',
      'sec-edgar',
    ]);
    expect(read.settings.sandbox.businessRegistry).toEqual(['gleif', 'sec-edgar']);

    const sandboxKey = readProviderSettings(
      { OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY: 'synthetic-sandbox-key' },
      'worker',
    );
    expect(sandboxKey.settings.sandbox.businessRegistry).toEqual(['gleif', 'companies-house']);
    expect(sandboxKey.settings.production.businessRegistry).toEqual(['gleif']);
  });

  it('takes none to unbind the two kinds that are on by default, case-insensitively', () => {
    const read = readProviderSettings(
      {
        [REGISTRY_SANDBOX]: 'None',
        [REGISTRY_PRODUCTION]: 'none',
        OPENVERIFY_PROVIDER_DOMAIN_AGE_SANDBOX: 'none',
        OPENVERIFY_PROVIDER_DOMAIN_AGE_PRODUCTION: ' NONE ',
      },
      'worker',
    );

    expect(read.issues).toEqual([]);
    expect(read.settings.sandbox).toMatchObject({ businessRegistry: null, domainAge: null });
    expect(read.settings.production).toMatchObject({ businessRegistry: null, domainAge: null });
  });

  it('reads a list of registers in the order of asking, and the sandbox register alone', () => {
    const read = readProviderSettings(
      {
        [REGISTRY_SANDBOX]: 'sandbox',
        [REGISTRY_PRODUCTION]: 'gleif, sec-edgar,gleif',
        OPENVERIFY_PROVIDER_DOMAIN_AGE_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_PRODUCTION: 'feed-list',
        OPENVERIFY_PROVIDER_BACKLINK_SANDBOX: 'sandbox',
      },
      'worker',
    );

    expect(read.issues).toEqual([]);
    expect(read.settings.sandbox).toMatchObject({
      businessRegistry: 'sandbox',
      domainAge: 'sandbox',
      maliciousWebsite: 'sandbox',
      backlink: 'sandbox',
    });
    expect(read.settings.production).toMatchObject({
      businessRegistry: ['gleif', 'sec-edgar'],
      domainAge: 'rdap',
      maliciousWebsite: 'feed-list',
      backlink: null,
    });
  });

  it.each([
    [
      REGISTRY_PRODUCTION,
      'sandbox',
      'a sandbox provider cannot be bound to production environments',
    ],
    [
      'OPENVERIFY_PROVIDER_DOMAIN_AGE_PRODUCTION',
      'sandbox',
      'a sandbox provider cannot be bound to production environments',
    ],
    [
      'OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_PRODUCTION',
      'sandbox',
      'a sandbox provider cannot be bound to production environments',
    ],
    [
      'OPENVERIFY_PROVIDER_BACKLINK_PRODUCTION',
      'sandbox',
      'a sandbox provider cannot be bound to production environments',
    ],
    [
      REGISTRY_SANDBOX,
      'gleif,sandbox',
      'must be sandbox alone, none, or a list of gleif, companies-house and sec-edgar',
    ],
    [
      REGISTRY_SANDBOX,
      'opencorporates-secret-key',
      'must be sandbox alone, none, or a list of gleif, companies-house and sec-edgar',
    ],
    [
      'OPENVERIFY_PROVIDER_DOMAIN_AGE_SANDBOX',
      'whois-secret',
      'must be rdap or sandbox, none, or unset',
    ],
    [
      'OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_SANDBOX',
      'none',
      'must be feed-list or sandbox, or unset',
    ],
    [
      'OPENVERIFY_PROVIDER_BACKLINK_SANDBOX',
      'paid-backlinks-key',
      'must be sandbox, the only provider this version ships, or unset',
    ],
  ])('refuses %s=%s, naming the variable without echoing its value', (variable, value, problem) => {
    const read = readProviderSettings({ [variable]: value }, 'worker');

    expect(read.issues).toEqual([`${variable}: ${problem}`]);
    expect(read.issues.join('\n')).not.toContain('secret');
    expect(read.issues.join('\n')).not.toContain('-key');
  });

  it('is not read by the API, whatever it holds', () => {
    const read = readProviderSettings(
      { [REGISTRY_PRODUCTION]: 'sandbox', OPENVERIFY_PROVIDER_BACKLINK_PRODUCTION: 'x' },
      'api',
    );

    expect(read.issues).toEqual([]);
    expect(read.settings.production).not.toHaveProperty('businessRegistry');
    expect(read.settings.production).not.toHaveProperty('backlink');
  });
});

describe('createProviderBindings for the Workflow 5B kinds (C61, C63)', () => {
  it('binds the registers in order, the domain age, feed and backlink providers per environment kind', () => {
    const bindings = createProviderBindings(
      {
        sandbox: {
          businessRegistry: 'sandbox',
          domainAge: 'sandbox',
          maliciousWebsite: 'sandbox',
          backlink: 'sandbox',
        },
        production: {
          businessRegistry: ['companies-house', 'gleif'],
          domainAge: 'rdap',
          maliciousWebsite: 'feed-list',
          backlink: null,
        },
      },
      { companiesHouse: { apiKey: 'synthetic-live-key', sandboxApiKey: null } },
    );

    expect(bindings.sandbox.businessRegistry).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(bindings.sandbox).toMatchObject({
      domainAge: { id: 'sandbox', sandbox: true },
      maliciousWebsite: { id: 'sandbox', sandbox: true },
      backlink: { id: 'sandbox', sandbox: true },
    });
    const registers = bindings.production.businessRegistry;
    expect(Array.isArray(registers)).toBe(true);
    expect((registers as readonly { source: string }[]).map((register) => register.source)).toEqual(
      ['companies-house', 'gleif'],
    );
    expect(bindings.production).toMatchObject({
      domainAge: { id: 'rdap', sandbox: false },
      maliciousWebsite: { id: 'feed-list', sandbox: false },
    });
    expect(bindings.production.backlink).toBeUndefined();
  });

  it('refuses Companies House or EDGAR without its credential, and a sandbox register in production', () => {
    expect(() =>
      createProviderBindings({
        sandbox: {},
        production: { businessRegistry: ['companies-house'] },
      }),
    ).toThrow('companies-house needs its key (OPENVERIFY_COMPANIES_HOUSE_API_KEY)');
    expect(() =>
      createProviderBindings({
        sandbox: { businessRegistry: ['companies-house'] },
        production: {},
      }),
    ).toThrow('companies-house needs its key (OPENVERIFY_COMPANIES_HOUSE_SANDBOX_API_KEY)');
    expect(() =>
      createProviderBindings({ sandbox: {}, production: { businessRegistry: ['sec-edgar'] } }),
    ).toThrow('sec-edgar needs its contact (OPENVERIFY_SEC_EDGAR_USER_AGENT)');
    expect(() =>
      createProviderBindings({ sandbox: {}, production: { businessRegistry: 'sandbox' } }),
    ).toThrow('a sandbox provider cannot be bound to production environments');
  });
});

// The Workflow 5B factories' stubs are gone: api-kyb built them, and their tests are in
// business-registry/, domain-age/, malicious-website/ and backlink/.

describe('bindsMaliciousFeedList (C61.5)', () => {
  const settings = (variables: Record<string, string>) =>
    readProviderSettings(variables, 'worker').settings;

  it('is true when either kind binds feed-list, so the worker loads the list', () => {
    expect(
      bindsMaliciousFeedList(
        settings({ OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_PRODUCTION: 'feed-list' }),
      ),
    ).toBe(true);
    expect(
      bindsMaliciousFeedList(
        settings({ OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_SANDBOX: 'feed-list' }),
      ),
    ).toBe(true);
  });

  it('is false for the sandbox provider and while unbound', () => {
    expect(
      bindsMaliciousFeedList(
        settings({ OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_SANDBOX: 'sandbox' }),
      ),
    ).toBe(false);
    expect(bindsMaliciousFeedList(settings({}))).toBe(false);
    expect(bindsMaliciousFeedList(NO_PROVIDERS)).toBe(false);
  });
});
