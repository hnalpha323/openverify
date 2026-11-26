/**
 * `@openverify/checks` does not depend on `@openverify/contracts`, so the reason vocabularies are
 * mirrored here. This test reads the frozen contracts source and fails when a mirror drifts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GAP_NULL_REASONS,
  SIGNAL_EVIDENCE_REASONS,
  SIGNAL_NULL_REASONS,
  isGapNullReason,
} from './vocabulary.js';

const contracts = readFileSync(
  new URL('../../../contracts/src/signals.ts', import.meta.url),
  'utf8',
);

/** The quoted members of `export const <name> = [ ... ] as const;` in the contracts source. */
function frozenList(name: string): string[] {
  const start = contracts.indexOf(`export const ${name} = [`);
  const end = contracts.indexOf('] as const;', start);
  expect(start).toBeGreaterThan(-1);
  return [...contracts.slice(start, end).matchAll(/'([a-z0-9_]+)'/g)].map(
    (match) => match[1] ?? '',
  );
}

/** The `ON_NULL_DEFAULTS` entries of the contracts source. */
function onNullDefaults(): Record<string, string> {
  const start = contracts.indexOf('export const ON_NULL_DEFAULTS');
  const end = contracts.indexOf('});', start);
  return Object.fromEntries(
    [...contracts.slice(start, end).matchAll(/^\s+([a-z0-9_]+): '([a-z_]+)',$/gm)].map((match) => [
      match[1] ?? '',
      match[2] ?? '',
    ]),
  );
}

describe('the mirrored signal vocabularies', () => {
  it('match the contracts SIGNAL_NULL_REASONS in order', () => {
    expect([...SIGNAL_NULL_REASONS]).toEqual(frozenList('SIGNAL_NULL_REASONS'));
  });

  it('match the contracts SIGNAL_EVIDENCE_REASONS in order', () => {
    expect([...SIGNAL_EVIDENCE_REASONS]).toEqual(frozenList('SIGNAL_EVIDENCE_REASONS'));
  });

  it('name as gaps exactly the reasons whose on-null default is needs_review', () => {
    const defaults = onNullDefaults();
    expect(Object.keys(defaults).sort()).toEqual([...SIGNAL_NULL_REASONS].sort());
    expect([...GAP_NULL_REASONS].sort()).toEqual(
      Object.entries(defaults)
        .filter(([, action]) => action === 'needs_review')
        .map(([reason]) => reason)
        .sort(),
    );
    expect(isGapNullReason('list_stale')).toBe(true);
    expect(isGapNullReason('ipv6_not_covered')).toBe(false);
  });
});
