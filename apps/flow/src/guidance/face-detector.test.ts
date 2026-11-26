/**
 * C46.1: the face detector loads YuNet into one single-threaded onnxruntime-web session with
 * explicit `wasmPaths` on the flow's own origin, after checking every file's SHA-256, and gives up
 * quietly (no exception, nothing logged) when anything fails, so the capture offers the manual
 * shutter at once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../../contracts/fixtures/vision/yunet-decode.json';
import {
  loadFaceDetector,
  sha256Hex,
  type LoadFaceDetectorOptions,
  type OrtModule,
  type OrtSession,
  type OrtTensor,
} from './face-detector';
import { ORT_WASM, ORT_WASM_LOADER, YUNET_MODEL } from './guidance-assets';

const BASE_URL = 'https://flow.example/';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Stand-in bytes for each guidance file, and the digest the fake hash gives each. */
const FILES: Readonly<Record<string, string>> = {
  [YUNET_MODEL.path]: 'model',
  [ORT_WASM.path]: 'wasm',
  [ORT_WASM_LOADER.path]: 'loader',
};
const DIGESTS: Readonly<Record<string, string>> = {
  model: YUNET_MODEL.sha256,
  wasm: ORT_WASM.sha256,
  loader: ORT_WASM_LOADER.sha256,
};

function fakeSha256(bytes: ArrayBuffer): Promise<string> {
  return Promise.resolve(DIGESTS[decoder.decode(bytes)] ?? 'f'.repeat(64));
}

interface FakeOrt {
  readonly module: OrtModule;
  readonly created: { model: Uint8Array; options: unknown; env: unknown }[];
  readonly feeds: Readonly<Record<string, OrtTensor>>[];
  session: OrtSession;
}

/** A fake onnxruntime-web whose session answers with the golden YuNet outputs. */
function fakeOrt(): FakeOrt {
  const created: FakeOrt['created'] = [];
  const feeds: FakeOrt['feeds'] = [];
  const env: OrtModule['env'] = { wasm: {} };
  const outputs = Object.fromEntries(
    Object.entries(fixture.outputs).map(([name, values]) => [
      name,
      { data: Float32Array.from(values), dims: [1, values.length] },
    ]),
  );
  const fake: FakeOrt = {
    created,
    feeds,
    session: {
      run: (input) => {
        feeds.push(input);
        return Promise.resolve(outputs);
      },
    },
    module: {
      env,
      InferenceSession: {
        create: (model, options) => {
          created.push({ model, options, env: structuredClone({ ...env, wasm: { ...env.wasm } }) });
          return Promise.resolve(fake.session);
        },
      },
      Tensor: class {
        constructor(
          readonly type: 'float32',
          readonly data: Float32Array,
          readonly dims: readonly number[],
        ) {}
      },
    },
  };
  return fake;
}

/** The URL `fetch` was called with. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function fakeFetch(files: Readonly<Record<string, string>> = FILES) {
  return vi.fn<typeof fetch>((input) => {
    const url = urlOf(input);
    const path = url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url;
    const body = files[path];
    return Promise.resolve(
      body === undefined ? new Response('', { status: 404 }) : new Response(encoder.encode(body)),
    );
  });
}

function options(overrides: Partial<LoadFaceDetectorOptions> = {}, ort = fakeOrt()) {
  const importOrt = vi.fn(() => Promise.resolve(ort.module));
  const fetch = fakeFetch();
  return {
    ort,
    importOrt,
    fetch,
    options: {
      baseUrl: BASE_URL,
      fetch,
      importOrt,
      sha256: fakeSha256,
      ...overrides,
    } satisfies LoadFaceDetectorOptions,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadFaceDetector (C46.1)', () => {
  it('runs YuNet in one single-threaded WASM session, from files on the flow’s own origin', async () => {
    const { ort, fetch, options: load } = options();

    expect(await loadFaceDetector(load)).not.toBeNull();

    const [session] = ort.created;
    expect(decoder.decode(session?.model)).toBe('model');
    expect(session?.options).toEqual({
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      logSeverityLevel: 3,
    });
    expect(session?.env).toEqual({
      logLevel: 'error',
      wasm: {
        numThreads: 1,
        proxy: false,
        wasmPaths: {
          mjs: `${BASE_URL}${ORT_WASM_LOADER.path}`,
          wasm: `${BASE_URL}${ORT_WASM.path}`,
        },
        wasmBinary: encoder.encode('wasm'),
      },
    });
    const requested = fetch.mock.calls.map(([input]) => urlOf(input)).sort();
    expect(requested).toEqual(
      [YUNET_MODEL, ORT_WASM, ORT_WASM_LOADER].map((asset) => `${BASE_URL}${asset.path}`).sort(),
    );
  });

  it('detects faces: the padded BGR tensor in, YuNet’s decoded faces out', async () => {
    const { ort, options: load } = options();
    const detector = await loadFaceDetector(load);
    const frame = {
      width: fixture.input.width,
      height: fixture.input.height,
      data: new Uint8ClampedArray(fixture.input.width * fixture.input.height * 4),
    };

    const faces = (await detector?.detect(frame)) ?? [];

    expect(ort.feeds[0]?.input?.dims).toEqual([
      1,
      3,
      fixture.input.padded_height,
      fixture.input.padded_width,
    ]);
    expect(faces).toHaveLength(1);
    expect(faces[0]?.box[0]).toBeCloseTo(fixture.expected[0]?.box[0] ?? Number.NaN, 2);
    expect(faces[0]?.score).toBeCloseTo(fixture.expected[0]?.score ?? Number.NaN, 3);
  });

  it.each([YUNET_MODEL, ORT_WASM, ORT_WASM_LOADER])(
    'never starts ONNX Runtime when $path does not match its pin',
    async (asset) => {
      const { importOrt, options: load } = options({
        fetch: fakeFetch({ ...FILES, [asset.path]: 'tampered' }),
      });

      expect(await loadFaceDetector(load)).toBeNull();
      expect(importOrt).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a file is not found', { fetch: fakeFetch({ [YUNET_MODEL.path]: 'model' }) }],
    [
      'the network fails',
      { fetch: vi.fn<typeof fetch>(() => Promise.reject(new TypeError('offline'))) },
    ],
    ['ONNX Runtime cannot be imported', { importOrt: () => Promise.reject(new Error('chunk')) }],
  ] as const)('gives up quietly when %s', async (_label, overrides) => {
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const { options: load } = options(overrides);

    await expect(loadFaceDetector(load)).resolves.toBeNull();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives up quietly when the session cannot be created', async () => {
    const ort = fakeOrt();
    const failing: OrtModule = {
      ...ort.module,
      InferenceSession: { create: () => Promise.reject(new Error('protobuf parsing failed')) },
    };
    const { options: load } = options({ importOrt: () => Promise.resolve(failing) });

    await expect(loadFaceDetector(load)).resolves.toBeNull();
  });
});

describe('sha256Hex', () => {
  it('is the lower-case hex SHA-256 of the bytes', async () => {
    expect(await sha256Hex(encoder.encode('abc').buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
