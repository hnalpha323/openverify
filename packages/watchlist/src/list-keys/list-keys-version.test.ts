/**
 * Phase 6 outcome 7: the name kinds of C98.2 and C101.2 read the C78 analysis, so a change of it
 * must bump `LIST_KEYS_VERSION`, and stored items then answer `normaliser_outdated`. The analysis
 * is pinned here beside the version: when any line below fails, bump `LIST_KEYS_VERSION` and re-pin
 * it, and only then this file. `list-logic` adds the golden key vectors beside it.
 */
import { LIST_KEYS_VERSION } from '@openverify/checks';
import { describe, expect, it } from 'vitest';
import { KEYS_VERSION } from '../keys/index.js';
import { analysePersonName } from '../names/index.js';
import { WATCHLIST_LIST_KEYS_AREA } from './index.js';

/** The two ICAO 9303 forms of each token, as the keys will read them (synthetic names). */
const forms = (first: string, last: string) =>
  analysePersonName({ first, last }).tokens.map(({ simple, expanded, role }) => [
    simple,
    expanded,
    role,
  ]);

describe('LIST_KEYS_VERSION pinned against the C78 analysis (Phase 6 outcome 7)', () => {
  it('names the area', () => {
    expect(WATCHLIST_LIST_KEYS_AREA).toBe('list-keys');
  });

  it('moves with KEYS_VERSION: lists-1 reads names-2', () => {
    expect([LIST_KEYS_VERSION, KEYS_VERSION]).toEqual(['lists-1', 'names-2']);
  });

  it.each([
    [
      'Ana',
      'Müller',
      [
        ['ana', 'ana'],
        ['muller', 'mueller'],
      ],
    ],
    [
      '  JOSÉ ',
      "O'Brien",
      [
        ['jose', 'jose'],
        ['obrien', 'obrien'],
      ],
    ],
    [
      'Zoë Marie',
      'Ångström',
      [
        ['zoe', 'zoe'],
        ['marie', 'marie'],
        ['angstrom', 'aangstroem'],
      ],
    ],
  ])('keeps both folds of %j %j', (first, last, expected) => {
    expect(forms(first, last).map(([simple, expanded]) => [simple, expanded])).toEqual(expected);
  });

  it('marks which tokens are the last name, which the fuzzy candidates key (F17)', () => {
    expect(forms('Ana', 'Müller').map(([, , role]) => role)).toEqual(['given', 'family']);
  });
});
