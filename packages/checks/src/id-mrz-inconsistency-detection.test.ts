import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { documentFeatures } from './data/feature-table.js';
import { idMrzInconsistencyDetection, type VizFields } from './id-mrz-inconsistency-detection.js';

// ICAO 9303 "Utopia" specimens (fictional holder).
const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];
const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
];

const MATCHING_VIZ: VizFields = {
  documentNumber: 'L898902C3',
  surname: 'Eriksson',
  givenNames: 'Anna Maria',
  birthDate: '1974-08-12',
  expirationDate: '2012-04-15',
  sex: 'F',
  nationality: 'UTO',
  issuingState: 'UTO',
};

function withName(surname: string): string[] {
  const line = `P<UTO${surname}<<ANNA<MARIA`.padEnd(44, '<');
  return [line, TD3[1] ?? ''];
}

describe('idMrzInconsistencyDetection', () => {
  it('passes a consistent specimen MRZ that agrees with the visual zone', () => {
    const result = idMrzInconsistencyDetection({ mrz: TD3, viz: MATCHING_VIZ });
    expect(result).toEqual({
      name: 'id_mrz_inconsistency_detection',
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: {
        format: 'TD3',
        checkDigits: {
          documentNumber: true,
          birthDate: true,
          expirationDate: true,
          optionalData: true,
          composite: true,
        },
        comparedFields: [
          'document_number',
          'surname',
          'given_names',
          'birth_date',
          'expiration_date',
          'sex',
          'nationality',
          'issuing_state',
        ],
        mismatchedFields: [],
        'agreement-fields': 4,
        'corrected-fields': [],
        'unconfirmed-corrections': [],
      },
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('answers input_missing on valid check digits alone: they do not show agreement with the card (C31.4)', () => {
    const result = idMrzInconsistencyDetection({ mrz: TD1.join('\n') });
    expect(result).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
    expect(result.metadata).toMatchObject({
      format: 'TD1',
      comparedFields: [],
      'agreement-fields': 0,
    });
    expect(result.metadata.checkDigits).not.toHaveProperty('optionalData');
  });

  it('needs two of document number, birth date, expiry and surname read by both (C31.4)', () => {
    const one = idMrzInconsistencyDetection({
      mrz: TD3,
      viz: { birthDate: '1974-08-12', sex: 'F' },
    });
    expect(one).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
    expect(one.metadata).toMatchObject({ 'agreement-fields': 1 });
    const two = idMrzInconsistencyDetection({
      mrz: TD3,
      viz: { birthDate: '1974-08-12', surname: 'Eriksson' },
    });
    expect(two).toMatchObject({ status: 'passed', metadata: { 'agreement-fields': 2 } });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['blank', '  \n '],
    ['an empty list', []],
  ])('answers input_missing when the MRZ is %s (C29.6)', (_label, mrz) => {
    expect(idMrzInconsistencyDetection({ mrz })).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('answers feature_absent without an MRZ for an established class that has none (C29.6)', () => {
    const features = documentFeatures(
      { scheme: 'aamva', code: '636014', country: 'US', jurisdiction: 'CA' },
      'drivers_license',
      'production',
    );
    expect(idMrzInconsistencyDetection({ mrz: [], features })).toMatchObject({
      status: 'not_applicable',
      reasons: ['feature_absent'],
    });
    expect(idMrzInconsistencyDetection({ mrz: [], features: null })).toMatchObject({
      reasons: ['input_missing'],
    });
  });

  it('answers not_requested when the MRZ sits on a side the flow did not ask for', () => {
    expect(idMrzInconsistencyDetection({ mrz: [], mrzNotRequested: true })).toMatchObject({
      status: 'not_applicable',
      reasons: ['not_requested'],
    });
  });

  it('answers input_missing when the MRZ cannot be read, leaving that to id_mrz_detection', () => {
    expect(idMrzInconsistencyDetection({ mrz: ['P<UTOERIKSSON', 'L898902C3'] })).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { error: 'mrz_unrecognized_format' },
    });
    expect(
      idMrzInconsistencyDetection({ mrz: [TD3[0]?.toLowerCase() ?? '', TD3[1] ?? ''] }),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { error: 'mrz_invalid_characters' },
    });
  });

  it('answers input_missing for an unsupported layout', () => {
    expect(
      idMrzInconsistencyDetection({
        mrz: ['IDFRAERIKSSON<<<<<<<<<<<<<<<<<<<<<<<', 'D231458907UTO7408122F1204159<<<<<<<6'],
      }),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { error: 'mrz_unsupported_format' },
    });
  });

  describe('OCR corrections (C31.3)', () => {
    const corrected = [TD3[0] ?? '', (TD3[1] ?? '').replace('7408122', '74O8122')];

    it('counts a corrected field when the visual zone agrees, and names it', () => {
      expect(idMrzInconsistencyDetection({ mrz: corrected, viz: MATCHING_VIZ })).toMatchObject({
        status: 'passed',
        metadata: { 'corrected-fields': ['birthdate'], 'unconfirmed-corrections': [] },
      });
    });

    it('answers input_missing when no visual zone confirms the corrected field', () => {
      expect(
        idMrzInconsistencyDetection({ mrz: corrected, viz: { ...MATCHING_VIZ, birthDate: null } }),
      ).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
        metadata: { 'corrected-fields': ['birthdate'], 'unconfirmed-corrections': ['birthdate'] },
      });
    });

    it('fails when the visual zone disagrees with the corrected value', () => {
      expect(
        idMrzInconsistencyDetection({
          mrz: corrected,
          viz: { ...MATCHING_VIZ, birthDate: '1974-08-13' },
        }),
      ).toMatchObject({ status: 'failed', reasons: ['birth_date_mismatch'] });
    });

    it('keeps a failure that needs any other change a failure', () => {
      const twice = [TD3[0] ?? '', (TD3[1] ?? '').replace('7408122', '7O08I22')];
      expect(idMrzInconsistencyDetection({ mrz: twice, viz: MATCHING_VIZ })).toMatchObject({
        status: 'failed',
        metadata: { 'corrected-fields': [] },
      });
    });
  });

  it('fails on each invalid check digit', () => {
    const tampered = [TD3[0] ?? '', (TD3[1] ?? '').replace('7408122', '7408132')];
    const result = idMrzInconsistencyDetection({ mrz: tampered });
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual([
      'birth_date_check_digit_invalid',
      'composite_check_digit_invalid',
    ]);
    expect(result.metadata.checkDigits).toMatchObject({ birthDate: false, composite: false });
  });

  it('fails on field-format violations even when check digits are valid', () => {
    const wrongCode = [`I${TD3[0]?.slice(1) ?? ''}`, TD3[1] ?? ''];
    expect(idMrzInconsistencyDetection({ mrz: wrongCode })).toMatchObject({
      status: 'failed',
      reasons: ['mrz_document_code_invalid'],
    });
  });

  it('fails a made-up issuing state and nationality, even when the visual zone agrees (G005)', () => {
    const madeUp = [
      (TD3[0] ?? '').replace('P<UTO', 'P<ZZZ'),
      (TD3[1] ?? '').replace('C36UTO', 'C36ZZZ'),
    ];
    const result = idMrzInconsistencyDetection({
      mrz: madeUp,
      viz: { ...MATCHING_VIZ, nationality: 'ZZZ', issuingState: 'ZZZ' },
    });
    expect(result).toMatchObject({
      status: 'failed',
      reasons: ['mrz_issuing_state_invalid', 'mrz_nationality_invalid'],
    });
  });

  it('fails an impossible 29 February with valid check digits (G006)', () => {
    // Birth 1999-02-29 does not exist; its check digit (9) and the composite (4) are right.
    const impossible = [TD3[0] ?? '', 'L898902C36UTO9902299F1204159ZE184226B<<<<<14'];
    const result = idMrzInconsistencyDetection({
      mrz: impossible,
      viz: { documentNumber: 'L898902C3', surname: 'Eriksson' },
    });
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual(['mrz_birth_date_invalid']);
    expect(result.metadata.checkDigits).toMatchObject({ birthDate: true, composite: true });
  });

  it.each<[string, VizFields, string]>([
    ['document number', { documentNumber: 'L898902C4' }, 'document_number_mismatch'],
    ['surname', { surname: 'Andersson' }, 'surname_mismatch'],
    ['given names', { givenNames: 'Anna' }, 'given_names_mismatch'],
    ['given names, other ones', { givenNames: 'Greta Maria' }, 'given_names_mismatch'],
    ['birth date', { birthDate: '1974-08-13' }, 'birth_date_mismatch'],
    ['expiration date', { expirationDate: '2013-04-15' }, 'expiration_date_mismatch'],
    ['sex', { sex: 'M' }, 'sex_mismatch'],
    ['nationality', { nationality: 'SWE' }, 'nationality_mismatch'],
    ['issuing state', { issuingState: 'SE' }, 'issuing_state_mismatch'],
    ['unparseable birth date', { birthDate: '12/08/1974' }, 'birth_date_mismatch'],
    ['unknown sex value', { sex: 'unknown' }, 'sex_mismatch'],
    ['invalid country code', { nationality: 'ZZ' }, 'nationality_mismatch'],
  ])('fails when the visual-zone %s disagrees', (_label, viz, reason) => {
    const result = idMrzInconsistencyDetection({ mrz: TD3, viz: { ...MATCHING_VIZ, ...viz } });
    expect(result.status).toBe('failed');
    expect(result.reasons).toEqual([reason]);
    expect(result.metadata.mismatchedFields).toEqual([reason.replace(/_mismatch$/, '')]);
  });

  it('never puts compared values in the result', () => {
    const result = idMrzInconsistencyDetection({
      mrz: TD3,
      viz: { ...MATCHING_VIZ, surname: 'Ericsson', documentNumber: 'X1' },
    });
    const serialized = JSON.stringify(result);
    for (const value of ['ERIKSSON', 'Ericsson', 'L898902C3', 'X1', '740812']) {
      expect(serialized).not.toContain(value);
    }
  });

  it.each<[string, VizFields]>([
    ['letter case and spacing', { surname: '  eriksson ', givenNames: 'ANNA   maria' }],
    ['punctuation in the document number', { documentNumber: 'l898-902 c3' }],
    ['lowercase country codes', { nationality: 'uto', issuingState: 'uto' }],
    ['spelled-out sex', { sex: 'female' }],
    ['ignored blank fields', { surname: '   ', birthDate: null }],
  ])('tolerates %s', (_label, viz) => {
    expect(idMrzInconsistencyDetection({ mrz: TD3, viz: { ...MATCHING_VIZ, ...viz } }).status).toBe(
      'passed',
    );
  });

  it('matches unspecified sex: X in the visual zone, filler in the MRZ', () => {
    const mrz = [TD3[0] ?? '', (TD3[1] ?? '').replace('2F120', '2<120')];
    const result = idMrzInconsistencyDetection({ mrz, viz: { sex: 'X' } });
    expect(result.reasons).not.toContain('sex_mismatch');
  });

  it('matches a German D in the MRZ with DEU or DE in the visual zone', () => {
    const mrz = [(TD3[0] ?? '').replace('P<UTO', 'P<D<<'), (TD3[1] ?? '').replace('UTO', 'D<<')];
    const result = idMrzInconsistencyDetection({
      mrz,
      viz: { ...MATCHING_VIZ, issuingState: 'DEU', nationality: 'DE' },
    });
    expect(result.reasons).toEqual([]);
  });

  describe('ICAO 9303-3 name transliteration', () => {
    it.each([
      ['MUELLER', 'Müller'],
      ['MULLER', 'Müller'],
      ['GROSSE', 'Große'],
      ['OESTERGAARD', 'Østergaard'],
      ['HAAKONSEN', 'Håkonsen'],
      ['HAKONSEN', 'Håkonsen'],
      ['AERO', 'Æro'],
      ['THORSDOTTIR', 'Þórsdóttir'],
      ['GARCIA<MARTINEZ', 'García-Martínez'],
      ['OBRIEN', "O'Brien"],
      ['DURAND<DE<LA<TOUR', 'Durand de la Tour'],
      ['LUKASZEWSKI', 'Łukaszewski'],
      ['YILDIZ', 'Yıldız'],
    ])('accepts MRZ %s for visual zone %s', (mrzSurname, vizSurname) => {
      expect(
        idMrzInconsistencyDetection({
          mrz: withName(mrzSurname),
          viz: { ...MATCHING_VIZ, surname: vizSurname },
        }).status,
      ).toBe('passed');
    });

    it('rejects a different letter even after transliteration', () => {
      expect(
        idMrzInconsistencyDetection({
          mrz: withName('MILLER'),
          viz: { ...MATCHING_VIZ, surname: 'Müller' },
        }).status,
      ).toBe('failed');
    });
  });

  describe('truncated names', () => {
    // 39-character name field filled to the end: the surname lost its last
    // letter and the second given name was cut to an initial.
    const TRUNCATED = [
      'P<UTOVANDERBERGHEHOFFMANNSCHMID<<ALEXANDRA<B',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
    ];

    it('uses a realistic fixture', () => {
      expect(TRUNCATED[0]).toHaveLength(44);
    });

    it('accepts visual-zone names the MRZ shortened when the field is full', () => {
      const result = idMrzInconsistencyDetection({
        mrz: TRUNCATED,
        viz: {
          ...MATCHING_VIZ,
          surname: 'Vanderberghehoffmannschmidt',
          givenNames: 'Alexandra Beatrix',
        },
      });
      expect(result.status).toBe('passed');
    });

    it('still rejects a name that is not a truncation', () => {
      const result = idMrzInconsistencyDetection({
        mrz: TRUNCATED,
        viz: { surname: 'Vanderberghehoffmannschmidt', givenNames: 'Alexis Beatrix' },
      });
      expect(result.reasons).toEqual(['given_names_mismatch']);
    });

    it('rejects a printed surname longer than an MRZ surname that did not fill its field (G007)', () => {
      const result = idMrzInconsistencyDetection({
        mrz: withName('DOE'),
        viz: { ...MATCHING_VIZ, surname: 'Doebert' },
      });
      expect(result.status).toBe('failed');
      expect(result.reasons).toEqual(['surname_mismatch']);
    });

    it('does not accept a prefix when the name field was not full', () => {
      const result = idMrzInconsistencyDetection({
        mrz: TD3,
        viz: { givenNames: 'Anna Maria Louise' },
      });
      expect(result.reasons).toEqual(['given_names_mismatch']);
    });
  });

  it('compares MRZ dates with unknown parts only on the known digits', () => {
    const mrz = [TD3[0] ?? '', (TD3[1] ?? '').replace('7408122', '7408<<2')];
    const result = idMrzInconsistencyDetection({ mrz, viz: { birthDate: '1974-08-30' } });
    expect(result.reasons).not.toContain('birth_date_mismatch');
  });
});
