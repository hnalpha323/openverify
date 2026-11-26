/**
 * C123.3 (F19): where the child lives and what it may read. The parent resolves the entry, the
 * QuickJS packages and the `.wasm` to their real paths and passes exactly those to
 * `--allow-fs-read`, so the same code works from source, from `dist` and in the image, and nothing
 * is fetched at run time.
 *
 * Node's ES module resolver reads a dependency's `package.json` through the link in the importer's
 * `node_modules` before it follows the link, and a `stat` of that link is a read the permission
 * model checks. So each package that imports `@jitl/quickjs-ffi-types` needs that one link allowed
 * beside the real directory. In a flat `node_modules` the link is the real directory.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVALUATE_CODE_LIMITS } from '../actions/evaluate-code.js';
import {
  CODE_RUNNER_PROTOCOL_VERSION,
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
} from './protocol.js';

const CORE_PACKAGE = 'quickjs-emscripten-core';
const VARIANT_PACKAGE = '@jitl/quickjs-wasmfile-release-sync';
const TYPES_PACKAGE = '@jitl/quickjs-ffi-types';

export interface RunnerPaths {
  /** The child entry, a real path. */
  entry: string;
  /** The ES module of each package, a real path. */
  core: string;
  variant: string;
  wasm: string;
  /** The variant's `package.json`, which names it for the handshake. */
  manifest: string;
  /** `<package>@<version>`, what the child's `ready` must name. */
  label: string;
  /** Exactly what `--allow-fs-read` gets. */
  fsRead: readonly string[];
}

/** The contract the child reads by hand: it imports nothing of ours. */
export type ChildConfig = Readonly<Record<string, number | string>>;

const DEFAULT_ENTRY = fileURLToPath(new URL('../../bin/code-runner-child.mjs', import.meta.url));

const packageDirectoryOf = (mainFile: string): string => dirname(dirname(mainFile));

/** The `node_modules` holding a package, whose own scope folder sits between them when scoped. */
const nodeModulesOf = (packageDirectory: string, packageName: string): string =>
  packageName.startsWith('@') ? dirname(dirname(packageDirectory)) : dirname(packageDirectory);

export function resolveRunnerPaths(entry: string = DEFAULT_ENTRY): RunnerPaths {
  const require = createRequire(import.meta.url);
  const coreDirectory = packageDirectoryOf(require.resolve(CORE_PACKAGE));
  const variantDirectory = packageDirectoryOf(require.resolve(VARIANT_PACKAGE));
  const typesDirectory = packageDirectoryOf(
    createRequire(join(coreDirectory, 'package.json')).resolve(TYPES_PACKAGE),
  );
  const manifest = join(variantDirectory, 'package.json');
  const { name, version } = JSON.parse(readFileSync(manifest, 'utf8')) as {
    name: string;
    version: string;
  };
  const realEntry = realpathSync(entry);
  return {
    entry: realEntry,
    core: join(coreDirectory, 'dist', 'index.mjs'),
    variant: join(variantDirectory, 'dist', 'index.mjs'),
    wasm: require.resolve(`${VARIANT_PACKAGE}/wasm`),
    manifest,
    label: `${name}@${version}`,
    fsRead: [
      ...new Set([
        realEntry,
        `${coreDirectory}/`,
        `${variantDirectory}/`,
        `${typesDirectory}/`,
        join(nodeModulesOf(coreDirectory, CORE_PACKAGE), TYPES_PACKAGE),
        join(nodeModulesOf(variantDirectory, VARIANT_PACKAGE), TYPES_PACKAGE),
      ]),
    ],
  };
}

export function childConfigOf(paths: RunnerPaths): ChildConfig {
  return {
    core: paths.core,
    variant: paths.variant,
    wasm: paths.wasm,
    manifest: paths.manifest,
    protocol: CODE_RUNNER_PROTOCOL_VERSION,
    'request-frame-bytes': REQUEST_FRAME_MAX_BYTES,
    'response-frame-bytes': RESPONSE_FRAME_MAX_BYTES,
    'output-bytes': EVALUATE_CODE_LIMITS['output-bytes'].value,
    'output-depth': EVALUATE_CODE_LIMITS['output-depth'].value,
    'error-message-bytes': EVALUATE_CODE_LIMITS['error-message-bytes'].value,
    'console-lines': EVALUATE_CODE_LIMITS['console-lines'].value,
    'console-line-bytes': EVALUATE_CODE_LIMITS['console-line-bytes'].value,
  };
}

/** C123.3: the permission model, one read grant per path, and the heap cap. Nothing else. */
export function childArgumentsOf(paths: RunnerPaths): string[] {
  return [
    '--permission',
    ...paths.fsRead.map((path) => `--allow-fs-read=${path}`),
    `--max-old-space-size=${String(EVALUATE_CODE_LIMITS['child-heap-mb'].value)}`,
    paths.entry,
    JSON.stringify(childConfigOf(paths)),
  ];
}
