/**
 * The selfie capture and liveness vocabulary in words (C40, C43, C47): the poses, a capture's
 * status, error code and method, the liveness mode, the basis of a threshold (C39.3), the three
 * liveness components with their statuses, and every flag `selfie_liveness_detection` records.
 *
 * The test (`selfie-words.test.ts`) reads the flags from the evaluators' own source
 * (`packages/checks/src/selfie`) and the other lists from the contracts, so a value added there
 * without words here fails it. A flag the console does not know yet is shown as its code.
 */
import type { SelfiePose } from '@openverify/contracts';
import type {
  SelfieCaptureErrorCode,
  SelfieCaptureMethod,
  SelfieCaptureStatus,
  ThresholdBasis,
} from '@openverify/core';

/** What a word list gives: short words, and a sentence where the words need one. */
export interface WordsText {
  readonly words: string;
  readonly explanation?: string;
}

/** The components of `selfie_liveness_detection`'s `metadata.components` (C43). */
export const LIVENESS_COMPONENTS = ['passive', 'active', 'integrity'] as const;
export type LivenessComponent = (typeof LIVENESS_COMPONENTS)[number];
/** What each component can be (C43). */
export const LIVENESS_COMPONENT_STATUSES = [
  'passed',
  'failed',
  'not_requested',
  'not_executed',
] as const;
export type LivenessComponentStatus = (typeof LIVENESS_COMPONENT_STATUSES)[number];

/** The poses as the console labels their photos (`FILE_KIND_LABELS` says the same). */
export const POSE_LABELS: Readonly<Record<SelfiePose, string>> = Object.freeze({
  center: 'Center',
  left: 'Left',
  right: 'Right',
});

export const CAPTURE_STATUS_LABELS: Readonly<Record<SelfieCaptureStatus, string>> = Object.freeze({
  initiated: 'Open',
  submitted: 'Submitted',
  processed: 'Processed',
  errored: 'Errored',
});

/** Why a capture errored (C40.1 `error-code`): the words, and what happened. */
export const CAPTURE_ERROR_TEXT: Readonly<Record<SelfieCaptureErrorCode, WordsText>> =
  Object.freeze({
    superseded: {
      words: 'Superseded',
      explanation: 'A newer capture replaced it before it was submitted.',
    },
    expired: {
      words: 'Expired',
      explanation: 'It expired before it was submitted, and a newer capture was started.',
    },
    canceled: {
      words: 'Canceled',
      explanation: 'Its verification or inquiry ended before it was submitted.',
    },
    processing_failed: {
      words: 'Processing failed',
      explanation: 'It was submitted, but the checks could not run on it.',
    },
  });

export const CAPTURE_METHOD_LABELS: Readonly<Record<SelfieCaptureMethod, string>> = Object.freeze({
  camera: 'Camera',
  upload: 'Photo upload (sandbox)',
});

export const LIVENESS_MODE_LABELS: Readonly<Record<'passive' | 'active', string>> = Object.freeze({
  passive: 'Passive',
  active: 'Active (head turns)',
});

/** C39.3: how a default threshold was set. A key without a basis was set by the template. */
export const THRESHOLD_BASIS_LABELS: Readonly<Record<ThresholdBasis, string>> = Object.freeze({
  calibrated: 'Calibrated',
  provisional: 'Provisional',
});

export const LIVENESS_COMPONENT_LABELS: Readonly<Record<LivenessComponent, string>> = Object.freeze(
  { passive: 'Passive', active: 'Active', integrity: 'Integrity' },
);

export const LIVENESS_COMPONENT_STATUS_LABELS: Readonly<Record<LivenessComponentStatus, string>> =
  Object.freeze({
    passed: 'Passed',
    failed: 'Failed',
    not_requested: 'Not requested',
    not_executed: 'Not run',
  });

/**
 * The flags of `selfie_liveness_detection` (C43): `integrity-flags`, `timing-flags`, and
 * `test-capture-device`. Order and timing flags only lower the confidence of a pass; in a sandbox
 * the automation and replay flags are recorded and not judged.
 */
const FLAG_TEXT: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  // Integrity: client claims of the device snapshot, and the replay lookup.
  ['file-path-label', { words: 'The camera label is a file path' }],
  ['webdriver', { words: 'The browser was under automation (webdriver)' }],
  [
    'virtual-camera',
    {
      words: 'The camera is on the virtual-camera list',
      explanation: 'A risk flag that sends the selfie to review when nothing else failed.',
    },
  ],
  ['replayed-bytes', { words: 'A photo has the bytes of a file stored before' }],
  // Timing: client-controlled, so they only lower the confidence of a pass.
  ['timing-missing', { words: 'A prompted pose has no timing' }],
  ['client-elapsed-missing', { words: 'The client sent no elapsed time for a pose' }],
  ['client-elapsed-not-increasing', { words: "The client's clock did not move forward" }],
  ['uploads-batched', { words: 'Poses arrived together, not one by one' }],
  ['client-server-skew', { words: "The client's and the server's intervals disagree" }],
  ['received-outside-window', { words: "A photo arrived outside the capture's lifetime" }],
  // The sandbox test-capture rule (C43, decision 7).
  [
    'test-capture-device',
    {
      words: 'Sandbox test capture',
      explanation:
        'In a sandbox, a file-path camera label, webdriver and replayed photos are recorded, not judged.',
    },
  ],
]);

/** The words of a flag `selfie_liveness_detection` records, or `undefined` for an unknown one. */
export function livenessFlagText(flag: string): WordsText | undefined {
  return FLAG_TEXT.get(flag);
}

/** Whether the poses arrived in the prompted order (`order-followed`), in words. */
export function orderFollowedText(value: boolean | null): string {
  if (value === null) {
    return 'Order could not be told';
  }
  return value ? 'In the prompted order' : 'Not in the prompted order';
}
