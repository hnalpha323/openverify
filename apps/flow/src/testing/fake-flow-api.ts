/**
 * An in-memory flow API for component and renderer tests. It follows the C3 rules the client
 * depends on: consent before uploads, one verification per attempt, attempts counted per type,
 * and the inquiry completing or failing once its verifications are decided.
 *
 * Selfie captures follow C40: a capture has a nonce and prompts (`center` first); a selfie pose
 * is uploaded with the capture's id and nonce; submit names the capture, which must have a file
 * for every prompt. A new capture supersedes the open one. Anything else answers 409
 * `selfie_capture_invalid` (or `selfie_capture_incomplete`), as the server does.
 *
 * Phone and email codes follow C55 on the fake's own clock (`nowMs`): five sends with the
 * 30/60/120/240 s cooldowns, five tries per code, a 600 s lifetime, ten wrong entries in all; a
 * send after the last one, or ten wrong entries, submits the verification; a confirmed code moves
 * it to `confirmed`, and only a confirmed one (or one a limit refused) may be submitted. The code
 * is `otpCode`, synthetic. `failures` queues golden problems a method answers first.
 *
 * Wallet challenges follow C57.2: a chain the step does not offer, a malformed EVM address or one
 * other than `expectedWalletAddress` is refused; a new challenge supersedes the open one; the
 * eleventh cancels the verification. A submit must name the open, unexpired challenge (C57.3).
 *
 * Entered values follow C52.3: a database body may carry only the step's fields and must carry
 * its required ones, the step's and the three every step collects (422 with a JSON Pointer per
 * member otherwise); a form type is submitted only
 * once its values were received (409 `inputs_required`). The fake keeps the values to assert on.
 * A business body may name associated persons only when the step collects them, and must carry
 * every `required-inputs` member (`businessRequiredInputs`, the default groups' `business-name`).
 *
 * Documents follow C52.4 and C52.6: a `document` file goes only to a document verification, and a
 * document is submitted only once its file was uploaded (422 otherwise). Each Phase 5 type's
 * guidance is derived from its step (a document's window is 90 days, its pages 50, every media
 * type) unless `guidanceOf` replaces it, `null` included.
 */
import {
  CRYPTO_CHALLENGE_LIMIT,
  CRYPTO_CHALLENGE_TTL_SECONDS,
  OTP_CODE_LENGTH,
  OTP_CODE_TTL_SECONDS,
  OTP_MAX_ATTEMPTS_PER_CODE,
  OTP_MAX_SENDS,
  OTP_MAX_WRONG_ENTRIES,
  OTP_RESEND_COOLDOWNS_SECONDS,
  SELFIE_CAPTURE_GUIDANCE_DEFAULTS,
  SELFIE_POSE_FILE_KINDS,
  fromApiVerificationType,
  isVerificationStep,
  stepMaxAttempts,
  verificationTypeForStep,
  type FileKind,
  type FlowSubmitVerificationBody,
  type FlowVerificationResource,
  type RetryHint,
  type SelfiePose,
  type FlowSessionSignals,
  type FlowSignals,
  type CreateHandoffBody,
  type CurrentHandoffResponse,
  type FlowHandoff,
  type FlowSessionResponse,
  handoffUrlFragment,
} from '@openverify/contracts';
import { DATABASE_REQUIRED_FIELDS, type Flow, type FlowStep } from '@openverify/flow-spec';
import { vi, type Mock } from 'vitest';
import {
  FlowApiError,
  type FlowApiClient,
  type FlowSelfieCaptureResource,
  type SelfieUploadFields,
} from '../api/flow-api-client';
import {
  AT_ISO,
  INQUIRY_ID,
  defaultFlow,
  fileResource,
  flowSession,
  flowVerification,
  type FixtureVerificationStatus,
  type FixtureVerificationType,
} from './flow-fixtures';
import { fakeFlowExtensions } from './fake-flow-registry';
import { goldenFlowError } from './golden-problems';

/** C96.3: the fake's issued handoff and its synthetic `ovh_` token. */
export const FAKE_HANDOFF_ID = 'hnd_01M5CK16P0D13FXHZSS4TCFBVH';
export const FAKE_HANDOFF_TOKEN = `ovh_${'H'.repeat(43)}`;

/** Distinct, well-formed verification IDs, handed out in creation order. */
const VERIFICATION_ID_POOL = [
  'ver_01M5CK16P0D13FXHZSS4TCFBV0',
  'ver_01M5CK16P0D13FXHZSS4TCFBV1',
  'ver_01M5CK16P0D13FXHZSS4TCFBV2',
  'ver_01M5CK16P0D13FXHZSS4TCFBV3',
  'ver_01M5CK16P0D13FXHZSS4TCFBV4',
  'ver_01M5CK16P0D13FXHZSS4TCFBV5',
  'ver_01M5CK16P0D13FXHZSS4TCFBV6',
  'ver_01M5CK16P0D13FXHZSS4TCFBV7',
];

/** Distinct capture IDs and synthetic nonces (22 base64url characters), in creation order. */
const CAPTURE_ID_POOL = Array.from(
  { length: 10 },
  (_, index) => `self_01M5CJXHG07XPHF3HRM6NRED${String(index).padStart(2, '0')}`,
);
const NONCE_POOL = Array.from(
  { length: 10 },
  (_, index) => `FakeSyntheticNonce${String(index).padStart(4, '0')}`,
);

export type Decision =
  | { readonly status: 'passed' }
  | { readonly status: 'needs_review' }
  | { readonly status: 'failed'; readonly hints?: RetryHint[] };

export interface Upload {
  readonly verificationId: string;
  readonly kind: FileKind;
  readonly file: Blob;
  /** A selfie pose's capture fields (C40.3), as the client sent them. */
  readonly capture?: SelfieUploadFields;
}

export interface FakeCapture {
  readonly id: string;
  readonly nonce: string;
  readonly verificationId: string;
  readonly method: 'camera' | 'upload';
  readonly prompts: readonly SelfiePose[];
  status: 'initiated' | 'submitted' | 'errored';
  readonly uploaded: Set<SelfiePose>;
}

export interface Submit {
  readonly verificationId: string;
  readonly body: FlowSubmitVerificationBody | undefined;
}

/** A wallet challenge (C57.2), as the fake keeps it. */
export interface FakeChallenge {
  readonly id: string;
  readonly chainId: string;
  readonly walletAddress: string;
  readonly message: string;
  readonly expiresAtMs: number;
  status: 'initiated' | 'superseded' | 'submitted';
}

/** The open code of a phone or email verification (C55). The fake keeps the destination. */
export interface FakeOtp {
  readonly destination: string;
  readonly sentAtMs: number;
  attemptsRemaining: number;
}

export interface FakeVerification {
  readonly type: FixtureVerificationType;
  status: FixtureVerificationStatus;
  readonly id: string;
  hints: RetryHint[];
  /** C55: accepted sends, the open code, wrong entries, and whether a limit refused the user. */
  sends?: number;
  otp?: FakeOtp;
  wrongEntries?: number;
  limited?: boolean;
  /** C57.2: the wallet challenges, oldest first. */
  challenges?: FakeChallenge[];
  /** C52.3: the values last entered, and whether any were. */
  values?: Readonly<Record<string, unknown>>;
  inputsReceived?: boolean;
}

export type MockedClient = { [Method in keyof FlowApiClient]: Mock<FlowApiClient[Method]> };

/**
 * The client methods this fake answers itself (the flow API before Workflow 9A). A method a later
 * owner adds to `FlowApiClient` comes from that owner's registered extension
 * (`fake-flow-registry.ts`), so this shared fake never needs editing for it.
 */
type CoreClientMethod =
  | 'getSession'
  | 'acceptConsent'
  | 'createVerification'
  | 'createSelfieCapture'
  | 'uploadFile'
  | 'submitVerification'
  | 'getVerification'
  | 'sendOtp'
  | 'confirmOtp'
  | 'enterInputs'
  | 'createCryptoChallenge'
  | 'sendSignals'
  | 'createHandoff'
  | 'continueHandoffHere'
  | 'getCurrentHandoff'
  | 'rejectHandoff';

/** The methods `failures` can make answer a problem first. */
type FailingMethod =
  | 'createVerification'
  | 'uploadFile'
  | 'sendOtp'
  | 'confirmOtp'
  | 'enterInputs'
  | 'createCryptoChallenge'
  | 'submitVerification';

const OTP_TYPES: ReadonlySet<FixtureVerificationType> = new Set(['phone_number', 'email_address']);

/** C52.3: the types whose step collects entered values. */
const INPUT_TYPES: ReadonlySet<FixtureVerificationType> = new Set([
  'database',
  'aamva',
  'database_business',
  'business_website',
]);

/** C52.4: every media type a document may be, the default of the fake's document guidance. */
const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** A 422 without pointers, as the submit guard answers a document without its file (C52.6). */
function missingFile(): FlowApiError {
  const path = '/submit';
  return new FlowApiError('http', `POST ${path} failed with HTTP 422`, {
    status: 422,
    problem: {
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      detail: 'Missing required files: document.',
      instance: path,
      requestId: 'fake',
    },
  });
}

/** A 422 with a JSON Pointer per refused member, as the inputs route answers (C52.3). */
function refusedValues(pointers: readonly string[]): FlowApiError {
  const path = '/inputs';
  return new FlowApiError('http', `POST ${path} failed with HTTP 422`, {
    status: 422,
    problem: {
      type: 'about:blank',
      title: 'Unprocessable Content',
      status: 422,
      detail: 'The values were refused.',
      instance: path,
      requestId: 'fake',
      errors: pointers.map((pointer) => ({ location: 'body', pointer, detail: 'is invalid' })),
    },
  });
}

/** A step field (`name_first`) as the body names it (`name-first`). */
const bodyName = (field: string) => field.replaceAll('_', '-');

/**
 * C52.3 as the server applies it: a database body carries the step's `requiredFields` and, always,
 * the three every database step collects (`DATABASE_REQUIRED_FIELDS`), in the step's order.
 */
const requiredMembers = (step: Extract<FlowStep, { type: 'database' }>): string[] => {
  const required = new Set<string>([...DATABASE_REQUIRED_FIELDS, ...(step.requiredFields ?? [])]);
  return step.fields.filter((field) => required.has(field)).map(bodyName);
};

const iso = (ms: number) => new Date(ms).toISOString();

/** C57.1: an EVM address, `0x` and 40 hexadecimal digits. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function conflict(path: string, code?: string): FlowApiError {
  return new FlowApiError('http', `POST ${path} failed with HTTP 409`, {
    status: 409,
    problem:
      code === undefined
        ? null
        : {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: 'Conflict.',
            instance: path,
            requestId: 'fake',
            code,
          },
  });
}

/** What the fake shows of a destination: its last characters only, as a masked one would. */
function maskDestination(destination: string): string {
  const at = destination.indexOf('@');
  if (at > 0) {
    return `${destination.slice(0, 1)}•••${destination.slice(at)}`;
  }
  return `•••••••${destination.slice(-4)}`;
}

const POSE_BY_KIND: ReadonlyMap<string, SelfiePose> = new Map(
  Object.entries(SELFIE_POSE_FILE_KINDS).map(([pose, kind]) => [kind, pose as SelfiePose]),
);

export class FakeFlowApi {
  flow: Flow = defaultFlow();
  inquiryStatus: 'created' | 'pending' | 'completed' | 'needs_review' | 'failed' | 'expired' =
    'created';
  /** `environment.kind` of the session (C19); `null` leaves it out, as a Phase 1 server did. */
  environmentKind: 'sandbox' | 'production' | null = null;
  /** The session's `face-template-retention-days` (C42.6); `null` leaves it out. */
  faceTemplateRetentionDays: number | null = 365;
  consent: { textKeys: string[]; optionalTextKeys?: string[]; locale: string } | null = null;
  readonly verifications: FakeVerification[] = [];
  readonly uploads: Upload[] = [];
  readonly captures: FakeCapture[] = [];
  readonly submits: Submit[] = [];
  /** The prompts of the next captures; defaults to `center`, then the step's other poses. */
  capturePrompts: readonly SelfiePose[] | null = null;
  /** C40.7: selfie uploads and submits need a capture, as they do for every new verification. */
  selfieCaptureRequired = true;
  /** Decisions for submitted verifications, applied in order when they are polled. */
  readonly decisions: Decision[] = [];
  /** Polls that still report `submitted` before the next decision applies. */
  pendingPolls = 0;
  /** The wall clock (milliseconds) of the fake's code times; tests move it. */
  nowMs = Date.parse(AT_ISO);
  /** The one code the fake accepts (C55); synthetic. */
  otpCode = '246810';
  /** The inquiry's expected wallet address (C57.2), or `null` for none. */
  expectedWalletAddress: string | null = null;
  /** Errors a method answers with, in order, before the fake's own rules apply. */
  readonly failures: Partial<Record<FailingMethod, Error[]>> = {};
  /** C52.2: a type's guidance in place of the one derived from its step; `null` sends none. */
  readonly guidanceOf: Partial<Record<FixtureVerificationType, unknown>> = {};
  /** C52.2, C52.3: the business inputs every configured match group names. */
  businessRequiredInputs: readonly string[] = ['business-name'];
  /** C94.6 (Workflow 7A): the session's collection tiers once it consented; `null` reports none. */
  signalTiers: FlowSessionSignals | null = null;
  /** C94.2: the signal bodies the flow sent, in order. */
  readonly signalBodies: FlowSignals[] = [];
  /**
   * C96.3 (Workflow 7A): the session's `handoff` member, `null` serving none; the handoff calls
   * move its state as the API does (an issue to `issued`, continue-here to `continued_here`, a
   * rejection to `rejected`).
   */
  handoff: FlowHandoff | null = null;
  /** C96.3: the bodies of `createHandoff`, in order. */
  readonly handoffIssues: CreateHandoffBody[] = [];

  readonly client: MockedClient = this.withExtensions({
    getSession: vi.fn<FlowApiClient['getSession']>(() => {
      if (this.inquiryStatus === 'created') {
        this.inquiryStatus = 'pending';
      }
      return Promise.resolve(
        this.extendedSession(
          flowSession({
            status: this.inquiryStatus,
            consent: this.consent !== null,
            verifications: this.verifications.map((v) => this.resource(v)),
            flow: this.flow,
            ...(this.environmentKind === null ? {} : { environment: this.environmentKind }),
            ...(this.faceTemplateRetentionDays === null
              ? {}
              : { faceTemplateRetentionDays: this.faceTemplateRetentionDays }),
            signals: this.consent === null ? null : this.signalTiers,
            ...(this.handoff === null ? {} : { handoff: this.handoff }),
          }),
        ),
      );
    }),
    acceptConsent: vi.fn<FlowApiClient['acceptConsent']>((body) => {
      this.consent = {
        textKeys: [...body['text-keys']],
        ...(body['optional-text-keys'] === undefined
          ? {}
          : { optionalTextKeys: [...body['optional-text-keys']] }),
        locale: body.locale,
      };
      return Promise.resolve({ acceptedAt: AT_ISO });
    }),
    createVerification: vi.fn<FlowApiClient['createVerification']>((body) => {
      const failed = this.failures.createVerification?.shift();
      if (failed !== undefined) {
        return Promise.reject(failed);
      }
      const id = VERIFICATION_ID_POOL[this.verifications.length];
      if (id === undefined) {
        throw new Error('FakeFlowApi ran out of verification IDs');
      }
      const type = fromApiVerificationType(body.type);
      // C52.2, C59.6: the server creates a silent AAMVA step's attempts itself.
      if (type === 'aamva' && this.stepOf('aamva')?.source === 'government_id') {
        return Promise.reject(goldenFlowError('verification_created_by_server'));
      }
      const verification: FakeVerification = { type, status: 'initiated', id, hints: [] };
      this.verifications.push(verification);
      return Promise.resolve(this.resource(verification));
    }),
    createSelfieCapture: vi.fn<FlowApiClient['createSelfieCapture']>((verificationId, body) => {
      const verification = this.find(verificationId);
      if (
        this.consent === null ||
        verification.type !== 'selfie' ||
        verification.status !== 'initiated'
      ) {
        return Promise.reject(conflict('/selfies'));
      }
      const id = CAPTURE_ID_POOL[this.captures.length];
      const nonce = NONCE_POOL[this.captures.length];
      if (id === undefined || nonce === undefined) {
        throw new Error('FakeFlowApi ran out of capture IDs');
      }
      // A new capture supersedes the open one (C40.2).
      for (const capture of this.captures) {
        if (capture.verificationId === verificationId && capture.status === 'initiated') {
          capture.status = 'errored';
        }
      }
      const prompts = this.capturePrompts ?? this.stepPrompts();
      this.captures.push({
        id,
        nonce,
        verificationId,
        method: body.method,
        prompts,
        status: 'initiated',
        uploaded: new Set(),
      });
      const resource: FlowSelfieCaptureResource = {
        type: 'selfie',
        id,
        attributes: {
          prompts: [...prompts],
          'expires-at': '2026-10-20T12:03:00.000Z',
          nonce,
          guidance: { ...SELFIE_CAPTURE_GUIDANCE_DEFAULTS },
        },
      };
      return Promise.resolve(resource);
    }),
    uploadFile: vi.fn<FlowApiClient['uploadFile']>(
      (verificationId, kind, file, _signal, capture) => {
        if (this.consent === null) {
          return Promise.reject(conflict('/files'));
        }
        const target = this.find(verificationId);
        const failed = this.failure('uploadFile', target);
        if (failed !== undefined) {
          return Promise.reject(failed);
        }
        // C52.4: a document goes to an initiated document verification only.
        if (
          (kind === 'document') !== (target.type === 'document') ||
          target.status !== 'initiated'
        ) {
          return Promise.reject(conflict('/files'));
        }
        const pose = POSE_BY_KIND.get(kind);
        if (pose !== undefined && (capture !== undefined || this.selfieCaptureRequired)) {
          const open = this.captures.find((candidate) => candidate.id === capture?.captureId);
          if (
            open === undefined ||
            open.nonce !== capture?.nonce ||
            open.status !== 'initiated' ||
            open.verificationId !== verificationId ||
            !open.prompts.includes(pose)
          ) {
            return Promise.reject(conflict('/files', 'selfie_capture_invalid'));
          }
          open.uploaded.add(pose);
        }
        this.uploads.push({
          verificationId,
          kind,
          file,
          ...(capture === undefined ? {} : { capture }),
        });
        return Promise.resolve(fileResource(verificationId, kind));
      },
    ),
    submitVerification: vi.fn<FlowApiClient['submitVerification']>(
      (verificationId, _signal, body) => {
        const verification = this.find(verificationId);
        const failure = this.failure('submitVerification', verification);
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        if (
          verification.type === 'selfie' &&
          (body?.capture !== undefined || this.selfieCaptureRequired)
        ) {
          const capture = this.captures.find((candidate) => candidate.id === body?.capture?.id);
          if (
            capture === undefined ||
            capture.nonce !== body?.capture?.nonce ||
            capture.status !== 'initiated' ||
            capture.verificationId !== verificationId
          ) {
            return Promise.reject(conflict('/submit', 'selfie_capture_invalid'));
          }
          if (capture.prompts.some((pose) => !capture.uploaded.has(pose))) {
            return Promise.reject(conflict('/submit', 'selfie_capture_incomplete'));
          }
          capture.status = 'submitted';
        }
        // C57.3: a wallet submit names its open, unexpired challenge.
        if (verification.type === 'crypto_wallet') {
          const open = verification.challenges?.find(
            (challenge) =>
              challenge.id === body?.crypto?.['challenge-id'] &&
              challenge.status === 'initiated' &&
              this.nowMs < challenge.expiresAtMs,
          );
          if (open === undefined) {
            return Promise.reject(goldenFlowError('crypto_challenge_invalid'));
          }
          open.status = 'submitted';
        }
        // C52.6: a form type is submitted once its values were received.
        if (INPUT_TYPES.has(verification.type) && verification.inputsReceived !== true) {
          return Promise.reject(goldenFlowError('inputs_required'));
        }
        // C52.6: a document is submitted once its file was uploaded.
        if (
          verification.type === 'document' &&
          !this.uploads.some((upload) => upload.verificationId === verificationId)
        ) {
          return Promise.reject(missingFile());
        }
        // C52.6: a code is submitted once confirmed, or after a limit refused the user (C55.6).
        if (
          OTP_TYPES.has(verification.type) &&
          verification.status !== 'confirmed' &&
          verification.limited !== true
        ) {
          return Promise.reject(conflict('/submit'));
        }
        this.submits.push({ verificationId, body });
        verification.status = 'submitted';
        return Promise.resolve(this.resource(verification));
      },
    ),
    getVerification: vi.fn<FlowApiClient['getVerification']>((verificationId) => {
      const verification = this.find(verificationId);
      if (verification.status === 'submitted') {
        if (this.pendingPolls > 0) {
          this.pendingPolls -= 1;
        } else {
          this.decide(verification);
        }
      }
      return Promise.resolve(this.resource(verification));
    }),
    sendOtp: vi.fn<FlowApiClient['sendOtp']>((verificationId, body) => {
      const verification = this.find(verificationId);
      if (this.consent === null || !OTP_TYPES.has(verification.type)) {
        return Promise.reject(conflict('/otp'));
      }
      if (verification.status === 'confirmed') {
        return Promise.reject(goldenFlowError('otp_already_confirmed'));
      }
      if (verification.status !== 'initiated') {
        return Promise.reject(conflict('/otp'));
      }
      const failure = this.failure('sendOtp', verification);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      const sends = verification.sends ?? 0;
      // C55.6: a send after the last one submits the verification, so the check fails.
      if (sends >= OTP_MAX_SENDS) {
        verification.status = 'submitted';
        return Promise.reject(goldenFlowError('otp_not_confirmed'));
      }
      const resendAt = this.resendAvailableAt(verification);
      if (resendAt !== null && this.nowMs < resendAt) {
        return Promise.reject(
          goldenFlowError('otp_resend_too_soon', { 'resend-available-at': iso(resendAt) }),
        );
      }
      verification.sends = sends + 1;
      verification.otp = {
        destination: 'phone-number' in body ? body['phone-number'] : body['email-address'],
        sentAtMs: this.nowMs,
        attemptsRemaining: OTP_MAX_ATTEMPTS_PER_CODE,
      };
      return Promise.resolve(this.resource(verification));
    }),
    confirmOtp: vi.fn<FlowApiClient['confirmOtp']>((verificationId, body) => {
      const verification = this.find(verificationId);
      if (this.consent === null || !OTP_TYPES.has(verification.type)) {
        return Promise.reject(conflict('/otp/confirm'));
      }
      if (verification.status === 'confirmed') {
        return Promise.reject(goldenFlowError('otp_already_confirmed'));
      }
      if (verification.status !== 'initiated') {
        return Promise.reject(conflict('/otp/confirm'));
      }
      const failure = this.failure('confirmOtp', verification);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      const { otp } = verification;
      if (otp === undefined) {
        return Promise.reject(goldenFlowError('otp_not_sent'));
      }
      if (this.nowMs >= otp.sentAtMs + OTP_CODE_TTL_SECONDS * 1000) {
        if ((verification.sends ?? 0) >= OTP_MAX_SENDS) {
          verification.status = 'submitted';
          return Promise.reject(goldenFlowError('otp_not_confirmed'));
        }
        return Promise.reject(goldenFlowError('otp_expired'));
      }
      if (otp.attemptsRemaining === 0) {
        return Promise.reject(goldenFlowError('otp_code_exhausted'));
      }
      if (body.code === this.otpCode) {
        verification.status = 'confirmed';
        return Promise.resolve(this.resource(verification));
      }
      otp.attemptsRemaining -= 1;
      verification.wrongEntries = (verification.wrongEntries ?? 0) + 1;
      // C55.5: ten wrong entries across the codes submit the verification.
      if (verification.wrongEntries >= OTP_MAX_WRONG_ENTRIES) {
        verification.status = 'submitted';
        return Promise.reject(goldenFlowError('otp_attempts_exhausted'));
      }
      return Promise.reject(
        goldenFlowError('otp_incorrect', { 'attempts-remaining': otp.attemptsRemaining }),
      );
    }),
    createCryptoChallenge: vi.fn<FlowApiClient['createCryptoChallenge']>((verificationId, body) => {
      const verification = this.find(verificationId);
      if (
        this.consent === null ||
        verification.type !== 'crypto_wallet' ||
        verification.status !== 'initiated'
      ) {
        return Promise.reject(conflict('/crypto-challenges'));
      }
      const failure = this.failure('createCryptoChallenge', verification);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      const chainId = body['chain-id'];
      const address = body['wallet-address'];
      if (!(this.stepOf('crypto_wallet')?.chains ?? []).includes(chainId)) {
        return Promise.reject(goldenFlowError('crypto_chain_not_offered'));
      }
      if (chainId.startsWith('eip155:') && !EVM_ADDRESS.test(address)) {
        return Promise.reject(goldenFlowError('crypto_address_invalid'));
      }
      if (
        this.expectedWalletAddress !== null &&
        this.expectedWalletAddress.toLowerCase() !== address.toLowerCase()
      ) {
        return Promise.reject(goldenFlowError('crypto_expected_address_mismatch'));
      }
      const challenges = (verification.challenges ??= []);
      // C57.2: the eleventh challenge cancels the attempt.
      if (challenges.length >= CRYPTO_CHALLENGE_LIMIT) {
        verification.status = 'canceled';
        return Promise.reject(goldenFlowError('crypto_challenge_invalid'));
      }
      for (const open of challenges) {
        if (open.status === 'initiated') {
          open.status = 'superseded';
        }
      }
      const index = String(challenges.length).padStart(2, '0');
      const challenge: FakeChallenge = {
        id: `cwc_01M5CK5AAB0000000000000C${index}`,
        chainId,
        walletAddress: address,
        message: `flow.openverify.test wants you to sign in with your account:\n${address}\n\nNonce: FakeNonce${index}`,
        expiresAtMs: this.nowMs + CRYPTO_CHALLENGE_TTL_SECONDS * 1000,
        status: 'initiated',
      };
      challenges.push(challenge);
      return Promise.resolve({
        id: challenge.id,
        message: challenge.message,
        'expires-at': iso(challenge.expiresAtMs),
      });
    }),
    enterInputs: vi.fn<FlowApiClient['enterInputs']>((verificationId, body) => {
      const verification = this.find(verificationId);
      if (
        this.consent === null ||
        !INPUT_TYPES.has(verification.type) ||
        verification.status !== 'initiated'
      ) {
        return Promise.reject(conflict('/inputs'));
      }
      const failure = this.failure('enterInputs', verification);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      const business =
        verification.type === 'database_business' ? this.stepOf('database_business') : undefined;
      if (business !== undefined) {
        const refused = [
          ...(business.collectAssociatedPersons !== true && 'associated-persons' in body
            ? ['associated-persons']
            : []),
          ...this.businessRequiredInputs.filter((name) => !(name in body)),
        ];
        if (refused.length > 0) {
          return Promise.reject(refusedValues(refused.map((name) => `/${name}`)));
        }
      }
      const database = verification.type === 'database' ? this.stepOf('database') : undefined;
      if (database !== undefined) {
        const collected = new Set(database.fields.map(bodyName));
        const given = Object.keys(body);
        const refused = [
          ...given.filter((name) => !collected.has(name)),
          ...requiredMembers(database).filter((name) => !given.includes(name)),
        ];
        if (refused.length > 0) {
          return Promise.reject(refusedValues(refused.map((name) => `/${name}`)));
        }
      }
      // A new body replaces the earlier values (C52.3).
      verification.values = { ...body };
      verification.inputsReceived = true;
      return Promise.resolve(this.resource(verification));
    }),
    // C94.2 (Workflow 7A): each body is recorded, answered as the API answers it (202).
    sendSignals: vi.fn<FlowApiClient['sendSignals']>((body) => {
      this.signalBodies.push(body);
      return Promise.resolve();
    }),
    // C96.3 (Workflow 7A): the issuing session's handoff calls, answered as the API answers them.
    createHandoff: vi.fn<FlowApiClient['createHandoff']>((body) => {
      this.handoffIssues.push(body);
      this.moveHandoff('issued');
      return Promise.resolve({
        id: FAKE_HANDOFF_ID,
        method: body.method,
        'expires-at': AT_ISO,
        ...(body.method === 'qr'
          ? { 'url-fragment': handoffUrlFragment(INQUIRY_ID, FAKE_HANDOFF_TOKEN) }
          : {}),
      });
    }),
    continueHandoffHere: vi.fn<FlowApiClient['continueHandoffHere']>(() => {
      this.moveHandoff('continued_here');
      return Promise.resolve(this.currentHandoff());
    }),
    getCurrentHandoff: vi.fn<FlowApiClient['getCurrentHandoff']>(() =>
      Promise.resolve(this.currentHandoff()),
    ),
    rejectHandoff: vi.fn<FlowApiClient['rejectHandoff']>(() => {
      this.moveHandoff('rejected');
      return Promise.resolve(this.currentHandoff());
    }),
  });

  /**
   * Workflow 9A Stage 1b (F; review F11): the client with every registered area's methods
   * (`fake-flow-registry.ts`) added to or replacing this fake's own, built once per fake.
   */
  private withExtensions(core: Pick<MockedClient, CoreClientMethod>): MockedClient {
    const client: Partial<MockedClient> = { ...core };
    for (const extension of fakeFlowExtensions()) {
      Object.assign(client, extension.client?.(this));
    }
    return client as MockedClient;
  }

  /** Each registered area's session members, applied in registration order. */
  private extendedSession(session: FlowSessionResponse): FlowSessionResponse {
    return fakeFlowExtensions().reduce(
      (extended, extension) => extension.session?.(extended, this) ?? extended,
      session,
    );
  }

  /** C96.3: the session's handoff step, moved to `state` (the flow's first handoff step). */
  private moveHandoff(state: FlowHandoff['state']): void {
    const step = this.flow.steps.find((candidate) => candidate.type === 'device_handoff');
    this.handoff = { 'step-id': this.handoff?.['step-id'] ?? step?.id ?? 'device_handoff', state };
  }

  /** C96.3: `GET /flow/handoffs/current` for the session's handoff; never redeemed here. */
  private currentHandoff(): CurrentHandoffResponse {
    return {
      status: this.handoff?.state ?? 'pending',
      'redeemed-at': null,
      'os-name': null,
      'browser-name': null,
    };
  }

  uploadedKinds(): FileKind[] {
    return this.uploads.map((upload) => upload.kind);
  }

  /** The verification with `id`, to set up or inspect its state. */
  verification(id: string): FakeVerification {
    return this.find(id);
  }

  /**
   * The next queued error of `method`. A queued C55 refusal changes the verification as the
   * server would: `otp_not_confirmed` and `otp_attempts_exhausted` submit it, `otp_rate_limited`
   * records the refusal so it may be submitted for review.
   */
  private failure(method: FailingMethod, verification: FakeVerification): Error | undefined {
    const failure = this.failures[method]?.shift();
    if (failure instanceof FlowApiError) {
      const code = failure.problem?.code;
      if (code === 'otp_not_confirmed' || code === 'otp_attempts_exhausted') {
        verification.status = 'submitted';
      } else if (code === 'otp_rate_limited') {
        verification.limited = true;
      }
    }
    return failure;
  }

  /** C55.6: when the next send is allowed, or `null` without a code or with no send left. */
  private resendAvailableAt(verification: FakeVerification): number | null {
    const sends = verification.sends ?? 0;
    const cooldown = OTP_RESEND_COOLDOWNS_SECONDS[sends - 1];
    if (verification.otp === undefined || sends >= OTP_MAX_SENDS || cooldown === undefined) {
      return null;
    }
    return verification.otp.sentAtMs + cooldown * 1000;
  }

  /** The first step of `type` in the flow. */
  private stepOf<Type extends FlowStep['type']>(
    type: Type,
  ): Extract<FlowStep, { type: Type }> | undefined {
    return this.flow.steps.find((step): step is Extract<FlowStep, { type: Type }> => {
      return step.type === type;
    });
  }

  /** `center` first, then the selfie step's other poses in its order (a passive step's order). */
  private stepPrompts(): SelfiePose[] {
    const step = this.stepOf('selfie');
    const poses = step?.poses ?? ['center' as const];
    return ['center', ...poses.filter((pose) => pose !== 'center')];
  }

  private find(id: string): FakeVerification {
    const verification = this.verifications.find((candidate) => candidate.id === id);
    if (verification === undefined) {
      throw new Error(`FakeFlowApi has no verification ${id}`);
    }
    return verification;
  }

  private decide(verification: FakeVerification): void {
    const decision = this.decisions.shift() ?? { status: 'passed' };
    verification.status = decision.status;
    verification.hints = decision.status === 'failed' ? (decision.hints ?? []) : [];
    this.updateInquiry();
  }

  /**
   * Completes the inquiry when every verification step is passed (or skipped) or in review, then
   * marks it for review when one is in review (C30.5); fails it when one is out of attempts.
   */
  private updateInquiry(): void {
    const outcomes = this.flow.steps.filter(isVerificationStep).map((step) => {
      const attempts = this.verifications.filter(
        (v) => v.type === verificationTypeForStep(step.type),
      );
      const latest = attempts.at(-1);
      if (latest?.status === 'passed' || latest?.status === 'skipped') {
        return 'passed';
      }
      if (latest?.status === 'needs_review') {
        return latest.status;
      }
      return latest?.status === 'failed' && attempts.length >= stepMaxAttempts(step)
        ? 'failed'
        : 'open';
    });
    if (outcomes.includes('failed')) {
      this.inquiryStatus = 'failed';
    } else if (outcomes.every((outcome) => outcome === 'passed')) {
      this.inquiryStatus = 'completed';
    } else if (outcomes.every((outcome) => outcome === 'passed' || outcome === 'needs_review')) {
      this.inquiryStatus = 'needs_review';
    }
  }

  /** C52.2: the guidance of a Phase 5 verification: a phone or email code, a form's fields. */
  private guidance(verification: FakeVerification): unknown {
    if (Object.hasOwn(this.guidanceOf, verification.type)) {
      return this.guidanceOf[verification.type] ?? null;
    }
    if (verification.type === 'document') {
      return {
        'accepted-types': this.stepOf('document')?.documentTypes ?? ['utility_bill'],
        'max-age-days': 90,
        'max-pages': 50,
        'accepted-mime-types': DOCUMENT_MIME_TYPES,
      };
    }
    if (verification.type === 'database_business') {
      return {
        'collect-associated-persons':
          this.stepOf('database_business')?.collectAssociatedPersons ?? false,
        'required-inputs': this.businessRequiredInputs,
      };
    }
    if (verification.type === 'business_website') {
      return {};
    }
    if (verification.type === 'phone_number') {
      const step = this.stepOf('phone_otp');
      return {
        'allowed-countries': step?.allowedCountries ?? ['US'],
        'code-length': step?.codeLength ?? OTP_CODE_LENGTH.default,
        otp: this.otpGuidance(verification),
      };
    }
    if (verification.type === 'email_address') {
      return {
        'code-length': this.stepOf('email_otp')?.codeLength ?? OTP_CODE_LENGTH.default,
        otp: this.otpGuidance(verification),
      };
    }
    if (verification.type === 'database') {
      const step = this.stepOf('database');
      return {
        fields: (step?.fields ?? []).map(bodyName),
        'required-fields': step === undefined ? [] : requiredMembers(step),
      };
    }
    if (verification.type === 'aamva') {
      return { source: this.stepOf('aamva')?.source ?? 'form' };
    }
    return undefined;
  }

  private otpGuidance(verification: FakeVerification): unknown {
    const { otp } = verification;
    if (otp === undefined || verification.status !== 'initiated') {
      return null;
    }
    const resendAt = this.resendAvailableAt(verification);
    return {
      'masked-destination': maskDestination(otp.destination),
      'expires-at': iso(otp.sentAtMs + OTP_CODE_TTL_SECONDS * 1000),
      'resend-available-at': resendAt === null ? null : iso(resendAt),
      'sends-remaining': OTP_MAX_SENDS - (verification.sends ?? 0),
      'attempts-remaining': otp.attemptsRemaining,
    };
  }

  private resource(verification: FakeVerification): FlowVerificationResource {
    return flowVerification(verification.type, verification.status, {
      id: verification.id,
      hints: verification.hints,
      guidance: this.guidance(verification),
      ...(INPUT_TYPES.has(verification.type)
        ? { inputsReceived: verification.inputsReceived ?? false }
        : {}),
    });
  }
}
