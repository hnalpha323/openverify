/**
 * C80.1-C80.4: the PEP build over a fake query service answering synthetic SPARQL JSON, with
 * fictional `Q-test` persons, positions and class rows, fictional names and made-up statements,
 * on a frozen clock (2026-10-27).
 */
import { describe, expect, it } from 'vitest';
import { WatchlistParseError } from '../parsers/errors.js';
import {
  contentHash,
  riskDataHash,
  watchlistRecordSchema,
  type WatchlistRecord,
} from '../record/index.js';
import { buildPepRecords, type PepBuildOptions, type PepPublication } from './build.js';
import { PEP_IMPORT_FORMAT, pepImportSource, type PepAnswerSource } from './import.js';
import type { PepPositionClass } from './positions.js';
import { WIKIDATA_ENTITY_PREFIX, type SparqlBinding } from './sparql.js';

const NOW = new Date('2026-10-27T12:00:00.000Z');

const row = (qid: string, overrides: Partial<PepPositionClass>): PepPositionClass => ({
  qid,
  label: 'synthetic class',
  pep_class: 2,
  selector: 'subclass',
  single_holder: false,
  head_of_state_or_government: false,
  refines: [],
  source: 'authored',
  note: 'Synthetic row.',
  ...overrides,
});

const HEADS = row('Q-test-9001', {
  pep_class: 1,
  single_holder: true,
  head_of_state_or_government: true,
});
const MEMBERS = row('Q-test-9002', { pep_class: 2 });
const MAYORS = row('Q-test-9003', { pep_class: 4, single_holder: true, refines: ['Q-test-9001'] });
const CLASSES = [HEADS, MEMBERS, MAYORS];

const entity = (qid: string) => ({
  type: 'uri' as const,
  value: `${WIKIDATA_ENTITY_PREFIX}${qid}`,
});
const literal = (value: string, lang?: string) => ({
  type: 'literal' as const,
  value,
  ...(lang === undefined ? {} : { 'xml:lang': lang }),
});
const time = (date: string) => ({
  type: 'literal' as const,
  value: `${date}T00:00:00Z`,
  datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
});
const precision = (level: number) => ({
  type: 'literal' as const,
  value: String(level),
  datatype: 'http://www.w3.org/2001/XMLSchema#integer',
});

interface Held {
  readonly id: string;
  readonly person: string;
  readonly position: string;
  readonly label: string;
  readonly start?: string;
  readonly end?: string;
  readonly jurisdiction?: string;
  readonly country?: string;
}

function statementBinding(held: Held): SparqlBinding {
  return {
    statement: { type: 'uri', value: `${WIKIDATA_ENTITY_PREFIX}statement/${held.id}` },
    person: entity(held.person),
    position: entity(held.position),
    positionLabel: literal(held.label, 'en'),
    ...(held.start === undefined ? {} : { start: time(held.start), startPrecision: precision(11) }),
    ...(held.end === undefined
      ? {}
      : { end: time(held.end), endPrecision: precision(11), endValue: time(held.end) }),
    ...(held.jurisdiction === undefined ? {} : { jurisdiction: literal(held.jurisdiction) }),
    ...(held.country === undefined ? {} : { country: literal(held.country) }),
  };
}

const PRESIDENT = { position: 'Q-test-2001', label: 'President of Synthetica', jurisdiction: 'GB' };
const ASSEMBLY = {
  position: 'Q-test-2002',
  label: 'Member of the Synthetic Assembly',
  country: 'GB',
};
const MAYOR = { position: 'Q-test-2003', label: 'Mayor of Synthetic Town' };

/** Statements by class row: what each positions query reaches. */
const STATEMENTS: Record<string, readonly Held[]> = {
  'Q-test-9001': [
    { id: 'a-president', person: 'Q-test-1001', start: '2019-07-24', ...PRESIDENT },
    { id: 'b-president', person: 'Q-test-1002', start: '2010-01-10', ...PRESIDENT },
    {
      id: 'c-president',
      person: 'Q-test-1003',
      start: '2014-01-01',
      end: '2022-06-30',
      ...PRESIDENT,
    },
    { id: 'f-mayor', person: 'Q-test-1006', start: '2023-01-01', ...MAYOR },
  ],
  'Q-test-9002': [
    { id: 'd-member', person: 'Q-test-1004', start: '2021-05-01', ...ASSEMBLY },
    { id: 'e-member', person: 'Q-test-1005', start: '2000-01-01', ...ASSEMBLY },
    { id: 'a-member', person: 'Q-test-1001', start: '2015-01-01', end: '2019-07-23', ...ASSEMBLY },
    { id: 'g-member', person: 'Q-test-1007', start: '2022-02-02', ...ASSEMBLY },
  ],
  'Q-test-9003': [{ id: 'f-mayor', person: 'Q-test-1006', start: '2023-01-01', ...MAYOR }],
};

interface Person {
  readonly labels?: readonly (readonly [string, string])[];
  readonly aliases?: readonly string[];
  readonly births?: readonly string[];
  readonly dead?: boolean;
  readonly sex?: string;
  readonly citizenship?: string;
}

const PERSONS: Record<string, Person> = {
  'Q-test-1001': {
    labels: [
      ['fr', 'Marlowe Testerton'],
      ['en', 'Marlowe Testerton'],
      ['ru', 'Марлоу Тестертон'],
    ],
    aliases: ['M. Testerton', 'Marly'],
    births: ['1960-03-15'],
    sex: 'Q6581072',
    citizenship: 'GB',
  },
  'Q-test-1002': { labels: [['en', 'Rowan Placeholder']], births: ['1950-01-01'] },
  'Q-test-1003': {
    labels: [['en', 'Sasha Quillfeather']],
    births: ['1955-05-05'],
    sex: 'Q6581097',
  },
  'Q-test-1004': { labels: [['en', 'Devon Testerton']], births: ['1965-02-02'] },
  'Q-test-1005': { labels: [['en', 'Ellis Placeholder']], births: ['1940-01-01'] },
  'Q-test-1006': { labels: [['de', 'Fenn Synthetik']], births: ['1970-07-07'] },
  'Q-test-1007': { labels: [['en', 'Gale Placeholder']], births: ['1945-04-04'], dead: true },
  'Q-test-1101': { labels: [['en', 'Riley Testerton']], births: ['1975-09-09'] },
  'Q-test-1102': { labels: [['en', 'Kit Testerton']], births: ['2012-12-12'] },
  'Q-test-1103': { labels: [['en', 'Parker Testerton']] },
  'Q-test-1104': { labels: [['en', 'Sam Testerton']], births: ['1980-08-08'] },
  'Q-test-1105': { labels: [['en', 'Xan Placeholder']], births: ['1970-01-01'] },
  'Q-test-1108': { labels: [['en', 'Hollis Placeholder']], births: ['1950-01-01'] },
};

/** Family links by PEP: [relation, relative]. */
const RELATIVES: Record<string, readonly (readonly [string, string])[]> = {
  'Q-test-1001': [
    ['spouse', 'Q-test-1101'],
    ['child', 'Q-test-1102'],
    ['parent', 'Q-test-1103'],
    ['sibling', 'Q-test-1104'],
    ['sibling', 'Q-test-1004'],
  ],
  'Q-test-1002': [['spouse', 'Q-test-1105']],
  'Q-test-1003': [['sibling', 'Q-test-1104']],
  'Q-test-1007': [['spouse', 'Q-test-1108']],
};

function personBindings(qid: string, persons: Record<string, Person> = PERSONS): SparqlBinding[] {
  const person = persons[qid] ?? {};
  const subject = entity(qid);
  const fact = (name: string, extra: Record<string, unknown> = {}) =>
    ({ person: subject, fact: literal(name), ...extra }) as SparqlBinding;
  return [
    ...(person.labels ?? []).map(([lang, text]) => fact('label', { value: literal(text, lang) })),
    ...(person.aliases ?? []).map((text) => fact('alias', { value: literal(text, 'en') })),
    ...(person.births ?? []).map((date) =>
      fact('birth', { value: time(date), precision: precision(11) }),
    ),
    ...(person.dead === true ? [fact('death')] : []),
    ...(person.sex === undefined ? [] : [fact('sex', { value: entity(person.sex) })]),
    ...(person.citizenship === undefined
      ? []
      : [fact('citizenship', { value: literal(person.citizenship) })]),
  ];
}

const VALUES = /VALUES \?person \{([^}]*)\}/u;
const QIDS = /wd:(Q-test-\d+)/gu;
const CLASS = /wd:(Q-test-90\d\d) \./u;
const LIMIT = /LIMIT (\d+)\s+OFFSET (\d+)/u;

interface Tables {
  readonly statements: Record<string, readonly Held[]>;
  readonly persons: Record<string, Person>;
  readonly relatives: Record<string, readonly (readonly [string, string])[]>;
}

/** A fake query service: one query at a time, answered from the synthetic tables. */
function service(
  tables: Tables = { statements: STATEMENTS, persons: PERSONS, relatives: RELATIVES },
) {
  const queries: string[] = [];
  let active = 0;
  let overlapped = false;
  const run = async (query: string): Promise<string> => {
    queries.push(query);
    active += 1;
    overlapped ||= active > 1;
    await Promise.resolve();
    active -= 1;
    const answer = (bindings: readonly SparqlBinding[]) =>
      JSON.stringify({ head: { vars: [] }, results: { bindings } });
    const named = [...(VALUES.exec(query)?.[1] ?? '').matchAll(QIDS)].map(
      (match) => match[1] ?? '',
    );
    if (query.includes('SELECT ?statement')) {
      const [, limit = '0', offset = '0'] = LIMIT.exec(query) ?? [];
      const rows = (tables.statements[CLASS.exec(query)?.[1] ?? ''] ?? []).map(statementBinding);
      return answer(rows.slice(Number(offset), Number(offset) + Number(limit)));
    }
    if (query.includes('SELECT ?person ?relation ?relative')) {
      // The query drops deceased PEPs (FILTER NOT EXISTS on P570), as the service would.
      return answer(
        named
          .filter((pep) => tables.persons[pep]?.dead !== true)
          .flatMap((pep) =>
            (tables.relatives[pep] ?? []).map(([relation, relative]) => ({
              person: entity(pep),
              relation: literal(relation),
              relative: entity(relative),
            })),
          ),
      );
    }
    return answer(named.flatMap((qid) => personBindings(qid, tables.persons)));
  };
  return { run, queries, overlapped: () => overlapped };
}

const OPTIONS: PepBuildOptions = {
  now: NOW,
  includeRelatives: true,
  classes: CLASSES,
  pageSize: 2,
  batchSize: 3,
};

async function build(
  options: PepBuildOptions,
  fake = service(),
): Promise<{
  records: WatchlistRecord[];
  publication: PepPublication;
  fake: ReturnType<typeof service>;
}> {
  const records: WatchlistRecord[] = [];
  const builder = buildPepRecords(fake.run, options);
  for (;;) {
    const step = await builder.next();
    if (step.done === true) {
      return { records, publication: step.value, fake };
    }
    records.push(step.value);
  }
}

describe('buildPepRecords', () => {
  it('keeps current holders, holders within retention and adult relatives of class 1-2 holders', async () => {
    const { records, publication, fake } = await build(OPTIONS);
    expect(records.map((record) => record.entry_id)).toEqual([
      'Q-test-1001',
      'Q-test-1003',
      'Q-test-1004',
      'Q-test-1006',
      'Q-test-1101',
      'Q-test-1104',
    ]);
    for (const record of records) {
      expect(watchlistRecordSchema.parse(record)).toEqual(record);
    }
    expect(publication).toEqual({
      publishedAt: '2026-10-27T12:00:00.000Z',
      entries: 6,
      stats: {
        statements: 8,
        holders: 4,
        relatives: 2,
        excludedByRetention: 2,
        excludedDeceased: 1,
        excludedWithoutName: 0,
        relativesExcludedByAge: 2,
      },
    });
    expect(fake.overlapped()).toBe(false);
  });

  it('writes a current national head: labels and aliases, the English label primary, kept tenures only', async () => {
    const { records } = await build(OPTIONS);
    expect(records[0]).toEqual({
      entry_id: 'Q-test-1001',
      kind: 'individual',
      names: [
        { full: 'Marlowe Testerton', parts: [], script: 'latin', quality: 'strong', primary: true },
        {
          full: 'Марлоу Тестертон',
          parts: [],
          script: 'cyrillic',
          quality: 'strong',
          primary: false,
        },
        { full: 'M. Testerton', parts: [], script: 'latin', quality: 'strong', primary: false },
        { full: 'Marly', parts: [], script: 'latin', quality: 'weak', primary: false },
      ],
      birth_dates: [{ value: '1960-03-15', precision: 'day' }],
      birth_places: [],
      countries: [{ code: 'GB', role: 'citizenship' }],
      gender: 'female',
      identifiers: [],
      addresses: [],
      crypto_addresses: [],
      programs: [],
      positions: [
        {
          position: 'Q-test-2001',
          label: 'President of Synthetica',
          pep_class: 1,
          country: 'GB',
          start: '2019-07-24',
          end: null,
          in_office: 'yes',
        },
      ],
      relations: [],
    });
  });

  it('keeps a head five years after office, a refined mayor in class 4, and a holder who is also a relative', async () => {
    const { records } = await build(OPTIONS);
    const byId = new Map(records.map((record) => [record.entry_id, record]));
    expect(byId.get('Q-test-1003')?.positions).toEqual([
      {
        position: 'Q-test-2001',
        label: 'President of Synthetica',
        pep_class: 1,
        country: 'GB',
        start: '2014-01-01',
        end: '2022-06-30',
        in_office: 'no',
      },
    ]);
    expect(byId.get('Q-test-1006')?.positions).toEqual([
      {
        position: 'Q-test-2003',
        label: 'Mayor of Synthetic Town',
        pep_class: 4,
        country: null,
        start: '2023-01-01',
        end: null,
        in_office: 'yes',
      },
    ]);
    expect(byId.get('Q-test-1006')?.names[0]).toMatchObject({
      full: 'Fenn Synthetik',
      primary: true,
    });
    expect(byId.get('Q-test-1004')).toMatchObject({
      positions: [{ position: 'Q-test-2002', pep_class: 2, country: 'GB', in_office: 'yes' }],
      relations: [{ relation: 'sibling', entity_id: 'Q-test-1001' }],
    });
  });

  it('writes relatives without positions, linked to every kept PEP they relate to', async () => {
    const { records } = await build(OPTIONS);
    const byId = new Map(records.map((record) => [record.entry_id, record]));
    expect(byId.get('Q-test-1101')).toMatchObject({
      positions: [],
      relations: [{ relation: 'spouse', entity_id: 'Q-test-1001' }],
      birth_dates: [{ value: '1975-09-09', precision: 'day' }],
    });
    expect(byId.get('Q-test-1104')?.relations).toEqual([
      { relation: 'sibling', entity_id: 'Q-test-1001' },
      { relation: 'sibling', entity_id: 'Q-test-1003' },
    ]);
  });

  it('asks only for the relatives of kept holders of class 1 or 2, the query dropping the deceased', async () => {
    const { fake } = await build(OPTIONS);
    const asked = fake.queries
      .filter((query) => query.includes('SELECT ?person ?relation ?relative'))
      .flatMap((query) =>
        [...(VALUES.exec(query)?.[1] ?? '').matchAll(QIDS)].map((match) => match[1]),
      );
    expect(asked.sort()).toEqual(['Q-test-1001', 'Q-test-1003', 'Q-test-1004', 'Q-test-1007']);
  });

  it('syncs no relative and sends no relatives query without the install flag', async () => {
    const { records, publication, fake } = await build({ ...OPTIONS, includeRelatives: false });
    expect(records.map((record) => record.entry_id)).toEqual([
      'Q-test-1001',
      'Q-test-1003',
      'Q-test-1004',
      'Q-test-1006',
    ]);
    expect(records.every((record) => record.relations.length === 0)).toBe(true);
    expect(fake.queries.some((query) => query.includes('?relation'))).toBe(false);
    expect(publication.stats).toMatchObject({ relatives: 0, relativesExcludedByAge: 0 });
  });

  it('pages each class until a short page, and asks for older ends only of single-holder classes', async () => {
    const { fake } = await build(OPTIONS);
    const positions = fake.queries.filter((query) => query.includes('SELECT ?statement'));
    expect(positions.map((query) => [CLASS.exec(query)?.[1], LIMIT.exec(query)?.[2]])).toEqual([
      ['Q-test-9001', '0'],
      ['Q-test-9001', '2'],
      ['Q-test-9001', '4'],
      ['Q-test-9002', '0'],
      ['Q-test-9002', '2'],
      ['Q-test-9002', '4'],
      ['Q-test-9003', '0'],
    ]);
    expect(
      positions
        .filter((query) => query.includes('^^xsd:dateTime'))
        .map((query) => CLASS.exec(query)?.[1]),
    ).toEqual(['Q-test-9002', 'Q-test-9002', 'Q-test-9002']);
  });

  it('refuses a class that needs more pages than allowed, and an answer it cannot read', async () => {
    await expect(build({ ...OPTIONS, maxPagesPerClass: 1 })).rejects.toMatchObject({
      code: 'too_large',
    });
    const broken = { ...service(), run: () => Promise.resolve('{"results":') };
    await expect(build(OPTIONS, broken)).rejects.toBeInstanceOf(WatchlistParseError);
  });
});

/**
 * Owner decision 9 after Workflow 6B: a relative carries the class of the PEP it relates to,
 * derived from the holders on each pass, so the class filter reads it from the relative's own
 * record and a holder's reclassification reaches its relatives as a change of risk data.
 */
describe('buildPepRecords, a relative’s class (owner decision 9 after 6B)', () => {
  const byId = (records: readonly WatchlistRecord[]) =>
    new Map(records.map((record) => [record.entry_id, record]));
  const must = (record: WatchlistRecord | undefined): WatchlistRecord => {
    if (record === undefined) {
      throw new Error('no record');
    }
    return record;
  };

  it('gives each relative the class of the PEP it relates to, and a holder without family links none', async () => {
    const records = byId((await build(OPTIONS)).records);
    expect(records.get('Q-test-1101')?.relative_of_class).toBe(1);
    expect(records.get('Q-test-1104')?.relative_of_class).toBe(1);
    // A class 2 holder who is also the sibling of a class 1 PEP is a class 1 relative.
    expect(records.get('Q-test-1004')).toMatchObject({
      positions: [{ pep_class: 2 }],
      relative_of_class: 1,
    });
    for (const holder of ['Q-test-1001', 'Q-test-1003', 'Q-test-1006']) {
      expect(records.get(holder)).not.toHaveProperty('relative_of_class');
    }
  });

  it('carries a holder’s class change to each of its relatives, as a change of risk data only', async () => {
    const before = byId((await build(OPTIONS)).records);
    const reclassified = byId(
      (await build({ ...OPTIONS, classes: [{ ...HEADS, pep_class: 2 }, MEMBERS, MAYORS] })).records,
    );
    for (const qid of ['Q-test-1101', 'Q-test-1104', 'Q-test-1004']) {
      const was = must(before.get(qid));
      const now = must(reclassified.get(qid));
      expect(now.relative_of_class, qid).toBe(2);
      expect(contentHash(now), qid).toBe(contentHash(was));
      expect(riskDataHash(now), qid).not.toBe(riskDataHash(was));
    }
  });

  it('takes the most senior class when a relative relates to PEPs of several classes', async () => {
    const minister = row('Q-test-9011', { pep_class: 1 });
    const envoy = row('Q-test-9012', { pep_class: 2 });
    const tables: Tables = {
      statements: {
        'Q-test-9011': [
          {
            id: 'm-minister',
            person: 'Q-test-1301',
            start: '2020-01-01',
            position: 'Q-test-2301',
            label: 'Minister of Synthetic Affairs',
          },
        ],
        'Q-test-9012': [
          {
            id: 'n-envoy',
            person: 'Q-test-1302',
            start: '2020-01-01',
            position: 'Q-test-2302',
            label: 'Envoy of Synthetica',
          },
        ],
      },
      persons: {
        'Q-test-1301': { labels: [['en', 'Quinn Placeholder']], births: ['1960-01-01'] },
        'Q-test-1302': { labels: [['en', 'Reese Placeholder']], births: ['1962-01-01'] },
        'Q-test-1303': { labels: [['en', 'Shay Placeholder']], births: ['1964-01-01'] },
        'Q-test-1304': { labels: [['en', 'Tate Placeholder']], births: ['1990-01-01'] },
      },
      relatives: {
        'Q-test-1301': [['spouse', 'Q-test-1303']],
        'Q-test-1302': [
          ['sibling', 'Q-test-1303'],
          ['child', 'Q-test-1304'],
        ],
      },
    };
    const records = byId(
      (await build({ ...OPTIONS, classes: [minister, envoy] }, service(tables))).records,
    );
    expect(records.get('Q-test-1303')).toMatchObject({
      relations: [
        { relation: 'spouse', entity_id: 'Q-test-1301' },
        { relation: 'sibling', entity_id: 'Q-test-1302' },
      ],
      relative_of_class: 1,
    });
    expect(records.get('Q-test-1304')?.relative_of_class).toBe(2);
  });
});

describe('buildPepRecords, the less common answers', () => {
  const HOLDERS = row('Q-test-9101', { pep_class: 1, single_holder: true });
  const POST = { position: 'Q-test-2101', label: 'x'.repeat(250) };

  function tinyService(answers: {
    readonly statements: readonly SparqlBinding[];
    readonly persons: Record<string, readonly SparqlBinding[]>;
    readonly relatives?: readonly SparqlBinding[];
  }) {
    return (query: string): Promise<string> => {
      const answer = (bindings: readonly SparqlBinding[]) =>
        JSON.stringify({ head: { vars: [] }, results: { bindings } });
      if (query.includes('SELECT ?statement')) {
        return Promise.resolve(answer(query.includes('OFFSET 0') ? answers.statements : []));
      }
      if (query.includes('?relation')) {
        return Promise.resolve(answer(answers.relatives ?? []));
      }
      const named = [...(VALUES.exec(query)?.[1] ?? '').matchAll(QIDS)].map(
        (match) => match[1] ?? '',
      );
      return Promise.resolve(answer(named.flatMap((qid) => answers.persons[qid] ?? [])));
    };
  }

  const fact = (qid: string, name: string, value?: SparqlBinding[string]) =>
    ({
      person: entity(qid),
      fact: literal(name),
      ...(value === undefined ? {} : { value }),
    }) as SparqlBinding;

  async function everything(
    run: (query: string) => Promise<string>,
    includeRelatives: boolean,
  ): Promise<{ records: WatchlistRecord[]; publication: PepPublication }> {
    const records: WatchlistRecord[] = [];
    const builder = buildPepRecords(run, { now: NOW, includeRelatives, classes: [HOLDERS] });
    for (;;) {
      const step = await builder.next();
      if (step.done === true) {
        return { records, publication: step.value };
      }
      records.push(step.value);
    }
  }

  it('merges a statement repeated with several successors, a known one winning, and counts the unnamed', async () => {
    const base = statementBinding({
      id: 'h-post',
      person: 'Q-test-1201',
      start: '2010-01-01',
      ...POST,
    });
    const later = statementBinding({
      id: 'l-post',
      person: 'Q-test-1202',
      start: '2012-01-01',
      ...POST,
    });
    const { records, publication } = await everything(
      tinyService({
        statements: [
          { ...base, successor: { type: 'bnode', value: 'b1' } },
          { ...base, successor: entity('Q-test-1203') },
          { ...base, successor: { type: 'bnode', value: 'b2' } },
          later,
        ],
        persons: {},
      }),
      false,
    );
    expect(records).toEqual([]);
    expect(publication.stats).toMatchObject({
      statements: 2,
      excludedByRetention: 1,
      excludedWithoutName: 1,
    });
  });

  it('takes family links only for the PEPs it asked about, never a self-link, the first relation of a pair', async () => {
    const { records } = await everything(
      tinyService({
        statements: [
          statementBinding({ id: 'l-post', person: 'Q-test-1202', start: '2012-01-01', ...POST }),
        ],
        persons: {
          'Q-test-1202': [fact('Q-test-1202', 'label', literal('Lane Placeholder', 'en'))],
          'Q-test-1204': [
            fact('Q-test-1204', 'label', literal('Mora Placeholder', 'en')),
            { ...fact('Q-test-1204', 'birth', time('1970-01-01')), precision: precision(11) },
          ],
          'Q-test-1205': [
            fact('Q-test-1205', 'label', literal('Nico Placeholder', 'en')),
            { ...fact('Q-test-1205', 'birth', time('1970-01-01')), precision: precision(11) },
          ],
        },
        relatives: [
          {
            person: entity('Q-test-1202'),
            relation: literal('sibling'),
            relative: entity('Q-test-1202'),
          },
          {
            person: entity('Q-test-1202'),
            relation: literal('spouse'),
            relative: entity('Q-test-1204'),
          },
          {
            person: entity('Q-test-1202'),
            relation: literal('parent'),
            relative: entity('Q-test-1204'),
          },
          {
            person: entity('Q-test-1201'),
            relation: literal('spouse'),
            relative: entity('Q-test-1205'),
          },
        ],
      }),
      true,
    );
    expect(records.map((record) => [record.entry_id, record.relations])).toEqual([
      ['Q-test-1202', []],
      ['Q-test-1204', [{ relation: 'spouse', entity_id: 'Q-test-1202' }]],
    ]);
  });

  it('prefers a multilingual label without an English one, drops over-long names and caps the label', async () => {
    const { records } = await everything(
      tinyService({
        statements: [
          statementBinding({ id: 'h-post', person: 'Q-test-1201', start: '2020-01-01', ...POST }),
        ],
        persons: {
          'Q-test-1201': [
            fact('Q-test-1201', 'label', literal('Hollis Placeholder', 'mul')),
            fact('Q-test-1201', 'label', literal('Hollis Placeholder', 'de')),
            fact('Q-test-1201', 'alias', literal('Q'.repeat(301))),
            fact('Q-test-1201', 'alias', literal('Hollis')),
            fact('Q-test-1201', 'sex', entity('Q6581097')),
            fact('Q-test-1201', 'sex', entity('Q6581072')),
            fact('Q-test-1201', 'birth', { type: 'literal', value: 'not a time' }),
          ],
        },
      }),
      false,
    );
    expect(records[0]).toMatchObject({
      gender: 'male',
      birth_dates: [],
      names: [
        { full: 'Hollis Placeholder', primary: true, quality: 'strong' },
        { full: 'Hollis', primary: false, quality: 'weak' },
      ],
      positions: [{ label: 'x'.repeat(200), country: null, in_office: 'yes' }],
    });
    expect(records[0]?.names).toHaveLength(2);
  });
});

describe('pepImportSource', () => {
  const results = (bindings: readonly SparqlBinding[]) => ({
    head: { vars: [] },
    results: { bindings },
  });
  const recorded = (withRelatives = true) =>
    JSON.stringify({
      format: PEP_IMPORT_FORMAT,
      positions: Object.fromEntries(
        Object.entries(STATEMENTS).map(([qid, held]) => [qid, results(held.map(statementBinding))]),
      ),
      persons: results(Object.keys(PERSONS).flatMap((qid) => personBindings(qid))),
      ...(withRelatives
        ? {
            relatives: results(
              Object.entries(RELATIVES).flatMap(([pep, links]) =>
                links.map(([relation, relative]) => ({
                  person: entity(pep),
                  relation: literal(relation),
                  relative: entity(relative),
                })),
              ),
            ),
          }
        : {}),
    });

  async function imported(source: PepAnswerSource, options: PepBuildOptions = OPTIONS) {
    const records: WatchlistRecord[] = [];
    const builder = buildPepRecords(source, options);
    for (;;) {
      const step = await builder.next();
      if (step.done === true) {
        return { records, publication: step.value };
      }
      records.push(step.value);
    }
  }

  it('builds from one recorded document what the live service gives, the dead PEP’s links left out', async () => {
    const live = await build(OPTIONS);
    const fromFile = await imported(pepImportSource(recorded(), { maxBytes: 1_000_000 }));
    expect(fromFile).toEqual({ records: live.records, publication: live.publication });
    expect(fromFile.records.some((record) => record.entry_id === 'Q-test-1108')).toBe(false);
  });

  it('answers no family links when the document records none', async () => {
    const { records } = await imported(pepImportSource(recorded(false), { maxBytes: 1_000_000 }));
    expect(records.every((record) => record.relations.length === 0)).toBe(true);
  });

  it('refuses another format, a body over its cap and a class key that is no QID', () => {
    const cases: Record<string, readonly [string, number, string]> = {
      format: [
        JSON.stringify({ format: 'other', positions: {}, persons: results([]) }),
        1_000_000,
        'format',
      ],
      size: [recorded(), 100, 'too_large'],
      key: [
        JSON.stringify({
          format: PEP_IMPORT_FORMAT,
          positions: { 'not a qid': results([]) },
          persons: results([]),
        }),
        1_000_000,
        'format',
      ],
    };
    for (const [label, [body, maxBytes, code]] of Object.entries(cases)) {
      let error: unknown;
      try {
        pepImportSource(body, { maxBytes });
      } catch (caught) {
        error = caught;
      }
      expect(error, label).toBeInstanceOf(WatchlistParseError);
      expect((error as WatchlistParseError).code, label).toBe(code);
    }
  });
});
