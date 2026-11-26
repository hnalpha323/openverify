/**
 * C169.7 (Workflow 9B Stage 1a, (W); review F18): a user's notification kinds beyond the three case
 * kinds, and the subject each kind names. Read through the package root.
 */
import { describe, expect, it } from 'vitest';
import * as core from './index.js';

const pick = (name: string): unknown => (core as Readonly<Record<string, unknown>>)[name];

describe('user notification kinds and subjects (C169.7)', () => {
  it('adds webhook-failure to the case kinds, which keep their own list', () => {
    expect(pick('USER_NOTIFICATION_KINDS')).toEqual([
      'assigned',
      'sla-breached',
      'mentioned',
      'webhook-failure',
    ]);
    expect(core.CASE_NOTIFICATION_KINDS).toEqual(['assigned', 'sla-breached', 'mentioned']);
  });

  it('names the subject of each kind: a case for the case kinds, a webhook for a failure', () => {
    expect(pick('NOTIFICATION_SUBJECT_TYPES')).toEqual(['case', 'webhook']);
    expect(pick('NOTIFICATION_KIND_SUBJECT')).toEqual({
      assigned: 'case',
      'sla-breached': 'case',
      mentioned: 'case',
      'webhook-failure': 'webhook',
    });
  });

  it('defaults a preference to the console on and email off (C169.7)', () => {
    expect(pick('NOTIFICATION_PREFERENCE_DEFAULT')).toEqual({ console: true, email: false });
  });
});
