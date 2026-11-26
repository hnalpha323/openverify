// @ts-check
/**
 * C271.2 (Workflow 11D, `matcher-c787-11d`; the calibration's method, "What is measured" item 6):
 * a re-screen lever's share is measured on the re-screen step it changes, so `rescreen-<n>` takes
 * `--switch <name>` (a Phase 11 switch, turned on for that one re-screen). The switch is checked
 * before the step does anything, so a wrong name costs no table and no database. Each case runs the
 * CLI as its package script does, with a size the step refuses, so no container starts.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const PACKAGE = join(import.meta.dirname, '..');
/** A development seed for the argument checks only: no table is built from it. */
const SEED = '0123456789abcdef0123456789abcdef';

/**
 * Runs `benchmark:performance` as its package script does; resolves with its exit code and stderr.
 * @param {string[]} args
 */
async function runPerformance(args) {
  /** @type {Record<string, string>} */
  const scripts = JSON.parse(await readFile(join(PACKAGE, 'package.json'), 'utf8')).scripts;
  const [command, ...flags] = (scripts['benchmark:performance'] ?? '').split(' ');
  expect(command).toBe('node');
  try {
    await promisify(execFile)(process.execPath, [...flags, ...args], { cwd: PACKAGE });
    return { code: 0, stderr: '' };
  } catch (error) {
    const failed = /** @type {{ code?: number, stderr?: string }} */ (error);
    return { code: failed.code ?? 1, stderr: String(failed.stderr ?? '') };
  }
}

describe('the re-screen step takes a Phase 11 switch (C271.2)', () => {
  it('refuses an unknown switch before the step, and lets a known one through to it', async () => {
    const out = await mkdtemp(join(tmpdir(), 'openverify-rescreen-switch-'));
    try {
      const base = ['--seed', SEED, '--out', out, '--step', 'rescreen-7'];
      const unknown = await runPerformance([...base, '--switch', 'no-such-switch']);
      expect(unknown.code).not.toBe(0);
      expect(unknown.stderr).toContain('--switch is one of');

      const known = await runPerformance([...base, '--switch', 'rescreen-bound-memo']);
      expect(known.code).not.toBe(0);
      // The switch was accepted; the step then refused its size, as without a switch.
      expect(known.stderr).toContain('the re-screen sizes are');
      expect(known.stderr).not.toContain('--switch is one of');
    } finally {
      await rm(out, { recursive: true, force: true });
    }
    // A hang guard, not a budget: two real child processes (see benchmark-identity.test.mjs).
  }, 180_000);
});
