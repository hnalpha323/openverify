/**
 * Synthetic fixtures for the business registry and website evaluator tests: an invented
 * cooperative, invented officers, an invented street and town, the unassigned ZIP code 00000,
 * and `.example` hosts (RFC 2606). Not exported from the package.
 */
import type { CheckId, CheckProvider, VerificationTemplateConfig } from '@openverify/core';
import type { ProviderOutcome } from '../government-id/inputs.js';
import type {
  BusinessPersonRecord,
  BusinessRegistryAnswer,
  BusinessRegistryLookup,
  BusinessRegistryRecord,
  BusinessRegistrySourceName,
  BusinessWebsiteCheckInput,
  DatabaseBusinessCheckInput,
  DatabaseBusinessValues,
} from './inputs.js';

export const NOW = new Date('2026-10-23T12:00:00Z');

export const PROVIDERS: Readonly<Record<BusinessRegistrySourceName, CheckProvider>> = {
  gleif: { id: 'gleif', sandbox: false },
  'companies-house': { id: 'companies-house', sandbox: false },
  'sec-edgar': { id: 'sec-edgar', sandbox: false },
  sandbox: { id: 'sandbox', sandbox: true },
};
export const DNS_PROVIDER: CheckProvider = { id: 'dns', sandbox: false };
export const RDAP_PROVIDER: CheckProvider = { id: 'rdap', sandbox: false };
export const SANDBOX_PROVIDER: CheckProvider = PROVIDERS.sandbox;

export const ENTERED: DatabaseBusinessValues = Object.freeze({
  'business-name': 'Utopia Orchard Cooperative Ltd',
  'country-code': 'US',
  'registration-number': '00000001',
  'address-street-1': '14 Lantern Row',
  'address-city': 'Meridale',
  'address-subdivision': 'UT',
  'address-postal-code': '00000',
});

/** The entered values without `keys`. */
export function enteredWithout(...keys: (keyof DatabaseBusinessValues)[]): DatabaseBusinessValues {
  return Object.fromEntries(
    Object.entries(ENTERED).filter(([key]) => !keys.includes(key as keyof DatabaseBusinessValues)),
  );
}

export const OFFICERS: readonly BusinessPersonRecord[] = Object.freeze([
  { name: 'VALEMONT, Quinn', birthMonth: '1987-04', role: 'officer', active: true },
  { name: 'Ada Vellacott', birthMonth: '1990-11', role: 'psc', active: true },
  { name: 'Ira Holloway', birthMonth: '1975-02', role: 'officer', active: false },
]);

/** The record a register holds for the entered business. */
export function registryRecord(
  changes: Partial<BusinessRegistryRecord> = {},
): BusinessRegistryRecord {
  return {
    source: 'gleif',
    recordId: '00000000000000000001',
    legalName: 'UTOPIA ORCHARD COOPERATIVE LIMITED',
    otherNames: ['Utopia Orchards'],
    status: 'ISSUED',
    statusDetail: 'ACTIVE',
    registeredAddress: {
      lines: ['14 Lantern Row'],
      city: 'Meridale',
      region: 'US-UT',
      postalCode: '00000',
      country: 'US',
    },
    jurisdiction: 'US-UT',
    registrationNumber: '00000001',
    persons: OFFICERS,
    ...changes,
  };
}

export function answer(
  source: BusinessRegistrySourceName,
  result: BusinessRegistryLookup,
): BusinessRegistryAnswer {
  return { source, outcome: { kind: 'result', provider: PROVIDERS[source], result } };
}

export const found = (
  record: BusinessRegistryRecord = registryRecord(),
  options: { readonly authoritative?: boolean; readonly personsAvailable?: boolean } = {},
): BusinessRegistryAnswer =>
  answer(record.source, {
    outcome: 'found',
    record,
    authoritative: options.authoritative ?? false,
    personsAvailable: options.personsAvailable ?? true,
  });

export const notFound = (
  source: BusinessRegistrySourceName,
  authoritative: boolean,
): BusinessRegistryAnswer => answer(source, { outcome: 'not_found', authoritative });

export const unsupported = (source: BusinessRegistrySourceName): BusinessRegistryAnswer =>
  answer(source, { outcome: 'unsupported_country' });

export const failed = (source: BusinessRegistrySourceName): BusinessRegistryAnswer => ({
  source,
  outcome: { kind: 'error' },
});

export function businessInput(
  registry: readonly BusinessRegistryAnswer[] | undefined = [found()],
  overrides: Partial<DatabaseBusinessCheckInput> = {},
): DatabaseBusinessCheckInput {
  return { values: ENTERED, collectAssociatedPersons: false, registry, ...overrides };
}

export function result<Result>(
  value: Result,
  provider = SANDBOX_PROVIDER,
): ProviderOutcome<Result> {
  return { kind: 'result', provider, result: value };
}

export function websiteInput(
  overrides: Partial<BusinessWebsiteCheckInput> = {},
): BusinessWebsiteCheckInput {
  return {
    values: {
      'website-url': 'https://shop.utopiaorchard.example/',
      'business-name': 'Utopia Orchard',
    },
    environment: 'production',
    now: NOW,
    ...overrides,
  };
}

/** A template enabling `checks` (all required), as a verification template holds it. */
export function templateOf(
  checks: readonly CheckId[],
  config: Partial<Record<CheckId, Record<string, unknown>>> = {},
  options: Partial<Omit<VerificationTemplateConfig, 'checks'>> = {},
): VerificationTemplateConfig {
  return {
    checks: Object.fromEntries(
      checks.map((id) => [
        id,
        {
          enabled: true,
          required: true,
          ...(config[id] === undefined ? {} : { config: config[id] }),
        },
      ]),
    ),
    ...options,
  };
}
