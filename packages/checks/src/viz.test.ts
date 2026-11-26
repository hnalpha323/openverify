import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseViz, parseVizDate, type VizLine } from './viz.js';

const NOW = new Date('2026-10-21T12:00:00Z');

function line(
  text: string,
  x: number,
  y: number,
  width = 160,
  height = 20,
  confidence = 0.95,
): VizLine {
  return { text, confidence, box: [x, y, width, height] };
}

/** The visual-zone lines of the golden vision fixture (C32.1), front and back. */
function fixtureLines(side: 'front' | 'back'): VizLine[] {
  const file = path.resolve(
    import.meta.dirname,
    '../../../contracts/fixtures/vision/analyze-government-id.json',
  );
  const analysis = JSON.parse(readFileSync(file, 'utf8')) as {
    sides: Record<string, { text: VizLine[] }>;
  };
  return analysis.sides[side]?.text ?? [];
}

const values = (lines: readonly VizLine[], options = {}) =>
  Object.fromEntries(
    Object.entries(parseViz(lines, { now: NOW, ...options }).fields).map(([field, reading]) => [
      field,
      reading.value,
    ]),
  );

describe('parseVizDate', () => {
  it.each([
    ['14 02 1990', 'DMY', '1990-02-14'],
    ['14.02.1990', 'DMY', '1990-02-14'],
    ['14/02/1990', 'DMY', '1990-02-14'],
    ['14-02-1990', 'DMY', '1990-02-14'],
    ['02/14/1990', 'MDY', '1990-02-14'],
    ['14/02/1990', 'MDY', '1990-02-14'],
    ['1990-02-14', 'DMY', '1990-02-14'],
    ['14021990', 'DMY', '1990-02-14'],
    ['02141990', 'MDY', '1990-02-14'],
    ['14 FEB 1990', 'DMY', '1990-02-14'],
    ['14 FEB/FÉV 1990', 'DMY', '1990-02-14'],
    ['14 FEBRUARY 1990', 'DMY', '1990-02-14'],
    ['FEB 14 1990', 'MDY', '1990-02-14'],
    ['14 ENE 1990', 'DMY', '1990-01-14'],
    ['14 DIC 1990', 'DMY', '1990-12-14'],
    ['14 AOÛT 1990', 'DMY', '1990-08-14'],
    ['14 OKT 1990', 'DMY', '1990-10-14'],
    ['14 MÄRZ 1990', 'DMY', '1990-03-14'],
    ['I4 O2 199O', 'DMY', '1990-02-14'],
    ['3O.O6.2O32', 'DMY', '2032-06-30'],
  ] as const)('reads %j (%s) as %s', (text, order, expected) => {
    expect(parseVizDate(text, order)).toBe(expected);
  });

  it.each([
    '30 02 1990',
    '14 13 1990',
    '1990',
    'VALEMONT',
    '14 02 90',
    '',
    '14 XYZ 1990',
    '00 01 2000',
  ])('does not read %j as a date', (text) => {
    expect(parseVizDate(text, 'DMY')).toBeNull();
  });

  // Workflow 5C review P006: a day past 31 is no calendar date, and must read as `null`, never
  // throw, because the document checks call this on arbitrary printed or OCR text.
  it.each([
    ['45 SEP 2026', 'DMY'],
    ['SEP 45 2026', 'MDY'],
    ['41/10/2026', 'DMY'],
    ['10/41/2026', 'MDY'],
    ['2 40 2000', 'DMY'],
    ['2026-10-41', 'DMY'],
    ['99999999', 'DMY'],
    ['4099 2026', 'DMY'],
  ] as const)('reads %j (%s), a day past 31, as no date', (text, order) => {
    expect(parseVizDate(text, order)).toBeNull();
  });
});

describe('parseViz: labels (C31.1)', () => {
  it('reads the golden fixture card: values below their labels', () => {
    const parsed = parseViz(fixtureLines('front'), { now: NOW });
    expect(
      Object.fromEntries(Object.entries(parsed.fields).map(([field, value]) => [field, value])),
    ).toEqual({
      'name-last': { value: 'VALEMONT', lineIndex: 3, via: 'label' },
      'name-first': { value: 'QUINN', lineIndex: 5, via: 'label' },
      birthdate: { value: '1990-02-14', lineIndex: 7, via: 'label' },
      'identification-number': { value: 'X12K45P78', lineIndex: 9, via: 'label' },
      'expiration-date': { value: '2034-02-28', lineIndex: 11, via: 'label' },
    });
    expect(parsed.labelLines).toEqual([2, 4, 6, 8, 10]);
  });

  it('reads the golden fixture back: the address below its label', () => {
    expect(values(fixtureLines('back'))).toEqual({
      'address-street-1': '12 LANTERN ROW',
      'address-city': 'NORTH HAVEN',
    });
  });

  it('reads values to the right of their labels', () => {
    expect(
      values(
        [
          line('LN', 20, 100, 40),
          line('CASTELLAN', 80, 100),
          line('FN', 20, 140, 40),
          line('ROBIN ALEX', 80, 140),
          line('DOB', 20, 180, 40),
          line('03/15/1988', 80, 180),
          line('DL NO', 20, 220, 60),
          line('A1234567', 100, 220),
        ],
        { dateOrder: 'MDY' },
      ),
    ).toEqual({
      'name-last': 'CASTELLAN',
      'name-first': 'ROBIN ALEX',
      birthdate: '1988-03-15',
      'identification-number': 'A1234567',
    });
  });

  it('reads a value on the label line, after a colon or the label words', () => {
    expect(
      values([
        line('Surname: Castellan', 20, 100, 300),
        line('Given names ROBIN', 20, 140, 300),
        line('Sex: F', 20, 180, 100),
        line('Nationality UTO', 20, 220, 200),
        line('Date of issue 01.02.2020', 20, 260, 300),
      ]),
    ).toEqual({
      'name-last': 'CASTELLAN',
      'name-first': 'ROBIN',
      sex: 'F',
      nationality: 'UTO',
      'issue-date': '2020-02-01',
    });
  });

  it.each([
    ['English', ['SURNAME', 'GIVEN NAMES', 'DATE OF BIRTH', 'DOCUMENT NO.', 'DATE OF EXPIRY']],
    ['Spanish', ['APELLIDOS', 'NOMBRE', 'FECHA DE NACIMIENTO', 'NÚM. DOCUMENTO', 'VÁLIDO HASTA']],
    ['French', ['NOM', 'PRÉNOMS', 'DATE DE NAISSANCE', 'N° DU DOCUMENT', "DATE D'EXPIRATION"]],
    ['German', ['NAME/NACHNAME', 'VORNAMEN', 'GEBURTSDATUM', 'AUSWEISNUMMER', 'GÜLTIG BIS']],
    [
      'bilingual',
      [
        'SURNAME / APELLIDOS',
        'GIVEN NAMES / NOMBRES',
        '3. DATE OF BIRTH / FECHA DE NACIMIENTO',
        'DOCUMENT NO / NO DOCUMENTO',
        'EXPIRY / CADUCIDAD',
      ],
    ],
  ])('reads %s labels', (_language, labels) => {
    const [surname = '', given = '', birth = '', number = '', expiry = ''] = labels;
    expect(
      values([
        line(surname, 20, 100),
        line('CASTELLAN', 20, 122),
        line(given, 20, 160),
        line('ROBIN', 20, 182),
        line(birth, 20, 220, 300),
        line('15 03 1988', 20, 242),
        line(number, 20, 280, 220),
        line('UT0123456', 20, 302),
        line(expiry, 400, 280),
        line('15.03.2034', 400, 302),
      ]),
    ).toEqual({
      'name-last': 'CASTELLAN',
      'name-first': 'ROBIN',
      birthdate: '1988-03-15',
      'identification-number': 'UT0123456',
      'expiration-date': '2034-03-15',
    });
  });

  it('reads a US style address below its label, with city, state and ZIP on one line', () => {
    expect(
      values([
        line('ADDRESS', 20, 100),
        line('400 EXAMPLE BLVD', 20, 122, 300),
        line('APT 4', 20, 146),
        line('AUSTIN, TX 78701', 20, 170, 300),
      ]),
    ).toEqual({
      'address-street-1': '400 EXAMPLE BLVD',
      'address-street-2': 'APT 4',
      'address-city': 'AUSTIN',
      'address-subdivision': 'TX',
      'address-postal-code': '78701',
    });
  });

  it('reads a European style postal code before the city', () => {
    expect(
      values([
        line('ADRESSE', 20, 100),
        line('12 RUE EXEMPLE', 20, 122),
        line('75001 PARIS', 20, 146),
      ]),
    ).toEqual({
      'address-street-1': '12 RUE EXEMPLE',
      'address-postal-code': '75001',
      'address-city': 'PARIS',
    });
  });

  it('skips a candidate that does not fit the field and takes the next', () => {
    expect(
      values([
        line('DATE OF BIRTH', 20, 100),
        line('UTOPIA', 300, 100),
        line('15 03 1988', 20, 122),
      ]),
    ).toEqual({ birthdate: '1988-03-15' });
  });

  it('never uses a label, an MRZ line or a line twice as a value', () => {
    expect(
      values([
        line('SURNAME', 20, 100),
        line('GIVEN NAMES', 20, 122),
        line('I<UTOX12K45P787<<<<<<<<<<<<<<<', 20, 160, 500),
      ]),
    ).toEqual({});
  });

  it('keeps a name with a hyphen or an apostrophe, and refuses one with digits', () => {
    expect(values([line('SURNAME', 20, 100), line("O'NEILL-SMITH", 20, 122)])).toEqual({
      'name-last': "O'NEILL-SMITH",
    });
    expect(values([line('SURNAME', 20, 100), line('CASTE11AN', 20, 122)])).toEqual({});
  });

  it.each([
    ['M', 'M'],
    ['FEMALE', 'F'],
    ['X', 'X'],
    ['MASCULINO', 'M'],
    ['FÉMININ', 'F'],
    ['WEIBLICH', 'F'],
  ])('reads the sex %j as %j', (text, sex) => {
    expect(values([line('SEX', 20, 100), line(text, 20, 122)])).toEqual({ sex });
  });

  it('reads the nationality code D as DEU, and ignores a nationality written out', () => {
    expect(values([line('NATIONALITY', 20, 100), line('D', 20, 122)])).toEqual({
      nationality: 'DEU',
    });
    expect(values([line('NATIONALITY', 20, 100), line('UTOPIAN', 20, 122)])).toEqual({});
  });

  it('reads a personal number', () => {
    expect(values([line('PERSONAL NO.', 20, 100), line('12345678Z', 20, 122)])).toEqual({
      'personal-number': '12345678Z',
    });
  });
});

describe('parseViz: what real OCR output needs (calibration findings)', () => {
  it('never takes a value from below another label in the same column', () => {
    expect(
      values([
        line('DATE OF BIRTH', 20, 100),
        line('DATE OF EXPIRY', 20, 130),
        line('05 05 2034', 20, 152),
      ]),
    ).toEqual({ 'expiration-date': '2034-05-05' });
  });

  it('reads a date whose day and month OCR ran together', () => {
    expect(parseVizDate('2103 1988', 'DMY')).toBe('1988-03-21');
    expect(parseVizDate('0321 1988', 'MDY')).toBe('1988-03-21');
    expect(parseVizDate('3221 1988', 'DMY')).toBeNull();
  });

  it('prefers the visa number to the passport number a visa also prints', () => {
    expect(
      values([
        line('PASSPORT NUMBER', 20, 100),
        line('P1234567', 20, 122),
        line('VISA NO.', 20, 200),
        line('V7654321', 20, 222),
      ]),
    ).toEqual({ 'identification-number': 'V7654321' });
  });

  it('reads the issuer code printed alone in the header', () => {
    const header = [
      line('UTOPIA', 20, 20),
      line('IDENTITY CARD', 300, 25),
      line('UTO', 800, 20, 70, 30),
    ];
    expect(
      values([
        ...header,
        line('SURNAME', 300, 130),
        line('CALDERWOOD', 300, 152),
        line('X', 300, 500),
      ]),
    ).toEqual({ 'name-last': 'CALDERWOOD', 'issuing-authority-code': 'UTO' });
    expect(
      values([...header, line('FRA', 900, 20, 70, 30), line('X', 300, 500)])[
        'issuing-authority-code'
      ],
    ).toBeUndefined();
    expect(
      values([line('UTOPIA', 20, 20), line('X', 300, 500), line('UTO', 800, 400, 70, 30)]),
    ).toEqual({});
  });

  it('ends an address block at the next label or date', () => {
    expect(
      values([
        line('ADDRESS', 20, 100),
        line('12 LANTERN ROW', 20, 122, 300, 40),
        line('DATE OF ISSUE', 20, 165),
        line('06 05 2024', 20, 190, 160, 40),
      ]),
    ).toEqual({ 'address-street-1': '12 LANTERN ROW', 'issue-date': '2024-05-06' });
  });
});

describe('parseViz: patterns when no label is read (C31.1)', () => {
  it('reads one future date as the expiry, an old one as the birth date, a recent one as the issue date', () => {
    expect(
      values([
        line('UTOPIA', 20, 20),
        line('15 03 1988', 20, 100),
        line('01 02 2024', 20, 140),
        line('01 02 2034', 20, 180),
      ]),
    ).toEqual({
      birthdate: '1988-03-15',
      'issue-date': '2024-02-01',
      'expiration-date': '2034-02-01',
    });
  });

  it('assigns no date when two future dates make the expiry ambiguous', () => {
    expect(values([line('01 02 2034', 20, 100), line('01 02 2035', 20, 140)])).toEqual({});
  });

  it('reads the one number-shaped token as the document number', () => {
    const parsed = parseViz([line('UTOPIA', 20, 20), line('X12K45P78', 20, 100)], { now: NOW });
    expect(parsed.fields['identification-number']).toEqual({
      value: 'X12K45P78',
      lineIndex: 1,
      via: 'pattern',
    });
  });

  it('reads no document number when two tokens could be one', () => {
    expect(values([line('X12K45P78', 20, 100), line('Y98Z76W54', 20, 140)])).toEqual({});
  });

  it('prefers a labelled value to a pattern', () => {
    expect(
      values([
        line('DATE OF EXPIRY', 20, 100),
        line('01 02 2034', 20, 122),
        line('01 02 2035', 20, 300),
      ]),
    ).toEqual({ 'expiration-date': '2034-02-01' });
  });

  it('reads nothing from no lines', () => {
    expect(parseViz([])).toEqual({ fields: {}, labelLines: [] });
  });
});
