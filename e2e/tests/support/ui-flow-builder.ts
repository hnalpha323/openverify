/**
 * Workflow 9C (`dashboard-flow-builder`): helpers of `ui-flow-builder.spec.ts`. Each object carries
 * a random suffix, so it never meets another run's on a reused stack. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import type { StackInfo } from '../../src/stack-info.js';
import { consentStep } from './flow-v2.js';
import { recordingClient } from './platform.js';

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/**
 * A flow-spec 2 flow: consent, a short screen, a government ID whose `exhausted` port is not wired
 * yet (the spec adds the fallback by keyboard), and a branch on the ID's extracted `age-years`
 * (`onNull: else`) that fails a minor (a non-outcome fact, so publishing it needs
 * `adverse-path:s_minor000`, C150.7) and completes everyone else.
 */
function builderFlow(run: string) {
  const id = defaultInquiryTemplateAttributes().flow.steps.find(
    (step) => step.type === 'government_id',
  );
  return {
    metadata: { specVersion: 2, id: `e2e-ui-builder-${run}`, version: 1, name: 'UI builder' },
    entry: 's_consent0',
    steps: [
      { ...consentStep(), id: 's_consent0' },
      {
        id: 's_intro000',
        type: 'screen',
        name: 'Introduction',
        components: [{ id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' }],
      },
      { ...id, id: 's_govid000', maxAttempts: 1, captureMethods: ['upload'] },
      {
        id: 's_age00000',
        type: 'branch',
        name: 'Age',
        routes: [
          {
            key: 'minor',
            label: 'Under 18',
            condition: { '<': [{ var: 'verifications.s_govid000.age-years' }, 18] },
            onNull: 'else',
          },
        ],
      },
      { id: 's_minor000', type: 'failure' },
      { id: 's_done0000', type: 'completion' },
    ],
    edges: [
      edge('e_1', 's_consent0', 'next', 's_intro000'),
      edge('e_2', 's_intro000', 'next', 's_govid000'),
      edge('e_3', 's_govid000', 'next', 's_age00000'),
      edge('e_4', 's_age00000', 'route:minor', 's_minor000'),
      edge('e_5', 's_age00000', 'else', 's_done0000'),
    ],
  };
}

export interface BuilderDraft {
  readonly templateId: string;
  /** The template's first version, published at creation. */
  readonly publishedId: string;
  readonly draftId: string;
}

/** A template with the draft above, never published by this helper; `archiveBuilderDraft` ends it. */
export async function builderDraft(stack: StackInfo): Promise<BuilderDraft> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().replaceAll('-', '').slice(0, 10);
  const { data: template } = await client.inquiryTemplates.create({
    ...defaultInquiryTemplateAttributes(),
    name: `e2e ui builder ${run}`,
  });
  const { data: draft } = await client.inquiryTemplateVersions.create({
    'inquiry-template-id': template.id,
    flow: builderFlow(run),
    'verification-config': {
      'government-id': defaultInquiryTemplateAttributes()['verification-config']['government-id'],
    },
  } as never);
  return {
    templateId: template.id,
    publishedId: template.attributes['current-version'].id,
    draftId: draft.id,
  };
}

/**
 * Someone else saves the draft (last-write-wins through the API key, with no `If-Match`), so the
 * console's next save meets a 412 (C154.3).
 */
export async function changeDraftElsewhere(stack: StackInfo, draft: BuilderDraft): Promise<void> {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  await client.inquiryTemplateVersions.update(draft.draftId, {
    description: 'Changed elsewhere (synthetic).',
  });
}

/** Archives the spec's template, so no inquiry can use it. */
export async function archiveBuilderDraft(
  stack: StackInfo,
  draft: BuilderDraft | undefined,
): Promise<void> {
  if (draft === undefined) {
    return;
  }
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  await client.inquiryTemplates.update(draft.templateId, { status: 'archived' });
}
