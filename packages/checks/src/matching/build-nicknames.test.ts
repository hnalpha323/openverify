/**
 * The dev-only builder of `data/nicknames.json` (C58.3), on synthetic inputs, and the committed
 * table, which must be exactly what the builder makes of the committed inputs.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildNicknameTable,
  checkWikidataResult,
  parseAuthoredNicknames,
  parseWikidataNicknames,
  serializeNicknameTable,
} from '../../scripts/build-nicknames.js';
import { MATCHING_DATA_DIRECTORY } from './data-files.js';

const AUTHORED = [
  '# a comment',
  'formal\tlang\tnicknames',
  'william\ten\tbill,will',
  '',
  'josé\tes\tpepe',
].join('\n');

const QUERY = 'SELECT ?nick WHERE {}\n';

/** A synthetic query result with one row, and the Wikidata file that records it. */
function wikidataFixture(
  rows = [{ nick: 'Q1', nickLabel: 'Bill', formal: 'Q2', formalLabel: 'William' }],
) {
  const result = new TextEncoder().encode(
    JSON.stringify({
      results: {
        bindings: rows.map((row) => ({
          nick: { type: 'uri', value: `http://www.wikidata.org/entity/${row.nick}` },
          nickLabel: { type: 'literal', value: row.nickLabel },
          formal: { type: 'uri', value: `http://www.wikidata.org/entity/${row.formal}` },
          formalLabel: { type: 'literal', value: row.formalLabel },
        })),
      },
    }),
  );
  const sha = createHash('sha256').update(result).digest('hex');
  const text = [
    '# reviewed pairs',
    '# endpoint: https://query.wikidata.org/sparql',
    '# retrieved-at: 2026-10-23T00:00:00Z',
    `# result-sha256: ${sha}`,
    '# result-rows: 1',
    'formal\tnickname\tlang\tnickname-qid\tformal-qid',
    'William\tBill\ten\tQ1\tQ2',
  ].join('\n');
  return { result, sha, text };
}

describe('parseAuthoredNicknames', () => {
  it('reads each row after the header, skipping comments and blank lines', () => {
    expect(parseAuthoredNicknames(AUTHORED)).toEqual([
      { formal: 'william', language: 'en', nicknames: ['bill', 'will'] },
      { formal: 'josé', language: 'es', nicknames: ['pepe'] },
    ]);
  });

  it.each([
    ['william\ten', /line 1/],
    ['William\ten\tbill', /lower case/],
    ['william\teng\tbill', /language/],
    ['william\ten\tbill,bill', /twice/],
    ['william\ten\twilliam', /itself/],
    ['william\ten\t', /no nickname/],
  ])('refuses %j', (row, message) => {
    expect(() => parseAuthoredNicknames(row)).toThrow(message);
  });
});

describe('parseWikidataNicknames', () => {
  it('reads the record lines and the rows', () => {
    const { text, sha } = wikidataFixture();

    expect(parseWikidataNicknames(text)).toEqual({
      record: {
        endpoint: 'https://query.wikidata.org/sparql',
        'retrieved-at': '2026-10-23T00:00:00Z',
        'result-sha256': sha,
        'result-rows': '1',
      },
      rows: [
        { formal: 'William', nickname: 'Bill', language: 'en', nicknameQid: 'Q1', formalQid: 'Q2' },
      ],
    });
  });

  it('refuses a row without both items', () => {
    expect(() => parseWikidataNicknames('William\tBill\ten\tQ1\tX2')).toThrow(/line 1/);
  });
});

describe('buildNicknameTable', () => {
  const { text } = wikidataFixture();
  const table = buildNicknameTable({ authored: AUTHORED, wikidata: text, query: QUERY });

  it('merges a pair both sources hold, keeping every source and language', () => {
    expect(table.pairs).toEqual([
      { formal: 'josé', nickname: 'pepe', languages: ['es'], sources: ['authored'] },
      {
        formal: 'william',
        nickname: 'bill',
        languages: ['en'],
        sources: ['authored', 'wikidata:Q1/Q2'],
      },
      { formal: 'william', nickname: 'will', languages: ['en'], sources: ['authored'] },
    ]);
  });

  it('records the query, its digest and the review counts', () => {
    expect(table.wikidata).toMatchObject({
      query: 'nicknames.sparql',
      'query-sha256': createHash('sha256').update(QUERY).digest('hex'),
      'retrieved-at': '2026-10-23T00:00:00Z',
      'accepted-rows': 1,
    });
    expect(table.counts).toEqual({
      pairs: 3,
      'formal-names': 2,
      authored: 3,
      wikidata: 1,
    });
  });

  it('serializes as two-space JSON with a final newline', () => {
    const json = serializeNicknameTable(table);

    expect(json.endsWith('}\n')).toBe(true);
    expect(JSON.parse(json)).toEqual(table);
    expect(json).toContain('\n  "pairs": [');
  });
});

describe('checkWikidataResult', () => {
  it('accepts the saved result the record names', () => {
    const { text, result } = wikidataFixture();

    expect(() => {
      checkWikidataResult(parseWikidataNicknames(text), result);
    }).not.toThrow();
  });

  it('refuses another result, and a pair the result does not hold', () => {
    const { text } = wikidataFixture();
    const other = wikidataFixture([
      { nick: 'Q1', nickLabel: 'Bob', formal: 'Q2', formalLabel: 'William' },
    ]);
    const parsed = parseWikidataNicknames(text);

    expect(() => {
      checkWikidataResult(parsed, other.result);
    }).toThrow(/sha-?256/i);
    expect(() => {
      checkWikidataResult(
        { ...parsed, record: { ...parsed.record, 'result-sha256': other.sha } },
        other.result,
      );
    }).toThrow(/Bill/);
  });
});

describe('the committed nicknames.json', () => {
  it('is exactly what the builder makes of the committed inputs', () => {
    const read = (file: string) => readFileSync(join(MATCHING_DATA_DIRECTORY, file), 'utf8');
    const built = buildNicknameTable({
      authored: read('nicknames-authored.tsv'),
      wikidata: read('nicknames-wikidata.tsv'),
      query: read('nicknames.sparql'),
    });

    expect(read('nicknames.json')).toBe(serializeNicknameTable(built));
  });
});
