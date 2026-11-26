/**
 * C207.9 (Phase 10, Workflow 10C; `api-nfc`, a borrowed edit of Phase 9's publish analyses): the
 * two rules of an `nfc` step.
 *
 * - `client-unable:<step id>`: an `nfc` step whose `exhausted` fallback continues needs this
 *   acknowledgement beside Phase 9's `fallback:<step id>`, because a "this client cannot read a
 *   chip" report is self-asserted, where `fallback:` covers a person who tried and failed. Without
 *   it on the version, a client-unable exit always sends the inquiry to review.
 * - `nfc_fallback_missing` (a warning): an `nfc` step without an `exhausted` edge stops, at that
 *   step, every web session and every Android session without a reader.
 */
import { describe, expect, it } from 'vitest';
import { analyzeFlowForPublish, type PublishAnalysisContext } from './analyses.js';
import { completion, consent, flowOf, governmentId, nfc, selfie } from './test-flows.js';
import { testTyper } from './test-typer.js';

const sandbox: PublishAnalysisContext = { environment: 'sandbox', typeCondition: testTyper };
const production: PublishAnalysisContext = { environment: 'production', typeCondition: testTyper };

/** consent, a selfie, the chip, completion; the chip's `exhausted` edge when `fallback`. */
const chipFlow = (chip: Record<string, unknown>, fallback: boolean) =>
  flowOf(
    [consent(), selfie(), nfc('chip', chip), completion()],
    [
      ['consent', 'next', 'face'],
      ['face', 'next', 'chip'],
      ['chip', 'next', 'done'],
      ...(fallback ? ([['chip', 'exhausted', 'done']] as const) : []),
    ],
  );

const keysOf = (context: PublishAnalysisContext, flow: ReturnType<typeof flowOf>) =>
  analyzeFlowForPublish(flow, context).acknowledgements.map(({ key }) => key);

const nfcProblems = (context: PublishAnalysisContext, flow: ReturnType<typeof flowOf>) =>
  analyzeFlowForPublish(flow, context)
    .problems.filter(({ code }) => code === 'nfc_fallback_missing')
    .map(({ severity, code, pointer }) => [severity, code, pointer]);

describe('analyzeFlowForPublish: client-unable:<step id> (C207.9)', () => {
  it('is asked, beside fallback:, for an nfc step whose fallback continues, in both kinds', () => {
    for (const context of [sandbox, production]) {
      const keys = keysOf(context, chipFlow({ onFallback: 'continue' }, true));

      expect(keys.slice(0, 2)).toEqual(['fallback:chip', 'client-unable:chip']);
    }
  });

  it('says why, at the step', () => {
    const asked = analyzeFlowForPublish(
      chipFlow({ onFallback: 'continue' }, true),
      production,
    ).acknowledgements.find(({ kind }) => kind === 'client-unable');

    expect(asked).toMatchObject({
      key: 'client-unable:chip',
      target: 'chip',
      pointer: '/steps/2',
    });
    expect(asked?.reason).toMatch(/self-asserted/);
  });

  it('is not asked while the fallback goes to review, or without an exhausted edge', () => {
    for (const flow of [
      chipFlow({}, true),
      chipFlow({ onFallback: 'review' }, true),
      chipFlow({ onFallback: 'continue' }, false),
    ]) {
      expect(keysOf(production, flow).filter((key) => key.startsWith('client-unable:'))).toEqual(
        [],
      );
    }
  });

  it('is never asked for another verification step', () => {
    const flow = flowOf(
      [consent(), governmentId('id_card', { onFallback: 'continue' }), selfie(), completion()],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'face'],
        ['id_card', 'exhausted', 'face'],
        ['face', 'next', 'done'],
      ],
    );

    expect(keysOf(production, flow)).toContain('fallback:id_card');
    expect(keysOf(production, flow).filter((key) => key.startsWith('client-unable:'))).toEqual([]);
  });
});

describe('analyzeFlowForPublish: nfc_fallback_missing (C207.9)', () => {
  it('warns about an nfc step without an exhausted edge, in both kinds, and never blocks', () => {
    for (const context of [sandbox, production]) {
      expect(nfcProblems(context, chipFlow({}, false))).toEqual([
        ['warning', 'nfc_fallback_missing', '/steps/2'],
      ]);
    }
  });

  it('says what stops there', () => {
    const [problem] = analyzeFlowForPublish(chipFlow({}, false), production).problems.filter(
      ({ code }) => code === 'nfc_fallback_missing',
    );

    expect(problem?.detail).toMatch(/web session/);
    expect(problem?.detail).toMatch(/reader/);
  });

  it('is silent once the step has the edge, and for a step no path reaches', () => {
    expect(nfcProblems(production, chipFlow({}, true))).toEqual([]);
    const unreachable = flowOf(
      [consent(), selfie(), nfc('chip'), completion()],
      [
        ['consent', 'next', 'face'],
        ['face', 'next', 'done'],
        ['chip', 'next', 'done'],
      ],
    );
    expect(nfcProblems(production, unreachable)).toEqual([]);
  });
});
