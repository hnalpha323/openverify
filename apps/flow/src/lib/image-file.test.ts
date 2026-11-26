import { MAX_UPLOAD_BYTES } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { JPEG_BYTES, PNG_BYTES } from '../testing/flow-fixtures';
import { IMAGE_INPUT_ACCEPT, checkImageFile } from './image-file';

const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

/** A blob of `size` bytes without allocating them, for the size limit. */
function blobOfSize(size: number, head: Uint8Array<ArrayBuffer>): Blob {
  const blob = new Blob([head]);
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
}

describe('checkImageFile', () => {
  it.each([
    ['JPEG', JPEG_BYTES, 'image/jpeg'],
    ['PNG', PNG_BYTES, 'image/png'],
    ['WebP', WEBP_BYTES, 'image/webp'],
  ] as const)('accepts a %s by its bytes', async (_label, bytes, mimeType) => {
    await expect(checkImageFile(new Blob([bytes]))).resolves.toEqual({ ok: true, mimeType });
  });

  it('types the file by its bytes, not by its declared type or name', async () => {
    const disguised = new File([new TextEncoder().encode('%PDF-1.7')], 'id.png', {
      type: 'image/png',
    });

    await expect(checkImageFile(disguised)).resolves.toEqual({
      ok: false,
      error: 'unsupported-type',
    });
  });

  it('rejects an empty file', async () => {
    await expect(checkImageFile(new Blob([]))).resolves.toEqual({ ok: false, error: 'empty' });
  });

  it('accepts exactly 10 MiB and rejects anything larger', async () => {
    await expect(checkImageFile(blobOfSize(MAX_UPLOAD_BYTES, PNG_BYTES))).resolves.toMatchObject({
      ok: true,
    });
    await expect(checkImageFile(blobOfSize(MAX_UPLOAD_BYTES + 1, PNG_BYTES))).resolves.toEqual({
      ok: false,
      error: 'too-large',
    });
  });

  it('reports a file it cannot read', async () => {
    const broken = new Blob([PNG_BYTES]);
    Object.defineProperty(broken, 'slice', {
      value: () => ({
        arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')),
      }),
    });

    await expect(checkImageFile(broken)).resolves.toEqual({ ok: false, error: 'unreadable' });
  });

  it('offers only the accepted formats in the file picker', () => {
    expect(IMAGE_INPUT_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });
});
