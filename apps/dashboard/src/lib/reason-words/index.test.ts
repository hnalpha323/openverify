/**
 * C54.5: the per-type reason-word modules. Each Phase 5 type has one, and each words only codes
 * its own type's checks can give (C51.2), in short English words; Workflow 5C fills them.
 */
import {
  PHASE5_CHECK_REASONS,
  VERIFICATION_RESOURCE_TYPES,
  toVerificationResourceType,
} from '@openverify/contracts';
import { getCheckDefinition } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { PHASE5_REASON_WORDS } from './index';

const PHASE5_TYPES = VERIFICATION_RESOURCE_TYPES.filter(
  (type) => type !== 'verification/government-id' && type !== 'verification/selfie',
);

/** Every reason the checks of `type` may give (C51.2). */
function reasonsOfType(type: string): ReadonlySet<string> {
  return new Set(
    Object.entries(PHASE5_CHECK_REASONS).flatMap(([check, reasons]) => {
      const definition = getCheckDefinition(check);
      return definition !== undefined &&
        toVerificationResourceType(definition.verificationType) === type
        ? reasons
        : [];
    }),
  );
}

describe('the reason-word modules (C54.5)', () => {
  it('has one per Phase 5 type', () => {
    expect(Object.keys(PHASE5_REASON_WORDS).sort()).toEqual([...PHASE5_TYPES].sort());
  });

  it.each(PHASE5_TYPES)('words only %s reasons, in short English words', (type) => {
    const reasons = reasonsOfType(type);
    expect(reasons.size).toBeGreaterThan(0);

    for (const [code, text] of Object.entries(PHASE5_REASON_WORDS[type])) {
      expect(reasons.has(code), code).toBe(true);
      expect(text.words, code).toMatch(/^[A-Z][^_]{1,59}$/);
    }
  });
});
