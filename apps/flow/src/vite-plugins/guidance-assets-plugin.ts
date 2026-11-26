/**
 * The local Vite plugin that puts the guidance files into the flow (C46.1): the YuNet model from
 * `models/` and onnxruntime-web's WASM files from the package, each checked against its pinned
 * SHA-256, plus ONNX Runtime's licence and notices (C48) and libphonenumber-js's licences, whose
 * metadata the flow's JavaScript bundles (Workflow 5C review P020). Nothing is fetched from a
 * CDN: a file that is missing or differs stops the build. The development server serves the same
 * verified files.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile as readFileFromDisk } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';
import {
  LIBPHONENUMBER_NOTICES,
  ORT_NOTICES,
  ORT_WASM,
  ORT_WASM_LOADER,
  YUNET_MODEL,
  type GuidanceAsset,
} from '../guidance/guidance-assets';

export interface GuidanceAssetSource extends GuidanceAsset {
  /** Absolute path of the file the build copies. */
  readonly source: string;
  /** What to do when the file is missing, such as fetching the models. */
  readonly hint?: string;
}

/** A guidance file that is missing or does not match its pinned digest: the build stops. */
export class GuidanceAssetError extends Error {
  override readonly name = 'GuidanceAssetError';
}

export type ReadFile = (path: string) => Promise<Uint8Array>;

const YUNET_FILENAME = path.posix.basename(YUNET_MODEL.path);

interface ModelManifest {
  readonly models?: readonly { readonly filename?: string; readonly sha256?: string }[];
}

/**
 * The guidance files of this repository, with where each comes from.
 * @throws {GuidanceAssetError} when `models/manifest.json` pins another YuNet than the flow.
 */
export function defaultGuidanceAssets(repoRoot: string): GuidanceAssetSource[] {
  const manifestPath = path.join(repoRoot, 'models', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ModelManifest;
  const pinned = manifest.models?.find((model) => model.filename === YUNET_FILENAME)?.sha256;
  if (pinned !== YUNET_MODEL.sha256) {
    throw new GuidanceAssetError(
      `${manifestPath} pins ${YUNET_FILENAME} as ${String(pinned)}, but the flow serves ` +
        `${YUNET_MODEL.sha256}: update both together (apps/flow/src/guidance/guidance-assets.ts).`,
    );
  }
  const flowRoot = path.join(repoRoot, 'apps', 'flow');
  const fromFlow = createRequire(path.join(flowRoot, 'package.json'));
  const libphonenumberRoot = path.dirname(fromFlow.resolve('libphonenumber-js/package.json'));
  return [
    {
      ...YUNET_MODEL,
      source: path.join(repoRoot, 'models', YUNET_FILENAME),
      hint: 'run python3 scripts/fetch_models.py, which fetches it as models/manifest.json pins it',
    },
    { ...ORT_WASM, source: fromFlow.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm') },
    { ...ORT_WASM_LOADER, source: fromFlow.resolve('onnxruntime-web/ort-wasm-simd-threaded.mjs') },
    // apps/flow/licenses/onnxruntime-web/*, served at the same relative path.
    ...ORT_NOTICES.map((notice) => ({ ...notice, source: path.join(flowRoot, notice.path) })),
    // The installed package's own files: a new version whose licence text differs stops the build.
    ...LIBPHONENUMBER_NOTICES.map((notice) => ({
      ...notice,
      source: path.join(libphonenumberRoot, path.posix.basename(notice.path)),
    })),
  ];
}

/**
 * The bytes of `asset`, once their SHA-256 matches the pin.
 * @throws {GuidanceAssetError} when the file is missing or differs.
 */
export async function readVerifiedAsset(
  asset: GuidanceAssetSource,
  readFile: ReadFile = (file) => readFileFromDisk(file),
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(asset.source);
  } catch (cause: unknown) {
    const hint = asset.hint === undefined ? '' : `: ${asset.hint}`;
    throw new GuidanceAssetError(`The guidance file ${asset.source} cannot be read${hint}.`, {
      cause,
    });
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset.sha256) {
    throw new GuidanceAssetError(
      `The guidance file ${asset.source} has SHA-256 ${digest}, not the pinned ${asset.sha256}.`,
    );
  }
  return bytes;
}

export interface GuidanceAssetsPluginOptions {
  readonly assets: readonly GuidanceAssetSource[];
  /** Injected in tests; defaults to `fs.readFile`. */
  readonly readFile?: ReadFile;
}

/** Copies the verified guidance files into the build, and serves them in development. */
export function guidanceAssetsPlugin({ assets, readFile }: GuidanceAssetsPluginOptions): Plugin {
  const verified = new Map<string, Promise<Uint8Array>>();
  /** Each file is read and checked once per dev server, and again after a failure. */
  const read = (asset: GuidanceAssetSource): Promise<Uint8Array> => {
    let bytes = verified.get(asset.path);
    if (bytes === undefined) {
      bytes = readVerifiedAsset(asset, readFile);
      verified.set(asset.path, bytes);
      bytes.catch(() => verified.delete(asset.path));
    }
    return bytes;
  };

  return {
    name: 'openverify:guidance-assets',

    async generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: 'asset',
          fileName: asset.path,
          source: await readVerifiedAsset(asset, readFile),
        });
      }
    },

    configureServer(server) {
      const { base } = server.config;
      const middleware: Connect.NextHandleFunction = (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        const asset = assets.find((candidate) => pathname === `${base}${candidate.path}`);
        if (asset === undefined) {
          next();
          return;
        }
        read(asset).then(
          (bytes) => {
            res.setHeader('content-type', asset.contentType);
            res.end(bytes);
          },
          (error: unknown) => {
            server.config.logger.error(String(error));
            res.statusCode = 500;
            res.end('This guidance file does not match its pinned SHA-256.');
          },
        );
      };
      server.middlewares.use(middleware);
    },
  };
}
