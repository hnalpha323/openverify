/**
 * C54.6, C61.2, C61.4: one JSON request of a KYB client through the outbound HTTP client, and what
 * its answer means to the job. A 404 is "not found"; 429 and 5xx a failure a retry may cure; a
 * redirect is returned by the outbound client and never followed, so it is a refusal; any other
 * status, a body that is not JSON, or a failure of the outbound client is a `ProviderError` whose
 * code names the client and the failure, never a URL, a query, a credential or a body (C53.8).
 */
import {
  OutboundHttpError,
  type OutboundHttpClient,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
} from '../../http/index.js';
import { ProviderError } from '../errors.js';

/** A JSON answer with the allowlisted headers it carried (Workflow 5C review K5), or a 404. */
export type JsonAnswer =
  { found: true; json: unknown; headers?: OutboundHttpResponse['headers'] } | { found: false };

/** The failure of a status other than 2xx and 404. */
function statusFailure(status: number, name: string): ProviderError {
  const fail = (what: string, retryable: boolean) =>
    new ProviderError(`${name}: the register answered ${String(status)}`, {
      retryable,
      code: `${name}_${what}`,
    });
  if (status >= 300 && status < 400) {
    // C54.6: a redirect is returned, never followed, so a credential never follows one.
    return fail('redirect', false);
  }
  if (status === 429) {
    return fail('rate_limited', true);
  }
  if (status >= 500) {
    return fail('unavailable', true);
  }
  return status === 401 || status === 403 ? fail('unauthorized', false) : fail('rejected', false);
}

/** Asks `client` for `request`; `name` prefixes every failure code (`gleif_timeout`). */
export async function requestJson(
  client: OutboundHttpClient,
  request: OutboundHttpRequest,
  name: string,
): Promise<JsonAnswer> {
  let response;
  try {
    response = await client.request(request);
  } catch (error) {
    if (error instanceof OutboundHttpError) {
      throw new ProviderError(`${name}: the request failed (${error.code})`, {
        retryable: error.retryable,
        code: `${name}_${error.code}`,
      });
    }
    throw error;
  }
  if (response.status === 404) {
    return { found: false };
  }
  if (response.status < 200 || response.status > 299) {
    throw statusFailure(response.status, name);
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(response.body)) as unknown;
  } catch {
    throw new ProviderError(`${name}: the answer is not JSON`, {
      retryable: false,
      code: `${name}_malformed`,
    });
  }
  return response.headers === undefined
    ? { found: true, json }
    : { found: true, json, headers: response.headers };
}
