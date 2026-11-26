/**
 * Workflow 9B Stage 1a, (F): the names `foundation-9b` (F) adds for the 9A items S4-12 carried.
 */
import { describe, expect, it } from 'vitest';
import * as core from './index.js';

const pick = (name: string): unknown => (core as Readonly<Record<string, unknown>>)[name];

describe('the per-inquiry expiry columns (9A Stage 3 amendment 21)', () => {
  it('names a nullable inquiries column for each window POST /inquiries may set after creation', () => {
    expect(pick('INQUIRY_EXPIRY_OVERRIDE_COLUMNS')).toEqual({
      'expiration-after-start-interval-seconds': 'expiration_after_start_seconds',
      'expiration-after-resume-interval-seconds': 'expiration_after_resume_seconds',
      'one-time-link-expiration-seconds': 'one_time_link_expiration_seconds',
    });
  });
});

describe('the flow run grants (9A Stage 3 amendment 31, C152.2)', () => {
  it('names the column and its default', () => {
    expect(pick('FLOW_RUN_GRANTS_COLUMN')).toBe('flow_run_grants');
  });
});
