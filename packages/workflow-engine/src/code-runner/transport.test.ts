import { describe, expect, it } from 'vitest';
import {
  CODE_RUNNER_LISTEN_VARIABLE,
  CODE_RUNNER_TOKEN_MIN_BYTES,
  CODE_RUNNER_TOKEN_VARIABLE,
  connectCodeRunnerOverTcp,
  parseCodeRunnerTcpTarget,
} from './transport.js';

describe('the code runner tcp: transport, frozen (C263.6)', () => {
  it('names its two variables and the token length', () => {
    expect(CODE_RUNNER_LISTEN_VARIABLE).toBe('OPENVERIFY_CODE_RUNNER_LISTEN');
    expect(CODE_RUNNER_TOKEN_VARIABLE).toBe('OPENVERIFY_CODE_RUNNER_TOKEN');
    expect(CODE_RUNNER_TOKEN_MIN_BYTES).toBe(32);
  });

  it.each([
    ['code-runner:7700', { host: 'code-runner', port: 7700 }],
    [
      'openverify-code-runner.openverify.svc.cluster.local:7700',
      { host: 'openverify-code-runner.openverify.svc.cluster.local', port: 7700 },
    ],
    ['192.0.2.10:1', { host: '192.0.2.10', port: 1 }],
    ['0.0.0.0:65535', { host: '0.0.0.0', port: 65535 }],
    ['[2001:db8::10]:7700', { host: '2001:db8::10', port: 7700 }],
    ['[::]:7700', { host: '::', port: 7700 }],
  ])('reads %s', (value, target) => {
    expect(parseCodeRunnerTcpTarget(value)).toEqual(target);
  });

  it.each([
    '',
    'code-runner',
    'code-runner:',
    ':7700',
    'code-runner:0',
    'code-runner:65536',
    'code-runner:77a0',
    'code-runner:+7700',
    'code-runner:07700',
    '2001:db8::10:7700',
    '[2001:db8::10]',
    '[not-an-address]:7700',
    'code_runner:7700',
    '-runner:7700',
    'http://code-runner:7700',
    'code-runner:7700/path',
    'user@code-runner:7700',
    ' code-runner:7700',
  ])('refuses %j', (value) => {
    expect(parseCodeRunnerTcpTarget(value)).toBeNull();
  });

  it('builds a client for a target and a token of at least 32 bytes (tcp.test.ts drives it)', async () => {
    const runner = connectCodeRunnerOverTcp({
      host: 'code-runner',
      port: 7700,
      token: 'synthetic-runner-token-0123456789abcdef',
    });
    expect(typeof runner.evaluate).toBe('function');
    await runner.close();
  });
});
