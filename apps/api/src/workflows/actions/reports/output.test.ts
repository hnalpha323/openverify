/**
 * C122.1 (H10): a step says what the job that made a match stored, and a decision record reads it.
 * Nothing is inferred from the report's type, so a fuzzy hit never reads as an exact one.
 */
import { describe, expect, it } from 'vitest';
import { matchFacts } from './output.js';

describe('matchFacts (C122.1, H10)', () => {
  it('reads a custom list’s match, which stores its own facts', () => {
    const snapshot = {
      entity: { method: 'cidr', tier: 'R', confidence: null, approximate: false },
      components: { methods: ['cidr'] },
    };

    expect(matchFacts(snapshot, 'H', 0.9)).toEqual({
      method: 'cidr',
      tier: 'R',
      confidence: null,
      approximate: false,
    });
  });

  it('reads a watchlist hit by its components, at the report’s tier, with its score', () => {
    const snapshot = { components: { methods: ['jaro-winkler', 'phonetic'] } };

    expect(matchFacts(snapshot, 'H', 0.8)).toEqual({
      method: 'jaro-winkler',
      tier: 'H',
      confidence: 0.8,
      approximate: true,
    });
  });

  it('falls back on the match types', () => {
    expect(matchFacts({ 'match-types': ['crypto_address_exact'] }, 'R', 1).method).toBe(
      'crypto_address_exact',
    );
  });

  it('says it is not recorded, for a snapshot redaction took, and guesses nothing', () => {
    expect(matchFacts(null, 'H', 0.8)).toMatchObject({ method: 'not_recorded', approximate: true });
  });
});
