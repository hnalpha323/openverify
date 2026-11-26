/**
 * C52.4, C52.6, C54.1: a document verification through the flow API, now that its job runs. It is
 * created with its guidance, takes its `document` file (a PDF, or a photo of the document, typed
 * by its content), refuses the server-written `document-preview`, and is submitted only once its
 * file is stored, with no body member of another type (the standard guard). A repeated submit only
 * enqueues again. Canceling it touches no sub-resource: its upload stays, as a government ID's
 * photos do, and no extraction or preview exists before the job. Every file is synthetic.
 */
import {
  defaultInquiryTemplateAttributes,
  flowVerificationDocumentSchema,
} from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import { getVerification, listVerificationFiles } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import {
  IMAGES,
  bearer,
  createTemplate,
  expectStatus,
  multipart,
  openFlowSession,
} from '../../test-support/harness.js';
import { documentSubResources } from '../sub-resources/document.js';

let api: InquiryTestApi;
let templateId: string;

const VERIFICATIONS = '/api/v1/flow/verifications';
const PDF = new TextEncoder().encode('%PDF-1.7\n% a synthetic bill\n%%EOF\n');

beforeAll(async () => {
  api = await createInquiryTestApi();
  const attributes = defaultInquiryTemplateAttributes();
  attributes.name = 'Proof of address';
  const consent = attributes.flow.steps.find((step) => step.type === 'consent');
  const completion = attributes.flow.steps.find((step) => step.type === 'completion');
  if (consent === undefined || completion === undefined) {
    throw new Error('the default template has a consent and a completion step');
  }
  attributes.flow.steps = [
    consent,
    {
      id: 'proof-of-address',
      type: 'document',
      documentTypes: ['utility_bill', 'bank_statement'],
      captureMethods: ['upload', 'camera'],
    },
    completion,
  ];
  attributes.flow.transitions = [];
  attributes['verification-config'] = { document: defaultTemplateConfig('document') };
  templateId = await createTemplate(api, api.token, attributes);
});

afterAll(async () => {
  await api.close();
});

async function consented() {
  const session = await openFlowSession(api, { templateId });
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(session.sessionToken),
      payload: {
        accepted: true,
        'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
        locale: 'en',
      },
    }),
    201,
  );
  return session;
}

async function created(token: string) {
  const response = await api.app.inject({
    method: 'POST',
    url: VERIFICATIONS,
    headers: bearer(token),
    payload: { type: 'document' },
  });
  return flowVerificationDocumentSchema.parse(expectStatus(response, 201)).data;
}

async function upload(token: string, verificationId: string, kind: string, bytes: Uint8Array) {
  const { payload, headers } = await multipart({ kind, file: { bytes } });
  return api.app.inject({
    method: 'POST',
    url: `${VERIFICATIONS}/${verificationId}/files`,
    headers: { ...bearer(token), ...headers },
    payload,
  });
}

function submit(token: string, verificationId: string, payload?: Record<string, unknown>) {
  return api.app.inject({
    method: 'POST',
    url: `${VERIFICATIONS}/${verificationId}/submit`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });
}

describe('a document verification through the flow API (C52.4, C52.6)', () => {
  it('is created with its guidance, takes a PDF and is submitted once its file is stored', async () => {
    const { sessionToken } = await consented();
    const verification = await created(sessionToken);
    expect(verification).toMatchObject({
      type: 'verification/document',
      attributes: {
        status: 'initiated',
        guidance: {
          'accepted-types': ['utility_bill', 'bank_statement'],
          'max-age-days': 90,
          'max-pages': 50,
          'accepted-mime-types': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        },
      },
    });

    const missing = await submit(sessionToken, verification.id);
    expect(missing.statusCode).toBe(422);
    expect(missing.json<{ detail: string }>().detail).toContain('document');

    const file = expectStatus(await upload(sessionToken, verification.id, 'document', PDF), 201);
    expect(file.data).toMatchObject({
      attributes: { kind: 'document', 'mime-type': 'application/pdf' },
    });
    expectStatus(await submit(sessionToken, verification.id), 202);

    expect(
      await getVerification(api.database.db, api.environmentId, verification.id),
    ).toMatchObject({ status: 'submitted' });
    expect(api.queue.jobs).toContainEqual({
      environmentId: api.environmentId,
      verificationId: verification.id,
    });
    expectStatus(await submit(sessionToken, verification.id), 202);
    expect(api.queue.jobs.filter((job) => job.verificationId === verification.id)).toHaveLength(2);
  });

  it('takes a photo of the document as the image it is', async () => {
    const { sessionToken } = await consented();
    const verification = await created(sessionToken);

    const file = expectStatus(
      await upload(sessionToken, verification.id, 'document', IMAGES.jpeg),
      201,
    );

    expect(file.data).toMatchObject({
      attributes: { kind: 'document', 'mime-type': 'image/jpeg' },
    });
    expectStatus(await submit(sessionToken, verification.id), 202);
  });

  it('refuses the preview kind, which only the server writes, and a file that is neither image nor PDF', async () => {
    const { sessionToken } = await consented();
    const verification = await created(sessionToken);

    const preview = await upload(sessionToken, verification.id, 'document-preview', IMAGES.png);
    const text = await upload(
      sessionToken,
      verification.id,
      'document',
      new TextEncoder().encode('plain text, not a document'),
    );

    expect(preview.statusCode).toBe(422);
    expect(text.statusCode).toBe(415);
    expect(
      await listVerificationFiles(api.database.db, api.environmentId, [verification.id]),
    ).toEqual([]);
  });

  it.each([
    ['capture', { capture: { id: 'self_01M5MYNQF59Z6NRCAFSWWNYM7Z', nonce: 'A'.repeat(22) } }],
    ['crypto', { crypto: { 'challenge-id': 'cwc_01M5MYNQF59Z6NRCAFSWWNYM7Z', signature: '0x00' } }],
  ])('refuses a submit body carrying a %s member', async (_, body) => {
    const { sessionToken } = await consented();
    const verification = await created(sessionToken);
    expectStatus(await upload(sessionToken, verification.id, 'document', PDF), 201);

    const response = await submit(sessionToken, verification.id, body);

    expect(response.statusCode, response.body).toBe(422);
    expect(response.json<{ detail: string }>().detail).toMatch(
      /^A document verification takes no /,
    );
    expect(
      await getVerification(api.database.db, api.environmentId, verification.id),
    ).toMatchObject({ status: 'initiated' });
  });
});

describe('canceling a document verification (C54.1)', () => {
  it('touches no sub-resource and deletes no object: its upload stays, as a government ID’s photos do', async () => {
    const { sessionToken } = await consented();
    const verification = await created(sessionToken);
    expectStatus(await upload(sessionToken, verification.id, 'document', PDF), 201);
    const row = await getVerification(api.database.db, api.environmentId, verification.id);
    if (row === null) {
      throw new Error('the verification was not created');
    }

    const canceled = await documentSubResources.onVerificationCanceled(
      api.database.db,
      api.events,
      row,
    );

    expect(canceled).toEqual({ staged: [], storageKeys: [] });
    expect(
      (await listVerificationFiles(api.database.db, api.environmentId, [verification.id])).map(
        (file) => file.kind,
      ),
    ).toEqual(['document']);
  });
});
