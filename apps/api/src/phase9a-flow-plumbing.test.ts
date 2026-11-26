/**
 * Workflow 9A Stage 1b, checkpoint (S): what `foundation-9a` builds in the API for the server flow
 * engine, each hook a call in a shared file to a stub in an owned file (plan, Stage 1b (S)):
 *
 * - the v2-safe stored-flow reader every caller of `storedFlow` moved to, so a v2 flow no longer
 *   fails a signal computation (a test through the `inquiry-signals` job) or a verification;
 * - the hooks at their call sites: `assertCurrentStepInTx` and `advanceFlowInTx` on consent and on a
 *   verification's creation, `flowActionGrantProblems` on publish (review F17's contract test),
 *   `flowActionCopyTargets` read by the inquiry's redaction into its audit entry before the rows go;
 * - the frozen routes (the screen submission and the selfie-capture extension) answering 501;
 * - the initial fields kept at creation (C149.4), and the screen's `values` masked in stored API logs;
 * - each stub preserving today's behaviour.
 *
 * Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import {
  defaultInquiryTemplateAttributes,
  PII_MASKED_ATTRIBUTES,
  type DefaultInquiryTemplateAttributes,
} from '@openverify/contracts';
import { getInquiry, getInquiryInitialFields } from '@openverify/db';
import { flowV2Schema, type Flow } from '@openverify/flow-spec';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as advance from './flow-engine/advance.js';
import * as currentStep from './flow-engine/current-step.js';
import { requiredVerificationsForInquiry } from './flow-engine/required.js';
import * as copies from './flow-actions/copies.js';
import * as grants from './flow-actions/grants.js';
import { runFlowActionInTx } from './flow-actions/run-action.js';
import { flowRunKeyOf } from './flow-actions/run.js';
import { ConflictError } from './errors.js';
import { createCapturingLogger, createMemoryStorage } from './jobs/testing.js';
import { createRedactionService } from './services/redaction.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from './test-support/fakes.js';
import { requiredVerifications } from './jobs/inquiry-outcome.js';
import { processInquirySignals } from './jobs/signals/process.js';
import { MASKED_ATTRIBUTES } from './auth/pii.js';
import { createInquiryTestApi, type InquiryTestApi } from './services/inquiries.test-support.js';
import { safeStoredFlowView, storedAnyFlow, storedFlowView } from './services/stored-flow.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  openFlowSession,
} from './test-support/harness.js';

vi.mock('./flow-engine/advance.js', { spy: true });
vi.mock('./flow-engine/current-step.js', { spy: true });
vi.mock('./flow-actions/grants.js', { spy: true });
vi.mock('./flow-actions/copies.js', { spy: true });

const V2_FLOW: unknown = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/flows/v2/every-step.json', import.meta.url),
    'utf8',
  ),
);

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

const V1_TYPES = new Set([
  'consent',
  'government_id',
  'selfie',
  'document',
  'phone_otp',
  'email_otp',
  'database',
  'aamva',
  'nfc',
  'crypto_wallet',
  'database_business',
  'business_website',
  'completion',
  'failure',
  'device_handoff',
]);

describe('the stored-flow reader (plan outcome 10; inventory 3)', () => {
  it('reads a v1 flow as it is stored', () => {
    const { flow } = defaultInquiryTemplateAttributes();
    expect(storedFlowView(flow)).toEqual(flow);
    expect(storedAnyFlow(flow)).toEqual(flow);
  });

  it('gives a v1 consumer the v2 steps of v1 types, without the additive members, screens, branches or actions', () => {
    const stored = flowV2Schema.parse(V2_FLOW);
    expect(storedAnyFlow(V2_FLOW)).toEqual(stored);
    const view = storedFlowView(V2_FLOW);
    expect(view.metadata).toEqual({ ...stored.metadata, specVersion: 1 });
    expect(view.transitions).toEqual([]);
    const expected = stored.steps.filter((step) => V1_TYPES.has(step.type));
    expect(view.steps.map((step) => step.id)).toEqual(expected.map((step) => step.id));
    for (const step of view.steps) {
      for (const member of [
        'captureMethodsByDevice',
        'onFallback',
        'prefillFrom',
        'decisionBasis',
        'contestRoute',
        'biometricBasis',
      ]) {
        expect(step, `${step.id}.${member}`).not.toHaveProperty(member);
      }
    }
    expect(stored.steps.some((step) => !V1_TYPES.has(step.type))).toBe(true);
  });

  it('answers null for a stored document that is no flow of either version', () => {
    expect(safeStoredFlowView({ metadata: { specVersion: 3 } })).toBeNull();
    expect(safeStoredFlowView(undefined)).toBeNull();
    expect(safeStoredFlowView(V2_FLOW)).not.toBeNull();
  });

  it('lets the inquiry-signals job compute the signals of an inquiry pinned to a v2 flow', async () => {
    const inquiryId = await createInquiry(api);
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/perform-simulate-actions`,
        headers: bearer(api.token),
        payload: { meta: { actions: [{ type: 'expire_inquiry' }] } },
      }),
      200,
    );
    // A v2 version is stored only once `api-templates` builds v2 drafts; the reader must not wait.
    await api.database.client.query(
      `update inquiry_template_versions set flow = $1
        where id = (select inquiry_template_version_id from inquiries where id = $2)`,
      [JSON.stringify(V2_FLOW), inquiryId],
    );
    const result = await processInquirySignals(
      { environmentId: api.environmentId, inquiryId },
      {
        db: api.database.db,
        clock: api.clock,
        logger: createCapturingLogger(),
        events: api.events,
        keyring: api.database.keyring,
      },
    );
    expect(result.outcome).toBe('computed');
    expect(
      (await getInquiry(api.database.db, api.environmentId, inquiryId))?.signals,
    ).not.toBeNull();
  });
});

const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

describe('the flow engine hooks at their call sites (C151.2, C151.4)', () => {
  it('asks for the current step and advances on consent, under the inquiry lock', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(sessionToken),
        payload: CONSENT_BODY,
      }),
      201,
    );
    const ref = { environmentId: api.environmentId, inquiryId };
    expect(currentStep.assertCurrentStepInTx).toHaveBeenCalledWith(expect.anything(), ref, {
      kind: 'consent',
      stepId: 'consent',
    });
    expect(advance.advanceFlowInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ref,
      {
        kind: 'consent-recorded',
        sessionId: expect.stringMatching(/^iqse_/) as unknown,
      },
    );
  });

  it('refuses a consent the current step does not take, and records nothing', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    vi.mocked(currentStep.assertCurrentStepInTx).mockRejectedValueOnce(
      new ConflictError('The flow is not on this step.'),
    );
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: bearer(sessionToken),
      payload: CONSENT_BODY,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(advance.advanceFlowInTx).not.toHaveBeenCalled();
    const { rows } = await api.database.client.query(
      'select consent from inquiry_sessions where inquiry_id = $1 and consent is not null',
      [inquiryId],
    );
    expect(rows).toEqual([]);
  });

  it('asks for the current step before a verification is created', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(sessionToken),
        payload: CONSENT_BODY,
      }),
      201,
    );
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/verifications',
        headers: bearer(sessionToken),
        payload: { type: 'government-id', country: 'US', 'id-class': 'drivers_license' },
      }),
      201,
    );
    expect(currentStep.assertCurrentStepInTx).toHaveBeenCalledWith(
      expect.anything(),
      { environmentId: api.environmentId, inquiryId },
      {
        kind: 'verification',
        stepId: expect.any(String) as unknown,
        verificationType: 'government_id',
      },
    );
  });
});

describe("publish asks for the flow actions' grants (C152.2; review F17)", () => {
  it('refuses a template whose run_workflow grant the publisher lacks, at its pointer', async () => {
    vi.mocked(grants.flowActionGrantProblems).mockResolvedValueOnce([
      {
        code: 'workflow_grant_missing',
        pointer: '/flow/steps/2/action/workflowId',
        detail: 'The publisher does not hold the workflow’s grant.',
      },
    ]);
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(api.token),
      payload: {
        data: { type: 'inquiry-template', attributes: defaultInquiryTemplateAttributes() },
      },
    });
    expect(response.statusCode, response.body).toBe(422);
    expect(JSON.stringify(response.json())).toContain(
      '/data/attributes/flow/steps/2/action/workflowId',
    );
    expect(grants.flowActionGrantProblems).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: api.environmentId,
        publisher: expect.anything() as unknown,
      }),
    );
  });

  it('publishes as before when the grants hold', async () => {
    const attributes: DefaultInquiryTemplateAttributes = defaultInquiryTemplateAttributes();
    await createTemplate(api, api.token, attributes);
    expect(grants.flowActionGrantProblems).toHaveBeenCalledTimes(1);
  });
});

describe("the inquiry's redaction reads the flow actions' copy targets first (C152.8; V08)", () => {
  it('names the accounts in its result and audit entry, read before the rows are deleted', async () => {
    const inquiryId = await createInquiry(api);
    const accountId = 'acc_01M5CJXHG07XPHF3HRM6NREDH8';
    const audit = createRecordingAuditLogger();
    const service = createRedactionService({
      db: api.database.db,
      storage: createMemoryStorage(),
      events: createRecordingEventPublisher(),
      clock: fixedClock(),
      audit,
    });
    vi.mocked(copies.flowActionCopyTargets).mockImplementationOnce(async (tx, inquiry) => {
      // Read in the redaction's own transaction, before the inquiry's records are redacted.
      const before = await getInquiry(tx, inquiry.environmentId, inquiry.inquiryId);
      expect(before?.redactedAt).toBeNull();
      return [{ accountId, keys: ['phone'], stepId: 'copy_phone', entry: 1 }];
    });
    const ctx = { environmentId: api.environmentId, organizationId: api.organizationId };
    const actor = { type: 'api-key' as const, id: 'key_01M5CJXHG07XPHF3HRM6NREDH8' };
    const result = await service.redactInquiry(ctx, inquiryId, actor);
    expect(result.flowCopyTargets).toEqual([{ accountId, keys: ['phone'] }]);
    expect(copies.flowActionCopyTargets).toHaveBeenCalledWith(expect.anything(), {
      environmentId: api.environmentId,
      inquiryId,
    });
    expect(audit.withAction('inquiry.redacted')[0]?.metadata).toMatchObject({
      'flow-copy-account-ids': [accountId],
    });
    // Without copies, the result and the entry carry nothing new.
    const plain = await service.redactInquiry(ctx, await createInquiry(api), actor);
    expect(plain).not.toHaveProperty('flowCopyTargets');
  });
});

describe('the routes frozen at (S) (C148.5, C171.4)', () => {
  // api-flow-engine built both routes (8d42b87f, and the screen submission); its own suites hold
  // them now (routes/flow/screens.test.ts, routes/flow/selfie-capture-extend.test.ts).
  it('needs a session token on both', async () => {
    for (const url of [
      '/api/v1/flow/screens/details/submit',
      '/api/v1/flow/selfie-captures/self_01M5CJXHG07XPHF3HRM6NREDH9/extend',
    ]) {
      const response = await api.app.inject({ method: 'POST', url, payload: { values: {} } });
      expect(response.statusCode, url).toBe(401);
    }
  });
});

describe('initial fields and masking (C149.4, C174.5)', () => {
  it('keeps the fields an inquiry is created with as its initial fields', async () => {
    const fields = { name_first: 'Alexis', name_last: 'Example' };
    const inquiryId = await createInquiry(api, { fields });
    expect(await getInquiryInitialFields(api.database.db, api.environmentId, inquiryId)).toEqual(
      fields,
    );
    const without = await createInquiry(api);
    expect(await getInquiryInitialFields(api.database.db, api.environmentId, without)).toBeNull();
  });

  it("masks a screen submission's values and the initial fields wherever a log keeps them", () => {
    expect(PII_MASKED_ATTRIBUTES).toEqual(expect.arrayContaining(['values', 'initial-fields']));
    expect(MASKED_ATTRIBUTES).toEqual(expect.arrayContaining(['values', 'initial-fields']));
  });
});

describe("the stubs keep today's behaviour until their owners build them", () => {
  it('requires every verification step of the flow, as today', async () => {
    const flow: Flow = defaultInquiryTemplateAttributes().flow;
    const inquiry = {
      id: 'inq_x',
      environmentId: api.environmentId,
      inquiryTemplateVersionId: 'v',
    };
    expect(await requiredVerificationsForInquiry(api.database.db, inquiry, flow)).toEqual(
      requiredVerifications(flow),
    );
  });

  // comparisonSourceFor is built (api-flow-engine); flow-engine/initial-fields.test.ts holds it.
  it('moves nothing and accepts everything', async () => {
    vi.mocked(currentStep.assertCurrentStepInTx).mockReset();
    const ref = { environmentId: api.environmentId, inquiryId: 'inq_x' };
    expect(
      await advance.advanceFlowInTx(api.database.db, api, ref, {
        kind: 'wait-elapsed',
        stepRecordSeq: 1,
      }),
    ).toEqual({ staged: [], after: [] });
    await expect(advance.runFlowAfterCommit(advance.NO_FLOW_ADVANCE)).resolves.toBeUndefined();
    await expect(
      currentStep.assertCurrentStepInTx(api.database.db, ref, { kind: 'screen', stepId: 's' }),
    ).resolves.toBeUndefined();
  });

  it('touches no inquiry it cannot read, and keys a run per inquiry, step and entry', async () => {
    // api-flow-actions built the actions (its tests are in flow-actions/): an inquiry that is not
    // there takes the error port and nothing is written.
    const outcome = await runFlowActionInTx(
      api.database.db,
      api,
      { environmentId: api.environmentId, inquiryId: 'inq_01M5CK16P0D13FXHZSS4TCFBVH' },
      {
        stepId: 'tag',
        entry: 1,
        action: { kind: 'tag_inquiry', add: ['vip'], remove: [] },
      },
    );
    expect(outcome).toMatchObject({ state: 'done', port: 'error' });
    expect(flowRunKeyOf({ inquiryId: 'inq_1', stepId: 'run_check', entry: 2 })).toBe(
      'inquiry-flow:inq_1:run_check:2',
    );
  });
});
