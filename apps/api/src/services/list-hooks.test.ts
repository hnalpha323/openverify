/**
 * Workflow 7B Stage 1b (L): the smaller hooks. `blind-index:rebuild` runs `rebuildListIndexes`
 * (C98.2); an inquiry redaction asks the `BiometricItemRedactor` in its transaction and deletes the
 * objects it names after the commit (C98.4); a `list-match` event's filter subject is strict
 * (C107.4, V14); `ListProblemError` answers each code's status. Synthetic values.
 */
import { LIST_PROBLEM_CODES, LIST_PROBLEM_STATUSES } from '@openverify/contracts';
import { createTestTenant, createTestInquiry } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runBlindIndexRebuild } from '../../scripts/blind-index-rebuild.js';
import { ListProblemError } from '../errors.js';
import { eventFilterSubjects, toEventSubject } from '../events/subject.js';
import { createEventPublisher } from '../events/index.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { createFakeBiometricItemRedactor, fixedClock } from '../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { createRedactionService } from './redaction.js';
import { rebuildListIndexes } from './lists/rebuild.js';

const rebuild = vi.hoisted(() => vi.fn(() => Promise.resolve({ scanned: 4, updated: 3 })));
vi.mock('./lists/rebuild.js', () => ({ rebuildListIndexes: rebuild }));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

describe('blind-index:rebuild and the lists (C98.2)', () => {
  it('runs rebuildListIndexes and prints counts only', async () => {
    const lines: string[] = [];

    const result = await runBlindIndexRebuild({
      db: api.database.db,
      key: new Uint8Array(32).fill(2),
      args: { batchSize: 7 },
      out: (line) => lines.push(line),
    });

    expect(rebuildListIndexes).toHaveBeenCalledWith(api.database.db, new Uint8Array(32).fill(2), {
      batchSize: 7,
    });
    expect(result.lists).toEqual({ scanned: 4, updated: 3 });
    expect(lines).toContain('blind-index:rebuild: done: scanned 4 list items, re-indexed 3.');
  });
});

describe('the biometric items of a redacted inquiry (C98.4, C99.7)', () => {
  function service() {
    const redactor = createFakeBiometricItemRedactor();
    const storage = createInMemoryFileStorage();
    const events = createEventPublisher({
      db: api.database.db,
      deliveries: createWebhookDeliveryScheduler({
        add: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }),
    });
    const redaction = createRedactionService({
      db: api.database.db,
      storage,
      events,
      clock: fixedClock(new Date('2026-10-31T00:00:00.000Z')),
      biometricItems: redactor,
    });
    return { redactor, storage, redaction };
  }

  async function subject() {
    const { organization, environment } = await createTestTenant(api.database.db);
    const { inquiry } = await createTestInquiry(api.database.db, environment.id);
    const ctx = {
      organizationId: organization.id,
      environmentId: environment.id,
      requestId: 'req-1',
    };
    return { ctx, inquiry };
  }

  it('asks the redactor with the inquiry, and deletes the objects it names after the commit', async () => {
    const { redactor, storage, redaction } = service();
    const { ctx, inquiry } = await subject();
    await storage.put('list-backgrounds/synthetic', new Uint8Array([1]));
    redactor.storageKeys = ['list-backgrounds/synthetic'];

    await redaction.redactInquiry(ctx, inquiry.id, null);

    expect(redactor.calls).toEqual([
      {
        environmentId: ctx.environmentId,
        inquiryId: inquiry.id,
        at: new Date('2026-10-31T00:00:00.000Z'),
      },
    ]);
    expect(await storage.get('list-backgrounds/synthetic')).toBeNull();
  });
});

describe('the list-match filter subject (C107.4, V14)', () => {
  it('is strict: a list match fails any filter that is present', async () => {
    const [subject] = await eventFilterSubjects(api.database.db, api.environmentId, [
      {
        data: {
          type: 'list-match',
          id: 'lmt_1',
          relationships: { inquiry: { data: { type: 'inquiry', id: 'inq_1' } } },
        },
      },
    ]);

    expect(toEventSubject(subject)).toEqual({ strict: true });
  });
});

describe('ListProblemError', () => {
  it.each([...LIST_PROBLEM_CODES])('%s answers its status with its code', (code) => {
    const error = new ListProblemError(code, 'Synthetic detail.');

    expect(error.status).toBe(LIST_PROBLEM_STATUSES[code]);
    expect(error.code).toBe(code);
  });
});
