import { describe, expect, it } from 'vitest';
import { BEHAVIOUR_RULES, sessionBehaviourLevel } from './behaviour.js';
import { sessionEvidence } from './evidence.js';
import type { BehaviourInput, IntegrityInput, SignalBodyInput } from './inputs.js';
import { behaviour, integrity, seededRandom, session, webBody } from './testing.js';

function evidenceOf(
  screens: readonly BehaviourInput[],
  options: {
    integrity?: IntegrityInput | null;
    screenTypes?: readonly string[];
    extra?: readonly SignalBodyInput[];
    environment?: 'sandbox' | 'production';
  } = {},
) {
  const bodies = screens.map((aggregates, index) =>
    webBody(index + 1, {
      screenType: options.screenTypes?.[index] ?? 'form',
      behaviour: aggregates,
      ...(index === 0 && options.integrity !== null
        ? { integrity: options.integrity ?? integrity() }
        : {}),
    }),
  );
  return sessionEvidence(
    session('iqse_1', { bodies: [...bodies, ...(options.extra ?? [])] }),
    options.environment ?? 'production',
  );
}

const human = [behaviour(), behaviour(), behaviour()];

describe('BEHAVIOUR_RULES (C94.8)', () => {
  it('holds the levels, the behaviour evidence it reads and its minimum', () => {
    expect(BEHAVIOUR_RULES).toEqual({
      levels: [
        { level: 'high', when: 'untrusted-input' },
        { level: 'medium', when: 'evidence-reaches-medium-weak-cap' },
        { level: 'low', when: 'otherwise' },
      ],
      evidence: [
        'untrusted_events',
        'uniform_typing_cadence',
        'fast_screens',
        'no_pointer_travel',
        'paste_into_identity_field',
        'autofill_into_identity_field',
        'many_focus_losses',
        'long_hidden_periods',
      ],
      minimum: ['min-screens', 'min-input-events'],
      groups: ['integrity', 'typing', 'pointer', 'screens'],
    });
  });
});

describe('sessionBehaviourLevel (C94.8)', () => {
  it('golden: ordinary behaviour is low, with no artefact found and the 0.5 cap', () => {
    expect(sessionBehaviourLevel(evidenceOf(human))).toEqual({
      level: 'low',
      confidence: 0.5,
      reasons: ['no_artefact_found'],
      nullReason: null,
    });
  });

  it('golden: untrusted input events are the one strong behavioural artefact: high', () => {
    expect(
      sessionBehaviourLevel(
        evidenceOf(human, { integrity: integrity({ 'untrusted-event-count': 3 }) }),
      ),
    ).toEqual({
      level: 'high',
      confidence: 0.6667,
      reasons: ['untrusted_events'],
      nullReason: null,
    });
    expect(
      sessionBehaviourLevel(
        evidenceOf(
          human.map((screen) => ({
            ...screen,
            'pointer-types': [],
            'pointer-before-click': 'n/a' as const,
          })),
          { integrity: integrity({ 'untrusted-event-count': 3 }) },
        ),
      ),
    ).toMatchObject({ level: 'high', confidence: 0.5834 });
  });

  it('reads no device artefact: webdriver alone leaves the level low', () => {
    expect(
      sessionBehaviourLevel(
        evidenceOf(human, {
          integrity: integrity({ webdriver: true, 'driver-globals': ['selenium'] }),
        }),
      ),
    ).toMatchObject({ level: 'low', reasons: ['no_artefact_found'] });
  });

  it('golden: medium when the behaviour evidence reaches the cap of 60', () => {
    const atCap = [1, 2, 3].map(() =>
      behaviour({
        'typing-cadence': 'uniform',
        'correction-count': 0,
        'dwell-seconds': 1,
        'paste-count': 1,
        'autofill-count': 1,
      }),
    );
    expect(sessionBehaviourLevel(evidenceOf(atCap))).toEqual({
      level: 'medium',
      confidence: 0,
      reasons: [
        'uniform_typing_cadence',
        'fast_screens',
        'paste_into_identity_field',
        'autofill_into_identity_field',
      ],
      nullReason: null,
    });
  });

  it('golden: the voice-control profile is never high (P24)', () => {
    const voice = Array.from({ length: 4 }, () =>
      behaviour({
        'typing-cadence': 'uniform',
        'correction-count': 0,
        'pointer-types': ['mouse'],
        'pointer-before-click': 'false',
        'dwell-seconds': 1.5,
        'input-event-count': 8,
        'autofill-count': 1,
        'paste-count': 1,
        'focus-loss-count': 3,
        'hidden-seconds': 100,
      }),
    );
    expect(
      sessionBehaviourLevel(
        evidenceOf(voice, { screenTypes: ['form', 'phone_otp', 'email_otp', 'form'] }),
      ),
    ).toEqual({
      level: 'medium',
      confidence: 0.875,
      reasons: [
        'uniform_typing_cadence',
        'fast_screens',
        'no_pointer_travel',
        'paste_into_identity_field',
        'autofill_into_identity_field',
        'many_focus_losses',
        'long_hidden_periods',
      ],
      nullReason: null,
    });
  });

  it('golden: the keyboard-only profile is low (P24)', () => {
    const keyboard = Array.from({ length: 4 }, () =>
      behaviour({
        'pointer-types': [],
        'pointer-before-click': 'n/a',
        'dwell-seconds': 1,
        'autofill-count': 2,
        'focus-loss-count': 3,
      }),
    );
    expect(sessionBehaviourLevel(evidenceOf(keyboard))).toEqual({
      level: 'low',
      confidence: 0.5,
      reasons: [
        'no_artefact_found',
        'fast_screens',
        'autofill_into_identity_field',
        'many_focus_losses',
      ],
      nullReason: null,
    });
  });

  it('golden: below 3 screens or 20 input events there is too little behaviour', () => {
    expect(sessionBehaviourLevel(evidenceOf([behaviour(), behaviour()]))).toEqual({
      level: null,
      confidence: null,
      reasons: [],
      nullReason: 'insufficient_behaviour',
    });
    const quiet = [1, 2, 3].map(() => behaviour({ 'input-event-count': 5 }));
    expect(sessionBehaviourLevel(evidenceOf(quiet))).toMatchObject({
      level: null,
      nullReason: 'insufficient_behaviour',
    });
    const revisits = sessionEvidence(
      session('iqse_1', {
        bodies: [1, 2, 3].map((sequence) =>
          webBody(sequence, { screen: 'step_1', behaviour: behaviour() }),
        ),
      }),
      'production',
    );
    expect(sessionBehaviourLevel(revisits)).toMatchObject({ nullReason: 'insufficient_behaviour' });
  });

  it('answers input_missing without behaviour aggregates', () => {
    expect(sessionBehaviourLevel(sessionEvidence(session('iqse_1'), 'production'))).toEqual({
      level: null,
      confidence: null,
      reasons: [],
      nullReason: 'input_missing',
    });
  });

  it('golden: the sandbox outcomes (C90.9)', () => {
    expect(
      sessionBehaviourLevel(
        evidenceOf([behaviour()], {
          extra: [webBody(9, { sandboxOutcome: 'bot' })],
          environment: 'sandbox',
        }),
      ),
    ).toEqual({ level: 'high', confidence: 1, reasons: ['sandbox_outcome'], nullReason: null });
    expect(
      sessionBehaviourLevel(
        evidenceOf(human, {
          extra: [webBody(9, { sandboxOutcome: 'human' })],
          environment: 'sandbox',
        }),
      ),
    ).toEqual({ level: 'low', confidence: 1, reasons: ['sandbox_outcome'], nullReason: null });
  });

  it('is never high without untrusted input, and a low level never carries more than 0.5 (property)', () => {
    const random = seededRandom('behaviour-level-properties');
    const pick = <Value>(values: readonly Value[]): Value =>
      values[Math.floor(random() * values.length)] as Value;
    for (let run = 0; run < 400; run += 1) {
      const screens = Array.from({ length: 2 + Math.floor(random() * 4) }, () =>
        behaviour({
          'paste-count': pick([0, 2]),
          'autofill-count': pick([0, 1]),
          'correction-count': pick([0, 1]),
          'focus-loss-count': pick([0, 5]),
          'input-event-count': pick([3, 12]),
          'dwell-seconds': pick([1, 30]),
          'hidden-seconds': pick([0, 200]),
          'typing-cadence': pick(['uniform', 'variable', 'insufficient'] as const),
          'pointer-types': pick([[], ['mouse'], ['touch']] as const),
          'pointer-before-click': pick(['true', 'false', 'n/a'] as const),
        }),
      );
      const result = sessionBehaviourLevel(
        evidenceOf(screens, { integrity: integrity({ webdriver: random() < 0.5 }) }),
      );
      expect(result.level).not.toBe('high');
      if (result.level === 'low') {
        expect(result.confidence).toBeLessThanOrEqual(0.5);
      }
    }
  });
});
