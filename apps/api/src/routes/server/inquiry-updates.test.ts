/**
 * C10 inquiry changes that are not status transitions: `PATCH /inquiries/:id`, the tag
 * actions and one-time links.
 */
import {
  defaultInquiryTemplateAttributes,
  eventPayloadSchema,
  generateOneTimeLinkDocumentSchema,
  inquiryDocumentSchema,
  newId,
  parseOneTimeLinkFragment,
} from '@openverify/contracts';
import { hashSessionToken, transitionInquiryStatus } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  FLOW_PUBLIC_URL,
  PROBLEM_JSON,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/inquiries';
const INVALID_TRANSITION = 'https://openverify.dev/problems/invalid-transition';

async function complete(id: string, environmentId = api.environmentId) {
  const { db } = api.database;
  await transitionInquiryStatus(db, environmentId, id, { from: 'created', to: 'pending' });
  await transitionInquiryStatus(db, environmentId, id, { from: 'pending', to: 'completed' });
}

function patch(id: string, attributes: Record<string, unknown>, token = api.token) {
  return api.app.inject({
    method: 'PATCH',
    url: `${BASE}/${id}`,
    headers: bearer(token),
    payload: { data: { type: 'inquiry', attributes } },
  });
}

function post(id: string, name: string, meta?: Record<string, unknown>, token = api.token) {
  return api.app.inject({
    method: 'POST',
    url: `${BASE}/${id}/${name}`,
    headers: bearer(token),
    ...(meta === undefined ? {} : { payload: { meta } }),
  });
}

const reader = () => api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

describe('PATCH /api/v1/inquiries/:id', () => {
  it('merges fields and sets the reference id and the note', async () => {
    const id = await createInquiry(api, { fields: { name_first: 'Ada', name_last: 'Old' } });

    const document = inquiryDocumentSchema.parse(
      expectStatus(
        await patch(id, {
          fields: { name_last: 'New', birth_year: 1990 },
          'reference-id': 'patched-ref',
          note: 'Checked by phone.',
        }),
        200,
      ),
    );

    expect(document.data.attributes).toMatchObject({
      fields: { name_first: 'Ada', name_last: 'New', birth_year: 1990 },
      'reference-id': 'patched-ref',
      note: 'Checked by phone.',
    });
    const read = expectStatus(
      await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(api.token) }),
      200,
    );
    expect(read.data.attributes).toMatchObject({ note: 'Checked by phone.' });
  });

  it('stores the note encrypted, never in plaintext', async () => {
    const id = await createInquiry(api);

    expectStatus(await patch(id, { note: 'Plaintextnotecheck' }), 200);

    const { rows } = await api.database.client.query<Record<string, unknown>>(
      'select * from inquiries where id = $1',
      [id],
    );
    expect(JSON.stringify(rows[0])).not.toContain('Plaintextnotecheck');
  });

  it('clears the reference id and the note with null', async () => {
    const id = await createInquiry(api, { referenceId: 'to-clear' });
    expectStatus(await patch(id, { note: 'temporary' }), 200);

    const document = expectStatus(await patch(id, { 'reference-id': null, note: null }), 200);

    expect(document.data.attributes).toMatchObject({ 'reference-id': null, note: null });
  });

  it('answers 409 invalid-transition for fields once the inquiry is finished', async () => {
    const id = await createInquiry(api, { fields: { name_first: 'Kept' } });
    await complete(id);

    const response = await patch(id, { fields: { name_first: 'Changed' } });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
    const document = expectStatus(await patch(id, { note: 'notes still change' }), 200);
    expect(document.data.attributes).toMatchObject({
      fields: { name_first: 'Kept' },
      note: 'notes still change',
    });
  });

  it('answers 410 redacted for fields or a note on a redacted inquiry', async () => {
    const id = await createInquiry(api);
    await api.database.client.query('update inquiries set redacted_at = now() where id = $1', [id]);

    for (const attributes of [{ fields: { name_first: 'x' } }, { note: 'x' }]) {
      const response = await patch(id, attributes);
      expect(response.statusCode).toBe(410);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
      expect(response.json<{ type: string }>().type).toBe(
        'https://openverify.dev/problems/redacted',
      );
    }
    expectStatus(await patch(id, { 'reference-id': 'still-allowed' }), 200);
  });

  it('masks the response for a user without pii:view', async () => {
    const id = await createInquiry(api, { fields: { name_first: 'Hidden' } });
    const writer = api.newUserToken(api.environmentId, { permissions: ['inquiries:write'] });

    const document = expectStatus(await patch(id, { note: 'hidden note' }, writer), 200);

    expect(document.data.attributes).toMatchObject({ fields: { name_first: null }, note: null });
  });

  it('audits the change with the attribute names only', async () => {
    const id = await createInquiry(api);
    const userId = newId('usr');

    expectStatus(
      await patch(
        id,
        { fields: { name_first: 'Secret' }, note: 'secret note' },
        api.newUserToken(api.environmentId, { userId }),
      ),
      200,
    );

    const entries = api.audit.withAction('inquiry.updated').filter((e) => e.resourceId === id);
    expect(entries).toEqual([
      expect.objectContaining({
        actor: { type: 'user', id: userId },
        resourceType: 'inquiry',
        metadata: { attributes: ['fields', 'note'] },
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('Secret');
  });

  it.each([
    ['nothing', {}],
    ['a note over 2,000 characters', { note: 'x'.repeat(2001) }],
    ['a status', { status: 'approved' }],
  ])('rejects %s', async (_label, attributes) => {
    const id = await createInquiry(api);

    expect((await patch(id, attributes)).statusCode).toBe(400);
  });

  it('answers 404 across environments and 403 without inquiries:write', async () => {
    const other = await api.newTenant();
    const foreign = await createInquiry(api, { token: other.token });
    const id = await createInquiry(api);

    expect((await patch(foreign, { note: 'x' })).statusCode).toBe(404);
    expect((await patch(id, { note: 'x' }, reader())).statusCode).toBe(403);
  });
});

describe('inquiry tags', () => {
  const tagsOf = async (id: string) =>
    expectStatus(await api.app.inject({ url: `${BASE}/${id}`, headers: bearer(api.token) }), 200)
      .data.attributes.tags;

  const tagEvents = (id: string) =>
    api.events.named('inquiry.updated-tags').filter((event) => event.payload.data.id === id);

  it('adds a trimmed tag once, ignoring case, and emits inquiry.updated-tags on change', async () => {
    const id = await createInquiry(api);

    const document = expectStatus(await post(id, 'add-tag', { 'tag-name': '  VIP  ' }), 200);
    expectStatus(await post(id, 'add-tag', { 'tag-name': 'vip' }), 200);

    expect(document.data.attributes.tags).toEqual(['VIP']);
    expect(await tagsOf(id)).toEqual(['VIP']);
    const events = tagEvents(id);
    expect(events).toHaveLength(1);
    expect(eventPayloadSchema.parse(events[0]?.payload).data).toMatchObject({
      attributes: { tags: ['VIP'] },
    });
    expect(
      api.audit.withAction('inquiry.updated-tags').filter((entry) => entry.resourceId === id),
    ).toHaveLength(1);
  });

  it('removes a tag ignoring case', async () => {
    const id = await createInquiry(api);
    expectStatus(await post(id, 'set-tags', { 'tag-names': ['Fraud review', 'Repeat'] }), 200);

    const document = expectStatus(
      await post(id, 'remove-tag', { 'tag-name': 'fraud REVIEW' }),
      200,
    );

    expect(document.data.attributes.tags).toEqual(['Repeat']);
    expect(tagEvents(id)).toHaveLength(2);
  });

  it('replaces the list with set-tags, keeping the first spelling of duplicates', async () => {
    const id = await createInquiry(api);
    expectStatus(await post(id, 'add-tag', { 'tag-name': 'old' }), 200);

    const document = expectStatus(
      await post(id, 'set-tags', { 'tag-names': ['Straße', 'STRASSE', 'b2b:eu'] }),
      200,
    );

    expect(document.data.attributes.tags).toEqual(['Straße', 'b2b:eu']);
    const cleared = expectStatus(await post(id, 'set-tags', { 'tag-names': [] }), 200);
    expect(cleared.data.attributes.tags).toEqual([]);
  });

  it('answers 422 when an inquiry would hold more than 50 tags', async () => {
    const id = await createInquiry(api);
    const fifty = Array.from({ length: 50 }, (_, index) => `tag ${String(index)}`);
    expectStatus(await post(id, 'set-tags', { 'tag-names': fifty }), 200);

    const response = await post(id, 'add-tag', { 'tag-name': 'one more' });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(await tagsOf(id)).toHaveLength(50);
  });

  it.each([
    ['a comma', 'a,b'],
    ['an empty tag', '   '],
    ['a tag over 64 characters', 'x'.repeat(65)],
  ])('rejects %s', async (_label, tag) => {
    const id = await createInquiry(api);

    expect((await post(id, 'add-tag', { 'tag-name': tag })).statusCode).toBe(400);
  });

  it.each(['add-tag', 'remove-tag', 'set-tags'])(
    '%s answers 404 across environments and 403 without inquiries:write',
    async (name) => {
      const other = await api.newTenant();
      const foreign = await createInquiry(api, { token: other.token });
      const id = await createInquiry(api);
      const meta = name === 'set-tags' ? { 'tag-names': ['x'] } : { 'tag-name': 'x' };

      expect((await post(foreign, name, meta)).statusCode).toBe(404);
      expect((await post(id, name, meta, reader())).statusCode).toBe(403);
    },
  );
});

describe('POST /api/v1/inquiries/:id/generate-one-time-link', () => {
  const generate = (id: string, meta?: Record<string, unknown>, token = api.token) =>
    post(id, 'generate-one-time-link', meta, token);

  it('returns a single-use link carrying an ovo_ token in its fragment, stored only hashed', async () => {
    const id = await createInquiry(api);

    const response = await generate(id);

    const document = generateOneTimeLinkDocumentSchema.parse(expectStatus(response, 200));
    expect(response.headers['cache-control']).toBe('no-store');
    const link = document.meta['one-time-link'];
    expect(link.startsWith(`${FLOW_PUBLIC_URL}/#inquiry-id=${id}&one-time-token=ovo_`)).toBe(true);
    const credentials = parseOneTimeLinkFragment(new URL(link).hash);
    expect(credentials?.inquiryId).toBe(id);
    const { rows } = await api.database.client.query<{ token_hash: string; expires_at: Date }>(
      'select token_hash, expires_at from one_time_links where inquiry_id = $1',
      [id],
    );
    expect(rows.map((row) => row.token_hash)).toEqual([
      hashSessionToken(credentials?.oneTimeToken ?? ''),
    ]);
    expect(document.meta['expires-at']).toBe(
      new Date(api.clock.now().getTime() + 86_400_000).toISOString(),
    );
    expect(new Date(rows[0]?.expires_at ?? 0).toISOString()).toBe(document.meta['expires-at']);
  });

  it('uses expires-in-seconds, else the template default, and never outlives the inquiry', async () => {
    const templateId = await createTemplate(api, api.token, {
      ...defaultInquiryTemplateAttributes(),
      settings: { 'inquiry-expiration-seconds': 7200, 'one-time-link-expiration-seconds': 1200 },
    });
    const id = await createInquiry(api, { templateId });
    const at = (seconds: number) => new Date(api.clock.now().getTime() + seconds * 1000);

    const byDefault = generateOneTimeLinkDocumentSchema.parse(
      expectStatus(await generate(id), 200),
    );
    const explicit = generateOneTimeLinkDocumentSchema.parse(
      expectStatus(await generate(id, { 'expires-in-seconds': 600 }), 200),
    );
    const capped = generateOneTimeLinkDocumentSchema.parse(
      expectStatus(await generate(id, { 'expires-in-seconds': 86_400 }), 200),
    );

    expect(byDefault.meta['expires-at']).toBe(at(1200).toISOString());
    expect(explicit.meta['expires-at']).toBe(at(600).toISOString());
    expect(capped.meta['expires-at']).toBe(at(7200).toISOString());
  });

  it('revokes the older unused links of the inquiry', async () => {
    const id = await createInquiry(api);
    expectStatus(await generate(id), 200);
    expectStatus(await generate(id), 200);

    const { rows } = await api.database.client.query<{ revoked: boolean }>(
      'select revoked_at is not null as revoked from one_time_links where inquiry_id = $1 order by id',
      [id],
    );

    expect(rows.map((row) => row.revoked)).toEqual([true, false]);
  });

  it('audits the link without its token', async () => {
    const id = await createInquiry(api);

    const document = generateOneTimeLinkDocumentSchema.parse(expectStatus(await generate(id), 200));

    const entries = api.audit
      .withAction('inquiry.one-time-link-generated')
      .filter((entry) => entry.resourceId === id);
    expect(entries).toEqual([
      expect.objectContaining({
        resourceType: 'inquiry',
        metadata: { 'expires-at': document.meta['expires-at'] },
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('ovo_');
  });

  it('answers 409 invalid-transition once the inquiry is finished', async () => {
    const id = await createInquiry(api);
    await complete(id);

    const response = await generate(id);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
  });

  it('answers 409 invalid-transition for an inquiry past its expiry the job has not reached', async () => {
    const templateId = await createTemplate(api, api.token, {
      ...defaultInquiryTemplateAttributes(),
      settings: { 'inquiry-expiration-seconds': 300 },
    });
    const id = await createInquiry(api, { templateId });
    const createdAt = api.clock.now();

    api.clock.advance(300_000);
    const response = await generate(id);
    api.clock.set(createdAt);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
  });

  it.each([299, 2_592_001, 1.5])('rejects expires-in-seconds %s', async (seconds) => {
    const id = await createInquiry(api);

    expect((await generate(id, { 'expires-in-seconds': seconds })).statusCode).toBe(400);
  });

  it('answers 404 across environments and 403 without inquiries:write', async () => {
    const other = await api.newTenant();
    const foreign = await createInquiry(api, { token: other.token });
    const id = await createInquiry(api);

    expect((await generate(foreign)).statusCode).toBe(404);
    expect((await generate(id, undefined, reader())).statusCode).toBe(403);
  });
});
