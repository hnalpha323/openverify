/**
 * Workflow 10C Stage 1a (N) (C207.9; `contracts-10c`): the engine's hooks for a client-unable
 * report, each a call to `api-nfc`'s `services/client-unable.ts`, replaced here so this file proves
 * the call sites; the rules themselves are `api-nfc`'s.
 *
 * - `advanceFlowInTx` with the exit `client-unable` asks `clientUnableLeave` how the current `nfc`
 *   step is left and walks the port it names, at once, whatever attempts remain; an answer of
 *   `null`, a step without an `exhausted` edge, or a current step of another type moves nothing.
 * - the settlement (`decideOutcome`) reads the verification outcomes through
 *   `clientUnableStepOutcomes`, which is what sends such an inquiry to review.
 * - `GET /api/v1/flow/session` serves an `nfc` step's view with `fallbackAvailable` from the flow
 *   and whatever `nfcSessionMembers` (`services/flow-views/nfc.ts`) adds.
 */
import { getInquiry, listInquiryFlowSteps, lockInquiry, type Db } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientUnableLeave, clientUnableStepOutcomes } from '../services/client-unable.js';
import { nfcSessionMembers } from '../services/flow-views/nfc.js';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, expectStatus, resumeInquiry } from '../test-support/harness.js';
import { advanceFlowInTx, runFlowAfterCommit, type FlowAdvance, type FlowExit } from './advance.js';
import { positionFlowInTx } from './position.js';

vi.mock('../services/client-unable.js', async (original) => ({
  ...(await original<typeof import('../services/client-unable.js')>()),
  clientUnableLeave: vi.fn(() => null),
  clientUnableStepOutcomes: vi.fn((_record: unknown, outcomes: Record<string, string>) => outcomes),
}));

vi.mock('../services/flow-views/nfc.js', () => ({
  nfcSessionMembers: vi.fn(() => Promise.resolve({})),
}));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  vi.mocked(clientUnableLeave).mockReset().mockReturnValue(null);
  vi.mocked(clientUnableStepOutcomes)
    .mockReset()
    .mockImplementation((_record, outcomes) => outcomes);
  vi.mocked(nfcSessionMembers).mockReset().mockResolvedValue({});
});

const chip = { id: 'chip', type: 'nfc', androidOnly: true };
const idCard = {
  id: 'id_card',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['camera'],
};
const done = { id: 'done', type: 'completion' };
const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

function v2(name: string, entry: string, steps: unknown[], edges: unknown[]): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: name, version: 1, name },
    entry,
    steps,
    edges,
  });
}

/** chip (exhausted -> done) -> done. */
const WITH_FALLBACK = v2(
  'nfc-fallback',
  'chip',
  [chip, done],
  [edge('e1', 'chip', 'next', 'done'), edge('e2', 'chip', 'exhausted', 'done')],
);
/** chip -> done, no fallback. */
const WITHOUT_FALLBACK = v2('nfc-only', 'chip', [chip, done], [edge('e1', 'chip', 'next', 'done')]);
/** id_card -> done: the current step is not an nfc step. */
const NO_CHIP = v2('no-chip', 'id_card', [idCard, done], [edge('e1', 'id_card', 'next', 'done')]);

const ref = (inquiryId: string) => ({ environmentId: api.environmentId, inquiryId });

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

async function positioned(flow: FlowV2): Promise<string> {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, { flow });
  await underLock(inquiry.id, (tx) => positionFlowInTx(tx, api.deps, ref(inquiry.id)));
  return inquiry.id;
}

const UNABLE: FlowExit = {
  kind: 'client-unable',
  verificationId: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
  reason: 'reader_not_installed',
  platform: 'android',
};

const report = (inquiryId: string) =>
  underLock(inquiryId, (tx) => advanceFlowInTx(tx, api.deps, ref(inquiryId), UNABLE));

const recordOf = async (inquiryId: string) =>
  (await listInquiryFlowSteps(api.database.db, api.environmentId, inquiryId)).map((entry) => ({
    stepId: entry.stepId,
    exitPort: entry.exitPort,
    outcome: entry.outcome,
    notes: entry.notes,
  }));

const NOTES = ['client-unable', 'client-unable-reason:reader_not_installed'];

describe('the client-unable exit (C207.9)', () => {
  it('asks clientUnableLeave with the step, its fallback, the acknowledgements, the reason and the platform', async () => {
    const inquiryId = await positioned(WITH_FALLBACK);

    await report(inquiryId);

    expect(vi.mocked(clientUnableLeave).mock.calls).toEqual([
      [
        {
          stepId: 'chip',
          onFallback: null,
          hasExhaustedEdge: true,
          acknowledgements: [],
          reason: 'reader_not_installed',
          platform: 'android',
        },
      ],
    ]);
  });

  it('moves nothing while the hook answers null', async () => {
    const inquiryId = await positioned(WITH_FALLBACK);

    await report(inquiryId);

    expect(await recordOf(inquiryId)).toEqual([
      { stepId: 'chip', exitPort: null, outcome: null, notes: [] },
    ]);
  });

  it('leaves the nfc step at once through the port, outcome and notes the hook names', async () => {
    vi.mocked(clientUnableLeave).mockReturnValue({
      port: 'exhausted',
      outcome: 'client_unable',
      notes: NOTES,
    });
    const inquiryId = await positioned(WITH_FALLBACK);

    await report(inquiryId);

    expect(await recordOf(inquiryId)).toEqual([
      { stepId: 'chip', exitPort: 'exhausted', outcome: 'client_unable', notes: NOTES },
      { stepId: 'done', exitPort: null, outcome: null, notes: [] },
    ]);
  });

  it('moves nothing from an nfc step without an exhausted edge, whatever the hook answers', async () => {
    vi.mocked(clientUnableLeave).mockReturnValue({
      port: 'exhausted',
      outcome: 'client_unable',
      notes: NOTES,
    });
    const inquiryId = await positioned(WITHOUT_FALLBACK);

    await report(inquiryId);

    expect(vi.mocked(clientUnableLeave).mock.calls[0]?.[0]).toMatchObject({
      hasExhaustedEdge: false,
    });
    expect(await recordOf(inquiryId)).toEqual([
      { stepId: 'chip', exitPort: null, outcome: null, notes: [] },
    ]);
  });

  it('never asks the hook at a step of another type', async () => {
    const inquiryId = await positioned(NO_CHIP);

    await report(inquiryId);

    expect(clientUnableLeave).not.toHaveBeenCalled();
    expect((await recordOf(inquiryId)).map((entry) => entry.exitPort)).toEqual([null]);
  });
});

describe('the settlement after a client-unable exit (C207.9)', () => {
  const leave = (notes: string[]) =>
    vi.mocked(clientUnableLeave).mockReturnValue({
      port: 'exhausted',
      outcome: 'client_unable',
      notes,
    });
  const statusOf = async (inquiryId: string) =>
    (await getInquiry(api.database.db, api.environmentId, inquiryId))?.status;

  it('reads the step outcomes through clientUnableStepOutcomes, with the step record', async () => {
    leave(NOTES);
    const inquiryId = await positioned(WITH_FALLBACK);

    await report(inquiryId);

    const calls = vi.mocked(clientUnableStepOutcomes).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [record] = calls.at(-1) ?? [];
    expect(record?.map((entry) => [entry.stepId, entry.exitPort, entry.notes])).toEqual([
      ['chip', 'exhausted', NOTES],
      ['done', null, []],
    ]);
  });

  it('sends the inquiry to review once the hook reads the step as decided without passing', async () => {
    leave(NOTES);
    vi.mocked(clientUnableStepOutcomes).mockImplementation((_record, outcomes) => ({
      ...outcomes,
      chip: 'failed',
    }));
    const inquiryId = await positioned(WITH_FALLBACK);
    await api.database.db.transaction((tx) => startPending(tx, inquiryId));

    await report(inquiryId);

    expect(await statusOf(inquiryId)).toBe('needs_review');
  });

  it('completes it only when the exit carries fallback-continue', async () => {
    leave([...NOTES, 'fallback-continue']);
    vi.mocked(clientUnableStepOutcomes).mockImplementation((_record, outcomes) => ({
      ...outcomes,
      chip: 'failed',
    }));
    const inquiryId = await positioned(WITH_FALLBACK);
    await api.database.db.transaction((tx) => startPending(tx, inquiryId));

    await report(inquiryId);

    expect(await statusOf(inquiryId)).toBe('completed');
  });
});

/** The inquiry as a session's first read leaves it: `pending`. */
async function startPending(tx: Db, inquiryId: string): Promise<void> {
  const { transitionInquiryStatus } = await import('@openverify/db');
  await transitionInquiryStatus(tx, api.environmentId, inquiryId, {
    from: 'created',
    to: 'pending',
  });
}

describe('GET /api/v1/flow/session at an nfc step (C207.1, C221.1)', () => {
  const session = async (inquiryId: string) =>
    expectStatus(
      await api.app.inject({
        url: '/api/v1/flow/session',
        headers: {
          ...bearer(await resumeInquiry(api, inquiryId)),
          'openverify-flow-spec': '2',
        },
      }),
      200,
    ) as { step?: Record<string, unknown> };

  it('serves fallbackAvailable from the flow and asks nfcSessionMembers with the view, the session and the kind', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
      flow: WITH_FALLBACK,
    });

    const body = await session(inquiry.id);

    expect(body.step).toEqual({
      id: 'chip',
      type: 'nfc',
      androidOnly: true,
      fallbackAvailable: true,
    });
    const hook = vi.mocked(nfcSessionMembers);
    expect(hook).toHaveBeenCalledTimes(1);
    const [, input] = hook.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      step: { id: 'chip', type: 'nfc', fallbackAvailable: true },
      environmentKind: 'sandbox',
      verifications: [],
    });
    expect(input?.inquiry.id).toBe(inquiry.id);
    expect(input?.sessionId).toMatch(/^iqse_/);
  });

  it('serves the members the hook answers, and fallbackAvailable false without the edge', async () => {
    vi.mocked(nfcSessionMembers).mockResolvedValue({
      sandboxChipAvailable: true,
      prefillMrz: { documentNumber: 'L898902C3', birthDate: '740812', expiryDate: '120415' },
    });
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
      flow: WITHOUT_FALLBACK,
    });

    const body = await session(inquiry.id);

    expect(body.step).toEqual({
      id: 'chip',
      type: 'nfc',
      androidOnly: true,
      fallbackAvailable: false,
      sandboxChipAvailable: true,
      prefillMrz: { documentNumber: 'L898902C3', birthDate: '740812', expiryDate: '120415' },
    });
  });

  it('never asks the hook at another step', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
      flow: NO_CHIP,
    });

    await session(inquiry.id);

    expect(nfcSessionMembers).not.toHaveBeenCalled();
  });
});
