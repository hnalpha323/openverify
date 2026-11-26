/**
 * C106.1, C84.2: an `ip-address` report on inquiry completion screens the first evaluated
 * session's address (query source `inquiry_session`), opened from its networks row. Without an
 * evaluated session the query is empty and the run ends `errored` with `insufficient_input`, never
 * read as screened. Every address is from the documentation ranges.
 */
import { randomBytes } from 'node:crypto';
import { getInquiry, getReport, recordSessionNetworkEvaluation, type Db, type Inquiry } from '@openverify/db';
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
const clock = fixedClock(new Date('2026-10-30T12:00:00.000Z'));

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function pendingInquiry(): Promise<Inquiry> {
  const templateId = (await seedReportTemplate(db, environmentId, { reportType: 'ip-address' }))
    .templateId;
  const { inquiry } = await createTestInquiry(db, environmentId);
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

async function sessionWithNetwork(inquiryId: string, ip: string, evaluatedAt: Date) {
  const sessionId = testId('iqse');
  await database.client.query(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [sessionId, environmentId, inquiryId, randomBytes(32).toString('hex')],
  );
  await recordSessionNetworkEvaluation(db, environmentId, {
    id: testId('net'),
    inquirySessionId: sessionId,
    ip,
    clientAddressSource: 'socket',
    evaluatedAt,
    facts: {
      isTor: true,
      isDatacenter: null,
      isVpn: null,
      isProxy: null,
      hostingAsn: null,
      hostingAsnConfidence: null,
      privacyRelay: null,
      threatLevel: 'high',
      countryCode: 'ZZ',
      countryName: 'Example Land',
      location: null,
      asn: 64504,
      organization: 'Example Sandbox Network',
      serviceType: null,
      proxyType: 'tor',
      ipConnectionType: null,
    },
    reasons: [],
    sources: [],
  });
}

async function complete(inquiry: Inquiry) {
  const events = createRecordingEventPublisher();
  await db.transaction((tx) => transitionInquiryInTx(tx, { events, clock }, inquiry, 'completed'));
  const rows = await database.client.query<{ id: string }>(
    'select id from reports where inquiry_id = $1',
    [inquiry.id],
  );
  return getReport(db, environmentId, rows.rows[0]?.id ?? '');
}

describe('the ip-address report on completion (C106.1)', () => {
  it('screens the first evaluated session’s address, from inquiry_session', async () => {
    const inquiry = await pendingInquiry();
    await sessionWithNetwork(inquiry.id, '203.0.113.9', new Date('2026-10-30T11:00:00Z'));
    await sessionWithNetwork(inquiry.id, '192.0.2.10', new Date('2026-10-30T10:00:00Z'));
    const report = await complete(inquiry);
    expect(report).toMatchObject({
      reportType: 'ip-address',
      origin: 'inquiry_completion',
      query: { 'ip-address': '192.0.2.10' },
      querySources: { 'ip-address': 'inquiry_session' },
    });
  });

  it('has an empty query without an evaluated session', async () => {
    const inquiry = await pendingInquiry();
    const report = await complete(inquiry);
    expect(report?.query).toEqual({});
  });
});
