/**
 * Workflow 11A integration-11a (C235.7(a), C242.4): the console's inquiry read serves a copy's
 * `provenance`, as the server API does, so the console can show the Cloned banner. Synthetic rows.
 */
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { getInquiry } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toInquiryResource } from './resources.js';

/** The row, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('the test expected a row');
  }
  return value;
}

const PROVENANCE = {
  kind: 'connect-clone',
  'share-token-id': 'cnst_01M5CN0000000000000011A200',
  'source-organization-name': 'Example Source',
  'source-environment-kind': 'sandbox',
  'source-created-at': '2026-10-20T12:00:00.000Z',
  'source-status': 'approved',
  'cloned-at': '2026-10-20T12:15:20.000Z',
};

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('toInquiryResource (the console read)', () => {
  it('serves a clone’s provenance, and none for an inquiry that is not a copy', async () => {
    const { environment } = await createTestTenant(database.db, { kind: 'sandbox' });
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const plain = await getInquiry(database.db, environment.id, inquiry.id);
    expect(toInquiryResource(must(plain), []).attributes).not.toHaveProperty('provenance');

    await database.client.query('update inquiries set provenance = $1 where id = $2', [
      JSON.stringify(PROVENANCE),
      inquiry.id,
    ]);
    const clone = await getInquiry(database.db, environment.id, inquiry.id);
    expect(toInquiryResource(must(clone), []).attributes).toMatchObject({ provenance: PROVENANCE });
  });
});
