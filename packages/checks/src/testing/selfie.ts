/**
 * Test helpers: synthetic selfie inputs for the C43 evaluators. Every value is made up here
 * (seeded unit vectors, drawn landmarks, round layouts); nothing comes from a real face or a real
 * background. Test-only.
 */
import type { CheckId, VerificationTemplateConfig } from '@openverify/core';
import type {
  PoseConsistencyInput,
  SelfieAnalysisInput,
  SelfiePoseAnalysisInput,
} from '../phase1/inputs.js';
import { selfieContext, type SelfieContext } from '../selfie/context.js';
import type {
  SelfieCaptureInput,
  SelfieCheckInput,
  SelfiePose,
  SidePose,
} from '../selfie/inputs.js';

export const NOW = new Date('2026-10-21T12:00:00Z');
export const CREATED_AT = new Date('2026-10-21T11:58:00Z');

/** A deterministic 128-dimension unit vector (a seeded LCG): a synthetic embedding. */
export function unitVector(seed: number): number[] {
  let state = seed >>> 0;
  const values = Array.from({ length: 128 }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32 - 0.5;
  });
  const norm = Math.hypot(...values);
  return values.map((value) => value / norm);
}

/** A unit vector at cosine `cosine` to `base`, built from `seed`'s direction. */
export function vectorAtCosine(base: readonly number[], seed: number, cosine: number): number[] {
  const other = unitVector(seed);
  const dot = other.reduce((sum, value, index) => sum + value * (base[index] ?? 0), 0);
  const orthogonal = other.map((value, index) => value - dot * (base[index] ?? 0));
  const norm = Math.hypot(...orthogonal);
  const sine = Math.sqrt(1 - cosine * cosine);
  return base.map((value, index) => cosine * value + sine * ((orthogonal[index] ?? 0) / norm));
}

export const CENTER_EMBEDDING = unitVector(11);
/** The ID portrait: the same synthetic person (cosine 0.62 to the centre face). */
export const ID_EMBEDDING = vectorAtCosine(CENTER_EMBEDDING, 12, 0.62);

const BOX = [244, 104, 152, 204] as const;

/** Five drawn YuNet points in `BOX` whose yaw ratio is `yawRatio`. */
function landmarks(yawRatio: number): [number, number][] {
  const [x, y, width, height] = BOX;
  const rightEye = x + 0.3 * width;
  const leftEye = x + 0.7 * width;
  const eyeY = y + 0.38 * height;
  return [
    [rightEye, eyeY],
    [leftEye, eyeY],
    [(rightEye + leftEye) / 2 + yawRatio * (leftEye - rightEye), y + 0.58 * height],
    [x + 0.35 * width, y + 0.78 * height],
    [x + 0.65 * width, y + 0.78 * height],
  ];
}

/** A usable, well-taken pose at `yawRatio`, with every C41.1 measurement. */
export function selfiePose(
  yawRatio: number,
  overrides: Partial<SelfiePoseAnalysisInput> = {},
): SelfiePoseAnalysisInput {
  const [x, y, width, height] = BOX;
  return {
    quality: {
      blur_score: 410,
      is_blurry: false,
      glare_ratio: 0.002,
      has_glare: false,
      brightness: 0.42,
      is_too_dark: false,
      is_too_bright: false,
    },
    faces: [{ bbox: [...BOX], score: 0.95, landmarks: landmarks(yawRatio) }],
    face: { bbox: [...BOX], score: 0.95, embedding: CENTER_EMBEDDING },
    image: { width: 640, height: 480 },
    face_quality: {
      box: [x, y, width, height],
      width_px: width,
      height_ratio: height / 480,
      center_offset: [0.01, -0.06],
      blur_score: 180,
      brightness: 0.4,
      glare_ratio: 0.001,
    },
    head_pose: {
      yaw_ratio: yawRatio,
      roll_deg: 1,
      yaw_deg: yawRatio * 160,
      pitch_deg: 8,
      method: 'yunet-5pt',
    },
    passive_liveness: {
      v2: 0.96,
      v1se: 0.98,
      mean: 0.97,
      effective_scales: { v2: 2.4, v1se: 2.4 },
    },
    occlusion: {
      covering: {
        score: 0.08,
        skin_fraction_ratio: 0.97,
        texture_ratio: 1.04,
        delta_e: 3.1,
        forehead_valid: true,
      },
      glasses: {
        score: 0.11,
        rim_edge_energy: 0.04,
        lens_highlight_ratio: 0,
        bridge_edge_density: 0.03,
      },
    },
    synthetic: {
      spectral_tail_deviation: 0.1,
      residual_peak_ratio: 1.5,
      noise_inconsistency: 0.08,
      jpeg_grid_misalignment: 0,
      canonical_landmark_distance: 0.3,
      digital_source_type: null,
    },
    background: null,
    ...overrides,
  };
}

/** A well-measured side pose: same face, 3-D motion, not a duplicate. */
export function consistencyFor(
  pose: SidePose,
  overrides: Partial<PoseConsistencyInput> = {},
): PoseConsistencyInput {
  return {
    pose,
    face_cosine_to_center: 0.88,
    planarity: { tracked_points: 52, median_residual_ratio: 0.0094, p90_residual_ratio: 0.026 },
    registered_ssim: 0.74,
    raw_ssim: 0.43,
    duplicate_of_center: false,
    ...overrides,
  };
}

/** The yaw ratio of each pose in a correct capture (the user's left is positive, C41.1). */
export const YAW = Object.freeze({ center: 0.004, left: 0.124, right: -0.118 });

/** A correct three-pose analysis: frontal centre, both turns well past the minimum. */
export function threePoseAnalysis(): SelfieAnalysisInput {
  return {
    poses: {
      center: selfiePose(YAW.center, {
        background: {
          layout: Array.from({ length: 144 }, (_, index) => (index % 7) * 10),
          valid_cells: '1'.repeat(36) + '0'.repeat(12),
          coverage: 0.75,
        },
      }),
      left: selfiePose(YAW.left, {
        face: {
          bbox: [...BOX],
          score: 0.93,
          embedding: vectorAtCosine(CENTER_EMBEDDING, 21, 0.88),
        },
      }),
      right: selfiePose(YAW.right, {
        face: { bbox: [...BOX], score: 0.93, embedding: vectorAtCosine(CENTER_EMBEDDING, 22, 0.9) },
      }),
    },
    consistency: [consistencyFor('left'), consistencyFor('right', { face_cosine_to_center: 0.9 })],
  };
}

/** A centre-only analysis (`poses: ["center"]`). */
export function centerOnlyAnalysis(): SelfieAnalysisInput {
  const analysis = threePoseAnalysis();
  return { poses: { center: analysis.poses.center, left: null, right: null }, consistency: [] };
}

const at = (seconds: number) => new Date(CREATED_AT.getTime() + seconds * 1000);

/** A live camera capture with active liveness, prompted centre, right, left, uploaded per pose. */
export function cameraCapture(overrides: Partial<SelfieCaptureInput> = {}): SelfieCaptureInput {
  return {
    method: 'camera',
    liveness: 'active',
    prompts: ['center', 'right', 'left'],
    promptTimings: [
      { pose: 'center', clientElapsedMs: 2100, receivedAt: at(2.4) },
      { pose: 'right', clientElapsedMs: 5300, receivedAt: at(5.7) },
      { pose: 'left', clientElapsedMs: 8800, receivedAt: at(9.1) },
    ],
    createdAt: CREATED_AT,
    expiresAt: at(180),
    submittedAt: at(10),
    device: {
      labelIsFilePath: false,
      virtualCamera: false,
      webdriver: false,
      imageMirrored: false,
    },
    replayedPoses: [],
    ...overrides,
  };
}

/** The checks named, enabled and required, with `config` where given. */
export function selfieTemplate(
  checks: readonly CheckId[],
  configs: Readonly<Partial<Record<CheckId, Record<string, unknown>>>> = {},
): VerificationTemplateConfig {
  return {
    checks: Object.fromEntries(
      checks.map((id) => {
        const config = configs[id];
        return [id, { enabled: true, required: true, ...(config === undefined ? {} : { config }) }];
      }),
    ),
  };
}

/** A complete, genuine input: three poses, a live capture, consent, a matching ID portrait. */
export function selfieInput(overrides: Partial<SelfieCheckInput> = {}): SelfieCheckInput {
  return {
    analysis: threePoseAnalysis(),
    capture: cameraCapture(),
    environment: 'production',
    now: NOW,
    matchingConsent: true,
    idReference: { kind: 'portrait', verificationId: 'ver_ID', embedding: ID_EMBEDDING },
    idBirthdate: '1990-02-14',
    history: {
      account: { kind: 'compared', templates: 2, bestCosine: 0.71 },
      repeat: {
        kind: 'searched',
        searched: 120,
        truncated: false,
        bestCosine: 0.21,
        matchCosines: [],
      },
      background: { kind: 'searched', candidates: [], skipped: 0 },
    },
    ...overrides,
  };
}

/** The context of {@link selfieInput} with `overrides`, under `template` (no config by default). */
export function selfieContextFor(
  overrides: Partial<SelfieCheckInput> = {},
  template: VerificationTemplateConfig = { checks: {} },
): SelfieContext {
  return selfieContext(selfieInput(overrides), template);
}

/** `analysis` with `pose` replaced by `patch` applied over it (or removed with `null`). */
export function withPose(
  analysis: SelfieAnalysisInput,
  pose: SelfiePose,
  patch: Partial<SelfiePoseAnalysisInput> | null,
): SelfieAnalysisInput {
  const current = analysis.poses[pose];
  return {
    ...analysis,
    poses: {
      ...analysis.poses,
      [pose]: patch === null || current == null ? null : { ...current, ...patch },
    },
  };
}

/** `analysis` with the `consistency` entry of `pose` patched (or removed with `null`). */
export function withConsistency(
  analysis: SelfieAnalysisInput,
  pose: SidePose,
  patch: Partial<PoseConsistencyInput> | null,
): SelfieAnalysisInput {
  const entries = analysis.consistency ?? [];
  return {
    ...analysis,
    consistency:
      patch === null
        ? entries.filter((entry) => entry.pose !== pose)
        : entries.map((entry) => (entry.pose === pose ? { ...entry, ...patch } : entry)),
  };
}
