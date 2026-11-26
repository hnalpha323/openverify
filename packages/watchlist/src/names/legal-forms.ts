/**
 * C78.1, C79.2: legal forms. A name's legal forms are read from the committed table
 * `packages/watchlist/data/legal-forms.json`, generated once from rigour `org_types.yml` (MIT, its
 * commit and SHA-256 recorded in the table) by `scripts/build-legal-forms.mjs`, and then from C58's
 * libpostal company types for any phrase rigour lacks. A legal form compares by its generic tag
 * (`llc`, `jsc`, ...) when it has one, else by its own id: its key is `g:<tag>`, `f:<id>` or, for a
 * C58 company type, `c:<canonical form>`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phraseAt, phraseEndingAt } from '@openverify/checks';
import { z } from 'zod';

/** One legal form of the table: its id, its generic tag and its phrases (folded tokens, spaced). */
export interface LegalForm {
  readonly id: string;
  readonly generic: string | null;
  readonly phrases: readonly string[];
}

/** Where the table came from (C78.1): the pinned source file, its licence and its text. */
export interface LegalFormSource {
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly sha256: string;
  readonly license: string;
  readonly licenseSha256: string;
  readonly licenseText: string;
}

export interface LegalFormTable {
  readonly format: 'openverify/legal-forms/v1';
  readonly source: LegalFormSource;
  readonly forms: readonly LegalForm[];
}

/** A legal form found in a token list: how many tokens it spans and what it compares by. */
export interface LegalFormMatch {
  readonly length: number;
  readonly key: string;
}

/** The committed table's path: `data/` beside `src/` and `dist/`. */
export const LEGAL_FORMS_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data',
  'legal-forms.json',
);

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const tableSchema = z.strictObject({
  format: z.literal('openverify/legal-forms/v1'),
  source: z.strictObject({
    repository: z.url(),
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    path: z.string().min(1),
    sha256,
    license: z.literal('MIT'),
    licenseSha256: sha256,
    licenseText: z.string().min(1),
  }),
  forms: z.array(
    z.strictObject({
      id: z.string().min(1),
      generic: z.string().min(1).nullable(),
      phrases: z.array(z.string().min(1)).min(1),
    }),
  ),
});

interface LoadedTable {
  readonly table: LegalFormTable;
  /** Each phrase to its key: the smallest of the keys of the forms that list it. */
  readonly keys: ReadonlyMap<string, string>;
  /** The most tokens a phrase has. */
  readonly longest: number;
}

let loaded: LoadedTable | undefined;

function load(): LoadedTable {
  if (loaded === undefined) {
    const table = tableSchema.parse(JSON.parse(readFileSync(LEGAL_FORMS_FILE, 'utf8')));
    const keys = new Map<string, string>();
    let longest = 1;
    for (const form of table.forms) {
      const key = form.generic === null ? `f:${form.id}` : `g:${form.generic}`;
      for (const phrase of form.phrases) {
        const known = keys.get(phrase);
        keys.set(phrase, known === undefined || key < known ? key : known);
        longest = Math.max(longest, phrase.split(' ').length);
      }
    }
    loaded = { table, keys, longest };
  }
  return loaded;
}

/** The committed table, read and checked on first use. */
export function legalFormTable(): LegalFormTable {
  return load().table;
}

function longestPhrase(
  tokens: readonly string[],
  from: number,
  span: (length: number) => readonly string[],
): LegalFormMatch | null {
  const { keys, longest } = load();
  for (let length = Math.min(longest, from); length >= 1; length -= 1) {
    const key = keys.get(span(length).join(' '));
    if (key !== undefined) {
      return { length, key };
    }
  }
  return null;
}

/** The longest legal form that starts at `tokens[start]` (texts as {@link phraseText} gives). */
export function legalFormAt(tokens: readonly string[], start: number): LegalFormMatch | null {
  const found = longestPhrase(tokens, tokens.length - start, (length) =>
    tokens.slice(start, start + length),
  );
  if (found !== null) {
    return found;
  }
  const c58 = phraseAt('company-types', tokens, start);
  return c58 === null ? null : { length: c58.length, key: `c:${c58.canonicals[0] ?? ''}` };
}

/** The longest legal form that ends with `tokens[end - 1]`. */
export function legalFormEndingAt(tokens: readonly string[], end: number): LegalFormMatch | null {
  const found = longestPhrase(tokens, end, (length) => tokens.slice(end - length, end));
  if (found !== null) {
    return found;
  }
  const c58 = phraseEndingAt('company-types', tokens, end);
  return c58 === null ? null : { length: c58.length, key: `c:${c58.canonicals[0] ?? ''}` };
}
