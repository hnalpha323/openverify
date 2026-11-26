/**
 * Workflow 10B (`api-integrity`; C210.5, C211.5, C211.9): the device-integrity publish rules of
 * `analyzeFlowForPublish`, golden cases.
 *
 * - `signal_not_decisive_alone` (an error in every environment): a failure step reached from a route
 *   whose condition reads a `decisive-alone: false` signal (the three heuristics and Play
 *   Integrity's two) is refused unless a verification step and a route reading that verification's
 *   outcome lie between them. The rule is over what a route reads, so a trivially true or unrelated
 *   fact joined by `and` or `or` changes nothing; the routes after the signal's and `else` depend on
 *   it too. Its stated limit: a route that couples the signal with an outcome of a verification that
 *   lies on the path passes.
 * - `heuristic:<branch>` for every route reading such a signal, whatever its tier and direction.
 * - With a `deviceIntegrity` provider unbound, a route on either Play Integrity signal is
 *   `provider_not_bound`; with one bound, a consent step that starts the session-integrity collection
 *   needs `notice.play-integrity` on it or on a screen or consent before it on every path
 *   (`play_integrity_notice_missing`).
 */
import { describe, expect, it } from 'vitest';
import { analyzeFlowForPublish, type PublishAnalysisContext } from './analyses.js';
import { testTyper } from './test-typer.js';
import {
  branch,
  completion,
  consent,
  failure,
  flowOf,
  governmentId,
  route,
  screen,
  selfie,
  text,
  v,
} from './test-flows.js';

const sandbox: PublishAnalysisContext = { environment: 'sandbox', typeCondition: testTyper };
const ROOTED = 'signals.inquiry/device_rooted';
const LEVEL = 'signals.inquiry/device_integrity_level';
const RECOGNIZED = 'signals.inquiry/app_recognized';
const isRooted = { '===': [v(ROOTED), true] };

const errorsOf = (flow: ReturnType<typeof flowOf>, context: PublishAnalysisContext = sandbox) =>
  analyzeFlowForPublish(flow, context)
    .problems.filter(({ severity }) => severity === 'error')
    .map(({ code, pointer }) => [code, pointer]);

const keysOf = (flow: ReturnType<typeof flowOf>, context: PublishAnalysisContext = sandbox) =>
  analyzeFlowForPublish(flow, context).acknowledgements.map(({ key }) => key);

/** consent, an ID, a branch on `condition` (waiting for `facts`), its route to a failure, else done. */
function onSignal(condition: unknown, facts: readonly string[] = [ROOTED]) {
  return flowOf(
    [
      consent(),
      governmentId(),
      branch('device', [route('adverse', condition as never, 'else')], {
        waitFor: { facts: [...facts], maxSeconds: 5 },
      }),
      completion(),
      failure('rejected'),
    ],
    [
      ['consent', 'next', 'id_card'],
      ['id_card', 'next', 'device'],
      ['device', 'route:adverse', 'rejected'],
      ['device', 'else', 'done'],
    ],
  );
}

describe('signal_not_decisive_alone (C210.5)', () => {
  it('golden: refuses a failure right after a route on a device heuristic', () => {
    expect(errorsOf(onSignal(isRooted))).toEqual([['signal_not_decisive_alone', '/steps/4']]);
  });

  it('golden: and with a trivially true fact changes nothing', () => {
    expect(errorsOf(onSignal({ and: [isRooted, { '===': [1, 1] }] }))).toEqual([
      ['signal_not_decisive_alone', '/steps/4'],
    ]);
  });

  it('golden: or with an unrelated fact changes nothing', () => {
    expect(
      errorsOf(onSignal({ or: [isRooted, { '===': [v('inquiry.status'), 'pending'] }] })),
    ).toEqual([['signal_not_decisive_alone', '/steps/4']]);
  });

  it('golden: refuses a Play Integrity signal, A-tier, the same way', () => {
    expect(errorsOf(onSignal({ in: [v(LEVEL), ['basic', 'none']] }, [LEVEL]))).toEqual([
      ['signal_not_decisive_alone', '/steps/4'],
    ]);
  });

  it('golden: refuses a failure behind else: the routes after the signal’s depend on it', () => {
    const flow = flowOf(
      [
        consent(),
        governmentId(),
        branch('device', [route('trusted', { in: [v(LEVEL), ['strong', 'device']] }, 'else')], {
          waitFor: { facts: [LEVEL], maxSeconds: 5 },
        }),
        completion(),
        failure('rejected'),
      ],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'device'],
        ['device', 'route:trusted', 'done'],
        ['device', 'else', 'rejected'],
      ],
    );
    expect(errorsOf(flow)).toEqual([['signal_not_decisive_alone', '/steps/4']]);
  });

  it('golden: passes when a verification and a route on its outcome lie between', () => {
    const flow = flowOf(
      [
        consent(),
        governmentId(),
        branch('device', [route('rooted', isRooted, 'else')], {
          waitFor: { facts: [ROOTED], maxSeconds: 5 },
        }),
        selfie(),
        branch('face_outcome', [
          route('failed', { '===': [v('verifications.face.status'), 'failed'] }, 'else'),
        ]),
        completion(),
        failure('rejected'),
      ],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'device'],
        ['device', 'route:rooted', 'face'],
        ['device', 'else', 'done'],
        ['face', 'next', 'face_outcome'],
        ['face_outcome', 'route:failed', 'rejected'],
        ['face_outcome', 'else', 'done'],
      ],
    );
    expect(errorsOf(flow)).toEqual([]);
    expect(keysOf(flow)).toContain('heuristic:device');
  });

  it('golden: a verification with no route on its outcome is not enough', () => {
    const flow = flowOf(
      [
        consent(),
        governmentId(),
        branch('device', [route('rooted', isRooted, 'else')], {
          waitFor: { facts: [ROOTED], maxSeconds: 5 },
        }),
        selfie(),
        completion(),
        failure('rejected'),
      ],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'device'],
        ['device', 'route:rooted', 'face'],
        ['device', 'else', 'done'],
        ['face', 'next', 'rejected'],
      ],
    );
    expect(errorsOf(flow)).toEqual([['signal_not_decisive_alone', '/steps/5']]);
  });

  it('golden: a route before the signal’s, on a verification outcome, is not held by it', () => {
    const flow = flowOf(
      [
        consent(),
        governmentId(),
        branch(
          'device',
          [
            route('id_failed', { '===': [v('verifications.id_card.status'), 'failed'] }, 'else'),
            route('rooted', isRooted, 'else'),
          ],
          { waitFor: { facts: [ROOTED], maxSeconds: 5 } },
        ),
        completion(),
        completion('review_later'),
        failure('rejected'),
      ],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'device'],
        ['device', 'route:id_failed', 'rejected'],
        ['device', 'route:rooted', 'review_later'],
        ['device', 'else', 'done'],
      ],
    );
    expect(errorsOf(flow)).toEqual([]);
  });

  it('golden: its stated limit: a route coupling the signal with an outcome on the path passes', () => {
    expect(
      errorsOf(
        onSignal({ and: [isRooted, { '===': [v('verifications.id_card.status'), 'failed'] }] }),
      ),
    ).toEqual([]);
  });

  it('leaves a route on a decisive signal to Phase 9’s rules', () => {
    expect(
      errorsOf(
        onSignal({ '>': [v('signals.inquiry/bot_score'), 80] }, ['signals.inquiry/bot_score']),
      ),
    ).toEqual([]);
  });
});

describe('heuristic: for every route on a signal that is not decisive alone (C150.7 widened)', () => {
  it('golden: asks it for an A-tier Play Integrity route that skips a step', () => {
    const flow = flowOf(
      [
        consent(),
        governmentId(),
        branch('device', [route('strong', { '===': [v(LEVEL), 'strong'] }, 'else')], {
          waitFor: { facts: [LEVEL], maxSeconds: 5 },
        }),
        selfie(),
        completion(),
      ],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'device'],
        ['device', 'route:strong', 'done'],
        ['device', 'else', 'face'],
        ['face', 'next', 'done'],
      ],
    );
    expect(keysOf(flow)).toContain('heuristic:device');
    expect(errorsOf(flow)).toEqual([]);
  });
});

describe('the binding rules (C211.5, C211.9)', () => {
  const onRecognition = onSignal({ '===': [v(RECOGNIZED), false] }, [RECOGNIZED]);

  it('refuses a route on a Play Integrity signal where no provider is bound', () => {
    expect(errorsOf(onRecognition, { ...sandbox, deviceIntegrityBound: false })).toContainEqual([
      'provider_not_bound',
      '/steps/2/routes/0/condition/===/0/var',
    ]);
    expect(errorsOf(onRecognition, { ...sandbox, deviceIntegrityBound: true })).not.toContainEqual(
      expect.arrayContaining(['provider_not_bound']),
    );
    expect(errorsOf(onRecognition)).not.toContainEqual(
      expect.arrayContaining(['provider_not_bound']),
    );
    expect(
      errorsOf(onSignal(isRooted), { ...sandbox, deviceIntegrityBound: false }),
    ).not.toContainEqual(expect.arrayContaining(['provider_not_bound']));
  });

  /** A consent that starts the session-integrity collection, with `before` ahead of it. */
  function collecting(textKeys: string[], before: unknown[] = []) {
    const ids = before.map((step) => (step as { id: string }).id);
    return flowOf(
      [...(before as never[]), consent('consent', { textKeys }), completion()],
      [
        ...ids.map((id, index): [string, string, string] => [
          id,
          'next',
          ids[index + 1] ?? 'consent',
        ]),
        ['consent', 'next', 'done'],
      ],
      ids[0] ?? 'consent',
    );
  }
  const bound = { ...sandbox, deviceIntegrityBound: true };

  it('golden: refuses a bound environment’s collection without notice.play-integrity', () => {
    expect(errorsOf(collecting(['consent.biometric', 'notice.session-integrity']), bound)).toEqual([
      ['play_integrity_notice_missing', '/steps/0'],
    ]);
  });

  it('golden: passes the notice on the consent, or on a screen before it', () => {
    expect(
      errorsOf(
        collecting(['consent.biometric', 'notice.session-integrity', 'notice.play-integrity']),
        bound,
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        collecting(
          ['consent.biometric', 'notice.session-integrity'],
          [screen('notice', [text('google', { copyKey: 'notice.play-integrity' })])],
        ),
        bound,
      ),
    ).toEqual([]);
  });

  it('asks nothing where no provider is bound, or nothing collects', () => {
    const missing = collecting(['consent.biometric', 'notice.session-integrity']);
    expect(errorsOf(missing, { ...sandbox, deviceIntegrityBound: false })).toEqual([]);
    expect(errorsOf(missing)).toEqual([]);
    expect(errorsOf(collecting(['consent.biometric']), bound)).toEqual([]);
  });
});
