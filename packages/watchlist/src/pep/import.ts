/**
 * C76.2, C89.2: where the PEP build reads its answers from. A sync asks the Wikidata Query
 * Service through `api-watchlists`' runner ({@link wikidataAnswerSource}); an import
 * (`watchlists:sync --import <file> --source wikidata-pep`) makes no request and answers the same
 * three kinds of question from one recorded document ({@link pepImportSource}), in the source's
 * own format: the query service's SPARQL JSON answers, keyed by what was asked.
 *
 * The import document (`openverify/wikidata-pep-answers/v1`):
 * - `positions`: per class QID, the answer of that class row's positions query (every page);
 * - `persons`: the persons query's answer rows of every person the build will ask about;
 * - `relatives` (optional): the relatives query's answer rows.
 *
 * The import answers a relatives question as the live query does, leaving out the links of a PEP
 * whose persons rows state a death. Its rows are read by the same readers as live answers.
 */
import { z } from 'zod';
import { WatchlistParseError } from '../parsers/errors.js';
import { parseGuardedJson } from '../parsers/json.js';
import type { PepPositionClass } from './positions.js';
import {
  parseSparqlResults,
  PEP_QID,
  PEP_QUERY_LIMITS,
  pepPersonsQuery,
  pepPositionsQuery,
  pepRelativesQuery,
  personFactRows,
  sparqlAnswerSchema,
  WIKIDATA_ENTITY_PREFIX,
  type SparqlBinding,
} from './sparql.js';

/** The import document's format tag. */
export const PEP_IMPORT_FORMAT = 'openverify/wikidata-pep-answers/v1';

/** Sends one query and answers its body; `api-watchlists` owns the HTTP side. */
export type SparqlRunner = (query: string) => Promise<string | Uint8Array>;

/** The three questions the build asks, answered as SPARQL bindings. */
export interface PepAnswerSource {
  positions(
    row: PepPositionClass,
    page: { readonly limit: number; readonly offset: number; readonly endedAfter: string | null },
  ): Promise<readonly SparqlBinding[]>;
  persons(qids: readonly string[]): Promise<readonly SparqlBinding[]>;
  relatives(qids: readonly string[]): Promise<readonly SparqlBinding[]>;
}

/** The live source: each question becomes its query, sent through `run` and read when answered. */
export function wikidataAnswerSource(
  run: SparqlRunner,
  options: { readonly maxAnswerBytes?: number } = {},
): PepAnswerSource {
  const maxBytes = options.maxAnswerBytes ?? PEP_QUERY_LIMITS.maxAnswerBytes;
  const ask = async (query: string) => parseSparqlResults(await run(query), { maxBytes });
  return {
    positions: (row, page) => ask(pepPositionsQuery(row, page)),
    persons: (qids) => ask(pepPersonsQuery(qids)),
    relatives: (qids) => ask(pepRelativesQuery(qids)),
  };
}

const importSchema = z.strictObject({
  format: z.literal(PEP_IMPORT_FORMAT),
  positions: z.record(z.string().regex(PEP_QID), sparqlAnswerSchema),
  persons: sparqlAnswerSchema,
  relatives: sparqlAnswerSchema.optional(),
});

/** The QID a row's `person` names, or null. */
function personOf(binding: SparqlBinding): string | null {
  const term = binding.person;
  return term?.type === 'uri' && term.value.startsWith(WIKIDATA_ENTITY_PREFIX)
    ? term.value.slice(WIKIDATA_ENTITY_PREFIX.length)
    : null;
}

/**
 * The import source over one recorded document.
 * @throws {WatchlistParseError} from the JSON reader, or `format` for another document.
 */
export function pepImportSource(
  body: string | Uint8Array,
  options: { readonly maxBytes: number },
): PepAnswerSource {
  const parsed = importSchema.safeParse(parseGuardedJson(body, { maxBytes: options.maxBytes }));
  if (!parsed.success) {
    throw new WatchlistParseError('format', `the document is not ${PEP_IMPORT_FORMAT}`);
  }
  const { positions, persons, relatives } = parsed.data;
  const people = persons.results.bindings;
  const deceased = new Set(
    personFactRows(people)
      .filter((row) => row.fact === 'death')
      .map((row) => row.person),
  );
  const named = (bindings: readonly SparqlBinding[], qids: readonly string[], living: boolean) => {
    const wanted = new Set(qids);
    return bindings.filter((binding) => {
      const person = personOf(binding);
      return person !== null && wanted.has(person) && !(living && deceased.has(person));
    });
  };
  return {
    positions: (row, page) =>
      Promise.resolve(
        (Object.hasOwn(positions, row.qid)
          ? positions[row.qid]?.results.bindings
          : undefined
        )?.slice(page.offset, page.offset + page.limit) ?? [],
      ),
    persons: (qids) => Promise.resolve(named(people, qids, false)),
    relatives: (qids) => Promise.resolve(named(relatives?.results.bindings ?? [], qids, true)),
  };
}
