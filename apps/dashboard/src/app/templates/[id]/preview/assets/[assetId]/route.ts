import { idSchema } from '@openverify/contracts';
import {
  fetchThemeAssetContent,
  themeAssetAnswer,
} from '../../../../../../lib/api/template-preview';

const empty = (status: number) =>
  new Response(null, { status, headers: { 'cache-control': 'private, no-store' } });

/**
 * `GET /templates/:id/preview/assets/:assetId` (C156.2, C160.6; review P17): a theme asset's bytes for
 * the preview frame, read from `GET /theme-sets/assets/:id/content` with the session cookie. Only a
 * PNG, JPEG or WOFF2 of at most 1 MiB passes, never cached; the API's errors become a bare status.
 * The API checks `theme-sets:read` and the environment.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
): Promise<Response> {
  const { id, assetId } = await params;
  if (!idSchema('itmpl').safeParse(id).success || !idSchema('tsa').safeParse(assetId).success) {
    return empty(404);
  }
  try {
    return await themeAssetAnswer(await fetchThemeAssetContent(assetId));
  } catch {
    return empty(502);
  }
}
