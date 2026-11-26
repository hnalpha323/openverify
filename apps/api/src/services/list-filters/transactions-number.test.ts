/**
 * C260.1 (Workflow 11C, sast-pii-11c): a number filter value is read in linear time.
 *
 * `filterTextOf` checks a `filter[fields.<key>]` value for an integer or number field against a
 * pattern before `Number()` reads it. The pattern `\d+\.?\d*` let its two digit runs exchange
 * characters, so a long run of digits with a rejecting suffix backtracked quadratically
 * (eslint-plugin-regexp's no-super-linear-backtracking; about a quarter of a second of CPU for
 * 16,000 digits). The same language as `\d+(?:\.\d*)?` is linear. CPU time is measured with
 * `process.cpuUsage`, the least of three runs (rule 6), never the wall clock.
 */
import { describe, expect, it } from 'vitest';
import { filterTextOf } from './transactions.js';

const CPU_BUDGET_MS = 50;

function cpuMilliseconds(run: () => void): number {
  let least = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 3; round += 1) {
    const before = process.cpuUsage();
    run();
    const used = process.cpuUsage(before);
    least = Math.min(least, (used.user + used.system) / 1000);
  }
  return least;
}

describe('a number filter value (C260.1)', () => {
  it.each(['1', '-1', '1.', '1.5', '.5', '-.5', '1e5', '1.5E-3', '12345', '0.0'])(
    'reads %s as a number',
    (value) => {
      expect(filterTextOf('number', value)).not.toBeNull();
    },
  );

  it.each(['', '-', '.', '1..2', 'e5', '1e', '--1', '1x', '+1', '1.5.6', ' 1'])(
    'refuses %j',
    (value) => {
      expect(filterTextOf('number', value)).toBeNull();
    },
  );

  it('refuses a long run of digits with a rejecting suffix in linear time', () => {
    const value = `${'1'.repeat(32_000)}x`;
    let text: string | null = '';
    const cpu = cpuMilliseconds(() => {
      text = filterTextOf('number', value);
    });
    expect(text).toBeNull();
    expect(cpu).toBeLessThan(CPU_BUDGET_MS);
  });
});
