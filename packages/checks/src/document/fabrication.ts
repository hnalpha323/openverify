/**
 * The fabrication score (C60.6, H11; H tier, `beta`): `score = 1 − Π(1 − wᵢ·sᵢ)` over the cues of
 * {@link FABRICATION_SIGNALS}, where `sᵢ` in [0, 1] is how strongly vision's measurements show
 * cue i and `wᵢ` its weight, with the weak cues' combined contribution capped at
 * {@link FABRICATION_WEAK_CUE_CAP} (0.45), so only a medium or strong cue can fail the default
 * threshold of 0.5. Cues that fire on genuine PDFs are not cues: DocumentID ≠ InstanceID, a
 * ModDate after the printed date, a GoTo `/OpenAction`, linearization, signatures extended for
 * long-term validation (C60.1 leaves those out), an invisible OCR layer over a scan, and an
 * embedded file (e-invoices embed their XML). Weights are ours and provisional, fixed here and
 * not tuned on the generated set (H23).
 */
import type { DocumentExtraction } from './extract.js';
import type {
  DocumentAnalysisInput,
  DocumentPageInput,
  DocumentPdfFontInput,
  DocumentPdfInput,
} from './inputs.js';
import { isMoneyAmount } from './layout.js';

export const FABRICATION_SIGNAL_IDS = [
  'incremental-revisions',
  'xref-repaired',
  'editor-producer',
  'created-before-issue-date',
  'metadata-inconsistent',
  'image-editor-software',
  'amount-line-font',
  'mixed-font-subsets',
  'text-layer-mismatch',
  'double-compression-ela',
  'hidden-text-over-field',
  'edits-after-signature',
  'active-content',
  'copy-move',
] as const;
export type FabricationSignalId = (typeof FABRICATION_SIGNAL_IDS)[number];

/** Weak cues weigh at most 0.2, medium ones 0.4 to 0.5, strong ones 0.6 or more (C60.6). */
export type FabricationCueStrength = 'weak' | 'medium' | 'strong';

export interface FabricationSignal {
  readonly id: FabricationSignalId;
  /** The `document_fabrication_detection` reason the cue fails with. */
  readonly reason: string;
  readonly strength: FabricationCueStrength;
  readonly weight: number;
}

/**
 * Every cue, its reason, strength and weight (ours, provisional; C60.6). How each is read:
 *
 * | Cue | Read as 1 when (else 0) |
 * |---|---|
 * | `incremental-revisions` | the PDF has more than one revision (a linearized first-page section is not one, C60.1) |
 * | `xref-repaired` | PDFium had to repair the cross-reference table |
 * | `editor-producer` | the producer, creator, XMP creator tool or XMP history names a PDF or image editor |
 * | `created-before-issue-date` | the PDF's CreationDate is more than a day before the printed issue date |
 * | `metadata-inconsistent` | the Info producer, creation or modification date disagrees with XMP's (a day's slack) |
 * | `image-editor-software` | a photo's EXIF software names an image editor |
 * | `amount-line-font` | a visible line holding an amount is set in two font families |
 * | `mixed-font-subsets` | one page uses two subsets of one base font |
 * | `text-layer-mismatch` | a field's text layer disagreed with OCR (1), else `(0.8 − agreement) / 0.2` of the least agreeing page, in [0, 1] |
 * | `double-compression-ela` | the lower of the double-compression and text-cell ELA scores |
 * | `hidden-text-over-field` | a born-digital page holds a covered, background-coloured or render-mode-3 line with a digit |
 * | `edits-after-signature` | the PDF was edited after a signature (DSS and DocTimeStamp increments excluded, C60.1) |
 * | `active-content` | JavaScript, Launch, SubmitForm, GoToR or RichMedia actions (not an embedded file) |
 * | `copy-move` | vision's copy-move score |
 */
export const FABRICATION_SIGNALS: readonly FabricationSignal[] = Object.freeze([
  { id: 'incremental-revisions', reason: 'pdf_incremental_update', strength: 'weak', weight: 0.15 },
  { id: 'xref-repaired', reason: 'pdf_incremental_update', strength: 'weak', weight: 0.1 },
  { id: 'editor-producer', reason: 'pdf_editor_producer', strength: 'weak', weight: 0.2 },
  {
    id: 'created-before-issue-date',
    reason: 'pdf_created_before_issue_date',
    strength: 'weak',
    weight: 0.15,
  },
  {
    id: 'metadata-inconsistent',
    reason: 'pdf_metadata_inconsistent',
    strength: 'weak',
    weight: 0.1,
  },
  { id: 'image-editor-software', reason: 'image_editor_software', strength: 'weak', weight: 0.2 },
  { id: 'amount-line-font', reason: 'pdf_font_inconsistent', strength: 'medium', weight: 0.45 },
  { id: 'mixed-font-subsets', reason: 'pdf_font_inconsistent', strength: 'medium', weight: 0.4 },
  {
    id: 'text-layer-mismatch',
    reason: 'pdf_text_layer_mismatch',
    strength: 'medium',
    weight: 0.45,
  },
  { id: 'double-compression-ela', reason: 'image_tampered', strength: 'medium', weight: 0.45 },
  { id: 'hidden-text-over-field', reason: 'pdf_hidden_text', strength: 'strong', weight: 0.7 },
  {
    id: 'edits-after-signature',
    reason: 'pdf_signature_invalidated',
    strength: 'strong',
    weight: 0.7,
  },
  { id: 'active-content', reason: 'pdf_active_content', strength: 'strong', weight: 0.6 },
  { id: 'copy-move', reason: 'image_tampered', strength: 'strong', weight: 0.6 },
] satisfies readonly FabricationSignal[]);

/** The weak cues' combined contribution is capped here (C60.6). */
export const FABRICATION_WEAK_CUE_CAP = 0.45;
/** A cue is a failure's reason when it contributes at least this much (C60.6). */
export const FABRICATION_REASON_MIN_CONTRIBUTION = 0.1;
/** The confidence is the score's margin from the threshold, capped here (C60.6). */
export const FABRICATION_CONFIDENCE_CAP = 0.6;

/** How strongly each measured cue shows, in [0, 1]; a cue left out was not measured. */
export type FabricationSignalValues = Readonly<Partial<Record<FabricationSignalId, number>>>;

export interface FabricationComponent {
  readonly id: FabricationSignalId;
  readonly strength: FabricationCueStrength;
  readonly weight: number;
  /** `sᵢ`. */
  readonly signal: number;
  /** `wᵢ·sᵢ`, scaled down with the other weak cues when their cap applies. */
  readonly contribution: number;
}

export interface FabricationAssessment {
  readonly score: number;
  /** Every measured cue, in {@link FABRICATION_SIGNAL_IDS} order. */
  readonly components: readonly FabricationComponent[];
  /** The reasons of the cues contributing at least 0.1, in signal order, without repeats. */
  readonly reasons: readonly string[];
}

/**
 * Products whose use is editing an existing PDF or image (ours; matched case-insensitively within
 * the producer, creator and XMP values). Converters and generators are not listed.
 */
const PDF_EDITORS = [
  'pdfelement',
  'phantompdf',
  'foxit pdf editor',
  'nitro pro',
  'nitro pdf',
  'sejda',
  'ilovepdf',
  'smallpdf',
  'pdf-xchange editor',
  'pdfescape',
  'pdffiller',
  'dochub',
  'soda pdf',
  'pdf candy',
  'inkscape',
  'libreoffice draw',
  'photoshop',
  'gimp',
  'canva',
] as const;
const IMAGE_EDITORS = [
  'photoshop',
  'gimp',
  'lightroom',
  'snapseed',
  'pixelmator',
  'affinity photo',
  'paint.net',
  'picsart',
  'canva',
  'pixlr',
  'photopea',
  'fotor',
] as const;

/** The agreement below which the text layer starts to disagree, and where it fully does. */
const AGREEMENT_FULL = 0.8;
const AGREEMENT_RANGE = 0.2;
const DAY_MS = 86_400_000;
/** The hidden reasons that put text where no reader sees it (C60.1). */
const CONCEALING: ReadonlySet<string> = new Set([
  'covered',
  'background_fill',
  'render_mode_invisible',
]);
const DIGIT = /\d/;
const FONT_SUFFIX = /(?:PSMT|PS|MT)$/;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const named = (value: string | null | undefined, products: readonly string[]) =>
  value !== null &&
  value !== undefined &&
  products.some((product) => value.toLowerCase().includes(product));

const instant = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

/** The family of a base font: `Arial-BoldMT` is `Arial`, `TimesNewRomanPSMT` `TimesNewRoman`. */
function fontFamily(font: DocumentPdfFontInput | undefined): string | null {
  if (font === undefined) {
    return null;
  }
  const dash = font.base_name.indexOf('-');
  const comma = font.base_name.indexOf(',');
  const cuts = [dash, comma].filter((at) => at !== -1);
  const base = cuts.length === 0 ? font.base_name : font.base_name.slice(0, Math.min(...cuts));
  return base.replace(FONT_SUFFIX, '').toLowerCase();
}

const bornDigital = (page: DocumentPageInput) => page.text_layer.some((line) => line.visible);

function editorNamed(pdf: DocumentPdfInput): number {
  const values = [
    pdf.producer,
    pdf.creator,
    pdf.xmp?.creator_tool,
    pdf.xmp?.producer,
    ...(pdf.xmp?.history_agents ?? []),
  ];
  return values.some((value) => named(value, PDF_EDITORS)) ? 1 : 0;
}

function createdBeforeIssue(
  pdf: DocumentPdfInput,
  extraction: DocumentExtraction | null,
): number | undefined {
  const created = instant(pdf.creation_date);
  const printed =
    extraction?.issueDateSource === 'label' ||
    extraction?.issueDateSource === 'period' ||
    extraction?.issueDateSource === 'generic';
  const readings = printed ? (extraction.issueDate?.readings ?? []) : [];
  if (created === null || readings.length === 0) {
    return undefined;
  }
  const day = Math.floor(created / DAY_MS) * DAY_MS;
  return readings.every((reading) => day < Date.parse(`${reading}T00:00:00Z`) - DAY_MS) ? 1 : 0;
}

function metadataInconsistent(pdf: DocumentPdfInput): number | undefined {
  const { xmp } = pdf;
  if (xmp === null) {
    return undefined;
  }
  const producers = [pdf.producer, xmp.producer].map((value) => value?.trim().toLowerCase() ?? '');
  const [info = '', meta = ''] = producers;
  const producerDiffers =
    info !== '' && meta !== '' && !info.includes(meta) && !meta.includes(info);
  const differs = (a: string | null, b: string | null) => {
    const x = instant(a);
    const y = instant(b);
    return x !== null && y !== null && Math.abs(x - y) > DAY_MS;
  };
  return producerDiffers ||
    differs(pdf.creation_date, xmp.create_date) ||
    differs(pdf.modification_date, xmp.modify_date)
    ? 1
    : 0;
}

function amountLineFont(analysis: DocumentAnalysisInput, pdf: DocumentPdfInput): number {
  return analysis.pages.some((page) =>
    page.text_layer.some((line) => {
      if (!line.visible || !line.text.split(/\s+/).some((word) => isMoneyAmount(word))) {
        return false;
      }
      const families = new Set(
        line.font_ids.flatMap((id) => {
          const family = fontFamily(pdf.fonts[id]);
          return family === null ? [] : [family];
        }),
      );
      return families.size >= 2;
    }),
  )
    ? 1
    : 0;
}

function mixedSubsets(analysis: DocumentAnalysisInput, pdf: DocumentPdfInput): number {
  return analysis.pages.some((page) => {
    const tags = new Map<string, Set<string>>();
    for (const line of page.text_layer) {
      for (const id of line.font_ids) {
        const font = pdf.fonts[id];
        if (font?.subset_tag !== null && font?.subset_tag !== undefined) {
          const known = tags.get(font.base_name) ?? new Set<string>();
          known.add(font.subset_tag);
          tags.set(font.base_name, known);
        }
      }
    }
    return [...tags.values()].some((set) => set.size >= 2);
  })
    ? 1
    : 0;
}

function textLayerMismatch(
  analysis: DocumentAnalysisInput,
  extraction: DocumentExtraction | null,
): number | undefined {
  const agreements = analysis.pages.flatMap((page) =>
    page.text_layer_ocr_agreement === null ? [] : [page.text_layer_ocr_agreement],
  );
  if (extraction?.textLayerMismatch === true) {
    return 1;
  }
  if (agreements.length === 0) {
    return undefined;
  }
  return clamp((AGREEMENT_FULL - Math.min(...agreements)) / AGREEMENT_RANGE);
}

function hiddenTextOverField(analysis: DocumentAnalysisInput): number {
  return analysis.pages.some(
    (page) =>
      bornDigital(page) &&
      page.text_layer.some(
        (line) =>
          !line.visible &&
          line.hidden_reason !== null &&
          CONCEALING.has(line.hidden_reason) &&
          DIGIT.test(line.text),
      ),
  )
    ? 1
    : 0;
}

function activeContent(pdf: DocumentPdfInput): number {
  const {
    javascript,
    launch,
    submit_form: submit,
    goto_remote: remote,
    rich_media: media,
  } = pdf.actions;
  return javascript + launch + submit + remote + media > 0 ? 1 : 0;
}

/** How strongly the measurements show each cue (C60.1 in, C60.6 out). */
export function documentFabricationSignals(
  analysis: DocumentAnalysisInput,
  extraction: DocumentExtraction | null,
): FabricationSignalValues {
  const values: Partial<Record<FabricationSignalId, number>> = {};
  const { pdf, image } = analysis;
  const hasTextLayer = analysis.pages.some((page) => page.text_layer.length > 0);
  if (pdf !== null) {
    values['incremental-revisions'] = pdf.revisions > 1 ? 1 : 0;
    values['xref-repaired'] = pdf.xref_repaired ? 1 : 0;
    values['editor-producer'] = editorNamed(pdf);
    const created = createdBeforeIssue(pdf, extraction);
    if (created !== undefined) {
      values['created-before-issue-date'] = created;
    }
    const metadata = metadataInconsistent(pdf);
    if (metadata !== undefined) {
      values['metadata-inconsistent'] = metadata;
    }
  }
  if (image !== null) {
    values['image-editor-software'] = named(image.exif_software, IMAGE_EDITORS) ? 1 : 0;
  }
  if (pdf !== null && hasTextLayer) {
    values['amount-line-font'] = amountLineFont(analysis, pdf);
    values['mixed-font-subsets'] = mixedSubsets(analysis, pdf);
  }
  const mismatch = textLayerMismatch(analysis, extraction);
  if (mismatch !== undefined) {
    values['text-layer-mismatch'] = mismatch;
  }
  const doubled = image?.double_compression_score ?? null;
  const ela = image?.ela_text_cell_score ?? null;
  if (doubled !== null && ela !== null) {
    values['double-compression-ela'] = clamp(Math.min(doubled, ela));
  }
  if (pdf !== null && hasTextLayer) {
    values['hidden-text-over-field'] = hiddenTextOverField(analysis);
  }
  if (pdf !== null) {
    values['edits-after-signature'] = pdf.edits_after_signature ? 1 : 0;
    values['active-content'] = activeContent(pdf);
  }
  if (image !== null && image.copy_move_score !== null) {
    values['copy-move'] = clamp(image.copy_move_score);
  }
  return values;
}

/** The score, its components and the reasons of the measured cues. */
export function assessDocumentFabrication(values: FabricationSignalValues): FabricationAssessment {
  const measured = FABRICATION_SIGNALS.flatMap((signal) => {
    const value = values[signal.id];
    return value === undefined || Number.isNaN(value) ? [] : [{ signal, value: clamp(value) }];
  });
  const product = (items: typeof measured) =>
    items.reduce((rest, { signal, value }) => rest * (1 - signal.weight * value), 1);
  const weak = measured.filter(({ signal }) => signal.strength === 'weak');
  const rest = measured.filter(({ signal }) => signal.strength !== 'weak');
  const weakUncapped = 1 - product(weak);
  const weakCapped = Math.min(FABRICATION_WEAK_CUE_CAP, weakUncapped);
  const scale = weakUncapped > FABRICATION_WEAK_CUE_CAP ? weakCapped / weakUncapped : 1;
  const score = 1 - (1 - weakCapped) * product(rest);
  const components: FabricationComponent[] = measured.map(({ signal, value }) => ({
    id: signal.id,
    strength: signal.strength,
    weight: signal.weight,
    signal: value,
    contribution: signal.weight * value * (signal.strength === 'weak' ? scale : 1),
  }));
  const reasons = [
    ...new Set(
      components
        .filter((component) => component.contribution >= FABRICATION_REASON_MIN_CONTRIBUTION)
        .flatMap((component) =>
          FABRICATION_SIGNALS.filter((signal) => signal.id === component.id).map(
            (signal) => signal.reason,
          ),
        ),
    ),
  ];
  return { score, components, reasons };
}

/** The margin of `score` from `threshold`, over the room on its side, capped at 0.6. */
export function documentFabricationConfidence(score: number, threshold: number): number {
  const room = score > threshold ? 1 - threshold : threshold;
  const margin = room <= 0 ? 1 : Math.abs(score - threshold) / room;
  return Math.min(FABRICATION_CONFIDENCE_CAP, margin);
}
