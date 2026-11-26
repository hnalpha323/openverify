import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { flowSignalsSchema } from '@openverify/contracts';
import { fakeBrowser, fakeEvent, recording, type ReadLog } from './fake-browser.js';
import type { CollectorOptions, Collector } from './collector.js';

/**
 * The browser entry as the flow ships it (plan C94.1, F19): bundled here with esbuild, minified,
 * so no prior build is needed. The budget is 4,096 B gzipped, at both zlib's default level and its
 * highest; the bundle has no dependency, reaches no network, storage, frame or worker API, and runs
 * where code generation from strings is refused, as the flow's CSP (no `'unsafe-eval'`) refuses it.
 */
const ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BUDGET_BYTES = 4096;

async function bundle(format: 'esm' | 'iife') {
  const result = await build({
    absWorkingDir: PACKAGE_ROOT,
    entryPoints: [ENTRY],
    bundle: true,
    minify: true,
    write: false,
    format,
    platform: 'browser',
    target: 'es2020',
    metafile: true,
    logLevel: 'silent',
    ...(format === 'iife' ? { globalName: 'OpenVerifySignals' } : {}),
  });
  const output = result.outputFiles[0];
  if (output === undefined) {
    throw new Error('esbuild wrote no output');
  }
  return { text: output.text, bytes: output.contents, inputs: Object.keys(result.metafile.inputs) };
}

/**
 * APIs the collector never uses (C94.1, C94.3): requests, storage, frames, workers, code from
 * strings, markup and style writes, and the probes the plan excludes.
 */
const FORBIDDEN_SOURCE = [
  /\bfetch\b/,
  /XMLHttpRequest/,
  /sendBeacon/,
  /WebSocket/,
  /EventSource/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /cookie/,
  /iframe/i,
  /Worker/,
  /importScripts/,
  /postMessage/,
  /\beval\b/,
  /new Function/,
  /\bimport\(/,
  /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
  /setAttribute|\.style\b/,
  /setTimeout|setInterval/,
  /RTCPeerConnection|AudioContext|getBattery|permissions|mediaDevices|geolocation/,
  /clipboard|matchMedia|speechSynthesis|getVoices|\bfonts\b/,
  /https?:\/\//,
];

describe('the browser entry as shipped (C94.1, F19)', () => {
  it('fits 4,096 B gzipped and bundles nothing but its own sources', async () => {
    const { bytes, inputs } = await bundle('esm');
    const gzipDefault = gzipSync(bytes).byteLength;
    const gzipBest = gzipSync(bytes, { level: 9 }).byteLength;
    console.info(
      `[collector size] minified ${String(bytes.byteLength)} B, gzip ${String(gzipDefault)} B (level 6), ${String(gzipBest)} B (level 9); budget ${String(BUDGET_BYTES)} B`,
    );
    expect(Math.max(gzipDefault, gzipBest)).toBeLessThanOrEqual(BUDGET_BYTES);
    expect(inputs.length).toBeGreaterThan(1);
    for (const input of inputs) {
      expect(input).toMatch(/^src\/browser\/(?!fake-browser|reads)[a-z-]+\.ts$/);
    }
  });

  it('reaches no network, storage, frame, worker, markup or excluded probe', async () => {
    const { text } = await bundle('esm');
    expect(FORBIDDEN_SOURCE.filter((pattern) => pattern.test(text)).map(String)).toEqual([]);
  });
});

/** Globals the bundle must never touch on its own: everything goes through the given window. */
const PAGE_GLOBALS = [
  'window',
  'document',
  'navigator',
  'screen',
  'performance',
  'crypto',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'importScripts',
  'open',
  'postMessage',
  'RTCPeerConnection',
  'AudioContext',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
];

describe('the bundle under the production CSP rules (C94.1)', () => {
  it('collects a whole session where code from strings is refused, touching no page global itself', async () => {
    const { text } = await bundle('iife');
    const touched: string[] = [];
    const sandbox: Record<string, unknown> = {};
    for (const name of PAGE_GLOBALS) {
      Object.defineProperty(sandbox, name, {
        get() {
          touched.push(name);
          return undefined;
        },
      });
    }
    // `script-src` without 'unsafe-eval' or 'wasm-unsafe-eval' for the collector: no eval, no
    // Function from a string, no string timer.
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    expect(() => {
      vm.runInContext('eval("1")', context);
    }).toThrow(/Code generation from strings/);
    vm.runInContext(text, context);
    const api = vm.runInContext('OpenVerifySignals', context) as {
      startCollector: (options: CollectorOptions) => Collector;
    };

    const fake = fakeBrowser({ canvasReadbacks: ['data:image/png;base64,AAAA'] });
    const reads: ReadLog = [];
    const bodies: unknown[] = [];
    const collector = api.startCollector({
      tiers: { integrity: true, recognition: true },
      send: (body) => {
        bodies.push(JSON.parse(JSON.stringify(body)));
      },
      window: recording(fake.window, 'window', reads),
    });
    collector.screen('personal-details');
    fake.advance(400);
    fake.dispatch('document', fakeEvent('keydown'));
    fake.dispatch('document', fakeEvent('input', { inputType: 'insertFromPaste' }));
    collector.screen('government-id');
    await collector.flush();
    collector.stop();

    expect(touched).toEqual([]);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(flowSignalsSchema.safeParse(body).error).toBeUndefined();
    }
    const recognition = bodies
      .map((body) => (body as { recognition?: { 'canvas-digest': string | null } }).recognition)
      .find((item) => item !== undefined);
    expect(recognition?.['canvas-digest']).toMatch(/^[0-9a-f]{64}$/);
    expect(
      reads.filter((read) =>
        /fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|Storage|indexedDB|cookie|Worker|postMessage|^window\.open|^window\.Function\(\)|^new window\.Function/.test(
          read,
        ),
      ),
    ).toEqual([]);
  });
});
