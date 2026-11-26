/**
 * Builds the committed matching tables of `packages/checks/data/` (plan C58.2, C58.4, C58.6) from
 * the pinned sources of `data/manifest.json`, a dev-only step:
 *
 *   python3 scripts/fetch_data.py      # downloads every pinned source, checking its SHA-256
 *   node --conditions=@openverify/source --import ./scripts/register-ts.mjs \
 *     scripts/build-matching-data.ts   # from packages/checks
 *
 * - `matching-dictionaries.json`: libpostal's street types, separable street suffixes,
 *   directionals, unit designators, place-name abbreviations, personal titles and suffixes and
 *   legal forms (MIT), folded as the matchers fold text and merged by canonical form;
 * - `subdivisions.json`: OpenCage's subdivision codes and names per country (MIT);
 * - `postal-codes.json`: libaddressinput's postal-code pattern and examples per country
 *   (CC BY 4.0, attributed in `data/NOTICE`), each pattern checked against its examples.
 *
 * Each table lists the sources it was built from with their SHA-256; the build refuses a source
 * whose bytes differ from the manifest. Nothing here runs in CI or at run time.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldText } from '../src/matching/text.js';

/** A source a table was built from: its manifest name, digest and licence. */
export interface TableSource {
  readonly name: string;
  readonly sha256: string;
  readonly license: string;
}

/** One manifest entry, as far as the build reads it. */
export interface ManifestEntry {
  readonly name: string;
  readonly filename: string;
  readonly sha256: string;
  readonly license: string;
}

const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt'] as const;
const libpostal = (dictionary: string, languages: readonly string[]) =>
  languages.map((language) => `libpostal_${language}_${dictionary}`);
const WITHOUT_NL = LANGUAGES.filter((language) => language !== 'nl');

/** The roles of the dictionary table and the sources each is built from. */
export const DICTIONARY_ROLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'street-types': [
    ...libpostal('street_types', LANGUAGES),
    ...libpostal('concatenated_suffixes_separable', ['de', 'nl']),
  ],
  'separable-suffixes': libpostal('concatenated_suffixes_separable', ['de', 'nl']),
  directionals: libpostal('directionals', LANGUAGES),
  'unit-types': libpostal('unit_types_numbered', LANGUAGES),
  toponyms: libpostal('toponyms', WITHOUT_NL),
  'personal-titles': libpostal('personal_titles', LANGUAGES),
  'personal-suffixes': libpostal('personal_suffixes', ['en', 'de', 'es', 'pt']),
  'company-types': libpostal('company_types', WITHOUT_NL),
});

/** Roles whose one-letter variants stay: compass points and generational suffixes. */
const KEEPS_SINGLE_LETTERS = new Set(['directionals', 'personal-suffixes']);

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** Both renderings of a phrase, the simplified first, without repeats. */
function renderings(phrase: string): string[] {
  const folded = foldText(phrase);
  return [...new Set([folded.simplified, folded.expanded])].filter(Boolean);
}

/**
 * One libpostal dictionary: an equivalence class per line, canonical first, every phrase folded
 * as the matchers fold text, empty and digit-only phrases dropped, duplicates removed.
 */
export function parseLibpostalDictionary(text: string): string[][] {
  return text.split('\n').flatMap((line) => {
    const phrases = [
      ...new Set(
        line
          .split('|')
          .flatMap(renderings)
          .filter((phrase) => !/^\d+$/.test(phrase)),
      ),
    ];
    return phrases.length === 0 ? [] : [phrases];
  });
}

/**
 * Merges the classes of several dictionaries by canonical form, sorted by it. With
 * `dropSingleLetters`, one-letter variants (ambiguous with initials) are left out.
 */
export function mergeEquivalences(
  dictionaries: readonly (readonly (readonly string[])[])[],
  options: { dropSingleLetters: boolean },
): string[][] {
  const classes = new Map<string, Set<string>>();
  for (const dictionary of dictionaries) {
    for (const [canonical, ...variants] of dictionary) {
      if (canonical === undefined || (options.dropSingleLetters && canonical.length === 1)) {
        continue;
      }
      const members = classes.get(canonical) ?? new Set([canonical]);
      for (const variant of variants) {
        if (!(options.dropSingleLetters && variant.length === 1)) {
          members.add(variant);
        }
      }
      classes.set(canonical, members);
    }
  }
  return [...classes.entries()]
    .sort(([a], [b]) => byCodePoint(a, b))
    .map(([, members]) => [...members]);
}

// eslint-disable-next-line security/detect-unsafe-regex -- a development script over the pinned OpenCage data file, never request text
const STATE_LINE = /^( *)(?:"([^"]+)"|([^":#]+)):(?: +(.*))?$/;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const NAME_KEY = /^(?:default|alt(?:_[a-z]{2})?)$/;

/** OpenCage `state_codes.yaml`: per country, each code with its folded names. */
export function parseStateCodes(text: string): Record<string, string[][]> {
  const countries: Record<string, string[][]> = {};
  let codes: string[][] | undefined;
  let entry: string[] | undefined;
  const addNames = (target: string[], value: string | undefined) => {
    const name = (value ?? '').trim().replace(/^"(.*)"$/, '$1');
    for (const rendering of renderings(name)) {
      if (!target.includes(rendering)) {
        target.push(rendering);
      }
    }
  };
  text.split('\n').forEach((raw, index) => {
    const line = raw.trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) {
      return;
    }
    const match = STATE_LINE.exec(line);
    const indent = match?.[1]?.length;
    const key = match?.[2] ?? match?.[3];
    const where = `line ${String(index + 1)}`;
    if (match === null || key === undefined) {
      throw new Error(`${where}: not a key and value`);
    }
    if (indent === 0 && /^[A-Z]{2}$/.test(key) && match[4] === undefined) {
      codes = [];
      countries[key] = codes;
      entry = undefined;
    } else if (indent === 4 && codes !== undefined) {
      entry = [key.trim()];
      addNames(entry, match[4]);
      codes.push(entry);
    } else if (indent === 6 && entry !== undefined && NAME_KEY.test(key)) {
      addNames(entry, match[4]);
    } else {
      throw new Error(
        `${where}: ${JSON.stringify(key)} does not fit the country, code, name levels`,
      );
    }
  });
  return countries;
}

const COUNTRY_INFO_LINE = /^data\/([A-Z]{2})=(\{.*\})$/;

/**
 * Examples at the pinned commit that contradict their own country's pattern, reviewed on
 * 2026-10-23 and left out: Belarus has six-digit codes (20050 has five), Estonia five (1001 has
 * four), and a British postcode never has the letter O where RH6 OHP has it (RH6 0HP). Any other
 * mismatch stops the build.
 */
export const UPSTREAM_EXAMPLE_ERRATA: Readonly<Record<string, readonly string[]>> = Object.freeze({
  BY: ['20050'],
  EE: ['1001'],
  GB: ['RH6 OHP'],
});

/**
 * libaddressinput `countryinfo.txt`: per country, its postal-code pattern and examples.
 * @throws {Error} for a pattern that does not compile or does not match one of its examples.
 */
export function parseCountryInfo(
  text: string,
): Record<string, { pattern: string; examples: string[] }> {
  const countries: Record<string, { pattern: string; examples: string[] }> = {};
  for (const line of text.split('\n')) {
    const match = COUNTRY_INFO_LINE.exec(line.trimEnd());
    const country = match?.[1];
    if (match?.[2] === undefined || country === undefined) {
      continue;
    }
    const { zip, zipex } = JSON.parse(match[2]) as { zip?: string; zipex?: string };
    if (zip === undefined || zip === '') {
      continue;
    }
    let anchored: RegExp;
    try {
      anchored = new RegExp(`^(?:${zip})$`);
    } catch (error) {
      throw new Error(`${country}: the postal-code pattern does not compile`, { cause: error });
    }
    const errata = UPSTREAM_EXAMPLE_ERRATA[country] ?? [];
    const examples = (zipex ?? '')
      .split(',')
      .map((example) => example.trim())
      .filter((example) => example !== '' && !errata.includes(example));
    for (const example of examples) {
      if (!anchored.test(example)) {
        throw new Error(
          `${country}: the postal-code pattern does not match its example ${example}`,
        );
      }
    }
    countries[country] = { pattern: zip, examples };
  }
  return countries;
}

/** The three tables, from the sources' texts by manifest name. */
export function buildMatchingTables(
  manifest: readonly ManifestEntry[],
  texts: Readonly<Record<string, string>>,
): Record<'matching-dictionaries.json' | 'subdivisions.json' | 'postal-codes.json', unknown> {
  const textOf = (name: string): string => {
    const text = texts[name];
    if (text === undefined) {
      throw new Error(`no text for ${name}`);
    }
    return text;
  };
  const sourcesOf = (names: readonly string[]): TableSource[] =>
    [...new Set(names)].sort(byCodePoint).map((name) => {
      const entry = manifest.find((candidate) => candidate.name === name);
      if (entry === undefined) {
        throw new Error(`${name} is not in data/manifest.json`);
      }
      return { name, sha256: entry.sha256, license: entry.license };
    });
  const roles = Object.entries(DICTIONARY_ROLES).map(([role, names]): [string, string[][]] => [
    role,
    mergeEquivalences(
      names.map((name) => parseLibpostalDictionary(textOf(name))),
      { dropSingleLetters: !KEEPS_SINGLE_LETTERS.has(role) },
    ),
  ]);
  return {
    'matching-dictionaries.json': {
      description:
        'OpenVerify matching dictionaries (plan C58.2, C58.4, C58.6): equivalence classes, canonical form first, every phrase folded as the matchers fold text (lower case, marks removed, punctuation as spaces, both renderings of ä, ö, ü, å and ø). Generated by packages/checks/scripts/build-matching-data.ts from the pinned sources listed below; never edit by hand.',
      licence:
        'Derived from libpostal resources/dictionaries (MIT, Copyright (c) 2015 openvenues): folded, merged by canonical form, one-letter variants left out except for directionals and generational suffixes. See packages/checks/data/NOTICE.',
      sources: sourcesOf(Object.values(DICTIONARY_ROLES).flat()),
      ...Object.fromEntries(roles),
    },
    'subdivisions.json': {
      description:
        'OpenVerify subdivision codes and names per country (plan C58.4): each code, then its default and alternative names folded as the matchers fold text. Generated by packages/checks/scripts/build-matching-data.ts; never edit by hand.',
      licence:
        'Derived from OpenCage address-formatting conf/state_codes.yaml (MIT, Copyright (c) 2020 Opencage GmbH): names folded. See packages/checks/data/NOTICE.',
      sources: sourcesOf(['opencage_state_codes']),
      countries: parseStateCodes(textOf('opencage_state_codes')),
    },
    'postal-codes.json': {
      description:
        "OpenVerify postal-code patterns per country (plan C58.4): each country's pattern, which the matchers anchor, and the examples it was checked against. Generated by packages/checks/scripts/build-matching-data.ts; never edit by hand.",
      licence:
        "Postal-code patterns and examples from Google's libaddressinput address metadata, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Modified: only each country's zip and zipex members are kept, without three examples that contradict their own patterns (BY 20050, EE 1001, GB RH6 OHP). See packages/checks/data/NOTICE.",
      sources: sourcesOf(['libaddressinput_countryinfo']),
      countries: parseCountryInfo(textOf('libaddressinput_countryinfo')),
    },
  };
}

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

/** A value that fits one line: a primitive, a list of primitives, or an object of those. */
function fitsOneLine(value: Json): boolean {
  const primitive = (item: Json) => item === null || typeof item !== 'object';
  const flatList = (item: Json) => Array.isArray(item) && item.every(primitive);
  if (primitive(value) || flatList(value)) {
    return true;
  }
  return (
    !Array.isArray(value) &&
    Object.values(value as Record<string, Json>).every((item) => primitive(item) || flatList(item))
  );
}

function printJson(value: Json, indent: number): string {
  if (fitsOneLine(value) && indent > 0) {
    return JSON.stringify(value);
  }
  const pad = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    const items = (value as readonly Json[]).map((item) => `${pad}${printJson(item, indent + 2)}`);
    return items.length === 0 ? '[]' : `[\n${items.join(',\n')}\n${' '.repeat(indent)}]`;
  }
  const entries = Object.entries(value as Record<string, Json>).map(
    ([key, item]) => `${pad}${JSON.stringify(key)}: ${printJson(item, indent + 2)}`,
  );
  return `{\n${entries.join(',\n')}\n${' '.repeat(indent)}}`;
}

/** A table as written: two-space JSON whose lists hold one entry per line, final newline. */
export function serializeTable(table: unknown): string {
  return `${printJson(table as Json, 0)}\n`;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function main(): void {
  const manifest = (
    JSON.parse(readFileSync(join(ROOT, 'data', 'manifest.json'), 'utf8')) as {
      data: ManifestEntry[];
    }
  ).data;
  const needed = [
    ...new Set([
      ...Object.values(DICTIONARY_ROLES).flat(),
      'opencage_state_codes',
      'libaddressinput_countryinfo',
    ]),
  ];
  const texts: Record<string, string> = {};
  for (const name of needed) {
    const entry = manifest.find((candidate) => candidate.name === name);
    if (entry === undefined) {
      throw new Error(`${name} is not in data/manifest.json`);
    }
    const bytes = readFileSync(join(ROOT, 'data', entry.filename));
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`data/${entry.filename} is not the pinned file; run scripts/fetch_data.py`);
    }
    texts[name] = bytes.toString('utf8');
  }
  for (const [file, table] of Object.entries(buildMatchingTables(manifest, texts))) {
    const json = serializeTable(table);
    writeFileSync(join(ROOT, 'packages', 'checks', 'data', file), json);
    process.stdout.write(`wrote ${file} (${String(Buffer.byteLength(json))} bytes)\n`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
