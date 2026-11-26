/**
 * Extraction from a document's visible lines (C60.5). Values are read after their labels (on the
 * label's line, the next line to its right on the same row, or the line below within 1.5 line
 * heights), never from invisible text:
 * - **issue date:** an issue-date label (statement, bill or invoice date, date of issue, a
 *   lease's "dated"); else the end of a labelled period (billing or statement period, period
 *   ending); else a bare "Date" opening a line; else, for a lease, its start; else, for a tax
 *   document, the end of its tax year. Two different dates under the same rank are a conflict:
 *   no issue date, and recency answers `input_missing`;
 * - **expiry:** a lease's labelled end, or the end of its term (a range, or a start and a
 *   duration in months or years);
 * - **issuer:** the tallest line in the top quarter of page 1 that is not a date, an amount, a
 *   label or an address line, else a web or email domain printed on the document;
 * - **name and address:** the addressee block (C58): a name line above the street lines and the
 *   line holding the country's postal code, aligned at their left edge; else a labelled holder
 *   (account holder, customer, employee, tenant) for the name.
 *
 * A value read from a text-layer line is checked against the OCR of that line's box: when they
 * disagree the OCR value is taken (`ocr-override`), or the field is left out when OCR reads none
 * (`ocr-disagreement`); either way `textLayerMismatch` is set for the fabrication score.
 */
import { parseIsoDate } from '../dates.js';
import { addressFromLines, type PostalAddress } from '../matching/addresses.js';
import { findPostalCode } from '../matching/postal-codes.js';
import { jaroWinkler } from '../name-matching.js';
import type { DateOrder } from '../viz.js';
import {
  addCalendarMonths,
  documentDateOrders,
  readDocumentDate,
  readDocumentDateRange,
  sameDocumentDate,
  type DocumentDate,
} from './dates.js';
import type { DocumentClassification } from './inputs.js';
import { isMoneyAmount } from './layout.js';
import { DOCUMENT_LEXICONS } from './lexicons/index.js';
import type { DocumentLabels, DocumentLanguage, DocumentLexicon } from './lexicons/types.js';
import type { DocumentLine } from './lines.js';
import { foldDocumentToken, trimTrailingCharacters } from './text.js';
import {
  canonicalDocumentTokens,
  canonicalTextTokens,
  phraseIndex,
  phrasesAt,
  type PhraseIndex,
} from './vocabulary.js';

/** Where the issue date came from. */
export type DocumentIssueDateSource = 'label' | 'period' | 'generic' | 'lease-start' | 'tax-year';

export interface DocumentExtraction {
  /** `null` when none was printed, or two different ones were (`issueDateConflict`). */
  readonly issueDate: DocumentDate | null;
  readonly issueDateSource: DocumentIssueDateSource | null;
  /** Two different issue dates were printed under the same rank of label (C60.5). */
  readonly issueDateConflict: boolean;
  /**
   * An issue date was printed, even one that conflicts, has two readings or that OCR contradicts
   * (so the properties check counts it found and recency answers `input_missing`).
   */
  readonly issueDateFound: boolean;
  /** A tax document's tax year, when printed. */
  readonly taxYear: number | null;
  /** A lease's start, when printed. */
  readonly leaseStart: DocumentDate | null;
  /** A lease's end, or another printed expiry; `null` when none or two different ones. */
  readonly expiry: DocumentDate | null;
  readonly expiryConflict: boolean;
  readonly issuer: string | null;
  readonly name: string | null;
  /** The addressee block's address lines, without the name line. */
  readonly addressLines: readonly string[];
  readonly address: PostalAddress | null;
  /** Kebab-case flags such as `ocr-override`, `ocr-disagreement`, `issue-date-conflict`. */
  readonly flags: readonly string[];
  /** A field's text layer disagreed with the OCR of its box (C60.5). */
  readonly textLayerMismatch: boolean;
}

export interface DocumentExtractionOptions {
  readonly language: DocumentLanguage | null;
  readonly classification: DocumentClassification;
  /**
   * The reference address's country (ISO 3166-1 alpha-2), which gives the postal code pattern and
   * the date order; without one the covered countries of the language are tried in turn.
   */
  readonly countryHint: string | null;
}

type LabelKind = keyof DocumentLabels;

/** A label found in a line: its kind, where its tokens are, and where its value may be. */
interface LabelHit {
  readonly kind: LabelKind;
  readonly line: number;
  /** Token indexes, end exclusive. */
  readonly start: number;
  readonly end: number;
  /** The value's text on the label's line, up to the next label. */
  readonly value: string;
  /** A colon follows the label. */
  readonly colon: boolean;
}

/** A value read after a label, and the line it was read from. */
interface Read<Value> {
  readonly value: Value;
  readonly line: number;
  /** Read on the label's own line (so the label is looked for again in the OCR text). */
  readonly inline: boolean;
}

/** The lines below a label it may take its value from: within 1.5 line heights. */
const BELOW = 1.5;
/** A value line's left edge may sit this share of the page width beside the label's. */
const ALIGNED = 0.1;
/** The block of an address: lines whose left edges are within this share of the page width. */
const BLOCK_ALIGNED = 0.03;
const BLOCK_LINES = 5;
/** The postal-code lines tried per country: an addressee block is one of the first (C58.7). */
const BLOCK_CANDIDATES = 20;
/** The issuer's heading is in this top share of page 1 and this much taller than most lines. */
const ISSUER_TOP = 0.25;
const ISSUER_HEIGHT = 1.2;
/** Folded text and its OCR agree at this Jaro-Winkler score (ours, provisional). */
const TEXT_AGREEMENT = 0.9;
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;
const MIN_NAME_WORDS = 2;
const MAX_NAME_WORDS = 6;
const MAX_NAME_LENGTH = 100;
const LEADING_PUNCTUATION = /^[\s:.\-–—]+/u;
const NAME_SHAPE = /^\p{L}[\p{L}\p{M} .'’&-]*$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const PREFIX_LABEL = /^\p{L}[\p{L} ]*:/u;
const YEAR = /^\d{4}$/;
const SUBDIVISION = /^[A-Z]{2,3}$/;
/** Countries whose address lines put a short subdivision code after the town. */
const SUBDIVISION_AFTER_TOWN: ReadonlySet<string> = new Set(['US', 'CA', 'AU']);

/** The countries tried for an address without a reference country, per language (ours). */
const LANGUAGE_COUNTRIES: Readonly<Record<DocumentLanguage, readonly string[]>> = {
  en: ['US', 'GB', 'CA', 'AU', 'IE', 'NZ'],
  es: ['ES', 'MX', 'US', 'AR', 'CO', 'CL'],
  fr: ['FR', 'BE', 'CH', 'CA', 'LU'],
  de: ['DE', 'AT', 'CH', 'LU', 'LI'],
};

/** "One", for a lease's term ("un año", "ein Jahr"). */
const ONE: ReadonlySet<string> = new Set([
  'one',
  'a',
  'un',
  'una',
  'une',
  'ein',
  'eine',
  'einen',
  'einem',
]);

let labelIndexes: Partial<Record<DocumentLanguage, PhraseIndex<LabelKind>>> = {};

function labelIndexOf(lexicon: DocumentLexicon): PhraseIndex<LabelKind> {
  const known = labelIndexes[lexicon.language];
  if (known !== undefined) {
    return known;
  }
  const index = phraseIndex(
    (Object.entries(lexicon.labels) as [LabelKind, readonly string[]][]).flatMap(
      ([kind, phrases]) => phrases.map((phrase) => ({ phrase, value: kind })),
    ),
  );
  labelIndexes = { ...labelIndexes, [lexicon.language]: index };
  return index;
}

/** The labels of one line's tokens, the longest at each place; a bare Date only at the start. */
function labelsIn(
  text: string,
  tokens: readonly { readonly start: number; readonly end: number }[],
  canonical: readonly string[],
  index: PhraseIndex<LabelKind>,
  line: number,
): LabelHit[] {
  const found: { kind: LabelKind; start: number; end: number }[] = [];
  for (let start = 0; start < canonical.length;) {
    const [entry] = phrasesAt(index, canonical, start);
    if (entry !== undefined && (entry.value !== 'genericDate' || start === 0)) {
      found.push({ kind: entry.value, start, end: start + entry.tokens.length });
      start += entry.tokens.length;
    } else {
      start += 1;
    }
  }
  return found.map((hit, position) => {
    const from = tokens[hit.end - 1]?.end ?? text.length;
    const next = found[position + 1];
    const to = next === undefined ? text.length : (tokens[next.start]?.start ?? text.length);
    const raw = text.slice(from, to);
    return {
      ...hit,
      line,
      value: raw.replace(LEADING_PUNCTUATION, '').trim(),
      colon: raw.trimStart().startsWith(':'),
    };
  });
}

const centreY = (line: DocumentLine) => line.box[1] + line.box[3] / 2;

/** The nearest line on the label's row to its right, then the line just below it. */
function neighboursOf(lines: readonly DocumentLine[], index: number): number[] {
  const label = lines[index];
  if (label === undefined) {
    return [];
  }
  const right = lines
    .map((line, at) => ({ line, at }))
    .filter(
      ({ line, at }) =>
        at !== index &&
        line.page === label.page &&
        Math.abs(centreY(line) - centreY(label)) <= label.box[3] / 2 &&
        line.box[0] >= label.box[0] + label.box[2] - label.box[3],
    )
    .sort((a, b) => a.line.box[0] - b.line.box[0]);
  const bottom = label.box[1] + label.box[3];
  const below = lines
    .map((line, at) => ({ line, at }))
    .filter(
      ({ line, at }) =>
        at !== index &&
        line.page === label.page &&
        centreY(line) > bottom &&
        line.box[1] - bottom <= BELOW * label.box[3] &&
        line.box[0] <= label.box[0] + label.box[2] + ALIGNED * label.pageWidth &&
        line.box[0] + line.box[2] >= label.box[0] - ALIGNED * label.pageWidth,
    )
    .sort((a, b) => a.line.box[1] - b.line.box[1]);
  return [...right.slice(0, 1), ...below.slice(0, 1)].map(({ at }) => at);
}

/** A name as a holder's name is printed: 2 to 6 words of letters, no digit. */
function nameValue(text: string): string | null {
  const value = trimTrailingCharacters(text.trim(), ' ,;.').trim();
  const words = value.split(/\s+/).filter(Boolean);
  return value.length <= MAX_NAME_LENGTH &&
    words.length >= MIN_NAME_WORDS &&
    words.length <= MAX_NAME_WORDS &&
    NAME_SHAPE.test(value)
    ? value
    : null;
}

/** The first year 1990-2100 printed in a text. */
function yearIn(text: string): number | null {
  for (const word of text.split(/[\s,;:/()]+/)) {
    if (YEAR.test(word)) {
      const year = Number(word);
      if (year >= MIN_YEAR && year <= MAX_YEAR) {
        return year;
      }
    }
  }
  return null;
}

/** A lease term's length in months: `12 months`, `3 ans`, `un año`, `2 Jahre`. */
function durationMonths(text: string, lexicon: DocumentLexicon): number | null {
  const words = text
    .toLowerCase()
    .split(/[\s,;:()]+/)
    .filter(Boolean)
    .map((word) => foldDocumentToken(word));
  const months = new Set(lexicon.durationUnits.month.map((word) => foldDocumentToken(word)));
  const years = new Set(lexicon.durationUnits.year.map((word) => foldDocumentToken(word)));
  for (let at = 0; at + 1 < words.length; at += 1) {
    const amount = words[at] ?? '';
    const unit = words[at + 1] ?? '';
    const count = /^\d{1,3}$/.test(amount) ? Number(amount) : ONE.has(amount) ? 1 : null;
    if (count !== null && count > 0 && (months.has(unit) || years.has(unit))) {
      return years.has(unit) ? count * 12 : count;
    }
  }
  return null;
}

/** A printed date's readings plus `months`, less a day (a term's last day). */
function termEnd(start: DocumentDate, months: number): DocumentDate {
  return {
    readings: start.readings.flatMap((reading) => {
      const date = parseIsoDate(reading);
      if (date === null) {
        return [];
      }
      const after = addCalendarMonths(date, months);
      const last = new Date(Date.UTC(after.year, after.month - 1, after.day - 1));
      return [last.toISOString().slice(0, 10)];
    }),
  };
}

/** One value out of several printed: the one, `null` without any, or a conflict. */
function decide(values: readonly (DocumentDate | 'rejected')[]): {
  readonly date: DocumentDate | null;
  readonly conflict: boolean;
} {
  if (values.includes('rejected')) {
    return { date: null, conflict: false };
  }
  const distinct: DocumentDate[] = [];
  for (const value of values) {
    if (value !== 'rejected' && !distinct.some((known) => sameDocumentDate(known, value))) {
      distinct.push(value);
    }
  }
  return distinct.length > 1
    ? { date: null, conflict: true }
    : { date: distinct[0] ?? null, conflict: false };
}

/** Folded text, for comparing a text-layer line with the OCR of its box. */
const foldedText = (text: string) =>
  canonicalTextTokens(text)
    .tokens.map((token) => token.folded)
    .join(' ');

/** Whether a text-layer line's text agrees with what OCR read over its box. */
function textAgrees(line: DocumentLine): boolean {
  if (line.source !== 'text_layer' || line.ocrText === null) {
    return true;
  }
  const a = foldedText(line.text);
  const b = foldedText(line.ocrText);
  return a === b || jaroWinkler(a, b) >= TEXT_AGREEMENT;
}

class Extraction {
  readonly flags = new Set<string>();
  readonly lexicon: DocumentLexicon | null;
  readonly orders: readonly DateOrder[];
  readonly hits: readonly LabelHit[];
  private readonly index: PhraseIndex<LabelKind> | null;

  constructor(
    readonly lines: readonly DocumentLine[],
    readonly options: DocumentExtractionOptions,
    readonly country: string | null,
  ) {
    this.lexicon = options.language === null ? null : DOCUMENT_LEXICONS[options.language];
    this.orders = documentDateOrders(options.language, country);
    const index = this.lexicon === null ? null : labelIndexOf(this.lexicon);
    this.index = index;
    const canonical = canonicalDocumentTokens(lines);
    this.hits =
      index === null
        ? []
        : lines.flatMap((line, at) =>
            labelsIn(line.text, line.tokens, canonical[at] ?? [], index, at),
          );
  }

  /** The labels of `kind`, in reading order. */
  hitsOf(kind: LabelKind): LabelHit[] {
    return this.hits.filter((hit) => hit.kind === kind);
  }

  /** Lines that open with a label. */
  labelLines(): ReadonlySet<number> {
    return new Set(this.hits.filter((hit) => hit.start === 0).map((hit) => hit.line));
  }

  /**
   * The value of a label read by `reader`, on its line or a neighbour, checked against the OCR
   * of that line's box: the OCR value when they disagree, `rejected` when OCR reads none.
   */
  valueOf<Value>(
    hit: LabelHit,
    reader: (text: string) => Value | null,
    same: (a: Value, b: Value) => boolean,
  ): Value | 'rejected' | null {
    const read = this.readAt(hit, reader);
    if (read === null) {
      return null;
    }
    const line = this.lines[read.line];
    if (line?.source !== 'text_layer' || line.ocrText === null) {
      return read.value;
    }
    const again = read.inline
      ? this.rereadInline(hit.kind, line.ocrText, reader)
      : reader(line.ocrText);
    if (again === null) {
      this.flags.add('ocr-disagreement');
      return 'rejected';
    }
    if (!same(again, read.value)) {
      this.flags.add('ocr-override');
      return again;
    }
    return read.value;
  }

  private readAt<Value>(hit: LabelHit, reader: (text: string) => Value | null): Read<Value> | null {
    if (hit.value !== '') {
      const value = reader(hit.value);
      return value === null ? null : { value, line: hit.line, inline: true };
    }
    for (const at of neighboursOf(this.lines, hit.line)) {
      const text = this.lines[at]?.text ?? '';
      const value = reader(text);
      if (value !== null) {
        return { value, line: at, inline: false };
      }
    }
    return null;
  }

  /** The value after the same kind of label in the OCR text, else in the whole OCR text. */
  private rereadInline<Value>(
    kind: LabelKind,
    ocrText: string,
    reader: (text: string) => Value | null,
  ): Value | null {
    if (this.index === null) {
      return reader(ocrText);
    }
    const { tokens, canonical } = canonicalTextTokens(ocrText);
    const again = labelsIn(ocrText, tokens, canonical, this.index, -1).find(
      (hit) => hit.kind === kind,
    );
    return reader(again === undefined ? ocrText : again.value);
  }

  /** A line's text, or the OCR of its box when the two disagree (flagged unless only probing). */
  checkedText(at: number, flag = true): string {
    const line = this.lines[at];
    if (line === undefined) {
      return '';
    }
    if (textAgrees(line)) {
      return line.text;
    }
    if (flag) {
      this.flags.add('ocr-override');
    }
    return line.ocrText ?? '';
  }

  date = (text: string): DocumentDate | null => readDocumentDate(text, this.orders);

  periodEnd = (text: string): DocumentDate | null =>
    readDocumentDateRange(text, this.orders, this.lexicon?.rangeWords ?? [])?.end ??
    readDocumentDate(text, this.orders);

  datesOf(
    kind: LabelKind,
    reader: (text: string) => DocumentDate | null,
  ): (DocumentDate | 'rejected')[] {
    return this.hitsOf(kind).flatMap((hit) => {
      const value = this.valueOf(hit, reader, sameDocumentDate);
      return value === null ? [] : [value];
    });
  }
}

/** The lease's start and end, from its labels and its term (a range, or a duration). */
function leaseDates(extraction: Extraction): {
  readonly start: DocumentDate | null;
  readonly end: DocumentDate | null;
  readonly endConflict: boolean;
} {
  const { lexicon } = extraction;
  const starts = extraction.datesOf('leaseStart', extraction.date);
  const ends = extraction.datesOf('expiry', extraction.date);
  const durations: number[] = [];
  for (const hit of extraction.hitsOf('leaseTerm')) {
    const range = extraction.valueOf(
      hit,
      (text) => readDocumentDateRange(text, extraction.orders, lexicon?.rangeWords ?? []),
      (a, b) => sameDocumentDate(a.start, b.start) && sameDocumentDate(a.end, b.end),
    );
    if (range === 'rejected') {
      ends.push('rejected');
    } else if (range !== null) {
      starts.push(range.start);
      ends.push(range.end);
    } else if (lexicon !== null) {
      const months = durationMonths(hit.value, lexicon);
      const startHere = extraction.date(hit.value);
      if (months !== null) {
        durations.push(months);
        if (startHere !== null) {
          starts.push(startHere);
        }
      }
    }
  }
  const start = decide(starts);
  if (start.conflict) {
    extraction.flags.add('lease-start-conflict');
  }
  if (start.date !== null) {
    for (const months of durations) {
      ends.push(termEnd(start.date, months));
    }
  }
  const end = decide(ends);
  if (end.conflict) {
    extraction.flags.add('expiry-conflict');
  }
  return { start: start.date, end: end.date, endConflict: end.conflict };
}

/** The tax year: a labelled one, else a year on a line naming a tax form. */
function taxYearOf(extraction: Extraction): number | null {
  const labelled = extraction.hitsOf('taxYear').flatMap((hit) => {
    const year = extraction.valueOf(hit, yearIn, (a, b) => a === b);
    return typeof year === 'number' ? [year] : [];
  });
  let years = [...new Set(labelled)];
  if (years.length === 0 && extraction.lexicon !== null) {
    const forms = phraseIndex(
      extraction.lexicon.cues
        .filter((cue) => cue.strength === 'anchor' && cue.classes.includes('tax_document'))
        .map((cue) => ({ phrase: cue.phrase, value: true })),
    );
    const canonical = canonicalDocumentTokens(extraction.lines);
    years = [
      ...new Set(
        extraction.lines.flatMap((line, at) => {
          const tokens = canonical[at] ?? [];
          const names = tokens.some((_, start) => phrasesAt(forms, tokens, start).length > 0);
          const year = names ? yearIn(extraction.checkedText(at)) : null;
          return year === null ? [] : [year];
        }),
      ),
    ];
  }
  if (years.length > 1) {
    extraction.flags.add('tax-year-conflict');
    return null;
  }
  return years[0] ?? null;
}

/** The issue date by rank: labelled, a period's end, a bare Date; then the class's fallback. */
function issueDateOf(
  extraction: Extraction,
  lease: { readonly start: DocumentDate | null },
  taxYear: number | null,
): Pick<
  DocumentExtraction,
  'issueDate' | 'issueDateSource' | 'issueDateConflict' | 'issueDateFound'
> {
  const ranks: [DocumentIssueDateSource, (DocumentDate | 'rejected')[]][] = [
    ['label', extraction.datesOf('issueDate', extraction.date)],
    ['period', extraction.datesOf('period', extraction.periodEnd)],
    ['generic', extraction.datesOf('genericDate', extraction.date)],
  ];
  for (const [source, values] of ranks) {
    if (values.length > 0) {
      const { date, conflict } = decide(values);
      if (conflict) {
        extraction.flags.add('issue-date-conflict');
      }
      return {
        issueDate: date,
        issueDateSource: date === null ? null : source,
        issueDateConflict: conflict,
        issueDateFound: true,
      };
    }
  }
  const { classification } = extraction.options;
  if (classification === 'lease' && lease.start !== null) {
    return {
      issueDate: lease.start,
      issueDateSource: 'lease-start',
      issueDateConflict: false,
      issueDateFound: true,
    };
  }
  if (classification === 'tax_document' && taxYear !== null) {
    return {
      issueDate: { readings: [`${String(taxYear)}-12-31`] },
      issueDateSource: 'tax-year',
      issueDateConflict: false,
      issueDateFound: true,
    };
  }
  return {
    issueDate: null,
    issueDateSource: null,
    issueDateConflict: false,
    issueDateFound: false,
  };
}

/** A line's text without a leading `Label:` and split at commas, as address lines. */
function addressParts(text: string): string[] {
  const unlabelled = PREFIX_LABEL.test(text) ? text.slice(text.indexOf(':') + 1) : text;
  return unlabelled
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The nearest line above `at`, aligned at its left edge, within 1.5 line heights. */
function lineAbove(lines: readonly DocumentLine[], at: number): number | null {
  const current = lines[at];
  if (current === undefined) {
    return null;
  }
  let best: number | null = null;
  lines.forEach((line, index) => {
    const gap = current.box[1] - (line.box[1] + line.box[3]);
    if (
      index !== at &&
      line.page === current.page &&
      line.box[1] < current.box[1] &&
      gap <= BELOW * line.box[3] &&
      gap >= -line.box[3] / 2 &&
      Math.abs(line.box[0] - current.box[0]) <= BLOCK_ALIGNED * current.pageWidth &&
      (best === null || line.box[1] > (lines[best]?.box[1] ?? 0))
    ) {
      best = index;
    }
  });
  return best;
}

interface AddresseeBlock {
  readonly nameLine: number | null;
  readonly addressLines: readonly number[];
  readonly country: string;
}

/**
 * The candidate addressee blocks of the first country that has one: each a postal-code line, the
 * street lines above it and, when the line above those reads as a name, the name line.
 */
function addresseeBlocks(
  extraction: Extraction,
  countries: readonly string[],
  issuer: number | null,
): AddresseeBlock[] {
  const { lines } = extraction;
  const stops = extraction.labelLines();
  const blocks: AddresseeBlock[] = [];
  for (const country of countries) {
    const candidates = lines
      .map((line, at) => ({ line, at }))
      .filter(
        ({ line, at }) =>
          (!stops.has(at) || PREFIX_LABEL.test(line.text)) &&
          addressParts(line.text).some((part) => findPostalCode(part, country) !== null),
      )
      .slice(0, BLOCK_CANDIDATES);
    candidates.forEach(({ at }) => {
      const block = [at];
      for (let above = lineAbove(lines, at); above !== null && block.length < BLOCK_LINES;) {
        const text = lines[above]?.text ?? '';
        if (
          stops.has(above) ||
          // A field ("Employer identification number: …") is never a line of the block.
          PREFIX_LABEL.test(text) ||
          isMoneyAmount(text.split(/\s+/).at(-1) ?? '') ||
          readDocumentDate(text, extraction.orders) !== null
        ) {
          break;
        }
        block.unshift(above);
        above = lineAbove(lines, above);
      }
      const [first] = block;
      const named =
        block.length >= 2 &&
        first !== undefined &&
        first !== issuer &&
        nameValue(extraction.checkedText(first, false)) !== null;
      blocks.push({
        nameLine: named ? first : null,
        addressLines: named ? block.slice(1) : block,
        country,
      });
    });
    if (blocks.length > 0) {
      break;
    }
  }
  return blocks;
}

/** The holder's name after a holder label (account holder, customer, tenant), and its line. */
function labelledHolder(extraction: Extraction): { name: string; line: number } | null {
  for (const hit of extraction.hitsOf('name')) {
    const value =
      hit.colon || hit.value === ''
        ? extraction.valueOf(hit, nameValue, (a, b) => foldedText(a) === foldedText(b))
        : null;
    if (typeof value === 'string') {
      return { name: value, line: hit.line };
    }
  }
  return null;
}

/**
 * The addressee block: one whose name line tops it; else, after a labelled holder, the nearest
 * block below that label on its page (a lease's premises after its tenant, never the landlord's
 * address above); else the first block.
 */
function chosenBlock(
  blocks: readonly AddresseeBlock[],
  lines: readonly DocumentLine[],
  holder: { line: number } | null,
): AddresseeBlock | null {
  const named = blocks.find((block) => block.nameLine !== null);
  if (named !== undefined) {
    return named;
  }
  const label = holder ? lines[holder.line] : undefined;
  const after =
    label === undefined
      ? []
      : blocks.filter((block) => {
          const first = lines[block.addressLines[0] ?? -1];
          return first?.page === label.page && first.box[1] > label.box[1];
        });
  const top = (block: AddresseeBlock) => lines[block.addressLines[0] ?? -1]?.box[1] ?? 0;
  return [...after].sort((a, b) => top(a) - top(b))[0] ?? blocks[0] ?? null;
}

/**
 * A block's lines split at commas, the postal code's part rejoined with the town before it when
 * it holds nothing but the code and, where the town comes first, a subdivision code
 * ("MERIDALE, UT 00000" stays one town line, so the town is not read as a street line).
 */
function blockParts(lines: readonly string[], country: string): string[] {
  const parts = lines.flatMap((line) => addressParts(line));
  const at = parts.findLastIndex((part) => findPostalCode(part, country) !== null);
  const postal = parts[at] ?? '';
  const town = parts[at - 1];
  const code = findPostalCode(postal, country);
  if (town === undefined || code === null || /\d/.test(town)) {
    return parts;
  }
  const rest = postal.toUpperCase().replace(code, '').trim();
  if (rest === '' || (SUBDIVISION_AFTER_TOWN.has(country) && SUBDIVISION.test(rest))) {
    parts.splice(at - 1, 2, `${town}, ${postal}`);
  }
  return parts;
}

/** The address of a block's lines, the town's trailing subdivision code split off. */
function blockAddress(lines: readonly string[], country: string): PostalAddress {
  const address = addressFromLines(blockParts(lines, country), country);
  const words = (address.city ?? '').split(/\s+/).filter(Boolean);
  const last = words.at(-1) ?? '';
  if (
    SUBDIVISION_AFTER_TOWN.has(country) &&
    words.length >= 2 &&
    SUBDIVISION.test(last) &&
    (address.subdivision ?? null) === null
  ) {
    return { ...address, city: words.slice(0, -1).join(' '), subdivision: last };
  }
  return { ...address, subdivision: address.subdivision ?? null };
}

/** The tallest line in the top quarter of page 1 that is a heading, not a field or an address. */
function issuerLine(extraction: Extraction, exclude: ReadonlySet<number>): number | null {
  const { lines } = extraction;
  const pageOne = lines.filter((line) => line.page === (lines[0]?.page ?? 1));
  const heights = pageOne.map((line) => line.box[3]).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] ?? 0;
  const labels = extraction.labelLines();
  let best: number | null = null;
  lines.forEach((line, at) => {
    const letters = line.text.match(/\p{L}/gu)?.length ?? 0;
    if (
      line.page === lines[0]?.page &&
      line.box[1] < ISSUER_TOP * line.pageHeight &&
      line.box[3] >= ISSUER_HEIGHT * median &&
      letters >= 3 &&
      !labels.has(at) &&
      !exclude.has(at) &&
      !isMoneyAmount(line.text.split(/\s+/).at(-1) ?? '') &&
      readDocumentDate(line.text, extraction.orders) === null &&
      (best === null || line.box[3] > (lines[best]?.box[3] ?? 0))
    ) {
      best = at;
    }
  });
  return best;
}

/** A web or email domain printed on the document. */
function domainOf(lines: readonly DocumentLine[]): string | null {
  for (const line of lines) {
    for (const raw of line.text.split(/\s+/)) {
      const bare = raw.toLowerCase().replace(/^https?:\/\//, '');
      const word = trimTrailingCharacters(bare, '.,;:)');
      const host = word.startsWith('www.')
        ? word.slice(4).split('/')[0]
        : word.includes('@')
          ? word.slice(word.lastIndexOf('@') + 1)
          : null;
      if (
        host !== undefined &&
        host !== null &&
        HOST.test(host) &&
        /[a-z]/.test(host.split('.').at(-1) ?? '')
      ) {
        return host;
      }
    }
  }
  return null;
}

/** Extracts the fields of a document from its lines. */
export function extractDocumentFields(
  lines: readonly DocumentLine[],
  options: DocumentExtractionOptions,
): DocumentExtraction {
  const countries =
    options.countryHint !== null
      ? [options.countryHint]
      : options.language === null
        ? []
        : LANGUAGE_COUNTRIES[options.language];
  // Dates are read in the reference country's order only: a country guessed from a postal code
  // pattern (many countries share five digits) never decides the order.
  const extraction = new Extraction(lines, options, options.countryHint);
  const headingFirst = issuerLine(extraction, new Set());
  const blocks = addresseeBlocks(extraction, countries, headingFirst);
  const holder = blocks.some((candidate) => candidate.nameLine !== null)
    ? null
    : labelledHolder(extraction);
  const block = chosenBlock(blocks, lines, holder);
  const blockLines = new Set([
    ...(block?.addressLines ?? []),
    ...(block?.nameLine === null || block === null ? [] : [block.nameLine]),
  ]);
  const heading = issuerLine(extraction, blockLines);
  const lease = leaseDates(extraction);
  const taxYear = taxYearOf(extraction);
  const issue = issueDateOf(extraction, lease, taxYear);
  const addressLines = (block?.addressLines ?? []).map((at) => extraction.checkedText(at));
  const name =
    (block?.nameLine === null || block === null
      ? null
      : nameValue(extraction.checkedText(block.nameLine))) ??
    (holder ?? labelledHolder(extraction))?.name ??
    null;
  const issuerText = heading === null ? null : extraction.checkedText(heading).trim();
  const flags = [...extraction.flags];
  return {
    ...issue,
    taxYear,
    leaseStart: lease.start,
    expiry: lease.end,
    expiryConflict: lease.endConflict,
    issuer: issuerText === null || issuerText === '' ? domainOf(lines) : issuerText,
    name,
    addressLines,
    address:
      block === null || addressLines.length === 0
        ? null
        : blockAddress(addressLines, block.country),
    flags: [...new Set(flags)],
    textLayerMismatch: flags.includes('ocr-override') || flags.includes('ocr-disagreement'),
  };
}
