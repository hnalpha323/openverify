import { fetchThemeAssetContent, themeAssetAnswer } from '../../../../../lib/api/template-preview';

/**
 * `GET /theme-sets/assets/:id/content` (C160.6): a stored logo's rendition or a font, for the theme
 * editor's preview of the chosen logo. It reads the API's operator route with the session
 * (`theme-sets:read`) and answers through the preview's rules: a PNG, JPEG or WOFF2 of at most
 * 1 MiB, never cached, `nosniff`; the API's 401, 403 and 404 as a bare status; anything else 502.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const upstream = await fetchThemeAssetContent(id);
  return themeAssetAnswer(upstream);
}
