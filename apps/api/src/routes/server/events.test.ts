import { emptyExtractedFields } from '@openverify/core';
import {
  buildInquiryResource,
  buildVerificationResource,
  eventDocumentSchema,
  eventListDocumentSchema,
  newId,
  type EventResource,
} from '@openverify/contracts';
import { createEvent, listInquirySessions } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTestApi,
  expectStatus,
  resumeInquiry,
  seedVerification,
  type TestApi,
  type TestTenant,
} from '../../test-support/harness.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
});

afterAll(async () => {
  await api.close();
});

const url = (id: string) => `/api/v1/events/${id}`;
const LIST = '/api/v1/events';

function inquiryPayload(id: string = newId('inq'), fields: Record<string, string> = {}) {
  const at = new Date('2026-10-20T12:00:00.000Z');
  return {
    data: buildInquiryResource({
      id,
      status: 'completed',
      referenceId: null,
      fields,
      inquiryTemplateId: newId('itmpl'),
      verifications: [],
      createdAt: at,
      updatedAt: at,
    }),
  };
}

async function seedEvent(
  environmentId: string,
  name = 'inquiry.completed',
  options: { inquiryId?: string; simulated?: boolean; fields?: Record<string, string> } = {},
) {
  return createEvent(api.database.db, environmentId, {
    id: newId('evt'),
    name,
    payload: inquiryPayload(options.inquiryId, options.fields),
    ...(options.simulated === undefined ? {} : { simulated: options.simulated }),
  });
}

describe('GET /api/v1/events/:id', () => {
  it('returns the event resource with its payload', async () => {
    const event = await seedEvent(api.environmentId);

    const response = await api.app.inject({ url: url(event.id), headers: bearer(api.token) });

    const document = eventDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data).toEqual({
      type: 'event',
      id: event.id,
      attributes: {
        name: 'inquiry.completed',
        payload: event.payload,
        simulated: false,
        'created-at': event.createdAt.toISOString(),
      },
    });
  });

  it('answers 404 for an event of another environment', async () => {
    const other = await api.newTenant();
    const event = await seedEvent(other.environmentId);

    const response = await api.app.inject({ url: url(event.id), headers: bearer(api.token) });

    expect(response.statusCode).toBe(404);
  });

  it('answers 500 rather than serve a stored event outside the event contract', async () => {
    const event = await seedEvent(api.environmentId, 'inquiry.deleted');

    const response = await api.app.inject({ url: url(event.id), headers: bearer(api.token) });

    expect(response.statusCode).toBe(500);
  });

  it('serves the stub that replaced the payload of a redacted subject (C16)', async () => {
    const inquiryId = newId('inq');
    const event = await createEvent(api.database.db, api.environmentId, {
      id: newId('evt'),
      name: 'inquiry.completed',
      payload: {
        data: {
          type: 'inquiry',
          id: inquiryId,
          attributes: { 'redacted-at': '2026-10-21T00:00:00.000Z' },
        },
      },
    });

    const response = await api.app.inject({ url: url(event.id), headers: bearer(api.token) });

    expect(eventDocumentSchema.parse(expectStatus(response, 200)).data.attributes.payload).toEqual({
      data: {
        type: 'inquiry',
        id: inquiryId,
        attributes: { 'redacted-at': '2026-10-21T00:00:00.000Z' },
      },
    });
  });

  it('masks fields in the payload for a user without pii:view (C15)', async () => {
    const event = await seedEvent(api.environmentId, 'inquiry.completed', {
      fields: { name_first: 'Synthetic-Jane' },
    });
    const masked = api.newUserToken(api.environmentId, { permissions: ['events:read'] });
    const visible = api.newUserToken(api.environmentId, {
      permissions: ['events:read', 'pii:view'],
    });

    const hidden = await api.app.inject({ url: url(event.id), headers: bearer(masked) });
    const shown = await api.app.inject({ url: url(event.id), headers: bearer(visible) });

    expect(
      eventDocumentSchema.parse(expectStatus(hidden, 200)).data.attributes.payload.data.attributes,
    ).toMatchObject({ fields: { name_first: null } });
    expect(hidden.body).not.toContain('Synthetic-Jane');
    expect(shown.body).toContain('Synthetic-Jane');
  });

  it('masks the extraction attributes of a verification payload, not their sources (C31.6)', async () => {
    const at = new Date('2026-10-20T12:00:00.000Z');
    const event = await createEvent(api.database.db, api.environmentId, {
      id: newId('evt'),
      name: 'verification.passed',
      payload: {
        data: buildVerificationResource({
          id: newId('ver'),
          type: 'government_id',
          status: 'passed',
          inquiryId: newId('inq'),
          fileIds: [],
          checks: [],
          // A fictional Utopia holder: synthetic values only.
          extraction: {
            fields: { ...emptyExtractedFields(), 'name-last': 'VALEMONT-SYNTHETIC' },
            sources: { 'name-last': ['mrz', 'viz'] },
          },
          createdAt: at,
          updatedAt: at,
        }),
      },
    });
    const masked = api.newUserToken(api.environmentId, { permissions: ['events:read'] });

    const hidden = await api.app.inject({ url: url(event.id), headers: bearer(masked) });
    const shown = await api.app.inject({ url: url(event.id), headers: bearer(api.token) });

    expect(
      eventDocumentSchema.parse(expectStatus(hidden, 200)).data.attributes.payload.data.attributes,
    ).toMatchObject({ 'name-last': null, 'extraction-sources': { 'name-last': ['mrz', 'viz'] } });
    expect(hidden.body).not.toContain('VALEMONT-SYNTHETIC');
    expect(shown.body).toContain('VALEMONT-SYNTHETIC');
  });

  it('answers 403 forbidden without events:read', async () => {
    const event = await seedEvent(api.environmentId);
    const token = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    expect((await api.app.inject({ url: url(event.id), headers: bearer(token) })).statusCode).toBe(
      403,
    );
  });
});

describe('GET /api/v1/events', () => {
  let tenant: TestTenant;
  let inquiryId: string;
  /** Oldest first. */
  let events: { id: string }[];

  beforeAll(async () => {
    tenant = await api.newTenant();
    inquiryId = newId('inq');
    events = [
      await seedEvent(tenant.environmentId, 'inquiry.created', { inquiryId }),
      await seedEvent(tenant.environmentId, 'inquiry.completed', { inquiryId }),
      await seedEvent(tenant.environmentId, 'inquiry.approved'),
      await seedEvent(tenant.environmentId, 'inquiry.completed', { simulated: true }),
    ];
  });

  async function list(query = '', token = tenant.token) {
    const response = await api.app.inject({ url: `${LIST}?${query}`, headers: bearer(token) });
    return eventListDocumentSchema.parse(expectStatus(response, 200));
  }

  const ids = (document: { data: EventResource[] }) => document.data.map((event) => event.id);
  const seeded = (...indexes: number[]) => indexes.map((index) => events[index]?.id);

  it('lists real events newest first, leaving simulated ones out by default', async () => {
    const document = await list();

    expect(ids(document)).toEqual(seeded(2, 1, 0));
    expect(document.data.every((event) => event.attributes.simulated === false)).toBe(true);
    expect(document.links.next).toBeNull();
  });

  it('lists simulated events on request', async () => {
    expect(ids(await list('filter[simulated]=true'))).toEqual(seeded(3));
    expect(ids(await list('filter[simulated]=false'))).toEqual(seeded(2, 1, 0));
  });

  it.each([
    ['filter[name]=inquiry.completed', [1]],
    ['filter[name]=inquiry.created,inquiry.approved', [2, 0]],
  ])('filters with %s', async (query, expected) => {
    expect(ids(await list(query))).toEqual(seeded(...expected));
  });

  it("filters by the payload's object", async () => {
    expect(ids(await list(`filter[object-id]=${inquiryId}`))).toEqual(seeded(1, 0));
  });

  it('filters by creation time', async () => {
    const future = encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString());
    const past = encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString());

    expect(await list(`filter[created-at-start]=${future}`)).toMatchObject({ data: [] });
    expect(
      ids(await list(`filter[created-at-start]=${past}&filter[created-at-end]=${future}`)),
    ).toEqual(seeded(2, 1, 0));
  });

  it('pages with page[size], keeping the filters in links.next', async () => {
    const first = await list('filter[name]=inquiry.created,inquiry.completed&page[size]=1');
    const next = first.links.next ?? '';
    const second = eventListDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: next, headers: bearer(tenant.token) }), 200),
    );

    expect(ids(first)).toEqual(seeded(1));
    expect(next).toContain('filter[name]=inquiry.created%2Cinquiry.completed');
    expect(ids(second)).toEqual(seeded(0));
  });

  it.each([
    'filter[name]=inquiry.nonsense',
    'filter[simulated]=yes',
    'filter[object-id]=nope',
    'page[after]=inq_01M5CJXHG07XPHF3HRM6NREDH7',
  ])('answers 400 for %s', async (query) => {
    const response = await api.app.inject({
      url: `${LIST}?${query}`,
      headers: bearer(tenant.token),
    });

    expect(response.statusCode).toBe(400);
  });

  it("never lists another environment's events", async () => {
    const other = await api.newTenant();

    expect((await list('', other.token)).data).toEqual([]);
  });

  it('masks payload fields for a user without pii:view', async () => {
    const event = await seedEvent(tenant.environmentId, 'inquiry.failed', {
      fields: { name_last: 'Synthetic-Doe' },
    });
    const token = api.newUserToken(tenant.environmentId, { permissions: ['events:read'] });

    const response = await api.app.inject({
      url: `${LIST}?filter[name]=inquiry.failed`,
      headers: bearer(token),
    });

    const document = eventListDocumentSchema.parse(expectStatus(response, 200));
    expect(ids(document)).toEqual([event.id]);
    expect(response.body).not.toContain('Synthetic-Doe');
  });

  it('answers 403 forbidden without events:read', async () => {
    const token = await api.newApiKey(tenant.environmentId, { scopes: ['inquiries:read'] });

    expect((await api.app.inject({ url: LIST, headers: bearer(token) })).statusCode).toBe(403);
  });
});

describe('GET /api/v1/events?filter[inquiry-id]= (C25.7, Workflow 2E)', () => {
  /** An inquiry with a verification and a session, and one event about each (oldest first). */
  async function timeline(tenant: TestTenant) {
    const inquiryId = await createInquiry(api, { token: tenant.token });
    const verification = await seedVerification(api, tenant.environmentId, inquiryId);
    await resumeInquiry(api, inquiryId, tenant.token);
    const [session] = (
      await listInquirySessions(api.database.db, tenant.environmentId, { inquiryId })
    ).items;
    // Inquiry events carry the inquiry; the others carry the C16 stub, a valid stored payload.
    const stub = (type: string, id: string) => ({
      data: { type, id, attributes: { 'redacted-at': '2026-10-21T00:00:00.000Z' } },
    });
    const event = (name: string, payload: Record<string, unknown>) =>
      createEvent(api.database.db, tenant.environmentId, { id: newId('evt'), name, payload });
    return {
      inquiryId,
      events: [
        await event('inquiry.created', inquiryPayload(inquiryId)),
        await event('inquiry-session.started', stub('inquiry-session', session?.id ?? '')),
        await event('verification.created', stub('verification/government-id', verification.id)),
        await event('inquiry.completed', inquiryPayload(inquiryId)),
      ],
    };
  }

  const ids = (document: { data: EventResource[] }) => document.data.map((event) => event.id);

  async function list(query: string, token: string) {
    return eventListDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: `${LIST}?${query}`, headers: bearer(token) }), 200),
    );
  }

  it('lists the events of the inquiry, its verifications and its sessions, newest first', async () => {
    const tenant = await api.newTenant();
    const own = await timeline(tenant);
    const other = await timeline(tenant);

    const document = await list(`filter[inquiry-id]=${own.inquiryId}`, tenant.token);
    const both = await list(`filter[inquiry-id]=${own.inquiryId},${other.inquiryId}`, tenant.token);

    expect(ids(document)).toEqual(own.events.map(({ id }) => id).reverse());
    expect(ids(both)).toEqual([...own.events, ...other.events].map(({ id }) => id).reverse());
  });

  it('combines with the other filters and keeps them all in links.next', async () => {
    const tenant = await api.newTenant();
    const { inquiryId, events } = await timeline(tenant);
    await timeline(tenant);
    const [created, started, verified, completed] = events.map(({ id }) => id);

    const named = await list(
      `filter[inquiry-id]=${inquiryId}&filter[name]=inquiry.created,verification.created`,
      tenant.token,
    );
    const first = await list(`filter[inquiry-id]=${inquiryId}&page[size]=2`, tenant.token);
    const next = first.links.next ?? '';
    const second = eventListDocumentSchema.parse(
      expectStatus(await api.app.inject({ url: next, headers: bearer(tenant.token) }), 200),
    );

    expect(ids(named)).toEqual([verified, created]);
    expect(ids(first)).toEqual([completed, verified]);
    expect(next).toContain(`filter[inquiry-id]=${inquiryId}`);
    expect(ids(second)).toEqual([started, created]);
  });

  it("lists nothing for another environment's inquiry", async () => {
    const tenant = await api.newTenant();
    const { inquiryId } = await timeline(tenant);
    const other = await api.newTenant();
    await timeline(other);

    expect((await list(`filter[inquiry-id]=${inquiryId}`, other.token)).data).toEqual([]);
  });

  it.each(['filter[inquiry-id]=nope', `filter[inquiry-id]=${newId('ver')}`])(
    'answers 400 for %s',
    async (query) => {
      const response = await api.app.inject({
        url: `${LIST}?${query}`,
        headers: bearer(api.token),
      });

      expect(response.statusCode).toBe(400);
    },
  );

  it('answers 403 forbidden without events:read', async () => {
    const token = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    const response = await api.app.inject({
      url: `${LIST}?filter[inquiry-id]=${newId('inq')}`,
      headers: bearer(token),
    });

    expect(response.statusCode).toBe(403);
  });
});
