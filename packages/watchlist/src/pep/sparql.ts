/**
 * C80.1-C80.3: the Wikidata Query Service queries the PEP sync sends, and the reader of their
 * answers (SPARQL 1.1 query results in JSON). Both live here so the variables they share cannot
 * drift apart. `api-watchlists`' client sends each query by POST with the operator's User-Agent,
 * one at a time, backing off on 429, within 75 s (C80.1); it never sends an end user's name: the
 * queries name position classes and person QIDs only.
 *
 * - Positions: every non-deprecated `position held` (P39) statement of a human whose position a
 *   class row reaches, with its start (P580), end (P582, a stated but unknown end included),
 *   successor (P1366), the position's jurisdiction (P1001) and country (P17) codes (P297) and
 *   English label; paged with `ORDER BY ?statement LIMIT … OFFSET …`. A row whose positions have
 *   many holders at once may leave out statements that ended before the longest retention.
 * - Persons: labels, aliases, birth dates (P569, with precision), death (P570), sex (P21) and
 *   citizenship (P27) codes of a batch of QIDs, one fact per answer row.
 * - Relatives: spouse (P26), child (P40), father (P22), mother (P25) and sibling (P3373) links of
 *   a batch of QIDs, to humans only, and none of a PEP who has died (V13: a relative is kept only
 *   while a PEP it is linked to is).
 */
import { z } from 'zod';
import { WatchlistParseError } from '../parsers/errors.js';
import { parseGuardedJson } from '../parsers/json.js';
import { calendarDate, cleanText, countryCode, partialDate } from '../parsers/normalise.js';
import { RELATION_KINDS } from '../record/index.js';
import type { PepPositionClass } from './positions.js';

/** Wikidata's entity IRI prefix. */
export const WIKIDATA_ENTITY_PREFIX = 'http://www.wikidata.org/entity/';

/**
 * A QID the queries may name: Wikidata's form, or the fictional `Q-test-<n>` form the synthetic
 * answers use (never in a real answer).
 */
export const PEP_QID = /^Q(?:[1-9]\d{0,11}|-test-\d{1,12})$/u;

/** The paging and batching defaults (ours, provisional). */
export const PEP_QUERY_LIMITS = Object.freeze({
  /** Statements per positions page. */
  pageSize: 5000,
  /** Persons per details or relatives query. */
  batchSize: 100,
  /** Pages one class may take before the sync is refused. */
  maxPagesPerClass: 1000,
  /** Bytes of one answer. */
  maxAnswerBytes: 67_108_864,
});

/** A term of an answer row. */
export interface SparqlTerm {
  readonly type: 'uri' | 'literal' | 'typed-literal' | 'bnode';
  readonly value: string;
  readonly 'xml:lang'?: string | undefined;
  readonly datatype?: string | undefined;
}
export type SparqlBinding = Readonly<Record<string, SparqlTerm>>;

/** One `position held` statement as the positions query answers it. */
export interface PositionStatementRow {
  /** The statement's IRI, the key that merges the rows and pages that repeat it. */
  readonly statement: string;
  readonly person: string;
  readonly position: string;
  readonly positionLabel: string | null;
  /** A partial date at the statement's precision, or null (none, or coarser than a year). */
  readonly start: string | null;
  readonly end: string | null;
  /** An end is stated, whether or not its value is known or precise enough. */
  readonly endStated: boolean;
  /** A successor is stated: its QID, `unknown` for an unknown value, or null for none. */
  readonly successor: string | null;
  /** ISO 3166-1 alpha-2 codes of the position's jurisdiction and country, when they are states. */
  readonly jurisdiction: string | null;
  readonly country: string | null;
}

/** One fact of a person as the persons query answers it. */
export type PersonFactRow =
  | {
      readonly person: string;
      readonly fact: 'label' | 'alias';
      readonly text: string;
      readonly lang: string | null;
    }
  | { readonly person: string; readonly fact: 'birth'; readonly date: string | null }
  | { readonly person: string; readonly fact: 'death' }
  | { readonly person: string; readonly fact: 'sex'; readonly sex: 'female' | 'male' | null }
  | { readonly person: string; readonly fact: 'citizenship'; readonly country: string | null };

/** One family link as the relatives query answers it: `relative` is the PEP's `relation`. */
export interface RelativeRow {
  readonly person: string;
  readonly relation: (typeof RELATION_KINDS)[number];
  readonly relative: string;
}

const PREFIXES = [
  'PREFIX wd: <http://www.wikidata.org/entity/>',
  'PREFIX wdt: <http://www.wikidata.org/prop/direct/>',
  'PREFIX p: <http://www.wikidata.org/prop/>',
  'PREFIX ps: <http://www.wikidata.org/prop/statement/>',
  'PREFIX psv: <http://www.wikidata.org/prop/statement/value/>',
  'PREFIX pq: <http://www.wikidata.org/prop/qualifier/>',
  'PREFIX pqv: <http://www.wikidata.org/prop/qualifier/value/>',
  'PREFIX wikibase: <http://wikiba.se/ontology#>',
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
  'PREFIX skos: <http://www.w3.org/2004/02/skos/core#>',
  'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
].join('\n');

/** A QID checked before it is written into a query; nothing else from outside is. */
function entity(value: string): string {
  if (!PEP_QID.test(value)) {
    throw new RangeError('a query names only QIDs');
  }
  return `wd:${value}`;
}

function whole(value: number, minimum: number): string {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`a page bound must be an integer of at least ${String(minimum)}`);
  }
  return String(value);
}

function batch(qids: readonly string[]): string {
  if (qids.length === 0) {
    throw new RangeError('a batch names at least one QID');
  }
  return qids.map(entity).join(' ');
}

/** The positions query of one class row's page. `endedAfter` (an ISO date) drops older ends. */
export function pepPositionsQuery(
  row: PepPositionClass,
  page: { readonly limit: number; readonly offset: number; readonly endedAfter?: string | null },
): string {
  const limit = whole(page.limit, 1);
  const offset = whole(page.offset, 0);
  const target = entity(row.qid);
  const positions =
    row.selector === 'directs'
      ? `?position wdt:P2389 ?organization . ?organization wdt:P31/wdt:P279* ${target} .`
      : `{ ?position wdt:P279* ${target} . } UNION { ?position wdt:P31/wdt:P279* ${target} . }`;
  let endFilter = '';
  if (page.endedAfter !== undefined && page.endedAfter !== null) {
    const day = calendarDate(page.endedAfter);
    if (day === null) {
      throw new RangeError('endedAfter must be a YYYY-MM-DD date');
    }
    endFilter = `  FILTER(!BOUND(?end) || ?end >= "${day}T00:00:00Z"^^xsd:dateTime)\n`;
  }
  return `${PREFIXES}
SELECT ?statement ?person ?position ?positionLabel ?start ?startPrecision ?end ?endPrecision ?endValue ?successor ?jurisdiction ?country WHERE {
  { SELECT DISTINCT ?position WHERE { ${positions} } }
  ?statement ps:P39 ?position ;
    wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  ?person p:P39 ?statement ;
    wdt:P31 wd:Q5 .
  OPTIONAL { ?statement pqv:P580 ?startNode . ?startNode wikibase:timeValue ?start ; wikibase:timePrecision ?startPrecision . }
  OPTIONAL { ?statement pq:P582 ?endValue . }
  OPTIONAL { ?statement pqv:P582 ?endNode . ?endNode wikibase:timeValue ?end ; wikibase:timePrecision ?endPrecision . }
  OPTIONAL { ?statement pq:P1366 ?successor . }
  OPTIONAL { ?position wdt:P1001/wdt:P297 ?jurisdiction . }
  OPTIONAL { ?position wdt:P17/wdt:P297 ?country . }
  OPTIONAL { ?position rdfs:label ?positionLabel . FILTER(LANG(?positionLabel) = "en") }
${endFilter}}
ORDER BY ?statement
LIMIT ${limit}
OFFSET ${offset}`;
}

/** The persons query of a batch of QIDs. */
export function pepPersonsQuery(qids: readonly string[]): string {
  return `${PREFIXES}
SELECT ?person ?fact ?value ?precision WHERE {
  VALUES ?person { ${batch(qids)} }
  {
    ?person rdfs:label ?value .
    BIND("label" AS ?fact)
  } UNION {
    ?person skos:altLabel ?value .
    BIND("alias" AS ?fact)
  } UNION {
    ?person p:P569 ?birthStatement .
    ?birthStatement wikibase:rank ?birthRank ;
      psv:P569 ?birthNode .
    ?birthNode wikibase:timeValue ?value ;
      wikibase:timePrecision ?precision .
    FILTER(?birthRank != wikibase:DeprecatedRank)
    BIND("birth" AS ?fact)
  } UNION {
    ?person p:P570 ?deathStatement .
    ?deathStatement wikibase:rank ?deathRank .
    FILTER(?deathRank != wikibase:DeprecatedRank)
    BIND("death" AS ?fact)
  } UNION {
    ?person wdt:P21 ?value .
    BIND("sex" AS ?fact)
  } UNION {
    ?person wdt:P27 ?citizenship .
    ?citizenship wdt:P297 ?value .
    BIND("citizenship" AS ?fact)
  }
}`;
}

/** The relatives query of a batch of PEP QIDs. */
export function pepRelativesQuery(qids: readonly string[]): string {
  return `${PREFIXES}
SELECT ?person ?relation ?relative WHERE {
  VALUES ?person { ${batch(qids)} }
  VALUES (?property ?relation) { (wdt:P26 "spouse") (wdt:P40 "child") (wdt:P22 "parent") (wdt:P25 "parent") (wdt:P3373 "sibling") }
  ?person ?property ?relative .
  ?relative wdt:P31 wd:Q5 .
  FILTER NOT EXISTS {
    ?person p:P570 ?death .
    ?death wikibase:rank ?deathRank .
    FILTER(?deathRank != wikibase:DeprecatedRank)
  }
}`;
}

const termSchema = z.object({
  type: z.enum(['uri', 'literal', 'typed-literal', 'bnode']),
  value: z.string().max(10_000),
  'xml:lang': z.string().max(64).optional(),
  datatype: z.string().max(2048).optional(),
});

/** A SPARQL 1.1 JSON results document, as far as the readers need it. */
export const sparqlAnswerSchema = z.object({
  results: z.object({ bindings: z.array(z.record(z.string(), termSchema)) }),
});

/**
 * Reads a SPARQL JSON answer through the guarded JSON reader.
 * @throws {WatchlistParseError} from the JSON reader, or `format` for another shape.
 */
export function parseSparqlResults(
  body: string | Uint8Array,
  options: { readonly maxBytes: number },
): SparqlBinding[] {
  const parsed = sparqlAnswerSchema.safeParse(
    parseGuardedJson(body, { maxBytes: options.maxBytes }),
  );
  if (!parsed.success) {
    throw new WatchlistParseError('format', 'the answer is not SPARQL JSON results');
  }
  return parsed.data.results.bindings;
}

function refuse(rule: string): never {
  throw new WatchlistParseError('format', `a SPARQL answer row ${rule}`);
}

function literal(term: SparqlTerm | undefined): string | null {
  return term !== undefined && (term.type === 'literal' || term.type === 'typed-literal')
    ? term.value
    : null;
}

function qidOf(term: SparqlTerm | undefined): string | null {
  if (term?.type !== 'uri' || !term.value.startsWith(WIKIDATA_ENTITY_PREFIX)) {
    return null;
  }
  const id = term.value.slice(WIKIDATA_ENTITY_PREFIX.length);
  return PEP_QID.test(id) ? id : null;
}

function requiredQid(binding: SparqlBinding, name: string): string {
  return qidOf(binding[name]) ?? refuse(`has no Wikidata entity as its ${name}`);
}

const TIME_VALUE = /^\+?(\d{4})-(\d{2})-(\d{2})T/u;

/** A time value at its precision (11 day, 10 month, 9 year); coarser ones read as no date. */
function wikidataDate(
  value: SparqlTerm | undefined,
  precision: SparqlTerm | undefined,
): string | null {
  const match = TIME_VALUE.exec(literal(value) ?? '');
  const level = Number(literal(precision));
  if (match === null) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (level >= 11) {
    return partialDate(year, month, day);
  }
  if (level === 10) {
    return partialDate(year, month);
  }
  return level === 9 ? partialDate(year) : null;
}

/**
 * The positions query's rows.
 * @throws {WatchlistParseError} `format` for a row without its statement, person or position.
 */
export function positionStatementRows(bindings: readonly SparqlBinding[]): PositionStatementRow[] {
  return bindings.map((binding) => {
    const statement = binding.statement;
    if (statement?.type !== 'uri') {
      return refuse('has no statement');
    }
    const successor = binding.successor;
    return {
      statement: statement.value,
      person: requiredQid(binding, 'person'),
      position: requiredQid(binding, 'position'),
      positionLabel: cleanText(literal(binding.positionLabel)),
      start: wikidataDate(binding.start, binding.startPrecision),
      end: wikidataDate(binding.end, binding.endPrecision),
      endStated: binding.endValue !== undefined || binding.end !== undefined,
      successor: successor === undefined ? null : (qidOf(successor) ?? 'unknown'),
      jurisdiction: countryCode(literal(binding.jurisdiction)),
      country: countryCode(literal(binding.country)),
    };
  });
}

const SEXES: Readonly<Record<string, 'female' | 'male'>> = Object.freeze({
  Q6581072: 'female',
  Q6581097: 'male',
});

/**
 * The persons query's rows.
 * @throws {WatchlistParseError} `format` for a row without its person or a known fact.
 */
export function personFactRows(bindings: readonly SparqlBinding[]): PersonFactRow[] {
  return bindings.map((binding): PersonFactRow => {
    const person = requiredQid(binding, 'person');
    const fact = literal(binding.fact);
    const value = binding.value;
    switch (fact) {
      case 'label':
      case 'alias':
        return {
          person,
          fact,
          text: literal(value) ?? refuse(`states a ${fact} without its text`),
          lang: value?.['xml:lang'] ?? null,
        };
      case 'birth':
        return { person, fact, date: wikidataDate(value, binding.precision) };
      case 'death':
        return { person, fact };
      case 'sex':
        return { person, fact, sex: SEXES[qidOf(value) ?? ''] ?? null };
      case 'citizenship':
        return { person, fact, country: countryCode(literal(value)) };
      default:
        return refuse('states no known fact');
    }
  });
}

/**
 * The relatives query's rows.
 * @throws {WatchlistParseError} `format` for a row without its person, relation or relative.
 */
export function relativeRows(bindings: readonly SparqlBinding[]): RelativeRow[] {
  return bindings.map((binding) => {
    const relation = RELATION_KINDS.find((kind) => kind === literal(binding.relation));
    return {
      person: requiredQid(binding, 'person'),
      relation: relation ?? refuse('states no known relation'),
      relative: requiredQid(binding, 'relative'),
    };
  });
}
