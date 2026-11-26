/**
 * C160.6, C160.9 (`api-themes`, Workflow 9B): reading a theme asset for the flow, from
 * `GET /api/v1/flow/theme-assets/:id` with the session token (the API answers only an asset of the
 * session's environment). The bytes are sniffed again before any `blob:` URL or `FontFace` is made:
 * a logo must be PNG, JPEG or WebP, a font WOFF2, whatever type the answer claims.
 */
import { sniffAsset } from '../preview/assets';

/** An asset's bytes and the type the API served them as. */
export interface ThemeAssetBytes {
  readonly bytes: ArrayBuffer;
  readonly mediaType: string;
}

/** Reads one asset of the session's theme by its `tsa_` id. */
export type ThemeAssetLoader = (assetId: string, signal?: AbortSignal) => Promise<ThemeAssetBytes>;

export interface ThemeAssetLoaderOptions {
  /** API base URL from `parseApiBaseUrl`; `''` for the flow's own origin. */
  readonly baseUrl: string;
  readonly sessionToken: string;
  readonly fetch?: typeof fetch;
}

const ASSET_ID = /^tsa_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** A logo's type by its bytes (PNG, JPEG or WebP), or `null`. */
export function logoTypeOf(bytes: ArrayBuffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  const type = sniffAsset(bytes);
  return type === 'font/woff2' ? null : type;
}

/** Whether `bytes` start as a WOFF2 file (`wOF2`). */
export const isWoff2Bytes = (bytes: ArrayBuffer): boolean => sniffAsset(bytes) === 'font/woff2';

/** A loader over `GET /api/v1/flow/theme-assets/:id`; an id that is not `tsa_` is never asked. */
export function createThemeAssetLoader(options: ThemeAssetLoaderOptions): ThemeAssetLoader {
  const request = options.fetch ?? fetch;
  return async (assetId, signal) => {
    if (!ASSET_ID.test(assetId)) {
      throw new TypeError('Not a theme asset id.');
    }
    const response = await request(`${options.baseUrl}/api/v1/flow/theme-assets/${assetId}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${options.sessionToken}` },
      credentials: 'omit',
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status !== 200) {
      throw new Error(`The theme asset could not be read (${String(response.status)}).`);
    }
    return {
      bytes: await response.arrayBuffer(),
      mediaType: response.headers.get('content-type') ?? '',
    };
  };
}
