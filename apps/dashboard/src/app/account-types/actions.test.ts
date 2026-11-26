// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { LIFECYCLE_IDS as IDS, accountType, single } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { createAccountType, updateAccountType } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['accounts:read', 'accounts:write'] });
  api.on('POST', '/account-types', 201, single(accountType('business')));
});

afterEach(() => {
  api.restore();
});

const form = (name: string, schema: string, environmentId: string = ENVIRONMENTS.sandbox.id) => {
  const data = new FormData();
  // The page renders the session environment's id (Workflow 2D F002).
  data.set('environment-id', environmentId);
  data.set('name', name);
  data.set('fields-schema', schema);
  return data;
};

describe('createAccountType', () => {
  it('creates nothing when the session switched environment after the form was rendered (Workflow 2D F002)', async () => {
    const result = await createAccountType(null, form('business', '', ENVIRONMENTS.production.id));

    expect(result).toMatchObject({ ok: false, problem: { title: 'The environment changed' } });
    expect(api.find('POST', '/account-types')).toBeUndefined();
  });

  it('creates the type with its fields schema and refreshes the list', async () => {
    await expect(
      createAccountType(
        null,
        form(' business ', '{ "legal_name": { "type": "string", "label": "Legal name" } }'),
      ),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('POST', '/account-types')?.body).toEqual({
      data: {
        type: 'account-type',
        attributes: {
          name: 'business',
          'fields-schema': { legal_name: { type: 'string', label: 'Legal name' } },
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/account-types');
  });

  it('creates a type without fields when the schema is left empty', async () => {
    await createAccountType(null, form('plain', '  '));

    expect(api.find('POST', '/account-types')?.body).toEqual({
      data: { type: 'account-type', attributes: { name: 'plain' } },
    });
  });

  it('refuses a schema that is not JSON, or a field the contract refuses, by path', async () => {
    await expect(createAccountType(null, form('business', '{'))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/fields-schema' }] },
    });
    await expect(
      createAccountType(null, form('business', '{ "Legal": { "type": "money", "label": "" } }')),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'Check the values you entered' } });
    await expect(createAccountType(null, form('', '{}'))).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: expect.arrayContaining([
          expect.objectContaining({ pointer: '/data/attributes/name' }),
        ]) as unknown,
      },
    });
    expect(api.find('POST', '/account-types')).toBeUndefined();
  });

  it("shows the API's refusal of a name already taken", async () => {
    api.onProblem('POST', '/account-types', 409);

    await expect(createAccountType(null, form('user', '{}'))).resolves.toMatchObject({
      ok: false,
      problem: { status: 409 },
    });
  });

  it('needs accounts:write', async () => {
    api.me({ permissions: ['accounts:read'] });

    await expect(createAccountType(null, form('business', '{}'))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
  });
});

describe('updateAccountType (C25.3)', () => {
  const PATCH = `/account-types/${IDS.accountType}`;
  const SCHEMA = {
    name_first: { type: 'string', label: 'Given name' },
    founded: { type: 'date', label: 'Founded on' },
  } as const;

  beforeEach(() => {
    api.on('PATCH', PATCH, 200, single(accountType('user', IDS.accountType, SCHEMA)));
  });

  const edit = (
    fields: { id?: string; name?: string; schema?: string },
    environmentId: string = ENVIRONMENTS.sandbox.id,
  ) => {
    const data = new FormData();
    // The page renders the session environment's id (Workflow 2D F002).
    data.set('environment-id', environmentId);
    data.set('account-type-id', fields.id ?? IDS.accountType);
    data.set('name', fields.name ?? 'user');
    data.set('fields-schema', fields.schema ?? JSON.stringify(SCHEMA));
    return data;
  };

  it('sends the name and the whole new fields schema, and refreshes the list and the page', async () => {
    await expect(updateAccountType(null, edit({ name: ' user ' }))).resolves.toEqual({
      ok: true,
      data: undefined,
    });

    expect(api.find('PATCH', PATCH)?.body).toEqual({
      data: { type: 'account-type', attributes: { name: 'user', 'fields-schema': SCHEMA } },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/account-types');
    expect(revalidatePath).toHaveBeenCalledWith(`/account-types/${IDS.accountType}`);
  });

  it('sends an empty schema as no fields at all, which removes every key the type had', async () => {
    await updateAccountType(null, edit({ schema: '  ' }));

    expect(api.find('PATCH', PATCH)?.body).toEqual({
      data: { type: 'account-type', attributes: { name: 'user', 'fields-schema': {} } },
    });
  });

  it('changes nothing when the session switched environment after the form was rendered (Workflow 2D F002)', async () => {
    const result = await updateAccountType(null, edit({}, ENVIRONMENTS.production.id));

    expect(result).toMatchObject({ ok: false, problem: { title: 'The environment changed' } });
    expect(api.find('PATCH', PATCH)).toBeUndefined();
  });

  it('refuses a schema that is not JSON, or a malformed id, by path, without calling the API', async () => {
    await expect(updateAccountType(null, edit({ schema: '{' }))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/fields-schema' }] },
    });
    await expect(
      updateAccountType(null, edit({ id: 'acc_01JB0000000000000000000001' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/account-type-id' }] },
    });
    expect(api.find('PATCH', PATCH)).toBeUndefined();
  });

  it("passes on the API's 422 for a removed or retyped key, with the key's pointer", async () => {
    api.onProblem('PATCH', PATCH, 422, undefined, {
      title: 'Unprocessable Content',
      detail: 'An account type change may add fields and change labels only.',
      errors: [
        {
          location: 'body',
          pointer: '/data/attributes/fields-schema/founded',
          detail: 'cannot be removed: accounts may hold values for it',
        },
      ],
    });

    await expect(
      updateAccountType(null, edit({ schema: JSON.stringify({ name_first: SCHEMA.name_first }) })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        status: 422,
        detail: 'An account type change may add fields and change labels only.',
        errors: [
          {
            pointer: '/data/attributes/fields-schema/founded',
            detail: 'cannot be removed: accounts may hold values for it',
          },
        ],
      },
    });
  });

  it('needs accounts:write', async () => {
    api.me({ permissions: ['accounts:read'] });

    await expect(updateAccountType(null, edit({}))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
    expect(api.find('PATCH', PATCH)).toBeUndefined();
  });
});

describe('updateAccountType: the contest route (C128.3)', () => {
  const PATCH = `/account-types/${IDS.accountType}`;
  const edit = (url: string, contact: string) => {
    const data = new FormData();
    data.set('environment-id', ENVIRONMENTS.sandbox.id);
    data.set('account-type-id', IDS.accountType);
    data.set('name', 'user');
    data.set('fields-schema', '');
    data.set('contest-route-shown', 'true');
    data.set('contest-url', url);
    data.set('contest-contact', contact);
    return data;
  };

  beforeEach(() => {
    api.on('PATCH', PATCH, 200, single(accountType('user', IDS.accountType)));
  });

  it('sends the contest route the form shows, or null when both are empty', async () => {
    await updateAccountType(null, edit('', 'appeals@example.com'));
    expect(
      (api.find('PATCH', PATCH)?.body as { data: { attributes: Record<string, unknown> } }).data
        .attributes['contest-route'],
    ).toEqual({ contact: 'appeals@example.com' });

    await updateAccountType(null, edit('', ''));
    expect(
      (api.all('PATCH', PATCH).at(-1)?.body as { data: { attributes: Record<string, unknown> } })
        .data.attributes['contest-route'],
    ).toBeNull();
  });
});
