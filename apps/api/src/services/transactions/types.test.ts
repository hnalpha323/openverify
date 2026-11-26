/**
 * Workflow 7B Stage 3 (`api-transactions`; C104.1, C104.3, C104.6): transaction types and their
 * versions through the routes: a type comes with its first draft, a draft changes and is published
 * as C71 publishes a template version, the engine's rules and ajv's compilation of each `json`
 * schema run at publish, and a publish that drops or converts a field emits the type events.
 * Order is asserted only on `created_at DESC, id DESC`. Every value is synthetic.
 */
import { eventAttributesSchema } from '@openverify/contracts';
import { createdAtClock, wallClockStepsBack } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
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

interface Resource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: unknown }>;
}

const STRING_FIELD = { type: 'string', key: 'iban', label: 'IBAN' };
const AMOUNT_FIELD = { type: 'number', key: 'amount', label: 'Amount' };

async function createType(attributes: Record<string, unknown> = {}, token = api.token) {
  const response = await call(
    'POST',
    '/transaction-types',
    body('transaction-type', { name: 'Synthetic payout', ...attributes }),
    token,
  );
  expect(response.statusCode).toBe(201);
  return response.json<{ data: Resource }>().data;
}

/** A new draft of the type, from its latest version. */
async function draftOf(typeId: string) {
  const response = await call(
    'POST',
    '/transaction-type-versions',
    body('transaction-type-version', { 'transaction-type-id': typeId }),
  );
  expect(response.statusCode).toBe(201);
  return response.json<{ data: Resource }>().data;
}

const publish = (versionId: string) =>
  call('POST', `/transaction-type-versions/${versionId}/publish`);

/** Version 1 of a new type: the draft that came with it. */
async function firstVersion(typeId: string) {
  const result = await api.database.db.execute(
    sql`select id from transaction_type_versions where transaction_type_id = ${typeId}
        and version = 1`,
  );
  return (result as unknown as { rows: { id: string }[] }).rows[0]?.id ?? '';
}

describe('transaction types (C104.1)', () => {
  it('creates a type with a draft version 1 holding the default statuses, audited', async () => {
    const type = await createType({ 'field-schemas': [STRING_FIELD] });

    expect(type).toMatchObject({
      type: 'transaction-type',
      attributes: {
        name: 'Synthetic payout',
        status: 'active',
        'latest-version': 1,
        'published-version': null,
        'field-schemas': [],
        statuses: [],
        'relation-schemas': [],
      },
    });
    expect(api.audit.entries.at(-1)).toMatchObject({
      action: 'transaction-type.created',
      resourceType: 'transaction-type',
      resourceId: type.id,
    });
    const version = await firstVersion(type.id);
    const read = await call('GET', `/transaction-type-versions/${version}`);
    expect(read.statusCode).toBe(200);
    expect(read.json<{ data: Resource }>().data).toMatchObject({
      attributes: {
        'version-number': 1,
        status: 'draft',
        'field-schemas': [STRING_FIELD],
        statuses: ['created', 'approved', 'declined', 'needs review'],
        'allow-card-like-strings': false,
        'published-at': null,
      },
      relationships: { 'transaction-type': { data: { type: 'transaction-type', id: type.id } } },
    });
  });

  it('reads, lists newest first, renames and archives, in this environment only', async () => {
    onTestFinished(wallClockStepsBack());
    const tenant = await api.newTenant();
    const call2 = (method: Method, url: string, payload?: unknown) =>
      call(method, url, payload, tenant.token);
    const clock = createdAtClock(api.database.db);
    const ids: string[] = [];
    for (const name of ['First', 'Second', 'Third']) {
      const created = await call2('POST', '/transaction-types', body('transaction-type', { name }));
      const id = created.json<{ data: Resource }>().data.id;
      await clock.at('transaction_types', id);
      ids.push(id);
    }

    const listed = await call2('GET', '/transaction-types?page[size]=2');
    expect(listed.json<{ data: Resource[] }>().data.map((type) => type.id)).toEqual([
      ids[2],
      ids[1],
    ]);
    expect(listed.json<{ links: { next: string } }>().links.next).toContain('page[after]=');
    expect((await call('GET', `/transaction-types/${ids[0] ?? ''}`)).statusCode).toBe(404);

    const renamed = await call2(
      'PATCH',
      `/transaction-types/${ids[0] ?? ''}`,
      body('transaction-type', { name: 'Renamed' }),
    );
    expect(renamed.json<{ data: Resource }>().data.attributes.name).toBe('Renamed');
    const archived = await call2('DELETE', `/transaction-types/${ids[0] ?? ''}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json<{ data: Resource }>().data.attributes.status).toBe('archived');
    const onlyArchived = await call2('GET', '/transaction-types?filter[status]=archived');
    expect(onlyArchived.json<{ data: Resource[] }>().data.map((type) => type.id)).toEqual([ids[0]]);
  });
});

describe('transaction type versions (C104.1, as C71)', () => {
  it('makes a draft from the latest version, its members replaced, and changes drafts only', async () => {
    const type = await createType({ 'field-schemas': [STRING_FIELD] });
    const draft = await draftOf(type.id);
    expect(draft.attributes).toMatchObject({
      'version-number': 2,
      status: 'draft',
      'field-schemas': [STRING_FIELD],
    });

    const changed = await call(
      'PATCH',
      `/transaction-type-versions/${draft.id}`,
      body('transaction-type-version', {
        'field-schemas': [STRING_FIELD, AMOUNT_FIELD],
        'allow-card-like-strings': true,
      }),
    );
    expect(changed.statusCode).toBe(200);
    expect(changed.json<{ data: Resource }>().data.attributes).toMatchObject({
      'field-schemas': [STRING_FIELD, AMOUNT_FIELD],
      'allow-card-like-strings': true,
    });

    expect((await publish(draft.id)).statusCode).toBe(200);
    const late = await call(
      'PATCH',
      `/transaction-type-versions/${draft.id}`,
      body('transaction-type-version', { 'field-schemas': [] }),
    );
    expect(late.statusCode).toBe(409);
    expect(late.json<{ code: string }>().code).toBe('transaction_type_version_not_draft');
    expect((await publish(draft.id)).json<{ code: string }>().code).toBe(
      'transaction_type_version_not_draft',
    );
  });

  it('answers 404 for a type or version of another environment', async () => {
    const tenant = await api.newTenant();
    const type = await createType();
    const response = await call(
      'POST',
      '/transaction-type-versions',
      body('transaction-type-version', { 'transaction-type-id': type.id }),
      tenant.token,
    );
    expect(response.statusCode).toBe(404);
  });

  it('publishes: the type serves the published version, and the previous one is superseded', async () => {
    const type = await createType({ 'field-schemas': [STRING_FIELD] });
    const first = await firstVersion(type.id);
    const published = await publish(first);
    expect(published.statusCode).toBe(200);
    expect(published.json<{ data: Resource }>().data.attributes.status).toBe('published');

    const read = await call('GET', `/transaction-types/${type.id}`);
    expect(read.json<{ data: Resource }>().data.attributes).toMatchObject({
      'field-schemas': [STRING_FIELD],
      statuses: ['created', 'approved', 'declined', 'needs review'],
      'latest-version': 1,
      'published-version': 1,
    });
    expect(api.audit.entries.at(-1)).toMatchObject({
      action: 'transaction-type-version.published',
      resourceId: first,
    });
  });

  it('refuses a version that breaks the engine’s rules, with each pointer (C104.2, C104.3)', async () => {
    const type = await createType({
      'field-schemas': [
        STRING_FIELD,
        { type: 'json', key: 'meta', label: 'Meta', config: { 'json-schema': { pattern: 'x' } } },
      ],
    });
    const response = await publish(await firstVersion(type.id));

    expect(response.statusCode).toBe(422);
    const problem = response.json<{ code: string; errors: { pointer: string }[] }>();
    expect(problem.code).toBe('field_schema_invalid');
    expect(problem.errors.map((error) => error.pointer)).toContain(
      '/data/attributes/field-schemas/1/config/json-schema/pattern',
    );
  });

  it('refuses an unsupported relation target with its own code (C104.2)', async () => {
    const type = await createType({
      'field-schemas': [
        { type: 'relation-schema', key: 'doc', label: 'Doc', config: { target: 'document-mdoc' } },
      ],
    });
    const response = await publish(await firstVersion(type.id));

    expect(response.statusCode).toBe(422);
    expect(response.json<{ code: string }>().code).toBe('relation_target_unsupported');
  });

  it('refuses a json schema ajv will not compile in strict mode, never a 500 (C104.3)', async () => {
    const type = await createType({
      'field-schemas': [
        { type: 'json', key: 'meta', label: 'Meta', config: { 'json-schema': { minimum: 3 } } },
      ],
    });
    const response = await publish(await firstVersion(type.id));

    expect(response.statusCode).toBe(422);
    const problem = response.json<{ code: string; errors: { pointer: string }[] }>();
    expect(problem.code).toBe('field_schema_invalid');
    expect(problem.errors.map((error) => error.pointer)).toEqual([
      '/data/attributes/field-schemas/0/config/json-schema',
    ]);
  });

  it('emits deleted-field and converted-field when a publish drops or retypes a field (C104.6)', async () => {
    const type = await createType({ 'field-schemas': [STRING_FIELD, AMOUNT_FIELD] });
    await publish(await firstVersion(type.id));
    const draft = await draftOf(type.id);
    await call(
      'PATCH',
      `/transaction-type-versions/${draft.id}`,
      body('transaction-type-version', {
        'field-schemas': [{ type: 'integer', key: 'amount', label: 'Amount' }],
      }),
    );
    const before = api.events.events.length;

    expect((await publish(draft.id)).statusCode).toBe(200);

    const emitted = api.events.events.slice(before);
    expect(emitted.map((event) => [event.name, event.payload.meta])).toEqual([
      ['transaction-type.deleted-field', { 'field-key': 'iban', 'version-number': 2 }],
      [
        'transaction-type.converted-field',
        { 'field-key': 'amount', 'version-number': 2, from: 'number', to: 'integer' },
      ],
    ]);
    for (const event of emitted) {
      expect(
        eventAttributesSchema.safeParse({
          name: event.name,
          payload: event.payload,
          'created-at': new Date().toISOString(),
        }).success,
      ).toBe(true);
    }
  });

  it('refuses a draft of an archived type', async () => {
    const type = await createType();
    await call('DELETE', `/transaction-types/${type.id}`);
    const response = await call(
      'POST',
      '/transaction-type-versions',
      body('transaction-type-version', { 'transaction-type-id': type.id }),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe('transaction_type_archived');
  });
});
