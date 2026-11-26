/**
 * C160.6 (`api-themes`, Workflow 9B): the flow reads its theme's assets with its session token from
 * `GET /api/v1/flow/theme-assets/:id`; an id that is not a theme asset's is never requested.
 */
import { describe, expect, it, vi } from 'vitest';
import { createThemeAssetLoader } from './assets';

const ID = 'tsa_01M5CK16P0D13FXHZSS4TCFBVH';
const TOKEN = 'ovs_synthetic-session-token-for-the-theme-asset-tests-0001';

describe('createThemeAssetLoader (C160.6)', () => {
  it('reads the asset with the session token and answers its bytes and type', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    const load = createThemeAssetLoader({
      baseUrl: 'https://api.example.com',
      sessionToken: TOKEN,
      fetch,
    });

    const asset = await load(ID);

    expect(new Uint8Array(asset.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(asset.mediaType).toBe('image/png');
    expect(fetch).toHaveBeenCalledWith(
      `https://api.example.com/api/v1/flow/theme-assets/${ID}`,
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: `Bearer ${TOKEN}` },
        credentials: 'omit',
      }),
    );
  });

  it('rejects an answer that is not 200', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    const load = createThemeAssetLoader({ baseUrl: '', sessionToken: TOKEN, fetch });
    await expect(load(ID)).rejects.toThrow();
  });

  it.each(['tsa_x', '../flow/session', 'theset_01M5CK16P0D13FXHZSS4TCFBVH'])(
    'never requests %j, which is not a theme asset id',
    async (id) => {
      const fetch = vi.fn();
      const load = createThemeAssetLoader({ baseUrl: '', sessionToken: TOKEN, fetch });
      await expect(load(id)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
