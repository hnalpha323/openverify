/**
 * Synthetic documents for the document evaluator tests: invented issuers ("Utopia Water Board"),
 * people (Quinn Valemont), streets and towns, an unassigned ZIP code (00000) and IBANs whose check
 * digits are computed here over made-up account numbers. Lines are laid out top to bottom on a
 * Letter page raster (1700 x 2200 pixels) unless a box is given. Not exported from the package.
 */
import type { CheckId, VerificationTemplateConfig } from '@openverify/core';
import type {
  DocumentAnalysisInput,
  DocumentBox,
  DocumentCheckInput,
  DocumentClass,
  DocumentHiddenReason,
  DocumentImageInput,
  DocumentOcrLineInput,
  DocumentPageInput,
  DocumentPdfInput,
  DocumentReferences,
  DocumentTextLayerLineInput,
} from './inputs.js';

export const NOW = new Date('2026-10-23T12:00:00Z');
export const PAGE_WIDTH = 1700;
export const PAGE_HEIGHT = 2200;

/** A line to lay out: its text, and optionally its box or where it sits. */
export type LineSpec =
  | string
  | {
      readonly text: string;
      readonly box?: DocumentBox;
      readonly x?: number;
      readonly y?: number;
      readonly height?: number;
      readonly fontIds?: readonly number[];
      readonly hidden?: DocumentHiddenReason;
    };

const CHARACTER_WIDTH = 22;
const LINE_HEIGHT = 40;
const LINE_STEP = 50;

interface PlacedLine {
  readonly text: string;
  readonly box: DocumentBox;
  readonly fontIds: readonly number[];
  readonly hidden: DocumentHiddenReason | null;
}

/** Lays lines out from y = 150, 50 px apart, at x = 150, unless a line says otherwise. */
export function placeLines(specs: readonly LineSpec[]): PlacedLine[] {
  let y = 150;
  return specs.map((spec) => {
    const line = typeof spec === 'string' ? { text: spec } : spec;
    const height = line.height ?? LINE_HEIGHT;
    const top = line.y ?? y;
    const box: DocumentBox = line.box ?? [
      line.x ?? 150,
      top,
      Math.min(PAGE_WIDTH - 160, Math.max(40, line.text.length * CHARACTER_WIDTH)),
      height,
    ];
    y = Math.max(y, box[1]) + LINE_STEP + (height - LINE_HEIGHT);
    return { text: line.text, box, fontIds: line.fontIds ?? [0], hidden: line.hidden ?? null };
  });
}

export function textLayerLine(line: PlacedLine): DocumentTextLayerLineInput {
  return {
    text: line.text,
    box: line.box,
    font_ids: line.fontIds,
    font_size_pt: 10,
    visible: line.hidden === null,
    hidden_reason: line.hidden,
  };
}

export function ocrLine(line: PlacedLine, confidence = 0.97): DocumentOcrLineInput {
  return { text: line.text, confidence, box: line.box };
}

/**
 * A born-digital PDF page: the text layer is the lines, OCR reads every visible line as printed
 * (or as `ocr` says, by line index).
 */
export function pdfPage(
  specs: readonly LineSpec[],
  options: {
    readonly number?: number;
    readonly ocr?: Readonly<Record<number, string | null>>;
    readonly agreement?: number | null;
  } = {},
): DocumentPageInput {
  const placed = placeLines(specs);
  const ocr = placed.flatMap((line, index) => {
    const read = options.ocr?.[index];
    if (read === null || (read === undefined && line.hidden !== null)) {
      return [];
    }
    return [ocrLine({ ...line, text: read ?? line.text })];
  });
  return {
    number: options.number ?? 1,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    width_pt: 612,
    height_pt: 792,
    text_layer: placed.map(textLayerLine),
    ocr,
    text_layer_ocr_agreement:
      options.agreement === undefined ? (ocr.length > 0 ? 0.96 : null) : options.agreement,
  };
}

/** A photo's (or a scan's) page: OCR lines only. */
export function photoPage(
  specs: readonly LineSpec[],
  options: { readonly number?: number } = {},
): DocumentPageInput {
  return {
    number: options.number ?? 1,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    width_pt: null,
    height_pt: null,
    text_layer: [],
    ocr: placeLines(specs).map((line) => ocrLine(line)),
    text_layer_ocr_agreement: null,
  };
}

/** A genuine-looking synthetic PDF's structure: one revision, no edit traces. */
export const GENUINE_PDF: DocumentPdfInput = Object.freeze({
  producer: 'Utopia Billing Engine 4.2',
  creator: 'Utopia Billing Engine 4.2',
  creation_date: '2026-09-30T06:00:00Z',
  modification_date: '2026-09-30T06:00:00Z',
  xmp: null,
  linearized: false,
  revisions: 1,
  xref_repaired: false,
  eof_markers: 1,
  bytes_after_last_eof: 0,
  object_streams: 0,
  fonts: Object.freeze([
    { id: 0, base_name: 'Helvetica', subset_tag: null, embedded: false },
    { id: 1, base_name: 'Helvetica-Bold', subset_tag: null, embedded: false },
  ]),
  annotations: 0,
  form_fields: 0,
  actions: Object.freeze({
    javascript: 0,
    launch: 0,
    submit_form: 0,
    goto_remote: 0,
    rich_media: 0,
    embedded_files: 0,
  }),
  signatures: 0,
  edits_after_signature: false,
});

/** A phone photo's forensics: nothing edited, low scores. */
export const GENUINE_PHOTO: DocumentImageInput = Object.freeze({
  exif_software: null,
  exif_datetime_original: '2026-10-02T18:41:07',
  exif_datetime: '2026-10-02T18:41:07',
  jpeg_quality: 87,
  double_compression_score: 0.04,
  ela_text_cell_score: 0.07,
  copy_move_score: 0.01,
});

/** The first three pages and the last, 1-based (C60.1). */
function analysedPages(count: number): number[] {
  const first = Array.from({ length: Math.min(count, 3) }, (_, index) => index + 1);
  return first.includes(count) ? first : [...first, count];
}

export function pdfAnalysis(
  pages: readonly DocumentPageInput[],
  pdf: Partial<DocumentPdfInput> = {},
  pageCount = pages.length,
): DocumentAnalysisInput {
  return {
    source: 'pdf',
    page_count: pageCount,
    analysed_pages: analysedPages(pageCount),
    pages,
    pdf: { ...GENUINE_PDF, ...pdf },
    image: null,
  };
}

export function photoAnalysis(
  page: DocumentPageInput,
  image: Partial<DocumentImageInput> = {},
): DocumentAnalysisInput {
  return {
    source: 'image',
    page_count: 1,
    analysed_pages: [1],
    pages: [page],
    pdf: null,
    image: { ...GENUINE_PHOTO, ...image },
  };
}

/** ISO 13616 check digits over a made-up account number, so the IBAN is valid and fictitious. */
export function syntheticIban(country: string, bban: string): string {
  const digits = `${bban}${country}00`
    .split('')
    .map((character) => String(Number.parseInt(character, 36)))
    .join('');
  let remainder = 0;
  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  const check = String(98 - remainder).padStart(2, '0');
  const compact = `${country}${check}${bban}`;
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

/** The synthetic holder every reference and document names. */
export const HOLDER = Object.freeze({
  first: 'Quinn',
  last: 'Valemont',
  street: '14 Lantern Row',
  city: 'Meridale',
  subdivision: 'UT',
  postalCode: '00000',
  country: 'US',
});

/** The inquiry's fields as the reference (C60.6). */
export const INQUIRY_REFERENCE: DocumentReferences = Object.freeze({
  inquiry: {
    name: { first: HOLDER.first, last: HOLDER.last },
    address: {
      street1: HOLDER.street,
      city: HOLDER.city,
      subdivision: HOLDER.subdivision,
      postalCode: HOLDER.postalCode,
      countryCode: HOLDER.country,
    },
  },
});

/** An English utility bill, laid out as a bill is: issuer, dates, the addressee block, the amounts. */
export function utilityBillLines(
  options: { readonly issueDate?: string; readonly name?: string } = {},
): LineSpec[] {
  return [
    { text: 'UTOPIA WATER BOARD', height: 70, fontIds: [1] },
    `Statement date: ${options.issueDate ?? '30 September 2026'}`,
    'Account number: 4471-2208-19',
    { text: options.name ?? 'QUINN VALEMONT', y: 520 },
    '14 LANTERN ROW',
    'MERIDALE UT 00000',
    { text: 'Billing period: 01 Jul 2026 - 30 Sep 2026', y: 800 },
    'Meter reading: 18.4 m3',
    'Water used this period: 18.4 m3',
    'Amount due: 48.20',
    'Due date: 21 October 2026',
    'Please pay by direct debit from your account.',
  ];
}

/** The bill's born-digital PDF, every line visible and read the same by OCR. */
export function utilityBillPdf(
  options: { readonly issueDate?: string } = {},
): DocumentAnalysisInput {
  return pdfAnalysis([pdfPage(utilityBillLines(options))]);
}

/** A template config enabling `checks` (all required), as a verification template holds it. */
export function templateOf(
  checks: readonly CheckId[],
  config: Partial<Record<CheckId, Record<string, unknown>>> = {},
): VerificationTemplateConfig {
  return {
    checks: Object.fromEntries(
      checks.map((id) => [
        id,
        {
          enabled: true,
          required: true,
          ...(config[id] === undefined ? {} : { config: config[id] }),
        },
      ]),
    ),
  };
}

/** A document check input: the analysis, the step's classes, the inquiry reference, now. */
export function documentInput(
  analysis: DocumentAnalysisInput,
  overrides: Partial<DocumentCheckInput> = {},
  acceptedTypes: readonly DocumentClass[] = ['utility_bill', 'bank_statement'],
): DocumentCheckInput {
  return {
    vision: { kind: 'analysis', analysis },
    acceptedTypes,
    references: INQUIRY_REFERENCE,
    now: NOW,
    ...overrides,
  };
}

/**
 * The CPU time `run` takes, in milliseconds: this test process's user and system time. C58.7's
 * bounds are on the work a capped input costs, which other processes on a loaded machine do not
 * add to (`pnpm test` runs every package at once), unlike the wall clock.
 */
export function cpuMilliseconds(run: () => void): number {
  const before = process.cpuUsage();
  run();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

let referenceSink = 0;

/** A fixed workload of string building and map updates, about 120 ms of CPU on the machine the limits were set on. */
function referenceWorkload(): void {
  const seen = new Map<string, number>();
  for (let index = 0; index < 300_000; index += 1) {
    const word = `w${String((index * 7919) % 20_011)}`.padEnd(12, 'x').toUpperCase().slice(1);
    seen.set(word, (seen.get(word) ?? 0) + word.charCodeAt(index % 11));
  }
  referenceSink += seen.size;
}

/**
 * The CPU time of `run` as a multiple of the reference workload's, each the least of `rounds` interleaved
 * measurements. Both grow together on a loaded or throttled machine, so a bound on the ratio holds where a bound
 * on the CPU time alone does not (rule 6); the least of each drops a collection that lands in one round.
 */
export function cpuTimesReference(run: () => void, rounds = 3): number {
  let reference = Number.POSITIVE_INFINITY;
  let work = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round += 1) {
    reference = Math.min(reference, cpuMilliseconds(referenceWorkload));
    work = Math.min(work, cpuMilliseconds(run));
  }
  return referenceSink > 0 ? work / reference : Number.NaN;
}
