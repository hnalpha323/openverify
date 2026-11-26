/**
 * C40.2 and C42.2 (Workflow 4A Stage 3, api-flow):
 * - every path that cancels a selfie verification (the inquiry `expire` action and the inquiry
 *   expiry job, besides the capture cap) moves its open capture to `errored` (`canceled`) with
 *   `selfie.errored`, deleting the capture's files;
 * - an inquiry an operator declines, or that fails, loses its face templates and background rows
 *   in that transition's transaction (`deleteFaceDataForInquiry`); approving keeps them.
 */
import {
  eventPayloadSchema,
  selfieCaptureResourceSchema,
} from '@openverify/contracts';
import {
  createFaceTemplate,
  createSelfieBackground,
  getInquiry,
  getSelfieCapture,
  listVerificationFiles,
  transitionInquiryStatus,
} from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runInquiryExpiry } from '../jobs/inquiry-expiry.js';
import { createCapturingLogger } from '../jobs/testing.js';
import {
  createCapture,
  selfieFlow,
  uploadPose,
  type HeldCapture,
  type SelfieFlow,
} from '../routes/flow/selfie.test-support.js';
import { bearer, expectStatus } from '../test-support/harness.js';
import { transitionInquiryInTx } from './inquiries.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

let api: InquiryTestApi;
let start: Date;

beforeAll(async () => {
  api = await createInquiryTestApi();
  start = api.clock.now();
});

afterEach(() => {
  api.clock.set(start);
});

afterAll(async () => {
  await api.close();
});

/** A selfie flow whose open capture has its centre pose stored. */
async function openCaptureWithFile(): Promise<{
  flow: SelfieFlow;
  capture: HeldCapture;
  storageKey: string;
}> {
  const flow = await selfieFlow(api);
  const capture = await createCapture(api, flow);
  expectStatus(await uploadPose(api, flow, capture, 'center'), 201);
  const [file] = await listVerificationFiles(api.database.db, api.environmentId, [
    flow.verificationId,
  ]);
  return { flow, capture, storageKey: file?.storageKey ?? '' };
}

/** The names of the events about the verification or the capture, in dispatch order. */
function eventNames(flow: SelfieFlow, capture: Pick<HeldCapture, 'id'>) {
  return api.events.events
    .filter((event) => {
      const id = (event.payload.data as { id: string }).id;
      return id === flow.verificationId || id === capture.id;
    })
    .map((event) => event.name);
}

function lastSelfieEvent(captureId: string) {
  const event = api.events.events
    .filter((candidate) => (candidate.payload.data as { id: string }).id === captureId)
    .at(-1);
  return {
    name: event?.name,
    resource: selfieCaptureResourceSchema.parse(eventPayloadSchema.parse(event?.payload).data),
  };
}

describe('every cancel path errors the open capture (C40.2)', () => {
  it('the expire action: canceled with selfie.errored, its files and objects deleted', async () => {
    const { flow, capture, storageKey } = await openCaptureWithFile();

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${flow.inquiryId}/expire`,
        headers: bearer(api.token),
      }),
      200,
    );

    expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
      status: 'errored',
      errorCode: 'canceled',
    });
    expect(eventNames(flow, capture).slice(-2)).toEqual([
      'selfie.errored',
      'verification.canceled',
    ]);
    expect(lastSelfieEvent(capture.id).resource.attributes).toMatchObject({
      status: 'errored',
      'error-code': 'canceled',
    });
    expect(
      await listVerificationFiles(api.database.db, api.environmentId, [flow.verificationId]),
    ).toEqual([]);
    expect(api.storage.keys()).not.toContain(storageKey);
  });

  it('the inquiry expiry job: canceled with selfie.errored, its file rows and objects deleted (K201)', async () => {
    const { flow, capture, storageKey } = await openCaptureWithFile();
    api.clock.advance(30 * 86_400_000);
    expect(api.storage.keys()).toContain(storageKey);

    await runInquiryExpiry({
      db: api.database.db,
      storage: api.storage,
      events: api.events,
      clock: api.clock,
      logger: createCapturingLogger(),
    });

    expect((await getInquiry(api.database.db, api.environmentId, flow.inquiryId))?.status).toBe(
      'expired',
    );
    expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
      status: 'errored',
      errorCode: 'canceled',
    });
    expect(lastSelfieEvent(capture.id).name).toBe('selfie.errored');
    expect(
      await listVerificationFiles(api.database.db, api.environmentId, [flow.verificationId]),
    ).toEqual([]);
    expect(api.storage.keys()).not.toContain(storageKey);
  });

  it('the inquiry expiry job deletes the objects only after the batch committed (K201)', async () => {
    const { storageKey } = await openCaptureWithFile();
    api.clock.advance(30 * 86_400_000);
    const log: string[] = [];
    const db = new Proxy(api.database.db, {
      get: (target, key) =>
        key === 'transaction'
          ? async (...args: Parameters<typeof target.transaction>) => {
              const result: unknown = await target.transaction(...args);
              log.push('commit');
              return result;
            }
          : (Reflect.get(target, key) as unknown),
    });
    const storage = {
      put: (key: string, bytes: Uint8Array) => api.storage.put(key, bytes),
      get: (key: string) => api.storage.get(key),
      delete: (key: string) => {
        log.push(key === storageKey ? 'delete the capture file' : 'delete another');
        return api.storage.delete(key);
      },
    };

    await runInquiryExpiry({
      db,
      storage,
      events: api.events,
      clock: api.clock,
      logger: createCapturingLogger(),
    });

    expect(log).toContain('delete the capture file');
    expect(log.indexOf('commit')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('commit')).toBeLessThan(log.findIndex((entry) => entry.startsWith('delete')));
    expect(api.storage.keys()).not.toContain(storageKey);
  });

  it('the inquiry expiry job counts the objects it could not delete and still expires (K201)', async () => {
    const { flow, storageKey } = await openCaptureWithFile();
    api.clock.advance(30 * 86_400_000);
    const logger = createCapturingLogger();

    const result = await runInquiryExpiry({
      db: api.database.db,
      storage: {
        put: (key, bytes) => api.storage.put(key, bytes),
        get: (key) => api.storage.get(key),
        delete: () => Promise.reject(new Error('storage unavailable')),
      },
      events: api.events,
      clock: api.clock,
      logger,
    });

    expect(result.expiredInquiries).toBeGreaterThanOrEqual(1);
    expect((await getInquiry(api.database.db, api.environmentId, flow.inquiryId))?.status).toBe(
      'expired',
    );
    const warning = logger.entries.find((entry) => entry.message.startsWith('capture objects'));
    expect(warning).toMatchObject({
      level: 'warn',
      object: { undeletedObjects: expect.any(Number) as number },
    });
    expect(Number(warning?.object.undeletedObjects)).toBeGreaterThanOrEqual(1);
    // Counts only: never a storage key.
    expect(JSON.stringify(warning)).not.toContain(storageKey);
    await api.storage.delete(storageKey);
  });
});

describe('face data on an operator decline or a failed inquiry (C42.2)', () => {
  /** A template and a background row for the flow's inquiry, as the worker writes them. */
  async function seedFaceData(flow: SelfieFlow): Promise<void> {
    const ids = { verificationId: flow.verificationId, inquiryId: flow.inquiryId };
    const template = await createFaceTemplate(api.database.db, api.environmentId, {
      id: testId('ftpl'),
      ...ids,
      model: 'sface-2021dec',
      embedding: Array.from({ length: 128 }, () => 0.088),
    });
    await createSelfieBackground(api.database.db, api.environmentId, {
      id: testId('sbg'),
      ...ids,
      faceTemplateId: template.id,
      layout: Array.from({ length: 144 }, (_, index) => index / 4),
      validCells: '1'.repeat(48),
      coverage: 1,
    });
  }

  async function faceRows(inquiryId: string) {
    const { rows } = await api.database.client.query<{ templates: number; backgrounds: number }>(
      `select (select count(*)::int from face_templates where inquiry_id = $1) as templates,
              (select count(*)::int from selfie_backgrounds where inquiry_id = $1) as backgrounds`,
      [inquiryId],
    );
    return rows[0];
  }

  async function completedWithFaceData(): Promise<SelfieFlow> {
    const flow = await selfieFlow(api);
    await seedFaceData(flow);
    await transitionInquiryStatus(api.database.db, api.environmentId, flow.inquiryId, {
      from: 'pending',
      to: 'completed',
    });
    return flow;
  }

  function act(flow: SelfieFlow, action: 'decline' | 'approve') {
    return api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${flow.inquiryId}/${action}`,
      headers: bearer(api.token),
    });
  }

  it('deletes the templates and background rows when an operator declines', async () => {
    const flow = await completedWithFaceData();

    expectStatus(await act(flow, 'decline'), 200);

    expect(await faceRows(flow.inquiryId)).toEqual({ templates: 0, backgrounds: 0 });
  });

  it('keeps them when the operator approves', async () => {
    const flow = await completedWithFaceData();

    expectStatus(await act(flow, 'approve'), 200);

    expect(await faceRows(flow.inquiryId)).toEqual({ templates: 1, backgrounds: 1 });
  });

  it('deletes them in the transaction that fails the inquiry', async () => {
    const flow = await selfieFlow(api);
    await seedFaceData(flow);
    const inquiry = await getInquiry(api.database.db, api.environmentId, flow.inquiryId);
    if (inquiry === null) {
      throw new Error('the inquiry exists');
    }

    expect(await faceRows(flow.inquiryId)).toEqual({ templates: 1, backgrounds: 1 });

    await api.database.db.transaction(async (tx) => {
      await transitionInquiryInTx(tx, api.deps, inquiry, 'failed');
    });

    expect(await faceRows(flow.inquiryId)).toEqual({ templates: 0, backgrounds: 0 });
  });
});
