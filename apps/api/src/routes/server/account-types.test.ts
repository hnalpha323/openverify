/** C13 account type routes through the HTTP API, on PGlite. Every value is synthetic. */
import {
  accountTypeDocumentSchema,
  accountTypeListDocumentSchema,
  type AccountTypeResource,
} from '@openverify/contracts';
import { testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA } from '../../services/accounts.js';
import {
  bearer,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  type TestApi,
} from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/account-types';

function create(attributes: Record<string, unknown>, token = api.token) {
  return api.app.inject({
    method: 'POST',
    url: BASE,
    headers: bearer(token),
    payload: { data: { type: 'account-type', attributes } },
  });
}

function get(url: string, token = api.token) {
  return api.app.inject({ url, headers: bearer(token) });
}

function accountType(response: Awaited<ReturnType<typeof get>>, status = 200): AccountTypeResource {
  return accountTypeDocumentSchema.parse(expectStatus(response, status)).data;
}

function expectProblem(response: Awaited<ReturnType<typeof get>>, status: number, slug?: string) {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  if (slug !== undefined) {
    expect(response.json<{ type: string }>().type).toBe(`https://openverify.dev/problems/${slug}`);
  }
}

const BUSINESS_FIELDS = {
  company_name: { type: 'string', label: 'Company name' },
  incorporated_on: { type: 'date', label: 'Incorporation date' },
};

describe('POST /api/v1/account-types', () => {
  it('creates a type with its fields schema and records an audit entry', async () => {
    const response = await create({ name: 'business', 'fields-schema': BUSINESS_FIELDS });

    const created = accountType(response, 201);
    expect(response.headers.location).toBe(`${BASE}/${created.id}`);
    expect(created.attributes).toMatchObject({
      name: 'business',
      'fields-schema': BUSINESS_FIELDS,
    });
    const entries = api.audit
      .withAction('account-type.created')
      .filter((entry) => entry.resourceId === created.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      resourceType: 'account-type',
      environmentId: api.environmentId,
      actor: { type: 'api-key' },
    });
  });

  it('defaults the fields schema to none', async () => {
    expect(
      accountType(await create({ name: 'no-fields' }), 201).attributes['fields-schema'],
    ).toEqual({});
  });

  it('answers 409 for a name the environment already has', async () => {
    accountType(await create({ name: 'duplicate' }), 201);

    expectProblem(await create({ name: 'duplicate' }), 409);
    expectProblem(await create({ name: 'user' }), 409);
  });

  it('allows the same name in another environment', async () => {
    const other = await api.newTenant();

    accountType(await create({ name: 'shared-name' }), 201);
    accountType(await create({ name: 'shared-name' }, other.token), 201);
  });

  it('answers 400 for a fields schema with more than 100 keys or a bad key', async () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `field_${String(index)}`,
        { type: 'string', label: 'Field' },
      ]),
    );

    expectProblem(await create({ name: 'too-many', 'fields-schema': tooMany }), 400);
    expectProblem(
      await create({
        name: 'bad-key',
        'fields-schema': { 'Bad Key': { type: 'string', label: 'x' } },
      }),
      400,
    );
  });

  it('answers 403 forbidden without accounts:write', async () => {
    const reader = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });
    const user = api.newUserToken(api.environmentId, { permissions: ['accounts:read'] });

    expectProblem(await create({ name: 'forbidden' }, reader), 403, 'forbidden');
    expectProblem(await create({ name: 'forbidden' }, user), 403, 'forbidden');
  });
});

describe('GET /api/v1/account-types', () => {
  it('lists the seeded type user with its default fields schema', async () => {
    const tenant = await api.newTenant();

    const listed = accountTypeListDocumentSchema.parse(
      expectStatus(await get(BASE, tenant.token), 200),
    );

    expect(listed.data.map((type) => type.attributes.name)).toEqual(['user']);
    expect(listed.data[0]?.attributes['fields-schema']).toEqual(DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA);
    expect(listed.links.next).toBeNull();
  });

  it('lists only the types of the environment, newest first, with the C1 cursor', async () => {
    const tenant = await api.newTenant();
    const first = accountType(await create({ name: 'first' }, tenant.token), 201);
    const second = accountType(await create({ name: 'second' }, tenant.token), 201);

    const page = accountTypeListDocumentSchema.parse(
      expectStatus(await get(`${BASE}?page[size]=2`, tenant.token), 200),
    );
    expect(page.data.map((type) => type.id)).toEqual([second.id, first.id]);
    expect(page.links.next).toBe(`${BASE}?page[after]=${first.id}&page[size]=2`);
    const rest = accountTypeListDocumentSchema.parse(
      expectStatus(await get(page.links.next ?? '', tenant.token), 200),
    );
    expect(rest.data.map((type) => type.attributes.name)).toEqual(['user']);
  });

  it('answers 400 for a cursor that names no type here', async () => {
    expectProblem(await get(`${BASE}?page[after]=${testId('acctp')}`), 400);
  });

  it('answers 403 forbidden without accounts:read', async () => {
    const user = api.newUserToken(api.environmentId, { permissions: ['accounts:write'] });

    expectProblem(await get(BASE, user), 403, 'forbidden');
  });
});

describe('GET /api/v1/account-types/:id', () => {
  it('returns the type', async () => {
    const created = accountType(
      await create({ name: 'fetched', 'fields-schema': BUSINESS_FIELDS }),
      201,
    );

    expect(accountType(await get(`${BASE}/${created.id}`))).toEqual(created);
  });

  it("answers 404 for another environment's type or an unknown one", async () => {
    const created = accountType(await create({ name: 'private' }), 201);
    const other = await api.newTenant();

    expectProblem(await get(`${BASE}/${created.id}`, other.token), 404);
    expectProblem(await get(`${BASE}/${testId('acctp')}`), 404);
  });

  it('answers 403 forbidden without accounts:read', async () => {
    const created = accountType(await create({ name: 'guarded' }), 201);
    const key = await api.newApiKey(api.environmentId, { scopes: ['accounts:write'] });

    expectProblem(await get(`${BASE}/${created.id}`, key), 403, 'forbidden');
  });
});

describe('PATCH /api/v1/account-types/:id (C25.3, Workflow 2E)', () => {
  function patch(id: string, attributes: Record<string, unknown>, token = api.token) {
    return api.app.inject({
      method: 'PATCH',
      url: `${BASE}/${id}`,
      headers: bearer(token),
      payload: { data: { type: 'account-type', attributes } },
    });
  }

  function pointers(response: Awaited<ReturnType<typeof get>>): string[] {
    return (
      response.json<{ errors?: { pointer: string }[] }>().errors?.map(({ pointer }) => pointer) ??
      []
    );
  }

  async function userType(token = api.token): Promise<AccountTypeResource> {
    const listed = accountTypeListDocumentSchema.parse(expectStatus(await get(BASE, token), 200));
    const found = listed.data.find((type) => type.attributes.name === 'user');
    if (found === undefined) {
      throw new Error('the environment has no type user');
    }
    return found;
  }

  it('renames a type and records an audit entry', async () => {
    const created = accountType(await create({ name: 'to-rename' }), 201);

    const renamed = accountType(await patch(created.id, { name: 'renamed' }));

    expect(renamed).toMatchObject({ id: created.id, attributes: { name: 'renamed' } });
    expect(accountType(await get(`${BASE}/${created.id}`)).attributes.name).toBe('renamed');
    const entries = api.audit
      .withAction('account-type.updated')
      .filter((entry) => entry.resourceId === created.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      resourceType: 'account-type',
      environmentId: api.environmentId,
      metadata: { attributes: ['name'] },
    });
  });

  it('adds keys and changes labels', async () => {
    const created = accountType(
      await create({ name: 'additive', 'fields-schema': BUSINESS_FIELDS }),
      201,
    );
    const next = {
      ...BUSINESS_FIELDS,
      company_name: { type: 'string', label: 'Registered company name' },
      employee_count: { type: 'number', label: 'Employees' },
    };

    const changed = accountType(await patch(created.id, { 'fields-schema': next }));

    expect(changed.attributes['fields-schema']).toEqual(next);
  });

  it('answers 422 with a pointer to each key a change removes or retypes', async () => {
    const created = accountType(
      await create({ name: 'guarded-fields', 'fields-schema': BUSINESS_FIELDS }),
      201,
    );

    const removed = await patch(created.id, {
      'fields-schema': { company_name: BUSINESS_FIELDS.company_name },
    });
    const retyped = await patch(created.id, {
      'fields-schema': {
        ...BUSINESS_FIELDS,
        incorporated_on: { type: 'string', label: 'Incorporation date' },
      },
    });

    expectProblem(removed, 422);
    expect(pointers(removed)).toEqual(['/data/attributes/fields-schema/incorporated_on']);
    expectProblem(retyped, 422);
    expect(pointers(retyped)).toEqual(['/data/attributes/fields-schema/incorporated_on']);
    expect(accountType(await get(`${BASE}/${created.id}`)).attributes['fields-schema']).toEqual(
      BUSINESS_FIELDS,
    );
  });

  it('holds the seeded type user to the same rule, and keeps its name', async () => {
    const tenant = await api.newTenant();
    const user = await userType(tenant.token);

    const added = accountType(
      await patch(
        user.id,
        {
          'fields-schema': {
            ...DEFAULT_USER_ACCOUNT_FIELDS_SCHEMA,
            nationality: { type: 'string', label: 'Nationality' },
          },
        },
        tenant.token,
      ),
    );
    const withoutFirstName = Object.fromEntries(
      Object.entries(added.attributes['fields-schema']).filter(([key]) => key !== 'name_first'),
    );
    const removed = await patch(user.id, { 'fields-schema': withoutFirstName }, tenant.token);
    const renamed = await patch(user.id, { name: 'customer' }, tenant.token);

    expect(added.attributes['fields-schema']).toMatchObject({
      nationality: { type: 'string', label: 'Nationality' },
    });
    expectProblem(removed, 422);
    expect(pointers(removed)).toEqual(['/data/attributes/fields-schema/name_first']);
    expectProblem(renamed, 422);
    expect(pointers(renamed)).toEqual(['/data/attributes/name']);
    expect((await userType(tenant.token)).attributes.name).toBe('user');
  });

  it('answers 409 for a name the environment already has, as create does', async () => {
    const created = accountType(await create({ name: 'unique-a' }), 201);
    accountType(await create({ name: 'unique-b' }), 201);

    expectProblem(await patch(created.id, { name: 'unique-b' }), 409);
    expectProblem(await patch(created.id, { name: 'user' }), 409);
    expect(accountType(await patch(created.id, { name: 'unique-a' })).attributes.name).toBe(
      'unique-a',
    );
  });

  it("answers 404 for another environment's type or an unknown one", async () => {
    const created = accountType(await create({ name: 'not-yours' }), 201);
    const other = await api.newTenant();

    expectProblem(await patch(created.id, { name: 'taken-over' }, other.token), 404);
    expectProblem(await patch(testId('acctp'), { name: 'nobody' }), 404);
    expect(accountType(await get(`${BASE}/${created.id}`)).attributes.name).toBe('not-yours');
  });

  it('answers 400 for an empty change, a bad key or more than 100 keys', async () => {
    const created = accountType(await create({ name: 'validated' }), 201);
    const tooMany = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `field_${String(index)}`,
        { type: 'string', label: 'Field' },
      ]),
    );

    expectProblem(await patch(created.id, {}), 400);
    expectProblem(
      await patch(created.id, { 'fields-schema': { 'Bad Key': { type: 'string', label: 'x' } } }),
      400,
    );
    expectProblem(await patch(created.id, { 'fields-schema': tooMany }), 400);
  });

  it('answers 403 forbidden without accounts:write', async () => {
    const created = accountType(await create({ name: 'read-only' }), 201);
    const reader = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });
    const user = api.newUserToken(api.environmentId, { permissions: ['accounts:read'] });

    expectProblem(await patch(created.id, { name: 'nope' }, reader), 403, 'forbidden');
    expectProblem(await patch(created.id, { name: 'nope' }, user), 403, 'forbidden');
  });
});
