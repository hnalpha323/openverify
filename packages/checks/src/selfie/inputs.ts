/**
 * What the §4.2 selfie evaluators read (C43): typed objects the worker builds. Every Phase 4 field
 * is optional, so the Phase 1-3 worker still compiles; an evaluator whose evidence is absent never
 * answers `passed`.
 *
 * - `analysis`: the C41.1 vision analysis per pose and the cross-pose `consistency`;
 * - `capture`: the C40.9 capture context (prompts, prompt-timings, liveness, method) with the
 *   device snapshot reduced to flags by `captureDeviceFlags` (the label never reaches a check)
 *   and the poses whose bytes replay a file stored outside this capture (`findReplayedDigests`);
 * - `environment`: the environment kind, read from the database by the worker;
 * - `idReference`: the C43 reference portrait of `selfie_id_comparison`;
 * - `matchingConsent` and `history`: the C42.3 consent and the account, repeat and background
 *   scan results;
 * - `providers`: the C44 provider answers.
 *
 * Biometric values (embeddings, landmarks, background layouts) are read, never copied into a
 * result (C39.4).
 */
import type { CheckModel } from '@openverify/core';
import type { EnvironmentKind } from '../data/feature-table.js';
import type { ProviderOutcome } from '../government-id/inputs.js';
import type { IdPortraitInput, SelfieAnalysisInput } from '../phase1/inputs.js';

export type { EnvironmentKind } from '../data/feature-table.js';

/** The selfie poses, centre first (C40.1). */
export const SELFIE_POSES = Object.freeze(['center', 'left', 'right'] as const);
export type SelfiePose = (typeof SELFIE_POSES)[number];
export type SidePose = Exclude<SelfiePose, 'center'>;

/** C40.1 `prompt-timings`: the latest file per pose, with the client's and the server's time. */
export interface SelfiePromptTimingInput {
  pose: SelfiePose;
  /** The client's milliseconds since it received the capture, or `null` when not sent. */
  clientElapsedMs: number | null;
  /** The server clock when the file was written (C40.3). */
  receivedAt: Date;
}

/**
 * The C40.4 device snapshot as flags (`captureDeviceFlags`). Client claims only: they stop
 * unsophisticated attackers, never a determined one.
 */
export interface SelfieDeviceFlags {
  /** The camera label is a file path, as Chromium's file-backed fake camera reports. */
  labelIsFilePath: boolean;
  /** The camera label is on the verified virtual-camera list (`VIRTUAL_CAMERA_NAMES`). */
  virtualCamera: boolean;
  /** `navigator.webdriver` was true. */
  webdriver: boolean;
  /** The saved image is mirrored, so the worker's yaw sign flips (C41.1). */
  imageMirrored: boolean;
}

/** The C40.9 capture context of the newest submitted capture. */
export interface SelfieCaptureInput {
  method: 'camera' | 'upload';
  liveness: 'passive' | 'active';
  /** Ordered poses, `center` first. */
  prompts: readonly SelfiePose[];
  promptTimings: readonly SelfiePromptTimingInput[];
  createdAt: Date;
  expiresAt: Date;
  submittedAt?: Date | null | undefined;
  /** The device snapshot's flags; `null` (or absent) when the client sent no snapshot. */
  device?: SelfieDeviceFlags | null | undefined;
  /**
   * Poses whose file has the SHA-256 of a file of another capture or inquiry in the environment
   * (C43 `capture_replayed`); `null` (or absent) when the lookup did not run.
   */
  replayedPoses?: readonly SelfiePose[] | null | undefined;
}

/**
 * The reference portrait of `selfie_id_comparison` (C43): the portrait of the latest government ID
 * verification of the inquiry that is `passed`, `submitted` or `needs_review` (as `idPortraitOf`);
 * or what is missing (no such verification, or one without a portrait); or `error` when embedding
 * the stored ID front failed on the job's last attempt.
 */
export type SelfieIdReferenceInput =
  | { kind: 'portrait'; verificationId: string; embedding: readonly number[] }
  | { kind: 'missing'; missing: 'government_id' | 'portrait' }
  | { kind: 'error' };

/**
 * `selfie_account_comparison` (C42.8): the current centre face against the decrypted templates of
 * the account's other inquiries. `templates` counts the templates compared; `bestCosine` is the
 * highest cosine, `null` without templates.
 */
export type AccountTemplatesInput =
  { kind: 'error' } | { kind: 'compared'; templates: number; bestCosine: number | null };

/**
 * The C42.4 1:N scan of `selfie_repeat_detection`: the templates of other accounts, newest first
 * up to `face-search-max-templates`. `matchCosines` holds every cosine at or above
 * {@link FACE_SCAN_FLOOR}, so the evaluator applies the configured threshold; `bestCosine` is the
 * highest cosine searched, `null` when none was.
 */
export type RepeatScanInput =
  | { kind: 'error' }
  | {
      kind: 'searched';
      searched: number;
      truncated: boolean;
      bestCosine: number | null;
      matchCosines: readonly number[];
    };

/** A verified background candidate (C42.8): its template's face and the C41.2 comparison. */
export interface BackgroundCandidateInput {
  /** Cosine of the candidate's decrypted template to the current centre face. */
  faceCosine: number;
  /**
   * Candidates whose templates match each other at the 1:1 threshold share a group (the worker
   * groups them), so the evaluator counts distinct faces.
   */
  faceGroup: number;
  goodMatches: number;
  inliers: number;
  inlierRatio: number;
}

/** The C42.8 background search: the candidates compared, and those skipped (missing files). */
export type BackgroundSearchInput =
  | { kind: 'error' }
  | { kind: 'searched'; candidates: readonly BackgroundCandidateInput[]; skipped: number };

export interface SelfieHistoryInput {
  account?: AccountTemplatesInput | undefined;
  repeat?: RepeatScanInput | undefined;
  background?: BackgroundSearchInput | undefined;
}

/** The C44 provider answers, by `SELFIE_PROVIDER_KINDS` key. */
export interface SelfieProviderOutcomes {
  selfieAgeEstimate?: ProviderOutcome<{ age: number }> | undefined;
  selfiePublicFigure?: ProviderOutcome<{ match: boolean; score: number }> | undefined;
  /** `score` is the provider's suspicion in [0, 1]. */
  suspiciousEntity?: ProviderOutcome<{ flagged: boolean; score: number }> | undefined;
}

/** The pinned models a selfie result may rest on (C39.1 `provenance.models`). */
export interface SelfieModels {
  faceDetector?: CheckModel | undefined;
  faceRecognizer?: CheckModel | undefined;
  antiSpoofV2?: CheckModel | undefined;
  antiSpoofV1se?: CheckModel | undefined;
  /** The canonical face points' source, which the pose results record (C39.1). */
  canonicalFaceMesh?: CheckModel | undefined;
}

export interface SelfieCheckInput {
  analysis: SelfieAnalysisInput;
  /**
   * Phase 1: the ID portrait, or `null` when none was found. Superseded by `idReference`, which
   * says what is missing; used only when `idReference` is absent.
   */
  idPortrait?: IdPortraitInput | null | undefined;
  /**
   * Phase 1: the face match threshold the worker applies when the template sets none; defaults to
   * `FACE_MATCH_DEFAULTS.threshold` (SFace, C39.3).
   */
  faceMatchThreshold?: number | undefined;
  idReference?: SelfieIdReferenceInput | undefined;
  /** The newest submitted capture; `null` or absent without one (before Phase 4, C40.7). */
  capture?: SelfieCaptureInput | null | undefined;
  /** `production` when omitted: the sandbox test-capture rule then never applies. */
  environment?: EnvironmentKind | undefined;
  /** The evaluation instant; now when omitted. */
  now?: Date | undefined;
  /** C42.3 matching consent; absent means not given. */
  matchingConsent?: boolean | undefined;
  /** The compared ID's birthdate (`YYYY-MM-DD`), for `selfie_age_comparison`. */
  idBirthdate?: string | null | undefined;
  history?: SelfieHistoryInput | undefined;
  providers?: SelfieProviderOutcomes | undefined;
  models?: SelfieModels | undefined;
}
