/** C69.4: the matcher version joins the scorer's rules and the keys version. */
import { describe, expect, it } from 'vitest';
import { keysVersion } from '../keys/index.js';
import { SCORER_VERSION, matcherVersion } from './index.js';

describe('matcherVersion', () => {
  it('joins the scorer version and the keys version, within the 200 characters a report serves', () => {
    const digest = 'b'.repeat(64);
    expect(matcherVersion(digest)).toBe(`${SCORER_VERSION};${keysVersion(digest)}`);
    expect(matcherVersion(digest).length).toBeLessThanOrEqual(200);
    expect(() => matcherVersion('not a digest')).toThrow(/SHA-256/);
  });

  it('moves with the typo rule: an adjacent transposition is one typo (owner decision 4 after 6B)', () => {
    expect(SCORER_VERSION).toBe('scorer-2');
  });
});
