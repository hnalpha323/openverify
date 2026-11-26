/**
 * Workflow 7B spec helpers (C97-C105): an inquiry on an email-code template whose version carries
 * a `list-config`, its email address confirmed through the flow API with the code Mailpit received,
 * and a base64 CSV for an importer. Every value a spec sends is synthetic (`.test` addresses, which
 * a sandbox environment answers without a DNS query, C56).
 */
import { DEFAULT_EMAIL_ADDRESS_CHECKS, type ListConfig } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { expect } from '@playwright/test';
import { waitForMail } from '../../src/mailpit.js';
import type { StackInfo } from '../../src/stack-info.js';
import { peopleFlow } from './people.js';
import { phase5Template, typeConfig } from './phase5.js';

/** A published email-code template, its version carrying `listConfig` when one is given. */
export async function emailCodeTemplate(
  client: OpenVerifyClient,
  name: string,
  listConfig?: ListConfig,
): Promise<string> {
  const attributes = phase5Template(name, [{ id: 'email', type: 'email_otp' }], {
    'email-address': typeConfig(DEFAULT_EMAIL_ADDRESS_CHECKS),
  });
  const { data: template } = await client.inquiryTemplates.create(attributes);
  if (listConfig !== undefined) {
    // A create body takes no `list-config` (C99.5): a draft carries it, then is published.
    const { data: draft } = await client.inquiryTemplateVersions.create({
      'inquiry-template-id': template.id,
      flow: attributes.flow,
      'verification-config': attributes['verification-config'],
      'list-config': listConfig,
    });
    await client.inquiryTemplateVersions.publish(draft.id);
  }
  return template.id;
}

/**
 * A new inquiry on `templateId` (for `accountId` when given) whose end user confirms `address`
 * with the code Mailpit received, `exceptMailIds` naming earlier mails to the same address. The
 * verification is awaited until it passed; returns the inquiry and the mail it read.
 */
export async function confirmEmailInquiry(
  stack: StackInfo,
  client: OpenVerifyClient,
  input: {
    templateId: string;
    referenceId: string;
    address: string;
    accountId?: string;
    exceptMailIds?: readonly string[];
  },
): Promise<{ inquiryId: string; mailId: string }> {
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': input.templateId,
    'reference-id': input.referenceId,
    ...(input.accountId === undefined ? {} : { 'account-id': input.accountId }),
  });
  const resumed = await client.inquiries.resume(inquiry.id);
  const flow = peopleFlow(stack, resumed.meta['session-token']);
  await flow.consent();
  const verificationId = await flow.create('email-address');
  await flow.sendCode(verificationId, { 'email-address': input.address });
  const mail = await waitForMail(stack.mailpitUrl, input.address, {
    timeoutMs: 30_000,
    exceptIds: input.exceptMailIds ?? [],
  });
  const code = /Your verification code is (\d{6})\./u.exec(mail.text)?.[1] ?? '';
  expect(code).toMatch(/^\d{6}$/u);
  expect(await flow.confirmCode(verificationId, code)).toBe(200);
  await flow.submit(verificationId);
  expect((await flow.decided(verificationId)).attributes.status).toBe('passed');
  return { inquiryId: inquiry.id, mailId: mail.id };
}

/** Waits until the inquiry reaches `status`, and returns it. */
export async function waitForInquiryStatus(
  client: OpenVerifyClient,
  inquiryId: string,
  status: string,
  timeoutMs = 45_000,
): Promise<void> {
  await expect
    .poll(async () => (await client.inquiries.retrieve(inquiryId)).data.attributes.status, {
      timeout: timeoutMs,
      intervals: [500, 1000],
    })
    .toBe(status);
}

/** A CSV file as an importer's JSON body takes it: CRLF records, base64. */
export function base64Csv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const text = [header, ...rows].map((record) => record.join(',')).join('\r\n');
  return Buffer.from(`${text}\r\n`, 'utf8').toString('base64');
}
