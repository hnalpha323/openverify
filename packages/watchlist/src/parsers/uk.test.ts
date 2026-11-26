/**
 * C77.2: the UK Sanctions List parser over synthetic documents written here in the 4.33.x
 * schema's shape: a fictional person, company and ship, made-up identifiers, and a published test
 * key's address (Hardhat's first account).
 */
import { describe, expect, it } from 'vitest';
import type { WatchlistRecord } from '../record/index.js';
import { WatchlistParseError } from './errors.js';
import { readPublication, type WatchlistParse } from './list.js';
import { parseUkSanctionsList, UNLABELLED_CRYPTO_TICKER } from './uk.js';

const element = (name: string, inner: string): string => `<${name}>${inner}</${name}>`;
const each = (wrapper: string, name: string, values: readonly string[]): string =>
  element(wrapper, values.map((value) => element(name, value)).join(''));

function designation(id: string, kind: string, inner: string): string {
  return element(
    'Designation',
    element('LastUpdated', '15/10/2026') +
      element('DateDesignated', '15/01/2024') +
      element('UniqueID', id) +
      element('OFSIGroupID', '99001') +
      inner +
      element('RegimeName', 'Sandbox Regime') +
      element('IndividualEntityShip', kind) +
      element('DesignationSource', 'UK') +
      element('SanctionsImposed', 'Asset freeze') +
      element(
        'SanctionsImposedIndicators',
        element('AssetFreeze', 'true') + element('TravelBan', 'false'),
      ),
  );
}

const PERSON = designation(
  'SBX0001',
  'Individual',
  element(
    'Names',
    element(
      'Name',
      element('Name1', 'Avery') +
        element('Name2', 'Sandbox') +
        element('Name6', 'QUILLFEATHER') +
        element('NameType', 'Primary Name'),
    ) +
      element(
        'Name',
        element('Name1', 'Avy') +
          element('Name6', 'Q') +
          element('NameType', 'Alias') +
          element('AliasStrength', 'Low quality a.k.a.'),
      ) +
      element(
        'Name',
        element('Name6', 'QUILLFEATHER-SMITH') +
          element('NameType', 'Primary Name Variation') +
          element('AliasStrength', 'Good quality a.k.a.'),
      ),
  ) +
    element(
      'NonLatinNames',
      element(
        'NonLatinName',
        element('NameNonLatinScript', 'Эйвери Квиллфезер') +
          element('NonLatinScriptType', 'Cyrillic') +
          element('NonLatinScriptLanguage', 'Russian'),
      ),
    ) +
    each('Titles', 'Title', ['Synthetic Official']) +
    element('OtherInformation', 'Synthetic entry for tests.') +
    element('UKStatementofReasons', 'Synthetic statement.') +
    element(
      'Addresses',
      element(
        'Address',
        element('AddressLine1', '1 Synthetic Lane') +
          element('AddressLine2', 'Sandbox City') +
          element('AddressPostalCode', 'ZZ99 9ZZ') +
          element('AddressCountry', 'United Kingdom'),
      ),
    ) +
    each('PhoneNumbers', 'PhoneNumber', ['+44 0000 000000']) +
    each('Websites', 'Website', ['quillfeather.example']) +
    each('CryptoWalletAddresses', 'CryptoWalletAddress', [
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    ]) +
    each('EmailAddresses', 'EmailAddress', ['avery@quillfeather.example']) +
    element(
      'IndividualDetails',
      element(
        'Individual',
        each('DOBs', 'DOB', ['12/04/1980', 'dd/mm/1979', 'dd/mm/yyyy']) +
          element(
            'PassportDetails',
            element(
              'Passport',
              element('PassportNumber', 'SBX123456') +
                element('PassportAdditionalInformation', 'Synthetic'),
            ),
          ) +
          each('Nationalities', 'Nationality', ['United Kingdom', 'Atlantis']) +
          element(
            'NationalIdentifierDetails',
            element('NationalIdentifier', element('NationalIdentifierNumber', 'SBX-NID-1')),
          ) +
          each('Positions', 'Position', ['Synthetic Official']) +
          each('Genders', 'Gender', ['Female']) +
          element(
            'BirthDetails',
            element(
              'Location',
              element('TownOfBirth', 'Sandbox City') + element('CountryOfBirth', 'United Kingdom'),
            ),
          ),
      ),
    ),
);

const COMPANY = designation(
  'SBX0002',
  'Entity',
  element(
    'Names',
    element(
      'Name',
      element('Name6', 'Marrowstone Placeholder Holdings Ltd') +
        element('NameType', 'Primary Name'),
    ),
  ) +
    element(
      'EntityDetails',
      element(
        'Entity',
        each('BusinessRegistrationNumbers', 'BusinessRegistrationNumber', ['SBX-REG-0001']) +
          each('TypeOfEntities', 'TypeOfEntity', ['Company']),
      ),
    ),
);

const SHIP = designation(
  'SBX0003',
  'Ship',
  element(
    'Names',
    element('Name', element('Name6', 'SYNTHETIC STAR') + element('NameType', 'Primary Name')),
  ) +
    element(
      'ShipDetails',
      element(
        'Ship',
        each('IMONumbers', 'IMONumber', ['9999993']) +
          each('CurrentBelievedFlagOfShips', 'CurrentBelievedFlagOfShip', ['Panama']) +
          each('PreviousFlags', 'PreviousFlag', ['Utopia']),
      ),
    ),
);

function ukXml(designations: readonly string[], generated: string | null = '16/10/2026'): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    element(
      'Designations',
      (generated === null ? '' : element('DateGenerated', generated)) + designations.join('\n'),
    )
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

describe('parseUkSanctionsList', () => {
  it('maps a person: Name1 to Name6 with roles, strength, non-Latin names, placeholder DOBs', async () => {
    const [person] = await records(parseUkSanctionsList(encode(ukXml([PERSON])), OPTIONS));
    expect(person).toEqual({
      entry_id: 'SBX0001',
      kind: 'individual',
      names: [
        {
          full: 'Avery Sandbox QUILLFEATHER',
          parts: [
            { role: 'given', value: 'Avery' },
            { role: 'middle', value: 'Sandbox' },
            { role: 'family', value: 'QUILLFEATHER' },
          ],
          script: 'latin',
          quality: 'strong',
          primary: true,
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
        {
          full: 'QUILLFEATHER-SMITH',
          parts: [{ role: 'family', value: 'QUILLFEATHER-SMITH' }],
          script: 'latin',
          quality: 'strong',
          primary: false,
        },
        {
          full: 'Эйвери Квиллфезер',
          parts: [],
          script: 'cyrillic',
          quality: 'strong',
          primary: false,
        },
      ],
      birth_dates: [
        { value: '1980-04-12', precision: 'day' },
        { value: '1979', precision: 'year' },
      ],
      birth_places: ['Sandbox City'],
      countries: [
        { code: 'GB', role: 'nationality' },
        { code: 'GB', role: 'birth' },
        { code: 'GB', role: 'address' },
      ],
      gender: 'female',
      identifiers: [
        { kind: 'passport', value: 'SBX123456' },
        { kind: 'national_id', value: 'SBX-NID-1' },
        { kind: 'website', value: 'quillfeather.example' },
        { kind: 'email', value: 'avery@quillfeather.example' },
      ],
      addresses: [
        { country: 'GB', postcode: 'ZZ99 9ZZ', lines: ['1 Synthetic Lane', 'Sandbox City'] },
      ],
      crypto_addresses: [
        { raw: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', ticker: UNLABELLED_CRYPTO_TICKER },
      ],
      programs: ['Sandbox Regime'],
      listed_at: '2024-01-15',
      positions: [],
      relations: [],
      remarks: 'Synthetic entry for tests.',
    });
  });

  it('maps an entity by its registration number and a ship by its IMO number and flag', async () => {
    const [company, ship] = await records(
      parseUkSanctionsList(encode(ukXml([COMPANY, SHIP])), OPTIONS),
    );
    expect(company).toMatchObject({
      entry_id: 'SBX0002',
      kind: 'entity',
      names: [{ full: 'Marrowstone Placeholder Holdings Ltd', parts: [], primary: true }],
      identifiers: [{ kind: 'registration_number', value: 'SBX-REG-0001' }],
    });
    expect(ship).toMatchObject({
      entry_id: 'SBX0003',
      kind: 'vessel',
      names: [{ full: 'SYNTHETIC STAR', parts: [] }],
      identifiers: [{ kind: 'imo', value: '9999993' }],
      countries: [{ code: 'PA', role: 'registration' }],
    });
  });

  it('returns DateGenerated as the publication time', async () => {
    const publication = await readPublication(
      parseUkSanctionsList(encode(ukXml([PERSON, COMPANY, SHIP])), OPTIONS),
      () => undefined,
    );
    expect(publication).toEqual({ publishedAt: '2026-10-16T00:00:00.000Z', entries: 3 });
  });

  it('refuses another root, and a list without or with an unreadable DateGenerated (format)', async () => {
    for (const xml of [
      ukXml([COMPANY]).replaceAll('Designations>', 'ConsolidatedList>'),
      ukXml([COMPANY], null),
      ukXml([COMPANY], 'dd/mm/yyyy'),
    ]) {
      expect((await refusal(parseUkSanctionsList(encode(xml), OPTIONS))).code).toBe('format');
    }
  });

  it('refuses an unknown kind and a unique id given twice (schema)', async () => {
    for (const designations of [
      [COMPANY.replace('<IndividualEntityShip>Entity<', '<IndividualEntityShip>Planet<')],
      [COMPANY, COMPANY],
    ]) {
      expect((await refusal(parseUkSanctionsList(encode(ukXml(designations)), OPTIONS))).code).toBe(
        'schema',
      );
    }
  });
});

describe('parseUkSanctionsList, the less common shapes', () => {
  it('reads a given name alone, a male gender, a placeholder year, addresses without a country', async () => {
    const person = element(
      'Designation',
      element('UniqueID', 'SBX0010') +
        element(
          'Names',
          element('Name', element('Name1', 'Robin') + element('NameType', 'Primary Name')),
        ) +
        element('RegimeName', 'Sandbox Regime') +
        element('IndividualEntityShip', 'Individual') +
        element(
          'Addresses',
          element('Address', element('AddressLine1', '2 Synthetic Lane')) + element('Address', ''),
        ) +
        element(
          'IndividualDetails',
          element(
            'Individual',
            each('DOBs', 'DOB', ['00/00/1970']) + each('Genders', 'Gender', ['Unknown', 'Male']),
          ),
        ),
    );
    const [record] = await records(parseUkSanctionsList(encode(ukXml([person])), OPTIONS));
    expect(record).toMatchObject({
      kind: 'individual',
      names: [{ full: 'Robin', parts: [{ role: 'given', value: 'Robin' }], quality: 'strong' }],
      gender: 'male',
      birth_dates: [{ value: '1970', precision: 'year' }],
      addresses: [{ lines: ['2 Synthetic Lane'] }],
      countries: [],
    });
    expect(record).not.toHaveProperty('listed_at');
    expect(record).not.toHaveProperty('remarks');
  });
});
