/**
 * C123.3 (F19): the workspace-layout test. The parent resolves the child entry, the QuickJS packages
 * and the `.wasm` to their real paths (pnpm's `.pnpm` layout), and passes exactly those to
 * `--allow-fs-read`. Nothing is downloaded at run time: everything comes from `node_modules`.
 */
import { accessSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { EVALUATE_CODE_LIMITS } from '../actions/evaluate-code.js';
import { childArgumentsOf, childConfigOf, resolveRunnerPaths, type RunnerPaths } from './paths.js';
import {
  CODE_RUNNER_PROTOCOL_VERSION,
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
} from './protocol.js';

let paths: RunnerPaths;

beforeAll(() => {
  paths = resolveRunnerPaths();
});

describe('resolveRunnerPaths', () => {
  it('finds the dependency-free entry beside src and dist', () => {
    expect(paths.entry).toBe(
      realpathSync(fileURLToPath(new URL('../../bin/code-runner-child.mjs', import.meta.url))),
    );
  });

  it('resolves every path to a real file, past pnpm symlinks', () => {
    for (const path of [paths.entry, paths.core, paths.variant, paths.wasm, paths.manifest]) {
      accessSync(path);
      expect(realpathSync(path)).toBe(path);
    }
    expect(paths.core).toMatch(/quickjs-emscripten-core\/dist\/index\.mjs$/);
    expect(paths.variant).toMatch(/quickjs-wasmfile-release-sync\/dist\/index\.mjs$/);
    expect(paths.wasm).toMatch(/quickjs-wasmfile-release-sync\/dist\/emscripten-module\.wasm$/);
  });

  it('names the variant the handshake must confirm', () => {
    expect(paths.label).toBe('@jitl/quickjs-wasmfile-release-sync@0.32.0');
  });

  it('allows the entry, the three packages and the links to the shared types, nothing else', () => {
    expect(paths.fsRead).toContain(paths.entry);
    const within = (path: string) => paths.fsRead.some((allowed) => path.startsWith(allowed));
    for (const path of [paths.core, paths.variant, paths.wasm, paths.manifest]) {
      expect(within(path), path).toBe(true);
    }
    expect(paths.fsRead.some((allowed) => allowed.endsWith('quickjs-ffi-types/'))).toBe(true);
    for (const allowed of paths.fsRead) {
      expect(allowed, allowed).toMatch(/code-runner-child\.mjs$|quickjs/);
      expect(allowed.split(sep).at(-2), allowed).not.toBe('node_modules');
    }
    expect(new Set(paths.fsRead).size).toBe(paths.fsRead.length);
  });

  it('takes another entry for the same packages', () => {
    const other = fileURLToPath(new URL('./paths.ts', import.meta.url));
    expect(resolveRunnerPaths(other).entry).toBe(realpathSync(other));
    expect(resolveRunnerPaths(other).fsRead).toContain(realpathSync(other));
  });
});

describe('childArgumentsOf (C123.3)', () => {
  let args: string[];

  beforeAll(() => {
    args = childArgumentsOf(paths);
  });

  it('turns the permission model on, with one --allow-fs-read per path and the heap cap', () => {
    expect(args[0]).toBe('--permission');
    expect(args.filter((arg) => arg.startsWith('--allow-fs-read='))).toEqual(
      paths.fsRead.map((path) => `--allow-fs-read=${path}`),
    );
    expect(args).toContain(
      `--max-old-space-size=${String(EVALUATE_CODE_LIMITS['child-heap-mb'].value)}`,
    );
  });

  it('grants nothing else', () => {
    const flags = args.filter((arg) => arg.startsWith('--'));
    expect(flags.filter((flag) => flag.startsWith('--allow-'))).toHaveLength(paths.fsRead.length);
    expect(flags.join(' ')).not.toMatch(/--allow-(?:child-process|worker|addons|wasi|fs-write)/);
    expect(flags.join(' ')).not.toMatch(/--inspect|--experimental|--import|--require/);
  });

  it('ends with the entry and its configuration', () => {
    expect(args.at(-2)).toBe(paths.entry);
    expect(JSON.parse(args.at(-1) ?? '')).toEqual(childConfigOf(paths));
  });
});

describe('childConfigOf', () => {
  it('hands the child the contract it reads by hand', () => {
    expect(childConfigOf(paths)).toEqual({
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
    });
  });
});
