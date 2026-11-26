/**
 * C82.2: the `phone-number` report. Numbers are fictional ranges (NANP 555-01xx, ACMA's 0491 570,
 * Ofcom's 020 7946 0 and 07700 900) or numbering-plan ranges, never a person's; provider answers
 * are synthetic.
 */
import type { CheckProvider } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { REFUSED_PHONE_NUMBER_TYPES } from '../../contact/phone-destination.js';
import type { ProviderOutcome } from '../../government-id/inputs.js';
import {
  NETWORK_LINE_TYPES,
  NUMBERING_PLAN_TYPES,
  evaluatePhoneNumberReport,
  phoneRecommendationOf,
  phoneTypeOfNetworkLine,
  phoneTypeOfNumberingPlan,
  type PhoneIntelligenceLookup,
  type PhoneNumberReportInput,
} from './report.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');
const HOUR = 3_600_000;
const SANDBOX: CheckProvider = { id: 'sandbox', sandbox: true };

const lookup = (
  answer: Partial<PhoneIntelligenceLookup> = {},
): ProviderOutcome<PhoneIntelligenceLookup> => ({
  kind: 'result',
  provider: SANDBOX,
  result: {
    lineType: 'mobile',
    carrier: 'Sandbox Mobile',
    simSwap: { checked: true, lastSwapAt: null },
    porting: { checked: true, lastPortedAt: null },
    ...answer,
  },
});
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const run = (overrides: Partial<PhoneNumberReportInput> = {}) =>
  evaluatePhoneNumberReport({
    phoneNumber: '+12025550100',
    now: NOW,
    confirmation: 'not_linked',
    ...overrides,
  });
const risk = (overrides: Partial<PhoneNumberReportInput> = {}) => {
  const { fields } = run(overrides);
  return {
    type: fields['phone-type'],
    level: fields['phone-risk-level'],
    recommendation: fields['phone-risk-recommendation'],
    confidence: fields['phone-risk-confidence'],
    reasons: fields['phone-risk-reasons'],
  };
};
const unavailable = (overrides: Partial<PhoneNumberReportInput> = {}) =>
  Object.fromEntries(run(overrides).unavailableFields.map(({ field, reason }) => [field, reason]));

describe('phoneTypeOfNumberingPlan', () => {
  it.each([
    ['FIXED_LINE', 'FIXED_LINE'],
    ['MOBILE', 'MOBILE'],
    ['FIXED_LINE_OR_MOBILE', null],
    ['TOLL_FREE', 'TOLL_FREE'],
    ['PREMIUM_RATE', 'RESTRICTED_PREMIUM'],
    ['SHARED_COST', 'RESTRICTED_PREMIUM'],
    ['UAN', 'RESTRICTED_PREMIUM'],
    ['VOIP', 'VOIP'],
    ['PERSONAL_NUMBER', 'PERSONAL'],
    ['PAGER', 'PAGER'],
    ['VOICEMAIL', 'VOICEMAIL'],
  ] as const)('maps %s to %s', (plan, type) => {
    expect(phoneTypeOfNumberingPlan(plan)).toBe(type);
  });

  it('maps every numbering-plan type, and never to a type only a carrier knows', () => {
    for (const plan of NUMBERING_PLAN_TYPES) {
      expect(['PREPAID', 'PAYPHONE', 'OTHER', 'INVALID']).not.toContain(
        phoneTypeOfNumberingPlan(plan),
      );
    }
  });
});

describe('the high-risk set (C82.2: the set C55.8 refuses for OTP)', () => {
  it('reads every numbering-plan type Phase 5 refuses to send a code to as a high / block type', () => {
    const highRisk = ['RESTRICTED_PREMIUM', 'TOLL_FREE', 'PAGER', 'VOICEMAIL'];
    for (const plan of REFUSED_PHONE_NUMBER_TYPES) {
      expect(highRisk, plan).toContain(phoneTypeOfNumberingPlan(plan));
    }
  });
});

describe('phoneTypeOfNetworkLine', () => {
  it.each([
    ['landline', 'FIXED_LINE'],
    ['mobile', 'MOBILE'],
    ['fixedVoip', 'FIXED_LINE'],
    ['nonFixedVoip', 'VOIP'],
    ['personal', 'PERSONAL'],
    ['tollFree', 'TOLL_FREE'],
    ['premium', 'RESTRICTED_PREMIUM'],
    ['sharedCost', 'RESTRICTED_PREMIUM'],
    ['uan', 'RESTRICTED_PREMIUM'],
    ['voicemail', 'VOICEMAIL'],
    ['pager', 'PAGER'],
    ['prepaid', 'PREPAID'],
    ['payphone', 'PAYPHONE'],
    ['other', 'OTHER'],
    ['unknown', null],
  ] as const)('maps %s to %s', (network, type) => {
    expect(phoneTypeOfNetworkLine(network)).toBe(type);
  });

  it('covers every network line type', () => {
    expect(NETWORK_LINE_TYPES).toHaveLength(15);
  });
});

describe('phoneRecommendationOf', () => {
  it.each([
    ['low', 'allow'],
    ['medium-low', 'allow'],
    ['medium', 'flag'],
    ['medium-high', 'block'],
    ['high', 'block'],
  ] as const)('recommends %s as %s (the public band mapping)', (level, recommendation) => {
    expect(phoneRecommendationOf(level)).toBe(recommendation);
  });
});

describe('evaluatePhoneNumberReport: the numbering plan alone', () => {
  it('reads an ordinary US number as undetermined: no phone-type, low / allow at 0.3 (decision 51)', () => {
    expect(run()).toEqual({
      fields: {
        'phone-country-code': 'US',
        'phone-is-possible': true,
        'phone-is-valid': true,
        'phone-type': null,
        'phone-type-numbering-plan': 'FIXED_LINE_OR_MOBILE',
        'phone-network-line-type': null,
        'phone-carrier': null,
        'phone-risk-level': 'low',
        'phone-risk-recommendation': 'allow',
        'phone-risk-confidence': 0.3,
        'phone-risk-reasons': ['line_type_undetermined'],
        'phone-risk-score': null,
        'phone-risk-sim-swap': null,
        'phone-ported-recently': null,
        'phone-reachable-at-otp': null,
      },
      unavailableFields: [
        { field: 'phone-type', reason: 'line_type_undetermined' },
        { field: 'phone-network-line-type', reason: 'provider_not_configured' },
        { field: 'phone-carrier', reason: 'provider_not_configured' },
        { field: 'phone-risk-score', reason: 'no_documented_method' },
        { field: 'phone-risk-sim-swap', reason: 'provider_not_configured' },
        { field: 'phone-ported-recently', reason: 'provider_not_configured' },
        { field: 'phone-reachable-at-otp', reason: 'not_linked' },
      ],
      details: {
        'line-type-source': null,
        provider: null,
        'reason-confidences': { line_type_undetermined: 0.3 },
      },
    });
  });

  it.each([
    ['+61491570156', 'MOBILE', 'low', 'allow', 0.5, 'low_risk_type'],
    ['+442079460123', 'FIXED_LINE', 'low', 'allow', 0.5, 'low_risk_type'],
    ['+15005550006', 'PERSONAL', 'medium-low', 'allow', 0.5, 'personal_number'],
    ['+445612345678', 'VOIP', 'medium-high', 'block', 0.7, 'voip'],
    ['+18005550100', 'TOLL_FREE', 'high', 'block', 0.9, 'high_risk_type'],
    ['+19005550100', 'RESTRICTED_PREMIUM', 'high', 'block', 0.9, 'high_risk_type'],
    ['+445512345678', 'RESTRICTED_PREMIUM', 'high', 'block', 0.9, 'high_risk_type'],
    ['+447640123456', 'PAGER', 'high', 'block', 0.9, 'high_risk_type'],
    ['+447700900123', 'INVALID', 'high', 'block', 0.95, 'invalid_number'],
  ] as const)(
    'reads %s as %s: %s / %s at %d',
    (phoneNumber, type, level, recommendation, confidence, reason) => {
      expect(risk({ phoneNumber })).toEqual({
        type,
        level,
        recommendation,
        confidence,
        reasons: [reason],
      });
    },
  );

  it('reads an invalid number’s region and plan type as unknown', () => {
    const invalid = run({ phoneNumber: '+447700900123' });
    expect(invalid.fields['phone-is-possible']).toBe(true);
    expect(invalid.fields['phone-is-valid']).toBe(false);
    expect(invalid.fields['phone-country-code']).toBeNull();
    expect(invalid.fields['phone-type-numbering-plan']).toBeNull();
    expect(unavailable({ phoneNumber: '+447700900123' })).toEqual(
      expect.objectContaining({
        'phone-country-code': 'undetermined',
        'phone-type-numbering-plan': 'undetermined',
      }),
    );
  });

  it('reads a value libphonenumber cannot parse as neither possible nor valid: INVALID', () => {
    const report = run({ phoneNumber: '+12' });
    expect(report.fields['phone-is-possible']).toBe(false);
    expect(report.fields['phone-is-valid']).toBe(false);
    expect(report.fields['phone-type']).toBe('INVALID');
    expect(run({ phoneNumber: '2025550100' }).fields['phone-type']).toBe('INVALID');
  });

  it('reads a non-geographic number without a region', () => {
    const report = run({ phoneNumber: '+80012345678' });
    expect(report.fields['phone-country-code']).toBeNull();
    expect(report.fields['phone-type']).toBe('TOLL_FREE');
    expect(unavailable({ phoneNumber: '+80012345678' })['phone-country-code']).toBe('undetermined');
  });

  it('never synthesises a score, and reads reachability only from a confirmed OTP', () => {
    expect(run({ confirmation: 'confirmed' }).fields['phone-reachable-at-otp']).toBe(true);
    expect(run({ confirmation: 'not_confirmed' }).fields['phone-reachable-at-otp']).toBeNull();
    expect(unavailable({ confirmation: 'not_confirmed' })['phone-reachable-at-otp']).toBe(
      'not_confirmed',
    );
    expect(run({ provider: lookup() }).fields['phone-risk-score']).toBeNull();
  });
});

describe('evaluatePhoneNumberReport: a bound provider', () => {
  it('replaces the plan’s type with the network’s, and reports the carrier, swap and port', () => {
    const report = run({ provider: lookup() });
    expect(report.fields).toEqual(
      expect.objectContaining({
        'phone-type': 'MOBILE',
        'phone-type-numbering-plan': 'FIXED_LINE_OR_MOBILE',
        'phone-network-line-type': 'mobile',
        'phone-carrier': 'Sandbox Mobile',
        'phone-risk-level': 'low',
        'phone-risk-confidence': 0.5,
        'phone-risk-reasons': ['low_risk_type'],
        'phone-risk-sim-swap': 'very-low',
        'phone-ported-recently': false,
      }),
    );
    expect(report.details).toEqual({
      'line-type-source': 'network',
      provider: SANDBOX,
      'reason-confidences': { low_risk_type: 0.5 },
    });
  });

  it('reads non-fixed VoIP as VOIP, medium-high / block', () => {
    expect(risk({ provider: lookup({ lineType: 'nonFixedVoip' }) })).toEqual({
      type: 'VOIP',
      level: 'medium-high',
      recommendation: 'block',
      confidence: 0.7,
      reasons: ['voip'],
    });
  });

  it('keeps the plan’s answer when the network type is unknown', () => {
    expect(risk({ provider: lookup({ lineType: 'unknown' }) }).reasons).toEqual([
      'line_type_undetermined',
    ]);
    expect(risk({ provider: lookup({ lineType: null }) }).type).toBeNull();
    expect(unavailable({ provider: lookup({ lineType: null }) })['phone-network-line-type']).toBe(
      'undetermined',
    );
  });

  it('reads a SIM swap within 24 h as high, within 7 days as medium-high (the worst level wins)', () => {
    expect(
      risk({ provider: lookup({ simSwap: { checked: true, lastSwapAt: hoursAgo(3) } }) }),
    ).toEqual({
      type: 'MOBILE',
      level: 'high',
      recommendation: 'block',
      confidence: 0.8,
      reasons: ['low_risk_type', 'sim_swap_24h'],
    });
    expect(
      risk({ provider: lookup({ simSwap: { checked: true, lastSwapAt: hoursAgo(72) } }) }),
    ).toEqual({
      type: 'MOBILE',
      level: 'medium-high',
      recommendation: 'block',
      confidence: 0.6,
      reasons: ['low_risk_type', 'sim_swap_7d'],
    });
  });

  it.each([
    [3, 'high'],
    [72, 'medium'],
    [480, 'low'],
    [960, 'very-low'],
  ] as const)('reads a SIM swap %d hours ago as phone-risk-sim-swap %s', (hours, level) => {
    const report = run({
      provider: lookup({ simSwap: { checked: true, lastSwapAt: hoursAgo(hours) } }),
    });
    expect(report.fields['phone-risk-sim-swap']).toBe(level);
  });

  it('reads a port within 30 days as medium / flag', () => {
    const ported = lookup({ porting: { checked: true, lastPortedAt: hoursAgo(240) } });
    expect(run({ provider: ported }).fields['phone-ported-recently']).toBe(true);
    expect(risk({ provider: ported })).toEqual({
      type: 'MOBILE',
      level: 'medium',
      recommendation: 'flag',
      confidence: 0.4,
      reasons: ['low_risk_type', 'ported_30d'],
    });
    expect(
      run({ provider: lookup({ porting: { checked: true, lastPortedAt: hoursAgo(1440) } }) })
        .fields['phone-ported-recently'],
    ).toBe(false);
  });

  it('reads a package the provider did not check as N/A or unknown, never as clear', () => {
    const unchecked = lookup({ simSwap: { checked: false }, porting: { checked: false } });
    expect(run({ provider: unchecked }).fields['phone-risk-sim-swap']).toBe('N/A');
    expect(run({ provider: unchecked }).fields['phone-ported-recently']).toBeNull();
    expect(unavailable({ provider: unchecked })['phone-ported-recently']).toBe('undetermined');
  });

  it('reads a provider-reported prepaid or payphone line as medium / flag (owner decision 14)', () => {
    expect(risk({ provider: lookup({ lineType: 'prepaid' }) })).toEqual({
      type: 'PREPAID',
      level: 'medium',
      recommendation: 'flag',
      confidence: 0.4,
      reasons: ['prepaid'],
    });
    expect(risk({ provider: lookup({ lineType: 'payphone' }) })).toEqual({
      type: 'PAYPHONE',
      level: 'medium',
      recommendation: 'flag',
      confidence: 0.4,
      reasons: ['payphone'],
    });
    expect(unavailable({ provider: lookup({ lineType: 'prepaid' }) })).not.toHaveProperty(
      'phone-risk-level',
    );
    const swapped = lookup({
      lineType: 'prepaid',
      simSwap: { checked: true, lastSwapAt: hoursAgo(2) },
    });
    expect(risk({ provider: swapped })).toEqual({
      type: 'PREPAID',
      level: 'high',
      recommendation: 'block',
      confidence: 0.8,
      reasons: ['prepaid', 'sim_swap_24h'],
    });
    const ported = lookup({
      lineType: 'payphone',
      porting: { checked: true, lastPortedAt: hoursAgo(240) },
    });
    expect(risk({ provider: ported })).toEqual({
      type: 'PAYPHONE',
      level: 'medium',
      recommendation: 'flag',
      confidence: 0.4,
      reasons: ['payphone', 'ported_30d'],
    });
  });

  it('states other_line_type and leaves the level null unless a SIM swap reaches high', () => {
    expect(risk({ provider: lookup({ lineType: 'other' }) })).toEqual({
      type: 'OTHER',
      level: null,
      recommendation: null,
      confidence: null,
      reasons: ['other_line_type'],
    });
    expect(unavailable({ provider: lookup({ lineType: 'other' }) })).toEqual(
      expect.objectContaining({
        'phone-risk-level': 'undetermined',
        'phone-risk-recommendation': 'undetermined',
        'phone-risk-confidence': 'undetermined',
      }),
    );
    expect(run({ provider: lookup({ lineType: 'other' }) }).details['reason-confidences']).toEqual(
      {},
    );
    expect(
      risk({
        provider: lookup({
          lineType: 'other',
          simSwap: { checked: true, lastSwapAt: hoursAgo(2) },
        }),
      }),
    ).toEqual({
      type: 'OTHER',
      level: 'high',
      recommendation: 'block',
      confidence: 0.8,
      reasons: ['other_line_type', 'sim_swap_24h'],
    });
    for (const answer of [
      { simSwap: { checked: true, lastSwapAt: hoursAgo(48) } },
      { porting: { checked: true, lastPortedAt: hoursAgo(240) } },
    ] as const) {
      expect(risk({ provider: lookup({ lineType: 'other', ...answer }) }).level).toBeNull();
    }
  });

  it('never answers low on a provider failure; a high already reached stands', () => {
    expect(risk({ provider: { kind: 'error' } })).toEqual({
      type: null,
      level: null,
      recommendation: null,
      confidence: null,
      reasons: ['line_type_undetermined'],
    });
    expect(unavailable({ provider: { kind: 'error' } })).toEqual(
      expect.objectContaining({
        'phone-network-line-type': 'execution_error',
        'phone-carrier': 'execution_error',
        'phone-risk-sim-swap': 'execution_error',
        'phone-ported-recently': 'execution_error',
        'phone-risk-level': 'execution_error',
        'phone-risk-recommendation': 'execution_error',
        'phone-risk-confidence': 'execution_error',
      }),
    );
    expect(risk({ phoneNumber: '+447700900123', provider: { kind: 'error' } }).level).toBe('high');
    expect(risk({ provider: { kind: 'not_configured' } }).level).toBe('low');
  });
});
