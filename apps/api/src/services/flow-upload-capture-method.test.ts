/**
 * C153.2 (Workflow 9A, api-flow-engine): the client-reported capture method of an upload is stored
 * as `files.capture_method` (`camera` or `upload`), and a file uploaded without one stores `null`
 * (unknown, never a guess). Every image is synthetic.
 */
import { listVerificationFiles } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reachStep } from '../flow-engine/testing.js';
import {
  createInquiry,
  IMAGES,
  resumeInquiry,
  seedVerification,
  type TestApi,
} from '../test-support/harness.js';
import { uploadFile, type Upload } from './flow.js';
import { createInquiryTestApi } from './inquiries.test-support.js';
import { listInquirySessions } from '@openverify/db';

let api: TestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

/** A session at the government ID step with an open ID verification. */
async function atIdStep() {
  const inquiryId = await createInquiry(api);
  const token = await resumeInquiry(api, inquiryId);
  await reachStep(api, inquiryId, token, 'government_id');
  const [session] = (await listInquirySessions(api.database.db, api.environmentId, { inquiryId }))
    .items;
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type: 'government_id',
  });
  return {
    session: { id: session?.id ?? '', environmentId: api.environmentId, inquiryId },
    verificationId: id,
  };
}

const upload = (at: Awaited<ReturnType<typeof atIdStep>>, file: Upload) =>
  uploadFile(api.deps, at.session, at.verificationId, () => Promise.resolve(file));

describe('the upload’s capture method (C153.2)', () => {
  it('stores the method the client reports, and null when it reports none', async () => {
    const at = await atIdStep();
    await upload(at, { kind: 'front', bytes: IMAGES.jpeg, captureMethod: 'camera' });
    await upload(at, { kind: 'back', bytes: IMAGES.png });
    const files = await listVerificationFiles(api.database.db, api.environmentId, [
      at.verificationId,
    ]);
    expect(Object.fromEntries(files.map((file) => [file.kind, file.captureMethod]))).toEqual({
      front: 'camera',
      back: null,
    });
  });
});
