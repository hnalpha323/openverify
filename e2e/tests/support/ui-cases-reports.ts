/**
 * `dashboard-cases-reports`' full-stack helpers (Workflow 9C; C172, C173, owner decision 20 after
 * Workflow 7B): everything `ui-cases-reports.spec.ts` works on, created through the API for its
 * run alone. Every value is synthetic: fictional names, `.test` addresses (a sandbox answers them
 * without a DNS query), and a documentation address presented for the spec's own OTP sends, so the
 * stack's per-address OTP budget for 127.0.0.1 stays one clean pass.
 */
import type { OpenVerifyClient } from '@openverify/node';
import { expect, type Page } from '@playwright/test';
import { withForwardedFor } from '../../src/forwarded-for.js';
import { waitForMail } from '../../src/mailpit.js';
import type { StackInfo } from '../../src/stack-info.js';
import { publishedCaseTemplate } from './cases.js';
import { peopleFlow } from './people.js';
import { chainDefinition, runningWorkflow } from './workflows.js';

/** The checklist item `approved` needs, and the preset comment the spec inserts. */
export const CHECKLIST = {
  key: 'review',
  label: 'Synthetic review',
  item: { key: 'document-seen', label: 'Document seen' },
} as const;
export const PRESET = {
  key: 'asked-docs',
  label: 'Asked for documents',
  text: 'We asked the synthetic applicant for a document.',
} as const;

export interface CompletionsTemplate {
  readonly templateId: string;
  /** The new draft (version 2), with the checklist and the preset comment. */
  readonly draftId: string;
  readonly actionLabel: string;
  readonly workflowId: string;
}

/**
 * A published case template with a new draft that carries a checklist whose item `approved` needs
 * and a preset comment, and a case action placed in the status switcher on a running
 * `trigger-case` workflow. The layout is left to the console.
 */
export async function completionsTemplate(
  admin: OpenVerifyClient,
  run: string,
): Promise<CompletionsTemplate> {
  const template = await publishedCaseTemplate(admin, `e2e ui cases-reports ${run}`);
  const { data: draft } = await admin.caseTemplateVersions.create({
    'case-template-id': template.id,
  });
  await admin.caseTemplateVersions.update(draft.id, {
    checklists: [
      {
        key: CHECKLIST.key,
        label: CHECKLIST.label,
        items: [
          {
            key: CHECKLIST.item.key,
            label: CHECKLIST.item.label,
            'required-for-statuses': ['approved'],
          },
        ],
      },
    ],
    'preset-comments': [{ key: PRESET.key, label: PRESET.label, text: PRESET.text }],
  });
  const workflowId = await runningWorkflow(
    admin,
    `e2e ui cases-reports action ${run}`,
    chainDefinition({ type: 'trigger-case', config: {} }, []),
  );
  const actionLabel = `Synthetic switcher action ${run}`;
  await admin.caseActions.create({
    'workflow-id': workflowId,
    'case-template-ids': [template.id],
    label: actionLabel,
    placement: 'status-switcher',
  });
  return { templateId: template.id, draftId: draft.id, actionLabel, workflowId };
}

/** Ends the workflow the spec made: paused, then archived. */
export async function endCompletions(
  admin: OpenVerifyClient,
  made: CompletionsTemplate | undefined,
): Promise<void> {
  if (made === undefined) {
    return;
  }
  await admin.workflows.pause(made.workflowId).catch(() => undefined);
  await admin.workflows.archive(made.workflowId).catch(() => undefined);
}

/**
 * A new inquiry on `templateId` for `accountId` whose end user confirms `address` with the code
 * Mailpit received, every flow call presented from `from` (a documentation address), so its OTP
 * send counts against that address, never 127.0.0.1's. Waits until the verification passed.
 */
export async function confirmEmailFrom(
  stack: StackInfo,
  client: OpenVerifyClient,
  input: {
    readonly templateId: string;
    readonly referenceId: string;
    readonly address: string;
    readonly accountId: string;
    readonly from: string;
    readonly exceptMailIds?: readonly string[];
  },
): Promise<{ inquiryId: string; mailId: string }> {
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': input.templateId,
    'reference-id': input.referenceId,
    'account-id': input.accountId,
  });
  const resumed = await client.inquiries.resume(inquiry.id);
  const token = resumed.meta['session-token'];
  const flow = peopleFlow(stack, token);
  await flow.consent();
  const verificationId = await flow.create('email-address');
  const sent = await fetch(`${stack.apiUrl}/api/v1/flow/verifications/${verificationId}/otp`, {
    method: 'POST',
    headers: withForwardedFor(
      {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      input.from,
    ),
    body: JSON.stringify({ 'email-address': input.address }),
  });
  expect(sent.status, 'the code was sent').toBe(200);
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

/**
 * The document of a console page as the signed-in `page`'s operator receives it: the server-rendered
 * HTML with the React Server Components payload Next.js inlines into it for hydration
 * (`self.__next_f`), which is everything the browser is given about the page.
 */
export async function documentPayloadOf(
  page: Page,
  stack: StackInfo,
  path: string,
): Promise<string> {
  const response = await page.goto(`${stack.dashboardUrl}${path}`);
  expect(response?.status(), `${path} answered its document`).toBe(200);
  expect(new URL(page.url()).pathname, `${path} was not redirected`).toBe(path);
  const html = (await response?.text()) ?? '';
  expect(html, `${path} carries its server components payload`).toContain('__next_f');
  return html;
}
