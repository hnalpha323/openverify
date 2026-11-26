/**
 * Uploaded images (contract C3, `POST /flow/verifications/:id/files`): kinds per verification
 * type, accepted formats sniffed from magic bytes, the size limit, and the `file` resource.
 * The resource never carries the client's filename (it can contain a name) or the contents.
 */
import { CAPTURE_METHODS, type FlowStep } from '@openverify/flow-spec';
import { z } from 'zod';
import { verificationIdentifierSchema } from './identifiers.js';
import {
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import {
  SUPPORTED_VERIFICATION_TYPES,
  toVerificationResourceType,
  type SupportedVerificationType,
  type VerificationStep,
} from './verification-types.js';

export const FILE_KINDS = [
  'front',
  'back',
  'portrait',
  'selfie-center',
  'selfie-left',
  'selfie-right',
  'document',
  'chip-sod',
  'chip-dg1',
  'chip-dg2',
  'chip-dg14',
  'chip-dg15',
  'chip-card-security',
  'chip-card-access',
  'chip-com',
  'document-preview',
  'chip-portrait',
] as const;
export const fileKindSchema = z.enum(FILE_KINDS);
export type FileKind = z.infer<typeof fileKindSchema>;

/**
 * C52.4: the chip files a client uploads to a government ID NFC verification. DG11 and DG12 are
 * not taken in Phase 5 (decision 43).
 */
const CHIP_FILE_KINDS = [
  'chip-sod',
  'chip-dg1',
  'chip-dg2',
  'chip-dg14',
  'chip-dg15',
  'chip-card-security',
  'chip-card-access',
  'chip-com',
] as const satisfies readonly FileKind[];

/**
 * Every kind each verification type owns, for display and ownership (C52.4): what a client
 * uploads and what the server writes (`document-preview`, `chip-portrait`).
 */
export const FILE_KINDS_BY_VERIFICATION_TYPE = Object.freeze({
  government_id: Object.freeze(['front', 'back', 'portrait'] as const),
  selfie: Object.freeze(['selfie-center', 'selfie-left', 'selfie-right'] as const),
  document: Object.freeze(['document', 'document-preview'] as const),
  database: Object.freeze([] as const),
  aamva: Object.freeze([] as const),
  phone_number: Object.freeze([] as const),
  email_address: Object.freeze([] as const),
  government_id_nfc: Object.freeze([...CHIP_FILE_KINDS, 'chip-portrait'] as const),
  crypto_wallet: Object.freeze([] as const),
  database_business: Object.freeze([] as const),
  business_website: Object.freeze([] as const),
} as const satisfies Record<SupportedVerificationType, readonly FileKind[]>);

/**
 * C52.4 (P16): the kinds only the server writes, through `storeServerFile` (C54.1): a document's
 * rendered preview and the chip portrait, both PNG. The upload route refuses them (422).
 */
export const SERVER_WRITTEN_FILE_KINDS = Object.freeze([
  'document-preview',
  'chip-portrait',
] as const satisfies readonly FileKind[]);

const SERVER_WRITTEN: ReadonlySet<string> = new Set(SERVER_WRITTEN_FILE_KINDS);

/** C52.4: the kinds a client may upload to each verification type (the upload route's list). */
export const CLIENT_FILE_KINDS_BY_VERIFICATION_TYPE: Readonly<
  Record<SupportedVerificationType, readonly FileKind[]>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(FILE_KINDS_BY_VERIFICATION_TYPE).map(([type, kinds]) => [
      type,
      Object.freeze((kinds as readonly FileKind[]).filter((kind) => !SERVER_WRITTEN.has(kind))),
    ]),
  ) as Record<SupportedVerificationType, readonly FileKind[]>,
);

/** Multipart field carrying the image. */
export const FILE_UPLOAD_FIELD = 'file';
/** Multipart field carrying the file kind. */
export const FILE_KIND_FIELD = 'kind';

/** Whether a client may upload a file of `kind` to a verification of `type` (C52.4). */
export function isFileKindAllowed(type: SupportedVerificationType, kind: string): boolean {
  if (!Object.hasOwn(CLIENT_FILE_KINDS_BY_VERIFICATION_TYPE, type)) {
    return false;
  }
  const allowed: readonly string[] = CLIENT_FILE_KINDS_BY_VERIFICATION_TYPE[type];
  return allowed.includes(kind);
}

type GovernmentIdStep = Extract<FlowStep, { type: 'government_id' }>;
type SelfieStep = Extract<FlowStep, { type: 'selfie' }>;

const SIDE_KINDS = {
  front: ['front'],
  back: ['back'],
  both: ['front', 'back'],
} as const satisfies Record<GovernmentIdStep['sides'], readonly FileKind[]>;

const POSE_KINDS = {
  center: 'selfie-center',
  left: 'selfie-left',
  right: 'selfie-right',
} as const satisfies Record<SelfieStep['poses'][number], FileKind>;

/**
 * Kinds that must be uploaded before a verification for this step can be submitted (C52.4). An
 * NFC submit also needs every DG among 14 and 15 its SOD lists, which only the server can read
 * (C62.5).
 */
export function requiredFileKinds(step: VerificationStep): FileKind[] {
  switch (step.type) {
    case 'government_id':
      return [...SIDE_KINDS[step.sides]];
    case 'selfie':
      return step.poses.map((pose) => POSE_KINDS[pose]);
    case 'document':
      return ['document'];
    case 'nfc':
      return ['chip-sod', 'chip-dg1', 'chip-dg2'];
    default:
      return [];
  }
}

export const ACCEPTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const acceptedImageMimeTypeSchema = z.enum(ACCEPTED_IMAGE_MIME_TYPES);
export type AcceptedImageMimeType = z.infer<typeof acceptedImageMimeTypeSchema>;

/** Largest accepted upload: 10 MiB (10 485 760 bytes). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, offset: number, signature: readonly number[]): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/**
 * The accepted image type the bytes start with, or `null`. Uploads are typed by content,
 * never by the client's `Content-Type` or filename.
 */
export function detectImageMimeType(bytes: Uint8Array): AcceptedImageMimeType | null {
  if (startsWith(bytes, 0, JPEG)) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, 0, PNG)) {
    return 'image/png';
  }
  if (startsWith(bytes, 0, RIFF) && startsWith(bytes, 8, WEBP)) {
    return 'image/webp';
  }
  return null;
}

/**
 * C52.4: every media type a file resource may carry: the images, a PDF document, and the chip
 * files, which have no media type of their own.
 */
export const ACCEPTED_UPLOAD_MIME_TYPES = [
  ...ACCEPTED_IMAGE_MIME_TYPES,
  'application/pdf',
  'application/octet-stream',
] as const;
export const acceptedUploadMimeTypeSchema = z.enum(ACCEPTED_UPLOAD_MIME_TYPES);
export type AcceptedUploadMimeType = z.infer<typeof acceptedUploadMimeTypeSchema>;

/** C52.4: the largest DG2 (the face image), and the largest other chip file. */
const MAX_DG2_BYTES = 1024 * 1024;
const MAX_CHIP_FILE_BYTES = 64 * 1024;

/**
 * C52.4: the largest file of `kind`: 10 MiB for images and documents, 1 MiB for DG2, 64 KiB for
 * the other chip files.
 */
export function maxUploadBytes(kind: FileKind): number {
  if (kind === 'chip-dg2') {
    return MAX_DG2_BYTES;
  }
  return (CHIP_FILE_KINDS as readonly string[]).includes(kind)
    ? MAX_CHIP_FILE_BYTES
    : MAX_UPLOAD_BYTES;
}

/** The first tag of each chip file (ICAO Doc 9303-10 and -11), one byte each. */
const CHIP_TAGS: Readonly<Record<(typeof CHIP_FILE_KINDS)[number], number>> = {
  'chip-sod': 0x77,
  'chip-dg1': 0x61,
  'chip-dg2': 0x75,
  'chip-dg14': 0x6e,
  'chip-dg15': 0x6f,
  'chip-card-security': 0x30,
  'chip-card-access': 0x31,
  'chip-com': 0x60,
};

/**
 * Whether `bytes` are exactly one BER-TLV with `tag` and a minimally encoded definite length, as
 * the chip stores it in DER: no indefinite length, at most four length bytes, nothing after the
 * value.
 */
function isOneTlv(bytes: Uint8Array, tag: number): boolean {
  if (bytes.length < 2 || bytes[0] !== tag) {
    return false;
  }
  const first = bytes[1] ?? 0;
  if (first < 0x80) {
    return bytes.length === 2 + first;
  }
  const count = first & 0x7f;
  if (count === 0 || count > 4 || bytes.length < 2 + count || bytes[2] === 0) {
    return false;
  }
  let length = 0;
  for (let index = 0; index < count; index += 1) {
    length = length * 0x100 + (bytes[2 + index] ?? 0);
  }
  return length >= 0x80 && bytes.length === 2 + count + length;
}

/** `%PDF-`. */
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** C52.4: the PDF header must lie within the first 1,024 bytes, as PDF readers look for it. */
const PDF_HEADER_WINDOW = 1024;

function hasPdfHeader(bytes: Uint8Array): boolean {
  const last = Math.min(bytes.length, PDF_HEADER_WINDOW) - PDF_HEADER.length;
  for (let offset = 0; offset <= last; offset += 1) {
    if (startsWith(bytes, offset, PDF_HEADER)) {
      return true;
    }
  }
  return false;
}

/**
 * C52.4: the media type of a file of `kind`, typed by its content, never by the client's
 * `Content-Type` or filename; `null` when the content does not fit the kind. The image kinds as
 * in Phase 1; a `document` is also a PDF whose `%PDF-` header lies within its first 1,024 bytes; a
 * chip file is one TLV with its kind's first tag (`application/octet-stream`); the server-written
 * kinds are PNG images.
 */
export function detectUploadMimeType(
  kind: FileKind,
  bytes: Uint8Array,
): AcceptedUploadMimeType | null {
  if (Object.hasOwn(CHIP_TAGS, kind)) {
    return isOneTlv(bytes, CHIP_TAGS[kind as keyof typeof CHIP_TAGS])
      ? 'application/octet-stream'
      : null;
  }
  const image = detectImageMimeType(bytes);
  if (SERVER_WRITTEN.has(kind)) {
    return image === 'image/png' ? image : null;
  }
  if (kind === 'document' && image === null) {
    return hasPdfHeader(bytes) ? 'application/pdf' : null;
  }
  return image;
}

/**
 * C206.2 (Workflow 10B; ours): how a photo upload says the shutter fired, the optional multipart field
 * `capture-trigger` and the file attribute of the same name; client-reported, never proven (C206.3).
 */
export const CAPTURE_TRIGGERS = ['auto', 'manual'] as const;
export type CaptureTrigger = (typeof CAPTURE_TRIGGERS)[number];

export const fileAttributesSchema = z.strictObject({
  kind: fileKindSchema,
  'mime-type': acceptedUploadMimeTypeSchema,
  'byte-size': z.int().min(1).max(MAX_UPLOAD_BYTES),
  'created-at': timestampSchema,
  /** C153.2, C206.1 (orchestrator decision 10B D1 (b)): how the client says it captured the file; client-reported, `null` when none was sent. */
  'capture-method': z.enum(CAPTURE_METHODS).nullable().optional().meta({
    description:
      'Client-reported: how the client says it captured the file; null when it sent none.',
  }),
  /** C206.2: whether the shutter or the auto-capture fired; client-reported, `null` when none was sent. */
  'capture-trigger': z.enum(CAPTURE_TRIGGERS).nullable().optional().meta({
    description:
      'Client-reported: whether the shutter (manual) or the auto-capture (auto) took the photo; null when none was sent.',
  }),
});

/** The verification resource type each file kind belongs to. */
const OWNER_BY_KIND: ReadonlyMap<string, string> = new Map(
  SUPPORTED_VERIFICATION_TYPES.flatMap((type) =>
    (FILE_KINDS_BY_VERIFICATION_TYPE[type] as readonly FileKind[]).map((kind): [string, string] => [
      kind,
      toVerificationResourceType(type),
    ]),
  ),
);

export const fileResourceSchema = resourceWithRelationshipsSchema(
  'file',
  'file',
  fileAttributesSchema,
  z.strictObject({ verification: toOneRelationshipSchema(verificationIdentifierSchema) }),
).refine(
  (file) => OWNER_BY_KIND.get(file.attributes.kind) === file.relationships.verification.data.type,
  {
    message: 'the file kind does not belong to the verification type',
    path: ['attributes', 'kind'],
  },
);
export type FileResource = z.infer<typeof fileResourceSchema>;

export const fileDocumentSchema = singleDocumentSchema(fileResourceSchema);
export type FileDocument = z.infer<typeof fileDocumentSchema>;

export interface FileRecord {
  id: string;
  kind: FileKind;
  /** C153.2, C206.1: the upload's client-reported `capture-method`; absent or null when none was sent. */
  captureMethod?: (typeof CAPTURE_METHODS)[number] | null;
  /** C206.2: the upload's client-reported `capture-trigger`; absent or null when none was sent. */
  captureTrigger?: CaptureTrigger | null;
  mimeType: AcceptedUploadMimeType;
  /** Plaintext size in bytes. */
  byteSize: number;
  createdAt: Date;
  verification: { id: string; type: SupportedVerificationType };
}

/**
 * Builds the `file` resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildFileResource(record: FileRecord): FileResource {
  return fileResourceSchema.parse({
    type: 'file',
    id: record.id,
    attributes: {
      kind: record.kind,
      'mime-type': record.mimeType,
      'byte-size': record.byteSize,
      'created-at': toTimestamp(record.createdAt),
      // C206: present when the record carries them (the API's own resources), null when the client
      // sent none; the flow's upload answer leaves them out (C40.10: the flow API echoes no capture fact).
      ...(record.captureMethod === undefined ? {} : { 'capture-method': record.captureMethod }),
      ...(record.captureTrigger === undefined ? {} : { 'capture-trigger': record.captureTrigger }),
    },
    relationships: {
      verification: {
        data: {
          type: toVerificationResourceType(record.verification.type),
          id: record.verification.id,
        },
      },
    },
  });
}
