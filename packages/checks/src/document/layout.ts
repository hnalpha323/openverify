/**
 * Layout features (C60.5) read from the lines' boxes, each adding its weight to the classes it
 * points to. Weights are ours and provisional, fixed here and not tuned on the generated set
 * (H23): 2 for a feature of one class, 1 for one that several classes share.
 *
 * | Feature | Classes | When |
 * |---|---|---|
 * | `money-column` | utility bill, bank statement, pay stub | 5 or more lines ending in an amount, their right edges within 1% of the page width |
 * | `transaction-table` | bank statement | 5 or more lines that start with a date and end with an amount |
 * | `valid-iban` | bank statement, utility bill | an IBAN whose ISO 13616 check digits hold (mod 97) |
 * | `earnings-deductions` | pay stub | an earnings heading and a deductions heading on one row |
 * | `numbered-boxes` | tax document | 4 or more lines that start with distinct box numbers 1-20 (no leading zero, no dot, not a date) |
 * | `contract-layout` | lease | 8 or more lines across 60% of the page width with at most 10% digits, and a signature line |
 * | `meter-readings` | utility bill | 2 or more lines with a number followed by a supply unit (kWh, m³, therms) |
 */
import { parseVizDate } from '../viz.js';
import type { DocumentClass } from './inputs.js';
import type { DocumentLexicon } from './lexicons/types.js';
import type { DocumentLine } from './lines.js';
import { canonicalDocumentTokens, phraseIndex, phrasesAt } from './vocabulary.js';

export const DOCUMENT_LAYOUT_FEATURE_IDS = [
  'money-column',
  'transaction-table',
  'valid-iban',
  'earnings-deductions',
  'numbered-boxes',
  'contract-layout',
  'meter-readings',
] as const;
export type DocumentLayoutFeatureId = (typeof DOCUMENT_LAYOUT_FEATURE_IDS)[number];

export interface DocumentLayoutFeatureDefinition {
  readonly id: DocumentLayoutFeatureId;
  readonly weight: number;
  readonly classes: readonly DocumentClass[];
}

/** Each feature's weight and classes (ours, provisional). */
export const DOCUMENT_LAYOUT_FEATURES: readonly DocumentLayoutFeatureDefinition[] = Object.freeze([
  { id: 'money-column', weight: 1, classes: ['utility_bill', 'bank_statement', 'pay_stub'] },
  { id: 'transaction-table', weight: 2, classes: ['bank_statement'] },
  { id: 'valid-iban', weight: 1, classes: ['bank_statement', 'utility_bill'] },
  { id: 'earnings-deductions', weight: 2, classes: ['pay_stub'] },
  { id: 'numbered-boxes', weight: 2, classes: ['tax_document'] },
  { id: 'contract-layout', weight: 2, classes: ['lease'] },
  { id: 'meter-readings', weight: 2, classes: ['utility_bill'] },
] satisfies readonly DocumentLayoutFeatureDefinition[]);

/** The fewest aligned amounts that make a money column, and dated rows a transaction table. */
const MIN_COLUMN_ROWS = 5;
/** Right edges within this share of the page width are aligned. */
const ALIGNMENT = 0.01;
const MIN_BOXES = 4;
const MAX_BOX_NUMBER = 20;
const MIN_PROSE_LINES = 8;
const PROSE_WIDTH = 0.6;
const PROSE_MAX_DIGITS = 0.1;
const MIN_METER_LINES = 2;
const SUPPLY_UNITS: ReadonlySet<string> = new Set([
  'kwh',
  'mwh',
  'm3',
  'therms',
  'ccf',
  'gj',
  'mj',
]);
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const INTEGER_PART = /^(?:\d{1,3}(?:[., \xa0]\d{3})*|\d+)$/;
const DECIMAL_PART = /^[.,]\d{2}$/;
const CURRENCY = /^[$€£¥]$/;
const IBAN_START = /^[A-Z]{2}\d{2}[A-Z0-9]*$/;
const IBAN_GROUP = /^[A-Z0-9]{1,4}$/;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const NUMERIC_DATE = /^\d{1,2}[./-]\d{1,2}(?:[./-](?:\d{4}|\d{2}))?\.?$/;
const BOX_NUMBER = /^([1-9]\d?)[a-z]?\s/;
const DIGIT = /\d/g;
const SPACE = /\s/g;

/** Whether a token is an amount of money: digits with a decimal part of two, a sign or currency. */
export function isMoneyAmount(token: string): boolean {
  let text = token.trim();
  if (text.startsWith('(') && text.endsWith(')')) {
    text = text.slice(1, -1);
  }
  if (text.startsWith('-') || text.startsWith('+') || text.startsWith('−')) {
    text = text.slice(1);
  }
  if (CURRENCY.test(text.charAt(0))) {
    text = text.slice(1);
  }
  if (CURRENCY.test(text.charAt(text.length - 1))) {
    text = text.slice(0, -1);
  }
  const integer = text.slice(0, -3);
  return integer !== '' && DECIMAL_PART.test(text.slice(-3)) && INTEGER_PART.test(integer);
}

/** ISO 13616 / ISO 7064 MOD 97-10. */
function ibanChecks(compact: string): boolean {
  const moved = `${compact.slice(4)}${compact.slice(0, 4)}`;
  let remainder = 0;
  for (const character of moved) {
    const value = Number.parseInt(character, 36);
    for (const digit of String(value)) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Whether a line holds an IBAN whose check digits hold (ISO 13616, mod 97). */
export function hasValidIban(line: DocumentLine): boolean {
  const tokens = line.tokens.map((token) => token.text.toUpperCase());
  for (let start = 0; start < tokens.length; start += 1) {
    let compact = tokens[start] ?? '';
    if (!IBAN_START.test(compact)) {
      continue;
    }
    for (let next = start + 1; compact.length <= 34; next += 1) {
      if (compact.length >= 15 && ibanChecks(compact)) {
        return true;
      }
      const group = tokens[next];
      if (group === undefined || !IBAN_GROUP.test(group)) {
        break;
      }
      compact += group;
    }
  }
  return false;
}

const lastWord = (text: string): string => text.trim().split(/\s+/).at(-1) ?? '';
const firstWords = (text: string): string[] => text.trim().split(/\s+/).slice(0, 2);
const centreY = (line: DocumentLine) => line.box[1] + line.box[3] / 2;

/** Whether a line opens with a date: `02.09.`, `14/09/2026`, or a day and a month name. */
function startsWithDate(line: DocumentLine): boolean {
  const [first = '', second = ''] = firstWords(line.text);
  return (
    NUMERIC_DATE.test(first) ||
    (/^\d{1,2}$/.test(first) && parseVizDate(`${first} ${second} 2000`) !== null)
  );
}

function hasMoneyColumn(lines: readonly DocumentLine[]): boolean {
  const amounts = lines.filter((line) => isMoneyAmount(lastWord(line.text)));
  return amounts.some(
    (line) =>
      amounts.filter(
        (other) =>
          other.page === line.page &&
          Math.abs(other.box[0] + other.box[2] - (line.box[0] + line.box[2])) <=
            ALIGNMENT * line.pageWidth,
      ).length >= MIN_COLUMN_ROWS,
  );
}

function hasTransactionTable(lines: readonly DocumentLine[]): boolean {
  return (
    lines.filter((line) => startsWithDate(line) && isMoneyAmount(lastWord(line.text))).length >=
    MIN_COLUMN_ROWS
  );
}

function hasNumberedBoxes(lines: readonly DocumentLine[]): boolean {
  const numbers = new Set<number>();
  for (const line of lines) {
    const match = BOX_NUMBER.exec(`${line.text.trim()} `);
    const number = Number(match?.[1]);
    const [, second = ''] = firstWords(line.text);
    if (
      match !== null &&
      number <= MAX_BOX_NUMBER &&
      /\p{L}/u.test(second) &&
      parseVizDate(`1 ${second} 2000`) === null
    ) {
      numbers.add(number);
    }
  }
  return numbers.size >= MIN_BOXES;
}

function hasPayColumns(
  lines: readonly DocumentLine[],
  tokens: readonly (readonly string[])[],
  lexicon: DocumentLexicon,
): boolean {
  const earnings = phraseIndex(lexicon.payColumns.earnings.map((phrase) => ({ phrase, value: 1 })));
  const deductions = phraseIndex(
    lexicon.payColumns.deductions.map((phrase) => ({ phrase, value: 1 })),
  );
  const holds = (index: typeof earnings, lineTokens: readonly string[]) =>
    lineTokens.some((_, start) => phrasesAt(index, lineTokens, start).length > 0);
  return lines.some((line, index) => {
    if (!holds(earnings, tokens[index] ?? [])) {
      return false;
    }
    return lines.some(
      (other, otherIndex) =>
        other.page === line.page &&
        Math.abs(centreY(other) - centreY(line)) <= line.box[3] / 2 &&
        holds(deductions, tokens[otherIndex] ?? []),
    );
  });
}

function hasContractLayout(
  lines: readonly DocumentLine[],
  tokens: readonly (readonly string[])[],
  lexicon: DocumentLexicon,
): boolean {
  const prose = lines.filter((line) => {
    const characters = line.text.replace(SPACE, '');
    const digits = characters.match(DIGIT)?.length ?? 0;
    return (
      line.box[2] >= PROSE_WIDTH * line.pageWidth &&
      characters.length > 0 &&
      digits / characters.length <= PROSE_MAX_DIGITS
    );
  });
  if (prose.length < MIN_PROSE_LINES) {
    return false;
  }
  const signature = phraseIndex(lexicon.signatureWords.map((phrase) => ({ phrase, value: 1 })));
  return lines.some(
    (line, index) =>
      line.text.includes('______') ||
      (tokens[index] ?? []).some(
        (_, start) => phrasesAt(signature, tokens[index] ?? [], start).length > 0,
      ),
  );
}

function hasMeterReadings(lines: readonly DocumentLine[]): boolean {
  return (
    lines.filter((line) =>
      line.tokens.some(
        (token, index) =>
          SUPPLY_UNITS.has(token.folded) &&
          index > 0 &&
          /^\d+$/.test(line.tokens[index - 1]?.folded ?? ''),
      ),
    ).length >= MIN_METER_LINES
  );
}

/** The layout features of a document's lines, in {@link DOCUMENT_LAYOUT_FEATURE_IDS} order. */
export function documentLayoutFeatures(
  lines: readonly DocumentLine[],
  lexicon: DocumentLexicon,
): DocumentLayoutFeatureId[] {
  const tokens = canonicalDocumentTokens(lines);
  const found: Record<DocumentLayoutFeatureId, boolean> = {
    'money-column': hasMoneyColumn(lines),
    'transaction-table': hasTransactionTable(lines),
    'valid-iban': lines.some((line) => hasValidIban(line)),
    'earnings-deductions': hasPayColumns(lines, tokens, lexicon),
    'numbered-boxes': hasNumberedBoxes(lines),
    'contract-layout': hasContractLayout(lines, tokens, lexicon),
    'meter-readings': hasMeterReadings(lines),
  };
  return DOCUMENT_LAYOUT_FEATURE_IDS.filter((id) => found[id]);
}
