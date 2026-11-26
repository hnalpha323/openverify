/**
 * Client of the internal vision service (contract C6). Requests are multipart uploads of the
 * decrypted images, authenticated with `x-service-token`; every response is validated with
 * zod before it is returned.
 *
 * The images and the embeddings in responses are biometric data: errors carry the endpoint,
 * the HTTP status and zod issue paths, never a body, an image byte or an embedding value.
 */
import { z } from 'zod';
import type {
  BackgroundComparison,
  DocumentAnalysis,
  FaceEmbeddingResult,
  GovernmentIdAnalysis,
  SelfieAnalysis,
  VisionClient,
  VisionDocument,
  VisionImage,
  VisionPageCount,
  VisionPageCounter,
  VisionPortrait,
  VisionRendition,
} from '../ports.js';
import {
  MASKED_BACKGROUND_MAX_SIDE_PX,
  PORTRAIT_MAX_SIDE_PX,
  RENDER_MAX_SIDE_PX,
  backgroundComparisonSchema,
  documentAnalysisSchema,
  faceEmbeddingResultSchema,
  governmentIdAnalysisSchema,
  pageCountSchema,
  renditionSchema,
  selfieAnalysisSchema,
  type RenditionResponse,
} from './schemas.js';

export * from './schemas.js';

export const SERVICE_TOKEN_HEADER = 'x-service-token';
/** The vision service refuses shorter tokens. */
export const MIN_SERVICE_TOKEN_LENGTH = 32;
export const DEFAULT_VISION_TIMEOUT_MS = 30_000;
/**
 * C60.2: the timeout of the routes that run vision's guarded child (the document analysis, the
 * page render, the portrait conversion and the chip embedding). The child is killed after 30 s and
 * the analysis then reads the pages, so the API waits longer and receives vision's own
 * `503 guarded_worker_failed` rather than timing out first.
 */
export const DEFAULT_GUARDED_VISION_TIMEOUT_MS = 45_000;
/** C41.2: `/v1/compare/background` takes `candidate_0` to `candidate_4`. */
export const MAX_BACKGROUND_CANDIDATES = 5;

/** Base class of vision client failures. `retryable` says whether a retry can help. */
export class VisionError extends Error {
  override name = 'VisionError';
  readonly endpoint: string;
  readonly retryable: boolean;

  constructor(message: string, endpoint: string, retryable: boolean) {
    super(message);
    this.endpoint = endpoint;
    this.retryable = retryable;
  }
}

/** The service could not be reached or did not answer in time. Always retryable. */
export class VisionUnavailableError extends VisionError {
  override name = 'VisionUnavailableError';
  readonly reason: 'timeout' | 'network';

  constructor(endpoint: string, reason: 'timeout' | 'network') {
    super(
      `Vision service ${reason === 'timeout' ? 'timed out' : 'unreachable'} (${endpoint})`,
      endpoint,
      true,
    );
    this.reason = reason;
  }
}

/** HTTP statuses after which the same request may succeed. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/**
 * The service answered with an error status. `code` is the problem's `code` member when it gave
 * one (C60.1: `pdf_encrypted`, `pdf_unprocessable`, `too_many_pages`, `guarded_worker_failed`),
 * read from at most 4 KiB of a problem+json body; never anything else of the body.
 */
export class VisionServiceError extends VisionError {
  override name = 'VisionServiceError';
  readonly status: number;
  readonly code: string | null;

  constructor(endpoint: string, status: number, code: string | null = null) {
    super(
      `Vision service answered ${String(status)}${code === null ? '' : ` ${code}`} (${endpoint})`,
      endpoint,
      RETRYABLE_STATUSES.has(status) || status >= 500,
    );
    this.status = status;
    this.code = code;
  }
}

/** The most of an error body read for its problem `code`. */
const MAX_PROBLEM_BYTES = 4 * 1024;
const PROBLEM_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** A problem body's `code`, when it is one; `null` otherwise (never the body). */
async function problemCode(response: Response): Promise<string | null> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json') || response.body === null) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > MAX_PROBLEM_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    const code = (body as { code?: unknown } | null)?.code;
    return typeof code === 'string' && PROBLEM_CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * C60.4: the width and height of a PNG's IHDR, or `null` when the bytes do not start with a PNG
 * signature and an IHDR chunk.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr = String.fromCharCode(...bytes.subarray(12, 16));
  if (view.getUint32(8) !== 13 || ihdr !== 'IHDR') {
    return null;
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface VisionResponseIssue {
  path: string;
  code: string;
}

/**
 * Statuses vision answers for an image it cannot read: too large (413: bytes or pixels),
 * not a supported image (415), or corrupt (422). This client always sends the fields C6
 * requires, so a 422 from request validation would be a contract bug, not an image.
 */
const UNREADABLE_IMAGE_STATUSES: ReadonlySet<number> = new Set([413, 415, 422]);

/** Whether vision refused an image because it cannot read it: something the user can fix. */
export function isUnreadableImageError(error: unknown): error is VisionServiceError {
  return error instanceof VisionServiceError && UNREADABLE_IMAGE_STATUSES.has(error.status);
}

/** The service answered 2xx with a body that does not match C6. Not retryable. */
export class VisionResponseError extends VisionError {
  override name = 'VisionResponseError';
  readonly issues: readonly VisionResponseIssue[];

  constructor(endpoint: string, issues: readonly VisionResponseIssue[]) {
    super(`Vision service response does not match the contract (${endpoint})`, endpoint, false);
    this.issues = issues;
  }
}

export interface VisionClientOptions {
  /** Base URL of the service, e.g. `http://vision:8000`. A path prefix is kept. */
  baseUrl: string;
  /** `OPENVERIFY_VISION_SERVICE_TOKEN`; at least 32 characters. */
  serviceToken: string;
  /** Per-request timeout. Defaults to 30 s. */
  timeoutMs?: number;
  /** Timeout of the routes that run the guarded child (C60.2). Defaults to 45 s. */
  guardedTimeoutMs?: number;
  /** Fetch implementation, for tests. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** Anything vision is sent: an image, a document (C60.1) or a chip portrait (C60.4). */
type VisionFile = VisionImage | VisionDocument | VisionPortrait;

const EXTENSIONS: Readonly<Record<VisionFile['mimeType'], string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'image/jp2': 'jp2',
};

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('The vision base URL must be an absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.search !== '' || url.hash !== '') {
    throw new TypeError('The vision base URL must be an http(s) URL without query or fragment');
  }
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return url;
}

function issuesOf(error: z.ZodError): VisionResponseIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
  }));
}

/** C135.3: the port's rendition, each page's base64 decoded. */
function renditionOf(answer: RenditionResponse): VisionRendition {
  return {
    source: answer.source,
    pageCount: answer.page_count,
    truncated: answer.truncated,
    pages: answer.pages.map((page) => ({
      page: page.page,
      mediaType: page.media_type,
      width: page.width,
      height: page.height,
      bytes: new Uint8Array(Buffer.from(page.data_b64, 'base64')),
    })),
  };
}

/**
 * Creates the vision client.
 * @throws {TypeError} for an invalid base URL, a token shorter than 32 characters or a
 * non-positive timeout.
 */
export function createVisionClient(options: VisionClientOptions): VisionClient & VisionPageCounter {
  const base = parseBaseUrl(options.baseUrl);
  if (options.serviceToken.length < MIN_SERVICE_TOKEN_LENGTH) {
    throw new TypeError(
      `The vision service token must be at least ${String(MIN_SERVICE_TOKEN_LENGTH)} characters`,
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_VISION_TIMEOUT_MS;
  const guardedTimeoutMs = options.guardedTimeoutMs ?? DEFAULT_GUARDED_VISION_TIMEOUT_MS;
  for (const timeout of [timeoutMs, guardedTimeoutMs]) {
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new TypeError('The vision timeout must be a positive number of milliseconds');
    }
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const { serviceToken } = options;

  /** One multipart request; any 2xx answer is returned for its caller to read. */
  async function send(
    path: string,
    files: Readonly<Record<string, VisionFile | undefined>>,
    texts: Readonly<Record<string, string | undefined>>,
    accept: string,
    timeout: number,
  ): Promise<Response> {
    const endpoint = `/${path}`;
    const form = new FormData();
    for (const [field, file] of Object.entries(files)) {
      if (file !== undefined) {
        const blob = new Blob([file.bytes], { type: file.mimeType });
        form.append(field, blob, `${field}.${EXTENSIONS[file.mimeType]}`);
      }
    }
    for (const [field, text] of Object.entries(texts)) {
      if (text !== undefined) {
        form.append(field, text);
      }
    }
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method: 'POST',
        headers: { [SERVICE_TOKEN_HEADER]: serviceToken, accept },
        body: form,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new VisionUnavailableError(endpoint, timedOut ? 'timeout' : 'network');
    }
    if (!response.ok) {
      throw new VisionServiceError(endpoint, response.status, await problemCode(response));
    }
    return response;
  }

  /**
   * C60.4, C99.7: a PNG answer, checked as `image/png` with a PNG header of at most `maxSide`
   * pixels a side; its bytes are returned as received.
   */
  async function postPng(
    path: string,
    files: Readonly<Record<string, VisionFile | undefined>>,
    maxSide: number,
    texts: Readonly<Record<string, string | undefined>> = {},
    // The document routes run the guarded child (C60.2, C60.4).
    timeout = guardedTimeoutMs,
  ): Promise<Uint8Array> {
    const endpoint = `/${path}`;
    const response = await send(path, files, texts, 'image/png', timeout);
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim();
    if (type !== 'image/png') {
      await response.body?.cancel();
      throw new VisionResponseError(endpoint, [{ path: 'content-type', code: 'invalid_type' }]);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const size = pngSize(bytes);
    if (size === null) {
      throw new VisionResponseError(endpoint, [{ path: '', code: 'invalid_format' }]);
    }
    if (size.width < 1 || size.height < 1 || size.width > maxSide || size.height > maxSide) {
      throw new VisionResponseError(endpoint, [{ path: 'IHDR', code: 'too_big' }]);
    }
    return bytes;
  }

  async function post<Schema extends z.ZodType>(
    path: string,
    files: Readonly<Record<string, VisionFile | undefined>>,
    schema: Schema,
    texts: Readonly<Record<string, string | undefined>> = {},
    timeout = timeoutMs,
  ): Promise<z.output<Schema>> {
    const endpoint = `/${path}`;
    const response = await send(path, files, texts, 'application/json', timeout);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new VisionResponseError(endpoint, []);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new VisionResponseError(endpoint, issuesOf(parsed.error));
    }
    return parsed.data;
  }

  return {
    analyzeGovernmentId: ({ front, back }): Promise<GovernmentIdAnalysis> =>
      post('v1/analyze/government-id', { front, back }, governmentIdAnalysisSchema),
    analyzeSelfie: ({ center, left, right, source }): Promise<SelfieAnalysis> =>
      post('v1/analyze/selfie', { center, left, right }, selfieAnalysisSchema, { source }),
    compareBackground: ({ probe, candidates }): Promise<BackgroundComparison> =>
      candidates.length < 1 || candidates.length > MAX_BACKGROUND_CANDIDATES
        ? Promise.reject(
            new RangeError(
              `A background comparison takes 1 to ${String(MAX_BACKGROUND_CANDIDATES)} candidates`,
            ),
          )
        : post(
            'v1/compare/background',
            {
              probe,
              ...Object.fromEntries(
                candidates.map((image, index) => [`candidate_${String(index)}`, image]),
              ),
            },
            backgroundComparisonSchema,
          ),
    // A chip portrait is decoded in the guarded child (C60.4).
    embedFace: ({ image, subject }): Promise<FaceEmbeddingResult> =>
      post(
        'v1/embed/face',
        { image },
        faceEmbeddingResultSchema,
        { subject },
        subject === 'chip' ? guardedTimeoutMs : timeoutMs,
      ),
    analyzeDocument: ({ document }): Promise<DocumentAnalysis> =>
      post('v1/analyze/document', { document }, documentAnalysisSchema, {}, guardedTimeoutMs),
    renderDocumentPage: ({ document, page }): Promise<Uint8Array> =>
      Number.isInteger(page) && page >= 1
        ? postPng('v1/render/document-page', { document }, RENDER_MAX_SIDE_PX, {
            page: String(page),
          })
        : Promise.reject(new RangeError('A document page is a whole number from 1')),
    convertPortrait: ({ portrait }): Promise<Uint8Array> =>
      postPng('v1/convert/portrait', { image: portrait }, PORTRAIT_MAX_SIDE_PX),
    // Not a guarded route, so it has the plain timeout.
    maskBackground: ({ image }): Promise<Uint8Array> =>
      postPng('v1/mask/background', { image }, MASKED_BACKGROUND_MAX_SIDE_PX, {}, timeoutMs),
    // C135.3: a PDF's pages are rendered by the guarded child, one child a page, and an image
    // may wait on the rendition lane behind one; vision stops at its own deadline (40 s) and
    // answers 503 `guarded_worker_failed` within this timeout.
    createRendition: async ({ source }): Promise<VisionRendition> =>
      renditionOf(await post('v1/renditions', { source }, renditionSchema, {}, guardedTimeoutMs)),
    // Workflow 11B: the count runs in the guarded child, so it has the guarded timeout.
    countDocumentPages: async ({ document }): Promise<VisionPageCount> => {
      const answer = await post(
        'v1/count/document-pages',
        { document },
        pageCountSchema,
        {},
        guardedTimeoutMs,
      );
      return { pageCount: answer.page_count };
    },
  };
}
