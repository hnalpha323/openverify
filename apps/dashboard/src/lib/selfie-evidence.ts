/**
 * The selfie evidence as the console shows it (C40.10, C43, C47), read from the API data only:
 * the verification's C40.10 attributes, its check results (their metadata and provenance), its
 * captures and the inquiry's files. Thresholds and their basis come from each result's
 * provenance (C39.3), never from the console's own copy of a default. Metadata is `unknown` in
 * the contract, so it is read defensively: a value of the wrong shape counts as not recorded.
 */
import {
  SELFIE_CHECK_IDS,
  SELFIE_POSE_FILE_KINDS,
  SELFIE_POSES,
  idSchema,
  type FileResource,
  type SelfieCaptureResource,
  type SelfiePose,
  type VerificationCheck,
  type VerificationResource,
} from '@openverify/contracts';
import {
  getCheckDefinition,
  isCheckId,
  type ThresholdBasis,
  type ThresholdValue,
} from '@openverify/core';
import {
  LIVENESS_COMPONENTS,
  THRESHOLD_BASIS_LABELS,
  type LivenessComponent,
} from './selfie-words';

export type SelfieVerification = Extract<VerificationResource, { type: 'verification/selfie' }>;
type SidePose = Exclude<SelfiePose, 'center'>;

/** How a threshold's value was set (C39.3): a default's basis, the template, or not recorded. */
export type ThresholdOrigin = ThresholdBasis | 'template' | 'unrecorded';

/** How a threshold's value was set (C39.3), in words. */
export const THRESHOLD_ORIGIN_WORDS: Readonly<Record<ThresholdOrigin, string>> = Object.freeze({
  ...THRESHOLD_BASIS_LABELS,
  template: 'Set by the template',
  unrecorded: 'Basis not recorded',
});

/** One threshold a result was judged against, and how its value was set. */
export interface AppliedThreshold {
  readonly key: string;
  readonly value: ThresholdValue;
  readonly origin: ThresholdOrigin;
}

/** A prompted pose and its photo; a photo of a pose the capture did not prompt comes last. */
export interface PosePhoto {
  readonly pose: SelfiePose;
  readonly file: FileResource | undefined;
  /** The consumed capture prompted this pose. */
  readonly prompted: boolean;
}

/** `selfie_id_comparison` (C43): the centre face against the portrait of a government ID. */
export interface IdComparison {
  readonly result: VerificationCheck | undefined;
  /** `document-similarity-score` (C40.10), the SFace cosine. */
  readonly similarity: number | null;
  readonly threshold: AppliedThreshold | null;
  /** The government ID verification whose portrait was compared (`id_verification_id`). */
  readonly referenceId: string | null;
  /** What was missing when nothing was compared (`metadata.reference`). */
  readonly missing: string | null;
}

export interface ScoreWithThreshold {
  readonly score: number | null;
  readonly threshold: AppliedThreshold | null;
}

/** A side pose's SFace cosine to the centre face, against `min-side-identity-cosine`. */
export interface SideSimilarity extends ScoreWithThreshold {
  readonly pose: SidePose;
}

/** What `selfie_liveness_detection` recorded (C43), as the console shows it. */
export interface LivenessEvidence {
  readonly result: VerificationCheck | undefined;
  /** In `LIVENESS_COMPONENTS` order; empty without a result. A status of the wrong shape is null. */
  readonly components: readonly {
    readonly component: LivenessComponent;
    readonly status: string | null;
  }[];
  readonly integrityFlags: readonly string[];
  readonly timingFlags: readonly string[];
  /** `undefined` when not recorded; `null` when the order could not be told. */
  readonly orderFollowed: boolean | null | undefined;
  readonly testCaptureDevice: boolean;
  readonly judgedPoses: readonly string[] | null;
  /** `liveness-score` (C40.10), the centre's passive P(real), against `min-passive-score`. */
  readonly livenessScore: ScoreWithThreshold;
  /** The prompted side poses, in prompt order. */
  readonly sideSimilarities: readonly SideSimilarity[];
}

const SELFIE_CHECKS: ReadonlySet<string> = new Set(SELFIE_CHECK_IDS);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** A selfie check's own result on the verification. */
function resultOf(verification: SelfieVerification, name: string): VerificationCheck | undefined {
  return verification.attributes.checks.find((check) => check.name === name);
}

/**
 * Whether a result's missing basis means the template set the key: a Phase 4 selfie evaluator at
 * the registry's current version records a basis for each default it used, and leaves the map out
 * only when it would be empty.
 */
function basisRecorded(check: VerificationCheck, version: number): boolean {
  if (!SELFIE_CHECKS.has(check.name) || !isCheckId(check.name)) {
    return false;
  }
  const current = getCheckDefinition(check.name)?.version;
  return current !== undefined && version >= current;
}

/**
 * The threshold `key` a result was judged against, with its origin (C39.3): the basis recorded
 * for a default; `template` for a key without one (the template set it); `unrecorded` for a
 * result that records no basis at all (an older implementation, or a check without bases).
 * `null` without the result, its provenance or the key.
 */
export function appliedThreshold(
  check: VerificationCheck | undefined,
  key: string,
): AppliedThreshold | null {
  const provenance = check?.provenance;
  // An own key only, so a key such as `constructor` never reads `Object.prototype`.
  const value =
    provenance != null && Object.hasOwn(provenance.thresholds, key)
      ? provenance.thresholds[key]
      : undefined;
  if (check === undefined || provenance == null || value === undefined) {
    return null;
  }
  const bases = provenance['threshold-basis'];
  const basis = bases !== undefined && Object.hasOwn(bases, key) ? bases[key] : undefined;
  let origin: ThresholdOrigin;
  if (basis !== undefined) {
    origin = basis;
  } else if (bases !== undefined || basisRecorded(check, provenance['implementation-version'])) {
    origin = 'template';
  } else {
    origin = 'unrecorded';
  }
  return { key, value, origin };
}

const createdAtDescending = (a: SelfieCaptureResource, b: SelfieCaptureResource) =>
  b.attributes['created-at'].localeCompare(a.attributes['created-at']) || b.id.localeCompare(a.id);

/** The captures of one verification, newest first (C40.1). */
export function capturesOf(
  captures: readonly SelfieCaptureResource[],
  verificationId: string,
): SelfieCaptureResource[] {
  return captures
    .filter((capture) => capture.relationships.verification.data.id === verificationId)
    .sort(createdAtDescending);
}

/**
 * The capture submit consumed: the newest with a submission time (`submitted`, `processed`, or
 * `errored` with `processing_failed`). A verification is submitted once, so there is one at most.
 */
export function consumedCapture(
  captures: readonly SelfieCaptureResource[],
): SelfieCaptureResource | undefined {
  return [...captures]
    .sort(createdAtDescending)
    .find((capture) => capture.attributes['submitted-at'] !== null);
}

/** The pose a selfie file was uploaded as, or `undefined` for any other kind. */
function poseOf(file: FileResource): SelfiePose | undefined {
  return SELFIE_POSES.find((pose) => SELFIE_POSE_FILE_KINDS[pose] === file.attributes.kind);
}

/**
 * The poses in the order they were prompted: the verification's `poses` (C40.10, the consumed
 * capture's prompts), else the consumed capture's prompts, else, for a selfie taken without a
 * capture (before Phase 4), the poses of its photos, centre first.
 */
export function promptOrder(
  verification: SelfieVerification,
  consumed: SelfieCaptureResource | undefined,
  files: readonly FileResource[],
): SelfiePose[] {
  const poses = verification.attributes.poses ?? consumed?.attributes.prompts;
  if (poses != null) {
    return [...poses];
  }
  const uploaded = new Set(files.map(poseOf));
  return SELFIE_POSES.filter((pose) => uploaded.has(pose));
}

/**
 * Each prompted pose with its photo (the latest file of its kind), then the photos of poses the
 * capture did not prompt. Files of other kinds are left out.
 */
export function posePhotos(
  order: readonly SelfiePose[],
  files: readonly FileResource[],
): PosePhoto[] {
  const latest = (pose: SelfiePose) => files.filter((file) => poseOf(file) === pose).at(-1);
  const prompted = order.map((pose) => ({ pose, file: latest(pose), prompted: true }));
  const others = SELFIE_POSES.filter((pose) => !order.includes(pose)).flatMap((pose) => {
    const file = latest(pose);
    return file === undefined ? [] : [{ pose, file, prompted: false }];
  });
  return [...prompted, ...others];
}

/** `selfie_id_comparison`'s similarity, threshold and reference (C40.10, C43). */
export function idComparisonOf(verification: SelfieVerification): IdComparison {
  const result = resultOf(verification, 'selfie_id_comparison');
  const metadata = result?.metadata ?? {};
  const reference = metadata.id_verification_id;
  return {
    result,
    similarity: verification.attributes['document-similarity-score'] ?? null,
    threshold: appliedThreshold(result, 'threshold'),
    referenceId: idSchema('ver').safeParse(reference).success ? (reference as string) : null,
    missing: typeof metadata.reference === 'string' ? metadata.reference : null,
  };
}

const SIDE_SCORE = {
  left: 'selfie-similarity-score-left',
  right: 'selfie-similarity-score-right',
} as const satisfies Record<SidePose, string>;

/** What `selfie_liveness_detection` recorded, and the C40.10 scores it judged (C43). */
export function livenessEvidenceOf(verification: SelfieVerification): LivenessEvidence {
  const { attributes } = verification;
  const result = resultOf(verification, 'selfie_liveness_detection');
  const metadata = result?.metadata ?? {};
  const components = isRecord(metadata.components) ? metadata.components : {};
  const order = metadata['order-followed'];
  const sideThreshold = appliedThreshold(result, 'min-side-identity-cosine');
  const poses: readonly SelfiePose[] = attributes.poses ?? SELFIE_POSES;
  const sides = poses.filter((pose): pose is SidePose => pose !== 'center');
  return {
    result,
    components:
      result === undefined
        ? []
        : LIVENESS_COMPONENTS.map((component) => {
            const status = components[component];
            return { component, status: typeof status === 'string' ? status : null };
          }),
    integrityFlags: strings(metadata['integrity-flags']),
    timingFlags: strings(metadata['timing-flags']),
    orderFollowed: typeof order === 'boolean' || order === null ? order : undefined,
    testCaptureDevice: metadata['test-capture-device'] === true,
    judgedPoses: Array.isArray(metadata['judged-poses']) ? strings(metadata['judged-poses']) : null,
    livenessScore: {
      score: attributes['liveness-score'] ?? null,
      threshold: appliedThreshold(result, 'min-passive-score'),
    },
    sideSimilarities: sides
      .map((pose) => ({
        pose,
        score: attributes[SIDE_SCORE[pose]] ?? null,
        threshold: sideThreshold,
      }))
      // Without the prompts (a selfie taken before captures), only the sides that were scored.
      .filter((side) => attributes.poses != null || side.score !== null),
  };
}

/** The front of the government ID whose portrait was compared, the latest of that kind. */
export function referenceFront(
  files: readonly FileResource[],
  referenceId: string | null,
): FileResource | undefined {
  if (referenceId === null) {
    return undefined;
  }
  return files
    .filter(
      (file) =>
        file.relationships.verification.data.id === referenceId && file.attributes.kind === 'front',
    )
    .at(-1);
}
