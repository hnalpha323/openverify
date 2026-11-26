import { describe, expect, it } from 'vitest';
import {
  FIRST_INPUT_BUCKETS,
  FLOW_SIGNALS_COLLECTOR_VERSION,
  FLOW_SIGNALS_MAX_COUNT,
} from '@openverify/contracts';
import {
  COLLECTOR_CONSTANTS,
  COLLECTOR_VERSION as REGISTERED_COLLECTOR_VERSION,
} from '@openverify/core';
import {
  COLLECTOR_CUTOFFS,
  COLLECTOR_VERSION,
  MAX_COUNT,
  RECOGNITION_BUCKETS,
} from './constants.js';

const registered = (key: string) => COLLECTOR_CONSTANTS[key]?.value;

/**
 * The browser keeps literal copies of the registered cut-offs (core and zod would not fit its
 * budget). These tests tie each copy to the registry (C90.1, H24), whose own golden test pins the
 * constants to `COLLECTOR_VERSION`: a cut-off cannot change here without changing there, and a
 * change there needs a version bump.
 */
describe('the collector cut-offs, tied to collector-version (C94.3, H24)', () => {
  it('sends the registered collector version, which the contract was frozen with', () => {
    expect(COLLECTOR_VERSION).toBe(REGISTERED_COLLECTOR_VERSION);
    expect(COLLECTOR_VERSION).toBe(FLOW_SIGNALS_COLLECTOR_VERSION);
  });

  it('applies exactly the registered cut-offs', () => {
    expect(COLLECTOR_CUTOFFS.minIntervals).toBe(registered('typing-cadence-min-intervals'));
    expect(COLLECTOR_CUTOFFS.uniformCv).toBe(registered('typing-cadence-uniform-cv'));
    expect(COLLECTOR_CUTOFFS.firstInputEdges).toEqual([
      registered('first-input-fast-seconds'),
      registered('first-input-quick-seconds'),
      registered('first-input-slow-seconds'),
    ]);
    expect(COLLECTOR_CUTOFFS.dwellCapSeconds).toBe(registered('dwell-seconds-cap'));
    expect(Object.keys(COLLECTOR_CONSTANTS).sort()).toEqual(
      [
        'dwell-seconds-cap',
        'first-input-fast-seconds',
        'first-input-quick-seconds',
        'first-input-slow-seconds',
        'typing-cadence-min-intervals',
        'typing-cadence-uniform-cv',
      ].sort(),
    );
  });

  it('names one bucket per edge and caps counts as the contract does', () => {
    expect(FIRST_INPUT_BUCKETS).toHaveLength(COLLECTOR_CUTOFFS.firstInputEdges.length + 2);
    expect(MAX_COUNT).toBe(FLOW_SIGNALS_MAX_COUNT);
  });

  it('pins the recognition buckets to collector version 1: change one, bump the version', () => {
    // A new bucket size changes every device fingerprint, so it is a new collector version.
    expect({ version: COLLECTOR_VERSION, ...RECOGNITION_BUCKETS }).toEqual({
      version: 1,
      screenPixels: 16,
      pixelRatio: 0.25,
    });
  });
});
