/**
 * Builds `packages/checks/data/nicknames.json` (plan C58.3), a dev-only step that never touches
 * the network:
 *
 *   node --conditions=@openverify/source --import ./scripts/register-ts.mjs \
 *     scripts/build-nicknames.ts [--wikidata-result <saved query result>]
 *
 * Inputs, all committed beside the output: `nicknames-authored.tsv` (our own rows),
 * `nicknames-wikidata.tsv` (the Wikidata pairs a reviewer accepted, with the query's date, result
 * SHA-256 and counts) and `nicknames.sparql` (the query). With `--wikidata-result`, a saved copy
 * of the query result is checked against the recorded SHA-256, and every accepted pair against
 * it. To fetch a copy (dev only, never in CI):
 *
 *   curl -G https://query.wikidata.org/sparql --data-urlencode query@data/nicknames.sparql \
 *     -H 'Accept: application/sparql-results+json' -o <scratch>/result.json
 *
 * A re-run of the query returns today's Wikidata, so its digest differs from the recorded one.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldText } from '../src/matching/text.js';

/** One authored row: a formal name, its language and its nicknames. */
export interface AuthoredNicknameRow {
  readonly formal: string;
  readonly language: string;
  readonly nicknames: readonly string[];
}

/** One reviewed Wikidata pair: the labels, the language the reviewer gave it and both items. */
export interface WikidataNicknameRow {
  readonly formal: string;
  readonly nickname: string;
  readonly language: string;
  readonly nicknameQid: string;
  readonly formalQid: string;
}

export interface WikidataNicknames {
  /** The `# key: value` lines: endpoint, retrieved-at, result-sha256 and the counts. */
  readonly record: Readonly<Record<string, string>>;
  readonly rows: readonly WikidataNicknameRow[];
}

/** What `nicknames.json` holds. */
export interface NicknameTableFile {
  readonly description: string;
  readonly licence: string;
  readonly wikidata: Readonly<Record<string, string | number>>;
  readonly counts: Readonly<Record<string, number>>;
  readonly pairs: readonly {
    readonly formal: string;
    readonly nickname: string;
    readonly languages: readonly string[];
    readonly sources: readonly string[];
  }[];
}

const AUTHORED_HEADER = 'formal\tlang\tnicknames';
const WIKIDATA_HEADER = 'formal\tnickname\tlang\tnickname-qid\tformal-qid';
const LANGUAGE = /^[a-z]{2}$/;
const QID = /^Q[1-9]\d*$/;
const RECORD_LINE = /^# ([a-z0-9-]+): (\S.*)$/;

/** The data lines of a TSV, with their 1-based line numbers: no blank, comment or header line. */
function dataLines(text: string, header: string): (readonly [number, string[]])[] {
  return text.split('\n').flatMap((raw, index) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    return line.trim() === '' || line.startsWith('#') || line === header
      ? []
      : [[index + 1, line.split('\t')] as const];
  });
}

const folded = (name: string): string => foldText(name).simplified;

/** One authored name: a single lower-case word. */
function authoredName(name: string, where: string): string {
  if (!/^\p{Ll}+$/u.test(name)) {
    throw new Error(`${where}: ${JSON.stringify(name)} must be one lower case word`);
  }
  return name;
}

/** Parses `nicknames-authored.tsv`. @throws {Error} naming the line of a malformed row. */
export function parseAuthoredNicknames(text: string): AuthoredNicknameRow[] {
  return dataLines(text, AUTHORED_HEADER).map(([line, cells]) => {
    const where = `line ${String(line)}`;
    const [formal, language, list] = cells;
    if (
      cells.length !== 3 ||
      formal === undefined ||
      language === undefined ||
      list === undefined
    ) {
      throw new Error(`${where}: expected a formal name, a language and nicknames`);
    }
    authoredName(formal, where);
    if (!LANGUAGE.test(language)) {
      throw new Error(`${where}: the language must be an ISO 639-1 code`);
    }
    const nicknames = list
      .split(',')
      .map((nickname) => nickname.trim())
      .filter(Boolean);
    if (nicknames.length === 0) {
      throw new Error(`${where}: no nickname`);
    }
    const seen = new Set<string>();
    for (const nickname of nicknames) {
      authoredName(nickname, where);
      if (folded(nickname) === folded(formal)) {
        throw new Error(`${where}: ${nickname} pairs ${formal} with itself`);
      }
      if (seen.has(folded(nickname))) {
        throw new Error(`${where}: ${nickname} is listed twice`);
      }
      seen.add(folded(nickname));
    }
    return { formal, language, nicknames };
  });
}

/** Parses `nicknames-wikidata.tsv`. @throws {Error} naming the line of a malformed row. */
export function parseWikidataNicknames(text: string): WikidataNicknames {
  const record: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = RECORD_LINE.exec(line.trimEnd());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      record[match[1]] = match[2];
    }
  }
  const rows = dataLines(text, WIKIDATA_HEADER).map(([line, cells]) => {
    const where = `line ${String(line)}`;
    const [formal, nickname, language, nicknameQid, formalQid] = cells;
    if (
      cells.length !== 5 ||
      formal === undefined ||
      nickname === undefined ||
      language === undefined ||
      nicknameQid === undefined ||
      formalQid === undefined ||
      !LANGUAGE.test(language) ||
      !QID.test(nicknameQid) ||
      !QID.test(formalQid)
    ) {
      throw new Error(`${where}: expected formal, nickname, language and two Wikidata items`);
    }
    for (const name of [formal, nickname]) {
      if (folded(name) === '' || folded(name).includes(' ')) {
        throw new Error(`${where}: ${JSON.stringify(name)} must be one word`);
      }
    }
    if (folded(formal) === folded(nickname)) {
      throw new Error(`${where}: ${nickname} pairs ${formal} with itself`);
    }
    return { formal, nickname, language, nicknameQid, formalQid };
  });
  return { record, rows };
}

const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

/** Byte-wise ordering, so the table never depends on the locale. */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Merges both sources into the table, one row per folded (formal, nickname) pair, sorted. */
export function buildNicknameTable(inputs: {
  authored: string;
  wikidata: string;
  query: string;
}): NicknameTableFile {
  const authored = parseAuthoredNicknames(inputs.authored);
  const wikidata = parseWikidataNicknames(inputs.wikidata);
  const pairs = new Map<
    string,
    { formal: string; nickname: string; languages: Set<string>; sources: Set<string> }
  >();
  const add = (formal: string, nickname: string, language: string, source: string) => {
    const key = `${folded(formal)}\t${folded(nickname)}`;
    const pair = pairs.get(key) ?? {
      formal: formal.toLowerCase(),
      nickname: nickname.toLowerCase(),
      languages: new Set<string>(),
      sources: new Set<string>(),
    };
    pair.languages.add(language);
    pair.sources.add(source);
    pairs.set(key, pair);
  };
  for (const row of authored) {
    for (const nickname of row.nicknames) {
      add(row.formal, nickname, row.language, 'authored');
    }
  }
  for (const row of wikidata.rows) {
    add(row.formal, row.nickname, row.language, `wikidata:${row.nicknameQid}/${row.formalQid}`);
  }
  const sorted = [...pairs.entries()]
    .sort(([a], [b]) => byCodePoint(a, b))
    .map(([, pair]) => ({
      formal: pair.formal,
      nickname: pair.nickname,
      languages: [...pair.languages].sort(byCodePoint),
      sources: [...pair.sources].sort((a, b) =>
        a === 'authored' ? -1 : b === 'authored' ? 1 : byCodePoint(a, b),
      ),
    }));
  const numeric = (value: string): string | number => (/^\d+$/.test(value) ? Number(value) : value);
  return {
    description:
      'OpenVerify nickname table (plan C58.3). Each pair links a formal given name and one of its nicknames; the matcher never chains pairs. Generated by packages/checks/scripts/build-nicknames.ts from nicknames-authored.tsv (our own rows) and nicknames-wikidata.tsv (Wikidata pairs a reviewer accepted); edit those files, never this one.',
    licence:
      'Authored rows: Apache-2.0, as OpenVerify. Wikidata rows: CC0-1.0 (https://www.wikidata.org/wiki/Wikidata:Licensing).',
    wikidata: {
      query: 'nicknames.sparql',
      'query-sha256': sha256(inputs.query),
      ...Object.fromEntries(
        Object.entries(wikidata.record).map(([key, value]) => [key, numeric(value)]),
      ),
      'accepted-rows': wikidata.rows.length,
    },
    counts: {
      pairs: sorted.length,
      'formal-names': new Set(sorted.map((pair) => folded(pair.formal))).size,
      authored: sorted.filter((pair) => pair.sources.includes('authored')).length,
      wikidata: sorted.filter((pair) => pair.sources.some((source) => source !== 'authored'))
        .length,
    },
    pairs: sorted,
  };
}

const ENTITY = 'http://www.wikidata.org/entity/';

/**
 * Checks a saved query result: its SHA-256 is the recorded one, and every accepted pair is one of
 * its rows. @throws {Error} on the first difference.
 */
export function checkWikidataResult(wikidata: WikidataNicknames, result: Uint8Array): void {
  const digest = sha256(result);
  if (digest !== wikidata.record['result-sha256']) {
    throw new Error(`the result's SHA-256 ${digest} is not the recorded one`);
  }
  const parsed = JSON.parse(new TextDecoder().decode(result)) as {
    results: { bindings: Record<string, { value: string } | undefined>[] };
  };
  const rows = new Set(
    parsed.results.bindings.map((binding) =>
      [
        binding.nick?.value.replace(ENTITY, ''),
        binding.nickLabel?.value,
        binding.formal?.value.replace(ENTITY, ''),
        binding.formalLabel?.value,
      ].join('\t'),
    ),
  );
  for (const row of wikidata.rows) {
    const key = [row.nicknameQid, row.nickname, row.formalQid, row.formal].join('\t');
    if (!rows.has(key)) {
      throw new Error(
        `the result has no row ${row.nickname} (${row.nicknameQid}) to ${row.formal} (${row.formalQid})`,
      );
    }
  }
}

/** The table as written: two-space JSON, one pair per line, with a final newline. */
export function serializeNicknameTable(table: NicknameTableFile): string {
  const { pairs, ...head } = table;
  const header = JSON.stringify(head, null, 2).slice(0, -2);
  const lines = pairs.map((pair) => `    ${JSON.stringify(pair)}`);
  return `${header},\n  "pairs": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

function main(argv: readonly string[]): void {
  const read = (file: string) => readFileSync(join(DATA, file), 'utf8');
  const wikidataText = read('nicknames-wikidata.tsv');
  const resultIndex = argv.indexOf('--wikidata-result');
  if (resultIndex !== -1) {
    const path = argv[resultIndex + 1];
    if (path === undefined) {
      throw new Error('--wikidata-result needs the path of a saved query result');
    }
    checkWikidataResult(parseWikidataNicknames(wikidataText), readFileSync(path));
    process.stdout.write(`checked ${path} against the recorded SHA-256 and every accepted pair\n`);
  }
  const table = buildNicknameTable({
    authored: read('nicknames-authored.tsv'),
    wikidata: wikidataText,
    query: read('nicknames.sparql'),
  });
  writeFileSync(join(DATA, 'nicknames.json'), serializeNicknameTable(table));
  process.stdout.write(`wrote nicknames.json: ${JSON.stringify(table.counts)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
