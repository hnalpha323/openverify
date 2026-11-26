// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_FILE_MAX_BYTES, LIST_PROBLEM_WORDS } from '../../components/lists/list-words';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import {
  LIST_IDS,
  emailItem,
  importer,
  listDocument,
  listResource,
} from '../../testing/lists-fixtures';
import { LIST_ADMIN, LIST_REVIEWER } from '../../testing/routes/lists';
import {
  addListItem,
  archiveList,
  archiveListItem,
  createList,
  importListItems,
  updateList,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: LIST_ADMIN });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};
const as = (permissions: readonly Permission[]) => api.me({ permissions });
const FORBIDDEN = { ok: false, problem: { title: 'You do not have access' } };
const ENV = { 'environment-id': ENVIRONMENTS.sandbox.id };

describe('createList (C97.1)', () => {
  it("creates the list on its kind's path with what the form set, and answers its id", async () => {
    api.on('POST', '/list/email-addresses', 201, listDocument(listResource('email-address')));

    const result = await createList(
      null,
      form({
        ...ENV,
        kind: 'email-address',
        name: ' Synthetic senders ',
        'item-retention-days': '',
        'screen-at-completion': 'on',
      }),
    );

    expect(result).toEqual({ ok: true, data: { id: LIST_IDS.list } });
    expect(api.find('POST', '/list/email-addresses')?.body).toEqual({
      data: {
        type: 'list/email-address',
        attributes: { name: 'Synthetic senders', 'screen-at-completion': true },
      },
    });
  });

  it("sends each kind's own settings", async () => {
    api.on('POST', '/list/fields', 201, listDocument(listResource('field')));
    api.on('POST', '/list/names', 201, listDocument(listResource('name')));
    api.on('POST', '/list/phone-numbers', 201, listDocument(listResource('phone-number')));
    api.on('POST', '/list/faces', 201, listDocument(listResource('face')));

    await createList(
      null,
      form({ ...ENV, kind: 'field', name: 'F', 'field-key': 'merchant_code' }),
    );
    await createList(
      null,
      form({
        ...ENV,
        kind: 'name',
        name: 'N',
        'allow-fuzzy-name-first': 'on',
        'screen-at-completion': 'on',
      }),
    );
    await createList(
      null,
      form({ ...ENV, kind: 'phone-number', name: 'P', 'default-region': 'gb' }),
    );
    await createList(null, form({ ...ENV, kind: 'face', name: 'Fc', 'item-retention-days': '30' }));

    expect(api.find('POST', '/list/fields')?.body).toMatchObject({
      data: {
        attributes: { name: 'F', 'field-key': 'merchant_code', 'screen-at-completion': false },
      },
    });
    expect(api.find('POST', '/list/names')?.body).toMatchObject({
      data: { attributes: { 'allow-fuzzy-name-first': true, 'screen-at-completion': true } },
    });
    expect(api.find('POST', '/list/phone-numbers')?.body).toMatchObject({
      data: { attributes: { 'default-region': 'GB' } },
    });
    expect(api.find('POST', '/list/faces')?.body).toMatchObject({
      data: { attributes: { 'item-retention-days': 30 } },
    });
  });

  it('titles the refusal of a face list before the acknowledgement in words', async () => {
    api.onProblem('POST', '/list/faces', 409, undefined, {
      code: 'biometric_lists_not_acknowledged',
    });

    const result = await createList(
      null,
      form({ ...ENV, kind: 'face', name: 'Fc', 'item-retention-days': '30' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        title: LIST_PROBLEM_WORDS.biometric_lists_not_acknowledged,
        code: 'biometric_lists_not_acknowledged',
        status: 409,
      },
    });
  });

  it('refuses an unknown kind or a bad value with a pointer, without calling the API', async () => {
    const unknown = await createList(null, form({ ...ENV, kind: 'planet', name: 'X' }));
    const empty = await createList(null, form({ ...ENV, kind: 'string', name: '' }));

    expect(unknown).toMatchObject({ ok: false, problem: { errors: [{ pointer: '/kind' }] } });
    expect(empty).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/name' }] },
    });
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  it('needs lists:write', async () => {
    as(['lists:read']);

    expect(await createList(null, form({ ...ENV, kind: 'string', name: 'S' }))).toMatchObject(
      FORBIDDEN,
    );
  });
});

describe('updateList and archiveList (C97.1)', () => {
  it('changes the name, retention, screening and the compromised-ID switch', async () => {
    api.on(
      'PATCH',
      `/lists/${LIST_IDS.list}`,
      200,
      listDocument(listResource('government-id-number')),
    );

    const result = await updateList(
      null,
      form({
        'list-id': LIST_IDS.list,
        kind: 'government-id-number',
        name: 'Synthetic IDs',
        'item-retention-days': '365',
        'use-for-compromised-ids': 'on',
      }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('PATCH', `/lists/${LIST_IDS.list}`)?.body).toEqual({
      data: {
        attributes: {
          name: 'Synthetic IDs',
          'item-retention-days': 365,
          'screen-at-completion': false,
          'use-for-compromised-ids': true,
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/lists/${LIST_IDS.list}`);
  });

  it('clears the retention when it is left empty, and sends no compromised-ID switch for other kinds', async () => {
    api.on('PATCH', `/lists/${LIST_IDS.list}`, 200, listDocument(listResource('email-address')));

    await updateList(
      null,
      form({
        'list-id': LIST_IDS.list,
        kind: 'email-address',
        name: 'S',
        'item-retention-days': '',
        'screen-at-completion': 'on',
      }),
    );

    expect(api.find('PATCH', `/lists/${LIST_IDS.list}`)?.body).toEqual({
      data: {
        attributes: { name: 'S', 'item-retention-days': null, 'screen-at-completion': true },
      },
    });
  });

  it('archives the list', async () => {
    api.on(
      'DELETE',
      `/lists/${LIST_IDS.list}`,
      200,
      listDocument(listResource('email-address', { status: 'archived' })),
    );

    expect(await archiveList(null, form({ 'list-id': LIST_IDS.list }))).toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.find('DELETE', `/lists/${LIST_IDS.list}`)).toBeDefined();
  });

  it('titles a retention beyond the face window in words', async () => {
    api.onProblem('PATCH', `/lists/${LIST_IDS.faceList}`, 422, undefined, {
      code: 'retention_exceeds_consent',
      errors: [{ pointer: '/data/attributes/item-retention-days', detail: 'Too long.' }],
    });

    const result = await updateList(
      null,
      form({
        'list-id': LIST_IDS.faceList,
        kind: 'face',
        name: 'F',
        'item-retention-days': '400',
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { title: LIST_PROBLEM_WORDS.retention_exceeds_consent },
    });
  });
});

describe('addListItem and archiveListItem (C97.1)', () => {
  it("adds an item on its kind's path, as typed", async () => {
    api.on('POST', '/list-item/email-addresses', 201, { data: emailItem() });
    api.on('POST', '/list-item/geolocations', 201, { data: emailItem() });

    const email = await addListItem(
      null,
      form({
        'list-id': LIST_IDS.list,
        kind: 'email-address',
        value: 'blocked.sender@mail.example',
        'match-type': 'domain',
      }),
    );
    await addListItem(
      null,
      form({
        'list-id': LIST_IDS.list,
        kind: 'geolocation',
        latitude: '-12.5',
        longitude: '140.25',
        'radius-meters': '5000',
      }),
    );

    expect(email).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', '/list-item/email-addresses')?.body).toEqual({
      data: {
        type: 'list-item/email-address',
        attributes: {
          'list-id': LIST_IDS.list,
          value: 'blocked.sender@mail.example',
          'match-type': 'domain',
        },
      },
    });
    expect(api.find('POST', '/list-item/geolocations')?.body).toMatchObject({
      data: { attributes: { latitude: -12.5, longitude: 140.25, 'radius-meters': 5000 } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/lists/${LIST_IDS.list}`);
  });

  it('titles a value already in the list in words', async () => {
    api.onProblem('POST', '/list-item/strings', 409, undefined, { code: 'list_item_exists' });

    const result = await addListItem(
      null,
      form({ 'list-id': LIST_IDS.list, kind: 'string', value: 'x' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: { title: LIST_PROBLEM_WORDS.list_item_exists },
    });
  });

  it('archives an item', async () => {
    api.on('DELETE', `/list-item/email-addresses/${LIST_IDS.item}`, 200, {
      data: emailItem({ status: 'archived' }),
    });

    const result = await archiveListItem(
      null,
      form({ 'list-id': LIST_IDS.list, kind: 'email-address', 'item-id': LIST_IDS.item }),
    );

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('needs pii:view as well to add a face item, and lists:write for any', async () => {
    as(['lists:read', 'lists:write']);
    expect(
      await addListItem(
        null,
        form({ 'list-id': LIST_IDS.faceList, kind: 'face', 'inquiry-id': LIST_IDS.inquiry }),
      ),
    ).toMatchObject(FORBIDDEN);
    as(['lists:read']);
    expect(
      await addListItem(null, form({ 'list-id': LIST_IDS.list, kind: 'string', value: 'x' })),
    ).toMatchObject(FORBIDDEN);
    expect(api.requests.filter((request) => request.method !== 'GET')).toHaveLength(0);
  });
});

describe('importListItems (C100.1)', () => {
  const csv = (text: string) => new File([text], 'synthetic.csv', { type: 'text/csv' });

  it('sends the file as base64 with its mode and encoding, and answers the importer id', async () => {
    api.on('POST', '/importer/list-item/email-addresses', 201, {
      data: importer('email-address', { status: 'pending' }),
    });

    const result = await importListItems(
      null,
      form({
        'list-id': LIST_IDS.list,
        kind: 'email-address',
        file: csv('value,match_type\nblocked.sender@mail.example,\n'),
        mode: 'skip-invalid',
        encoding: 'windows-1252',
      }),
    );

    expect(result).toEqual({ ok: true, data: { id: LIST_IDS.importer } });
    expect(api.find('POST', '/importer/list-item/email-addresses')?.body).toEqual({
      data: {
        attributes: {
          'list-id': LIST_IDS.list,
          file: Buffer.from('value,match_type\nblocked.sender@mail.example,\n').toString('base64'),
          mode: 'skip-invalid',
          encoding: 'windows-1252',
        },
      },
    });
  });

  it('refuses an empty or too large file, and a kind without an importer, without calling the API', async () => {
    const empty = await importListItems(
      null,
      form({ 'list-id': LIST_IDS.list, kind: 'email-address', file: csv('') }),
    );
    const large = await importListItems(
      null,
      form({
        'list-id': LIST_IDS.list,
        kind: 'email-address',
        file: csv('x'.repeat(IMPORT_FILE_MAX_BYTES + 1)),
      }),
    );
    const face = await importListItems(
      null,
      form({ 'list-id': LIST_IDS.list, kind: 'face', file: csv('a') }),
    );

    expect(empty).toMatchObject({ ok: false, problem: { errors: [{ pointer: '/file' }] } });
    expect(large).toMatchObject({ ok: false, problem: { errors: [{ pointer: '/file' }] } });
    expect(face).toMatchObject({ ok: false, problem: { errors: [{ pointer: '/kind' }] } });
    expect(api.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  });

  it('needs importers:write and lists:write, which a reviewer lacks', async () => {
    as(LIST_REVIEWER);

    expect(
      await importListItems(
        null,
        form({ 'list-id': LIST_IDS.list, kind: 'email-address', file: csv('value\n') }),
      ),
    ).toMatchObject(FORBIDDEN);
  });
});

describe('updateList: the purpose (C122.1)', () => {
  it('sends the purpose the form posts', async () => {
    api.on('PATCH', `/lists/${LIST_IDS.list}`, 200, listDocument(listResource('email-address')));

    await updateList(
      null,
      form({
        'list-id': LIST_IDS.list,
        kind: 'email-address',
        name: 'Synthetic senders',
        'item-retention-days': '',
        purpose: 'watch',
      }),
    );

    expect(
      (api.find('PATCH', `/lists/${LIST_IDS.list}`)?.body as { data: { attributes: object } }).data
        .attributes,
    ).toMatchObject({ purpose: 'watch' });
  });
});
