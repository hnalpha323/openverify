// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { WORKFLOW_SECRETS_PATH } from '../../testing/routes/workflows';
import { SECRET_ENVIRONMENT_ID as ENV, workflowSecret } from '../../testing/workflow-fixtures';
import { createSecret, deleteSecret, setSecretValue, updateSecret } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  vi.mocked(revalidatePath).mockClear();
});

afterEach(() => {
  api.restore();
});

const as = (...permissions: Permission[]) => api.me({ permissions });
const formOf = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};
/** A canary, never a real credential. */
const CANARY = 'canary-not-a-real-secret-0001';

describe('createSecret (C125.1)', () => {
  it('creates the key with its description and one host per line', async () => {
    as('secrets:read', 'secrets:write');
    api.on('POST', WORKFLOW_SECRETS_PATH, 201, { data: workflowSecret() });

    const result = await createSecret(
      null,
      formOf({
        'environment-id': ENV,
        key: 'slack_token',
        description: 'Synthetic token',
        'allowed-hosts': 'hooks.example.com\n api.example.org ,\n',
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', WORKFLOW_SECRETS_PATH)?.body).toEqual({
      data: {
        type: 'workflow-secret',
        attributes: {
          key: 'slack_token',
          description: 'Synthetic token',
          'allowed-hosts': ['hooks.example.com', 'api.example.org'],
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/secrets');
  });

  it('refuses a key that is not snake_case, by its pointer, without calling the API', async () => {
    as('secrets:read', 'secrets:write');

    const result = await createSecret(
      null,
      formOf({ 'environment-id': ENV, key: 'Slack-Token', 'allowed-hosts': 'hooks.example.com' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toContain(
      '/data/attributes/key',
    );
    expect(api.find('POST', WORKFLOW_SECRETS_PATH)).toBeUndefined();
  });

  it('needs secrets:write', async () => {
    as('secrets:read');

    const result = await createSecret(
      null,
      formOf({ 'environment-id': ENV, key: 'slack_token', 'allowed-hosts': 'hooks.example.com' }),
    );

    expect(result).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('setSecretValue (C125.2)', () => {
  const VALUES = `${WORKFLOW_SECRETS_PATH}/slack_token/values/${ENV}`;

  it('sets the value in the session’s environment', async () => {
    as('secrets:read', 'secrets:write');
    api.on('PUT', VALUES, 200, { data: workflowSecret() });

    const result = await setSecretValue(
      null,
      formOf({ key: 'slack_token', mode: 'set', 'secret-value': CANARY }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PUT', VALUES)?.body).toEqual({
      data: { attributes: { 'secret-value': CANARY } },
    });
  });

  it('rotates the value, keeping the previous one for a signing secret', async () => {
    as('secrets:read', 'secrets:write');
    api.on('POST', `${VALUES}/rotate`, 200, { data: workflowSecret() });

    const result = await setSecretValue(
      null,
      formOf({ key: 'slack_token', mode: 'rotate', 'secret-value': CANARY }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', `${VALUES}/rotate`)?.body).toEqual({
      data: { attributes: { 'secret-value': CANARY } },
    });
  });

  it('refuses an empty value at its pointer, without calling the API', async () => {
    as('secrets:read', 'secrets:write');

    const result = await setSecretValue(
      null,
      formOf({ key: 'slack_token', mode: 'set', 'secret-value': '' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/secret-value',
    ]);
    expect(api.find('PUT', VALUES)).toBeUndefined();
  });

  it('refuses a value with a line break, without echoing it', async () => {
    as('secrets:read', 'secrets:write');

    const result = await setSecretValue(
      null,
      formOf({ key: 'slack_token', mode: 'set', 'secret-value': `${CANARY}\nx` }),
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(CANARY);
  });
});

describe('deleteSecret (C125.1)', () => {
  it('deletes the key', async () => {
    as('secrets:read', 'secrets:write');
    api.on('DELETE', `${WORKFLOW_SECRETS_PATH}/slack_token`, 200, { data: workflowSecret() });

    const result = await deleteSecret(null, formOf({ key: 'slack_token' }));

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('DELETE', `${WORKFLOW_SECRETS_PATH}/slack_token`)).toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith('/secrets');
  });

  it('passes on the refusal of a key a published version still names', async () => {
    as('secrets:read', 'secrets:write');
    api.onProblem('DELETE', `${WORKFLOW_SECRETS_PATH}/slack_token`, 409, undefined, {
      code: 'secret_in_use',
      detail: 'A published version references this secret.',
    });

    const result = await deleteSecret(null, formOf({ key: 'slack_token' }));

    expect(result).toMatchObject({
      ok: false,
      problem: { code: 'secret_in_use', detail: 'A published version references this secret.' },
    });
  });
});

describe('updateSecret (C125.2)', () => {
  const PATH = `${WORKFLOW_SECRETS_PATH}/slack_token`;
  const editForm = (values: Record<string, string>) =>
    formOf({
      key: 'slack_token',
      description: 'Synthetic token',
      'allowed-hosts': 'hooks.example.com',
      'header-placements': 'authorization',
      'body-pointers': '',
      ...values,
    });

  it('changes the description, the hosts and the placements by PATCH, never a value', async () => {
    as('secrets:read', 'secrets:write');
    api.on('PATCH', PATH, 200, { data: workflowSecret() });

    const result = await updateSecret(
      null,
      editForm({
        description: 'Signing key for the receiver',
        'allowed-hosts': 'receiver.example.com\nhooks.example.com',
        'header-placements': 'authorization\nx-signature',
        'body-pointers': '/auth/token',
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', PATH)?.body).toEqual({
      data: {
        type: 'workflow-secret',
        attributes: {
          description: 'Signing key for the receiver',
          'allowed-hosts': ['receiver.example.com', 'hooks.example.com'],
          'allowed-placements': {
            headers: ['authorization', 'x-signature'],
            'body-pointers': ['/auth/token'],
          },
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/secrets');
  });

  it('clears the description when it is emptied', async () => {
    as('secrets:read', 'secrets:write');
    api.on('PATCH', PATH, 200, { data: workflowSecret() });

    await updateSecret(null, editForm({ description: '' }));

    expect(
      (api.find('PATCH', PATH)?.body as { data: { attributes: Record<string, unknown> } }).data
        .attributes.description,
    ).toBeNull();
  });

  it('refuses a host or a placement the contract refuses, by its pointer, without calling the API', async () => {
    as('secrets:read', 'secrets:write');

    const result = await updateSecret(
      null,
      editForm({ 'allowed-hosts': 'https://Hooks.example.com/', 'body-pointers': 'auth.token' }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/allowed-hosts/0',
      '/data/attributes/allowed-placements/body-pointers/0',
    ]);
    expect(api.all('PATCH', PATH)).toHaveLength(0);
  });

  it('passes on the API’s refusal by pointer, as it refuses', async () => {
    as('secrets:read', 'secrets:write');
    api.onProblem('PATCH', PATH, 422, undefined, {
      errors: [
        { pointer: '/data/attributes/allowed-hosts', detail: 'needs a production user session' },
      ],
    });

    const result = await updateSecret(null, editForm({}));

    expect(result.ok ? [] : result.problem.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/allowed-hosts',
    ]);
  });

  it('needs secrets:write', async () => {
    as('secrets:read');

    expect((await updateSecret(null, editForm({}))).ok).toBe(false);
    expect(api.all('PATCH', PATH)).toHaveLength(0);
  });
});
