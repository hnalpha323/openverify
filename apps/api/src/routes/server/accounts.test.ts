/**
 * C13 account routes through the HTTP API: the real accounts and redaction services on
 * PGlite, with the recording event publisher and audit logger of the harness. Every value is
 * synthetic.
 */
import {
  accountDocumentSchema,
  accountListDocumentSchema,
  accountRelationListDocumentSchema,
  type AccountResource,
} from '@openverify/contracts';
import {
  addAccountRelation,
  createAccount as insertAccount,
  createAccountType,
  createInquiry as insertInquiry,
  createInquiryTemplate,
  getAccount,
  getInquiry,
  type Db,
} from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountsService } from '../../services/accounts.js';
import { createRedactionService } from '../../services/redaction.js';
import {
  bearer,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  type TestApi,
} from '../../test-support/harness.js';

let api: TestApi;
let db: Db;

beforeAll(async () => {
  api = await createTestApi((defaults) => ({
    accounts: createAccountsService({ events: defaults.events, ids: defaults.ids }),
    redaction: createRedactionService({
      db: defaults.db,
      storage: defaults.storage,
      events: defaults.events,
      clock: defaults.clock,
      audit: defaults.audit,
    }),
  }));
  db = api.database.db;
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/accounts';
const PROBLEMS = 'https://openverify.dev/problems';

type Attributes = Record<string, unknown>;

/** A POST; without `payload` the request has no body, as a client sends a bare action. */
function post(url: string, payload: unknown, token = api.token) {
  return api.app.inject({
    method: 'POST',
    url,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

function patch(id: string, attributes: Attributes, token = api.token) {
  return api.app.inject({
    method: 'PATCH',
    url: `${BASE}/${id}`,
    headers: bearer(token),
    payload: { data: { type: 'account', attributes } },
  });
}

function get(url: string, token = api.token) {
  return api.app.inject({ url, headers: bearer(token) });
}

function account(response: Awaited<ReturnType<typeof get>>, status = 200): AccountResource {
  return accountDocumentSchema.parse(expectStatus(response, status)).data;
}

async function createAccount(attributes: Attributes = {}, token = api.token) {
  return account(await post(BASE, { data: { type: 'account', attributes } }, token), 201);
}

function action(id: string, name: string, meta?: unknown, token = api.token) {
  return post(`${BASE}/${id}/${name}`, meta === undefined ? undefined : { meta }, token);
}

/** An inquiry of `accountId`, inserted directly (the inquiry routes belong to api-inquiries). */
async function seedInquiry(environmentId: string, accountId: string): Promise<string> {
  const template = await createInquiryTemplate(db, environmentId, {
    id: testId('itmpl'),
    name: 'Synthetic template',
    version: { id: testId('itmplv'), flow: {}, verificationConfig: {} },
  });
  const inquiry = await insertInquiry(db, environmentId, {
    id: testId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.currentVersion.id,
    accountId,
  });
  return inquiry.id;
}

function expectProblem(
  response: Awaited<ReturnType<typeof get>>,
  status: number,
  slug?: string,
): { type: string; detail: string; errors?: { pointer: string }[] } {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  const problem = response.json<{ type: string; detail: string; errors?: { pointer: string }[] }>();
  if (slug !== undefined) {
    expect(problem.type).toBe(`${PROBLEMS}/${slug}`);
  }
  return problem;
}

/** A user session without `pii:view`, and one API key holding only `scopes`. */
const readerWithoutPii = () =>
  api.newUserToken(api.environmentId, { permissions: ['accounts:read', 'accounts:write'] });

describe('POST /api/v1/accounts', () => {
  it('creates an active account of the type user and emits account.created', async () => {
    const response = await post(BASE, {
      data: {
        type: 'account',
        attributes: {
          'reference-id': 'ref-create-1',
          fields: { name_first: 'Jane', birthdate: '1990-01-31' },
          tags: [' vip ', 'VIP', 'returning'],
        },
      },
    });

    const created = account(response, 201);
    expect(response.headers.location).toBe(`${BASE}/${created.id}`);
    expect(created.attributes).toMatchObject({
      'reference-id': 'ref-create-1',
      status: 'active',
      fields: { name_first: 'Jane', birthdate: '1990-01-31' },
      tags: ['vip', 'returning'],
      'consolidated-into': null,
      'redacted-at': null,
    });
    expect(created.relationships.inquiries.data).toEqual([]);
    const types = expectStatus(await get('/api/v1/account-types'), 200);
    const user = (types.data as unknown as { id: string; attributes: { name: string } }[]).find(
      (type) => type.attributes.name === 'user',
    );
    expect(created.relationships['account-type'].data.id).toBe(user?.id);

    const [event] = api.events
      .named('account.created')
      .filter((recorded) => recorded.payload.data.id === created.id);
    expect(event?.environmentId).toBe(api.environmentId);
    expect(event?.payload.data).toEqual(created);
    const [entry] = api.audit
      .withAction('account.created')
      .filter((recorded) => recorded.resourceId === created.id);
    expect(entry).toMatchObject({
      environmentId: api.environmentId,
      organizationId: api.organizationId,
      actor: { type: 'api-key' },
      resourceType: 'account',
    });
    expect(JSON.stringify(entry?.metadata ?? {})).not.toContain('Jane');
  });

  it('creates an account of the given type, validated against its fields schema', async () => {
    const typeId = testId('acctp');
    await createAccountType(db, api.environmentId, {
      id: typeId,
      name: 'business',
      fieldsSchema: {
        company_name: { type: 'string', label: 'Company name' },
        employees: { type: 'number', label: 'Employees' },
        listed: { type: 'boolean', label: 'Listed' },
      },
    });

    const created = await createAccount({
      'account-type-id': typeId,
      fields: { company_name: 'Example Co', employees: 12, listed: false },
    });

    expect(created.relationships['account-type'].data.id).toBe(typeId);
    expect(created.attributes.fields).toEqual({
      company_name: 'Example Co',
      employees: 12,
      listed: false,
    });
  });

  it('answers 422 for fields the type does not define or of the wrong type', async () => {
    const response = await post(BASE, {
      data: {
        type: 'account',
        attributes: { fields: { favourite_colour: 'teal', birthdate: 'not-a-date', name_last: 7 } },
      },
    });

    const problem = expectProblem(response, 422);
    expect(problem.errors?.map((error) => error.pointer).sort()).toEqual([
      '/data/attributes/fields/birthdate',
      '/data/attributes/fields/favourite_colour',
      '/data/attributes/fields/name_last',
    ]);
    expect(response.body).not.toContain('teal');
    expect(response.body).not.toContain('not-a-date');
  });

  it('answers 404 for an account type of another environment', async () => {
    const other = await api.newTenant();
    const typeId = testId('acctp');
    await createAccountType(db, other.environmentId, { id: typeId, name: 'foreign' });

    expectProblem(await post(BASE, { data: { attributes: { 'account-type-id': typeId } } }), 404);
  });

  it('answers 409 for a reference id another account already has', async () => {
    await createAccount({ 'reference-id': 'ref-taken' });

    expectProblem(await post(BASE, { data: { attributes: { 'reference-id': 'ref-taken' } } }), 409);
  });

  it('answers 403 forbidden without accounts:write', async () => {
    const key = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });
    const user = api.newUserToken(api.environmentId, { permissions: ['accounts:read'] });

    expectProblem(await post(BASE, { data: { attributes: {} } }, key), 403, 'forbidden');
    expectProblem(await post(BASE, { data: { attributes: {} } }, user), 403, 'forbidden');
  });

  it('masks the fields for a user without pii:view, but stores them', async () => {
    const created = await createAccount({ fields: { name_first: 'Jane' } }, readerWithoutPii());

    expect(created.attributes.fields).toEqual({ name_first: null });
    expect((await getAccount(db, api.environmentId, created.id))?.fields).toEqual({
      name_first: 'Jane',
    });
    const [entry] = api.audit
      .withAction('account.created')
      .filter((recorded) => recorded.resourceId === created.id);
    expect(entry?.actor.type).toBe('user');
  });
});

describe('GET /api/v1/accounts/:id', () => {
  it('returns the account with its latest inquiries, newest first', async () => {
    const created = await createAccount({ fields: { name_first: 'Jane' } });
    const first = await seedInquiry(api.environmentId, created.id);
    const second = await seedInquiry(api.environmentId, created.id);

    const fetched = account(await get(`${BASE}/${created.id}`));

    expect(fetched.relationships.inquiries.data).toEqual([
      { type: 'inquiry', id: second },
      { type: 'inquiry', id: first },
    ]);
    expect(fetched.attributes.fields).toEqual({ name_first: 'Jane' });
  });

  it('shows fields to a user with pii:view and masks them without it', async () => {
    const created = await createAccount({ fields: { name_first: 'Jane', name_last: 'Sample' } });
    const viewer = api.newUserToken(api.environmentId, {
      permissions: ['accounts:read', 'pii:view'],
    });

    expect(account(await get(`${BASE}/${created.id}`, viewer)).attributes.fields).toEqual({
      name_first: 'Jane',
      name_last: 'Sample',
    });
    expect(
      account(await get(`${BASE}/${created.id}`, readerWithoutPii())).attributes.fields,
    ).toEqual({ name_first: null, name_last: null });
  });

  it("answers 404 for another environment's account", async () => {
    const created = await createAccount();
    const other = await api.newTenant();

    expectProblem(await get(`${BASE}/${created.id}`, other.token), 404);
    expectProblem(await get(`${BASE}/${created.id}`, api.newUserToken(other.environmentId)), 404);
  });

  it('answers 403 forbidden without accounts:read', async () => {
    const created = await createAccount();
    const key = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });

    expectProblem(await get(`${BASE}/${created.id}`, key), 403, 'forbidden');
  });
});

describe('GET /api/v1/accounts', () => {
  it('lists the accounts of the environment newest first, with the C9 filters', async () => {
    const tenant = await api.newTenant();
    const typeId = testId('acctp');
    await createAccountType(db, tenant.environmentId, { id: typeId, name: 'business' });
    const plain = await createAccount({ 'reference-id': 'ref-list-a' }, tenant.token);
    const tagged = await createAccount({ tags: ['VIP'] }, tenant.token);
    const business = await createAccount({ 'account-type-id': typeId }, tenant.token);
    const archived = await createAccount({}, tenant.token);
    expectStatus(await patch(archived.id, { status: 'archived' }, tenant.token), 200);
    const list = async (query = '') =>
      accountListDocumentSchema
        .parse(expectStatus(await get(`${BASE}${query}`, tenant.token), 200))
        .data.map((item) => item.id);

    expect(await list()).toEqual([archived.id, business.id, tagged.id, plain.id]);
    expect(await list('?filter[reference-id]=ref-list-a')).toEqual([plain.id]);
    expect(await list(`?filter[account-type-id]=${typeId}`)).toEqual([business.id]);
    expect(await list('?filter[status]=archived')).toEqual([archived.id]);
    expect(await list('?filter[status]=active,archived')).toHaveLength(4);
    expect(await list('?filter[tag]=vip')).toEqual([tagged.id]);
    expect(
      await list(`?filter[created-at-start]=${encodeURIComponent(plain.attributes['created-at'])}`),
    ).toHaveLength(4);
    expect(
      await list(`?filter[created-at-end]=${encodeURIComponent(plain.attributes['created-at'])}`),
    ).toEqual([]);
  });

  it('pages with the C1 cursor and keeps the filters in links.next', async () => {
    const tenant = await api.newTenant();
    const older = await createAccount({ tags: ['paged'] }, tenant.token);
    const newer = await createAccount({ tags: ['paged'] }, tenant.token);

    const first = accountListDocumentSchema.parse(
      expectStatus(await get(`${BASE}?filter[tag]=paged&page[size]=1`, tenant.token), 200),
    );
    expect(first.data.map((item) => item.id)).toEqual([newer.id]);
    expect(first.links.next).toBe(`${BASE}?filter[tag]=paged&page[after]=${newer.id}&page[size]=1`);
    const second = accountListDocumentSchema.parse(
      expectStatus(await get(first.links.next ?? '', tenant.token), 200),
    );
    expect(second.data.map((item) => item.id)).toEqual([older.id]);
    expect(second.links.next).toBeNull();
  });

  it('masks fields in the list for a user without pii:view', async () => {
    const tenant = await api.newTenant();
    await createAccount({ fields: { name_first: 'Jane' } }, tenant.token);
    const reader = api.newUserToken(tenant.environmentId, { permissions: ['accounts:read'] });

    const listed = accountListDocumentSchema.parse(expectStatus(await get(BASE, reader), 200));

    expect(listed.data.map((item) => item.attributes.fields)).toEqual([{ name_first: null }]);
  });

  it('answers 400 for a cursor that names no account here', async () => {
    expectProblem(await get(`${BASE}?page[after]=${testId('acc')}`), 400);
  });

  it('answers 403 forbidden without accounts:read', async () => {
    const user = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    expectProblem(await get(BASE, user), 403, 'forbidden');
  });
});

describe('PATCH /api/v1/accounts/:id', () => {
  it('merges fields and emits account.updated-fields', async () => {
    const created = await createAccount({ fields: { name_first: 'Jane', name_last: 'Sample' } });

    const updated = account(
      await patch(created.id, { fields: { name_last: 'Example', birthdate: '1991-02-03' } }),
    );

    expect(updated.attributes.fields).toEqual({
      name_first: 'Jane',
      name_last: 'Example',
      birthdate: '1991-02-03',
    });
    const [event] = api.events
      .named('account.updated-fields')
      .filter((recorded) => recorded.payload.data.id === created.id);
    expect(event?.payload.data).toEqual(updated);
    expect(
      api.audit.withAction('account.updated').filter((entry) => entry.resourceId === created.id),
    ).toEqual([
      expect.objectContaining({ metadata: { attributes: ['fields'] }, resourceType: 'account' }),
    ]);
  });

  it('sets and clears the reference id', async () => {
    const created = await createAccount();

    expect(
      account(await patch(created.id, { 'reference-id': 'ref-patched' })).attributes[
        'reference-id'
      ],
    ).toBe('ref-patched');
    expect(
      account(await patch(created.id, { 'reference-id': null })).attributes['reference-id'],
    ).toBeNull();
  });

  it('answers 409 for a reference id another account has', async () => {
    await createAccount({ 'reference-id': 'ref-patch-taken' });
    const created = await createAccount();

    expectProblem(await patch(created.id, { 'reference-id': 'ref-patch-taken' }), 409);
  });

  it('archives and restores the account with the status events', async () => {
    const created = await createAccount();

    const archived = account(await patch(created.id, { status: 'archived' }));
    const restored = account(await patch(created.id, { status: 'active' }));

    expect(archived.attributes.status).toBe('archived');
    expect(restored.attributes.status).toBe('active');
    const about = (name: string) =>
      api.events.named(name).filter((recorded) => recorded.payload.data.id === created.id);
    expect(about('account.status-updated').map((event) => event.payload.meta)).toEqual([
      { from: 'active', to: 'archived' },
      { from: 'archived', to: 'active' },
    ]);
    expect(about('account.archived')).toHaveLength(1);
    expect(about('account.restored')).toHaveLength(1);
    expect(about('account.updated-fields')).toEqual([]);
  });

  it('emits nothing and records nothing when nothing changes', async () => {
    const created = await createAccount({ fields: { name_first: 'Jane' } });
    const before = api.events.events.length;
    const audited = api.audit.entries.length;

    account(await patch(created.id, { fields: { name_first: 'Jane' }, status: 'active' }));

    expect(api.events.events.length).toBe(before);
    expect(api.audit.entries.length).toBe(audited);
  });

  it('answers 422 for a field the type does not define', async () => {
    const created = await createAccount();

    const problem = expectProblem(await patch(created.id, { fields: { shoe_size: 42 } }), 422);
    expect(problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/fields/shoe_size',
    ]);
  });

  it('answers 409 invalid-transition when restoring a consolidated account', async () => {
    const target = await createAccount();
    const source = await createAccount();
    expectStatus(
      await action(target.id, 'consolidate', { 'source-account-ids': [source.id] }),
      200,
    );

    expectProblem(await patch(source.id, { status: 'active' }), 409, 'invalid-transition');
  });

  it('answers 410 redacted when setting fields of a redacted account', async () => {
    const created = await createAccount({ fields: { name_first: 'Jane' } });
    expectStatus(await action(created.id, 'redact'), 200);

    expectProblem(await patch(created.id, { fields: { name_first: 'Jane' } }), 410, 'redacted');
  });

  it("answers 404 for another environment's account and 403 without accounts:write", async () => {
    const created = await createAccount();
    const other = await api.newTenant();
    const reader = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });

    expectProblem(await patch(created.id, { status: 'archived' }, other.token), 404);
    expectProblem(await patch(created.id, { status: 'archived' }, reader), 403, 'forbidden');
  });
});

describe('POST /api/v1/accounts/:id/add-tag, remove-tag and set-tags', () => {
  it('adds a tag once, ignoring case, and emits account.tag-added', async () => {
    const created = await createAccount({ tags: ['vip'] });

    const added = account(await action(created.id, 'add-tag', { 'tag-name': ' Returning ' }));
    const again = account(await action(created.id, 'add-tag', { 'tag-name': 'RETURNING' }));

    expect(added.attributes.tags).toEqual(['vip', 'Returning']);
    expect(again.attributes.tags).toEqual(['vip', 'Returning']);
    const events = api.events
      .named('account.tag-added')
      .filter((recorded) => recorded.payload.data.id === created.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.meta).toEqual({ 'tag-name': 'Returning' });
    expect(
      api.audit.withAction('account.tag-added').filter((entry) => entry.resourceId === created.id),
    ).toHaveLength(1);
  });

  it('removes a tag ignoring case and emits account.tag-removed', async () => {
    const created = await createAccount({ tags: ['vip', 'returning'] });

    const removed = account(await action(created.id, 'remove-tag', { 'tag-name': 'VIP' }));

    expect(removed.attributes.tags).toEqual(['returning']);
    expect(
      api.events
        .named('account.tag-removed')
        .filter((recorded) => recorded.payload.data.id === created.id),
    ).toHaveLength(1);
  });

  it('replaces the tags and emits account.updated-tags', async () => {
    const created = await createAccount({ tags: ['vip'] });

    const replaced = account(
      await action(created.id, 'set-tags', { 'tag-names': ['a', 'A', 'b'] }),
    );

    expect(replaced.attributes.tags).toEqual(['a', 'b']);
    expect(
      api.events
        .named('account.updated-tags')
        .filter((recorded) => recorded.payload.data.id === created.id),
    ).toHaveLength(1);
  });

  it('answers 422 for a 51st tag', async () => {
    const created = await createAccount({
      tags: Array.from({ length: 50 }, (_, index) => `tag-${String(index)}`),
    });

    expectProblem(await action(created.id, 'add-tag', { 'tag-name': 'one-too-many' }), 422);
  });

  it('answers 400 for an invalid tag', async () => {
    const created = await createAccount();

    expectProblem(await action(created.id, 'add-tag', { 'tag-name': 'no,commas' }), 400);
  });

  it("answers 404 for another environment's account and 403 without accounts:write", async () => {
    const created = await createAccount();
    const other = await api.newTenant();
    const reader = api.newUserToken(api.environmentId, { permissions: ['accounts:read'] });

    for (const name of ['add-tag', 'remove-tag']) {
      expectProblem(await action(created.id, name, { 'tag-name': 'x' }, other.token), 404);
      expectProblem(await action(created.id, name, { 'tag-name': 'x' }, reader), 403, 'forbidden');
    }
    expectProblem(await action(created.id, 'set-tags', { 'tag-names': [] }, other.token), 404);
    expectProblem(
      await action(created.id, 'set-tags', { 'tag-names': [] }, reader),
      403,
      'forbidden',
    );
  });
});

describe('account relations', () => {
  it('adds a directed relation once and lists it from both sides', async () => {
    const from = await createAccount();
    const to = await createAccount();
    const meta = { 'related-account-id': to.id, 'relation-type': 'spouse' };

    expect(account(await action(from.id, 'add-relation', meta)).id).toBe(from.id);
    expectStatus(await action(from.id, 'add-relation', meta), 200);

    const outgoing = accountRelationListDocumentSchema.parse(
      expectStatus(await get(`${BASE}/${from.id}/relations`), 200),
    );
    const incoming = accountRelationListDocumentSchema.parse(
      expectStatus(await get(`${BASE}/${to.id}/relations`), 200),
    );
    expect(outgoing.data).toEqual([
      expect.objectContaining({
        direction: 'outgoing',
        'relation-type': 'spouse',
        'related-account': { type: 'account', id: to.id },
      }),
    ]);
    expect(incoming.data).toEqual([
      expect.objectContaining({
        direction: 'incoming',
        'relation-type': 'spouse',
        'related-account': { type: 'account', id: from.id },
      }),
    ]);
    const events = api.events
      .named('account.added-relation')
      .filter((recorded) => recorded.payload.data.id === from.id);
    expect(events.map((event) => event.payload.meta)).toEqual([
      { 'related-account-id': to.id, 'relation-type': 'spouse' },
    ]);
    expect(
      api.audit
        .withAction('account.added-relation')
        .filter((entry) => entry.resourceId === from.id),
    ).toHaveLength(1);
  });

  it('removes a relation once and emits account.removed-relation', async () => {
    const from = await createAccount();
    const to = await createAccount();
    const meta = { 'related-account-id': to.id, 'relation-type': 'business_owner' };
    expectStatus(await action(from.id, 'add-relation', meta), 200);

    expectStatus(await action(from.id, 'remove-relation', meta), 200);
    expectStatus(await action(from.id, 'remove-relation', meta), 200);

    expect(
      accountRelationListDocumentSchema.parse(
        expectStatus(await get(`${BASE}/${from.id}/relations`), 200),
      ).data,
    ).toEqual([]);
    expect(
      api.events
        .named('account.removed-relation')
        .filter((recorded) => recorded.payload.data.id === from.id),
    ).toHaveLength(1);
  });

  it('answers 422 for a relation of an account to itself', async () => {
    const created = await createAccount();

    expectProblem(
      await action(created.id, 'add-relation', {
        'related-account-id': created.id,
        'relation-type': 'spouse',
      }),
      422,
    );
  });

  it('answers 400 for a relation type outside the pattern', async () => {
    const from = await createAccount();
    const to = await createAccount();

    expectProblem(
      await action(from.id, 'add-relation', {
        'related-account-id': to.id,
        'relation-type': 'Spouse',
      }),
      400,
    );
  });

  it("answers 404 when either account is another environment's", async () => {
    const mine = await createAccount();
    const other = await api.newTenant();
    const theirs = await createAccount({}, other.token);
    const meta = (id: string) => ({ 'related-account-id': id, 'relation-type': 'spouse' });

    expectProblem(await action(mine.id, 'add-relation', meta(theirs.id)), 404);
    expectProblem(await action(theirs.id, 'add-relation', meta(mine.id)), 404);
    expectProblem(await action(mine.id, 'remove-relation', meta(theirs.id)), 404);
    expectProblem(await get(`${BASE}/${theirs.id}/relations`), 404);
  });

  it('answers 409 invalid-transition for a consolidated account', async () => {
    const target = await createAccount();
    const source = await createAccount();
    const other = await createAccount();
    expectStatus(
      await action(target.id, 'consolidate', { 'source-account-ids': [source.id] }),
      200,
    );

    expectProblem(
      await action(source.id, 'add-relation', {
        'related-account-id': other.id,
        'relation-type': 'spouse',
      }),
      409,
      'invalid-transition',
    );
  });

  it('answers 403 forbidden without the permissions', async () => {
    const from = await createAccount();
    const to = await createAccount();
    const meta = { 'related-account-id': to.id, 'relation-type': 'spouse' };
    const reader = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });
    const writer = await api.newApiKey(api.environmentId, { scopes: ['accounts:write'] });

    expectProblem(await action(from.id, 'add-relation', meta, reader), 403, 'forbidden');
    expectProblem(await action(from.id, 'remove-relation', meta, reader), 403, 'forbidden');
    expectProblem(await get(`${BASE}/${from.id}/relations`, writer), 403, 'forbidden');
  });
});

describe('POST /api/v1/accounts/:id/consolidate', () => {
  it('merges the sources into the target in one step (C13)', async () => {
    const target = await createAccount({
      'reference-id': 'ref-target',
      fields: { name_first: 'Jane', birthdate: '1990-01-31' },
      tags: ['vip'],
    });
    const source1 = await createAccount({
      fields: { name_first: 'Janet', name_last: 'Sample' },
      tags: ['VIP', 'returning'],
    });
    const source2 = await createAccount({ fields: { phone_number: '+15550100' } });
    const outsider = await createAccount();
    const parent = await createAccount();
    const targetInquiry = await seedInquiry(api.environmentId, target.id);
    const sourceInquiry1 = await seedInquiry(api.environmentId, source1.id);
    const sourceInquiry2 = await seedInquiry(api.environmentId, source2.id);
    const relate = (from: string, to: string, relationType: string) =>
      addAccountRelation(db, api.environmentId, {
        fromAccountId: from,
        toAccountId: to,
        relationType,
      });
    await relate(source1.id, outsider.id, 'spouse');
    await relate(target.id, outsider.id, 'spouse');
    await relate(source2.id, target.id, 'business_owner');
    await relate(parent.id, source1.id, 'parent');

    const merged = account(
      await action(target.id, 'consolidate', {
        'source-account-ids': [source1.id, source2.id],
      }),
    );

    expect(merged.attributes).toMatchObject({
      'reference-id': 'ref-target',
      status: 'active',
      fields: {
        name_first: 'Jane',
        birthdate: '1990-01-31',
        name_last: 'Sample',
        phone_number: '+15550100',
      },
      tags: ['vip', 'returning'],
      'consolidated-into': null,
    });
    expect(merged.relationships.inquiries.data.map((ref) => ref.id).sort()).toEqual(
      [targetInquiry, sourceInquiry1, sourceInquiry2].sort(),
    );
    for (const source of [source1, source2]) {
      expect(account(await get(`${BASE}/${source.id}`)).attributes).toMatchObject({
        status: 'archived',
        'consolidated-into': target.id,
      });
    }
    const relations = accountRelationListDocumentSchema.parse(
      expectStatus(await get(`${BASE}/${target.id}/relations`), 200),
    ).data;
    expect(
      relations
        .map(
          (relation) =>
            `${relation.direction}:${relation['relation-type']}:${relation['related-account'].id}`,
        )
        .sort(),
    ).toEqual([`incoming:parent:${parent.id}`, `outgoing:spouse:${outsider.id}`].sort());

    const [consolidated] = api.events
      .named('account.consolidated')
      .filter((recorded) => recorded.payload.data.id === target.id);
    expect(consolidated?.payload.data).toEqual(merged);
    expect(consolidated?.payload.included?.map((resource) => resource.id)).toEqual([
      source1.id,
      source2.id,
    ]);
    expect(consolidated?.payload.meta).toEqual({
      'source-account-ids': [source1.id, source2.id],
    });
    const consolidatedWith = api.events
      .named('account.consolidated-with')
      .filter((recorded) => [source1.id, source2.id].includes(recorded.payload.data.id));
    expect(consolidatedWith.map((event) => event.payload.data.id)).toEqual([
      source1.id,
      source2.id,
    ]);
    expect(consolidatedWith.map((event) => event.payload.meta)).toEqual([
      { 'consolidated-into': target.id },
      { 'consolidated-into': target.id },
    ]);
    expect(
      api.audit
        .withAction('account.consolidated')
        .filter((entry) => entry.resourceId === target.id),
    ).toEqual([
      expect.objectContaining({
        metadata: { 'source-account-ids': [source1.id, source2.id], 'moved-inquiry-count': 2 },
      }),
    ]);
    expect(
      api.audit
        .withAction('account.consolidated-with')
        .map((entry) => entry.resourceId)
        .filter((id) => [source1.id, source2.id].includes(id)),
    ).toEqual([source1.id, source2.id]);
  });

  it('answers 422 when the target is among the sources', async () => {
    const target = await createAccount();

    expectProblem(
      await action(target.id, 'consolidate', { 'source-account-ids': [target.id] }),
      422,
    );
  });

  it('answers 422 when a source has fields the target type does not define', async () => {
    const typeId = testId('acctp');
    await createAccountType(db, api.environmentId, {
      id: typeId,
      name: `business-${typeId}`,
      fieldsSchema: { company_name: { type: 'string', label: 'Company name' } },
    });
    const target = await createAccount();
    const source = await createAccount({
      'account-type-id': typeId,
      fields: { company_name: 'Example Co' },
    });

    expectProblem(
      await action(target.id, 'consolidate', { 'source-account-ids': [source.id] }),
      422,
    );
    expect(account(await get(`${BASE}/${source.id}`)).attributes.status).toBe('active');
  });

  it('answers 409 invalid-transition for an archived target or an already consolidated source', async () => {
    const target = await createAccount();
    const archived = await createAccount();
    const source = await createAccount();
    expectStatus(await patch(archived.id, { status: 'archived' }), 200);
    expectStatus(
      await action(target.id, 'consolidate', { 'source-account-ids': [source.id] }),
      200,
    );
    const another = await createAccount();

    expectProblem(
      await action(archived.id, 'consolidate', { 'source-account-ids': [another.id] }),
      409,
      'invalid-transition',
    );
    expectProblem(
      await action(another.id, 'consolidate', { 'source-account-ids': [source.id] }),
      409,
      'invalid-transition',
    );
  });

  it('answers 410 redacted for a redacted target', async () => {
    const target = await createAccount();
    const source = await createAccount({ fields: { name_first: 'Jane' } });
    expectStatus(await action(target.id, 'redact'), 200);

    expectProblem(
      await action(target.id, 'consolidate', { 'source-account-ids': [source.id] }),
      410,
      'redacted',
    );
  });

  it("answers 404 for another environment's target or source", async () => {
    const mine = await createAccount();
    const other = await api.newTenant();
    const theirs = await createAccount({}, other.token);

    expectProblem(await action(mine.id, 'consolidate', { 'source-account-ids': [theirs.id] }), 404);
    expectProblem(await action(theirs.id, 'consolidate', { 'source-account-ids': [mine.id] }), 404);
  });

  it('answers 400 for no source or more than ten', async () => {
    const target = await createAccount();

    expectProblem(await action(target.id, 'consolidate', { 'source-account-ids': [] }), 400);
    expectProblem(
      await action(target.id, 'consolidate', {
        'source-account-ids': Array.from({ length: 11 }, () => testId('acc')),
      }),
      400,
    );
  });

  it('answers 403 forbidden without accounts:write', async () => {
    const target = await createAccount();
    const source = await createAccount();
    const reader = api.newUserToken(api.environmentId, { permissions: ['accounts:read'] });

    expectProblem(
      await action(target.id, 'consolidate', { 'source-account-ids': [source.id] }, reader),
      403,
      'forbidden',
    );
  });
});

describe('POST /api/v1/accounts/:id/add-objects and remove-objects', () => {
  it('links inquiries to the account', async () => {
    const from = await createAccount();
    const to = await createAccount();
    const inquiryId = await seedInquiry(api.environmentId, from.id);

    const linked = account(
      await action(to.id, 'add-objects', { objects: [{ type: 'inquiry', id: inquiryId }] }),
    );

    expect(linked.relationships.inquiries.data).toEqual([{ type: 'inquiry', id: inquiryId }]);
    expect(account(await get(`${BASE}/${from.id}`)).relationships.inquiries.data).toEqual([]);
    expect(
      api.audit.withAction('account.added-objects').filter((entry) => entry.resourceId === to.id),
    ).toEqual([expect.objectContaining({ metadata: { 'inquiry-ids': [inquiryId] } })]);
  });

  it('unlinks inquiries into a new account of their own', async () => {
    const owner = await createAccount();
    const inquiryId = await seedInquiry(api.environmentId, owner.id);

    const unlinked = account(
      await action(owner.id, 'remove-objects', { objects: [{ type: 'inquiry', id: inquiryId }] }),
    );

    expect(unlinked.relationships.inquiries.data).toEqual([]);
    const moved = await getInquiry(db, api.environmentId, inquiryId);
    expect(moved?.accountId).not.toBe(owner.id);
    const fresh = await getAccount(db, api.environmentId, moved?.accountId ?? '');
    expect(fresh).toMatchObject({ status: 'active', referenceId: null });
    expect(
      api.events
        .named('account.created')
        .filter((recorded) => recorded.payload.data.id === fresh?.id),
    ).toHaveLength(1);
    expect(
      api.audit
        .withAction('account.removed-objects')
        .filter((entry) => entry.resourceId === owner.id),
    ).toEqual([expect.objectContaining({ metadata: { 'inquiry-ids': [inquiryId] } })]);
  });

  it('answers 422 for an inquiry that is not linked to the account', async () => {
    const owner = await createAccount();
    const stranger = await createAccount();
    const inquiryId = await seedInquiry(api.environmentId, stranger.id);

    expectProblem(
      await action(owner.id, 'remove-objects', { objects: [{ type: 'inquiry', id: inquiryId }] }),
      422,
    );
  });

  it("answers 404 for another environment's inquiry or account", async () => {
    const mine = await createAccount();
    const other = await api.newTenant();
    const theirs = await createAccount({}, other.token);
    const theirInquiry = await seedInquiry(other.environmentId, theirs.id);
    const myInquiry = await seedInquiry(api.environmentId, mine.id);
    const objects = (id: string) => ({ objects: [{ type: 'inquiry', id }] });

    expectProblem(await action(mine.id, 'add-objects', objects(theirInquiry)), 404);
    expectProblem(await action(mine.id, 'remove-objects', objects(theirInquiry)), 404);
    expectProblem(await action(theirs.id, 'add-objects', objects(myInquiry)), 404);
    expect((await getInquiry(db, other.environmentId, theirInquiry))?.accountId).toBe(theirs.id);
  });

  it('answers 409 invalid-transition when linking to a consolidated account', async () => {
    const target = await createAccount();
    const source = await createAccount();
    const inquiryId = await seedInquiry(api.environmentId, target.id);
    expectStatus(
      await action(target.id, 'consolidate', { 'source-account-ids': [source.id] }),
      200,
    );

    expectProblem(
      await action(source.id, 'add-objects', { objects: [{ type: 'inquiry', id: inquiryId }] }),
      409,
      'invalid-transition',
    );
  });

  it('answers 403 forbidden without accounts:write', async () => {
    const owner = await createAccount();
    const inquiryId = await seedInquiry(api.environmentId, owner.id);
    const reader = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });
    const objects = { objects: [{ type: 'inquiry', id: inquiryId }] };

    expectProblem(await action(owner.id, 'add-objects', objects, reader), 403, 'forbidden');
    expectProblem(await action(owner.id, 'remove-objects', objects, reader), 403, 'forbidden');
  });
});

describe('POST /api/v1/accounts/:id/redact', () => {
  it('redacts the account and answers with it (C16)', async () => {
    const created = await createAccount({ fields: { name_first: 'Jane' }, tags: ['vip'] });

    const redacted = account(await action(created.id, 'redact'));

    expect(redacted.attributes.fields).toEqual({});
    expect(redacted.attributes['redacted-at']).toBe(api.clock.now().toISOString());
    expect(
      api.events
        .named('account.redacted')
        .filter((recorded) => recorded.payload.data.id === created.id),
    ).toHaveLength(1);
    const entries = api.audit
      .withAction('account.redacted')
      .filter((entry) => entry.resourceId === created.id);
    expect(entries.map((entry) => entry.actor.type)).toEqual(['api-key']);
  });

  it('is idempotent', async () => {
    const created = await createAccount({ fields: { name_first: 'Jane' } });
    const first = account(await action(created.id, 'redact'));
    api.clock.advance(60_000);

    const second = account(await action(created.id, 'redact', {}));

    expect(second.attributes['redacted-at']).toBe(first.attributes['redacted-at']);
    expect(
      api.events
        .named('account.redacted')
        .filter((recorded) => recorded.payload.data.id === created.id),
    ).toHaveLength(1);
  });

  it('needs accounts:redact, not just accounts:write', async () => {
    const created = await createAccount();
    const writer = await api.newApiKey(api.environmentId, { scopes: ['accounts:write'] });
    const user = api.newUserToken(api.environmentId, {
      permissions: ['accounts:read', 'accounts:write'],
    });

    expectProblem(await action(created.id, 'redact', undefined, writer), 403, 'forbidden');
    expectProblem(await action(created.id, 'redact', undefined, user), 403, 'forbidden');
  });

  it("answers 404 for another environment's account", async () => {
    const created = await createAccount();
    const other = await api.newTenant();

    expectProblem(await action(created.id, 'redact', undefined, other.token), 404);
    expect((await getAccount(db, api.environmentId, created.id))?.redactedAt).toBeNull();
  });

  it('accepts accounts created by the repository with no fields', async () => {
    const created = await insertAccount(db, api.environmentId, { id: testId('acc') });

    expect(account(await action(created.id, 'redact')).attributes.fields).toEqual({});
  });
});
