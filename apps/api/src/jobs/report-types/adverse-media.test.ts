/**
 * C81: the `adverse-media` report job. Its whole answer needs the `adverseMedia` provider, so
 * without one it errors `provider_not_configured`. With one it asks once for every screened name
 * (the query's and its `additional-names`) and the template's category terms, within the shared
 * budget (a refusal is a wait, never a failure, until it has waited 24 h), asks again with the
 * country when the answer filled its cap, keeps the articles the relevance rule finds as matches
 * (sealed snapshots in the public article shape), and states its coverage; a truncated search with
 * no match errors `result_truncated`. Every name and article is synthetic.
 */
import { readFileSync } from 'node:fs';
import { adverseMediaReportResourceSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  createAdverseMediaProvider,
  SANDBOX_MEDIA_CITATION,
} from '../../providers/adverse-media/index.js';
import { ProviderError } from '../../providers/errors.js';
import type {
  AdverseMediaArticle,
  AdverseMediaProvider,
  AdverseMediaSearch,
  AdverseMediaSearchResult,
} from '../../ports.js';
import { fixedClock } from '../../test-support/fakes.js';
import { adverseMediaReportJob } from './adverse-media.js';
import type { FoundReportMatch, ReportRunResult, RunOutcome } from './job.js';
import { UNDETERMINED_LANGUAGE } from './media-screening.js';
import {
  REPORT_NOW,
  reportContext,
  servedReport,
  type ReportContextOptions,
} from './provider-testing.js';

const DAY_MS = 86_400_000;
const PERSON = { 'name-first': 'Avery', 'name-last': 'Quillfeather' };
const MEDIA_LIMITS = ['title_only', 'window_90_days', 'lexicon_languages'];

/** The article a match's snapshot holds in its served shape. */
const entityOf = (match: FoundReportMatch) =>
  match.snapshot.entity as Record<string, unknown> & { url: string; confidence: number };

function completed(outcome: RunOutcome): ReportRunResult {
  if (outcome.kind !== 'completed') {
    throw new Error('the run did not complete');
  }
  return outcome.result;
}

function article(overrides: Partial<AdverseMediaArticle> = {}): AdverseMediaArticle {
  return {
    url: 'https://synthetic-news.example/articles/1',
    domain: 'synthetic-news.example',
    seenAt: new Date(REPORT_NOW.getTime() - 2 * DAY_MS),
    language: 'en',
    sourceCountry: 'GB',
    title: 'Avery Quillfeather charged in synthetic fraud case',
    ...overrides,
  };
}

/** A provider answering each search from `answers`, in turn, and recording the requests. */
function scripted(
  ...answers: (AdverseMediaSearchResult | Error)[]
): AdverseMediaProvider & { requests: AdverseMediaSearch[] } {
  const requests: AdverseMediaSearch[] = [];
  return {
    requests,
    id: 'gdelt-doc',
    sandbox: false,
    search(request: AdverseMediaSearch) {
      requests.push(request);
      const answer = answers.shift() ?? { outcome: 'articles', articles: [], truncated: false };
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
}

const full = (articles: AdverseMediaArticle[] = []): AdverseMediaSearchResult => ({
  outcome: 'articles',
  articles,
  truncated: true,
});
const found = (articles: AdverseMediaArticle[]): AdverseMediaSearchResult => ({
  outcome: 'articles',
  articles,
  truncated: false,
});

function context(
  query: Record<string, unknown>,
  options: Omit<ReportContextOptions, 'type' | 'query'> = {},
) {
  return reportContext({ type: 'adverse-media', query, environmentKind: 'production', ...options });
}

function served(ctx: ReturnType<typeof context>, result: ReportRunResult) {
  const parsed = adverseMediaReportResourceSchema.safeParse(servedReport(ctx, result));
  expect(parsed.error?.issues ?? []).toEqual([]);
}

describe('the adverse-media report (C81)', () => {
  it('errors provider_not_configured without a provider, stating its coverage', async () => {
    const ctx = context(PERSON);
    const result = completed(await adverseMediaReportJob.run(ctx));

    expect(result.errors).toEqual([{ code: 'provider_not_configured' }]);
    expect(result.coverage).toEqual({ complete: false, limits: MEDIA_LIMITS });
    expect(result.notices).toEqual(['media_coverage_limited']);
    expect(result.matches).toEqual([]);
    served(ctx, result);
  });

  it('finds the sandbox’s two articles for a name holding sandbox-media, as matches', async () => {
    const ctx = context(
      { 'name-first': 'Avery', 'name-middle': 'sandbox-media', 'name-last': 'Quill' },
      {
        environmentKind: 'sandbox',
        providers: {
          adverseMedia: createAdverseMediaProvider('sandbox', { clock: fixedClock(REPORT_NOW) }),
        },
      },
    );
    const result = completed(await adverseMediaReportJob.run(ctx));

    expect(result.errors).toEqual([]);
    expect(result.matches).toHaveLength(2);
    expect(result.provider).toEqual({ id: 'sandbox', sandbox: true });
    expect(result.result).toEqual({ citation: SANDBOX_MEDIA_CITATION });
    for (const match of result.matches) {
      expect(match.sourceId).toBeNull();
      expect(match.riskDataHash).toBeNull();
      expect(match.entryKey).toMatch(/^article:[0-9a-f]{32}$/u);
      expect(match.contentHash).toMatch(/^[0-9a-f]{64}$/u);
      // The article in its served shape, without the match id and score the framework adds.
      expect(entityOf(match)).toMatchObject({
        'entity-id': match.entryKey,
        language: 'en',
        'match-types': ['title_full_name'],
      });
      expect(entityOf(match)).not.toHaveProperty('match-id');
      expect(entityOf(match)).not.toHaveProperty('score');
      expect(entityOf(match).confidence).toBeLessThanOrEqual(0.6);
      expect(match.snapshot).toMatchObject({ 'match-types': ['title_full_name'], qualifiers: [] });
    }
    served(ctx, result);
  });

  it('answers ready without a match when no title names the subject', async () => {
    const ctx = context(PERSON, {
      environmentKind: 'sandbox',
      providers: {
        adverseMedia: createAdverseMediaProvider('sandbox', { clock: fixedClock(REPORT_NOW) }),
      },
    });
    const result = completed(await adverseMediaReportJob.run(ctx));

    expect(result.errors).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.coverage).toEqual({ complete: false, limits: MEDIA_LIMITS });
  });

  it('asks once for every screened name and the template’s category terms, for its environment', async () => {
    const provider = scripted(found([]));
    const ctx = context(
      { ...PERSON, 'additional-names': [{ term: 'Avy Quill' }] },
      { providers: { adverseMedia: provider }, config: { categories: ['fraud', 'corruption'] } },
    );

    await adverseMediaReportJob.run(ctx);

    expect(provider.requests).toEqual([
      expect.objectContaining({
        nameTokens: ['avery', 'quillfeather'],
        names: [
          ['avery', 'quillfeather'],
          ['avy', 'quill'],
        ],
        terms: ['fraud', 'scam', 'corruption', 'bribery'],
        maxRecords: 250,
        environmentId: ctx.report.environmentId,
      }),
    ]);
    expect(provider.requests[0]?.country).toBeUndefined();
  });

  it('keeps the relevant articles only, as the template filters them', async () => {
    const provider = scripted(
      found([
        article(),
        article({
          url: 'https://synthetic-news.example/old',
          seenAt: new Date(REPORT_NOW.getTime() - 40 * DAY_MS),
        }),
        article({
          url: 'https://synthetic-news.example/other',
          title: 'Someone Else charged in fraud case',
        }),
        article({ url: 'https://synthetic-news.example/fr', sourceCountry: 'FR' }),
      ]),
    );
    const ctx = context(PERSON, {
      providers: { adverseMedia: provider },
      config: { 'max-article-age-days': 30, 'allowed-countries': ['GB'] },
    });
    const result = completed(await adverseMediaReportJob.run(ctx));

    expect(result.matches.map((match) => entityOf(match).url)).toEqual([article().url]);
    expect(result.matches[0]?.matchedName).toBe(article().title);
    served(ctx, result);
  });

  it('asks again with the country when the answer filled its cap, and is then complete', async () => {
    const provider = scripted(full([]), found([article()]));
    const ctx = context(
      { ...PERSON, 'country-code': 'GB' },
      { providers: { adverseMedia: provider } },
    );
    const result = completed(await adverseMediaReportJob.run(ctx));

    expect(provider.requests.map(({ country }) => country)).toEqual([undefined, 'GB']);
    expect(result.errors).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.coverage?.limits).not.toContain('truncated');
  });

  it('errors result_truncated when a full answer found nothing, never "no match"', async () => {
    const noCountry = context(PERSON, { providers: { adverseMedia: scripted(full([])) } });
    const truncated = completed(await adverseMediaReportJob.run(noCountry));
    expect(truncated.errors).toEqual([{ code: 'result_truncated' }]);
    expect(truncated.coverage?.limits).toContain('truncated');
    served(noCountry, truncated);

    // A country re-query that also fills the cap leaves the search truncated.
    const both = context(
      { ...PERSON, 'country-code': 'GB' },
      { providers: { adverseMedia: scripted(full([]), full([])) } },
    );
    expect(completed(await adverseMediaReportJob.run(both)).errors).toEqual([
      { code: 'result_truncated' },
    ]);

    // An empty country re-query cannot tell a quiet country from a filter GDELT did not know.
    const empty = context(
      { ...PERSON, 'country-code': 'GB' },
      { providers: { adverseMedia: scripted(full([]), found([])) } },
    );
    expect(completed(await adverseMediaReportJob.run(empty)).errors).toEqual([
      { code: 'result_truncated' },
    ]);
  });

  it('keeps a match found in a truncated answer, saying it was cut short', async () => {
    const ctx = context(PERSON, { providers: { adverseMedia: scripted(full([article()])) } });
    const result = completed(await adverseMediaReportJob.run(ctx));

    expect(result.errors).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.coverage?.limits).toContain('truncated');
  });

  it('waits for the shared budget, and errors provider_error once it has waited 24 h', async () => {
    const retryAt = new Date(REPORT_NOW.getTime() + 7_000);
    await expect(
      adverseMediaReportJob.run(
        context(PERSON, { providers: { adverseMedia: scripted({ outcome: 'wait', retryAt }) } }),
      ),
    ).resolves.toEqual({ kind: 'wait', notBefore: retryAt });

    const ctx = context(PERSON, {
      providers: { adverseMedia: scripted({ outcome: 'wait', retryAt }) },
      runCreatedAt: new Date(REPORT_NOW.getTime() - 24 * 3_600_000),
    });
    const result = completed(await adverseMediaReportJob.run(ctx));
    expect(result.errors).toEqual([{ code: 'provider_error' }]);
    served(ctx, result);
  });

  it('retries a provider failure while attempts remain, then errors provider_error', async () => {
    const failure = () =>
      new ProviderError('gdelt-doc: the search failed (error)', {
        retryable: true,
        code: 'gdelt_error',
      });
    await expect(
      adverseMediaReportJob.run(
        context(PERSON, { providers: { adverseMedia: scripted(failure()) } }),
      ),
    ).rejects.toThrow(ProviderError);

    const ctx = context(PERSON, { providers: { adverseMedia: scripted(failure()) }, attempt: 5 });
    const result = completed(await adverseMediaReportJob.run(ctx));
    expect(result.errors).toEqual([{ code: 'provider_error' }]);
  });

  it('errors a query that is not the type’s with insufficient_input, asking nothing', async () => {
    const provider = scripted();
    const ctx = context({}, { providers: { adverseMedia: provider } });
    const result = completed(await adverseMediaReportJob.run(ctx));

    expect(result.errors).toEqual([{ code: 'insufficient_input' }]);
    expect(provider.requests).toEqual([]);
    served(ctx, result);
  });

  it('keys an article by its URL: the same article gives the same key and hash', async () => {
    const first = completed(
      await adverseMediaReportJob.run(
        context(PERSON, { providers: { adverseMedia: scripted(found([article()])) } }),
      ),
    );
    const again = completed(
      await adverseMediaReportJob.run(
        context(PERSON, { providers: { adverseMedia: scripted(found([article()])) } }),
      ),
    );

    expect(again.matches[0]?.entryKey).toBe(first.matches[0]?.entryKey);
    expect(again.matches[0]?.contentHash).toBe(first.matches[0]?.contentHash);
  });
});

describe('the media pages state the undetermined language (K6A-10, owner decision 5 (f))', () => {
  const page = (name: string) =>
    readFileSync(new URL(`../../../../../docs/reports/${name}`, import.meta.url), 'utf8');

  it.each(['adverse-media.md', 'business-adverse-media.md'])(
    'says in %s that an article whose language GDELT does not name is served as und',
    (name) => {
      expect(UNDETERMINED_LANGUAGE).toBe('und');
      const text = page(name);
      expect(text).toContain(`\`${UNDETERMINED_LANGUAGE}\``);
      expect(text).toMatch(/language GDELT does not name/u);
    },
  );
});
