/**
 * Workflow 11B (ingestion-11b; the owner decisions after Workflow 7B, "Later phases"): the client
 * of vision's `POST /v1/count/document-pages`, a PDF's page count from the guarded child, and its
 * bounds against the exported fixture `contracts/fixtures/vision/pdf-page-count.json` (rule 28:
 * vision's `tests/test_page_count.py` writes it; this side only reads it). Every byte is synthetic.
 */
import { readFileSync } from 'node:fs';
import { TRANSACTION_LIMITS } from '@openverify/core';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GUARDED_VISION_TIMEOUT_MS,
  DOCUMENT_PROBLEM_CODES,
  PAGE_COUNT_MAX_PAGES,
  VisionResponseError,
  VisionServiceError,
  VisionUnavailableError,
  createVisionClient,
  pageCountSchema,
} from './index.js';

const TOKEN = 'synthetic-vision-token-0123456789abcdef';
const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.7\nsynthetic\n%%EOF\n', 'latin1'));

const bounds = JSON.parse(
  readFileSync(
    new URL('../../../../contracts/fixtures/vision/pdf-page-count.json', import.meta.url),
    'utf8',
  ),
) as { path: string; media_type: string; max_bytes: number; max_pages: number; refusals: string[] };

const answering = (respond: () => Response | Promise<Response>) =>
  vi.fn<typeof globalThis.fetch>(() => Promise.resolve(respond()));

const json =
  (body: unknown, status = 200, type = 'application/json') =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

const clientWith = (fetch: typeof globalThis.fetch) =>
  createVisionClient({ baseUrl: 'http://vision.invalid:8000/', serviceToken: TOKEN, fetch });

const count = (fetch: typeof globalThis.fetch) =>
  clientWith(fetch).countDocumentPages({
    document: { bytes: PDF_BYTES, mimeType: 'application/pdf' },
  });

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('the page count bounds (rule 28: vision exports, the API reads)', () => {
  it('agree with the fixture vision writes from its own constants', () => {
    expect(bounds).toEqual({
      path: '/v1/count/document-pages',
      media_type: 'application/pdf',
      max_bytes: TRANSACTION_LIMITS.fileMaxBytes,
      max_pages: PAGE_COUNT_MAX_PAGES,
      refusals: [...DOCUMENT_PROBLEM_CODES],
    });
    expect(PAGE_COUNT_MAX_PAGES).toBe(10_000);
  });

  it.each([
    [{ page_count: 1 }, true],
    [{ page_count: 10_000 }, true],
    [{ page_count: 0 }, false],
    [{ page_count: 10_001 }, false],
    [{ page_count: 2.5 }, false],
    [{ page_count: '3' }, false],
    [{ page_count: 3, pages: [] }, false],
    [{}, false],
  ])('takes %j: %s', (body, valid) => {
    expect(pageCountSchema.safeParse(body).success).toBe(valid);
  });
});

describe('countDocumentPages', () => {
  it('posts the PDF as the multipart file `document`, with the token, and answers the count', async () => {
    const fetch = answering(json({ page_count: 3 }));

    await expect(count(fetch)).resolves.toEqual({ pageCount: 3 });
    const [url, init] = fetch.mock.calls[0] ?? [];
    if (!(url instanceof URL)) throw new Error('the count is posted to a URL');
    expect(url.href).toBe('http://vision.invalid:8000/v1/count/document-pages');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('x-service-token')).toBe(TOKEN);
    const form = init?.body;
    if (!(form instanceof FormData)) throw new Error('the count is a multipart request');
    const document = form.get('document');
    if (!(document instanceof Blob)) throw new Error('the PDF is the file `document`');
    expect(document.type).toBe('application/pdf');
    expect(new Uint8Array(await document.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('waits as long as the other guarded routes', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<typeof globalThis.fetch>(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(init.signal?.reason as Error);
            });
          }),
      );
      const pending = caught(count(fetch));
      await vi.advanceTimersByTimeAsync(DEFAULT_GUARDED_VISION_TIMEOUT_MS - 1);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      const error = await pending;
      expect(error).toBeInstanceOf(VisionUnavailableError);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['pdf_encrypted', 'pdf_unprocessable', 'too_many_pages'])(
    'rejects with 422 and the code %s, not retryable',
    async (code) => {
      const error = await caught(
        count(answering(json({ status: 422, code }, 422, 'application/problem+json'))),
      );
      expect(error).toBeInstanceOf(VisionServiceError);
      expect(error).toMatchObject({ status: 422, code, retryable: false });
    },
  );

  it('rejects a 503 guarded_worker_failed as retryable', async () => {
    const error = await caught(
      count(
        answering(
          json({ status: 503, code: 'guarded_worker_failed' }, 503, 'application/problem+json'),
        ),
      ),
    );
    expect(error).toMatchObject({ status: 503, code: 'guarded_worker_failed', retryable: true });
  });

  it('rejects an answer outside the contract, never a made-up count', async () => {
    const error = await caught(count(answering(json({ page_count: 0 }))));
    expect(error).toBeInstanceOf(VisionResponseError);
  });
});
