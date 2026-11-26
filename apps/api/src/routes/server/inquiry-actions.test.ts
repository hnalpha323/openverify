/**
 * C10 inquiry status actions: approve, decline, mark-for-review, expire, the sandbox-only
 * perform-simulate-actions, and redact.
 */
import { eventPayloadSchema, inquiryDocumentSchema, newId } from '@openverify/contracts';
import type { InquiryStatus } from '@openverify/core';
import { getInquiry, redactInquiryRecords, transitionInquiryStatus } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  PROBLEM_JSON,
  resumeInquiry,
  seedVerification,
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

/** The path the state machine takes from `created` to each status. */
const PATHS: Record<InquiryStatus, InquiryStatus[]> = {
  created: [],
  pending: ['pending'],
  completed: ['pending', 'completed'],
  failed: ['pending', 'failed'],
  needs_review: ['pending', 'completed', 'needs_review'],
  approved: ['pending', 'completed', 'approved'],
  declined: ['pending', 'failed', 'declined'],
  expired: ['expired'],
};

/** An inquiry of `environmentId` moved to `status` directly in the database. */
async function inquiryIn(
  status: InquiryStatus,
  tenant: { token: string; environmentId: string } = api,
): Promise<string> {
  const id = await createInquiry(api, { token: tenant.token });
  let from: InquiryStatus = 'created';
  for (const to of PATHS[status]) {
    await transitionInquiryStatus(api.database.db, tenant.environmentId, id, { from, to });
    from = to;
  }
  return id;
}

function action(id: string, name: string, token = api.token, payload?: unknown) {
  return api.app.inject({
    method: 'POST',
    url: `${BASE}/${id}/${name}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const eventsAbout = (id: string) =>
  api.events.events.filter((event) => event.payload.data.id === id);

const namesAbout = (id: string) => eventsAbout(id).map((event) => event.name);

const auditsAbout = (id: string) => api.audit.entries.filter((entry) => entry.resourceId === id);

/** `inquiry-session.*` events about the sessions of `inquiryId`. */
const sessionEvents = (name: string, inquiryId: string) =>
  api.events.named(name).filter((event) => {
    const { data } = event.payload;
    return data.type === 'inquiry-session' && data.relationships.inquiry.data.id === inquiryId;
  });

describe.each([
  ['approve', 'approved', 'inquiry.approved', ['completed', 'failed', 'needs_review']],
  ['decline', 'declined', 'inquiry.declined', ['completed', 'failed', 'needs_review']],
  ['mark-for-review', 'needs_review', 'inquiry.marked-for-review', ['completed', 'failed']],
] as const)('POST /api/v1/inquiries/:id/%s', (name, to, eventName, sources) => {
  it.each(sources)(`moves a %s inquiry to ${to}`, async (from) => {
    const id = await inquiryIn(from);

    const response = await action(id, name);

    const document = inquiryDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.attributes.status).toBe(to);
    expect((await getInquiry(api.database.db, api.environmentId, id))?.status).toBe(to);
  });

  it('emits its event and inquiry.transitioned with { from, to }, and audits the principal', async () => {
    const [from] = sources;
    const id = await inquiryIn(from);
    const userId = newId('usr');
    const before = { events: eventsAbout(id).length, audit: auditsAbout(id).length };

    expectStatus(await action(id, name, api.newUserToken(api.environmentId, { userId })), 200);

    const events = eventsAbout(id).slice(before.events);
    expect(events.map((event) => event.name)).toEqual([eventName, 'inquiry.transitioned']);
    for (const event of events) {
      expect(event.environmentId).toBe(api.environmentId);
      expect(eventPayloadSchema.parse(event.payload).data).toMatchObject({
        type: 'inquiry',
        id,
        attributes: { status: to },
      });
    }
    expect(events[1]?.payload.meta).toEqual({ from, to });
    expect(auditsAbout(id).slice(before.audit)).toEqual([
      expect.objectContaining({
        action: eventName,
        actor: { type: 'user', id: userId },
        resourceType: 'inquiry',
        resourceId: id,
        environmentId: api.environmentId,
        organizationId: api.organizationId,
        metadata: { from, to },
      }),
    ]);
  });

  it.each(['created', 'pending', 'expired', 'approved'] as const)(
    'answers 409 invalid-transition from %s, changing nothing',
    async (from) => {
      const id = await inquiryIn(from);
      const before = eventsAbout(id).length;
      const audited = auditsAbout(id).length;

      const response = await action(id, name);

      expect(response.statusCode).toBe(409);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
      expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
      expect((await getInquiry(api.database.db, api.environmentId, id))?.status).toBe(from);
      expect(eventsAbout(id)).toHaveLength(before);
      expect(auditsAbout(id)).toHaveLength(audited);
    },
  );

  it('changes nothing when its events cannot be written', async () => {
    const id = await inquiryIn(sources[0]);
    const audited = auditsAbout(id).length;
    api.events.failNext(new Error('event store unavailable'));

    const response = await action(id, name);

    expect(response.statusCode).toBe(500);
    expect((await getInquiry(api.database.db, api.environmentId, id))?.status).toBe(sources[0]);
    expect(auditsAbout(id)).toHaveLength(audited);
  });

  it('accepts an empty meta and refuses unknown members', async () => {
    const id = await inquiryIn(sources[0]);

    expect((await action(id, name, api.token, { meta: { reason: 'x' } })).statusCode).toBe(400);
    expectStatus(await action(id, name, api.token, { meta: {} }), 200);
  });

  it('answers 404 for an inquiry of another environment', async () => {
    const other = await api.newTenant();
    const foreign = await inquiryIn(sources[0], other);

    const response = await action(foreign, name);

    expect(response.statusCode).toBe(404);
    expect((await getInquiry(api.database.db, other.environmentId, foreign))?.status).toBe(
      sources[0],
    );
  });

  it('answers 403 forbidden without inquiries:write', async () => {
    const id = await inquiryIn(sources[0]);
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    const response = await action(id, name, reader);

    expect(response.statusCode).toBe(403);
    expect(response.json<{ type: string }>().type).toBe(
      'https://openverify.dev/problems/forbidden',
    );
  });

  it('records decisioned-at when it approves or declines', async () => {
    const id = await inquiryIn(sources[0]);

    const document = expectStatus(await action(id, name), 200);

    expect(document.data.attributes['decisioned-at']).toBe(
      to === 'needs_review' ? null : api.clock.now().toISOString(),
    );
  });
});

describe('POST /api/v1/inquiries/:id/expire', () => {
  it.each(['created', 'pending'] as const)('expires a %s inquiry', async (from) => {
    const id = await inquiryIn(from);

    const document = expectStatus(await action(id, 'expire'), 200);

    expect(document.data.attributes.status).toBe('expired');
    expect(namesAbout(id).slice(-2)).toEqual(['inquiry.expired', 'inquiry.transitioned']);
    expect(api.audit.withAction('inquiry.expired').map((entry) => entry.resourceId)).toContain(id);
  });

  it('cancels the active sessions and the initiated verifications, with their events', async () => {
    const id = await createInquiry(api);
    const first = await resumeInquiry(api, id);
    await resumeInquiry(api, id);
    const initiated = await seedVerification(api, api.environmentId, id, { files: ['front'] });
    const submitted = await seedVerification(api, api.environmentId, id, {
      type: 'selfie',
      status: 'submitted',
    });

    expectStatus(await action(id, 'expire'), 200);

    const { rows: sessions } = await api.database.client.query<{ status: string }>(
      'select status from inquiry_sessions where inquiry_id = $1',
      [id],
    );
    expect(sessions.map((row) => row.status)).toEqual(['canceled', 'canceled']);
    const { rows: verifications } = await api.database.client.query<{
      id: string;
      status: string;
    }>('select id, status from verifications where inquiry_id = $1 order by id', [id]);
    expect(Object.fromEntries(verifications.map((row) => [row.id, row.status]))).toEqual({
      [initiated.id]: 'canceled',
      [submitted.id]: 'submitted',
    });

    const canceledSessions = sessionEvents('inquiry-session.canceled', id);
    expect(canceledSessions).toHaveLength(2);
    for (const event of canceledSessions) {
      expect(eventPayloadSchema.parse(event.payload).data).toMatchObject({
        type: 'inquiry-session',
        attributes: { status: 'canceled' },
      });
    }
    const [canceledVerification, ...others] = api.events
      .named('verification.canceled')
      .filter((event) => event.payload.data.id === initiated.id);
    expect(others).toEqual([]);
    expect(eventPayloadSchema.parse(canceledVerification?.payload).data).toMatchObject({
      type: 'verification/government-id',
      id: initiated.id,
      attributes: { status: 'canceled' },
      relationships: { files: { data: [{ type: 'file', id: initiated.fileIds[0] }] } },
    });

    const flow = await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(first) });
    expect(flow.statusCode).toBe(401);
    expect(flow.json<{ code: string }>().code).toBe('session_canceled');
  });

  it.each(['completed', 'failed', 'expired', 'needs_review'] as const)(
    'answers 409 invalid-transition for a %s inquiry',
    async (from) => {
      const id = await inquiryIn(from);

      const response = await action(id, 'expire');

      expect(response.statusCode).toBe(409);
      expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
    },
  );

  it('answers 404 across environments and 403 without inquiries:write', async () => {
    const other = await api.newTenant();
    const foreign = await inquiryIn('created', other);
    const id = await inquiryIn('created');
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    expect((await action(foreign, 'expire')).statusCode).toBe(404);
    expect((await action(id, 'expire', reader)).statusCode).toBe(403);
  });
});

describe('POST /api/v1/inquiries/:id/perform-simulate-actions', () => {
  const simulate = (id: string, types: string[], token = api.token) =>
    action(id, 'perform-simulate-actions', token, {
      meta: { actions: types.map((type) => ({ type })) },
    });

  it('runs the actions in order through the normal transitions in sandbox', async () => {
    const id = await createInquiry(api);
    await resumeInquiry(api, id);

    const document = expectStatus(
      await simulate(id, ['start_inquiry', 'complete_inquiry', 'approve_inquiry']),
      200,
    );

    expect(document.data.attributes.status).toBe('approved');
    expect(namesAbout(id)).toEqual([
      'inquiry.created',
      'inquiry.started',
      'inquiry.transitioned',
      'inquiry.completed',
      'inquiry.transitioned',
      'inquiry.approved',
      'inquiry.transitioned',
    ]);
    expect(sessionEvents('inquiry-session.canceled', id)).toHaveLength(1);
    expect(
      api.audit.entries
        .filter((entry) => entry.resourceId === id)
        .map((entry) => [entry.action, entry.metadata]),
    ).toEqual([
      ['inquiry.created', undefined],
      ['inquiry.resumed', { 'inquiry-session-id': expect.stringMatching(/^iqse_/) as unknown }],
      ['inquiry.started', { from: 'created', to: 'pending', simulated: true }],
      ['inquiry.completed', { from: 'pending', to: 'completed', simulated: true }],
      ['inquiry.approved', { from: 'completed', to: 'approved', simulated: true }],
    ]);
  });

  it.each([
    ['fail_inquiry', 'failed'],
    ['expire_inquiry', 'expired'],
  ] as const)('supports %s', async (type, status) => {
    const id = await createInquiry(api);
    const steps = type === 'fail_inquiry' ? ['start_inquiry', type] : [type];

    expect(expectStatus(await simulate(id, steps), 200).data.attributes.status).toBe(status);
  });

  it('supports decline_inquiry and mark_for_review_inquiry', async () => {
    const id = await inquiryIn('failed');

    const document = expectStatus(
      await simulate(id, ['mark_for_review_inquiry', 'decline_inquiry']),
      200,
    );

    expect(document.data.attributes.status).toBe('declined');
  });

  it('answers 409 invalid-transition and changes nothing when any action is not allowed', async () => {
    const id = await createInquiry(api);
    const before = eventsAbout(id).length;

    const response = await simulate(id, ['start_inquiry', 'approve_inquiry']);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe(INVALID_TRANSITION);
    expect((await getInquiry(api.database.db, api.environmentId, id))?.status).toBe('created');
    expect(eventsAbout(id)).toHaveLength(before);
  });

  it('answers 403 sandbox-only in production', async () => {
    const production = await api.newTenant({ kind: 'production' });
    const id = await createInquiry(api, { token: production.token });

    const response = await simulate(id, ['start_inquiry'], production.token);

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ type: string }>().type).toBe(
      'https://openverify.dev/problems/sandbox-only',
    );
    expect((await getInquiry(api.database.db, production.environmentId, id))?.status).toBe(
      'created',
    );
  });

  it.each([
    ['no actions', { meta: { actions: [] } }],
    ['an unknown action', { meta: { actions: [{ type: 'teleport_inquiry' }] } }],
    ['no body', undefined],
  ])('rejects %s', async (_label, payload) => {
    const id = await createInquiry(api);

    expect((await action(id, 'perform-simulate-actions', api.token, payload)).statusCode).toBe(400);
  });

  it('answers 404 across environments and 403 without inquiries:write', async () => {
    const other = await api.newTenant();
    const foreign = await createInquiry(api, { token: other.token });
    const id = await createInquiry(api);
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    expect((await simulate(foreign, ['start_inquiry'])).statusCode).toBe(404);
    expect((await simulate(id, ['start_inquiry'], reader)).statusCode).toBe(403);
  });
});

describe('POST /api/v1/inquiries/:id/redact', () => {
  it('delegates to the redaction service with the principal as actor', async () => {
    const id = await inquiryIn('completed');
    const userId = newId('usr');
    const token = api.newUserToken(api.environmentId, { userId });

    const document = inquiryDocumentSchema.parse(
      expectStatus(await action(id, 'redact', token), 200),
    );

    expect(document.data.id).toBe(id);
    expect(api.redaction.redactions.filter((call) => call.id === id)).toEqual([
      {
        target: 'inquiry',
        id,
        actor: { type: 'user', id: userId },
        ctx: expect.objectContaining({
          environmentId: api.environmentId,
          organizationId: api.organizationId,
        }) as unknown,
      },
    ]);
  });

  it('requires inquiries:redact', async () => {
    const id = await inquiryIn('completed');
    const writer = api.newUserToken(api.environmentId, { permissions: ['inquiries:write'] });

    const response = await action(id, 'redact', writer);

    expect(response.statusCode).toBe(403);
    expect(response.headers['www-authenticate']).toContain('scope="inquiries:redact"');
    expect(api.redaction.redactions.filter((call) => call.id === id)).toEqual([]);
  });

  it('answers 410 redacted to new sessions and one-time links for a redacted open inquiry (2B F018)', async () => {
    const id = await inquiryIn('pending');
    await redactInquiryRecords(api.database.db, api.environmentId, id);

    for (const name of ['resume', 'generate-one-time-link']) {
      const response = await action(id, name);
      expect(response.statusCode, `${name}: ${response.body}`).toBe(410);
      expect(response.json<{ type: string }>().type).toBe(
        'https://openverify.dev/problems/redacted',
      );
    }
  });

  it('answers 404 for an inquiry of another environment without redacting it', async () => {
    const other = await api.newTenant();
    const foreign = await inquiryIn('completed', other);

    expect((await action(foreign, 'redact')).statusCode).toBe(404);
    expect(api.redaction.redactions.filter((call) => call.id === foreign)).toEqual([]);
  });
});

describe('OpenAPI', () => {
  it('documents every C10 and C11 route of the inquiries area', async () => {
    await api.app.ready();
    const document = api.app.swagger() as { paths: Record<string, Record<string, unknown>> };

    const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations).toEqual(
      expect.arrayContaining([
        'PATCH /api/v1/inquiries/{id}',
        'POST /api/v1/inquiries/{id}/approve',
        'POST /api/v1/inquiries/{id}/decline',
        'POST /api/v1/inquiries/{id}/mark-for-review',
        'POST /api/v1/inquiries/{id}/expire',
        'POST /api/v1/inquiries/{id}/add-tag',
        'POST /api/v1/inquiries/{id}/remove-tag',
        'POST /api/v1/inquiries/{id}/set-tags',
        'POST /api/v1/inquiries/{id}/generate-one-time-link',
        'POST /api/v1/inquiries/{id}/perform-simulate-actions',
        'POST /api/v1/inquiries/{id}/redact',
        'GET /api/v1/inquiry-sessions',
        'GET /api/v1/inquiry-sessions/{id}',
        'POST /api/v1/inquiry-sessions/{id}/expire',
        'POST /api/v1/inquiry-sessions/expire-all',
        'POST /api/v1/inquiry-template-versions',
        'GET /api/v1/inquiry-template-versions',
        'GET /api/v1/inquiry-template-versions/{id}',
        'PATCH /api/v1/inquiry-template-versions/{id}',
        'POST /api/v1/inquiry-template-versions/{id}/publish',
        'PATCH /api/v1/inquiry-templates/{id}',
        'POST /api/v1/flow/one-time-links/redeem',
      ]),
    );
  });
});
