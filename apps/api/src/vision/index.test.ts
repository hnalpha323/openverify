import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VisionDocument, VisionImage, VisionPortrait } from '../ports.js';
import {
  DEFAULT_GUARDED_VISION_TIMEOUT_MS,
  VisionError,
  VisionResponseError,
  VisionServiceError,
  VisionUnavailableError,
  createVisionClient,
  isUnreadableImageError,
  MASKED_BACKGROUND_MAX_SIDE_PX,
} from './index.js';

const TOKEN = 'test-vision-service-token-0123456789abcdef';

function fixtureText(name: string): string {
  const url = new URL(`../../../../contracts/fixtures/vision/${name}.json`, import.meta.url);
  return readFileSync(url, 'utf8');
}

const jpeg: VisionImage = {
  bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  mimeType: 'image/jpeg',
};
const png: VisionImage = {
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]),
  mimeType: 'image/png',
};

interface ReceivedPart {
  field: string;
  type: string;
  filename: string;
  bytes: number[];
}

interface ReceivedRequest {
  method: string;
  path: string;
  token: string | undefined;
  accept: string | undefined;
  parts: ReceivedPart[];
  /** The plain text fields, in order. */
  texts: { field: string; value: string }[];
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let handler: Handler;
const received: ReceivedRequest[] = [];

async function readMultipart(
  message: IncomingMessage,
): Promise<Pick<ReceivedRequest, 'parts' | 'texts'>> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) {
    chunks.push(chunk as Buffer);
  }
  const contentType = message.headers['content-type'] ?? '';
  const texts: ReceivedRequest['texts'] = [];
  if (!contentType.startsWith('multipart/form-data')) {
    return { parts: [], texts };
  }
  const body = new Response(Buffer.concat(chunks), { headers: { 'content-type': contentType } });
  // Test-only parsing of a small, trusted body; production code never parses multipart.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const form = await body.formData();
  const parts: ReceivedPart[] = [];
  for (const [field, value] of form.entries()) {
    if (typeof value === 'string') {
      texts.push({ field, value });
    } else {
      parts.push({
        field,
        type: value.type,
        filename: value.name,
        bytes: [...new Uint8Array(await value.arrayBuffer())],
      });
    }
  }
  return { parts, texts };
}

/** A handler answering every request with `status` and `body`. */
function respondWith(status: number, body: string, type = 'application/json'): Handler {
  return (_request, response) => {
    response.writeHead(status, { 'content-type': type });
    response.end(body);
  };
}

beforeAll(async () => {
  server = createServer((message, response) => {
    void readMultipart(message).then(({ parts, texts }) => {
      const request: ReceivedRequest = {
        method: message.method ?? '',
        path: message.url ?? '',
        token: message.headers['x-service-token'] as string | undefined,
        accept: message.headers.accept,
        parts,
        texts,
      };
      received.push(request);
      handler(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

afterEach(() => {
  received.length = 0;
  vi.restoreAllMocks();
});

const client = () => createVisionClient({ baseUrl, serviceToken: TOKEN, timeoutMs: 2_000 });

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('createVisionClient requests (C6)', () => {
  it('posts the front and back of an ID with the service token and returns the analysis', async () => {
    handler = respondWith(200, fixtureText('analyze-government-id'));
    const analysis = await client().analyzeGovernmentId({ front: jpeg, back: png });

    expect(analysis).toEqual(JSON.parse(fixtureText('analyze-government-id')));
    const [request] = received;
    expect(request).toMatchObject({
      method: 'POST',
      path: '/v1/analyze/government-id',
      token: TOKEN,
      accept: 'application/json',
    });
    expect(request?.parts).toEqual([
      { field: 'front', type: 'image/jpeg', filename: 'front.jpg', bytes: [...jpeg.bytes] },
      { field: 'back', type: 'image/png', filename: 'back.png', bytes: [...png.bytes] },
    ]);
  });

  it('sends only the front when there is no back', async () => {
    handler = respondWith(200, fixtureText('analyze-government-id'));
    await client().analyzeGovernmentId({ front: jpeg, back: undefined });
    expect(received[0]?.parts.map((part) => part.field)).toEqual(['front']);
  });

  it('posts the selfie poses it is given', async () => {
    handler = respondWith(200, fixtureText('analyze-selfie'));
    const webp: VisionImage = { bytes: Uint8Array.from([0x52, 0x49]), mimeType: 'image/webp' };
    const analysis = await client().analyzeSelfie({ center: jpeg, right: webp });
    expect(analysis.poses.center.face?.embedding).toHaveLength(128);
    expect(received[0]?.path).toBe('/v1/analyze/selfie');
    expect(received[0]?.parts.map((part) => [part.field, part.filename])).toEqual([
      ['center', 'center.jpg'],
      ['right', 'right.webp'],
    ]);
  });

  it('names the selfie source in a text field after the images, and sends none when not given (C41.1)', async () => {
    handler = respondWith(200, fixtureText('analyze-selfie'));
    await client().analyzeSelfie({ center: jpeg, left: png, source: 'upload' });
    await client().analyzeSelfie({ center: jpeg });

    expect(received[0]?.parts.map((part) => part.field)).toEqual(['center', 'left']);
    expect(received[0]?.texts).toEqual([{ field: 'source', value: 'upload' }]);
    expect(received[1]?.texts).toEqual([]);
  });

  it('posts a probe and its candidates, numbered from 0, to the background comparison (C41.2)', async () => {
    const answer = {
      results: [
        { index: 0, good_matches: 320, inliers: 300, inlier_ratio: 0.9375 },
        { index: 1, good_matches: 9, inliers: 4, inlier_ratio: 0.4444 },
      ],
    };
    handler = respondWith(200, JSON.stringify(answer));

    expect(await client().compareBackground({ probe: jpeg, candidates: [png, jpeg] })).toEqual(
      answer,
    );
    expect(received[0]?.path).toBe('/v1/compare/background');
    expect(received[0]?.parts.map((part) => [part.field, part.filename])).toEqual([
      ['probe', 'probe.jpg'],
      ['candidate_0', 'candidate_0.png'],
      ['candidate_1', 'candidate_1.jpg'],
    ]);
  });

  it('refuses a background comparison of no candidate or more than five, without calling vision', async () => {
    handler = respondWith(200, '{"results":[]}');
    const six = [jpeg, jpeg, jpeg, jpeg, jpeg, jpeg];

    await expect(client().compareBackground({ probe: jpeg, candidates: six })).rejects.toThrow(
      RangeError,
    );
    await expect(client().compareBackground({ probe: jpeg, candidates: [] })).rejects.toThrow(
      RangeError,
    );
    expect(received).toEqual([]);
  });

  it('posts an image to the face embedding endpoint, with no subject for a selfie (K101)', async () => {
    handler = respondWith(200, fixtureText('embed-face'));
    const result = await client().embedFace({ image: png });
    expect(result.face_count).toBe(1);
    expect(received[0]?.path).toBe('/v1/embed/face');
    expect(received[0]?.parts.map((part) => part.field)).toEqual(['image']);
    expect(received[0]?.texts).toEqual([]);
  });

  it.each(['document', 'selfie'] as const)(
    'names the subject %s of a face embedding in a text field after the image (K101)',
    async (subject) => {
      handler = respondWith(200, fixtureText('embed-face'));
      await client().embedFace({ image: jpeg, subject });
      expect(received[0]?.parts.map((part) => part.field)).toEqual(['image']);
      expect(received[0]?.texts).toEqual([{ field: 'subject', value: subject }]);
    },
  );

  it('keeps a path prefix of the base URL', async () => {
    handler = respondWith(200, fixtureText('embed-face'));
    await createVisionClient({ baseUrl: `${baseUrl}/vision/`, serviceToken: TOKEN }).embedFace({
      image: jpeg,
    });
    expect(received[0]?.path).toBe('/vision/v1/embed/face');
  });
});

describe('createVisionClient errors', () => {
  it.each([
    [401, false],
    [413, false],
    [422, false],
    [408, true],
    [429, true],
    [500, true],
    [503, true],
  ])('maps HTTP %i to a VisionServiceError (retryable: %s)', async (status, retryable) => {
    handler = respondWith(
      status,
      JSON.stringify({ type: 'about:blank', title: 'Problem', status }),
      'application/problem+json',
    );
    const error = await caught(client().embedFace({ image: jpeg }));
    expect(error).toBeInstanceOf(VisionServiceError);
    expect(error).toBeInstanceOf(VisionError);
    expect(error).toMatchObject({ status, retryable, endpoint: '/v1/embed/face' });
    expect(String(error)).not.toContain(TOKEN);
  });

  it.each([
    [new VisionServiceError('/v1/analyze/selfie', 413), true],
    [new VisionServiceError('/v1/analyze/selfie', 415), true],
    [new VisionServiceError('/v1/analyze/selfie', 422), true],
    [new VisionServiceError('/v1/analyze/selfie', 400), false],
    [new VisionServiceError('/v1/analyze/selfie', 401), false],
    [new VisionServiceError('/v1/analyze/selfie', 503), false],
    [new VisionUnavailableError('/v1/analyze/selfie', 'timeout'), false],
    [new Error('415'), false],
  ])('isUnreadableImageError(%s) is %s', (error, unreadable) => {
    expect(isUnreadableImageError(error)).toBe(unreadable);
  });

  it('rejects a response that does not match C6, without echoing its values', async () => {
    const body = JSON.parse(fixtureText('embed-face')) as { face: { embedding: number[] } };
    body.face.embedding = body.face.embedding.slice(0, 64);
    handler = respondWith(200, JSON.stringify(body));
    const error = await caught(client().embedFace({ image: jpeg }));
    expect(error).toBeInstanceOf(VisionResponseError);
    expect(error).toMatchObject({ retryable: false });
    expect((error as VisionResponseError).issues).toEqual([
      { path: 'face.embedding', code: 'too_small' },
    ]);
    const firstValue = String(body.face.embedding[0]);
    expect(JSON.stringify(error)).not.toContain(firstValue);
    expect((error as Error).message).not.toContain(firstValue);
  });

  it('rejects a body that is not JSON', async () => {
    handler = respondWith(200, '<html>', 'text/html');
    const error = await caught(client().embedFace({ image: jpeg }));
    expect(error).toBeInstanceOf(VisionResponseError);
    expect(error).toMatchObject({ retryable: false, issues: [] });
  });

  it('times out a slow service as a retryable outage', async () => {
    handler = () => {
      // Never answers.
    };
    const error = await caught(
      createVisionClient({ baseUrl, serviceToken: TOKEN, timeoutMs: 50 }).embedFace({
        image: jpeg,
      }),
    );
    expect(error).toBeInstanceOf(VisionUnavailableError);
    expect(error).toMatchObject({ retryable: true, reason: 'timeout' });
  });

  it('reports an unreachable service as a retryable outage', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) =>
      closed.close(() => {
        resolve();
      }),
    );
    const error = await caught(
      createVisionClient({
        baseUrl: `http://127.0.0.1:${String(port)}`,
        serviceToken: TOKEN,
      }).embedFace({ image: jpeg }),
    );
    expect(error).toBeInstanceOf(VisionUnavailableError);
    expect(error).toMatchObject({ retryable: true, reason: 'network' });
  });

  it('wraps a non-Error rejection of the fetch implementation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue('boom');
    const error = await caught(
      createVisionClient({ baseUrl, serviceToken: TOKEN, fetch: fetchImpl }).embedFace({
        image: jpeg,
      }),
    );
    expect(error).toBeInstanceOf(VisionUnavailableError);
  });
});

describe('createVisionClient options', () => {
  it.each([
    ['a relative base URL', { baseUrl: '/vision', serviceToken: TOKEN }],
    ['a non-HTTP base URL', { baseUrl: 'ftp://vision.internal', serviceToken: TOKEN }],
    ['a base URL with a query', { baseUrl: 'http://vision.internal/?a=1', serviceToken: TOKEN }],
    ['a short service token', { baseUrl: 'http://vision.internal', serviceToken: 'short' }],
    ['a zero timeout', { baseUrl: 'http://vision.internal', serviceToken: TOKEN, timeoutMs: 0 }],
  ])('rejects %s', (_label, options) => {
    expect(() => createVisionClient(options)).toThrow(TypeError);
  });

  it('never puts the service token in its validation errors', () => {
    const token = 'x'.repeat(31);
    expect(() => createVisionClient({ baseUrl: 'nope', serviceToken: token })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(token) as unknown }) as Error,
    );
  });
});

// C60.1, C60.4 (Workflow 5B) --------------------------------------------------------------------

const pdfDocument: VisionDocument = {
  bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
  mimeType: 'application/pdf',
};
const jp2Portrait: VisionPortrait = {
  bytes: Uint8Array.from([0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20]),
  mimeType: 'image/jp2',
};

/** A PNG signature and IHDR of `width` x `height` (no image data: the client reads the header). */
function pngOf(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header.set([8, 6, 0, 0, 0], 24);
  return header;
}

function respondWithPng(body: Buffer, type = 'image/png'): Handler {
  return (_request, response) => {
    response.writeHead(200, { 'content-type': type });
    response.end(body);
  };
}

describe('createVisionClient document requests (C60.1, C60.4)', () => {
  it('posts a PDF as the document field and returns the analysis', async () => {
    handler = respondWith(200, fixtureText('analyze-document-pdf'));
    const analysis = await client().analyzeDocument({ document: pdfDocument });

    expect(analysis).toEqual(JSON.parse(fixtureText('analyze-document-pdf')));
    expect(received[0]).toMatchObject({ path: '/v1/analyze/document', token: TOKEN });
    expect(received[0]?.parts).toEqual([
      {
        field: 'document',
        type: 'application/pdf',
        filename: 'document.pdf',
        bytes: [...pdfDocument.bytes],
      },
    ]);
  });

  it('posts a photo of a document as an image', async () => {
    handler = respondWith(200, fixtureText('analyze-document-image'));
    await client().analyzeDocument({ document: jpeg });
    expect(received[0]?.parts.map((part) => [part.field, part.filename])).toEqual([
      ['document', 'document.jpg'],
    ]);
  });

  it('asks for a page as a PNG and returns its bytes', async () => {
    const preview = pngOf(1200, 1553);
    handler = respondWithPng(preview);

    const bytes = await client().renderDocumentPage({ document: pdfDocument, page: 2 });

    expect([...bytes]).toEqual([...preview]);
    expect(received[0]).toMatchObject({ path: '/v1/render/document-page', accept: 'image/png' });
    expect(received[0]?.parts.map((part) => part.field)).toEqual(['document']);
    expect(received[0]?.texts).toEqual([{ field: 'page', value: '2' }]);
  });

  it('refuses a page number below 1 or not whole, without calling vision', async () => {
    await expect(client().renderDocumentPage({ document: pdfDocument, page: 0 })).rejects.toThrow(
      RangeError,
    );
    await expect(client().renderDocumentPage({ document: pdfDocument, page: 1.5 })).rejects.toThrow(
      RangeError,
    );
    expect(received).toEqual([]);
  });

  it('converts a chip portrait to a PNG of at most 640 px', async () => {
    const converted = pngOf(480, 640);
    handler = respondWithPng(converted);

    const bytes = await client().convertPortrait({ portrait: jp2Portrait });

    expect([...bytes]).toEqual([...converted]);
    expect(received[0]?.path).toBe('/v1/convert/portrait');
    expect(received[0]?.parts).toEqual([
      { field: 'image', type: 'image/jp2', filename: 'image.jp2', bytes: [...jp2Portrait.bytes] },
    ]);
  });

  it.each([
    ['a preview over 1,600 px', 'render', pngOf(1601, 900), 'image/png'],
    ['a portrait over 640 px', 'portrait', pngOf(640, 641), 'image/png'],
    ['an answer that is not image/png', 'render', pngOf(10, 10), 'image/jpeg'],
    ['bytes that are not a PNG', 'portrait', Buffer.from('not a png at all, no'), 'image/png'],
    ['a zero-sized PNG', 'render', pngOf(0, 10), 'image/png'],
  ] as const)('refuses %s', async (_case, route, body, type) => {
    handler = respondWithPng(body, type);
    const call =
      route === 'render'
        ? client().renderDocumentPage({ document: pdfDocument, page: 1 })
        : client().convertPortrait({ portrait: jp2Portrait });
    const error = await caught(call);
    expect(error).toBeInstanceOf(VisionResponseError);
    expect(error).toMatchObject({ retryable: false });
  });

  it('answers the masked background as the PNG it received (C99.7)', async () => {
    const masked = pngOf(640, 480);
    handler = respondWithPng(masked);

    const bytes = await client().maskBackground({ image: jpeg });

    expect([...bytes]).toEqual([...masked]);
    expect(received[0]?.path).toBe('/v1/mask/background');
    expect(received[0]?.parts.map((part) => part.field)).toEqual(['image']);
  });

  it('refuses a masked background over the 640 px of the contract (C99.7)', async () => {
    handler = respondWithPng(pngOf(MASKED_BACKGROUND_MAX_SIDE_PX + 1, 480));
    const error = await caught(client().maskBackground({ image: jpeg }));
    expect(error).toBeInstanceOf(VisionResponseError);
    expect(error).toMatchObject({ retryable: false });
  });

  it('embeds a chip portrait with subject chip (C60.4)', async () => {
    handler = respondWith(200, fixtureText('embed-face-chip'));
    const result = await client().embedFace({ image: jp2Portrait, subject: 'chip' });

    expect(result.face_count).toBe(1);
    expect(received[0]?.parts.map((part) => [part.field, part.type, part.filename])).toEqual([
      ['image', 'image/jp2', 'image.jp2'],
    ]);
    expect(received[0]?.texts).toEqual([{ field: 'subject', value: 'chip' }]);
  });
});

describe('createVisionClient guarded routes (C60.2)', () => {
  /** Answers each request after `ms`, as a busy vision does. */
  const slowly =
    (ms: number, answer: Handler): Handler =>
    (request, response) => {
      setTimeout(() => {
        answer(request, response);
      }, ms);
    };

  it('waits longer for the routes that run the guarded child than for the others', async () => {
    const fast = createVisionClient({ baseUrl, serviceToken: TOKEN, timeoutMs: 50 });

    handler = slowly(300, respondWith(200, fixtureText('embed-face-chip')));
    expect(await caught(fast.embedFace({ image: jpeg }))).toMatchObject({ reason: 'timeout' });
    await expect(fast.embedFace({ image: jp2Portrait, subject: 'chip' })).resolves.toMatchObject({
      face_count: 1,
    });
    handler = slowly(300, respondWith(200, fixtureText('analyze-document-pdf')));
    await expect(fast.analyzeDocument({ document: pdfDocument })).resolves.toBeDefined();
    handler = slowly(300, respondWithPng(pngOf(100, 100)));
    await expect(
      fast.renderDocumentPage({ document: pdfDocument, page: 1 }),
    ).resolves.toBeDefined();
    await expect(fast.convertPortrait({ portrait: jp2Portrait })).resolves.toBeDefined();
  });

  it('times the guarded routes out on their own timeout, longer than the child is given', async () => {
    expect(DEFAULT_GUARDED_VISION_TIMEOUT_MS).toBeGreaterThan(30_000);
    const strict = createVisionClient({
      baseUrl,
      serviceToken: TOKEN,
      timeoutMs: 50,
      guardedTimeoutMs: 50,
    });
    handler = slowly(300, respondWith(200, fixtureText('analyze-document-pdf')));
    expect(await caught(strict.analyzeDocument({ document: pdfDocument }))).toMatchObject({
      retryable: true,
      reason: 'timeout',
    });
    expect(() => createVisionClient({ baseUrl, serviceToken: TOKEN, guardedTimeoutMs: 0 })).toThrow(
      TypeError,
    );
  });
});

describe('createVisionClient problem codes (C60.1)', () => {
  it.each(['pdf_encrypted', 'pdf_unprocessable', 'too_many_pages'])(
    'carries the code %s of a 422',
    async (code) => {
      handler = respondWith(
        422,
        JSON.stringify({ type: 'about:blank', title: 'Unprocessable', status: 422, code }),
        'application/problem+json',
      );
      const error = await caught(client().analyzeDocument({ document: pdfDocument }));
      expect(error).toBeInstanceOf(VisionServiceError);
      expect(error).toMatchObject({ status: 422, code, retryable: false });
    },
  );

  it('carries guarded_worker_failed on a retryable 503', async () => {
    handler = respondWith(
      503,
      JSON.stringify({ status: 503, code: 'guarded_worker_failed' }),
      'application/problem+json',
    );
    const error = await caught(client().analyzeDocument({ document: pdfDocument }));
    expect(error).toMatchObject({ status: 503, code: 'guarded_worker_failed', retryable: true });
  });

  it.each([
    ['no code', JSON.stringify({ status: 422 })],
    ['a code that is not a code', JSON.stringify({ status: 422, code: 'Not A Code!' })],
    ['a body that is not JSON', 'not json'],
    [
      'a body over 4 KiB',
      JSON.stringify({ status: 422, code: 'pdf_encrypted', pad: 'x'.repeat(5000) }),
    ],
  ])('keeps the code null for %s', async (_case, body) => {
    handler = respondWith(422, body, 'application/problem+json');
    const error = await caught(client().analyzeDocument({ document: pdfDocument }));
    expect(error).toMatchObject({ status: 422, code: null });
  });
});
