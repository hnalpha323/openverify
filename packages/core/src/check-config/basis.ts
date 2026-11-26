/**
 * What every check-config module shares (C39.3, C51.3): the basis of a default threshold, the
 * shape of a default with its basis and source, and the one face-match threshold. Kept apart
 * from `check-config.ts` so the per-area modules (`check-config/<area>.ts`, V09) can import it
 * without a cycle.
 */
import { z } from 'zod';

/**
 * What a default threshold rests on (C39.3): `calibrated` comes from a calibration report;
 * `provisional` is principled (from the research or an upstream decision point) but not fitted
 * to our fixtures. Results record it per threshold key (`provenance['threshold-basis']`).
 */
export const THRESHOLD_BASES = ['calibrated', 'provisional'] as const;
export const thresholdBasisSchema = z.enum(THRESHOLD_BASES);
export type ThresholdBasis = z.infer<typeof thresholdBasisSchema>;

/** A default threshold or option, with its basis and where its value comes from. */
export interface ConfigDefault {
  readonly value: CheckConfigDefault;
  readonly basis: ThresholdBasis;
  /** The source of the value: a research section, an upstream decision point or a report. */
  readonly source: string;
}

/**
 * The one SFace 1:1 face-match threshold every face comparison shares (C39.3): the selfie and ID
 * comparisons, the account comparison, `id_selfie_comparison` and the face half of
 * `id_inconsistent_repeat_detection`. Calibrated by Workflow 4B (C49.3): SFace's published 0.363
 * gave a false-match rate significantly above 1e-3 on studio portrait pairs, so the threshold
 * moved to the upper end of the bootstrap interval of the FAR 1e-3 threshold. It is not measured on
 * selfies against ID card photos, whose error rates are higher.
 */
export const FACE_MATCH_DEFAULTS: Readonly<{
  threshold: number;
  basis: ThresholdBasis;
  source: string;
}> = Object.freeze({
  threshold: 0.394,
  basis: 'calibrated',
  source:
    "C49 report (docs/calibration/selfie-phase4.md): the upper end of the 95% bootstrap interval over 707 identities of the threshold for FAR 1e-3 on studio portrait pairs (point 0.3862, interval 0.3796-0.3937), rounded up; SFace's published 0.363 gave FAR 2.40e-3 there; not measured on selfies against ID card photos",
});

/** One match group's default (C58.1): each named field and the level it must reach. */
export type MatchGroupDefault = Readonly<Record<string, string>>;

/** A default threshold or option value; Phase 5's match groups are lists of objects (C51.3). */
export type CheckConfigDefault =
  number | boolean | string | readonly string[] | readonly MatchGroupDefault[];

/** A `provisional` default (C39.3, C51.3): principled, never fitted to our fixtures. */
export function provisionalDefault(value: CheckConfigDefault, source: string): ConfigDefault {
  return Object.freeze({ value, basis: 'provisional', source });
}

/** Freezes a table of per-check defaults and each check's entry. */
export function defaultsTable(
  table: Readonly<Record<string, Readonly<Record<string, ConfigDefault>>>>,
): Readonly<Record<string, Readonly<Record<string, ConfigDefault>>>> {
  return Object.freeze(
    Object.fromEntries(Object.entries(table).map(([check, keys]) => [check, Object.freeze(keys)])),
  );
}

/** A list of distinct values, possibly bounded; `uniqueItems` is left to the caller. */
export function distinctList<Item extends z.ZodType>(item: Item, min = 1, max?: number) {
  const list = z.array(item).min(min);
  return (max === undefined ? list : list.max(max)).refine(
    (values) => new Set(values).size === values.length,
    'must not contain duplicates',
  );
}

/** A 0-1 score. */
export const unitInterval = z.number().min(0).max(1);

/** Days of grace after an expiry date (C29.5). */
export const graceDaysSchema = z.int().min(0).max(365);

/** Cosine similarity at or above which two SFace embeddings match ({@link FACE_MATCH_DEFAULTS}). */
export const faceThresholdSchema = z.number().min(0.25).max(0.6);
