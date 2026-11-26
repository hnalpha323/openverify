/**
 * The C36 calibration report: the raw measurements of every synthetic variant (written by
 * `services/vision/tools/calibrate_government_id.py`), scored by the real evaluators, and the
 * thresholds that would separate the genuine cards from the variants built to trip each check.
 *
 * It covers synthetic fixtures only: the proposals separate OpenVerify's generated Utopia cards,
 * and say nothing about error rates on real documents, so every heuristic (H-tier) check stays
 * `beta` (ADR 0002 §3f). The report never prints a field value of the cards, only variant names,
 * measurements and scores.
 */
import {
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  listChecks,
  type CheckId,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { z } from 'zod';
import { extractGovernmentId } from '../extraction/extract.js';
import { governmentIdContext, type GovernmentIdContext } from '../government-id/context.js';
import {
  colorInconsistencyScore,
  electronicReplicaScore,
  entityScore,
  fabricationScore,
  handwritingScore,
  tamperScore,
} from '../government-id/scores.js';
import { phashDistance } from '../government-id/values.js';
import { evaluateGovernmentIdChecks } from '../phase1/evaluate.js';
import type { GovernmentIdAnalysisInput, IdSideAnalysisInput } from '../phase1/inputs.js';

const sideSchema = z.custom<IdSideAnalysisInput>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'quality' in value &&
    'faces' in value &&
    'portrait' in value,
  'must be a C32.1 side analysis',
);

/** The measurements file of `tools/calibrate_government_id.py` (agreed through the handoff). */
export const calibrationMeasurementsSchema = z.object({
  generator_version: z.int().min(0),
  model_versions: z.record(z.string(), z.string().nullable()),
  /** The whole-image thresholds vision judged `quality` with: the defaults of C11's keys. */
  quality_thresholds: z
    .object({ blur_min: z.number().optional(), glare_max: z.number().optional() })
    .optional(),
  variants: z
    .array(
      z.object({
        name: z.string().min(1),
        group: z.enum(['happy', 'variant', 'distinct-holder', 're-encoding']),
        expect: z.array(z.string()),
        description: z.string(),
        sides: z.object({ front: sideSchema, back: sideSchema.nullable() }),
        truth: z.unknown().optional(),
      }),
    )
    .min(1),
  aamva: z
    .array(z.object({ id: z.string().min(1), valid: z.boolean(), side: sideSchema }))
    .default([]),
});
export type CalibrationMeasurements = z.infer<typeof calibrationMeasurementsSchema>;
type Variant = CalibrationMeasurements['variants'][number];

export interface CalibrationOptions {
  /** The evaluation instant (expiry and age depend on it). */
  now: Date;
  /** Where the measurements came from, for the report header. */
  source?: string | undefined;
}

export interface ThresholdCalibration {
  check: string;
  key: string;
  /** `max`: a value above the threshold fails; `min`: a value below it fails. */
  direction: 'max' | 'min';
  /** The current default (C29.5), or `null` when the key has none. */
  current: number | null;
  /**
   * Where the current default comes from: the registry (`GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS`),
   * or, for the whole-image keys a template leaves unset, the vision service's own verdict.
   */
  currentSource: 'registry' | 'vision' | null;
  /** The genuine cards: the happy, distinct-holder and re-encoded variants. */
  genuine: { count: number; min: number | null; max: number | null };
  /** The variants built to trip the check, with their value. */
  positives: readonly { variant: string; value: number | null }[];
  /** The positives beyond every genuine card. */
  separated: readonly string[];
  /** The midpoint between the genuine cards and the separated positives, or `null`. */
  proposed: number | null;
  /** Half the gap: how far the proposal sits from either side. */
  margin: number | null;
  /** What the current default does on these fixtures, or `null` without a default. */
  atCurrent: CurrentDefaultCalibration | null;
  note: string;
}

export interface CurrentDefaultCalibration {
  /** The variants built to trip the check that the default fails. */
  caught: readonly string[];
  /** How many genuine cards the default fails. */
  genuineFailing: number;
  /** When it separates: its distance to the nearer of the genuine cards and the caught variants. */
  margin: number | null;
}

export interface VariantCalibration {
  name: string;
  group: string;
  expect: readonly string[];
  /** Per check, its status and reasons, for example `failed expired`. */
  results: Readonly<Record<string, string>>;
  /** The expected checks that failed. */
  tripped: readonly string[];
  /** The expected checks that did not fail. */
  missed: readonly string[];
  /** Checks a genuine card failed, or a variant failed beyond what it expects. */
  failedUnexpectedly: readonly string[];
  measurements: Readonly<Record<string, number | string | null>>;
}

export interface PhashCalibration {
  /** Front pHash distances of the re-encoded copies to the happy card. */
  reencodings: readonly number[];
  /** Front pHash distances between distinct cards of the design (happy and distinct holders). */
  distinct: readonly number[];
  maxReencoding: number | null;
  minDistinct: number | null;
  /** A `max-phash-distance` between the two (0-7), or `null`: the pHash half stays disabled. */
  proposed: number | null;
  note: string;
}

export interface AamvaCalibration {
  id: string;
  expectedValid: boolean;
  decoded: boolean;
  valid: boolean;
  error: string | null;
  agrees: boolean;
}

export interface CalibrationReport {
  generatorVersion: number;
  modelVersions: Readonly<Record<string, string | null>>;
  now: string;
  source: string | null;
  variants: readonly VariantCalibration[];
  thresholds: readonly ThresholdCalibration[];
  phash: PhashCalibration;
  aamva: readonly AamvaCalibration[];
}

const GENUINE_GROUPS: ReadonlySet<string> = new Set(['happy', 'distinct-holder', 're-encoding']);
const INTEGER_KEYS: ReadonlySet<string> = new Set([
  'min-document-width-px',
  'min-text-lines',
  'min-front-back-phash-distance',
]);

/** Every government ID check enabled, and the age gate the under-age variant is built for. */
const EVERY_CHECK: VerificationTemplateConfig = {
  checks: Object.fromEntries(
    listChecks('government_id').map((check) => [
      check.id,
      check.id === 'id_age_comparison'
        ? { enabled: true, required: true, config: { 'min-age': 18 } }
        : { enabled: true, required: true },
    ]),
  ),
};

const sidesOf = (variant: Variant): IdSideAnalysisInput[] =>
  variant.sides.back === null ? [variant.sides.front] : [variant.sides.front, variant.sides.back];

const values = (list: readonly (number | null | undefined)[]): number[] =>
  list.filter((value): value is number => typeof value === 'number');
const minOf = (list: readonly (number | null | undefined)[]): number | null => {
  const present = values(list);
  return present.length === 0 ? null : Math.min(...present);
};
const maxOf = (list: readonly (number | null | undefined)[]): number | null => {
  const present = values(list);
  return present.length === 0 ? null : Math.max(...present);
};

interface Measure {
  check: CheckId;
  key: string;
  direction: 'max' | 'min';
  value: (variant: Variant, context: GovernmentIdContext) => number | null;
  /** The vision threshold that judges this key when a template leaves it unset (C11). */
  vision?: 'blur_min' | 'glare_max';
}

type VisionThresholds = CalibrationMeasurements['quality_thresholds'];

const MEASURES: readonly Measure[] = [
  {
    check: 'id_unprocessable_submission_detection',
    key: 'min-text-lines',
    direction: 'min',
    value: (variant) =>
      (variant.sides.front.text ?? []).filter((line) => line.confidence >= 0.5).length,
  },
  {
    check: 'id_blur_detection',
    key: 'min-blur-score',
    direction: 'min',
    vision: 'blur_min',
    value: (variant) => minOf(sidesOf(variant).map((side) => side.quality.blur_score)),
  },
  {
    check: 'id_blur_detection',
    key: 'min-document-blur-score',
    direction: 'min',
    value: (variant) => minOf(sidesOf(variant).map((side) => side.document_quality?.blur_score)),
  },
  {
    check: 'id_blur_detection',
    key: 'min-document-tenengrad',
    direction: 'min',
    value: (variant) => minOf(sidesOf(variant).map((side) => side.document_quality?.tenengrad)),
  },
  {
    check: 'id_blur_detection',
    key: 'min-document-width-px',
    direction: 'min',
    value: (variant) => minOf(sidesOf(variant).map((side) => side.document_quality?.width_px)),
  },
  {
    check: 'id_glare_detection',
    key: 'max-glare-ratio',
    direction: 'max',
    vision: 'glare_max',
    value: (variant) => maxOf(sidesOf(variant).map((side) => side.quality.glare_ratio)),
  },
  {
    check: 'id_glare_detection',
    key: 'max-document-glare-ratio',
    direction: 'max',
    value: (variant) =>
      maxOf(
        sidesOf(variant).flatMap((side) => [
          side.document_quality?.glare_ratio_text,
          side.document_quality?.glare_ratio_portrait,
        ]),
      ),
  },
  {
    check: 'id_double_side_detection',
    key: 'min-front-back-phash-distance',
    direction: 'min',
    value: (variant) => phashDistance(variant.sides.front.phash, variant.sides.back?.phash),
  },
  {
    check: 'id_portrait_clarity_detection',
    key: 'min-face-width-px',
    direction: 'min',
    value: (variant) => variant.sides.front.portrait_clarity?.face_width_px ?? null,
  },
  {
    check: 'id_portrait_clarity_detection',
    key: 'min-sharpness',
    direction: 'min',
    value: (variant) => variant.sides.front.portrait_clarity?.sharpness ?? null,
  },
  {
    check: 'id_portrait_clarity_detection',
    key: 'min-landmarks-score',
    direction: 'min',
    value: (variant) => variant.sides.front.portrait_clarity?.landmarks_score ?? null,
  },
  {
    check: 'id_color_inconsistency_detection',
    key: 'max-color-inconsistency-score',
    direction: 'max',
    value: (_, context) => colorInconsistencyScore(context.input.analysis)?.score ?? null,
  },
  {
    check: 'id_electronic_replica_detection',
    key: 'max-electronic-replica-score',
    direction: 'max',
    value: (_, context) => electronicReplicaScore(context.input.analysis)?.score ?? null,
  },
  {
    check: 'id_tamper_detection',
    key: 'max-tamper-score',
    direction: 'max',
    value: (_, context) => tamperScore(context.input.analysis)?.score ?? null,
  },
  {
    check: 'id_fabrication_detection',
    key: 'max-fabrication-score',
    direction: 'max',
    value: (_, context) => fabricationScore(context)?.score ?? null,
  },
  {
    check: 'id_handwriting_detection',
    key: 'max-handwriting-score',
    direction: 'max',
    value: (_, context) => handwritingScore(context)?.score ?? null,
  },
  {
    check: 'id_entity_detection',
    key: 'max-entity-score',
    direction: 'max',
    value: (_, context) => entityScore(context)?.score ?? null,
  },
];

/** A measured value as reported: three decimals at most, so float noise never shows. */
function observed(value: number | null | undefined): number | null {
  return typeof value === 'number' ? Math.round(value * 1000) / 1000 : null;
}

/** A proposal: whole numbers above 100, two decimals above 1, three below. */
function nice(value: number, integer = false): number {
  if (integer) {
    return Math.round(value);
  }
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 3;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function inputOf(variant: Variant, analysis: GovernmentIdAnalysisInput, now: Date) {
  const back = variant.sides.back;
  return {
    analysis,
    requiredSides: back === null ? ('front' as const) : ('both' as const),
    uploads: {
      front: { sha256: 'f'.repeat(64) },
      back: back === null ? null : { sha256: 'b'.repeat(64) },
    },
    environment: 'sandbox' as const,
    now,
  };
}

/** What the current default fails on these fixtures, and how far it sits from either side. */
function judgeDefault(
  measure: Measure,
  current: number,
  genuine: readonly (number | null)[],
  positives: readonly { variant: string; value: number | null }[],
): CurrentDefaultCalibration {
  const fails = (value: number) =>
    measure.direction === 'max' ? value > current : value < current;
  const genuineValues = values(genuine);
  const genuineFailing = genuineValues.filter(fails).length;
  const caught = positives.filter(({ value }) => value !== null && fails(value));
  const distances = [
    ...genuineValues.map((value) => Math.abs(value - current)),
    ...values(caught.map(({ value }) => value)).map((value) => Math.abs(value - current)),
  ];
  return {
    caught: caught.map(({ variant }) => variant),
    genuineFailing,
    margin: genuineFailing > 0 || caught.length === 0 ? null : observed(Math.min(...distances)),
  };
}

/** The current default of `measure`'s key, and where it comes from. */
function currentDefault(
  measure: Measure,
  vision: VisionThresholds,
): Pick<ThresholdCalibration, 'current' | 'currentSource'> {
  const fallback = GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS[measure.check]?.[measure.key];
  if (typeof fallback === 'number') {
    return { current: fallback, currentSource: 'registry' };
  }
  const visionDefault = measure.vision === undefined ? undefined : vision?.[measure.vision];
  return visionDefault === undefined
    ? { current: null, currentSource: null }
    : { current: visionDefault, currentSource: 'vision' };
}

function calibrate(
  measure: Measure,
  genuine: readonly (number | null)[],
  positives: readonly { variant: string; value: number | null }[],
  vision: VisionThresholds,
): ThresholdCalibration {
  const integer = INTEGER_KEYS.has(measure.key);
  const { current, currentSource } = currentDefault(measure, vision);
  const low = minOf(genuine);
  const high = maxOf(genuine);
  const boundary = measure.direction === 'max' ? high : low;
  const separated = positives.filter(
    ({ value }) =>
      value !== null &&
      boundary !== null &&
      (measure.direction === 'max' ? value > boundary : value < boundary),
  );
  const nearest =
    measure.direction === 'max'
      ? minOf(separated.map(({ value }) => value))
      : maxOf(separated.map(({ value }) => value));
  const proposed =
    boundary === null || nearest === null ? null : nice((boundary + nearest) / 2, integer);
  const margin =
    boundary === null || nearest === null ? null : nice(Math.abs(nearest - boundary) / 2);
  const atCurrent = current === null ? null : judgeDefault(measure, current, genuine, positives);
  const failing = atCurrent?.genuineFailing ?? 0;
  const notes: string[] = [];
  if (positives.length === 0) {
    notes.push(
      'No variant is built to trip this check by this measure; the genuine range is shown.',
    );
  } else if (separated.length === 0) {
    notes.push(
      'No variant that should trip lies beyond every genuine card: this measure does not detect them on these fixtures.',
    );
  } else {
    notes.push(
      `Separates ${String(separated.length)} of ${String(positives.length)} variants that should trip.`,
    );
  }
  if (failing > 0) {
    notes.push(`The current default fails ${String(failing)} genuine card(s).`);
  }
  return {
    check: measure.check,
    key: measure.key,
    direction: measure.direction,
    current,
    currentSource,
    genuine: {
      count: values(genuine).length,
      min: observed(low),
      max: observed(high),
    },
    positives: positives.map(({ variant, value }) => ({
      variant,
      value: observed(value),
    })),
    separated: separated.map(({ variant }) => variant),
    proposed,
    margin,
    atCurrent,
    note: notes.join(' '),
  };
}

function calibratePhash(variants: readonly Variant[]): PhashCalibration {
  const happy =
    variants.find((variant) => variant.name === 'happy') ??
    variants.find((variant) => variant.group === 'happy');
  const base = happy?.sides.front.phash ?? null;
  const reencodings = values(
    variants
      .filter((variant) => variant.group === 're-encoding')
      .map((variant) => phashDistance(base, variant.sides.front.phash)),
  );
  const cards = [
    ...(happy === undefined ? [] : [happy]),
    ...variants.filter((variant) => variant.group === 'distinct-holder'),
  ];
  const distinct: number[] = [];
  cards.forEach((left, index) => {
    for (const right of cards.slice(index + 1)) {
      const distance = phashDistance(left.sides.front.phash, right.sides.front.phash);
      if (distance !== null) {
        distinct.push(distance);
      }
    }
  });
  const maxReencoding = maxOf(reencodings);
  const minDistinct = minOf(distinct);
  if (
    maxReencoding === null ||
    minDistinct === null ||
    maxReencoding >= minDistinct ||
    maxReencoding > 7
  ) {
    return {
      reencodings,
      distinct,
      maxReencoding,
      minDistinct,
      proposed: null,
      note: 'No distance separates the re-encodings of one card from distinct cards of the design, so the pHash half of id_repeat_detection ships disabled (no max-phash-distance default, C34).',
    };
  }
  const proposed = Math.min(7, Math.floor((maxReencoding + minDistinct) / 2));
  return {
    reencodings,
    distinct,
    maxReencoding,
    minDistinct,
    proposed,
    note: `max-phash-distance ${String(proposed)} matches every re-encoding (up to ${String(maxReencoding)} bits) and no distinct card (from ${String(minDistinct)} bits).`,
  };
}

function variantMeasurements(variant: Variant): Record<string, number | string | null> {
  const { front, back } = variant.sides;
  return {
    'document-method': front.document?.method ?? null,
    'aspect-ratio': front.document?.aspect_ratio ?? null,
    'front-blur': observed(front.quality.blur_score),
    'back-blur': observed(back?.quality.blur_score),
    'document-blur': observed(
      minOf(sidesOf(variant).map((side) => side.document_quality?.blur_score)),
    ),
    tenengrad: observed(minOf(sidesOf(variant).map((side) => side.document_quality?.tenengrad))),
    'width-px': minOf(sidesOf(variant).map((side) => side.document_quality?.width_px)),
    'glare-ratio': observed(maxOf(sidesOf(variant).map((side) => side.quality.glare_ratio))),
    'text-lines': sidesOf(variant).reduce((sum, side) => sum + (side.text ?? []).length, 0),
    mrz:
      sidesOf(variant)
        .map((side) => side.mrz?.format_guess ?? null)
        .find((format) => format !== null) ?? null,
    barcodes: sidesOf(variant).reduce((sum, side) => sum + (side.barcodes ?? []).length, 0),
    'front-back-phash-distance': phashDistance(front.phash, back?.phash),
  };
}

function evaluateVariant(
  variant: Variant,
  modelVersions: Readonly<Record<string, string | null>>,
  now: Date,
) {
  const analysis: GovernmentIdAnalysisInput = {
    model_versions: modelVersions,
    sides: variant.sides,
  };
  const input = inputOf(variant, analysis, now);
  const results = evaluateGovernmentIdChecks(input, EVERY_CHECK);
  const statuses = Object.fromEntries(
    results.map((result) => [result.name, [result.status, ...result.reasons].join(' ')]),
  );
  const failed = results
    .filter((result) => result.status === 'failed')
    .map((result) => result.name);
  const row: VariantCalibration = {
    name: variant.name,
    group: variant.group,
    expect: variant.expect,
    results: statuses,
    tripped: variant.expect.filter((check) => failed.includes(check)),
    missed: variant.expect.filter((check) => !failed.includes(check)),
    failedUnexpectedly: failed.filter((check) => !variant.expect.includes(check)),
    measurements: variantMeasurements(variant),
  };
  return { row, context: governmentIdContext(input, EVERY_CHECK) };
}

/** Scores the measurements with the real evaluators and proposes thresholds (C36). */
export function calibrationReport(
  measurements: unknown,
  options: CalibrationOptions,
): CalibrationReport {
  const parsed = calibrationMeasurementsSchema.parse(measurements);
  const evaluated = parsed.variants.map((variant) => ({
    variant,
    ...evaluateVariant(variant, parsed.model_versions, options.now),
  }));
  const thresholds = MEASURES.map((measure) =>
    calibrate(
      measure,
      evaluated
        .filter(({ variant }) => GENUINE_GROUPS.has(variant.group))
        .map(({ variant, context }) => measure.value(variant, context)),
      evaluated
        .filter(
          ({ variant }) => variant.group === 'variant' && variant.expect.includes(measure.check),
        )
        .map(({ variant, context }) => ({
          variant: variant.name,
          value: measure.value(variant, context),
        })),
      parsed.quality_thresholds,
    ),
  );
  const aamva = parsed.aamva.map((entry): AamvaCalibration => {
    const extraction = extractGovernmentId(
      { sides: { front: entry.side, back: null } },
      { now: options.now },
    );
    const { barcode, barcodeError } = extraction.sources;
    const valid = barcode?.parsed.valid === true;
    return {
      id: entry.id,
      expectedValid: entry.valid,
      decoded: barcode !== null || barcodeError !== null,
      valid,
      error: barcodeError?.code ?? barcode?.parsed.issues[0]?.code ?? null,
      agrees: valid === entry.valid,
    };
  });
  return {
    generatorVersion: parsed.generator_version,
    modelVersions: parsed.model_versions,
    now: options.now.toISOString().slice(0, 10),
    source: options.source ?? null,
    variants: evaluated.map(({ row }) => row),
    thresholds,
    phash: calibratePhash(parsed.variants),
    aamva,
  };
}

type Cell = string | number | boolean | null | undefined | readonly (string | number)[];

const cell = (value: Cell): string => {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'object') {
    return value.length === 0 ? '-' : value.map(String).join(', ');
  }
  return String(value);
};

const table = (header: readonly string[], rows: readonly (readonly Cell[])[]): string =>
  [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');

const defaultVerdict = ({ atCurrent: verdict, positives }: ThresholdCalibration): string => {
  if (verdict === null) {
    return '-';
  }
  const parts = [
    positives.length === 0
      ? 'no variant to catch'
      : verdict.caught.length === 0
        ? 'catches none'
        : `catches ${verdict.caught.join(', ')}`,
    ...(verdict.genuineFailing > 0
      ? [`fails ${String(verdict.genuineFailing)} genuine`]
      : verdict.margin === null
        ? []
        : [`margin ${String(verdict.margin)}`]),
  ];
  return parts.join(', ');
};

/** The report as Markdown, for `docs/calibration/government-id-phase3.md`. */
export function renderCalibrationMarkdown(report: CalibrationReport): string {
  const models = Object.entries(report.modelVersions)
    .map(([name, version]) => `${name} ${version ?? '(none)'}`)
    .join(', ');
  return [
    '# Government ID calibration, Phase 3',
    '',
    "> **Scope: synthetic fixtures only.** Every measurement below comes from OpenVerify's generated cards of the fictional issuer Utopia and its synthetic AAMVA barcodes (C36), never from a real document. A proposed threshold separates these fixtures; it is not an error rate on real IDs. Every heuristic (H-tier) check therefore stays `beta` (ADR 0002 §3f), and the model-based checks stay `beta` until a FAR/FRR report on labelled data (Phase 4).",
    '',
    `Generated on ${report.now} by \`pnpm --filter @openverify/checks calibration:report\` from ${report.source ?? 'the calibration measurements'} (generator version ${String(report.generatorVersion)}; models: ${models}). The evaluators run in a sandbox with every government ID check enabled and \`id_age_comparison\` set to \`min-age: 18\`. Genuine cards are the happy, distinct-holder and re-encoded variants; each other variant is built to trip the checks it names.`,
    '',
    '## Thresholds',
    '',
    'One value per card: its weakest side for a per-side measure. "(vision)" marks a whole-image key a template leaves unset, judged by the vision service\'s own threshold, which the selfie checks share. "At the default" lists the variants the current default fails and, when it fails no genuine card, its distance to the nearer side. A proposal is the midpoint between the genuine cards and the variants beyond them; its margin is half the gap. "-" means none.',
    '',
    table(
      [
        'Check',
        'Key',
        'Fails when',
        'Current default',
        'Genuine (n, min-max)',
        'Should trip',
        'Separated',
        'At the default',
        'Proposed',
        'Margin',
        'Note',
      ],
      report.thresholds.map((entry) => [
        entry.check,
        `\`${entry.key}\``,
        entry.direction === 'max' ? 'above' : 'below',
        entry.currentSource === 'vision' ? `${String(entry.current)} (vision)` : entry.current,
        `${String(entry.genuine.count)}, ${cell(entry.genuine.min)}-${cell(entry.genuine.max)}`,
        entry.positives.map(({ variant, value }) => `${variant} ${cell(value)}`),
        entry.separated,
        defaultVerdict(entry),
        entry.proposed,
        entry.margin,
        entry.note,
      ]),
    ),
    '',
    '## pHash distances (C34)',
    '',
    `- Re-encodings of the happy card (bits): ${cell(report.phash.reencodings)}; at most ${cell(report.phash.maxReencoding)}.`,
    `- Distinct cards of the design (bits): ${cell(report.phash.distinct)}; at least ${cell(report.phash.minDistinct)}.`,
    `- Proposed \`max-phash-distance\`: ${cell(report.phash.proposed)}. ${report.phash.note}`,
    '',
    '## Variants',
    '',
    table(
      ['Variant', 'Group', 'Should trip', 'Tripped', 'Missed', 'Also failed'],
      report.variants.map((row) => [
        row.name,
        row.group,
        row.expect,
        row.tripped,
        row.missed,
        row.failedUnexpectedly,
      ]),
    ),
    '',
    '## Measurements',
    '',
    table(
      ['Variant', ...Object.keys(report.variants[0]?.measurements ?? {})],
      report.variants.map((row) => [row.name, ...Object.values(row.measurements)]),
    ),
    '',
    '## AAMVA barcode images',
    '',
    table(
      ['Vector', 'Expected valid', 'Decoded', 'Valid', 'First error', 'Agrees'],
      report.aamva.map((entry) => [
        entry.id,
        entry.expectedValid,
        entry.decoded,
        entry.valid,
        entry.error,
        entry.agrees,
      ]),
    ),
    '',
  ].join('\n');
}
