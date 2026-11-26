/**
 * C263.6 (Workflow 11C Stage 1a, contracts-11c): `OPENVERIFY_WORKFLOW_CODE_RUNNER=tcp:<host>:<port>`
 * and `OPENVERIFY_CODE_RUNNER_TOKEN` (at least 32 bytes), parsed in `config.ts` so images-11c edits
 * no line of it. The worker requires the token for `tcp:`; the API, which never connects, reads the
 * setting without one. A problem names the variable and never echoes a value.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_SECRETS, ConfigError, loadConfig, type LoadConfigOptions } from './config.js';
import { syntheticEnv } from './test-support/env.js';

const TOKEN = 'synthetic-code-runner-token-0123456789abcdef';
const worker: LoadConfigOptions = { process: 'worker' };
const api: LoadConfigOptions = { process: 'api' };

function issuesOf(env: NodeJS.ProcessEnv, options: LoadConfigOptions = worker): readonly string[] {
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

const runnerOf = (env: NodeJS.ProcessEnv, options: LoadConfigOptions = worker) =>
  loadConfig(syntheticEnv(env), options).workflows.codeRunner;

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('the code runner tcp: form (C263.6)', () => {
  it('reads tcp:<host>:<port> with its token in the worker', () => {
    expect(
      runnerOf({
        OPENVERIFY_WORKFLOW_CODE_RUNNER: 'tcp:openverify-code-runner:7700',
        OPENVERIFY_CODE_RUNNER_TOKEN: TOKEN,
      }),
    ).toEqual({ kind: 'tcp', host: 'openverify-code-runner', port: 7700, token: TOKEN });
  });

  it('reads an IPv6 host written in brackets', () => {
    expect(
      runnerOf({
        OPENVERIFY_WORKFLOW_CODE_RUNNER: 'tcp:[2001:db8::10]:7700',
        OPENVERIFY_CODE_RUNNER_TOKEN: TOKEN,
      }),
    ).toEqual({ kind: 'tcp', host: '2001:db8::10', port: 7700, token: TOKEN });
  });

  it('requires the token in the worker for tcp:, naming the variable', () => {
    expect(issuesOf({ OPENVERIFY_WORKFLOW_CODE_RUNNER: 'tcp:code-runner:7700' })).toEqual([
      'OPENVERIFY_CODE_RUNNER_TOKEN: is required while OPENVERIFY_WORKFLOW_CODE_RUNNER is tcp:',
    ]);
  });

  it('refuses a token shorter than 32 bytes, without echoing it', () => {
    const issues = issuesOf({
      OPENVERIFY_WORKFLOW_CODE_RUNNER: 'tcp:code-runner:7700',
      OPENVERIFY_CODE_RUNNER_TOKEN: 'synthetic-short-token',
    });
    expect(issues).toEqual(['OPENVERIFY_CODE_RUNNER_TOKEN: must be at least 32 bytes']);
    expect(issues.join()).not.toContain('synthetic-short-token');
  });

  it('lets the API read tcp: without the token: it never connects', () => {
    expect(runnerOf({ OPENVERIFY_WORKFLOW_CODE_RUNNER: 'tcp:code-runner:7700' }, api)).toEqual({
      kind: 'tcp',
      host: 'code-runner',
      port: 7700,
      token: null,
    });
  });

  it('reads the token from its _FILE form, trailing line ends trimmed (C249.2)', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openverify-runner-token-'));
    directories.push(directory);
    const file = join(directory, 'OPENVERIFY_CODE_RUNNER_TOKEN');
    writeFileSync(file, `${TOKEN}\n`);
    chmodSync(file, 0o440);
    expect(
      runnerOf({
        OPENVERIFY_WORKFLOW_CODE_RUNNER: 'tcp:code-runner:7700',
        OPENVERIFY_CODE_RUNNER_TOKEN_FILE: file,
      }),
    ).toEqual({ kind: 'tcp', host: 'code-runner', port: 7700, token: TOKEN });
  });

  it.each(['tcp:synthetic-host', 'tcp:synthetic-host:0', 'tcp::7700', 'tcp:synthetic-host:7700/x'])(
    'refuses %j, naming the three forms and never echoing the value',
    (value) => {
      const issues = issuesOf({
        OPENVERIFY_WORKFLOW_CODE_RUNNER: value,
        OPENVERIFY_CODE_RUNNER_TOKEN: TOKEN,
      });
      expect(issues).toEqual([
        'OPENVERIFY_WORKFLOW_CODE_RUNNER: must be pool, socket:<absolute path> or tcp:<host>:<port>',
      ]);
      expect(issues.join()).not.toContain('synthetic-host');
    },
  );

  it('keeps the pool and socket forms as they were', () => {
    expect(runnerOf({})).toEqual({ kind: 'pool' });
    expect(
      runnerOf({ OPENVERIFY_WORKFLOW_CODE_RUNNER: 'socket:/run/code-runner/code-runner.sock' }),
    ).toEqual({
      kind: 'socket',
      path: '/run/code-runner/code-runner.sock',
    });
  });

  it('refuses the token’s change-me placeholder in production', () => {
    expect(CONFIG_SECRETS).toContain('OPENVERIFY_CODE_RUNNER_TOKEN');
    const issues = issuesOf({
      OPENVERIFY_MODE: 'production',
      OPENVERIFY_WORKFLOW_CODE_RUNNER: 'tcp:code-runner:7700',
      OPENVERIFY_CODE_RUNNER_TOKEN: 'change-me-code-runner-token-at-least-32-bytes',
    });
    expect(issues).toContain(
      'OPENVERIFY_CODE_RUNNER_TOKEN: still holds a change-me placeholder; set a real secret',
    );
  });
});
