/**
 * C173.2 (Workflow 9B, `api-cases-reports`; K17, contracts B38): `GET /verifications/:id` serves
 * `include=files`, the verification's file resources with metadata only (the existing file contract:
 * kind, MIME type, size, time, the verification it belongs to; never content or a value), and
 * `redacted-at`, when the verification's data was redacted with its inquiry (left out before, so an
 * unredacted verification reads the same as in every other exit).
 * `include=selfies` is unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, createInquiry, seedVerification } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

interface Document {
  data: {
    attributes: Record<string, unknown>;
    relationships: { files: { data: { type: string; id: string }[] } };
  };
  included?: {
    type: string;
    id: string;
    attributes: Record<string, unknown>;
    relationships: Record<string, { data: unknown }>;
  }[];
}

const read = async (id: string, include?: string) => {
  const response = await api.app.inject({
    url: `/api/v1/verifications/${id}${include === undefined ? '' : `?include=${include}`}`,
    headers: bearer(api.token),
  });
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as Document;
};

describe('GET /api/v1/verifications/:id?include=files (C173.2)', () => {
  it('includes each file with its metadata only, in the order of the relationship', async () => {
    const inquiryId = await createInquiry(api);
    const verification = await seedVerification(api, api.environmentId, inquiryId, {
      status: 'failed',
      files: ['front', 'back'],
    });

    const document = await read(verification.id, 'files');

    expect(document.data.relationships.files.data.map(({ id }) => id)).toEqual(
      verification.fileIds,
    );
    expect(document.included?.map(({ type, id }) => ({ type, id }))).toEqual(
      verification.fileIds.map((id) => ({ type: 'file', id })),
    );
    for (const file of document.included ?? []) {
      expect(Object.keys(file.attributes).sort()).toEqual([
        'byte-size',
        // Workflow 10B (C206): client-reported, null when the client sent none.
        'capture-method',
        'capture-trigger',
        'created-at',
        'kind',
        'mime-type',
      ]);
      expect(file.relationships.verification?.data).toEqual({
        type: 'verification/government-id',
        id: verification.id,
      });
    }
    expect((await read(verification.id, 'selfies')).included).toEqual([]);
  });

  it('includes nothing for a verification without files', async () => {
    const inquiryId = await createInquiry(api);
    const verification = await seedVerification(api, api.environmentId, inquiryId);

    expect((await read(verification.id, 'files')).included).toEqual([]);
  });
});

describe('redacted-at (C173.2)', () => {
  it('is left out until the verification’s inquiry is redacted, then its time', async () => {
    const inquiryId = await createInquiry(api);
    const verification = await seedVerification(api, api.environmentId, inquiryId, {
      status: 'failed',
    });

    expect((await read(verification.id)).data.attributes).not.toHaveProperty('redacted-at');

    const at = '2026-10-30T08:00:00.000Z';
    await api.database.client.query('update inquiries set redacted_at = $1 where id = $2', [
      at,
      inquiryId,
    ]);

    expect((await read(verification.id)).data.attributes['redacted-at']).toBe(at);
    expect((await read(verification.id, 'files')).data.attributes['redacted-at']).toBe(at);
  });
});
