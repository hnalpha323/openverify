/**
 * C52.8, C53.7, the fourth exit: the dashboard inquiry document serves a phone and an email
 * verification's attributes from their stored codes, the destination to a reviewer (`pii:view`)
 * and masked for a viewer, the counts to both. Every value is synthetic.
 */
import { dashboardInquiryDocumentSchema, newId } from '@openverify/contracts';
import { createVerification } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  seedOtpChallenge,
  seedOtpVerificationState,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
} from '../../routes/dashboard/dashboard.test-support.js';

const NUMBER = '+12025550100';
const ADDRESS = 'avery.synthetic@mail.example.test';
const CONFIRMED_AT = new Date('2026-10-23T09:00:30.000Z');

let database: TestDatabase;
let api: DashboardHarness;
let organization: TestOrganization;
let reviewer: string;
let viewer: string;
let inquiryId: string;
const ids = new Map<string, string>();

beforeAll(async () => {
  database = await createTestDatabase();
  api = await createDashboardHarness(database);
  organization = await api.organization();
  reviewer = await api.signIn((await api.operator(organization, { roles: ['reviewer'] })).email);
  viewer = await api.signIn((await api.operator(organization, { roles: ['viewer'] })).email);
  const environmentId = organization.sandboxId;
  inquiryId = (await createTestInquiry(database.db, environmentId)).inquiry.id;
  for (const [type, channel, destination] of [
    ['phone_number', 'sms', NUMBER],
    ['email_address', 'email', ADDRESS],
  ] as const) {
    const verificationId = newId('ver');
    await createVerification(database.db, environmentId, { id: verificationId, inquiryId, type });
    await seedOtpChallenge(database.db, environmentId, {
      verificationId,
      inquiryId,
      channel,
      destination,
      status: 'confirmed',
      confirmedAt: CONFIRMED_AT,
    });
    await seedOtpVerificationState(database.db, environmentId, {
      verificationId,
      inquiryId,
      sends: 2,
      wrongEntries: 1,
    });
    ids.set(type, verificationId);
  }
}, 60_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

async function attributesOf(token: string, type: string) {
  const document = dashboardInquiryDocumentSchema.parse(
    expectJson(await api.call('GET', `/inquiries/${inquiryId}`, { token }), 200),
  );
  const resource = document.included.find((included) => included.id === ids.get(type)) as
    | { attributes: Record<string, unknown> }
    | undefined;
  return Object.fromEntries(
    Object.entries(resource?.attributes ?? {}).filter(
      ([name]) => !['status', 'checks', 'from-rejected-handoff', 'created-at', 'updated-at'].includes(name),
    ),
  );
}

describe('the dashboard inquiry document (C52.8, C53.7)', () => {
  it.each([
    ['phone_number', 'phone-number', NUMBER],
    ['email_address', 'email-address', ADDRESS],
  ] as const)('serves a %s verification’s destination to a reviewer only', async (type, member, value) => {
    const counts = {
      'confirmed-at': CONFIRMED_AT.toISOString(),
      sends: 2,
      'failed-attempts': 1,
    };

    expect(await attributesOf(reviewer, type)).toEqual({ [member]: value, ...counts });
    expect(await attributesOf(viewer, type)).toEqual({ [member]: null, ...counts });
  });
});
