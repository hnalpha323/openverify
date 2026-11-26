/**
 * The report risk constants (C81.3, C82; ADR 0002 §3c, §3f): each has a value, a provisional basis
 * and a source, and the values the plan fixes are the ones the rules read.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_RISK_CONSTANTS,
  REPORT_RISK_CONSTANT_NAMES,
  RISK_UNAVAILABLE_REASONS,
  riskConstant,
  type RiskConstantName,
} from './constants.js';

describe('REPORT_RISK_CONSTANTS', () => {
  it('holds exactly the named constants, each provisional with a source', () => {
    expect(Object.keys(REPORT_RISK_CONSTANTS).sort()).toEqual(
      [...REPORT_RISK_CONSTANT_NAMES].sort(),
    );
    for (const name of REPORT_RISK_CONSTANT_NAMES) {
      const constant = REPORT_RISK_CONSTANTS[name];
      expect(constant.basis, name).toBe('provisional');
      expect(constant.source.length, name).toBeGreaterThan(10);
      expect(Number.isFinite(constant.value), name).toBe(true);
      expect(constant.value, name).toBeGreaterThan(0);
    }
  });

  it.each([
    ['email-confidence-list-fact', 0.95],
    ['email-confidence-domain-age', 0.7],
    ['email-confidence-mx-heuristic', 0.5],
    ['email-confidence-accepts-mail', 0.5],
    ['email-breach-window-days', 365],
    ['email-typo-max-edits', 1],
    ['email-dmarc-max-queries', 8],
    ['email-txt-max-length', 4096],
    ['phone-confidence-invalid', 0.95],
    ['phone-confidence-high-risk-type', 0.9],
    ['phone-confidence-voip', 0.7],
    ['phone-confidence-personal', 0.5],
    ['phone-confidence-low-risk-type', 0.5],
    ['phone-confidence-undetermined', 0.3],
    ['phone-sim-swap-high-hours', 24],
    ['phone-sim-swap-medium-hours', 168],
    ['phone-ported-recent-days', 30],
    ['media-confidence-cap', 0.6],
    ['media-title-max-length', 200],
  ] as const)('fixes %s at %d, as the plan states it', (name, value) => {
    expect(riskConstant(name)).toBe(value);
  });

  it.each([
    'email-confidence-role-account',
    'email-confidence-young-domain',
    'email-confidence-breach',
    'email-confidence-typo',
  ] as const)('keeps the medium email reason %s within the plan’s 0.4 to 0.6', (name) => {
    expect(riskConstant(name)).toBeGreaterThanOrEqual(0.4);
    expect(riskConstant(name)).toBeLessThanOrEqual(0.6);
  });

  it.each([
    ['phone-confidence-prepaid', 0.4],
    ['phone-confidence-payphone', 0.4],
  ])(
    'weighs the provider-reported %s as weak evidence, as a recent port (owner decision 14)',
    (name, value) => {
      expect(REPORT_RISK_CONSTANT_NAMES).toContain(name);
      const constant = (REPORT_RISK_CONSTANTS as Readonly<Record<string, { value: number }>>)[name];
      expect(constant?.value).toBe(value);
      expect(constant?.value).toBe(riskConstant('phone-confidence-ported'));
    },
  );

  it('keeps every confidence within [0, 1], and media’s within its 0.6 cap', () => {
    const confidences = REPORT_RISK_CONSTANT_NAMES.filter((name) => name.includes('confidence'));
    expect(confidences.length).toBeGreaterThan(15);
    for (const name of confidences) {
      expect(riskConstant(name), name).toBeLessThanOrEqual(1);
    }
    const weights: RiskConstantName[] = [
      'media-weight-name',
      'media-weight-category',
      'media-weight-recency',
    ];
    expect(weights.reduce((sum, name) => sum + riskConstant(name), 0)).toBeCloseTo(1, 10);
  });

  it('orders the SIM swap windows from the most recent', () => {
    expect(riskConstant('phone-sim-swap-high-hours')).toBeLessThan(
      riskConstant('phone-sim-swap-medium-hours'),
    );
    expect(riskConstant('phone-sim-swap-medium-hours')).toBeLessThan(
      riskConstant('phone-sim-swap-low-hours'),
    );
  });
});

describe('RISK_UNAVAILABLE_REASONS', () => {
  it('names the C69.4 reasons the risk reports use, never list_not_configured', () => {
    expect(RISK_UNAVAILABLE_REASONS).toEqual(
      expect.arrayContaining([
        'provider_not_configured',
        'not_confirmed',
        'not_linked',
        'line_type_undetermined',
        'unsupported_country',
        'undetermined',
        'execution_error',
        'no_adapter',
        'no_documented_method',
      ]),
    );
    expect(RISK_UNAVAILABLE_REASONS).not.toContain('list_not_configured');
  });
});
