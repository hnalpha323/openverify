/**
 * Workflow 11B (ingestion-11b; the owner decisions after Workflow 7B, "Later phases"): a transaction
 * PDF's page count, made where untrusted PDFs are already parsed (vision's guarded child,
 * `POST /v1/count/document-pages`), called only when the field limits pages. A PDF vision cannot
 * count (422 with C60.1's code, 413, 415, an answer outside the contract) is refused with
 * `transaction_file_refused`; a vision outage (unreachable, timed out, 503) answers a retryable 503
 * with `Retry-After`; nothing is ever passed. Every byte is synthetic.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../errors.js';
import type { VisionPageCounter } from '../../ports.js';
import {
  VisionResponseError,
  VisionServiceError,
  VisionUnavailableError,
} from '../../vision/index.js';
import { PAGE_COUNT_RETRY_AFTER_SECONDS, countTransactionPdfPages } from './page-count.js';

const PDF = new Uint8Array(Buffer.from('%PDF-1.7\nsynthetic\n%%EOF\n', 'latin1'));
const ENDPOINT = '/v1/count/document-pages';

const counter = (answer: () => Promise<{ pageCount: number }>) => ({
  countDocumentPages: vi.fn<VisionPageCounter['countDocumentPages']>(answer),
});

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection, never a count');
}

describe('countTransactionPdfPages', () => {
  it('answers vision’s count, sending the bytes as a PDF', async () => {
    const vision = counter(() => Promise.resolve({ pageCount: 3 }));

    await expect(countTransactionPdfPages(vision, PDF)).resolves.toBe(3);
    expect(vision.countDocumentPages).toHaveBeenCalledWith({
      document: { bytes: PDF, mimeType: 'application/pdf' },
    });
  });

  it.each([
    ['vision unreachable', new VisionUnavailableError(ENDPOINT, 'network')],
    ['vision timed out', new VisionUnavailableError(ENDPOINT, 'timeout')],
    ['the child failed', new VisionServiceError(ENDPOINT, 503, 'guarded_worker_failed')],
    ['vision busy', new VisionServiceError(ENDPOINT, 429)],
  ])('answers a retryable 503 with Retry-After when %s', async (_label, failure) => {
    const error = await caught(
      countTransactionPdfPages(
        counter(() => Promise.reject(failure)),
        PDF,
      ),
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      status: 503,
      headers: { 'retry-after': String(PAGE_COUNT_RETRY_AFTER_SECONDS) },
    });
  });

  it('answers a retryable 503 when no vision client can count', async () => {
    for (const vision of [undefined, {}]) {
      expect(await caught(countTransactionPdfPages(vision, PDF))).toMatchObject({ status: 503 });
    }
  });

  it.each([
    ['encrypted', new VisionServiceError(ENDPOINT, 422, 'pdf_encrypted')],
    ['unreadable', new VisionServiceError(ENDPOINT, 422, 'pdf_unprocessable')],
    ['past 10,000 pages', new VisionServiceError(ENDPOINT, 422, 'too_many_pages')],
    ['too large', new VisionServiceError(ENDPOINT, 413)],
    ['not a PDF', new VisionServiceError(ENDPOINT, 415)],
    ['answered outside the contract', new VisionResponseError(ENDPOINT, [])],
  ])('refuses a PDF vision cannot count (%s) as transaction_file_refused', async (_l, failure) => {
    const error = await caught(
      countTransactionPdfPages(
        counter(() => Promise.reject(failure)),
        PDF,
      ),
    );
    expect(error).toMatchObject({ status: 422, code: 'transaction_file_refused' });
  });

  it('rethrows anything that is not a vision failure', async () => {
    const bug = new TypeError('synthetic bug');
    expect(
      await caught(
        countTransactionPdfPages(
          counter(() => Promise.reject(bug)),
          PDF,
        ),
      ),
    ).toBe(bug);
  });
});
