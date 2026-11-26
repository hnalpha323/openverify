/**
 * C140.5 (Workflow 8B; H11, H12, V06, V20): the recipes with a case, joined to `WORKFLOW_RECIPE_ROWS`
 * in `workflows/recipes/rows.ts`, and so to `GET /workflow-recipes`, the install route and the dev
 * seed. Owner `api-case-workflows`; `foundation-8b` made the join.
 *
 * "Review on report match": a completion report that matched or errored marks its inquiry for
 * review and opens a case holding the inquiry and the report; when a person resolves the case, the
 * route reads the wait and the case's resolution, and approves or declines. An errored report is
 * reviewed, never read as "no match" (ADR 0005). A wait that times out decides nothing: the inquiry
 * stays in review. The decline carries no `decision-basis` and no `contest-route`, so the production
 * gate refuses it until the operator fills them (C128.3), and the case template is a placeholder that
 * publish refuses until it names one (`reference_unknown`).
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import { REPORT_REGISTRY, REPORT_TYPES } from '@openverify/core';
import type { WorkflowRecipe } from '../../recipes/table.js';

/** C140.5: what the operator must name; a literal here fails `reference_unknown` at publish. */
const CASE_TEMPLATE = 'change-me-case-template-id';

/** C129.2: a review template's default resolutions, which its `end` statuses' labels match. */
const APPROVED = 'Approved';
const DECLINED = 'Declined';

/** C135, C127.2: a person has 30 days to resolve the case; then the inquiry stays in review. */
const REVIEW_SECONDS = 30 * 24 * 60 * 60;

const INQUIRY = '{{ trigger.inquiry.id }}';
const CASE = '{{ steps.open_case.output.case-id }}';

/** Every report type that can match, its `matched` and `errored` events (C70.4). */
function reportEvents(): string[] {
  return REPORT_TYPES.filter((type) => REPORT_REGISTRY[type].review === 'matches').flatMap(
    (type) => {
      const { resourceType } = REPORT_REGISTRY[type];
      return [`${resourceType}.matched`, `${resourceType}.errored`];
    },
  );
}

const resolvedTo = (resolution: string) => ({
  and: [
    { '===': [{ var: 'steps.review_case.output.resolved-by' }, 'event'] },
    { '===': [{ var: 'steps.read_case.output.object.resolution' }, resolution] },
  ],
});

const action = (id: string, name: string, key: string, config: Record<string, unknown>) => ({
  id,
  type: 'action' as const,
  name,
  'action-key': key,
  'action-version': 1,
  config,
});

const edge = (id: string, from: string, port: string, to: string) => ({
  id,
  from,
  'from-port': port,
  to,
});

function reviewOnReportMatch(): WorkflowDefinition {
  return {
    'schema-version': 1,
    trigger: {
      type: 'trigger-event',
      config: {
        events: reportEvents(),
        criteria: { '===': [{ var: 'trigger.origin' }, 'inquiry_completion'] },
      },
    },
    inputs: [],
    variables: [],
    steps: [
      action('mark_review', 'Mark the inquiry for review', 'mark_inquiry_for_review', {
        'inquiry-id': INQUIRY,
      }),
      action('open_case', 'Open a review case', 'create_case', {
        'case-template-id': CASE_TEMPLATE,
        'object-ids': [INQUIRY, '{{ trigger.id }}'],
      }),
      {
        id: 'review_case',
        type: 'wait',
        name: 'Wait for a person to resolve the case',
        mode: 'events',
        subject: 'steps.open_case.output.case-id',
        events: ['case.resolved'],
        'timeout-seconds': REVIEW_SECONDS,
        'on-timeout': 'continue',
      },
      action('read_case', 'Read the case’s resolution', 'fetch_object', {
        'object-type': 'case',
        'object-id': CASE,
      }),
      {
        id: 'decide',
        type: 'conditional',
        name: 'Decide from the resolution',
        routes: [
          {
            key: 'approve',
            label: APPROVED,
            condition: resolvedTo(APPROVED),
            'on-null': 'skip-route',
          },
          {
            key: 'decline',
            label: DECLINED,
            condition: resolvedTo(DECLINED),
            'on-null': 'skip-route',
          },
        ],
      },
      action('approve', 'Approve the inquiry', 'approve_inquiry', { 'inquiry-id': INQUIRY }),
      action('decline', 'Decline the inquiry', 'decline_inquiry', { 'inquiry-id': INQUIRY }),
      { id: 'output', type: 'output', name: 'Output', mappings: {} },
    ],
    edges: [
      edge('start', 'trigger', 'next', 'mark_review'),
      edge('open', 'mark_review', 'next', 'open_case'),
      edge('wait', 'open_case', 'next', 'review_case'),
      edge('read', 'review_case', 'next', 'read_case'),
      edge('route', 'read_case', 'next', 'decide'),
      edge('approved', 'decide', 'route:approve', 'approve'),
      edge('declined', 'decide', 'route:decline', 'decline'),
      edge('undecided', 'decide', 'else', 'output'),
      edge('after_approve', 'approve', 'next', 'output'),
      edge('after_decline', 'decline', 'next', 'output'),
    ],
    outputs: [],
    layout: {},
  } as WorkflowDefinition;
}

/**
 * "Review on report match", whole. Its route reads the case's resolution from `fetch_object`, which
 * the engine types by the case view (`OBJECT_VIEW_NAMES` in `packages/workflow-engine`), where
 * `resolution` is plain, so the literal comparison stands (Workflow 8B Stage 4).
 */
export const REVIEW_ON_REPORT_MATCH: WorkflowRecipe = {
  key: 'review-on-report-match',
  name: 'Review on report match',
  description:
    'When a report made at an inquiry’s completion matches or errors, marks the inquiry for ' +
    'review and opens a case holding the inquiry and the report. When a person resolves the ' +
    'case Approved or Declined, the inquiry is approved or declined. Choose the case template, ' +
    'and give the decline its decision basis and contest route before publishing in production.',
  needsConfiguration: ['case-template-id', 'decision-basis', 'contest-route'],
  definition: reviewOnReportMatch,
};

/** The recipes with a case (C140.5). */
export const CASE_RECIPE_ROWS: readonly WorkflowRecipe[] = [REVIEW_ON_REPORT_MATCH];
