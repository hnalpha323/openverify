/**
 * C40.2 `POST /api/v1/flow/verifications/:id/selfies` (Workflow 4A Stage 3, api-flow): the
 * preconditions, the prompts, the nonce (returned once, stored as SHA-256), the expiry from the
 * injected clock, the guidance, the supersede (and the expiry of an open capture at the next
 * create) with its files deleted, the cap that cancels the verification and, when no attempt
 * remains, fails the inquiry in the same transaction, and the `selfie.*` events.
 */
import { createHash } from 'node:crypto';
import {
  eventPayloadSchema,
  flowSelfieCaptureDocumentSchema,
  newId,
  SELFIE_CAPTURE_LIMIT,
  SELFIE_CAPTURE_TTL_SECONDS,
  selfieCaptureResourceSchema,
} from '@openverify/contracts';
import {
  createFile,
  encryptBytes,
  getInquiry,
  getSelfieCapture,
  getVerification,
  listSelfieCaptures,
  listVerificationFiles,
  lockSelfieCapture,
  redactInquiryRecords,
  setVerificationStatus,
  transitionInquiryStatus,
} from '@openverify/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  expectStatus,
  IMAGES,
  PROBLEM_JSON,
  seedVerification,
} from '../../test-support/harness.js';
import {
  createCapture,
  postCapture,
  problemCode,
  selfieFlow,
  templateWithSelfie,
  type SelfieFlow,
} from './selfie.test-support.js';

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

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** The recorded `selfie.*` payloads about `captureId`, parsed as the C40.1 resource. */
function selfieEvents(captureId: string) {
  return api.events.events
    .filter((event) => event.name.startsWith('selfie.'))
    .map((event) => ({ name: event.name, payload: eventPayloadSchema.parse(event.payload) }))
    .filter((event) => event.payload.data.id === captureId);
}

/** A file stored under `captureId`, as an upload would leave it. */
async function fileOfCapture(flow: SelfieFlow, captureId: string): Promise<string> {
  const id = newId('file');
  const sealed = encryptBytes(IMAGES.jpeg, api.database.keyring, { context: id });
  const storageKey = `${api.environmentId}/${id}`;
  await api.storage.put(storageKey, sealed.ciphertext);
  await createFile(api.database.db, api.environmentId, {
    id,
    verificationId: flow.verificationId,
    kind: 'selfie-center',
    storageKey,
    mimeType: 'image/jpeg',
    byteSize: IMAGES.jpeg.length,
    sha256: createHash('sha256').update(IMAGES.jpeg).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
  await api.database.client.query('update files set selfie_capture_id = $1 where id = $2', [
    captureId,
    id,
  ]);
  return storageKey;
}

describe('POST /api/v1/flow/verifications/:id/selfies', () => {
  it('creates an initiated capture: center first, a nonce returned once, the expiry and the guidance', async () => {
    const flow = await selfieFlow(api);

    const response = await postCapture(api, flow);

    const { data } = flowSelfieCaptureDocumentSchema.parse(expectStatus(response, 201));
    expect(data.id).toMatch(/^self_/);
    expect(data.attributes.prompts[0]).toBe('center');
    // C45.1: the default step prompts the three poses with active liveness.
    expect([...data.attributes.prompts].sort()).toEqual(['center', 'left', 'right']);
    expect(data.attributes.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(data.attributes['expires-at']).toBe(
      new Date(start.getTime() + SELFIE_CAPTURE_TTL_SECONDS * 1000).toISOString(),
    );
    expect(data.attributes.guidance).toEqual({
      'max-center-yaw-ratio': 0.021,
      'min-side-yaw-ratio-change': 0.077,
      'hold-ms': 500,
    });
    expect(response.headers['cache-control']).toBe('no-store');

    const stored = await lockSelfieCapture(
      api.database.db,
      api.environmentId,
      flow.verificationId,
      data.id,
    );
    expect(stored).toMatchObject({
      status: 'initiated',
      method: 'camera',
      liveness: 'active',
      prompts: data.attributes.prompts,
      inquiryId: flow.inquiryId,
      createdAt: start,
      expiresAt: new Date(start.getTime() + SELFIE_CAPTURE_TTL_SECONDS * 1000),
    });
    expect(Buffer.from(stored?.nonceSha256 ?? [])).toEqual(sha256(data.attributes.nonce));
  });

  it('stores the nonce only as its SHA-256 and never sends it in an event', async () => {
    const flow = await selfieFlow(api);

    const capture = await createCapture(api, flow);

    const { rows } = await api.database.client.query<Record<string, unknown>>(
      'select * from selfie_captures where id = $1',
      [capture.id],
    );
    expect(JSON.stringify(rows)).not.toContain(capture.nonce);
    expect(JSON.stringify(api.events.events)).not.toContain(capture.nonce);
  });

  it('publishes selfie.created with the capture resource, after verification.created', async () => {
    const flow = await selfieFlow(api);

    const capture = await createCapture(api, flow);

    const [created] = selfieEvents(capture.id);
    expect(created?.name).toBe('selfie.created');
    const resource = selfieCaptureResourceSchema.parse(created?.payload.data);
    expect(resource).toEqual({
      type: 'selfie',
      id: capture.id,
      attributes: {
        status: 'initiated',
        'capture-method': 'camera',
        liveness: 'active',
        prompts: capture.prompts,
        'prompt-timings': [],
        'created-at': start.toISOString(),
        'expires-at': capture.expiresAt,
        'submitted-at': null,
        'processed-at': null,
        'error-code': null,
      },
      relationships: {
        verification: { data: { type: 'verification/selfie', id: flow.verificationId } },
        inquiry: { data: { type: 'inquiry', id: flow.inquiryId } },
      },
    });
    const names = api.events.events
      .filter(
        (event) =>
          (event.payload.data as { id: string }).id === flow.verificationId ||
          (event.payload.data as { id: string }).id === capture.id,
      )
      .map((event) => event.name);
    expect(names).toEqual(['verification.created', 'selfie.created']);
  });

  it('prompts the side poses in the step order with passive liveness', async () => {
    const templateId = await templateWithSelfie(api, (step) => {
      step.poses = ['center', 'right', 'left'];
      step.liveness = 'passive';
    });
    const flow = await selfieFlow(api, { templateId });

    const capture = await createCapture(api, flow);

    expect(capture.prompts).toEqual(['center', 'right', 'left']);
    expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
      liveness: 'passive',
    });
  });

  it('prompts the center alone for a centre-only step', async () => {
    const templateId = await templateWithSelfie(api, (step) => {
      step.poses = ['center'];
      step.liveness = 'passive';
    });
    const flow = await selfieFlow(api, { templateId });

    expect((await createCapture(api, flow)).prompts).toEqual(['center']);
  });

  it("sends the template's pose thresholds as guidance", async () => {
    const templateId = await templateWithSelfie(api, (_step, attributes) => {
      const checks = attributes['verification-config'].selfie?.checks ?? {};
      checks.selfie_pose_detection = {
        enabled: true,
        required: true,
        config: { 'max-center-yaw-ratio': 0.03, 'min-side-yaw-ratio-change': 0.1 },
      };
    });
    const flow = await selfieFlow(api, { templateId });

    const { data } = flowSelfieCaptureDocumentSchema.parse(
      expectStatus(await postCapture(api, flow), 201),
    );

    expect(data.attributes.guidance).toEqual({
      'max-center-yaw-ratio': 0.03,
      'min-side-yaw-ratio-change': 0.1,
      'hold-ms': 500,
    });
  });

  it('creates an upload capture in a sandbox (C19)', async () => {
    const flow = await selfieFlow(api);

    const capture = await createCapture(api, flow, 'upload');

    expect(await getSelfieCapture(api.database.db, api.environmentId, capture.id)).toMatchObject({
      method: 'upload',
    });
  });

  it('refuses an upload capture in production with 403 sandbox-only', async () => {
    const tenant = await api.newTenant({ kind: 'production' });
    const flow = await selfieFlow(api, { token: tenant.token });

    const response = await postCapture(api, flow, 'upload');

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<{ type: string }>().type).toBe(
      'https://openverify.dev/problems/sandbox-only',
    );
    expect(
      await listSelfieCaptures(api.database.db, tenant.environmentId, {
        verificationId: flow.verificationId,
      }),
    ).toEqual([]);
  });

  it('answers 409 before consent and creates nothing', async () => {
    const flow = await selfieFlow(api, { consent: false });

    const response = await postCapture(api, flow);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ detail: string }>().detail).toMatch(/consent/i);
    expect(
      await listSelfieCaptures(api.database.db, api.environmentId, {
        verificationId: flow.verificationId,
      }),
    ).toEqual([]);
  });

  it('answers 422 for a government ID verification', async () => {
    const flow = await selfieFlow(api);
    // C151.4 (Workflow 9A): the selfie step is the current one, so the ID attempt is seeded.
    const { id: governmentId } = await seedVerification(api, api.environmentId, flow.inquiryId, {
      type: 'government_id',
    });

    const response = await postCapture(api, { ...flow, verificationId: governmentId });

    expect(response.statusCode).toBe(422);
  });

  it('answers 409 for a verification that is no longer initiated', async () => {
    const flow = await selfieFlow(api);
    await setVerificationStatus(api.database.db, api.environmentId, flow.verificationId, {
      to: 'submitted',
    });

    expect((await postCapture(api, flow)).statusCode).toBe(409);
  });

  it("answers 404 for another session's verification", async () => {
    const mine = await selfieFlow(api);
    const theirs = await selfieFlow(api);

    const response = await postCapture(api, {
      sessionToken: mine.sessionToken,
      verificationId: theirs.verificationId,
    });

    expect(response.statusCode).toBe(404);
  });

  it('answers 410 once the inquiry was redacted, and 409 once it is finished', async () => {
    const redacted = await selfieFlow(api);
    await redactInquiryRecords(api.database.db, api.environmentId, redacted.inquiryId);
    const finished = await selfieFlow(api);
    await transitionInquiryStatus(api.database.db, api.environmentId, finished.inquiryId, {
      from: 'pending',
      to: 'completed',
    });

    expect((await postCapture(api, redacted)).statusCode).toBe(410);
    expect((await postCapture(api, finished)).statusCode).toBe(409);
  });
});

describe('a new capture supersedes the open one (C40.2)', () => {
  it('errors the open capture as superseded, deletes its files and their objects, and opens the new one', async () => {
    const flow = await selfieFlow(api);
    const first = await createCapture(api, flow);
    const storageKey = await fileOfCapture(flow, first.id);

    const second = await createCapture(api, flow);

    expect(await getSelfieCapture(api.database.db, api.environmentId, first.id)).toMatchObject({
      status: 'errored',
      errorCode: 'superseded',
    });
    expect(await getSelfieCapture(api.database.db, api.environmentId, second.id)).toMatchObject({
      status: 'initiated',
    });
    expect(
      await listVerificationFiles(api.database.db, api.environmentId, [flow.verificationId]),
    ).toEqual([]);
    expect(api.storage.keys()).not.toContain(storageKey);
    expect(selfieEvents(first.id).map((event) => event.name)).toEqual([
      'selfie.created',
      'selfie.errored',
    ]);
    expect(
      selfieCaptureResourceSchema.parse(selfieEvents(first.id)[1]?.payload.data).attributes,
    ).toMatchObject({ status: 'errored', 'error-code': 'superseded' });
  });

  it('errors an open capture past its expiry as expired', async () => {
    const flow = await selfieFlow(api);
    const first = await createCapture(api, flow);
    api.clock.advance(SELFIE_CAPTURE_TTL_SECONDS * 1000);

    await createCapture(api, flow);

    expect(await getSelfieCapture(api.database.db, api.environmentId, first.id)).toMatchObject({
      status: 'errored',
      errorCode: 'expired',
    });
    expect(selfieEvents(first.id).at(-1)?.name).toBe('selfie.errored');
  });

  it('starts the new expiry from the clock at its own creation', async () => {
    const flow = await selfieFlow(api);
    await createCapture(api, flow);
    api.clock.advance(42_000);

    const second = await createCapture(api, flow);

    expect(second.expiresAt).toBe(
      new Date(start.getTime() + 42_000 + SELFIE_CAPTURE_TTL_SECONDS * 1000).toISOString(),
    );
  });
});

describe('the capture cap (C40.2)', () => {
  async function exhaustCaptures(flow: SelfieFlow) {
    for (let index = 0; index < SELFIE_CAPTURE_LIMIT; index += 1) {
      await createCapture(api, flow);
    }
  }

  it('cancels the verification on the 11th create, errors its open capture and answers 409 selfie_capture_limit', async () => {
    const flow = await selfieFlow(api);
    await exhaustCaptures(flow);
    const [open] = await listSelfieCaptures(api.database.db, api.environmentId, {
      verificationId: flow.verificationId,
    });

    const response = await postCapture(api, flow);

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(problemCode(response)).toBe('selfie_capture_limit');
    expect(
      (await getVerification(api.database.db, api.environmentId, flow.verificationId))?.status,
    ).toBe('canceled');
    expect(
      await getSelfieCapture(api.database.db, api.environmentId, open?.id ?? ''),
    ).toMatchObject({ status: 'errored', errorCode: 'canceled' });
    expect(
      await listSelfieCaptures(api.database.db, api.environmentId, {
        verificationId: flow.verificationId,
      }),
    ).toHaveLength(SELFIE_CAPTURE_LIMIT);
    expect(
      api.events
        .named('verification.canceled')
        .filter((event) => (event.payload.data as { id: string }).id === flow.verificationId),
    ).toHaveLength(1);
    expect(selfieEvents(open?.id ?? '').at(-1)?.name).toBe('selfie.errored');
    // Attempts remain (the default step allows 3): the inquiry stays open for a new one.
    expect((await getInquiry(api.database.db, api.environmentId, flow.inquiryId))?.status).toBe(
      'pending',
    );
  });

  it('fails the inquiry in the same transaction when no attempt remains', async () => {
    const templateId = await templateWithSelfie(api, (step) => {
      step.maxAttempts = 1;
    });
    const flow = await selfieFlow(api, { templateId });
    await exhaustCaptures(flow);

    const response = await postCapture(api, flow);

    expect(problemCode(response)).toBe('selfie_capture_limit');
    expect((await getInquiry(api.database.db, api.environmentId, flow.inquiryId))?.status).toBe(
      'failed',
    );
    const names = api.events.events
      .filter((event) => {
        const id = (event.payload.data as { id: string }).id;
        return id === flow.inquiryId || id === flow.verificationId;
      })
      .map((event) => event.name);
    expect(names.slice(-3)).toEqual([
      'verification.canceled',
      'inquiry.failed',
      'inquiry.transitioned',
    ]);
  });
});
