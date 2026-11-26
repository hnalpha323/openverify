/**
 * C263.6 (Workflow 11C Stage 1a): the egress configuration's `tcp:` branch. The worker passes the
 * token config.ts required; a setting without one (the API's) never builds a runner; with one, the
 * worker gets images-11c's client, which connects on first use.
 */
import { describe, expect, it } from 'vitest';
import { createWorkflowEgressConfig } from './egress-config.js';

const settings = (token: string | null) => ({
  codeEnabled: true,
  codeRunner: { kind: 'tcp' as const, host: 'code-runner', port: 7700, token },
  httpAllowLoopback: false,
  nat64Prefixes: [],
  inFlightCap: 50,
  slackBound: { sandbox: false, production: false },
});

describe('the tcp: code runner in the egress configuration (C263.6)', () => {
  it('builds no runner without the token', () => {
    expect(() => createWorkflowEgressConfig(settings(null))).toThrow(
      'OPENVERIFY_CODE_RUNNER_TOKEN is required for the tcp: code runner',
    );
  });

  // Workflow 11C (images-11c built the client): a runner is built, and connects on first use.
  it('builds the tcp: client with the token', async () => {
    const { codeRunner } = createWorkflowEgressConfig(
      settings('synthetic-code-runner-token-0123456789abcdef'),
    );
    expect(codeRunner).not.toBeNull();
    await codeRunner?.close();
  });

  it('builds nothing while code is off', () => {
    expect(
      createWorkflowEgressConfig({ ...settings(null), codeEnabled: false }).codeRunner,
    ).toBeNull();
  });
});
