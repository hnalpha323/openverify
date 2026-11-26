/**
 * The API, as server components and server actions of this request reach it (C21):
 *
 * - `getApiClient()`: the `@openverify/node` client (C18) for the server API, authenticated with
 *   the operator's session token, which the server API accepts as a bearer (C12).
 * - `apiRequest(call)`: any server or dashboard API endpoint with the session, typed by its
 *   contract schema. Use it for the dashboard API, and for a server endpoint the node client
 *   has no method for.
 * - `publicApiRequest(call)`: the dashboard routes that take no session (login, MFA login,
 *   invitations).
 *
 * Every request carries the operator's address and the BFF token, is never retried and never
 * cached. The session token comes from the httpOnly cookie and never leaves the server. Without
 * a session these send the operator to `/login` before calling anything.
 */
import 'server-only';
import { createClient, type OpenVerifyClient } from '@openverify/node';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { z } from 'zod';
import { apiBaseUrl, bffToken } from '../config';
import { getSessionToken } from '../session';
import { requestClientAddress } from './client-address';
import { LOGIN_PATH } from './errors';
import {
  API_TIMEOUT_MS,
  createBffFetch,
  sendApiRequest,
  sendApiRequestWithHeaders,
  type ApiAnswerWithHeaders,
  type ApiCall,
  type BffContext,
} from './http';

/**
 * The BFF context of this request, read once per server render. The cookie and headers are read
 * first: that makes every page that calls the API dynamic, never prerendered at build time.
 */
const requestContext = cache(async (): Promise<BffContext> => {
  const token = await getSessionToken();
  const clientAddress = await requestClientAddress();
  return { baseUrl: apiBaseUrl(), token, clientAddress, bffToken: bffToken() };
});

/** The context with a session token; without one, the operator is sent to sign in. */
async function sessionContext(): Promise<BffContext & { token: string }> {
  const context = await requestContext();
  if (context.token === null) {
    redirect(LOGIN_PATH);
  }
  return { ...context, token: context.token };
}

/** The server API client for this request's session. */
export const getApiClient = cache(async (): Promise<OpenVerifyClient> => {
  const context = await sessionContext();
  return createClient({
    apiKey: context.token,
    baseUrl: context.baseUrl,
    fetch: createBffFetch(context),
    // An operator sees a failure at once; a retried write could run twice behind a timeout.
    maxRetries: 0,
    timeoutMs: API_TIMEOUT_MS,
  });
});

/** One call to any API endpoint with this request's session. */
export async function apiRequest<Schema extends z.ZodType>(
  call: ApiCall<Schema>,
): Promise<z.output<Schema>> {
  return sendApiRequest(await sessionContext(), call);
}

/** One call to any API endpoint with this request's session, answering the headers too. */
export async function apiRequestWithHeaders<Schema extends z.ZodType>(
  call: ApiCall<Schema>,
): Promise<ApiAnswerWithHeaders<z.output<Schema>>> {
  return sendApiRequestWithHeaders(await sessionContext(), call);
}

/** One call to a dashboard route that takes no session; no token is sent even if there is one. */
export async function publicApiRequest<Schema extends z.ZodType>(
  call: ApiCall<Schema>,
): Promise<z.output<Schema>> {
  return sendApiRequest({ ...(await requestContext()), token: null }, call);
}

/** A `fetch` with this request's BFF headers, for answers streamed through as they are. */
export async function getBffFetch(): Promise<typeof fetch> {
  return createBffFetch(await requestContext());
}
