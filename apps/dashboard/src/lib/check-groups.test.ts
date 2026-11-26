import type { VerificationCheck } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { checkGroupOf, countByStatus, groupChecks, sendsToReview } from './check-groups';

type Name = VerificationCheck['name'];

function check(
  name: Name,
  status: VerificationCheck['status'],
  requirement: VerificationCheck['requirement'],
  reasons: string[] = [],
): VerificationCheck {
  return { name, status, requirement, reasons, metadata: {} };
}

describe('the group of a check (C37)', () => {
  it.each([
    [
      'a required failure',
      'failed',
      check('id_blur_detection', 'failed', 'required', ['image_blurry']),
    ],
    [
      'a required check without a provider',
      'review',
      check('id_public_figure_detection', 'not_applicable', 'required', [
        'provider_not_configured',
      ]),
    ],
    [
      'a required check whose input is missing',
      'review',
      check('id_mrz_detection', 'not_applicable', 'required', ['input_missing']),
    ],
    [
      'a required check not applicable for no reason',
      'review',
      check('id_glare_detection', 'not_applicable', 'required'),
    ],
    [
      'a required check with a blocking reason beside a non-blocking one',
      'review',
      check('id_mrz_detection', 'not_applicable', 'required', [
        'feature_absent',
        'execution_error',
      ]),
    ],
    ['a required pending check', 'review', check('id_tamper_detection', 'pending', 'required')],
    [
      'an optional failure',
      'advisory-failed',
      check('id_repeat_detection', 'failed', 'not_required', ['id_repeat_detected']),
    ],
    ['a pass', 'other', check('id_glare_detection', 'passed', 'required')],
    [
      'a required check absent from this kind of document',
      'other',
      check('id_barcode_detection', 'not_applicable', 'required', ['feature_absent']),
    ],
    [
      'a required check the flow did not ask for',
      'other',
      check('id_double_side_detection', 'not_applicable', 'required', ['not_requested']),
    ],
    [
      'an optional check without a provider',
      'other',
      check('id_aamva_database_lookup', 'not_applicable', 'not_required', [
        'provider_not_configured',
      ]),
    ],
    ['an optional pending check', 'other', check('id_entity_detection', 'pending', 'not_required')],
  ] as const)('puts %s in %s', (_label, group, value) => {
    expect(checkGroupOf(value)).toBe(group);
    expect(sendsToReview(value)).toBe(group === 'review');
  });
});

describe('groupChecks (C37)', () => {
  it('lists failures, then review, then advisory failures, and keeps the rest apart, each in the API order', () => {
    const passed = check('id_glare_detection', 'passed', 'required');
    const advisory = check('id_repeat_detection', 'failed', 'not_required', ['id_repeat_detected']);
    const review = check('id_public_figure_detection', 'not_applicable', 'required', [
      'provider_not_configured',
    ]);
    const failedFirst = check('id_blur_detection', 'failed', 'required', ['image_blurry']);
    const absent = check('id_barcode_detection', 'not_applicable', 'required', ['feature_absent']);
    const pending = check('id_tamper_detection', 'pending', 'required');
    const failedSecond = check('id_expired_detection', 'failed', 'required', ['expired']);

    const grouped = groupChecks([
      passed,
      advisory,
      review,
      failedFirst,
      absent,
      pending,
      failedSecond,
    ]);

    expect(grouped.attention).toEqual([failedFirst, failedSecond, review, pending, advisory]);
    expect(grouped.other).toEqual([passed, absent]);
  });

  it('has nothing to look at when every check passed or does not apply', () => {
    const checks = [
      check('id_glare_detection', 'passed', 'required'),
      check('id_barcode_detection', 'not_applicable', 'required', ['feature_absent']),
    ];

    expect(groupChecks(checks)).toEqual({ attention: [], other: checks });
  });
});

describe('countByStatus', () => {
  it('counts each status in the order of the check statuses, without zeros', () => {
    expect(
      countByStatus([
        check('id_barcode_detection', 'not_applicable', 'required', ['feature_absent']),
        check('id_glare_detection', 'passed', 'required'),
        check('id_blur_detection', 'passed', 'required'),
        check('id_entity_detection', 'pending', 'not_required'),
      ]),
    ).toEqual([
      { status: 'passed', count: 2 },
      { status: 'not_applicable', count: 1 },
      { status: 'pending', count: 1 },
    ]);
  });

  it('counts nothing in an empty list', () => {
    expect(countByStatus([])).toEqual([]);
  });
});
