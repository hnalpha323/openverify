/**
 * C207.2 (decision 63; review P01), C208.2, C221.1 (Phase 10, Workflow 10C; `api-nfc`): the
 * contract of `GET /api/v1/flow/session` at an `nfc` step, through the real hook. A web client's
 * session carries no `prefillMrz` and no `sandboxChipAvailable`, whatever the inquiry holds; an SDK
 * client's carries both; and neither reaches a client that did not declare spec 2. The served
 * views have the members of the goldens `flow-session-nfc.json` (web) and
 * `flow-session-nfc-sdk.json`.
 */
import { readFileSync } from 'node:fs';
import {
  listInquirySessions,
  recordSessionDeviceFields,
  setVerificationStatus,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema, nfcClientViewSchema } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  expectStatus,
  resumeInquiry,
  seedVerification,
} from '../../test-support/harness.js';
import { installSandboxTrustAnchor } from '../../trust-anchors/sandbox.js';
import { td3ExtractionFields } from '../chip-challenges/testing.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
  await installSandboxTrustAnchor(api.database.db, { now: new Date() });
});

afterAll(async () => {
  await api.close();
});

const FLOW = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'nfc-contract', version: 1, name: 'nfc-contract' },
  entry: 'chip',
  steps: [
    { id: 'chip', type: 'nfc', androidOnly: true, maxAttempts: 3 },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    { id: 'e1', from: 'chip', port: 'next', to: 'done' },
    { id: 'e2', from: 'chip', port: 'exhausted', to: 'done' },
  ],
});

const golden = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../contracts/fixtures/api/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as { step: Record<string, unknown> };

/** A session at the chip step whose inquiry holds a decided Utopia passport reading. */
async function sessionAtChip(options: { sdk: boolean }): Promise<string> {
  const { db } = api.database;
  const { inquiry } = await createTestInquiry(db, api.environmentId, { flow: FLOW });
  const sessionToken = await resumeInquiry(api, inquiry.id);
  const [session] = (await listInquirySessions(db, api.environmentId, { inquiryId: inquiry.id }))
    .items;
  if (session === undefined) {
    throw new Error('the inquiry has no session');
  }
  if (options.sdk) {
    await recordSessionDeviceFields(db, api.environmentId, session.id, {
      osName: 'Android',
      osFullVersion: '14',
      browserName: null,
      browserFullVersion: null,
      deviceType: 'smartphone',
      deviceName: null,
      mobileSdkName: 'openverify-android',
      mobileSdkFullVersion: '0.1.0',
    });
  }
  const id = await seedVerification(api, api.environmentId, inquiry.id, {
    type: 'government_id',
    extraction: {
      fields: td3ExtractionFields(),
      sources: {
        'identification-number': ['mrz'],
        birthdate: ['mrz'],
        'expiration-date': ['mrz'],
      },
    },
  });
  // The reading's class, as the worker establishes it.
  await db.execute(sql`update verifications set id_class = 'passport' where id = ${id.id}`);
  await setVerificationStatus(db, api.environmentId, id.id, { to: 'submitted' });
  await setVerificationStatus(db, api.environmentId, id.id, { to: 'passed' });
  return sessionToken;
}

const read = async (sessionToken: string, spec: string | null) =>
  expectStatus(
    await api.app.inject({
      url: '/api/v1/flow/session',
      headers: {
        ...bearer(sessionToken),
        ...(spec === null ? {} : { 'openverify-flow-spec': spec }),
      },
    }),
    200,
  ) as { step?: Record<string, unknown> };

describe('GET /api/v1/flow/session at an nfc step (C207.2, C208.2)', () => {
  it('serves a web client neither prefillMrz nor sandboxChipAvailable', async () => {
    const body = await read(await sessionAtChip({ sdk: false }), '2');

    expect(body.step).toEqual({
      id: 'chip',
      type: 'nfc',
      androidOnly: true,
      maxAttempts: 3,
      fallbackAvailable: true,
    });
    expect(Object.keys(body.step ?? {}).sort()).toEqual(
      Object.keys(golden('flow-session-nfc').step).sort(),
    );
    expect(JSON.stringify(body)).not.toContain('UT1234567');
  });

  it('serves an SDK client both, in the client view’s shape', async () => {
    const body = await read(await sessionAtChip({ sdk: true }), '2');

    expect(body.step).toEqual({
      id: 'chip',
      type: 'nfc',
      androidOnly: true,
      maxAttempts: 3,
      fallbackAvailable: true,
      sandboxChipAvailable: true,
      prefillMrz: { documentNumber: 'UT1234567', birthDate: '900412', expiryDate: '310411' },
    });
    expect(nfcClientViewSchema.safeParse(body.step).success).toBe(true);
    expect(Object.keys(body.step ?? {}).sort()).toEqual(
      Object.keys(golden('flow-session-nfc-sdk').step).sort(),
    );
  });

  it('serves no step view, so neither member, to a client that did not declare spec 2', async () => {
    const body = await read(await sessionAtChip({ sdk: true }), null);

    expect(body).not.toHaveProperty('step');
    expect(JSON.stringify(body)).not.toContain('UT1234567');
  });
});
