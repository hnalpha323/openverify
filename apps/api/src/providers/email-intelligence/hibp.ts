/**
 * C82.1, C83: the `hibp` adapter, Have I Been Pwned's API v3 `breachedaccount`, through the
 * outbound client: `GET /api/v3/breachedaccount/{address}?truncateResponse=false` with the
 * operator's `hibp-api-key` and a descriptive User-Agent (HIBP refuses a request without one).
 * The untruncated model carries each breach's `BreachDate`, which the report's recency rule
 * reads; a 404 means the address is in no breach.
 *
 * - The answer is the count and the newest breach date. A breach without a usable date makes the
 *   newest date unknown (`null` beside a count), never an older date: the report then cannot say
 *   whether a breach is recent.
 * - 401 and 403 (a refused key) fail for good; 429 and 5xx fail for a retry; any other status, a
 *   redirect or an answer that is not a list of breaches fails for good. Errors name the adapter and
 *   the failure only, never the address, the key or a body (C53.8).
 * - Terms (P16, decision 31): HIBP makes every submitted address "Subscriber Data"; the operator
 *   needs a plan whose terms allow screening its own users, and shows "Source: Have I Been Pwned"
 *   wherever breach data appears (CC BY 4.0).
 */
import { z } from 'zod';
import type { OutboundHttp, OutboundHttpClient } from '../../http/index.js';
import type { EmailIntelligenceProvider, EmailIntelligenceResult } from '../../ports.js';
import { requestJson } from '../business-registry/http.js';
import { ProviderError } from '../errors.js';

/** C82.1: where HIBP's API v3 answers. */
export const HIBP_API_ORIGIN = 'https://haveibeenpwned.com';

/** HIBP refuses a request without a User-Agent; ours names the product, never the operator. */
export const HIBP_USER_AGENT = 'OpenVerify email-address report';

/** An untruncated answer for an address in many breaches stays well under this. */
export const HIBP_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** A breach as far as the report reads it; every other member is ignored. */
const breachesSchema = z.array(z.object({ BreachDate: z.string().max(64).optional() })).max(20_000);

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** A `BreachDate` (`YYYY-MM-DD`) as UTC midnight, or `null` when it is not a calendar date. */
function breachDateOf(value: string | undefined): Date | null {
  const parts = value === undefined ? null : DATE.exec(value);
  if (parts === null) {
    return null;
  }
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

export interface HibpOptions {
  apiKey: string;
  /** The worker's outbound client; a call without one fails for good. */
  outboundHttp?: OutboundHttp | undefined;
}

/** The `hibp` adapter (C82.1). Its outbound client is made on the first call. */
export function createHibpProvider(options: HibpOptions): EmailIntelligenceProvider {
  let client: OutboundHttpClient | undefined;
  return {
    id: 'hibp',
    sandbox: false,
    async breaches({ emailAddress }): Promise<EmailIntelligenceResult> {
      if (options.outboundHttp === undefined) {
        throw new ProviderError('hibp: no outbound client', {
          retryable: false,
          code: 'hibp_not_configured',
        });
      }
      client ??= options.outboundHttp.client({
        name: 'hibp',
        contentTypes: ['application/json'],
        maxResponseBytes: HIBP_MAX_RESPONSE_BYTES,
      });
      const answer = await requestJson(
        client,
        {
          method: 'GET',
          url: `${HIBP_API_ORIGIN}/api/v3/breachedaccount/${encodeURIComponent(emailAddress)}?truncateResponse=false`,
          headers: {
            accept: 'application/json',
            'hibp-api-key': options.apiKey,
            'user-agent': HIBP_USER_AGENT,
          },
        },
        'hibp',
      );
      if (!answer.found) {
        return { breachCount: 0, latestBreachAt: null };
      }
      const parsed = breachesSchema.safeParse(answer.json);
      if (!parsed.success) {
        throw new ProviderError('hibp: the answer is not a list of breaches', {
          retryable: false,
          code: 'hibp_malformed',
        });
      }
      const dates = parsed.data.map(({ BreachDate }) => breachDateOf(BreachDate));
      const dated = dates.filter((date): date is Date => date !== null);
      return {
        breachCount: parsed.data.length,
        latestBreachAt:
          dated.length === 0 || dated.length < dates.length
            ? null
            : new Date(Math.max(...dated.map((date) => date.getTime()))),
      };
    },
  };
}
