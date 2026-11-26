import { SUPPORTED_VERIFICATION_TYPES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { submitGuardFor, SUBMIT_GUARDS } from './index.js';

describe('the submit guards (C52.6, C54.1)', () => {
  it('has one guard per verification type', () => {
    expect(Object.keys(SUBMIT_GUARDS).sort()).toEqual([...SUPPORTED_VERIFICATION_TYPES].sort());
    for (const type of SUPPORTED_VERIFICATION_TYPES) {
      expect(submitGuardFor(type).submittableStatuses, type).toContain('initiated');
    }
  });

  it('submits a government ID and a selfie from initiated only, as before', () => {
    expect(submitGuardFor('government_id').submittableStatuses).toEqual(['initiated']);
    expect(submitGuardFor('selfie').submittableStatuses).toEqual(['initiated']);
  });
});
