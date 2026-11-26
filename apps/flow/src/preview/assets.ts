/**
 * C156.2 (Workflow 9A, `flow-server-embed`; reviews P17, H15, F09): the `preview-assets` message's
 * transferred buffers. The preview has no session and `connect-src 'none'`, so the console fetches
 * the theme's logo and font itself and posts their bytes; the preview sniffs each buffer again
 * before any `blob:` URL or font is made: a logo must be PNG, JPEG or WebP by its bytes, a font WOFF2
 * (`wOF2`). Anything else is refused, and its policy is never relaxed for them.
 */

export type PreviewAssetType = 'image/png' | 'image/jpeg' | 'image/webp' | 'font/woff2';

/** The family an uploaded font is loaded under in the preview. */
export const PREVIEW_FONT_FAMILY = 'openverify-preview-font';

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + prefix.length &&
  prefix.every((value, index) => bytes[offset + index] === value);

/** The type `bytes` really hold, by their magic numbers, or `null`. */
export function sniffAsset(buffer: ArrayBuffer): PreviewAssetType | null {
  const bytes = new Uint8Array(buffer);
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  if (startsWith(bytes, [0x77, 0x4f, 0x46, 0x32])) {
    return 'font/woff2';
  }
  return null;
}

/** The browser's parts the assets are given to (injected in tests). */
export interface PreviewAssetDeps {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  /** Loads a font from bytes (`new FontFace(family, bytes)`, `load()`, `document.fonts.add`). */
  readonly loadFont: (family: string, bytes: ArrayBuffer) => Promise<void>;
}

export interface LoadedPreviewAssets {
  /** Each accepted logo's `blob:` URL by asset id. */
  readonly logos: ReadonlyMap<string, string>;
  /** Whether a font was loaded under `PREVIEW_FONT_FAMILY`. */
  readonly font: boolean;
  /** Whether any asset was refused. */
  readonly refused: boolean;
}

/** Sniffs and loads `assets`: each accepted logo a `blob:` URL, an accepted font loaded. */
export async function loadPreviewAssets(
  assets: readonly {
    readonly 'asset-id': string;
    readonly kind: 'logo' | 'font';
    readonly bytes: ArrayBuffer;
  }[],
  deps: PreviewAssetDeps,
): Promise<LoadedPreviewAssets> {
  const logos = new Map<string, string>();
  let font = false;
  let refused = false;
  for (const asset of assets) {
    const type = sniffAsset(asset.bytes);
    if (asset.kind === 'logo' && type !== null && type !== 'font/woff2') {
      logos.set(asset['asset-id'], deps.createObjectURL(new Blob([asset.bytes], { type })));
    } else if (asset.kind === 'font' && type === 'font/woff2') {
      try {
        await deps.loadFont(PREVIEW_FONT_FAMILY, asset.bytes);
        font = true;
      } catch {
        refused = true;
      }
    } else {
      refused = true;
    }
  }
  return { logos, font, refused };
}

/** The browser's own asset parts: `URL.createObjectURL` and a `FontFace` from bytes. */
export function browserAssetDeps(document: Document): PreviewAssetDeps {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => {
      URL.revokeObjectURL(url);
    },
    loadFont: async (family, bytes) => {
      const face = new FontFace(family, bytes);
      await face.load();
      document.fonts.add(face);
    },
  };
}
