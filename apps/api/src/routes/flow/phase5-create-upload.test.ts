/**
 * C52.2, C50.7: creation refuses a client-created silent AAMVA attempt, stops at a skipped
 * attempt, and reuses an open `confirmed` one. C52.4: uploads are typed per kind by content (a
 * PDF document, a chip file's TLV), capped per kind, and served-written kinds are refused.
 */
import { newId, type SupportedVerificationType } from '@openverify/contracts';
import { createVerification, setVerificationStatus } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTemplate,
  createTestApi,
  expectStatus,
  multipart,
  resumeInquiry,
  type TestApi,
} from '../../test-support/harness.js';
import { passStepsBefore } from '../../flow-engine/testing.js';
import { phase5TemplateAttributes } from '../../test-support/phase5-templates.js';

let api: TestApi;
let templateId: string;

beforeAll(async () => {
  // C55.10: the template's phone step publishes only with an SMS sender bound.
  api = await createTestApi();
  templateId = await createTemplate(api, api.token, phase5TemplateAttributes());
});

afterAll(async () => {
  await api.close();
});

const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

/**
 * A started inquiry of the Phase 5 template, with consent, and its session token; with `at`, the
 * steps before that type's are passed first, so it is the current step (C151.4, Workflow 9A).
 */
async function session(at?: SupportedVerificationType) {
  const inquiryId = await createInquiry(api, { templateId });
  const token = await resumeInquiry(api, inquiryId);
  if (at !== undefined) {
    await passStepsBefore(api, inquiryId, at);
  }
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(token),
      payload: CONSENT_BODY,
    }),
    201,
  );
  return { inquiryId, token };
}

function create(token: string, type: string) {
  return api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/verifications',
    headers: bearer(token),
    payload: { type },
  });
}

async function seed(inquiryId: string, type: 'government_id' | 'document' | 'government_id_nfc') {
  return createVerification(api.database.db, api.environmentId, {
    id: newId('ver'),
    inquiryId,
    type,
  });
}

describe('POST /flow/verifications (C52.2, C50.7)', () => {
  it('answers 409 verification_created_by_server for a silent AAMVA step', async () => {
    const { token } = await session();

    const response = await create(token, 'aamva');

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'verification_created_by_server' });
  });

  it('answers 409 when the type latest attempt was skipped', async () => {
    const { inquiryId, token } = await session();
    const skipped = await seed(inquiryId, 'government_id');
    await setVerificationStatus(api.database.db, api.environmentId, skipped.id, { to: 'skipped' });

    const response = await create(token, 'government-id');

    expect(response.statusCode).toBe(409);
  });

  it('returns an open confirmed attempt instead of creating another', async () => {
    const { inquiryId, token } = await session();
    const confirmed = await seed(inquiryId, 'government_id');
    await setVerificationStatus(api.database.db, api.environmentId, confirmed.id, {
      to: 'confirmed',
    });

    const response = await create(token, 'government-id');

    expect(expectStatus(response, 201).data.id).toBe(confirmed.id);
  });
});

/** `%PDF-` after a short preamble, then synthetic bytes: no real document. */
const PDF = new Uint8Array([
  0x0a,
  ...new TextEncoder().encode('%PDF-1.7\n'),
  ...Array.from({ length: 32 }, (_, index) => index),
]);
/** One DER TLV with the SOD tag (0x77) and a short synthetic value. */
const SOD = new Uint8Array([0x77, 0x04, 0x01, 0x02, 0x03, 0x04]);
/** A DG1 TLV of 65 KiB, over the 64 KiB chip file cap. */
function oversizeDg1(): Uint8Array {
  const length = 65 * 1024;
  return new Uint8Array([
    0x61,
    0x83,
    length >> 16,
    (length >> 8) & 0xff,
    length & 0xff,
    ...new Uint8Array(length),
  ]);
}

async function upload(token: string, verificationId: string, kind: string, bytes: Uint8Array) {
  const body = await multipart({ kind, file: { bytes } });
  return api.app.inject({
    method: 'POST',
    url: `/api/v1/flow/verifications/${verificationId}/files`,
    headers: { ...bearer(token), ...body.headers },
    payload: body.payload,
  });
}

describe('POST /flow/verifications/:id/files (C52.4)', () => {
  it('takes a PDF for a document, typed by its content', async () => {
    const { inquiryId, token } = await session('document');
    const document = await seed(inquiryId, 'document');

    const response = await upload(token, document.id, 'document', PDF);

    expect(expectStatus(response, 201).data.attributes).toMatchObject({
      kind: 'document',
      'mime-type': 'application/pdf',
    });
  });

  it('takes a chip file whose content is one TLV of its tag, and refuses one that is not', async () => {
    const { inquiryId, token } = await session('government_id_nfc');
    const chip = await seed(inquiryId, 'government_id_nfc');

    const accepted = await upload(token, chip.id, 'chip-sod', SOD);
    const refused = await upload(token, chip.id, 'chip-dg1', SOD);

    expect(expectStatus(accepted, 201).data.attributes).toMatchObject({
      kind: 'chip-sod',
      'mime-type': 'application/octet-stream',
    });
    expect(refused.statusCode).toBe(415);
  });

  it('answers 413 for a chip file over its 64 KiB cap', async () => {
    const { inquiryId, token } = await session('government_id_nfc');
    const chip = await seed(inquiryId, 'government_id_nfc');

    const response = await upload(token, chip.id, 'chip-dg1', oversizeDg1());

    expect(response.statusCode).toBe(413);
  });

  it('refuses a server-written kind with 422', async () => {
    const { inquiryId, token } = await session('document');
    const document = await seed(inquiryId, 'document');

    const response = await upload(token, document.id, 'document-preview', PDF);

    expect(response.statusCode).toBe(422);
  });
});
