/**
 * C58, C59, C66: what the database evidence reads from a verification answer, and only from it.
 * The fixtures and the golden API fixture carry the metadata the evaluators write (Workflow 5C
 * review P008); an older shape, which no evaluator writes, is still read.
 */
import { DATABASE_VERIFICATION_ATTRIBUTES, type VerificationCheck } from '@openverify/contracts';
import { DATABASE_MATCH_FIELDS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  databaseChecks,
  databaseVerification,
  olderShapeDatabaseVerification,
} from '../testing/fixtures/database';
import { phase5Verification } from '../testing/phase5-fixtures';
import {
  DATABASE_VALUE_MEMBERS,
  checkOutcomeOf,
  databaseEvidenceOf,
  recordedGroupsOf,
  recordedMatchOf,
  resultOf,
  sourceOf,
  textListOf,
  type DatabaseVerification,
} from './database-evidence';

const evidenceOf = (verification: ReturnType<typeof databaseVerification>) =>
  databaseEvidenceOf(verification as DatabaseVerification);

const check = (overrides: Partial<VerificationCheck>): VerificationCheck => ({
  name: 'database_identity_comparison',
  status: 'passed',
  reasons: [],
  requirement: 'required',
  metadata: {},
  ...overrides,
});

describe('the attributes of each database match field (C52.3, C52.8)', () => {
  it('names every entered value once, under the match field it is compared as', () => {
    expect(Object.keys(DATABASE_VALUE_MEMBERS)).toEqual([...DATABASE_MATCH_FIELDS]);
    expect(Object.values(DATABASE_VALUE_MEMBERS).flat().sort()).toEqual(
      Object.keys(DATABASE_VERIFICATION_ATTRIBUTES).sort(),
    );
    expect(DATABASE_VALUE_MEMBERS.name).toEqual(['name-first', 'name-middle', 'name-last']);
    expect(DATABASE_VALUE_MEMBERS.address[0]).toBe('address-street-1');
  });
});

describe('databaseEvidenceOf (C58, C59)', () => {
  it('reads the source, its authority and the identity result', () => {
    const evidence = evidenceOf(databaseVerification());

    expect(evidence.ran).toBe(true);
    expect(evidence.source).toEqual({ id: 'sandbox', sandbox: true });
    expect(evidence.authoritative).toBe(false);
    expect(evidence.identity).toEqual({
      name: 'database_identity_comparison',
      status: 'passed',
      required: true,
      reasons: [],
    });
  });

  it('reads each match field with its entered attributes and how it compared', () => {
    const { fields } = evidenceOf(databaseVerification());

    expect(fields.map((field) => field.field)).toEqual([...DATABASE_MATCH_FIELDS]);
    const [name, birthdate, address, number] = fields;
    expect(name).toEqual({
      field: 'name',
      members: ['name-first', 'name-middle', 'name-last'],
      match: {
        level: 'partial',
        methods: ['fold_characters', 'nickname'],
        flags: [],
        components: [],
      },
    });
    expect(birthdate?.match?.level).toBe('full');
    expect(address?.match?.components).toEqual([
      ['country', 'exact'],
      ['postal-code', 'exact'],
      ['house-number', 'exact'],
      ['street', 'exact'],
      ['unit', 'absent'],
      ['city', 'exact'],
      ['subdivision', 'absent'],
    ]);
    expect(number?.match?.level).toBe('missing');
  });

  it('reads each match group with the level each field needs and its outcome', () => {
    expect(evidenceOf(databaseVerification({ scenario: 'name-mismatch' })).groups).toEqual([
      {
        fields: [
          ['name', 'partial'],
          ['birthdate', 'partial'],
          ['address', 'partial'],
        ],
        outcome: 'unmet',
      },
    ]);
    expect(evidenceOf(databaseVerification({ scenario: 'no-birthdate' })).groups[0]?.outcome).toBe(
      'undecidable',
    );
  });

  it('reads the group fields the step did not collect', () => {
    const [identity, ...rest] = databaseChecks();
    if (identity === undefined) throw new Error('no identity result');
    const verification = databaseVerification({
      checks: [
        {
          ...identity,
          metadata: { ...identity.metadata, 'not-requested-fields': ['birthdate', 7] },
        },
        ...rest,
      ],
    });

    expect(evidenceOf(verification).notRequested).toEqual(['birthdate']);
  });

  it('reads the golden fixture through the identity check’s own comparisons and groups (Workflow 5C review P008)', () => {
    const evidence = evidenceOf(phase5Verification('verification/database'));

    const [name, birthdate, address, number] = evidence.fields;
    expect(name?.match?.level).toBe('full');
    expect(birthdate?.match?.level).toBe('full');
    expect(address?.match?.level).toBe('full');
    expect(number?.match?.level).toBe('missing');
    expect(evidence.groups).toEqual([
      {
        fields: [
          ['name', 'partial'],
          ['birthdate', 'partial'],
          ['address', 'partial'],
        ],
        outcome: 'met',
      },
    ]);
  });

  it('falls back to the per-field results, and to the template’s groups, when the identity records neither (an older shape)', () => {
    const evidence = evidenceOf(olderShapeDatabaseVerification());

    const [name, birthdate, address, number] = evidence.fields;
    expect(name?.match).toEqual({
      level: 'full',
      methods: ['fold_characters'],
      flags: [],
      components: [],
    });
    expect(birthdate?.match?.level).toBe('full');
    expect(address?.match?.level).toBe('partial');
    expect(number?.match).toBeNull();
    expect(evidence.groups).toEqual([
      {
        fields: [
          ['name', 'partial'],
          ['birthdate', 'partial'],
          ['address', 'partial'],
        ],
        outcome: null,
      },
    ]);
  });

  it('reads no comparison from a record that was not found', () => {
    const evidence = evidenceOf(databaseVerification({ scenario: 'not-found' }));

    expect(evidence.identity?.reasons).toEqual(['no_matching_record']);
    expect(evidence.fields.every((field) => field.match === null)).toBe(true);
    expect(evidence.groups[0]?.outcome).toBeNull();
  });

  it('reads the inquiry comparison and the PO box patterns', () => {
    const checks = databaseChecks().map((result) =>
      result.name === 'database_inquiry_comparison'
        ? {
            ...result,
            status: 'failed' as const,
            reasons: ['inquiry_field_mismatch'],
            metadata: {
              'compared-fields': ['name', 'birthdate'],
              'mismatched-fields': ['birthdate'],
              'not-requested-fields': ['phone-number'],
              fields: {
                name: { level: 'full', methods: [], flags: [] },
                birthdate: { level: 'none', methods: [], flags: ['near-match'] },
              },
            },
          }
        : result.name === 'database_po_box_detection'
          ? {
              ...result,
              status: 'failed' as const,
              reasons: ['po_box_detected'],
              metadata: { 'matched-patterns': ['po_box', 'military'] },
            }
          : result,
    );
    const evidence = evidenceOf(databaseVerification({ checks }));

    expect(evidence.inquiry).toEqual({
      outcome: {
        name: 'database_inquiry_comparison',
        status: 'failed',
        required: false,
        reasons: ['inquiry_field_mismatch'],
      },
      fields: [
        ['name', { level: 'full', methods: [], flags: [], components: [] }],
        ['birthdate', { level: 'none', methods: [], flags: ['near-match'], components: [] }],
      ],
      // C149.4 (K9-16): this result records no comparison-source, so neither field has one.
      sources: { name: null, birthdate: null },
      mismatched: ['birthdate'],
      notRequested: ['phone-number'],
    });
    expect(evidence.poBox?.patterns).toEqual(['po_box', 'military']);
  });

  it('reads nothing before a check ran, and no source from results that name none', () => {
    const evidence = evidenceOf(databaseVerification({ checks: [] }));

    expect(evidence).toMatchObject({
      ran: false,
      identity: null,
      source: null,
      authoritative: null,
      groups: [],
      notRequested: [],
      inquiry: null,
      poBox: null,
    });
    expect(evidence.fields.every((field) => field.match === null)).toBe(true);
  });
});

describe('the result readers (C29.2, C58)', () => {
  it('finds a result by its check name', () => {
    const checks = databaseChecks();
    expect(resultOf(checks, 'database_po_box_detection')?.name).toBe('database_po_box_detection');
    expect(resultOf(checks, 'no_such_check')).toBeUndefined();
  });

  it('says a result as its status, its requirement and its reasons', () => {
    expect(
      checkOutcomeOf(check({ requirement: 'not_required', status: 'failed', reasons: ['x'] })),
    ).toEqual({
      name: 'database_identity_comparison',
      status: 'failed',
      required: false,
      reasons: ['x'],
    });
    expect(checkOutcomeOf(undefined)).toBeNull();
  });

  it('names the provider of the first result that has one', () => {
    const plain = check({ provenance: { 'implementation-version': 1, thresholds: {} } });
    const sandbox = check({
      provenance: {
        'implementation-version': 1,
        thresholds: {},
        provider: { id: 'sandbox', sandbox: true },
      },
    });
    expect(sourceOf([undefined, plain, sandbox])).toEqual({ id: 'sandbox', sandbox: true });
    expect(sourceOf([plain, undefined])).toBeNull();
  });

  it('reads a field comparison, and nothing from a malformed one', () => {
    expect(
      recordedMatchOf({
        level: 'partial',
        methods: ['nickname', 4],
        flags: ['swapped'],
        components: { street: 'fuzzy', unit: 9 },
      }),
    ).toEqual({
      level: 'partial',
      methods: ['nickname'],
      flags: ['swapped'],
      components: [['street', 'fuzzy']],
    });
    expect(recordedMatchOf({ level: 'close' })).toBeNull();
    expect(recordedMatchOf('full')).toBeNull();
    expect(recordedMatchOf(null)).toBeNull();
    expect(recordedMatchOf([{ level: 'full' }])).toBeNull();
    expect(recordedMatchOf({ level: 'none' })).toEqual({
      level: 'none',
      methods: [],
      flags: [],
      components: [],
    });
  });

  it('reads the recorded groups, skipping malformed ones, else the template’s', () => {
    expect(
      recordedGroupsOf(
        check({
          metadata: {
            groups: [
              { fields: { name: 'partial', address: 'exact' }, outcome: 'met' },
              { fields: { name: 'full' }, outcome: 'maybe' },
              'a group',
            ],
          },
        }),
      ),
    ).toEqual([{ fields: [['name', 'partial']], outcome: 'met' }]);
    expect(
      recordedGroupsOf(
        check({
          provenance: {
            'implementation-version': 1,
            thresholds: { 'match-groups': [{ name: 'partial', 'registration-number': 'full' }] },
          },
        }),
      ),
    ).toEqual([
      {
        fields: [
          ['name', 'partial'],
          ['registration-number', 'full'],
        ],
        outcome: null,
      },
    ]);
    expect(recordedGroupsOf(check({}))).toEqual([]);
    expect(recordedGroupsOf(undefined)).toEqual([]);
  });

  it('reads the strings of a metadata list', () => {
    expect(textListOf({ list: ['a', 2, 'b'] }, 'list')).toEqual(['a', 'b']);
    expect(textListOf({ list: 'a' }, 'list')).toEqual([]);
    expect(textListOf({}, 'list')).toEqual([]);
  });
});
