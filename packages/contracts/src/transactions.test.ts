import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eventAttributesSchema } from './events.js';
import { readFixture } from './test-support.js';
import {
  PII_TRANSACTION_ATTRIBUTES,
  buildTransactionLabelResource,
  buildTransactionResource,
  buildTransactionTypeResource,
  buildTransactionTypeVersionResource,
  createTransactionBodySchema,
  createTransactionTypeBodySchema,
  createTransactionTypeVersionBodySchema,
  labelTransactionBodySchema,
  listTransactionRelationsQuerySchema,
  listTransactionsQuerySchema,
  redactTransactionBodySchema,
  transactionFileValueSchema,
  transactionObjectsBodySchema,
  transactionRelationBodySchema,
  transactionRelationCursorSchema,
  transactionRelationListDocumentSchema,
  transactionRelationMetaSchema,
  transactionStatusSchema,
  updateTransactionBodySchema,
  updateTransactionTypeVersionBodySchema,
  transactionTypeConvertedFieldMetaSchema,
  transactionTypeDeletedFieldMetaSchema,
} from './transactions.js';
import { reportDocumentSchema } from './reports.js';
import { inquiryRelationshipsSchema } from './inquiries.js';

const AT = new Date('2026-10-31T12:00:00.000Z');
const TYPE = 'txntp_01M5CK3190XEVBM5ZXA76E1JSN';
const VERSION = 'txntpv_01M5CK3190XEVBM5ZXA76E1JSN';
const TRANSACTION = 'txn_01M5CK3190XEVBM5ZXA76E1JSN';
const LABEL = 'txnl_01M5CK3190XEVBM5ZXA76E1JSN';
const ACCOUNT = 'acc_01M5CK3190XEVBM5ZXA76E1JSN';
const INQUIRY = 'inq_01M5CK3190XEVBM5ZXA76E1JSN';

const refused = (schema: z.ZodType, value: unknown) => !schema.safeParse(value).success;

const type = {
  id: TYPE,
  name: 'Synthetic payment',
  status: 'active',
  fieldSchemas: [{ type: 'string', key: 'order_id', label: 'Order' }],
  statuses: ['created', 'approved'],
  relationSchemas: [],
  latestVersion: 2,
  publishedVersion: 1,
  createdAt: AT,
  updatedAt: AT,
} as const;

const transaction = {
  id: TRANSACTION,
  status: 'created',
  referenceId: 'ref-test-001',
  fields: { order_id: { type: 'string', value: 'synthetic-0001' } },
  tags: [],
  transactionTypeId: TYPE,
  transactionTypeVersionId: VERSION,
  latestLabelId: null,
  relatedObjects: [{ type: 'account', id: ACCOUNT }],
  createdAt: AT,
  updatedAt: AT,
  redactedAt: null,
  biometricsRedactedAt: null,
} as const;

describe('transaction types and versions (C104.1)', () => {
  it('builds a type with its public attributes and ours', () => {
    expect(buildTransactionTypeResource(type)).toMatchObject({
      type: 'transaction-type',
      id: TYPE,
      attributes: {
        name: 'Synthetic payment',
        'field-schemas': [{ type: 'string', key: 'order_id', label: 'Order' }],
        statuses: ['created', 'approved'],
        'latest-version': 2,
        'published-version': 1,
      },
    });
  });

  it('builds a version, published exactly when it is no longer a draft', () => {
    const version = {
      id: VERSION,
      transactionTypeId: TYPE,
      versionNumber: 1,
      status: 'published',
      fieldSchemas: [],
      statuses: ['created'],
      relationSchemas: [],
      allowCardLikeStrings: false,
      createdAt: AT,
      publishedAt: AT,
    } as const;
    expect(buildTransactionTypeVersionResource(version).relationships).toEqual({
      'transaction-type': { data: { type: 'transaction-type', id: TYPE } },
    });
    expect(() => buildTransactionTypeVersionResource({ ...version, publishedAt: null })).toThrow();
    expect(() => buildTransactionTypeVersionResource({ ...version, status: 'draft' })).toThrow();
  });

  it('refuses a field of an unknown type in a body', () => {
    const body = (fields: unknown) => ({
      data: { attributes: { name: 'x', 'field-schemas': fields } },
    });
    expect(createTransactionTypeBodySchema.safeParse(body([])).success).toBe(true);
    expect(
      refused(createTransactionTypeBodySchema, body([{ type: 'float', key: 'a', label: 'A' }])),
    ).toBe(true);
  });

  it('takes a draft from the latest version, and refuses an empty update', () => {
    expect(
      createTransactionTypeVersionBodySchema.safeParse({
        data: { attributes: { 'transaction-type-id': TYPE } },
      }).success,
    ).toBe(true);
    expect(refused(updateTransactionTypeVersionBodySchema, { data: { attributes: {} } })).toBe(
      true,
    );
  });

  it('caps the statuses and keeps their vocabulary (C104.5)', () => {
    expect(transactionStatusSchema.safeParse('needs review').success).toBe(true);
    expect(refused(transactionStatusSchema, 'Needs Review')).toBe(true);
    expect(refused(transactionStatusSchema, 'x'.repeat(65))).toBe(true);
    const body = (statuses: string[]) => ({
      data: { attributes: { name: 'x', statuses } },
    });
    expect(refused(createTransactionTypeBodySchema, body(['a', 'a']))).toBe(true);
    expect(refused(createTransactionTypeBodySchema, body([]))).toBe(true);
  });
});

describe('transactions (C105)', () => {
  it('builds the public attributes and relationships, and ours', () => {
    expect(buildTransactionResource(transaction)).toMatchObject({
      type: 'transaction',
      id: TRANSACTION,
      attributes: {
        status: 'created',
        'reference-id': 'ref-test-001',
        fields: { order_id: { type: 'string', value: 'synthetic-0001' } },
        signals: null,
        'transaction-type-version-id': VERSION,
        'redacted-at': null,
        'biometrics-redacted-at': null,
      },
      relationships: {
        'transaction-type': { data: { type: 'transaction-type', id: TYPE } },
        'transaction-label': { data: null },
        reviewer: { data: null },
        'related-objects': { data: [{ type: 'account', id: ACCOUNT }] },
        'sentinel-sessions': { data: [] },
      },
    });
  });

  it('names its latest label', () => {
    expect(
      buildTransactionResource({ ...transaction, latestLabelId: LABEL }).relationships[
        'transaction-label'
      ].data,
    ).toEqual({ type: 'transaction-label', id: LABEL });
  });

  it('serves null fields once redacted', () => {
    expect(
      buildTransactionResource({ ...transaction, fields: null, redactedAt: AT }).attributes.fields,
    ).toBeNull();
  });

  it('carries a file by id, never a URL (P12)', () => {
    const value = {
      'file-id': 'txnf_01M5CK3190XEVBM5ZXA76E1JSN',
      filename: 'synthetic.pdf',
      'byte-size': 10,
      'mime-type': 'application/pdf',
    };
    expect(transactionFileValueSchema.safeParse(value).success).toBe(true);
    expect(refused(transactionFileValueSchema, { ...value, url: 'https://example.test/f' })).toBe(
      true,
    );
  });

  it('takes the create and update bodies of C105.2', () => {
    const create = {
      data: {
        attributes: { 'transaction-type-id': TYPE, fields: { order_id: 'x' }, tags: ['synthetic'] },
      },
    };
    expect(createTransactionBodySchema.safeParse(create).success).toBe(true);
    expect(refused(createTransactionBodySchema, { data: { attributes: { fields: {} } } })).toBe(
      true,
    );
    expect(
      updateTransactionBodySchema.safeParse({ data: { attributes: { status: 'approved' } } })
        .success,
    ).toBe(true);
    expect(refused(updateTransactionBodySchema, { data: { attributes: {} } })).toBe(true);
  });

  it('asks a key and a value of filter[identifier], or neither', () => {
    expect(
      listTransactionsQuerySchema.safeParse({
        'filter[identifier][key]': 'order_id',
        'filter[identifier][value]': 'synthetic-0001',
      }).success,
    ).toBe(true);
    expect(refused(listTransactionsQuerySchema, { 'filter[identifier][key]': 'order_id' })).toBe(
      true,
    );
    expect(refused(listTransactionsQuerySchema, { 'filter[identifier][value]': 'x' })).toBe(true);
  });

  it('attaches at most 100 distinct inquiries, reports and verifications', () => {
    const body = (ids: string[]) => ({ meta: { 'object-ids': ids } });
    expect(transactionObjectsBodySchema.safeParse(body([INQUIRY])).success).toBe(true);
    expect(refused(transactionObjectsBodySchema, body([ACCOUNT]))).toBe(true);
    expect(refused(transactionObjectsBodySchema, body([INQUIRY, INQUIRY]))).toBe(true);
    expect(refused(transactionObjectsBodySchema, body([]))).toBe(true);
  });

  it('relates to an account or a transaction', () => {
    const body = (target: string) => ({
      meta: { 'relation-schema-key': 'buyer', 'target-object-id': target },
    });
    expect(transactionRelationBodySchema.safeParse(body(ACCOUNT)).success).toBe(true);
    expect(transactionRelationBodySchema.safeParse(body(TRANSACTION)).success).toBe(true);
    expect(refused(transactionRelationBodySchema, body(INQUIRY))).toBe(true);
  });

  it('labels with a finite score, and builds the label', () => {
    expect(
      labelTransactionBodySchema.safeParse({
        meta: { label: 'chargeback', score: 0.5, 'model-version': 'synthetic-1' },
      }).success,
    ).toBe(true);
    expect(refused(labelTransactionBodySchema, { meta: { label: 'x', score: Infinity } })).toBe(
      true,
    );
    expect(
      buildTransactionLabelResource({
        id: LABEL,
        label: 'chargeback',
        modelVersion: null,
        score: 0.5,
        createdAt: AT,
        updatedAt: AT,
      }).attributes,
    ).toMatchObject({ 'model-label': 'chargeback', 'model-version': null, score: 0.5 });
  });

  it('offers the audited override on redaction (P21)', () => {
    expect(redactTransactionBodySchema.safeParse({}).success).toBe(true);
    expect(redactTransactionBodySchema.safeParse({ meta: { 'include-never': true } }).success).toBe(
      true,
    );
    expect(refused(redactTransactionBodySchema, { meta: { other: true } })).toBe(true);
  });

  it('marks fields, file content and the identifier filter PII (C105.8, P06, C107.5)', () => {
    expect([...PII_TRANSACTION_ATTRIBUTES].sort()).toEqual(
      ['content', 'fields', 'filter[identifier][value]'].sort(),
    );
  });
});

describe('a transaction’s relations (K7C-2, C108)', () => {
  const ID = `${TRANSACTION}:payer:${ACCOUNT}`;
  const relation = (attributes: Record<string, unknown> = {}, id = ID) => ({
    data: [
      {
        type: 'transaction-relation',
        id,
        attributes: {
          'relation-schema-key': 'payer',
          target: { type: 'account', id: ACCOUNT },
          'created-at': AT.toISOString(),
          ...attributes,
        },
      },
    ],
    links: { next: null },
  });
  const schema = transactionRelationListDocumentSchema;

  it('names an account or a transaction by a resource identifier, and nothing of it', () => {
    expect(schema.safeParse(relation()).success).toBe(true);
    expect(
      schema.safeParse(
        relation(
          { target: { type: 'transaction', id: TRANSACTION } },
          `${TRANSACTION}:payer:${TRANSACTION}`,
        ),
      ).success,
    ).toBe(true);
    expect(refused(schema, relation({ target: { type: 'inquiry', id: INQUIRY } }))).toBe(true);
    expect(
      refused(schema, relation({ target: { type: 'account', id: ACCOUNT, attributes: {} } })),
    ).toBe(true);
    expect(refused(schema, relation({ 'reference-id': 'ref-test-001' }))).toBe(true);
  });

  it('has an id that names the transaction, the key and the target', () => {
    expect(refused(schema, relation({}, `payer:${ACCOUNT}`))).toBe(true);
    expect(refused(schema, relation({}, `${TRANSACTION}:Payer:${ACCOUNT}`))).toBe(true);
    expect(refused(schema, relation({}, `${TRANSACTION}:payer:${INQUIRY}`))).toBe(true);
  });

  it('takes a position as a cursor: a time to the microsecond, a key and a target', () => {
    const cursor = `2026-10-31T12:00:00.123456Z~refund-of_2~${TRANSACTION}`;

    expect(transactionRelationCursorSchema.parse(cursor)).toBe(cursor);
    expect(listTransactionRelationsQuerySchema.parse({ 'page[after]': cursor })).toEqual({
      'page[after]': cursor,
    });
    for (const value of [
      ID,
      `2026-10-31T12:00:00.123Z~payer~${ACCOUNT}`,
      `2026-13-01T12:00:00.123456Z~payer~${ACCOUNT}`,
      `2026-02-30T12:00:00.123456Z~payer~${ACCOUNT}`,
      `0000-01-01T00:00:00.000000Z~payer~${ACCOUNT}`,
      `2026-10-31T12:00:00.123456Z~Payer~${ACCOUNT}`,
      `2026-10-31T12:00:00.123456Z~payer~${INQUIRY}`,
      `2026-10-31T12:00:00.123456Z~payer~${ACCOUNT}~more`,
    ]) {
      expect(refused(transactionRelationCursorSchema, value), value).toBe(true);
    }
    expect(refused(listTransactionRelationsQuerySchema, { 'page[size]': 500 })).toBe(true);
    expect(refused(listTransactionRelationsQuerySchema, { filter: 'x' })).toBe(true);
  });
});

describe('the transaction events (C105.3, C107.5)', () => {
  it('carry no field values', () => {
    const data = buildTransactionResource({ ...transaction, fields: null });
    expect(
      eventAttributesSchema.safeParse({
        name: 'transaction.created',
        payload: { data },
        'created-at': '2026-10-31T12:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      refused(eventAttributesSchema, {
        name: 'transaction.created',
        payload: { data: buildTransactionResource(transaction) },
        'created-at': '2026-10-31T12:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('name the related object in a relation event, in the newer changelog names', () => {
    expect(
      transactionRelationMetaSchema.safeParse({
        context: { 'relation-schema-key': 'buyer', 'related-account-id': ACCOUNT },
      }).success,
    ).toBe(true);
    expect(
      refused(transactionRelationMetaSchema, {
        context: { 'relation-schema-key': 'buyer', 'target-account-id': ACCOUNT },
      }),
    ).toBe(true);
    const data = buildTransactionResource({ ...transaction, fields: null });
    expect(
      refused(eventAttributesSchema, {
        name: 'transaction.added-relation',
        payload: { data },
        'created-at': '2026-10-31T12:00:00.000Z',
      }),
    ).toBe(true);
  });
});

describe('the transaction relationship (C105.7, a Phase 6 amendment)', () => {
  const golden = () =>
    structuredClone(readFixture('api/report-watchlist.json')) as {
      data: { relationships: Record<string, unknown> };
    };

  it('names the latest transaction on a report, or null', () => {
    const report = golden();
    expect(report.data.relationships.transaction).toEqual({ data: null });
    report.data.relationships.transaction = { data: { type: 'transaction', id: TRANSACTION } };
    expect(reportDocumentSchema.safeParse(report).success).toBe(true);
    report.data.relationships.transaction = { data: { type: 'account', id: ACCOUNT } };
    expect(refused(reportDocumentSchema, report)).toBe(true);
  });

  it('is optional on an inquiry, so a stored payload from before Phase 7 still parses', () => {
    const relationships = (readFixture('api/inquiry.json') as { data: { relationships: object } })
      .data.relationships;
    expect(inquiryRelationshipsSchema.safeParse(relationships).success).toBe(true);
    expect(
      inquiryRelationshipsSchema.safeParse({
        ...relationships,
        transaction: { data: { type: 'transaction', id: TRANSACTION } },
      }).success,
    ).toBe(true);
  });
});

describe('the type events’ field-key (K7B-8, owner decision 2 after 7B)', () => {
  const deleted = (key: string) =>
    transactionTypeDeletedFieldMetaSchema.safeParse({ 'field-key': key, 'version-number': 2 })
      .success;

  it('takes one segment, as every existing consumer reads, and a dotted path', () => {
    expect(deleted('amount')).toBe(true);
    expect(deleted('h.x')).toBe(true);
    expect(deleted('a.b.c.d')).toBe(true);
    expect(
      transactionTypeConvertedFieldMetaSchema.safeParse({
        'field-key': 'h.x',
        'version-number': 2,
        from: 'string',
        to: 'integer',
      }).success,
    ).toBe(true);
  });

  it('refuses a path deeper than the nesting allows, and a broken segment', () => {
    expect(deleted('a.b.c.d.e')).toBe(false);
    expect(deleted('a..b')).toBe(false);
    expect(deleted('A.b')).toBe(false);
  });
});
