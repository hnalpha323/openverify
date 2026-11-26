import { describe, expect, it } from 'vitest';
import { listChecks } from './check-registry.js';
import type { CheckResult } from './check-result.js';
import {
  InvalidDecisionInputError,
  NON_BLOCKING_NOT_APPLICABLE_REASONS,
  VERIFICATION_DECISION_STATUSES,
  decideVerification,
  defaultTemplateConfig,
  verificationTemplateConfigSchema,
  type VerificationTemplateConfig,
} from './decision-engine.js';
import { VERIFICATION_TYPES, type CheckStatus, type CheckType } from './enums.js';
import { DomainError } from './errors.js';

function result(
  name: string,
  status: CheckStatus,
  type: CheckType = 'fraud',
  reasons: string[] = [],
): CheckResult {
  return {
    name,
    status,
    type,
    reasons,
    metadata: {},
    stage: 'ga',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: {} },
  };
}

const REQUIRED = { enabled: true, required: true } as const;
const OPTIONAL = { enabled: true, required: false } as const;
const DISABLED = { enabled: false, required: false } as const;

function config(checks: VerificationTemplateConfig['checks']): VerificationTemplateConfig {
  return { checks };
}

describe('decideVerification', () => {
  it('passes when every required and enabled check passed', () => {
    const decision = decideVerification(
      [result('id_blur_detection', 'passed'), result('id_expired_detection', 'passed')],
      config({ id_blur_detection: REQUIRED, id_expired_detection: REQUIRED }),
    );
    expect(decision).toEqual({
      status: 'passed',
      failingCheckIds: [],
      pendingCheckIds: [],
      reviewCheckIds: [],
      advisoryFailedCheckIds: [],
      hints: [],
      retryable: false,
    });
  });

  it('fails when any required and enabled check failed', () => {
    const decision = decideVerification(
      [result('id_blur_detection', 'passed'), result('id_expired_detection', 'failed')],
      config({ id_blur_detection: REQUIRED, id_expired_detection: REQUIRED }),
    );
    expect(decision.status).toBe('failed');
    expect(decision.failingCheckIds).toEqual(['id_expired_detection']);
  });

  it('sends a verification with a pending required check to review (C30.1)', () => {
    const decision = decideVerification(
      [result('id_blur_detection', 'passed'), result('id_selfie_comparison', 'pending')],
      config({ id_blur_detection: REQUIRED, id_selfie_comparison: REQUIRED }),
    );
    expect(decision.status).toBe('needs_review');
    expect(decision.pendingCheckIds).toEqual(['id_selfie_comparison']);
    expect(decision.failingCheckIds).toEqual([]);
  });

  it('stays pending only when the caller says more results will come (C30.1)', () => {
    const decision = decideVerification(
      [result('id_blur_detection', 'passed'), result('id_selfie_comparison', 'pending')],
      config({ id_blur_detection: REQUIRED, id_selfie_comparison: REQUIRED }),
      { moreResultsExpected: true },
    );
    expect(decision.status).toBe('pending');
    expect(decision.pendingCheckIds).toEqual(['id_selfie_comparison']);
    expect(
      decideVerification(
        [result('id_blur_detection', 'passed')],
        config({ id_blur_detection: REQUIRED }),
        { moreResultsExpected: true },
      ).status,
    ).toBe('passed');
  });

  it('treats a required check without a result as needing review, never as passed', () => {
    const decision = decideVerification(
      [result('id_blur_detection', 'passed')],
      config({ id_blur_detection: REQUIRED, id_glare_detection: REQUIRED }),
    );
    expect(decision.status).toBe('needs_review');
    expect(decision.pendingCheckIds).toEqual(['id_glare_detection']);
  });

  it('lets a definitive failure win over pending checks', () => {
    const decision = decideVerification(
      [result('id_expired_detection', 'failed'), result('id_selfie_comparison', 'pending')],
      config({ id_expired_detection: REQUIRED, id_selfie_comparison: REQUIRED }),
    );
    expect(decision.status).toBe('failed');
    expect(decision.failingCheckIds).toEqual(['id_expired_detection']);
    expect(decision.pendingCheckIds).toEqual(['id_selfie_comparison']);
  });

  it('never fails on not_applicable', () => {
    const decision = decideVerification(
      [
        result('id_barcode_detection', 'not_applicable', 'user_behavior', ['input_missing']),
        result('id_blur_detection', 'passed'),
      ],
      config({ id_barcode_detection: REQUIRED, id_blur_detection: REQUIRED }),
    );
    expect(decision.status).not.toBe('failed');
    expect(decision.failingCheckIds).toEqual([]);
  });

  it('passes when a required check passed and the others are not_applicable for a non-blocking reason (C30.2)', () => {
    const decision = decideVerification(
      [
        result('id_blur_detection', 'passed'),
        result('id_barcode_detection', 'not_applicable', 'user_behavior', ['feature_absent']),
        result('id_double_side_detection', 'not_applicable', 'user_behavior', ['not_requested']),
      ],
      config({
        id_blur_detection: REQUIRED,
        id_barcode_detection: REQUIRED,
        id_double_side_detection: REQUIRED,
      }),
    );
    expect(decision).toMatchObject({ status: 'passed', reviewCheckIds: [] });
  });

  it('sends a verification to review when no required check passed, since a non-blocking answer is no evidence (C30.1 amendment, V17)', () => {
    const decision = decideVerification(
      [
        result('id_barcode_detection', 'not_applicable', 'user_behavior', ['feature_absent']),
        result('id_double_side_detection', 'not_applicable', 'user_behavior', ['not_requested']),
      ],
      config({ id_barcode_detection: REQUIRED, id_double_side_detection: REQUIRED }),
    );
    expect(decision).toMatchObject({
      status: 'needs_review',
      reviewCheckIds: ['id_barcode_detection', 'id_double_side_detection'],
      failingCheckIds: [],
      pendingCheckIds: [],
      retryable: false,
    });
  });

  it.each(VERIFICATION_TYPES)(
    'never passes a %s verification on non-blocking answers alone (V17)',
    (type) => {
      const template = defaultTemplateConfig(type);
      const required = Object.entries(template.checks)
        .filter(([, { enabled, required: isRequired }]) => enabled && isRequired)
        .map(([id]) => id);
      expect(required.length, type).toBeGreaterThan(0);
      const nonBlocking = (id: string) =>
        result(id, 'not_applicable', 'fraud', [...NON_BLOCKING_NOT_APPLICABLE_REASONS]);

      expect(decideVerification(required.map(nonBlocking), template)).toMatchObject({
        status: 'needs_review',
        reviewCheckIds: required,
      });
      const [first = '', ...rest] = required;
      expect(
        decideVerification([result(first, 'passed'), ...rest.map(nonBlocking)], template).status,
        type,
      ).toBe('passed');
    },
  );

  it.each([
    ['input_missing', ['input_missing']],
    ['no_reference_data', ['no_reference_data']],
    ['execution_error', ['execution_error']],
    ['provider_not_configured', ['provider_not_configured']],
    ['no reason at all', []],
    ['a non-blocking and a blocking reason', ['feature_absent', 'input_missing']],
  ])(
    'sends a required not_applicable check with %s to review (ADR 0002 §3b)',
    (_label, reasons) => {
      const decision = decideVerification(
        [
          result('id_blur_detection', 'passed'),
          result('id_mrz_detection', 'not_applicable', 'user_behavior', reasons),
        ],
        config({ id_blur_detection: REQUIRED, id_mrz_detection: REQUIRED }),
      );
      expect(decision).toMatchObject({
        status: 'needs_review',
        reviewCheckIds: ['id_mrz_detection'],
        pendingCheckIds: [],
        retryable: false,
      });
    },
  );

  it('lets a failure win over review, and review over a passing required check', () => {
    expect(
      decideVerification(
        [
          result('id_expired_detection', 'failed'),
          result('id_mrz_detection', 'not_applicable', 'user_behavior', ['input_missing']),
          result('id_selfie_comparison', 'pending'),
        ],
        config({
          id_expired_detection: REQUIRED,
          id_mrz_detection: REQUIRED,
          id_selfie_comparison: REQUIRED,
        }),
      ),
    ).toMatchObject({
      status: 'failed',
      failingCheckIds: ['id_expired_detection'],
      reviewCheckIds: ['id_mrz_detection'],
      pendingCheckIds: ['id_selfie_comparison'],
    });
  });

  it('keeps advisory checks out of the decision, whatever their status or reasons', () => {
    const decision = decideVerification(
      [
        result('id_blur_detection', 'passed'),
        result('id_tamper_detection', 'not_applicable', 'fraud', ['execution_error']),
        result('id_handwriting_detection', 'pending'),
      ],
      config({
        id_blur_detection: REQUIRED,
        id_tamper_detection: OPTIONAL,
        id_handwriting_detection: OPTIONAL,
      }),
    );
    expect(decision).toMatchObject({ status: 'passed', reviewCheckIds: [], pendingCheckIds: [] });
  });

  it('sends a template that requires nothing to review: nothing passed (C30.1 amendment, V17)', () => {
    expect(decideVerification([], config({})).status).toBe('needs_review');
    expect(
      decideVerification(
        [result('id_glare_detection', 'failed')],
        config({ id_glare_detection: OPTIONAL }),
      ),
    ).toMatchObject({ status: 'needs_review', advisoryFailedCheckIds: ['id_glare_detection'] });
  });

  it('ignores disabled checks, even when they are marked required', () => {
    const decision = decideVerification(
      [
        result('id_tamper_detection', 'failed'),
        result('id_blur_detection', 'pending'),
        // C30.1 amendment (V17): a passing required check, so only the disabled ones are judged.
        result('id_glare_detection', 'passed'),
      ],
      config({
        id_tamper_detection: { enabled: false, required: true },
        id_blur_detection: DISABLED,
        id_glare_detection: REQUIRED,
      }),
    );
    expect(decision).toMatchObject({
      status: 'passed',
      failingCheckIds: [],
      pendingCheckIds: [],
      advisoryFailedCheckIds: [],
    });
  });

  it('reports failed optional checks as advisory without failing', () => {
    const decision = decideVerification(
      [result('id_blur_detection', 'passed'), result('id_tamper_detection', 'failed')],
      config({ id_blur_detection: REQUIRED, id_tamper_detection: OPTIONAL }),
    );
    expect(decision.status).toBe('passed');
    expect(decision.failingCheckIds).toEqual([]);
    expect(decision.advisoryFailedCheckIds).toEqual(['id_tamper_detection']);
  });

  it('does not wait for optional checks that are pending or missing', () => {
    const decision = decideVerification(
      [result('id_blur_detection', 'passed'), result('id_tamper_detection', 'pending')],
      config({
        id_blur_detection: REQUIRED,
        id_tamper_detection: OPTIONAL,
        id_handwriting_detection: OPTIONAL,
      }),
    );
    expect(decision.status).toBe('passed');
    expect(decision.pendingCheckIds).toEqual([]);
  });

  it('ignores results for checks the template does not configure', () => {
    const decision = decideVerification(
      [result('id_blur_detection', 'passed'), result('id_repeat_detection', 'failed')],
      config({ id_blur_detection: REQUIRED }),
    );
    expect(decision.status).toBe('passed');
    expect(decision.advisoryFailedCheckIds).toEqual([]);
  });

  it('returns user_behavior hints with their reasons for failing checks', () => {
    const decision = decideVerification(
      [
        result('id_blur_detection', 'failed', 'user_behavior', ['image_too_blurry']),
        result('id_glare_detection', 'failed', 'user_behavior', ['glare_on_portrait']),
        result('id_expired_detection', 'failed', 'fraud', ['expired']),
      ],
      config({
        id_blur_detection: REQUIRED,
        id_glare_detection: REQUIRED,
        id_expired_detection: REQUIRED,
      }),
    );
    expect(decision.failingCheckIds).toEqual([
      'id_blur_detection',
      'id_glare_detection',
      'id_expired_detection',
    ]);
    expect(decision.hints).toEqual([
      { checkId: 'id_blur_detection', reasons: ['image_too_blurry'] },
      { checkId: 'id_glare_detection', reasons: ['glare_on_portrait'] },
    ]);
    expect(decision.retryable).toBe(false);
  });

  it('is retryable when only user_behavior checks failed', () => {
    const decision = decideVerification(
      [
        result('id_blur_detection', 'failed', 'user_behavior', ['image_too_blurry']),
        result('id_expired_detection', 'passed'),
      ],
      config({ id_blur_detection: REQUIRED, id_expired_detection: REQUIRED }),
    );
    expect(decision).toMatchObject({ status: 'failed', retryable: true });
  });

  it('gives no hints for advisory user_behavior failures', () => {
    const decision = decideVerification(
      [result('selfie_glasses_detection', 'failed', 'user_behavior', ['glasses_detected'])],
      config({ selfie_glasses_detection: OPTIONAL }),
    );
    expect(decision.hints).toEqual([]);
    expect(decision.retryable).toBe(false);
  });

  it('is not retryable while it needs review or is pending', () => {
    const decision = decideVerification([], config({ id_blur_detection: REQUIRED }));
    expect(decision).toMatchObject({ status: 'needs_review', retryable: false });
    expect(
      decideVerification([], config({ id_blur_detection: REQUIRED }), {
        moreResultsExpected: true,
      }),
    ).toMatchObject({ status: 'pending', retryable: false });
  });

  describe('duplicate results for one check', () => {
    it.each([
      [['passed', 'failed'], 'failed'],
      [['failed', 'passed'], 'failed'],
      [['passed', 'pending'], 'needs_review'],
      [['pending', 'failed'], 'failed'],
      [['not_applicable', 'passed'], 'passed'],
      [['passed', 'not_applicable'], 'passed'],
    ] as const)('merges %j conservatively to %s', (statuses, expected) => {
      const decision = decideVerification(
        statuses.map((status) => result('id_blur_detection', status)),
        config({ id_blur_detection: REQUIRED }),
      );
      expect(decision.status).toBe(expected);
    });

    it('keeps the reasons of every failing duplicate once', () => {
      const decision = decideVerification(
        [
          result('id_blur_detection', 'failed', 'user_behavior', ['image_too_blurry']),
          result('id_blur_detection', 'failed', 'user_behavior', [
            'image_too_blurry',
            'resolution_too_low',
          ]),
        ],
        config({ id_blur_detection: REQUIRED }),
      );
      expect(decision.failingCheckIds).toEqual(['id_blur_detection']);
      expect(decision.hints).toEqual([
        { checkId: 'id_blur_detection', reasons: ['image_too_blurry', 'resolution_too_low'] },
      ]);
    });
  });

  it('lists ids in template configuration order', () => {
    const decision = decideVerification(
      [
        result('id_c_detection', 'failed'),
        result('id_a_detection', 'failed'),
        result('id_b_detection', 'failed'),
      ],
      config({ id_b_detection: REQUIRED, id_a_detection: REQUIRED, id_c_detection: REQUIRED }),
    );
    expect(decision.failingCheckIds).toEqual([
      'id_b_detection',
      'id_a_detection',
      'id_c_detection',
    ]);
  });

  const validConfig: unknown = config({ id_blur_detection: REQUIRED });
  it.each<[string, unknown, unknown]>([
    [
      'an unknown result status',
      [{ ...result('id_blur_detection', 'passed'), status: 'ok' }],
      validConfig,
    ],
    [
      'a result without a name',
      [{ status: 'passed', type: 'fraud', reasons: [], metadata: {} }],
      validConfig,
    ],
    ['a non-array of results', 'passed', validConfig],
    ['a check config missing required', [], { checks: { id_blur_detection: { enabled: true } } }],
    ['a non snake_case check id', [], { checks: { 'Id-Blur': REQUIRED } }],
    ['a missing template config', [], undefined],
  ])('rejects %s with a typed error', (_label, results, templateConfig) => {
    let thrown: unknown;
    try {
      decideVerification(results as CheckResult[], templateConfig as VerificationTemplateConfig);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidDecisionInputError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({ code: 'invalid_decision_input' });
    expect((thrown as InvalidDecisionInputError).issues.length).toBeGreaterThan(0);
  });

  it('drops a __proto__ check id without touching the prototype', () => {
    // zod v4 records skip "__proto__" keys, so JSON input cannot pollute
    // Object.prototype or smuggle in a pseudo-check.
    const templateConfig = JSON.parse(
      '{"checks":{"__proto__":{"enabled":true,"required":true},"id_blur_detection":{"enabled":true,"required":true}}}',
    ) as VerificationTemplateConfig;
    const decision = decideVerification([result('id_blur_detection', 'passed')], templateConfig);
    expect(decision.status).toBe('passed');
    expect(decision.pendingCheckIds).toEqual([]);
    expect(Object.prototype).not.toHaveProperty('enabled');
  });
});

describe('defaultTemplateConfig', () => {
  it('configures every check of the verification type from registry defaults', () => {
    const selfieChecks = listChecks('selfie');
    const template = defaultTemplateConfig('selfie');

    expect(Object.keys(template.checks)).toEqual(selfieChecks.map((check) => check.id));
    for (const check of selfieChecks) {
      expect(template.checks[check.id]).toEqual({
        enabled: check.defaultEnabled,
        required: check.defaultRequired,
      });
    }
  });

  it('feeds straight into decideVerification', () => {
    const template = defaultTemplateConfig('phone_number');
    expect(decideVerification([], template)).toMatchObject({
      status: 'needs_review',
      pendingCheckIds: ['phone_number_otp_comparison'],
    });
    expect(
      decideVerification(
        [result('phone_number_otp_comparison', 'passed', 'user_behavior')],
        template,
      ).status,
    ).toBe('passed');
  });
});

describe('decision statuses and non-blocking reasons (C30.1, C30.2)', () => {
  it('decides passed, failed, needs_review or pending', () => {
    expect(VERIFICATION_DECISION_STATUSES).toEqual(['passed', 'failed', 'needs_review', 'pending']);
  });

  it('lets only feature_absent, not_requested, no_allowlist and chip_auth_not_server_verifiable leave a required check without evidence (C30.2 amendment, C51.2)', () => {
    expect(NON_BLOCKING_NOT_APPLICABLE_REASONS).toEqual([
      'feature_absent',
      'not_requested',
      'no_allowlist',
      'chip_auth_not_server_verifiable',
    ]);
    expect(Object.isFrozen(NON_BLOCKING_NOT_APPLICABLE_REASONS)).toBe(true);
  });
});

describe('type-level template options (C50.4)', () => {
  const accepts = (value: unknown) => verificationTemplateConfigSchema.safeParse(value).success;

  it('takes the chains a crypto wallet template allows, distinct and in canonical CAIP-2 form', () => {
    expect(
      accepts({
        checks: {},
        'allowed-chains': ['eip155:1', 'bip122:000000000019d6689c085ae165831e93'],
      }),
    ).toBe(true);
    expect(accepts({ checks: {}, 'allowed-chains': [] })).toBe(false);
    expect(accepts({ checks: {}, 'allowed-chains': ['eip155:1', 'eip155:1'] })).toBe(false);
    expect(accepts({ checks: {}, 'allowed-chains': ['tron:0x2b6653dc'] })).toBe(false);
    expect(accepts({ checks: {}, 'allowed-chains': ['cosmos:cosmoshub-4'] })).toBe(false);
  });

  it('takes accept-review-without-provider as a boolean', () => {
    expect(accepts({ checks: {}, 'accept-review-without-provider': true })).toBe(true);
    expect(accepts({ checks: {}, 'accept-review-without-provider': false })).toBe(true);
    expect(accepts({ checks: {}, 'accept-review-without-provider': 'yes' })).toBe(false);
  });

  it('still refuses an option it does not know', () => {
    expect(accepts({ checks: {}, 'allowed-currencies': ['USD'] })).toBe(false);
  });
});
