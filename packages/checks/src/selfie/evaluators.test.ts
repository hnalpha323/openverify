import { listChecks } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { SELFIE_EVALUATORS } from './evaluators.js';
import { SELFIE_EVALUATOR_REASONS } from './reasons.js';

describe('SELFIE_EVALUATORS (C43)', () => {
  it('has an evaluator for every §4.2 check of the registry, and nothing else', () => {
    const ids = listChecks('selfie').map((check) => check.id);
    expect(Object.keys(SELFIE_EVALUATORS).sort()).toEqual([...ids].sort());
    expect(ids).toHaveLength(15);
  });

  it('declares the reasons every evaluator may emit, snake_case codes only', () => {
    expect(Object.keys(SELFIE_EVALUATOR_REASONS).sort()).toEqual(
      Object.keys(SELFIE_EVALUATORS).sort(),
    );
    for (const [id, reasons] of Object.entries(SELFIE_EVALUATOR_REASONS)) {
      expect(reasons.length, id).toBeGreaterThan(0);
      for (const reason of reasons) {
        // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
        expect(reason, id).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      }
    }
  });

  it('never declares a legacy Phase 1 reason or not_implemented', () => {
    const all = Object.values(SELFIE_EVALUATOR_REASONS).flat();
    for (const legacy of [
      'selfie_face_not_present',
      'id_portrait_not_present',
      'not_implemented',
    ]) {
      expect(all).not.toContain(legacy);
    }
  });
});
