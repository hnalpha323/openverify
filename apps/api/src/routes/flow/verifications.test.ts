import { createHash } from 'node:crypto';
import {
  defaultInquiryTemplateAttributes,
  eventPayloadSchema,
  fileDocumentSchema,
  flowVerificationDocumentSchema,
  MAX_UPLOAD_BYTES,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import {
  decryptBytes,
  getFile,
  getInquiry,
  getVerification,
  listInquiryVerifications,
  listVerificationFiles,
  redactInquiryRecords,
  setVerificationStatus,
  transitionInquiryStatus,
} from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createTemplate,
  expectStatus,
  IMAGES,
  multipart,
  openFlowSession,
  PROBLEM_JSON,
  seedVerification,
  type MultipartFile,
} from '../../test-support/harness.js';
import { passStepsBefore, reachStep } from '../../flow-engine/testing.js';
import { phase5TemplateAttributes } from '../../test-support/phase5-templates.js';
import { renderedPage, renditionAfter } from '../../test-support/rendition-pages.js';

// C54.1: Workflow 5B builds the last type jobs (the document job is runnable since `api-document`),
// so this file keeps an unbuilt document job to test the refusal of a type whose job is not built.
vi.mock('../../jobs/types/document.js', async () => {
  const { unbuiltTypeJob } = await import('../../jobs/types/stub.js');
  return { documentJob: unbuiltTypeJob('document') };
});

let api: InquiryTestApi;

beforeAll(async () => {
  // C55.10: the Phase 5 template's phone step publishes only with an SMS sender bound.
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const VERIFICATIONS = '/api/v1/flow/verifications';
const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

function createVerification(token: string, body: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: VERIFICATIONS,
    headers: bearer(token),
    payload: body,
  });
}

async function consent(token: string) {
  const response = await api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/consent',
    headers: bearer(token),
    payload: CONSENT_BODY,
  });
  expectStatus(response, 201);
}

/** Starts the inquiry (`inquiry.started`), so a later failure is the one under test. */
async function getSessionOnce(token: string) {
  expectStatus(await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) }), 200);
}

async function newVerification(token: string, type: 'government-id' | 'selfie') {
  return expectStatus(await createVerification(token, { type }), 201).data.id;
}

async function upload(
  token: string,
  verificationId: string,
  fields: Readonly<Record<string, string | MultipartFile>>,
) {
  const { payload, headers } = await multipart(fields);
  return api.app.inject({
    method: 'POST',
    url: `${VERIFICATIONS}/${verificationId}/files`,
    headers: { ...bearer(token), ...headers },
    payload,
  });
}

function submit(token: string, verificationId: string) {
  return api.app.inject({
    method: 'POST',
    url: `${VERIFICATIONS}/${verificationId}/submit`,
    headers: bearer(token),
  });
}

/** A session that consented, with a government ID verification ready for files. */
async function governmentIdReady(templateId?: string) {
  const session = await openFlowSession(api, templateId === undefined ? {} : { templateId });
  await consent(session.sessionToken);
  const verificationId = await newVerification(session.sessionToken, 'government-id');
  return { ...session, verificationId };
}

function templateWith(change: (attributes: DefaultInquiryTemplateAttributes) => void) {
  const attributes = defaultInquiryTemplateAttributes();
  change(attributes);
  return createTemplate(api, api.token, attributes);
}

describe('flow writes after the inquiry was redacted (2B F018)', () => {
  const REDACTED = 'https://openverify.dev/problems/redacted';

  function expectRedacted(response: Awaited<ReturnType<typeof submit>>) {
    expect(response.statusCode, response.body).toBe(410);
    expect(response.json<{ type: string }>().type).toBe(REDACTED);
  }

  it('answers 410 redacted to consent, new verifications, uploads and submits, even on a live session', async () => {
    const { inquiryId, sessionToken, verificationId } = await governmentIdReady();
    // The records only: the session stays active, as for a request already past auth.
    await redactInquiryRecords(api.database.db, api.environmentId, inquiryId);

    expectRedacted(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(sessionToken),
        payload: CONSENT_BODY,
      }),
    );
    expectRedacted(await createVerification(sessionToken, { type: 'selfie' }));
    expectRedacted(
      await upload(sessionToken, verificationId, { kind: 'front', file: { bytes: IMAGES.jpeg } }),
    );
    expectRedacted(await submit(sessionToken, verificationId));
    expect(
      await listVerificationFiles(api.database.db, api.environmentId, [verificationId]),
    ).toEqual([]);
    expect(
      await listInquiryVerifications(api.database.db, api.environmentId, inquiryId),
    ).toHaveLength(1);
  });
});

describe('POST /api/v1/flow/verifications', () => {
  it('creates a government ID verification in status initiated', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    const response = await createVerification(sessionToken, {
      type: 'government-id',
      country: 'US',
      'id-class': 'drivers_license',
    });

    const document = flowVerificationDocumentSchema.parse(expectStatus(response, 201));
    expect(document.data).toMatchObject({
      type: 'verification/government-id',
      attributes: { status: 'initiated', 'retry-hints': [] },
    });
    const stored = await getVerification(api.database.db, api.environmentId, document.data.id);
    expect(stored).toMatchObject({
      inquiryId,
      type: 'government_id',
      country: 'US',
      idClass: 'drivers_license',
    });
  });

  it('publishes verification.created with the full resource', async () => {
    const { sessionToken } = await openFlowSession(api);

    const id = await newVerification(sessionToken, 'selfie');

    const [event] = api.events
      .named('verification.created')
      .filter((e) => e.payload.data.id === id);
    expect(eventPayloadSchema.parse(event?.payload).data).toMatchObject({
      type: 'verification/selfie',
      attributes: { status: 'initiated', checks: [] },
    });
  });

  it('starts an inquiry that was still created', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    await newVerification(sessionToken, 'selfie');

    expect((await getInquiry(api.database.db, api.environmentId, inquiryId))?.status).toBe(
      'pending',
    );
  });

  it('answers 422 for a verification type the flow does not have', async () => {
    const templateId = await templateWith((attributes) => {
      attributes.flow.steps = attributes.flow.steps.filter((step) => step.type !== 'selfie');
      attributes.flow.transitions = attributes.flow.transitions.filter(
        (transition) => transition.from !== 'selfie',
      );
      delete attributes['verification-config'].selfie;
    });
    const { sessionToken } = await openFlowSession(api, { templateId });

    const response = await createVerification(sessionToken, { type: 'selfie' });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  });

  it('answers 422 for a type whose step the server does not run yet, and creates nothing (C50.6, C54)', async () => {
    const templateId = await createTemplate(api, api.token, phase5TemplateAttributes());
    const { inquiryId, sessionToken } = await openFlowSession(api, { templateId });

    const response = await createVerification(sessionToken, { type: 'document' });

    expect(response.statusCode).toBe(422);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(await listInquiryVerifications(api.database.db, api.environmentId, inquiryId)).toEqual(
      [],
    );
  });

  it('enforces the countries and ID classes the step allows', async () => {
    const templateId = await templateWith((attributes) => {
      const step = attributes.flow.steps.find((candidate) => candidate.type === 'government_id');
      if (step?.type === 'government_id') {
        step.allowedCountries = ['US'];
        step.allowedIdClasses = ['passport'];
      }
    });
    const { sessionToken } = await openFlowSession(api, { templateId });

    const country = await createVerification(sessionToken, {
      type: 'government-id',
      country: 'MX',
    });
    const idClass = await createVerification(sessionToken, {
      type: 'government-id',
      'id-class': 'drivers_license',
    });
    const allowed = await createVerification(sessionToken, {
      type: 'government-id',
      country: 'US',
      'id-class': 'passport',
    });

    expect(country.statusCode).toBe(422);
    expect(idClass.statusCode).toBe(422);
    expect(allowed.statusCode).toBe(201);
  });

  it('allows at most maxAttempts verifications of a type', async () => {
    const templateId = await templateWith((attributes) => {
      const step = attributes.flow.steps.find((candidate) => candidate.type === 'selfie');
      if (step?.type === 'selfie') {
        step.maxAttempts = 2;
      }
    });
    const { inquiryId, sessionToken } = await openFlowSession(api, { templateId });
    await seedVerification(api, api.environmentId, inquiryId, { type: 'selfie', status: 'failed' });
    await newVerification(sessionToken, 'selfie');
    const [, second] = await listInquiryVerifications(
      api.database.db,
      api.environmentId,
      inquiryId,
    );
    await setVerificationStatus(api.database.db, api.environmentId, second?.id ?? '', {
      to: 'failed',
    });

    const third = await createVerification(sessionToken, { type: 'selfie' });

    expect(third.statusCode).toBe(409);
  });

  it('returns the initiated verification of the type instead of starting another (F011)', async () => {
    // A create whose response was lost, or a second tab, must not leave a stray attempt.
    const { inquiryId, sessionToken } = await openFlowSession(api);

    const first = await newVerification(sessionToken, 'government-id');
    const again = await createVerification(sessionToken, { type: 'government-id' });

    const document = flowVerificationDocumentSchema.parse(expectStatus(again, 201));
    expect(document.data).toMatchObject({ id: first, attributes: { status: 'initiated' } });
    expect(
      await listInquiryVerifications(api.database.db, api.environmentId, inquiryId),
    ).toHaveLength(1);
    expect(
      api.events.named('verification.created').filter((event) => event.payload.data.id === first),
    ).toHaveLength(1);
  });

  it('publishes verification.created on a retry when the first attempt could not (F014)', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await getSessionOnce(sessionToken);
    // C151.4 (Workflow 9A): the ID passed and consent given, so the selfie step is current.
    await reachStep(api, inquiryId, sessionToken, 'selfie');
    api.events.failNext(new Error('events table unavailable'));

    const failed = await createVerification(sessionToken, { type: 'selfie' });
    expect(failed.statusCode).toBe(500);
    expect(
      (await listInquiryVerifications(api.database.db, api.environmentId, inquiryId)).filter(
        (verification) => verification.type === 'selfie',
      ),
    ).toEqual([]);

    const id = await newVerification(sessionToken, 'selfie');
    expect(
      api.events.named('verification.created').filter((event) => event.payload.data.id === id),
    ).toHaveLength(1);
  });

  it('starts one verification for parallel requests (F002, F012)', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    // C151.4 (Workflow 9A): the ID passed and consent given, so the selfie step is current.
    await reachStep(api, inquiryId, sessionToken, 'selfie');
    await seedVerification(api, api.environmentId, inquiryId, { type: 'selfie', status: 'failed' });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => createVerification(sessionToken, { type: 'selfie' })),
    );

    const ids = responses.map((response) => expectStatus(response, 201).data.id);
    expect(new Set(ids).size).toBe(1);
    expect(
      (await listInquiryVerifications(api.database.db, api.environmentId, inquiryId))
        .filter((verification) => verification.type === 'selfie')
        .map((verification) => verification.status),
    ).toEqual(['failed', 'initiated']);
  });

  it.each(['submitted', 'passed'] as const)(
    'answers 409 while a verification of the type is %s',
    async (status) => {
      const { inquiryId, sessionToken } = await openFlowSession(api);
      await seedVerification(api, api.environmentId, inquiryId, { type: 'selfie', status });

      expect((await createVerification(sessionToken, { type: 'selfie' })).statusCode).toBe(409);
    },
  );

  it('allows a retry after a failed attempt', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await seedVerification(api, api.environmentId, inquiryId, { type: 'selfie', status: 'failed' });

    expect((await createVerification(sessionToken, { type: 'selfie' })).statusCode).toBe(201);
  });

  it('lets the step run live beside a cloned pass that does not count (C235.4, review H01; integration-11a)', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await consent(sessionToken);
    const clone = await seedVerification(api, api.environmentId, inquiryId, {
      type: 'government_id',
      status: 'passed',
    });
    await api.database.client.query('update verifications set provenance = $1 where id = $2', [
      JSON.stringify({
        kind: 'connect-clone',
        'share-token-id': 'cnst_01M5CN0000000000000011A200',
        'source-organization-name': 'Example Partner',
        'source-environment-kind': 'sandbox',
        'source-created-at': '2026-10-19T12:00:00.000Z',
        'source-status': 'passed',
        'cloned-at': '2026-10-20T11:00:00.000Z',
      }),
      clone.id,
    ]);

    const created = await createVerification(sessionToken, { type: 'government-id' });
    expect(created.statusCode, created.body).toBe(201);
    expect((JSON.parse(created.body) as { data: { id: string } }).data.id).not.toBe(clone.id);
  });

  it('answers 409 once the inquiry is finished', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await newVerification(sessionToken, 'selfie');
    await transitionInquiryStatus(api.database.db, api.environmentId, inquiryId, {
      from: 'pending',
      to: 'failed',
    });

    expect((await createVerification(sessionToken, { type: 'selfie' })).statusCode).toBe(409);
  });

  // `business` was never an API type (C50.1 renamed the domain value to database_business).
  it.each([{ type: 'business' }, { type: 'selfie', country: 'US' }, {}])(
    'rejects the body %j',
    async (body) => {
      const { sessionToken } = await openFlowSession(api);

      expect((await createVerification(sessionToken, body)).statusCode).toBe(400);
    },
  );
});

describe('POST /api/v1/flow/verifications/:id/files', () => {
  it('stores the image encrypted under a random key and returns the file resource', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();

    const response = await upload(sessionToken, verificationId, {
      kind: 'front',
      file: { bytes: IMAGES.jpeg, filename: 'jane-doe-license.jpg', type: 'image/png' },
    });

    const document = fileDocumentSchema.parse(expectStatus(response, 201));
    expect(document.data).toMatchObject({
      type: 'file',
      attributes: { kind: 'front', 'mime-type': 'image/jpeg', 'byte-size': IMAGES.jpeg.length },
      relationships: {
        verification: { data: { type: 'verification/government-id', id: verificationId } },
      },
    });
    expect(response.body).not.toContain('jane-doe');

    const row = await getFile(api.database.db, api.environmentId, document.data.id);
    expect(row).toMatchObject({
      verificationId,
      kind: 'front',
      mimeType: 'image/jpeg',
      byteSize: IMAGES.jpeg.length,
      sha256: createHash('sha256').update(IMAGES.jpeg).digest('hex'),
    });
    expect(row?.storageKey).toMatch(new RegExp(`^${api.environmentId}/[A-Za-z0-9_-]{43}$`));
    expect(row?.storageKey).not.toContain('jane');

    const ciphertext = await api.storage.get(row?.storageKey ?? '');
    expect(ciphertext).not.toBeNull();
    expect(Buffer.from(ciphertext ?? []).includes(Buffer.from(IMAGES.jpeg))).toBe(false);
    const plaintext = decryptBytes(
      { wrappedDek: row?.wrappedDek ?? '', ciphertext: ciphertext ?? new Uint8Array() },
      api.database.keyring,
      { context: document.data.id },
    );
    expect(new Uint8Array(plaintext)).toEqual(IMAGES.jpeg);
  });

  it.each([
    ['PNG', IMAGES.png, 'image/png'],
    ['WebP', IMAGES.webp, 'image/webp'],
  ])('accepts a %s image, typed by its magic bytes', async (_label, bytes, mimeType) => {
    const { sessionToken, verificationId } = await governmentIdReady();

    const response = await upload(sessionToken, verificationId, {
      kind: 'back',
      file: { bytes, type: 'image/jpeg' },
    });

    expect(expectStatus(response, 201).data.attributes['mime-type']).toBe(mimeType);
  });

  it.each([
    ['a GIF', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0])],
    ['a PDF', new TextEncoder().encode('%PDF-1.7 synthetic')],
    ['text named .jpg', new TextEncoder().encode('not an image')],
    ['an empty file', new Uint8Array()],
  ])('rejects %s with 415 and stores nothing', async (_label, bytes) => {
    const { sessionToken, verificationId } = await governmentIdReady();
    const stored = api.storage.keys().length;

    const response = await upload(sessionToken, verificationId, {
      kind: 'front',
      file: { bytes, filename: 'photo.jpg', type: 'image/jpeg' },
    });

    expect(response.statusCode).toBe(415);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(api.storage.keys()).toHaveLength(stored);
  });

  it('rejects a file over 10 MiB with 413', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    bytes.set(IMAGES.jpeg);

    const response = await upload(sessionToken, verificationId, { kind: 'front', file: { bytes } });

    expect(response.statusCode).toBe(413);
  });

  it('accepts a file of exactly 10 MiB', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES);
    bytes.set(IMAGES.png);

    const response = await upload(sessionToken, verificationId, { kind: 'front', file: { bytes } });

    expect(response.statusCode).toBe(201);
  });

  it('answers 409 before consent and stores nothing', async () => {
    const { sessionToken } = await openFlowSession(api);
    const verificationId = await newVerification(sessionToken, 'government-id');
    const stored = api.storage.keys().length;

    const response = await upload(sessionToken, verificationId, {
      kind: 'front',
      file: { bytes: IMAGES.jpeg },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ detail: string }>().detail).toMatch(/consent/i);
    expect(api.storage.keys()).toHaveLength(stored);
  });

  it('answers 422 for a kind the verification type does not take', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();

    const response = await upload(sessionToken, verificationId, {
      kind: 'selfie-center',
      file: { bytes: IMAGES.jpeg },
    });

    expect(response.statusCode).toBe(422);
  });

  it('replaces the earlier file of a kind while the verification is initiated', async () => {
    // A reload between two uploads makes the flow upload the front again (K001).
    const { sessionToken, verificationId } = await governmentIdReady();
    const first = expectStatus(
      await upload(sessionToken, verificationId, { kind: 'front', file: { bytes: IMAGES.jpeg } }),
      201,
    ).data.id;
    const firstKey = (await getFile(api.database.db, api.environmentId, first))?.storageKey;

    const response = await upload(sessionToken, verificationId, {
      kind: 'front',
      file: { bytes: IMAGES.png },
    });

    const replacement = fileDocumentSchema.parse(expectStatus(response, 201)).data;
    expect(replacement.attributes).toMatchObject({ kind: 'front', 'mime-type': 'image/png' });
    expect(replacement.id).not.toBe(first);
    const files = await listVerificationFiles(api.database.db, api.environmentId, [verificationId]);
    expect(files.map((file) => [file.id, file.kind])).toEqual([[replacement.id, 'front']]);
    expect(await getFile(api.database.db, api.environmentId, first)).toBeNull();
    expect(api.storage.keys()).not.toContain(firstKey);

    expectStatus(
      await upload(sessionToken, verificationId, { kind: 'back', file: { bytes: IMAGES.jpeg } }),
      201,
    );
    expectStatus(await submit(sessionToken, verificationId), 202);
    const [submitted] = api.events
      .named('verification.submitted')
      .filter((event) => event.payload.data.id === verificationId);
    const { data } = eventPayloadSchema.parse(submitted?.payload);
    const fileIds =
      data.type === 'verification/government-id'
        ? data.relationships.files.data.map((file) => file.id)
        : [];
    expect(fileIds).toContain(replacement.id);
    expect(fileIds).not.toContain(first);
  });

  it('discards the replaced file’s rendition pages and deletes their objects after the commit (K8-29)', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();
    const first = expectStatus(
      await upload(sessionToken, verificationId, { kind: 'front', file: { bytes: IMAGES.jpeg } }),
      201,
    ).data.id;
    const page = await renderedPage(api.database.db, api.storage, api.environmentId, first);

    expectStatus(
      await upload(sessionToken, verificationId, { kind: 'front', file: { bytes: IMAGES.png } }),
      201,
    );

    // The page row stays, discarded, so the C16 pass still finds it; its state went with the file.
    expect(await renditionAfter(api.database.db, first, page)).toEqual({
      discarded: true,
      status: null,
    });
    expect(api.storage.keys()).not.toContain(page.storageKey);
  });

  it('answers 409 and keeps nothing when the verification is submitted during the upload', async () => {
    // The state is checked before the body is read; it must hold when the file is stored.
    const { sessionToken, verificationId } = await governmentIdReady();
    const keys = api.storage.keys().length;
    const put = api.storage.put.bind(api.storage);
    const spy = vi.spyOn(api.storage, 'put').mockImplementationOnce(async (key, bytes) => {
      await setVerificationStatus(api.database.db, api.environmentId, verificationId, {
        to: 'submitted',
      });
      return put(key, bytes);
    });

    try {
      const response = await upload(sessionToken, verificationId, {
        kind: 'front',
        file: { bytes: IMAGES.jpeg },
      });

      expect(response.statusCode).toBe(409);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(
        await listVerificationFiles(api.database.db, api.environmentId, [verificationId]),
      ).toEqual([]);
      expect(api.storage.keys()).toHaveLength(keys);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    ['without a kind', { file: { bytes: IMAGES.jpeg } }],
    ['without a file', { kind: 'front' }],
    ['with an unknown kind', { kind: 'side', file: { bytes: IMAGES.jpeg } }],
    ['with an extra field', { kind: 'front', note: 'x', file: { bytes: IMAGES.jpeg } }],
    ['with a file under another name', { kind: 'front', image: { bytes: IMAGES.jpeg } }],
  ])('answers 400 for a body %s', async (_label, fields) => {
    const { sessionToken, verificationId } = await governmentIdReady();

    const response = await upload(sessionToken, verificationId, fields);

    expect(response.statusCode).toBe(400);
  });

  it('answers 415 for a body that is not multipart', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();

    const response = await api.app.inject({
      method: 'POST',
      url: `${VERIFICATIONS}/${verificationId}/files`,
      headers: bearer(sessionToken),
      payload: { kind: 'front' },
    });

    expect(response.statusCode).toBe(415);
  });

  it('answers 409 once the verification was submitted', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await consent(sessionToken);
    const seeded = await seedVerification(api, api.environmentId, inquiryId, {
      status: 'submitted',
    });

    const response = await upload(sessionToken, seeded.id, {
      kind: 'front',
      file: { bytes: IMAGES.jpeg },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('POST /api/v1/flow/verifications/:id/submit', () => {
  async function uploadSides(token: string, verificationId: string) {
    for (const kind of ['front', 'back']) {
      expectStatus(
        await upload(token, verificationId, { kind, file: { bytes: IMAGES.jpeg } }),
        201,
      );
    }
  }

  it('submits a live attempt made beside a cloned pass that does not count (C235.4, H01; integration-11a)', async () => {
    const { inquiryId, sessionToken, verificationId } = await governmentIdReady();
    const clone = await seedVerification(api, api.environmentId, inquiryId, {
      type: 'government_id',
      status: 'passed',
    });
    await api.database.client.query(
      `update verifications set provenance = '{"kind":"connect-clone","share-token-id":"cnst_01M5CN0000000000000011A200","source-organization-name":"Example Partner","source-environment-kind":"sandbox","source-created-at":"2026-10-19T12:00:00.000Z","source-status":"passed","cloned-at":"2026-10-20T11:00:00.000Z"}'::jsonb where id = $1`,
      [clone.id],
    );
    await uploadSides(sessionToken, verificationId);

    expectStatus(await submit(sessionToken, verificationId), 202);
  });

  it('submits, enqueues processing and publishes verification.submitted', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();
    await uploadSides(sessionToken, verificationId);

    const response = await submit(sessionToken, verificationId);

    const document = flowVerificationDocumentSchema.parse(expectStatus(response, 202));
    expect(document.data.attributes.status).toBe('submitted');
    expect(api.queue.jobs).toContainEqual({ environmentId: api.environmentId, verificationId });
    const stored = await getVerification(api.database.db, api.environmentId, verificationId);
    expect(stored?.status).toBe('submitted');
    expect(stored?.submittedAt).toEqual(api.clock.now());
    const events = api.events
      .named('verification.submitted')
      .filter((event) => event.payload.data.id === verificationId);
    expect(events).toHaveLength(1);
    const payload = eventPayloadSchema.parse(events[0]?.payload);
    expect(payload.data.type === 'verification/government-id' && payload.data).toMatchObject({
      attributes: { status: 'submitted' },
      relationships: { files: { data: [expect.anything(), expect.anything()] } },
    });
  });

  it('answers 422 naming the missing sides when the step needs both', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();
    await upload(sessionToken, verificationId, { kind: 'front', file: { bytes: IMAGES.jpeg } });

    const response = await submit(sessionToken, verificationId);

    expect(response.statusCode).toBe(422);
    expect(response.json<{ detail: string }>().detail).toContain('back');
    expect(api.queue.jobs.map((job) => job.verificationId)).not.toContain(verificationId);
  });

  it('needs only the front when the step takes the front side', async () => {
    const templateId = await templateWith((attributes) => {
      const step = attributes.flow.steps.find((candidate) => candidate.type === 'government_id');
      if (step?.type === 'government_id') {
        step.sides = 'front';
      }
    });
    const { sessionToken, verificationId } = await governmentIdReady(templateId);
    await upload(sessionToken, verificationId, { kind: 'front', file: { bytes: IMAGES.jpeg } });

    expect((await submit(sessionToken, verificationId)).statusCode).toBe(202);
  });

  it('needs the center selfie for a selfie verification', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    // C151.4 (Workflow 9A): the ID step passed, so the selfie step is the current one.
    await passStepsBefore(api, inquiryId, 'selfie');
    await consent(sessionToken);
    const verificationId = await newVerification(sessionToken, 'selfie');
    // C40.7: a verification created before Phase 4 needs no capture; selfie-capture-submit.test.ts
    // covers the capture-bound selfie.
    await api.database.client.query(
      'update verifications set selfie_capture_required = false where id = $1',
      [verificationId],
    );

    const missing = await submit(sessionToken, verificationId);
    // C45.1: the default template prompts center, left and right.
    for (const kind of ['selfie-center', 'selfie-left', 'selfie-right'] as const) {
      await upload(sessionToken, verificationId, { kind, file: { bytes: IMAGES.png } });
    }
    const complete = await submit(sessionToken, verificationId);

    expect(missing.statusCode).toBe(422);
    expect(missing.json<{ detail: string }>().detail).toContain('selfie-center');
    expect(complete.statusCode).toBe(202);
  });

  it('is idempotent: a repeated submit enqueues again but publishes once', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();
    await uploadSides(sessionToken, verificationId);

    await submit(sessionToken, verificationId);
    const again = await submit(sessionToken, verificationId);

    expect(again.statusCode).toBe(202);
    expect(api.queue.jobs.filter((job) => job.verificationId === verificationId)).toHaveLength(2);
    expect(
      api.events
        .named('verification.submitted')
        .filter((event) => event.payload.data.id === verificationId),
    ).toHaveLength(1);
  });

  it('answers 409 for a verification whose type already passed (F011)', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await consent(sessionToken);
    await seedVerification(api, api.environmentId, inquiryId, { status: 'passed' });
    const stray = await seedVerification(api, api.environmentId, inquiryId, {
      files: ['front', 'back'],
    });

    const response = await submit(sessionToken, stray.id);

    expect(response.statusCode).toBe(409);
    expect((await getVerification(api.database.db, api.environmentId, stray.id))?.status).toBe(
      'initiated',
    );
    expect(api.queue.jobs.map((job) => job.verificationId)).not.toContain(stray.id);
  });

  it('answers 409 for a decided verification', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const seeded = await seedVerification(api, api.environmentId, inquiryId, { status: 'passed' });

    expect((await submit(sessionToken, seeded.id)).statusCode).toBe(409);
  });

  it('publishes verification.submitted on a retry when the first attempt could not (F014)', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();
    await uploadSides(sessionToken, verificationId);
    api.events.failNext(new Error('events table unavailable'));

    const failed = await submit(sessionToken, verificationId);
    expect(failed.statusCode).toBe(500);
    expect(
      (await getVerification(api.database.db, api.environmentId, verificationId))?.status,
    ).toBe('initiated');
    expect(api.queue.jobs.map((job) => job.verificationId)).not.toContain(verificationId);

    expectStatus(await submit(sessionToken, verificationId), 202);
    expect(
      api.events
        .named('verification.submitted')
        .filter((event) => event.payload.data.id === verificationId),
    ).toHaveLength(1);
    expect(api.queue.jobs.filter((job) => job.verificationId === verificationId)).toHaveLength(1);
  });

  it('publishes once and lets a retry enqueue when the queue is unavailable', async () => {
    const { sessionToken, verificationId } = await governmentIdReady();
    await uploadSides(sessionToken, verificationId);
    api.queue.failNext(new Error('valkey unavailable'));

    const failed = await submit(sessionToken, verificationId);
    const retried = await submit(sessionToken, verificationId);

    expect(failed.statusCode).toBe(500);
    expect(retried.statusCode).toBe(202);
    expect(api.queue.jobs.filter((job) => job.verificationId === verificationId)).toHaveLength(1);
    expect(
      api.events
        .named('verification.submitted')
        .filter((event) => event.payload.data.id === verificationId),
    ).toHaveLength(1);
  });
});

describe('GET /api/v1/flow/verifications/:id', () => {
  it('returns the status and user-facing retry hints only', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const seeded = await seedVerification(api, api.environmentId, inquiryId, {
      type: 'selfie',
      checks: [
        {
          name: 'selfie_image_quality_detection',
          status: 'failed',
          reasons: ['image_too_dark'],
        },
        {
          name: 'selfie_id_comparison',
          status: 'failed',
          type: 'fraud',
          reasons: ['face_mismatch'],
          metadata: { similarity: 0.1 },
        },
      ],
    });
    await setVerificationStatus(api.database.db, api.environmentId, seeded.id, { to: 'failed' });

    const response = await api.app.inject({
      url: `${VERIFICATIONS}/${seeded.id}`,
      headers: bearer(sessionToken),
    });

    const document = flowVerificationDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.attributes).toMatchObject({
      status: 'failed',
      'retry-hints': [{ name: 'selfie_image_quality_detection', reasons: ['image_too_dark'] }],
    });
    expect(response.body).not.toContain('face_mismatch');
    expect(response.body).not.toContain('similarity');
  });

  it('answers 400 for a malformed id', async () => {
    const { sessionToken } = await openFlowSession(api);

    const response = await api.app.inject({
      url: `${VERIFICATIONS}/ver_nope`,
      headers: bearer(sessionToken),
    });

    expect(response.statusCode).toBe(400);
  });
});
