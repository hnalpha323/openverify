/**
 * C77.2: the UN consolidated list parser over synthetic documents written here in the file's
 * shape: a fictional person and company, made-up reference numbers and documents.
 */
import { describe, expect, it } from 'vitest';
import type { WatchlistRecord } from '../record/index.js';
import { WatchlistParseError } from './errors.js';
import { readPublication, type WatchlistParse } from './list.js';
import { parseUnConsolidated } from './un.js';

const element = (name: string, inner = ''): string => `<${name}>${inner}</${name}>`;
const value = (name: string, text: string): string => element(name, element('VALUE', text));

const PERSON = element(
  'INDIVIDUAL',
  element('DATAID', '990001') +
    element('VERSIONNUM', '1') +
    element('FIRST_NAME', 'AVERY') +
    element('SECOND_NAME', 'SANDBOX') +
    element('THIRD_NAME', 'QUILLFEATHER') +
    element('FOURTH_NAME') +
    element('UN_LIST_TYPE', 'Sandbox') +
    element('REFERENCE_NUMBER', 'SBXi.001') +
    element('LISTED_ON', '2024-01-15') +
    element('NAME_ORIGINAL_SCRIPT', 'Эйвери Квиллфезер') +
    element('COMMENTS1', 'Synthetic entry for tests.') +
    value('TITLE', 'Synthetic Official') +
    value('DESIGNATION', 'Synthetic designation') +
    value('NATIONALITY', 'United Kingdom of Great Britain and Northern Ireland') +
    value('LIST_TYPE', 'UN List') +
    value('LAST_DAY_UPDATED', '2025-01-01') +
    element('GENDER', 'Female') +
    element('INDIVIDUAL_ALIAS', element('QUALITY', 'Good') + element('ALIAS_NAME', 'Avery Quill')) +
    element('INDIVIDUAL_ALIAS', element('QUALITY', 'Low') + element('ALIAS_NAME', 'Avy')) +
    element(
      'INDIVIDUAL_ALIAS',
      element('QUALITY', 'a.k.a.') + element('ALIAS_NAME', 'A. S. Quillfeather'),
    ) +
    element('INDIVIDUAL_ALIAS', element('QUALITY') + element('ALIAS_NAME')) +
    element(
      'INDIVIDUAL_ADDRESS',
      element('STREET', '1 Synthetic Lane') +
        element('CITY', 'Sandbox City') +
        element('ZIP_CODE', 'ZZ99 9ZZ') +
        element('COUNTRY', 'United Kingdom'),
    ) +
    element(
      'INDIVIDUAL_DATE_OF_BIRTH',
      element('TYPE_OF_DATE', 'EXACT') + element('DATE', '1980-04-12'),
    ) +
    element(
      'INDIVIDUAL_DATE_OF_BIRTH',
      element('TYPE_OF_DATE', 'APPROXIMATELY') + element('YEAR', '1979'),
    ) +
    element(
      'INDIVIDUAL_DATE_OF_BIRTH',
      element('TYPE_OF_DATE', 'BETWEEN') +
        element('FROM_YEAR', '1958') +
        element('TO_YEAR', '1960'),
    ) +
    element('INDIVIDUAL_DATE_OF_BIRTH', element('YEAR', '1975')) +
    element(
      'INDIVIDUAL_PLACE_OF_BIRTH',
      element('CITY', 'Sandbox City') +
        element('STATE_PROVINCE', 'Sandbox Province') +
        element('COUNTRY', 'United Kingdom'),
    ) +
    element(
      'INDIVIDUAL_DOCUMENT',
      element('TYPE_OF_DOCUMENT', 'Passport') +
        element('NUMBER', 'SBX123456') +
        element('ISSUING_COUNTRY', 'United Kingdom'),
    ) +
    element(
      'INDIVIDUAL_DOCUMENT',
      element('TYPE_OF_DOCUMENT', 'National Identification Number') +
        element('NUMBER', 'SBX-NID-1'),
    ) +
    element('SORT_KEY') +
    element('SORT_KEY_LAST_MOD'),
);

const COMPANY = element(
  'ENTITY',
  element('DATAID', '990002') +
    element('VERSIONNUM', '1') +
    element('FIRST_NAME', 'MARROWSTONE PLACEHOLDER HOLDINGS') +
    element('UN_LIST_TYPE', 'Sandbox') +
    element('REFERENCE_NUMBER', 'SBXe.001') +
    element('LISTED_ON', '2024-01-15') +
    element('COMMENTS1') +
    value('LIST_TYPE', 'UN List') +
    element('ENTITY_ALIAS', element('QUALITY', 'Good') + element('ALIAS_NAME', 'MPH LTD')) +
    element(
      'ENTITY_ADDRESS',
      element('CITY', 'Elsewhere Synthetic') + element('COUNTRY', 'Utopia'),
    ),
);

function unXml(
  individuals: readonly string[],
  entities: readonly string[],
  generated: string | null = '2026-10-22T23:00:06.809Z',
): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<CONSOLIDATED_LIST xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:noNamespaceSchemaLocation="https://www.un.org/sc/resources/sc-sanctions.xsd"' +
    (generated === null ? '' : ` dateGenerated="${generated}"`) +
    '>' +
    element('INDIVIDUALS', individuals.join('\n')) +
    element('ENTITIES', entities.join('\n')) +
    '</CONSOLIDATED_LIST>'
  );
}

const OPTIONS = { maxBytes: 5_000_000 };
const encode = (text: string): Uint8Array[] => [new TextEncoder().encode(text)];

async function records(parse: WatchlistParse): Promise<WatchlistRecord[]> {
  const read: WatchlistRecord[] = [];
  await readPublication(parse, (record) => {
    read.push(record);
  });
  return read;
}

async function refusal(parse: WatchlistParse): Promise<WatchlistParseError> {
  try {
    await records(parse);
  } catch (error) {
    expect(error).toBeInstanceOf(WatchlistParseError);
    return error as WatchlistParseError;
  }
  throw new Error('the list was not refused');
}

describe('parseUnConsolidated', () => {
  it('maps an individual: positional names without roles, alias quality, typed dates', async () => {
    const [person] = await records(parseUnConsolidated(encode(unXml([PERSON], [])), OPTIONS));
    expect(person).toEqual({
      entry_id: 'SBXi.001',
      kind: 'individual',
      names: [
        {
          full: 'AVERY SANDBOX QUILLFEATHER',
          parts: [],
          script: 'latin',
          quality: 'strong',
          primary: true,
        },
        {
          full: 'Эйвери Квиллфезер',
          parts: [],
          script: 'cyrillic',
          quality: 'strong',
          primary: false,
        },
        { full: 'Avery Quill', parts: [], script: 'latin', quality: 'strong', primary: false },
        { full: 'Avy', parts: [], script: 'latin', quality: 'weak', primary: false },
        {
          full: 'A. S. Quillfeather',
          parts: [],
          script: 'latin',
          quality: 'strong',
          primary: false,
        },
      ],
      birth_dates: [
        { value: '1980-04-12', precision: 'day' },
        { value: '1979', precision: 'year', range: { from: '1978', to: '1980' } },
        { value: '1958', precision: 'year', range: { from: '1958', to: '1960' } },
        { value: '1975', precision: 'year' },
      ],
      birth_places: ['Sandbox City, Sandbox Province'],
      countries: [
        { code: 'GB', role: 'nationality' },
        { code: 'GB', role: 'birth' },
        { code: 'GB', role: 'address' },
      ],
      gender: 'female',
      identifiers: [
        { kind: 'passport', value: 'SBX123456', country: 'GB' },
        { kind: 'national_id', value: 'SBX-NID-1' },
      ],
      addresses: [
        { country: 'GB', city: 'Sandbox City', postcode: 'ZZ99 9ZZ', lines: ['1 Synthetic Lane'] },
      ],
      crypto_addresses: [],
      programs: ['Sandbox'],
      listed_at: '2024-01-15',
      positions: [],
      relations: [],
      remarks: 'Synthetic entry for tests.',
    });
  });

  it('maps an entity with its alias and an address in an unknown country', async () => {
    const [company] = await records(parseUnConsolidated(encode(unXml([], [COMPANY])), OPTIONS));
    expect(company).toMatchObject({
      entry_id: 'SBXe.001',
      kind: 'entity',
      names: [
        { full: 'MARROWSTONE PLACEHOLDER HOLDINGS', primary: true },
        { full: 'MPH LTD', primary: false },
      ],
      countries: [],
      addresses: [{ city: 'Elsewhere Synthetic', lines: [] }],
    });
    expect(company).not.toHaveProperty('remarks');
  });

  it('returns dateGenerated as the publication time', async () => {
    const publication = await readPublication(
      parseUnConsolidated(encode(unXml([PERSON], [COMPANY])), OPTIONS),
      () => undefined,
    );
    expect(publication).toEqual({ publishedAt: '2026-10-22T23:00:06.809Z', entries: 2 });
  });

  it('refuses another root and a list without dateGenerated (format)', async () => {
    for (const xml of [
      unXml([PERSON], []).replaceAll('CONSOLIDATED_LIST', 'SANCTIONS_LIST'),
      unXml([PERSON], [], null),
    ]) {
      expect((await refusal(parseUnConsolidated(encode(xml), OPTIONS))).code).toBe('format');
    }
  });

  it('refuses a reference number given twice or missing (schema)', async () => {
    for (const [individuals, entities] of [
      [[PERSON, PERSON], []],
      [[], [COMPANY.replace('SBXe.001', ' ')]],
    ] as const) {
      expect(
        (await refusal(parseUnConsolidated(encode(unXml(individuals, entities)), OPTIONS))).code,
      ).toBe('schema');
    }
  });
});
