/**
 * Workflow 9C (`dashboard-preview`): helpers of `ui-preview.spec.ts`. Each object the spec makes
 * carries a random suffix, so it never meets another run's on a reused stack. Every value is
 * synthetic: the flow, its copy and the workflow are invented, and no person's value appears.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_DOCUMENT_CHECKS, defaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import type { StackInfo } from '../../src/stack-info.js';
import { consentStep } from './flow-v2.js';
import { typeConfig } from './phase5.js';
import { recordingClient } from './platform.js';
import { draftWorkflow } from './ui-workflow-ops.js';
import { chainDefinition } from './workflows.js';

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** A short random suffix. */
export const previewSuffix = (): string => randomUUID().replaceAll('-', '').slice(0, 10);

/** The details screen's heading key and its English text (the pseudo-locales derive from it). */
export const DETAILS_KEY = 'details.heading.title';
export const DETAILS_TEXT = 'A few more details';

/**
 * A flow-spec 2 draft with a branch: consent, a government ID of one attempt whose `exhausted` edge
 * falls back to a proof-of-address document (`onFallback: review`), then a branch on the ID's
 * extracted `age-years` (`onNull: else`) with a details screen for one route.
 */
function previewFlow(run: string) {
  const id = defaultInquiryTemplateAttributes().flow.steps.find(
    (step) => step.type === 'government_id',
  );
  return {
    metadata: { specVersion: 2, id: `e2e-ui-preview-${run}`, version: 1, name: 'UI preview' },
    entry: 'consent',
    steps: [
      consentStep(),
      { ...id, id: 'id_card', maxAttempts: 1, captureMethods: ['upload'], onFallback: 'review' },
      {
        id: 'age_route',
        type: 'branch',
        routes: [
          {
            key: 'under_60',
            label: 'Under 60',
            condition: { '<': [{ var: 'verifications.id_card.age-years' }, 60] },
            onNull: 'else',
          },
        ],
      },
      {
        id: 'details',
        type: 'screen',
        components: [
          { id: 'heading', kind: 'text', variant: 'title', copyKey: DETAILS_KEY },
          { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        ],
      },
      {
        id: 'poa',
        type: 'document',
        documentTypes: ['utility_bill', 'bank_statement'],
        captureMethods: ['upload'],
      },
      { id: 'done', type: 'completion' },
    ],
    edges: [
      edge('e1', 'consent', 'next', 'id_card'),
      edge('e2', 'id_card', 'next', 'age_route'),
      edge('e3', 'id_card', 'exhausted', 'poa'),
      edge('e4', 'age_route', 'route:under_60', 'details'),
      edge('e5', 'age_route', 'else', 'done'),
      edge('e6', 'details', 'next', 'done'),
      edge('e7', 'poa', 'next', 'done'),
    ],
  };
}

export interface PreviewDraft {
  readonly templateId: string;
  readonly versionId: string;
}

/** A template with the draft above, never published; `archivePreviewDraft` ends it. */
export async function previewDraft(stack: StackInfo): Promise<PreviewDraft> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = previewSuffix();
  const { data: template } = await client.inquiryTemplates.create({
    ...defaultInquiryTemplateAttributes(),
    name: `e2e ui preview ${run}`,
  });
  const { data: draft } = await client.inquiryTemplateVersions.create({
    'inquiry-template-id': template.id,
    flow: previewFlow(run),
    'verification-config': {
      'government-id': defaultInquiryTemplateAttributes()['verification-config']['government-id'],
      document: typeConfig(DEFAULT_DOCUMENT_CHECKS),
    },
    copy: { messages: { en: { [DETAILS_KEY]: DETAILS_TEXT } } },
    'enabled-locales': ['en'],
    'default-locale': 'en',
  } as never);
  return { templateId: template.id, versionId: draft.id };
}

/** Archives the spec's template, so no inquiry can use it. */
export async function archivePreviewDraft(
  stack: StackInfo,
  draft: PreviewDraft | undefined,
): Promise<void> {
  if (draft === undefined) {
    return;
  }
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  await client.inquiryTemplates.update(draft.templateId, { status: 'archived' });
}

/**
 * C156.6: a draft workflow, API-triggered, whose one step waits an hour, so a sandbox test run of it
 * stays at that step ("waiting") until the workflow is ended.
 */
export async function waitingWorkflow(admin: OpenVerifyClient): Promise<string> {
  return draftWorkflow(
    admin,
    `e2e ui preview overlay ${previewSuffix()}`,
    chainDefinition({ type: 'trigger-api', config: {} }, [
      { id: 'hold', type: 'wait', name: 'Hold for an hour', mode: 'time', seconds: 3600 },
    ]),
  );
}
