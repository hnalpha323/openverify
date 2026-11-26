/**
 * Workflow 9C (`dashboard-template-forms`): helpers of `ui-template-forms.spec.ts`. Each object the
 * spec makes carries a random suffix, so it never meets another run's on a reused stack, and is
 * archived when the spec ends. Every value is synthetic: the flow and the names are invented.
 */
import { randomUUID } from 'node:crypto';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { StackInfo } from '../../src/stack-info.js';
import { consentStep } from './flow-v2.js';
import { recordingClient } from './platform.js';

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** A short random suffix. */
export const formsSuffix = (): string => randomUUID().replaceAll('-', '').slice(0, 10);

/** The check the draft's branch reads, and the branch's and route's names. */
export const READ_CHECK = 'id_expired_detection';
export const BRANCH_NAME = 'Expired ID route';
export const ROUTE_LABEL = 'Expired ID';

/**
 * A flow-spec 2 draft: consent, a government ID, then a branch whose one route reads the ID's
 * `id_expired_detection` status (`onNull: review`) to a failure step, else completion.
 */
function formsFlow(run: string) {
  const id = defaultInquiryTemplateAttributes().flow.steps.find(
    (step) => step.type === 'government_id',
  );
  return {
    metadata: { specVersion: 2, id: `e2e-ui-forms-${run}`, version: 1, name: 'UI template forms' },
    entry: 'consent',
    steps: [
      consentStep(),
      { ...id, id: 'id_card', maxAttempts: 1, captureMethods: ['upload'] },
      {
        id: 'expiry_route',
        type: 'branch',
        name: BRANCH_NAME,
        routes: [
          {
            key: 'expired',
            label: ROUTE_LABEL,
            condition: {
              '===': [{ var: `verifications.id_card.checks.${READ_CHECK}.status` }, 'failed'],
            },
            onNull: 'review',
          },
        ],
      },
      { id: 'done', type: 'completion' },
      { id: 'refused', type: 'failure' },
    ],
    edges: [
      edge('e1', 'consent', 'next', 'id_card'),
      edge('e2', 'id_card', 'next', 'expiry_route'),
      edge('e3', 'expiry_route', 'route:expired', 'refused'),
      edge('e4', 'expiry_route', 'else', 'done'),
    ],
  };
}

export interface FormsDraft {
  readonly templateId: string;
  readonly versionId: string;
}

/** A template with the draft above, never published; `archiveFormsDraft` ends it. */
export async function formsDraft(stack: StackInfo): Promise<FormsDraft> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = formsSuffix();
  const { data: template } = await client.inquiryTemplates.create({
    ...defaultInquiryTemplateAttributes(),
    name: `e2e ui template forms ${run}`,
  });
  const { data: draft } = await client.inquiryTemplateVersions.create({
    'inquiry-template-id': template.id,
    flow: formsFlow(run),
    'verification-config': {
      'government-id': defaultInquiryTemplateAttributes()['verification-config']['government-id'],
    },
  } as never);
  return { templateId: template.id, versionId: draft.id };
}

/** Archives the spec's inquiry template, so no inquiry can use it. */
export async function archiveFormsDraft(
  stack: StackInfo,
  draft: FormsDraft | undefined,
): Promise<void> {
  if (draft === undefined) {
    return;
  }
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  await client.inquiryTemplates.update(draft.templateId, { status: 'archived' });
}

/** Archives the report templates the spec created through the form, found by their name. */
export async function archiveReportTemplatesNamed(stack: StackInfo, name: string): Promise<void> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  for await (const template of client.reportTemplates.listAll({ page: { size: 100 } })) {
    if (template.attributes.name === name && template.attributes.status === 'active') {
      await client.reportTemplates.update(template.id, { status: 'archived' });
    }
  }
}
