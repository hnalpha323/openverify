/**
 * C81: the screening both media jobs run (`adverse-media`, `business-adverse-media`).
 *
 * - **No provider** (C69.4): the whole answer needs `adverseMedia`, so the run errors
 *   `provider_not_configured`.
 * - **The names** (C81.2, V10): every screened name (the query's and its `additional-names`), or
 *   the business name without its legal form (H13), reduced to letters and digits by
 *   `gdeltNameTokens`; the adapter builds the query from them with `gdeltQuery` alone. A name with
 *   no word left, or a business name that is one generic word once stripped, errors
 *   `insufficient_input` and asks nothing.
 * - **One search** for every name and the template's category terms (`mediaQueryTerms`), within the
 *   asking environment's share of the GDELT budget (V09). A refusal is a wait (`not_before` at the
 *   budget's retry time) until the run has waited 24 h, measured from its id's time, then the run
 *   errors `provider_error`.
 * - **Truncation** (H12): an answer that fills the 250 records is asked again once with
 *   `sourcecountry:` when the query names a country; it stays truncated when the re-query is
 *   full too or empty (an empty one cannot tell a quiet country from a country GDELT did not
 *   know). A truncated search that found no match errors `result_truncated`, never "no match".
 * - **Relevance** (C81.3) is risk-logic's `screenMediaArticle`, per article; a relevant article
 *   is a match keyed by its URL, its snapshot the public article shape (C81.4: URL, domain, seen
 *   date, language, source country, the title capped at 200 characters; never a body, image or
 *   snippet), its confidence capped at 0.6 (H).
 * - **No cache** (P03): nothing about an article or a name is kept anywhere but the sealed result.
 */
import { createHash } from 'node:crypto';
import {
  businessMediaName,
  mediaCoverage,
  mediaPersonNames,
  mediaQueryTerms,
  screenMediaArticle,
  storedMediaTitle,
  type MediaSubject,
} from '@openverify/checks';
import {
  adverseMediaQuerySchema,
  businessAdverseMediaQuerySchema,
  ulidTime,
} from '@openverify/contracts';
import { ADVERSE_MEDIA_CATEGORIES, type AdverseMediaCategory } from '@openverify/core';
import {
  GDELT_MAX_RECORDS,
  gdeltNameTokens,
  mediaCitationOf,
} from '../../providers/adverse-media/index.js';
import type { AdverseMediaArticle, AdverseMediaProvider, AdverseMediaSearch } from '../../ports.js';
import type { FoundReportMatch, ReportRunContext, ReportRunResult, RunOutcome } from './job.js';
import { erroredResult, recordedFailure } from './provider-reports.js';

/** Who a media report screens. */
export type MediaReportSubject = 'person' | 'business';

/** C81.2: a run that has waited this long for the budget errors `provider_error`. */
export const MEDIA_MAX_WAIT_MS = 24 * 3_600_000;

/** The served article's language when GDELT names none (ISO 639-2 `und`, undetermined). */
export const UNDETERMINED_LANGUAGE = 'und';

/** C81.5 (H13): the notice every media result carries. */
const NOTICES = ['media_coverage_limited'] as const;

interface Screened {
  subject: MediaSubject;
  /** Each screened name's query tokens, the first the port's phrase. */
  names: string[][];
  country: string | undefined;
}

/**
 * C81.2, C81.3 (H13): why a media query cannot be screened, for report creation's 422
 * `report_query_invalid`: `invalid` (not the type's query), `empty` (no name word left once
 * reduced to letters and digits) or `generic` (a business name that is one generic word once its
 * legal form is stripped); `null` when it can be. A run errors `insufficient_input` for the same.
 */
export function mediaQueryProblem(
  subject: MediaReportSubject,
  query: Readonly<Record<string, unknown>>,
): 'invalid' | 'empty' | 'generic' | null {
  const screened = screenedOf(subject, query);
  return typeof screened === 'string' ? screened : null;
}

/** What the screening reads from a query, or why it cannot screen it (see the file header). */
function screenedOf(
  subject: MediaReportSubject,
  query: Readonly<Record<string, unknown>>,
): Screened | 'invalid' | 'empty' | 'generic' {
  if (subject === 'business') {
    const parsed = businessAdverseMediaQuerySchema.safeParse(query);
    if (!parsed.success) {
      return 'invalid';
    }
    const name = businessMediaName(parsed.data.term);
    if (name.status !== 'ok') {
      return name.status;
    }
    const tokens = gdeltNameTokens(name.tokens.join(' '));
    return tokens.length === 0
      ? 'empty'
      : {
          subject: {
            kind: 'business',
            term: parsed.data.term,
            countryCode: parsed.data['country-code'] ?? null,
          },
          names: [tokens],
          country: parsed.data['country-code'],
        };
  }
  const parsed = adverseMediaQuerySchema.safeParse(query);
  if (!parsed.success) {
    return 'invalid';
  }
  const fullNames = mediaPersonNames(parsed.data);
  const names = fullNames.map(gdeltNameTokens).filter((tokens) => tokens.length > 0);
  return names.length === 0
    ? 'empty'
    : {
        subject: { kind: 'person', names: fullNames },
        names,
        country: parsed.data['country-code'],
      };
}

/** The template's media configuration, as risk-logic reads it. */
function screeningConfig(config: Readonly<Record<string, unknown>>) {
  const categories = Array.isArray(config.categories)
    ? config.categories.filter((id): id is AdverseMediaCategory =>
        (ADVERSE_MEDIA_CATEGORIES as readonly unknown[]).includes(id),
      )
    : [...ADVERSE_MEDIA_CATEGORIES];
  const maxAge = config['max-article-age-days'];
  const allowed = config['allowed-countries'];
  return {
    categories,
    maxArticleAgeDays: typeof maxAge === 'number' ? maxAge : 90,
    allowedCountries: Array.isArray(allowed)
      ? allowed.filter((code): code is string => typeof code === 'string')
      : null,
  };
}

/** C75.3: an article's key (the dismiss `entity-id`) and content hash, from its URL and title. */
function articleKey(url: string): string {
  const digest = createHash('sha256').update(`openverify/media-article/v1\u0000${url}`, 'utf8');
  return `article:${digest.digest('hex').slice(0, 32)}`;
}

function articleHash(url: string, title: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['openverify/media-article-content/v1', url, title]), 'utf8')
    .digest('hex');
}

/** Whether an article can be served in the public shape (an http(s) URL, a domain). */
function servable(article: AdverseMediaArticle): boolean {
  if (article.url.length > 2048 || article.domain.length === 0 || article.domain.length > 253) {
    return false;
  }
  try {
    const { protocol } = new URL(article.url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function matchesOf(
  ctx: ReportRunContext,
  screened: Screened,
  articles: readonly AdverseMediaArticle[],
): FoundReportMatch[] {
  const config = screeningConfig(ctx.report.config);
  const now = ctx.deps.clock.now();
  const found = new Map<string, FoundReportMatch>();
  for (const article of articles) {
    const title = storedMediaTitle(article.title);
    if (title === '' || !servable(article)) {
      continue;
    }
    const relevance = screenMediaArticle(
      screened.subject,
      {
        title: article.title,
        seenAt: article.seenAt,
        language: article.language,
        sourceCountry: article.sourceCountry,
      },
      config,
      now,
    );
    const key = articleKey(article.url);
    if (!relevance.relevant || found.has(key)) {
      continue;
    }
    found.set(key, {
      sourceId: null,
      entryKey: key,
      contentHash: articleHash(article.url, title),
      riskDataHash: null,
      matchedName: title,
      score: relevance.score,
      snapshot: {
        entity: {
          'entity-id': key,
          url: article.url,
          domain: article.domain,
          'seen-date': article.seenAt.toISOString(),
          language: article.language ?? UNDETERMINED_LANGUAGE,
          'source-country': article.sourceCountry,
          title,
          categories: [...relevance.categories],
          'match-types': [...relevance.matchTypes],
          confidence: relevance.confidence,
        },
        'match-types': [...relevance.matchTypes],
        qualifiers: [],
        components: {
          'subject-name': null,
          'list-name': title,
          'name-level': null,
          methods: [],
          preset: null,
          'min-score': null,
        },
      },
    });
  }
  return [...found.values()];
}

/** Whether the run has waited for the budget as long as it may (from its id's time). */
function waitedTooLong(ctx: ReportRunContext): boolean {
  const created = ulidTime(ctx.run.id.slice(ctx.run.id.indexOf('_') + 1));
  return ctx.deps.clock.now().getTime() - created >= MEDIA_MAX_WAIT_MS;
}

interface Search {
  kind: 'articles';
  articles: readonly AdverseMediaArticle[];
  truncated: boolean;
}

/** One search: its articles, a wait, or a failure recorded on the last attempt. */
async function search(
  ctx: ReportRunContext,
  provider: AdverseMediaProvider,
  request: AdverseMediaSearch,
): Promise<Search | { kind: 'wait'; retryAt: Date } | { kind: 'error' }> {
  try {
    const answer = await provider.search(request);
    return answer.outcome === 'wait'
      ? { kind: 'wait', retryAt: answer.retryAt }
      : { kind: 'articles', articles: answer.articles, truncated: answer.truncated };
  } catch (error) {
    return recordedFailure(ctx, error);
  }
}

/** Runs the screening of a media report (see the file header). */
export async function runMediaScreening(
  ctx: ReportRunContext,
  subject: MediaReportSubject,
): Promise<RunOutcome> {
  const coverage = (truncated: boolean) => mediaCoverage({ truncated });
  const base: Partial<ReportRunResult> = { coverage: coverage(false), notices: NOTICES };
  const screened = screenedOf(subject, ctx.report.query);
  if (typeof screened === 'string') {
    return { kind: 'completed', result: erroredResult('insufficient_input', base) };
  }
  const provider = ctx.providers.adverseMedia;
  if (provider === undefined) {
    return { kind: 'completed', result: erroredResult('provider_not_configured', base) };
  }
  const identity = { id: provider.id, sandbox: provider.sandbox };
  const config = screeningConfig(ctx.report.config);
  const request: AdverseMediaSearch = {
    nameTokens: screened.names[0] ?? [],
    names: screened.names,
    terms: mediaQueryTerms(config.categories),
    maxRecords: GDELT_MAX_RECORDS,
    environmentId: ctx.report.environmentId,
    signal: ctx.signal,
  };
  const failed = (answer: { kind: 'wait'; retryAt: Date } | { kind: 'error' }): RunOutcome =>
    answer.kind === 'wait' && !waitedTooLong(ctx)
      ? { kind: 'wait', notBefore: answer.retryAt }
      : {
          kind: 'completed',
          result: erroredResult('provider_error', { ...base, provider: identity }),
        };
  const first = await search(ctx, provider, request);
  if (first.kind !== 'articles') {
    return failed(first);
  }
  let articles = [...first.articles];
  let truncated = first.truncated;
  if (truncated && screened.country !== undefined) {
    const again = await search(ctx, provider, { ...request, country: screened.country });
    if (again.kind !== 'articles') {
      return failed(again);
    }
    articles = [...articles, ...again.articles];
    truncated = again.truncated || again.articles.length === 0;
  }
  const matches = matchesOf(ctx, screened, articles);
  return {
    kind: 'completed',
    result: {
      errors: truncated && matches.length === 0 ? [{ code: 'result_truncated' }] : [],
      sources: [],
      coverage: coverage(truncated),
      result: { citation: mediaCitationOf(provider.id) },
      unavailableFields: [],
      provider: identity,
      thresholds: {
        'max-article-age-days': config.maxArticleAgeDays,
        'max-records': GDELT_MAX_RECORDS,
      },
      notices: NOTICES,
      matcherVersion: null,
      matches,
    },
  };
}
