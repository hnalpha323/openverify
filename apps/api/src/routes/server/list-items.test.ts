/**
 * C97.1, C97.2, C97.5, C97.6, C98 (Workflow 7B, `api-lists`): the list item routes: one value per
 * kind keyed and sealed, the refusals as codes with no value, masking at every exit and the C12
 * policy `lists-write`. Every value is synthetic.
 */
import {
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  LIST_LIMITS,
  listItemDocumentSchema,
  listItemListDocumentSchema,
  type ListKind,
} from '@openverify/contracts';
import { toListItemResourceType } from '@openverify/core';
import { getList, redactListItems } from '@openverify/db';
import { seedList, testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { UNMASKED } from '../../auth/pii.js';
import { createListItem } from '../../services/lists/items.js';
import { createDenyRateLimiter } from '../../test-support/fakes.js';
import { bearer, expectStatus } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, token?: string) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token ?? api.token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });

const KEYED: Exclude<ListKind, 'face' | 'selfie-background'>[] = LIST_KINDS.filter(
  (kind): kind is Exclude<ListKind, 'face' | 'selfie-background'> =>
    !LIST_KIND_REGISTRY[kind].biometric,
);

const VALUES: Record<(typeof KEYED)[number], Record<string, unknown>> = {
  'browser-fingerprint': { value: 'a'.repeat(64) },
  'device-fingerprint': { value: 'b'.repeat(64) },
  country: { 'country-code': 'ZZ' },
  'email-address': { value: 'Jane@Example.com' },
  geolocation: { latitude: -30, longitude: -140, 'radius-meters': 1000 },
  'government-id-number': { 'id-number': 'X123 4567', 'id-class': 'passport' },
  field: { 'field-value': 'synthetic value' },
  'ip-address': { value: '192.0.2.1' },
  name: { 'name-first': 'Jane', 'name-last': 'Example' },
  'phone-number': { value: '+12025550100' },
  string: { value: 'synthetic' },
};

const listOf = (kind: ListKind, input: Parameters<typeof seedList>[2] = {}) =>
  seedList(api.database.db, api.environmentId, {
    kind,
    ...(kind === 'field' ? { fieldKey: 'synthetic-field' } : {}),
    ...input,
  });

async function createdItem(kind: (typeof KEYED)[number], listId?: string) {
  const list = listId ?? (await listOf(kind)).id;
  const response = await call(
    'POST',
    `/list-item/${LIST_KIND_REGISTRY[kind].plural}`,
    body({ 'list-id': list, ...VALUES[kind] }),
  );
  return { list, document: listItemDocumentSchema.parse(expectStatus(response, 201)) };
}

describe('POST /list-item/<plural> (C97.1)', () => {
  it.each(KEYED)('creates a %s item, serving what was entered', async (kind) => {
    const { list, document } = await createdItem(kind);

    expect(document.data.type).toBe(toListItemResourceType(kind));
    expect(document.data.attributes).toMatchObject({
      status: 'active',
      'archived-at': null,
      'redacted-at': null,
      'match-count': 0,
      ...VALUES[kind],
    });
    expect(document.data.relationships.list.data.id).toBe(list);
    expect(document.data.relationships.creator.data).toMatchObject({ type: 'api-key' });
    expect(await getList(api.database.db, api.environmentId, list)).toMatchObject({
      version: 2,
      itemCount: 1,
    });
  });

  it('records the key id of a fingerprint item and the email’s match type', async () => {
    const fingerprint = await createdItem('browser-fingerprint');
    expect(fingerprint.document.data.attributes).toMatchObject({
      'key-id': expect.stringMatching(/^[A-Za-z0-9_-]{11}$/) as string,
    });
    const email = await createdItem('email-address');
    expect(email.document.data.attributes).toMatchObject({ 'match-type': 'email_address' });
  });

  it('keeps an extra key per fold of a name, and the last names of a fuzzy list', async () => {
    const exact = await createdItem('name');
    const fuzzy = await seedFuzzyList();
    const fuzzyItem = await createdItem('name', fuzzy);
    const keys = async (id: string) =>
      (
        await api.database.client.query<{ key_kind: string }>(
          `select key_kind from list_item_keys where item_id = $1`,
          [id],
        )
      ).rows.map(({ key_kind: kind }) => kind);

    expect(await keys(exact.document.data.id)).not.toContain('identifier-name-last');
    expect(await keys(fuzzyItem.document.data.id)).toContain('identifier-name-last');
  });

  it('writes a range’s plaintext row, and a box per side of the antimeridian', async () => {
    const list = await listOf('ip-address');
    const range = expectStatus(
      await call(
        'POST',
        '/list-item/ip-addresses',
        body({ 'list-id': list.id, value: '198.51.100.0/24' }),
      ),
      201,
    );
    const rows = await api.database.client.query<{ range: string }>(
      `select range::text as range from list_item_ip_ranges where item_id = $1`,
      [(range.data as { id: string }).id],
    );
    expect(rows.rows).toEqual([{ range: '198.51.100.0/24' }]);

    const geo = await listOf('geolocation');
    const crossing = expectStatus(
      await call(
        'POST',
        '/list-item/geolocations',
        body({ 'list-id': geo.id, latitude: 0, longitude: 179.9999, 'radius-meters': 5000 }),
      ),
      201,
    );
    const boxes = await api.database.client.query<{ part: number }>(
      `select part from list_item_geo where item_id = $1 order by part`,
      [(crossing.data as { id: string }).id],
    );
    expect(boxes.rows).toEqual([{ part: 0 }, { part: 1 }]);
  });

  it.each([
    ['phone-number', { value: 'not a number' }, 'unparseable_phone'],
    ['ip-address', { value: '192.0.2.1/24' }, 'host_bits_set'],
    ['email-address', { value: 'nobody' }, 'invalid_value'],
    ['country', { 'country-code': 'ZZ' }, null],
  ] as const)('answers a %s value by a code, echoing nothing', async (kind, value, code) => {
    const list = await listOf(kind);
    const response = await call(
      'POST',
      `/list-item/${LIST_KIND_REGISTRY[kind].plural}`,
      body({ 'list-id': list.id, ...value }),
    );
    if (code === null) {
      expectStatus(response, 201);
      return;
    }
    expect(expectStatus(response, 422)).toMatchObject({ code });
    expect(response.body).not.toContain(Object.values(value)[0]);
  });

  it('answers 409 for a value already live in the list, however it was written', async () => {
    const list = await listOf('email-address');
    const post = (value: string) =>
      call('POST', '/list-item/email-addresses', body({ 'list-id': list.id, value }));
    expectStatus(await post('jane@example.com'), 201);
    expect(expectStatus(await post(' JANE@example.COM '), 409)).toMatchObject({
      code: 'list_item_exists',
    });
    expect(await getList(api.database.db, api.environmentId, list.id)).toMatchObject({
      version: 2,
      itemCount: 1,
    });
  });

  it('refuses the wrong list: unknown, another kind, archived, another environment', async () => {
    const post = (listId: string) =>
      call('POST', '/list-item/strings', body({ 'list-id': listId, value: 'synthetic' }));
    const emails = await listOf('email-address');
    const archived = await listOf('string', { status: 'archived' });
    const other = await seedList(api.database.db, (await api.newTenant()).environmentId);

    expectStatus(await post('lst_00000000000000000000000000'), 404);
    expectStatus(await post(other.id), 404);
    expect(expectStatus(await post(emails.id), 422)).toMatchObject({
      code: 'list_kind_mismatch',
    });
    expect(expectStatus(await post(archived.id), 409)).toMatchObject({ code: 'list_archived' });
  });

  it('refuses an item past the list’s limit (C97.5)', async () => {
    const list = await listOf('string');
    await api.database.db.execute(
      sql`update lists set item_count = ${LIST_LIMITS.itemsPerList} where id = ${list.id}`,
    );
    const response = await call(
      'POST',
      '/list-item/strings',
      body({ 'list-id': list.id, value: 'one too many' }),
    );
    expect(expectStatus(response, 409)).toMatchObject({ code: 'list_limit_reached' });
  });

  it('takes the C12 policy lists-write, per environment', async () => {
    const list = await listOf('string');
    await call('POST', '/list-item/strings', body({ 'list-id': list.id, value: 'one' }));

    expect(api.rateLimiter.calls.map(({ key }) => key)).toContain(
      `lists-write:${api.environmentId}`,
    );
    expect(api.rateLimiter.calls.find(({ key }) => key.startsWith('lists-write:'))?.policy).toEqual(
      {
        name: 'lists-write',
        limit: 600,
        windowSeconds: 60,
      },
    );
  });

  it('answers 429 with Retry-After past the policy', async () => {
    const limited = await createInquiryTestApi({
      rateLimiter: createDenyRateLimiter(30),
    });
    try {
      const list = await seedList(limited.database.db, limited.environmentId);
      const response = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/list-item/strings',
        headers: bearer(limited.token),
        payload: body({ 'list-id': list.id, value: 'over' }),
      });
      expectStatus(response, 429);
      expect(response.headers['retry-after']).toBe('30');
    } finally {
      await limited.close();
    }
  });

  it('needs pii:view to add a face or background item (C97.3)', async () => {
    const list = await listOf('face');
    const token = api.newUserToken(api.environmentId, { permissions: ['lists:write'] });
    const response = await call(
      'POST',
      '/list-item/faces',
      body({ 'list-id': list.id, 'inquiry-id': 'inq_00000000000000000000000000' }),
      token,
    );
    expectStatus(response, 403);
  });
});

describe('reading and archiving an item (C97.1, C97.6)', () => {
  it('reads an item, masked without pii:view, the country code and class aside', async () => {
    const number = await createdItem('government-id-number');
    const country = await createdItem('country');
    const masked = api.newUserToken(api.environmentId, { permissions: ['lists:read'] });
    const read = async (plural: string, id: string, token: string) =>
      listItemDocumentSchema.parse(
        expectStatus(await call('GET', `/list-item/${plural}/${id}`, undefined, token), 200),
      );

    const open = await read('government-id-numbers', number.document.data.id, api.token);
    expect(open.data).toEqual(number.document.data);
    const hidden = await read('government-id-numbers', number.document.data.id, masked);
    expect(hidden.data.attributes).toMatchObject({ 'id-number': null, 'id-class': 'passport' });
    const code = await read('countries', country.document.data.id, masked);
    expect(code.data.attributes).toMatchObject({ 'country-code': 'ZZ' });
  });

  it('answers 404 for an item of another environment', async () => {
    const tenant = await api.newTenant();
    const { token } = tenant;
    const { document } = await createdItem('string');
    expectStatus(
      await call('GET', `/list-item/strings/${document.data.id}`, undefined, token),
      404,
    );
    expectStatus(
      await call('DELETE', `/list-item/strings/${document.data.id}`, undefined, token),
      404,
    );
  });

  it('archives: the item stays readable and its list stops counting it', async () => {
    const { list, document } = await createdItem('string');
    const archived = listItemDocumentSchema.parse(
      expectStatus(await call('DELETE', `/list-item/strings/${document.data.id}`), 200),
    );

    expect(archived.data.attributes).toMatchObject({ status: 'archived', value: 'synthetic' });
    expect(await getList(api.database.db, api.environmentId, list)).toMatchObject({ itemCount: 0 });
  });

  it('serves a redacted item with its values null', async () => {
    const { document } = await createdItem('geolocation');
    await api.database.db.transaction((tx) =>
      redactListItems(tx, api.environmentId, [document.data.id], new Date()),
    );

    const read = listItemDocumentSchema.parse(
      expectStatus(await call('GET', `/list-item/geolocations/${document.data.id}`), 200),
    );

    expect(read.data.attributes).toMatchObject({
      status: 'archived',
      latitude: null,
      longitude: null,
      'radius-meters': null,
    });
    expect(read.data.attributes['redacted-at']).not.toBeNull();
  });
});

describe('GET /list-items (C97.1)', () => {
  it('needs filter[list-id]', async () => {
    expect(expectStatus(await call('GET', '/list-items'), 400)).toMatchObject({
      code: 'filter_required',
    });
  });

  it('pages a list’s items, by status, masked', async () => {
    const list = await listOf('string');
    const post = (value: string) =>
      call('POST', '/list-item/strings', body({ 'list-id': list.id, value }));
    expectStatus(await post('first'), 201);
    const second = expectStatus(await post('second'), 201).data as { id: string };
    await call('DELETE', `/list-item/strings/${second.id}`);

    const active = listItemListDocumentSchema.parse(
      expectStatus(
        await call('GET', `/list-items?filter[list-id]=${list.id}&filter[status]=active`),
        200,
      ),
    );
    expect(active.data).toHaveLength(1);
    const masked = api.newUserToken(api.environmentId, { permissions: ['lists:read'] });
    const page = listItemListDocumentSchema.parse(
      expectStatus(
        await call('GET', `/list-items?filter[list-id]=${list.id}&page[size]=1`, undefined, masked),
        200,
      ),
    );
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.attributes).toMatchObject({ value: null });
    expect(page.links.next).toContain(`filter[list-id]=${list.id}`);
  });

  it('answers an empty page for another environment’s list', async () => {
    const other = await seedList(api.database.db, (await api.newTenant()).environmentId);
    const answer = listItemListDocumentSchema.parse(
      expectStatus(await call('GET', `/list-items?filter[list-id]=${other.id}`), 200),
    );
    expect(answer.data).toEqual([]);
  });
});

async function seedFuzzyList(): Promise<string> {
  const list = await seedList(api.database.db, api.environmentId, { kind: 'name' });
  await api.database.db.execute(
    sql`update lists set allow_fuzzy_name_first = true where id = ${list.id}`,
  );
  return list.id;
}

describe('an item a workflow run created (C121.1)', () => {
  it('serves the run as its creator', async () => {
    const list = await seedList(api.database.db, api.environmentId);
    const run = testId('wfr');

    const { data } = await createListItem(
      api.deps,
      {
        ctx: { organizationId: api.organizationId, environmentId: api.environmentId },
        mask: UNMASKED,
        actor: { type: 'workflow-run', id: run },
      },
      'string',
      { 'list-id': list.id, value: 'synthetic' },
    );

    expect(data.relationships.creator.data).toEqual({ type: 'workflow-run', id: run });
  });
});
