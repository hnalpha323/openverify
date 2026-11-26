/**
 * C84, C73.5, C89.2 (Workflow 6A): reports on inquiry completion, full stack. Budget: 90 s.
 *
 * An inquiry template with an email one-time-code step pins a report list (C84.1): the seeded
 * sandbox watchlist and email templates, with `on-report-match: needs_review`. The first inquiry
 * completes through the hosted flow, its name prefilled as the sandbox list's fictional listed
 * person; the second completes through the sandbox simulate actions (F15). The sweep runs every
 * report created by the completion (C84.2), linked to its inquiry and, after its first run, to
 * the inquiry's account. The first inquiry's email report screens the address the end user
 * confirmed with the code, and only it says deliverable (P05). The watchlist match sends both
 * inquiries to review (C84.3). Redacting the first inquiry redacts its reports (C73.5).
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_EMAIL_ADDRESS_CHECKS } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { waitForMail } from '../src/mailpit.js';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import { phase5Template, typeConfig } from './support/phase5.js';
import { recordingClient } from './support/platform.js';
import {
  SANDBOX_LISTS,
  attributesOf,
  historyOf,
  runsOf,
  seededTemplateId,
  waitForReport,
  type ReportData,
} from './support/reports.js';

interface Relationships {
  relationships: Record<string, { data: { id: string } | null }>;
}

/** The reports the completion created for `inquiryId`, once each has run. */
async function completionReports(
  client: OpenVerifyClient,
  inquiryId: string,
): Promise<Map<string, ReportData>> {
  let reports: ReportData[] = [];
  await expect
    .poll(
      async () => {
        reports = (await client.reports.list({ filter: { 'inquiry-id': inquiryId } })).data;
        return reports.filter((report) => report.attributes.status !== 'pending').length;
      },
      { timeout: 60_000, intervals: [500, 1000] },
    )
    .toBe(2);
  return new Map(reports.map((report) => [report.type, report] as const));
}

function linkOf(report: ReportData, name: string): string | null {
  return (report as unknown as Relationships).relationships[name]?.data?.id ?? null;
}

test('reports run when an inquiry completes, through the flow and the simulate action, screen the verified email, send a matched inquiry to review and are redacted with it (C84, C89.2)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().slice(0, 8);
  const watchlistTemplate = await seededTemplateId(client, 'watchlist');
  const emailTemplate = await seededTemplateId(client, 'email-address');
  const template = {
    ...phase5Template(`e2e-report-inquiry-${run}`, [{ id: 'email', type: 'email_otp' }], {
      'email-address': typeConfig(DEFAULT_EMAIL_ADDRESS_CHECKS),
    }),
    'report-config': {
      'on-completion': [
        { 'report-template-id': watchlistTemplate },
        { 'report-template-id': emailTemplate },
      ],
      'on-report-match': 'needs_review' as const,
    },
  };
  const listed = SANDBOX_LISTS.listedPerson.query;
  const fields = {
    name_first: listed['name-first'],
    name_last: listed['name-last'],
    birthdate: listed.birthdate,
  };

  // The first inquiry: the end user confirms an address with the code Mailpit received.
  const address = `e2e-report-${run}@example.test`;
  const { data: inquiryTemplate } = await client.inquiryTemplates.create(template);
  const { data: firstInquiry } = await client.inquiries.create({
    'inquiry-template-id': inquiryTemplate.id,
    'reference-id': `e2e-report-inquiry-${run}`,
    fields,
  });
  const first = {
    inquiryId: firstInquiry.id,
    flowUrl: (await client.inquiries.resume(firstInquiry.id)).meta['flow-url'],
  };
  const errors = collectConsoleErrors(page);
  await page.goto(first.flowUrl);
  await giveConsent(page);
  await page.getByLabel('Email address', { exact: true }).fill(address);
  await page.getByRole('button', { name: 'Send code' }).click();
  const mail = await waitForMail(stack.mailpitUrl, address, { timeoutMs: 30_000 });
  const code = /Your verification code is (\d{6})\./u.exec(mail.text)?.[1] ?? '';
  await page.getByLabel('Code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);

  // The second inquiry completes through the sandbox simulate actions, its address only typed.
  const { data: second } = await client.inquiries.create({
    'inquiry-template-id': inquiryTemplate.id,
    'reference-id': `e2e-report-inquiry-simulated-${run}`,
    fields: { ...fields, email_address: `e2e-typed-${run}@example.test` },
  });
  await client.inquiries.performSimulateActions(second.id, {
    actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
  });

  for (const [inquiryId, confirmed] of [
    [first.inquiryId, true],
    [second.id, false],
  ] as const) {
    const reports = await completionReports(client, inquiryId);
    const watchlist = reports.get('report/watchlist');
    const email = reports.get('report/email-address');
    if (watchlist === undefined || email === undefined) {
      throw new Error(`The completion of ${inquiryId} created ${[...reports.keys()].join(', ')}`);
    }
    // C84.2: linked to the inquiry and, after the first run, to its account.
    const { data: inquiry } = await client.inquiries.retrieve(inquiryId);
    const accountId = (inquiry as unknown as Relationships).relationships.account?.data?.id;
    for (const report of [watchlist, email]) {
      expect(report.attributes.origin).toBe('inquiry_completion');
      expect(linkOf(report, 'inquiry')).toBe(inquiryId);
      expect(linkOf(report, 'account')).toBe(accountId);
    }
    // The prefilled name of the listed person matches (C84.2: the typed fields, no ID here).
    expect(attributesOf(watchlist)).toMatchObject({
      status: 'ready',
      'has-match': true,
      'query-sources': { 'name-first': 'inquiry_fields', 'name-last': 'inquiry_fields' },
    });
    // P05: only the address the inquiry confirmed with a code is deliverable.
    const emailAttributes = attributesOf(email);
    expect(emailAttributes.status).toBe('ready');
    if (confirmed) {
      expect(emailAttributes).toMatchObject({
        query: { 'email-address': address },
        'query-sources': { 'email-address': 'otp_confirmed' },
        'email-is-deliverable': true,
      });
    } else {
      expect(emailAttributes['email-is-deliverable']).toBeNull();
      expect(emailAttributes['unavailable-fields']).toEqual(
        expect.arrayContaining([{ field: 'email-is-deliverable', reason: 'not_confirmed' }]),
      );
    }
    // C84.3: the match sends the completed inquiry to review, and the run says why.
    await expect
      .poll(async () => (await client.inquiries.retrieve(inquiryId)).data.attributes.status, {
        timeout: 30_000,
      })
      .toBe('needs_review');
    const notes = runsOf(await historyOf(client, watchlist.id)).flatMap(
      (entry) => entry.attributes.notes,
    );
    expect(notes).toContain('report_match');
  }

  // C73.5: redacting the inquiry redacts its reports.
  await client.inquiries.redact(first.inquiryId);
  const reports = (await client.reports.list({ filter: { 'inquiry-id': first.inquiryId } })).data;
  expect(reports).toHaveLength(2);
  for (const report of reports) {
    const redacted = await waitForReport(
      client,
      report.id,
      (current) => current.attributes['redacted-at'] !== null,
    );
    expect(redacted.attributes.query).toBeNull();
  }
});
