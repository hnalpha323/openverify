/**
 * C206.2 (Workflow 10B Stage 1b, checkpoint 2 (C), `foundation-10b`): an upload's client-reported
 * `capture-trigger` (`auto`, `manual`) reaches `files.capture_trigger` as received, validated by the
 * contract's enum; any other value is a 400 and stores nothing. The API's file resources serve it as
 * the file attribute `capture-trigger` (labelled client-reported in the schema), `null` when the client
 * sent none; the flow's upload answer echoes no capture fact (C40.10, contracts-10b's 10B D1 (b)).
 * Every value is synthetic.
 */
import { listInquirySessions, listVerificationFiles } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reachStep } from '../../flow-engine/testing.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  IMAGES,
  multipart,
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

async function atIdStep() {
  const inquiryId = await createInquiry(api);
  const token = await resumeInquiry(api, inquiryId);
  await reachStep(api, inquiryId, token, 'government_id');
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type: 'government_id',
  });
  const sessions = await listInquirySessions(api.database.db, api.environmentId, { inquiryId });
  expect(sessions.items).toHaveLength(1);
  return { token, verificationId: id };
}

const send = async (token: string, verificationId: string, fields: Record<string, string>) => {
  const body = await multipart({ ...fields, file: { bytes: IMAGES.jpeg } });
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${verificationId}/files`,
    headers: { ...bearer(token), ...body.headers },
    payload: body.payload,
  });
};

const stored = async (verificationId: string) =>
  (await listVerificationFiles(api.database.db, api.environmentId, [verificationId])).map(
    (file) => [file.kind, file.captureMethod, file.captureTrigger],
  );

interface FileDocument {
  included?: { type: string; id: string; attributes: Record<string, unknown> }[];
}

describe('an upload names its capture trigger (C206.2)', () => {
  it('stores the trigger the client reports, beside its method', async () => {
    const at = await atIdStep();

    expectStatus(
      await send(at.token, at.verificationId, {
        kind: 'front',
        'capture-method': 'camera',
        'capture-trigger': 'auto',
      }),
      201,
    );

    expect(await stored(at.verificationId)).toEqual([['front', 'camera', 'auto']]);
  });

  it('stores no trigger when the client sent none', async () => {
    const at = await atIdStep();

    expectStatus(await send(at.token, at.verificationId, { kind: 'front' }), 201);

    expect(await stored(at.verificationId)).toEqual([['front', null, null]]);
  });

  it('refuses a trigger outside the list with 400 and stores nothing', async () => {
    const at = await atIdStep();

    const response = await send(at.token, at.verificationId, {
      kind: 'front',
      'capture-trigger': 'timer',
    });

    expectStatus(response, 400);
    expect(response.body).not.toContain('timer');
    expect(await stored(at.verificationId)).toEqual([]);
  });

  it('refuses a repeated trigger field with 400', async () => {
    const at = await atIdStep();
    const form = new FormData();
    form.append('kind', 'front');
    form.append('capture-trigger', 'auto');
    form.append('capture-trigger', 'manual');
    form.append('file', new Blob([IMAGES.jpeg]), 'upload.bin');
    const request = new Request('http://localhost/', { method: 'POST', body: form });

    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${at.verificationId}/files`,
      headers: {
        ...bearer(at.token),
        'content-type': request.headers.get('content-type') ?? '',
      },
      payload: Buffer.from(await request.arrayBuffer()),
    });

    expectStatus(response, 400);
    expect(await stored(at.verificationId)).toEqual([]);
  });

  it('echoes no capture fact in the flow answer, and serves both, client-reported, on the server API', async () => {
    const at = await atIdStep();
    const upload = await send(at.token, at.verificationId, {
      kind: 'front',
      'capture-method': 'camera',
      'capture-trigger': 'manual',
    });
    expectStatus(upload, 201);
    expect(upload.body).not.toContain('capture-trigger');
    expect(upload.body).not.toContain('capture-method');

    const read = await api.app.inject({
      url: `/api/v1/verifications/${at.verificationId}?include=files`,
      headers: bearer(api.token),
    });
    expectStatus(read, 200);
    const document = JSON.parse(read.body) as FileDocument;
    expect(document.included?.map((file) => file.attributes)).toEqual([
      expect.objectContaining({ 'capture-method': 'camera', 'capture-trigger': 'manual' }),
    ]);
  });
});
