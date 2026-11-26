/**
 * Typed client for the flow API (contract C3), authenticated with the session token. Request
 * bodies and responses are checked against the `@openverify/contracts` zod schemas; errors are
 * `FlowApiError`s carrying the RFC 9457 problem document when the server sent one.
 *
 * The token is only ever put in the `Authorization` header: never in URLs, error messages or
 * logs. Requests omit cookies and the referrer, and each has a deadline (see `flow-transport`).
 */
import { createThemeAssetLoader, type ThemeAssetBytes } from '../theme/assets';
import {
  CLIENT_ELAPSED_MS_FIELD,
  SELFIE_CAPTURE_ID_FIELD,
  SELFIE_CAPTURE_NONCE_FIELD,
  createCryptoChallengeBodySchema,
  createFlowVerificationBodySchema,
  createSelfieCaptureBodySchema,
  fileDocumentSchema,
  flowConsentBodySchema,
  flowConsentResponseSchema,
  flowCryptoChallengeResponseSchema,
  flowFileUploadFieldsSchema,
  flowInputsBodySchema,
  flowOtpConfirmBodySchema,
  flowOtpSendBodySchema,
  flowSelfieCaptureDocumentSchema,
  flowSessionResponseSchema,
  flowSignalsSchema,
  flowSubmitVerificationBodySchema,
  flowVerificationDocumentSchema,
  idSchema,
  type CreateCryptoChallengeBody,
  type CreateFlowVerificationBody,
  type CreateSelfieCaptureBody,
  type FileKind,
  type FileResource,
  type FlowConsentBody,
  type FlowCryptoChallengeResponse,
  type FlowInputsBody,
  type FlowOtpConfirmBody,
  type FlowOtpSendBody,
  type FlowSelfieCaptureDocument,
  type FlowSessionResponse,
  type FlowSignals,
  type CreateHandoffBody,
  type CreateHandoffResponse,
  type CurrentHandoffResponse,
  createHandoffBodySchema,
  createHandoffResponseSchema,
  currentHandoffResponseSchema,
  type FlowSubmitVerificationBody,
  type FlowVerificationResource,
  type SelfieCaptureResource,
  type SubmitFlowScreenBody,
  selfieCaptureDocumentSchema,
  submitFlowScreenBodySchema,
  flowClientUnableBodySchema,
  flowClientUnableResponseSchema,
  type ClientUnableReason,
  type FlowClientUnableResponse,
  type FlowShareConsentAcceptBody,
  flowShareConsentAcceptBodySchema,
  flowShareConsentDeclineBodySchema,
  flowShareConsentWithdrawBodySchema,
} from '@openverify/contracts';
import { stepIdSchema, type CAPTURE_METHODS } from '@openverify/flow-spec';
import { z } from 'zod';
import { createFlowTransport, type FlowTimeouts } from './flow-transport';

export { FlowApiError, type FlowApiErrorKind } from './flow-api-error';
export { DEFAULT_FLOW_TIMEOUTS, type FlowTimeouts } from './flow-transport';

export interface FlowApiClient {
  /** `GET /api/v1/flow/session`. */
  getSession(signal?: AbortSignal): Promise<FlowSessionResponse>;
  /** `POST /api/v1/flow/consent`. */
  acceptConsent(body: FlowConsentBody, signal?: AbortSignal): Promise<{ acceptedAt: string }>;
  /** `POST /api/v1/flow/verifications`. */
  createVerification(
    body: CreateFlowVerificationBody,
    signal?: AbortSignal,
  ): Promise<FlowVerificationResource>;
  /** `POST /api/v1/flow/verifications/:id/selfies` (C40.2): the capture, with its nonce. */
  createSelfieCapture(
    verificationId: string,
    body: CreateSelfieCaptureBody,
    signal?: AbortSignal,
  ): Promise<FlowSelfieCaptureResource>;
  /**
   * `POST /api/v1/flow/verifications/:id/files` (multipart: `kind`, a selfie pose's capture
   * fields (C40.3), the client-reported `capture-method` (C153.2), then `file`).
   */
  uploadFile(
    verificationId: string,
    kind: FileKind,
    file: Blob,
    signal?: AbortSignal,
    capture?: SelfieUploadFields,
    captureMethod?: CaptureMethod,
  ): Promise<FileResource>;
  /** `POST /api/v1/flow/verifications/:id/submit`; a selfie names its capture (C40.4). */
  submitVerification(
    verificationId: string,
    signal?: AbortSignal,
    body?: FlowSubmitVerificationBody,
  ): Promise<FlowVerificationResource>;
  /** `GET /api/v1/flow/verifications/:id`, polled for status and retry hints. */
  getVerification(verificationId: string, signal?: AbortSignal): Promise<FlowVerificationResource>;
  /**
   * `POST /api/v1/flow/verifications/:id/otp` (C55): sends a code to the phone number or email
   * address; the answer carries the open code's `guidance.otp`, never the code.
   */
  sendOtp(
    verificationId: string,
    body: FlowOtpSendBody,
    signal?: AbortSignal,
  ): Promise<FlowVerificationResource>;
  /** `POST /api/v1/flow/verifications/:id/otp/confirm` (C55): a correct code confirms it. */
  confirmOtp(
    verificationId: string,
    body: FlowOtpConfirmBody,
    signal?: AbortSignal,
  ): Promise<FlowVerificationResource>;
  /** `POST /api/v1/flow/verifications/:id/inputs` (C52.3): the values a form step entered. */
  enterInputs(
    verificationId: string,
    body: FlowInputsBody,
    signal?: AbortSignal,
  ): Promise<FlowVerificationResource>;
  /** `POST /api/v1/flow/verifications/:id/crypto-challenges` (C57.2): the message to sign. */
  createCryptoChallenge(
    verificationId: string,
    body: CreateCryptoChallengeBody,
    signal?: AbortSignal,
  ): Promise<FlowCryptoChallengeResponse>;
  /**
   * `POST /api/v1/flow/signals` (C94.2, Workflow 7A): one signal body of the collector, answered
   * 202 with no content. The collector swallows a failure (C94.3).
   */
  sendSignals(body: FlowSignals, signal?: AbortSignal): Promise<void>;
  /**
   * `POST /api/v1/flow/handoffs` (C96.3, Workflow 7A): issues a handoff for the waiting step; a QR
   * answers its fragment, and a step with `confirmationCode` its six digits.
   */
  createHandoff(body: CreateHandoffBody, signal?: AbortSignal): Promise<CreateHandoffResponse>;
  /** `POST /api/v1/flow/handoffs/continue-here` (C96.3, F01): the new state. */
  continueHandoffHere(signal?: AbortSignal): Promise<CurrentHandoffResponse>;
  /**
   * `POST /api/v1/flow/screens/:stepId/submit` (C148.5, Workflow 9A): the current screen's values
   * and the pressed button's key; the server answers the session at the next step.
   */
  submitScreen(
    stepId: string,
    body: SubmitFlowScreenBody,
    signal?: AbortSignal,
  ): Promise<FlowSessionResponse>;
  /**
   * `POST /api/v1/flow/selfie-captures/:id/extend` (C171.4, WCAG 2.2.1): moves the open capture's
   * expiry by 180 s; answers the capture with its new `expires-at`.
   */
  extendSelfieCapture(captureId: string, signal?: AbortSignal): Promise<SelfieCaptureResource>;
  /** `GET /api/v1/flow/handoffs/current` (C96.3): polled while the phone works. */
  getCurrentHandoff(signal?: AbortSignal): Promise<CurrentHandoffResponse>;
  /** `POST /api/v1/flow/handoffs/current/reject` (C96.3, P15, V02): "this was not me". */
  rejectHandoff(signal?: AbortSignal): Promise<CurrentHandoffResponse>;
  /**
   * `GET /api/v1/flow/theme-assets/:id` (C160.6, C160.9; Workflow 9B): a logo's or a font's bytes,
   * of the session's environment only.
   */
  getThemeAsset(assetId: string, signal?: AbortSignal): Promise<ThemeAssetBytes>;
  /**
   * `POST /api/v1/flow/verifications/:id/client-unable` (C207.9, C207.10; Workflow 10C): this
   * client cannot read a document chip, so the flow takes the `nfc` step's fallback. The answer
   * says nothing of where the flow goes: the caller reads the session.
   */
  reportClientUnable(
    verificationId: string,
    reason: ClientUnableReason,
    signal?: AbortSignal,
  ): Promise<FlowClientUnableResponse>;
  /**
   * `POST /api/v1/flow/share-consents/:stepId/accept` (C238.4; Phase 11, Workflow 11A): the digests
   * of the texts the person was shown and the separate biometric tick; the answer is the session at
   * the next step.
   */
  acceptShareConsent(
    stepId: string,
    body: FlowShareConsentAcceptBody,
    signal?: AbortSignal,
  ): Promise<FlowSessionResponse>;
  /** `POST /api/v1/flow/share-consents/:stepId/decline` (C238.1): the flow continues. */
  declineShareConsent(stepId: string, signal?: AbortSignal): Promise<FlowSessionResponse>;
  /**
   * `POST /api/v1/flow/share-consents/:stepId/withdraw` (C237.6): withdraws a step listed in the
   * session's `withdrawable-share-consents`; the answer is the session where it was.
   */
  withdrawShareConsent(stepId: string, signal?: AbortSignal): Promise<FlowSessionResponse>;
}

/** C153.2: how the client says it captured a file (client-reported guidance, never proof). */
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/** C40.3: the capture a selfie pose belongs to, its nonce and the client's elapsed time. */
export interface SelfieUploadFields {
  readonly captureId: string;
  readonly nonce: string;
  /** Milliseconds since the capture was created, on the client's clock. */
  readonly clientElapsedMs: number;
}

/** The flow's view of a new selfie capture (C40.2). */
export type FlowSelfieCaptureResource = FlowSelfieCaptureDocument['data'];

export interface FlowApiClientOptions {
  /** API base URL from `parseApiBaseUrl`; `''` for the flow's own origin. */
  readonly baseUrl: string;
  readonly sessionToken: string;
  /** Injected in tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Request deadlines; defaults to `DEFAULT_FLOW_TIMEOUTS` (1B F018). */
  readonly timeouts?: Partial<FlowTimeouts>;
}

const API_PREFIX = '/api/v1/flow';
/** C153.2: the upload's client-reported capture method field. */
const CAPTURE_METHOD_FIELD = 'capture-method';
const verificationIdSchema = idSchema('ver');
const captureIdSchema = idSchema('self');

/** File extensions for the formats the API accepts; the server sniffs the bytes anyway. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  // C52.4: a document may be a PDF.
  'application/pdf': '.pdf',
};

/** C148.5: a screen's submit path; a step id outside its pattern never reaches a URL. */
function screenPath(stepId: string): string {
  if (!stepIdSchema.safeParse(stepId).success) {
    throw new TypeError('Malformed step ID');
  }
  return `${API_PREFIX}/screens/${stepId}/submit`;
}

/** C238.4, C237.6: a share-consent exit's path; a step id outside its pattern never reaches a URL. */
function shareConsentPath(stepId: string, exit: 'accept' | 'decline' | 'withdraw'): string {
  if (!stepIdSchema.safeParse(stepId).success) {
    throw new TypeError('Malformed step ID');
  }
  return `${API_PREFIX}/share-consents/${stepId}/${exit}`;
}

/** C171.4: a selfie capture's extension path. */
function capturePath(captureId: string): string {
  if (!captureIdSchema.safeParse(captureId).success) {
    throw new TypeError('Malformed selfie capture ID');
  }
  return `${API_PREFIX}/selfie-captures/${captureId}/extend`;
}

function verificationPath(verificationId: string, suffix = ''): string {
  if (!verificationIdSchema.safeParse(verificationId).success) {
    throw new TypeError('Malformed verification ID');
  }
  return `${API_PREFIX}/verifications/${verificationId}${suffix}`;
}

/** A safe file name for an upload: its kind, never the user's own file name. */
function uploadName(kind: FileKind, file: Blob): string {
  return `${kind}${EXTENSIONS[file.type] ?? ''}`;
}

export function createFlowApiClient(options: FlowApiClientOptions): FlowApiClient {
  const { sessionToken } = options;
  const transport = createFlowTransport(options);
  const readThemeAsset = createThemeAssetLoader({
    baseUrl: options.baseUrl,
    sessionToken,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const send: typeof transport.send = (schema, request) =>
    transport.send(schema, { ...request, token: sessionToken });

  return {
    getSession: (signal) =>
      send(flowSessionResponseSchema, { method: 'GET', path: `${API_PREFIX}/session`, signal }),

    acceptConsent: async (body, signal) => {
      const { consent } = await send(flowConsentResponseSchema, {
        method: 'POST',
        path: `${API_PREFIX}/consent`,
        json: flowConsentBodySchema.parse(body),
        signal,
      });
      return { acceptedAt: consent['accepted-at'] };
    },

    createVerification: async (body, signal) =>
      (
        await send(flowVerificationDocumentSchema, {
          method: 'POST',
          path: `${API_PREFIX}/verifications`,
          json: createFlowVerificationBodySchema.parse(body),
          signal,
        })
      ).data,

    createSelfieCapture: async (verificationId, body, signal) =>
      (
        await send(flowSelfieCaptureDocumentSchema, {
          method: 'POST',
          path: verificationPath(verificationId, '/selfies'),
          json: createSelfieCaptureBodySchema.parse(body),
          signal,
        })
      ).data,

    uploadFile: async (verificationId, kind, file, signal, capture, captureMethod) => {
      const path = verificationPath(verificationId, '/files');
      // The fields go first so a streaming multipart parser knows them before the file arrives.
      const fields = flowFileUploadFieldsSchema.parse({
        kind,
        ...(capture === undefined
          ? {}
          : {
              [SELFIE_CAPTURE_ID_FIELD]: capture.captureId,
              [SELFIE_CAPTURE_NONCE_FIELD]: capture.nonce,
              [CLIENT_ELAPSED_MS_FIELD]: String(capture.clientElapsedMs),
            }),
        ...(captureMethod === undefined ? {} : { [CAPTURE_METHOD_FIELD]: captureMethod }),
      });
      const form = new FormData();
      form.append('kind', fields.kind);
      if (capture !== undefined) {
        form.append(SELFIE_CAPTURE_ID_FIELD, capture.captureId);
        form.append(SELFIE_CAPTURE_NONCE_FIELD, capture.nonce);
        form.append(CLIENT_ELAPSED_MS_FIELD, String(capture.clientElapsedMs));
      }
      // C153.2: client-reported guidance for analytics, never proof of how the photo was taken.
      const method = fields[CAPTURE_METHOD_FIELD];
      if (method !== undefined) {
        form.append(CAPTURE_METHOD_FIELD, method);
      }
      form.append('file', file, uploadName(kind, file));
      return (await send(fileDocumentSchema, { method: 'POST', path, form, signal })).data;
    },

    submitVerification: async (verificationId, signal, body) =>
      (
        await send(flowVerificationDocumentSchema, {
          method: 'POST',
          path: verificationPath(verificationId, '/submit'),
          // A government ID sends no body; a selfie names its capture (C40.4).
          ...(body === undefined ? {} : { json: flowSubmitVerificationBodySchema.parse(body) }),
          signal,
        })
      ).data,

    getVerification: async (verificationId, signal) =>
      (
        await send(flowVerificationDocumentSchema, {
          method: 'GET',
          path: verificationPath(verificationId),
          signal,
        })
      ).data,

    sendOtp: async (verificationId, body, signal) =>
      (
        await send(flowVerificationDocumentSchema, {
          method: 'POST',
          path: verificationPath(verificationId, '/otp'),
          json: flowOtpSendBodySchema.parse(body),
          signal,
        })
      ).data,

    confirmOtp: async (verificationId, body, signal) =>
      (
        await send(flowVerificationDocumentSchema, {
          method: 'POST',
          path: verificationPath(verificationId, '/otp/confirm'),
          json: flowOtpConfirmBodySchema.parse(body),
          signal,
        })
      ).data,

    enterInputs: async (verificationId, body, signal) =>
      (
        await send(flowVerificationDocumentSchema, {
          method: 'POST',
          path: verificationPath(verificationId, '/inputs'),
          json: flowInputsBodySchema.parse(body),
          signal,
        })
      ).data,

    // C57.2: the 201 answer is the challenge itself, not a JSON:API document.
    createCryptoChallenge: async (verificationId, body, signal) => {
      const challenge = await send(flowCryptoChallengeResponseSchema, {
        method: 'POST',
        path: verificationPath(verificationId, '/crypto-challenges'),
        json: createCryptoChallengeBodySchema.parse(body),
        signal,
      });
      return challenge;
    },

    // C148.5 (Workflow 9A): the current screen's values; the answer is the session at the next step.
    submitScreen: async (stepId, body, signal) =>
      send(flowSessionResponseSchema, {
        method: 'POST',
        path: screenPath(stepId),
        json: submitFlowScreenBodySchema.parse(body),
        signal,
      }),

    // C171.4 (WCAG 2.2.1): the open capture's expiry moved by 180 s, answered without its nonce.
    extendSelfieCapture: async (captureId, signal) =>
      (
        await send(selfieCaptureDocumentSchema, {
          method: 'POST',
          path: capturePath(captureId),
          signal,
        })
      ).data,

    // C96.3 (Workflow 7A): the issuing session's handoff calls.
    createHandoff: (body, signal) =>
      send(createHandoffResponseSchema, {
        method: 'POST',
        path: `${API_PREFIX}/handoffs`,
        json: createHandoffBodySchema.parse(body),
        signal,
      }),
    continueHandoffHere: (signal) =>
      send(currentHandoffResponseSchema, {
        method: 'POST',
        path: `${API_PREFIX}/handoffs/continue-here`,
        json: {},
        signal,
      }),
    getCurrentHandoff: (signal) =>
      send(currentHandoffResponseSchema, {
        method: 'GET',
        path: `${API_PREFIX}/handoffs/current`,
        signal,
      }),
    // C160.6, C160.9 (Workflow 9B): a logo's or a font's bytes, through the theme's own loader.
    getThemeAsset: (assetId, signal) => readThemeAsset(assetId, signal),
    // C207.9, C207.10 (Workflow 10C, api-nfc): this client cannot read a document chip.
    reportClientUnable: (verificationId, reason, signal) =>
      send(flowClientUnableResponseSchema, {
        method: 'POST',
        path: verificationPath(verificationId, '/client-unable'),
        json: flowClientUnableBodySchema.parse({ reason }),
        signal,
      }),
    rejectHandoff: (signal) =>
      send(currentHandoffResponseSchema, {
        method: 'POST',
        path: `${API_PREFIX}/handoffs/current/reject`,
        json: {},
        signal,
      }),
    // C238.4, C237.6 (Workflow 11A, clients-connect): the share-consent exits, each answered with
    // the session (at the next step, or where it was for a withdrawal).
    acceptShareConsent: async (stepId, body, signal) =>
      send(flowSessionResponseSchema, {
        method: 'POST',
        path: shareConsentPath(stepId, 'accept'),
        json: flowShareConsentAcceptBodySchema.parse(body),
        signal,
      }),
    declineShareConsent: async (stepId, signal) =>
      send(flowSessionResponseSchema, {
        method: 'POST',
        path: shareConsentPath(stepId, 'decline'),
        json: flowShareConsentDeclineBodySchema.parse({}),
        signal,
      }),
    withdrawShareConsent: async (stepId, signal) =>
      send(flowSessionResponseSchema, {
        method: 'POST',
        path: shareConsentPath(stepId, 'withdraw'),
        json: flowShareConsentWithdrawBodySchema.parse({}),
        signal,
      }),

    // C94.2: answered 202 with a JSON `null`. K7A-11: `keepalive`, so the open screen's body,
    // sent on `pagehide`, outlives the page; a body is at most 8 KiB.
    sendSignals: async (body, signal) => {
      await send(z.null(), {
        method: 'POST',
        path: `${API_PREFIX}/signals`,
        json: flowSignalsSchema.parse(body),
        signal,
        keepalive: true,
      });
    },
  };
}
