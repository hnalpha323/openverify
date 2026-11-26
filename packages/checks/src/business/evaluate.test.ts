/**
 * The business runners and their contracts (C51.2, C61.7): every check has an evaluator, results
 * carry only the reasons the C51.2 table gives their check, no result holds an entered or
 * registered value, and the default templates decide the C61.6 sandbox cases as the plan says.
 */
import {
  checkResultSchema,
  decideVerification,
  defaultTemplateConfig,
  listChecks,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import { evaluateBusinessWebsiteChecks, evaluateDatabaseBusinessChecks } from './evaluate.js';
import { BUSINESS_WEBSITE_EVALUATORS, DATABASE_BUSINESS_EVALUATORS } from './evaluators.js';
import type { BusinessWebsiteCheckInput, DatabaseBusinessCheckInput } from './inputs.js';
import { BUSINESS_EVALUATOR_REASONS } from './reasons.js';
import {
  DNS_PROVIDER,
  ENTERED,
  NOW,
  SANDBOX_PROVIDER,
  businessInput,
  failed,
  found,
  notFound,
  registryRecord,
  result,
  templateOf,
  unsupported,
  websiteInput,
} from './testing.js';

/** The C51.2 rows of `packages/contracts/src/business-check-reasons.ts`, with their shared reasons. */
const PROVIDER = ['input_missing', 'execution_error', 'provider_not_configured'];
const C51_2: Readonly<Record<string, readonly string[]>> = {
  database_business_identity_comparison: [
    ...PROVIDER,
    'low_confidence_match',
    'registration_number_not_found',
    'no_registry_record',
    'insufficient_data',
  ],
  database_business_active_business_detection: [
    ...PROVIDER,
    'business_inactive',
    'no_registry_record',
    'status_not_available',
  ],
  database_business_associated_persons_comparison: [
    ...PROVIDER,
    'associated_person_not_on_register',
    'not_requested',
    'source_has_no_persons',
    'no_registry_record',
  ],
  database_business_enabled_country_detection: [
    'input_missing',
    'country_not_enabled',
    'no_allowlist',
  ],
  database_business_service_available_detection: PROVIDER,
  business_website_resolution_detection: [...PROVIDER, 'domain_not_resolving'],
  business_website_domain_age_detection: [
    ...PROVIDER,
    'domain_recently_registered',
    'domain_age_unavailable',
  ],
  business_website_malicious_website_detection: [...PROVIDER, 'malware', 'phishing', 'spam_source'],
  business_website_backlink_detection: [...PROVIDER, 'backlinks_below_threshold'],
};

const PERSON = { 'name-first': 'Quinn', 'name-last': 'Valemont', birthdate: '1987-04' };

const REGISTRY_BATTERY: readonly [string, DatabaseBusinessCheckInput][] = [
  ['a match', businessInput()],
  [
    'persons',
    businessInput(undefined, {
      collectAssociatedPersons: true,
      values: {
        ...ENTERED,
        'associated-persons': [PERSON, { 'name-first': 'Lior', 'name-last': 'Brennagh' }],
      },
    }),
  ],
  ['an authoritative miss', businessInput([notFound('companies-house', true)])],
  ['a lapsed LEI', businessInput([found(registryRecord({ status: 'LAPSED' }))])],
  ['every register unsupported', businessInput([unsupported('gleif')])],
  ['a failed register', businessInput([failed('gleif')])],
  ['no register', businessInput([])],
  ['no values', businessInput(undefined, { values: null })],
];

const WEBSITE_BATTERY: readonly [string, BusinessWebsiteCheckInput][] = [
  [
    'every answer',
    websiteInput({
      resolution: result({ kind: 'addresses', addresses: ['1.1.1.1'] }, DNS_PROVIDER),
      domainAge: result({
        outcome: 'registered',
        registeredAt: new Date('2006-01-01T00:00:00Z'),
        domain: 'utopiaorchard.example',
      }),
      maliciousWebsite: result({ outcome: 'listed', categories: ['phishing'], feeds: ['feed-a'] }),
      backlink: result({ count: 3 }),
    }),
  ],
  ['no answer', websiteInput()],
  [
    'failures',
    websiteInput({
      resolution: { kind: 'error' },
      domainAge: { kind: 'error' },
      maliciousWebsite: { kind: 'error' },
      backlink: { kind: 'error' },
    }),
  ],
  [
    'a sandbox reserved name',
    websiteInput({ environment: 'sandbox', values: { 'website-url': 'https://gone.invalid/' } }),
  ],
  ['no values', websiteInput({ values: null })],
];

describe('the business evaluators', () => {
  it('cover every business registry and business website check of the registry', () => {
    expect(Object.keys(DATABASE_BUSINESS_EVALUATORS).sort()).toEqual(
      listChecks('database_business')
        .map((check) => check.id)
        .sort(),
    );
    expect(Object.keys(BUSINESS_WEBSITE_EVALUATORS).sort()).toEqual(
      listChecks('business_website')
        .map((check) => check.id)
        .sort(),
    );
  });

  it('declare the C51.2 reasons of each check', () => {
    expect(BUSINESS_EVALUATOR_REASONS).toEqual(C51_2);
  });

  it.each(REGISTRY_BATTERY)(
    'answer only declared reasons, holding no value: registry, %s',
    (_name, input) => {
      const everything = templateOf(
        Object.keys(DATABASE_BUSINESS_EVALUATORS) as never,
        {},
        { 'allowed-countries': ['GB'] },
      );
      const results = evaluateDatabaseBusinessChecks(input, everything);
      for (const one of results) {
        expect(checkResultSchema.parse(one)).toEqual(one);
        for (const reason of one.reasons) {
          expect(BUSINESS_EVALUATOR_REASONS[one.name], `${one.name}: ${reason}`).toContain(reason);
        }
      }
      const text = JSON.stringify(results).toLowerCase();
      for (const value of [
        'utopia',
        'orchard',
        'valemont',
        'vellacott',
        'brennagh',
        'lantern',
        '00000001',
      ]) {
        expect(text).not.toContain(value);
      }
    },
  );

  it.each(WEBSITE_BATTERY)(
    'answer only declared reasons, holding no value: website, %s',
    (_name, input) => {
      const everything = templateOf(Object.keys(BUSINESS_WEBSITE_EVALUATORS) as never);
      const results = evaluateBusinessWebsiteChecks(input, everything);
      for (const one of results) {
        expect(checkResultSchema.parse(one)).toEqual(one);
        for (const reason of one.reasons) {
          expect(BUSINESS_EVALUATOR_REASONS[one.name], `${one.name}: ${reason}`).toContain(reason);
        }
      }
      const text = JSON.stringify(results).toLowerCase();
      for (const value of ['utopiaorchard', 'gone.invalid', 'shop.', '1.1.1.1', 'feed-a']) {
        expect(text).not.toContain(value);
      }
    },
  );
});

describe('the runners', () => {
  it('run the enabled checks in configuration order and skip disabled ones', () => {
    const results = evaluateDatabaseBusinessChecks(businessInput(), {
      checks: {
        database_business_active_business_detection: { enabled: true, required: true },
        database_business_identity_comparison: { enabled: true, required: true },
        database_business_enabled_country_detection: { enabled: false, required: false },
      },
    });
    expect(results.map((one) => one.name)).toEqual([
      'database_business_active_business_detection',
      'database_business_identity_comparison',
    ]);
  });

  it('refuse a check of another type, or a config its schema refuses', () => {
    expect(() =>
      evaluateDatabaseBusinessChecks(
        businessInput(),
        templateOf(['business_website_resolution_detection']),
      ),
    ).toThrow(InvalidCheckConfigError);
    expect(() =>
      evaluateBusinessWebsiteChecks(
        websiteInput(),
        templateOf(['business_website_domain_age_detection'], {
          business_website_domain_age_detection: { 'min-domain-age-days': 0 },
        }),
      ),
    ).toThrow(InvalidCheckConfigError);
  });
});

describe('the default templates on the C61.6 sandbox cases', () => {
  const registry = defaultTemplateConfig('database_business');
  const website = defaultTemplateConfig('business_website');
  const sandboxed = (record: Parameters<typeof registryRecord>[0], authoritative = true) =>
    businessInput([
      found(
        registryRecord({ source: 'sandbox', status: 'active', statusDetail: null, ...record }),
        { authoritative },
      ),
    ]);
  const decideRegistry = (input: DatabaseBusinessCheckInput) =>
    decideVerification(evaluateDatabaseBusinessChecks(input, registry), registry).status;

  it('passes a found, active, matching record', () => {
    expect(decideRegistry(sandboxed({}))).toBe('passed');
  });

  it('fails an identity mismatch (0000) and an inactive business (8888)', () => {
    expect(
      decideRegistry(
        sandboxed({
          legalName: 'Meridale Glassworks Inc',
          otherNames: [],
          registrationNumber: '00000000',
          registeredAddress: null,
        }),
      ),
    ).toBe('failed');
    expect(decideRegistry(sandboxed({ status: 'inactive' }))).toBe('failed');
  });

  it('reviews a number the authoritative register lacks (9999)', () => {
    expect(decideRegistry(businessInput([notFound('sandbox', true)]))).toBe('needs_review');
  });

  it('records a person not on the register (7777) on the advisory check only', () => {
    const results = evaluateDatabaseBusinessChecks(
      {
        ...sandboxed({}),
        collectAssociatedPersons: true,
        values: {
          ...ENTERED,
          'associated-persons': [
            { 'name-first': 'Lior', 'name-last': 'Brennagh', birthdate: '1980-01' },
          ],
        },
      },
      registry,
    );
    const decision = decideVerification(results, registry);
    expect(decision.status).toBe('passed');
    expect(decision.advisoryFailedCheckIds).toEqual([
      'database_business_associated_persons_comparison',
    ]);
  });

  it('reviews a registry verification with no register bound', () => {
    expect(decideRegistry(businessInput([]))).toBe('needs_review');
  });

  it('passes old.example on resolution, and records new.example only on the advisory age check', () => {
    const sandbox = (url: string, days: number) =>
      websiteInput({
        environment: 'sandbox',
        values: { 'website-url': url },
        domainAge: result(
          {
            outcome: 'registered',
            registeredAt: new Date(NOW.getTime() - days * 86_400_000),
            domain: new URL(url).hostname,
          },
          SANDBOX_PROVIDER,
        ),
      });
    const old = evaluateBusinessWebsiteChecks(sandbox('https://old.example/', 7305), website);
    expect(decideVerification(old, website).status).toBe('passed');
    const fresh = decideVerification(
      evaluateBusinessWebsiteChecks(sandbox('https://new.example/', 3), website),
      website,
    );
    expect(fresh.status).toBe('passed');
    expect(fresh.advisoryFailedCheckIds).toEqual(['business_website_domain_age_detection']);
  });

  it('fails a website whose host does not resolve, with a hint', () => {
    const decision = decideVerification(
      evaluateBusinessWebsiteChecks(
        websiteInput({
          environment: 'sandbox',
          values: { 'website-url': 'https://gone.invalid/' },
        }),
        website,
      ),
      website,
    );
    expect(decision.status).toBe('failed');
    expect(decision.hints).toEqual([
      { checkId: 'business_website_resolution_detection', reasons: ['domain_not_resolving'] },
    ]);
  });
});
