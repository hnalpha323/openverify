/**
 * K8-13 (Workflow 8D review): what a case's SLA answers when its calendar cannot measure business
 * time (C133.3): a target past the ten-year scan is `sla_out_of_range`, a zone the runtime does not
 * know is `calendar_invalid`, each at the caller's pointer when it names one; any other error passes
 * through unchanged. Pure; no value is personal.
 */
import { describe, expect, it } from 'vitest';
import { BusinessTimeError } from './business-time.js';
import { measured, slaProblemOf } from './policy-sla.js';

const POINTER = '/meta/sla-expires-in-seconds';

describe('slaProblemOf and measured (C133.3)', () => {
  it('answers a target its calendar cannot reach in ten years as sla_out_of_range, at the pointer', () => {
    const problem = slaProblemOf(new BusinessTimeError('business_time_scan_exceeded'), POINTER);

    expect(problem).toMatchObject({
      status: 422,
      code: 'sla_out_of_range',
      errors: [{ location: 'body', pointer: POINTER }],
    });
  });

  it('answers an unreadable calendar as calendar_invalid, with or without a pointer', () => {
    const at = slaProblemOf(new BusinessTimeError('business_time_zone_unknown'), POINTER);
    const bare = slaProblemOf(new BusinessTimeError('business_time_invalid'));

    expect(at).toMatchObject({
      code: 'calendar_invalid',
      members: { dates: [] },
      errors: [{ pointer: POINTER }],
    });
    expect(bare).toMatchObject({ code: 'calendar_invalid', errors: undefined });
    expect(slaProblemOf(new BusinessTimeError('business_time_scan_exceeded'))).toMatchObject({
      code: 'sla_out_of_range',
      errors: undefined,
    });
  });

  it('passes any other error through as it is, and measured answers what it measured', () => {
    const other = new Error('synthetic failure');

    expect(slaProblemOf(other, POINTER)).toBe(other);
    expect(measured(() => 42)).toBe(42);
    expect(() =>
      measured(() => {
        throw new BusinessTimeError('business_time_scan_exceeded');
      }, POINTER),
    ).toThrow(expect.objectContaining({ code: 'sla_out_of_range' }) as Error);
  });
});
