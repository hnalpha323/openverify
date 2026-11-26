/**
 * The editor's decision templates (C128.5, decision 51): review first. Each template marks the
 * inquiry for review and opens a case holding it, waits for a person to resolve the case, reads the
 * case's resolution, and only then approves or declines. A decline is never reached without that
 * wait, and it carries the decision basis, contest route and biometric basis the operator gave
 * (C128.3, C128.4); left unset, the production publish gate refuses it until they are filled.
 *
 * A template only makes a definition. The create form saves it as the new workflow's draft through
 * `PUT /workflows/:id/draft`; nothing here publishes, and the draft is published like any other
 * (C116.4). The definitions use only what the draft check accepts: the shape of the "Review on
 * report match" recipe (C140.5), which installs as a draft with no error.
 *
 * console-editor's palette reads `DECISION_TEMPLATES` and `decisionTemplateDefinition`.
 */
import type { ContestRoute, WorkflowDefinition } from '@openverify/contracts';
import { REPORT_REGISTRY, REPORT_TYPES } from '@openverify/core';
import type { BiometricBasis, DecisionBasis } from '@openverify/core';

export const DECISION_TEMPLATE_KEYS = [
  'review-completed-inquiry',
  'review-failed-inquiry',
  'review-report-match',
] as const;
export type DecisionTemplateKey = (typeof DECISION_TEMPLATE_KEYS)[number];

/** A template as the create form and the palette name it. */
export interface DecisionTemplate {
  readonly key: DecisionTemplateKey;
  readonly name: string;
  readonly description: string;
}

/** What the operator fills in; each is optional, and nothing is filled in on their behalf. */
export interface DecisionTemplateOptions {
  /** The case template of the review case; a placeholder that publish refuses when left out. */
  readonly caseTemplateId?: string;
  /** C128.3: the basis of an automated decline. */
  readonly decisionBasis?: DecisionBasis;
  /** C128.3: how the person contests a decline: an `https:` URL or a contact. */
  readonly contestRoute?: ContestRoute;
  /** C128.4: the basis of a biometric decline. */
  readonly biometricBasis?: BiometricBasis;
}

export const DECISION_TEMPLATES: readonly DecisionTemplate[] = [
  {
    key: 'review-completed-inquiry',
    name: 'Review a completed inquiry, then decide from the case',
    description:
      'When an inquiry completes, marks it for review and opens a case holding it. When a person ' +
      'resolves the case Approved or Declined, the inquiry is approved or declined; otherwise it ' +
      'stays in review.',
  },
  {
    key: 'review-failed-inquiry',
    name: 'Review a failed inquiry, then decline only from the case',
    description:
      'When an inquiry fails, marks it for review and opens a case holding it. A decline follows ' +
      'only a person resolving the case Declined; any other outcome leaves the inquiry in review ' +
      'for a person to decide.',
  },
  {
    key: 'review-report-match',
    name: 'Review a report match, then decide from the case',
    description:
      'When a report made at an inquiry’s completion matches or errors, marks the inquiry for ' +
      'review and opens a case holding the inquiry and the report. The case’s resolution decides.',
  },
];

/** What publish refuses as `reference_unknown` until the operator names a case template. */
export const CASE_TEMPLATE_PLACEHOLDER = 'change-me-case-template-id';

/** C129.2: a review template's default resolutions, which its end statuses' labels match. */
const APPROVED = 'Approved';
const DECLINED = 'Declined';

/** A person has 30 days to resolve the case; past that the inquiry stays in review. */
const REVIEW_SECONDS = 30 * 24 * 60 * 60;

const CASE = '{{ steps.open_case.output.case-id }}';

/** Every report type that can match: its `matched` and `errored` events. */
function reportEvents(): string[] {
  return REPORT_TYPES.filter((type) => REPORT_REGISTRY[type].review === 'matches').flatMap(
    (type) => {
      const { resourceType } = REPORT_REGISTRY[type];
      return [`${resourceType}.matched`, `${resourceType}.errored`];
    },
  );
}

/** A route that holds only once a person resolved the case (not a timeout) with `resolution`. */
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

/** The decline's own fields: only those the operator gave (C128.3, C128.4). */
function adverseFields(options: DecisionTemplateOptions): Record<string, unknown> {
  return {
    ...(options.decisionBasis === undefined ? {} : { 'decision-basis': options.decisionBasis }),
    ...(options.contestRoute === undefined ? {} : { 'contest-route': options.contestRoute }),
    ...(options.biometricBasis === undefined ? {} : { 'biometric-basis': options.biometricBasis }),
  };
}

interface Shape {
  readonly events: string[];
  /** Where the inquiry's id is in the trigger view. */
  readonly inquiry: string;
  /** What the case holds besides the inquiry. */
  readonly alsoHeld: readonly string[];
  /** Whether a resolution of Approved approves; never for a failed inquiry (C127.1). */
  readonly approves: boolean;
}

const SHAPES: Readonly<Record<DecisionTemplateKey, Shape>> = {
  'review-completed-inquiry': {
    events: ['inquiry.completed'],
    inquiry: '{{ trigger.id }}',
    alsoHeld: [],
    approves: true,
  },
  'review-failed-inquiry': {
    events: ['inquiry.failed'],
    inquiry: '{{ trigger.id }}',
    alsoHeld: [],
    approves: false,
  },
  'review-report-match': {
    events: reportEvents(),
    inquiry: '{{ trigger.inquiry.id }}',
    alsoHeld: ['{{ trigger.id }}'],
    approves: true,
  },
};

/** The definition of template `key`, holding what the operator gave in `options`. */
export function decisionTemplateDefinition(
  key: DecisionTemplateKey,
  options: DecisionTemplateOptions = {},
): WorkflowDefinition {
  const shape = SHAPES[key];
  const routes = [
    ...(shape.approves
      ? [
          {
            key: 'approve',
            label: APPROVED,
            condition: resolvedTo(APPROVED),
            'on-null': 'skip-route',
          },
        ]
      : []),
    { key: 'decline', label: DECLINED, condition: resolvedTo(DECLINED), 'on-null': 'skip-route' },
  ];
  const definition = {
    'schema-version': 1,
    trigger: {
      type: 'trigger-event',
      config: {
        events: shape.events,
        ...(key === 'review-report-match'
          ? { criteria: { '===': [{ var: 'trigger.origin' }, 'inquiry_completion'] } }
          : {}),
      },
    },
    inputs: [],
    variables: [],
    steps: [
      action('mark_review', 'Mark the inquiry for review', 'mark_inquiry_for_review', {
        'inquiry-id': shape.inquiry,
      }),
      action('open_case', 'Open a review case', 'create_case', {
        'case-template-id': options.caseTemplateId ?? CASE_TEMPLATE_PLACEHOLDER,
        'object-ids': [shape.inquiry, ...shape.alsoHeld],
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
      { id: 'decide', type: 'conditional', name: 'Decide from the resolution', routes },
      ...(shape.approves
        ? [
            action('approve', 'Approve the inquiry', 'approve_inquiry', {
              'inquiry-id': shape.inquiry,
            }),
          ]
        : []),
      action('decline', 'Decline the inquiry', 'decline_inquiry', {
        'inquiry-id': shape.inquiry,
        ...adverseFields(options),
      }),
      { id: 'output', type: 'output', name: 'Output', mappings: {} },
    ],
    edges: [
      edge('start', 'trigger', 'next', 'mark_review'),
      edge('open', 'mark_review', 'next', 'open_case'),
      edge('wait', 'open_case', 'next', 'review_case'),
      edge('read', 'review_case', 'next', 'read_case'),
      edge('route', 'read_case', 'next', 'decide'),
      ...(shape.approves
        ? [
            edge('approved', 'decide', 'route:approve', 'approve'),
            edge('after_approve', 'approve', 'next', 'output'),
          ]
        : []),
      edge('declined', 'decide', 'route:decline', 'decline'),
      edge('undecided', 'decide', 'else', 'output'),
      edge('after_decline', 'decline', 'next', 'output'),
    ],
    outputs: [],
    layout: {},
  };
  return definition as WorkflowDefinition;
}
