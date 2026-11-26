// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  apiKeyResource,
  apiKeyToken,
} from '../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { cloneApiKey, createApiKey, expireApiKey, rotateApiKey, updateApiKey } from './actions';
import { rotatedKeyDocument, SETTINGS_IDS } from '../../testing/routes/settings';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { apiKey: KEY_ID, clonedApiKey: CLONE_ID } = INTEGRATION_IDS;
const WRITER = meDocument({ permissions: ['api-keys:read', 'api-keys:write', 'inquiries:read'] });

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  vi.mocked(revalidatePath).mockClear();
});

afterEach(() => {
  api.restore();
});

function form(entries: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    for (const item of typeof value === 'string' ? [value] : value) {
      data.append(name, item);
    }
  }
  return data;
}

const NEW_KEY = {
  // The new key page renders the session environment's id (Workflow 2D F002).
  'environment-id': ENVIRONMENTS.sandbox.id,
  name: 'CI deploys',
  scopes: ['inquiries:read'],
  'allowed-ips': '203.0.113.0/24',
  'api-version': '2026-10-01',
  'expires-in-seconds': '',
};

describe('createApiKey', () => {
  it('creates the key and answers its id and token, once', async () => {
    const token = apiKeyToken();
    api.reply(200, WRITER).reply(201, { data: apiKeyResource(), meta: { token } });

    await expect(createApiKey(null, form(NEW_KEY))).resolves.toEqual({
      ok: true,
      data: { id: KEY_ID, secret: token, expiresAt: null },
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/api-keys',
      body: {
        data: {
          type: 'api-key',
          attributes: {
            name: 'CI deploys',
            scopes: ['inquiries:read'],
            'allowed-ips': ['203.0.113.0/24'],
            'api-version': '2026-10-01',
          },
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/api-keys');
  });

  it('creates the key with the expiry chosen, in one call (C25.5)', async () => {
    const token = apiKeyToken();
    api.reply(200, WRITER).reply(201, {
      data: apiKeyResource({ 'expires-at': '2026-10-21T04:35:00.000Z' }),
      meta: { token },
    });

    await expect(
      createApiKey(null, form({ ...NEW_KEY, 'expires-in-seconds': '86400' })),
    ).resolves.toEqual({
      ok: true,
      data: { id: KEY_ID, secret: token, expiresAt: '2026-10-21T04:35:00.000Z' },
    });
    expect(api.requests).toHaveLength(2);
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/api-keys',
      body: { data: { attributes: { 'expires-in-seconds': 86_400 } } },
    });
  });

  describe('with an expiry at a date and time (UTC)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T12:00:00.250Z') });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends the seconds from now until then, rounded up', async () => {
      api.reply(200, WRITER).reply(201, {
        data: apiKeyResource({ 'expires-at': '2026-10-20T12:00:30.250Z' }),
        meta: { token: apiKeyToken() },
      });

      await createApiKey(
        null,
        form({ ...NEW_KEY, 'expires-in-seconds': 'custom', 'expires-at': '2026-10-20T12:00:30' }),
      );

      expect(api.last()).toMatchObject({
        method: 'POST',
        path: '/api/v1/api-keys',
        body: { data: { attributes: { 'expires-in-seconds': 30 } } },
      });
    });

    it.each([
      ['a time that has passed', '2026-10-20T12:00:00', 'Choose a time in the future.'],
      ['a time more than 30 days away', '2026-11-19T12:00:01', 'Choose a time within 30 days.'],
      ['no date and time', '', 'Enter a date and time.'],
      ['a date that does not exist', '2026-02-30T12:00', 'Enter a date and time.'],
    ])('refuses %s at its field, without calling the API', async (_case, value, detail) => {
      api.reply(200, WRITER);

      await expect(
        createApiKey(
          null,
          form({ ...NEW_KEY, 'expires-in-seconds': 'custom', 'expires-at': value }),
        ),
      ).resolves.toMatchObject({
        ok: false,
        problem: { errors: [{ pointer: '/expires-at', detail }] },
      });
      expect(api.requests).toHaveLength(1);
    });
  });

  it('refuses an expiry that is not offered, without calling the API', async () => {
    api.reply(200, WRITER);

    await expect(
      createApiKey(null, form({ ...NEW_KEY, 'expires-in-seconds': '0' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/expires-in-seconds' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('points at the fields to correct, in words', async () => {
    api.reply(200, WRITER);

    const result = await createApiKey(
      null,
      form({ ...NEW_KEY, name: '', scopes: [], 'allowed-ips': '203.0.113.0/24 nowhere' }),
    );

    expect(result).toMatchObject({ ok: false, problem: { title: 'Check the values you entered' } });
    const errors = result.ok ? [] : (result.problem.errors ?? []);
    expect(errors).toEqual(
      expect.arrayContaining([
        { pointer: '/data/attributes/name', detail: 'Enter a name.' },
        { pointer: '/data/attributes/scopes', detail: 'needs at least one scope' },
        {
          pointer: '/data/attributes/allowed-ips/1',
          detail: 'nowhere is not a CIDR range, such as 203.0.113.0/24 or 2001:db8::/32.',
        },
      ]),
    );
    expect(api.requests).toHaveLength(1);
  });

  describe('reports a bad expiry and bad key attributes together, in one submit (E003)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T12:00:00.250Z') });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([
      [
        'a custom expiry in the past',
        { 'expires-in-seconds': 'custom', 'expires-at': '2026-10-20T11:00' },
        { pointer: '/expires-at', detail: 'Choose a time in the future.' },
      ],
      [
        'a custom expiry without a date',
        { 'expires-in-seconds': 'custom', 'expires-at': '' },
        { pointer: '/expires-at', detail: 'Enter a date and time.' },
      ],
      [
        'an expiry that is not offered',
        { 'expires-in-seconds': '0' },
        { pointer: '/expires-in-seconds', detail: 'Choose from the list.' },
      ],
    ])(
      '%s, with an unnamed key and a range that is not CIDR',
      async (_case, expiry, expiryError) => {
        api.reply(200, WRITER);

        const result = await createApiKey(
          null,
          form({ ...NEW_KEY, ...expiry, name: '', 'allowed-ips': 'nowhere' }),
        );

        expect(result).toMatchObject({
          ok: false,
          problem: { title: 'Check the values you entered' },
        });
        expect(result.ok ? [] : (result.problem.errors ?? [])).toEqual([
          { pointer: '/data/attributes/name', detail: 'Enter a name.' },
          {
            pointer: '/data/attributes/allowed-ips/0',
            detail: 'nowhere is not a CIDR range, such as 203.0.113.0/24 or 2001:db8::/32.',
          },
          expiryError,
        ]);
        expect(api.requests).toHaveLength(1);
      },
    );
  });

  it("shows the API's refusal of a scope the operator does not hold, in its words", async () => {
    api.reply(200, WRITER).replyProblem(403, 'forbidden', {
      title: 'Forbidden',
      detail: 'A user can only grant scopes it holds. Missing: api-logs:read.',
    });

    await expect(
      createApiKey(null, form({ ...NEW_KEY, scopes: ['api-logs:read'] })),
    ).resolves.toMatchObject({
      ok: false,
      problem: {
        title: 'Forbidden',
        detail: 'A user can only grant scopes it holds. Missing: api-logs:read.',
        status: 403,
      },
    });
  });

  it('creates nothing when the session switched environment after the form was rendered (Workflow 2D F002)', async () => {
    api.reply(
      200,
      meDocument({
        permissions: ['api-keys:read', 'api-keys:write', 'inquiries:read'],
        environment: ENVIRONMENTS.production,
      }),
    );

    await expect(createApiKey(null, form(NEW_KEY))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'The environment changed' },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses an operator without api-keys:write, without calling the API', async () => {
    api.reply(200, meDocument({ permissions: ['api-keys:read'] }));

    await expect(createApiKey(null, form(NEW_KEY))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
    expect(api.requests).toHaveLength(1);
  });
});

describe('updateApiKey', () => {
  it('renames the key and sets where it may be used from', async () => {
    api.reply(200, WRITER).reply(200, { data: apiKeyResource() });

    await expect(
      updateApiKey(null, form({ 'api-key-id': KEY_ID, name: 'Deploys', 'allowed-ips': '' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.last()).toMatchObject({
      method: 'PATCH',
      path: `/api/v1/api-keys/${KEY_ID}`,
      body: { data: { attributes: { name: 'Deploys', 'allowed-ips': [] } } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/api-keys/${KEY_ID}`);
  });

  it('refuses a malformed key id', async () => {
    api.reply(200, WRITER);

    await expect(
      updateApiKey(null, form({ 'api-key-id': 'key_nope', name: 'Deploys' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/api-key-id' }] } });
  });
});

describe('cloneApiKey', () => {
  it("answers the clone's id and its token, once", async () => {
    const token = apiKeyToken('c');
    api.reply(200, WRITER).reply(201, { data: apiKeyResource({}, CLONE_ID), meta: { token } });

    await expect(
      cloneApiKey(null, form({ 'api-key-id': KEY_ID, name: 'CI deploys 2' })),
    ).resolves.toEqual({ ok: true, data: { id: CLONE_ID, secret: token } });
    expect(api.last()).toMatchObject({
      path: `/api/v1/api-keys/${KEY_ID}/clone`,
      body: { meta: { name: 'CI deploys 2' } },
    });
  });

  it('keeps the name the API gives a clone when none is typed', async () => {
    api
      .reply(200, WRITER)
      .reply(201, { data: apiKeyResource({}, CLONE_ID), meta: { token: apiKeyToken('c') } });

    await cloneApiKey(null, form({ 'api-key-id': KEY_ID, name: ' ' }));

    expect(api.last().body).toEqual({});
  });
});

describe('expireApiKey', () => {
  it('expires the key now', async () => {
    api.reply(200, WRITER).reply(200, { data: apiKeyResource() });

    await expect(
      expireApiKey(null, form({ 'api-key-id': KEY_ID, 'expires-in-seconds': '0' })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.last()).toMatchObject({
      path: `/api/v1/api-keys/${KEY_ID}/expire`,
      body: { meta: { 'expires-in-seconds': 0 } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/api-keys/${KEY_ID}`);
  });

  it('refuses a time that is not offered', async () => {
    api.reply(200, WRITER);

    await expect(
      expireApiKey(null, form({ 'api-key-id': KEY_ID, 'expires-in-seconds': '-1' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/expires-in-seconds' }] },
    });
    expect(api.requests).toHaveLength(1);
  });
});

describe('updateApiKey: the note and the attribute blocklist (C169.1, C169.3)', () => {
  it('sends the note and the blocklist, one attribute per line', async () => {
    api.reply(200, WRITER).reply(200, { data: apiKeyResource() });

    await updateApiKey(
      null,
      form({
        'api-key-id': KEY_ID,
        name: 'Deploys',
        'allowed-ips': '',
        note: ' For the CI pipeline ',
        'attribute-blocklist': 'name-first\n\nbirthdate , address-street-1',
      }),
    );

    expect(api.last().body).toEqual({
      data: {
        type: 'api-key',
        attributes: {
          name: 'Deploys',
          'allowed-ips': [],
          note: 'For the CI pipeline',
          'attribute-blocklist': ['name-first', 'birthdate', 'address-street-1'],
        },
      },
    });
  });

  it('removes the note when it is emptied', async () => {
    api.reply(200, WRITER).reply(200, { data: apiKeyResource() });

    await updateApiKey(
      null,
      form({
        'api-key-id': KEY_ID,
        name: 'Deploys',
        'allowed-ips': '',
        note: '  ',
        'attribute-blocklist': '',
      }),
    );

    expect(api.last().body).toMatchObject({
      data: { attributes: { note: null, 'attribute-blocklist': [] } },
    });
  });
});

describe('rotateApiKey (C169.1)', () => {
  it('rotates with how long the old token keeps working, and answers the new token once with the old one’s end', async () => {
    api.reply(200, WRITER).reply(201, rotatedKeyDocument('2026-10-21T04:40:00.000Z'));

    const result = await rotateApiKey(
      null,
      form({ 'api-key-id': KEY_ID, 'previous-expires-in-seconds': '86400', name: '' }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        id: SETTINGS_IDS.rotatedKey,
        secret: apiKeyToken('r'),
        previousExpiresAt: '2026-10-21T04:40:00.000Z',
      },
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/api-keys/${KEY_ID}/rotate`,
      body: { meta: { 'previous-expires-in-seconds': 86_400 } },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/api-keys');
  });

  it('names the new key when a name is typed, and ends the old token now when chosen', async () => {
    api.reply(200, WRITER).reply(201, rotatedKeyDocument());

    await rotateApiKey(
      null,
      form({ 'api-key-id': KEY_ID, 'previous-expires-in-seconds': '0', name: 'CI 2' }),
    );

    expect(api.last().body).toEqual({ meta: { 'previous-expires-in-seconds': 0, name: 'CI 2' } });
  });

  it('refuses a time the form does not offer, without calling the API', async () => {
    api.reply(200, WRITER);

    await expect(
      rotateApiKey(null, form({ 'api-key-id': KEY_ID, 'previous-expires-in-seconds': '99' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/previous-expires-in-seconds' }] },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('keeps the API’s words when the copy would carry scopes the operator lacks (403)', async () => {
    api
      .reply(200, WRITER)
      .replyProblem(403, undefined, { detail: 'You do not hold webhooks:read.' });

    await expect(
      rotateApiKey(null, form({ 'api-key-id': KEY_ID, 'previous-expires-in-seconds': '0' })),
    ).resolves.toMatchObject({ ok: false, problem: { detail: 'You do not hold webhooks:read.' } });
  });
});
