/**
 * The equivalence classes of `matching-dictionaries.json` (C58.2, C58.4, C58.6), read on first use:
 * for each role, every folded phrase with the canonical forms it stands for. A phrase can stand
 * for several (`st` is street and saint; `dr` is drive and doctor): matchers compare the sets, so
 * two phrases agree when they share a canonical form.
 */

import { z } from 'zod';
import { readMatchingData } from './data-files.js';

/** The roles of the dictionary table. */
export const MATCHING_DICTIONARY_ROLES = [
  'street-types',
  'separable-suffixes',
  'directionals',
  'unit-types',
  'toponyms',
  'personal-titles',
  'personal-suffixes',
  'company-types',
] as const;
export type DictionaryRole = (typeof MATCHING_DICTIONARY_ROLES)[number];

/** A phrase found in a token list: how many tokens it spans and what it stands for. */
export interface PhraseMatch {
  readonly length: number;
  readonly canonicals: readonly string[];
}

interface RoleIndex {
  /** Each folded phrase to the canonical forms of the classes it belongs to. */
  readonly canonicals: ReadonlyMap<string, readonly string[]>;
  /** The most tokens a phrase of the role has. */
  readonly longest: number;
}

const dictionarySchema = z.object(
  Object.fromEntries(
    MATCHING_DICTIONARY_ROLES.map((role) => [role, z.array(z.array(z.string().min(1)).min(1))]),
  ) as Record<DictionaryRole, z.ZodArray<z.ZodArray<z.ZodString>>>,
);

let loaded: Readonly<Record<DictionaryRole, RoleIndex>> | undefined;

function roleIndex(role: DictionaryRole): RoleIndex {
  if (loaded === undefined) {
    const table = dictionarySchema.parse(readMatchingData('matching-dictionaries.json'));
    const indexes = {} as Record<DictionaryRole, RoleIndex>;
    for (const name of MATCHING_DICTIONARY_ROLES) {
      const canonicals = new Map<string, string[]>();
      let longest = 1;
      for (const [canonical, ...variants] of table[name]) {
        if (canonical === undefined) {
          continue;
        }
        for (const phrase of [canonical, ...variants]) {
          const known = canonicals.get(phrase) ?? [];
          if (!known.includes(canonical)) {
            known.push(canonical);
          }
          canonicals.set(phrase, known);
          longest = Math.max(longest, phrase.split(' ').length);
        }
      }
      indexes[name] = { canonicals, longest };
    }
    loaded = indexes;
  }
  return loaded[role];
}

/** The canonical forms a folded phrase stands for in `role`; empty when it is in no class. */
export function canonicalsOf(role: DictionaryRole, phrase: string): readonly string[] {
  return roleIndex(role).canonicals.get(phrase) ?? [];
}

/** Every phrase of `role`, canonical forms and variants alike. */
export function phrasesOf(role: DictionaryRole): readonly string[] {
  return [...roleIndex(role).canonicals.keys()];
}

/** The longest phrase of `role` that starts at `tokens[start]`, or `null`. */
export function phraseAt(
  role: DictionaryRole,
  tokens: readonly string[],
  start: number,
): PhraseMatch | null {
  const { canonicals, longest } = roleIndex(role);
  for (let length = Math.min(longest, tokens.length - start); length >= 1; length -= 1) {
    const found = canonicals.get(tokens.slice(start, start + length).join(' '));
    if (found !== undefined) {
      return { length, canonicals: found };
    }
  }
  return null;
}

/** The longest phrase of `role` that ends with `tokens[end - 1]`, or `null`. */
export function phraseEndingAt(
  role: DictionaryRole,
  tokens: readonly string[],
  end: number,
): PhraseMatch | null {
  const { canonicals, longest } = roleIndex(role);
  for (let length = Math.min(longest, end); length >= 1; length -= 1) {
    const found = canonicals.get(tokens.slice(end - length, end).join(' '));
    if (found !== undefined) {
      return { length, canonicals: found };
    }
  }
  return null;
}
