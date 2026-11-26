/**
 * The Phase 4 follow-up of the expiry job (K201, C54.1, C54.3), for every Phase 5 type: the
 * inquiry expiry cancels `initiated` and (C50.7) `confirmed` verifications through each type's
 * cancel hook (`services/sub-resources/<type>.ts`), and deletes, once the batch committed, the
 * objects any hook returns, with the job's own storage. A database or AAMVA verification has no
 * sub-resource: its entered values stay, under the inquiry's retention and redaction (C53.6).
 * The document hook is replaced by one that returns a stored object. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  createVerification,
  getVerification,
  getVerificationInputs,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedVerificationInputs,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { runInquiryExpiry } from './inquiry-expiry.js';
import { createCapturingLogger, createMemoryStorage, createRecordingQueue } from './testing.js';

const { hookKeys, order } = vi.hoisted(() => ({
  hookKeys: [] as string[],
  order: [] as string[],
}));

vi.mock('../services/sub-resources/document.js', () => ({
  documentSubResources: {
    onVerificationCanceled: () => {
      order.push('hook');
      return Promise.resolve({ staged: [], storageKeys: [...hookKeys] });
    },
  },
}));

const NOW = new Date('2026-10-23T12:00:00.000Z');

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function overdueInquiry(): Promise<string> {
  const { inquiry } = await createTestInquiry(db, environmentId);
  await database.client.query('update inquiries set expires_at = $2 where id = $1', [
    inquiry.id,
    new Date(NOW.getTime() - 60_000),
  ]);
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  return inquiry.id;
}

async function verification(
  inquiryId: string,
  type: 'document' | 'phone_number' | 'database' | 'aamva',
  status?: 'confirmed',
) {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type });
  if (status !== undefined) {
    await setVerificationStatus(db, environmentId, id, { to: status });
  }
  return id;
}

describe('the inquiry expiry job and the Phase 5 cancel hooks (K201, C54.1)', () => {
  it('cancels initiated and confirmed verifications and deletes the objects a hook returns, after commit', async () => {
    const inquiryId = await overdueInquiry();
    const document = await verification(inquiryId, 'document');
    const phone = await verification(inquiryId, 'phone_number', 'confirmed');
    const storage = createMemoryStorage();
    const key = `${environmentId}/${newId('file')}`;
    await storage.put(key, new Uint8Array([1, 2, 3]));
    hookKeys.splice(0, hookKeys.length, key);
    const deleting = storage.delete.bind(storage);
    const logger = createCapturingLogger();
    const events = createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
      logger,
    });

    const result = await runInquiryExpiry({
      db,
      storage: {
        ...storage,
        delete: (deleted) => {
          order.push('delete');
          return deleting(deleted);
        },
      },
      events: {
        ...events,
        dispatch: (staged) => {
          order.push('dispatch');
          return events.dispatch(staged);
        },
      },
      clock: { now: () => NOW },
      logger,
    });

    expect(result.expiredInquiries).toBeGreaterThanOrEqual(1);
    expect((await getVerification(db, environmentId, document))?.status).toBe('canceled');
    expect((await getVerification(db, environmentId, phone))?.status).toBe('canceled');
    expect(storage.objects.has(key)).toBe(false);
    // The hook ran in the batch; the object went once the batch committed and its events left.
    expect(order.indexOf('hook')).toBeLessThan(order.indexOf('dispatch'));
    expect(order.indexOf('dispatch')).toBeLessThan(order.indexOf('delete'));
  });

  it('keeps the entered values of a canceled database or AAMVA verification', async () => {
    const inquiryId = await overdueInquiry();
    hookKeys.splice(0, hookKeys.length);
    const ids = [await verification(inquiryId, 'database'), await verification(inquiryId, 'aamva')];
    for (const id of ids) {
      await seedVerificationInputs(db, environmentId, {
        verificationId: id,
        inquiryId,
        values: { 'name-last': 'Testerton' },
      });
    }
    const logger = createCapturingLogger();

    await runInquiryExpiry({
      db,
      storage: createMemoryStorage(),
      events: createEventPublisher({
        db,
        deliveries: createWebhookDeliveryScheduler(createRecordingQueue()),
        logger,
      }),
      clock: { now: () => NOW },
      logger,
    });

    for (const id of ids) {
      expect((await getVerification(db, environmentId, id))?.status).toBe('canceled');
      expect((await getVerificationInputs(db, environmentId, id))?.values).toEqual({
        'name-last': 'Testerton',
      });
    }
  });
});
