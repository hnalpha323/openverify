/**
 * Workflow 11A Stage 1a (C) (C231.10; decision 71): the install switch `OPENVERIFY_CONNECT_ENABLED`.
 * Connect is off unless the install allows it: the default is `false` (the images and the chart),
 * and the development `.env.example` and the e2e stack set it `true`. The API and the worker read
 * it the same way; while it is `false` every Connect route answers the generic 404 and a
 * `share_consent` step fails publish.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type LoadConfigOptions } from './config.js';
import { syntheticEnv } from './test-support/env.js';

function issuesOf(env: NodeJS.ProcessEnv, options: LoadConfigOptions = {}): readonly string[] {
  try {
    loadConfig(syntheticEnv(env), options);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

const connectOf = (env: NodeJS.ProcessEnv, options: LoadConfigOptions = {}): unknown =>
  loadConfig(syntheticEnv(env), options).connect;

describe('OPENVERIFY_CONNECT_ENABLED (C231.10)', () => {
  it.each(['api', 'worker'] as const)('is off by default in the %s', (process) => {
    expect(connectOf({ OPENVERIFY_CONNECT_ENABLED: undefined }, { process })).toEqual({
      enabled: false,
    });
  });

  it.each(['api', 'worker'] as const)('is on when the install sets it, in the %s', (process) => {
    expect(connectOf({ OPENVERIFY_CONNECT_ENABLED: 'true' }, { process })).toEqual({
      enabled: true,
    });
    expect(connectOf({ OPENVERIFY_CONNECT_ENABLED: 'false' }, { process })).toEqual({
      enabled: false,
    });
  });

  it('takes only true or false', () => {
    expect(issuesOf({ OPENVERIFY_CONNECT_ENABLED: 'yes' })).toEqual([
      'OPENVERIFY_CONNECT_ENABLED: must be true or false',
    ]);
  });
});
