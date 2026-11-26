/**
 * Synthetic flow API documents for tests. Every builder parses its output with the contract
 * schema, so tests never run against data the real API could not send.
 */
import {
  defaultInquiryTemplateAttributes,
  fileResourceSchema,
  flowSelfieCaptureDocumentSchema,
  flowSessionResponseSchema,
  flowSubmitVerificationBodySchema,
  flowVerificationResourceSchema,
  toVerificationResourceType,
  type FileKind,
  type FileResource,
  type FlowSessionResponse,
  type FlowVerificationResource,
  type RetryHint,
  type SupportedVerificationType,
} from '@openverify/contracts';
import type { Flow } from '@openverify/flow-spec';
import goldenCreated from '../../../../contracts/fixtures/flow/selfie-capture-created.json';
import goldenSubmit from '../../../../contracts/fixtures/flow/selfie-capture-submit.json';

/** The golden create answer of a selfie capture (C40.2): prompts center, right, left. */
export const GOLDEN_SELFIE_CAPTURE = flowSelfieCaptureDocumentSchema.parse(goldenCreated).data;

/** The golden submit body of that capture (C40.4), with a synthetic camera's snapshot. */
export const GOLDEN_SELFIE_SUBMIT = flowSubmitVerificationBodySchema.parse(goldenSubmit);

export const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
export const SESSION_TOKEN = `ovs_${'A'.repeat(43)}`;

export const VERIFICATION_IDS = {
  governmentId: 'ver_01M5CK16P0D13FXHZSS4TCFBVH',
  governmentIdRetry: 'ver_01M5CJZC301G4JHXZQ3PZBYH3Q',
  governmentIdThird: 'ver_01M5CK17N82ZP0PQ8RZRRTT5V5',
  selfie: 'ver_01M5CK3190XEVBM5ZXA76E1JSM',
  selfieRetry: 'ver_01M5CK3288G5K9T8DC51K68DDZ',
} as const;

/** The kinds the flow uploads: the government ID and selfie images, and a document (C52.4). */
const FILE_IDS: Partial<Record<FileKind, string>> = {
  front: 'file_01M5CK17N82ZP0PQ8RZRRTT5V5',
  back: 'file_01M5CK18MGP7DK00CDQ1KEB2N2',
  portrait: 'file_01M5CJZD282YV9958CG7ZK9ZKN',
  'selfie-center': 'file_01M5CK3288G5K9T8DC51K68DDZ',
  'selfie-left': 'file_01M5CJZE1G6XVZ8MHB9Y8SNWH3',
  'selfie-right': 'file_01M5CK4VW0MRQ4HKKTBDT6PXEM',
  document: 'file_01M5CK5AAB0000000000000F01',
};

/** The verification resource each uploaded kind belongs to. */
function verificationTypeOfKind(kind: FileKind): string {
  if (kind === 'document') {
    return 'verification/document';
  }
  return kind.startsWith('selfie-') ? 'verification/selfie' : 'verification/government-id';
}

/** A default ID per Phase 5 type the flow runs (C64.1), so each fixture names its own. */
export const PHASE5_VERIFICATION_IDS = {
  phone_number: 'ver_01M5CK5AAB0000000000000P01',
  email_address: 'ver_01M5CK5AAB0000000000000E01',
  crypto_wallet: 'ver_01M5CK5AAB0000000000000C01',
  database: 'ver_01M5CK5AAB0000000000000D01',
  aamva: 'ver_01M5CK5AAB0000000000000A01',
  document: 'ver_01M5CK5AAB0000000000000F01',
  government_id_nfc: 'ver_01M5CK5AAB0000000000000N01',
  database_business: 'ver_01M5CK5AAB0000000000000B01',
  business_website: 'ver_01M5CK5AAB0000000000000W01',
} as const satisfies Record<Exclude<SupportedVerificationType, 'government_id' | 'selfie'>, string>;

export const AT_ISO = '2026-10-20T12:00:00.000Z';

export type FixtureVerificationType = SupportedVerificationType;
export type FixtureVerificationStatus = FlowVerificationResource['attributes']['status'];

/**
 * The default template's flow (C7, C45.1): consent with the optional matching consent, a
 * two-sided ID, a selfie of three poses with active liveness, completion, failure.
 */
export function defaultFlow(): Flow {
  return defaultInquiryTemplateAttributes().flow;
}

/** The default flow with a centre-only, passive selfie step (the Phases 1-3 step). */
export function centreOnlyFlow(): Flow {
  const flow = defaultFlow();
  return {
    ...flow,
    steps: flow.steps.map((step) =>
      step.type === 'selfie' ? { ...step, poses: ['center'], liveness: 'passive' } : step,
    ),
  };
}

function defaultVerificationId(type: FixtureVerificationType): string {
  switch (type) {
    case 'government_id':
      return VERIFICATION_IDS.governmentId;
    case 'selfie':
      return VERIFICATION_IDS.selfie;
    default:
      return PHASE5_VERIFICATION_IDS[type];
  }
}

export interface FlowVerificationOptions {
  id?: string;
  hints?: RetryHint[];
  /** A Phase 5 type's `guidance` (C52.2); left out unless given. */
  guidance?: unknown;
  /** A form type's `inputs-received` (C52.2); left out unless given. */
  inputsReceived?: boolean;
}

export function flowVerification(
  type: FixtureVerificationType,
  status: FixtureVerificationStatus,
  options: FlowVerificationOptions = {},
): FlowVerificationResource {
  return flowVerificationResourceSchema.parse({
    type: toVerificationResourceType(type),
    id: options.id ?? defaultVerificationId(type),
    attributes: {
      status,
      'retry-hints': options.hints ?? [],
      ...(options.guidance === undefined ? {} : { guidance: options.guidance }),
      ...(options.inputsReceived === undefined
        ? {}
        : { 'inputs-received': options.inputsReceived }),
      'created-at': AT_ISO,
      'updated-at': AT_ISO,
    },
  });
}

export interface FlowSessionOptions {
  status?: FlowSessionResponse['inquiry']['status'];
  consent?: boolean;
  verifications?: FlowVerificationResource[];
  flow?: Flow;
  /** C19; omitted, as a Phase 1 server did, unless given. */
  environment?: 'sandbox' | 'production';
  /** C42.6 `face-template-retention-days`; omitted, as a Phase 1-3 server did, unless given. */
  faceTemplateRetentionDays?: number;
  /** C94.6 (Workflow 7A) `signals`: the collection tiers; omitted, as a Phase 6 server did. */
  signals?: FlowSessionResponse['signals'];
  /** C96.3 (Workflow 7A) `handoff` and `handoff-context`; omitted, as a Phase 6 server did. */
  handoff?: FlowSessionResponse['handoff'];
  handoffContext?: FlowSessionResponse['handoff-context'];
}

export function flowSession(options: FlowSessionOptions = {}): FlowSessionResponse {
  return flowSessionResponseSchema.parse({
    inquiry: { id: INQUIRY_ID, status: options.status ?? 'pending' },
    flow: options.flow ?? defaultFlow(),
    verifications: options.verifications ?? [],
    consent: options.consent === true ? { 'accepted-at': AT_ISO } : null,
    ...(options.environment === undefined ? {} : { environment: { kind: options.environment } }),
    ...(options.faceTemplateRetentionDays === undefined
      ? {}
      : { 'face-template-retention-days': options.faceTemplateRetentionDays }),
    ...(options.signals === undefined ? {} : { signals: options.signals }),
    ...(options.handoff === undefined ? {} : { handoff: options.handoff }),
    ...(options.handoffContext === undefined ? {} : { 'handoff-context': options.handoffContext }),
  });
}

export function fileResource(verificationId: string, kind: FileKind): FileResource {
  const id = FILE_IDS[kind];
  if (id === undefined) {
    throw new Error(`No fixture file of kind ${kind}`);
  }
  return fileResourceSchema.parse({
    type: 'file',
    id,
    attributes: {
      kind,
      'mime-type': kind === 'document' ? 'application/pdf' : 'image/png',
      'byte-size': 1024,
      'created-at': AT_ISO,
    },
    relationships: {
      verification: { data: { type: verificationTypeOfKind(kind), id: verificationId } },
    },
  });
}

/** Smallest valid PNG and JPEG headers, enough for magic-byte sniffing. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

export function pngFile(name = 'photo.png'): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

export function jpegBlob(): Blob {
  return new Blob([JPEG_BYTES], { type: 'image/jpeg' });
}

/** The start of a synthetic PDF: enough for sniffing (C52.4); it is never parsed in the flow. */
export const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%synthetic test document\n');

/** A synthetic PDF file, named as a user might name it. */
export function pdfFile(name = 'statement.pdf'): File {
  return new File([PDF_BYTES], name, { type: 'application/pdf' });
}
