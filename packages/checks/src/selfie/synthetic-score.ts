/**
 * The heuristic fusion of `selfie_suspicious_entity_detection` (C43, research §5.3): the C41.1
 * synthetic cues, each mapped onto a [0, 1] suspicion, and the XMP digital source type of an
 * upload. Weight-free and uncalibrated: the detection rate is unmeasured, modern generators are not
 * detected, and resizing or re-encoding weakens every cue, so the check stays beta and advisory.
 *
 * The fused score is the strongest weighted cue (`max(weight x suspicion)`), as the Phase 3 tamper
 * score: a noisy-OR would let the small background every genuine frame shows add up. Coverage is
 * the share of the applicable cues vision measured.
 */
import type { SyntheticScoresInput } from '../phase1/inputs.js';
import type { HeuristicScore } from '../government-id/scores.js';
import { clamp01, round4 } from './values.js';

/** One synthetic cue: its suspicion is 0 at `clear`, 1 at `suspicious`, linear between. */
export interface SyntheticSignal {
  key: Exclude<keyof SyntheticScoresInput, 'digital_source_type'>;
  clear: number;
  suspicious: number;
  weight: number;
  /** Read only for an upload (a camera frame is never FFHQ-aligned by construction). */
  uploadsOnly: boolean;
  basis: string;
}

/**
 * The cues, in C41.1 order. Every scale and weight is provisional: set from the research's
 * description of each measure, never fitted to a fixture. Workflow 4B's calibration (C49,
 * `docs/calibration/selfie-phase4.md`) checked each clear level against a genuine-only
 * distribution, studio portraits scaled to a 2,000-px long side and the 45 re-encodings of the
 * public-domain faces: a level below the genuine 99th percentile (above the 1st for the landmark
 * distance) flagged genuine photos, so it moved to that percentile, rounded outward, keeping its
 * ramp's width and its weight. No level was set from a drawn artefact; the detection rate stays
 * unmeasured.
 */
export const SYNTHETIC_SIGNALS: readonly SyntheticSignal[] = Object.freeze([
  {
    key: 'spectral_tail_deviation',
    clear: 3.71,
    suspicious: 4.46,
    weight: 0.8,
    uploadsOnly: false,
    basis:
      'provisional: the face crop high-frequency tail slope against its own background (Durall et al. 2020); clear at the genuine 99th percentile of C49 (3.7036; the research level 0.25 flagged genuine photos), the ramp width 0.75 kept; genuine-only distribution; detection rate unmeasured',
  },
  {
    key: 'residual_peak_ratio',
    clear: 2,
    suspicious: 6,
    weight: 0.8,
    uploadsOnly: false,
    basis:
      'provisional: periodic up-sampling peaks over the local median of the noise residual (Zhang et al. 2019, Corvi et al. 2023), JPEG and demosaicing frequencies masked; a camera residual peaks about 1-2; checked against C49 (genuine 99th percentile 1.9774, below clear); genuine-only distribution; detection rate unmeasured',
  },
  {
    key: 'noise_inconsistency',
    clear: 0.69,
    suspicious: 1.19,
    weight: 0.7,
    uploadsOnly: false,
    basis:
      'provisional: face against background noise level (Mahdian and Saic 2009); blended swaps are smoother than their surroundings; clear at the genuine 99th percentile of C49 (0.6889; the research level 0.25 flagged genuine portraits), the ramp width 0.5 kept, so this cue alone stays below a 0.5 score; genuine-only distribution; detection rate unmeasured',
  },
  {
    key: 'jpeg_grid_misalignment',
    clear: 0.27,
    suspicious: 1.02,
    weight: 0.5,
    uploadsOnly: false,
    basis:
      'provisional: a non-aligned JPEG grid confined to the face (Bianchi and Piva 2012); weak evidence on resized or re-encoded images, hence the lower weight; clear at the genuine 99th percentile of C49 (0.2638; the research level 0.25 flagged genuine photos), the ramp width 0.75 kept; genuine-only distribution; detection rate unmeasured',
  },
  {
    key: 'canonical_landmark_distance',
    clear: 0.05,
    suspicious: 0.01,
    weight: 0.8,
    uploadsOnly: true,
    basis:
      'provisional: the five landmarks within 1% of the image size of the FFHQ-aligned position (Yang et al. 2019); a crop defeats it; checked against C49 (genuine 1st percentile 0.22, above clear); genuine-only distribution; detection rate unmeasured',
  },
] satisfies SyntheticSignal[]);

/** IPTC digital source types that fail the check outright (`provenance_marks_synthetic`). */
export const SYNTHETIC_DIGITAL_SOURCE_TYPES: readonly string[] = Object.freeze([
  'trainedAlgorithmicMedia',
  'compositeSynthetic',
]);

/** The IPTC term of a digital source type value (a bare term or a NewsCodes URI). */
export function digitalSourceTermOf(value: string | null): string | null {
  const term =
    value
      ?.split('/')
      .filter((part) => part !== '')
      .at(-1) ?? '';
  return term === '' ? null : term;
}

const kebab = (key: string) => key.replaceAll('_', '-');

/** The fused synthetic-face score; `null` when no applicable cue was measured. */
export function syntheticFaceScore(
  scores: SyntheticScoresInput,
  options: { upload: boolean },
): HeuristicScore | null {
  const applicable = SYNTHETIC_SIGNALS.filter((signal) => options.upload || !signal.uploadsOnly);
  const components: Record<string, number> = {};
  let score = 0;
  for (const signal of applicable) {
    const value = scores[signal.key];
    if (value === null) {
      continue;
    }
    const suspicion = clamp01((value - signal.clear) / (signal.suspicious - signal.clear));
    components[kebab(signal.key)] = round4(suspicion);
    score = Math.max(score, signal.weight * suspicion);
  }
  const measured = Object.keys(components).length;
  if (measured === 0) {
    return null;
  }
  return { score: round4(score), components, coverage: round4(measured / applicable.length) };
}
