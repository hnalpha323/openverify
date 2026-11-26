/**
 * C80.1-C80.3: the PEP queries and the reader of their answers, over synthetic SPARQL JSON
 * answers with fictional `Q-test` QIDs, fictional names and made-up statement ids. Class rows use
 * the public QIDs of the committed table.
 */
import { describe, expect, it } from 'vitest';
import { WatchlistParseError } from '../parsers/errors.js';
import type { PepPositionClass } from './positions.js';
import {
  parseSparqlResults,
  pepPersonsQuery,
  pepPositionsQuery,
  pepRelativesQuery,
  personFactRows,
  positionStatementRows,
  relativeRows,
  WIKIDATA_ENTITY_PREFIX,
  type SparqlBinding,
} from './sparql.js';

const uri = (value: string) => ({ type: 'uri' as const, value });
const entity = (qid: string) => uri(`${WIKIDATA_ENTITY_PREFIX}${qid}`);
const literal = (value: string, extra: { 'xml:lang'?: string; datatype?: string } = {}) => ({
  type: 'literal' as const,
  value,
  ...extra,
});
const time = (value: string) =>
  literal(value, { datatype: 'http://www.w3.org/2001/XMLSchema#dateTime' });
const integer = (value: number) =>
  literal(String(value), { datatype: 'http://www.w3.org/2001/XMLSchema#integer' });
const statement = (id: string) => uri(`${WIKIDATA_ENTITY_PREFIX}statement/${id}`);
const answer = (vars: readonly string[], bindings: readonly SparqlBinding[]) =>
  JSON.stringify({ head: { vars }, results: { bindings } });

const HEAD: PepPositionClass = {
  qid: 'Q48352',
  label: 'head of state',
  pep_class: 1,
  selector: 'subclass',
  single_holder: true,
  head_of_state_or_government: true,
  refines: [],
  source: 'fatf-2013',
  note: 'Heads of state.',
};

describe('the queries', () => {
  it('pages the statements of the positions a subclass row reaches', () => {
    const query = pepPositionsQuery(HEAD, { limit: 5000, offset: 10_000 });
    for (const part of [
      'wd:Q48352',
      'wdt:P279*',
      'wdt:P31/wdt:P279*',
      'ps:P39',
      'wikibase:DeprecatedRank',
      'wd:Q5',
      'pqv:P580',
      'pq:P582',
      'pqv:P582',
      'pq:P1366',
      'wdt:P1001/wdt:P297',
      'wdt:P17/wdt:P297',
      'ORDER BY ?statement',
      'LIMIT 5000',
      'OFFSET 10000',
    ]) {
      expect(query, part).toContain(part);
    }
    expect(query).not.toContain('P2389');
    expect(query).not.toContain('^^xsd:dateTime');
  });

  it('reaches the positions that direct an organisation for a directs row, and drops old ends when asked', () => {
    const query = pepPositionsQuery(
      { ...HEAD, qid: 'Q484652', selector: 'directs' },
      { limit: 10, offset: 0, endedAfter: '2021-10-27' },
    );
    expect(query).toContain('wdt:P2389');
    expect(query).toContain('wd:Q484652');
    expect(query).toContain('"2021-10-27T00:00:00Z"^^xsd:dateTime');
  });

  it('names a batch of persons, or their relatives, by QID only', () => {
    const persons = pepPersonsQuery(['Q-test-1001', 'Q-test-1002']);
    expect(persons).toContain('VALUES ?person { wd:Q-test-1001 wd:Q-test-1002 }');
    for (const part of [
      'rdfs:label',
      'skos:altLabel',
      'psv:P569',
      'p:P570',
      'wdt:P21',
      'wdt:P27',
    ]) {
      expect(persons, part).toContain(part);
    }
    const relatives = pepRelativesQuery(['Q-test-1001']);
    for (const part of [
      'wdt:P26',
      'wdt:P40',
      'wdt:P22',
      'wdt:P25',
      'wdt:P3373',
      'wd:Q-test-1001',
      'FILTER NOT EXISTS',
      'p:P570',
    ]) {
      expect(relatives, part).toContain(part);
    }
  });

  it('refuses anything that is not a QID, an empty batch and an odd page', () => {
    for (const run of [
      () => pepPersonsQuery(['Q1 } DELETE {']),
      () => pepPersonsQuery([]),
      () => pepRelativesQuery(['"Quillfeather"']),
      () => pepPositionsQuery({ ...HEAD, qid: 'Q1>' }, { limit: 10, offset: 0 }),
      () => pepPositionsQuery(HEAD, { limit: 0, offset: 0 }),
      () => pepPositionsQuery(HEAD, { limit: 10, offset: -1 }),
      () => pepPositionsQuery(HEAD, { limit: 10, offset: 0, endedAfter: '2021-10-27"} }' }),
    ]) {
      expect(run).toThrow(RangeError);
    }
  });
});

describe('parseSparqlResults', () => {
  it('reads the bindings of an answer', () => {
    const bindings = parseSparqlResults(answer(['person'], [{ person: entity('Q-test-1001') }]), {
      maxBytes: 10_000,
    });
    expect(bindings).toEqual([{ person: entity('Q-test-1001') }]);
  });

  it('refuses an answer over the cap, too deep, malformed or of another shape', () => {
    const cases: Record<string, readonly [string, string]> = {
      large: [answer(['person'], [{ person: entity('Q-test-1001') }]), 'too_large'],
      deep: [`{"head":${'['.repeat(100)}${']'.repeat(100)}}`, 'too_deep'],
      malformed: ['{"head":{"vars":[]},"results":', 'malformed'],
      shape: [
        '{"head":{"vars":[]},"results":{"bindings":[{"person":{"type":"number","value":"1"}}]}}',
        'format',
      ],
      empty: ['[]', 'format'],
    };
    for (const [label, [body, code]] of Object.entries(cases)) {
      let error: unknown;
      try {
        parseSparqlResults(body, { maxBytes: label === 'large' ? 20 : 10_000 });
      } catch (caught) {
        error = caught;
      }
      expect(error, label).toBeInstanceOf(WatchlistParseError);
      expect((error as WatchlistParseError).code, label).toBe(code);
    }
  });
});

describe('positionStatementRows', () => {
  it('reads statements with dates at their precision, stated ends and successors', () => {
    const rows = positionStatementRows([
      {
        statement: statement('Q-test-1001-a'),
        person: entity('Q-test-1001'),
        position: entity('Q-test-2001'),
        positionLabel: literal('Minister of Synthetic Affairs', { 'xml:lang': 'en' }),
        start: time('2019-05-12T00:00:00Z'),
        startPrecision: integer(11),
        end: time('2024-01-01T00:00:00Z'),
        endPrecision: integer(9),
        endValue: time('2024-01-01T00:00:00Z'),
        successor: entity('Q-test-1002'),
        jurisdiction: literal('GB'),
        country: literal('GB'),
      },
      {
        statement: statement('Q-test-1002-a'),
        person: entity('Q-test-1002'),
        position: entity('Q-test-2001'),
        start: time('2024-03-01T00:00:00Z'),
        startPrecision: integer(10),
        endValue: { type: 'bnode', value: 't123' },
        successor: { type: 'bnode', value: 't124' },
      },
      {
        statement: statement('Q-test-1003-a'),
        person: entity('Q-test-1003'),
        position: entity('Q-test-2002'),
        start: time('1990-01-01T00:00:00Z'),
        startPrecision: integer(8),
        endValue: uri('http://www.wikidata.org/.well-known/genid/0a1b2c'),
        country: literal('ZZ'),
      },
    ]);
    expect(rows).toEqual([
      {
        statement: `${WIKIDATA_ENTITY_PREFIX}statement/Q-test-1001-a`,
        person: 'Q-test-1001',
        position: 'Q-test-2001',
        positionLabel: 'Minister of Synthetic Affairs',
        start: '2019-05-12',
        end: '2024',
        endStated: true,
        successor: 'Q-test-1002',
        jurisdiction: 'GB',
        country: 'GB',
      },
      {
        statement: `${WIKIDATA_ENTITY_PREFIX}statement/Q-test-1002-a`,
        person: 'Q-test-1002',
        position: 'Q-test-2001',
        positionLabel: null,
        start: '2024-03',
        end: null,
        endStated: true,
        successor: 'unknown',
        jurisdiction: null,
        country: null,
      },
      {
        statement: `${WIKIDATA_ENTITY_PREFIX}statement/Q-test-1003-a`,
        person: 'Q-test-1003',
        position: 'Q-test-2002',
        positionLabel: null,
        start: null,
        end: null,
        endStated: true,
        successor: null,
        jurisdiction: null,
        country: null,
      },
    ]);
  });

  it('refuses a row without its statement, person or position, or with a person that is no QID', () => {
    const base = {
      statement: statement('s'),
      person: entity('Q-test-1001'),
      position: entity('Q-test-2001'),
    };
    for (const broken of [
      { ...base, statement: literal('s') },
      { person: base.person, position: base.position },
      { ...base, person: uri('https://example.invalid/Q-test-1001') },
      { ...base, position: entity('Quillfeather') },
    ]) {
      expect(() => positionStatementRows([broken])).toThrow(WatchlistParseError);
    }
  });
});

describe('personFactRows and relativeRows', () => {
  it('reads labels, aliases, births, deaths, sex and citizenship, one fact a row', () => {
    const person = entity('Q-test-1001');
    expect(
      personFactRows([
        {
          person,
          fact: literal('label'),
          value: literal('Marlowe Testerton', { 'xml:lang': 'en' }),
        },
        { person, fact: literal('alias'), value: literal('M. Testerton') },
        {
          person,
          fact: literal('birth'),
          value: time('1970-06-01T00:00:00Z'),
          precision: integer(10),
        },
        { person, fact: literal('death') },
        { person, fact: literal('sex'), value: entity('Q6581072') },
        { person, fact: literal('sex'), value: entity('Q-test-9') },
        { person, fact: literal('citizenship'), value: literal('GB') },
      ]),
    ).toEqual([
      { person: 'Q-test-1001', fact: 'label', text: 'Marlowe Testerton', lang: 'en' },
      { person: 'Q-test-1001', fact: 'alias', text: 'M. Testerton', lang: null },
      { person: 'Q-test-1001', fact: 'birth', date: '1970-06' },
      { person: 'Q-test-1001', fact: 'death' },
      { person: 'Q-test-1001', fact: 'sex', sex: 'female' },
      { person: 'Q-test-1001', fact: 'sex', sex: null },
      { person: 'Q-test-1001', fact: 'citizenship', country: 'GB' },
    ]);
    expect(() => personFactRows([{ person, fact: literal('portrait') }])).toThrow(
      WatchlistParseError,
    );
    expect(() => personFactRows([{ person, fact: literal('label') }])).toThrow(WatchlistParseError);
  });

  it('reads family links', () => {
    expect(
      relativeRows([
        {
          person: entity('Q-test-1001'),
          relation: literal('spouse'),
          relative: entity('Q-test-1101'),
        },
      ]),
    ).toEqual([{ person: 'Q-test-1001', relation: 'spouse', relative: 'Q-test-1101' }]);
    expect(() =>
      relativeRows([
        {
          person: entity('Q-test-1001'),
          relation: literal('friend'),
          relative: entity('Q-test-1'),
        },
      ]),
    ).toThrow(WatchlistParseError);
  });
});
