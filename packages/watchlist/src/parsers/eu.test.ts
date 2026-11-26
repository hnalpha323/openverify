/**
 * C77.2: the EU Financial Sanctions Files parser over synthetic documents written here in the
 * file's shape: fictional persons and companies, made-up identifiers and regulations.
 */
import { describe, expect, it } from 'vitest';
import type { WatchlistRecord } from '../record/index.js';
import { WatchlistParseError } from './errors.js';
import { EU_FSF_NAMESPACE, parseEuFsf } from './eu.js';
import { readPublication, type WatchlistParse } from './list.js';

type Attributes = Record<string, string>;

const tag = (name: string, attributes: Attributes, inner = ''): string =>
  `<${name} ${Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')}>${inner}</${name}>`;

const regulation = (programme: string, date: string): string =>
  tag(
    'regulation',
    {
      regulationType: 'regulation',
      organisationType: 'council',
      publicationDate: date,
      entryIntoForceDate: date,
      numberTitle: '2022/1 (OJ L 1)',
      programme,
      logicalId: '1',
    },
    '<publicationUrl>https://eur-lex.europa.eu/example</publicationUrl>',
  );

const alias = (attributes: Attributes): string =>
  tag(
    'nameAlias',
    {
      firstName: '',
      middleName: '',
      lastName: '',
      function: '',
      gender: '',
      title: '',
      nameLanguage: '',
      strong: 'true',
      regulationLanguage: 'en',
      logicalId: '11',
      ...attributes,
    },
    '<regulationSummary regulationType="regulation" publicationDate="2022-03-01" numberTitle="2022/1"/>',
  );

const birth = (attributes: Attributes): string =>
  tag('birthdate', {
    circa: 'false',
    calendarType: 'GREGORIAN',
    city: '',
    zipCode: '',
    birthdate: '',
    dayOfMonth: '',
    monthOfYear: '',
    year: '',
    region: '',
    place: '',
    countryIso2Code: '00',
    regulationLanguage: 'en',
    logicalId: '51',
    ...attributes,
  });

const identification = (attributes: Attributes): string =>
  tag('identification', {
    diplomatic: 'false',
    knownExpired: 'false',
    knownFalse: 'false',
    reportedLost: 'false',
    revokedByIssuer: 'false',
    issuedBy: '',
    issuedDate: '',
    validFrom: '',
    validTo: '',
    latinNumber: '',
    nameOnDocument: '',
    documentNumber: '',
    number: '',
    region: '',
    countryIso2Code: '00',
    countryDescription: 'UNKNOWN',
    identificationTypeCode: 'other',
    identificationTypeDescription: '',
    regulationLanguage: 'en',
    logicalId: '31',
    ...attributes,
  });

const PERSON = tag(
  'sanctionEntity',
  {
    designationDetails: '',
    unitedNationId: '',
    euReferenceNumber: 'EU.9001.01',
    logicalId: '70001',
  },
  regulation('SBX', '2023-05-02') +
    regulation('SBX', '2022-03-01') +
    '<subjectType code="person" classificationCode="P"/>' +
    alias({
      firstName: 'Avery',
      middleName: 'Sandbox',
      lastName: 'Quillfeather',
      wholeName: 'Avery Sandbox Quillfeather',
      gender: 'F',
      function: 'Synthetic official',
    }) +
    alias({ wholeName: 'Эйвери Квиллфезер', nameLanguage: 'RU' }) +
    alias({ wholeName: 'Avy Q', strong: 'false' }) +
    tag('citizenship', {
      region: '',
      countryIso2Code: 'GB',
      countryDescription: 'UNITED KINGDOM',
    }) +
    tag('citizenship', { region: '', countryIso2Code: '00', countryDescription: 'UNKNOWN' }) +
    birth({
      birthdate: '1980-04-12',
      dayOfMonth: '12',
      monthOfYear: '4',
      year: '1980',
      city: 'Sandbox City',
      countryIso2Code: 'GB',
    }) +
    birth({ circa: 'true', year: '1979' }) +
    birth({ yearRangeFrom: '1958', yearRangeTo: '1960' }) +
    birth({ monthOfYear: '9', year: '1975', place: 'Sandbox Province' }) +
    identification({
      number: 'SBX123456',
      countryIso2Code: 'GB',
      identificationTypeCode: 'passport',
      identificationTypeDescription: 'National passport',
    }) +
    identification({
      number: 'SBX-FC-1',
      identificationTypeCode: 'fiscalcode',
      identificationTypeDescription: 'Fiscal Code',
    }) +
    identification({
      latinNumber: 'SBX-ID-1',
      identificationTypeCode: 'id',
      identificationTypeDescription: 'National identification card',
    }) +
    tag('address', {
      city: 'Sandbox City',
      street: '1 Synthetic Lane',
      poBox: '',
      zipCode: 'ZZ99 9ZZ',
      region: 'Sandbox Region',
      place: '',
      asAtListingTime: 'false',
      contactInfo: '',
      countryIso2Code: 'GB',
      countryDescription: 'UNITED KINGDOM',
    }) +
    '<remark>Synthetic entry for tests.</remark>',
);

const COMPANY = tag(
  'sanctionEntity',
  {
    designationDetails: '',
    unitedNationId: '',
    euReferenceNumber: 'EU.9002.01',
    logicalId: '70002',
  },
  regulation('SBX-2', '2024-01-15') +
    '<subjectType code="enterprise" classificationCode="E"/>' +
    alias({ wholeName: 'Marrowstone Placeholder Holdings Ltd' }) +
    identification({
      number: 'SBX-REG-0001',
      countryIso2Code: 'GB',
      identificationTypeCode: 'regnumber',
      identificationTypeDescription: 'Registration Number',
    }) +
    identification({
      number: 'SBXHGB2L',
      identificationTypeCode: 'swiftbic',
      identificationTypeDescription: 'SWIFT BIC',
    }),
);

function euXml(
  entities: readonly string[],
  root: Attributes = { generationDate: '2026-10-15T12:10:34.160+02:00', globalFileId: '999001' },
  namespace = EU_FSF_NAMESPACE,
): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    tag('export', { xmlns: namespace, ...root }, entities.join('\n'))
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

describe('parseEuFsf', () => {
  it('maps a person: aliases with strength, parts and gender, dates, countries, documents', async () => {
    const [person] = await records(parseEuFsf(encode(euXml([PERSON])), OPTIONS));
    expect(person).toEqual({
      entry_id: '70001',
      kind: 'individual',
      names: [
        {
          full: 'Avery Sandbox Quillfeather',
          parts: [
            { role: 'given', value: 'Avery' },
            { role: 'middle', value: 'Sandbox' },
            { role: 'family', value: 'Quillfeather' },
          ],
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
        { full: 'Avy Q', parts: [], script: 'latin', quality: 'weak', primary: false },
      ],
      birth_dates: [
        { value: '1980-04-12', precision: 'day' },
        { value: '1979', precision: 'year', range: { from: '1978', to: '1980' } },
        { value: '1958', precision: 'year', range: { from: '1958', to: '1960' } },
        { value: '1975-09', precision: 'month' },
      ],
      birth_places: ['Sandbox City', 'Sandbox Province'],
      countries: [
        { code: 'GB', role: 'citizenship' },
        { code: 'GB', role: 'birth' },
        { code: 'GB', role: 'address' },
      ],
      gender: 'female',
      identifiers: [
        { kind: 'passport', value: 'SBX123456', country: 'GB' },
        { kind: 'tax_id', value: 'SBX-FC-1' },
        { kind: 'national_id', value: 'SBX-ID-1' },
      ],
      addresses: [
        {
          country: 'GB',
          city: 'Sandbox City',
          postcode: 'ZZ99 9ZZ',
          lines: ['1 Synthetic Lane', 'Sandbox Region'],
        },
      ],
      crypto_addresses: [],
      programs: ['SBX'],
      listed_at: '2022-03-01',
      positions: [],
      relations: [],
      remarks: 'Synthetic entry for tests.',
    });
  });

  it('maps an enterprise with its registration number and BIC', async () => {
    const [company] = await records(parseEuFsf(encode(euXml([COMPANY])), OPTIONS));
    expect(company).toMatchObject({
      entry_id: '70002',
      kind: 'entity',
      names: [{ full: 'Marrowstone Placeholder Holdings Ltd', primary: true, quality: 'strong' }],
      identifiers: [
        { kind: 'registration_number', value: 'SBX-REG-0001', country: 'GB' },
        { kind: 'swift_bic', value: 'SBXHGB2L' },
      ],
      programs: ['SBX-2'],
      listed_at: '2024-01-15',
    });
  });

  it('returns the generation date and the file id', async () => {
    const publication = await readPublication(
      parseEuFsf(encode(euXml([PERSON, COMPANY])), OPTIONS),
      () => undefined,
    );
    expect(publication).toEqual({
      publishedAt: '2026-10-15T10:10:34.160Z',
      entries: 2,
      fileId: '999001',
    });
  });

  it('accepts an XML 1.1 declaration', async () => {
    const xml = euXml([COMPANY]).replace('version="1.0"', 'version="1.1"');
    expect(await records(parseEuFsf(encode(xml), OPTIONS))).toHaveLength(1);
  });

  it('refuses another namespace and a file without its generation date (format)', async () => {
    for (const xml of [
      euXml([COMPANY], undefined, 'http://example.invalid/export'),
      euXml([COMPANY], { globalFileId: '999001' }),
    ]) {
      expect((await refusal(parseEuFsf(encode(xml), OPTIONS))).code).toBe('format');
    }
  });

  it('refuses an unknown subject type and a logical id given twice (schema)', async () => {
    for (const entities of [
      [
        COMPANY.replace(
          'code="enterprise" classificationCode="E"',
          'code="planet" classificationCode="X"',
        ),
      ],
      [COMPANY, COMPANY],
    ]) {
      expect((await refusal(parseEuFsf(encode(euXml(entities)), OPTIONS))).code).toBe('schema');
    }
  });
});

describe('parseEuFsf, the less common shapes', () => {
  it('falls back to the classification code, prefers the designation date, reads parts and codes', async () => {
    const entity = tag(
      'sanctionEntity',
      { logicalId: '70010', designationDate: '2020-02-02' },
      regulation('SBX', '2021-01-01') +
        '<subjectType code="" classificationCode="P"/>' +
        alias({ firstName: 'Robin', lastName: 'Testerton', gender: 'M' }) +
        identification({
          documentNumber: 'IMO 9999993',
          identificationTypeCode: 'other',
          identificationTypeDescription: 'IMO number',
        }) +
        identification({ identificationTypeCode: 'passport' }) +
        tag('address', { city: '', street: '', zipCode: '', countryIso2Code: '00' }) +
        birth({ city: 'Sandbox City' }),
    );
    const [record] = await records(parseEuFsf(encode(euXml([entity])), OPTIONS));
    expect(record).toMatchObject({
      kind: 'individual',
      names: [
        {
          full: 'Robin Testerton',
          parts: [
            { role: 'given', value: 'Robin' },
            { role: 'family', value: 'Testerton' },
          ],
        },
      ],
      gender: 'male',
      identifiers: [{ kind: 'imo', value: 'IMO 9999993' }],
      addresses: [],
      birth_dates: [],
      birth_places: ['Sandbox City'],
      listed_at: '2020-02-02',
    });
    expect(record).not.toHaveProperty('remarks');
  });
});
