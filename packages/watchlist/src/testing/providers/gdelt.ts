/**
 * Synthetic GDELT DOC 2.0 `artlist` answers (C81.2) for the `gdelt-doc` adapter's tests against a
 * local stub: articles under reserved `.example` domains whose titles name the subject beside a
 * term, an empty answer (GDELT answers `{}` when nothing matched), an answer filling the 250-record
 * cap, GDELT's plain-text error answered with status 200, and a 429. Every title is our own
 * synthetic text; nothing is a real article.
 */
import { fictionalFamilyName, fictionalGivenName } from '../names.js';
import { seededRandom, type SeededRandom } from '../random.js';
import { jsonAnswer, textAnswer, type StubAnswer } from '../stub-answer.js';

/** The DOC API's record cap. */
export const GDELT_MAX_RECORDS = 250;
/** The sandbox token: a name containing it gets two articles (C81.5). */
export const GDELT_SANDBOX_TOKEN = 'sandbox-media';

/** One `artlist` record, as the DOC API's JSON writes it. */
export interface GdeltArticle {
  readonly url: string;
  readonly url_mobile: string;
  readonly title: string;
  /** When GDELT saw the article: `YYYYMMDDTHHMMSSZ`. */
  readonly seendate: string;
  readonly socialimage: string;
  readonly domain: string;
  readonly language: string;
  readonly sourcecountry: string;
}

export interface GdeltArticleOptions {
  /** The name the title carries; `null` for an article about someone else. */
  readonly name: string | null;
  /** A category term the title carries. */
  readonly term: string;
  readonly seen: Date;
  readonly language?: string;
  readonly sourceCountry?: string;
}

/** GDELT's `seendate`: `YYYYMMDDTHHMMSSZ` in UTC. */
const seenDate = (date: Date): string =>
  `${date.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '')}Z`;

export function gdeltArticle(random: SeededRandom, options: GdeltArticleOptions): GdeltArticle {
  const domain = `${fictionalGivenName(random).latin.toLowerCase()}-news.example`;
  const subject =
    options.name ?? `${fictionalGivenName(random).latin} ${fictionalFamilyName(random).latin}`;
  return {
    url: `https://${domain}/articles/${random.string('0123456789abcdef', 12)}`,
    url_mobile: '',
    title: `${subject} named in synthetic ${options.term} report`.slice(0, 200),
    seendate: seenDate(options.seen),
    socialimage: '',
    domain,
    language: options.language ?? 'English',
    sourcecountry: options.sourceCountry ?? 'United Kingdom',
  };
}

export function gdeltArtlistAnswer(articles: readonly GdeltArticle[]): StubAnswer {
  return jsonAnswer(200, { articles });
}

export function gdeltEmptyAnswer(): StubAnswer {
  return jsonAnswer(200, {});
}

/** 250 articles: about the subject when `matching`, else about other people. */
export function gdeltCappedAnswer(
  random: SeededRandom,
  options: {
    readonly name: string;
    readonly term: string;
    readonly seen: Date;
    readonly matching: boolean;
  },
): StubAnswer {
  return gdeltArtlistAnswer(
    Array.from({ length: GDELT_MAX_RECORDS }, () =>
      gdeltArticle(random, {
        name: options.matching ? options.name : null,
        term: options.term,
        seen: options.seen,
      }),
    ),
  );
}

export function gdeltPlainTextErrorAnswer(): StubAnswer {
  return textAnswer(
    200,
    'The query could not be run: a phrase is too short or uses an unsupported operator. (synthetic)',
  );
}

export function gdeltRateLimitedAnswer(): StubAnswer {
  return textAnswer(429, 'Too many requests: wait five seconds between requests. (synthetic)');
}

/** The answer a stub gives a query phrase: two articles when it holds the sandbox token, else none. */
export function gdeltScenarioAnswer(phrase: string, term: string, now: Date): StubAnswer {
  if (!phrase.includes(GDELT_SANDBOX_TOKEN)) {
    return gdeltEmptyAnswer();
  }
  const random = seededRandom('gdelt/sandbox');
  const daysAgo = (days: number): Date => new Date(now.getTime() - days * 86_400_000);
  return gdeltArtlistAnswer([
    gdeltArticle(random, { name: phrase, term, seen: daysAgo(1) }),
    gdeltArticle(random, { name: phrase, term, seen: daysAgo(10) }),
  ]);
}
