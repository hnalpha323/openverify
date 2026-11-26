import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_FIELD_TYPES,
  DEFAULT_ACCOUNT_TYPE_NAME,
  MAX_ACCOUNT_TYPE_FIELDS,
  accountFieldIssues,
  accountTypeDocumentSchema,
  accountTypeFieldsChangeIssues,
  accountTypeFieldsSchema,
  accountTypeListDocumentSchema,
  accountTypeResourceSchema,
  buildAccountTypeResource,
  createAccountTypeBodySchema,
  listAccountTypesQuerySchema,
  updateAccountTypeBodySchema,
} from './account-types.js';
import { AT, AT_ISO, IDS } from './test-support.js';

const fieldsSchema = {
  name_first: { type: 'string', label: 'First name' },
  birthdate: { type: 'date', label: 'Date of birth' },
  risk_score: { type: 'number', label: 'Risk score' },
  vip: { type: 'boolean', label: 'VIP' },
} as const;

const accountType = {
  type: 'account-type',
  id: IDS.accountType,
  attributes: {
    name: 'user',
    'fields-schema': fieldsSchema,
    'created-at': AT_ISO,
    'contest-route': null,
  },
};

describe('account-type resource (C13)', () => {
  it('has a name and a typed fields schema', () => {
    expect(ACCOUNT_FIELD_TYPES).toEqual(['string', 'number', 'boolean', 'date']);
    expect(DEFAULT_ACCOUNT_TYPE_NAME).toBe('user');
    expect(accountTypeResourceSchema.parse(accountType)).toEqual(accountType);
    expect(accountTypeDocumentSchema.safeParse({ data: accountType }).success).toBe(true);
    expect(
      accountTypeListDocumentSchema.safeParse({ data: [accountType], links: { next: null } })
        .success,
    ).toBe(true);
  });

  it('is built from a record', () => {
    expect(
      buildAccountTypeResource({
        id: IDS.accountType,
        name: 'user',
        fieldsSchema,
        createdAt: AT,
      }),
    ).toEqual(accountType);
  });

  it.each([
    ['a kebab-case key', { 'name-first': { type: 'string', label: 'First name' } }],
    ['an unknown field type', { photo: { type: 'image', label: 'Photo' } }],
    ['an empty label', { name_first: { type: 'string', label: '' } }],
    ['extra members', { name_first: { type: 'string', label: 'x', required: true } }],
  ])('rejects a fields schema with %s', (_name, value) => {
    expect(accountTypeFieldsSchema.safeParse(value).success).toBe(false);
  });

  it('allows at most 100 fields', () => {
    expect(MAX_ACCOUNT_TYPE_FIELDS).toBe(100);
    const many = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `field_${String(index)}`,
        { type: 'string', label: 'x' },
      ]),
    );
    expect(accountTypeFieldsSchema.safeParse(many).success).toBe(false);
  });
});

describe('account-type requests (C13)', () => {
  it('create a type with an optional fields schema', () => {
    const body = { data: { attributes: { name: 'business', 'fields-schema': fieldsSchema } } };
    expect(createAccountTypeBodySchema.parse(body)).toEqual(body);
    expect(
      createAccountTypeBodySchema.safeParse({ data: { attributes: { name: '' } } }).success,
    ).toBe(false);
    expect(listAccountTypesQuerySchema.parse({ 'page[size]': '10' })).toEqual({ 'page[size]': 10 });
  });
});

describe('accountFieldIssues (C13)', () => {
  it('accepts fields that match the type, including null to clear a value', () => {
    expect(
      accountFieldIssues(
        { name_first: 'Jane', birthdate: '1990-01-31', risk_score: 0.4, vip: true },
        fieldsSchema,
      ),
    ).toEqual([]);
    expect(accountFieldIssues({ name_first: null, vip: null }, fieldsSchema)).toEqual([]);
  });

  it('reports unknown keys and wrong value types', () => {
    expect(
      accountFieldIssues(
        {
          nickname: 'JJ',
          name_first: 7,
          birthdate: '31/01/1990',
          risk_score: 'high',
          vip: 'yes',
        },
        fieldsSchema,
      ),
    ).toEqual([
      { field: 'nickname', message: 'is not a field of this account type' },
      { field: 'name_first', message: 'must be a string' },
      { field: 'birthdate', message: 'must be an ISO 8601 date (YYYY-MM-DD)' },
      { field: 'risk_score', message: 'must be a number' },
      { field: 'vip', message: 'must be a boolean' },
    ]);
  });

  it('ignores prototype keys of the schema', () => {
    expect(accountFieldIssues({ constructor: 'x' }, fieldsSchema)).toEqual([
      { field: 'constructor', message: 'is not a field of this account type' },
    ]);
  });
});

describe('PATCH /account-types/:id (C25.3, Workflow 2E)', () => {
  const body = (attributes: Record<string, unknown>) => ({
    data: { type: 'account-type', attributes },
  });

  it('changes the name, the fields schema or both', () => {
    for (const attributes of [
      { name: 'business' },
      { 'fields-schema': fieldsSchema },
      { name: 'business', 'fields-schema': {} },
    ]) {
      expect(updateAccountTypeBodySchema.parse(body(attributes))).toEqual(body(attributes));
    }
  });

  it.each([
    ['nothing to change', {}],
    ['an unknown attribute', { 'created-at': AT_ISO }],
    ['an empty name', { name: '' }],
    ['a bad field key', { 'fields-schema': { 'Bad Key': { type: 'string', label: 'x' } } }],
    [
      'more than 100 fields',
      {
        'fields-schema': Object.fromEntries(
          Array.from({ length: MAX_ACCOUNT_TYPE_FIELDS + 1 }, (_, index) => [
            `field_${String(index)}`,
            { type: 'string', label: 'Field' },
          ]),
        ),
      },
    ],
  ])('rejects %s', (_name, attributes) => {
    expect(updateAccountTypeBodySchema.safeParse(body(attributes)).success).toBe(false);
  });
});

describe('accountTypeFieldsChangeIssues (C25.3, Workflow 2E)', () => {
  it('allows adding keys and changing labels', () => {
    expect(
      accountTypeFieldsChangeIssues(fieldsSchema, {
        ...fieldsSchema,
        name_first: { type: 'string', label: 'Given name' },
        tier: { type: 'string', label: 'Tier' },
      }),
    ).toEqual([]);
    expect(accountTypeFieldsChangeIssues({}, fieldsSchema)).toEqual([]);
  });

  it('reports each removed key and each key whose type changed', () => {
    const withoutVip = Object.fromEntries(
      Object.entries(fieldsSchema).filter(([key]) => key !== 'vip'),
    );
    expect(
      accountTypeFieldsChangeIssues(fieldsSchema, {
        ...withoutVip,
        birthdate: { type: 'string', label: 'Date of birth' },
      }),
    ).toEqual([
      { field: 'birthdate', message: 'cannot change type from date to string' },
      { field: 'vip', message: 'cannot be removed: accounts may hold values for it' },
    ]);
  });

  it('treats prototype names as ordinary keys', () => {
    const withConstructor = {
      ...fieldsSchema,
      constructor: { type: 'string', label: 'Constructor' },
    } as const;
    expect(accountTypeFieldsChangeIssues(withConstructor, fieldsSchema)).toEqual([
      { field: 'constructor', message: 'cannot be removed: accounts may hold values for it' },
    ]);
    expect(accountTypeFieldsChangeIssues(fieldsSchema, withConstructor)).toEqual([]);
  });
});
