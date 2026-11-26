/**
 * Client-side checks on an image the user picked, mirroring the API's own rules (C3: JPEG,
 * PNG or WebP sniffed from magic bytes, at most 10 MiB) so the user hears about a wrong file
 * straight away. The server still checks everything again.
 */
import {
  MAX_UPLOAD_BYTES,
  detectImageMimeType,
  type AcceptedImageMimeType,
} from '@openverify/contracts';

export type ImageFileError = 'empty' | 'too-large' | 'unsupported-type' | 'unreadable';

export const IMAGE_FILE_ERRORS: readonly ImageFileError[] = [
  'empty',
  'too-large',
  'unsupported-type',
  'unreadable',
];

export type ImageFileCheck =
  | { readonly ok: true; readonly mimeType: AcceptedImageMimeType }
  | { readonly ok: false; readonly error: ImageFileError };

/** The `accept` attribute for image inputs. */
export const IMAGE_INPUT_ACCEPT = 'image/jpeg,image/png,image/webp';

/** Enough leading bytes for every accepted signature (WebP needs 12). */
const SNIFF_BYTES = 12;

export async function checkImageFile(file: Blob): Promise<ImageFileCheck> {
  if (file.size === 0) {
    return { ok: false, error: 'empty' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'too-large' };
  }
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  const mimeType = detectImageMimeType(head);
  return mimeType === null ? { ok: false, error: 'unsupported-type' } : { ok: true, mimeType };
}
