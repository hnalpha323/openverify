/**
 * C73.5: the redaction entries of the report tables in the shared redaction code. A report id is a
 * redaction subject (stored API-log copies that mention it are cleared), the events about an
 * inquiry include its reports' events, and redacting an inquiry or an account stubs the events of
 * the reports it holds (the inquiry's, or the account's home and linked ones). The report rows
 * themselves are redacted by `api-reports`' hook. Synthetic values only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReport,
  seedReportAccount,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '../testing.js';
import { createAccount } from './accounts.js';
import { createEvent, getEvent, listEvents } from './events.js';
import { redactAccountRecords, redactInquiryRecords } from './redaction.js';
import { subjectIdsIn } from './subject-ids.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function reportEvent(env: string, reportId: string) {
  return createEvent(database.db, env, {
    id: testId('evt'),
    name: 'report/watchlist.ready',
    payload: {
      data: {
        type: 'report/watchlist',
        id: reportId,
        attributes: { query: { 'name-first': 'Avery' } },
      },
    },
  });
}

const stubbed = async (env: string, eventId: string) =>
  (await getEvent(database.db, env, eventId))?.redactedAt !== null;

describe('C73.5: report redaction entries', () => {
  it('names report ids among the redaction subjects', () => {
    const reportId = testId('rep');

    expect(subjectIdsIn({ data: { id: reportId } })).toEqual([reportId]);
  });

  it('lists an inquiry report events with the inquiry events', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const { inquiry } = await createTestInquiry(database.db, env);
    const template = await seedReportTemplate(database.db, env);
    const reportId = await seedReport(database.db, env, { ...template, inquiryId: inquiry.id });
    const event = await reportEvent(env, reportId);

    const page = await listEvents(database.db, env, { inquiryId: inquiry.id });

    expect(page.items.map((item) => item.id)).toContain(event.id);
  });

  it('stubs the events of the reports of a redacted inquiry', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const { inquiry } = await createTestInquiry(database.db, env);
    const template = await seedReportTemplate(database.db, env);
    const own = await reportEvent(
      env,
      await seedReport(database.db, env, { ...template, inquiryId: inquiry.id }),
    );
    const other = await reportEvent(env, await seedReport(database.db, env, template));

    await redactInquiryRecords(database.db, env, inquiry.id);

    expect(await stubbed(env, own.id)).toBe(true);
    expect(await stubbed(env, other.id)).toBe(false);
  });

  it('stubs the events of the reports a redacted account holds, home or linked', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const account = await createAccount(database.db, env, { id: testId('acc') });
    const template = await seedReportTemplate(database.db, env);
    const home = await reportEvent(
      env,
      await seedReport(database.db, env, { ...template, accountId: account.id }),
    );
    const linkedId = await seedReport(database.db, env, template);
    await seedReportAccount(database.db, env, { reportId: linkedId, accountId: account.id });
    const linked = await reportEvent(env, linkedId);
    const other = await reportEvent(env, await seedReport(database.db, env, template));

    await redactAccountRecords(database.db, env, account.id);

    expect(await stubbed(env, home.id)).toBe(true);
    expect(await stubbed(env, linked.id)).toBe(true);
    expect(await stubbed(env, other.id)).toBe(false);
  });
});
