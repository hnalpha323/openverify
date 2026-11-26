import { DomainError } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { AAMVA_SYNTHETIC_MARKER, AamvaParseError, parseAamva } from './aamva.js';

/** Builds a payload with correct designators: subfiles of `[type, [[id, value], ...]]`. */
function payload(
  subfiles: readonly (readonly [string, readonly (readonly [string, string])[]])[],
  { iin = '636014', version = 10, jurisdiction = 0 } = {},
): string {
  const header = `@\n\x1e\rANSI ${iin}${String(version).padStart(2, '0')}${
    version >= 2 ? String(jurisdiction).padStart(2, '0') : ''
  }${String(subfiles.length).padStart(2, '0')}`;
  const bodies = subfiles.map(
    ([type, elements]) => `${type}${elements.map(([id, value]) => id + value).join('\n')}\r`,
  );
  let offset = header.length + 10 * subfiles.length;
  const designators = subfiles.map(([type], index) => {
    const length = bodies[index]?.length ?? 0;
    const designator = `${type}${String(offset).padStart(4, '0')}${String(length).padStart(4, '0')}`;
    offset += length;
    return designator;
  });
  return header + designators.join('') + bodies.join('');
}

const DL: readonly (readonly [string, string])[] = [
  ['DCA', 'C'],
  ['DCB', 'NONE'],
  ['DCD', 'NONE'],
  ['DBA', '02142031'],
  ['DCS', 'TESTWORTH'],
  ['DAC', 'JORDAN'],
  ['DAD', 'NONE'],
  ['DBD', '02142023'],
  ['DBB', '02141990'],
  ['DBC', '2'],
  ['DAY', 'BRO'],
  ['DAU', '067 IN'],
  ['DAG', '1200 VERIFICATION AVE'],
  ['DAI', 'SACRAMENTO'],
  ['DAJ', 'CA'],
  ['DAK', '958140000  '],
  ['DAQ', 'Y9876543'],
  ['DCF', '20230214SYNTH0001'],
  ['DCG', 'USA'],
  ['DDE', 'N'],
  ['DDF', 'N'],
  ['DDG', 'N'],
  ['DDA', 'F'],
];
const MARKER = ['ZC', [['ZCA', AAMVA_SYNTHETIC_MARKER]]] as const;

const without = (id: string) => DL.filter(([element]) => element !== id);
const replaced = (id: string, value: string) =>
  DL.map(([element, old]) => [element, element === id ? value : old] as const);

describe('parseAamva', () => {
  it('reads the header, the designators, the elements and the C31.5 fields', () => {
    const parsed = parseAamva(payload([['DL', DL], MARKER]));
    expect(parsed.header).toEqual({
      complianceIndicator: '@',
      fileType: 'ANSI ',
      iin: '636014',
      aamvaVersion: 10,
      jurisdictionVersion: 0,
      numberOfEntries: 2,
    });
    expect(parsed.subfiles.map((subfile) => subfile.type)).toEqual(['DL', 'ZC']);
    expect(parsed.documentType).toBe('DL');
    expect(parsed.elements.DAK).toBe('958140000  ');
    expect(parsed.issuer).toMatchObject({ code: 'CA', country: 'US' });
    expect(parsed.realIdCompliance).toBe('F');
    expect(parsed.syntheticMarker).toBe(true);
    expect(parsed.issues).toEqual([]);
    expect(parsed.valid).toBe(true);
    expect(parsed.fields).toEqual({
      'name-first': 'JORDAN',
      'name-last': 'TESTWORTH',
      birthdate: '1990-02-14',
      sex: 'F',
      'identification-number': 'Y9876543',
      'issue-date': '2023-02-14',
      'expiration-date': '2031-02-14',
      'issuing-authority-code': '636014',
      'address-street-1': '1200 VERIFICATION AVE',
      'address-city': 'SACRAMENTO',
      'address-subdivision': 'CA',
      'address-postal-code': '95814',
      'address-country-code': 'US',
      endorsements: 'NONE',
      restrictions: 'NONE',
      'vehicle-class': 'C',
    });
  });

  it('reads a version 01 header, which has no jurisdiction version', () => {
    const parsed = parseAamva(payload([['DL', DL]], { version: 1 }));
    expect(parsed.header).toMatchObject({ aamvaVersion: 1, jurisdictionVersion: null });
    expect(parsed.syntheticMarker).toBe(false);
    expect(parsed.valid).toBe(true);
  });

  it('reads an ID card subfile, which needs no vehicle class, restrictions or endorsements', () => {
    const id = DL.filter(([element]) => !['DCA', 'DCB', 'DCD'].includes(element));
    const parsed = parseAamva(payload([['ID', id], MARKER]));
    expect(parsed.documentType).toBe('ID');
    expect(parsed.valid).toBe(true);
    expect(parsed.fields['vehicle-class']).toBeUndefined();
  });

  it.each([
    ['1', 'M'],
    ['2', 'F'],
    ['9', 'X'],
    ['M', 'M'],
    ['F', 'F'],
  ])('maps sex %j to %j', (value, sex) => {
    expect(parseAamva(payload([['DL', replaced('DBC', value)]])).fields.sex).toBe(sex);
  });

  it('leaves out an unknown sex code, a middle name of NONE and blank values', () => {
    const parsed = parseAamva(
      payload([['DL', [...replaced('DBC', '3').filter(([id]) => id !== 'DAH'), ['DAH', '   ']]]]),
    );
    expect(parsed.fields.sex).toBeUndefined();
    expect(parsed.fields['name-middle']).toBeUndefined();
    expect(parsed.fields['address-street-2']).toBeUndefined();
  });

  it.each([
    ['958140000  ', '95814'],
    ['958141234', '95814-1234'],
    ['95814', '95814'],
    ['A1A1A1     ', 'A1A 1A1'],
  ])('normalizes the postal code %j to %j', (value, expected) => {
    expect(
      parseAamva(payload([['DL', replaced('DAK', value)]])).fields['address-postal-code'],
    ).toBe(expected);
  });

  it('reads Canadian dates as CCYYMMDD', () => {
    const elements = replaced('DCG', 'CAN')
      .map(([id, value]) => [id, id === 'DBB' ? '19900214' : value] as const)
      .map(([id, value]) => [id, id === 'DBA' ? '20310214' : value] as const)
      .map(([id, value]) => [id, id === 'DBD' ? '20230214' : value] as const);
    const parsed = parseAamva(payload([['DL', elements]], { iin: '636012' }));
    expect(parsed.fields).toMatchObject({
      birthdate: '1990-02-14',
      'expiration-date': '2031-02-14',
      'address-country-code': 'CA',
    });
    expect(parsed.issues).toEqual([]);
  });

  it('takes the date order from the IIN country when DCG is missing', () => {
    const elements = without('DCG').map(
      ([id, value]) =>
        [
          id,
          id === 'DBB' ? '19900214' : id === 'DBA' ? '20310214' : id === 'DBD' ? '20230214' : value,
        ] as const,
    );
    const parsed = parseAamva(payload([['DL', elements]], { iin: '636012' }));
    expect(parsed.fields.birthdate).toBe('1990-02-14');
    expect(parsed.fields['address-country-code']).toBeUndefined();
  });

  it('reports a missing mandatory element of the 2020 standard, and the payload still reads', () => {
    const parsed = parseAamva(
      payload([['DL', without('DAQ').filter(([id]) => id !== 'DCF')], MARKER]),
    );
    expect(parsed.issues).toEqual([
      { code: 'aamva_mandatory_element_missing', details: { elements: ['DAQ', 'DCF'] } },
    ]);
    expect(parsed.valid).toBe(false);
    expect(parsed.fields['name-last']).toBe('TESTWORTH');
  });

  it('asks an older version only for the identity core', () => {
    const elements = DL.filter(([id]) => ['DAQ', 'DBB', 'DBA', 'DCS', 'DAC'].includes(id));
    expect(parseAamva(payload([['DL', elements]], { version: 8 })).valid).toBe(true);
    const parsed = parseAamva(
      payload([['DL', elements.filter(([id]) => id !== 'DCS')]], { version: 8 }),
    );
    expect(parsed.issues).toEqual([
      { code: 'aamva_mandatory_element_missing', details: { elements: ['DCS'] } },
    ]);
  });

  it('accepts DAB as the family name of an older version', () => {
    const elements = [
      ...DL.filter(([id]) => ['DAQ', 'DBB', 'DBA', 'DAC'].includes(id)),
      ['DAB', 'TESTWORTH'],
    ] as const;
    const parsed = parseAamva(payload([['DL', elements]], { version: 3 }));
    expect(parsed.valid).toBe(true);
    expect(parsed.fields['name-last']).toBe('TESTWORTH');
  });

  it.each(['DBB', 'DBA', 'DBD'])('reports an impossible %s date', (element) => {
    const parsed = parseAamva(payload([['DL', replaced(element, '02301990')], MARKER]));
    expect(parsed.issues).toContainEqual({ code: 'aamva_date_invalid', details: { element } });
    expect(parsed.valid).toBe(false);
  });

  it('reports an IIN AAMVA does not list, and a version no edition has', () => {
    expect(parseAamva(payload([['DL', DL]], { iin: '636099' })).issues).toEqual([
      { code: 'aamva_iin_unknown', details: { field: 'iin' } },
    ]);
    expect(parseAamva(payload([['DL', DL]], { version: 11 })).issues).toEqual([
      { code: 'aamva_version_unsupported', details: { field: 'aamva_version' } },
    ]);
  });

  it('reports a payload without a DL or ID subfile', () => {
    const parsed = parseAamva(payload([MARKER]));
    expect(parsed.documentType).toBeNull();
    expect(parsed.issues).toEqual([{ code: 'aamva_document_subfile_missing', details: {} }]);
    expect(parsed.fields).toEqual({ 'issuing-authority-code': '636014' });
  });

  it.each([
    ['an empty payload', '', 'compliance_indicator'],
    ['a wrong compliance indicator', `#${payload([['DL', DL]]).slice(1)}`, 'compliance_indicator'],
    ['wrong separators', `@\n\x1c\r${payload([['DL', DL]]).slice(4)}`, 'separators'],
    ['a wrong file type', payload([['DL', DL]]).replace('ANSI ', 'ANSX '), 'file_type'],
    ['a short IIN', payload([['DL', DL]]).replace('636014', '63601A'), 'iin'],
    [
      'a version that is not a number',
      payload([['DL', DL]]).replace('6360141000', '636014A000'),
      'aamva_version',
    ],
    [
      'a jurisdiction version that is not a number',
      payload([['DL', DL]]).replace('6360141000', '636014100A'),
      'jurisdiction_version',
    ],
    [
      'no entries',
      payload([['DL', DL]]).replace('636014100001', '636014100000'),
      'number_of_entries',
    ],
  ])('refuses %s as an AAMVA header', (_label, text, field) => {
    let thrown: unknown;
    try {
      parseAamva(text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AamvaParseError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({ code: 'aamva_header_invalid', details: { field } });
    expect((thrown as Error).message).not.toContain('TESTWORTH');
  });

  it.each([
    ['an offset past the end', (text: string) => `${text.slice(0, 23)}9000${text.slice(27)}`],
    ['a length past the end', (text: string) => `${text.slice(0, 27)}9000${text.slice(31)}`],
    [
      'a subfile that does not start with its type',
      (text: string) => `${text.slice(0, 23)}0045${text.slice(27)}`,
    ],
    ['a designator that is not one', (text: string) => `${text.slice(0, 21)}D!${text.slice(23)}`],
    ['a missing designator', (text: string) => text.slice(0, 25)],
    ['a subfile without its terminator', (text: string) => `${text.slice(0, -1)}\n`],
  ])('refuses %s as a subfile designator', (_label, mutate) => {
    expect(() => parseAamva(mutate(payload([['DL', DL]])))).toThrow(
      expect.objectContaining({
        code: 'aamva_subfile_designator_invalid',
        details: { subfile: expect.any(String) as unknown },
      }) as Error,
    );
  });
});
