import { DOCUMENT_MIME_TYPES, maxUploadBytes } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { JPEG_BYTES, PNG_BYTES } from '../testing/flow-fixtures';
import {
  checkDocumentFile,
  formatFileSize,
  imageMimeTypes,
  type DocumentMimeType,
} from './document-file';

const ALL: readonly DocumentMimeType[] = DOCUMENT_MIME_TYPES;

const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

/** A synthetic PDF: its header, then nothing a reader would need (it is never parsed here). */
function pdfBytes(prefix = ''): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${prefix}%PDF-1.7\n%synthetic\n`);
}

/** A blob of `size` bytes without allocating them, for the size limit. */
function blobOfSize(size: number, head: Uint8Array<ArrayBuffer>): Blob {
  const blob = new Blob([head]);
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
}

describe('checkDocumentFile (C52.4, C64.1)', () => {
  it.each([
    ['a PDF', pdfBytes(), 'application/pdf'],
    ['a JPEG', JPEG_BYTES, 'image/jpeg'],
    ['a PNG', PNG_BYTES, 'image/png'],
    ['a WebP', WEBP_BYTES, 'image/webp'],
  ] as const)('accepts %s by its bytes', async (_label, bytes, mimeType) => {
    await expect(checkDocumentFile(new Blob([bytes]), ALL)).resolves.toEqual({
      ok: true,
      mimeType,
    });
  });

  it('finds a PDF header anywhere in the first 1,024 bytes, as PDF readers do', async () => {
    const late = pdfBytes(' '.repeat(1024 - '%PDF-'.length));
    const tooLate = pdfBytes(' '.repeat(1025 - '%PDF-'.length));

    await expect(checkDocumentFile(new Blob([late]), ALL)).resolves.toEqual({
      ok: true,
      mimeType: 'application/pdf',
    });
    await expect(checkDocumentFile(new Blob([tooLate]), ALL)).resolves.toEqual({
      ok: false,
      error: 'unsupported-type',
    });
  });

  it('types the file by its bytes, not by its declared type or name', async () => {
    const disguised = new File([new TextEncoder().encode('just text')], 'bill.pdf', {
      type: 'application/pdf',
    });

    await expect(checkDocumentFile(disguised, ALL)).resolves.toEqual({
      ok: false,
      error: 'unsupported-type',
    });
  });

  it('refuses a type the step’s guidance does not accept, such as a PDF for images only', async () => {
    await expect(
      checkDocumentFile(new Blob([pdfBytes()]), ['image/jpeg', 'image/png']),
    ).resolves.toEqual({ ok: false, error: 'unsupported-type' });
    await expect(checkDocumentFile(new Blob([JPEG_BYTES]), ['application/pdf'])).resolves.toEqual({
      ok: false,
      error: 'unsupported-type',
    });
  });

  it('refuses an empty file', async () => {
    await expect(checkDocumentFile(new Blob([]), ALL)).resolves.toEqual({
      ok: false,
      error: 'empty',
    });
  });

  it('accepts exactly 10 MiB and refuses anything larger, before reading it', async () => {
    const limit = maxUploadBytes('document');

    await expect(checkDocumentFile(blobOfSize(limit, pdfBytes()), ALL)).resolves.toEqual({
      ok: true,
      mimeType: 'application/pdf',
    });
    await expect(checkDocumentFile(blobOfSize(limit + 1, pdfBytes()), ALL)).resolves.toEqual({
      ok: false,
      error: 'too-large',
    });
  });

  it('says a file it could not read is unreadable', async () => {
    const broken = new Blob([pdfBytes()]);
    Object.defineProperty(broken, 'slice', {
      value: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }),
    });

    await expect(checkDocumentFile(broken, ALL)).resolves.toEqual({
      ok: false,
      error: 'unreadable',
    });
  });
});

describe('imageMimeTypes', () => {
  it('keeps the image types, in their order, for a camera capture', () => {
    expect(imageMimeTypes(ALL)).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(imageMimeTypes(['application/pdf', 'image/png'])).toEqual(['image/png']);
    expect(imageMimeTypes(['application/pdf'])).toEqual([]);
  });
});

describe('formatFileSize', () => {
  it.each([
    [512, 'en', '512 bytes'],
    [1536, 'en', '1.5 kB'],
    [1024 * 1024 * 2.25, 'en', '2.3 MB'],
    [1024 * 1024 * 10, 'es', '10 MB'],
  ])('writes %d bytes in %s as %s', (bytes, language, expected) => {
    // Intl may use a narrow no-break space between the number and its unit.
    expect(formatFileSize(bytes, language).replace(/\s/gu, ' ')).toBe(expected);
  });
});
