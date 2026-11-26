/**
 * C61, C66: business registry verifications whose check results carry the metadata the evaluators
 * write (`packages/checks/src/business`), as the golden API fixture
 * (`contracts/fixtures/api/verification-database-business.json`) does: the identity's `source`,
 * `authoritative`, per-field `fields` and `groups`; the active check's `source`, `status` and
 * `flags`; the persons check's counts. The scenarios follow the sandbox register's endings
 * (C61.6), plus a lapsed LEI from GLEIF. Every business, person and number is synthetic.
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { Phase5Verification } from '../../components/evidence';
import { phase5Verification } from '../phase5-fixtures';

/** The business as the user entered it, and the register's record of it. */
export const BUSINESS_VALUES: Readonly<Record<string, unknown>> = Object.freeze({
  'business-name': 'Quillon Lantern Works Ltd',
  'registration-number': '01234567',
  lei: null,
  'address-street-1': '1 Lantern Row',
  'address-street-2': null,
  'address-city': 'Exampleton',
  'address-subdivision': null,
  'address-postal-code': 'ZZ1 1ZZ',
  'address-country-code': 'GB',
  'associated-persons': null,
  'registry-record-id': '01234567',
  'registry-legal-name': 'Quillon Lantern Works Ltd',
  'registry-source': 'sandbox',
  'registry-status': 'active',
});

/** The values distinctive enough to search a page or a payload for (the persons' included). */
export const BUSINESS_PII_VALUES: readonly string[] = [
  'Quillon Lantern Works Ltd',
  '1 Lantern Row',
  'Exampleton',
  'ZZ1 1ZZ',
  'Placeholder',
];

/** The sandbox officer a step collecting persons is told about (C61.6). */
export const ASSOCIATED_PERSON = Object.freeze({
  'name-first': 'Ada',
  'name-last': 'Placeholder',
  birthdate: '1980-04',
});

export type BusinessScenario =
  | 'match'
  | 'other-business'
  | 'dissolved'
  | 'person-not-listed'
  | 'number-not-found'
  | 'lapsed-lei';

const SANDBOX = { id: 'sandbox', sandbox: true };
const GLEIF = { id: 'gleif', sandbox: false };

const GROUPS = [
  { name: 'partial', 'registration-number': 'full' },
  { name: 'partial', address: 'partial' },
];

const COMPONENTS_SAME = {
  country: 'exact',
  'postal-code': 'exact',
  'house-number': 'exact',
  street: 'exact',
  unit: 'absent',
  city: 'exact',
  subdivision: 'absent',
};

const field = (level: string, methods: string[] = []) => ({ level, methods, flags: [] });

const IDENTITY = 'database_business_identity_comparison';
const ACTIVE = 'database_business_active_business_detection';
const PERSONS = 'database_business_associated_persons_comparison';
const COUNTRY = 'database_business_enabled_country_detection';
const SERVICE = 'database_business_service_available_detection';

function result(
  name: string,
  status: VerificationCheck['status'],
  reasons: string[],
  metadata: Record<string, unknown>,
  options: {
    readonly required?: boolean;
    readonly provider?: { id: string; sandbox: boolean } | null;
    readonly thresholds?: Record<string, unknown>;
  } = {},
): VerificationCheck {
  const thresholds = options.thresholds ?? {};
  return {
    name,
    status,
    reasons,
    requirement: options.required === false ? 'not_required' : 'required',
    metadata,
    stage: 'ga',
    confidence: null,
    provenance: {
      'implementation-version': 1,
      ...(options.provider === null ? {} : { provider: options.provider ?? SANDBOX }),
      thresholds,
      ...(Object.keys(thresholds).length === 0
        ? {}
        : {
            'threshold-basis': Object.fromEntries(
              Object.keys(thresholds).map((key) => [key, 'provisional']),
            ),
          }),
    },
    category: name === COUNTRY || name === SERVICE ? 'user_action_required' : 'fraud',
  } as VerificationCheck;
}

/** The five registry results as the evaluators write them for `scenario`. */
export function businessChecks(scenario: BusinessScenario = 'match'): VerificationCheck[] {
  const provider = scenario === 'lapsed-lei' ? GLEIF : SANDBOX;
  const source = provider.id;
  const identityMetadata = (level: string, outcome: string, authoritative = true) => ({
    source,
    authoritative,
    fields: {
      name: field(level, level === 'none' ? [] : ['fold_characters']),
      'registration-number': field(scenario === 'lapsed-lei' ? 'missing' : level),
      address: { ...field(level), components: COMPONENTS_SAME },
    },
    groups: GROUPS.map((group) => ({ fields: { ...group }, outcome })),
  });
  const identity =
    scenario === 'number-not-found'
      ? result(
          IDENTITY,
          'not_applicable',
          ['registration_number_not_found'],
          {
            authoritative: true,
          },
          { provider, thresholds: { 'match-groups': GROUPS } },
        )
      : scenario === 'other-business'
        ? result(IDENTITY, 'failed', ['low_confidence_match'], identityMetadata('none', 'unmet'), {
            provider,
            thresholds: { 'match-groups': GROUPS },
          })
        : result(
            IDENTITY,
            'passed',
            [],
            identityMetadata('full', 'met', scenario !== 'lapsed-lei'),
            { provider, thresholds: { 'match-groups': GROUPS } },
          );
  const activeThresholds = { provider, thresholds: { 'fail-on-lapsed-lei': false } };
  const active =
    scenario === 'number-not-found'
      ? result(ACTIVE, 'not_applicable', ['no_registry_record'], {}, activeThresholds)
      : scenario === 'dissolved'
        ? result(
            ACTIVE,
            'failed',
            ['business_inactive'],
            { source, status: 'dissolved', flags: [] },
            activeThresholds,
          )
        : scenario === 'lapsed-lei'
          ? result(
              ACTIVE,
              'not_applicable',
              ['status_not_available'],
              { source, status: 'LAPSED', flags: ['lei-lapsed'] },
              activeThresholds,
            )
          : result(ACTIVE, 'passed', [], { source, status: 'active', flags: [] }, activeThresholds);
  const personThresholds = { required: false, thresholds: { 'min-match-level': 'partial' } };
  const persons =
    scenario === 'person-not-listed'
      ? result(
          PERSONS,
          'failed',
          ['associated_person_not_on_register'],
          { source, persons: 1, matched: 0, unmatched: 1, undecided: 0 },
          personThresholds,
        )
      : result(
          PERSONS,
          'not_applicable',
          ['not_requested'],
          {},
          { ...personThresholds, provider: null },
        );
  return [
    identity,
    active,
    persons,
    result(COUNTRY, 'not_applicable', ['no_allowlist'], {}, { provider: null }),
    result(SERVICE, 'passed', [], {}, { provider }),
  ];
}

const STATUS: Readonly<Record<BusinessScenario, string>> = {
  match: 'passed',
  'other-business': 'failed',
  dissolved: 'failed',
  'person-not-listed': 'passed',
  'number-not-found': 'needs_review',
  'lapsed-lei': 'needs_review',
};

/** The attributes each scenario's register gives, over the entered business. */
const RECORDS: Readonly<Record<BusinessScenario, Readonly<Record<string, unknown>>>> = {
  match: {},
  'other-business': {
    'registry-record-id': '00000001',
    'registry-legal-name': 'Marrowstone Placeholder Holdings',
  },
  dissolved: { 'registry-status': 'dissolved' },
  'person-not-listed': { 'associated-persons': [ASSOCIATED_PERSON] },
  'number-not-found': {
    'registry-record-id': null,
    'registry-legal-name': null,
    'registry-source': null,
    'registry-status': null,
  },
  'lapsed-lei': {
    lei: 'ZZZZ00SYNTHETIC00LEI',
    'registration-number': null,
    'registry-record-id': 'ZZZZ00SYNTHETIC00LEI',
    'registry-source': 'gleif',
    'registry-status': 'LAPSED',
  },
};

export interface BusinessVerificationOptions {
  readonly scenario?: BusinessScenario;
  readonly masked?: boolean;
  readonly checks?: VerificationCheck[];
  readonly status?: string;
  readonly values?: Readonly<Record<string, unknown>>;
}

/** A business registry verification of `scenario`, as the API answers for it. */
export function businessVerification(
  options: BusinessVerificationOptions = {},
): Phase5Verification {
  const scenario = options.scenario ?? 'match';
  return phase5Verification('verification/database-business', {
    masked: options.masked === true,
    attributes: {
      status: options.status ?? STATUS[scenario],
      checks: options.checks ?? businessChecks(scenario),
      ...BUSINESS_VALUES,
      ...RECORDS[scenario],
      ...options.values,
    },
  });
}

/** A redacted business registry verification (C16): the personal values `null`, metadata emptied. */
export function redactedBusinessVerification(): Phase5Verification {
  return businessVerification({
    scenario: 'person-not-listed',
    masked: true,
    checks: businessChecks('person-not-listed').map((check) => ({
      ...check,
      reasons: [],
      metadata: {},
    })),
  });
}
