/**
 * C143.8 (Workflow 8A Stage 1b (E)): the engine's settings. A problem names the variable and never
 * echoes its value.
 */
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';
import { syntheticEnv } from './test-support/env.js';

function issuesOf(env: NodeJS.ProcessEnv): readonly string[] {
  try {
    loadConfig(syntheticEnv(env), { process: 'worker' });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw a ConfigError');
}

describe('the workflow settings (C143.8)', () => {
  it('default to the code runner on, the pool, no loopback and a cap of 50', () => {
    expect(loadConfig(syntheticEnv({}), { process: 'worker' }).workflows).toEqual({
      codeEnabled: true,
      codeRunner: { kind: 'pool' },
      httpAllowLoopback: false,
      nat64Prefixes: [],
      inFlightCap: 50,
      slackBound: { sandbox: false, production: false },
    });
  });

  it('reads whether Slack is bound by name alone, in the API too (C122.5)', () => {
    const { workflows } = loadConfig(
      syntheticEnv({ OPENVERIFY_PROVIDER_SLACK_SANDBOX: 'sandbox' }),
      { process: 'api' },
    );

    expect(workflows.slackBound).toEqual({ sandbox: true, production: false });
  });

  it('reads each variable', () => {
    const { workflows } = loadConfig(
      syntheticEnv({
        OPENVERIFY_WORKFLOW_CODE_ENABLED: 'false',
        OPENVERIFY_WORKFLOW_CODE_RUNNER: 'socket:/run/openverify/code-runner.sock',
        OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK: 'true',
        OPENVERIFY_NAT64_PREFIXES: '2001:db8:64::/96, 2001:db8:65::/96',
        OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP: '10',
      }),
      { process: 'worker' },
    );

    expect(workflows).toEqual({
      codeEnabled: false,
      codeRunner: { kind: 'socket', path: '/run/openverify/code-runner.sock' },
      httpAllowLoopback: true,
      nat64Prefixes: ['2001:db8:64::/96', '2001:db8:65::/96'],
      inFlightCap: 10,
      slackBound: { sandbox: false, production: false },
    });
  });

  it('refuses a runner that is neither form, without echoing it', () => {
    const issues = issuesOf({ OPENVERIFY_WORKFLOW_CODE_RUNNER: 'ssh://synthetic-host' });

    expect(issues.join()).toContain('OPENVERIFY_WORKFLOW_CODE_RUNNER');
    expect(issues.join()).not.toContain('synthetic-host');
  });

  it('refuses a relative socket path', () => {
    expect(issuesOf({ OPENVERIFY_WORKFLOW_CODE_RUNNER: 'socket:run/code.sock' }).join()).toContain(
      'OPENVERIFY_WORKFLOW_CODE_RUNNER',
    );
  });

  it('refuses a cap below one', () => {
    expect(issuesOf({ OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP: '0' }).join()).toContain(
      'OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP',
    );
  });

  it('refuses a NAT64 prefix that is not IPv6 or not one of the RFC 6052 lengths', () => {
    expect(issuesOf({ OPENVERIFY_NAT64_PREFIXES: '192.0.2.0/24' }).join()).toContain(
      'OPENVERIFY_NAT64_PREFIXES',
    );
    expect(issuesOf({ OPENVERIFY_NAT64_PREFIXES: '2001:db8::/97' }).join()).toContain(
      'OPENVERIFY_NAT64_PREFIXES',
    );
  });

  it('refuses loopback in production (C124.3: sandbox environments outside production installs)', () => {
    const issues = issuesOf({
      OPENVERIFY_MODE: 'production',
      OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK: 'true',
    });

    expect(issues.join()).toContain('OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK');
  });

  it('reads the same way in the API process', () => {
    expect(loadConfig(syntheticEnv({})).workflows.inFlightCap).toBe(50);
  });
});
