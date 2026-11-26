/**
 * C81.3, C81.5: adverse-media relevance (H, `beta`), as pure functions over a GDELT article's
 * metadata. Name co-occurrence in a title is not identity, so a match is a link for a reviewer,
 * never a finding: its confidence is capped at 0.6.
 *
 * - **Person.** An article is relevant when its title holds one of the subject's names, whole and
 *   in order (`title_full_name`) or every token of it in any order (`title_all_tokens`), and at
 *   least one term of a template category in the title's language.
 * - **Business (H13).** The legal form is stripped (articles rarely carry it), then the title must
 *   hold the whole remaining phrase, and either the query's country (the article's source country,
 *   or the country's name in the title) or a second distinctive word in the name. A name that is a
 *   single generic word once stripped is refused at creation.
 * - **Filters.** `max-article-age-days` on `seen-date`, `allowed-countries` on the source country
 *   (an article whose country is unknown is kept: missing is not a mismatch), the template's
 *   categories.
 * - **Score (ours).** `0.5 × name + 0.3 × category weight + 0.2 × recency`, where name is 1.0 for
 *   the whole name and 0.8 for every token, and recency falls from 1.0 today to 0.5 at the age
 *   limit; the confidence is `0.6 × score`.
 */
import {
  REPORT_COVERAGE_LIMITS,
  type AdverseMediaCategory,
  type ReportCoverageLimit,
  type ReportMatchType,
} from '@openverify/core';
import { canonicalsOf, phraseEndingAt } from '../../matching/dictionaries.js';
import { capText } from '../../matching/limits.js';
import { riskConstant } from '../constants.js';
import {
  foldedWords,
  holdsPhrase,
  lexiconLanguagesOf,
  mediaCategoriesOfTitle,
  MEDIA_CATEGORY_WEIGHTS,
  type FoldedWords,
} from './lexicon.js';

/** Why an article is not a match (non-personal, for the run's counts). */
export const MEDIA_DROP_REASONS = [
  'too_old',
  'country_not_allowed',
  'language_not_covered',
  'name_not_in_title',
  'business_unconfirmed',
  'no_category_term',
] as const;
export type MediaDropReason = (typeof MEDIA_DROP_REASONS)[number];

/** What a media run states it could not cover (C78.5, C81.5), in core's order. */
export const MEDIA_COVERAGE_LIMITS = Object.freeze([
  'title_only',
  'window_90_days',
  'lexicon_languages',
] as const satisfies readonly ReportCoverageLimit[]);

/** Who is screened. */
export type MediaSubject =
  | {
      readonly kind: 'person';
      /** Every name screened (the query's and its `additional-names`), as full names. */
      readonly names: readonly string[];
    }
  | {
      readonly kind: 'business';
      /** The business name as the query gives it (`term`). */
      readonly term: string;
      /** The query's ISO 3166-1 alpha-2 `country-code`, if any. */
      readonly countryCode?: string | null | undefined;
    };

/** An article as the adapter read it: metadata only, never the body. */
export interface MediaArticle {
  readonly title: string;
  /** When GDELT saw it (GDELT gives no publication date). */
  readonly seenAt: Date;
  /** ISO 639-1, or `null` when unknown. */
  readonly language: string | null;
  /** ISO 3166-1 alpha-2, or `null` when unknown. */
  readonly sourceCountry: string | null;
}

/** The template's media configuration (C81.5). */
export interface MediaScreeningConfig {
  readonly categories: readonly AdverseMediaCategory[];
  readonly maxArticleAgeDays: number;
  /** `null`: every source country. */
  readonly allowedCountries: readonly string[] | null;
}

/** An article judged relevant, or why not. */
export type MediaRelevance =
  | {
      readonly relevant: true;
      readonly categories: readonly AdverseMediaCategory[];
      readonly matchTypes: readonly ReportMatchType[];
      readonly score: number;
      readonly confidence: number;
    }
  | { readonly relevant: false; readonly reason: MediaDropReason };

/** A business name as the media rule reads it (H13). */
export interface BusinessMediaName {
  /** The folded words with the legal form and a leading "the" stripped. */
  readonly tokens: readonly string[];
  /** The words that are not generic (Holdings, Global, Trading, ...). */
  readonly distinctive: readonly string[];
  /** `empty`: nothing left; `generic`: one generic word left; both answer 422 on creation. */
  readonly status: 'ok' | 'empty' | 'generic';
}

/** A person query's name members (the contracts' `adverseMediaQuerySchema`). */
export interface MediaPersonQuery {
  readonly 'name-first'?: string | undefined;
  readonly 'name-middle'?: string | undefined;
  readonly 'name-last'?: string | undefined;
  readonly term?: string | undefined;
  readonly 'additional-names'?:
    | readonly {
        readonly 'name-first'?: string | undefined;
        readonly 'name-middle'?: string | undefined;
        readonly 'name-last'?: string | undefined;
        readonly term?: string | undefined;
      }[]
    | undefined;
}

/** Reads a business name for the media rule. */
export function businessMediaName(term: string): BusinessMediaName {
  const { simple } = businessPhrase(term);
  const distinctive = simple.filter((word) => !GENERIC_WORDS.has(word));
  const only = simple.length === 1 ? (simple[0] ?? '') : null;
  return {
    tokens: simple,
    distinctive,
    status:
      simple.length === 0 ? 'empty' : only !== null && GENERIC_WORDS.has(only) ? 'generic' : 'ok',
  };
}

/** The subject's full names from a person query's name parts or `term`, and `additional-names`. */
export function mediaPersonNames(query: MediaPersonQuery): string[] {
  const names = [query, ...(query['additional-names'] ?? [])].map((name) => {
    const parts = [name['name-first'], name['name-middle'], name['name-last']]
      .map((part) => spaced(part ?? ''))
      .filter((part) => part !== '');
    return parts.length > 0 ? parts.join(' ') : spaced(name.term ?? '');
  });
  return [...new Set(names.filter((name) => name !== ''))];
}

/** Judges one article for a subject. */
export function screenMediaArticle(
  subject: MediaSubject,
  article: MediaArticle,
  config: MediaScreeningConfig,
  now: Date,
): MediaRelevance {
  const ageDays = Math.max(0, (now.getTime() - article.seenAt.getTime()) / DAY_MS);
  if (ageDays > config.maxArticleAgeDays) {
    return dropped('too_old');
  }
  if (
    config.allowedCountries !== null &&
    article.sourceCountry !== null &&
    !config.allowedCountries.includes(article.sourceCountry)
  ) {
    return dropped('country_not_allowed');
  }
  const title = foldedWords(article.title, riskConstant('media-title-read-length'));
  const named =
    subject.kind === 'person'
      ? personMatch(subject.names, title)
      : businessMatch(subject, article, title);
  if (typeof named === 'string') {
    return dropped(named);
  }
  if (lexiconLanguagesOf(article.language).length === 0) {
    return dropped('language_not_covered');
  }
  const categories = mediaCategoriesOfTitle(article.title, article.language, config.categories);
  if (categories.length === 0) {
    return dropped('no_category_term');
  }
  const floor = riskConstant('media-recency-floor');
  const recency = 1 - (1 - floor) * Math.min(1, ageDays / config.maxArticleAgeDays);
  const category = Math.max(...categories.map((id) => MEDIA_CATEGORY_WEIGHTS[id].value));
  const score =
    riskConstant('media-weight-name') * named.weight +
    riskConstant('media-weight-category') * category +
    riskConstant('media-weight-recency') * recency;
  return {
    relevant: true,
    categories,
    matchTypes: [named.matchType],
    score: round(score),
    confidence: round(riskConstant('media-confidence-cap') * score),
  };
}

/** The title as stored: trimmed and capped at 200 characters (C81.4, decision 8). */
export function storedMediaTitle(title: string): string {
  return capText(title.trim(), riskConstant('media-title-max-length'));
}

/** A media run's coverage: never complete, `truncated` added when the answer filled its cap. */
export function mediaCoverage(options: { truncated: boolean }): {
  complete: false;
  limits: ReportCoverageLimit[];
} {
  const limits = new Set<ReportCoverageLimit>(MEDIA_COVERAGE_LIMITS);
  if (options.truncated) {
    limits.add('truncated');
  }
  return { complete: false, limits: REPORT_COVERAGE_LIMITS.filter((limit) => limits.has(limit)) };
}

const DAY_MS = 86_400_000;
const NAME_MAX_LENGTH = 300;
const round = (value: number) => Math.round(value * 100) / 100;
const dropped = (reason: MediaDropReason): MediaRelevance => ({ relevant: false, reason });
const spaced = (text: string) =>
  text
    .split(/\s+/u)
    .filter((part) => part !== '')
    .join(' ');

interface NameMatch {
  readonly matchType: ReportMatchType;
  readonly weight: number;
}

/** The best of the subject's names in the title: whole and in order, else every word. */
function personMatch(names: readonly string[], title: FoldedWords): NameMatch | MediaDropReason {
  let best: NameMatch | null = null;
  for (const name of names) {
    const words = foldedWords(name, NAME_MAX_LENGTH);
    if (words.simple.length === 0) {
      continue;
    }
    if (holdsPhrase(title, words)) {
      return { matchType: 'title_full_name', weight: riskConstant('media-name-full') };
    }
    const every =
      words.simple.every((word) => title.simple.includes(word)) ||
      words.expanded.every((word) => title.expanded.includes(word));
    if (every) {
      best ??= { matchType: 'title_all_tokens', weight: riskConstant('media-name-all-tokens') };
    }
  }
  return best ?? 'name_not_in_title';
}

/**
 * H13: the whole stripped phrase, and the query's country (the article's source or the country's
 * name in the title) or a second distinctive word.
 */
function businessMatch(
  subject: Extract<MediaSubject, { kind: 'business' }>,
  article: MediaArticle,
  title: FoldedWords,
): NameMatch | MediaDropReason {
  const phrase = businessPhrase(subject.term);
  if (!holdsPhrase(title, phrase)) {
    return 'name_not_in_title';
  }
  const distinctive = phrase.simple.filter((word) => !GENERIC_WORDS.has(word));
  const country = subject.countryCode ?? null;
  const placed =
    country !== null &&
    (article.sourceCountry === country ||
      countryNames(country).some((name) => holdsPhrase(title, name)));
  return placed || distinctive.length >= 2
    ? { matchType: 'title_full_name', weight: riskConstant('media-name-full') }
    : 'business_unconfirmed';
}

/**
 * A business name's words without a leading "the", its legal forms (C58.6's dictionary; "bank" and
 * "group" are kept: the news names a business by them) and connecting words at either end.
 */
function businessPhrase(term: string): FoldedWords {
  const folded = foldedWords(term.replace(/[&+]/gu, ' and '), NAME_MAX_LENGTH);
  let simple = [...folded.simple];
  let expanded = [...folded.expanded];
  const cut = (start: number, end: number) => {
    simple = simple.slice(start, end);
    expanded = expanded.slice(start, end);
  };
  let run = 0;
  while (run < simple.length && simple[simple.length - 1 - run]?.length === 1) {
    run += 1;
  }
  const glued = simple.slice(-run).join('');
  if (run >= 2 && canonicalsOf('company-types', glued).length > 0) {
    simple = [...simple.slice(0, -run), glued];
    expanded = [...expanded.slice(0, -run), glued];
  }
  if (simple[0] === 'the') {
    cut(1, simple.length);
  }
  for (;;) {
    const form = phraseEndingAt('company-types', simple, simple.length);
    if (form === null || form.canonicals.some((canonical) => KEPT_FORMS.has(canonical))) {
      break;
    }
    cut(0, simple.length - form.length);
  }
  while (simple.length > 0 && CONNECTORS.has(simple[0] ?? '')) {
    cut(1, simple.length);
  }
  while (simple.length > 0 && CONNECTORS.has(simple.at(-1) ?? '')) {
    cut(0, simple.length - 1);
  }
  return { simple, expanded };
}

/** Legal-form classes the media rule keeps: the news names a business by them. */
const KEPT_FORMS: ReadonlySet<string> = new Set(['bank', 'group']);

/** Words that join a name's parts (en, es, fr, de), never distinctive. */
const CONNECTORS: ReadonlySet<string> = new Set([
  'and',
  'the',
  'of',
  'for',
  'y',
  'e',
  'et',
  'und',
  'de',
  'del',
  'la',
  'el',
  'le',
  'les',
  'des',
  'du',
  'der',
  'die',
  'das',
  'fur',
]);

/**
 * Generic business words (ours, en, es, fr, de, folded): a name made only of them says little in a
 * title, so it needs the country beside it (H13).
 */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  ...CONNECTORS,
  'group',
  'groupe',
  'grupo',
  'gruppe',
  'holding',
  'holdings',
  'international',
  'internacional',
  'internationale',
  'global',
  'globale',
  'world',
  'worldwide',
  'mundial',
  'trading',
  'trade',
  'commerce',
  'commercial',
  'comercial',
  'handel',
  'import',
  'export',
  'services',
  'service',
  'servicios',
  'dienstleistungen',
  'solutions',
  'soluciones',
  'industries',
  'industry',
  'industrias',
  'industrie',
  'enterprises',
  'enterprise',
  'empresa',
  'entreprise',
  'unternehmen',
  'capital',
  'partners',
  'partner',
  'management',
  'investments',
  'investment',
  'inversiones',
  'technologies',
  'technology',
  'tech',
  'tecnologia',
  'technologie',
  'systems',
  'sistemas',
  'consulting',
  'consultants',
  'ventures',
  'resources',
  'logistics',
  'logistica',
  'logistique',
  'logistik',
  'general',
  'national',
  'nacional',
  'nationale',
  'united',
  'consolidated',
  'associates',
  'energy',
  'energia',
  'energie',
  'finance',
  'financial',
  'finanzas',
  'bank',
  'banco',
  'banque',
  'development',
  'construction',
  'products',
  'productos',
  'network',
  'digital',
  'media',
]);

const countryNameCache = new Map<string, readonly FoldedWords[]>();

/** A country's names in the lexicon's languages, from `Intl` (never typed out), folded. */
function countryNames(code: string): readonly FoldedWords[] {
  let names = countryNameCache.get(code);
  if (names === undefined) {
    names = (['en', 'es', 'fr', 'de'] as const).flatMap((language) => {
      let name: string | undefined;
      try {
        name = new Intl.DisplayNames([language], { type: 'region' }).of(code);
      } catch {
        name = undefined;
      }
      return name === undefined || name === code ? [] : [foldedWords(name, NAME_MAX_LENGTH)];
    });
    countryNameCache.set(code, names);
  }
  return names;
}
