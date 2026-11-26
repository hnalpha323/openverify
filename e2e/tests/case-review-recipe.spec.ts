/**
 * C140.5, C128.2, C146.3 (Workflow 8B): the "Review on report match" recipe, installed as the dev
 * seed installs it, end to end on both of its paths. Budget: 120 s each.
 *
 * The recipe listens to every completion report that matched or errored in the environment, so
 * each test narrows its trigger to its own inquiry (a criterion beside the recipe's own), names its
 * own case template and gives the decline its basis and contest route, as an operator must before
 * production (C128.3). The inquiry completes; its report runs; the run marks the inquiry for review,
 * opens a case holding the inquiry and the report, and waits. A reviewer resolves the case through
 * the API, and the run decides from the resolution. The decision record says a person took part:
 * the reviewer's case resolution is the human step (C128.2), so it is not solely automated.
 *
 * - matched: the sandbox watchlist finds the fictional listed person; the reviewer declines.
 * - errored: a watchlist template naming a list the stack never synced errors; an error is
 *   reviewed, never read as "no match" (ADR 0005); the reviewer approves.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_EMAIL_ADDRESS_CHECKS } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import { publishedCaseTemplate } from './support/cases.js';
import { phase5Template, typeConfig } from './support/phase5.js';
import { recordingClient, signInToApi } from './support/platform.js';
import { SANDBOX_LISTS, seededTemplateId } from './support/reports.js';
import { adminClient, waitForRunEnd, waitForRunOf } from './support/workflows.js';

const RECIPE = 'review-on-report-match';
const PLACEHOLDER = 'change-me-case-template-id';

type Definition = Parameters<OpenVerifyClient['workflows']['saveDraft']>[1]['definition'];

interface Step {
  id: string;
  config?: Record<string, unknown>;
}

/** The recipe's draft, narrowed to `inquiryId`, on `caseTemplateId`, its decline filled. */
function filled(definition: unknown, inquiryId: string, caseTemplateId: string): Definition {
  if (definition === null || definition === undefined) {
    throw new Error(`the ${RECIPE} draft holds no definition`);
  }
  const text = JSON.stringify(definition).replaceAll(PLACEHOLDER, caseTemplateId);
  const parsed = JSON.parse(text) as {
    trigger: { config: { criteria: unknown; 'on-null'?: string } };
    steps: Step[];
  };
  parsed.trigger.config.criteria = {
    and: [parsed.trigger.config.criteria, { '===': [{ var: 'trigger.inquiry.id' }, inquiryId] }],
  };
  // A report may have no inquiry: such an event is not this test's, so it starts nothing.
  parsed.trigger.config['on-null'] = 'skip';
  for (const step of parsed.steps) {
    if (step.id === 'decline') {
      step.config = {
        ...step.config,
        'decision-basis': 'contract',
        'contest-route': {
          contact: 'Write to review@example.com',
          'case-template-id': caseTemplateId,
        },
      };
    }
  }
  return parsed as unknown as Definition;
}

async function reviewerClient(stack: StackInfo): Promise<OpenVerifyClient> {
  const token = await signInToApi(stack, stack.operators.reviewer);
  return recordingClient(stack.apiUrl, token).client;
}

async function reviewPath(path: 'matched' | 'errored'): Promise<void> {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const admin = await adminClient(stack);
  const reviewer = await reviewerClient(stack);
  const run = randomUUID().slice(0, 8);
  const caseTemplate = await publishedCaseTemplate(admin, `e2e-review-${path}-${run}`);
  const reportTemplateId =
    path === 'matched'
      ? await seededTemplateId(client, 'watchlist')
      : (
          await client.reportTemplates.create({
            name: `e2e review unsynced ${run}`,
            'report-type': 'watchlist',
            // A real list the e2e stack never syncs: the report errors, list_unavailable.
            config: { 'search-lists': ['ofac-sdn'] },
          })
        ).data.id;
  const { data: inquiryTemplate } = await client.inquiryTemplates.create({
    ...phase5Template(`e2e-review-${path}-${run}`, [{ id: 'email', type: 'email_otp' }], {
      'email-address': typeConfig(DEFAULT_EMAIL_ADDRESS_CHECKS),
    }),
    'report-config': { 'on-completion': [{ 'report-template-id': reportTemplateId }] },
  });
  const listed = SANDBOX_LISTS.listedPerson.query;
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': inquiryTemplate.id,
    'reference-id': `e2e-review-${path}-${run}`,
    fields: {
      name_first: listed['name-first'],
      name_last: listed['name-last'],
      birthdate: listed.birthdate,
      email_address: `e2e-review-${run}@example.test`,
    },
  });

  // Installed paused with a draft, as seed:dev installs it; filled, published and activated.
  const { data: workflow } = await admin.workflows.installRecipe(RECIPE);
  try {
    const { data: draft } = await admin.workflows.draft(workflow.id);
    await admin.workflows.saveDraft(workflow.id, {
      definition: filled(draft.attributes.definition, inquiry.id, caseTemplate.id),
      'lock-version': draft.attributes['lock-version'],
    });
    await admin.workflows.publish(workflow.id, {
      description: 'Synthetic e2e version.',
    });
    await admin.workflows.activate(workflow.id);

    await client.inquiries.performSimulateActions(inquiry.id, {
      actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
    });

    // The run reached its wait: the inquiry is in review, and a case holds it and the report.
    const runId = await waitForRunOf(client, workflow.id, 90_000);
    await expect
      .poll(async () => (await client.inquiries.retrieve(inquiry.id)).data.attributes.status, {
        timeout: 60_000,
      })
      .toBe('needs_review');
    let caseId: string | undefined;
    await expect
      .poll(
        async () => {
          const { data } = await admin.cases.list({
            filter: { 'case-template-id': caseTemplate.id },
          });
          caseId = data[0]?.id;
          return caseId;
        },
        { timeout: 60_000, intervals: [500, 1_000] },
      )
      .toBeDefined();
    const opened = caseId ?? '';
    const { data: held } = await admin.cases.objects(opened);
    const report = held.find(({ attributes }) => attributes['object-type'] === 'report');
    expect(held.map(({ attributes }) => attributes['object-type']).sort()).toEqual([
      'inquiry',
      'report',
    ]);
    const reportId = report?.attributes['object-id'] ?? '';
    const { data: screened } = await client.reports.retrieve(reportId);
    expect(screened.attributes.status).toBe(path === 'matched' ? 'ready' : 'errored');
    expect((await client.workflowRuns.retrieve(runId)).data.attributes).toMatchObject({
      status: 'in_progress',
      'waiting-on': 'event',
    });

    // A reviewer resolves the case through the API: a person's resolution (C128.2).
    const resolution = path === 'matched' ? 'declined' : 'approved';
    const { data: resolved } = await reviewer.cases.setStatus(opened, { status: resolution });
    expect(resolved.attributes).toMatchObject({
      'status-category': 'end',
      resolution: path === 'matched' ? 'Declined' : 'Approved',
      'resolver-type': 'user',
    });

    const ended = await waitForRunEnd(client, runId);
    expect(ended.attributes.status).toBe('completed');
    expect((await client.inquiries.retrieve(inquiry.id)).data.attributes.status).toBe(resolution);
    const { data: decisions } = await client.decisions.list({
      filter: { 'subject-id': inquiry.id },
    });
    const kind = path === 'matched' ? 'decline' : 'approve';
    const decided = decisions.find(({ attributes }) => attributes.kind === kind);
    expect(decided?.attributes).toMatchObject({
      actor: { type: 'workflow-run', id: runId },
      'solely-automated': false,
      'human-step': { kind: 'case-resolution' },
      ...(path === 'matched' ? { 'decision-basis': 'contract' } : {}),
    });
    expect(decisions.map(({ attributes }) => attributes.kind)).toEqual(
      expect.arrayContaining(['review', kind]),
    );
  } finally {
    await admin.workflows.pause(workflow.id);
  }
}

test('"Review on report match" on a matched completion report: a reviewer declines the case, and the run declines the inquiry with its basis, not solely automated (C140.5, C128.2, C146.3)', async () => {
  test.setTimeout(120_000);
  await reviewPath('matched');
});

test('"Review on report match" on an errored completion report: a reviewer approves the case, and the run approves the inquiry, not solely automated (C140.5, C128.2, C146.3)', async () => {
  test.setTimeout(120_000);
  await reviewPath('errored');
});
