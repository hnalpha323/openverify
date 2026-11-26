/**
 * C81, C82.4, C83: the `adverseMedia` providers. `gdelt-doc` asks GDELT's DOC 2.0 `artlist` mode
 * in JSON for the `gdeltQuery` of the request (V10), within the shared budget (V09), here against
 * `MockAgent` with fixtures-6's synthetic answers; it keeps no article anywhere (P03). Binding it
 * needs the disclosure acknowledgement (decision 7). The sandbox calls nothing and answers two
 * synthetic articles for a name holding `sandbox-media`. Every name and article is synthetic.
 */
import {
  gdeltArticle,
  gdeltArtlistAnswer,
  gdeltCappedAnswer,
  gdeltEmptyAnswer,
  gdeltPlainTextErrorAnswer,
  gdeltRateLimitedAnswer,
  seededRandom,
  type StubAnswer,
} from '@openverify/watchlist/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAllowAllRateLimiter,
  createDenyRateLimiter,
  createInMemoryKeyValueCache,
  fixedClock,
  T0,
} from '../../test-support/fakes.js';
import type { AdverseMediaSearch, RateLimiter } from '../../ports.js';
import { createMockOutbound, type MockOutbound } from '../business-registry/testing.js';
import { ProviderError } from '../errors.js';
import {
  createAdverseMediaProvider,
  GDELT_CITATION,
  GDELT_DOC_ORIGIN,
  mediaCitationOf,
  SANDBOX_MEDIA_CITATION,
} from './index.js';
import { gdeltQuery } from './query.js';

const REQUEST: AdverseMediaSearch = {
  nameTokens: ['avery', 'quillfeather'],
  terms: ['fraud', 'money laundering'],
  maxRecords: 250,
  environmentId: 'env_one',
};
const ACKNOWLEDGED = { gdeltAcknowledged: true, hibp: null, twilioLookup: null, smarty: null };
const DAY_MS = 86_400_000;

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function gdelt(answer: StubAnswer | null, rateLimiter?: RateLimiter) {
  outbound = createMockOutbound();
  const clock = fixedClock();
  const cache = createInMemoryKeyValueCache(clock);
  if (answer !== null) {
    outbound.agent
      .get(GDELT_DOC_ORIGIN)
      .intercept({ path: (path) => path.startsWith('/api/v2/doc/doc?'), method: 'GET' })
      .reply(answer.status, answer.body, { headers: answer.headers });
  }
  return {
    outbound,
    cache,
    clock,
    provider: createAdverseMediaProvider('gdelt-doc', {
      credentials: ACKNOWLEDGED,
      outboundHttp: outbound,
      cache,
      rateLimiter: rateLimiter ?? createAllowAllRateLimiter(clock),
      clock,
    }),
  };
}

async function failureOf(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ProviderError);
  expect(String(error) + JSON.stringify(error)).not.toMatch(/avery|quillfeather/iu);
  return error as ProviderError;
}

describe('the gdelt-doc adapter (C81.2)', () => {
  it('asks artlist in JSON for the gdeltQuery of the request, 250 records, by hybrid relevance', async () => {
    const random = seededRandom('gdelt/test');
    const seen = new Date(T0.getTime() - 2 * DAY_MS);
    const article = gdeltArticle(random, { name: 'Avery Quillfeather', term: 'fraud', seen });
    const { provider, outbound: requests } = gdelt(gdeltArtlistAnswer([article]));

    const result = await provider.search({ ...REQUEST, country: 'GB' });

    expect(provider).toMatchObject({ id: 'gdelt-doc', sandbox: false });
    const url = new URL(requests.requests[0]?.request.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(`${GDELT_DOC_ORIGIN}/api/v2/doc/doc`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: gdeltQuery({ names: [REQUEST.nameTokens], terms: REQUEST.terms, country: 'GB' }),
      mode: 'artlist',
      format: 'json',
      sort: 'hybridrel',
      maxrecords: '250',
    });
    expect(result).toEqual({
      outcome: 'articles',
      truncated: false,
      articles: [
        {
          url: article.url,
          domain: article.domain,
          seenAt: new Date(`${seen.toISOString().slice(0, 19)}Z`),
          language: 'en',
          sourceCountry: 'GB',
          title: article.title,
        },
      ],
    });
    expect(requests.clients[0]).toMatchObject({
      name: 'gdelt-doc',
      contentTypes: ['application/json'],
      maxResponseBytes: 1024 * 1024,
    });
  });

  it('screens every name of the request in one query', async () => {
    const { provider, outbound: requests } = gdelt(gdeltEmptyAnswer());
    const names = [REQUEST.nameTokens, ['avy', 'quill']];

    const request: AdverseMediaSearch = { ...REQUEST, names };
    await provider.search(request);

    expect(new URL(requests.requests[0]?.request.url ?? '').searchParams.get('query')).toBe(
      gdeltQuery({ names, terms: REQUEST.terms }),
    );
  });

  it('reads an empty answer as no article, and a full one as truncated', async () => {
    await expect(gdelt(gdeltEmptyAnswer()).provider.search(REQUEST)).resolves.toEqual({
      outcome: 'articles',
      articles: [],
      truncated: false,
    });
    await outbound?.close();
    const capped = gdeltCappedAnswer(seededRandom('gdelt/capped'), {
      name: 'Someone Else',
      term: 'fraud',
      seen: T0,
      matching: false,
    });
    const result = await gdelt(capped).provider.search(REQUEST);
    expect(result).toMatchObject({ outcome: 'articles', truncated: true });
    expect(result.outcome === 'articles' ? result.articles.length : 0).toBe(250);
  });

  it('caps a title at 200 characters, and reads an unknown language or country as unknown', async () => {
    const article = {
      ...gdeltArticle(seededRandom('gdelt/long'), {
        name: 'Avery Quillfeather',
        term: 'fraud',
        seen: T0,
      }),
      title: `Avery Quillfeather ${'fraud '.repeat(60)}`,
      language: 'Synthetic Tongue',
      sourcecountry: 'Nowhere Land',
    };

    const result = await gdelt(gdeltArtlistAnswer([article])).provider.search(REQUEST);

    expect(result.outcome === 'articles' ? result.articles[0] : null).toMatchObject({
      language: null,
      sourceCountry: null,
    });
    expect(result.outcome === 'articles' ? result.articles[0]?.title.length : 0).toBe(200);
  });

  it('drops an article it cannot read, and keeps the others', async () => {
    const random = seededRandom('gdelt/broken');
    const good = gdeltArticle(random, { name: 'Avery Quillfeather', term: 'fraud', seen: T0 });
    const broken = [
      { ...good, url: 'javascript:alert(1)' },
      { ...good, seendate: 'yesterday' },
      { ...good, title: '   ' },
    ];

    const result = await gdelt(gdeltArtlistAnswer([...broken, good])).provider.search(REQUEST);

    expect(result.outcome === 'articles' ? result.articles.map(({ url }) => url) : []).toEqual([
      good.url,
    ]);
  });

  it('fails GDELT’s plain-text error and a 429 for a retry, without the subject', async () => {
    expect(
      await failureOf(gdelt(gdeltPlainTextErrorAnswer()).provider.search(REQUEST)),
    ).toMatchObject({ retryable: true, code: 'gdelt_error' });
    await outbound?.close();
    expect(await failureOf(gdelt(gdeltRateLimitedAnswer()).provider.search(REQUEST))).toMatchObject(
      {
        retryable: true,
        code: 'gdelt_rate_limited',
      },
    );
    await outbound?.close();
    expect(
      await failureOf(gdelt({ status: 502, headers: {}, body: '' }).provider.search(REQUEST)),
    ).toMatchObject({ retryable: true, code: 'gdelt_unavailable' });
    await outbound?.close();
    expect(
      await failureOf(
        gdelt({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"articles":',
        }).provider.search(REQUEST),
      ),
    ).toMatchObject({ retryable: true, code: 'gdelt_malformed' });
  });

  it('waits, asking nothing, when the shared budget refuses', async () => {
    const clock = fixedClock();
    const { provider, outbound: requests } = gdelt(null, createDenyRateLimiter(7, clock));

    const result = await provider.search(REQUEST);

    expect(result.outcome).toBe('wait');
    expect(result.outcome === 'wait' ? result.retryAt.getTime() : 0).toBeGreaterThanOrEqual(
      T0.getTime() + 7_000,
    );
    expect(requests.requests).toEqual([]);
  });

  it('keeps no article and no name in Valkey: only the budget’s ids and times (P03)', async () => {
    const random = seededRandom('gdelt/scan');
    const article = gdeltArticle(random, { name: 'Avery Quillfeather', term: 'fraud', seen: T0 });
    const { provider, cache } = gdelt(gdeltArtlistAnswer([article]));

    await provider.search(REQUEST);

    const kept = [
      ...cache.keys(),
      ...(await Promise.all(
        cache
          .keys()
          .map(
            async (key) => (await cache.get(key)) ?? (await cache.listRange(key, 600)).join('\n'),
          ),
      )),
    ].join('\n');
    expect(kept).not.toMatch(/avery|quillfeather|fraud|news\.example/iu);
  });

  it('is never bound without the disclosure acknowledgement, naming the variable', () => {
    expect(() =>
      createAdverseMediaProvider('gdelt-doc', {
        credentials: { ...ACKNOWLEDGED, gdeltAcknowledged: false },
      }),
    ).toThrow(/^gdelt-doc needs OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE=true \(decision 7\)$/u);
    expect(() => createAdverseMediaProvider('gdelt-doc')).toThrow(
      /OPENVERIFY_GDELT_ACKNOWLEDGE_DISCLOSURE/u,
    );
  });

  it('cites GDELT, as its terms require', () => {
    expect(GDELT_CITATION).toContain('https://www.gdeltproject.org/');
    expect(mediaCitationOf('gdelt-doc')).toBe(GDELT_CITATION);
    expect(mediaCitationOf('sandbox')).toBe(SANDBOX_MEDIA_CITATION);
    expect(mediaCitationOf('another')).toBeNull();
  });
});

describe('the sandbox adverse media provider (C81.5, C82.4)', () => {
  const clock = fixedClock();
  const rateLimiter = createAllowAllRateLimiter(clock);
  const provider = createAdverseMediaProvider('sandbox', { clock, rateLimiter });

  it('answers two synthetic articles for a name holding sandbox-media, asking no budget', async () => {
    const result = await provider.search({
      ...REQUEST,
      nameTokens: ['avery', 'sandbox', 'media', 'quill'],
    });

    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(result).toMatchObject({ outcome: 'articles', truncated: false });
    const articles = result.outcome === 'articles' ? result.articles : [];
    expect(articles).toHaveLength(2);
    for (const article of articles) {
      expect(article.domain).toMatch(/\.example$/u);
      expect(new URL(article.url).hostname).toBe(article.domain);
      expect(article.title).toContain('avery sandbox media quill');
      expect(article.title).toContain('fraud');
      expect(article.language).toBe('en');
    }
    expect(articles.map(({ seenAt }) => seenAt)).toEqual([
      new Date(T0.getTime() - DAY_MS),
      new Date(T0.getTime() - 10 * DAY_MS),
    ]);
    expect(rateLimiter.calls).toEqual([]);
  });

  it('finds the token in any screened name, joined or split', async () => {
    const request: AdverseMediaSearch = {
      ...REQUEST,
      names: [REQUEST.nameTokens, ['kim', 'sandboxmedia']],
    };
    const joined = await provider.search(request);

    expect(joined.outcome === 'articles' ? joined.articles.length : 0).toBe(2);
  });

  it('answers no article for any other name', async () => {
    await expect(provider.search(REQUEST)).resolves.toEqual({
      outcome: 'articles',
      articles: [],
      truncated: false,
    });
  });
});
