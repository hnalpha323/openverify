/**
 * C151.8, C151.13 (Workflow 9A, api-flow-engine, checkpoint "outcome"): the inquiry's
 * `previous-step-name` and `next-step-name` (`null` once ended), each `null` without PII
 * visibility when its step was reached through a sensitive exit (a screen button other than
 * `next`, or a route reading a PII-marked path: it can reveal a masked value, review P15), and the
 * PII-free `flow-outcome`, also `inquiry.completed`'s `meta`. Every value is synthetic.
 */
import {
  appendInquiryFlowStepInTx,
  exitInquiryFlowStepInTx,
  getInquiry,
  setInquiryFlowOutcomeInTx,
  setInquiryFlowPositionInTx,
  type Inquiry,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { flowV2Schema } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { flowInquiryAttributes, inquiryCompletedMeta } from './inquiry-attributes.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** consent -> about (screen; skip button) -> route (reads a field) -> extra | done. */
const FLOW = flowV2Schema.parse({
  metadata: { specVersion: 2, id: 'names', version: 1, name: 'Names' },
  entry: 'consent',
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
    {
      id: 'about',
      type: 'screen',
      components: [
        { id: 'nick', kind: 'text_input', field: 'nickname', labelKey: 'about.nickname' },
        { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        { id: 'later', kind: 'button', labelKey: 'about.later', action: 'submit', port: 'skip' },
      ],
    },
    {
      id: 'route',
      type: 'branch',
      routes: [
        {
          key: 'named',
          label: 'Named',
          condition: { '===': [{ var: 'inquiry.fields.nickname' }, 'Ada'] },
          onNull: 'else',
        },
      ],
    },
    {
      id: 'extra',
      type: 'screen',
      components: [{ id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' }],
    },
    { id: 'done', type: 'completion' },
  ],
  edges: [
    edge('e1', 'consent', 'next', 'about'),
    edge('e2', 'about', 'next', 'route'),
    edge('e3', 'about', 'button:skip', 'done'),
    edge('e4', 'route', 'route:named', 'extra'),
    edge('e5', 'route', 'else', 'done'),
    edge('e6', 'extra', 'next', 'done'),
  ],
});

interface Exit {
  stepId: string;
  port: string;
  sensitive?: boolean;
}

/** A new inquiry of {@link FLOW} whose record holds `exits` and whose position is `current`. */
async function storedAt(exits: Exit[], current: string, previous: string | null): Promise<Inquiry> {
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, { flow: FLOW });
  const typeOf = (stepId: string) => FLOW.steps.find((step) => step.id === stepId)?.type ?? '';
  const at = new Date('2026-10-20T12:00:00.000Z');
  await api.database.db.transaction(async (tx) => {
    for (const exit of exits) {
      const entry = await appendInquiryFlowStepInTx(tx, api.environmentId, {
        inquiryId: inquiry.id,
        stepId: exit.stepId,
        stepType: typeOf(exit.stepId),
        enteredAt: at,
      });
      await exitInquiryFlowStepInTx(tx, api.environmentId, inquiry.id, entry.seq, {
        exitedAt: at,
        exitPort: exit.port,
        outcome: null,
        sensitive: exit.sensitive ?? false,
        notes: [],
      });
    }
    await appendInquiryFlowStepInTx(tx, api.environmentId, {
      inquiryId: inquiry.id,
      stepId: current,
      stepType: typeOf(current),
      enteredAt: at,
    });
    await setInquiryFlowPositionInTx(tx, api.environmentId, inquiry.id, {
      stepId: current,
      state: typeOf(current) === 'completion' ? 'ended' : 'active',
      previousStepId: previous,
      specVersion: 2,
    });
  });
  const stored = await getInquiry(api.database.db, api.environmentId, inquiry.id);
  if (stored === null) throw new Error('no inquiry');
  return stored;
}

const VISIBLE = { visible: true };
const MASKED = { visible: false };

describe('the step names (C151.8)', () => {
  it('names the step left and the step the person is on, to everyone, after plain exits', async () => {
    const inquiry = await storedAt([{ stepId: 'consent', port: 'next' }], 'about', 'consent');
    const expected = { 'previous-step-name': 'consent', 'next-step-name': 'about' };
    expect(await flowInquiryAttributes(api.database.db, inquiry, MASKED)).toMatchObject(expected);
    expect(await flowInquiryAttributes(api.database.db, inquiry, VISIBLE)).toMatchObject(expected);
  });

  it('hides a step reached through a route that read a field, without PII visibility only', async () => {
    const inquiry = await storedAt(
      [
        { stepId: 'consent', port: 'next' },
        { stepId: 'about', port: 'next' },
        { stepId: 'route', port: 'route:named', sensitive: true },
      ],
      'extra',
      'about',
    );
    expect(await flowInquiryAttributes(api.database.db, inquiry, MASKED)).toMatchObject({
      'previous-step-name': 'about',
      'next-step-name': null,
    });
    expect(await flowInquiryAttributes(api.database.db, inquiry, VISIBLE)).toMatchObject({
      'previous-step-name': 'about',
      'next-step-name': 'extra',
    });
  });

  it('hides a previous step that was itself reached sensitively, and names no next step once ended', async () => {
    const inquiry = await storedAt(
      [
        { stepId: 'consent', port: 'next' },
        { stepId: 'about', port: 'next' },
        { stepId: 'route', port: 'route:named', sensitive: true },
        { stepId: 'extra', port: 'next' },
      ],
      'done',
      'extra',
    );
    expect(await flowInquiryAttributes(api.database.db, inquiry, MASKED)).toEqual({
      'previous-step-name': null,
      'next-step-name': null,
      'flow-outcome': null,
    });
    expect(await flowInquiryAttributes(api.database.db, inquiry, VISIBLE)).toMatchObject({
      'previous-step-name': 'extra',
      'next-step-name': null,
    });
  });

  it('answers null names for an inquiry the engine never positioned', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, { flow: FLOW });
    expect(await flowInquiryAttributes(api.database.db, inquiry, VISIBLE)).toEqual({
      'previous-step-name': null,
      'next-step-name': null,
      'flow-outcome': null,
    });
  });
});

describe('the flow outcome (C151.13)', () => {
  it('serves the stored outcome on the inquiry and as inquiry.completed’s meta', async () => {
    const inquiry = await storedAt(
      [
        { stepId: 'consent', port: 'next' },
        { stepId: 'about', port: 'button:skip', sensitive: true },
      ],
      'done',
      'about',
    );
    expect(inquiryCompletedMeta(inquiry)).toBeUndefined();
    await api.database.db.transaction((tx) =>
      setInquiryFlowOutcomeInTx(tx, api.environmentId, inquiry.id, {
        verificationTypesOnPath: [],
        fallbacksTaken: [],
        flags: ['unverified_path'],
      }),
    );
    const settled = await getInquiry(api.database.db, api.environmentId, inquiry.id);
    if (settled === null) throw new Error('no inquiry');
    const outcome = {
      'verification-types-on-path': [],
      'fallbacks-taken': [],
      flags: ['unverified_path'],
    };
    expect(await flowInquiryAttributes(api.database.db, settled, MASKED)).toEqual({
      'previous-step-name': 'about',
      'next-step-name': null,
      'flow-outcome': outcome,
    });
    expect(inquiryCompletedMeta(settled)).toEqual({ 'flow-outcome': outcome });
  });
});
