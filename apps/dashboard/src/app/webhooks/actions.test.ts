// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_IDS,
  createdWebhookResource,
  webhookResource,
  webhookSecret,
} from '../../components/integrations/testing-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  archiveWebhook,
  cloneWebhook,
  createWebhook,
  disableWebhook,
  enableWebhook,
  replayWebhookEvents,
  rotateWebhookSecret,
  simulateWebhookEvent,
  updateWebhook,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { webhook: WEBHOOK, clonedWebhook: CLONE, event: EVENT } = INTEGRATION_IDS;
const WRITER = meDocument({ permissions: ['webhooks:read', 'webhooks:write'] });
const READER = meDocument({ permissions: ['webhooks:read'] });

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

const NEW_WEBHOOK = {
  // The new webhook page renders the session environment's id (Workflow 2D F002).
  'environment-id': ENVIRONMENTS.sandbox.id,
  // C169.5: the console names every new webhook.
  name: 'Fulfilment',
  url: 'https://hooks.example.test/openverify',
  'enabled-events': ['inquiry.approved'],
  'api-version': '2026-10-01',
  'inquiry-template-ids': INTEGRATION_IDS.template,
  'header-name': 'Authorization',
  'header-value': 'Bearer change-me-synthetic',
};

describe('createWebhook', () => {
  it('creates the webhook and answers its id and secret, once', async () => {
    const secret = webhookSecret();
    api.reply(200, WRITER).reply(201, { data: createdWebhookResource(WEBHOOK, secret) });

    await expect(createWebhook(null, form(NEW_WEBHOOK))).resolves.toEqual({
      ok: true,
      data: { id: WEBHOOK, secret },
    });

    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/webhooks',
      body: {
        data: {
          type: 'webhook',
          attributes: {
            url: 'https://hooks.example.test/openverify',
            'enabled-events': ['inquiry.approved'],
            'api-version': '2026-10-01',
            filters: { 'inquiry-template-ids': [INTEGRATION_IDS.template] },
            'attribute-blocklist': [],
            'custom-headers': { Authorization: 'Bearer change-me-synthetic' },
          },
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/webhooks');
  });

  it('points at the fields to correct, without calling the API', async () => {
    api.reply(200, WRITER);

    const result = await createWebhook(
      null,
      form({
        'environment-id': ENVIRONMENTS.sandbox.id,
        url: 'ftp://hooks.example.test',
        'enabled-events': [],
      }),
    );

    expect(result).toMatchObject({ ok: false, problem: { title: 'Check the values you entered' } });
    const pointers = result.ok ? [] : (result.problem.errors ?? []).map((error) => error.pointer);
    expect(pointers).toEqual(
      expect.arrayContaining(['/data/attributes/url', '/data/attributes/enabled-events']),
    );
    expect(api.requests).toHaveLength(1);
  });

  it("shows the API's refusal", async () => {
    api.reply(200, WRITER).replyProblem(422, undefined, {
      title: 'Unprocessable Content',
      errors: [{ pointer: '/data/attributes/url', detail: 'must not be a private address' }],
    });

    await expect(createWebhook(null, form(NEW_WEBHOOK))).resolves.toMatchObject({
      ok: false,
      problem: {
        title: 'Unprocessable Content',
        errors: [{ pointer: '/data/attributes/url', detail: 'must not be a private address' }],
      },
    });
  });

  it('creates nothing when the session switched environment after the form was rendered (Workflow 2D F002)', async () => {
    api.reply(
      200,
      meDocument({
        permissions: ['webhooks:read', 'webhooks:write'],
        environment: ENVIRONMENTS.production,
      }),
    );

    await expect(createWebhook(null, form(NEW_WEBHOOK))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'The environment changed' },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('refuses an operator without webhooks:write, without calling the API', async () => {
    api.reply(200, READER);

    await expect(createWebhook(null, form(NEW_WEBHOOK))).resolves.toMatchObject({
      ok: false,
      problem: { title: 'You do not have access' },
    });
    expect(api.requests).toHaveLength(1);
  });
});

describe('updateWebhook', () => {
  it('saves the changes, keeping the stored headers, then opens the webhook', async () => {
    api.reply(200, WRITER).reply(200, { data: webhookResource() });

    await expect(
      redirectTarget(updateWebhook(null, form({ ...NEW_WEBHOOK, 'webhook-id': WEBHOOK }))),
    ).resolves.toBe(`/webhooks/${WEBHOOK}`);

    const { body } = api.last() as { body: { data: { attributes: Record<string, unknown> } } };
    expect(api.last()).toMatchObject({ method: 'PATCH', path: `/api/v1/webhooks/${WEBHOOK}` });
    expect(body.data.attributes).not.toHaveProperty('custom-headers');
    expect(body.data.attributes.filters).toEqual({
      'inquiry-template-ids': [INTEGRATION_IDS.template],
    });
  });

  it('replaces the headers when the operator asks to, even with none', async () => {
    api.reply(200, WRITER).reply(200, { data: webhookResource() });

    await redirectTarget(
      updateWebhook(
        null,
        form({
          url: NEW_WEBHOOK.url,
          'enabled-events': '*',
          'webhook-id': WEBHOOK,
          'replace-custom-headers': 'true',
        }),
      ),
    );

    expect(api.last().body).toMatchObject({
      data: { attributes: { 'enabled-events': ['*'], 'custom-headers': {} } },
    });
  });

  it('refuses a malformed webhook id', async () => {
    api.reply(200, WRITER);

    await expect(
      updateWebhook(null, form({ ...NEW_WEBHOOK, 'webhook-id': 'wbh_nope' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/webhook-id' }] } });
    expect(api.requests).toHaveLength(1);
  });

  it("shows the API's refusal of an archived webhook", async () => {
    api.reply(200, WRITER).replyProblem(409, 'invalid-transition');

    await expect(
      updateWebhook(null, form({ ...NEW_WEBHOOK, 'webhook-id': WEBHOOK })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'Synthetic invalid-transition' } });
  });
});

describe('status changes', () => {
  it.each([
    ['enable', enableWebhook],
    ['disable', disableWebhook],
    ['archive', archiveWebhook],
  ] as const)('%ss the webhook', async (name, action) => {
    api.reply(200, WRITER).reply(200, { data: webhookResource() });

    await expect(action(null, form({ 'webhook-id': WEBHOOK }))).resolves.toEqual({
      ok: true,
      data: undefined,
    });

    expect(api.last()).toMatchObject({
      method: 'POST',
      path: `/api/v1/webhooks/${WEBHOOK}/${name}`,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/webhooks/${WEBHOOK}`);
  });
});

describe('cloneWebhook', () => {
  it("answers the clone's id and its new secret", async () => {
    const secret = webhookSecret('c', 'Cl0n');
    api.reply(200, WRITER).reply(201, { data: createdWebhookResource(CLONE, secret) });

    await expect(cloneWebhook(null, form({ 'webhook-id': WEBHOOK }))).resolves.toEqual({
      ok: true,
      data: { id: CLONE, secret },
    });
    expect(api.last().path).toBe(`/api/v1/webhooks/${WEBHOOK}/clone`);
  });
});

describe('rotateWebhookSecret', () => {
  it('rotates with the overlap and answers the new secret and when the old one stops', async () => {
    const secret = webhookSecret('r', 'R0ta');
    api.reply(200, WRITER).reply(200, {
      data: createdWebhookResource(WEBHOOK, secret),
      meta: { 'previous-secret-expires-at': '2026-10-21T04:35:00.000Z' },
    });

    await expect(
      rotateWebhookSecret(
        null,
        form({ 'webhook-id': WEBHOOK, 'previous-secret-expires-in-seconds': '3600' }),
      ),
    ).resolves.toEqual({
      ok: true,
      data: { secret, previousSecretExpiresAt: '2026-10-21T04:35:00.000Z' },
    });
    expect(api.last()).toMatchObject({
      path: `/api/v1/webhooks/${WEBHOOK}/rotate-secret`,
      body: { meta: { 'previous-secret-expires-in-seconds': 3600 } },
    });
  });

  it("uses the API's default overlap when none is given", async () => {
    api.reply(200, WRITER).reply(200, {
      data: createdWebhookResource(),
      meta: { 'previous-secret-expires-at': '2026-10-21T04:35:00.000Z' },
    });

    await rotateWebhookSecret(
      null,
      form({ 'webhook-id': WEBHOOK, 'previous-secret-expires-in-seconds': ' ' }),
    );

    expect(api.last().body).toEqual({});
  });

  it('refuses an overlap out of range, without calling the API', async () => {
    api.reply(200, WRITER);

    await expect(
      rotateWebhookSecret(
        null,
        form({ 'webhook-id': WEBHOOK, 'previous-secret-expires-in-seconds': '604801' }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/meta/previous-secret-expires-in-seconds' }] },
    });
    expect(api.requests).toHaveLength(1);
  });
});

describe('simulateWebhookEvent', () => {
  it('sends a sample event and answers its id', async () => {
    api.reply(200, WRITER).reply(200, { data: webhookResource(), meta: { 'event-id': EVENT } });

    await expect(
      simulateWebhookEvent(null, form({ 'webhook-id': WEBHOOK, 'event-name': 'inquiry.approved' })),
    ).resolves.toEqual({ ok: true, data: { eventId: EVENT } });
    expect(api.last()).toMatchObject({
      path: `/api/v1/webhooks/${WEBHOOK}/simulate`,
      body: { meta: { 'event-name': 'inquiry.approved' } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/webhooks/${WEBHOOK}`);
  });

  it('refuses an unknown event', async () => {
    api.reply(200, WRITER);

    await expect(
      simulateWebhookEvent(null, form({ 'webhook-id': WEBHOOK, 'event-name': 'inquiry.lost' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/meta/event-name' }] },
    });
  });
});

describe('replayWebhookEvents', () => {
  it('replays the events named by id and answers how many', async () => {
    api.reply(200, WRITER).reply(200, { data: webhookResource(), meta: { 'replayed-count': 1 } });

    await expect(
      replayWebhookEvents(
        null,
        form({ 'webhook-id': WEBHOOK, 'replay-by': 'event-ids', 'event-ids': EVENT }),
      ),
    ).resolves.toEqual({ ok: true, data: { replayedCount: 1 } });
    expect(api.last()).toMatchObject({
      path: `/api/v1/webhooks/${WEBHOOK}/replay`,
      body: { meta: { 'event-ids': [EVENT] } },
    });
  });

  it('points at the field to correct', async () => {
    api.reply(200, WRITER);

    await expect(
      replayWebhookEvents(null, form({ 'webhook-id': WEBHOOK, 'replay-by': 'event-ids' })),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/meta/event-ids', detail: 'Enter at least one event ID.' }] },
    });
    expect(api.requests).toHaveLength(1);
  });
});

describe('createWebhook: a name is required for a new webhook (C169.5)', () => {
  it('refuses a new webhook without a name, without calling the API', async () => {
    api.reply(200, WRITER);

    await expect(createWebhook(null, form({ ...NEW_WEBHOOK, name: ' ' }))).resolves.toMatchObject({
      ok: false,
      problem: {
        errors: [{ pointer: '/data/attributes/name', detail: 'Give the webhook a name.' }],
      },
    });
    expect(api.requests).toHaveLength(1);
  });

  it('sends the name', async () => {
    api.reply(200, WRITER).reply(201, { data: createdWebhookResource(WEBHOOK, webhookSecret()) });

    await createWebhook(null, form(NEW_WEBHOOK));

    expect(api.last().body).toMatchObject({ data: { attributes: { name: 'Fulfilment' } } });
  });
});
