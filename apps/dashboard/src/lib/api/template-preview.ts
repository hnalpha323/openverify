/**
 * C156.1, C156.2, C156.4 (Workflow 9C, `dashboard-preview`): the preview and simulate calls of a
 * template version, and the theme asset read the preview's `preview-assets` message is built from.
 *
 * - `previewTemplateVersion`: `POST /inquiry-template-versions/:id/preview` with an optional unsaved
 *   body (`flow`, `copy`, `field-schemas`, `theme-set-id`, `styles`) and `meta.locale`. The answer is
 *   configuration and synthetic guidance only, never inquiry data.
 * - `simulateTemplateVersion`: `POST /inquiry-template-versions/:id/simulate` with a simulated scope
 *   or a preset id. The scope is personal data in logs (C174.5): it goes in the body only, never in a
 *   URL, a log line or a query.
 * - `fetchThemeAssetContent` and `themeAssetAnswer`: `GET /theme-sets/assets/:id/content`, read on
 *   the BFF with the session and passed on to the browser by the preview's asset route, so the
 *   console can post the bytes to the frame (the preview itself has `connect-src 'none'`).
 *
 * All three need the template's `inquiry-templates:read`; the asset read also `theme-sets:read`.
 */
import 'server-only';
import {
  idSchema,
  templatePreviewDocumentSchema,
  templateSimulationDocumentSchema,
  type PreviewInquiryTemplateVersionBody,
  type SimulateInquiryTemplateVersionBody,
} from '@openverify/contracts';
import type { z } from 'zod';
import { apiBaseUrl } from '../config';
import { getSessionToken } from '../session';
import { apiRequest, getBffFetch } from './client';

export type TemplatePreviewDocument = z.output<typeof templatePreviewDocumentSchema>;
export type TemplateSimulationDocument = z.output<typeof templateSimulationDocumentSchema>;

const versionPath = (versionId: string, action: 'preview' | 'simulate') => {
  if (!idSchema('itmplv').safeParse(versionId).success) {
    throw new TypeError('Not a template version id');
  }
  return `/inquiry-template-versions/${versionId}/${action}`;
};

/** `POST /inquiry-template-versions/:id/preview`. */
export async function previewTemplateVersion(
  versionId: string,
  body: PreviewInquiryTemplateVersionBody,
): Promise<TemplatePreviewDocument> {
  return apiRequest({
    method: 'POST',
    path: versionPath(versionId, 'preview'),
    body,
    schema: templatePreviewDocumentSchema,
  });
}

/** `POST /inquiry-template-versions/:id/simulate`: the scope travels in the body only. */
export async function simulateTemplateVersion(
  versionId: string,
  body: SimulateInquiryTemplateVersionBody,
): Promise<TemplateSimulationDocument> {
  return apiRequest({
    method: 'POST',
    path: versionPath(versionId, 'simulate'),
    body,
    schema: templateSimulationDocumentSchema,
  });
}

/** The asset types the preview takes (C160.6): a logo's rendition and a WOFF2 font. */
const ASSET_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'font/woff2']);
/** C156.2: what one `preview-assets` message may transfer in all (`PREVIEW_ASSETS_MAX_BYTES`). */
const ASSET_MAX_BYTES = 1024 * 1024;
/** API statuses passed on as a bare status: no session, no `theme-sets:read`, no such asset. */
const PASSED_ON: ReadonlySet<number> = new Set([401, 403, 404]);
const NO_STORE = { 'cache-control': 'private, no-store' } as const;

const emptyAnswer = (status: number): Response =>
  new Response(null, { status, headers: { ...NO_STORE } });

/**
 * `GET /theme-sets/assets/:id/content` as the raw answer, with the session and the BFF headers;
 * `null` without a session or for an id that is not a theme asset's (nothing is sent then).
 */
export async function fetchThemeAssetContent(assetId: string): Promise<Response | null> {
  if (!idSchema('tsa').safeParse(assetId).success) {
    return null;
  }
  const token = await getSessionToken();
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (token === null) {
    return null;
  }
  const bffFetch = await getBffFetch();
  return bffFetch(`${apiBaseUrl()}/api/v1/theme-sets/assets/${assetId}/content`, {
    headers: { authorization: `Bearer ${token}`, accept: 'image/png, image/jpeg, font/woff2' },
  });
}

/**
 * What the console's preview asset route answers for an API asset read: a PNG, JPEG or WOFF2 of
 * at most 1 MiB passed on, never cached, `nosniff` and with no filename; the API's 401, 403 and 404
 * as a bare status; 401 without a session; anything else 502. The API's problem is not passed on.
 */
export async function themeAssetAnswer(upstream: Response | null): Promise<Response> {
  if (upstream === null) {
    return emptyAnswer(401);
  }
  const contentType = upstream.headers.get('content-type') ?? '';
  let bytes: ArrayBuffer;
  try {
    bytes = await upstream.arrayBuffer();
  } catch {
    return emptyAnswer(502);
  }
  if (upstream.status !== 200) {
    return emptyAnswer(PASSED_ON.has(upstream.status) ? upstream.status : 502);
  }
  if (!ASSET_TYPES.has(contentType) || bytes.byteLength > ASSET_MAX_BYTES) {
    return emptyAnswer(502);
  }
  return new Response(bytes, {
    status: 200,
    headers: { ...NO_STORE, 'content-type': contentType, 'x-content-type-options': 'nosniff' },
  });
}
