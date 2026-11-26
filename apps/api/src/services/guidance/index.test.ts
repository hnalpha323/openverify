import { SUPPORTED_VERIFICATION_TYPES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { guidanceHookFor, VERIFICATION_GUIDANCE_HOOKS } from './index.js';
import { unbuiltGuidanceHook } from './stub.js';

describe('the guidance hooks (C52.2, C54.1)', () => {
  it('has a hook for every Phase 5 type and none for a government ID or a selfie', () => {
    for (const type of SUPPORTED_VERIFICATION_TYPES) {
      const phase5 = type !== 'government_id' && type !== 'selfie';
      expect(guidanceHookFor(type) !== undefined, type).toBe(phase5);
    }
    expect(Object.keys(VERIFICATION_GUIDANCE_HOOKS)).toHaveLength(9);
  });

  it('gives no guidance until a type is built', async () => {
    await expect(unbuiltGuidanceHook().flowAttributes({} as never)).resolves.toEqual({
      guidance: null,
    });
  });
});
