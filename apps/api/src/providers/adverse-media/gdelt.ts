/**
 * C81.2, C83: the `gdelt-doc` adapter, GDELT's DOC 2.0 API in `artlist` mode, through the outbound
 * client (JSON only, 1 MiB): the `gdeltQuery` of the request (V10), `sort=hybridrel`, at most 250
 * records (the API's maximum, H12), GDELT's rolling three-month window (the API's default).
 *
 * - **Budget** (V09). Each request first takes the asking environment's share of the shared budget
 *   (`budget.ts`); a refusal answers `wait` with the time to ask again, and no request is made.
 * - **Answer.** `{}` is no article; `articles[]` holds `url`, `title`, `seendate`
 *   (`YYYYMMDDTHHMMSSZ`, when GDELT saw it: GDELT gives no publication date, H13), `domain`,
 *   `language` and `sourcecountry` in English, mapped to ISO 639-1 and ISO 3166-1 codes through
 *   `Intl` (an unknown one is `null`). An article without an http(s) URL, a date or a title is
 *   dropped. The title is trimmed and capped at 200 characters (decision 8). A full answer (the
 *   record cap) is `truncated`.
 * - **Errors.** GDELT answers a malformed or refused query with plain text and status 200, and asks
 *   for one request per 5 s with a 429: both, a body that is not the artlist JSON and 5xx fail for
 *   a retry (`provider_error` once the retries run out); any other status fails for good. Errors
 *   never carry the query, a name or a body (C53.8).
 * - **No cache** (P03). Nothing about an article or a name is kept anywhere: every run asks again.
 *
 * Disclosure (decision 7): every query sends the screened name to GDELT, so binding needs
 * `OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true`. GDELT's terms require its citation and link.
 */
import { storedMediaTitle } from '@openverify/checks';
import { z } from 'zod';
import { OutboundHttpError, type OutboundHttp, type OutboundHttpClient } from '../../http/index.js';
import type {
  AdverseMediaArticle,
  AdverseMediaProvider,
  AdverseMediaSearchResult,
} from '../../ports.js';
import { ProviderError } from '../errors.js';
import type { GdeltBudget } from './budget.js';
import { GDELT_MAX_RECORDS, gdeltQuery } from './query.js';
import { searchEnvironmentOf, searchNamesOf } from './request.js';

/** C81.2: where the DOC 2.0 API answers. */
export const GDELT_DOC_ORIGIN = 'https://api.gdeltproject.org';

/** C76.7, C81.4: GDELT's required citation and link, served with every result that used it. */
export const GDELT_CITATION =
  'Articles found through the GDELT Project (https://www.gdeltproject.org/): titles and links only.';

/** C81.2: the adapter's response cap. */
export const GDELT_MAX_RESPONSE_BYTES = 1024 * 1024;

const articleSchema = z.object({
  url: z.string().max(2048),
  title: z.string().max(10_000),
  seendate: z.string().max(32),
  domain: z.string().max(253).optional(),
  language: z.string().max(64).optional(),
  sourcecountry: z.string().max(128).optional(),
});
const answerSchema = z.object({ articles: z.array(z.unknown()).max(10_000).optional() });

const SEEN_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u;

function seenAtOf(value: string): Date | null {
  const parts = SEEN_DATE.exec(value);
  if (parts === null) {
    return null;
  }
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/** English names (lower case) to codes, built once from `Intl` over every two-letter code. */
function reverseNames(type: 'language' | 'region', skip: RegExp | null): Map<string, string> {
  const names = new Intl.DisplayNames(['en'], { type, fallback: 'none' });
  const table = new Map<string, string>();
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const first of letters) {
    for (const second of letters) {
      const code = type === 'region' ? `${first}${second}`.toUpperCase() : `${first}${second}`;
      if (skip?.test(code) === true) {
        continue;
      }
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        name = undefined;
      }
      // The first code wins: `GB` before the reserved alias `UK`, which `Intl` names alike.
      if (
        name !== undefined &&
        name.toLowerCase() !== code.toLowerCase() &&
        !table.has(name.toLowerCase())
      ) {
        table.set(name.toLowerCase(), code);
      }
    }
  }
  return table;
}

let languages: Map<string, string> | undefined;
let regions: Map<string, string> | undefined;

/** ISO 639-1 of an English language name, as GDELT writes it, or `null`. */
export function languageCodeOf(name: string | undefined): string | null {
  languages ??= reverseNames('language', null);
  return name === undefined ? null : (languages.get(name.trim().toLowerCase()) ?? null);
}

/** ISO 3166-1 alpha-2 of an English country name, as GDELT writes it, or `null`. */
export function countryCodeOf(name: string | undefined): string | null {
  // User-assigned codes and the reserved EU, EZ, UK and UN name no country.
  regions ??= reverseNames('region', /^(?:AA|E[UZ]|Q[M-Z]|UK|UN|X[A-JL-Z]|ZZ)$/u);
  return name === undefined ? null : (regions.get(name.trim().toLowerCase()) ?? null);
}

/** One `artlist` record as the port's article, or `null` when it cannot be read. */
function articleOf(record: unknown): AdverseMediaArticle | null {
  const parsed = articleSchema.safeParse(record);
  if (!parsed.success) {
    return null;
  }
  const { url, title, seendate, domain, language, sourcecountry } = parsed.data;
  if (!URL.canParse(url)) {
    return null;
  }
  const link = new URL(url);
  const seenAt = seenAtOf(seendate);
  const stored = storedMediaTitle(title);
  if (
    (link.protocol !== 'https:' && link.protocol !== 'http:') ||
    seenAt === null ||
    stored === ''
  ) {
    return null;
  }
  return {
    url,
    domain: domain !== undefined && domain.length > 0 ? domain.toLowerCase() : link.hostname,
    seenAt,
    language: languageCodeOf(language),
    sourceCountry: countryCodeOf(sourcecountry),
    title: stored,
  };
}

const failure = (code: string, retryable: boolean) =>
  new ProviderError(`gdelt-doc: the search failed (${code})`, {
    retryable,
    code: `gdelt_${code}`,
  });

export interface GdeltDocOptions {
  /** The worker's outbound client; a call without one fails for good. */
  outboundHttp?: OutboundHttp | undefined;
  budget: GdeltBudget;
}

/** The `gdelt-doc` adapter (C81.2). Its outbound client is made on the first call. */
export function createGdeltDocProvider(options: GdeltDocOptions): AdverseMediaProvider {
  let client: OutboundHttpClient | undefined;
  return {
    id: 'gdelt-doc',
    sandbox: false,
    async search(request): Promise<AdverseMediaSearchResult> {
      if (options.outboundHttp === undefined) {
        throw failure('not_configured', false);
      }
      const query = gdeltQuery({
        names: searchNamesOf(request),
        terms: request.terms,
        country: request.country,
      });
      const decision = await options.budget.take(searchEnvironmentOf(request));
      if (!decision.granted) {
        return { outcome: 'wait', retryAt: decision.retryAt };
      }
      client ??= options.outboundHttp.client({
        name: 'gdelt-doc',
        contentTypes: ['application/json'],
        maxResponseBytes: GDELT_MAX_RESPONSE_BYTES,
      });
      const maxRecords = Math.min(GDELT_MAX_RECORDS, Math.max(1, Math.floor(request.maxRecords)));
      const parameters = new URLSearchParams({
        query,
        mode: 'artlist',
        format: 'json',
        sort: 'hybridrel',
        maxrecords: String(maxRecords),
      });
      let response;
      try {
        response = await client.request({
          method: 'GET',
          url: `${GDELT_DOC_ORIGIN}/api/v2/doc/doc?${parameters.toString()}`,
          headers: { accept: 'application/json' },
        });
      } catch (error) {
        if (error instanceof OutboundHttpError) {
          // A plain-text error answered with 200 is GDELT refusing the query for now.
          throw error.code === 'content_type'
            ? failure('error', true)
            : failure(error.code, error.retryable);
        }
        throw error;
      }
      if (response.status === 429) {
        throw failure('rate_limited', true);
      }
      if (response.status >= 500) {
        throw failure('unavailable', true);
      }
      if (response.status < 200 || response.status > 299) {
        throw failure('rejected', false);
      }
      let parsed;
      try {
        parsed = answerSchema.safeParse(JSON.parse(new TextDecoder().decode(response.body)));
      } catch {
        throw failure('malformed', true);
      }
      if (!parsed.success) {
        throw failure('malformed', true);
      }
      const records = parsed.data.articles ?? [];
      return {
        outcome: 'articles',
        articles: records.map(articleOf).filter((article) => article !== null),
        truncated: records.length >= maxRecords,
      };
    },
  };
}
