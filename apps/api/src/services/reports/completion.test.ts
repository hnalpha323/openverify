/**
 * C84.2 (V08, H04; Workflow 6A Stage 3, `api-reports`): an inquiry's report list runs when it
 * completes, or when a failed inquiry is approved or sent to review, through
 * `transitionInquiryInTx`: one pending report per entry with its initial run, linked to the
 * inquiry only, from the report template's published version, its query from the verified data
 * first with `query-sources`. Synthetic values only.
 */
import { emptyExtractedFields } from '@openverify/core';
import {
  createAccount,
  createGovernmentIdExtraction,
  createVerification,
  getInquiry,
  getReport,
  listReportRuns,
  setVerificationStatus,
  type Db,
  type Inquiry,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCryptoChallenge,
  seedOtpChallenge,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRecordingEventPublisher,
  fixedClock,
  type RecordingEventPublisher,
} from '../../test-support/fakes.js';
import { transitionInquiryInTx } from '../inquiries.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let events: RecordingEventPublisher;
const clock = fixedClock(new Date('2026-10-27T12:00:00.000Z'));

const ID_NAME = { 'name-first': 'Avery', 'name-middle': null, 'name-last': 'Quillfeather' };
const ADDRESS = '0x52908400098527886e0f7030069857d2e4169ee7';

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  events = createRecordingEventPublisher();
});

async function template(reportType: string, config: Record<string, unknown> = {}) {
  const lists = ['watchlist', 'crypto-address-watchlist', 'business-watchlist'].includes(reportType)
    ? { 'search-lists': ['openverify-sandbox'] }
    : reportType === 'politically-exposed-person'
      ? { 'search-lists': ['openverify-sandbox-pep'] }
      : {};
  return (await seedReportTemplate(db, environmentId, { reportType, config: { ...lists, ...config } }))
    .templateId;
}

/** An inquiry whose version runs `templateIds` on completion, in `status`. */
async function inquiryWith(
  templateIds: string[],
  options: { fields?: Record<string, unknown>; status?: string; account?: Record<string, unknown> } = {},
): Promise<Inquiry> {
  const { inquiry } = await createTestInquiry(db, environmentId, { fields: options.fields ?? {} });
  await db.execute(
    sql`update inquiry_template_versions set report_config = ${JSON.stringify({
      'on-completion': templateIds.map((id) => ({ 'report-template-id': id })),
    })}::jsonb where id = ${inquiry.inquiryTemplateVersionId}`,
  );
  if (options.account !== undefined) {
    const account = await createAccount(db, environmentId, { id: testId('acc'), fields: options.account });
    await db.execute(sql`update inquiries set account_id = ${account.id} where id = ${inquiry.id}`);
  }
  await db.execute(
    sql`update inquiries set status = ${options.status ?? 'pending'} where id = ${inquiry.id}`,
  );
  const current = await getInquiry(db, environmentId, inquiry.id);
  if (current === null) {
    throw new Error('the inquiry is gone');
  }
  return current;
}

async function verification(inquiryId: string, type: string, status: 'passed' | 'needs_review') {
  const id = testId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type: type as 'government_id' });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, id, { to: status });
  return id;
}

async function passedGovernmentId(inquiryId: string, fields: Record<string, string | null>) {
  const id = await verification(inquiryId, 'government_id', 'passed');
  await createGovernmentIdExtraction(db, environmentId, {
    verificationId: id,
    fields: { ...emptyExtractedFields(), ...fields },
    fieldSources: {},
    identificationNumberIndex: null,
    frontPhash: null,
  });
}

/** Moves the inquiry as the lifecycle does; returns the ids of the reports it created. */
async function move(inquiry: Inquiry, to: 'completed' | 'approved' | 'needs_review' | 'declined') {
  await db.transaction((tx) => transitionInquiryInTx(tx, { events, clock }, inquiry, to));
  const rows = await database.client.query<{ id: string }>(
    'select id from reports where inquiry_id = $1 order by id',
    [inquiry.id],
  );
  return rows.rows.map((row) => row.id);
}

describe('reports on inquiry completion (C84.2)', () => {
  it('creates one pending report per entry, linked to the inquiry only, with its initial run', async () => {
    const watchlist = await template('watchlist', { 'recurrence-interval-days': 30 });
    const inquiry = await inquiryWith([watchlist], {
      fields: { name_first: 'Avery', name_last: 'Quillfeather', birthdate: '1980-04-12' },
    });
    const [reportId] = await move(inquiry, 'completed');
    const report = await getReport(db, environmentId, reportId ?? '');
    expect(report).toMatchObject({
      status: 'pending',
      origin: 'inquiry_completion',
      inquiryId: inquiry.id,
      accountId: null,
      reportTemplateId: watchlist,
      recurrenceIntervalDays: 30,
      query: { 'name-first': 'Avery', 'name-last': 'Quillfeather', birthdate: '1980-04-12' },
      querySources: { 'name-first': 'inquiry_fields', 'name-last': 'inquiry_fields', birthdate: 'inquiry_fields' },
    });
    expect(report?.nextRunAt?.getTime()).toBe(clock.now().getTime() + 30 * 86_400_000);
    expect((await listReportRuns(db, environmentId, reportId ?? '')).map((run) => run.runType)).toEqual([
      'initial',
    ]);
  });

  it('screens the verified name first and a differing prefilled name as an additional name (H04)', async () => {
    const watchlist = await template('watchlist');
    const inquiry = await inquiryWith([watchlist], {
      fields: { name_first: 'Avry', name_last: 'Quilfeather', address_country_code: 'GB' },
      account: { name_first: 'Avery', name_last: 'Quillfeather' },
    });
    await passedGovernmentId(inquiry.id, { ...ID_NAME, birthdate: '1980-04-12' });
    const [reportId] = await move(inquiry, 'completed');
    const report = await getReport(db, environmentId, reportId ?? '');
    expect(report?.query).toEqual({
      'name-first': 'Avery',
      'name-last': 'Quillfeather',
      'additional-names': [{ 'name-first': 'Avry', 'name-last': 'Quilfeather' }],
      birthdate: '1980-04-12',
      'address-country-code': 'GB',
    });
    expect(report?.querySources).toMatchObject({
      'name-first': 'government_id',
      'additional-names': 'inquiry_fields',
      birthdate: 'government_id',
      'address-country-code': 'inquiry_fields',
    });
  });

  it('takes the email of a confirmed OTP and the wallet of a passed crypto step (H04)', async () => {
    const email = await template('email-address');
    const crypto = await template('crypto-address-watchlist');
    const inquiry = await inquiryWith([email, crypto], {
      fields: { email_address: 'prefilled@example.test' },
    });
    const emailVerification = await verification(inquiry.id, 'email_address', 'passed');
    await seedOtpChallenge(db, environmentId, {
      verificationId: emailVerification,
      inquiryId: inquiry.id,
      channel: 'email',
      destination: 'confirmed@example.test',
      status: 'confirmed',
      confirmedAt: clock.now(),
    });
    const wallet = await verification(inquiry.id, 'crypto_wallet', 'passed');
    await seedCryptoChallenge(db, environmentId, {
      verificationId: wallet,
      inquiryId: inquiry.id,
      chainId: 'eip155:1',
      walletAddress: ADDRESS,
      message: 'Synthetic challenge message',
      status: 'processed',
    });
    const ids = await move(inquiry, 'completed');
    const reports = await Promise.all(ids.map((id) => getReport(db, environmentId, id)));
    const byType = new Map(reports.map((report) => [report?.reportType, report]));
    expect(byType.get('email-address')).toMatchObject({
      query: { 'email-address': 'confirmed@example.test' },
      querySources: { 'email-address': 'otp_confirmed' },
    });
    expect(byType.get('crypto-address-watchlist')).toMatchObject({
      query: { 'crypto-address': ADDRESS, 'chain-id': 'eip155:1' },
      querySources: { 'crypto-address': 'crypto_wallet', 'chain-id': 'crypto_wallet' },
    });
  });

  it('creates the report of a missing input all the same, with an empty query', async () => {
    const phone = await template('phone-number');
    const inquiry = await inquiryWith([phone]);
    const [reportId] = await move(inquiry, 'completed');
    expect(await getReport(db, environmentId, reportId ?? '')).toMatchObject({
      status: 'pending',
      query: {},
      querySources: {},
    });
  });

  it('runs on a failed inquiry approved or sent to review, never when declined, and once (V08)', async () => {
    const email = await template('email-address');
    const approved = await inquiryWith([email], { status: 'failed' });
    expect(await move(approved, 'approved')).toHaveLength(1);
    const reviewed = await inquiryWith([email], { status: 'failed' });
    expect(await move(reviewed, 'needs_review')).toHaveLength(1);
    const declined = await inquiryWith([email], { status: 'failed' });
    expect(await move(declined, 'declined')).toEqual([]);
    const completed = await inquiryWith([email]);
    expect(await move(completed, 'completed')).toHaveLength(1);
    const again = await getInquiry(db, environmentId, completed.id);
    if (again === null) {
      throw new Error('the inquiry is gone');
    }
    // completed -> approved runs nothing: the report list ran once, on completion.
    expect(await move(again, 'approved')).toHaveLength(1);
  });

  it('creates no report for an inquiry redacted while its completion waited for the row (owner decision 11)', async () => {
    const watchlist = await template('watchlist');
    // Read before the redaction, as settlement reads it; the move sees the redacted row.
    const inquiry = await inquiryWith([watchlist], {
      fields: { name_first: 'Avery', name_last: 'Quillfeather' },
    });
    await db.execute(sql`update inquiries set redacted_at = ${clock.now()} where id = ${inquiry.id}`);

    // Owner decision 5 after Workflow 6C: the move itself is refused, so the hook never runs.
    const moved = await db.transaction((tx) =>
      transitionInquiryInTx(tx, { events, clock }, inquiry, 'completed'),
    );
    expect(moved).toBeNull();
    const reports = await database.client.query('select id from reports where inquiry_id = $1', [
      inquiry.id,
    ]);
    expect(reports.rows).toEqual([]);
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('pending');
  });

  it('creates no report when a redacted failed inquiry is approved: the move applies, and the hook keeps its own guard', async () => {
    const watchlist = await template('watchlist');
    const inquiry = await inquiryWith([watchlist], {
      fields: { name_first: 'Avery', name_last: 'Quillfeather' },
      status: 'failed',
    });
    await db.execute(sql`update inquiries set redacted_at = ${clock.now()} where id = ${inquiry.id}`);

    // A move out of `failed` is not one redaction ends (owner decision 5 after Workflow 6C).
    expect(await move(inquiry, 'approved')).toEqual([]);
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('approved');
  });

  it('runs an archived report template from its published version (C71.1)', async () => {
    const email = await template('email-address');
    const inquiry = await inquiryWith([email]);
    await db.execute(sql`update report_templates set status = 'archived' where id = ${email}`);
    expect(await move(inquiry, 'completed')).toHaveLength(1);
  });
});
