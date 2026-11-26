/**
 * The C60.5 lexicons: per covered language, cues for every class (anchor, medium, weak), the
 * labels the extractor reads, identity labels and function words; and the language-neutral cues.
 */
import { DOCUMENT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { foldedPhrase } from '../text.js';
import {
  DOCUMENT_LANGUAGES,
  DOCUMENT_LEXICONS,
  NEUTRAL_DOCUMENT_CUES,
  type DocumentCue,
  type DocumentLexicon,
} from './index.js';

const cueOf = (lexicon: { readonly cues: readonly DocumentCue[] }, phrase: string) =>
  lexicon.cues.find((cue) => foldedPhrase(cue.phrase).join(' ') === foldedPhrase(phrase).join(' '));

const LABEL_LISTS = [
  'issueDate',
  'period',
  'genericDate',
  'expiry',
  'leaseStart',
  'leaseTerm',
  'taxYear',
  'name',
  'otherDate',
] as const;

describe.each(DOCUMENT_LANGUAGES)('the %s lexicon', (language) => {
  const lexicon: DocumentLexicon = DOCUMENT_LEXICONS[language];

  it('is the lexicon of its language', () => {
    expect(lexicon.language).toBe(language);
  });

  it.each(DOCUMENT_TYPES)('holds an anchor and at least six cues for %s', (documentClass) => {
    const cues = lexicon.cues.filter((cue) => cue.classes.includes(documentClass));
    expect(cues.length).toBeGreaterThanOrEqual(6);
    expect(cues.some((cue) => cue.strength === 'anchor')).toBe(true);
  });

  it('points anchors and medium cues at one class, weak cues at one or more', () => {
    for (const cue of lexicon.cues) {
      expect(cue.classes.length, cue.phrase).toBeGreaterThanOrEqual(1);
      if (cue.strength !== 'weak') {
        expect(cue.classes, cue.phrase).toHaveLength(1);
      }
    }
  });

  it('folds every phrase to tokens, and lists none twice', () => {
    const folded = lexicon.cues.map((cue) => foldedPhrase(cue.phrase).join(' '));
    expect(folded.every((phrase) => phrase.length > 0)).toBe(true);
    expect(new Set(folded).size).toBe(folded.length);
  });

  it.each(LABEL_LISTS)('lists %s labels', (list) => {
    expect(lexicon.labels[list].length).toBeGreaterThan(0);
    expect(lexicon.labels[list].every((label) => foldedPhrase(label).length > 0)).toBe(true);
  });

  it('lists identity labels, function words and the words ranges, terms and names use', () => {
    expect(lexicon.identity.length).toBeGreaterThanOrEqual(6);
    expect(lexicon.functionWords.length).toBeGreaterThanOrEqual(8);
    expect(lexicon.rangeWords.length).toBeGreaterThan(0);
    expect(lexicon.durationUnits.month.length).toBeGreaterThan(0);
    expect(lexicon.durationUnits.year.length).toBeGreaterThan(0);
    expect(lexicon.jointWords.length).toBeGreaterThan(0);
    expect(lexicon.payColumns.earnings.length).toBeGreaterThan(0);
    expect(lexicon.payColumns.deductions.length).toBeGreaterThan(0);
    expect(lexicon.signatureWords.length).toBeGreaterThan(0);
  });
});

describe('the research anchors (docs/research/phase5-libraries.md §1.5)', () => {
  it.each([
    ['en', 'Statement of account', 'bank_statement'],
    ['en', 'Lease agreement', 'lease'],
    ['en', 'Payslip', 'pay_stub'],
    ['en', 'Pay stub', 'pay_stub'],
    ['en', 'Form W-2', 'tax_document'],
    ['en', 'P60', 'tax_document'],
    ['en', 'Meter reading', 'utility_bill'],
    ['de', 'Kontoauszug', 'bank_statement'],
    ['de', 'Mietvertrag', 'lease'],
    ['de', 'Gehaltsabrechnung', 'pay_stub'],
    ['de', 'Entgeltabrechnung', 'pay_stub'],
    ['de', 'Lohnsteuerbescheinigung', 'tax_document'],
    ['de', 'Steuerbescheid', 'tax_document'],
    ['de', 'Zählerstand', 'utility_bill'],
    ['fr', 'Relevé de compte', 'bank_statement'],
    ['fr', 'Contrat de location', 'lease'],
    ['fr', 'Bulletin de paie', 'pay_stub'],
    ['fr', "Avis d'imposition", 'tax_document'],
    ['es', 'Extracto de cuenta', 'bank_statement'],
    ['es', 'Contrato de arrendamiento', 'lease'],
    ['es', 'Nómina', 'pay_stub'],
    ['es', 'Modelo 100', 'tax_document'],
  ] as const)('%s: %s is an anchor for %s', (language, phrase, documentClass) => {
    const cue = cueOf(DOCUMENT_LEXICONS[language], phrase);
    expect(cue?.strength).toBe('anchor');
    expect(cue?.classes).toEqual([documentClass]);
  });

  it.each([
    ['en', 'Amount due', 'utility_bill'],
    ['en', 'Net pay', 'pay_stub'],
    ['en', 'Landlord', 'lease'],
    ['de', 'Vermieter', 'lease'],
    ['fr', 'Salaire net', 'pay_stub'],
    ['es', 'Fianza', 'lease'],
  ] as const)('%s: %s is a medium cue for %s', (language, phrase, documentClass) => {
    const cue = cueOf(DOCUMENT_LEXICONS[language], phrase);
    expect(cue?.strength).toBe('medium');
    expect(cue?.classes).toEqual([documentClass]);
  });

  it('shares the weak "account number" cue between bills and statements', () => {
    expect(cueOf(DOCUMENT_LEXICONS.en, 'Account number')).toEqual(
      expect.objectContaining({ strength: 'weak', classes: ['utility_bill', 'bank_statement'] }),
    );
  });
});

describe('NEUTRAL_DOCUMENT_CUES', () => {
  it.each([
    ['kWh', 'anchor', ['utility_bill']],
    ['m³', 'anchor', ['utility_bill']],
    ['therms', 'anchor', ['utility_bill']],
    ['IBAN', 'weak', ['bank_statement', 'utility_bill']],
  ] as const)('holds %s (%s)', (phrase, strength, classes) => {
    expect(cueOf({ cues: NEUTRAL_DOCUMENT_CUES }, phrase)).toEqual(
      expect.objectContaining({ strength, classes }),
    );
  });

  it('holds no cue a covered language also lists', () => {
    const neutral = new Set(NEUTRAL_DOCUMENT_CUES.map((cue) => foldedPhrase(cue.phrase).join(' ')));
    for (const language of DOCUMENT_LANGUAGES) {
      for (const cue of DOCUMENT_LEXICONS[language].cues) {
        expect(neutral.has(foldedPhrase(cue.phrase).join(' ')), cue.phrase).toBe(false);
      }
    }
  });
});
