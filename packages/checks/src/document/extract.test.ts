/**
 * C60.5: extraction from the visible lines: the labelled issue date (two different ones are a
 * conflict), a lease's term and end, a tax document's year, the issuer, and the addressee block's
 * name and address; a text-layer value that OCR contradicts takes the OCR value or is left out.
 */
import { describe, expect, it } from 'vitest';
import type { DocumentClassification } from './inputs.js';
import { extractDocumentFields, type DocumentExtractionOptions } from './extract.js';
import type { DocumentLanguage } from './lexicons/types.js';
import { documentLines } from './lines.js';
import { CLASS_SAMPLES } from './samples.js';
import {
  cpuMilliseconds,
  pdfAnalysis,
  pdfPage,
  photoAnalysis,
  photoPage,
  utilityBillLines,
  type LineSpec,
} from './testing.js';

const options = (
  classification: DocumentClassification,
  language: DocumentLanguage | null = 'en',
  countryHint: string | null = 'US',
): DocumentExtractionOptions => ({ classification, language, countryHint });

const extractPhoto = (specs: readonly LineSpec[], extraction: DocumentExtractionOptions) =>
  extractDocumentFields(documentLines(photoAnalysis(photoPage(specs))), extraction);

const extractPdf = (
  specs: readonly LineSpec[],
  extraction: DocumentExtractionOptions,
  ocr: Readonly<Record<number, string | null>> = {},
) => extractDocumentFields(documentLines(pdfAnalysis([pdfPage(specs, { ocr })])), extraction);

describe('extractDocumentFields: a utility bill', () => {
  const read = () => extractPhoto(utilityBillLines(), options('utility_bill'));

  it('reads the labelled issue date', () => {
    const bill = read();
    expect(bill.issueDate).toEqual({ readings: ['2026-09-30'] });
    expect(bill.issueDateSource).toBe('label');
    expect(bill.issueDateConflict).toBe(false);
  });

  it('reads the issuer, the addressee and the address', () => {
    const bill = read();
    expect(bill.issuer).toBe('UTOPIA WATER BOARD');
    expect(bill.name).toBe('QUINN VALEMONT');
    expect(bill.addressLines).toEqual(['14 LANTERN ROW', 'MERIDALE UT 00000']);
    expect(bill.address).toEqual({
      street1: '14 LANTERN ROW',
      street2: null,
      city: 'MERIDALE',
      subdivision: 'UT',
      postalCode: '00000',
      countryCode: 'US',
    });
  });

  it('reads no expiry, tax year or lease start, and raises no flag', () => {
    const bill = read();
    expect(bill.expiry).toBeNull();
    expect(bill.taxYear).toBeNull();
    expect(bill.leaseStart).toBeNull();
    expect(bill.flags).toEqual([]);
    expect(bill.textLayerMismatch).toBe(false);
  });

  it('finds the address without a reference country, trying the language countries', () => {
    expect(extractPhoto(utilityBillLines(), options('utility_bill', 'en', null)).address).toEqual(
      expect.objectContaining({ postalCode: '00000', countryCode: 'US' }),
    );
  });
});

describe('extractDocumentFields: the issue date', () => {
  it('answers a conflict for two different labelled issue dates', () => {
    const result = extractPhoto(
      [...utilityBillLines(), 'Invoice date: 2 October 2026'],
      options('utility_bill'),
    );
    expect(result.issueDate).toBeNull();
    expect(result.issueDateConflict).toBe(true);
    expect(result.flags).toContain('issue-date-conflict');
  });

  it('takes a date printed twice once', () => {
    const result = extractPhoto(
      [...utilityBillLines(), 'Statement date: 30 Sep 2026'],
      options('utility_bill'),
    );
    expect(result.issueDate).toEqual({ readings: ['2026-09-30'] });
    expect(result.issueDateConflict).toBe(false);
  });

  it('falls back to the end of a labelled period, then to a bare Date at a line start', () => {
    const period = extractPhoto(
      ['UTOPIA GAS', 'Billing period: 01 Jul 2026 - 30 Sep 2026', 'Due date: 21 Oct 2026'],
      options('utility_bill'),
    );
    expect(period.issueDate).toEqual({ readings: ['2026-09-30'] });
    expect(period.issueDateSource).toBe('period');
    const generic = extractPhoto(
      ['UTOPIA GAS', 'Date: 5 October 2026', 'Due date: 21 Oct 2026'],
      options('utility_bill'),
    );
    expect(generic.issueDate).toEqual({ readings: ['2026-10-05'] });
    expect(generic.issueDateSource).toBe('generic');
  });

  it('never takes a due date, a date of birth or a reading date', () => {
    const result = extractPhoto(
      ['Due date: 21 Oct 2026', 'Date of birth: 12 Apr 1987', 'Meter read date: 28 Sep 2026'],
      options('utility_bill'),
    );
    expect(result.issueDate).toBeNull();
    expect(result.issueDateSource).toBeNull();
  });

  it('reads a value on the line below the label, or on the same row to its right', () => {
    const below = extractPhoto(['Statement date', '30 September 2026'], options('utility_bill'));
    expect(below.issueDate).toEqual({ readings: ['2026-09-30'] });
    const right = extractPhoto(
      [
        { text: 'Statement date:', box: [150, 300, 330, 40] },
        { text: '30 Sep 2026', box: [900, 302, 240, 40] },
      ],
      options('utility_bill'),
    );
    expect(right.issueDate).toEqual({ readings: ['2026-09-30'] });
    const far = extractPhoto(
      [
        { text: 'Statement date', box: [150, 300, 300, 40] },
        { text: '30 September 2026', box: [150, 600, 380, 40] },
      ],
      options('utility_bill'),
    );
    expect(far.issueDate).toBeNull();
  });

  it('keeps both readings of an ambiguous numeric date when the convention allows both', () => {
    const ambiguous = ['UTOPIA GAS', 'Statement date: 03/04/2026'];
    expect(extractPhoto(ambiguous, options('utility_bill', 'en', null)).issueDate).toEqual({
      readings: ['2026-04-03', '2026-03-04'],
    });
    expect(extractPhoto(ambiguous, options('utility_bill', 'en', 'US')).issueDate).toEqual({
      readings: ['2026-03-04'],
    });
    expect(extractPhoto(ambiguous, options('utility_bill', 'en', 'GB')).issueDate).toEqual({
      readings: ['2026-04-03'],
    });
  });

  it('reads the issue date of each covered language', () => {
    expect(
      extractPhoto(CLASS_SAMPLES.es.utility_bill, options('utility_bill', 'es', 'ES')).issueDate,
    ).toEqual({ readings: ['2026-09-30'] });
    expect(
      extractPhoto(CLASS_SAMPLES.fr.utility_bill, options('utility_bill', 'fr', 'FR')).issueDate,
    ).toEqual({ readings: ['2026-09-30'] });
    expect(
      extractPhoto(CLASS_SAMPLES.de.utility_bill, options('utility_bill', 'de', 'DE')).issueDate,
    ).toEqual({ readings: ['2026-09-30'] });
    expect(
      extractPhoto(CLASS_SAMPLES.de.bank_statement, options('bank_statement', 'de', 'DE'))
        .issueDate,
    ).toEqual({ readings: ['2026-09-30'] });
  });
});

describe('extractDocumentFields: whether an issue date was printed', () => {
  it('says so for a single, a conflicting, an ambiguous or an OCR-contradicted issue date', () => {
    expect(extractPhoto(utilityBillLines(), options('utility_bill')).issueDateFound).toBe(true);
    expect(
      extractPhoto([...utilityBillLines(), 'Invoice date: 2 October 2026'], options('utility_bill'))
        .issueDateFound,
    ).toBe(true);
    expect(
      extractPhoto(
        ['UTOPIA GAS', 'Statement date: 03/04/2026'],
        options('utility_bill', 'en', null),
      ).issueDateFound,
    ).toBe(true);
    expect(
      extractPdf(utilityBillLines(), options('utility_bill'), { 1: 'Statement date: ~~ ~~~~' })
        .issueDateFound,
    ).toBe(true);
  });

  it('says so for a lease start or a tax year taken as the issue date', () => {
    expect(
      extractPhoto(
        ['TENANCY AGREEMENT', 'Term: 12 months commencing 1 March 2026'],
        options('lease'),
      ).issueDateFound,
    ).toBe(true);
    expect(
      extractPhoto(CLASS_SAMPLES.en.tax_document, options('tax_document')).issueDateFound,
    ).toBe(true);
  });

  it('says not without any', () => {
    expect(
      extractPhoto(['UTOPIA GAS', 'Due date: 21 Oct 2026'], options('utility_bill')).issueDateFound,
    ).toBe(false);
    expect(
      extractPhoto(['UTOPIA GAS', 'Statement date: soon'], options('utility_bill')).issueDateFound,
    ).toBe(false);
  });
});

describe('extractDocumentFields: invisible text and the OCR cross-check', () => {
  it('never reads a hidden date: an old bill with an invisible recent date stays old', () => {
    const result = extractPdf(
      [
        'UTOPIA WATER BOARD',
        'Statement date: 30 September 2024',
        { text: 'Statement date: 30 September 2026', hidden: 'render_mode_invisible' },
      ],
      options('utility_bill'),
    );
    expect(result.issueDate).toEqual({ readings: ['2024-09-30'] });
    expect(result.issueDateConflict).toBe(false);
  });

  it('takes the OCR value when the text layer disagrees with what the page shows', () => {
    const result = extractPdf(utilityBillLines(), options('utility_bill'), {
      1: 'Statement date: 30 September 2024',
    });
    expect(result.issueDate).toEqual({ readings: ['2024-09-30'] });
    expect(result.flags).toContain('ocr-override');
    expect(result.textLayerMismatch).toBe(true);
  });

  it('leaves the field out when OCR reads no value over it', () => {
    const result = extractPdf(utilityBillLines(), options('utility_bill'), {
      1: 'Statement date: ~~ ~~~~',
    });
    expect(result.issueDate).toBeNull();
    expect(result.flags).toContain('ocr-disagreement');
    expect(result.textLayerMismatch).toBe(true);
  });

  it('keeps the text layer when OCR agrees, or read nothing there', () => {
    const agrees = extractPdf(utilityBillLines(), options('utility_bill'));
    expect(agrees.issueDate).toEqual({ readings: ['2026-09-30'] });
    expect(agrees.textLayerMismatch).toBe(false);
    const unread = extractPdf(utilityBillLines(), options('utility_bill'), { 1: null });
    expect(unread.issueDate).toEqual({ readings: ['2026-09-30'] });
    expect(unread.textLayerMismatch).toBe(false);
  });

  it('takes the OCR name when the text layer names someone else', () => {
    const result = extractPdf(utilityBillLines(), options('utility_bill'), {
      3: 'ADA VELLACOTT',
    });
    expect(result.name).toBe('ADA VELLACOTT');
    expect(result.textLayerMismatch).toBe(true);
  });
});

describe('extractDocumentFields: leases', () => {
  it('reads the term, its start and end, and the date it was made', () => {
    const lease = extractPhoto(CLASS_SAMPLES.en.lease, options('lease'));
    expect(lease.issueDate).toEqual({ readings: ['2026-03-01'] });
    expect(lease.leaseStart).toEqual({ readings: ['2026-03-01'] });
    expect(lease.expiry).toEqual({ readings: ['2027-02-28'] });
    expect(lease.name).toBe('Quinn Valemont');
  });

  it('reads a term given as a duration after its start', () => {
    const lease = extractPhoto(
      ['TENANCY AGREEMENT', 'Term: 12 months commencing 1 March 2026'],
      options('lease'),
    );
    expect(lease.leaseStart).toEqual({ readings: ['2026-03-01'] });
    expect(lease.expiry).toEqual({ readings: ['2027-02-28'] });
    expect(lease.issueDate).toEqual({ readings: ['2026-03-01'] });
    expect(lease.issueDateSource).toBe('lease-start');
    const spanish = extractPhoto(CLASS_SAMPLES.es.lease, options('lease', 'es', 'ES'));
    expect(spanish.expiry).toEqual({ readings: ['2027-02-28'] });
    const french = extractPhoto(CLASS_SAMPLES.fr.lease, options('lease', 'fr', 'FR'));
    expect(french.expiry).toEqual({ readings: ['2029-02-28'] });
  });

  it('reads a labelled end date, and none for a periodic tenancy', () => {
    const ended = extractPhoto(
      ['LEASE AGREEMENT', 'Start date: 1 March 2024', 'End date: 28 February 2025'],
      options('lease'),
    );
    expect(ended.expiry).toEqual({ readings: ['2025-02-28'] });
    const periodic = extractPhoto(CLASS_SAMPLES.de.lease, options('lease', 'de', 'DE'));
    expect(periodic.leaseStart).toEqual({ readings: ['2026-03-01'] });
    expect(periodic.expiry).toBeNull();
  });

  it('answers a conflict for two different end dates', () => {
    const result = extractPhoto(
      ['LEASE AGREEMENT', 'Term: 1 March 2026 to 28 February 2027', 'End date: 31 March 2027'],
      options('lease'),
    );
    expect(result.expiry).toBeNull();
    expect(result.expiryConflict).toBe(true);
  });
});

describe('extractDocumentFields: leases written as clauses (integration-5b)', () => {
  it('reads a term that begins on one date and ends on another, in each covered language', () => {
    const english = extractPhoto(
      [
        { text: 'RESIDENTIAL TENANCY AGREEMENT', height: 70 },
        '1. Term. The lease begins on 1 March 2026 and ends on 28 February 2027.',
      ],
      options('lease'),
    );
    expect(english.leaseStart).toEqual({ readings: ['2026-03-01'] });
    expect(english.expiry).toEqual({ readings: ['2027-02-28'] });
    const spanish = extractPhoto(
      [
        { text: 'CONTRATO DE ARRENDAMIENTO DE VIVIENDA', height: 70 },
        'PRIMERA. Duración. El contrato comienza el 1 de marzo de 2026 y termina el 28 de febrero de 2027.',
      ],
      options('lease', 'es', 'ES'),
    );
    expect(spanish.leaseStart).toEqual({ readings: ['2026-03-01'] });
    expect(spanish.expiry).toEqual({ readings: ['2027-02-28'] });
    const french = extractPhoto(
      [
        { text: 'CONTRAT DE LOCATION', height: 70 },
        'Article 2. Le bail commence le 01/03/2026 et prend fin le 28/02/2029.',
      ],
      options('lease', 'fr', 'FR'),
    );
    expect(french.leaseStart).toEqual({ readings: ['2026-03-01'] });
    expect(french.expiry).toEqual({ readings: ['2029-02-28'] });
  });

  it('reads the premises printed after the labelled tenant, not the landlord’s address above', () => {
    const lease = extractPhoto(
      [
        { text: 'RESIDENTIAL TENANCY AGREEMENT', height: 70 },
        'Date of agreement: 3 March 2026',
        'Landlord: Harbour Homes LLC, 9 Quay Street, Meridale, UT 00000',
        'Tenant: QUINN VALEMONT',
        'Premises: 14 LANTERN ROW, MERIDALE, UT 00000',
        '2. Rent. The tenant pays 950.00 each month.',
      ],
      options('lease'),
    );
    expect(lease.name).toBe('QUINN VALEMONT');
    expect(lease.address).toEqual({
      street1: '14 LANTERN ROW',
      street2: null,
      city: 'MERIDALE',
      subdivision: 'UT',
      postalCode: '00000',
      countryCode: 'US',
    });
    const spanish = extractPhoto(
      [
        { text: 'CONTRATO DE ARRENDAMIENTO DE VIVIENDA', height: 70 },
        'Fecha de firma: 3 de marzo de 2026',
        'Arrendador: Inmobiliaria Meridale, S.L., Calle del Muelle 9, 00000 Meridale',
        'Arrendatario: QUINN VALEMONT',
        'Vivienda: CALLE DEL FAROL 14, 2B, 00000 MERIDALE',
      ],
      options('lease', 'es', 'ES'),
    );
    expect(spanish.name).toBe('QUINN VALEMONT');
    expect(spanish.address).toEqual(
      expect.objectContaining({
        street1: 'CALLE DEL FAROL 14',
        street2: '2B',
        city: 'MERIDALE',
        postalCode: '00000',
      }),
    );
  });
});

describe('extractDocumentFields: tax documents', () => {
  it.each([
    ['en', CLASS_SAMPLES.en.tax_document, 'US'],
    ['es', CLASS_SAMPLES.es.tax_document, 'ES'],
    ['fr', CLASS_SAMPLES.fr.tax_document, 'FR'],
    ['de', CLASS_SAMPLES.de.tax_document, 'DE'],
  ] as const)(
    'reads the %s tax year and takes the end of it as the issue date',
    (language, specs, country) => {
      const result = extractPhoto(specs, options('tax_document', language, country));
      expect(result.taxYear).toBe(2025);
      expect(result.issueDate).toEqual({ readings: ['2025-12-31'] });
      expect(result.issueDateSource).toBe('tax-year');
    },
  );

  it('prefers a labelled issue date to the tax year', () => {
    const result = extractPhoto(
      ['P60 End of Year Certificate', 'Tax year to 5 April 2026', 'Date issued: 20 May 2026'],
      options('tax_document', 'en', 'GB'),
    );
    expect(result.issueDate).toEqual({ readings: ['2026-05-20'] });
    expect(result.issueDateSource).toBe('label');
  });
});

describe('extractDocumentFields: names and issuers', () => {
  it('reads a labelled holder when there is no addressee block', () => {
    const result = extractPhoto(
      CLASS_SAMPLES.es.bank_statement,
      options('bank_statement', 'es', 'ES'),
    );
    expect(result.name).toBe('Quinn Valemont');
    const german = extractPhoto(
      CLASS_SAMPLES.de.bank_statement,
      options('bank_statement', 'de', 'DE'),
    );
    expect(german.name).toBe('Quinn Valemont');
  });

  it('never takes a label followed by something other than a name', () => {
    const result = extractPhoto(
      ['UTOPIA GAS', 'Customer number: 00004471', 'Customer service team'],
      options('utility_bill'),
    );
    expect(result.name).toBeNull();
  });

  it('reads the addressee block of each covered language', () => {
    const spanish = extractPhoto(
      CLASS_SAMPLES.es.utility_bill,
      options('utility_bill', 'es', 'ES'),
    );
    expect(spanish.name).toBe('QUINN VALEMONT');
    expect(spanish.address).toEqual(
      expect.objectContaining({
        street1: 'CALLE DEL FAROL 14',
        postalCode: '00000',
        city: 'MERIDALE',
      }),
    );
    const german = extractPhoto(CLASS_SAMPLES.de.utility_bill, options('utility_bill', 'de', 'DE'));
    expect(german.address).toEqual(
      expect.objectContaining({
        street1: 'LATERNENWEG 14',
        postalCode: '00000',
        countryCode: 'DE',
      }),
    );
  });

  it('keeps a US town with its state when a comma stands between them', () => {
    const bill = extractPhoto(
      [
        { text: 'UTOPIA WATER BOARD', height: 70 },
        'Statement date: 30 September 2026',
        { text: 'QUINN VALEMONT', y: 520 },
        '14 LANTERN ROW',
        'MERIDALE, UT 00000',
      ],
      options('utility_bill'),
    );
    expect(bill.address).toEqual({
      street1: '14 LANTERN ROW',
      street2: null,
      city: 'MERIDALE',
      subdivision: 'UT',
      postalCode: '00000',
      countryCode: 'US',
    });
    const oneLine = extractPhoto(
      [
        { text: 'UTOPIA WATER BOARD', height: 70 },
        'Service address: 14 Lantern Row, Meridale, UT 00000',
      ],
      options('utility_bill'),
    );
    expect(oneLine.address).toEqual(
      expect.objectContaining({ street1: '14 Lantern Row', city: 'Meridale', subdivision: 'UT' }),
    );
  });

  it('ends the addressee block at a field line above its name (Label: value)', () => {
    const w2 = extractPhoto(
      [
        { text: 'UTOPIA LANTERN WORKS LLC', height: 70 },
        '200 Foundry Lane, Meridale, UT 00000',
        'Form W-2 Wage and Tax Statement',
        'Tax year 2025',
        'Date issued: 30 January 2026',
        'Employer identification number: 00-0000000',
        'QUINN VALEMONT',
        '14 LANTERN ROW',
        'MERIDALE UT 00000',
      ],
      options('tax_document'),
    );
    expect(w2.name).toBe('QUINN VALEMONT');
    expect(w2.address).toEqual(
      expect.objectContaining({ street1: '14 LANTERN ROW', city: 'MERIDALE', subdivision: 'UT' }),
    );
    expect(w2.issuer).toBe('UTOPIA LANTERN WORKS LLC');
    const spanish = extractPhoto(
      [
        { text: 'FAROLES DE UTOPÍA, S.L.', height: 70 },
        'Ejercicio 2025',
        'Fecha de expedición: 30 de enero de 2026',
        'Pagador: Faroles de Utopía, S.L. (NIF B00000000)',
        'QUINN VALEMONT',
        'CALLE DEL FAROL 14',
        '00000 MERIDALE',
      ],
      options('tax_document', 'es', 'ES'),
    );
    expect(spanish.name).toBe('QUINN VALEMONT');
    expect(spanish.address).toEqual(
      expect.objectContaining({ street1: 'CALLE DEL FAROL 14', city: 'MERIDALE' }),
    );
  });

  it('reads the issuer from a web or email domain when no heading stands out', () => {
    const result = extractPhoto(
      ['Statement date: 30 September 2026', 'Questions? Visit www.utopiawater.example today'],
      options('utility_bill'),
    );
    expect(result.issuer).toBe('utopiawater.example');
    const email = extractPhoto(
      ['Statement date: 30 September 2026', 'Write to billing@utopiagas.example.'],
      options('utility_bill'),
    );
    expect(email.issuer).toBe('utopiagas.example');
  });

  it('reads nothing from no lines', () => {
    const result = extractDocumentFields([], options('unknown', null, null));
    expect(result).toEqual(
      expect.objectContaining({ issueDate: null, name: null, address: null, issuer: null }),
    );
  });

  it('extracts a page of 600 lines that each hold a postal code within two seconds (C58.7)', () => {
    const lines = documentLines(
      photoAnalysis(
        photoPage(
          Array.from({ length: 600 }, (_, index) => ({
            text: `${String(index)} LANTERN ROW MERIDALE UT 00000`,
            box: [150, index * 3, 900, 2] as const,
          })),
        ),
      ),
    );
    expect(
      cpuMilliseconds(() => extractDocumentFields(lines, options('utility_bill', 'en', null))),
    ).toBeLessThan(2000);
  });

  it('extracts four full pages within two seconds (C58.7)', () => {
    const line = 'Statement date: 30 September 2026 Amount due: 48.20 Customer: Quinn Valemont ';
    const pages = [1, 2, 3, 4].map((number) =>
      photoPage(
        Array.from({ length: 600 }, (_, index) => ({
          text: line.repeat(4).slice(0, 300),
          box: [150, index * 3, 1400, 2] as const,
        })),
        { number },
      ),
    );
    const lines = documentLines({
      ...photoAnalysis(pages[0] ?? photoPage([])),
      pages,
      page_count: 4,
      analysed_pages: [1, 2, 3, 4],
    });
    expect(
      cpuMilliseconds(() => extractDocumentFields(lines, options('utility_bill'))),
    ).toBeLessThan(2000);
  });
});
