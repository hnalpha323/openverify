import {
  buildAccountResource,
  buildInquiryResource,
  buildInquirySessionResource,
  buildVerificationResource,
  defaultInquiryTemplateAttributes,
  newId,
  newWebhookSecret,
  type EventName,
  type EventPayload,
} from '@openverify/contracts';
import {
  createInquiry,
  createInquiryTemplate,
  createWebhook,
  getEvent,
  getWebhookDelivery,
  listDueWebhookDeliveries,
  type Db,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createCapturingLogger, createRecordingQueue } from '../jobs/testing.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../webhooks/queue.js';
import { createEventPublisher } from './index.js';

const at = new Date('2026-10-20T12:00:00.000Z');

function verificationPayload(): EventPayload {
  return {
    data: buildVerificationResource({
      id: newId('ver'),
      type: 'selfie',
      status: 'passed',
      inquiryId: newId('inq'),
      fileIds: [newId('file')],
      checks: [
        {
          name: 'selfie_multiple_faces_detection',
          status: 'passed',
          reasons: [],
          required: true,
          metadata: { face_count: 1 },
        },
      ],
      createdAt: at,
      updatedAt: at,
    }),
  };
}

const defaults = defaultInquiryTemplateAttributes();

function inquiryRecord() {
  return {
    id: newId('inq'),
    status: 'completed' as const,
    referenceId: 'ref-synthetic-1',
    fields: { name_first: 'Synthetic' },
    inquiryTemplateId: newId('itmpl'),
    verifications: [],
    createdAt: at,
    updatedAt: at,
  };
}

function inquiryPayload(): EventPayload {
  return { data: buildInquiryResource(inquiryRecord()) };
}

let database: TestDatabase;
let db: Db;
let environmentId: string;
let otherEnvironmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
  otherEnvironmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function addWebhook(environment: string, enabledEvents: string[], status = 'enabled') {
  return createWebhook(db, environment, {
    id: newId('wbh'),
    url: 'https://hooks.example.test/openverify',
    enabledEvents,
    secret: newWebhookSecret(),
    status: status as 'enabled' | 'disabled',
  });
}

function setup() {
  const queue = createRecordingQueue<WebhookDeliveryJob>();
  const logger = createCapturingLogger();
  const publisher = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(queue),
    logger,
  });
  return { queue, logger, publisher };
}

describe('createEventPublisher', () => {
  let subscribedByName: string;
  let subscribedToAll: string;

  beforeEach(async () => {
    await db.execute('delete from webhooks');
    subscribedByName = (await addWebhook(environmentId, ['verification.passed'])).id;
    subscribedToAll = (await addWebhook(environmentId, ['*'])).id;
    await addWebhook(environmentId, ['inquiry.completed']);
    await addWebhook(environmentId, ['*'], 'disabled');
    await addWebhook(otherEnvironmentId, ['*']);
  });

  it('writes the event with its C5 payload and returns its id', async () => {
    const { publisher } = setup();
    const payload = verificationPayload();
    const eventId = await publisher.publish({
      environmentId,
      name: 'verification.passed',
      payload,
    });

    expect(eventId).toMatch(/^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
    const stored = await getEvent(db, environmentId, eventId);
    expect(stored).toMatchObject({ id: eventId, name: 'verification.passed', payload });
    expect(await getEvent(db, otherEnvironmentId, eventId)).toBeNull();
  });

  it('fans out to the enabled webhooks subscribed by name or "*" and enqueues each delivery', async () => {
    const { publisher, queue } = setup();
    const eventId = await publisher.publish({
      environmentId,
      name: 'verification.passed',
      payload: verificationPayload(),
    });

    expect(queue.jobs).toHaveLength(2);
    const deliveries = await Promise.all(
      queue.jobs.map((job) => getWebhookDelivery(db, environmentId, job.data.deliveryId)),
    );
    expect(deliveries.map((delivery) => delivery?.webhookId).sort()).toEqual(
      [subscribedByName, subscribedToAll].sort(),
    );
    for (const [index, delivery] of deliveries.entries()) {
      expect(delivery).toMatchObject({ eventId, status: 'pending', attemptCount: 0 });
      expect(queue.jobs[index]).toEqual({
        name: 'deliver',
        data: { environmentId, deliveryId: delivery?.id, attempt: 1 },
        options: expect.objectContaining({
          jobId: `${String(delivery?.id)}-1`,
          delay: 0,
        }) as unknown,
      });
    }
  });

  it('creates no delivery when no webhook wants the event', async () => {
    const { publisher, queue } = setup();
    await db.execute('delete from webhooks');
    await publisher.publish({ environmentId, name: 'inquiry.started', payload: inquiryPayload() });
    expect(queue.jobs).toEqual([]);
  });

  it('refuses a payload that does not match the event name, writing nothing', async () => {
    const { publisher, queue } = setup();
    const count = 'select count(*)::int as count from events';
    const before = await database.client.query(count);
    await expect(
      publisher.publish({
        environmentId,
        name: 'inquiry.completed',
        payload: verificationPayload(),
      }),
    ).rejects.toBeInstanceOf(ZodError);
    const after = await database.client.query(count);
    expect(after.rows).toEqual(before.rows);
    expect(queue.jobs).toEqual([]);
  });

  it('keeps the event and its pending deliveries when enqueueing fails, for the sweep to retry', async () => {
    const { publisher, queue, logger } = setup();
    queue.fail = new Error('connection is closed');
    const eventId = await publisher.publish({
      environmentId,
      name: 'verification.passed',
      payload: verificationPayload(),
    });

    expect(await getEvent(db, environmentId, eventId)).not.toBeNull();
    const due = await listDueWebhookDeliveries(db, { now: new Date(Date.now() + 1000) });
    expect(due.filter((delivery) => delivery.eventId === eventId)).toHaveLength(2);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        object: expect.objectContaining({ eventId }) as unknown,
      }),
    );
  });

  it('stages inside a caller transaction and dispatches only after commit', async () => {
    const { publisher, queue } = setup();
    const staged = await db.transaction((tx) =>
      publisher.stage(tx, {
        environmentId,
        name: 'verification.passed',
        payload: verificationPayload(),
      }),
    );
    expect(queue.jobs).toEqual([]);
    expect(staged.deliveries).toHaveLength(2);
    await publisher.dispatch([staged]);
    expect(queue.jobs.map((job) => job.data.deliveryId).sort()).toEqual(
      staged.deliveries.map((delivery) => delivery.deliveryId).sort(),
    );
  });

  it('leaves nothing behind when the caller transaction rolls back', async () => {
    const { publisher } = setup();
    let eventId = '';
    await expect(
      db.transaction(async (tx) => {
        eventId = (
          await publisher.stage(tx, {
            environmentId,
            name: 'verification.passed',
            payload: verificationPayload(),
          })
        ).eventId;
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await getEvent(db, environmentId, eventId)).toBeNull();
  });
});

describe('createEventPublisher with C14 filters', () => {
  const T1 = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6';
  const T2 = 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X7';
  const A1 = 'acctp_01M5CJXHZMQ72CZPQ5Y3XGC48W';
  const A2 = 'acctp_01M5CJXHZMQ72CZPQ5Y3XGC48X';

  async function hook(filters: Parameters<typeof createWebhook>[2]['filters']) {
    return (
      await createWebhook(db, environmentId, {
        id: newId('wbh'),
        url: 'https://hooks.example.test/openverify',
        enabledEvents: ['*'],
        secret: newWebhookSecret(),
        ...(filters === undefined ? {} : { filters }),
      })
    ).id;
  }

  /** The webhooks a published event fanned out to. */
  async function deliveredTo(name: EventName, payload: EventPayload): Promise<string[]> {
    const { publisher, queue } = setup();
    await publisher.publish({ environmentId, name, payload });
    const deliveries = await Promise.all(
      queue.jobs.map((job) => getWebhookDelivery(db, environmentId, job.data.deliveryId)),
    );
    return deliveries.map((delivery) => delivery?.webhookId ?? '').sort();
  }

  beforeEach(async () => {
    await db.execute('delete from webhooks');
  });

  it('delivers an inquiry event only to webhooks whose template filter matches', async () => {
    const open = await hook(undefined);
    const matching = await hook({ 'inquiry-template-ids': [T2, T1] });
    await hook({ 'inquiry-template-ids': [T2] });
    const withAccountType = await hook({ 'inquiry-template-ids': [T1], 'account-type-ids': [A2] });
    const payload = {
      data: buildInquiryResource({ ...inquiryRecord(), inquiryTemplateId: T1 }),
    };

    expect(await deliveredTo('inquiry.completed', payload)).toEqual(
      [open, matching, withAccountType].sort(),
    );
  });

  it("filters verification and inquiry-session events by their inquiry's template", async () => {
    const template = await createInquiryTemplate(db, environmentId, {
      id: newId('itmpl'),
      name: 'Synthetic template',
      version: {
        id: newId('itmplv'),
        flow: defaults.flow,
        verificationConfig: defaults['verification-config'],
      },
    });
    const inquiry = await createInquiry(db, environmentId, {
      id: newId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.latestVersion.id,
    });
    const open = await hook(undefined);
    const matching = await hook({ 'inquiry-template-ids': [template.id] });
    await hook({ 'inquiry-template-ids': [T2] });
    const verification = {
      data: buildVerificationResource({
        id: newId('ver'),
        type: 'selfie',
        status: 'passed',
        inquiryId: inquiry.id,
        fileIds: [],
        checks: [],
        createdAt: at,
        updatedAt: at,
      }),
    };
    const session = {
      data: buildInquirySessionResource({
        id: newId('iqse'),
        inquiryId: inquiry.id,
        status: 'active',
        createdAt: at,
        startedAt: at,
        expiresAt: at,
        ipAddress: null,
        userAgent: null,
      }),
    };

    expect(await deliveredTo('verification.passed', verification)).toEqual([open, matching].sort());
    expect(await deliveredTo('inquiry-session.started', session)).toEqual([open, matching].sort());
  });

  it('filters account events by account type, and template filters do not apply to them', async () => {
    const open = await hook(undefined);
    const matching = await hook({ 'account-type-ids': [A1] });
    await hook({ 'account-type-ids': [A2] });
    const byTemplate = await hook({ 'inquiry-template-ids': [T1] });
    const payload = {
      data: buildAccountResource({
        id: newId('acc'),
        referenceId: null,
        status: 'active',
        fields: {},
        tags: [],
        consolidatedInto: null,
        accountTypeId: A1,
        inquiryIds: [],
        createdAt: at,
        updatedAt: at,
        redactedAt: null,
      }),
    };

    expect(await deliveredTo('account.created', payload)).toEqual(
      [open, matching, byTemplate].sort(),
    );
  });

  it('does not filter an event whose inquiry is unknown', async () => {
    const open = await hook(undefined);
    const filtered = await hook({ 'inquiry-template-ids': [T1] });

    expect(await deliveredTo('verification.passed', verificationPayload())).toEqual(
      [open, filtered].sort(),
    );
  });

  it("never reads another environment's inquiry for the subject", async () => {
    const template = await createInquiryTemplate(db, otherEnvironmentId, {
      id: newId('itmpl'),
      name: 'Other environment template',
      version: {
        id: newId('itmplv'),
        flow: defaults.flow,
        verificationConfig: defaults['verification-config'],
      },
    });
    const foreign = await createInquiry(db, otherEnvironmentId, {
      id: newId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.latestVersion.id,
    });
    const filteredOut = await hook({ 'inquiry-template-ids': [T1] });
    const payload = {
      data: buildVerificationResource({
        id: newId('ver'),
        type: 'selfie',
        status: 'passed',
        inquiryId: foreign.id,
        fileIds: [],
        checks: [],
        createdAt: at,
        updatedAt: at,
      }),
    };

    // The foreign inquiry is invisible here, so the subject is unknown and not filtered.
    expect(await deliveredTo('verification.passed', payload)).toEqual([filteredOut]);
  });
});
