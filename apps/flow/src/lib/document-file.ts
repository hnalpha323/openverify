/**
 * Client-side checks on a document the user picked (C52.4, C64.1), mirroring the API's own rules
 * so the user hears about a wrong file straight away: a PDF whose `%PDF-` header lies within its
 * first 1,024 bytes, or a JPEG, PNG or WebP image, sniffed from its bytes; at most 10 MiB; one of
 * the media types the step's guidance accepts. The server checks everything again. The file is
 * never opened beyond its first bytes, and a PDF is never rendered.
 */
import {
  ACCEPTED_IMAGE_MIME_TYPES,
  detectUploadMimeType,
  maxUploadBytes,
  type DOCUMENT_MIME_TYPES,
} from '@openverify/contracts';

/** A media type a document may be (C52.4): the images and PDF. */
export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number];

export type DocumentFileError = 'empty' | 'too-large' | 'unsupported-type' | 'unreadable';

export const DOCUMENT_FILE_ERRORS: readonly DocumentFileError[] = [
  'empty',
  'too-large',
  'unsupported-type',
  'unreadable',
];

export type DocumentFileCheck =
  | { readonly ok: true; readonly mimeType: DocumentMimeType }
  | { readonly ok: false; readonly error: DocumentFileError };

/** C52.4: a PDF's header lies within its first 1,024 bytes, which also hold every image signature. */
const SNIFF_BYTES = 1024;

const IMAGE_TYPES: ReadonlySet<string> = new Set(ACCEPTED_IMAGE_MIME_TYPES);

/** Whether `file` is a document the step accepts, and its media type, read from its bytes. */
export async function checkDocumentFile(
  file: Blob,
  accepted: readonly DocumentMimeType[],
): Promise<DocumentFileCheck> {
  if (file.size === 0) {
    return { ok: false, error: 'empty' };
  }
  if (file.size > maxUploadBytes('document')) {
    return { ok: false, error: 'too-large' };
  }
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  const mimeType = detectUploadMimeType('document', head);
  return mimeType !== null && (accepted as readonly string[]).includes(mimeType)
    ? { ok: true, mimeType: mimeType as DocumentMimeType }
    : { ok: false, error: 'unsupported-type' };
}

/** The image media types among `accepted`: what a camera capture may produce. */
export function imageMimeTypes(accepted: readonly DocumentMimeType[]): DocumentMimeType[] {
  return accepted.filter((type) => IMAGE_TYPES.has(type));
}

const KIB = 1024;

/** A file size as the user reads it in `language`: bytes, kilobytes or megabytes. */
export function formatFileSize(bytes: number, language: string): string {
  if (bytes < KIB) {
    return new Intl.NumberFormat(language, {
      style: 'unit',
      unit: 'byte',
      unitDisplay: 'long',
    }).format(bytes);
  }
  const megabytes = bytes >= KIB * KIB;
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: megabytes ? 'megabyte' : 'kilobyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(bytes / (megabytes ? KIB * KIB : KIB));
}
