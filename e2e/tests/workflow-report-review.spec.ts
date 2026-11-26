/**
 * C118.1, C119.3, C127, C128, C146.3 (Workflow 8A): the whole loop, full stack. Budget: 90 s.
 *
 * An inquiry completes, which starts a workflow through the event outbox. It runs a sandbox watchlist
 * report on the fictional listed person (the synthetic list seed:dev imported), reads the hit, marks
 * the inquiry for review and waits on the report. A reviewer dismisses the match, which resumes the
 * run: it approves the inquiry. The decision record says a run made it, by which route, and that it
 * was solely automated: a report's dismissal is no case resolved by a person (C128.2).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { defaultTemplateAttributes, recordingClient } from './support/platform.js';
import { SANDBOX_LISTS, seededTemplateId, waitForReport } from './support/reports.js';
import {
  actionStep,
  adminClient,
  runningWorkflow,
  waitForRunEnd,
  waitForRunOf,
} from './support/workflows.js';

test('an inquiry-completed workflow screens, reviews on a hit and approves after the dismissal, with its decision recorded (C127, C128, C146.3)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const admin = await adminClient(stack);
  const run = randomUUID().slice(0, 8);
  const reportTemplateId = await seededTemplateId(client, 'watchlist');
  const { data: inquiryTemplate } = await client.inquiryTemplates.create(
    await defaultTemplateAttributes(`e2e-workflow-review-${run}`),
  );
  const listed = SANDBOX_LISTS.listedPerson.query;
  const definition = {
    'schema-version': 1,
    trigger: {
      type: 'trigger-event',
      config: {
        events: ['inquiry.completed'],
        criteria: { '===': [{ var: 'trigger.template.id' }, inquiryTemplate.id] },
      },
    },
    inputs: [],
    variables: [],
    steps: [
      actionStep('screen', 'run_report', {
        'report-template-id': reportTemplateId,
        'inquiry-id': '{{ trigger.id }}',
        fields: {
          'name-first': listed['name-first'],
          'name-last': listed['name-last'],
          birthdate: listed.birthdate,
        },
      }),
      {
        id: 'hit',
        type: 'conditional',
        name: 'Listed?',
        routes: [
          {
            key: 'listed',
            label: 'Listed',
            condition: { '===': [{ var: 'steps.screen.output.has-match' }, true] },
            'on-null': 'error',
          },
        ],
      },
      actionStep('review', 'mark_inquiry_for_review', { 'inquiry-id': '{{ trigger.id }}' }),
      {
        id: 'dismissed',
        type: 'wait',
        name: 'A reviewer dismisses the match',
        mode: 'events',
        subject: 'steps.screen.output.report-id',
        events: ['report/watchlist.dismissed'],
        'timeout-seconds': 300,
        'on-timeout': 'error',
      },
      actionStep('approve', 'approve_inquiry', { 'inquiry-id': '{{ trigger.id }}' }),
      { id: 'output', type: 'output', name: 'Output', mappings: {} },
    ],
    edges: [
      { id: 'start', from: 'trigger', 'from-port': 'next', to: 'screen' },
      { id: 'screened', from: 'screen', 'from-port': 'next', to: 'hit' },
      { id: 'listed', from: 'hit', 'from-port': 'route:listed', to: 'review' },
      { id: 'clear', from: 'hit', 'from-port': 'else', to: 'output' },
      { id: 'reviewed', from: 'review', 'from-port': 'next', to: 'dismissed' },
      { id: 'cleared', from: 'dismissed', 'from-port': 'next', to: 'approve' },
      { id: 'end', from: 'approve', 'from-port': 'next', to: 'output' },
    ],
    outputs: [],
    layout: {},
  };
  const workflowId = await runningWorkflow(
    admin,
    `e2e-workflow-review-${run}`,
    definition as never,
  );

  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': inquiryTemplate.id,
    'reference-id': `e2e-workflow-review-${run}`,
  });
  await client.inquiries.performSimulateActions(inquiry.id, {
    actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
  });

  const runId = await waitForRunOf(client, workflowId);
  // The run reached its wait: the inquiry is in review and the report holds the hit.
  await expect
    .poll(async () => (await client.inquiries.retrieve(inquiry.id)).data.attributes.status, {
      timeout: 60_000,
    })
    .toBe('needs_review');
  const { data: steps } = await client.workflowRuns.steps(runId);
  const screen = steps.find(({ attributes }) => attributes['node-id'] === 'screen');
  const output = screen?.attributes.output as { 'report-id': string; 'has-match': boolean };
  expect(output['has-match']).toBe(true);
  await waitForReport(client, output['report-id']);
  expect((await client.workflowRuns.retrieve(runId)).data.attributes).toMatchObject({
    status: 'in_progress',
    'waiting-on': 'event',
  });

  await admin.reports.dismiss(output['report-id'], {
    reason: `Synthetic e2e ${run}: not the listed party`,
  });

  const ended = await waitForRunEnd(client, runId);
  expect(ended.attributes.status).toBe('completed');
  expect((await client.inquiries.retrieve(inquiry.id)).data.attributes.status).toBe('approved');
  const { data: decisions } = await client.decisions.list({ filter: { 'subject-id': inquiry.id } });
  const approve = decisions.find(({ attributes }) => attributes.kind === 'approve');
  expect(approve?.attributes).toMatchObject({
    actor: { type: 'workflow-run', id: runId },
    'solely-automated': true,
    'human-step': null,
    run: { routes: [{ 'node-id': 'hit', 'route-key': 'listed' }] },
  });
  expect(decisions.map(({ attributes }) => attributes.kind)).toEqual(
    expect.arrayContaining(['review', 'approve']),
  );
});
