/**
 * C150 on the server, C151.2-C151.4, C151.14 (Workflow 9A, api-flow-engine, checkpoint "engine"):
 * the server decides every step. The position starts at `entry`; each exit (consent recorded, a
 * verification decided) advances in the transaction that records it, through `nextPosition` over
 * the scope assembled from the inquiry; only the current step accepts input; the verifications
 * required are those on the path taken; the inquiry completes, goes to review or fails by
 * `flowOutcome`. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { EXTRACTION_FIELDS, type ExtractedFields } from '@openverify/core';
import {
  getInquiry,
  listInquiryFlowSteps,
  listInquirySessions,
  lockInquiry,
  recordInquirySessionConsent,
  setInquiryHandoffStepState,
  type Db,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceFlowInTx, runFlowAfterCommit, type FlowAdvance, type FlowExit } from './advance.js';
import { assertCurrentStepInTx } from './current-step.js';
import { positionFlowInTx } from './position.js';
import { requiredVerificationsForInquiry } from './required.js';
import { storedFlowView } from '../services/stored-flow.js';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  resumeInquiry,
  seedVerification,
  type SeedCheck,
} from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const consent = { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true };
const idCard = (extra: Record<string, unknown> = {}) => ({
  id: 'id_card',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['camera'],
  ...extra,
});
const done = { id: 'done', type: 'completion' };
const refused = { id: 'refused', type: 'failure' };
const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

function v2(name: string, steps: unknown[], edges: unknown[]): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: name, version: 1, name },
    entry: 'consent',
    steps,
    edges,
  });
}

/** consent -> id_card -> done. */
const LINEAR = v2(
  'linear',
  [consent, idCard(), done],
  [edge('e1', 'consent', 'next', 'id_card'), edge('e2', 'id_card', 'next', 'done')],
);

/** consent -> id_card (exhausted -> proof) -> done. */
const FALLBACK = v2(
  'fallback',
  [
    consent,
    idCard({ maxAttempts: 1 }),
    { id: 'proof', type: 'document', documentTypes: ['utility_bill'], captureMethods: ['upload'] },
    done,
  ],
  [
    edge('e1', 'consent', 'next', 'id_card'),
    edge('e2', 'id_card', 'next', 'done'),
    edge('e3', 'id_card', 'exhausted', 'proof'),
    edge('e4', 'proof', 'next', 'done'),
  ],
);

/** A branch after the ID: a route on a value, then `else`. */
function branchFlow(name: string, route: Record<string, unknown>, minorTo = 'refused'): FlowV2 {
  return v2(
    name,
    [
      consent,
      idCard(),
      { id: 'route', type: 'branch', routes: [{ key: 'minor', label: 'Route', ...route }] },
      done,
      refused,
    ],
    [
      edge('e1', 'consent', 'next', 'id_card'),
      edge('e2', 'id_card', 'next', 'route'),
      edge('e3', 'route', 'route:minor', minorTo),
      edge('e4', 'route', 'else', 'done'),
    ],
  );
}

async function v2Inquiry(flow: FlowV2): Promise<string> {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, { flow });
  return inquiry.id;
}

const ref = (inquiryId: string) => ({ environmentId: api.environmentId, inquiryId });

/** Runs `work` in a transaction holding the inquiry's lock, then dispatches what it staged. */
async function underLock(
  inquiryId: string,
  work: (tx: Db) => Promise<FlowAdvance>,
): Promise<FlowAdvance> {
  const advance = await api.database.db.transaction(async (tx) => {
    await lockInquiry(tx, api.environmentId, inquiryId);
    return work(tx);
  });
  await api.deps.events.dispatch(advance.staged);
  await runFlowAfterCommit(advance);
  return advance;
}

const start = (inquiryId: string) =>
  underLock(inquiryId, (tx) => positionFlowInTx(tx, api.deps, ref(inquiryId)));
const exit = (inquiryId: string, flowExit: FlowExit) =>
  underLock(inquiryId, (tx) => advanceFlowInTx(tx, api.deps, ref(inquiryId), flowExit));

const consentRecorded = (inquiryId: string) =>
  exit(inquiryId, { kind: 'consent-recorded', sessionId: 'iqse_none' });

async function decide(
  inquiryId: string,
  status: 'passed' | 'failed' | 'needs_review',
  options: { type?: 'government_id' | 'document'; checks?: SeedCheck[]; birthdate?: string } = {},
): Promise<string> {
  const type = options.type ?? 'government_id';
  const fields = Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, null]));
  const { id } = await seedVerification(api, api.environmentId, inquiryId, {
    type,
    status,
    checks: options.checks ?? [],
    ...(options.birthdate === undefined
      ? {}
      : {
          extraction: {
            fields: { ...fields, birthdate: options.birthdate } as ExtractedFields,
            sources: {},
          },
        }),
  });
  await exit(inquiryId, {
    kind: 'verification-decided',
    verificationId: id,
    verificationType: type,
    status,
    origin: 'flow',
  });
  return id;
}

async function inquiryOf(inquiryId: string) {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  if (inquiry === null) throw new Error('no inquiry');
  return inquiry;
}

const record = async (inquiryId: string) =>
  (await listInquiryFlowSteps(api.database.db, api.environmentId, inquiryId)).map((entry) => ({
    stepId: entry.stepId,
    exitPort: entry.exitPort,
    notes: entry.notes,
  }));

describe('advancing (C151.2)', () => {
  it('starts at entry and moves on each exit, recording every step, until the completion', async () => {
    const inquiryId = await v2Inquiry(LINEAR);
    await start(inquiryId);
    expect(await inquiryOf(inquiryId)).toMatchObject({
      flowStepId: 'consent',
      flowState: 'active',
      flowPreviousStepId: null,
      flowSpecVersion: 2,
    });
    await consentRecorded(inquiryId);
    expect(await inquiryOf(inquiryId)).toMatchObject({
      flowStepId: 'id_card',
      flowPreviousStepId: 'consent',
    });
    await decide(inquiryId, 'passed');
    expect(await inquiryOf(inquiryId)).toMatchObject({
      flowStepId: 'done',
      flowState: 'ended',
      flowPreviousStepId: 'id_card',
      status: 'completed',
      flowOutcome: { verificationTypesOnPath: ['government-id'], fallbacksTaken: [], flags: [] },
    });
    expect(await record(inquiryId)).toEqual([
      { stepId: 'consent', exitPort: 'next', notes: [] },
      { stepId: 'id_card', exitPort: 'next', notes: [] },
      { stepId: 'done', exitPort: null, notes: [] },
    ]);
  });

  it('stays on a verification step after a failed attempt with attempts left', async () => {
    const inquiryId = await v2Inquiry(LINEAR);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    await decide(inquiryId, 'failed', {
      checks: [{ name: 'id_blur_detection', status: 'failed', type: 'user_behavior' }],
    });
    expect(await inquiryOf(inquiryId)).toMatchObject({
      flowStepId: 'id_card',
      flowState: 'active',
      status: 'pending',
    });
  });

  it('fails the inquiry when a verification ends without passing and has no exhausted edge', async () => {
    const inquiryId = await v2Inquiry(LINEAR);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    await decide(inquiryId, 'failed', {
      checks: [{ name: 'id_blur_detection', status: 'failed', type: 'fraud' }],
    });
    expect(await inquiryOf(inquiryId)).toMatchObject({
      flowStepId: 'id_card',
      flowState: 'ended',
      status: 'failed',
    });
  });

  it('takes the exhausted port to the fallback, keeps the failure failed, and sends the inquiry to review', async () => {
    const inquiryId = await v2Inquiry(FALLBACK);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    await decide(inquiryId, 'failed', {
      checks: [{ name: 'id_blur_detection', status: 'failed', type: 'user_behavior' }],
    });
    expect(await inquiryOf(inquiryId)).toMatchObject({ flowStepId: 'proof', status: 'pending' });
    await decide(inquiryId, 'passed', { type: 'document' });
    const inquiry = await inquiryOf(inquiryId);
    expect(inquiry).toMatchObject({
      status: 'needs_review',
      flowOutcome: {
        verificationTypesOnPath: ['government-id', 'document'],
        fallbacksTaken: ['id_card'],
      },
    });
    expect((await record(inquiryId)).map((entry) => entry.exitPort)).toEqual([
      'next',
      'exhausted',
      'next',
      null,
    ]);
  });

  it('ends in review through completed, so the completion writes its signals, list screening and graph rows', async () => {
    const inquiryId = await v2Inquiry(FALLBACK);
    // C99.4: the version screens a named list, so the completion writes the screening's row.
    await api.database.db.execute(
      sql`update inquiry_template_versions set list_config = ${JSON.stringify({
        screen: [newId('lst')],
      })}::jsonb where id = (select inquiry_template_version_id from inquiries where id = ${inquiryId})`,
    );
    await start(inquiryId);
    await consentRecorded(inquiryId);
    await decide(inquiryId, 'failed', {
      checks: [{ name: 'id_blur_detection', status: 'failed', type: 'user_behavior' }],
    });
    await decide(inquiryId, 'passed', { type: 'document' });
    expect((await inquiryOf(inquiryId)).status).toBe('needs_review');
    const triggers = async (table: string) =>
      (
        await api.database.db.execute(
          sql`select trigger_status from ${sql.identifier(table)} where inquiry_id = ${inquiryId}`,
        )
      ).rows.map((row) => (row as { trigger_status: string }).trigger_status);
    expect(await triggers('inquiry_signal_computations')).toEqual(['completed']);
    expect(await triggers('list_screenings')).toEqual(['completed']);
    expect(await triggers('graph_index_jobs')).toEqual(['completed']);
    expect(api.events.named('inquiry.completed').map((event) => event.payload.data)).toContainEqual(
      expect.objectContaining({ id: inquiryId }),
    );
  });

  it('routes on an extracted value and fails the person at a failure step', async () => {
    const flow = branchFlow('age', {
      condition: { '<': [{ var: 'verifications.id_card.age-years' }, 18] },
      onNull: 'else',
    });
    const minor = await v2Inquiry(flow);
    await start(minor);
    await consentRecorded(minor);
    await decide(minor, 'passed', { birthdate: '2015-01-01' });
    expect(await inquiryOf(minor)).toMatchObject({
      flowStepId: 'refused',
      flowPreviousStepId: 'id_card',
      status: 'failed',
    });
    expect((await record(minor)).map((entry) => [entry.stepId, entry.exitPort])).toEqual([
      ['consent', 'next'],
      ['id_card', 'next'],
      ['route', 'route:minor'],
      ['refused', null],
    ]);

    const adult = await v2Inquiry(flow);
    await start(adult);
    await consentRecorded(adult);
    await decide(adult, 'passed', { birthdate: '1980-01-01' });
    expect(await inquiryOf(adult)).toMatchObject({ flowStepId: 'done', status: 'completed' });
  });

  it('never reads an errored check as not failed (H03): the onNull route is taken, and review flagged', async () => {
    const flow = branchFlow(
      'h03',
      {
        condition: {
          '!==': [{ var: 'verifications.id_card.checks.id_blur_detection.status' }, 'failed'],
        },
        onNull: 'review',
      },
      'done',
    );
    for (const reason of ['provider_not_configured', 'execution_error', 'vision_unavailable']) {
      const inquiryId = await v2Inquiry(flow);
      await start(inquiryId);
      await consentRecorded(inquiryId);
      await decide(inquiryId, 'passed', {
        checks: [
          {
            name: 'id_blur_detection',
            status: 'not_applicable',
            requirement: 'not_required',
            reasons: [reason],
          },
        ],
      });
      const entries = await record(inquiryId);
      expect(entries[2], reason).toMatchObject({ stepId: 'route', exitPort: 'else' });
      expect(entries[2]?.notes, reason).toContain('on-null-review');
      expect((await inquiryOf(inquiryId)).status, reason).toBe('needs_review');
    }
  });

  it('sends the inquiry to review when a route reads a path the scope no longer has', async () => {
    const inquiryId = await v2Inquiry(
      branchFlow('missing', {
        condition: { '===': [{ var: 'signals.inquiry/retired_signal' }, true] },
        onNull: 'else',
      }),
    );
    await start(inquiryId);
    await consentRecorded(inquiryId);
    await decide(inquiryId, 'passed');
    const inquiry = await inquiryOf(inquiryId);
    expect(inquiry).toMatchObject({ flowState: 'ended', status: 'needs_review' });
    expect((await record(inquiryId)).at(-1)).toMatchObject({
      stepId: 'route',
      notes: ['scope_path_missing'],
    });
  });

  it('ignores a decision of a verification the flow did not create (Phase 8 sandbox action)', async () => {
    const inquiryId = await v2Inquiry(LINEAR);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    const { id } = await seedVerification(api, api.environmentId, inquiryId, {
      type: 'government_id',
      status: 'passed',
    });
    await exit(inquiryId, {
      kind: 'verification-decided',
      verificationId: id,
      verificationType: 'government_id',
      status: 'passed',
      origin: 'workflow-action',
    });
    expect(await inquiryOf(inquiryId)).toMatchObject({ flowStepId: 'id_card', status: 'pending' });
  });

  it('never moves or settles a redacted inquiry, which still expires', async () => {
    const inquiryId = await v2Inquiry(LINEAR);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    await api.database.db.execute(
      sql`update inquiries set redacted_at = now() where id = ${inquiryId}`,
    );
    await decide(inquiryId, 'passed');
    expect((await inquiryOf(inquiryId)).status).toBe('pending');
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/expire`,
        headers: bearer(api.token),
      }),
      200,
    );
    expect((await inquiryOf(inquiryId)).status).toBe('expired');
  });
});

describe('the scope (C150.2)', () => {
  it('reads Phase 7’s handoff state of the flow’s handoff step in session.handoff.state', async () => {
    const flow = v2(
      'handoff',
      [
        consent,
        { id: 'phone', type: 'device_handoff' },
        {
          id: 'route',
          type: 'branch',
          routes: [
            {
              key: 'here',
              label: 'Here',
              condition: { '===': [{ var: 'session.handoff.state' }, 'continued_here'] },
              onNull: 'else',
            },
          ],
        },
        done,
        refused,
      ],
      [
        edge('e1', 'consent', 'next', 'phone'),
        edge('e2', 'phone', 'next', 'route'),
        edge('e3', 'route', 'route:here', 'refused'),
        edge('e4', 'route', 'else', 'done'),
      ],
    );
    const inquiryId = await v2Inquiry(flow);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    await api.database.db.transaction((tx) =>
      setInquiryHandoffStepState(tx, api.environmentId, {
        inquiryId,
        stepId: 'phone',
        state: 'continued_here',
        at: api.clock.now(),
      }),
    );
    await exit(inquiryId, { kind: 'handoff-resolved', resolution: 'continued-here' });
    expect((await record(inquiryId)).map((entry) => [entry.stepId, entry.exitPort])).toEqual([
      ['consent', 'next'],
      ['phone', 'next'],
      ['route', 'route:here'],
      ['refused', null],
    ]);
  });
});

describe('the caps (C151.2)', () => {
  it('halts the flow with flow_loop_limit on the 21st entry of one step, and takes no input then', async () => {
    const flow = v2(
      'loop',
      [
        consent,
        {
          id: 'again',
          type: 'screen',
          components: [
            { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
            { id: 'redo', kind: 'button', labelKey: 'again.redo', action: 'submit', port: 'redo' },
          ],
        },
        done,
      ],
      [
        edge('e1', 'consent', 'next', 'again'),
        edge('e2', 'again', 'next', 'done'),
        edge('e3', 'again', 'button:redo', 'again'),
      ],
    );
    const inquiryId = await v2Inquiry(flow);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    for (let entry = 1; entry <= 20; entry += 1) {
      expect(await inquiryOf(inquiryId), `entry ${String(entry)}`).toMatchObject({
        flowStepId: 'again',
        flowState: 'active',
      });
      await exit(inquiryId, { kind: 'screen-submitted', stepId: 'again', port: 'button:redo' });
    }
    expect(await inquiryOf(inquiryId)).toMatchObject({
      flowState: 'halted',
      status: 'pending',
    });
    expect((await record(inquiryId)).at(-1)?.notes).toContain('flow_loop_limit');
    await expect(
      api.database.db.transaction((tx) =>
        assertCurrentStepInTx(tx, ref(inquiryId), { kind: 'screen', stepId: 'again' }),
      ),
    ).rejects.toMatchObject({ code: 'flow_step_not_current' });
  });
});

describe('a v1 flow, migrated on read (C147.10, C151.14)', () => {
  it('positions a fresh inquiry at its first step and replays an earlier one, noted', async () => {
    const fresh = await createInquiry(api);
    await start(fresh);
    expect(await inquiryOf(fresh)).toMatchObject({ flowStepId: 'consent', flowSpecVersion: 1 });
    expect(await record(fresh)).toEqual([{ stepId: 'consent', exitPort: null, notes: [] }]);

    const earlier = await createInquiry(api);
    const sessionToken = await resumeInquiry(api, earlier);
    // Consent recorded and the ID passed before the engine ever positioned this inquiry.
    const [session] = (
      await listInquirySessions(api.database.db, api.environmentId, { inquiryId: earlier })
    ).items;
    await recordInquirySessionConsent(api.database.db, api.environmentId, session?.id ?? '', {
      acceptedAt: new Date('2026-10-20T12:00:00.000Z'),
      textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
      optionalTextKeys: [],
      locale: 'en',
      ip: '203.0.113.7',
      userAgent: null,
    });
    await seedVerification(api, api.environmentId, earlier, {
      type: 'government_id',
      status: 'passed',
    });
    expect(sessionToken).toMatch(/^ovs_/);
    await start(earlier);
    expect(await inquiryOf(earlier)).toMatchObject({
      flowStepId: 'selfie',
      flowPreviousStepId: 'government_id',
    });
    const entries = await record(earlier);
    expect(entries[0]?.notes).toEqual(['position_backfilled']);
    expect(entries.at(-1)).toMatchObject({ stepId: 'selfie', exitPort: null });
  });
});

describe('only the current step accepts input (C151.4)', () => {
  it('refuses a verification of another step with flow_step_not_current, and accepts the current one', async () => {
    const inquiryId = await createInquiry(api);
    const sessionToken = await resumeInquiry(api, inquiryId);
    const flow = { authorization: `Bearer ${sessionToken}` };
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: flow,
        payload: {
          accepted: true,
          'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
          locale: 'en',
        },
      }),
      201,
    );
    const selfie = await api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/verifications',
      headers: flow,
      payload: { type: 'selfie' },
    });
    expect(selfie.statusCode).toBe(409);
    expect(selfie.json()).toMatchObject({ code: 'flow_step_not_current' });
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/verifications',
        headers: flow,
        payload: { type: 'government-id' },
      }),
      201,
    );
  });

  it('refuses a screen or a handoff the position does not name, and takes a later session consent without a move', async () => {
    const inquiryId = await v2Inquiry(LINEAR);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    const attempt = (kind: 'screen' | 'handoff') =>
      api.database.db.transaction((tx) =>
        assertCurrentStepInTx(
          tx,
          ref(inquiryId),
          kind === 'screen'
            ? { kind: 'screen', stepId: 'id_card' }
            : { kind: 'handoff', action: 'issue' },
        ),
      );
    await expect(attempt('screen')).rejects.toMatchObject({
      status: 409,
      code: 'flow_step_not_current',
    });
    await expect(attempt('handoff')).rejects.toMatchObject({ code: 'flow_step_not_current' });
    // C94.6 (Phase 7): a handed-off session records its own consent; the position does not move.
    await expect(
      api.database.db.transaction((tx) =>
        assertCurrentStepInTx(tx, ref(inquiryId), { kind: 'consent', stepId: 'consent' }),
      ),
    ).resolves.toBeUndefined();
    await consentRecorded(inquiryId);
    expect(await inquiryOf(inquiryId)).toMatchObject({ flowStepId: 'id_card' });
    await expect(
      api.database.db.transaction((tx) =>
        assertCurrentStepInTx(tx, ref(inquiryId), {
          kind: 'verification',
          stepId: 'id_card',
          verificationType: 'government_id',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('the verifications required are those on the path (C151.3)', () => {
  it('answers the verification steps entered, and every step of an inquiry the engine never positioned', async () => {
    const inquiryId = await v2Inquiry(FALLBACK);
    const view = storedFlowView(FALLBACK);
    const required = async () => {
      const inquiry = await inquiryOf(inquiryId);
      return (
        await api.database.db.transaction((tx) =>
          requiredVerificationsForInquiry(tx, inquiry, view),
        )
      ).map((entry) => entry.type);
    };
    expect(await required()).toEqual(['government_id', 'document']);
    await start(inquiryId);
    await consentRecorded(inquiryId);
    expect(await required()).toEqual(['government_id']);
  });
});
