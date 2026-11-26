/**
 * C76.2, C78.3, C80.1 (Workflow 6A Stage 1b): the watchlist CLIs are package scripts of the API,
 * run like the other operator CLIs (tsx with the source condition and the repository's `.env`).
 * `api-watchlists` builds each in the script file named here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scripts = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

describe('the watchlist CLIs (C76.2, C78.3, C80.1)', () => {
  it.each([
    ['watchlists:sync', 'scripts/watchlists-sync.ts'],
    ['watchlists:rekey', 'scripts/watchlists-rekey.ts'],
    ['pep:sync', 'scripts/pep-sync.ts'],
  ])('runs %s from %s with the repository .env, as the other CLIs do', (name, script) => {
    expect(scripts[name]).toBe(
      `tsx --conditions=@openverify/source --env-file-if-exists=../../.env ${script}`,
    );
    expect(existsSync(new URL(`../${script}`, import.meta.url)), script).toBe(true);
    expect(scripts[name]?.replace(script, 'scripts/trust-anchors-sync.ts')).toBe(
      scripts['trust-anchors:sync'],
    );
  });
});

describe('the network sync CLI (C92.2, Workflow 7A)', () => {
  it('runs network:sync from scripts/network-sync.ts with the repository .env, as the other CLIs do', () => {
    const script = 'scripts/network-sync.ts';

    expect(scripts['network:sync']).toBe(
      `tsx --conditions=@openverify/source --env-file-if-exists=../../.env ${script}`,
    );
    expect(existsSync(new URL(`../${script}`, import.meta.url)), script).toBe(true);
  });
});

describe('the analytics benchmark (C163.7, review F22; Workflow 9B Stage 1a)', () => {
  it('runs analytics:benchmark from scripts/analytics-benchmark.ts with the repository .env, as the other CLIs do', () => {
    const script = 'scripts/analytics-benchmark.ts';

    expect(scripts['analytics:benchmark']).toBe(
      `tsx --conditions=@openverify/source --env-file-if-exists=../../.env ${script}`,
    );
    expect(existsSync(new URL(`../${script}`, import.meta.url)), script).toBe(true);
  });

  it('takes one phase per call, --seed, --measure or --teardown, and refuses anything else', async () => {
    // A computed specifier, so this file typechecks whatever the script exports (rule 5).
    const script = new URL('../scripts/analytics-benchmark.ts', import.meta.url).href;
    const benchmark = (await import(script)) as {
      main: (argv: readonly string[]) => Promise<void>;
      parseAnalyticsBenchmarkArgs: (argv: readonly string[]) => string;
      ANALYTICS_BENCHMARK_PHASES: readonly string[];
    };

    expect(benchmark.ANALYTICS_BENCHMARK_PHASES).toEqual(['--seed', '--measure']);
    for (const phase of ['--seed', '--measure', '--teardown']) {
      expect(benchmark.parseAnalyticsBenchmarkArgs([phase])).toBe(phase);
    }
    for (const argv of [[], ['--seed', '--measure'], ['--build']]) {
      expect(() => benchmark.parseAnalyticsBenchmarkArgs(argv)).toThrow(
        /--seed, --measure or --teardown/,
      );
    }
    await expect(benchmark.main([])).rejects.toThrow(/one per call/);
  });
});

describe('the Workflow 11B commands (C247.1, C248.6, C249.3, C250.5; Stage 1a (P))', () => {
  it.each([
    ['org:create', 'scripts/org-create.ts'],
    ['db:grant-runtime', 'scripts/db-grant-runtime.ts'],
    // C248.6 (Workflow 11B sso-oidc, a named borrowed edit): built, out of the stub list.
    ['user:allow-password', 'scripts/user-allow-password.ts'],
  ])(
    'runs %s from %s (built): an empty command line prints the usage and answers 2',
    async (name, script) => {
      expect(scripts[name]).toBe(
        `tsx --conditions=@openverify/source --env-file-if-exists=../../.env ${script}`,
      );
      const href = new URL(`../${script}`, import.meta.url).href;
      const command = (await import(href)) as {
        main: (argv: readonly string[], env: NodeJS.ProcessEnv, io: unknown) => Promise<number>;
      };
      const written: string[] = [];
      const io = {
        stdout: { write: () => true },
        stderr: { write: (chunk: string) => written.push(chunk) },
      };

      await expect(command.main([], {}, io)).resolves.toBe(2);
      expect(written.join('')).toContain(`Usage: pnpm --filter @openverify/api ${name}`);
    },
  );

  it('runs api-keys:pepper-status from scripts/api-keys-pepper-status.ts (auth-sessions, built): an argument it does not know prints the usage and answers 2 before connecting', async () => {
    const script = 'scripts/api-keys-pepper-status.ts';
    expect(scripts['api-keys:pepper-status']).toBe(
      `tsx --conditions=@openverify/source --env-file-if-exists=../../.env ${script}`,
    );
    const href = new URL(`../${script}`, import.meta.url).href;
    const command = (await import(href)) as {
      main: (argv: readonly string[], env: NodeJS.ProcessEnv, io: unknown) => Promise<number>;
    };
    const written: string[] = [];
    const io = {
      stdout: { write: () => true },
      stderr: { write: (chunk: string) => written.push(chunk) },
    };

    await expect(command.main(['--show-hashes'], {}, io)).resolves.toBe(2);
    expect(written.join('')).toContain(
      'Usage: pnpm --filter @openverify/api api-keys:pepper-status',
    );
  });
});
