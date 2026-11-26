/**
 * Synthetic Phase 4 selfie documents (C40, C43, C47) for the selfie surfaces. No real people and
 * no real identifiers: every ID is a made-up ULID, every score, digest and time is invented, and
 * nothing here comes from a real face. The thresholds and bases are deliberately not the shipped
 * defaults, so a test proves the console reads them from the API data. Each builder parses its
 * result with the contract schema.
 */
import {
  dashboardInquiryDocumentSchema,
  eventResourceSchema,
  selfieCaptureResourceSchema,
  verificationResourceSchema,
  type DashboardInquiryDocument,
  type EventResource,
  type SelfieCaptureResource,
  type VerificationCheck,
} from '@openverify/contracts';
import type { SelfieEventName } from '../lib/event-words';
import type { SelfieVerification } from '../lib/selfie-evidence';
import { LIFECYCLE_IDS, T0, T1, inquiry } from './lifecycle-fixtures';

export const SELFIE_IDS = {
  ...LIFECYCLE_IDS,
  selfieLeft: 'file_01JB0000000000000000000004',
  selfieRight: 'file_01JB0000000000000000000005',
  capture: 'self_01JB0000000000000000000010',
  supersededCapture: 'self_01JB0000000000000000000011',
} as const;

const IDS = SELFIE_IDS;

/** A synthetic model pin: an invented id and digest. */
const model = (id: string, digit: string) => ({ id, sha256: digit.repeat(64) });
const MODELS = [model('synthetic-face-detector', 'a'), model('synthetic-face-recognizer', 'b')];

/** The five required checks of the default template, as a passed Phase 4 selfie has them. */
export function selfieChecks(): VerificationCheck[] {
  return [
    {
      name: 'selfie_image_quality_detection',
      status: 'passed',
      reasons: [],
      requirement: 'required',
      metadata: { 'face-box': [0.3125, 0.2083, 0.375, 0.5] },
      stage: 'beta',
      confidence: null,
      provenance: {
        'implementation-version': 2,
        models: MODELS,
        thresholds: { 'min-face-blur-score': 15 },
        'threshold-basis': { 'min-face-blur-score': 'provisional' },
      },
    },
    {
      name: 'selfie_pose_detection',
      status: 'passed',
      reasons: [],
      requirement: 'required',
      metadata: {},
      stage: 'beta',
      confidence: null,
      provenance: { 'implementation-version': 1, models: MODELS, thresholds: {} },
    },
    {
      name: 'selfie_liveness_detection',
      status: 'passed',
      reasons: [],
      requirement: 'required',
      metadata: {
        components: { passive: 'passed', active: 'passed', integrity: 'not_executed' },
        'liveness-score': 0.8811,
        'passive-scores': { center: 0.8811, right: 0.9102, left: 0.9333 },
        'face-cosines': { right: 0.8123, left: 0.7954 },
        'capture-method': 'camera',
        'judged-poses': ['right', 'left'],
        'order-followed': true,
        'timing-flags': ['uploads-batched'],
        'integrity-flags': ['file-path-label', 'webdriver'],
        'test-capture-device': true,
      },
      stage: 'beta',
      confidence: 0.4,
      provenance: {
        'implementation-version': 1,
        models: MODELS,
        // The template set the side-identity cosine; the passive score is a default.
        thresholds: { 'min-passive-score': 0.55, 'min-side-identity-cosine': 0.45 },
        'threshold-basis': { 'min-passive-score': 'provisional' },
      },
    },
    {
      name: 'selfie_id_comparison',
      status: 'passed',
      reasons: [],
      requirement: 'required',
      metadata: {
        similarity: 0.6512,
        threshold: 0.371,
        confidence: 0.9,
        confidence_stage: 'beta',
        id_verification_id: IDS.governmentId,
      },
      stage: 'beta',
      confidence: 0.9,
      provenance: {
        'implementation-version': 2,
        models: MODELS,
        thresholds: { threshold: 0.371 },
        'threshold-basis': { threshold: 'calibrated' },
      },
    },
  ];
}

type SelfieAttributes = SelfieVerification['attributes'];

/** The inquiry's selfie verification, passed, with the C40.10 attributes of its capture. */
export function selfieVerification(attributes: Partial<SelfieAttributes> = {}): SelfieVerification {
  const verification = verificationResourceSchema.parse({
    type: 'verification/selfie',
    id: IDS.selfie,
    attributes: {
      status: 'passed',
      checks: selfieChecks(),
      'capture-method': 'camera',
      liveness: 'active',
      // A random side order (C40.2): right before left.
      poses: ['center', 'right', 'left'],
      'document-similarity-score': 0.6512,
      'selfie-similarity-score-left': 0.7954,
      'selfie-similarity-score-right': 0.8123,
      'liveness-score': 0.8811,
      'center-photo-face-coordinates': [
        [0.3125, 0.2083],
        [0.6875, 0.2083],
        [0.6875, 0.7083],
        [0.3125, 0.7083],
      ],
      'created-at': T0,
      'updated-at': T1,
      ...attributes,
    },
    relationships: {
      inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
      // Listed out of prompt order on purpose: the console must follow the prompts.
      files: {
        data: [
          { type: 'file', id: IDS.selfieLeft },
          { type: 'file', id: IDS.selfieCenter },
          { type: 'file', id: IDS.selfieRight },
        ],
      },
      selfies: {
        data: [
          { type: 'selfie', id: IDS.capture },
          { type: 'selfie', id: IDS.supersededCapture },
        ],
      },
    },
  });
  if (verification.type !== 'verification/selfie') {
    throw new Error('Not a selfie verification');
  }
  return verification;
}

type CaptureAttributes = SelfieCaptureResource['attributes'];

/** The capture submit consumed: processed, with its three prompt timings. */
export function selfieCapture(
  attributes: Partial<CaptureAttributes> = {},
  id: string = IDS.capture,
): SelfieCaptureResource {
  return selfieCaptureResourceSchema.parse({
    type: 'selfie',
    id,
    attributes: {
      status: 'processed',
      'capture-method': 'camera',
      liveness: 'active',
      prompts: ['center', 'right', 'left'],
      'prompt-timings': [
        { pose: 'center', 'client-elapsed-ms': 4200, 'received-at': '2026-10-20T04:37:05.000Z' },
        { pose: 'right', 'client-elapsed-ms': 9100, 'received-at': '2026-10-20T04:37:10.000Z' },
        { pose: 'left', 'client-elapsed-ms': 14050, 'received-at': '2026-10-20T04:37:15.000Z' },
      ],
      'created-at': '2026-10-20T04:37:00.000Z',
      'expires-at': '2026-10-20T04:40:00.000Z',
      'submitted-at': '2026-10-20T04:37:20.000Z',
      'processed-at': '2026-10-20T04:37:40.000Z',
      'error-code': null,
      ...attributes,
    },
    relationships: {
      verification: { data: { type: 'verification/selfie', id: IDS.selfie } },
      inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
    },
  });
}

/** An earlier capture of the same verification that a newer one superseded (C40.2). */
export function supersededCapture(): SelfieCaptureResource {
  return selfieCapture(
    {
      status: 'errored',
      'prompt-timings': [],
      'created-at': '2026-10-20T04:36:00.000Z',
      'expires-at': '2026-10-20T04:39:00.000Z',
      'submitted-at': null,
      'processed-at': null,
      'error-code': 'superseded',
    },
    IDS.supersededCapture,
  );
}

function file(id: string, kind: string, verificationId: string, verificationType: string) {
  return {
    type: 'file',
    id,
    attributes: { kind, 'mime-type': 'image/jpeg', 'byte-size': 2048, 'created-at': T0 },
    relationships: { verification: { data: { type: verificationType, id: verificationId } } },
  };
}

/**
 * `GET /dashboard/inquiries/:id` with a passed government ID (both sides) and a passed Phase 4
 * selfie: three poses prompted center, right, left, its consumed capture and a superseded one.
 */
export function selfieInquiryDocument(
  selfie: SelfieVerification = selfieVerification(),
  captures: readonly SelfieCaptureResource[] = [selfieCapture(), supersededCapture()],
): DashboardInquiryDocument {
  const base = inquiry();
  return dashboardInquiryDocumentSchema.parse({
    data: {
      ...base,
      relationships: {
        ...base.relationships,
        selfies: { data: captures.map((capture) => ({ type: 'selfie', id: capture.id })) },
      },
    },
    included: [
      {
        type: 'verification/government-id',
        id: IDS.governmentId,
        attributes: {
          status: 'passed',
          country: null,
          'id-class': 'national_id',
          checks: [],
          'created-at': T0,
          'updated-at': T1,
        },
        relationships: {
          inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
          files: {
            data: [
              { type: 'file', id: IDS.front },
              { type: 'file', id: IDS.back },
            ],
          },
        },
      },
      selfie,
      file(IDS.front, 'front', IDS.governmentId, 'verification/government-id'),
      file(IDS.back, 'back', IDS.governmentId, 'verification/government-id'),
      // Out of prompt order on purpose, as in the verification's relationships.
      file(IDS.selfieLeft, 'selfie-left', IDS.selfie, 'verification/selfie'),
      file(IDS.selfieCenter, 'selfie-center', IDS.selfie, 'verification/selfie'),
      file(IDS.selfieRight, 'selfie-right', IDS.selfie, 'verification/selfie'),
      ...captures,
    ],
  });
}

/** A `selfie.*` event about a capture (C40.8); `redacted` gives the C16 stub payload. */
export function selfieEvent(
  name: SelfieEventName,
  capture: SelfieCaptureResource | 'redacted' = selfieCapture(),
  id = 'evt_01JB0000000000000000000010',
): EventResource {
  const data =
    capture === 'redacted'
      ? { type: 'selfie', id: IDS.capture, attributes: { 'redacted-at': T1 } }
      : capture;
  return eventResourceSchema.parse({
    type: 'event',
    id,
    attributes: { name, payload: { data }, simulated: false, 'created-at': T1 },
  });
}
