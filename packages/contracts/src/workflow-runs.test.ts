import { describe, expect, it } from 'vitest';
import { AT, AT_ISO, IDS, LATER, LATER_ISO } from './test-support.js';
import {
  PII_WORKFLOW_RUN_ATTRIBUTES,
  WORKFLOW_RUN_INCLUDES,
  WORKFLOW_RUN_INCLUDE_PERMISSIONS,
  buildWorkflowRunResource,
  buildWorkflowRunStepResource,
  buildWorkflowTriggerDeliveryResource,
  cancelWorkflowRunsBodySchema,
  createWorkflowManualRunsBodySchema,
  createWorkflowTestRunBodySchema,
  getWorkflowRunQuerySchema,
  listWorkflowRunStepsQuerySchema,
  listWorkflowRunsQuerySchema,
  listWorkflowTriggerDeliveriesQuerySchema,
  resumeWorkflowRunBodySchema,
  triggerWorkflowBodySchema,
  workflowRunAttributesSchema,
  workflowRunErroredEventMetaSchema,
  workflowRunEventMetaSchema,
  workflowRunResourceSchema,
  workflowTriggerFileValueSchema,
} from './workflow-runs.js';

const WFL = 'wfl_01M5CM00000000000000000001';
const WFV = 'wfv_01M5CM00000000000000000002';
const WFR = 'wfr_01M5CM00000000000000000006';
const WFST = 'wfst_01M5CM00000000000000000007';
const WFTD = 'wftd_01M5CM00000000000000000008';

const outcomes = {
  succeeded: 3,
  'failed-continued': 0,
  'timed-out': 0,
  'unknown-effect': 0,
  skipped: 1,
};

const run = {
  id: WFR,
  workflowId: WFL,
  workflowVersionId: WFV,
  status: 'in_progress' as const,
  createdAt: AT,
  updatedAt: LATER,
  completedAt: null,
  waitingOn: null,
  rolloutLabel: null,
  triggerType: 'trigger-event' as const,
  error: null,
  erroredStep: null,
  subjectIds: [IDS.inquiry],
  stepOutcomes: outcomes,
  testRunId: null,
  overriddenSteps: [],
  redactedAt: null,
  valuesPurgedAt: null,
  inputs: {},
  variables: {},
  outputs: null,
  triggerSnapshot: null,
  creator: { type: 'event' as const, id: IDS.event },
  rerunOf: null,
  processingTimeSeconds: null,
};

const FAILURE = { type: 'resource-error', message: 'A resource was not available.' };
const STEP = {
  name: 'Run a report',
  key: 'run_report',
  type: 'action',
  'action-key': 'run_report',
};

describe('the run resource (C120.1, C120.2)', () => {
  it('builds with the public members, ours and the public meta', () => {
    const resource = buildWorkflowRunResource(run);
    expect(resource.attributes).toMatchObject({
      status: 'in_progress',
      'created-at': AT_ISO,
      'updated-at': LATER_ISO,
      'completed-at': null,
      'trigger-type': 'trigger-event',
      'step-outcomes': outcomes,
    });
    expect(resource.meta).toEqual({ 'processing-time-seconds': null });
    expect(resource.relationships.creator.data).toEqual({ type: 'event', id: IDS.event });
  });

  it('takes each creator of C120.1, and none for a recurring tick', () => {
    for (const creator of [
      { type: 'user', id: IDS.user },
      { type: 'api-key', id: IDS.serverIntegration },
      { type: 'event', id: IDS.event },
      { type: 'scheduled-run', id: 'srrun_01M5CM00000000000000000009' },
      { type: 'workflow-run', id: WFR },
      { type: 'account-action', id: 'accac_01M5CM00000000000000000010' },
      { type: 'case-action', id: 'cact_01M5CM00000000000000000011' },
      null,
    ] as const) {
      expect(buildWorkflowRunResource({ ...run, creator }).relationships.creator.data).toEqual(
        creator,
      );
    }
  });

  it('types the error as an open string, so a new type is not breaking', () => {
    const errored = { ...run, status: 'errored' as const, completedAt: LATER };
    const open = { type: 'quota-error', message: 'Fixed text.' };
    expect(buildWorkflowRunResource({ ...errored, error: open }).attributes.error).toEqual(open);
  });

  it('says when it ended exactly when it has', () => {
    expect(() => buildWorkflowRunResource({ ...run, completedAt: LATER })).toThrow();
    expect(() => buildWorkflowRunResource({ ...run, status: 'completed' })).toThrow();
    expect(() => buildWorkflowRunResource({ ...run, status: 'canceled' })).toThrow();
    expect(
      buildWorkflowRunResource({ ...run, status: 'canceled', completedAt: LATER }).attributes
        .status,
    ).toBe('canceled');
  });

  it('waits only while in progress: waiting is no status of its own (decision 20)', () => {
    expect(buildWorkflowRunResource({ ...run, waitingOn: 'event' }).attributes['waiting-on']).toBe(
      'event',
    );
    expect(() =>
      buildWorkflowRunResource({
        ...run,
        status: 'completed',
        completedAt: LATER,
        waitingOn: 'event',
      }),
    ).toThrow();
  });

  it('says why it errored, and a run that did not has no error', () => {
    expect(() =>
      buildWorkflowRunResource({ ...run, status: 'errored', completedAt: LATER }),
    ).toThrow();
    expect(() => buildWorkflowRunResource({ ...run, error: FAILURE })).toThrow();
    const failed = buildWorkflowRunResource({
      ...run,
      status: 'errored',
      completedAt: LATER,
      error: FAILURE,
      erroredStep: STEP as never,
    });
    expect(failed.attributes['errored-step']).toEqual(STEP);
    expect(
      buildWorkflowRunResource({
        ...run,
        status: 'errored',
        completedAt: LATER,
        error: { type: 'run-failure', message: 'The run failed.' },
      }).attributes['errored-step'],
    ).toBeNull();
  });

  it('keeps a test run marked with its own id (C120.7)', () => {
    const resource = buildWorkflowRunResource({
      ...run,
      testRunId: WFR,
      overriddenSteps: ['run_report'],
    });
    expect(resource.attributes['test-run-id']).toBe(WFR);
    expect(resource.attributes['overridden-steps']).toEqual(['run_report']);
  });

  it('names what it was rerun from (C120.4)', () => {
    const other = 'wfr_01M5CM00000000000000000011';
    expect(
      buildWorkflowRunResource({ ...run, rerunOf: other }).relationships['rerun-of'].data,
    ).toEqual({ type: 'workflow-run', id: other });
  });

  it('nulls every value member, as a mask, a purge or an event does', () => {
    const resource = buildWorkflowRunResource({
      ...run,
      inputs: null,
      variables: null,
      outputs: null,
      triggerSnapshot: null,
    });
    expect(workflowRunResourceSchema.parse(resource)).toEqual(resource);
  });

  it('marks every value member PII, and lists it (C120.6)', () => {
    for (const member of ['inputs', 'variables', 'outputs', 'trigger-snapshot']) {
      const schema = workflowRunAttributesSchema.shape[member as 'inputs'];
      expect(schema.meta(), member).toEqual({ pii: true });
      expect(PII_WORKFLOW_RUN_ATTRIBUTES).toContain(member);
    }
  });

  it('marks nothing a run reader needs without PII visibility as PII', () => {
    for (const member of ['status', 'error', 'errored-step', 'subject-ids', 'step-outcomes']) {
      expect(PII_WORKFLOW_RUN_ATTRIBUTES).not.toContain(member);
    }
  });
});

describe('the run routes (C112.6)', () => {
  it('filters as the plan lists, by name for status (the parameter, not its description)', () => {
    const query = {
      'filter[workflow-id]': WFL,
      'filter[status]': 'in_progress,errored',
      'filter[workflow-version-id]': WFV,
      'filter[subject-id]': IDS.inquiry,
      'filter[has-step-errors]': 'true',
      'page[after]': WFR,
    };
    expect(listWorkflowRunsQuerySchema.parse(query)).toEqual(query);
    expect(listWorkflowRunsQuerySchema.safeParse({ 'filter[status]': 'waiting' }).success).toBe(
      false,
    );
    expect(
      listWorkflowRunsQuerySchema.safeParse({ 'filter[has-step-errors]': 'yes' }).success,
    ).toBe(false);
  });

  it('includes a workflow and version, each needing workflows:read (C143.6)', () => {
    expect(WORKFLOW_RUN_INCLUDES).toEqual(['workflow', 'workflow-version']);
    expect(
      getWorkflowRunQuerySchema.safeParse({ include: 'workflow,workflow-version' }).success,
    ).toBe(true);
    expect(getWorkflowRunQuerySchema.safeParse({ include: 'creator' }).success).toBe(false);
    expect(WORKFLOW_RUN_INCLUDE_PERMISSIONS).toEqual({
      workflow: ['workflows:read'],
      'workflow-version': ['workflows:read'],
    });
  });

  it('resumes with or without the unknown-effect acknowledgement (C120.3)', () => {
    expect(resumeWorkflowRunBodySchema.safeParse(undefined).success).toBe(true);
    expect(
      resumeWorkflowRunBodySchema.safeParse({ meta: { 'skip-unknown-effects': true } }).success,
    ).toBe(true);
    expect(resumeWorkflowRunBodySchema.safeParse({ meta: { skip: true } }).success).toBe(false);
  });

  it('cancels the runs of versions older than a named one', () => {
    expect(
      cancelWorkflowRunsBodySchema.safeParse({ meta: { 'before-version-id': WFV } }).success,
    ).toBe(true);
    expect(cancelWorkflowRunsBodySchema.safeParse({ meta: {} }).success).toBe(false);
  });

  it('pages steps by their own ids, with no creation range', () => {
    expect(listWorkflowRunStepsQuerySchema.safeParse({ 'page[after]': WFST }).success).toBe(true);
    expect(
      listWorkflowRunStepsQuerySchema.safeParse({
        'filter[created-at-start]': '2026-10-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});

describe('the step resource (C117.2)', () => {
  const step = {
    id: WFST,
    nodeId: 'run_report',
    iterationPath: 'loop[3]',
    nodeType: 'action' as const,
    actionKey: 'run_report',
    actionVersion: 1,
    status: 'succeeded' as const,
    attempt: 1,
    dueAt: null,
    startedAt: AT,
    completedAt: LATER,
    errorType: null,
    errorCode: null,
    effectStatus: 'done' as const,
    simulated: false,
    overridden: false,
    input: { 'report-template-id': 'rptp_01M5CM00000000000000000003' },
    output: { 'report-id': 'rep_01M5CM00000000000000000012' },
    console: null,
  };

  it('builds with its node, attempt and values', () => {
    const { attributes } = buildWorkflowRunStepResource(step);
    expect(attributes).toMatchObject({ 'node-id': 'run_report', 'iteration-path': 'loop[3]' });
  });

  it('holds a control node with no action', () => {
    const node = {
      ...step,
      nodeType: 'conditional' as const,
      actionKey: null,
      actionVersion: null,
    };
    expect(buildWorkflowRunStepResource(node).attributes['action-key']).toBeNull();
  });

  it('says why a step failed', () => {
    expect(() => buildWorkflowRunStepResource({ ...step, status: 'failed' })).toThrow();
    expect(
      buildWorkflowRunStepResource({
        ...step,
        status: 'failed',
        errorType: 'resource-error',
        errorCode: 'report_errored',
      }).attributes['error-code'],
    ).toBe('report_errored');
  });

  it('keeps text a step produced out of the code columns (C120.2)', () => {
    expect(() =>
      buildWorkflowRunStepResource({ ...step, errorCode: 'name was Jane Example' }),
    ).toThrow();
  });

  it('marks its values PII, and masks them to null', () => {
    const masked = { ...step, input: null, output: null, console: null };
    expect(buildWorkflowRunStepResource(masked).attributes.output).toBeNull();
    for (const member of ['input', 'output', 'console']) {
      expect(PII_WORKFLOW_RUN_ATTRIBUTES).toContain(member);
    }
  });
});

describe('the trigger delivery resource (C118.1)', () => {
  const delivery = {
    id: WFTD,
    workflowId: WFL,
    eventId: IDS.event,
    eventName: 'inquiry.completed' as const,
    workflowRunId: null,
    status: 'refused' as const,
    reasonCode: 'workflow_not_running',
    notBefore: null,
    createdAt: AT,
    updatedAt: LATER,
  };

  it('builds with its reason code and event', () => {
    const resource = buildWorkflowTriggerDeliveryResource(delivery);
    expect(resource.attributes['reason-code']).toBe('workflow_not_running');
    expect(resource.relationships['workflow-run'].data).toBeNull();
  });

  it('filters by workflow and status', () => {
    const query = { 'filter[workflow-id]': WFL, 'filter[status]': 'refused,expired' };
    expect(listWorkflowTriggerDeliveriesQuerySchema.parse(query)).toEqual(query);
    expect(
      listWorkflowTriggerDeliveriesQuerySchema.safeParse({ 'filter[status]': 'created' }).success,
    ).toBe(false);
  });
});

describe('starting a run (C118.2, C118.5, C120.7)', () => {
  it('takes data.attributes.fields alone, as the public route does', () => {
    const body = { data: { attributes: { fields: { reference_id: 'ref-1', count: 2 } } } };
    expect(triggerWorkflowBodySchema.parse(body)).toEqual(body);
    expect(triggerWorkflowBodySchema.safeParse({ meta: { params: {} } }).success).toBe(false);
    expect(
      triggerWorkflowBodySchema.safeParse({
        data: { attributes: { fields: {}, reference_id: 'ref-1' } },
      }).success,
    ).toBe(false);
  });

  it('reads a file value as a filename and base64 data, and marks both PII', () => {
    expect(
      workflowTriggerFileValueSchema.safeParse({ filename: 'a.pdf', data: 'JVBERi0=' }).success,
    ).toBe(true);
    expect(
      workflowTriggerFileValueSchema.safeParse({ filename: 'a.pdf', data: 'not base64!' }).success,
    ).toBe(false);
    expect(workflowTriggerFileValueSchema.safeParse({ data: 'JVBERi0=' }).success).toBe(false);
    expect(workflowTriggerFileValueSchema.shape.data.meta()).toEqual({ pii: true });
    expect(PII_WORKFLOW_RUN_ATTRIBUTES).toContain('filename');
    expect(PII_WORKFLOW_RUN_ATTRIBUTES).not.toContain('data');
  });

  it('takes object ids or a CSV of ids, never both and never neither', () => {
    const body = (attributes: object) =>
      createWorkflowManualRunsBodySchema.safeParse({ data: { attributes } }).success;
    expect(body({ 'object-ids': [IDS.inquiry] })).toBe(true);
    expect(body({ csv: 'id\ninq_x\n' })).toBe(true);
    expect(body({})).toBe(false);
    expect(body({ 'object-ids': [IDS.inquiry], csv: 'id\n' })).toBe(false);
  });

  it('holds a manual run to 1,000 objects', () => {
    const ids = (count: number) => Array.from({ length: count }, () => IDS.inquiry);
    const parse = (count: number) =>
      createWorkflowManualRunsBodySchema.safeParse({
        data: { attributes: { 'object-ids': ids(count) } },
      }).success;
    expect(parse(1000)).toBe(true);
    expect(parse(1001)).toBe(false);
  });

  it('starts a test run from an object or a synthetic payload, never both (C120.7)', () => {
    const body = (attributes: object, meta?: object) =>
      createWorkflowTestRunBodySchema.safeParse({
        data: { attributes },
        ...(meta === undefined ? {} : { meta }),
      }).success;
    expect(body({ 'object-id': IDS.inquiry })).toBe(true);
    expect(body({ 'trigger-payload': { data: {} }, 'workflow-version-id': WFV })).toBe(true);
    expect(body({})).toBe(false);
    expect(body({ 'object-id': IDS.inquiry, 'trigger-payload': {} })).toBe(false);
    expect(
      body(
        {
          'object-id': IDS.inquiry,
          'start-step': 'a',
          'end-step': 'b',
          overrides: { run_report: { 'has-match': false } },
          'allow-hosts': ['receiver.example.org'],
          'allow-triggers': true,
        },
        { acknowledgements: ['irreversible:forget'] },
      ),
    ).toBe(true);
    expect(body({ 'object-id': IDS.inquiry }, { acknowledgements: ['forget'] })).toBe(false);
  });

  it('marks the request members C143.5 names', () => {
    expect(PII_WORKFLOW_RUN_ATTRIBUTES).toEqual(
      expect.arrayContaining([
        'fields',
        'trigger-payload',
        'overrides',
        'parameters',
        'object-ids',
        'csv',
      ]),
    );
  });
});

describe('the event meta (C112.7)', () => {
  it('is an empty context on a created run, as the public one is', () => {
    expect(workflowRunEventMetaSchema.parse({ context: {} })).toEqual({ context: {} });
    expect(workflowRunEventMetaSchema.safeParse({}).success).toBe(false);
  });

  it('names outputs and never holds a value', () => {
    expect(
      workflowRunEventMetaSchema.safeParse({ context: { 'output-names': ['decision'] } }).success,
    ).toBe(true);
    expect(
      workflowRunEventMetaSchema.safeParse({ context: { outputs: { decision: 'decline' } } })
        .success,
    ).toBe(false);
  });

  it('names the error of an errored run, with a null step for a whole-run failure', () => {
    const context = { 'errored-step': STEP, error: FAILURE };
    expect(workflowRunErroredEventMetaSchema.parse({ context })).toEqual({ context });
    expect(
      workflowRunErroredEventMetaSchema.safeParse({
        context: { 'errored-step': null, error: FAILURE },
      }).success,
    ).toBe(true);
    expect(workflowRunErroredEventMetaSchema.safeParse({ context: {} }).success).toBe(false);
  });
});
