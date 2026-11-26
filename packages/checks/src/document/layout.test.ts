/**
 * C60.5 layout features: read from the lines' boxes, each pointing to the classes of the table in
 * `layout.ts` with its fixed, provisional weight.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_LAYOUT_FEATURES,
  DOCUMENT_LAYOUT_FEATURE_IDS,
  documentLayoutFeatures,
  hasValidIban,
  isMoneyAmount,
} from './layout.js';
import { DOCUMENT_LEXICONS } from './lexicons/index.js';
import { documentLines } from './lines.js';
import { CLASS_SAMPLES } from './samples.js';
import { photoAnalysis, photoPage, syntheticIban, type LineSpec } from './testing.js';

const linesOf = (specs: readonly LineSpec[]) => documentLines(photoAnalysis(photoPage(specs)));
const lineOf = (text: string) => {
  const [line] = linesOf([text]);
  if (line === undefined) {
    throw new Error('the line was dropped');
  }
  return line;
};
const features = (specs: readonly LineSpec[], language: 'en' | 'de' = 'en') =>
  documentLayoutFeatures(linesOf(specs), DOCUMENT_LEXICONS[language]);

/** `count` lines whose right edges sit at `right`, each ending in an amount. */
const alignedAmounts = (count: number, right: number): LineSpec[] =>
  Array.from({ length: count }, (_, index) => {
    const text = `Charge ${String(index + 1)} ${String(10 + index)}.50`;
    const width = text.length * 22;
    return { text, box: [right - width, 300 + index * 50, width, 40] as const };
  });

describe('DOCUMENT_LAYOUT_FEATURES', () => {
  it('weighs each feature as the table in layout.ts says (ours, provisional)', () => {
    expect(
      DOCUMENT_LAYOUT_FEATURES.map(({ id, weight, classes }) => [id, weight, classes]),
    ).toEqual([
      ['money-column', 1, ['utility_bill', 'bank_statement', 'pay_stub']],
      ['transaction-table', 2, ['bank_statement']],
      ['valid-iban', 1, ['bank_statement', 'utility_bill']],
      ['earnings-deductions', 2, ['pay_stub']],
      ['numbered-boxes', 2, ['tax_document']],
      ['contract-layout', 2, ['lease']],
      ['meter-readings', 2, ['utility_bill']],
    ]);
    expect(DOCUMENT_LAYOUT_FEATURES.map((feature) => feature.id)).toEqual([
      ...DOCUMENT_LAYOUT_FEATURE_IDS,
    ]);
  });
});

describe('isMoneyAmount', () => {
  it.each(['48.20', '1,234.56', '1.234,56', '$48.20', '€1.234,56', '(12.00)', '-12.00', '£0.99'])(
    '%s is an amount',
    (token) => {
      expect(isMoneyAmount(token)).toBe(true);
    },
  );

  it.each(['2026', '48.2', '4471-2208-19', '30.09.2026', '12.345', 'abc', '', '.20', '1.2.34'])(
    '%s is not',
    (token) => {
      expect(isMoneyAmount(token)).toBe(false);
    },
  );
});

describe('hasValidIban', () => {
  const iban = syntheticIban('GB', 'UTOP00000000000001');

  it('finds an IBAN whose check digits hold, grouped or compact', () => {
    expect(hasValidIban(lineOf(`IBAN: ${iban}`))).toBe(true);
    expect(hasValidIban(lineOf(`IBAN ${iban.replaceAll(' ', '')} BIC UTOPGB00`))).toBe(true);
  });

  it('refuses one whose check digits fail', () => {
    const broken = iban.replace(/1$/, '2');
    expect(hasValidIban(lineOf(`IBAN: ${broken}`))).toBe(false);
    expect(hasValidIban(lineOf('Account GB12 ABCD'))).toBe(false);
  });
});

describe('documentLayoutFeatures', () => {
  it('reads a right-aligned column of amounts, not a ragged one', () => {
    expect(features(alignedAmounts(5, 1500))).toContain('money-column');
    const ragged = alignedAmounts(5, 1500).map((spec, index) =>
      typeof spec === 'string'
        ? spec
        : { ...spec, box: [150, 300 + index * 50, 400 + index * 60, 40] as const },
    );
    expect(features(ragged)).not.toContain('money-column');
    expect(features(alignedAmounts(4, 1500))).not.toContain('money-column');
  });

  it('reads a table of dated transactions', () => {
    const rows = [
      '02 Sep Card payment 23.10',
      '05 Sep Transfer received 200.00',
      '09 Sep Direct debit 48.20',
      '14.09.2026 Cash withdrawal 60.00',
      '21/09 Interest 0.42',
    ];
    expect(features(rows)).toContain('transaction-table');
    expect(features(rows.slice(0, 4))).not.toContain('transaction-table');
  });

  it('reads an IBAN whose check digits hold', () => {
    expect(features([`IBAN: ${syntheticIban('DE', '000000000000000001')}`])).toEqual([
      'valid-iban',
    ]);
  });

  it('reads earnings and deductions headings on one row', () => {
    const row: LineSpec[] = [
      { text: 'Earnings', box: [150, 400, 200, 40] },
      { text: 'Deductions', box: [900, 402, 240, 40] },
    ];
    expect(features(row)).toContain('earnings-deductions');
    const apart: LineSpec[] = [
      { text: 'Earnings', box: [150, 400, 200, 40] },
      { text: 'Deductions', box: [900, 900, 240, 40] },
    ];
    expect(features(apart)).not.toContain('earnings-deductions');
    expect(
      features(
        [
          { text: 'Bezüge', box: [150, 400, 200, 40] },
          { text: 'Abzüge', box: [900, 400, 200, 40] },
        ],
        'de',
      ),
    ).toContain('earnings-deductions');
  });

  it('reads numbered form boxes, but not an address, dated rows or numbered clauses', () => {
    expect(features(CLASS_SAMPLES.en.tax_document)).toContain('numbered-boxes');
    expect(
      features([
        '14 Lantern Row',
        '1 Jul Opening balance',
        '2 Jul Card payment',
        '3 Jul Transfer',
        '4 Jul Transfer',
        '1. Parties',
        '2. Premises',
        '3. Rent',
        '4. Deposit',
        '01 Opening',
      ]),
    ).not.toContain('numbered-boxes');
  });

  it('reads a contract: long lines of prose and a signature line', () => {
    const prose = Array.from(
      { length: 8 },
      () => 'The tenant shall keep the premises in good repair and shall not sublet them',
    );
    expect(features([...prose, 'Signature of tenant: ____________'])).toContain('contract-layout');
    expect(features(prose)).not.toContain('contract-layout');
    expect(features([...prose.slice(0, 7), 'Signature: ______'])).not.toContain('contract-layout');
  });

  it('reads meter readings: numbers followed by a supply unit', () => {
    expect(features(['Previous reading 1204 kWh', 'Current reading 1456 kWh'])).toContain(
      'meter-readings',
    );
    expect(features(['Water used: 18.4 m³', 'Average 0.2 m3 a day'])).toContain('meter-readings');
    expect(features(['Previous reading 1204 kWh'])).not.toContain('meter-readings');
  });

  it('lists features in the table order', () => {
    const found = features(CLASS_SAMPLES.en.utility_bill);
    expect(found).toEqual(DOCUMENT_LAYOUT_FEATURE_IDS.filter((id) => found.includes(id)));
    expect(found).toContain('meter-readings');
  });
});
