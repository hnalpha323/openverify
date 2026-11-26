import { describe, expect, it } from 'vitest';
import { analyzeFlowForPublish, flowScopeAt, type PublishAnalysisContext } from './analyses.js';
import { testTyper } from './test-typer.js';
import {
  branch,
  completion,
  consent,
  document,
  failure,
  flowOf,
  governmentId,
  route,
  screen,
  selfie,
  submit,
  textInput,
  v,
} from './test-flows.js';

const sandbox: PublishAnalysisContext = { environment: 'sandbox', typeCondition: testTyper };
const production: PublishAnalysisContext = { environment: 'production', typeCondition: testTyper };
const codes = (context: PublishAnalysisContext, flow: ReturnType<typeof flowOf>) =>
  analyzeFlowForPublish(flow, context).problems.map(({ severity, code, pointer }) => [
    severity,
    code,
    pointer,
  ]);

/** consent, an ID with a continued fallback to a document, a branch on the ID's country, a selfie. */
const adverse = (failureExtra: Record<string, unknown> = {}, consentExtra = {}) =>
  flowOf(
    [
      consent('consent', consentExtra),
      governmentId('id_card', { onFallback: 'continue' }),
      document(),
      branch('country_route', [
        route('foreign', { '===': [v('verifications.id_card.country-code'), 'FR'] }, 'else'),
      ]),
      selfie(),
      completion(),
      failure('rejected', failureExtra),
    ],
    [
      ['consent', 'next', 'id_card'],
      ['id_card', 'next', 'country_route'],
      ['id_card', 'exhausted', 'proof'],
      ['proof', 'next', 'country_route'],
      ['country_route', 'route:foreign', 'rejected'],
      ['country_route', 'else', 'face'],
      ['face', 'next', 'done'],
    ],
  );

describe('analyzeFlowForPublish: the acknowledgements (C150.6, C150.7, C150.10, C151.13)', () => {
  it('asks for fallback, heuristic, adverse-path and, in production, unverified-path', () => {
    const analysis = analyzeFlowForPublish(adverse(), production);
    expect(analysis.acknowledgements.map(({ key }) => key)).toEqual([
      'fallback:id_card',
      'heuristic:country_route',
      'adverse-path:rejected',
      'unverified-path:done',
    ]);
    for (const acknowledgement of analysis.acknowledgements) {
      expect(acknowledgement.reason.length).toBeGreaterThan(0);
      expect(acknowledgement.pointer).toMatch(/^\/steps\/\d+$/);
    }
  });

  it('needs a basis and a contest route on an adverse failure in production only', () => {
    expect(codes(production, adverse())).toEqual([
      ['error', 'decision_basis_missing', '/steps/6'],
      ['error', 'contest_route_missing', '/steps/6'],
    ]);
    expect(
      codes(
        production,
        adverse({ decisionBasis: 'contract', contestRoute: { url: 'https://example.com/c' } }),
      ),
    ).toEqual([]);
    expect(codes(sandbox, adverse())).toEqual([
      ['warning', 'unverified_path_completion', '/steps/5'],
    ]);
    expect(
      analyzeFlowForPublish(adverse(), sandbox).acknowledgements.map(({ kind }) => kind),
    ).toEqual(['fallback', 'heuristic', 'adverse-path']);
  });

  it('checks the recorded consent keys when a basis is explicit consent (C128.4)', () => {
    const basis = {
      decisionBasis: 'explicit-consent',
      contestRoute: { contact: 'help@example.com' },
    };
    expect(codes(production, adverse(basis))).toEqual([
      ['error', 'consent_key_missing', '/steps/6'],
    ]);
    expect(
      codes(production, adverse(basis, { optionalTextKeys: ['consent.automated-decision'] })),
    ).toEqual([]);
  });

  it('treats a route on a selfie check as a biometric adverse path (C128.4)', () => {
    const flow = flowOf(
      [
        consent('consent', { optionalTextKeys: ['consent.automated-decision'] }),
        selfie(),
        branch('live', [
          route(
            'spoof',
            { '===': [v('verifications.face.checks.selfie_liveness_detection.status'), 'failed'] },
            'review',
          ),
        ]),
        completion(),
        failure('rejected', {
          decisionBasis: 'explicit-consent',
          contestRoute: { contact: 'help@example.com' },
        }),
      ],
      [
        ['consent', 'next', 'face'],
        ['face', 'next', 'live'],
        ['live', 'route:spoof', 'rejected'],
        ['live', 'else', 'done'],
      ],
    );
    expect(codes(production, flow)).toEqual([['error', 'biometric_basis_missing', '/steps/4']]);
    const withBasis = flowOf(
      flow.steps.map((step) =>
        step.id === 'rejected' ? { ...step, biometricBasis: 'explicit-consent' } : step,
      ),
      flow.edges.map(({ from, port, to }) => [from, port, to] as const),
    );
    expect(codes(production, withBasis)).toEqual([]);
  });

  it('counts inquiry.status and check statuses as biometric on a biometric template, unknown failing closed', () => {
    const flow = (biometricStatus: boolean) =>
      flowOf(
        [
          consent(),
          governmentId(),
          branch('state', [
            route(
              'odd',
              biometricStatus
                ? {
                    '===': [
                      v('verifications.id_card.checks.id_barcode_detection.status'),
                      'failed',
                    ],
                  }
                : { '===': [v('verifications.id_card.country-code'), 'FR'] },
              'else',
            ),
          ]),
          completion(),
          failure('rejected', {
            decisionBasis: 'contract',
            contestRoute: { contact: 'x@example.com' },
          }),
        ],
        [
          ['consent', 'next', 'id_card'],
          ['id_card', 'next', 'state'],
          ['state', 'route:odd', 'rejected'],
          ['state', 'else', 'done'],
        ],
      );
    const biometric = (templateIsBiometric: boolean | null, checkStatus: boolean) =>
      codes({ ...production, templateIsBiometric }, flow(checkStatus)).some(
        ([, code]) => code === 'biometric_basis_missing',
      );
    expect(biometric(true, true)).toBe(true);
    expect(biometric(null, true)).toBe(true);
    expect(biometric(false, true)).toBe(false);
    expect(biometric(true, false)).toBe(false);
  });

  it('asks asserted-fact for a route on a person’s fact that skips a verification (production)', () => {
    const flow = flowOf(
      [
        consent(),
        screen('where', [textInput('country', 'country'), submit()]),
        branch('trust', [route('local', { '===': [v('inquiry.fields.country'), 'US'] }, 'else')]),
        governmentId(),
        completion(),
      ],
      [
        ['consent', 'next', 'where'],
        ['where', 'next', 'trust'],
        ['trust', 'route:local', 'done'],
        ['trust', 'else', 'id_card'],
        ['id_card', 'next', 'done'],
      ],
    );
    const context = {
      ...production,
      fieldSchemas: [{ key: 'country', type: 'string', pii: false }],
    };
    expect(analyzeFlowForPublish(flow, context).acknowledgements.map(({ key }) => key)).toEqual([
      'asserted-fact:trust',
      'unverified-path:done',
    ]);
    expect(codes({ ...context, environment: 'sandbox' }, flow)).toEqual([
      ['warning', 'asserted_fact_route', '/steps/2'],
      ['warning', 'unverified_path_completion', '/steps/4'],
    ]);
  });

  it('asks heuristic for an H-tier signal and for a check that is not required', () => {
    const flow = flowOf(
      [
        consent(),
        governmentId(),
        branch(
          'friction',
          [
            route('bot', { '>': [v('signals.inquiry/bot_score'), 80] }, 'else'),
            route(
              'barcode',
              { '===': [v('verifications.id_card.checks.id_barcode_detection.status'), 'passed'] },
              'else',
            ),
          ],
          { waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 5 } },
        ),
        completion(),
      ],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'friction'],
        ['friction', 'route:bot', 'done'],
        ['friction', 'route:barcode', 'done'],
        ['friction', 'else', 'done'],
      ],
    );
    const context = { ...sandbox, signalCollect: ['inquiry/bot_score'] };
    expect(analyzeFlowForPublish(flow, context).acknowledgements.map(({ key }) => key)).toEqual([
      'heuristic:friction',
    ]);
    expect(codes(context, flow)).toEqual([]);
  });
});

describe('analyzeFlowForPublish: typing over the flow scope (C150.3, C150.9)', () => {
  const branchFlow = (
    routes: readonly Record<string, unknown>[],
    extra: Record<string, unknown> = {},
    before = false,
  ) =>
    flowOf(
      before
        ? [consent(), branch('b', routes, extra), governmentId(), completion()]
        : [consent(), governmentId(), branch('b', routes, extra), completion()],
      before
        ? [
            ['consent', 'next', 'b'],
            ...routes.map((r) => ['b', `route:${String(r.key)}`, 'id_card'] as const),
            ['b', 'else', 'id_card'],
            ['id_card', 'next', 'done'],
          ]
        : [
            ['consent', 'next', 'id_card'],
            ['id_card', 'next', 'b'],
            ...routes.map((r) => ['b', `route:${String(r.key)}`, 'done'] as const),
            ['b', 'else', 'done'],
          ],
    );
  const at = '/steps/2/routes/0';

  it('needs onNull on a route that reads a nullable path, with no default', () => {
    expect(
      codes(
        sandbox,
        branchFlow([route('young', { '<': [v('verifications.id_card.age-years'), 18] })]),
      ),
    ).toEqual([['error', 'on_null_missing', at]]);
  });

  it('types a verification’s outcome nullable only where its step does not come first', () => {
    const status = { '===': [v('verifications.id_card.status'), 'passed'] };
    expect(codes(sandbox, branchFlow([route('ok', status)]))).toEqual([]);
    expect(codes(sandbox, branchFlow([route('ok', status)], {}, true))).toEqual([
      ['error', 'on_null_missing', '/steps/1/routes/0'],
    ]);
  });

  it('refuses an unknown path, a PII literal and a nullable boolean operand, by pointer', () => {
    const flow = branchFlow([
      route('a', { '===': [v('verifications.id_card.nope'), 'x'] }, 'else'),
      route('b', { '===': [v('inquiry.fields.nickname'), 'jo'] }, 'else'),
      route(
        'c',
        { '!==': [v('verifications.id_card.checks.id_barcode_detection.status'), 'failed'] },
        'else',
      ),
    ]);
    const context = { ...sandbox, fieldSchemas: [{ key: 'nickname', type: 'string', pii: true }] };
    expect(codes(context, flow)).toEqual([
      ['error', 'scope_path_unknown', '/steps/2/routes/0/condition/===/0/var'],
      ['error', 'pii_literal_in_condition', '/steps/2/routes/1/condition/===/0/var'],
      ['error', 'nullable_in_boolean_position', '/steps/2/routes/2/condition/!==/0/var'],
    ]);
  });

  it('refuses signals a flow cannot read: not provisional, not collected, and every list', () => {
    const flow = branchFlow(
      [
        route('a', { '===': [v('signals.inquiry/country_comparison'), 'same'] }, 'else'),
        route('b', { '>': [v('signals.inquiry/bot_score'), 50] }, 'else'),
        route('c', { '===': [v('lists.lst_01HZZZZZZZZZZZZZZZZZZZZZZZ.matched'), true] }, 'else'),
      ],
      {
        waitFor: {
          facts: ['signals.inquiry/bot_score', 'signals.inquiry/country_comparison'],
          maxSeconds: 5,
        },
      },
    );
    expect(codes({ ...sandbox, signalCollect: [] }, flow)).toEqual([
      ['error', 'scope_path_unavailable_in_flow', '/steps/2/routes/0/condition/===/0/var'],
      ['error', 'scope_path_unavailable_in_flow', '/steps/2/routes/1/condition/>/0/var'],
      ['error', 'scope_path_unavailable_in_flow', '/steps/2/routes/2/condition/===/0/var'],
      ['error', 'scope_path_unavailable_in_flow', '/steps/2/waitFor/facts/0'],
      ['error', 'scope_path_unavailable_in_flow', '/steps/2/waitFor/facts/1'],
    ]);
  });

  it('needs every signal a route reads named in its waitFor, and every waited fact known', () => {
    const context = { ...sandbox, signalCollect: ['inquiry/bot_score'] };
    expect(
      codes(
        context,
        branchFlow([route('a', { '>': [v('signals.inquiry/bot_score'), 50] }, 'else')]),
      ),
    ).toEqual([['error', 'signal_wait_missing', '/steps/2/routes/0/condition/>/0/var']]);
    expect(
      codes(
        context,
        branchFlow([route('a', { '===': [v('session.resumed'), true] })], {
          waitFor: { facts: ['session.nope'], maxSeconds: 3 },
        }),
      ),
    ).toEqual([['error', 'scope_path_unknown', '/steps/2/waitFor/facts/0']]);
  });
});

describe('flowScopeAt (C150.2, C150.10)', () => {
  it('describes each concrete path with its source, tier, stage and availability', () => {
    const flow = adverse();
    const paths = new Map(
      flowScopeAt(flow, 'country_route', { signalCollect: ['inquiry/bot_score'] }).paths.map(
        (path) => [path.path, path],
      ),
    );
    expect(paths.get('verifications.id_card.status')).toMatchObject({
      nullable: false,
      outcome: true,
      source: 'verification',
    });
    expect(paths.get('verifications.proof.status')).toMatchObject({ nullable: true });
    expect(paths.get('verifications.id_card.age-years')).toMatchObject({
      pii: true,
      tier: 'R/H',
      stage: 'beta',
      outcome: false,
    });
    expect(paths.get('verifications.id_card.checks.id_barcode_detection.status')).toMatchObject({
      nullable: true,
      source: 'verification',
    });
    expect(paths.get('signals.inquiry/bot_score')).toMatchObject({
      tier: 'H',
      stage: 'beta',
      source: 'client',
      availableInFlow: true,
    });
    expect(paths.get('signals.inquiry/vpn_detected')).toMatchObject({
      source: 'server',
      availableInFlow: false,
    });
    expect(paths.get('device.kind')).toMatchObject({ source: 'client', nullable: true });
    expect([...paths.keys()].some((path) => path.includes('<'))).toBe(false);
  });
});
