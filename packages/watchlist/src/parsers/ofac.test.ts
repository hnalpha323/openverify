/**
 * C77.2: the OFAC enhanced XML parser over synthetic documents written here in the schema's shape
 * (`ENHANCED_XML.xsd`): fictional persons, companies, a vessel and an aircraft, with a published
 * test key's address (Hardhat's first account) and made-up identifiers.
 */
import { describe, expect, it } from 'vitest';
import { contentHash, riskDataHash, type WatchlistRecord } from '../record/index.js';
import { bytesSource } from '../zip/index.js';
import { writeZip } from '../zip/writer.js';
import { WatchlistParseError } from './errors.js';
import { readPublication, type WatchlistParse } from './list.js';
import {
  OFAC_ENHANCED_NAMESPACE,
  OFAC_SDN_ZIP_MEMBER,
  parseOfacEnhanced,
  parseOfacEnhancedZip,
} from './ofac.js';

interface DatePeriod {
  readonly from: readonly [string, string];
  readonly to: readonly [string, string];
  readonly approximate?: boolean;
  readonly range?: boolean;
}

interface Entity {
  readonly id: number;
  readonly type: string;
  readonly names: readonly {
    readonly primary: boolean;
    readonly lowQuality?: boolean;
    readonly translations: readonly {
      readonly primary: boolean;
      readonly script: string;
      readonly full: string;
      readonly parts: readonly (readonly [string, string])[];
    }[];
  }[];
  /** A listing date on the SDN List, or a date and a list's name. */
  readonly lists?: readonly (string | readonly [date: string, name: string])[];
  readonly programs?: readonly string[];
  readonly features?: readonly {
    readonly type: string;
    readonly value: string;
    readonly refId?: number;
    readonly date?: DatePeriod;
  }[];
  readonly documents?: readonly {
    readonly type: string;
    readonly number: string;
    readonly country?: number;
  }[];
  readonly addresses?: readonly {
    readonly country?: number;
    readonly parts: readonly (readonly [string, string])[];
  }[];
  readonly remarks?: string;
}

const escape = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const period = (date: DatePeriod): string =>
  `<valueDate id="1"><fromDateBegin>${date.from[0]}</fromDateBegin><fromDateEnd>${date.from[1]}</fromDateEnd>` +
  `<toDateBegin>${date.to[0]}</toDateBegin><toDateEnd>${date.to[1]}</toDateEnd>` +
  `<isApproximate>${String(date.approximate ?? false)}</isApproximate>` +
  `<isDateRange>${String(date.range ?? false)}</isDateRange></valueDate>`;

function entityXml(entity: Entity): string {
  const names = entity.names
    .map(
      (name, index) =>
        `<name id="${String(index)}"><isPrimary>${String(name.primary)}</isPrimary>` +
        `<aliasType refId="1400">A.K.A.</aliasType>` +
        `<isLowQuality>${String(name.lowQuality ?? false)}</isLowQuality><translations>` +
        name.translations
          .map(
            (translation, at) =>
              `<translation id="${String(at)}"><isPrimary>${String(translation.primary)}</isPrimary>` +
              `<script refId="215">${translation.script}</script>` +
              `<formattedLastName>${escape(translation.parts[0]?.[1] ?? '')}</formattedLastName>` +
              `<formattedFullName>${escape(translation.full)}</formattedFullName><nameParts>` +
              translation.parts
                .map(
                  ([type, value], part) =>
                    `<namePart id="${String(part)}"><type refId="1">${type}</type><value>${escape(value)}</value></namePart>`,
                )
                .join('') +
              '</nameParts></translation>',
          )
          .join('') +
        '</translations></name>',
    )
    .join('');
  const lists = (entity.lists ?? ['2024-01-15'])
    .map((list, index) => {
      const [date, name] = typeof list === 'string' ? [list, 'SDN List'] : list;
      return `<sanctionsList refId="1550" id="${String(index)}" datePublished="${date}">${escape(name)}</sanctionsList>`;
    })
    .join('');
  const programs = (entity.programs ?? ['SANDBOX-1'])
    .map(
      (program, index) =>
        `<sanctionsProgram refId="9" id="${String(index)}">${program}</sanctionsProgram>`,
    )
    .join('');
  const features = (entity.features ?? [])
    .map(
      (feature, index) =>
        `<feature id="${String(index)}"><type featureTypeId="8">${escape(feature.type)}</type>` +
        `<versionId>1</versionId><value>${escape(feature.value)}</value>` +
        (feature.refId === undefined ? '' : `<valueRefId>${String(feature.refId)}</valueRefId>`) +
        (feature.date === undefined ? '' : period(feature.date)) +
        '<isPrimary>true</isPrimary></feature>',
    )
    .join('');
  const documents = (entity.documents ?? [])
    .map(
      (document, index) =>
        `<identityDocument id="${String(index)}"><type refId="1">${escape(document.type)}</type>` +
        `<name nameId="1" nameTranslationId="1">x</name>` +
        `<documentNumber>${escape(document.number)}</documentNumber><isValid>true</isValid>` +
        (document.country === undefined
          ? ''
          : `<issuingCountry refId="${String(document.country)}">x</issuingCountry>`) +
        '</identityDocument>',
    )
    .join('');
  const addresses = (entity.addresses ?? [])
    .map(
      (address, index) =>
        `<address id="${String(index)}">` +
        (address.country === undefined
          ? ''
          : `<country refId="${String(address.country)}">x</country>`) +
        '<translations><translation id="1"><isPrimary>true</isPrimary><script refId="215">Latin</script><addressParts>' +
        address.parts
          .map(
            ([type, value], part) =>
              `<addressPart id="${String(part)}"><type refId="1">${type}</type><value>${escape(value)}</value></addressPart>`,
          )
          .join('') +
        '</addressParts></translation></translations></address>',
    )
    .join('');
  return (
    `<entity id="${String(entity.id)}"><generalInfo><identityId>${String(entity.id + 1)}</identityId>` +
    `<entityType refId="600">${entity.type}</entityType>` +
    (entity.remarks === undefined ? '' : `<remarks>${escape(entity.remarks)}</remarks>`) +
    `</generalInfo><sanctionsLists>${lists}</sanctionsLists>` +
    `<sanctionsPrograms>${programs}</sanctionsPrograms>` +
    '<sanctionsTypes><sanctionsType refId="1" id="1">Block</sanctionsType></sanctionsTypes>' +
    `<legalAuthorities></legalAuthorities><names>${names}</names>` +
    `<addresses>${addresses}</addresses><features>${features}</features>` +
    `<identityDocuments>${documents}</identityDocuments></entity>`
  );
}

const REFERENCES = [
  { refId: 11, type: 'Country', value: 'United Kingdom', isoCode: 'GB' },
  { refId: 13, type: 'Country', value: 'United Kingdom' },
  { refId: 14, type: 'Country', value: 'Panama', isoCode: 'PA' },
  { refId: 15, type: 'Country', value: 'Utopia' },
  { refId: 1400, type: 'AliasType', value: 'A.K.A.' },
];

function ofacXml(
  entities: readonly Entity[],
  options: { dataAsOf?: string | null; namespace?: string; root?: string } = {},
): string {
  const dataAsOf = options.dataAsOf === undefined ? '2026-10-21T00:00:00-04:00' : options.dataAsOf;
  const references = REFERENCES.map(
    (reference) =>
      `<referenceValue refId="${String(reference.refId)}"><type>${reference.type}</type>` +
      `<value>${reference.value}</value>` +
      (reference.isoCode === undefined ? '' : `<isoCode>${reference.isoCode}</isoCode>`) +
      '</referenceValue>',
  ).join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<${options.root ?? 'sanctionsData'} xmlns="${options.namespace ?? OFAC_ENHANCED_NAMESPACE}">` +
    '<publicationInfo>' +
    (dataAsOf === null ? '' : `<dataAsOf>${dataAsOf}</dataAsOf>`) +
    '<filters></filters></publicationInfo>' +
    `<referenceValues>${references}</referenceValues>` +
    '<featureTypes><featureType featureTypeId="8"><type>Birthdate</type></featureType></featureTypes>' +
    `<entities>${entities.map(entityXml).join('\n')}</entities></${options.root ?? 'sanctionsData'}>`
  );
}

const PERSON: Entity = {
  id: 9001,
  type: 'Individual',
  names: [
    {
      primary: true,
      translations: [
        {
          primary: true,
          script: 'Latin',
          full: 'QUILLFEATHER, Avery',
          parts: [
            ['Last Name', 'QUILLFEATHER'],
            ['First Name', 'Avery'],
          ],
        },
        {
          primary: false,
          script: 'Cyrillic',
          full: 'КВИЛЛФЕЗЕР, Эйвери',
          parts: [
            ['Last Name', 'КВИЛЛФЕЗЕР'],
            ['First Name', 'Эйвери'],
          ],
        },
      ],
    },
    {
      primary: false,
      lowQuality: true,
      translations: [
        {
          primary: true,
          script: 'Latin',
          full: 'Avy Q',
          parts: [
            ['First Name', 'Avy'],
            ['Last Name', 'Q'],
          ],
        },
      ],
    },
  ],
  lists: ['2024-01-15', '2022-06-01'],
  programs: ['SANDBOX-1', 'SANDBOX-2', 'SANDBOX-1'],
  features: [
    {
      type: 'Birthdate',
      value: '12 Apr 1980',
      date: { from: ['1980-04-12', '1980-04-12'], to: ['1980-04-12', '1980-04-12'] },
    },
    {
      type: 'Birthdate',
      value: 'circa 1979',
      date: {
        from: ['1979-01-01', '1979-12-31'],
        to: ['1979-01-01', '1979-12-31'],
        approximate: true,
      },
    },
    { type: 'Nationality Country', value: 'United Kingdom', refId: 11 },
    { type: 'Place of Birth', value: 'Sandbox City,  Sandbox Province' },
    { type: 'Gender', value: 'Female' },
    { type: 'Phone Number', value: '+1 555 0100' },
    { type: 'Digital Currency Address - ETH', value: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    { type: 'Digital Currency Address - USDT', value: 'TSyntheticTronAddress0000000000001' },
  ],
  documents: [{ type: 'Passport', number: 'SBX123456', country: 11 }],
  remarks: 'Synthetic entry for tests.',
};

const COMPANY: Entity = {
  id: 9002,
  type: 'Entity',
  names: [
    {
      primary: true,
      translations: [
        {
          primary: true,
          script: 'Latin',
          full: 'Marrowstone Placeholder Holdings Ltd',
          parts: [['Entity Name', 'Marrowstone Placeholder Holdings Ltd']],
        },
      ],
    },
  ],
  features: [
    { type: 'Website', value: 'www.marrowstone.example' },
    { type: 'SWIFT/BIC', value: 'SBXHGB2L' },
  ],
  documents: [
    { type: 'Registration Number', number: 'SBX-REG-0001', country: 13 },
    { type: 'Legal Entity Number', number: '5299000SANDBOXLEI047' },
    { type: 'Tax ID No.', number: 'SBX-TAX-1', country: 15 },
  ],
  addresses: [
    {
      country: 13,
      parts: [
        ['ADDRESS1', '88 Synthetic Lane'],
        ['CITY', 'Elsewhere Synthetic'],
        ['POSTAL CODE', 'ZZ99 9ZZ'],
      ],
    },
  ],
};

const VESSEL: Entity = {
  id: 9003,
  type: 'Vessel',
  names: [
    {
      primary: true,
      translations: [
        {
          primary: true,
          script: 'Latin',
          full: 'SYNTHETIC STAR',
          parts: [['Vessel Name', 'SYNTHETIC STAR']],
        },
      ],
    },
  ],
  features: [{ type: 'Vessel Flag', value: 'Panama', refId: 14 }],
  documents: [
    { type: 'Vessel Registration Identification', number: 'IMO 9999993' },
    { type: 'MMSI', number: '999999999' },
  ],
};

const AIRCRAFT: Entity = {
  id: 9004,
  type: 'Aircraft',
  names: [
    {
      primary: true,
      translations: [
        {
          primary: true,
          script: 'Latin',
          full: 'PLACEHOLDER AIR ONE',
          parts: [['Aircraft Name', 'PLACEHOLDER AIR ONE']],
        },
      ],
    },
  ],
  features: [
    { type: 'Aircraft Tail Number', value: 'SX-SBX' },
    { type: 'Aircraft Manufacturer’s Serial Number (MSN)', value: '99999' },
  ],
};

const RANGED: Entity = {
  id: 9005,
  type: 'Individual',
  names: [
    {
      primary: true,
      translations: [
        {
          primary: true,
          script: 'Latin',
          full: 'TESTERTON, Robin',
          parts: [
            ['Last Name', 'TESTERTON'],
            ['First Name', 'Robin'],
          ],
        },
      ],
    },
  ],
  features: [
    {
      type: 'Birthdate',
      value: '1958 to 1960',
      date: { from: ['1958-01-01', '1958-12-31'], to: ['1960-01-01', '1960-12-31'], range: true },
    },
    {
      type: 'Birthdate',
      value: 'Sep 1975',
      date: { from: ['1975-09-01', '1975-09-30'], to: ['1975-09-01', '1975-09-30'] },
    },
  ],
};

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

const ALL = [PERSON, COMPANY, VESSEL, AIRCRAFT, RANGED];

describe('parseOfacEnhanced', () => {
  it('maps a person: names by translation, weak aliases, dates, countries, documents, crypto', async () => {
    const [person] = await records(parseOfacEnhanced(encode(ofacXml([PERSON])), OPTIONS));
    expect(person).toEqual({
      entry_id: '9001',
      kind: 'individual',
      names: [
        {
          full: 'QUILLFEATHER, Avery',
          parts: [
            { role: 'family', value: 'QUILLFEATHER' },
            { role: 'given', value: 'Avery' },
          ],
          script: 'latin',
          quality: 'strong',
          primary: true,
        },
        {
          full: 'КВИЛЛФЕЗЕР, Эйвери',
          parts: [
            { role: 'family', value: 'КВИЛЛФЕЗЕР' },
            { role: 'given', value: 'Эйвери' },
          ],
          script: 'cyrillic',
          quality: 'strong',
          primary: false,
        },
        {
          full: 'Avy Q',
          parts: [
            { role: 'given', value: 'Avy' },
            { role: 'family', value: 'Q' },
          ],
          script: 'latin',
          quality: 'weak',
          primary: false,
        },
      ],
      birth_dates: [
        { value: '1980-04-12', precision: 'day' },
        { value: '1979', precision: 'year', range: { from: '1978', to: '1980' } },
      ],
      birth_places: ['Sandbox City, Sandbox Province'],
      countries: [{ code: 'GB', role: 'nationality' }],
      gender: 'female',
      identifiers: [{ kind: 'passport', value: 'SBX123456', country: 'GB' }],
      addresses: [],
      crypto_addresses: [
        { raw: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', ticker: 'ETH' },
        { raw: 'TSyntheticTronAddress0000000000001', ticker: 'USDT' },
      ],
      programs: ['SANDBOX-1', 'SANDBOX-2'],
      listed_at: '2022-06-01',
      positions: [],
      relations: [],
      remarks: 'Synthetic entry for tests.',
    });
  });

  it('maps a company, a vessel and an aircraft by their identifiers, flags and addresses', async () => {
    const [company, vessel, aircraft] = await records(
      parseOfacEnhanced(encode(ofacXml([COMPANY, VESSEL, AIRCRAFT])), OPTIONS),
    );
    expect(company).toMatchObject({
      entry_id: '9002',
      kind: 'entity',
      names: [{ full: 'Marrowstone Placeholder Holdings Ltd', parts: [], primary: true }],
      identifiers: [
        { kind: 'website', value: 'www.marrowstone.example' },
        { kind: 'swift_bic', value: 'SBXHGB2L' },
        { kind: 'registration_number', value: 'SBX-REG-0001', country: 'GB' },
        { kind: 'lei', value: '5299000SANDBOXLEI047' },
        { kind: 'tax_id', value: 'SBX-TAX-1' },
      ],
      addresses: [
        {
          country: 'GB',
          city: 'Elsewhere Synthetic',
          postcode: 'ZZ99 9ZZ',
          lines: ['88 Synthetic Lane'],
        },
      ],
      countries: [{ code: 'GB', role: 'address' }],
      listed_at: '2024-01-15',
    });
    expect(
      company?.identifiers.find((identifier) => identifier.kind === 'tax_id'),
    ).not.toHaveProperty('country');
    expect(vessel).toMatchObject({
      entry_id: '9003',
      kind: 'vessel',
      countries: [{ code: 'PA', role: 'registration' }],
      identifiers: [
        { kind: 'imo', value: '9999993' },
        { kind: 'mmsi', value: '999999999' },
      ],
    });
    expect(aircraft).toMatchObject({
      entry_id: '9004',
      kind: 'aircraft',
      identifiers: [
        { kind: 'aircraft_tail', value: 'SX-SBX' },
        { kind: 'aircraft_serial', value: '99999' },
      ],
    });
  });

  it('reads date ranges and month-precision dates', async () => {
    const [ranged] = await records(parseOfacEnhanced(encode(ofacXml([RANGED])), OPTIONS));
    expect(ranged?.birth_dates).toEqual([
      { value: '1958', precision: 'year', range: { from: '1958', to: '1960' } },
      { value: '1975-09', precision: 'month' },
    ]);
  });

  it('returns the publication time and the entry count once every record is read', async () => {
    const publication = await readPublication(
      parseOfacEnhanced(encode(ofacXml(ALL)), OPTIONS),
      () => undefined,
    );
    expect(publication).toEqual({ publishedAt: '2026-10-21T04:00:00.000Z', entries: 5 });
  });

  it('reads the SDN list inside its single-member ZIP', async () => {
    const xml = new TextEncoder().encode(ofacXml(ALL));
    const archive = writeZip([{ name: OFAC_SDN_ZIP_MEMBER, content: xml }]);
    const zipped = await records(
      parseOfacEnhancedZip(bytesSource(archive), { ...OPTIONS, maxCompressedBytes: 1_000_000 }),
    );
    expect(zipped).toEqual(await records(parseOfacEnhanced([xml], OPTIONS)));
  });

  it('refuses another root or namespace and a publication without its time (format)', async () => {
    for (const xml of [
      ofacXml(ALL, { root: 'sdnList' }),
      ofacXml(ALL, { namespace: 'https://example.invalid/OTHER' }),
      ofacXml(ALL, { dataAsOf: null }),
      ofacXml(ALL, { dataAsOf: 'last Tuesday' }),
      ofacXml([], { dataAsOf: null }),
    ]) {
      expect((await refusal(parseOfacEnhanced(encode(xml), OPTIONS))).code).toBe('format');
    }
  });

  it('refuses an unknown entity type, an entity id given twice and a nameless entity (schema)', async () => {
    const nameless: Entity = {
      ...COMPANY,
      id: 9010,
      names: [
        { primary: true, translations: [{ primary: true, script: 'Latin', full: ' ', parts: [] }] },
      ],
    };
    const overlong: Entity = {
      ...COMPANY,
      id: 9011,
      names: [
        {
          primary: true,
          translations: [
            { primary: true, script: 'Latin', full: `QUILLFEATHER ${'Q'.repeat(300)}`, parts: [] },
          ],
        },
      ],
    };
    for (const entities of [
      [{ ...COMPANY, type: 'Spaceship' }],
      [PERSON, { ...COMPANY, id: PERSON.id }],
      [nameless],
      [PERSON, overlong],
    ]) {
      const error = await refusal(parseOfacEnhanced(encode(ofacXml(entities)), OPTIONS));
      expect(error.code).toBe('schema');
      expect(error.message).not.toContain('QUILLFEATHER');
    }
  });
});

describe('parseOfacEnhanced, dates as two bounds and registration countries', () => {
  const bounded = (from: string, to: string, approximate = false, range = false): DatePeriod => ({
    from: [from, from],
    to: [to, to],
    approximate,
    range,
  });

  it('reads valueDate as a start bound and an end bound, keeping a year or a month whole', async () => {
    const dated: Entity = {
      ...RANGED,
      features: [
        { type: 'Birthdate', value: '1979', date: bounded('1979-01-01', '1979-12-31') },
        { type: 'Birthdate', value: 'Jun 1980', date: bounded('1980-06-01', '1980-06-30') },
        { type: 'Birthdate', value: 'circa 1961', date: bounded('1961-01-01', '1961-12-31', true) },
        {
          type: 'Birthdate',
          value: '1958 to 1960',
          date: bounded('1958-01-01', '1960-12-31', false, true),
        },
      ],
    };
    const [record] = await records(parseOfacEnhanced(encode(ofacXml([dated])), OPTIONS));
    expect(record?.birth_dates).toEqual([
      { value: '1979', precision: 'year' },
      { value: '1980-06', precision: 'month' },
      { value: '1961', precision: 'year', range: { from: '1960', to: '1962' } },
      { value: '1958', precision: 'year', range: { from: '1958', to: '1960' } },
    ]);
  });

  it('reads the nationality of registration as the registration country', async () => {
    const registered: Entity = {
      ...COMPANY,
      features: [{ type: 'Nationality of Registration', value: 'Panama', refId: 14 }],
      addresses: [],
    };
    const [record] = await records(parseOfacEnhanced(encode(ofacXml([registered])), OPTIONS));
    expect(record?.countries).toEqual([{ code: 'PA', role: 'registration' }]);
  });
});

describe('parseOfacEnhanced, the less common shapes', () => {
  it('reads every document kind, unusual features and dates, and skips what holds nothing', async () => {
    const odd: Entity = {
      id: 9020,
      type: 'individual',
      names: [
        {
          primary: true,
          translations: [
            {
              primary: true,
              script: 'Latin',
              full: '',
              parts: [
                ['First Name', 'Robin'],
                ['Nickname', 'Rob'],
                ['Last Name', 'TESTERTON'],
              ],
            },
          ],
        },
      ],
      lists: ['not a date'],
      features: [
        {
          type: 'Birthdate',
          value: 'odd span',
          date: { from: ['1960-03-01', '1960-03-02'], to: ['1962-06-30', '1962-06-30'] },
        },
        { type: 'Birthdate', value: 'no date' },
        { type: 'Birthdate', value: 'bad', date: { from: ['1960-02-30', ''], to: ['', ''] } },
        { type: 'Email Address', value: 'robin@sandbox.example' },
        { type: 'Citizenship Country', value: 'Syrian Arab Republic' },
        { type: 'Residency Country', value: 'Utopia' },
        { type: 'Gender', value: 'Unknown' },
        { type: 'Website', value: ' ' },
        { type: 'Digital Currency Address - ', value: 'nothing' },
      ],
      documents: [
        { type: 'National ID No.', number: 'SBX-NID-1' },
        { type: 'Cedula No.', number: 'SBX-CED-1' },
        { type: 'Vessel Registration Identification', number: 'SBX-VR-1' },
        { type: 'SWIFT/BIC', number: 'SBXHGB2L' },
        { type: 'Aircraft Manufacturer’s Serial Number (MSN)', number: 'SBX-MSN-1' },
        { type: 'Aircraft Tail Number', number: 'SX-SBY' },
        { type: 'Commercial Registry Number', number: 'SBX-CR-1' },
        { type: "Driver's License No.", number: 'SBX-DL-1' },
        { type: 'Passport', number: ' ' },
      ],
      addresses: [{ parts: [] }, { parts: [['STATE/PROVINCE', 'Sandbox Province']] }],
    };
    const [record] = await records(parseOfacEnhanced(encode(ofacXml([odd])), OPTIONS));
    expect(record).toMatchObject({
      kind: 'individual',
      names: [
        {
          full: 'Robin Rob TESTERTON',
          parts: [
            { role: 'given', value: 'Robin' },
            { role: 'family', value: 'TESTERTON' },
          ],
        },
      ],
      birth_dates: [
        { value: '1960', precision: 'year', range: { from: '1960-03-01', to: '1962-06-30' } },
      ],
      countries: [{ code: 'SY', role: 'citizenship' }],
      identifiers: [
        { kind: 'email', value: 'robin@sandbox.example' },
        { kind: 'national_id', value: 'SBX-NID-1' },
        { kind: 'national_id', value: 'SBX-CED-1' },
        { kind: 'other', value: 'SBX-VR-1' },
        { kind: 'swift_bic', value: 'SBXHGB2L' },
        { kind: 'aircraft_serial', value: 'SBX-MSN-1' },
        { kind: 'aircraft_tail', value: 'SX-SBY' },
        { kind: 'registration_number', value: 'SBX-CR-1' },
        { kind: 'other', value: 'SBX-DL-1' },
      ],
      addresses: [{ lines: ['Sandbox Province'] }],
      crypto_addresses: [],
    });
    expect(record).not.toHaveProperty('gender');
    expect(record).not.toHaveProperty('listed_at');
    expect(record).not.toHaveProperty('remarks');
  });
});

/**
 * Owner decision 9 after Workflow 6B: an entry's OFAC lists other than the SDN List, so a
 * sectoral or other non-blocking listing is never read as an SDN-level block. The enhanced XML
 * names an entry's lists and programmes side by side without saying which programme belongs to
 * which list, so a programme is tied to a list only when the entry names one list.
 */
describe('parseOfacEnhanced, list memberships (owner decision 9 after 6B)', () => {
  const SSI = 'Sectoral Sanctions Identifications List';
  const MBS = 'Non-SDN Menu-Based Sanctions List';
  const parsed = async (entity: Entity) => {
    const [record] = await records(parseOfacEnhanced(encode(ofacXml([entity])), OPTIONS));
    if (record === undefined) {
      throw new Error('no record');
    }
    return record;
  };

  it('gives an entry on the SDN List alone no membership, so both its hashes stay', async () => {
    const record = await parsed(PERSON);
    expect(record).not.toHaveProperty('list_memberships');
    const sdn = await parsed({ ...COMPANY, lists: [['2024-01-15', 'SDN List']] });
    expect(sdn).not.toHaveProperty('list_memberships');
  });

  it('ties each programme to the one non-SDN list an entry is on, changing only its risk data', async () => {
    const sdn = await parsed({ ...COMPANY, programs: ['SANDBOX-SSI-1', 'SANDBOX-SSI-2'] });
    const sectoral = await parsed({
      ...COMPANY,
      lists: [['2024-01-15', SSI]],
      programs: ['SANDBOX-SSI-1', 'SANDBOX-SSI-2'],
    });

    expect(sectoral.list_memberships).toEqual([
      { list: SSI, program: 'SANDBOX-SSI-1' },
      { list: SSI, program: 'SANDBOX-SSI-2' },
    ]);
    expect(sectoral.programs).toEqual(['SANDBOX-SSI-1', 'SANDBOX-SSI-2']);
    expect(sectoral.listed_at).toBe('2024-01-15');
    expect(contentHash(sectoral)).toBe(contentHash(sdn));
    expect(riskDataHash(sectoral)).not.toBe(riskDataHash(sdn));
  });

  it('ties no programme when an entry is on several lists, or names none', async () => {
    const several = await parsed({
      ...COMPANY,
      lists: [
        ['2020-02-01', 'SDN List'],
        ['2021-03-01', MBS],
        ['2022-04-01', ` ${SSI}  `],
        ['2022-04-01', SSI],
      ],
      programs: ['SANDBOX-A', 'SANDBOX-B'],
    });
    expect(several.list_memberships).toEqual([
      { list: MBS, program: null },
      { list: SSI, program: null },
    ]);
    expect(several.listed_at).toBe('2020-02-01');

    const bare = await parsed({ ...COMPANY, lists: [['2024-01-15', MBS]], programs: [] });
    expect(bare.list_memberships).toEqual([{ list: MBS, program: null }]);
  });

  it('reads the SDN List in any case and spacing, and skips a list without a name', async () => {
    const record = await parsed({
      ...COMPANY,
      lists: [
        ['2024-01-15', ' sdn  list '],
        ['2024-01-16', ' '],
      ],
    });
    expect(record).not.toHaveProperty('list_memberships');
  });
});
