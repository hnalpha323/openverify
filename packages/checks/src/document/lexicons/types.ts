/**
 * The shape of a document lexicon (C60.5): per covered language, the phrases that point to a
 * class (anchor, medium or weak, each naming the classes it supports), the field labels the
 * extractor reads values after, the labels an identity document prints, and the function words
 * that, with the phrases, tell the language. Phrases are OpenVerify's own short lists of common
 * words, written for this classifier; none is copied from a published list.
 */
import type { DocumentClass } from '../inputs.js';

/** The languages the classifier covers (C60.5); any other is `unknown`. */
export const DOCUMENT_LANGUAGES = ['en', 'es', 'fr', 'de'] as const;
export type DocumentLanguage = (typeof DOCUMENT_LANGUAGES)[number];

/** How strongly a phrase points to its classes: weights 3, 2 and 1 (C60.5). */
export type DocumentCueStrength = 'anchor' | 'medium' | 'weak';

/** A phrase that points to one class, or (a weak cue) to several. */
export interface DocumentCue {
  readonly phrase: string;
  readonly strength: DocumentCueStrength;
  readonly classes: readonly DocumentClass[];
}

/** The labels the extractor reads a value after (C60.5). */
export interface DocumentLabels {
  /** The issue date itself: statement date, bill date, invoice date, date of issue. */
  readonly issueDate: readonly string[];
  /** A period whose end is the issue date when no issue-date label is printed. */
  readonly period: readonly string[];
  /** A bare "Date" at the start of a line, read last. */
  readonly genericDate: readonly string[];
  /** A lease's end or a printed expiry. */
  readonly expiry: readonly string[];
  /** A lease's start. */
  readonly leaseStart: readonly string[];
  /** A lease's term: a date range, or a duration after a start date. */
  readonly leaseTerm: readonly string[];
  /** The tax year of a tax document. */
  readonly taxYear: readonly string[];
  /** The holder's name: account holder, customer, employee, tenant. */
  readonly name: readonly string[];
  /** Other dated labels (due date, date of birth, meter reading date) whose value is never taken. */
  readonly otherDate: readonly string[];
}

export interface DocumentLexicon {
  readonly language: DocumentLanguage;
  readonly cues: readonly DocumentCue[];
  readonly labels: DocumentLabels;
  /** Labels an identity document prints (surname, date of birth, nationality, passport). */
  readonly identity: readonly string[];
  /** Short common words that tell the language. */
  readonly functionWords: readonly string[];
  /** Words between the two dates of a range ("to", "until"). */
  readonly rangeWords: readonly string[];
  /** Duration units of a lease term. */
  readonly durationUnits: {
    readonly month: readonly string[];
    readonly year: readonly string[];
  };
  /** Words that join two holders' names ("and"). */
  readonly jointWords: readonly string[];
  /** The headings of a pay stub's two columns. */
  readonly payColumns: {
    readonly earnings: readonly string[];
    readonly deductions: readonly string[];
  };
  /** Words of a signature line. */
  readonly signatureWords: readonly string[];
}
