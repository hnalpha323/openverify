// @vitest-environment node
/**
 * C58, C59, C66: the matching vocabulary in words. The methods, the address components, how a
 * component compared, a group's outcomes, the flags and the PO box patterns are read from the
 * evaluators' own source (`packages/checks`, which the console does not depend on), so a value
 * added there without words here fails this test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { DATABASE_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import { DATABASE_MATCH_FIELDS, MATCH_LEVELS, MATCH_REQUIREMENTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import {
  DATABASE_PASS_MEANING,
  addressComponentText,
  attributeTerm,
  componentMatchText,
  databaseAuthorityText,
  databaseFieldText,
  groupOutcomeText,
  matchFlagText,
  matchLevelText,
  matchMethodText,
  matchRequirementText,
  poBoxPatternText,
  requirementText,
} from './database-words';

const CHECKS_SRC = new URL('../../../../packages/checks/src/', import.meta.url);
const source = (file: string) => readFileSync(new URL(file, CHECKS_SRC), 'utf8');

/** Every source file of a checks folder, tests and test helpers left out. */
const folder = (name: string) =>
  readdirSync(new URL(`${name}/`, CHECKS_SRC))
    .filter((file) => file.endsWith('.ts') && !file.includes('.test.') && file !== 'testing.ts')
    .map((file) => source(`${name}/${file}`))
    .join('\n');

/** The string literals of the array assigned to `name` (`const NAME = [...]`). */
function arrayOf(text: string, name: string): string[] {
  const found = new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\[([^\\]]*)\\]`).exec(text);
  if (found?.[1] === undefined) {
    throw new Error(`No ${name} in the source`);
  }
  return literals(found[1]);
}

/** The string literals of a union type (`type Name = 'a' | 'b'`). */
function unionOf(text: string, name: string): string[] {
  const found = new RegExp(`type ${name} =([^;]*);`).exec(text);
  if (found?.[1] === undefined) {
    throw new Error(`No ${name} in the source`);
  }
  return literals(found[1]);
}

const literals = (text: string) =>
  [...text.matchAll(/'([^']+)'/g)].flatMap((literal) => literal[1] ?? []);

const MATCHING = folder('matching');
const DATABASE = folder('database');

/**
 * The flags the matchers and the database evaluators record: those pushed onto a flag list,
 * given as `fieldMatch`'s third argument, as a partial date's `result` flag, or as a conditional
 * one-flag list (`cond ? ['flag'] : []`). A match level found there is a condition's operand
 * (`family.level === 'missing' ? […] : []`), never a flag.
 */
function recordedFlags(text: string): string[] {
  const sites = [
    /flags\.push\(([^)]*)\)/g,
    /fieldMatch\(\s*'[a-z]+',\s*[^,]*,\s*\[([^\]]*)\]/g,
    /result\(\s*'[a-z]+',\s*\[[^\]]*\],\s*('[a-z-]+')\)/g,
    /\?\s*\[\s*('[a-z-]+')\s*\]\s*:\s*\[\s*\]/g,
  ];
  const levels: readonly string[] = MATCH_LEVELS;
  return [
    ...new Set(
      sites.flatMap((site) => [...text.matchAll(site)].flatMap((m) => literals(m[1] ?? ''))),
    ),
  ]
    .filter((literal) => !levels.includes(literal))
    .sort();
}

const FLAGS = recordedFlags(`${MATCHING}\n${DATABASE}`);
const WORDS = /^[A-Z][^_]{1,79}$/;
const SENTENCE = /^[A-Z][^_]+\.$/;

describe('the match levels, requirements and methods in words (C58.1)', () => {
  it.each(MATCH_LEVELS)('says the level %s', (level) => {
    expect(matchLevelText(level).words).toMatch(WORDS);
  });

  it('says a missing level is no mismatch', () => {
    expect(matchLevelText('missing').explanation).toMatch(/never a mismatch/);
    expect(matchLevelText('full').words).toBe('Full match');
    expect(matchLevelText('none').words).toBe('No match');
  });

  it.each(MATCH_REQUIREMENTS)('says the requirement %s', (requirement) => {
    expect(matchRequirementText(requirement)).toMatch(WORDS);
  });

  it('says a partial requirement is also met by a full match', () => {
    expect(matchRequirementText('partial')).toBe('At least partial');
    expect(matchRequirementText('full')).toBe('Full');
  });

  it.each(arrayOf(source('matching/levels.ts'), 'MATCH_METHODS'))(
    'says the method %s',
    (method) => {
      expect(matchMethodText(method)).toMatch(WORDS);
    },
  );
});

describe('the match flags in words (C58)', () => {
  it('reads the flags the matchers and the database evaluators record', () => {
    expect(FLAGS).toEqual(
      expect.arrayContaining([
        'swapped',
        'near-match',
        'transposed',
        'unit-one-sided',
        'not-accepted',
        'legal-form-mismatch',
        'script-mismatch',
      ]),
    );
    expect(FLAGS.length).toBeGreaterThanOrEqual(23);
  });

  it.each(FLAGS)('says the flag %s', (flag) => {
    expect(matchFlagText(flag)?.words, flag).toMatch(WORDS);
  });

  it('explains every flag it words in one sentence', () => {
    for (const flag of FLAGS) {
      const explanation = matchFlagText(flag)?.explanation;
      if (explanation !== undefined) {
        expect(explanation, flag).toMatch(SENTENCE);
      }
    }
  });

  it('says a refused precision-limited or transposed birth date counts as missing', () => {
    expect(matchFlagText('not-accepted')?.explanation).toMatch(/missing/);
  });

  it.each(['a-flag-from-the-future', 'constructor', '__proto__'])('knows nothing of %s', (flag) => {
    expect(matchFlagText(flag)).toBeUndefined();
    expect(matchMethodText(flag)).toBeUndefined();
    expect(matchLevelText(flag)).toBeUndefined();
  });
});

describe('the match groups and address components in words (C58.1, C58.4)', () => {
  it.each(unionOf(source('matching/levels.ts'), 'MatchGroupOutcome'))(
    'says the group outcome %s, and what it means',
    (outcome) => {
      expect(groupOutcomeText(outcome)?.words).toMatch(WORDS);
      expect(groupOutcomeText(outcome)?.explanation).toMatch(SENTENCE);
    },
  );

  it('says an undecidable group sends the identity to review, never to a failure', () => {
    expect(groupOutcomeText('undecidable').explanation).toMatch(/review/);
  });

  it.each(arrayOf(source('matching/addresses.ts'), 'ADDRESS_COMPONENTS'))(
    'names the address component %s',
    (component) => {
      expect(addressComponentText(component)).toMatch(WORDS);
    },
  );

  it.each(unionOf(source('matching/postal-codes.ts'), 'ComponentMatch'))(
    'says how a component compared: %s',
    (match) => {
      expect(componentMatchText(match)).toMatch(WORDS);
    },
  );
});

describe('the database fields and values in words (C51.3, C52.8)', () => {
  it.each(DATABASE_MATCH_FIELDS)('names the match field %s', (field) => {
    expect(databaseFieldText(field)).toMatch(WORDS);
  });

  it('terms each entered value by its API member name, as the generic view did', () => {
    expect(Object.keys(DATABASE_VERIFICATION_ATTRIBUTES).map(attributeTerm)).toEqual([
      'Name first',
      'Name middle',
      'Name last',
      'Birthdate',
      'Address street 1',
      'Address street 2',
      'Address city',
      'Address subdivision',
      'Address postal code',
      'Address country code',
      'Identification number',
      'Phone number',
      'Email address',
    ]);
    expect(attributeTerm('registry-record-id')).toBe('Registry record ID');
    expect(attributeTerm('lei')).toBe('LEI');
    expect(attributeTerm('website-url')).toBe('Website URL');
  });

  it.each([
    ...new Set(
      [...source('id-po-box-detection.ts').matchAll(/\['([a-z_]+)', \//g)].map((m) => m[1] ?? ''),
    ),
  ])('says the PO box pattern %s', (pattern) => {
    expect(poBoxPatternText(pattern)).toMatch(WORDS);
  });
});

describe('what a database result means (C59, C66)', () => {
  it('says what a pass means as `docs/checks/database.md` says it, sentence by sentence', () => {
    const section = passMeansSection('database.md').replaceAll('`', '').toLowerCase();
    const sentences = sentencesOf(DATABASE_PASS_MEANING);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    for (const sentence of sentences) {
      expect(section, sentence).toContain(sentence.toLowerCase());
    }
    expect(DATABASE_PASS_MEANING).toMatch(/^The values the user entered match a record/);
    expect(DATABASE_PASS_MEANING).toMatch(/does not show that the person entering the values/);
  });

  it('says what a miss from a source means, by its authority', () => {
    expect(databaseAuthorityText(true)).toEqual({
      words: 'Yes',
      explanation: 'A miss from this source fails the identity check.',
    });
    expect(databaseAuthorityText(false)).toEqual({
      words: 'No',
      explanation: 'A miss from this source goes to review, never to a failure.',
    });
  });

  it('says whether a check is required or advisory', () => {
    expect(requirementText(true)).toBe('Required');
    expect(requirementText(false)).toBe('Advisory');
  });
});
