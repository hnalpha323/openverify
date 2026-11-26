/**
 * C156.2 (review F09): the preview sniffs each transferred buffer again (PNG, JPEG or WebP for a
 * logo; `wOF2` for a font) before any `blob:` URL or font is made, and refuses anything else.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  loadPreviewAssets,
  PREVIEW_FONT_FAMILY,
  sniffAsset,
  type PreviewAssetDeps,
} from './assets';

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array([...values, 0, 0, 0, 0]).buffer;
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
const WOFF2 = bytes(0x77, 0x4f, 0x46, 0x32);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>').buffer;
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const WOFF1 = bytes(0x77, 0x4f, 0x46, 0x46);
const LOGO_ID = 'tsa_01M5CJXHG07XPHF3HRM6NREDH7';
const FONT_ID = 'tsa_01M5CK16P0D13FXHZSS4TCFBVH';

const deps = (overrides: Partial<PreviewAssetDeps> = {}) => ({
  createObjectURL: vi.fn((blob: Blob) => `blob:preview/${blob.type}`),
  revokeObjectURL: vi.fn(),
  loadFont: vi.fn(() => Promise.resolve()),
  ...overrides,
});

describe('sniffAsset', () => {
  it('reads the type from the bytes', () => {
    expect(sniffAsset(PNG)).toBe('image/png');
    expect(sniffAsset(JPEG)).toBe('image/jpeg');
    expect(sniffAsset(WEBP)).toBe('image/webp');
    expect(sniffAsset(WOFF2)).toBe('font/woff2');
  });

  it('refuses SVG, GIF, WOFF 1, an empty or a short buffer', () => {
    for (const buffer of [
      SVG,
      GIF,
      WOFF1,
      new ArrayBuffer(0),
      new Uint8Array([0x89, 0x50]).buffer,
    ]) {
      expect(sniffAsset(buffer)).toBeNull();
    }
  });
});

describe('loadPreviewAssets (C156.2)', () => {
  it('makes a blob: URL of a logo with its sniffed type, and loads a font from bytes', async () => {
    const browser = deps();
    const loaded = await loadPreviewAssets(
      [
        { 'asset-id': LOGO_ID, kind: 'logo', bytes: PNG },
        { 'asset-id': FONT_ID, kind: 'font', bytes: WOFF2 },
      ],
      browser,
    );

    expect(loaded).toEqual({
      logos: new Map([[LOGO_ID, 'blob:preview/image/png']]),
      font: true,
      refused: false,
    });
    expect(browser.loadFont).toHaveBeenCalledWith(PREVIEW_FONT_FAMILY, WOFF2);
  });

  it('refuses a buffer of the wrong type for its kind before any URL or font is made', async () => {
    const browser = deps();
    const loaded = await loadPreviewAssets(
      [
        { 'asset-id': LOGO_ID, kind: 'logo', bytes: SVG },
        { 'asset-id': FONT_ID, kind: 'font', bytes: PNG },
      ],
      browser,
    );
    expect(loaded).toEqual({ logos: new Map(), font: false, refused: true });
    expect(browser.createObjectURL).not.toHaveBeenCalled();
    expect(browser.loadFont).not.toHaveBeenCalled();

    const fontAsLogo = await loadPreviewAssets(
      [{ 'asset-id': LOGO_ID, kind: 'logo', bytes: WOFF2 }],
      browser,
    );
    expect(fontAsLogo.refused).toBe(true);
  });

  it('refuses a font the browser cannot load', async () => {
    const loaded = await loadPreviewAssets(
      [{ 'asset-id': FONT_ID, kind: 'font', bytes: WOFF2 }],
      deps({ loadFont: () => Promise.reject(new Error('decode')) }),
    );
    expect(loaded).toEqual({ logos: new Map(), font: false, refused: true });
  });
});
