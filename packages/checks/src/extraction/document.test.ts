import { describe, expect, it } from 'vitest';
import { parseAamva } from '../aamva.js';
import { parseMrz } from '../mrz.js';
import { establishDocument } from './document.js';

const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
];
const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];
const DE_TD1 = ['IDD<<T220001293<<<<<<<<<<<<<<<', TD1[1] ?? '', TD1[2] ?? ''];

const AAMVA =
  '@\n\x1e\rANSI 636014100002DL00410232ZC02730036DLDCAC\nDCBNONE\nDCDNONE\nDBA02142031\nDCSTESTWORTH\nDACJORDAN\nDADNONE\nDBD02142023\nDBB02141990\nDBC2\nDAYBRO\nDAU067 IN\nDAG1200 VERIFICATION AVE\nDAISACRAMENTO\nDAJCA\nDAK958140000  \nDAQY9876543\nDCF20230214SYNTH0001\nDCGUSA\nDDEN\nDDFN\nDDGN\nDDAF\rZCZCAOPENVERIFY SYNTHETIC TEST DATA\r';

const none = { mrz: null, aamva: null, vizTexts: [], aspectRatio: null };

describe('establishDocument (C30.2)', () => {
  it('establishes the class, issuer and layout from an MRZ document code', () => {
    expect(establishDocument({ ...none, mrz: parseMrz(TD1) })).toEqual({
      idClass: 'national_id',
      classSource: 'mrz',
      issuer: { scheme: 'icao', code: 'UTO', country: null, jurisdiction: null },
      layout: 'TD1',
    });
    expect(establishDocument({ ...none, mrz: parseMrz(TD3) })).toMatchObject({
      idClass: 'passport',
      layout: 'TD3',
    });
  });

  it('normalizes the issuer D to DEU, with its country', () => {
    expect(establishDocument({ ...none, mrz: parseMrz(DE_TD1) }).issuer).toEqual({
      scheme: 'icao',
      code: 'DEU',
      country: 'DE',
      jurisdiction: null,
    });
  });

  it.each([
    ['V<', 'visa'],
    ['IR', 'residence_permit'],
    ['AR', 'residence_permit'],
    ['I<', 'national_id'],
    ['ID', 'national_id'],
    ['AC', 'travel_document'],
    ['C<', 'travel_document'],
  ])('maps the document code %j to %s', (code, idClass) => {
    const lines = code.startsWith('V')
      ? [
          'V<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
          'L8988901C4XXX4009078F96121096ZE184226B<<<<<<',
        ]
      : [`${code}${TD1[0]?.slice(2) ?? ''}`, TD1[1] ?? '', TD1[2] ?? ''];
    expect(establishDocument({ ...none, mrz: parseMrz(lines) }).idClass).toBe(idClass);
  });

  it('establishes nothing from an MRZ whose document code is invalid', () => {
    const lines = [`X<${TD1[0]?.slice(2) ?? ''}`, TD1[1] ?? '', TD1[2] ?? ''];
    expect(establishDocument({ ...none, mrz: parseMrz(lines) })).toEqual({
      idClass: null,
      classSource: null,
      issuer: null,
      layout: null,
    });
  });

  it('establishes a driver licence and its issuer from an AAMVA header', () => {
    expect(establishDocument({ ...none, aamva: parseAamva(AAMVA) })).toEqual({
      idClass: 'drivers_license',
      classSource: 'barcode',
      issuer: { scheme: 'aamva', code: '636014', country: 'US', jurisdiction: 'CA' },
      layout: 'ID1',
    });
  });

  it('prefers the MRZ to the barcode', () => {
    expect(
      establishDocument({ ...none, mrz: parseMrz(TD3), aamva: parseAamva(AAMVA) }).classSource,
    ).toBe('mrz');
  });

  it.each([
    [['UTOPIA', 'PASSPORT / PASAPORTE'], 1.42, 'passport', 'TD3'],
    [['DRIVER LICENSE'], 1.586, 'drivers_license', 'ID1'],
    [['FÜHRERSCHEIN'], 1.6, 'drivers_license', 'ID1'],
    [['IDENTITY CARD'], 1.58, 'national_id', 'ID1'],
    [['Carte nationale d’identité'], 1.55, 'national_id', 'ID1'],
    [['RESIDENCE PERMIT'], 1.586, 'residence_permit', 'ID1'],
  ] as const)(
    'establishes %j with aspect %d as %s from keywords and layout',
    (texts, aspectRatio, idClass, layout) => {
      expect(establishDocument({ ...none, vizTexts: texts, aspectRatio })).toEqual({
        idClass,
        classSource: 'viz',
        issuer: null,
        layout,
      });
    },
  );

  it.each([
    [['PASSPORT'], 1.586],
    [['IDENTITY CARD'], 1.42],
    [['IDENTITY CARD'], null],
    [['IDENTITY CARD', 'DRIVER LICENSE'], 1.586],
    [['UTOPIA'], 1.586],
  ] as const)(
    'establishes nothing from %j with aspect %j: keywords need their layout, and one class',
    (texts, aspectRatio) => {
      expect(establishDocument({ ...none, vizTexts: texts, aspectRatio }).idClass).toBeNull();
    },
  );
});
