/**
 * Workflow 10B Stage 1b (`foundation-10b`): the contract lists the database holds with a CHECK are the
 * same lists, so a value the route accepts is one the column takes.
 * - C206.2: `CAPTURE_TRIGGERS` (the upload's `capture-trigger` and the file attribute) and core's
 *   `FILE_CAPTURE_TRIGGERS` (`files.capture_trigger`).
 * - C211.4: `DEVICE_INTEGRITY_PROVIDERS` and core's `INTEGRITY_VERDICT_PROVIDERS`
 *   (`inquiry_integrity_verdicts.provider`).
 *
 * And the C12 policy `flow-integrity` (C221.7): 5 an hour per inquiry, in all three maps.
 */
import { FILE_CAPTURE_TRIGGERS, INTEGRITY_VERDICT_PROVIDERS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { CAPTURE_TRIGGERS } from './files.js';
import { DEVICE_INTEGRITY_PROVIDERS } from './flow-integrity.js';
import {
  RATE_LIMIT_DEFAULTS,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_POLICY_WINDOWS,
} from './rate-limits.js';

describe('C206.2: the capture triggers', () => {
  it('are the same list in the contract and in the database', () => {
    expect([...CAPTURE_TRIGGERS]).toEqual([...FILE_CAPTURE_TRIGGERS]);
  });
});

describe('C211.4: the device-integrity providers', () => {
  it('are the same list in the contract and in the database', () => {
    expect([...DEVICE_INTEGRITY_PROVIDERS]).toEqual([...INTEGRITY_VERDICT_PROVIDERS]);
  });
});

describe('C221.7: the flow-integrity policy', () => {
  it('allows 5 an hour, after the policies before it', () => {
    const policies = RATE_LIMIT_POLICIES as readonly string[];
    // Workflow 10C (C221.7) adds flow-sandbox-chip after it (phase10c-contracts.test.ts).
    expect(policies.indexOf('flow-integrity')).toBe(policies.indexOf('report-bulk') + 1);
    expect((RATE_LIMIT_DEFAULTS as Record<string, number>)['flow-integrity']).toBe(5);
    expect((RATE_LIMIT_POLICY_WINDOWS as Record<string, number>)['flow-integrity']).toBe(3600);
  });
});
