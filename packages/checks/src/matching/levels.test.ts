import { describe, expect, it } from 'vitest';
import {
  MATCH_METHODS,
  evaluateMatchGroup,
  evaluateMatchGroups,
  fieldMatch,
  meetsRequirement,
  type MatchGroup,
} from './levels.js';

describe('fieldMatch', () => {
  it('keeps the level and orders methods as the public list does, without duplicates', () => {
    const match = fieldMatch('partial', ['nickname', 'fold_characters', 'nickname']);

    expect(match).toEqual({
      level: 'partial',
      methods: ['fold_characters', 'nickname'],
      flags: [],
    });
  });

  it('sorts and deduplicates flags', () => {
    expect(fieldMatch('missing', [], ['script-mismatch', 'a', 'script-mismatch']).flags).toEqual([
      'a',
      'script-mismatch',
    ]);
  });

  it('lists the eleven public method ids', () => {
    expect(MATCH_METHODS).toEqual([
      'remove_prefixes',
      'remove_suffixes',
      'remove_special_characters',
      'fold_characters',
      'string_similarity',
      'string_difference',
      'nickname',
      'substring',
      'tokenization',
      'date_similarity',
      'date_difference',
    ]);
  });
});

describe('meetsRequirement', () => {
  it.each([
    ['full', 'full', true],
    ['full', 'partial', true],
    ['partial', 'partial', true],
    ['partial', 'full', false],
    ['none', 'partial', false],
    ['none', 'full', false],
    ['missing', 'partial', false],
    ['missing', 'full', false],
  ] as const)('%s meets %s: %s', (level, requirement, expected) => {
    expect(meetsRequirement(level, requirement)).toBe(expected);
  });
});

describe('evaluateMatchGroup', () => {
  const group: MatchGroup = { name: 'partial', birthdate: 'partial', address: 'full' };

  it('is met when every field reaches its level', () => {
    expect(
      evaluateMatchGroup(group, { name: 'partial', birthdate: 'full', address: 'full' }),
    ).toEqual({ fields: group, outcome: 'met', unmetFields: [], missingFields: [] });
  });

  it('is unmet when a field is none, or below its level', () => {
    expect(
      evaluateMatchGroup(group, { name: 'none', birthdate: 'full', address: 'partial' }),
    ).toMatchObject({ outcome: 'unmet', unmetFields: ['name', 'address'], missingFields: [] });
  });

  it('is undecidable when no field is below its level and some field is missing', () => {
    expect(evaluateMatchGroup(group, { name: 'full', address: 'full' })).toMatchObject({
      outcome: 'undecidable',
      unmetFields: [],
      missingFields: ['birthdate'],
    });
  });

  it('stays unmet when one field is missing and another is none (a contradiction wins)', () => {
    expect(
      evaluateMatchGroup(group, { name: 'none', birthdate: 'missing', address: 'full' }),
    ).toMatchObject({ outcome: 'unmet', unmetFields: ['name'], missingFields: ['birthdate'] });
  });
});

describe('evaluateMatchGroups (C58.1)', () => {
  const NAME_BIRTHDATE_ADDRESS: MatchGroup = {
    name: 'partial',
    birthdate: 'partial',
    address: 'partial',
  };

  it('passes when any group is met', () => {
    const result = evaluateMatchGroups(
      [{ name: 'partial', 'phone-number': 'full' }, NAME_BIRTHDATE_ADDRESS],
      { name: 'full', 'phone-number': 'none', birthdate: 'partial', address: 'partial' },
    );

    expect(result.outcome).toBe('met');
    expect(result.groups.map((group) => group.outcome)).toEqual(['unmet', 'met']);
  });

  it('a step that collects name and phone only: the default group is undecidable, not unmet', () => {
    // C58.1 test: no birthdate and no address were collected, so both are missing.
    const result = evaluateMatchGroups([NAME_BIRTHDATE_ADDRESS], {
      name: 'full',
      'phone-number': 'full',
    });

    expect(result.outcome).toBe('undecidable');
    expect(result.groups[0]?.missingFields).toEqual(['birthdate', 'address']);
  });

  it('a record without a birthdate is undecidable, never a mismatch', () => {
    const result = evaluateMatchGroups([NAME_BIRTHDATE_ADDRESS], {
      name: 'partial',
      birthdate: 'missing',
      address: 'full',
    });

    expect(result.outcome).toBe('undecidable');
  });

  it('a business that left both optional inputs blank is undecidable', () => {
    // C58.1 test: the business groups name the registration number and the address.
    const result = evaluateMatchGroups(
      [
        { name: 'partial', 'registration-number': 'full' },
        { name: 'partial', address: 'partial' },
      ],
      { name: 'full' },
    );

    expect(result.outcome).toBe('undecidable');
    expect(result.groups.map((group) => group.outcome)).toEqual(['undecidable', 'undecidable']);
  });

  it('fails only when every group is unmet', () => {
    const groups: MatchGroup[] = [
      { name: 'partial', 'registration-number': 'full' },
      { name: 'partial', address: 'partial' },
    ];

    expect(
      evaluateMatchGroups(groups, { name: 'none', 'registration-number': 'full', address: 'full' })
        .outcome,
    ).toBe('unmet');
    expect(
      evaluateMatchGroups(groups, { name: 'full', 'registration-number': 'none' }).outcome,
    ).toBe('undecidable');
  });

  it('is undecidable without any group, so nothing passes on an empty configuration', () => {
    expect(evaluateMatchGroups([], { name: 'full' })).toEqual({
      outcome: 'undecidable',
      groups: [],
    });
  });
});
