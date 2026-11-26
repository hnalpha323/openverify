/**
 * C58, C59, C66: database verifications whose check results carry the metadata the evaluators
 * write (`packages/checks/src/database`): `database_identity_comparison` records `authoritative`,
 * each match field's `level`, `methods` and `flags` (an address also its `components`), each
 * group's `fields` and `outcome`, and `not-requested-fields`. The golden API fixture
 * (`contracts/fixtures/api/verification-database.json`) predates the evaluators and records
 * another shape, which the evidence must still read. Every value is synthetic: an invented person
 * at an invented address, as the sandbox database provider echoes it (C59.2).
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { Phase5Verification } from '../../components/evidence';
import { phase5Verification } from '../phase5-fixtures';

/** What the user entered: a nickname, as the sandbox's `sandbox-database-nickname` case has it. */
export const DATABASE_VALUES: Readonly<Record<string, string | null>> = Object.freeze({
  'name-first': 'Bob',
  'name-middle': null,
  'name-last': 'Quillon',
  birthdate: '1984-07-09',
  'address-street-1': '12 Example Street',
  'address-street-2': null,
  'address-city': 'Exampleton',
  'address-subdivision': null,
  'address-postal-code': '00000',
  'address-country-code': 'US',
  'identification-number': null,
  'phone-number': null,
  'email-address': null,
});

/** The entered values distinctive enough to search a page or a payload for. */
export const DATABASE_PII_VALUES: readonly string[] = [
  'Bob',
  'Quillon',
  '1984-07-09',
  '12 Example Street',
  'Exampleton',
];

const SANDBOX = Object.freeze({ id: 'sandbox', sandbox: true });

const GROUPS = [{ name: 'partial', birthdate: 'partial', address: 'partial' }] as const;

const IDENTITY_THRESHOLDS = {
  'match-groups': GROUPS.map((group) => ({ ...group })),
  'accept-precision-limited-birthdate': true,
  'accept-transposed-birthdate': false,
};

const IDENTITY_BASES = {
  'match-groups': 'provisional',
  'accept-precision-limited-birthdate': 'provisional',
  'accept-transposed-birthdate': 'provisional',
} as const;

const match = (level: string, methods: string[] = [], flags: string[] = []) => ({
  level,
  methods,
  flags,
});

const COMPONENTS_SAME = {
  country: 'exact',
  'postal-code': 'exact',
  'house-number': 'exact',
  street: 'exact',
  unit: 'absent',
  city: 'exact',
  subdivision: 'absent',
};

/** The sandbox scenarios of C59.2 the tests use, by the token that picks them. */
export type DatabaseScenario = 'nickname' | 'name-mismatch' | 'no-birthdate' | 'not-found';

interface Scenario {
  readonly status: VerificationCheck['status'];
  readonly reasons: string[];
  readonly name: ReturnType<typeof match>;
  readonly birthdate: ReturnType<typeof match>;
  readonly outcome: string;
}

const SCENARIOS: Readonly<Record<Exclude<DatabaseScenario, 'not-found'>, Scenario>> = {
  nickname: {
    status: 'passed',
    reasons: [],
    name: match('partial', ['fold_characters', 'nickname']),
    birthdate: match('full', ['date_similarity']),
    outcome: 'met',
  },
  'name-mismatch': {
    status: 'failed',
    reasons: ['low_confidence_match'],
    name: match('none'),
    birthdate: match('full', ['date_similarity']),
    outcome: 'unmet',
  },
  'no-birthdate': {
    status: 'not_applicable',
    reasons: ['insufficient_data'],
    name: match('partial', ['fold_characters', 'nickname']),
    birthdate: match('missing'),
    outcome: 'undecidable',
  },
};

const result = (
  name: string,
  status: VerificationCheck['status'],
  reasons: string[],
  metadata: Record<string, unknown>,
  options: {
    readonly required?: boolean;
    readonly provider?: boolean;
    readonly thresholds?: Record<string, unknown>;
  } = {},
): VerificationCheck =>
  ({
    name,
    status,
    reasons,
    requirement: options.required === true ? 'required' : 'not_required',
    metadata,
    stage: 'ga',
    confidence: null,
    provenance: {
      'implementation-version': 1,
      ...(options.provider === false ? {} : { provider: SANDBOX }),
      thresholds: options.thresholds ?? { 'min-match-level': 'partial' },
      'threshold-basis':
        options.thresholds === undefined ? { 'min-match-level': 'provisional' } : IDENTITY_BASES,
    },
    category: name === 'database_po_box_detection' ? 'user_action_required' : 'fraud',
  }) as VerificationCheck;

/** The six database results as the evaluators write them for `scenario`. */
export function databaseChecks(scenario: DatabaseScenario = 'nickname'): VerificationCheck[] {
  const shared = [
    result(
      'database_inquiry_comparison',
      'not_applicable',
      ['no_reference_data'],
      {},
      {
        provider: false,
      },
    ),
    result(
      'database_po_box_detection',
      'passed',
      [],
      { 'matched-patterns': [] },
      { provider: false, thresholds: {} },
    ),
  ];
  if (scenario === 'not-found') {
    return [
      result(
        'database_identity_comparison',
        'not_applicable',
        ['no_matching_record'],
        { authoritative: false },
        { required: true, thresholds: IDENTITY_THRESHOLDS },
      ),
      ...['name', 'address', 'birthdate'].map((field) =>
        result(`database_${field}_comparison`, 'not_applicable', ['no_matching_record'], {}),
      ),
      ...shared,
    ];
  }
  const { status, reasons, name, birthdate, outcome } = SCENARIOS[scenario];
  const address = { ...match('full', ['fold_characters']), components: COMPONENTS_SAME };
  return [
    result(
      'database_identity_comparison',
      status,
      reasons,
      {
        authoritative: false,
        fields: {
          name,
          birthdate,
          address,
          'identification-number': match('missing'),
          'phone-number': match('missing'),
          'email-address': match('missing'),
        },
        groups: GROUPS.map((group) => ({ fields: { ...group }, outcome })),
        'not-requested-fields': [],
      },
      { required: true, thresholds: IDENTITY_THRESHOLDS },
    ),
    result(
      'database_name_comparison',
      name.level === 'none' ? 'failed' : 'passed',
      name.level === 'none' ? ['name_mismatch'] : [],
      name,
    ),
    result('database_address_comparison', 'passed', [], address),
    birthdate.level === 'missing'
      ? result('database_birthdate_comparison', 'not_applicable', ['no_reference_data'], birthdate)
      : result('database_birthdate_comparison', 'passed', [], birthdate),
    ...shared,
  ];
}

const STATUS: Readonly<Record<DatabaseScenario, string>> = {
  nickname: 'passed',
  'name-mismatch': 'failed',
  'no-birthdate': 'needs_review',
  'not-found': 'needs_review',
};

export interface DatabaseVerificationOptions {
  readonly scenario?: DatabaseScenario;
  /** As the API serves it to an operator without `pii:view`, or after a redaction. */
  readonly masked?: boolean;
  /** Replaces the scenario's results. */
  readonly checks?: VerificationCheck[];
  readonly status?: string;
  /** Replaces entered values, member by member. */
  readonly values?: Readonly<Record<string, string | null>>;
  readonly id?: string;
}

/** A database verification of `scenario`, as the API answers for it. */
export function databaseVerification(
  options: DatabaseVerificationOptions = {},
): Phase5Verification {
  const scenario = options.scenario ?? 'nickname';
  return phase5Verification('verification/database', {
    ...(options.id === undefined ? {} : { id: options.id }),
    masked: options.masked === true,
    attributes: {
      status: options.status ?? STATUS[scenario],
      checks: options.checks ?? databaseChecks(scenario),
      ...DATABASE_VALUES,
      ...options.values,
    },
  });
}

/** A redacted database verification: every value `null`, every result's metadata emptied (C16). */
export function redactedDatabaseVerification(): Phase5Verification {
  return databaseVerification({
    masked: true,
    checks: databaseChecks().map((check) => ({ ...check, reasons: [], metadata: {} })),
  });
}

/**
 * Metadata in the shape the golden API fixture had before Workflow 5C (review P008): the identity
 * check's `matched-group` and its groups as maps of levels, without `fields`; the per-field
 * results with their methods. No evaluator writes it; the database evidence still reads it.
 */
const OLDER_SHAPE_METADATA: Readonly<Record<string, Record<string, unknown>>> = Object.freeze({
  database_identity_comparison: {
    'matched-group': 0,
    groups: [{ name: 'full', birthdate: 'full', address: 'partial' }],
    authoritative: false,
  },
  database_name_comparison: { level: 'full', methods: ['fold_characters'] },
  database_address_comparison: { level: 'partial', methods: ['string_similarity'] },
  database_birthdate_comparison: { level: 'full', methods: ['date_similarity'] },
});

/** The golden database verification with its checks' metadata in that older shape. */
export function olderShapeDatabaseVerification(): Phase5Verification {
  const golden = phase5Verification('verification/database');
  return phase5Verification('verification/database', {
    attributes: {
      ...golden.attributes,
      checks: golden.attributes.checks.map((check) => ({
        ...check,
        metadata: OLDER_SHAPE_METADATA[check.name] ?? check.metadata,
      })),
    },
  });
}
