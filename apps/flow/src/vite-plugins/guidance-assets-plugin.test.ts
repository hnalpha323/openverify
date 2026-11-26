// @vitest-environment node
/**
 * C46.1: the local Vite plugin copies the YuNet model from `models/` and the ORT WASM files from
 * the package into the build, each checked against its pinned SHA-256, with ONNX Runtime's licence
 * and notices beside them. Nothing is fetched from a CDN.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import {
  LIBPHONENUMBER_NOTICES,
  ORT_NOTICES,
  ORT_WASM,
  ORT_WASM_LOADER,
  YUNET_MODEL,
} from '../guidance/guidance-assets';
import {
  GuidanceAssetError,
  defaultGuidanceAssets,
  guidanceAssetsPlugin,
  readVerifiedAsset,
  type GuidanceAssetSource,
} from './guidance-assets-plugin';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'openverify-guidance-'));
}

/** A guidance file written to a temporary directory, pinned to its own digest. */
async function tempAsset(content = 'guidance bytes'): Promise<GuidanceAssetSource> {
  const source = path.join(await tempDir(), 'asset.bin');
  await writeFile(source, content);
  return {
    path: 'guidance/asset.bin',
    sha256: sha256(content),
    contentType: 'application/octet-stream',
    source,
  };
}

type Hook = (...args: never[]) => unknown;

/** A plugin hook as a plain function, whether it was given bare or as `{ handler }`. */
function hook(plugin: Plugin, name: 'generateBundle' | 'configureServer'): Hook {
  const value = plugin[name] as Hook | { handler: Hook } | undefined;
  if (value === undefined) {
    throw new TypeError(`the plugin has no ${name} hook`);
  }
  return typeof value === 'function' ? value : value.handler;
}

interface Emitted {
  readonly fileName: string;
  readonly source: Uint8Array;
}

async function build(plugin: Plugin): Promise<Emitted[]> {
  const emitted: Emitted[] = [];
  const context = {
    emitFile: (file: { type: string; fileName: string; source: Uint8Array }) => {
      emitted.push({ fileName: file.fileName, source: file.source });
      return file.fileName;
    },
  };
  await (hook(plugin, 'generateBundle') as (this: typeof context) => Promise<void>).call(context);
  return emitted;
}

type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: unknown) => void,
) => void;

/** The plugin's development middleware, as Vite's dev server would install it. */
async function devMiddleware(plugin: Plugin, base = '/'): Promise<Middleware> {
  let installed: Middleware | undefined;
  const server = {
    config: { base, logger: { error: vi.fn() } },
    middlewares: {
      use: (middleware: Middleware) => {
        installed = middleware;
      },
    },
  } as unknown as ViteDevServer;
  await (hook(plugin, 'configureServer') as (server: ViteDevServer) => unknown)(server);
  if (installed === undefined) {
    throw new TypeError('no middleware installed');
  }
  return installed;
}

interface Served {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer | null;
  readonly passedOn: boolean;
}

async function request(middleware: Middleware, url: string): Promise<Served> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = value;
      },
      end: (body?: Uint8Array | string) => {
        resolve({
          status: res.statusCode,
          headers,
          body: body === undefined ? null : Buffer.from(body),
          passedOn: false,
        });
      },
    };
    middleware({ url, method: 'GET' } as IncomingMessage, res as unknown as ServerResponse, () => {
      resolve({ status: 0, headers, body: null, passedOn: true });
    });
  });
}

describe('defaultGuidanceAssets', () => {
  const assets = defaultGuidanceAssets(REPO_ROOT);
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));

  it('lists the model, the WASM runtime with its loader, and the licences and notices', () => {
    expect([...byPath.keys()].sort()).toEqual(
      [YUNET_MODEL, ORT_WASM, ORT_WASM_LOADER, ...ORT_NOTICES, ...LIBPHONENUMBER_NOTICES]
        .map((asset) => asset.path)
        .sort(),
    );
    for (const asset of assets) {
      expect(asset.path).toMatch(/^(?:guidance|licenses)\//);
    }
  });

  it('takes YuNet from models/, pinned as models/manifest.json pins it', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(REPO_ROOT, 'models', 'manifest.json'), 'utf8'),
    ) as { models: { filename: string; sha256: string }[] };
    const entry = manifest.models.find(
      (model) => model.filename === 'face_detection_yunet_2026may.onnx',
    );

    expect(byPath.get(YUNET_MODEL.path)).toMatchObject({
      source: path.join(REPO_ROOT, 'models', 'face_detection_yunet_2026may.onnx'),
      sha256: entry?.sha256,
      hint: expect.stringContaining('python3 scripts/fetch_models.py') as unknown,
    });
  });

  it('takes the WASM runtime and its loader, unchanged, from the installed onnxruntime-web', async () => {
    for (const pinned of [ORT_WASM, ORT_WASM_LOADER]) {
      const asset = byPath.get(pinned.path);
      expect(asset?.source).toMatch(/[\\/]onnxruntime-web[\\/]dist[\\/]ort-wasm-simd-threaded\./);
      expect(sha256(await readFile(asset?.source ?? ''))).toBe(pinned.sha256);
    }
  });

  it('serves ONNX Runtime’s licence and notices, Eigen’s MPL-2.0 among them (C48)', async () => {
    for (const pinned of ORT_NOTICES) {
      const content = await readFile(byPath.get(pinned.path)?.source ?? '');
      expect(sha256(content)).toBe(pinned.sha256);
    }
    const notices = await readFile(
      byPath.get('licenses/onnxruntime-web/ThirdPartyNotices.txt')?.source ?? '',
      'utf8',
    );
    expect(notices).toContain('Mozilla Public License Version 2.0');
  });

  // Phase 10 P2 (owner, 2026-11-08; settles Phase 4 decision 11): Eigen ships inside the WASM under
  // MPL-2.0, whose section 3.2(a) asks that recipients be told where its source is. ORT's notices
  // name Eigen and its licence but no location, so the flow serves one beside them.
  it('serves where the source of the Eigen inside the WASM is, beside ONNX Runtime’s notices', async () => {
    expect(ORT_NOTICES.map((notice) => notice.path)).toEqual([
      'licenses/onnxruntime-web/LICENSE.txt',
      'licenses/onnxruntime-web/ThirdPartyNotices.txt',
      'licenses/onnxruntime-web/EIGEN-SOURCE.txt',
    ]);
    const source = await readFile(
      byPath.get('licenses/onnxruntime-web/EIGEN-SOURCE.txt')?.source ?? '',
      'utf8',
    );
    expect(source).toContain('1d8b82b0740839c0de7f1242a3585e3390ff5f33');
    expect(source).toContain('https://github.com/eigen-mirror/eigen');
    expect(source).toContain('https://gitlab.com/libeigen/eigen');
    expect(source).toContain('MPL-2.0');
    expect(source).toContain('unmodified');
  });

  // Workflow 5C review P020: the phone and country steps bundle libphonenumber's metadata, whose
  // Apache-2.0 licence (section 4(a)) must reach everyone the flow serves it to.
  it('serves libphonenumber-js’s MIT licence and its metadata’s Apache-2.0 licence, as installed', async () => {
    expect(LIBPHONENUMBER_NOTICES.map((notice) => notice.path)).toEqual([
      'licenses/libphonenumber-js/LICENSE',
      'licenses/libphonenumber-js/LICENSE.Apache',
    ]);
    for (const pinned of LIBPHONENUMBER_NOTICES) {
      const source = byPath.get(pinned.path)?.source ?? '';
      expect(source).toMatch(/[\\/]libphonenumber-js[\\/]LICENSE(?:\.Apache)?$/);
      expect(sha256(await readFile(source))).toBe(pinned.sha256);
      expect(pinned.contentType).toBe('text/plain; charset=utf-8');
    }
    const apache = await readFile(
      byPath.get('licenses/libphonenumber-js/LICENSE.Apache')?.source ?? '',
      'utf8',
    );
    expect(apache).toContain('Apache License');
    expect(apache).toContain('Version 2.0');
  });

  it('refuses a repository whose manifest pins another YuNet than the flow serves', async () => {
    const root = await tempDir();
    await mkdir(path.join(root, 'models'));
    await writeFile(
      path.join(root, 'models', 'manifest.json'),
      JSON.stringify({
        models: [{ filename: 'face_detection_yunet_2026may.onnx', sha256: '0'.repeat(64) }],
      }),
    );

    expect(() => defaultGuidanceAssets(root)).toThrow(GuidanceAssetError);
  });
});

describe('readVerifiedAsset', () => {
  it('returns the bytes of a file that matches its pin', async () => {
    const asset = await tempAsset('pinned');

    expect(Buffer.from(await readVerifiedAsset(asset)).toString()).toBe('pinned');
  });

  it('refuses a file whose digest differs, naming it', async () => {
    const asset = { ...(await tempAsset('pinned')), sha256: sha256('other') };

    await expect(readVerifiedAsset(asset)).rejects.toThrow(GuidanceAssetError);
    await expect(readVerifiedAsset(asset)).rejects.toThrow(asset.source);
  });

  it('explains how to get a missing file', async () => {
    const asset = {
      ...(await tempAsset()),
      source: path.join(await tempDir(), 'missing.onnx'),
      hint: 'run python3 scripts/fetch_models.py',
    };

    await expect(readVerifiedAsset(asset)).rejects.toThrow(/missing\.onnx.*fetch_models\.py/s);
  });
});

describe('guidanceAssetsPlugin', () => {
  it('puts each verified file into the build at its path', async () => {
    const asset = await tempAsset('model bytes');

    const emitted = await build(guidanceAssetsPlugin({ assets: [asset] }));

    expect(emitted.map((file) => file.fileName)).toEqual(['guidance/asset.bin']);
    expect(Buffer.from(emitted[0]?.source ?? []).toString()).toBe('model bytes');
  });

  it('stops the build when a file does not match its pin', async () => {
    const asset = { ...(await tempAsset('tampered')), sha256: sha256('original') };

    await expect(build(guidanceAssetsPlugin({ assets: [asset] }))).rejects.toThrow(
      GuidanceAssetError,
    );
  });

  it('serves the verified files in development, with their content type', async () => {
    const asset = { ...(await tempAsset('wasm bytes')), contentType: 'application/wasm' };
    const middleware = await devMiddleware(guidanceAssetsPlugin({ assets: [asset] }), '/flow/');

    const served = await request(middleware, '/flow/guidance/asset.bin?v=1');

    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('application/wasm');
    expect(served.body?.toString()).toBe('wasm bytes');
  });

  it('passes every other request on', async () => {
    const middleware = await devMiddleware(guidanceAssetsPlugin({ assets: [await tempAsset()] }));

    expect((await request(middleware, '/index.html')).passedOn).toBe(true);
    expect((await request(middleware, '/guidance/other.bin')).passedOn).toBe(true);
  });

  it('answers 500 in development for a file that does not match its pin', async () => {
    const asset = { ...(await tempAsset('tampered')), sha256: sha256('original') };
    const middleware = await devMiddleware(guidanceAssetsPlugin({ assets: [asset] }));

    expect((await request(middleware, '/guidance/asset.bin')).status).toBe(500);
  });
});
