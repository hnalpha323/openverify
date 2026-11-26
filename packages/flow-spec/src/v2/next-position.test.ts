import { CHECK_ERROR_REASONS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  FLOW_LOOP_LIMITS,
  FLOW_STEP_NOTES,
  checkScopeStatus,
  flowOutcome,
  nextPosition,
  resumeAt,
  type FlowStepRecordEntry,
} from './next-position.js';
import { testEvaluator } from './test-evaluator.js';
import {
  action,
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

const evaluate = testEvaluator();

const linear = flowOf(
  [consent(), governmentId(), document(), selfie(), completion(), failure()],
  [
    ['consent', 'next', 'id_card'],
    ['id_card', 'next', 'face'],
    ['id_card', 'exhausted', 'proof'],
    ['proof', 'next', 'face'],
    ['face', 'next', 'done'],
  ],
);

describe('nextPosition: the walk (C151.2)', () => {
  it('follows the exited port to the next step a person sees', () => {
    expect(nextPosition(linear, {}, 'consent', 'next', evaluate)).toEqual({
      kind: 'step',
      stepId: 'id_card',
      taken: [],
    });
    expect(nextPosition(linear, {}, 'id_card', 'exhausted', evaluate)).toEqual({
      kind: 'step',
      stepId: 'proof',
      taken: [],
    });
    expect(nextPosition(linear, {}, 'face', 'next', evaluate)).toEqual({
      kind: 'terminal',
      stepId: 'done',
      terminal: 'completion',
      taken: [],
    });
  });

  it('halts, never guesses, when the exited port has no edge', () => {
    expect(nextPosition(linear, {}, 'face', 'exhausted', evaluate)).toEqual({
      kind: 'halted',
      reason: 'edge_missing',
      stepId: 'face',
      taken: [],
    });
    expect(nextPosition(linear, {}, 'gone', 'next', evaluate)).toMatchObject({
      kind: 'halted',
      reason: 'edge_missing',
    });
  });

  it('stops at an action, which the engine runs before walking on from next or error', () => {
    const flow = flowOf(
      [consent(), action('tag', { kind: 'tag_inquiry', add: ['vip'] }), completion(), failure()],
      [
        ['consent', 'next', 'tag'],
        ['tag', 'next', 'done'],
        ['tag', 'error', 'rejected'],
      ],
    );
    expect(nextPosition(flow, {}, 'consent', 'next', evaluate)).toEqual({
      kind: 'action',
      stepId: 'tag',
      taken: [],
    });
    expect(nextPosition(flow, {}, 'tag', 'error', evaluate)).toMatchObject({
      kind: 'terminal',
      terminal: 'failure',
    });
  });
});

describe('nextPosition: branches (C150.1, C150.3, C150.4)', () => {
  const age = v('verifications.id_card.age-years');
  const flowWith = (
    routes: readonly Record<string, unknown>[],
    waitFor?: Record<string, unknown>,
  ) =>
    flowOf(
      [
        governmentId(),
        branch('age_route', routes, waitFor === undefined ? {} : { waitFor }),
        screen('minor_screen', [textInput('guardian', 'guardian'), submit()]),
        screen('senior_screen', [textInput('note', 'note'), submit()]),
        completion(),
      ],
      [
        ['id_card', 'next', 'age_route'],
        ['age_route', 'route:minor', 'minor_screen'],
        ['age_route', 'route:senior', 'senior_screen'],
        ['age_route', 'else', 'done'],
        ['minor_screen', 'next', 'done'],
        ['senior_screen', 'next', 'done'],
      ],
    );
  const routes = (onNull: string | undefined) => [
    route('minor', { '<': [age, 18] }, onNull),
    route('senior', { '>=': [age, 65] }, onNull),
  ];
  const scopeAge = (years: number | null) => ({
    verifications: { id_card: { 'age-years': years } },
  });

  it('takes the first route whose condition holds, in order, else else', () => {
    const flow = flowWith(routes('else'));
    expect(nextPosition(flow, scopeAge(12), 'id_card', 'next', evaluate)).toEqual({
      kind: 'step',
      stepId: 'minor_screen',
      taken: [
        {
          branchId: 'age_route',
          port: 'route:minor',
          onNull: null,
          nullPaths: [],
          review: false,
          notes: [],
        },
      ],
    });
    expect(nextPosition(flow, scopeAge(70), 'id_card', 'next', evaluate)).toMatchObject({
      stepId: 'senior_screen',
      taken: [{ port: 'route:senior' }],
    });
    expect(nextPosition(flow, scopeAge(30), 'id_card', 'next', evaluate)).toMatchObject({
      kind: 'terminal',
      stepId: 'done',
      taken: [{ port: 'else', onNull: null, review: false }],
    });
  });

  it('follows each onNull: else, skip-route, route:<key>, review', () => {
    const nullAge = scopeAge(null);
    expect(
      nextPosition(flowWith(routes('else')), nullAge, 'id_card', 'next', evaluate),
    ).toMatchObject({
      stepId: 'done',
      taken: [
        {
          port: 'else',
          onNull: 'else',
          nullPaths: ['verifications.id_card.age-years'],
          review: false,
        },
      ],
    });
    const skip = flowWith([
      route('minor', { '<': [age, 18] }, 'skip-route'),
      route('senior', { '===': [v('verifications.id_card.status'), 'passed'] }),
    ]);
    expect(
      nextPosition(
        skip,
        { verifications: { id_card: { 'age-years': null, status: 'passed' } } },
        'id_card',
        'next',
        evaluate,
      ),
    ).toMatchObject({ stepId: 'senior_screen', taken: [{ port: 'route:senior', onNull: null }] });
    expect(
      nextPosition(
        flowWith([
          route('minor', { '<': [age, 18] }, 'route:senior'),
          route('senior', { '>=': [age, 65] }),
        ]),
        nullAge,
        'id_card',
        'next',
        evaluate,
      ),
    ).toMatchObject({
      stepId: 'senior_screen',
      taken: [{ port: 'route:senior', onNull: 'route:senior' }],
    });
    expect(
      nextPosition(flowWith(routes('review')), nullAge, 'id_card', 'next', evaluate),
    ).toMatchObject({
      stepId: 'done',
      taken: [{ port: 'else', onNull: 'review', review: true, notes: ['on-null-review'] }],
    });
  });

  it('flags review for a needs_review-class null whatever onNull says (C150.3)', () => {
    const classed = testEvaluator({ reviewClass: ['verifications.id_card.age-years'] });
    expect(
      nextPosition(flowWith(routes('else')), scopeAge(null), 'id_card', 'next', classed),
    ).toMatchObject({
      stepId: 'done',
      taken: [{ port: 'else', onNull: 'else', review: true, notes: ['review-class-null'] }],
    });
  });

  it('treats a null with no onNull as review, failing safe (publish refuses it, on_null_missing)', () => {
    expect(
      nextPosition(flowWith(routes(undefined)), scopeAge(null), 'id_card', 'next', evaluate),
    ).toMatchObject({
      stepId: 'done',
      taken: [{ port: 'else', onNull: 'review', review: true, notes: ['on-null-review'] }],
    });
  });

  it('never follows else for a path the scope no longer has: it halts with scope_path_missing', () => {
    const missing = testEvaluator({ missing: ['verifications.id_card.age-years'] });
    expect(
      nextPosition(flowWith(routes('else')), scopeAge(30), 'id_card', 'next', missing),
    ).toEqual({
      kind: 'halted',
      reason: 'scope_path_missing',
      stepId: 'age_route',
      taken: [],
    });
  });

  it('records every branch passed on the way, in order', () => {
    const flow = flowOf(
      [
        consent(),
        branch('first', [route('a', { '===': [v('device.kind'), 'native'] }, 'else')]),
        branch('second', [route('b', { '===': [v('session.locale'), 'ar'] }, 'skip-route')]),
        completion(),
        failure(),
      ],
      [
        ['consent', 'next', 'first'],
        ['first', 'route:a', 'second'],
        ['first', 'else', 'second'],
        ['second', 'route:b', 'rejected'],
        ['second', 'else', 'done'],
      ],
    );
    const position = nextPosition(
      flow,
      { device: { kind: 'native' }, session: { locale: null } },
      'consent',
      'next',
      evaluate,
    );
    expect(position).toMatchObject({
      kind: 'terminal',
      stepId: 'done',
      taken: [
        { branchId: 'first', port: 'route:a', onNull: null },
        { branchId: 'second', port: 'else', onNull: 'skip-route', nullPaths: ['session.locale'] },
      ],
    });
  });
});

describe('nextPosition: waits (C150.5, C150.9)', () => {
  const bot = v('signals.inquiry/bot_score');
  const flow = flowOf(
    [
      consent(),
      branch('friction', [route('risky', { '>': [bot, 80] }, 'else')], {
        waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 10 },
      }),
      selfie(),
      completion(),
    ],
    [
      ['consent', 'next', 'friction'],
      ['friction', 'route:risky', 'face'],
      ['friction', 'else', 'done'],
      ['face', 'next', 'done'],
    ],
  );

  it('waits while a named fact is null', () => {
    expect(nextPosition(flow, { signals: {} }, 'consent', 'next', evaluate)).toEqual({
      kind: 'wait',
      stepId: 'friction',
      facts: ['signals.inquiry/bot_score'],
      maxSeconds: 10,
      taken: [],
    });
  });

  it('routes at once when every named fact is there', () => {
    expect(
      nextPosition(flow, { signals: { 'inquiry/bot_score': 90 } }, 'consent', 'next', evaluate),
    ).toMatchObject({ kind: 'step', stepId: 'face', taken: [{ port: 'route:risky' }] });
  });

  it('resumes at the waiting branch once its wait is over, nulls following onNull', () => {
    expect(
      resumeAt(flow, { signals: {} }, 'friction', evaluate, { waited: ['friction'] }),
    ).toMatchObject({
      kind: 'terminal',
      stepId: 'done',
      taken: [{ port: 'else', onNull: 'else' }],
    });
    expect(
      resumeAt(flow, { signals: { 'inquiry/bot_score': 95 } }, 'friction', evaluate),
    ).toMatchObject({ kind: 'step', stepId: 'face' });
    expect(resumeAt(flow, { signals: {} }, 'friction', evaluate)).toMatchObject({
      kind: 'wait',
      stepId: 'friction',
    });
  });

  it('resumes at a step a person sees as that step, and at an unknown step as halted', () => {
    expect(resumeAt(flow, {}, 'face', evaluate)).toEqual({
      kind: 'step',
      stepId: 'face',
      taken: [],
    });
    expect(resumeAt(flow, {}, 'gone', evaluate)).toMatchObject({
      kind: 'halted',
      reason: 'edge_missing',
    });
  });
});

describe('nextPosition: the visit caps (C151.2)', () => {
  const loop = flowOf(
    [
      screen('form', [textInput('name', 'name'), submit()]),
      branch('check', [route('again', { '===': [v('inquiry.fields.name'), null] }, 'else')]),
      completion(),
    ],
    [
      ['form', 'next', 'check'],
      ['check', 'route:again', 'form'],
      ['check', 'else', 'done'],
    ],
  );

  it('states its caps', () => {
    expect(FLOW_LOOP_LIMITS).toEqual({ entriesPerStep: 20, moves: 200 });
  });

  it('halts with flow_loop_limit on the 21st entry of one step', () => {
    const scope = { inquiry: { fields: { name: null } } };
    expect(
      nextPosition(loop, scope, 'form', 'next', evaluate, { visits: { form: 20, check: 19 } }),
    ).toMatchObject({ kind: 'halted', reason: 'flow_loop_limit', stepId: 'form' });
    expect(
      nextPosition(loop, scope, 'form', 'next', evaluate, { visits: { form: 19, check: 19 } }),
    ).toMatchObject({ kind: 'step', stepId: 'form' });
    expect(
      nextPosition(loop, scope, 'form', 'next', evaluate, { visits: { check: 20 } }),
    ).toMatchObject({ kind: 'halted', reason: 'flow_loop_limit', stepId: 'check' });
  });

  it('halts with flow_loop_limit past 200 moves', () => {
    expect(
      nextPosition(loop, {}, 'check', 'else', evaluate, { moves: FLOW_LOOP_LIMITS.moves }),
    ).toMatchObject({ kind: 'halted', reason: 'flow_loop_limit', stepId: 'done' });
    expect(
      nextPosition(loop, {}, 'check', 'else', evaluate, { moves: FLOW_LOOP_LIMITS.moves - 1 }),
    ).toMatchObject({ kind: 'terminal', stepId: 'done' });
  });

  it('halts a loop of branches with no step in between, within one walk', () => {
    const spin = flowOf(
      [
        consent(),
        branch('a', [route('x', { '===': [v('session.resumed'), true] }, 'else')]),
        branch('b', [route('y', { '===': [v('session.resumed'), true] }, 'else')]),
        completion(),
      ],
      [
        ['consent', 'next', 'a'],
        ['a', 'route:x', 'b'],
        ['a', 'else', 'done'],
        ['b', 'route:y', 'a'],
        ['b', 'else', 'done'],
      ],
    );
    const position = nextPosition(
      spin,
      { session: { resumed: true } },
      'consent',
      'next',
      evaluate,
    );
    expect(position).toMatchObject({ kind: 'halted', reason: 'flow_loop_limit' });
    expect(position.taken).toHaveLength(40);
  });
});

describe('checkScopeStatus (C150.2, H03)', () => {
  it('reads a decided check as its status', () => {
    expect(checkScopeStatus('passed', [])).toBe('passed');
    expect(checkScopeStatus('failed', ['id_expired'])).toBe('failed');
    expect(checkScopeStatus('not_applicable', ['not_us_licence'])).toBe('not_applicable');
  });

  it('reads a pending check and an errored one as null, never "not failed"', () => {
    expect(checkScopeStatus('pending', [])).toBeNull();
    for (const reason of [...CHECK_ERROR_REASONS, 'watchlist_unavailable']) {
      expect(checkScopeStatus('not_applicable', [reason])).toBeNull();
      expect(checkScopeStatus('not_applicable', ['other', reason])).toBeNull();
    }
    expect(checkScopeStatus('weird', [])).toBeNull();
  });
});

describe('H03 golden: an errored advisory check never takes a "not failed" route', () => {
  const statusPath = 'verifications.id_card.checks.id_barcode_detection.status';
  const conditions = {
    'not-equal': { '!==': [v(statusPath), 'failed'] },
    'negated-equal': { '!': [{ '===': [v(statusPath), 'failed'] }] },
    'negated-equal-loose': { '!': { '==': [v(statusPath), 'failed'] } },
  };
  const reasons = [...CHECK_ERROR_REASONS, 'aamva_unavailable'];

  it.each(Object.entries(conditions))(
    '%s, for every reason class and onNull',
    (_name, condition) => {
      for (const onNull of ['else', 'skip-route', 'review']) {
        const flow = flowOf(
          [
            governmentId(),
            branch('easy', [route('not_failed', condition, onNull)]),
            completion('fast'),
            selfie(),
            completion(),
          ],
          [
            ['id_card', 'next', 'easy'],
            ['easy', 'route:not_failed', 'fast'],
            ['easy', 'else', 'face'],
            ['face', 'next', 'done'],
          ],
        );
        for (const reason of reasons) {
          const status = checkScopeStatus('not_applicable', [reason]);
          const scope = {
            verifications: { id_card: { checks: { id_barcode_detection: { status } } } },
          };
          const position = nextPosition(flow, scope, 'id_card', 'next', evaluate);
          expect(position, `${reason} with onNull ${onNull}`).toMatchObject({
            kind: 'step',
            stepId: 'face',
          });
          expect(position.taken[0]?.port).toBe('else');
          expect(position.taken[0]?.nullPaths).toEqual([statusPath]);
        }
        // The same route with the check decided passed is taken: the test can tell the two apart.
        const passed = nextPosition(
          flow,
          {
            verifications: { id_card: { checks: { id_barcode_detection: { status: 'passed' } } } },
          },
          'id_card',
          'next',
          evaluate,
        );
        expect(passed).toMatchObject({ kind: 'terminal', stepId: 'fast' });
      }
    },
  );
});

describe('flowOutcome (C151.3, review H16)', () => {
  const entry = (
    stepId: string,
    stepType: string,
    exitPort: string | null = 'next',
    notes: readonly string[] = [],
  ): FlowStepRecordEntry => ({ stepId, stepType, exitPort, notes });

  const path = [
    entry('consent', 'consent'),
    entry('id_card', 'government_id'),
    entry('face', 'selfie'),
    entry('done', 'completion', null),
  ];

  it('completes at a completion step with every entered verification decided and passed', () => {
    expect(flowOutcome(path, { id_card: 'passed', face: 'skipped' }, [])).toEqual({
      status: 'completed',
      outcome: {
        verificationTypesOnPath: ['government-id', 'selfie'],
        fallbacksTaken: [],
        flags: [],
      },
    });
  });

  it('names the verification types in the API’s spelling, once each, in path order', () => {
    const contact = [
      entry('phone', 'phone_otp'),
      entry('email', 'email_otp'),
      entry('chip', 'nfc'),
      entry('done', 'completion', null),
    ];
    expect(
      flowOutcome(contact, { phone: 'passed', email: 'passed', chip: 'passed' }, []).outcome
        .verificationTypesOnPath,
    ).toEqual(['phone-number', 'email-address', 'government-id-nfc']);
  });

  it('flags a completion through no verification (unverified-path)', () => {
    expect(
      flowOutcome([entry('consent', 'consent'), entry('done', 'completion', null)], {}, []),
    ).toEqual({
      status: 'completed',
      outcome: { verificationTypesOnPath: [], fallbacksTaken: [], flags: ['unverified-path'] },
    });
  });

  it('stays pending until the completion step, and while an entered verification is undecided', () => {
    expect(flowOutcome(path.slice(0, 3), { id_card: 'passed' }, []).status).toBe('pending');
    expect(flowOutcome(path, { id_card: 'passed', face: 'submitted' }, []).status).toBe('pending');
    expect(flowOutcome(path, { id_card: 'passed' }, []).status).toBe('pending');
  });

  it('fails at a failure step, and when a verification ends without passing and no fallback', () => {
    expect(
      flowOutcome([entry('consent', 'consent'), entry('rejected', 'failure', null)], {}, []).status,
    ).toBe('failed');
    expect(
      flowOutcome(
        [entry('consent', 'consent'), entry('id_card', 'government_id', null)],
        { id_card: 'failed' },
        [],
      ).status,
    ).toBe('failed');
    // Never counted passed whatever follows: a failed verification exited through next still fails.
    expect(flowOutcome(path, { id_card: 'failed', face: 'passed' }, []).status).toBe('failed');
  });

  it('sends a path through a fallback to review, unless the step said continue', () => {
    const fallback = [
      entry('consent', 'consent'),
      entry('id_card', 'government_id', 'exhausted'),
      entry('proof', 'document'),
      entry('done', 'completion', null),
    ];
    expect(flowOutcome(fallback, { id_card: 'failed', proof: 'passed' }, [])).toEqual({
      status: 'needs_review',
      outcome: {
        verificationTypesOnPath: ['government-id', 'document'],
        fallbacksTaken: ['id_card'],
        flags: [],
      },
    });
    const continued = fallback.map((step) =>
      step.stepId === 'id_card' ? { ...step, notes: [FLOW_STEP_NOTES.fallbackContinue] } : step,
    );
    expect(flowOutcome(continued, { id_card: 'failed', proof: 'passed' }, [])).toMatchObject({
      status: 'completed',
      outcome: { fallbacksTaken: ['id_card'] },
    });
  });

  it('goes to review for a verification in review, a flag, and a branch’s review notes', () => {
    expect(flowOutcome(path, { id_card: 'needs_review', face: 'passed' }, []).status).toBe(
      'needs_review',
    );
    expect(
      flowOutcome(path, { id_card: 'passed', face: 'passed' }, ['flag_for_review:velocity']),
    ).toEqual({
      status: 'needs_review',
      outcome: {
        verificationTypesOnPath: ['government-id', 'selfie'],
        fallbacksTaken: [],
        flags: ['flag_for_review:velocity'],
      },
    });
    for (const note of [FLOW_STEP_NOTES.onNullReview, FLOW_STEP_NOTES.reviewClassNull]) {
      const noted = [
        ...path.slice(0, 2),
        entry('route', 'branch', 'else', [note]),
        ...path.slice(2),
      ];
      expect(flowOutcome(noted, { id_card: 'passed', face: 'passed' }, [])).toMatchObject({
        status: 'needs_review',
        outcome: { flags: [note] },
      });
    }
  });

  it('ends the person’s part in review at scope_path_missing, and stays pending when halted', () => {
    expect(
      flowOutcome(
        [entry('consent', 'consent'), entry('route', 'branch', null, ['scope_path_missing'])],
        {},
        [],
      ),
    ).toEqual({
      status: 'needs_review',
      outcome: { verificationTypesOnPath: [], fallbacksTaken: [], flags: ['scope_path_missing'] },
    });
    expect(
      flowOutcome(
        [entry('form', 'screen'), entry('form', 'screen', null, ['flow_loop_limit'])],
        {},
        [],
      ),
    ).toMatchObject({ status: 'pending', outcome: { flags: ['flow_loop_limit'] } });
  });
});
