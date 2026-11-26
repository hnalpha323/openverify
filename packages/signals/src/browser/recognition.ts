/**
 * Device recognition (plan C94.4), read only under its tier: the bucketed screen, the hardware
 * hints, a 2D canvas digest (SHA-256 of `toDataURL` over a fixed drawing, computed here; only the
 * digest leaves the browser) with a second readback that detects noise, and the WebGL vendor and
 * renderer strings where the browser exposes them. Every read is guarded and answers `null` when
 * the browser does not give it.
 */
import { RECOGNITION_BUCKETS } from './constants.js';
import { probe } from './probe.js';
import type { BrowserWindow, RecognitionSignals } from './types.js';

const integerIn = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;

const bucket = (value: number, size: number) => Math.round(value / size) * size;

/** The WebGL strings: trimmed, at most 128 characters, `null` when empty or not a string. */
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 128) : null;

/**
 * The fixed drawing whose readback is digested: a filled box, a line of text in the generic
 * sans-serif family (one family only: no font is enumerated) and a translucent arc.
 */
function drawing(win: BrowserWindow): string | null {
  const canvas = win.document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 60;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.textBaseline = 'top';
  context.font = '14px sans-serif';
  context.fillStyle = '#f60';
  context.fillRect(125, 1, 62, 20);
  context.fillStyle = '#069';
  context.fillText('OpenVerify 1.0 <canvas>', 2, 15);
  context.fillStyle = 'rgba(102,204,0,0.7)';
  context.beginPath();
  context.arc(50, 40, 18, 0, Math.PI * 2);
  context.fill();
  return canvas.toDataURL();
}

/**
 * The canvas digest and noise flag: the drawing is read back twice, on two canvases; when the two
 * differ, the browser adds noise (Safari, Firefox and Brave do this for ordinary users), so no
 * digest is sent and the server keeps only the device class (C94.4).
 */
async function canvasDigest(win: BrowserWindow): Promise<[string | null, boolean]> {
  try {
    const subtle = win.crypto.subtle;
    const first = drawing(win);
    if (first === null) {
      return [null, false];
    }
    if (drawing(win) !== first) {
      return [null, true];
    }
    const digest = await subtle.digest(
      'SHA-256',
      Uint8Array.from(first, (character) => character.charCodeAt(0)),
    );
    return [
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      false,
    ];
  } catch {
    return [null, false];
  }
}

/** The WebGL vendor and renderer, unmasked where the browser allows; the context is released. */
function webgl(win: BrowserWindow): (string | null)[] {
  const gl = win.document.createElement('canvas').getContext('webgl');
  if (!gl) {
    return [null, null];
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const strings = [
    gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
  ].map(text);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return strings;
}

/** Reads the recognition components once. */
export async function readRecognition(win: BrowserWindow): Promise<RecognitionSignals> {
  const nav = win.navigator as Navigator & { readonly deviceMemory?: unknown };
  const screen = probe(() => {
    const { width, height, colorDepth } = win.screen;
    const pixels = RECOGNITION_BUCKETS.screenPixels;
    const ratio = RECOGNITION_BUCKETS.pixelRatio;
    const widthBucket = integerIn(bucket(width, pixels), 0, 16_384);
    const heightBucket = integerIn(bucket(height, pixels), 0, 16_384);
    const depth = integerIn(colorDepth, 1, 64);
    const pixelRatio = Math.min(8, Math.max(0.5, bucket(win.devicePixelRatio, ratio)));
    return widthBucket === null || heightBucket === null || depth === null || !(pixelRatio > 0)
      ? null
      : {
          'width-bucket': widthBucket,
          'height-bucket': heightBucket,
          'color-depth': depth,
          'pixel-ratio-bucket': pixelRatio,
        };
  }, null);
  const memory = probe(() => nav.deviceMemory, null);
  const [digest, noise] = await canvasDigest(win);
  const [vendor = null, renderer = null] = probe(() => webgl(win), []);
  return {
    screen,
    'hardware-concurrency': probe(() => integerIn(nav.hardwareConcurrency, 1, 1024), null),
    'device-memory':
      typeof memory === 'number' && memory >= 0.125 && memory <= 1024 ? memory : null,
    'max-touch-points': probe(() => integerIn(nav.maxTouchPoints, 0, 64), null),
    'canvas-digest': digest,
    'canvas-noise': noise,
    'webgl-vendor': vendor,
    'webgl-renderer': renderer,
  };
}
