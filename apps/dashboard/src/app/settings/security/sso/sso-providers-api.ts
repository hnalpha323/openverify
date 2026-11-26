/**
 * C248.3 (Phase 11, Workflow 11B, `sso-oidc`): the console's calls of the SSO provider routes,
 * with the operator's session. The client secret is sent only on a create or a change and is never
 * read back: the API serves `client-secret-set` in its place.
 */
import 'server-only';
import {
  ssoProviderDocumentSchema,
  ssoProviderListDocumentSchema,
  type CreateSsoProviderBody,
  type SsoProviderResource,
  type UpdateSsoProviderBody,
} from '@openverify/contracts';
import { z } from 'zod';
import { apiRequest } from '../../../../lib/api/client';

export const SSO_PROVIDERS_PATH = '/dashboard/sso-providers';

/** `GET /dashboard/sso-providers`: the organisation's providers. */
export async function listSsoProviders(): Promise<readonly SsoProviderResource[]> {
  const answer = await apiRequest({
    method: 'GET',
    path: SSO_PROVIDERS_PATH,
    schema: ssoProviderListDocumentSchema,
  });
  return answer.data;
}

/** `POST /dashboard/sso-providers`. */
export async function createSsoProvider(body: CreateSsoProviderBody): Promise<SsoProviderResource> {
  const answer = await apiRequest({
    method: 'POST',
    path: SSO_PROVIDERS_PATH,
    body,
    schema: ssoProviderDocumentSchema,
  });
  return answer.data;
}

/** `PATCH /dashboard/sso-providers/:id`. */
export async function updateSsoProvider(
  id: string,
  body: UpdateSsoProviderBody,
): Promise<SsoProviderResource> {
  const answer = await apiRequest({
    method: 'PATCH',
    path: `${SSO_PROVIDERS_PATH}/${encodeURIComponent(id)}`,
    body,
    schema: ssoProviderDocumentSchema,
  });
  return answer.data;
}

/** `DELETE /dashboard/sso-providers/:id`. */
export async function deleteSsoProvider(id: string): Promise<void> {
  await apiRequest({
    method: 'DELETE',
    path: `${SSO_PROVIDERS_PATH}/${encodeURIComponent(id)}`,
    schema: z.undefined(),
  });
}
