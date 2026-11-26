/**
 * Workflow 7A Stage 1b (H) (C96.3, C107.8): `OPENVERIFY_HANDOFF_SENDS_PER_HOUR`, the email and SMS
 * handoff sends an environment may make per hour (default 200; the budget fails closed). A problem
 * names the variable.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_HANDOFF_SENDS_PER_HOUR, loadConfig } from './config.js';
import { syntheticEnv } from './test-support/env.js';

function issuesOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(syntheticEnv(env));
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

describe('the handoff settings (C96.3, C107.8)', () => {
  it('default to 200 sends an hour', () => {
    expect(DEFAULT_HANDOFF_SENDS_PER_HOUR).toBe(200);
    expect(loadConfig(syntheticEnv()).handoff).toEqual({ sendsPerHour: 200 });
  });

  it('read OPENVERIFY_HANDOFF_SENDS_PER_HOUR', () => {
    expect(
      loadConfig(syntheticEnv({ OPENVERIFY_HANDOFF_SENDS_PER_HOUR: '40' })).handoff.sendsPerHour,
    ).toBe(40);
  });

  it.each(['0', '-1', 'many', '100001'])('refuse %s, naming the variable', (value) => {
    expect(issuesOf({ OPENVERIFY_HANDOFF_SENDS_PER_HOUR: value }).join('\n')).toMatch(
      /OPENVERIFY_HANDOFF_SENDS_PER_HOUR/,
    );
  });
});
