/**
 * Workflow 7B Stage 3 (`api-transactions`; C105.5-C105.7, C107.4, C107.6, C105.4): what the
 * transaction family plugs into the platform: the redaction hook with its `never` override, the
 * biometric redaction, the `transaction` relationship of inquiries and reports, the strict filter
 * subject, the account include and the rebuild of the searchable keys. Every value is synthetic.
 */
import { eventAttributesSchema } from '@openverify/contracts';
import {
  createAccount,
  createFile,
  createFaceTemplate,
  createVerification,
  updateEnvironmentSettings,
} from '@openverify/db';
import { createTestInquiry, testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRedactionService } from '../redaction.js';
import { runRetention } from '../retention.js';
import { createDbAccountsService } from '../inquiries.test-support.js';
import { biometricItemRedactor } from '../lists/biometric/index.js';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import { renderedPage, renditionAfter } from '../../test-support/rendition-pages.js';
import { resolveTransactionFilterSubjects } from './filter-subjects.js';
import { rebuildTransactionFieldKeys } from './rebuild.js';
import { resolveTransactionRelationships } from './relationships.js';
import { fieldValueKey } from './write-checks.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi((defaults) => ({
    accounts: createDbAccountsService(),
    redaction: createRedactionService({
      db: defaults.db,
      storage: defaults.storage,
      events: defaults.events,
      clock: defaults.clock,
      audit: defaults.audit,
    }),
  }));
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

interface Resource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: unknown }>;
}

const FIELDS = [
  { type: 'string', key: 'iban', label: 'IBAN', config: { searchable: true } },
  {
    type: 'string',
    key: 'ledger',
    label: 'Ledger',
    config: { 'redaction-policy': 'never', 'never-redact-acknowledged': true },
  },
  { type: 'relation-schema', key: 'selfie', label: 'Selfie', config: { target: 'selfie' } },
];

let typeId: string;

beforeAll(async () => {
  const created = await call('POST', '/transaction-types', {
    data: { type: 'transaction-type', attributes: { name: 'Synthetic', 'field-schemas': FIELDS } },
  });
  typeId = created.json<{ data: Resource }>().data.id;
  const result = await api.database.db.execute(
    sql`select id from transaction_type_versions where transaction_type_id = ${typeId}`,
  );
  const versionId = (result as unknown as { rows: { id: string }[] }).rows[0]?.id ?? '';
  expect((await call('POST', `/transaction-type-versions/${versionId}/publish`)).statusCode).toBe(
    200,
  );
});

async function newTransaction(fields: Record<string, unknown> = {}) {
  const response = await call('POST', '/transactions', {
    data: { type: 'transaction', attributes: { 'transaction-type-id': typeId, fields } },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ data: Resource }>().data;
}

describe('the redaction (C105.5, P21)', () => {
  it('keeps the never fields, emits transaction.redacted once, and takes them with include-never', async () => {
    const transaction = await newTransaction({
      iban: 'synthetic-iban',
      ledger: 'synthetic-ledger',
    });
    const before = api.events.named('transaction.redacted').length;

    const first = await call('DELETE', `/transactions/${transaction.id}`);
    expect(first.statusCode).toBe(200);
    expect(first.json<{ data: Resource }>().data.attributes).toMatchObject({
      fields: { ledger: { type: 'string', value: 'synthetic-ledger' } },
    });
    expect(first.json<{ data: Resource }>().data.attributes['redacted-at']).not.toBeNull();
    const event = api.events.named('transaction.redacted').at(-1);
    expect(
      eventAttributesSchema.safeParse({
        name: 'transaction.redacted',
        payload: event?.payload,
        'created-at': new Date().toISOString(),
      }).success,
    ).toBe(true);
    expect(JSON.stringify(event?.payload)).not.toContain('synthetic-ledger');

    await call('DELETE', `/transactions/${transaction.id}`);
    expect(api.events.named('transaction.redacted')).toHaveLength(before + 1);

    const override = await call('DELETE', `/transactions/${transaction.id}`, {
      meta: { 'include-never': true },
    });
    expect(override.json<{ data: Resource }>().data.attributes.fields).toBeNull();
    expect(api.audit.withAction('transaction.redacted').at(-1)?.metadata).toMatchObject({
      'include-never': true,
    });
    const keys = await api.database.db.execute(
      sql`select 1 from transaction_field_keys where transaction_id = ${transaction.id}`,
    );
    expect((keys as unknown as { rows: unknown[] }).rows).toEqual([]);
  });

  it('answers 404 for a transaction of another environment', async () => {
    const transaction = await newTransaction();
    const tenant = await api.newTenant();
    expect(
      (await call('DELETE', `/transactions/${transaction.id}`, undefined, tenant.token)).statusCode,
    ).toBe(404);
  });
});

describe('the retention (C105.5, C16)', () => {
  it('redacts a transaction past transaction-retention-days through the hook, keeping never fields', async () => {
    const transaction = await newTransaction({ iban: 'synthetic-due', ledger: 'synthetic-kept' });
    await updateEnvironmentSettings(api.database.db, api.environmentId, {
      'transaction-retention-days': 1,
    });
    await api.database.db.execute(
      sql`update transactions set created_at = now() - interval '3 days'
          where id = ${transaction.id}`,
    );

    const report = await runRetention({
      db: api.database.db,
      storage: api.storage,
      redaction: api.deps.redaction,
      clock: { now: () => new Date() },
    });

    expect(report.redactedTransactions).toBeGreaterThanOrEqual(1);
    expect(report.failedTransactionRedactions).toBe(0);
    const read = await call('GET', `/transactions/${transaction.id}`);
    expect(read.json<{ data: Resource }>().data.attributes).toMatchObject({
      fields: { ledger: { type: 'string', value: 'synthetic-kept' } },
    });
    await updateEnvironmentSettings(api.database.db, api.environmentId, {
      'transaction-retention-days': null,
    });
  });
});

describe('the biometric redaction (C105.6)', () => {
  it('deletes the related selfie’s template and file, through the item redactor, once', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const selfie = await createVerification(api.database.db, api.environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    const key = `${api.environmentId}/synthetic-selfie-object`;
    await api.storage.put(key, new Uint8Array([1, 2, 3]));
    const file = await createFile(api.database.db, api.environmentId, {
      id: testId('file'),
      verificationId: selfie.id,
      kind: 'selfie-center',
      storageKey: key,
      mimeType: 'image/png',
      byteSize: 3,
      sha256: 'a'.repeat(64),
      wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
    });
    await createFaceTemplate(api.database.db, api.environmentId, {
      id: testId('ftpl'),
      verificationId: selfie.id,
      inquiryId: inquiry.id,
      model: 'synthetic-model',
      embedding: [0.1, 0.2],
    });
    const transaction = await newTransaction({ selfie: selfie.id, iban: 'synthetic-iban' });
    const spy = vi.spyOn(biometricItemRedactor, 'redactBySource');

    const response = await call('POST', `/transactions/${transaction.id}/redact-biometrics`);

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: Resource }>().data.attributes).toMatchObject({
      fields: { iban: { type: 'string', value: 'synthetic-iban' } },
    });
    expect(
      response.json<{ data: Resource }>().data.attributes['biometrics-redacted-at'],
    ).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ inquiryId: inquiry.id }),
    );
    spy.mockRestore();
    expect(api.storage.keys()).not.toContain(key);
    const rows = await api.database.db.execute(
      sql`select (select count(*) from face_templates where verification_id = ${selfie.id})::int as templates,
                 (select deleted_at is not null from files where id = ${file.id}) as deleted`,
    );
    expect((rows as unknown as { rows: unknown[] }).rows).toEqual([
      { templates: 0, deleted: true },
    ]);
    const audited = api.audit.withAction('transaction.biometrics-redacted').length;

    expect(
      (await call('POST', `/transactions/${transaction.id}/redact-biometrics`)).statusCode,
    ).toBe(200);
    expect(api.audit.withAction('transaction.biometrics-redacted')).toHaveLength(audited);
  });
});

describe('the biometric redaction’s renditions (C105.6, C135.3)', () => {
  it('discards the redacted file’s rendition pages and deletes their objects after the commit (K8-29)', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const selfie = await createVerification(api.database.db, api.environmentId, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'selfie',
    });
    const key = `${api.environmentId}/synthetic-rendered-selfie`;
    await api.storage.put(key, new Uint8Array([1, 2, 3]));
    const file = await createFile(api.database.db, api.environmentId, {
      id: testId('file'),
      verificationId: selfie.id,
      kind: 'selfie-center',
      storageKey: key,
      mimeType: 'image/png',
      byteSize: 3,
      sha256: 'b'.repeat(64),
      wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
    });
    const page = await renderedPage(api.database.db, api.storage, api.environmentId, file.id);
    const transaction = await newTransaction({ selfie: selfie.id });

    const response = await call('POST', `/transactions/${transaction.id}/redact-biometrics`);

    expect(response.statusCode).toBe(200);
    expect(await renditionAfter(api.database.db, file.id, page)).toEqual({
      discarded: true,
      status: 'deleted',
    });
    expect(api.storage.keys()).not.toContain(page.storageKey);
  });
});

describe('the transaction relationship (C105.7)', () => {
  it('serves the latest transaction an object was attached to, and null without one', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const lone = await createTestInquiry(api.database.db, api.environmentId);
    const transaction = await newTransaction();
    await call('POST', `/transactions/${transaction.id}/add-objects`, {
      meta: { 'object-ids': [inquiry.id] },
    });

    const map = await resolveTransactionRelationships(api.database.db, api.environmentId, [
      inquiry.id,
      lone.inquiry.id,
    ]);
    expect(map).toEqual(
      new Map([
        [inquiry.id, transaction.id],
        [lone.inquiry.id, null],
      ]),
    );
    const read = await call('GET', `/inquiries/${inquiry.id}`);
    expect(read.json<{ data: Resource }>().data.relationships.transaction).toEqual({
      data: { type: 'transaction', id: transaction.id },
    });
  });
});

describe('the strict filter subject (C107.4)', () => {
  it('resolves the attached inquiries’ templates and the related accounts’ types', async () => {
    const { inquiry, template } = await createTestInquiry(api.database.db, api.environmentId);
    const account = await createAccount(api.database.db, api.environmentId, { id: testId('acc') });
    const transaction = await newTransaction();
    await call('POST', `/transactions/${transaction.id}/add-objects`, {
      meta: { 'object-ids': [inquiry.id] },
    });
    await api.database.db.execute(
      sql`insert into transaction_objects (environment_id, transaction_id, account_id)
          values (${api.environmentId}, ${transaction.id}, ${account.id})`,
    );

    const subjects = await resolveTransactionFilterSubjects(api.database.db, api.environmentId, [
      { data: { type: 'transaction', id: transaction.id } },
      { data: { type: 'transaction', id: testId('txn') } },
      null,
    ]);

    expect(subjects).toEqual([
      { inquiryTemplateIds: [template.id], accountTypeIds: [account.accountTypeId] },
      { inquiryTemplateIds: [], accountTypeIds: [] },
      { inquiryTemplateIds: [], accountTypeIds: [] },
    ]);
  });
});

describe('the account include (C107.6)', () => {
  it('includes the account’s transactions, masked as the caller reads them', async () => {
    const account = await createAccount(api.database.db, api.environmentId, {
      id: testId('acc'),
      referenceId: `synthetic-${testId('acc')}`,
    });
    const transaction = await newTransaction({ iban: 'synthetic-iban' });
    await api.database.db.execute(
      sql`insert into transaction_objects (environment_id, transaction_id, account_id)
          values (${api.environmentId}, ${transaction.id}, ${account.id})`,
    );
    const masked = api.newUserToken(api.environmentId, {
      permissions: ['accounts:read', 'transactions:read'],
    });

    const response = await call(
      'GET',
      `/accounts/${account.id}?include=transactions`,
      undefined,
      masked,
    );

    expect(response.statusCode).toBe(200);
    const included = response.json<{ included: Resource[] }>().included;
    expect(included.map((resource) => resource.id)).toEqual([transaction.id]);
    expect(included[0]?.attributes.fields).toEqual({ iban: { type: 'string', value: null } });
  });
});

describe('the rebuild of the searchable keys (C105.4)', () => {
  it('rekeys every unredacted transaction under a new key, and changes nothing the second time', async () => {
    const transaction = await newTransaction({ iban: 'synthetic-rebuild' });
    const key = new Uint8Array(32).fill(7);

    const first = await rebuildTransactionFieldKeys(api.database.db, key, { batchSize: 2 });
    expect(first.scanned).toBeGreaterThan(0);
    expect(first.updated).toBeGreaterThan(0);
    const rows = await api.database.db.execute(
      sql`select value_key from transaction_field_keys where transaction_id = ${transaction.id}`,
    );
    expect((rows as unknown as { rows: unknown[] }).rows).toEqual([
      { value_key: fieldValueKey(key, api.environmentId, 'iban', 'synthetic-rebuild') },
    ]);

    const second = await rebuildTransactionFieldKeys(api.database.db, key, { batchSize: 2 });
    expect(second.updated).toBe(0);
  });
});
