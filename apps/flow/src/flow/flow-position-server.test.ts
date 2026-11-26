import { flowSessionResponseSchema } from '@openverify/contracts';
import type { ClientStepView } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { defaultFlow, flowVerification } from '../testing/flow-fixtures';
import { at, positionedSession } from '../testing/flow-renderer';
import { WAIT_POLL_MS, resolveFlowPosition } from './flow-position';

// C151.5 (Workflow 9A, ADR 0008): a Phase 9 session names the server's position and serves the
// current step's client view; the web flow renders that step and evaluates nothing.

const SCREEN: ClientStepView = {
  id: 'about_you',
  type: 'screen',
  components: [
    { id: 'name', kind: 'text_input', field: 'name_first', labelKey: 'about_you.name.label' },
    { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
  ],
};
const ID_CARD: ClientStepView = {
  id: 'id_card',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['upload'],
};

describe('the server position (C151.5)', () => {
  it('renders the served screen with the values of its fields', () => {
    const session = positionedSession(
      { position: at('about_you'), step: SCREEN, values: { name_first: 'Sam' } },
      { consent: true },
    );

    expect(resolveFlowPosition(session)).toEqual({
      kind: 'screen',
      step: SCREEN,
      values: { name_first: 'Sam' },
    });
  });

  it('renders the served step, whatever the list order of the projection says', () => {
    // The projection lists consent first; the server says the person is on the ID step.
    const session = positionedSession(
      { position: at('id_card', 'active', 'about_you'), step: ID_CARD },
      { consent: true },
    );

    expect(resolveFlowPosition(session)).toMatchObject({
      kind: 'capture',
      step: ID_CARD,
      attempt: 1,
      maxAttempts: 2,
    });
  });

  it('asks a session with no consent of its own (a phone a handoff redeemed) for the flow consent before the served step (C94.6, C96.5)', () => {
    const session = positionedSession({
      position: at('id_card', 'active', 'about_you'),
      step: ID_CARD,
    });
    const consent = session.flow.steps.find((step) => step.type === 'consent');

    expect(consent).toBeDefined();
    expect(resolveFlowPosition(session)).toEqual({ kind: 'consent', step: consent });
  });

  it('keeps the step screen the session facts say: a failed attempt with no hint waits for the server', () => {
    const session = positionedSession(
      { position: at('id_card'), step: ID_CARD },
      { consent: true, verifications: [flowVerification('government_id', 'failed')] },
    );

    expect(resolveFlowPosition(session)).toEqual({ kind: 'finalizing', step: ID_CARD });
  });

  it('waits when the served step is already done here and the server has not moved yet', () => {
    const session = positionedSession(
      { position: at('id_card'), step: ID_CARD },
      { consent: true, verifications: [flowVerification('government_id', 'passed')] },
    );

    expect(resolveFlowPosition(session)).toEqual({
      kind: 'waiting',
      stepId: 'id_card',
      retryAfterMs: WAIT_POLL_MS,
    });
  });

  it('waits while the server waits, polling as it says (C150.5)', () => {
    const session = positionedSession({
      position: { ...at('age_route', 'waiting', 'id_card'), 'retry-after-ms': 1500 },
    });

    expect(resolveFlowPosition(session)).toEqual({
      kind: 'waiting',
      stepId: 'age_route',
      retryAfterMs: 1500,
    });
    expect(WAIT_POLL_MS).toBe(2000);
  });

  it('says the flow cannot continue once the server halted it (C151.2)', () => {
    const session = positionedSession({ position: at('again', 'halted') });

    expect(resolveFlowPosition(session)).toEqual({ kind: 'halted' });
  });

  it('shows the served completion or failure step once the person part ended', () => {
    const done = positionedSession({
      position: at('done', 'ended'),
      step: { id: 'done', type: 'completion', messageKey: 'flow.completion' },
    });
    const failed = positionedSession({
      position: at('refused', 'ended'),
      step: { id: 'refused', type: 'failure' },
    });

    expect(resolveFlowPosition(done)).toEqual({
      kind: 'completion',
      step: { id: 'done', type: 'completion', messageKey: 'flow.completion' },
    });
    expect(resolveFlowPosition(failed)).toEqual({
      kind: 'failure',
      step: { id: 'refused', type: 'failure' },
    });
  });

  it('ends on the completion screen when the person part ended elsewhere (C150.4)', () => {
    expect(resolveFlowPosition(positionedSession({ position: at('age_route', 'ended') }))).toEqual({
      kind: 'completion',
      step: null,
    });
  });

  it('prefers the served terminal step once the inquiry is decided', () => {
    const session = positionedSession(
      {
        position: at('refused', 'ended'),
        step: { id: 'refused', type: 'failure', messageKey: 'flow.failure' },
      },
      { status: 'failed' },
    );

    expect(resolveFlowPosition(session)).toEqual({
      kind: 'failure',
      step: { id: 'refused', type: 'failure', messageKey: 'flow.failure' },
    });
  });

  it('falls back to the projection entry when a spec-1 answer serves no step', () => {
    const session = positionedSession({ position: at('government_id') }, { consent: true });
    const step = defaultFlow().steps.find(({ id }) => id === 'government_id');

    expect(resolveFlowPosition(session)).toMatchObject({ kind: 'capture', step });
  });

  it('waits rather than guess when the position names a step it was not given', () => {
    const session = positionedSession({ position: at('elsewhere') }, { consent: true });
    expect(resolveFlowPosition(session)).toEqual({
      kind: 'waiting',
      stepId: 'elsewhere',
      retryAfterMs: WAIT_POLL_MS,
    });
  });

  it('shows a server-continuation placeholder as unsupported, never skipped', () => {
    const placeholder = { id: 'continue-1', type: 'server-continuation' } as const;
    const session = flowSessionResponseSchema.parse({
      ...positionedSession({ position: at('continue-1') }),
      flow: {
        metadata: { specVersion: 1, id: 'projection', version: 1, name: 'Projection' },
        steps: [placeholder],
        transitions: [],
      },
    });

    expect(resolveFlowPosition(session)).toEqual({
      kind: 'unsupported',
      step: placeholder,
      reason: 'step',
    });
  });
});

describe('a handed-off v2 phone without consent of its own (C94.6, C96.5; contracts B48)', () => {
  const CONSENT_VIEW: ClientStepView = {
    id: 'consent',
    type: 'consent',
    textKeys: ['consent.biometric'],
    required: true,
  };

  it('shows the consent step the server serves when the projection leaves the consent out', () => {
    const base = defaultFlow();
    const flow = { ...base, steps: base.steps.filter((step) => step.type !== 'consent') };
    const session = positionedSession(
      { position: at('id_card', 'active', 'consent'), step: CONSENT_VIEW },
      { flow },
    );

    expect(resolveFlowPosition(session)).toEqual({ kind: 'consent', step: CONSENT_VIEW });
  });
});
