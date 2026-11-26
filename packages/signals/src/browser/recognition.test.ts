import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeBrowser, type FakeBrowserOptions } from './fake-browser.js';
import { readRecognition } from './recognition.js';

const READBACK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk';
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const read = (options: FakeBrowserOptions = {}) => readRecognition(fakeBrowser(options).window);

describe('device recognition components (C94.4)', () => {
  it('reads the bucketed screen and the hardware hints', async () => {
    const recognition = await read({
      screen: { width: 1366, height: 768, colorDepth: 24 },
      devicePixelRatio: 1.3,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 5,
    });
    expect(recognition.screen).toEqual({
      'width-bucket': 1360,
      'height-bucket': 768,
      'color-depth': 24,
      'pixel-ratio-bucket': 1.25,
    });
    expect(recognition['hardware-concurrency']).toBe(8);
    expect(recognition['device-memory']).toBe(8);
    expect(recognition['max-touch-points']).toBe(5);
  });

  it('keeps the pixel ratio bucket inside 0.5 to 8', async () => {
    expect((await read({ devicePixelRatio: 0.3 })).screen?.['pixel-ratio-bucket']).toBe(0.5);
    expect((await read({ devicePixelRatio: 12 })).screen?.['pixel-ratio-bucket']).toBe(8);
    expect((await read({ devicePixelRatio: 3 })).screen?.['pixel-ratio-bucket']).toBe(3);
  });

  it('answers null for what the browser does not give, or gives out of bounds', async () => {
    const recognition = await read({
      screen: null,
      hardwareConcurrency: 0,
      maxTouchPoints: 99,
    });
    expect(recognition.screen).toBeNull();
    expect(recognition['hardware-concurrency']).toBeNull();
    expect(recognition['device-memory']).toBeNull();
    expect(recognition['max-touch-points']).toBeNull();
    expect((await read({ screen: { width: 1280, height: 800, colorDepth: 0 } })).screen).toBeNull();
    expect(
      (await read({ screen: { width: 40_000, height: 800, colorDepth: 24 } })).screen,
    ).toBeNull();
    expect((await read({ hardwareConcurrency: 2.5 }))['hardware-concurrency']).toBeNull();
    expect((await read({ deviceMemory: 0.1 }))['device-memory']).toBeNull();
  });

  it('digests the fixed canvas drawing with SHA-256 in the browser, when two readbacks agree', async () => {
    const fake = fakeBrowser({ canvasReadbacks: [READBACK] });
    const recognition = await readRecognition(fake.window);
    expect(recognition['canvas-digest']).toBe(sha256(READBACK));
    expect(recognition['canvas-noise']).toBe(false);
    // Two canvases, the same drawing on each, and the drawing is fixed from run to run.
    expect(fake.drawings).toHaveLength(2);
    expect(fake.drawings[1]).toEqual(fake.drawings[0]);
    const again = fakeBrowser({ canvasReadbacks: [READBACK] });
    await readRecognition(again.window);
    expect(again.drawings[0]).toEqual(fake.drawings[0]);
    expect(fake.drawings[0]?.length).toBeGreaterThan(3);
  });

  it('detects canvas noise when the two readbacks differ, and then sends no digest', async () => {
    const recognition = await read({ canvasReadbacks: [READBACK, `${READBACK}AB`] });
    expect(recognition['canvas-noise']).toBe(true);
    expect(recognition['canvas-digest']).toBeNull();
  });

  it('sends no digest without a 2D canvas or without SubtleCrypto', async () => {
    expect(await read({ canvasReadbacks: null })).toMatchObject({
      'canvas-digest': null,
      'canvas-noise': false,
    });
    expect(await read({ subtle: false })).toMatchObject({
      'canvas-digest': null,
      'canvas-noise': false,
    });
  });

  it('reads the unmasked WebGL strings where the browser exposes them, then releases the context', async () => {
    const fake = fakeBrowser({
      webgl: {
        vendor: 'WebKit',
        renderer: 'WebKit WebGL',
        unmaskedVendor: 'Example GPU Vendor',
        unmaskedRenderer: `Example Renderer ${'x'.repeat(200)}`,
      },
    });
    const recognition = await readRecognition(fake.window);
    expect(recognition['webgl-vendor']).toBe('Example GPU Vendor');
    expect(recognition['webgl-renderer']).toHaveLength(128);
    expect(recognition['webgl-renderer']?.startsWith('Example Renderer')).toBe(true);
    expect(fake.webglReleased()).toBe(true);
  });

  it('falls back to the masked WebGL strings, and to null without WebGL or with empty strings', async () => {
    const masked = await read({ webgl: { vendor: ' Mozilla ', renderer: 'Generic Renderer' } });
    expect(masked['webgl-vendor']).toBe('Mozilla');
    expect(masked['webgl-renderer']).toBe('Generic Renderer');
    const empty = await read({ webgl: { vendor: '', renderer: '   ' } });
    expect(empty['webgl-vendor']).toBeNull();
    expect(empty['webgl-renderer']).toBeNull();
    const none = await read({ webgl: null });
    expect(none['webgl-vendor']).toBeNull();
    expect(none['webgl-renderer']).toBeNull();
  });

  it('answers nulls when creating a canvas throws', async () => {
    const fake = fakeBrowser();
    Object.defineProperty(fake.window.document, 'createElement', {
      value: () => {
        throw new Error('blocked');
      },
    });
    expect(await readRecognition(fake.window)).toMatchObject({
      'canvas-digest': null,
      'canvas-noise': false,
      'webgl-vendor': null,
      'webgl-renderer': null,
    });
  });
});
