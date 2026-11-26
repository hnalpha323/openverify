/**
 * Workflow 7B Stage 3 (`api-transactions`; C104.2-C104.5, C105.1-C105.3, C105.8): transactions
 * through the routes: validated against the type's published version, which each pins; the
 * card-number guard at every position; the searchable keys; `write_once`; statuses, tags, labels,
 * objects and relations with their events, which never carry a field value; masking without
 * `pii:view`. Order is asserted only on `created_at DESC, id DESC`. Every value is synthetic, and
 * the card-like strings are the guard's own refusal cases.
 */
import { eventAttributesSchema } from '@openverify/contracts';
import {
  createAccount,
  createFile,
  createVerification,
  redactTransactionRecords,
} from '@openverify/db';
import {
  createTestInquiry,
  createdAtClock,
  testId,
  wallClockStepsBack,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { checkReference } from './write-checks.js';
import { bearer } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const call = (method: Method, url: string, payload?: unknown, token = api.token) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const body = (type: string, attributes: Record<string, unknown>) => ({
  data: { type, attributes },
});
const meta = (members: Record<string, unknown>) => ({ meta: members });

interface Resource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: unknown }>;
}

/** A card-like test string: a Luhn-valid 16-digit run (the guard's refusal case only). */
const CARD_LIKE = '4242 4242 4242 4242';

const FIELDS = [
  { type: 'string', key: 'iban', label: 'IBAN', config: { searchable: true } },
  { type: 'number', key: 'amount', label: 'Amount' },
  { type: 'string', key: 'ledger', label: 'Ledger', config: { 'write-policy': 'write_once' } },
  {
    type: 'json',
    key: 'meta',
    label: 'Meta',
    config: {
      'json-schema': {
        type: 'object',
        properties: { note: { type: 'string', maxLength: 5 } },
        additionalProperties: false,
      },
    },
  },
  { type: 'platform-file', key: 'evidence', label: 'Evidence' },
  { type: 'relation-schema', key: 'selfie', label: 'Selfie', config: { target: 'selfie' } },
];
const RELATIONS = [
  { key: 'payer', target: 'account', cardinality: 'many' },
  { key: 'refund-of', target: 'transaction', cardinality: 'one' },
];

/** A type with `FIELDS`, published, in the harness's environment unless a token is given. */
async function publishedType(token = api.token, fieldSchemas: unknown[] = FIELDS) {
  const created = await call(
    'POST',
    '/transaction-types',
    body('transaction-type', {
      name: 'Synthetic payout',
      'field-schemas': fieldSchemas,
      'relation-schemas': RELATIONS,
    }),
    token,
  );
  expect(created.statusCode).toBe(201);
  const typeId = created.json<{ data: Resource }>().data.id;
  const result = await api.database.db.execute(
    sql`select id from transaction_type_versions where transaction_type_id = ${typeId}`,
  );
  const versionId = (result as unknown as { rows: { id: string }[] }).rows[0]?.id ?? '';
  expect(
    (await call('POST', `/transaction-type-versions/${versionId}/publish`, undefined, token))
      .statusCode,
  ).toBe(200);
  return { typeId, versionId };
}

async function createTransaction(
  typeId: string,
  attributes: Record<string, unknown> = {},
  token = api.token,
) {
  return call(
    'POST',
    '/transactions',
    body('transaction', { 'transaction-type-id': typeId, ...attributes }),
    token,
  );
}

async function created(typeId: string, attributes: Record<string, unknown> = {}) {
  const response = await createTransaction(typeId, attributes);
  expect(response.statusCode).toBe(201);
  return response.json<{ data: Resource }>().data;
}

interface Problem {
  code: string;
  errors?: { pointer: string; detail: string }[];
}

const problemOf = (response: { json: () => unknown }) => response.json() as Problem;

function expectValidEvent(name: string) {
  const event = api.events.named(name).at(-1);
  expect(event).toBeDefined();
  expect(
    eventAttributesSchema.safeParse({
      name,
      payload: event?.payload,
      'created-at': new Date().toISOString(),
    }).success,
  ).toBe(true);
  return event;
}

let type: { typeId: string; versionId: string };

beforeAll(async () => {
  type = await publishedType();
});

describe('creating a transaction (C105.1, C105.2)', () => {
  it('validates against the published version, pins it, and emits transaction.created with no value', async () => {
    const account = await createAccount(api.database.db, api.environmentId, {
      id: testId('acc'),
      referenceId: 'synthetic-customer-1',
    });
    const transaction = await created(type.typeId, {
      fields: { iban: 'synthetic-iban', amount: 12.5, meta: { note: 'ok' } },
      'reference-id': 'synthetic-customer-1',
      tags: ['Synthetic'],
    });

    expect(transaction).toMatchObject({
      type: 'transaction',
      attributes: {
        status: 'created',
        'reference-id': 'synthetic-customer-1',
        fields: {
          iban: { type: 'string', value: 'synthetic-iban' },
          amount: { type: 'number', value: 12.5 },
          meta: { type: 'json', value: { note: 'ok' } },
        },
        tags: ['Synthetic'],
        signals: null,
        'transaction-type-version-id': type.versionId,
        'redacted-at': null,
      },
      relationships: {
        'transaction-type': { data: { type: 'transaction-type', id: type.typeId } },
        'transaction-label': { data: null },
        'related-objects': { data: [{ type: 'account', id: account.id }] },
      },
    });
    const event = expectValidEvent('transaction.created');
    expect(event?.payload.data).toMatchObject({ id: transaction.id, attributes: { fields: null } });
    expect(JSON.stringify(event?.payload)).not.toContain('synthetic-iban');
    expect(api.audit.withAction('transaction.created').at(-1)).toMatchObject({
      resourceId: transaction.id,
    });
    const history = await api.database.db.execute(
      sql`select from_status, to_status from transaction_status_history
          where transaction_id = ${transaction.id}`,
    );
    expect((history as unknown as { rows: unknown[] }).rows).toEqual([
      { from_status: null, to_status: 'created' },
    ]);
  });

  it('refuses a value that breaks its field, and an undeclared key, at their pointers', async () => {
    const response = await createTransaction(type.typeId, { fields: { amount: 'x', nope: 1 } });

    expect(response.statusCode).toBe(422);
    const problem = problemOf(response);
    expect(problem.code).toBe('field_schema_invalid');
    expect(problem.errors?.map((error) => error.pointer).sort()).toEqual(
      ['/data/attributes/fields', '/data/attributes/fields/amount'].sort(),
    );
  });

  it('refuses a json value its schema refuses, at the field (C104.3)', async () => {
    const response = await createTransaction(type.typeId, {
      fields: { meta: { note: 'too long' } },
    });

    expect(response.statusCode).toBe(422);
    expect(problemOf(response).errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/fields/meta',
    ]);
  });

  it('refuses a card-like value in a field, the reference and a tag (C104.4)', async () => {
    for (const attributes of [
      { fields: { iban: `card ${CARD_LIKE}` } },
      { 'reference-id': CARD_LIKE },
      { tags: [CARD_LIKE.replaceAll(' ', '-')] },
    ]) {
      const response = await createTransaction(type.typeId, attributes);
      expect(response.statusCode).toBe(422);
      expect(problemOf(response).code).toBe('card_number_refused');
      expect(JSON.stringify(response.json())).not.toContain('4242');
    }
  });

  it('refuses a type with no published version, an archived type, and another environment’s', async () => {
    const draftOnly = await call(
      'POST',
      '/transaction-types',
      body('transaction-type', { name: 'Draft only' }),
    );
    const draftType = draftOnly.json<{ data: Resource }>().data.id;
    const notPublished = await createTransaction(draftType);
    expect(notPublished.statusCode).toBe(422);
    expect(problemOf(notPublished).code).toBe('transaction_type_not_published');

    const archivedType = await publishedType();
    await call('DELETE', `/transaction-types/${archivedType.typeId}`);
    const archived = await createTransaction(archivedType.typeId);
    expect(archived.statusCode).toBe(409);
    expect(problemOf(archived).code).toBe('transaction_type_archived');

    const tenant = await api.newTenant();
    expect((await createTransaction(type.typeId, {}, tenant.token)).statusCode).toBe(404);
  });

  it('checks a platform file’s environment and the principal’s scope (C104.2, P12)', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const verification = await createVerification(api.database.db, api.environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    const file = await createFile(api.database.db, api.environmentId, {
      id: testId('file'),
      verificationId: verification.id,
      kind: 'selfie-center',
      storageKey: `files/${testId('file')}`,
      mimeType: 'image/png',
      byteSize: 4,
      sha256: 'a'.repeat(64),
      wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
    });
    const reference = { kind: 'platform-file' as const, pointer: '/evidence', id: file.id };
    const acting = (allows: boolean, visible: boolean) => ({
      ctx: { organizationId: api.organizationId, environmentId: api.environmentId },
      actor: { type: 'api-key' as const, id: testId('key') },
      mask: { ...UNMASKED, visible },
      allows: () => allows,
    });
    const check = (allows: boolean, visible: boolean, id = file.id) =>
      checkReference(api.database.db, api.environmentId, acting(allows, visible), {
        ...reference,
        id,
      });

    await expect(check(false, true)).rejects.toMatchObject({ code: 'platform_file_not_allowed' });
    await expect(check(true, false)).rejects.toMatchObject({ code: 'platform_file_not_allowed' });
    await expect(check(true, true, testId('file'))).rejects.toMatchObject({
      code: 'related_object_not_found',
    });
    await expect(check(true, true)).resolves.toBeUndefined();
  });

  it('takes a platform file of its environment in a create, by the platform’s own id (C104.2)', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const verification = await createVerification(api.database.db, api.environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'document',
    });
    const file = await createFile(api.database.db, api.environmentId, {
      id: testId('file'),
      verificationId: verification.id,
      kind: 'document',
      storageKey: `files/${testId('file')}`,
      mimeType: 'image/png',
      byteSize: 4,
      sha256: 'b'.repeat(64),
      wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
    });

    const response = await createTransaction(type.typeId, { fields: { evidence: file.id } });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: Resource }>().data.attributes.fields).toMatchObject({
      evidence: { type: 'platform-file', value: file.id },
    });
  });

  it('checks a relation field’s verification and its type (C104.2)', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const selfie = await createVerification(api.database.db, api.environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    const document = await createVerification(api.database.db, api.environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'document',
    });

    expect(
      (await createTransaction(type.typeId, { fields: { selfie: selfie.id } })).statusCode,
    ).toBe(201);
    const wrong = await createTransaction(type.typeId, { fields: { selfie: document.id } });
    expect(wrong.statusCode).toBe(422);
    expect(problemOf(wrong).code).toBe('related_object_not_found');
  });
});

describe('filter[identifier] is a search by a value (K7B-14)', () => {
  const FILTER = '?filter[identifier][key]=iban&filter[identifier][value]=synthetic-oracle';

  it('refuses a principal who may not see values: a masked key and a viewer read no membership', async () => {
    const transaction = await created(type.typeId, { fields: { iban: 'synthetic-oracle' } });
    const reader = api.newUserToken(api.environmentId, { permissions: ['transactions:read'] });
    const maskedKey = await api.newApiKey(api.environmentId, {
      scopes: ['transactions:read'],
      piiMasked: true,
    });

    for (const token of [reader, maskedKey]) {
      const refused = await call('GET', `/transactions${FILTER}`, undefined, token);
      expect(refused.statusCode).toBe(403);
      expect((await call('GET', '/transactions', undefined, token)).statusCode).toBe(200);
    }
    const found = await call('GET', `/transactions${FILTER}`);
    expect(found.json<{ data: Resource[] }>().data.map(({ id }) => id)).toContain(transaction.id);
  });

  it('finds a transaction for a principal holding pii:view', async () => {
    const transaction = await created(type.typeId, { fields: { iban: 'synthetic-oracle-2' } });
    const reader = api.newUserToken(api.environmentId, {
      permissions: ['transactions:read', 'pii:view'],
    });

    const found = await call(
      'GET',
      '/transactions?filter[identifier][key]=iban&filter[identifier][value]=synthetic-oracle-2',
      undefined,
      reader,
    );

    expect(found.json<{ data: Resource[] }>().data.map(({ id }) => id)).toEqual([transaction.id]);
  });
});

describe('reading transactions (C105.2, C105.8)', () => {
  it('masks each field’s value without pii:view and keeps its type', async () => {
    const transaction = await created(type.typeId, { fields: { iban: 'synthetic-iban' } });
    const masked = api.newUserToken(api.environmentId, { permissions: ['transactions:read'] });

    const response = await call('GET', `/transactions/${transaction.id}`, undefined, masked);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: Resource }>().data.attributes.fields).toEqual({
      iban: { type: 'string', value: null },
    });
  });

  it('includes the type and the latest label when asked', async () => {
    const transaction = await created(type.typeId);
    await call(
      'POST',
      `/transactions/${transaction.id}/label`,
      meta({ label: 'fraud', score: 0.9 }),
    );

    const response = await call(
      'GET',
      `/transactions/${transaction.id}?include=transaction-type,transaction-label`,
    );

    const document = response.json<{ data: Resource; included: Resource[] }>();
    expect(document.included.map((resource) => resource.type).sort()).toEqual([
      'transaction-label',
      'transaction-type',
    ]);
    expect(
      document.included.find((resource) => resource.type === 'transaction-label'),
    ).toMatchObject({
      attributes: { 'model-label': 'fraud', score: 0.9 },
    });
  });

  it('lists newest first, filtered by type, status, reference and a searchable field', async () => {
    onTestFinished(wallClockStepsBack());
    const own = await publishedType();
    const clock = createdAtClock(api.database.db);
    const first = await created(own.typeId, {
      fields: { iban: 'synthetic-search' },
      'reference-id': 'synthetic-ref',
    });
    await clock.at('transactions', first.id);
    const second = await created(own.typeId, { fields: { iban: 'synthetic-other' } });
    await clock.at('transactions', second.id);
    await call('PATCH', `/transactions/${second.id}`, body('transaction', { status: 'approved' }));
    const ids = async (query: string) =>
      (await call('GET', `/transactions?filter[transaction-type-id]=${own.typeId}${query}`))
        .json<{ data: Resource[] }>()
        .data.map((row) => row.id);

    expect(await ids('')).toEqual([second.id, first.id]);
    expect(await ids('&filter[status]=approved')).toEqual([second.id]);
    expect(await ids('&filter[reference-id]=synthetic-ref')).toEqual([first.id]);
    expect(
      await ids('&filter[identifier][key]=iban&filter[identifier][value]=synthetic-search'),
    ).toEqual([first.id]);
    expect(await ids('&filter[identifier][key]=amount&filter[identifier][value]=1')).toEqual([]);
    const paged = await call(
      'GET',
      `/transactions?filter[transaction-type-id]=${own.typeId}&page[size]=1`,
    );
    expect(paged.json<{ links: { next: string } }>().links.next).toContain(
      `filter[transaction-type-id]=${own.typeId}`,
    );
  });
});

describe('changing a transaction (C105.2, C105.3)', () => {
  it('moves its status with a history row and status-updated, and refuses an unknown status', async () => {
    const transaction = await created(type.typeId);
    const moved = await call(
      'PATCH',
      `/transactions/${transaction.id}`,
      body('transaction', { status: 'needs review' }),
    );

    expect(moved.statusCode).toBe(200);
    expect(moved.json<{ data: Resource }>().data.attributes.status).toBe('needs review');
    expect(expectValidEvent('transaction.status-updated')?.payload.meta).toEqual({
      from: 'created',
      to: 'needs review',
    });
    const unknown = await call(
      'PATCH',
      `/transactions/${transaction.id}`,
      body('transaction', { status: 'nowhere' }),
    );
    expect(unknown.statusCode).toBe(422);
    expect(problemOf(unknown).code).toBe('status_does_not_exist');
  });

  it('merges fields with updated-fields, and refuses a second write of a write_once field', async () => {
    const transaction = await created(type.typeId, { fields: { ledger: 'synthetic-ledger' } });
    const updated = await call(
      'PATCH',
      `/transactions/${transaction.id}`,
      body('transaction', { fields: { amount: 3 } }),
    );

    expect(updated.json<{ data: Resource }>().data.attributes.fields).toEqual({
      ledger: { type: 'string', value: 'synthetic-ledger' },
      amount: { type: 'number', value: 3 },
    });
    expectValidEvent('transaction.updated-fields');
    const again = await call(
      'PATCH',
      `/transactions/${transaction.id}`,
      body('transaction', { fields: { ledger: 'synthetic-other' } }),
    );
    expect(again.statusCode).toBe(409);
    expect(problemOf(again).code).toBe('field_write_once');
  });

  it('labels through the PATCH and the label route, refusing a card-like label', async () => {
    const transaction = await created(type.typeId);
    const patched = await call(
      'PATCH',
      `/transactions/${transaction.id}`,
      body('transaction', { label: 'legit' }),
    );
    expect(
      patched.json<{ data: Resource }>().data.relationships['transaction-label']?.data,
    ).toMatchObject({ type: 'transaction-label' });
    expectValidEvent('transaction.labeled');
    const refused = await call(
      'POST',
      `/transactions/${transaction.id}/label`,
      meta({ label: CARD_LIKE }),
    );
    expect(refused.statusCode).toBe(422);
    expect(problemOf(refused).code).toBe('card_number_refused');
  });

  it('adds, removes and sets tags ignoring case', async () => {
    const transaction = await created(type.typeId, { tags: ['One'] });
    const url = `/transactions/${transaction.id}`;
    await call('POST', `${url}/add-tag`, meta({ 'tag-name': 'Two' }));
    await call('POST', `${url}/add-tag`, meta({ 'tag-name': 'two' }));
    const removed = await call('POST', `${url}/remove-tag`, meta({ 'tag-name': 'one' }));
    expect(removed.json<{ data: Resource }>().data.attributes.tags).toEqual(['Two']);
    const set = await call('POST', `${url}/set-tags`, meta({ 'tag-names': ['a', 'A', 'b'] }));
    expect(set.json<{ data: Resource }>().data.attributes.tags).toEqual(['a', 'b']);
  });

  it('refuses a change to a redacted transaction (410)', async () => {
    const transaction = await created(type.typeId);
    await redactTransactionRecords(api.database.db, api.environmentId, transaction.id, {});

    const response = await call(
      'PATCH',
      `/transactions/${transaction.id}`,
      body('transaction', { status: 'approved' }),
    );
    expect(response.statusCode).toBe(410);
    expect(problemOf(response).code).toBe('transaction_redacted');
  });
});

describe('the two transaction limits have codes (K7B-6, owner decision 10)', () => {
  it('answers relation_cardinality_exceeded for a second target of a one-target relation', async () => {
    const transaction = await created(type.typeId);
    const first = await created(type.typeId);
    const second = await created(type.typeId);
    const url = `/transactions/${transaction.id}/add-relation`;
    const relation = (target: string) =>
      meta({ 'relation-schema-key': 'refund-of', 'target-object-id': target });

    expect((await call('POST', url, relation(first.id))).statusCode).toBe(200);
    const refused = await call('POST', url, relation(second.id));

    expect(refused.statusCode).toBe(422);
    expect(problemOf(refused).code).toBe('relation_cardinality_exceeded');
    expect(problemOf(refused).errors?.map(({ pointer }) => pointer)).toEqual([
      '/meta/relation-schema-key',
    ]);
  });

  it('answers related_objects_limit for the 101st related object', async () => {
    const transaction = await created(type.typeId);
    const url = `/transactions/${transaction.id}/add-objects`;
    const inquiries = await Promise.all(
      Array.from({ length: 101 }, () => createTestInquiry(api.database.db, api.environmentId)),
    );
    const ids = inquiries.map(({ inquiry }) => inquiry.id);

    expect(
      (await call('POST', url, meta({ 'object-ids': ids.slice(0, 100) }))).statusCode,
    ).toBe(200);
    const refused = await call('POST', url, meta({ 'object-ids': ids.slice(100) }));

    expect(refused.statusCode).toBe(422);
    expect(problemOf(refused).code).toBe('related_objects_limit');
    expect(problemOf(refused).errors?.map(({ pointer }) => pointer)).toEqual(['/meta/object-ids']);
  });
});

describe('objects and relations (C105.2, C105.3, C105.7)', () => {
  it('attaches and detaches the environment’s objects, refusing another’s', async () => {
    const transaction = await created(type.typeId);
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const tenant = await api.newTenant();
    const foreign = await createTestInquiry(api.database.db, tenant.environmentId);
    const url = `/transactions/${transaction.id}`;

    const added = await call('POST', `${url}/add-objects`, meta({ 'object-ids': [inquiry.id] }));
    expect(added.json<{ data: Resource }>().data.relationships['related-objects']?.data).toEqual([
      { type: 'inquiry', id: inquiry.id },
    ]);
    const refused = await call(
      'POST',
      `${url}/add-objects`,
      meta({ 'object-ids': [foreign.inquiry.id] }),
    );
    expect(refused.statusCode).toBe(422);
    expect(problemOf(refused).code).toBe('related_object_not_found');
    const removed = await call(
      'POST',
      `${url}/remove-objects`,
      meta({ 'object-ids': [inquiry.id] }),
    );
    expect(removed.json<{ data: Resource }>().data.relationships['related-objects']?.data).toEqual(
      [],
    );
  });

  it('adds and removes relations idempotently, with their context, refusing unknown ones', async () => {
    const transaction = await created(type.typeId);
    const target = await created(type.typeId);
    const account = await createAccount(api.database.db, api.environmentId, { id: testId('acc') });
    const url = `/transactions/${transaction.id}`;
    const before = api.events.named('transaction.added-relation').length;

    const toAccount = meta({ 'relation-schema-key': 'payer', 'target-object-id': account.id });
    expect((await call('POST', `${url}/add-relation`, toAccount)).statusCode).toBe(200);
    expect((await call('POST', `${url}/add-relation`, toAccount)).statusCode).toBe(200);
    expect(api.events.named('transaction.added-relation')).toHaveLength(before + 1);
    expect(expectValidEvent('transaction.added-relation')?.payload.meta).toEqual({
      context: { 'relation-schema-key': 'payer', 'related-account-id': account.id },
    });
    await call(
      'POST',
      `${url}/add-relation`,
      meta({ 'relation-schema-key': 'refund-of', 'target-object-id': target.id }),
    );
    expect(expectValidEvent('transaction.added-relation')?.payload.meta).toEqual({
      context: { 'relation-schema-key': 'refund-of', 'related-txn-id': target.id },
    });

    const wrongKind = await call(
      'POST',
      `${url}/add-relation`,
      meta({ 'relation-schema-key': 'payer', 'target-object-id': target.id }),
    );
    expect(problemOf(wrongKind).code).toBe('relation_schema_unknown');
    const missing = await call(
      'POST',
      `${url}/add-relation`,
      meta({ 'relation-schema-key': 'payer', 'target-object-id': testId('acc') }),
    );
    expect(problemOf(missing).code).toBe('related_object_not_found');

    expect((await call('POST', `${url}/remove-relation`, toAccount)).statusCode).toBe(200);
    expectValidEvent('transaction.removed-relation');
  });
});
