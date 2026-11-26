import { DomainError } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { MrzParseError, computeMrzCheckDigit, parseMrz } from './mrz.js';

/*
 * Specimen data is the fictional "Utopia" (UTO) holder from ICAO Doc 9303
 * Parts 4-6. Synthetic SPECIMEN vectors were generated with an independent
 * Python implementation of the 7-3-1 check digit, not with this code.
 */
const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
] as const;
const TD2 = [
  'I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<',
  'D231458907UTO7408122F1204159<<<<<<<6',
] as const;
const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
] as const;
/** ICAO Part 5 long document number example: D23145890734, check digit 9. */
const TD1_LONG_NUMBER = [
  'I<UTOD23145890<7349<<<<<<<<<<<',
  '3407127M9507122UTO<<<<<<<<<<<2',
  'STEVENSON<<PETER<JOHN<<<<<<<<<',
] as const;

/** Replaces one character of one line. */
function tamper(lines: readonly string[], line: number, index: number, char: string): string[] {
  return lines.map((text, i) =>
    i === line ? `${text.slice(0, index)}${char}${text.slice(index + 1)}` : text,
  );
}

/** Replaces the characters of one line from `index` on with `text` (MRZ characters only). */
function overwrite(lines: readonly string[], line: number, index: number, text: string): string[] {
  return lines.map((current, i) =>
    i === line ? `${current.slice(0, index)}${text}${current.slice(index + text.length)}` : current,
  );
}

describe('computeMrzCheckDigit', () => {
  it.each([
    ['520727', 3], // ICAO Doc 9303 Part 3 worked example
    ['L898902C3', 6],
    ['D23145890', 7],
    ['740812', 2],
    ['120415', 9],
    ['ZE184226B<<<<<', 1],
    ['D23145890734', 9],
    ['AB', 3], // A=10*7 + B=11*3 = 103
    ['Z', 5], // 35*7 = 245
    ['<<<<', 0],
    ['', 0],
  ])('computes %j -> %i', (input, expected) => {
    expect(computeMrzCheckDigit(input)).toBe(expected);
  });

  it.each(['a', 'A B', 'A-1', 'É', '«'])('rejects the non-MRZ character in %j', (input) => {
    expect(() => computeMrzCheckDigit(input)).toThrow(MrzParseError);
  });
});

describe('parseMrz: ICAO specimens', () => {
  it('parses the TD3 passport specimen', () => {
    expect(parseMrz(TD3)).toEqual({
      format: 'TD3',
      lines: TD3,
      documentCode: 'P',
      issuingState: 'UTO',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      nameTruncated: false,
      documentNumber: 'L898902C3',
      documentNumberOverflow: false,
      nationality: 'UTO',
      birthDate: '740812',
      sex: 'F',
      expirationDate: '120415',
      optionalData1: 'ZE184226B',
      optionalData2: null,
      checkDigits: {
        documentNumber: { value: '6', expected: 6, valid: true },
        birthDate: { value: '2', expected: 2, valid: true },
        expirationDate: { value: '9', expected: 9, valid: true },
        optionalData: { value: '1', expected: 1, valid: true },
        composite: { value: '0', expected: 0, valid: true },
      },
      checkDigitsValid: true,
      formatIssues: [],
      valid: true,
      corrections: [],
    });
  });

  it('parses the TD2 specimen', () => {
    expect(parseMrz(TD2)).toEqual({
      format: 'TD2',
      lines: TD2,
      documentCode: 'I',
      issuingState: 'UTO',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      nameTruncated: false,
      documentNumber: 'D23145890',
      documentNumberOverflow: false,
      nationality: 'UTO',
      birthDate: '740812',
      sex: 'F',
      expirationDate: '120415',
      optionalData1: '',
      optionalData2: null,
      checkDigits: {
        documentNumber: { value: '7', expected: 7, valid: true },
        birthDate: { value: '2', expected: 2, valid: true },
        expirationDate: { value: '9', expected: 9, valid: true },
        optionalData: null,
        composite: { value: '6', expected: 6, valid: true },
      },
      checkDigitsValid: true,
      formatIssues: [],
      valid: true,
      corrections: [],
    });
  });

  it('parses the TD1 specimen', () => {
    expect(parseMrz(TD1)).toEqual({
      format: 'TD1',
      lines: TD1,
      documentCode: 'I',
      issuingState: 'UTO',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      nameTruncated: false,
      documentNumber: 'D23145890',
      documentNumberOverflow: false,
      nationality: 'UTO',
      birthDate: '740812',
      sex: 'F',
      expirationDate: '120415',
      optionalData1: '',
      optionalData2: '',
      checkDigits: {
        documentNumber: { value: '7', expected: 7, valid: true },
        birthDate: { value: '2', expected: 2, valid: true },
        expirationDate: { value: '9', expected: 9, valid: true },
        optionalData: null,
        composite: { value: '6', expected: 6, valid: true },
      },
      checkDigitsValid: true,
      formatIssues: [],
      valid: true,
      corrections: [],
    });
  });

  it('joins a TD1 long document number from the optional data field', () => {
    expect(parseMrz(TD1_LONG_NUMBER)).toMatchObject({
      format: 'TD1',
      documentNumber: 'D23145890734',
      documentNumberOverflow: true,
      optionalData1: '',
      surname: 'STEVENSON',
      givenNames: 'PETER JOHN',
      sex: 'M',
      birthDate: '340712',
      expirationDate: '950712',
      checkDigits: {
        documentNumber: { value: '9', expected: 9, valid: true },
        composite: { value: '2', expected: 2, valid: true },
      },
      valid: true,
    });
  });
});

describe('parseMrz: long document numbers', () => {
  // Remainder "8901": the full number gives 1, the variant that wrongly keeps
  // the position-15 filler gives 7 (ICAO 9303-5 §4.2.4 excludes position 15).
  const STRICT = [
    'I<UTOAB1234567<89011<<<<<<<<<<',
    '8501019M3001019UTO<<<<<<<<<<<0',
    'SPECIMEN<<TEST<<<<<<<<<<<<<<<<',
  ];
  const FILLER_VARIANT = [
    'I<UTOAB1234567<89017<<<<<<<<<<',
    '8501019M3001019UTO<<<<<<<<<<<6',
    'SPECIMEN<<TEST<<<<<<<<<<<<<<<<',
  ];

  it('computes the check digit over the full number, excluding the filler', () => {
    expect(parseMrz(STRICT)).toMatchObject({
      documentNumber: 'AB12345678901',
      documentNumberOverflow: true,
      checkDigits: { documentNumber: { value: '1', expected: 1, valid: true } },
      valid: true,
    });
  });

  it('rejects a check digit computed with the filler included', () => {
    const parsed = parseMrz(FILLER_VARIANT);
    expect(parsed.checkDigits.documentNumber).toEqual({ value: '7', expected: 1, valid: false });
    expect(parsed.checkDigits.composite?.valid).toBe(true);
    expect(parsed.valid).toBe(false);
  });

  it('keeps optional data that follows the long number', () => {
    const lines = [...STRICT];
    lines[0] = 'I<UTOAB1234567<89011<OPT<<<<<<';
    expect(parseMrz(lines)).toMatchObject({
      documentNumber: 'AB12345678901',
      optionalData1: 'OPT',
    });
  });

  it('reads a long number that fills the optional field without a trailing filler', () => {
    const lines = [...STRICT];
    lines[0] = 'I<UTOAB1234567<12345678901234X';
    const parsed = parseMrz(lines);
    expect(parsed.documentNumber).toBe('AB123456712345678901234');
    expect(parsed.checkDigits.documentNumber.value).toBe('X');
    expect(parsed.checkDigits.documentNumber.valid).toBe(false);
  });

  it('parses a TD2 long document number', () => {
    expect(
      parseMrz(['I<UTOSPECIMEN<<TEST<<<<<<<<<<<<<<<<<', 'XY1234567<UTO8501019F3001019894<<<<0']),
    ).toMatchObject({
      format: 'TD2',
      documentNumber: 'XY123456789',
      documentNumberOverflow: true,
      optionalData1: '',
      checkDigits: {
        documentNumber: { value: '4', expected: 4, valid: true },
        composite: { value: '0', valid: true },
      },
      valid: true,
    });
  });

  it('treats a filler check digit with empty optional data as invalid, not as overflow', () => {
    const parsed = parseMrz(tamper(TD1, 0, 14, '<'));
    expect(parsed.documentNumberOverflow).toBe(false);
    expect(parsed.documentNumber).toBe('D23145890');
    expect(parsed.checkDigits.documentNumber).toEqual({ value: '<', expected: 7, valid: false });
  });

  it('never treats a TD3 filler check digit as overflow', () => {
    const parsed = parseMrz(tamper(TD3, 1, 9, '<'));
    expect(parsed.documentNumberOverflow).toBe(false);
    expect(parsed.checkDigits.documentNumber).toEqual({ value: '<', expected: 6, valid: false });
  });
});

describe('parseMrz: tampering', () => {
  it('flags a changed birth date through its own and the composite check digit', () => {
    const parsed = parseMrz(tamper(TD3, 1, 18, '3')); // 740812 -> 740813
    expect(parsed.birthDate).toBe('740813');
    expect(parsed.checkDigits.birthDate.valid).toBe(false);
    expect(parsed.checkDigits.composite?.valid).toBe(false);
    expect(parsed.checkDigits.documentNumber.valid).toBe(true);
    expect(parsed.checkDigitsValid).toBe(false);
    expect(parsed.valid).toBe(false);
  });

  it('flags a changed document number', () => {
    const parsed = parseMrz(tamper(TD1, 0, 6, '3'));
    expect(parsed.checkDigits.documentNumber.valid).toBe(false);
    expect(parsed.checkDigits.composite?.valid).toBe(false);
  });

  it('flags a changed expiration date in a TD2', () => {
    const parsed = parseMrz(tamper(TD2, 1, 22, '3'));
    expect(parsed.checkDigits.expirationDate.valid).toBe(false);
  });

  it('flags a changed composite check digit only', () => {
    const parsed = parseMrz(tamper(TD1, 1, 29, '5'));
    expect(parsed.checkDigits).toMatchObject({
      documentNumber: { valid: true },
      birthDate: { valid: true },
      expirationDate: { valid: true },
      composite: { value: '5', expected: 6, valid: false },
    });
  });

  it('flags a changed TD3 personal number', () => {
    const parsed = parseMrz(tamper(TD3, 1, 30, '9'));
    expect(parsed.checkDigits.optionalData?.valid).toBe(false);
  });

  it('flags a change to the TD1 optional data through the composite check digit', () => {
    const parsed = parseMrz(tamper(TD1, 1, 20, 'Q'));
    expect(parsed.optionalData2).toBe('<<Q');
    expect(parsed.checkDigits.composite?.valid).toBe(false);
  });
});

describe('parseMrz: TD3 personal number check digit', () => {
  const NAME = 'P<UTOSPECIMEN<<TEST<<<<<<<<<<<<<<<<<<<<<<<<<';

  it.each([
    ['a filler', 'X123456785UTO8501019X3001019<<<<<<<<<<<<<<<2'],
    ['a zero', 'X123456785UTO8501019X3001019<<<<<<<<<<<<<<02'],
  ])('accepts %s when the personal number is empty', (_label, line2) => {
    const parsed = parseMrz([NAME, line2]);
    expect(parsed.optionalData1).toBe('');
    expect(parsed.checkDigits.optionalData?.valid).toBe(true);
    expect(parsed.valid).toBe(true);
  });

  it('rejects any other digit when the personal number is empty', () => {
    const parsed = parseMrz([NAME, 'X123456785UTO8501019X3001019<<<<<<<<<<<<<<52']);
    expect(parsed.checkDigits.optionalData).toEqual({ value: '5', expected: 0, valid: false });
  });

  it('reports sex X for both X and filler', () => {
    expect(parseMrz([NAME, 'X123456785UTO8501019X3001019<<<<<<<<<<<<<<<2']).sex).toBe('X');
    const filler = parseMrz(tamper(TD3, 1, 20, '<'));
    expect(filler.sex).toBe('X');
  });
});

describe('parseMrz: field format', () => {
  it.each([
    ['document code of a TD3', tamper(TD3, 0, 0, 'I'), 'document_code_invalid'],
    ['document code of a TD1', tamper(TD1, 0, 0, 'P'), 'document_code_invalid'],
    ['second document code letter V', tamper(TD1, 0, 1, 'V'), 'document_code_invalid'],
    ['document code AI', tamper(tamper(TD1, 0, 0, 'A'), 0, 1, 'I'), 'document_code_invalid'],
    ['document code with a digit', tamper(TD1, 0, 1, '1'), 'document_code_invalid'],
    ['issuing state with digits', tamper(TD3, 0, 3, '1'), 'issuing_state_invalid'],
    // G005: a state must be an ISO alpha-3 or ICAO 9303 Part 3 code (or UTO, the specimen state).
    [
      'issuing state outside ICAO 9303 Part 3',
      overwrite(TD3, 0, 2, 'ZZZ'),
      'issuing_state_invalid',
    ],
    ['two-letter issuing state', overwrite(TD3, 0, 2, 'AB<'), 'issuing_state_invalid'],
    ['nationality outside ICAO 9303 Part 3', overwrite(TD3, 1, 10, 'ZZZ'), 'nationality_invalid'],
    ['two-letter nationality', overwrite(TD1, 1, 15, 'AB<'), 'nationality_invalid'],
    [
      'nationality of fillers only',
      tamper(tamper(tamper(TD1, 1, 15, '<'), 1, 16, '<'), 1, 17, '<'),
      'nationality_invalid',
    ],
    ['birth month 13', tamper(tamper(TD3, 1, 15, '1'), 1, 16, '3'), 'birth_date_invalid'],
    ['birth day 32', tamper(tamper(TD3, 1, 17, '3'), 1, 18, '2'), 'birth_date_invalid'],
    [
      '30 February',
      tamper(tamper(tamper(TD3, 1, 16, '2'), 1, 17, '3'), 1, 18, '0'),
      'birth_date_invalid',
    ],
    // G006: 29 February only in a year that can be a leap year in either century (yy % 4 = 0).
    ['birth date 29 February 99', overwrite(TD3, 1, 13, '990229'), 'birth_date_invalid'],
    ['expiration date 29 February 27', overwrite(TD3, 1, 21, '270229'), 'expiration_date_invalid'],
    [
      'unknown expiration day',
      tamper(tamper(TD3, 1, 25, '<'), 1, 26, '<'),
      'expiration_date_invalid',
    ],
    ['sex Q', tamper(TD2, 1, 20, 'Q'), 'sex_invalid'],
    ['digit in the name', tamper(TD1, 2, 2, '1'), 'name_invalid'],
  ])('reports an invalid %s', (_label, lines, issue) => {
    const parsed = parseMrz(lines);
    expect(parsed.formatIssues).toContain(issue);
    expect(parsed.valid).toBe(false);
  });

  it('nulls an invalid sex', () => {
    expect(parseMrz(tamper(TD2, 1, 20, 'Q')).sex).toBeNull();
  });

  it('accepts 29 February of a year that is a leap year in a century, and of an unknown year (G006)', () => {
    /** The TD3 specimen with this birth date and expiry, its check digits recomputed. */
    const withDates = (birth: string, expiry: string) => {
      const line = overwrite(overwrite(TD3, 1, 13, birth), 1, 21, expiry)[1] ?? '';
      const digits = `${line.slice(0, 19)}${String(computeMrzCheckDigit(line.slice(13, 19)))}${line.slice(20, 27)}${String(computeMrzCheckDigit(line.slice(21, 27)))}${line.slice(28, 43)}`;
      const composite = `${digits.slice(0, 10)}${digits.slice(13, 20)}${digits.slice(21, 43)}`;
      return [TD3[0], `${digits}${String(computeMrzCheckDigit(composite))}`];
    };
    for (const [birth, expiry] of [
      ['960229', '280229'],
      ['000229', '320229'],
    ]) {
      const parsed = parseMrz(withDates(birth ?? '', expiry ?? ''));
      expect(parsed.formatIssues).toEqual([]);
      expect(parsed.valid).toBe(true);
    }
    expect(parseMrz(withDates('<<0229', '280229')).formatIssues).toEqual([]);
  });

  it('accepts an unknown birth day or month written as fillers', () => {
    const parsed = parseMrz(tamper(tamper(TD3, 1, 17, '<'), 1, 18, '<'));
    expect(parsed.birthDate).toBe('7408<<');
    expect(parsed.formatIssues).toEqual([]);

    const unknownMonth = parseMrz(tamper(tamper(TD3, 1, 15, '<'), 1, 16, '<'));
    expect(unknownMonth.birthDate).toBe('74<<12');
    expect(unknownMonth.formatIssues).toEqual([]);
  });

  it('accepts the crew member certificate code AC and the one-letter state code D', () => {
    const parsed = parseMrz(overwrite(TD1, 0, 0, 'ACD<<'));
    expect(parsed.documentCode).toBe('AC');
    expect(parsed.issuingState).toBe('D');
    expect(parsed.formatIssues).toEqual([]);
  });

  it.each(['UTO', 'D<<', 'DEU', 'GBR', 'XXA', 'XXX', 'EUE', 'UNO'])(
    'accepts the state code %s: ISO alpha-3, ICAO 9303 Part 3, or the specimen state (G005)',
    (code) => {
      const parsed = parseMrz(overwrite(overwrite(TD3, 0, 2, code), 1, 10, code));
      expect(parsed.formatIssues).toEqual([]);
      expect(parsed.valid).toBe(true);
    },
  );

  it('marks a name that fills the whole field as possibly truncated', () => {
    const parsed = parseMrz([
      'P<UTOVANDERBERGHEHOFFMANNSCHMIDT<<ALEXANDRAB',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
    ]);
    expect(parsed.surname).toBe('VANDERBERGHEHOFFMANNSCHMIDT');
    expect(parsed.givenNames).toBe('ALEXANDRAB');
    expect(parsed.nameTruncated).toBe(true);
  });

  it('reads a name without a secondary identifier', () => {
    const parsed = parseMrz(['P<UTOMONONYM<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<', TD3[1]]);
    expect(parsed.surname).toBe('MONONYM');
    expect(parsed.givenNames).toBe('');
  });

  it('reads a name with no double filler at all', () => {
    const parsed = parseMrz(['P<UTOABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLM', TD3[1]]);
    expect(parsed.surname).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLM');
    expect(parsed.givenNames).toBe('');
    expect(parsed.nameTruncated).toBe(true);
  });
});

describe('parseMrz: input handling', () => {
  it('accepts one string with LF or CRLF line breaks and surrounding whitespace', () => {
    expect(parseMrz(`${TD3[0]}\n${TD3[1]}\n`).valid).toBe(true);
    expect(parseMrz(`  ${TD1.join('\r\n')}  `).valid).toBe(true);
  });

  it('ignores blank lines', () => {
    expect(parseMrz(['', TD2[0], '   ', TD2[1]]).format).toBe('TD2');
  });

  it.each([
    ['no lines', []],
    ['one line', [TD3[0]]],
    ['four lines', [...TD1, TD1[0]]],
    ['mismatched TD3 lengths', [TD3[0], TD3[1].slice(0, 43)]],
    ['TD1 lines in pairs', [TD1[0], TD1[1]]],
    ['three TD3 lines', [TD3[0], TD3[1], TD3[1]]],
  ])('rejects %s as an unrecognized format', (_label, lines) => {
    expect(() => parseMrz(lines)).toThrow(
      expect.objectContaining({ code: 'mrz_unrecognized_format' }) as Error,
    );
  });

  it.each([
    ['lowercase letters', [TD3[0].toLowerCase(), TD3[1]]],
    ['a space inside a line', [TD3[0].replace('<<ANNA', '< ANNA'), TD3[1]]],
    ['a guillemet OCR artefact', [TD3[0].replace('<', '«'), TD3[1]]],
  ])('rejects %s as invalid characters', (_label, lines) => {
    expect(() => parseMrz(lines)).toThrow(
      expect.objectContaining({ code: 'mrz_invalid_characters' }) as Error,
    );
  });

  it.each([['a pre-2021 French national ID', ['IDFRAERIKSSON<<<<<<<<<<<<<<<<<<<<<<<', TD2[1]]]])(
    'reports %s as an unsupported format',
    (_label, lines) => {
      expect(() => parseMrz(lines)).toThrow(
        expect.objectContaining({ code: 'mrz_unsupported_format' }) as Error,
      );
    },
  );

  it('raises domain errors without echoing MRZ content', () => {
    let thrown: unknown;
    try {
      parseMrz(['P<UTOERIKSSON', TD3[1]]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MrzParseError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as Error).message).not.toContain('ERIKSSON');
  });
});

/** ICAO Doc 9303 Part 7 examples of the specimen state Utopia. */
const MRVA = [
  'V<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L8988901C4XXX4009078F96121096ZE184226B<<<<<<',
] as const;
const MRVB = [
  'V<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<',
  'L8988901C4XXX4009078F9612109<<<<<<<<',
] as const;

describe('parseMrz: machine-readable visas (MRV-A, MRV-B)', () => {
  it('parses the MRV-A example, which has no composite or optional-data check digit', () => {
    expect(parseMrz(MRVA)).toMatchObject({
      format: 'MRVA',
      documentCode: 'V',
      issuingState: 'UTO',
      surname: 'ERIKSSON',
      givenNames: 'ANNA MARIA',
      documentNumber: 'L8988901C',
      documentNumberOverflow: false,
      nationality: 'XXX',
      birthDate: '400907',
      sex: 'F',
      expirationDate: '961210',
      optionalData1: '6ZE184226B',
      optionalData2: null,
      checkDigits: {
        documentNumber: { value: '4', expected: 4, valid: true },
        birthDate: { value: '8', expected: 8, valid: true },
        expirationDate: { value: '9', expected: 9, valid: true },
        optionalData: null,
        composite: null,
      },
      checkDigitsValid: true,
      formatIssues: [],
      valid: true,
    });
  });

  it('parses the MRV-B example', () => {
    expect(parseMrz(MRVB)).toMatchObject({
      format: 'MRVB',
      documentNumber: 'L8988901C',
      optionalData1: '',
      checkDigits: { composite: null, optionalData: null },
      valid: true,
    });
  });

  it('flags a changed visa document number through its check digit', () => {
    const parsed = parseMrz(tamper(MRVA, 1, 3, '9'));
    expect(parsed.checkDigits.documentNumber.valid).toBe(false);
    expect(parsed.valid).toBe(false);
  });

  it('never reads a visa long number from its optional data', () => {
    const parsed = parseMrz(tamper(MRVB, 1, 9, '<'));
    expect(parsed.documentNumberOverflow).toBe(false);
    expect(parsed.checkDigits.documentNumber.valid).toBe(false);
  });

  it('tells a visa from a passport and a TD2 card by its document code', () => {
    expect(parseMrz(TD3).format).toBe('TD3');
    expect(parseMrz(TD2).format).toBe('TD2');
    expect(parseMrz([`P${MRVA[0].slice(1)}`, MRVA[1]]).format).toBe('TD3');
  });
});

describe('parseMrz: OCR corrections (C31.3)', () => {
  const correct = { correct: true } as const;

  it.each([
    ['a letter O in a TD1 birth date', tamper(TD1, 1, 2, 'O'), TD1, [1, 2, 'birth_date', 'O', '0']],
    [
      'a Z for the TD1 birth date check digit',
      tamper(TD1, 1, 6, 'Z'),
      TD1,
      [1, 6, 'birth_date_check_digit', 'Z', '2'],
    ],
    [
      'a digit 0 in the TD3 issuing state',
      tamper(TD3, 0, 4, '0'),
      TD3,
      [0, 4, 'issuing_state', '0', 'O'],
    ],
    ['a digit 0 in the TD1 name', tamper(TD1, 2, 6, '0'), TD1, [2, 6, 'name', '0', 'O']],
    [
      'a digit 0 in the TD1 nationality',
      tamper(TD1, 1, 17, '0'),
      TD1,
      [1, 17, 'nationality', '0', 'O'],
    ],
    [
      'a letter O for the TD3 composite check digit',
      tamper(TD3, 1, 43, 'O'),
      TD3,
      [1, 43, 'composite_check_digit', 'O', '0'],
    ],
    [
      'a letter I in an MRV-A expiration date',
      tamper(MRVA, 1, 25, 'I'),
      MRVA,
      [1, 25, 'expiration_date', 'I', '1'],
    ],
  ] as const)(
    'corrects %s, and names it',
    (_label, read, expected, [line, position, field, from, to]) => {
      const parsed = parseMrz(read, correct);
      expect(parsed.lines).toEqual(expected);
      expect(parsed.corrections).toEqual([{ line, position, field, from, to }]);
      expect(parsed.valid).toBe(true);
    },
  );

  it('corrects nothing unless asked', () => {
    const parsed = parseMrz(tamper(TD1, 1, 2, 'O'));
    expect(parsed.corrections).toEqual([]);
    expect(parsed.valid).toBe(false);
  });

  it('corrects at most one character per field: two impossible characters stay a failure', () => {
    const parsed = parseMrz(tamper(tamper(TD1, 1, 1, 'O'), 1, 4, 'I'), correct);
    expect(parsed.corrections).toEqual([]);
    expect(parsed.valid).toBe(false);
    expect(parsed.formatIssues).toContain('birth_date_invalid');
  });

  it('corrects one character in each of two fields', () => {
    const parsed = parseMrz(tamper(tamper(TD1, 1, 2, 'O'), 1, 13, 'S'), correct);
    expect(parsed.corrections.map((correction) => correction.field)).toEqual([
      'birth_date',
      'expiration_date',
    ]);
  });

  it('never changes a digit to another digit', () => {
    const parsed = parseMrz(tamper(TD1, 1, 5, '3'), correct);
    expect(parsed.corrections).toEqual([]);
    expect(parsed.checkDigits.birthDate.valid).toBe(false);
  });

  it('never corrects a document number, where letters and digits are both allowed', () => {
    const parsed = parseMrz(tamper(TD3, 1, 5, 'O'), correct);
    expect(parsed.corrections).toEqual([]);
    expect(parsed.checkDigits.documentNumber.valid).toBe(false);
  });

  it('leaves a letter it has no digit for, and the sex field, uncorrected', () => {
    expect(parseMrz(tamper(TD1, 1, 2, 'X'), correct).corrections).toEqual([]);
    expect(parseMrz(tamper(TD1, 1, 7, '0'), correct).corrections).toEqual([]);
  });

  it('keeps any other check-digit failure a failure, corrections or not', () => {
    const parsed = parseMrz(tamper(tamper(TD1, 1, 2, 'O'), 1, 14, '8'), correct);
    expect(parsed.corrections).toHaveLength(1);
    expect(parsed.checkDigits.expirationDate.valid).toBe(false);
    expect(parsed.valid).toBe(false);
  });
});
