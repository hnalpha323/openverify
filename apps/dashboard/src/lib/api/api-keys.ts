/**
 * API keys (C12) in the console: the list, the scopes an operator may grant (only those its role
 * holds: the API refuses the others), how the key form becomes the API's attributes, the state a
 * key's expiry gives it, and the caller's rate limits.
 */
import 'server-only';
import {
  rotatedApiKeyDocumentSchema,
  type ApiKeyResource,
  type RateLimitResource,
} from '@openverify/contracts';
import { API_SCOPES, type ApiScope, type Permission } from '@openverify/core';
import type { OpenVerifyClient } from '@openverify/node';
import { splitList } from '../../components/integrations/filter-values';
import { formString, formStrings } from './action';
import { apiRequest } from './client';
import { classifyApiError } from './errors';

export const API_KEY_PAGE_SIZE = 25;

/** One page of the environment's API keys. */
export function listApiKeys(api: OpenVerifyClient, after: string | undefined) {
  return api.apiKeys.list({
    page: { size: API_KEY_PAGE_SIZE, ...(after === undefined ? {} : { after }) },
  });
}

/**
 * The caller's rate limits (C12 `GET /rate-limits`, any principal), for the information panel of
 * `/api-keys`; `null` when the API cannot tell them (a 503 while its limiter fails open, or no
 * answer). A signed-out session still goes to sign-in.
 */
export async function readRateLimits(
  api: OpenVerifyClient,
): Promise<readonly RateLimitResource[] | null> {
  try {
    return (await api.rateLimits.list()).data;
  } catch (error) {
    const kind = classifyApiError(error);
    if (kind === null || kind === 'unauthenticated' || kind === 'mfa-required') {
      throw error;
    }
    return null;
  }
}

/** The API scopes `permissions` hold, in the catalog's order: what a new key may be granted. */
export function grantableScopes(permissions: ReadonlySet<Permission>): ApiScope[] {
  return API_SCOPES.filter((scope) => permissions.has(scope));
}

/**
 * The create form's attributes, for `createApiKeyBodySchema`: the name, the checked scopes, the
 * allowed CIDR ranges (one per line, or separated by commas) and the API version.
 */
export function apiKeyAttributesFromForm(formData: FormData): Record<string, unknown> {
  const apiVersion = formString(formData, 'api-version');
  return {
    name: formString(formData, 'name'),
    scopes: formStrings(formData, 'scopes'),
    'allowed-ips': splitList(formString(formData, 'allowed-ips')),
    ...(apiVersion === undefined || apiVersion === '' ? {} : { 'api-version': apiVersion }),
  };
}

/** `active` (no expiry), `expiring` (an expiry ahead) or `expired`. */
export type ApiKeyState = 'active' | 'expiring' | 'expired';

export function apiKeyState(expiresAt: string | null, now: Date): ApiKeyState {
  if (expiresAt === null) {
    return 'active';
  }
  return Date.parse(expiresAt) > now.getTime() ? 'expiring' : 'expired';
}

/** The rotation's answer: the new key, its token (shown once), and when the old token stops. */
export interface RotatedApiKey {
  readonly key: ApiKeyResource;
  readonly token: string;
  readonly previousKeyId: string;
  readonly previousExpiresAt: string;
}

/**
 * `POST /api-keys/:id/rotate` (`api-keys:write`; C169.1): a new key with the old one's scopes, IPs,
 * version, note and blocklist; the old token keeps working for `previousExpiresInSeconds` (0 ends it
 * now, at most 30 days). One audit entry links both.
 */
export async function rotateApiKey(
  id: string,
  meta: { readonly previousExpiresInSeconds: number; readonly name?: string },
): Promise<RotatedApiKey> {
  const answer = await apiRequest({
    method: 'POST',
    path: `/api-keys/${encodeURIComponent(id)}/rotate`,
    body: {
      meta: {
        'previous-expires-in-seconds': meta.previousExpiresInSeconds,
        ...(meta.name === undefined ? {} : { name: meta.name }),
      },
    },
    schema: rotatedApiKeyDocumentSchema,
  });
  return {
    key: answer.data,
    token: answer.meta.token,
    previousKeyId: answer.meta['previous-key-id'],
    previousExpiresAt: answer.meta['previous-expires-at'],
  };
}
