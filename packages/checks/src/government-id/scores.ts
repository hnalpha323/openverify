/**
 * The heuristic scores of the H-tier checks (ADR 0002 §3c), each in [0, 1], higher meaning more
 * suspicious, from the raw C32.1 measurements. They are uncalibrated: the constants below are
 * starting points the C36 calibration report measures, and every H-tier check stays `beta`.
 * Each score names its components and the share of them that could be measured (`coverage`).
 */
import { checkConfigOf } from './context.js';
import { idCompromisedDetection } from './id-compromised-detection.js';
import { perspectiveMap, type Point } from './geometry.js';
import type { GovernmentIdContext } from './context.js';
import type { DocumentLayout } from '../data/feature-table.js';
import type {
  ForensicsInput,
  GovernmentIdAnalysisInput,
  IdSideAnalysisInput,
  VisionBoxInput,
} from '../phase1/inputs.js';
import { numberOf, sidesOf, type Side } from './values.js';

export interface HeuristicScore {
  score: number;
  components: Readonly<Record<string, number>>;
  coverage: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;
const roundAll = (components: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round4(value)]));

/** Colourfulness (Hasler-Süsstrunk) and mean saturation at which a print counts as fully colour. */
export const FULL_COLORFULNESS = 15;
export const FULL_SATURATION = 0.08;

function forensicsOf(analysis: GovernmentIdAnalysisInput): [Side, ForensicsInput][] {
  return sidesOf(analysis).flatMap(([side, entry]) =>
    entry.forensics == null ? [] : [[side, entry.forensics] as [Side, ForensicsInput]],
  );
}

const maxOf = (values: readonly number[]): number => values.reduce((a, b) => Math.max(a, b), 0);

/**
 * Grayscale or photocopy (both colourfulness and saturation near zero) and a regional colour
 * cast, the worse side counting. `null` without forensics on the front.
 */
export function colorInconsistencyScore(
  analysis: GovernmentIdAnalysisInput,
): HeuristicScore | null {
  if (analysis.sides.front.forensics == null) {
    return null;
  }
  const sides = forensicsOf(analysis).map(([, forensics]) => forensics);
  const grayscale = maxOf(
    sides.map((forensics) =>
      Math.min(
        clamp01(1 - forensics.chroma.colorfulness / FULL_COLORFULNESS),
        clamp01(1 - forensics.chroma.mean_saturation / FULL_SATURATION),
      ),
    ),
  );
  const cast = maxOf(sides.map((forensics) => forensics.color_cast_score));
  return {
    score: round4(Math.max(grayscale, cast)),
    components: roundAll({ grayscale, 'color-cast': cast }),
    coverage: 1,
  };
}

/** Screen recapture: the moiré and pixel-grid scores, the worse side counting. */
export function electronicReplicaScore(analysis: GovernmentIdAnalysisInput): HeuristicScore | null {
  if (analysis.sides.front.forensics == null) {
    return null;
  }
  const sides = forensicsOf(analysis).map(([, forensics]) => forensics);
  const moire = maxOf(sides.map((forensics) => forensics.moire_score));
  const grid = maxOf(sides.map((forensics) => forensics.screen_grid_score));
  return {
    score: round4(Math.max(moire, grid)),
    components: roundAll({ moire, 'screen-grid': grid }),
    coverage: 1,
  };
}

/** Image editors that leave their name in EXIF `Software`. Not PII; never copied into a result. */
const EDITING_SOFTWARE =
  /photoshop|gimp|lightroom|affinity|pixelmator|paint\.net|picsart|snapseed|canva|illustrator|corel|krita|photopea|fotor|facetune|luminar|capture one/i;

/** The weight of each tamper component in the combined score. */
export const TAMPER_WEIGHTS = Object.freeze({
  'editing-software': 0.9,
  'error-level': 0.6,
  'double-compression': 0.6,
  'copy-move': 0.9,
  'portrait-boundary': 0.8,
});
export type TamperComponent = keyof typeof TAMPER_WEIGHTS;

/**
 * The tamper components measured on one side. Error-level analysis compares the portrait with the
 * rest of the document, so a side without a portrait has none: vision's `ela_score` of 0 there
 * means "not measured", not "no anomaly" (Workflow 3B review, G009).
 */
function tamperComponents(side: IdSideAnalysisInput): Partial<Record<TamperComponent, number>> {
  const forensics = side.forensics;
  if (forensics == null) {
    return {};
  }
  const components: Partial<Record<TamperComponent, number>> = {
    'editing-software': EDITING_SOFTWARE.test(forensics.exif.software ?? '') ? 1 : 0,
    'copy-move': forensics.copy_move_score,
  };
  if (side.portrait != null) {
    components['error-level'] = forensics.ela_score;
  }
  const double = forensics.jpeg?.double_compression_score ?? null;
  if (double !== null) {
    components['double-compression'] = double;
  }
  if (forensics.portrait_boundary_score !== null) {
    components['portrait-boundary'] = forensics.portrait_boundary_score;
  }
  return components;
}

/**
 * Digital edits: editing software, error-level analysis, double JPEG compression, copy-move and
 * the portrait boundary, each component the worse side's, combined as the strongest weighted
 * component (`max(weight × score)`). A noisy-OR would let the moderate copy-move and boundary
 * scores every genuine synthetic card shows add up to a failure (C36 calibration). Coverage is the
 * share of components measured on the front; error-level counts only on a side with a portrait.
 */
export function tamperScore(analysis: GovernmentIdAnalysisInput): HeuristicScore | null {
  const front = analysis.sides.front.forensics;
  if (front == null) {
    return null;
  }
  const components: Partial<Record<TamperComponent, number>> = {};
  for (const [, side] of sidesOf(analysis)) {
    for (const [name, value] of Object.entries(tamperComponents(side)) as [
      TamperComponent,
      number,
    ][]) {
      components[name] = Math.max(components[name] ?? 0, value);
    }
  }
  const weighted = (Object.entries(components) as [TamperComponent, number][]).map(
    ([name, value]) => TAMPER_WEIGHTS[name] * value,
  );
  const measured = Object.keys(tamperComponents(analysis.sides.front)).length;
  return {
    score: round4(maxOf(weighted)),
    components: roundAll(components),
    coverage: measured / Object.keys(TAMPER_WEIGHTS).length,
  };
}

/** Width over height of the ICAO and ID-1 layouts (ICAO 9303 Parts 4-7, ISO/IEC 7810). */
const LAYOUT_ASPECT: Readonly<Record<DocumentLayout, number>> = {
  TD1: 85.6 / 53.98,
  ID1: 85.6 / 53.98,
  TD2: 105 / 74,
  MRVB: 105 / 74,
  TD3: 125 / 88,
  MRVA: 120 / 80,
};
const MRZ_LAYOUTS: ReadonlySet<DocumentLayout> = new Set(['TD1', 'TD2', 'TD3', 'MRVA', 'MRVB']);
/** Layouts whose portrait sits on the left of the front (ICAO 9303 zone V). */
const PORTRAIT_LEFT: ReadonlySet<DocumentLayout> = new Set(['TD1', 'TD2', 'TD3']);
const ASPECT_TOLERANCE = 0.12;

type Rect = readonly [left: number, top: number, right: number, bottom: number];

const rectOf = ([x, y, width, height]: VisionBoxInput): Rect => [x, y, x + width, y + height];
const area = ([left, top, right, bottom]: Rect): number =>
  Math.max(0, right - left) * Math.max(0, bottom - top);
const intersection = (a: Rect, b: Rect): Rect => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.min(a[2], b[2]),
  Math.min(a[3], b[3]),
];

/** The portrait box of the front, mapped from upload pixels onto the rectified document. */
function portraitRect(side: IdSideAnalysisInput): Rect | null {
  const { portrait, document } = side;
  if (portrait === null || document?.quad == null || document.rectified_size === null) {
    return null;
  }
  const map = perspectiveMap(document.quad, document.rectified_size);
  if (map === null) {
    return null;
  }
  const [x = 0, y = 0, width = 0, height = 0] = portrait.bbox;
  const box: Point[] = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
  const corners = box.map(map);
  const xs = corners.map(([px]) => px);
  const ys = corners.map(([, py]) => py);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The nearer standard layout, ID-1 or TD3, of an aspect ratio. */
export const nearestLayout = (aspect: number): DocumentLayout =>
  Math.abs(aspect - LAYOUT_ASPECT.ID1) <= Math.abs(aspect - LAYOUT_ASPECT.TD3) ? 'ID1' : 'TD3';

/**
 * Layout conformance (C32.2): the document's aspect ratio against its layout; text outside the
 * document; text over the portrait; and, for the ICAO layouts, the MRZ at the bottom across the
 * width and the portrait on the left of the front. Every component is 0 when the layout holds
 * and 1 at a clear violation; the score is the worst. `null` without a front document outline.
 */
export function fabricationScore(context: GovernmentIdContext): HeuristicScore | null {
  const { analysis } = context.input;
  const front = analysis.sides.front;
  const detection = front.document;
  if (
    detection?.found !== true ||
    detection.rectified_size === null ||
    detection.aspect_ratio === null
  ) {
    return null;
  }
  const [width, height] = detection.rectified_size;
  const layout = context.extraction.document.layout ?? nearestLayout(detection.aspect_ratio);
  const expected = LAYOUT_ASPECT[layout];
  const components: Record<string, number> = {
    'aspect-ratio': clamp01(
      Math.abs(detection.aspect_ratio - expected) / expected / ASPECT_TOLERANCE,
    ),
  };
  let possible = 3;
  const lines = (front.text ?? []).map((line) => rectOf(line.box));
  if (lines.length > 0) {
    const outside = lines.filter(
      ([left, top, right, bottom]) =>
        left < -0.02 * width ||
        top < -0.02 * height ||
        right > 1.02 * width ||
        bottom > 1.02 * height,
    ).length;
    components['text-outside'] = clamp01(outside / 2);
  }
  const portrait = portraitRect(front);
  if (portrait !== null && lines.length > 0) {
    const over = lines.filter(
      (line) => area(intersection(line, portrait)) > 0.3 * area(line),
    ).length;
    components['text-over-portrait'] = clamp01(over / 2);
  }
  if (MRZ_LAYOUTS.has(layout)) {
    possible += 2;
    const side: Side = context.extraction.sources.mrz?.side ?? context.features?.mrzSide ?? 'back';
    const entry = side === 'front' ? front : analysis.sides.back;
    const box = entry?.mrz?.box ?? null;
    const size = entry?.document?.found === true ? entry.document.rectified_size : null;
    if (box !== null && size !== null) {
      const [x, y, boxWidth, boxHeight] = box;
      const [sideWidth, sideHeight] = size;
      components['mrz-geometry'] = Math.max(
        clamp01((0.85 - (y + boxHeight) / sideHeight) / 0.3),
        clamp01((0.7 - boxWidth / sideWidth) / 0.4),
        clamp01((x / sideWidth - 0.15) / 0.3),
      );
    }
    if (portrait !== null && PORTRAIT_LEFT.has(layout)) {
      const center = (portrait[0] + portrait[2]) / 2 / width;
      components['portrait-position'] = clamp01((center - 0.5) / 0.3);
    }
  }
  const values = Object.values(components);
  return {
    score: round4(maxOf(values)),
    components: roundAll(components),
    coverage: values.length / possible,
  };
}

export interface HandwritingScore extends HeuristicScore {
  /** Per C31.5 field read from the visual zone, its line's score. */
  fieldScores: Readonly<Record<string, number>>;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/** Lines whose strokes were measured that a baseline needs. */
const MIN_MEASURED_LINES = 3;

/** The stroke excess below which a line shows no stroke signal: its confidence drop is ignored. */
export const HANDWRITING_STROKE_SIGNAL = 0.1;
/** Fields the visual zone must have read for the score to judge their lines only. */
const MIN_FIELDS_FOR_FIELD_SCORES = 2;

/**
 * Handwriting in a printed field: a value line whose stroke-width variation is well above the
 * card's typical line (printed type is even) and whose OCR confidence falls below it. Per line:
 * 0.6 × the stroke excess (three times the median variation scores 1) + 0.4 × the confidence drop
 * (0.3 below the median scores 1). The confidence drop counts only on a line with a stroke signal
 * (an excess of at least {@link HANDWRITING_STROKE_SIGNAL}), so a line of even print read with
 * less confidence scores under 0.06 (Phase 12A C10: the drop alone gave a live false positive).
 * The score is the worst field line when at least two fields were read, else the worst line.
 * `null` with fewer than three lines whose strokes were measured.
 */
export function handwritingScore(context: GovernmentIdContext): HandwritingScore | null {
  const lines = sidesOf(context.input.analysis).flatMap(([side, entry]) =>
    (entry.text ?? []).flatMap((line, index) =>
      line.stroke_width_cv === null
        ? []
        : [{ side, index, cv: line.stroke_width_cv, confidence: line.confidence }],
    ),
  );
  if (lines.length < MIN_MEASURED_LINES) {
    return null;
  }
  const baselineCv = Math.max(median(lines.map((line) => line.cv)), 0.05);
  const baselineConfidence = median(lines.map((line) => line.confidence));
  const scoreOf = (line: (typeof lines)[number]) => ({
    stroke: clamp01((line.cv / baselineCv - 1) / 2),
    drop: clamp01((baselineConfidence - line.confidence) / 0.3),
  });
  const lineScore = (line: (typeof lines)[number]): number => {
    const { stroke, drop } = scoreOf(line);
    return 0.6 * stroke + (stroke >= HANDWRITING_STROKE_SIGNAL ? 0.4 * drop : 0);
  };
  const fields = Object.entries(context.extraction.sources.viz?.readings ?? {});
  const fieldScores: Record<string, number> = {};
  for (const [field, reading] of fields) {
    const line = lines.find(
      (entry) => entry.side === reading.side && entry.index === reading.lineIndex,
    );
    if (line !== undefined) {
      fieldScores[field] = round4(lineScore(line));
    }
  }
  const candidates =
    Object.keys(fieldScores).length >= MIN_FIELDS_FOR_FIELD_SCORES
      ? Object.values(fieldScores)
      : lines.map(lineScore);
  const stroke = maxOf(lines.map((line) => scoreOf(line).stroke));
  const drop = maxOf(lines.map((line) => scoreOf(line).drop));
  return {
    score: round4(maxOf(candidates)),
    components: roundAll({ 'stroke-width-variation': stroke, 'confidence-drop': drop }),
    coverage: 1,
    fieldScores,
  };
}

/** The weight of each hard signal in the entity score. */
export const ENTITY_SIGNAL_WEIGHTS = Object.freeze({
  compromised: 1,
  'mrz-check-digits': 0.9,
  'extraction-inconsistent': 0.8,
  'barcode-invalid': 0.7,
});

/** The H-tier checks the entity score aggregates, with their threshold keys. */
const ENTITY_HEURISTICS = [
  ['tamper', 'id_tamper_detection', 'max-tamper-score'],
  ['electronic-replica', 'id_electronic_replica_detection', 'max-electronic-replica-score'],
  ['color-inconsistency', 'id_color_inconsistency_detection', 'max-color-inconsistency-score'],
  ['fabrication', 'id_fabrication_detection', 'max-fabrication-score'],
  ['handwriting', 'id_handwriting_detection', 'max-handwriting-score'],
] as const;

/**
 * The composite entity risk (an interpretation, documented in `docs/checks/government-id.md`):
 * a noisy-OR (`1 - Π(1 - c)`) of
 * - each other heuristic by how far it exceeds its own threshold (`(score - t) / (1 - t)`, 0 at
 *   or below it), so the background every genuine card shows adds nothing; and
 * - hard signals: a compromised document, failing MRZ check digits, sources that disagree, an
 *   unsound barcode.
 * Coverage is the share of the nine measured. `null` without forensics on the front and without
 * any extraction source.
 */
export function entityScore(context: GovernmentIdContext): HeuristicScore | null {
  const { analysis } = context.input;
  const { sources, consolidated } = context.extraction;
  const anySource = sources.mrz !== null || sources.barcode !== null || sources.viz !== null;
  if (analysis.sides.front.forensics == null && !anySource) {
    return null;
  }
  const components: Record<string, number> = {};
  const scores: Readonly<Record<string, HeuristicScore | null>> = {
    tamper: tamperScore(analysis),
    'electronic-replica': electronicReplicaScore(analysis),
    'color-inconsistency': colorInconsistencyScore(analysis),
    fabrication: fabricationScore(context),
    handwriting: handwritingScore(context),
  };
  for (const [name, checkId, key] of ENTITY_HEURISTICS) {
    const measured = scores[name] ?? null;
    if (measured !== null) {
      const threshold = numberOf(checkConfigOf(context, checkId), key) ?? 0.5;
      components[name] =
        threshold >= 1 ? 0 : clamp01((measured.score - threshold) / (1 - threshold));
    }
  }
  const compromised = idCompromisedDetection(context);
  if (compromised.status !== 'not_applicable') {
    components.compromised =
      compromised.status === 'failed' ? ENTITY_SIGNAL_WEIGHTS.compromised : 0;
  }
  if (sources.mrz !== null) {
    components['mrz-check-digits'] = sources.mrz.parsed.checkDigitsValid
      ? 0
      : ENTITY_SIGNAL_WEIGHTS['mrz-check-digits'];
  }
  if (anySource) {
    components['extraction-inconsistent'] =
      consolidated.disagreeingFields.length > 0
        ? ENTITY_SIGNAL_WEIGHTS['extraction-inconsistent']
        : 0;
  }
  if (sources.barcode !== null || sources.barcodeError !== null) {
    components['barcode-invalid'] =
      sources.barcodeError !== null || sources.barcode?.parsed.valid === false
        ? ENTITY_SIGNAL_WEIGHTS['barcode-invalid']
        : 0;
  }
  const clear = Object.values(components).reduce((product, value) => product * (1 - value), 1);
  return {
    score: round4(1 - clear),
    components: roundAll(components),
    coverage: Object.keys(components).length / 9,
  };
}
