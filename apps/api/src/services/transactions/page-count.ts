/**
 * Workflow 11B (ingestion-11b; the owner decisions after Workflow 7B, "Later phases"): a
 * transaction PDF's page count, for a `file` field with `page-count-limit-enabled`.
 *
 * The count was made in this process from the PDF's `/Type /Page` objects (provisional: no parser,
 * and a page tree inside a compressed object stream counted 0). It is now made where untrusted
 * PDFs are already parsed: vision's guarded child (`POST /v1/count/document-pages`, PDFium's count
 * of the page tree in a child with rlimits and a kill timer; no new dependency), and only when the
 * field limits pages.
 *
 * - A PDF vision cannot count (422 `pdf_encrypted`, `pdf_unprocessable` or `too_many_pages`; 413;
 *   415; an answer outside the contract) is refused: 422 `transaction_file_refused`, as before.
 * - While vision cannot answer (unreachable, timed out, busy, 503 `guarded_worker_failed`, or no
 *   client that counts), the upload answers 503 with `Retry-After`: retryable, never a pass.
 */
import { AppError, TransactionProblemError } from '../../errors.js';
import type { VisionPageCounter } from '../../ports.js';
import { VisionError } from '../../vision/index.js';

/** Ours, provisional: the seconds a caller waits before retrying an upload whose pages could not be counted. */
export const PAGE_COUNT_RETRY_AFTER_SECONDS = 30;

function unavailable(): AppError {
  return new AppError({
    status: 503,
    detail: 'The file’s pages could not be counted now; retry later.',
    headers: { 'retry-after': String(PAGE_COUNT_RETRY_AFTER_SECONDS) },
  });
}

/**
 * The page count of the PDF `bytes`, from vision's guarded child.
 * @throws {TransactionProblemError} 422 `transaction_file_refused` for a PDF vision cannot count.
 * @throws {AppError} 503 with `Retry-After` while vision cannot answer.
 */
export async function countTransactionPdfPages(
  vision: Partial<VisionPageCounter> | undefined,
  bytes: Uint8Array,
): Promise<number> {
  if (vision?.countDocumentPages === undefined) {
    throw unavailable();
  }
  try {
    const { pageCount } = await vision.countDocumentPages({
      document: { bytes, mimeType: 'application/pdf' },
    });
    return pageCount;
  } catch (error) {
    if (!(error instanceof VisionError)) {
      throw error;
    }
    if (error.retryable) {
      throw unavailable();
    }
    throw new TransactionProblemError(
      'transaction_file_refused',
      'The file’s page count is outside what this field takes, or unreadable.',
    );
  }
}
