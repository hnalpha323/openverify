import { describe, expect, it } from 'vitest';
import { checkProvenanceSchema, checkResultSchema, reasonCodeSchema } from './check-result.js';

const valid = {
  name: 'id_expired_detection',
  status: 'failed',
  type: 'fraud',
  reasons: ['expired'],
  metadata: { graceDays: 0 },
  stage: 'ga',
  confidence: null,
  provenance: { 'implementation-version': 1, thresholds: { 'grace-days': 0 } },
};

const SHA = 'a'.repeat(64);

describe('checkResultSchema', () => {
  it('accepts a well-formed result', () => {
    expect(checkResultSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ['an unknown status', { status: 'error' }],
    ['an unknown type', { type: 'other' }],
    ['a non-snake_case name', { name: 'IdExpired' }],
    ['a human-readable reason', { reasons: ['The ID has expired.'] }],
    ['missing metadata', { metadata: undefined }],
    ['an unexpected property', { score: 1 }],
  ])('rejects %s', (_label, patch) => {
    expect(checkResultSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('only allows machine-readable snake_case reason codes', () => {
    expect(reasonCodeSchema.safeParse('po_box_detected').success).toBe(true);
    expect(reasonCodeSchema.safeParse('mrz_td1_check_digit_invalid').success).toBe(true);
    expect(reasonCodeSchema.safeParse('PO box').success).toBe(false);
    expect(reasonCodeSchema.safeParse('').success).toBe(false);
  });
});

describe('stage, confidence and provenance (C29.2)', () => {
  it.each(['stage', 'confidence', 'provenance'] as const)('are required: %s', (field) => {
    const value: Record<string, unknown> = { ...valid };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the field under test
    delete value[field];
    expect(checkResultSchema.safeParse(value).success).toBe(false);
  });

  it('accept a confidence in [0, 1] or null', () => {
    for (const confidence of [0, 0.5, 1, null]) {
      expect(
        checkResultSchema.safeParse({ ...valid, confidence }).success,
        String(confidence),
      ).toBe(true);
    }
    for (const confidence of [-0.01, 1.01, Number.NaN, '0.5']) {
      expect(
        checkResultSchema.safeParse({ ...valid, confidence }).success,
        String(confidence),
      ).toBe(false);
    }
  });

  it('accept a full provenance with models, a provider and every kind of threshold', () => {
    const provenance = {
      'implementation-version': 2,
      models: [{ id: 'yunet-2026may', sha256: SHA }],
      provider: { id: 'sandbox', sandbox: true },
      thresholds: {
        'min-blur-score': 100,
        'required-fields': ['name-first', 'birthdate'],
        'allow-po-box': false,
        'name-mode': 'strict',
        // C51.3: a match-group list, the one threshold made of objects.
        'match-groups': [{ name: 'partial', birthdate: 'full' }],
      },
    };
    expect(checkProvenanceSchema.parse(provenance)).toEqual(provenance);
    expect(checkResultSchema.safeParse({ ...valid, provenance }).success).toBe(true);
  });

  it.each([
    ['no implementation version', { thresholds: {} }],
    ['implementation version 0', { 'implementation-version': 0, thresholds: {} }],
    ['no thresholds', { 'implementation-version': 1 }],
    ['a camelCase threshold', { 'implementation-version': 1, thresholds: { minBlurScore: 1 } }],
    ['an object threshold', { 'implementation-version': 1, thresholds: { 'max-x': { a: 1 } } }],
    [
      'a match-group list with a number',
      { 'implementation-version': 1, thresholds: { 'match-groups': [{ name: 1 }] } },
    ],
    [
      'a list mixing names and groups',
      { 'implementation-version': 1, thresholds: { 'match-groups': ['name', { name: 'full' }] } },
    ],
    ['an empty model list', { 'implementation-version': 1, thresholds: {}, models: [] }],
    [
      'a model without a SHA-256',
      { 'implementation-version': 1, thresholds: {}, models: [{ id: 'yunet', sha256: 'abc' }] },
    ],
    [
      'a provider without its sandbox flag',
      { 'implementation-version': 1, thresholds: {}, provider: { id: 'sandbox' } },
    ],
    ['an unknown member', { 'implementation-version': 1, thresholds: {}, extra: 1 }],
  ])('reject a provenance with %s', (_label, provenance) => {
    expect(checkProvenanceSchema.safeParse(provenance).success).toBe(false);
    expect(checkResultSchema.safeParse({ ...valid, provenance }).success).toBe(false);
  });

  it('reject an unknown stage', () => {
    expect(checkResultSchema.safeParse({ ...valid, stage: 'alpha' }).success).toBe(false);
  });
});

describe('the threshold basis (C39.3, an additive C29.2 member)', () => {
  const provenance = { 'implementation-version': 1, thresholds: { threshold: 0.363 } };

  it('maps each threshold key to calibrated or provisional', () => {
    expect(
      checkProvenanceSchema.safeParse({
        ...provenance,
        'threshold-basis': { threshold: 'provisional', 'min-passive-score': 'calibrated' },
      }).success,
    ).toBe(true);
  });

  it('is optional, so earlier results still parse', () => {
    expect(checkProvenanceSchema.safeParse(provenance).success).toBe(true);
  });

  it.each([
    ['an unknown basis', { threshold: 'fitted' }],
    ['a camelCase key', { minPassiveScore: 'provisional' }],
  ])('refuses %s', (_label, basis) => {
    expect(
      checkProvenanceSchema.safeParse({ ...provenance, 'threshold-basis': basis }).success,
    ).toBe(false);
  });
});
