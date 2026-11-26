/**
 * C106.2 (Workflow 7B, `api-lists`): a `custom-list` report on inquiry completion takes the query
 * sources of C99.5, `government_id_country` among them, the same values the list screening reads,
 * and leaves out what a rejected handoff captured (C96.3). With nothing to screen the query stays
 * empty, so the run ends `errored` with `insufficient_input` and never reads as screened.
 */
import { emptyExtractedFields } from '@openverify/core';
import {
  createGovernmentIdExtraction,
  createVerification,
  getInquiry,
  getReport,
  setVerificationStatus,
  type Db,
  type Inquiry,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRecordingEventPublisher, fixedClock } from '../../test-support/fakes.js';
import { transitionInquiryInTx } from '../inquiries.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
const clock = fixedClock(new Date('2026-10-31T12:00:00.000Z'));

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function pendingInquiry(fields: Record<string, unknown> = {}): Promise<Inquiry> {
  const templateId = (await seedReportTemplate(db, environmentId, { reportType: 'custom-list' }))
    .templateId;
  const { inquiry } = await createTestInquiry(db, environmentId, { fields });
  await db.execute(
    sql`update inquiry_template_versions set report_config = ${JSON.stringify({
      'on-completion': [{ 'report-template-id': templateId }],
    })}::jsonb where id = ${inquiry.inquiryTemplateVersionId}`,
  );
  await db.execute(sql`update inquiries set status = 'pending' where id = ${inquiry.id}`);
  const current = await getInquiry(db, environmentId, inquiry.id);
  if (current === null) {
    throw new Error('the inquiry is gone');
  }
  return current;
}

async function governmentId(inquiryId: string, fields: Record<string, string | null>) {
  const id = testId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type: 'government_id' });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, id, { to: 'passed' });
  await createGovernmentIdExtraction(db, environmentId, {
    verificationId: id,
    fields: { ...emptyExtractedFields(), ...fields },
    fieldSources: {},
    identificationNumberIndex: null,
    frontPhash: null,
    idClassGroup: 'passport',
  });
  await db.execute(sql`update verifications set country = 'ZZ' where id = ${id}`);
  return id;
}

async function reportOf(inquiry: Inquiry) {
  await db.transaction(async (tx) => {
    await transitionInquiryInTx(
      tx,
      { events: createRecordingEventPublisher(), clock },
      inquiry,
      'completed',
    );
  });
  const rows = await database.client.query<{ id: string }>(
    `select id from reports where inquiry_id = $1 and report_type = 'custom-list'`,
    [inquiry.id],
  );
  const [row] = rows.rows;
  expect(row).toBeDefined();
  return getReport(db, environmentId, row?.id ?? '');
}

describe('the custom-list report at completion (C106.2)', () => {
  it('leaves the query empty with nothing to screen', async () => {
    const report = await reportOf(await pendingInquiry());
    expect(report?.querySources).toEqual({});
  });

  it('takes the verified values first, and the issuing country', async () => {
    const inquiry = await pendingInquiry({
      name_first: 'Typed',
      name_last: 'Name',
      email_address: 'typed@example.com',
      phone_number: '+12025550100',
    });
    await governmentId(inquiry.id, {
      'name-first': 'Avery',
      'name-last': 'Quillfeather',
      'identification-number': 'X1234567',
    });

    const report = await reportOf(inquiry);

    expect(report?.query).toEqual({
      'name-first': 'Avery',
      'name-last': 'Quillfeather',
      'email-address': 'typed@example.com',
      'phone-number': '+12025550100',
      'government-id-number': 'X1234567',
      'government-id-class': 'passport',
      'country-code': 'ZZ',
    });
    expect(report?.querySources).toEqual({
      'name-first': 'government_id',
      'name-last': 'government_id',
      'email-address': 'inquiry_fields',
      'phone-number': 'inquiry_fields',
      'government-id-number': 'government_id',
      'government-id-class': 'government_id',
      'country-code': 'government_id_country',
    });
  });

  it('reads the address country of the fields without an ID', async () => {
    const report = await reportOf(await pendingInquiry({ address_country_code: 'ZZ' }));
    expect(report?.querySources).toEqual({ 'country-code': 'inquiry_fields' });
  });

  it('leaves out what a rejected handoff captured (C96.3)', async () => {
    const inquiry = await pendingInquiry();
    const id = await governmentId(inquiry.id, { 'identification-number': 'X1234567' });
    await db.execute(sql`update verifications set from_rejected_handoff = true where id = ${id}`);

    const report = await reportOf(inquiry);

    expect(report?.querySources).toEqual({});
  });
});
