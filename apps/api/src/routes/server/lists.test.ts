/**
 * C97.1, C97.2, C97.5 (Workflow 7B, `api-lists`): the list routes: the thirteen kinds, their own
 * members, the limits in `meta`, the biometric acknowledgement, the archive and the changes a list
 * can take. Every value is synthetic.
 */
import {
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  LIST_LIMITS,
  listLimitsMeta,
  listResourceDocumentSchema,
  listResourceListDocumentSchema,
  type ListKind,
} from '@openverify/contracts';
import { toListResourceType } from '@openverify/core';
import { updateEnvironmentSettings } from '@openverify/db';
import { createdAtClock, seedList, wallClockStepsBack } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { createFakeBiometricListsGate } from '../../test-support/fakes.js';
import { bearer, expectStatus } from '../../test-support/harness.js';

let api: InquiryTestApi;
const gate = createFakeBiometricListsGate();

beforeAll(async () => {
  api = await createInquiryTestApi({ biometricListsGate: gate });
  gate.acknowledged.add(api.environmentId);
});

afterAll(async () => {
  await api.close();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(api.token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });

const CREATE_BODIES: Partial<Record<ListKind, Record<string, unknown>>> = {
  face: { 'item-retention-days': 30 },
  field: { 'field-key': 'synthetic-field' },
  'selfie-background': { 'item-retention-days': 30 },
};

async function created(kind: ListKind, attributes: Record<string, unknown> = {}) {
  const response = await call(
    'POST',
    `/list/${LIST_KIND_REGISTRY[kind].plural}`,
    body({ name: 'Synthetic', ...CREATE_BODIES[kind], ...attributes }),
  );
  const document = listResourceDocumentSchema.parse(expectStatus(response, 201));
  return document;
}

describe('POST /list/<plural> (C97.1, C97.2)', () => {
  it.each([...LIST_KINDS])('creates a %s list with its limits in meta', async (kind) => {
    const document = await created(kind);

    expect(document.data.type).toBe(toListResourceType(kind));
    expect(document.data.attributes).toMatchObject({
      name: 'Synthetic',
      status: 'active',
      'archived-at': null,
      'item-count': 0,
      version: 1,
      'screen-at-completion': true,
    });
    expect(document.meta).toEqual(listLimitsMeta(kind));
  });

  it('keeps each kind’s own members, with the defaults of C97.2', async () => {
    expect((await created('string')).data.attributes).toMatchObject({ 'case-sensitive': false });
    expect((await created('string', { 'case-sensitive': true })).data.attributes).toMatchObject({
      'case-sensitive': true,
    });
    expect((await created('name')).data.attributes).toMatchObject({
      'allow-fuzzy-name-first': false,
    });
    expect((await created('phone-number')).data.attributes).toMatchObject({
      'default-region': null,
    });
    expect(
      (await created('phone-number', { 'default-region': 'US' })).data.attributes,
    ).toMatchObject({ 'default-region': 'US' });
    expect((await created('government-id-number')).data.attributes).toMatchObject({
      'use-for-compromised-ids': false,
    });
    expect((await created('field')).data.attributes).toMatchObject({
      'field-key': 'synthetic-field',
    });
  });

  it('answers 409 for a biometric list until the environment acknowledged it (C97.4)', async () => {
    const closed = await createInquiryTestApi({
      biometricListsGate: createFakeBiometricListsGate(),
    });
    try {
      const response = await closed.app.inject({
        method: 'POST',
        url: '/api/v1/list/faces',
        headers: bearer(closed.token),
        payload: body({ name: 'Faces', 'item-retention-days': 30 }),
      });
      expect(expectStatus(response, 409)).toMatchObject({
        code: 'biometric_lists_not_acknowledged',
      });
    } finally {
      await closed.close();
    }
  });

  it('holds a biometric list’s retention to the consent’s window (C97.2, P08)', async () => {
    const tenant = await api.newTenant();
    gate.acknowledged.add(tenant.environmentId);
    await updateEnvironmentSettings(api.database.db, tenant.environmentId, {
      'face-template-retention-days': 20,
    });
    const { token } = tenant;

    const refused = await api.app.inject({
      method: 'POST',
      url: '/api/v1/list/selfie-backgrounds',
      headers: bearer(token),
      payload: body({ name: 'Rooms', 'item-retention-days': 21 }),
    });
    expect(expectStatus(refused, 422)).toMatchObject({ code: 'retention_exceeds_consent' });

    const kept = await api.app.inject({
      method: 'POST',
      url: '/api/v1/list/selfie-backgrounds',
      headers: bearer(token),
      payload: body({ name: 'Rooms', 'item-retention-days': 20 }),
    });
    expectStatus(kept, 201);
  });

  it('refuses a list past the environment’s limit (C97.5)', async () => {
    const tenant = await api.newTenant();
    await api.database.db.execute(sql`
      insert into lists (id, environment_id, type, name)
      select 'lst_' || lpad(n::text, 26, 'A'), ${tenant.environmentId}, 'string', 'Synthetic'
        from generate_series(1, ${LIST_LIMITS.activeListsPerEnvironment}) as n`);
    const { token } = tenant;

    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/list/strings',
      headers: bearer(token),
      payload: body({ name: 'One too many' }),
    });

    expect(expectStatus(response, 409)).toMatchObject({ code: 'list_limit_reached' });
  });

  it('writes an audit entry naming the list, never a value', async () => {
    const document = await created('string');
    expect(api.audit.entries.filter(({ resourceId }) => resourceId === document.data.id)).toEqual([
      expect.objectContaining({ action: 'list.created', metadata: { kind: 'string' } }),
    ]);
  });
});

describe('GET /lists (C97.1)', () => {
  it('pages newest first, by status and kind, across pages', async () => {
    onTestFinished(wallClockStepsBack());
    const tenant = await api.newTenant();
    const { token } = tenant;
    const clock = createdAtClock(api.database.db);
    const seed = async (input: Parameters<typeof seedList>[2]) => {
      const list = await seedList(api.database.db, tenant.environmentId, input);
      await clock.at('lists', list.id);
      return list;
    };
    const email = await seed({ kind: 'email-address' });
    const archived = await seed({ kind: 'string', status: 'archived' });
    const string = await seed({ kind: 'string' });
    const get = async (url: string) =>
      listResourceListDocumentSchema.parse(
        expectStatus(await api.app.inject({ url, headers: bearer(token) }), 200),
      );

    const first = await get('/api/v1/lists?page[size]=2');
    expect(first.data.map(({ id }) => id)).toEqual([string.id, archived.id]);
    expect(first.links.next).toContain('page[after]=');
    const rest = await get(first.links.next ?? '');
    expect(rest.data.map(({ id }) => id)).toEqual([email.id]);
    expect(rest.links.next).toBeNull();

    const active = await get('/api/v1/lists?filter[status]=active&filter[type]=string');
    expect(active.data.map(({ id }) => id)).toEqual([string.id]);
    const paged = await get('/api/v1/lists?filter[type]=string&page[size]=1');
    expect(paged.links.next).toContain('filter[type]=string');
  });

  it('answers 400 for a cursor that names no list', async () => {
    const response = await call('GET', '/lists?page[after]=lst_00000000000000000000000000');
    expectStatus(response, 400);
  });
});

describe('GET, PATCH and DELETE /lists/:id (C97.1)', () => {
  it('reads a list, and answers 404 for another environment’s', async () => {
    const { data } = await created('string');
    const read = listResourceDocumentSchema.parse(
      expectStatus(await call('GET', `/lists/${data.id}`), 200),
    );
    expect(read.data).toEqual(data);

    const other = await seedList(api.database.db, (await api.newTenant()).environmentId);
    expectStatus(await call('GET', `/lists/${other.id}`), 404);
    expectStatus(await call('PATCH', `/lists/${other.id}`, body({ name: 'x' })), 404);
    expectStatus(await call('DELETE', `/lists/${other.id}`), 404);
  });

  it('changes the four members', async () => {
    const { data } = await created('government-id-number');
    const response = await call(
      'PATCH',
      `/lists/${data.id}`,
      body({
        name: 'Renamed',
        'item-retention-days': 30,
        'screen-at-completion': false,
        'use-for-compromised-ids': true,
      }),
    );
    expect(
      listResourceDocumentSchema.parse(expectStatus(response, 200)).data.attributes,
    ).toMatchObject({
      name: 'Renamed',
      'item-retention-days': 30,
      'screen-at-completion': false,
      'use-for-compromised-ids': true,
    });
  });

  it('refuses a member the kind does not have', async () => {
    const { data } = await created('string');
    const response = await call(
      'PATCH',
      `/lists/${data.id}`,
      body({ 'use-for-compromised-ids': true }),
    );
    expect(expectStatus(response, 422)).toMatchObject({ code: 'list_kind_mismatch' });
  });

  it('holds a biometric list’s retention on a change too (C97.2, P08)', async () => {
    const tenant = await api.newTenant();
    gate.acknowledged.add(tenant.environmentId);
    await updateEnvironmentSettings(api.database.db, tenant.environmentId, {
      'face-template-retention-days': 20,
    });
    const { token } = tenant;
    const list = await seedList(api.database.db, tenant.environmentId, {
      kind: 'face',
      itemRetentionDays: 10,
    });
    const change = (days: number | null) =>
      api.app.inject({
        method: 'PATCH',
        url: `/api/v1/lists/${list.id}`,
        headers: bearer(token),
        payload: body({ 'item-retention-days': days }),
      });

    expect(expectStatus(await change(21), 422)).toMatchObject({
      code: 'retention_exceeds_consent',
    });
    expect(expectStatus(await change(null), 422)).toMatchObject({
      code: 'retention_exceeds_consent',
    });
    expectStatus(await change(15), 200);
  });

  it('archives once, keeping the first time', async () => {
    const { data } = await created('string');
    const archived = listResourceDocumentSchema.parse(
      expectStatus(await call('DELETE', `/lists/${data.id}`), 200),
    );
    expect(archived.data.attributes.status).toBe('archived');
    expect(archived.data.attributes['archived-at']).not.toBeNull();

    const again = listResourceDocumentSchema.parse(
      expectStatus(await call('DELETE', `/lists/${data.id}`), 200),
    );
    expect(again.data.attributes['archived-at']).toBe(archived.data.attributes['archived-at']);
  });
});
