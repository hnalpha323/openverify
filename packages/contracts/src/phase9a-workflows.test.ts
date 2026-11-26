/**
 * Workflow 9A Stage 1a, the Phase 8 side of the flow (review F05; the "Phase 7 and 8 outcomes that
 * amend this plan", item 5): the `trigger-flow` trigger, the run creator `inquiry-flow`, and the
 * decision record of an inquiry a flow failed on more than a verification's outcome (C150.7).
 */
import { describe, expect, it } from 'vitest';
import {
  buildDecisionResource,
  decisionDocumentSchema,
  decisionFlowSchema,
  type DecisionRecord,
} from './decisions.js';
import { AT, IDS, readFixture } from './test-support.js';
import { workflowTriggerSchema } from './workflow-definition.js';
import { workflowRunCreatorIdentifierSchema } from './workflow-runs.js';

const VERSION = 'itmplv_01M5CN00000000000000009A01';

const FLOW_FAILURE = {
  id: 'idec_01M5CN00000000000000009A20',
  kind: 'flow-failure',
  subject: { type: 'inquiry', id: IDS.inquiry },
  actor: { type: 'inquiry-flow', id: IDS.inquiry },
  run: null,
  flow: {
    templateVersionId: VERSION,
    failureStepId: 'failed_minor',
    routes: [
      { stepId: 'age_route', port: 'route:minor', onNull: null },
      { stepId: 'risk_route', port: 'else', onNull: 'else' },
    ],
  },
  solelyAutomated: true,
  humanStep: null,
  evidence: [
    {
      kind: 'extraction',
      id: null,
      name: 'age-years',
      status: null,
      tier: 'R/H',
      stage: 'beta',
      confidence: null,
    },
    {
      kind: 'device',
      id: null,
      name: 'kind',
      status: 'mobile-web',
      tier: 'R',
      stage: 'ga',
      confidence: null,
    },
    {
      kind: 'field',
      id: null,
      name: 'purpose',
      status: null,
      tier: 'R',
      stage: 'ga',
      confidence: null,
    },
    {
      kind: 'account',
      id: null,
      name: 'status',
      status: 'active',
      tier: 'R',
      stage: 'ga',
      confidence: null,
    },
    {
      kind: 'workflow-output',
      id: null,
      name: 'screening.risk',
      status: null,
      tier: 'R',
      stage: 'ga',
      confidence: null,
    },
  ],
  pendingEvidence: [],
  decisionBasis: 'contract',
  contestRoute: { url: 'https://help.example.com/contest' },
  biometricBasis: null,
  comment: null,
  needsReview: false,
  humanReviewPending: false,
  errorCode: null,
  testRunId: null,
  createdAt: AT,
} as DecisionRecord;

const attributesOf = (record: DecisionRecord) =>
  (buildDecisionResource(record) as { attributes: Record<string, unknown> }).attributes;

describe('trigger-flow (C152.2)', () => {
  it('is a trigger with no config: the inquiry is its subject and the declared inputs its view', () => {
    expect(workflowTriggerSchema.safeParse({ type: 'trigger-flow', config: {} }).success).toBe(
      true,
    );
    expect(
      workflowTriggerSchema.safeParse({
        type: 'trigger-flow',
        config: { 'object-type': 'inquiry' },
      }).success,
    ).toBe(false);
  });
});

describe('the run creator inquiry-flow (C152.2, C120.1 amended)', () => {
  it('names the inquiry whose flow started the run, and nothing else', () => {
    expect(
      workflowRunCreatorIdentifierSchema.safeParse({ type: 'inquiry-flow', id: IDS.inquiry })
        .success,
    ).toBe(true);
    expect(
      workflowRunCreatorIdentifierSchema.safeParse({
        type: 'inquiry-flow',
        id: 'wfr_01M5CM00000000000000000006',
      }).success,
    ).toBe(false);
  });
});

describe('the flow-failure decision record (C150.7)', () => {
  it('records the flow as its actor, the routes taken as codes, and the facts with their tiers', () => {
    const attributes = attributesOf(FLOW_FAILURE);
    expect(attributes).toMatchObject({
      kind: 'flow-failure',
      actor: { type: 'inquiry-flow', id: IDS.inquiry },
      run: null,
      flow: {
        'template-version-id': VERSION,
        'failure-step-id': 'failed_minor',
        routes: [
          { 'step-id': 'age_route', port: 'route:minor', 'on-null': null },
          { 'step-id': 'risk_route', port: 'else', 'on-null': 'else' },
        ],
      },
      'solely-automated': true,
    });
    expect((attributes.evidence as { kind: string }[]).map((entry) => entry.kind)).toEqual([
      'extraction',
      'device',
      'field',
      'account',
      'workflow-output',
    ]);
  });

  it('names an inquiry flow only by its inquiry id', () => {
    expect(() =>
      buildDecisionResource({
        ...FLOW_FAILURE,
        actor: { type: 'inquiry-flow', id: 'wfr_01M5CM00000000000000000006' },
      }),
    ).toThrow();
  });

  it('serves flow as null on every record a flow did not make', () => {
    const earlier: DecisionRecord = { ...FLOW_FAILURE };
    delete earlier.flow;
    expect(
      attributesOf({ ...earlier, kind: 'decline', actor: { type: 'user', id: IDS.user } }).flow,
    ).toBeNull();
  });

  it('carries codes only: the builder keeps no other member, and the schema refuses one', () => {
    const withValue = {
      ...FLOW_FAILURE,
      flow: {
        templateVersionId: VERSION,
        failureStepId: 'failed_minor',
        routes: [{ stepId: 'age_route', port: 'route:minor', onNull: null, value: 17 }],
      },
    } as unknown as DecisionRecord;
    const flow = attributesOf(withValue).flow as { routes: object[] };
    expect(flow.routes[0]).toEqual({
      'step-id': 'age_route',
      port: 'route:minor',
      'on-null': null,
    });
    expect(
      decisionFlowSchema.safeParse({
        'template-version-id': VERSION,
        'failure-step-id': 'failed_minor',
        routes: [{ 'step-id': 'age_route', port: 'route:minor', 'on-null': null, value: 17 }],
      }).success,
    ).toBe(false);
  });

  it('parses the golden record', () => {
    const golden = readFixture('api/decision-flow-failure.json');
    expect(decisionDocumentSchema.parse(golden)).toEqual(golden);
  });
});
