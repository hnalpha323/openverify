/**
 * C135.3 (Workflow 8B Stage 1a, F36): the rendition contract of `POST /v1/renditions` on the API's
 * side, against the same golden files the vision service validates, and `createRendition`, the
 * client of the route (Workflow 8B Stage 2, `vision-renditions`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { VisionDocument } from '../ports.js';
import {
  RENDER_MAX_SIDE_PX,
  RENDITION_IMAGE_MAX_SIDE_PX,
  RENDITION_MAX_BYTES,
  RENDITION_MAX_PAGES,
  VisionResponseError,
  VisionServiceError,
  VisionUnavailableError,
  createVisionClient,
  renditionPageSchema,
  renditionSchema,
  type RenditionPageResponse,
} from './index.js';

function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../../../../contracts/fixtures/vision/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

const image = fixture('rendition-image');
const pdf = fixture('rendition-pdf');
const pdfPages = (pdf as { pages: RenditionPageResponse[] }).pages;
const [firstPage] = pdfPages;
if (firstPage === undefined) {
  throw new Error('the golden PDF rendition has pages');
}

/** A page whose bytes are `bytes`, with every other member as stated. */
const pageOf = (bytes: Uint8Array, patch: Partial<RenditionPageResponse> = {}) => ({
  page: 1,
  media_type: 'image/jpeg',
  width: 8,
  height: 6,
  byte_size: bytes.length,
  data_b64: Buffer.from(bytes).toString('base64'),
  ...patch,
});

const JPEG_LIKE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('the rendition contract (C135.3)', () => {
  it('holds the limits the service holds', () => {
    expect([
      RENDITION_MAX_PAGES,
      RENDITION_IMAGE_MAX_SIDE_PX,
      RENDITION_MAX_BYTES,
      RENDER_MAX_SIDE_PX,
    ]).toEqual([20, 4096, 16 * 1024 * 1024, 1600]);
  });

  it('parses both golden renditions unchanged', () => {
    expect(renditionSchema.parse(image)).toEqual(image);
    expect(renditionSchema.parse(pdf)).toEqual(pdf);
  });

  it("checks a page's bytes: their length, a PNG's IHDR and a JPEG's start", () => {
    expect(renditionPageSchema.safeParse(firstPage).success).toBe(true);
    expect(renditionPageSchema.safeParse({ ...firstPage, width: 4, height: 3 }).success).toBe(
      false,
    );
    expect(
      renditionPageSchema.safeParse({ ...firstPage, byte_size: firstPage.byte_size + 1 }).success,
    ).toBe(false);
    expect(renditionPageSchema.safeParse(pageOf(JPEG_LIKE)).success).toBe(true);
    expect(renditionPageSchema.safeParse({ ...firstPage, media_type: 'image/jpeg' }).success).toBe(
      false,
    );
    expect(
      renditionPageSchema.safeParse(pageOf(JPEG_LIKE, { media_type: 'image/png' })).success,
    ).toBe(false);
    expect(
      renditionPageSchema.safeParse({
        ...firstPage,
        data_b64: `${firstPage.data_b64.slice(0, -1)}-`,
      }).success,
    ).toBe(false);
    expect(renditionPageSchema.safeParse({ ...firstPage, page: 21 }).success).toBe(false);
    expect(renditionPageSchema.safeParse({ ...firstPage, extra: true }).success).toBe(false);
  });

  it('numbers pages in order, renders up to 20, and says when a PDF holds more', () => {
    expect(renditionSchema.safeParse({ ...pdf, pages: [...pdfPages].reverse() }).success).toBe(
      false,
    );
    expect(renditionSchema.safeParse({ ...pdf, page_count: 3 }).success).toBe(false);
    expect(renditionSchema.safeParse({ ...pdf, truncated: true }).success).toBe(false);
    const twenty = Array.from({ length: 20 }, (_, index) => ({ ...firstPage, page: index + 1 }));
    expect(
      renditionSchema.safeParse({ source: 'pdf', page_count: 23, truncated: true, pages: twenty })
        .success,
    ).toBe(true);
    expect(
      renditionSchema.safeParse({ source: 'pdf', page_count: 23, truncated: false, pages: twenty })
        .success,
    ).toBe(false);
  });

  it("holds an image to one page and a PDF's pages to small PNG images", () => {
    expect(
      renditionSchema.safeParse({
        ...image,
        page_count: 2,
        pages: [firstPage, { ...firstPage, page: 2 }],
      }).success,
    ).toBe(false);
    expect(
      renditionSchema.safeParse({
        source: 'pdf',
        page_count: 1,
        truncated: false,
        pages: [pageOf(JPEG_LIKE)],
      }).success,
    ).toBe(false);
    expect(
      renditionSchema.safeParse({
        source: 'image',
        page_count: 1,
        truncated: false,
        pages: [pageOf(JPEG_LIKE)],
      }).success,
    ).toBe(true);
  });
});

const TOKEN = 'test-vision-service-token-0123456789abcdef';
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

/** A fetch that answers `answer` after `delayMs`, or rejects with the signal's reason first. */
function answering(answer: () => Response, delayMs = 0) {
  return vi.fn<typeof globalThis.fetch>(
    (_url, init) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const timer = setTimeout(() => {
          resolve(answer());
        }, delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(signal.reason as Error);
        });
      }),
  );
}

const json =
  (body: unknown, status = 200, type = 'application/json') =>
  () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': type },
    });

function clientWith(
  fetch: typeof globalThis.fetch,
  timeouts: { timeoutMs?: number; guardedTimeoutMs?: number } = {},
) {
  return createVisionClient({
    baseUrl: 'http://vision.invalid:8000/',
    serviceToken: TOKEN,
    fetch,
    ...timeouts,
  });
}

/** The request `fetch` was called with, by call. */
function sent(fetch: ReturnType<typeof answering>, call = 0) {
  const [url, init] = fetch.mock.calls[call] ?? [];
  const headers = new Headers(init?.headers);
  const form = init?.body;
  if (!(form instanceof FormData) || !(url instanceof URL)) {
    throw new Error('the rendition request is multipart, to a URL');
  }
  return { url: url.href, method: init?.method, headers, form };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('createRendition (C135.3)', () => {
  const pdfSource: VisionDocument = { bytes: PDF_BYTES, mimeType: 'application/pdf' };

  it('posts the source as the multipart file `source` and decodes each page', async () => {
    const fetch = answering(json(pdf));

    const answer = await clientWith(fetch).createRendition({ source: pdfSource });

    const request = sent(fetch);
    expect(request.url).toBe('http://vision.invalid:8000/v1/renditions');
    expect(request.method).toBe('POST');
    expect(request.headers.get('x-service-token')).toBe(TOKEN);
    expect(request.headers.get('accept')).toBe('application/json');
    expect([...request.form.keys()]).toEqual(['source']);
    const file = request.form.get('source');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('source.pdf');
    expect((file as File).type).toBe('application/pdf');
    expect([...new Uint8Array(await (file as File).arrayBuffer())]).toEqual([...PDF_BYTES]);

    expect(answer).toEqual({
      source: 'pdf',
      pageCount: 2,
      truncated: false,
      pages: pdfPages.map((page) => ({
        page: page.page,
        mediaType: page.media_type,
        width: page.width,
        height: page.height,
        bytes: new Uint8Array(Buffer.from(page.data_b64, 'base64')),
      })),
    });
    expect(answer.pages[0]?.bytes).toBeInstanceOf(Uint8Array);
    expect(answer.pages[0]?.bytes.length).toBe(firstPage.byte_size);
  });

  it("names an image source by its type and reads the image's one page", async () => {
    const fetch = answering(json(image));
    const source: VisionDocument = { bytes: JPEG_LIKE, mimeType: 'image/jpeg' };

    const answer = await clientWith(fetch).createRendition({ source });

    expect((sent(fetch).form.get('source') as File).name).toBe('source.jpg');
    expect(answer).toMatchObject({ source: 'image', pageCount: 1, truncated: false });
    expect(answer.pages).toHaveLength(1);
  });

  it('refuses an answer that does not hold the contract, naming no value', async () => {
    const fetch = answering(json({ ...pdf, truncated: true }));

    const error = await caught(clientWith(fetch).createRendition({ source: pdfSource }));

    expect(error).toBeInstanceOf(VisionResponseError);
    expect(error).toMatchObject({ endpoint: '/v1/renditions', retryable: false });
    expect(JSON.stringify(error)).not.toContain(firstPage.data_b64.slice(0, 16));
  });

  it('refuses a body that is not JSON', async () => {
    const fetch = answering(json('{not json'));
    await expect(clientWith(fetch).createRendition({ source: pdfSource })).rejects.toBeInstanceOf(
      VisionResponseError,
    );
  });

  it.each([
    [422, 'pdf_encrypted', false],
    [422, 'too_many_pages', false],
    [503, 'guarded_worker_failed', true],
  ])('carries a %i %s as a service error (retryable: %s)', async (status, code, retryable) => {
    const fetch = answering(json({ status, code }, status, 'application/problem+json'));

    const error = await caught(clientWith(fetch).createRendition({ source: pdfSource }));

    expect(error).toBeInstanceOf(VisionServiceError);
    expect(error).toMatchObject({ endpoint: '/v1/renditions', status, code, retryable });
  });

  it('waits as long as for the guarded routes, since a PDF is rendered by the guarded child', async () => {
    const patient = answering(json(pdf), 200);
    await expect(
      clientWith(patient, { timeoutMs: 50, guardedTimeoutMs: 10_000 }).createRendition({
        source: pdfSource,
      }),
    ).resolves.toMatchObject({ pageCount: 2 });

    const strict = answering(json(pdf), 200);
    const error = await caught(
      clientWith(strict, { timeoutMs: 10_000, guardedTimeoutMs: 50 }).createRendition({
        source: pdfSource,
      }),
    );
    expect(error).toBeInstanceOf(VisionUnavailableError);
    expect(error).toMatchObject({ reason: 'timeout', retryable: true });
  });

  it('answers an unreachable service as retryable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    expect(await caught(clientWith(fetch).createRendition({ source: pdfSource }))).toMatchObject({
      endpoint: '/v1/renditions',
      reason: 'network',
      retryable: true,
    });
  });
});
