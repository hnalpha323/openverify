/**
 * Workflow 7B (T) (C105.2, C105.8, C107.5, P07): the transaction PII joins both masking sets.
 * `fields` is masked member-wise: a field keeps its key and its `type`, and loses its value, as the
 * contract's `transactionFieldValueSchema` expects. A searched value reaches neither a masked API log
 * query nor a masked `links.next`. Every value is synthetic.
 */
import { PII_TRANSACTION_ATTRIBUTES, transactionAttributesSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { apiLogValue, maskPersonalData } from '../services/api-logs.js';
import type { UserPrincipal } from '../ports.js';
import { canViewPii, MASKED_ATTRIBUTES, piiMaskFor, UNMASKED } from './pii.js';

const masked: UserPrincipal = {
  kind: 'user',
  userId: 'usr_1',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  permissions: new Set(),
} as unknown as UserPrincipal;

const FIELDS = {
  iban: { type: 'string', value: 'synthetic-iban' },
  amount: { type: 'number', value: 12.5 },
  statement: {
    type: 'file',
    value: {
      'file-id': 'txnf_01M5CK16P0D13FXHZSS4TCFBVH',
      filename: 'synthetic.pdf',
      'byte-size': 10,
      'mime-type': 'application/pdf',
    },
  },
};

const ATTRIBUTES = {
  status: 'created',
  'reference-id': 'synthetic-reference',
  fields: FIELDS,
  tags: [],
  signals: null,
  'created-at': '2026-10-31T00:00:00.000Z',
  'updated-at': '2026-10-31T00:00:00.000Z',
  'transaction-type-version-id': 'txntpv_01M5CK16P0D13FXHZSS4TCFBVH',
  'redacted-at': null,
  'biometrics-redacted-at': null,
};

const MASKED_FIELDS = {
  iban: { type: 'string', value: null },
  amount: { type: 'number', value: null },
  statement: { type: 'file', value: null },
};

describe('the transaction PII in MASKED_ATTRIBUTES (C105.8, C107.5)', () => {
  it('joins every transaction name', () => {
    expect(canViewPii(masked)).toBe(false);
    for (const name of PII_TRANSACTION_ATTRIBUTES) {
      expect(MASKED_ATTRIBUTES, name).toContain(name);
    }
  });

  it('masks fields member-wise, keeping each key and type, and the result still parses', () => {
    const attributes = piiMaskFor(masked).attributes(ATTRIBUTES);

    expect(attributes.fields).toEqual(MASKED_FIELDS);
    expect(transactionAttributesSchema.parse(attributes)).toMatchObject({
      'reference-id': 'synthetic-reference',
      status: 'created',
    });
  });

  it('does the same through PiiMask.fields', () => {
    expect(piiMaskFor(masked).fields(FIELDS)).toEqual(MASKED_FIELDS);
  });

  it('keeps an inquiry’s or account’s plain value masked whole, as before', () => {
    expect(
      piiMaskFor(masked).fields({ name_first: 'Jane', age: 30, nested: { value: 'x' } }),
    ).toEqual({ name_first: null, age: null, nested: null });
  });

  it('does not mistake a field with more members for a transaction field', () => {
    expect(
      piiMaskFor(masked).fields({ other: { type: 'string', value: 'x', extra: 'y' } }),
    ).toEqual({ other: null });
  });

  it('shows everything to a principal who may see it', () => {
    expect(UNMASKED.attributes(ATTRIBUTES).fields).toEqual(FIELDS);
  });
});

describe('the transaction PII in the API-log masked set (C105.2, C107.5, P07)', () => {
  it('masks a body’s fields and content under data.attributes', () => {
    expect(
      maskPersonalData({
        data: {
          attributes: {
            'transaction-type-id': 'txntp_01M5CK16P0D13FXHZSS4TCFBVH',
            fields: { iban: 'synthetic-iban' },
            content: 'synthetic content',
          },
        },
      }),
    ).toEqual({
      data: {
        attributes: {
          'transaction-type-id': 'txntp_01M5CK16P0D13FXHZSS4TCFBVH',
          fields: { iban: null },
          content: null,
        },
      },
    });
  });

  it('masks a stored query’s searched value and keeps the field’s key (C105.2)', () => {
    expect(
      maskPersonalData({
        'filter[identifier][key]': 'iban',
        'filter[identifier][value]': 'synthetic-iban',
        'page[size]': '10',
      }),
    ).toEqual({
      'filter[identifier][key]': 'iban',
      'filter[identifier][value]': null,
      'page[size]': '10',
    });
  });

  it('masks the searched value in a stored answer’s next link, keeping the rest of it', () => {
    const next =
      '/api/v1/transactions?filter[identifier][key]=iban&' +
      'filter[identifier][value]=synthetic%2Diban&page[after]=txn_01M5CK16P0D13FXHZSS4TCFBVH';

    const stored = maskPersonalData({ data: [], links: { next } });

    expect(stored).toEqual({
      data: [],
      links: {
        next:
          '/api/v1/transactions?filter[identifier][key]=iban&filter[identifier][value]=&' +
          'page[after]=txn_01M5CK16P0D13FXHZSS4TCFBVH',
      },
    });
  });

  it('leaves a next link without a searched value alone, and null where there is none', () => {
    const body = {
      data: [],
      links: { next: '/api/v1/transactions?filter[status]=created&page[size]=10' },
    };
    expect(maskPersonalData(body)).toEqual(body);
    expect(maskPersonalData({ links: { next: null } })).toEqual({ links: { next: null } });
  });

  it('leaves no searched value in the preview of a body too long to store whole (2B F008)', () => {
    const next = `/api/v1/transactions?filter[identifier][value]=synthetic-iban&page[size]=10`;
    // The links come first, so the preview reaches them.
    const stored = apiLogValue({ links: { next }, data: [{ id: 'x'.repeat(70_000) }] });

    expect(JSON.stringify(stored)).not.toContain('synthetic-iban');
  });
});
