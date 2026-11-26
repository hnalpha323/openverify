import { SIGNAL_PROBLEM_CODES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { SIGNAL_PROBLEM_WORDS, describeVersionProblem } from './version-problem-words';

describe('the version and signal problem codes in words (C90.6, C96, C99.5, C108)', () => {
  it.each([...SIGNAL_PROBLEM_CODES, 'list_kind_mismatch', 'kind_not_collected'] as const)(
    'says %s in words',
    (code) => {
      expect(SIGNAL_PROBLEM_WORDS[code]).toMatch(/^[A-Z].*\.$/);
    },
  );

  it('names the settings page for a handoff step without a display name', () => {
    expect(SIGNAL_PROBLEM_WORDS.display_name_required).toMatch(/Settings/);
  });
});

describe('describeVersionProblem', () => {
  it('titles a publish refusal by its code, and names the document of every error', () => {
    const described = describeVersionProblem({
      title: 'Unprocessable',
      detail: 'Synthetic detail.',
      code: 'unknown_signal',
      errors: [
        { pointer: '/data/attributes/signal-config/collect/0', detail: 'unknown_signal' },
        { pointer: '/data/attributes/list-config/screen/1', detail: 'kind_not_collected' },
        { pointer: '/data/attributes/flow/steps/2', detail: 'display_name_required' },
        { pointer: '/data/attributes/verification-config/selfie', detail: 'invalid' },
        { pointer: '/data/attributes/settings/max-sessions', detail: 'too big' },
        { pointer: '/data/attributes/other', detail: 'elsewhere' },
      ],
    });

    expect(described.title).toBe(SIGNAL_PROBLEM_WORDS.unknown_signal);
    expect(described.errors?.map((error) => error.detail)).toEqual([
      `Signal config, at /collect/0: ${SIGNAL_PROBLEM_WORDS.unknown_signal}`,
      `List config, at /screen/1: ${SIGNAL_PROBLEM_WORDS.kind_not_collected}`,
      `Flow, at /steps/2: ${SIGNAL_PROBLEM_WORDS.display_name_required}`,
      'Verification config, at /selfie: invalid',
      'Settings, at /max-sessions: too big',
      'elsewhere',
    ]);
    expect(described.errors?.map((error) => error.pointer)).toEqual([
      '/data/attributes/signal-config/collect/0',
      '/data/attributes/list-config/screen/1',
      '/data/attributes/flow/steps/2',
      '/data/attributes/verification-config/selfie',
      '/data/attributes/settings/max-sessions',
      '/data/attributes/other',
    ]);
  });

  it('leaves a problem without a known code titled as it was', () => {
    expect(describeVersionProblem({ title: 'Other', detail: 'x' })).toEqual({
      title: 'Other',
      detail: 'x',
    });
  });
});
