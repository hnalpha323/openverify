/**
 * C207.2, C208.2, C221.1 (Phase 10, Workflow 10C; `api-nfc`): the `nfc` client view's members that
 * need the inquiry and the environment.
 *
 * - `prefillMrz`: the MRZ's access-key fields of the inquiry's latest decided government ID, only
 *   for an SDK client (`mobile-sdk-name` set) while the `nfc` step is the active position, and only
 *   when that ID is of a class whose MRZ is TD1 or TD3 and its reading took all three fields from
 *   the MRZ. Never for the web flow (decision 63; review P01).
 * - `sandboxChipAvailable`: only in a sandbox environment whose trust store lists the current
 *   Utopia test anchor, for the same SDK client at the same step (C208.2; review F27).
 *
 * Every value is synthetic (the Utopia specimen holder of the API's NFC tests).
 */
import { randomBytes } from 'node:crypto';
import type { IdClass } from '@openverify/core';
import {
  createGovernmentIdExtraction,
  createInquirySession,
  createVerification,
  getInquiry,
  hashSessionToken,
  listInquiryVerifications,
  recordSessionDeviceFields,
  setVerificationStatus,
  type Db,
  type Inquiry,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { flowV2Schema, nfcClientViewSchema, type NfcClientView } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installSandboxTrustAnchor } from '../../trust-anchors/sandbox.js';
import { td3ExtractionFields } from '../chip-challenges/testing.js';
import { nfcSessionMembers, type NfcSessionMembersInput } from './nfc.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const clock = { now: () => NOW };
const STEP: NfcClientView = { id: 'chip', type: 'nfc', androidOnly: true, fallbackAvailable: true };

let database: TestDatabase;
let db: Db;
let sandboxEnv: string;
let productionEnv: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  sandboxEnv = (await createTestTenant(db, { organizationName: 'Nfc View Org' })).environment.id;
  productionEnv = (await createTestTenant(db, { kind: 'production' })).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** The pinned flow: the chip step, then completion. */
const FLOW = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'nfc-view', version: 1, name: 'nfc-view' },
  entry: 'chip',
  steps: [
    { id: 'chip', type: 'nfc', androidOnly: true },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    { id: 'e1', from: 'chip', port: 'next', to: 'done' },
    { id: 'e2', from: 'chip', port: 'exhausted', to: 'done' },
  ],
});

const MRZ_FIELDS = ['identification-number', 'birthdate', 'expiration-date'] as const;

interface IdOptions {
  idClass?: IdClass | null;
  status?: 'submitted' | 'passed' | 'needs_review' | 'failed';
  fields?: Partial<ReturnType<typeof td3ExtractionFields>>;
  /** The fields the reading took from the MRZ (all three by default). */
  fromMrz?: readonly (typeof MRZ_FIELDS)[number][];
}

async function addGovernmentId(inquiry: Inquiry, options: IdOptions = {}): Promise<string> {
  const id = testId('ver');
  await createVerification(db, inquiry.environmentId, {
    id,
    inquiryId: inquiry.id,
    type: 'government_id',
    idClass: options.idClass === undefined ? 'passport' : options.idClass,
  });
  await createGovernmentIdExtraction(db, inquiry.environmentId, {
    verificationId: id,
    fields: { ...td3ExtractionFields(), ...options.fields },
    fieldSources: Object.fromEntries(
      (options.fromMrz ?? MRZ_FIELDS).map((field) => [field, ['mrz'] as const]),
    ),
    identificationNumberIndex: null,
    frontPhash: null,
  });
  await setVerificationStatus(db, inquiry.environmentId, id, { to: 'submitted' });
  const status = options.status ?? 'passed';
  if (status !== 'submitted') {
    await setVerificationStatus(db, inquiry.environmentId, id, { to: status });
  }
  return id;
}

/** An inquiry positioned at the `chip` step, with a session (an SDK's unless `web`). */
async function atChipStep(
  environmentId: string,
  options: { web?: boolean; stepId?: string; state?: 'active' | 'waiting' | 'ended' } = {},
): Promise<{ inquiry: Inquiry; sessionId: string }> {
  const created = await createTestInquiry(db, environmentId, { flow: FLOW });
  await db.execute(
    sql`update inquiries set flow_step_id = ${options.stepId ?? 'chip'},
                             flow_state = ${options.state ?? 'active'}
         where id = ${created.inquiry.id}`,
  );
  const inquiry = await getInquiry(db, environmentId, created.inquiry.id);
  if (inquiry === null) {
    throw new Error('the inquiry is gone');
  }
  const session = await createInquirySession(db, environmentId, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_synthetic_${randomBytes(16).toString('hex')}`),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  });
  if (options.web !== true) {
    await recordSessionDeviceFields(db, environmentId, session.id, {
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
  return { inquiry, sessionId: session.id };
}

async function members(
  target: { inquiry: Inquiry; sessionId: string | null },
  overrides: Partial<NfcSessionMembersInput> = {},
) {
  const { inquiry } = target;
  return nfcSessionMembers(
    db,
    {
      inquiry,
      step: STEP,
      sessionId: target.sessionId,
      environmentKind: inquiry.environmentId === productionEnv ? 'production' : 'sandbox',
      verifications: await listInquiryVerifications(db, inquiry.environmentId, inquiry.id),
      ...overrides,
    },
    clock,
  );
}

const PREFILL = { documentNumber: 'UT1234567', birthDate: '900412', expiryDate: '310411' };

describe('nfcSessionMembers: prefillMrz (C207.2)', () => {
  it('serves an SDK client the decided ID’s MRZ key fields, as the MRZ holds them', async () => {
    const target = await atChipStep(sandboxEnv);
    await addGovernmentId(target.inquiry);

    const answer = await members(target);

    expect(answer.prefillMrz).toEqual(PREFILL);
    expect(nfcClientViewSchema.safeParse({ ...STEP, ...answer }).success).toBe(true);
  });

  it('never serves the web flow, or a caller without a session', async () => {
    const web = await atChipStep(sandboxEnv, { web: true });
    await addGovernmentId(web.inquiry);
    const sdk = await atChipStep(sandboxEnv);
    await addGovernmentId(sdk.inquiry);

    expect(await members(web)).not.toHaveProperty('prefillMrz');
    expect(await members({ inquiry: sdk.inquiry, sessionId: null })).not.toHaveProperty(
      'prefillMrz',
    );
    expect(await members({ inquiry: sdk.inquiry, sessionId: web.sessionId })).not.toHaveProperty(
      'prefillMrz',
    );
  });

  it('serves it only while the nfc step is the active position', async () => {
    for (const position of [
      { stepId: 'done' },
      { state: 'waiting' },
      { state: 'ended' },
    ] as const) {
      const target = await atChipStep(sandboxEnv, position);
      await addGovernmentId(target.inquiry);

      expect(await members(target)).not.toHaveProperty('prefillMrz');
    }
  });

  it('needs a decided government ID: none, a submitted or a failed one serve nothing', async () => {
    const none = await atChipStep(sandboxEnv);
    expect(await members(none)).not.toHaveProperty('prefillMrz');
    for (const status of ['submitted', 'failed'] as const) {
      const target = await atChipStep(sandboxEnv);
      await addGovernmentId(target.inquiry, { status });

      expect(await members(target)).not.toHaveProperty('prefillMrz');
    }
    const reviewed = await atChipStep(sandboxEnv);
    await addGovernmentId(reviewed.inquiry, { status: 'needs_review' });
    expect((await members(reviewed)).prefillMrz).toEqual(PREFILL);
  });

  it('needs a class whose MRZ is TD1 or TD3', async () => {
    for (const idClass of [
      'passport',
      'national_id',
      'residence_permit',
      'passport_card',
    ] as const) {
      const target = await atChipStep(sandboxEnv);
      await addGovernmentId(target.inquiry, { idClass });

      expect((await members(target)).prefillMrz, idClass).toEqual(PREFILL);
    }
    for (const idClass of ['drivers_license', 'visa', null] as const) {
      const target = await atChipStep(sandboxEnv);
      await addGovernmentId(target.inquiry, { idClass });

      expect(await members(target), String(idClass)).not.toHaveProperty('prefillMrz');
    }
  });

  it('needs all three fields read from the MRZ, in a form the MRZ can hold', async () => {
    for (const fromMrz of [
      ['identification-number', 'birthdate'],
      ['birthdate', 'expiration-date'],
      [],
    ] as const) {
      const target = await atChipStep(sandboxEnv);
      await addGovernmentId(target.inquiry, { fromMrz });

      expect(await members(target)).not.toHaveProperty('prefillMrz');
    }
    for (const fields of [
      { 'identification-number': 'é-17' },
      { birthdate: null },
      { 'expiration-date': null },
    ]) {
      const target = await atChipStep(sandboxEnv);
      await addGovernmentId(target.inquiry, { fields });

      expect(await members(target)).not.toHaveProperty('prefillMrz');
    }
  });

  it('folds the document number to the MRZ’s characters', async () => {
    const target = await atChipStep(sandboxEnv);
    await addGovernmentId(target.inquiry, { fields: { 'identification-number': 'ut 12-34567' } });

    expect((await members(target)).prefillMrz?.documentNumber).toBe('UT1234567');
  });

  it('reads the latest decided ID, and passes over a later one that cannot serve', async () => {
    const target = await atChipStep(sandboxEnv);
    await addGovernmentId(target.inquiry, { fields: { 'identification-number': 'UT0000001' } });
    await addGovernmentId(target.inquiry, { fields: { 'identification-number': 'UT0000002' } });
    await addGovernmentId(target.inquiry, { status: 'failed' });

    expect((await members(target)).prefillMrz?.documentNumber).toBe('UT0000002');
  });
});

describe('nfcSessionMembers: sandboxChipAvailable (C208.2)', () => {
  it('is left out of a sandbox whose trust store lacks the test anchor', async () => {
    const target = await atChipStep(sandboxEnv);

    expect(await members(target)).toEqual({});
  });

  describe('with the anchor installed', () => {
    beforeAll(async () => {
      await installSandboxTrustAnchor(db, { now: NOW });
    });

    it('is true for an SDK client at the active nfc step in a sandbox', async () => {
      const target = await atChipStep(sandboxEnv);

      expect(await members(target)).toEqual({ sandboxChipAvailable: true });
    });

    it('is never set in production, for an unknown kind, or for the web flow', async () => {
      const production = await atChipStep(productionEnv);
      const sandbox = await atChipStep(sandboxEnv);
      const web = await atChipStep(sandboxEnv, { web: true });

      expect(await members(production)).toEqual({});
      expect(await members(sandbox, { environmentKind: null })).toEqual({});
      expect(await members(web)).toEqual({});
    });

    it('is never set away from the active nfc step', async () => {
      const target = await atChipStep(sandboxEnv, { state: 'ended' });

      expect(await members(target)).toEqual({});
    });

    it('goes once no enabled source lists the anchor', async () => {
      const target = await atChipStep(sandboxEnv);
      await db.execute(sql`update trust_anchor_sources set enabled = false`);

      expect(await members(target)).toEqual({});
    });
  });
});
