/**
 * The dev-only builder of the matching tables (C58.2, C58.4, C58.6), on synthetic inputs, and the
 * committed tables: built from exactly the pinned sources of `data/manifest.json`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DICTIONARY_ROLES,
  mergeEquivalences,
  parseCountryInfo,
  parseLibpostalDictionary,
  parseStateCodes,
  serializeTable,
  type TableSource,
} from '../../scripts/build-matching-data.js';
import { MATCHING_DATA_DIRECTORY, readMatchingData } from './data-files.js';

describe('parseLibpostalDictionary', () => {
  it('folds every phrase, keeps the canonical first and drops empty, digit-only and repeated ones', () => {
    const text = 'street|st|str.|St\n\navenue|av|Ave.\nstraße|str.|strasse\nnumber|#|no\n123\n';

    expect(parseLibpostalDictionary(text)).toEqual([
      ['street', 'st', 'str'],
      ['avenue', 'av', 'ave'],
      ['strasse', 'str'],
      ['number', 'no'],
    ]);
  });

  it('keeps multi-word phrases, with their punctuation turned into spaces', () => {
    expect(parseLibpostalDictionary('doing business as|d / b / a|dba\n')).toEqual([
      ['doing business as', 'd b a', 'dba'],
    ]);
  });
});

describe('mergeEquivalences', () => {
  it('merges classes with one canonical form, sorted by it', () => {
    expect(
      mergeEquivalences(
        [
          [['boulevard', 'blvd', 'bd']],
          [
            ['avenue', 'av'],
            ['boulevard', 'bd', 'bld'],
          ],
        ],
        { dropSingleLetters: false },
      ),
    ).toEqual([
      ['avenue', 'av'],
      ['boulevard', 'blvd', 'bd', 'bld'],
    ]);
  });

  it('can leave out one-letter variants, which read as initials', () => {
    expect(mergeEquivalences([[['north', 'n', 'nth']]], { dropSingleLetters: true })).toEqual([
      ['north', 'nth'],
    ]);
  });
});

describe('parseStateCodes', () => {
  it('reads each code with its default and alternative names, folded in both renderings', () => {
    const yaml = [
      'US:',
      '    # a comment',
      '    CA: California',
      '    NY: New York',
      'AT:',
      '    "1": Burgenland',
      '    "2":',
      '      default: Kärnten',
      '      alt_en: Carinthia',
      '',
    ].join('\n');

    expect(parseStateCodes(yaml)).toEqual({
      US: [
        ['CA', 'california'],
        ['NY', 'new york'],
      ],
      AT: [
        ['1', 'burgenland'],
        ['2', 'karnten', 'kaernten', 'carinthia'],
      ],
    });
  });

  it('refuses a line it cannot place', () => {
    expect(() => parseStateCodes('    CA: California\n')).toThrow(/line 1/);
  });
});

describe('parseCountryInfo', () => {
  const line = (key: string, members: Record<string, string>) =>
    `data/${key}=${JSON.stringify({ id: `data/${key}`, key, ...members })}`;

  it("takes each country's pattern and examples, and skips sub-regions and countries without one", () => {
    const text = [
      'data={"id":"data","countries":"US~DE~AQ"}',
      line('US', { zip: '\\d{5}([ \\-]\\d{4})?', zipex: '95014,22162-1010' }),
      line('DE', { zip: '\\d{5}', zipex: '26133,53225' }),
      line('US/CA', { zip: '9[0-5]|96[01]' }),
      line('AQ', {}),
    ].join('\n');

    expect(parseCountryInfo(text)).toEqual({
      US: { pattern: '\\d{5}([ \\-]\\d{4})?', examples: ['95014', '22162-1010'] },
      DE: { pattern: '\\d{5}', examples: ['26133', '53225'] },
    });
  });

  it('refuses a pattern that does not match its own example, or does not compile', () => {
    expect(() => parseCountryInfo(line('DE', { zip: '\\d{5}', zipex: '2613' }))).toThrow(/DE/);
    expect(() => parseCountryInfo(line('DE', { zip: '(\\d{5}', zipex: '26133' }))).toThrow(/DE/);
  });
});

describe('serializeTable', () => {
  it('writes two-space JSON with one list entry per line', () => {
    const json = serializeTable({ a: 'x', b: [['p', 'q'], ['r']], c: { US: [['CA', 'ca']] } });

    expect(JSON.parse(json)).toEqual({ a: 'x', b: [['p', 'q'], ['r']], c: { US: [['CA', 'ca']] } });
    expect(json).toContain('\n    ["p","q"],\n    ["r"]\n');
    expect(json.endsWith('}\n')).toBe(true);
  });
});

interface ManifestEntry {
  name: string;
  sha256: string;
  license: string;
}

const MANIFEST = JSON.parse(
  readFileSync(join(MATCHING_DATA_DIRECTORY, '..', '..', '..', 'data', 'manifest.json'), 'utf8'),
) as { data: ManifestEntry[] };
const pinned = (names: readonly string[]): TableSource[] =>
  names.map((name) => {
    const entry = MANIFEST.data.find((candidate) => candidate.name === name);
    if (entry === undefined) {
      throw new Error(`${name} is not in data/manifest.json`);
    }
    return { name, sha256: entry.sha256, license: entry.license };
  });

interface TableFile {
  sources: TableSource[];
  [key: string]: unknown;
}
const table = (file: string) => readMatchingData(file) as TableFile;
const classWith = (classes: unknown, canonical: string) =>
  (classes as string[][]).find((entry) => entry[0] === canonical);

describe('the committed matching tables (C58.4)', () => {
  it('list exactly the pinned sources they were built from, with their manifest digests', () => {
    const dictionarySources = [...new Set(Object.values(DICTIONARY_ROLES).flat())].sort();

    expect(dictionarySources.length).toBe(46);
    expect(table('matching-dictionaries.json').sources).toEqual(pinned(dictionarySources));
    expect(table('subdivisions.json').sources).toEqual(pinned(['opencage_state_codes']));
    expect(table('postal-codes.json').sources).toEqual(pinned(['libaddressinput_countryinfo']));
  });

  it('never use the CC BY-SA name and place lists libpostal also ships', () => {
    const names = Object.values(DICTIONARY_ROLES).flat();

    expect(
      names.filter((name) => /given_names|surnames|place_names|categories/.test(name)),
    ).toEqual([]);
  });

  it('hold the street, unit, direction, title, suffix and legal-form classes the matchers read', () => {
    const dictionaries = table('matching-dictionaries.json');

    expect(classWith(dictionaries['street-types'], 'street')).toEqual(
      expect.arrayContaining(['street', 'st']),
    );
    expect(classWith(dictionaries['street-types'], 'strasse')).toEqual(
      expect.arrayContaining(['strasse', 'str']),
    );
    expect(dictionaries['separable-suffixes']).toEqual(
      expect.arrayContaining([expect.arrayContaining(['strasse'])]),
    );
    expect(classWith(dictionaries.directionals, 'north')).toEqual(
      expect.arrayContaining(['north', 'n']),
    );
    expect(classWith(dictionaries['unit-types'], 'apartment')).toEqual(
      expect.arrayContaining(['apartment', 'apt']),
    );
    expect(classWith(dictionaries.toponyms, 'california')).toEqual(
      expect.arrayContaining(['california', 'ca']),
    );
    // libpostal lists Saint (st) among the titles, where the matchers read it for places too.
    expect(classWith(dictionaries['personal-titles'], 'saint')).toEqual(
      expect.arrayContaining(['saint', 'st']),
    );
    expect(classWith(dictionaries['personal-titles'], 'doctor')).toEqual(
      expect.arrayContaining(['doctor', 'dr']),
    );
    expect(classWith(dictionaries['personal-suffixes'], 'junior')).toEqual(
      expect.arrayContaining(['junior', 'jr']),
    );
    expect(classWith(dictionaries['company-types'], 'limited')).toEqual(
      expect.arrayContaining(['limited', 'ltd']),
    );
    expect(classWith(dictionaries['company-types'], 'gmbh')).toBeDefined();
  });

  it('hold subdivision codes with their names', () => {
    const { countries } = table('subdivisions.json') as unknown as {
      countries: Record<string, string[][]>;
    };

    expect(countries.US).toEqual(expect.arrayContaining([['CA', 'california']]));
    expect(countries.CA?.find((entry) => entry[0] === 'QC')).toEqual(
      expect.arrayContaining(['quebec']),
    );
  });

  it('hold postal-code patterns that match every example they ship with', () => {
    const { countries } = table('postal-codes.json') as unknown as {
      countries: Record<string, { pattern: string; examples: string[] }>;
    };

    expect(Object.keys(countries).length).toBeGreaterThan(150);
    for (const [country, { pattern, examples }] of Object.entries(countries)) {
      const anchored = new RegExp(`^(?:${pattern})$`, 'i');
      for (const example of examples) {
        expect(anchored.test(example), `${country} ${example}`).toBe(true);
      }
    }
    expect(new RegExp(`^(?:${countries.GB?.pattern ?? '$^'})$`, 'i').test('SW1A 1AA')).toBe(true);
  });
});
