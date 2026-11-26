/**
 * The dev-only build of `data/legal-forms.json` (C78.1), on rigour's `org_types.yml` (MIT): a
 * reader of exactly the YAML shape that file uses (a `types:` list of entries with `display`,
 * `compare`, `generic` and an `aliases` list), refusing anything else, and the table builder.
 * `scripts/build-legal-forms.mjs` runs it on the pinned file; nothing here runs in CI or at run
 * time.
 */
import type { LegalForm, LegalFormSource, LegalFormTable } from './legal-forms.js';
import { nameToken, splitNameText } from './tokens.js';

/** One entry of `org_types.yml`. */
export interface OrgTypeEntry {
  readonly display: string | null;
  readonly compare: string | null;
  readonly generic: string | null;
  readonly aliases: readonly string[];
}

const ENTRY = /^ {2}- ([a-z]+):(.*)$/u;
const MEMBER = /^ {4}([a-z]+):(.*)$/u;
const ALIAS = /^ {6}- (.+)$/u;
const KEYS = new Set(['display', 'compare', 'generic', 'aliases']);

const lineError = (index: number, why: string) =>
  new Error(`org_types.yml line ${String(index + 1)}: ${why}`);

/** A scalar: a double-quoted string, or plain text up to a ` #` comment. */
function scalar(raw: string, index: number): string {
  const text = raw.trim();
  if (text.startsWith('"')) {
    const close = text.indexOf('"', 1);
    if (close === -1) {
      throw lineError(index, 'an unterminated quoted value');
    }
    const rest = text.slice(close + 1).trim();
    if (rest !== '' && !rest.startsWith('#')) {
      throw lineError(index, 'text after a quoted value');
    }
    return text.slice(1, close);
  }
  const comment = text.indexOf(' #');
  return (comment === -1 ? text : text.slice(0, comment)).trim();
}

interface DraftEntry {
  display: string | null;
  compare: string | null;
  generic: string | null;
  aliases: string[] | null;
}

/**
 * Reads `org_types.yml`.
 * @throws {Error} naming the line of any shape the file does not use.
 */
export function parseOrgTypes(yaml: string): OrgTypeEntry[] {
  const entries: DraftEntry[] = [];
  const lines = yaml.split('\n').map((line) => line.replace(/\r$/u, ''));
  let header = false;
  let current: DraftEntry | null = null;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }
    if (!header) {
      if (line !== 'types:') {
        throw lineError(index, 'expected "types:"');
      }
      header = true;
      continue;
    }
    const alias = ALIAS.exec(line);
    if (alias !== null) {
      if (current?.aliases == null) {
        throw lineError(index, 'an alias outside an aliases list');
      }
      current.aliases.push(scalar(alias[1] ?? '', index));
      continue;
    }
    const entry = ENTRY.exec(line);
    const member = entry ?? MEMBER.exec(line);
    if (member === null) {
      throw lineError(index, 'a line of an unknown shape');
    }
    if (entry !== null) {
      current = { display: null, compare: null, generic: null, aliases: null };
      entries.push(current);
    }
    const key = member[1] ?? '';
    const value = member[2] ?? '';
    if (current === null || !KEYS.has(key)) {
      throw lineError(index, `an unknown key "${key}"`);
    }
    if (key === 'aliases') {
      if (value.trim() !== '') {
        throw lineError(index, 'aliases must be a list');
      }
      current.aliases = [];
    } else {
      current[key as 'display' | 'compare' | 'generic'] = scalar(value, index);
    }
  }
  if (!header) {
    throw lineError(0, 'expected "types:"');
  }
  return entries.map((entry) => ({
    display: entry.display,
    compare: entry.compare,
    generic: entry.generic,
    aliases: entry.aliases ?? [],
  }));
}

/** A phrase folded as name tokens are, in the simplified and the expanded rendering. */
function phrasesOf(text: string): string[] {
  const tokens = splitNameText(text).map((raw) => nameToken(raw));
  const simple = tokens.map((token) => token.original ?? token.simple).join(' ');
  const expanded = tokens.map((token) => token.original ?? token.expanded).join(' ');
  return [...new Set([simple, expanded])].filter((phrase) => phrase.trim() !== '');
}

const present = (value: string | null): value is string => value !== null && value.trim() !== '';

/**
 * The table: one form per entry with at least one phrase, its id the folded `compare` (else
 * `display`, else the first alias) and its phrases every alias, `display` and `compare` folded as
 * name tokens are, deduplicated; forms sorted by id. Entries that fold to one id and one generic
 * tag are merged; an id met with another generic tag gains it as a suffix (`id/tag`).
 */
export function buildLegalFormTable(
  entries: readonly OrgTypeEntry[],
  source: LegalFormSource,
): LegalFormTable {
  const forms = new Map<string, { id: string; generic: string | null; phrases: Set<string> }>();
  for (const entry of entries) {
    const texts = [entry.display, entry.compare, ...entry.aliases].filter(present);
    const phrases = texts.flatMap(phrasesOf);
    const named = [entry.compare, entry.display, entry.aliases[0] ?? null].find(present);
    const id = named === undefined ? undefined : phrasesOf(named)[0];
    if (id === undefined || phrases.length === 0) {
      continue;
    }
    const generic = present(entry.generic) ? entry.generic.trim().toLowerCase() : null;
    const key = `${id}\u0000${generic ?? ''}`;
    const form = forms.get(key) ?? { id, generic, phrases: new Set<string>() };
    phrases.forEach((phrase) => form.phrases.add(phrase));
    forms.set(key, form);
  }
  const genericsById = new Map<string, Set<string | null>>();
  for (const form of forms.values()) {
    genericsById.set(form.id, (genericsById.get(form.id) ?? new Set()).add(form.generic));
  }
  const built: LegalForm[] = [...forms.values()].map((form) => ({
    id:
      (genericsById.get(form.id)?.size ?? 0) > 1 && form.generic !== null
        ? `${form.id}/${form.generic}`
        : form.id,
    generic: form.generic,
    phrases: [...form.phrases].sort(),
  }));
  built.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { format: 'openverify/legal-forms/v1', source, forms: built };
}

/** The table as committed: two-space JSON with a final newline. */
export function serialiseLegalFormTable(table: LegalFormTable): string {
  return `${JSON.stringify(table, null, 2)}\n`;
}
