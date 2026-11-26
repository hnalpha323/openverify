/**
 * The label-anchored parser of the visual inspection zone (C31.1): it reads the printed fields of
 * an identity document from the OCR lines and their boxes.
 *
 * 1. A line is a label when its words are a label of the dictionary below (English, Spanish,
 *    French and German; bilingual labels split by `/` included; a leading field number such as
 *    `3.` ignored). A label followed by more words on the same line carries its value inline.
 * 2. A label's value is the nearest line to its right (same row) or below it (aligned), that is
 *    not itself a label or an MRZ line, was not used already, and fits the field (a date for a
 *    date, letters for a name, a number-shaped token for a number).
 * 3. When no label was read, dates and the document number are also found by pattern, among the
 *    lines no label is near: a single future date is the expiry; a single date at least 16 years
 *    old the birth date; a single date of the last 15 years the issue date; a single
 *    number-shaped token the document number. A date may sit inside a longer line (a misread
 *    label before it); a line with two dates gives none. An ambiguous pattern assigns nothing.
 * 4. Phase 12A, the Quebec driver licence (`docs/plans/phase-12a.plan.md` C1, C2):
 *    - a format hint in parentheses (`(A-M-J)`, `(JJ.MM.AAAA)`, `(MM/DD/YYYY)`) is dropped from a
 *      label, and a day-first or month-first hint sets that line's date order;
 *    - a label glued to its value is split at a letter-to-digit boundary (`LE2021-03-15`);
 *    - the OCR confusions `O`, `I`, `l`, `S`, `B`, `Z` read as digits only inside a token that
 *      holds a digit (a date or a number), never in a name;
 *    - the licence number `A9999-999999-99` is read compact by its pattern;
 *    - when the card reads as Quebec (the barcode's jurisdiction, or a `QUEBEC` line beside that
 *      number), the two unlabeled lines under the number are the surname and the given names
 *      (`via: 'layout'`), both or neither, never over a label reading.
 *
 * Each reading names how it was read (`label`, `pattern` or `layout`), so the consistency checks
 * can weigh it. OCR text is PII: the parser returns values for the extraction only, and nothing
 * here logs.
 */
import type { ExtractionField } from '@openverify/core';
import { normalizeCountryCode } from './country-codes.js';

export type VizBox = readonly [x: number, y: number, width: number, height: number];

export interface VizLine {
  text: string;
  confidence: number;
  box: VizBox;
}

/** How a numeric date is ordered: day first (most of the world) or month first (US). */
export type DateOrder = 'DMY' | 'MDY';

/** The jurisdiction a document's barcode names (an AAMVA issuer): country and subdivision code. */
export interface VizJurisdiction {
  country: string;
  code: string;
}

export interface VizParseOptions {
  /** Defaults to `DMY`; the worker passes `MDY` for a US document. */
  dateOrder?: DateOrder;
  /** Decides which pattern dates are past or future; defaults to now. */
  now?: Date;
  /** The AAMVA issuer's jurisdiction, when a barcode named one: it turns on a layout rule. */
  jurisdiction?: VizJurisdiction | null;
}

/**
 * How a value was read: after its label, by its own pattern, or by its place on a known layout
 * (the Quebec name lines). A layout reading is weaker evidence than a label.
 */
export type VizVia = 'label' | 'pattern' | 'layout';

export interface VizFieldReading {
  value: string;
  /** The index of the line the value was read from. */
  lineIndex: number;
  via: VizVia;
}

export type VizField = Extract<
  ExtractionField,
  | 'name-first'
  | 'name-last'
  | 'birthdate'
  | 'sex'
  | 'nationality'
  | 'identification-number'
  | 'personal-number'
  | 'issue-date'
  | 'expiration-date'
  | 'address-street-1'
  | 'address-street-2'
  | 'address-city'
  | 'address-subdivision'
  | 'address-postal-code'
  | 'issuing-authority-code'
>;

export interface VizParse {
  fields: Partial<Record<VizField, VizFieldReading>>;
  /** The lines read as labels, inline values included, in order. */
  labelLines: readonly number[];
}

type LabelField = Exclude<
  VizField,
  | 'address-street-2'
  | 'address-city'
  | 'address-subdivision'
  | 'address-postal-code'
  | 'issuing-authority-code'
>;

/**
 * Labels as folded words (upper case, accents removed, punctuation dropped). Within a field, an
 * earlier label wins when a document prints several: a visa's own number before the passport
 * number it also shows.
 */
const LABELS: Readonly<Record<LabelField, readonly string[]>> = {
  'name-last': [
    'SURNAME',
    'SURNAMES',
    'LAST NAME',
    'FAMILY NAME',
    'LN',
    'APELLIDOS',
    'APELLIDO',
    'PRIMER APELLIDO',
    'NOM',
    'NOM DE FAMILLE',
    'NACHNAME',
    'FAMILIENNAME',
  ],
  'name-first': [
    'GIVEN NAMES',
    'GIVEN NAME',
    'FIRST NAME',
    'FIRST NAMES',
    'FORENAMES',
    'FORENAME',
    'FN',
    'NOMBRE',
    'NOMBRES',
    'PRENOM',
    'PRENOMS',
    'VORNAME',
    'VORNAMEN',
  ],
  birthdate: [
    'DATE OF BIRTH',
    'BIRTH DATE',
    'DOB',
    'FECHA DE NACIMIENTO',
    'FECHA NACIMIENTO',
    'NACIMIENTO',
    'DATE DE NAISSANCE',
    'NE LE',
    'NEE LE',
    'GEBURTSDATUM',
    'GEBURTSTAG',
    'GEBOREN AM',
  ],
  'expiration-date': [
    'DATE OF EXPIRY',
    'EXPIRY DATE',
    'EXPIRY',
    'EXPIRES',
    'EXPIRATION',
    'EXPIRATION DATE',
    'EXP',
    'VALID UNTIL',
    'VALID THRU',
    'VALID THROUGH',
    'FECHA DE CADUCIDAD',
    'CADUCIDAD',
    'FECHA DE VENCIMIENTO',
    'VENCIMIENTO',
    'VALIDO HASTA',
    'DATE D EXPIRATION',
    'EXPIRE LE',
    'VALABLE JUSQU AU',
    'GULTIG BIS',
    'ABLAUFDATUM',
  ],
  'issue-date': [
    'DATE OF ISSUE',
    'ISSUE DATE',
    'ISSUED',
    'ISS',
    'FECHA DE EXPEDICION',
    'EXPEDICION',
    'FECHA DE EMISION',
    'EMISION',
    'DATE DE DELIVRANCE',
    'DELIVRE LE',
    'AUSSTELLUNGSDATUM',
    'AUSGESTELLT AM',
  ],
  'identification-number': [
    'VISA NO',
    'VISA NUMBER',
    'NUMERO DE VISADO',
    'NO DE VISA',
    'VISUMNUMMER',
    'DOCUMENT NO',
    'DOCUMENT NUMBER',
    'DOC NO',
    'CARD NO',
    'CARD NUMBER',
    'PASSPORT NO',
    'PASSPORT NUMBER',
    'ID NO',
    'ID NUMBER',
    'LICENSE NO',
    'LICENCE NO',
    'DL NO',
    'DLN',
    'NUMERO DE PERMIS',
    'NO DE PERMIS',
    'N DE PERMIS',
    'NUMERO DE DOCUMENTO',
    'NUM DOCUMENTO',
    'NO DOCUMENTO',
    'N DOCUMENTO',
    'NUMERO DE PASAPORTE',
    'NO DU DOCUMENT',
    'N DU DOCUMENT',
    'NUMERO DU DOCUMENT',
    'NO DE PASSEPORT',
    'DOKUMENTENNUMMER',
    'AUSWEISNUMMER',
    'PASSNUMMER',
    'KARTENNUMMER',
  ],
  'personal-number': [
    'PERSONAL NO',
    'PERSONAL NUMBER',
    'PERSONAL ID NO',
    'NUMERO PERSONAL',
    'NO PERSONNEL',
  ],
  sex: ['SEX', 'SEXO', 'SEXE', 'GESCHLECHT'],
  nationality: ['NATIONALITY', 'NACIONALIDAD', 'NATIONALITE', 'STAATSANGEHORIGKEIT'],
  'address-street-1': ['ADDRESS', 'DOMICILIO', 'DIRECCION', 'ADRESSE', 'ANSCHRIFT', 'WOHNORT'],
};

/** Words that sit beside a real label in multilingual labels, such as `Name/Surname/Nom`. */
const COMPANION_WORDS = new Set(['NAME']);

const PHRASES: readonly (readonly [words: readonly string[], field: LabelField, rank: number])[] = (
  Object.entries(LABELS) as [LabelField, readonly string[]][]
)
  .flatMap(([field, labels]) =>
    labels.map((label, rank) => [label.split(' '), field, rank] as const),
  )
  .sort((a, b) => b[0].length - a[0].length);

const MONTHS: Readonly<Record<string, number>> = Object.fromEntries(
  (
    [
      [1, 'JAN JANUARY ENE ENERO JANV JANVIER JANUAR JAEN'],
      [2, 'FEB FEBRUARY FEBRERO FEV FEVR FEVRIER FEBRUAR'],
      [3, 'MAR MARCH MARZO MARS MARZ'],
      [4, 'APR APRIL ABR ABRIL AVR AVRIL'],
      [5, 'MAY MAYO MAI'],
      [6, 'JUN JUNE JUNIO JUIN JUNI'],
      [7, 'JUL JULY JULIO JUIL JUILLET JULI'],
      [8, 'AUG AUGUST AGO AGOSTO AOUT'],
      [9, 'SEP SEPT SEPTEMBER SEPTIEMBRE SET SEPTEMBRE'],
      [10, 'OCT OCTOBER OCTUBRE OCTOBRE OKT OKTOBER'],
      [11, 'NOV NOVEMBER NOVIEMBRE NOVEMBRE'],
      [12, 'DEC DECEMBER DIC DICIEMBRE DECEMBRE DEZ DEZEMBER'],
    ] as const
  ).flatMap(([month, names]) => names.split(' ').map((name) => [name, month])),
);

/** C31.2 confusables in a digit position. */
const TO_DIGIT: Readonly<Record<string, string>> = { O: '0', I: '1', S: '5', B: '8', Z: '2' };

/** The same confusables before case folding, with the lower-case `l` (and `o`, `s`, `z`) for 1. */
const CONFUSABLE: Readonly<Record<string, string>> = {
  O: '0',
  o: '0',
  I: '1',
  l: '1',
  S: '5',
  s: '5',
  B: '8',
  Z: '2',
  z: '2',
};
const NUMERIC_LIKE = /^[\p{N}OoIlSsBZz]+$/u;

/** A token holding a digit and otherwise only confusables, as digits; any other token unchanged. */
function confusedDigits(token: string): string {
  return /\d/.test(token) && NUMERIC_LIKE.test(token)
    ? Array.from(token, (char) => CONFUSABLE[char] ?? char).join('')
    : token;
}

/** Maps the confusables inside the digit-bearing tokens of a text (dates and numbers only). */
const digitTokens = (text: string): string =>
  text.replace(/[\p{L}\p{N}]+/gu, (token) => confusedDigits(token));

const SEX_WORDS: Readonly<Record<string, 'M' | 'F' | 'X'>> = {
  M: 'M',
  F: 'F',
  X: 'X',
  MALE: 'M',
  FEMALE: 'F',
  MASCULINO: 'M',
  FEMENINO: 'F',
  MASCULIN: 'M',
  FEMININ: 'F',
  MANNLICH: 'M',
  WEIBLICH: 'F',
};

/** Upper case with accents removed; `ß` becomes `SS`. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase();
}

interface Token {
  word: string;
  start: number;
}

/** Words of a line; a label glued to its value (`LE2021`) splits at the letter-to-digit boundary. */
function tokens(text: string): Token[] {
  return Array.from(text.matchAll(/\p{L}+(?=\p{N})|[\p{L}\p{N}]+/gu), (match) => ({
    word: fold(match[0]),
    start: match.index,
  }));
}

/**
 * A printed date format hint in parentheses: three groups of one repeated letter, joined by `-`,
 * `/` or `.` (`(A-M-J)`, `(AAAA-MM-JJ)`, `(JJ.MM.AAAA)`, `(MM/DD/YYYY)`, `(TT.MM.JJJJ)`).
 */
const HINT = /\(\s*([A-Za-z])\1{0,3}\s*[-/.]\s*([A-Za-z])\2{0,3}\s*[-/.]\s*([A-Za-z])\3{0,3}\s*\)/g;

type HintPart = 'day' | 'month' | 'year';

/**
 * The order a hint's letters give: `DMY` or `MDY` for a day-first or month-first hint, `YMD` for a
 * year-first one, `null` when the letters are not a day, a month and a year. `J` is the French
 * day (`jour`) unless a `T` (German `Tag`) makes it the German year (`Jahr`); `A` is the French
 * year (`année`).
 */
function hintOrder(letters: readonly string[]): DateOrder | 'YMD' | null {
  const upper = letters.map((letter) => letter.toUpperCase());
  const german = upper.includes('T');
  const parts = upper.map((letter): HintPart | null => {
    switch (letter) {
      case 'M':
        return 'month';
      case 'D':
      case 'T':
        return 'day';
      case 'Y':
      case 'A':
        return 'year';
      case 'J':
        return german ? 'year' : 'day';
      default:
        return null;
    }
  });
  if ([...parts].sort().join(' ') !== 'day month year') {
    return null;
  }
  if (parts[0] === 'year') {
    return 'YMD';
  }
  return parts.indexOf('day') < parts.indexOf('month') ? 'DMY' : 'MDY';
}

/** The text without its date format hints, and the date order the first one sets, if any. */
function stripHints(text: string): { text: string; order: DateOrder | null } {
  let order: DateOrder | 'YMD' | null = null;
  let stripped = text;
  for (const match of text.matchAll(HINT)) {
    const found = hintOrder([match[1] ?? '', match[2] ?? '', match[3] ?? '']);
    if (found !== null) {
      order ??= found;
      stripped = stripped.replace(match[0], ' ');
    }
  }
  return { text: stripped, order: order === 'YMD' ? null : order };
}

/** The longest label phrase at `tokens[from]`. */
function phraseAt(
  words: readonly Token[],
  from: number,
): { field: LabelField; length: number; rank: number } | null {
  for (const [phrase, field, rank] of PHRASES) {
    if (phrase.every((word, index) => words[from + index]?.word === word)) {
      return { field, length: phrase.length, rank };
    }
  }
  return null;
}

/** A leading field number such as `3`, `4a` or `4D`, when a label follows it. */
const ENUMERATOR = /^\d{1,2}[A-Z]?$/;

type LineKind =
  | { kind: 'label'; field: LabelField; rank: number; order: DateOrder | null }
  | { kind: 'inline'; field: LabelField; value: string; order: DateOrder | null }
  | { kind: 'text' };

function classify(raw: string): LineKind {
  const { text, order } = stripHints(raw);
  // Bilingual labels split at `/` or `|`; a `/` between digits belongs to a date.
  const parts = text.split(/\||(?<!\d)\/|\/(?!\d)/).map((part) => ({ part, words: tokens(part) }));
  let field: LabelField | null = null;
  let rank = Number.POSITIVE_INFINITY;
  let inline: { field: LabelField; value: string } | null = null;
  for (const [index, { part, words }] of parts.entries()) {
    if (words.length === 0) {
      continue;
    }
    let position = words.length > 1 && ENUMERATOR.test(words[0]?.word ?? '') ? 1 : 0;
    let first: LabelField | null = null;
    for (let match = phraseAt(words, position); match !== null; match = phraseAt(words, position)) {
      if (first === null) {
        first = match.field;
        if (field === null) {
          rank = match.rank;
        }
      }
      position += match.length;
    }
    if (first === null) {
      if (parts.length > 1 && words.length === 1 && COMPANION_WORDS.has(words[0]?.word ?? '')) {
        continue;
      }
      return { kind: 'text' };
    }
    field ??= first;
    if (position < words.length) {
      if (index !== parts.length - 1) {
        return { kind: 'text' };
      }
      inline = { field: first, value: part.slice(words[position]?.start ?? part.length).trim() };
    }
  }
  if (field === null) {
    return { kind: 'text' };
  }
  return inline === null
    ? { kind: 'label', field, rank, order }
    : { kind: 'inline', ...inline, order };
}

const isMrzLike = (text: string): boolean =>
  /^[A-Z0-9<]{20,}$/.test(text.trim()) && text.includes('<');

function digitsOf(token: string): string {
  return /\d/.test(token) && /^[0-9OISBZ]+$/.test(token)
    ? Array.from(token, (char) => TO_DIGIT[char] ?? char).join('')
    : token;
}

/** `YYYY-MM-DD` when the three numbers name a day of the calendar, else `null` (never throws). */
function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const iso = `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  // A day past the month's end rolls over (30 February reads 2 March) and is refused here; a day
  // past 31 would be an invalid date, whose `toISOString` throws, so it is refused above.
  return date.toISOString().startsWith(iso) ? iso : null;
}

/** Day and month from two numbers in the given order; an unambiguous swap is undone. */
function dayMonth(first: number, second: number, order: DateOrder): [day: number, month: number] {
  if (order === 'DMY') {
    return second > 12 && first <= 12 ? [second, first] : [first, second];
  }
  return first > 12 && second <= 12 ? [first, second] : [second, first];
}

/**
 * Reads a printed date as `YYYY-MM-DD`: numeric (`14 02 1990`, `14.02.1990`, `1990-02-14`,
 * `14021990`) in the given order, or with an English, Spanish, French or German month name
 * (`14 FEB/FÉV 1990`). The C31.2 confusables (`O`, `I`, `l`, `S`, `B`, `Z`) count as digits inside
 * a number. A format hint (`(JJ.MM.AAAA)`) is dropped, and a day-first or month-first one sets the
 * order. Two-digit years are not read. `null` when the text is not a calendar date.
 */
export function parseVizDate(text: string, order: DateOrder = 'DMY'): string | null {
  const hinted = stripHints(text);
  return readDate(digitTokens(hinted.text), hinted.order ?? order);
}

function readDate(text: string, order: DateOrder): string | null {
  const words = fold(text)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map(digitsOf)
    .filter((word, index, all) => {
      const month = MONTHS[word];
      return month === undefined || index === 0 || MONTHS[all[index - 1] ?? ''] !== month;
    });
  const numbers = words.map((word) => (/^\d+$/.test(word) ? word : null));
  const monthIndex = words.findIndex((word) => MONTHS[word] !== undefined);
  if (monthIndex !== -1 && words.length === 3) {
    const month = MONTHS[words[monthIndex] ?? ''] ?? 0;
    // `14 FEB 1990` and `FEB 14 1990`: the day comes before the year either way.
    const [day = '', year = ''] = numbers.flatMap((value, index) =>
      index === monthIndex || value === null ? [] : [value],
    );
    return /^\d{1,2}$/.test(day) && /^\d{4}$/.test(year)
      ? calendarDate(Number(year), month, Number(day))
      : null;
  }
  if (!numbers.every((value) => value !== null)) {
    return null;
  }
  if (words.length === 1 && /^\d{8}$/.test(words[0] ?? '')) {
    const value = words[0] ?? '';
    const [day, month] = dayMonth(Number(value.slice(0, 2)), Number(value.slice(2, 4)), order);
    return (
      calendarDate(Number(value.slice(4)), month, day) ??
      calendarDate(Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6)))
    );
  }
  if (words.length === 2 && /^\d{4}$/.test(words[0] ?? '') && /^\d{4}$/.test(words[1] ?? '')) {
    // OCR ran the day and month together: `2103 1988`.
    const [joined = '', year = ''] = words;
    const [day, month] = dayMonth(Number(joined.slice(0, 2)), Number(joined.slice(2)), order);
    return calendarDate(Number(year), month, day);
  }
  if (words.length !== 3) {
    return null;
  }
  const [a = '', b = '', c = ''] = words;
  if (/^\d{4}$/.test(a) && /^\d{1,2}$/.test(b) && /^\d{1,2}$/.test(c)) {
    return calendarDate(Number(a), Number(b), Number(c));
  }
  if (!/^\d{1,2}$/.test(a) || !/^\d{1,2}$/.test(b) || !/^\d{4}$/.test(c)) {
    return null;
  }
  const [day, month] = dayMonth(Number(a), Number(b), order);
  return calendarDate(Number(c), month, day);
}

const collapse = (text: string): string => text.trim().replace(/\s+/g, ' ');

function nameValue(text: string): string | null {
  const value = collapse(text).toUpperCase();
  return /^\p{L}[\p{L} '’.-]*$/u.test(value) && value.length <= 100 ? value : null;
}

/** The Quebec licence number: one letter, 4, 6 and 2 digits, dashes or spaces optional. */
const QUEBEC_NUMBER = /^([A-Za-z])([\dOoIlSsBZz]{4})-?([\dOoIlSsBZz]{6})-?([\dOoIlSsBZz]{2})$/;

/**
 * A Quebec-shaped licence number, compact (`T123456789012`), its confusables mapped at the digit
 * positions only, each digit group holding at least one digit; `null` for any other text.
 */
function quebecNumber(text: string): string | null {
  const normalized = collapse(text)
    .replace(/\s*-\s*/g, '-')
    .replace(/ /g, '-');
  const match = QUEBEC_NUMBER.exec(normalized);
  if (match === null) {
    return null;
  }
  const [, letter = '', ...groups] = match;
  return groups.every((group) => /\d/.test(group))
    ? `${letter.toUpperCase()}${groups.map(confusedDigits).join('')}`
    : null;
}

function numberValue(text: string): string | null {
  const quebec = quebecNumber(text);
  if (quebec !== null) {
    return quebec;
  }
  const value = text.toUpperCase().replace(/[\s.-]+/g, '');
  return /^[A-Z0-9]{4,20}$/.test(value) && /\d/.test(value) ? value : null;
}

function textValue(text: string, max: number): string | null {
  const value = collapse(text);
  return value !== '' && value.length <= max ? value : null;
}

function fieldValue(field: LabelField, text: string, order: DateOrder): string | null {
  switch (field) {
    case 'name-first':
    case 'name-last':
      return nameValue(text);
    case 'birthdate':
    case 'issue-date':
    case 'expiration-date':
      return parseVizDate(text, order);
    case 'identification-number':
    case 'personal-number':
      return numberValue(text);
    case 'sex':
      return SEX_WORDS[fold(collapse(text))] ?? null;
    case 'nationality': {
      const code = fold(collapse(text));
      const normalized = /^(?:[A-Z]{3}|D)$/.test(code) ? normalizeCountryCode(code) : null;
      return normalized !== null && /^[A-Z]{3}$/.test(normalized) ? normalized : null;
    }
    case 'address-street-1':
      return textValue(text, 200);
  }
}

const top = (line: VizLine): number => line.box[1];
const bottom = (line: VizLine): number => line.box[1] + line.box[3];
const left = (line: VizLine): number => line.box[0];
const right = (line: VizLine): number => line.box[0] + line.box[2];
const height = (line: VizLine): number => line.box[3];

/** Whether a label line sits between `upper` and `lower` in `lower`'s column. */
function labelBetween(
  lines: readonly VizLine[],
  labels: ReadonlySet<number>,
  upper: VizLine,
  lower: VizLine,
): boolean {
  return [...labels].some((index) => {
    const line = lines[index];
    return (
      line !== undefined &&
      line !== upper &&
      top(line) >= top(upper) + 0.5 * height(upper) &&
      bottom(line) <= top(lower) + 0.5 * height(lower) &&
      Math.min(right(line), right(lower)) > Math.max(left(line), left(lower))
    );
  });
}

/**
 * Lines to the right on the same row, or below and aligned with no other label in between,
 * nearest first.
 */
function candidates(
  lines: readonly VizLine[],
  labelIndex: number,
  labels: ReadonlySet<number>,
): number[] {
  const label = lines[labelIndex];
  if (label === undefined) {
    return [];
  }
  const h = height(label);
  const scored: [index: number, score: number][] = [];
  lines.forEach((line, index) => {
    if (index === labelIndex) {
      return;
    }
    const overlap = Math.min(bottom(label), bottom(line)) - Math.max(top(label), top(line));
    const dx = left(line) - right(label);
    if (overlap >= 0.5 * Math.min(h, height(line)) && dx >= -0.5 * h && dx <= 8 * h) {
      scored.push([index, Math.max(0, dx) / h]);
      return;
    }
    const dy = top(line) - bottom(label);
    const aligned =
      Math.min(right(label), right(line)) > Math.max(left(label), left(line)) ||
      Math.abs(left(line) - left(label)) <= 2 * h;
    if (
      top(line) >= top(label) + 0.5 * h &&
      top(line) <= bottom(label) + 2.5 * Math.max(h, height(line)) &&
      aligned &&
      !labelBetween(lines, labels, label, line)
    ) {
      scored.push([index, Math.max(0, dy) / h]);
    }
  });
  return scored.sort((a, b) => a[1] - b[1]).map(([index]) => index);
}

/** The lines below an address value, stacked and aligned, until a label, a date or a gap. */
function addressBlock(
  lines: readonly VizLine[],
  first: number,
  labels: ReadonlySet<number>,
  order: DateOrder,
): number[] {
  const block = [first];
  while (block.length < 3) {
    const previous = lines[block.at(-1) ?? first];
    if (previous === undefined) {
      break;
    }
    const next = lines.findIndex(
      (line, index) =>
        !labels.has(index) &&
        !block.includes(index) &&
        top(line) >= top(previous) + 0.5 * height(previous) &&
        top(line) <= bottom(previous) + height(previous) &&
        Math.abs(left(line) - left(previous)) <= 2 * height(previous) &&
        !labelBetween(lines, labels, previous, line) &&
        parseVizDate(line.text, order) === null,
    );
    if (next === -1) {
      break;
    }
    block.push(next);
  }
  return block;
}

/** City, subdivision and postal code from an address's last line. */
function cityLine(text: string): Partial<Record<VizField, string>> {
  const value = collapse(text).toUpperCase();
  // eslint-disable-next-line security/detect-unsafe-regex -- collapse() leaves single spaces, so .+? and \s+ cannot trade a run; each start fails in bounded steps
  const northAmerican = /^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)$/.exec(
    value,
  );
  if (northAmerican) {
    return {
      'address-city': northAmerican[1] ?? '',
      'address-subdivision': northAmerican[2] ?? '',
      'address-postal-code': northAmerican[3] ?? '',
    };
  }
  const european = /^(\d{4,5})\s+(.+)$/.exec(value);
  if (european) {
    return { 'address-postal-code': european[1] ?? '', 'address-city': european[2] ?? '' };
  }
  return { 'address-city': value };
}

/**
 * The issuer code a document prints alone in its header (ICAO zone I): the one line of three
 * capital letters in the top fifth of the text, with no label near it.
 */
function headerCode(lines: readonly VizLine[], orphans: readonly number[]): number | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  const first = Math.min(...lines.map(top));
  const last = Math.max(...lines.map(bottom));
  const band = first + 0.2 * (last - first);
  const codes = orphans.filter((index) => {
    const line = lines[index];
    return line !== undefined && /^[A-Z]{3}$/.test(line.text.trim()) && top(line) <= band;
  });
  return codes.length === 1 ? codes[0] : undefined;
}

/**
 * The tokens of a line for the in-line date search: a letter run joins the digits beside it only
 * when every letter is a confusable (`2O21`, `I4`), so a misread label glued to a date
 * (`LF2021-03-15`) leaves the date apart.
 */
function searchTokens(text: string): string[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (match) => match[0]).flatMap((run) => {
    const merged: string[] = [];
    for (const piece of run.match(/\p{L}+|\p{N}+/gu) ?? []) {
      const last = merged.at(-1);
      if (last !== undefined && NUMERIC_LIKE.test(last) && NUMERIC_LIKE.test(piece)) {
        merged[merged.length - 1] = last + piece;
      } else {
        merged.push(piece);
      }
    }
    return merged;
  });
}

/**
 * The one date a line holds: the whole line, else a single date found inside it (three words, or
 * eight digits), the line's format hint setting the order. `null` without one or with two.
 */
function dateInside(text: string, order: DateOrder): string | null {
  const whole = parseVizDate(text, order);
  if (whole !== null) {
    return whole;
  }
  const hinted = stripHints(text);
  const lineOrder = hinted.order ?? order;
  const words = searchTokens(hinted.text);
  const found: string[] = [];
  words.forEach((word, index) => {
    const triple = words.slice(index, index + 3);
    const date = triple.length === 3 ? parseVizDate(triple.join(' '), lineOrder) : null;
    if (date !== null) {
      found.push(date);
    }
    if (/^\d{8}$/.test(confusedDigits(word))) {
      const single = parseVizDate(word, lineOrder);
      if (single !== null) {
        found.push(single);
      }
    }
  });
  return found.length === 1 ? (found[0] ?? null) : null;
}

function patternFields(
  lines: readonly VizLine[],
  orphans: readonly number[],
  order: DateOrder,
  now: Date,
  quebecLine: number | undefined,
): Partial<Record<VizField, VizFieldReading>> {
  const today = now.toISOString().slice(0, 10);
  const yearsAgo = (years: number): string =>
    `${String(now.getUTCFullYear() - years)}${today.slice(4)}`;
  const dates = orphans.flatMap((index) => {
    const value = dateInside(lines[index]?.text ?? '', order);
    return value === null ? [] : [{ index, value }];
  });
  const datedLines = new Set(dates.map(({ index }) => index));
  const only = (list: typeof dates) => (list.length === 1 ? list[0] : undefined);
  const future = only(dates.filter(({ value }) => value > today));
  const birth = only(dates.filter(({ value }) => value <= yearsAgo(16)));
  const issue = only(dates.filter(({ value }) => value <= today && value > yearsAgo(15)));
  const numbers = orphans.filter((index) => {
    const text = lines[index]?.text.trim() ?? '';
    return !datedLines.has(index) && /^(?=.*\d)[A-Z0-9]{6,12}$/.test(text);
  });
  const reading = (entry: { index: number; value: string } | undefined) =>
    entry === undefined
      ? undefined
      : { value: entry.value, lineIndex: entry.index, via: 'pattern' as const };
  const number = numbers.length === 1 ? numbers[0] : undefined;
  const issuer = headerCode(lines, orphans);
  const quebec =
    quebecLine !== undefined && orphans.includes(quebecLine)
      ? quebecNumber(lines[quebecLine]?.text ?? '')
      : null;
  const entries: [VizField, VizFieldReading | undefined][] = [
    ['expiration-date', reading(future)],
    ['birthdate', reading(birth)],
    ['issue-date', reading(issue)],
    [
      'identification-number',
      quebec !== null && quebecLine !== undefined
        ? { value: quebec, lineIndex: quebecLine, via: 'pattern' }
        : number === undefined
          ? undefined
          : { value: lines[number]?.text.trim() ?? '', lineIndex: number, via: 'pattern' },
    ],
    [
      'issuing-authority-code',
      issuer === undefined
        ? undefined
        : { value: lines[issuer]?.text.trim() ?? '', lineIndex: issuer, via: 'pattern' },
    ],
  ];
  return Object.fromEntries(
    entries.filter((entry): entry is [VizField, VizFieldReading] => entry[1] !== undefined),
  );
}

/** A tiny printed field number on its own line (`1`, `4a`), which the layout rule steps over. */
const isFieldNumber = (text: string): boolean => /^\d{1,2}[A-Z]?$/.test(fold(text.trim()));

/**
 * The one line holding a Quebec-shaped licence number, alone or after a number label; `undefined`
 * with none or several.
 */
function quebecNumberLine(
  lines: readonly VizLine[],
  kinds: readonly LineKind[],
  mrz: ReadonlySet<number>,
): number | undefined {
  const found = lines.flatMap((line, index) => {
    const kind = kinds[index];
    const text =
      kind?.kind === 'inline' && kind.field === 'identification-number' ? kind.value : line.text;
    return !mrz.has(index) && kind?.kind !== 'label' && quebecNumber(text) !== null ? [index] : [];
  });
  return found.length === 1 ? found[0] : undefined;
}

/** Whether the document reads as a Quebec licence (C2): the barcode says so, or the print does. */
function readsAsQuebec(
  lines: readonly VizLine[],
  numberLine: number | undefined,
  jurisdiction: VizJurisdiction | null | undefined,
): boolean {
  if (numberLine === undefined) {
    return false;
  }
  if (jurisdiction?.country === 'CA' && jurisdiction.code === 'QC') {
    return true;
  }
  return lines.some((line) => {
    const words = tokens(line.text);
    return words.length === 1 && words[0]?.word === 'QUEBEC';
  });
}

/**
 * The Quebec layout rule (C2): the two lines straight under the licence number, each starting
 * within three number-line heights below the line above it and aligned with the number's column
 * (overlapping it, or its left edge within two heights), field numbers stepped over. Both must be
 * plain text lines no reading used, with a valid name (letters only, so never a date, a number or
 * an MRZ line): the first is the surname, the second the given names. Both or neither.
 */
function quebecNames(
  lines: readonly VizLine[],
  kinds: readonly LineKind[],
  numberLine: number,
  blocked: ReadonlySet<number>,
): [last: { index: number; value: string }, first: { index: number; value: string }] | null {
  const anchor = lines[numberLine];
  if (anchor === undefined) {
    return null;
  }
  const h = height(anchor);
  const chain: { index: number; value: string }[] = [];
  let previous = anchor;
  while (chain.length < 2) {
    const above = previous;
    const next = lines
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line, index }) =>
          index !== numberLine &&
          !chain.some((entry) => entry.index === index) &&
          !isFieldNumber(line.text) &&
          top(line) >= top(above) + 0.5 * height(above) &&
          top(line) - bottom(above) <= 3 * h &&
          (Math.min(right(anchor), right(line)) > Math.max(left(anchor), left(line)) ||
            Math.abs(left(line) - left(anchor)) <= 2 * h),
      )
      .sort((a, b) => top(a.line) - top(b.line))[0];
    if (next === undefined || blocked.has(next.index) || kinds[next.index]?.kind !== 'text') {
      return null;
    }
    const value = nameValue(next.line.text);
    if (value === null || isMrzLike(next.line.text)) {
      return null;
    }
    chain.push({ index: next.index, value });
    previous = next.line;
  }
  const [last, first] = chain;
  return last === undefined || first === undefined ? null : [last, first];
}

/** Reads the visual-zone fields of one side's OCR lines (C31.1). */
export function parseViz(lines: readonly VizLine[], options: VizParseOptions = {}): VizParse {
  const order = options.dateOrder ?? 'DMY';
  const kinds = lines.map((line) =>
    isMrzLike(line.text) ? ({ kind: 'text' } as const) : classify(line.text),
  );
  const labels = new Set(kinds.flatMap((kind, index) => (kind.kind === 'text' ? [] : [index])));
  const mrz = new Set(lines.flatMap((line, index) => (isMrzLike(line.text) ? [index] : [])));
  const fields: Partial<Record<VizField, VizFieldReading>> = {};
  const used = new Set<number>();
  const nearLabel = new Set<number>();
  const assign = (field: VizField, value: string, lineIndex: number): void => {
    fields[field] = { value, lineIndex, via: 'label' };
    used.add(lineIndex);
  };

  kinds.forEach((kind, index) => {
    if (kind.kind === 'inline' && fields[kind.field] === undefined) {
      const value = fieldValue(kind.field, kind.value, kind.order ?? order);
      if (value !== null) {
        assign(kind.field, value, index);
      }
    }
  });
  const labelEntries = kinds
    .flatMap((kind, index) => (kind.kind === 'label' ? [{ kind, index }] : []))
    .sort((a, b) => a.kind.rank - b.kind.rank || a.index - b.index);
  labelEntries.forEach(({ kind, index }) => {
    const near = candidates(lines, index, labels).filter(
      (candidate) => !labels.has(candidate) && !mrz.has(candidate),
    );
    near.forEach((candidate) => nearLabel.add(candidate));
    if (fields[kind.field] !== undefined) {
      return;
    }
    for (const candidate of near.filter((line) => !used.has(line))) {
      const value = fieldValue(kind.field, lines[candidate]?.text ?? '', kind.order ?? order);
      if (value === null) {
        continue;
      }
      if (kind.field !== 'address-street-1') {
        assign(kind.field, value, candidate);
        return;
      }
      const block = addressBlock(lines, candidate, labels, order);
      block.forEach((line) => {
        used.add(line);
        nearLabel.add(line);
      });
      const [street, second, third] = block.map((line) => lines[line]?.text ?? '');
      assign('address-street-1', value, candidate);
      const last = third ?? second;
      const lastIndex = block.at(-1) ?? candidate;
      if (third !== undefined && second !== undefined && block[1] !== undefined) {
        const street2 = textValue(second, 200);
        if (street2 !== null) {
          assign('address-street-2', street2, block[1]);
        }
      }
      if (last !== undefined && street !== undefined) {
        for (const [field, part] of Object.entries(cityLine(last)) as [VizField, string][]) {
          assign(field, part, lastIndex);
        }
      }
      return;
    }
  });

  const orphans = lines.flatMap((_, index) =>
    labels.has(index) || mrz.has(index) || used.has(index) || nearLabel.has(index) ? [] : [index],
  );
  const numberLine = quebecNumberLine(lines, kinds, mrz);
  for (const [field, reading] of Object.entries(
    patternFields(lines, orphans, order, options.now ?? new Date(), numberLine),
  ) as [VizField, VizFieldReading][]) {
    fields[field] ??= reading;
  }
  if (
    numberLine !== undefined &&
    fields['name-last'] === undefined &&
    fields['name-first'] === undefined &&
    readsAsQuebec(lines, numberLine, options.jurisdiction)
  ) {
    const names = quebecNames(lines, kinds, numberLine, used);
    if (names !== null) {
      const [last, first] = names;
      fields['name-last'] = { value: last.value, lineIndex: last.index, via: 'layout' };
      fields['name-first'] = { value: first.value, lineIndex: first.index, via: 'layout' };
    }
  }
  return { fields, labelLines: [...labels].sort((a, b) => a - b) };
}
