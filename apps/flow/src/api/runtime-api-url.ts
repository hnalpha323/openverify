/**
 * C257.1 (Phase 11, Workflow 11C, images-11c; verification V07, decision 73): the API base URL of
 * the bundle. Built with `VITE_OPENVERIFY_API_URL` (`vite`, `vite preview`, the per-push e2e and
 * the mocked flow suite), the bundle uses it as before, without a request. Built without it (the
 * image), it reads the URL the flow server serves as `/config.json` before it renders, so one image
 * serves any install; a failed or malformed answer means the flow's own origin, as an unset
 * variable always has.
 */
import { parseApiBaseUrl } from './api-base-url';
import { FLOW_RUNTIME_CONFIG_PATH } from '../security/runtime-config';

/** The member of `/config.json` that holds the API base URL. */
export const RUNTIME_API_URL_KEY = 'api-url';

/** The API base URL (`''`: the flow's own origin). */
export async function resolveApiBaseUrl(
  buildValue: string | undefined,
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<string> {
  if ((buildValue?.trim() ?? '') !== '') {
    return parseApiBaseUrl(buildValue);
  }
  try {
    const response = await fetch(FLOW_RUNTIME_CONFIG_PATH, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      return '';
    }
    const body: unknown = await response.json();
    const value =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)[RUNTIME_API_URL_KEY]
        : undefined;
    return typeof value === 'string' ? parseApiBaseUrl(value) : '';
  } catch {
    return '';
  }
}
