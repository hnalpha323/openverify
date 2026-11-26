/**
 * C82.3: US ZIP-to-state consistency, from the state ZIP prefixes of Google's libaddressinput
 * address metadata (`data/US`'s `sub_keys` and `sub_zips`; CC BY 4.0, attributed in
 * `packages/checks/data/reports/NOTICE`), pinned in `data/manifest.json` as
 * `libaddressinput_countryinfo` and generated into `us-zip-prefixes.json` by the builder. A ZIP is
 * consistent with a state when its digits start with one of the state's prefixes.
 */
import { z } from 'zod';
import { readReportData } from '../data.js';

/** The table as the builder writes it: each state or territory code with its prefix pattern. */
export interface UsZipPrefixTable {
  readonly description: string;
  readonly licence: string;
  readonly sources: readonly {
    readonly name: string;
    readonly sha256: string;
    readonly license: string;
  }[];
  /** Code (`CA`, `PR`, `AE`) to libaddressinput's prefix pattern (`9[0-5]|96[01]`). */
  readonly states: Readonly<Record<string, string>>;
}

/** The generated table's file. */
export const US_ZIP_PREFIXES_FILE = 'us-zip-prefixes.json';

/**
 * Reads the US state prefixes from libaddressinput's `countryinfo.txt`.
 * @throws {Error} when the US line is missing, its keys and prefixes do not pair up, or a prefix
 *   pattern does not compile or does not match its own examples.
 */
export function parseUsZipPrefixes(countryInfo: string): Record<string, string> {
  const line = countryInfo
    .split('\n')
    .map((text) => text.trimEnd())
    .find((text) => text.startsWith(US_LINE));
  if (line === undefined) {
    throw new Error('libaddressinput countryinfo has no data/US line');
  }
  const us = countryLineSchema.parse(JSON.parse(line.slice(US_LINE.length)));
  const keys = us.sub_keys.split('~');
  const prefixes = us.sub_zips.split('~');
  const examples = us.sub_zipexs.split('~');
  if (keys.length !== prefixes.length || keys.length !== examples.length) {
    throw new Error('the US state keys, ZIP prefixes and examples do not pair up');
  }
  const states: Record<string, string> = {};
  keys.forEach((key, index) => {
    const prefix = prefixes[index] ?? '';
    let pattern: RegExp;
    try {
      pattern = prefixPattern(prefix);
    } catch (error) {
      throw new Error(`${key}: the ZIP prefix pattern does not compile`, { cause: error });
    }
    for (const example of (examples[index] ?? '').split(/[,:]/u)) {
      if (!pattern.test(example)) {
        throw new Error(`${key}: the ZIP prefix pattern does not match its example ${example}`);
      }
    }
    states[key] = prefix;
  });
  return states;
}

/** Every state and territory code the table holds, sorted. */
export function usZipStateCodes(): readonly string[] {
  return [...prefixes().keys()].sort();
}

/**
 * Whether a US ZIP (five digits, or ZIP+4) belongs to a state or territory code; `null` for a code
 * the table does not hold or a value that is no ZIP.
 */
export function usZipMatchesState(zip: string, state: string): boolean | null {
  const digits = zip.replace(/[\s-]/gu, '');
  const pattern = prefixes().get(state.trim().toUpperCase());
  if (!ZIP.test(digits) || pattern === undefined) {
    return null;
  }
  return pattern.test(digits.slice(0, 5));
}

const US_LINE = 'data/US=';
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const ZIP = /^\d{5}(?:\d{4})?$/u;
const countryLineSchema = z.object({
  sub_keys: z.string().min(1),
  sub_zips: z.string().min(1),
  sub_zipexs: z.string().min(1),
});
const tableSchema = z.object({ states: z.record(z.string(), z.string().min(1)) });

/** A prefix pattern, anchored at the start of a five-digit ZIP only (the input is digits). */
const prefixPattern = (prefix: string) => new RegExp(`^(?:${prefix})`, 'u');

let loaded: ReadonlyMap<string, RegExp> | undefined;

function prefixes(): ReadonlyMap<string, RegExp> {
  loaded ??= new Map(
    Object.entries(tableSchema.parse(readReportData(US_ZIP_PREFIXES_FILE)).states).map(
      ([state, prefix]) => [state, prefixPattern(prefix)],
    ),
  );
  return loaded;
}
