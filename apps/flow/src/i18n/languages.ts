/**
 * C161.1, C161.2 (decision 30): the flow's built-in languages and how one is chosen. Catalogs are
 * chosen by base language; `Intl` formats with the full tag the person's browser or link asked
 * for (`intl-locale.ts`).
 */
export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'ar'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

export function isSupportedLanguage(value: string | undefined): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly (string | undefined)[]).includes(value);
}

/** The language chosen for the catalogs, and the full tag `Intl` formats with. */
export interface LanguageChoice {
  readonly language: SupportedLanguage;
  readonly locale: string;
}

export interface NegotiateOptions {
  /** The languages that may be chosen (a version's `enabled-locales`); all built-in ones when absent. */
  readonly available?: readonly SupportedLanguage[];
  /** The language when no candidate matches (a version's `default-locale`); `en` when absent. */
  readonly fallback?: SupportedLanguage;
}

/**
 * A candidate as a canonical BCP 47 tag (`ES_mx` is `es-MX`), or `null` when it is empty, the
 * wildcard or not a language tag. `Intl.getCanonicalLocales` is the parser, so nothing a URL
 * carries reaches `Intl` unchecked.
 */
export function canonicalTag(candidate: string | null | undefined): string | null {
  const trimmed = candidate?.trim().replaceAll('_', '-') ?? '';
  if (trimmed === '' || trimmed === '*') {
    return null;
  }
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * RFC 4647 section 3.4 lookup of one tag among `available`: the tag is truncated from the end,
 * a single-letter subtag going with the one that follows it, until a whole prefix matches.
 * `ara` never matches `ar`, since subtags are compared whole.
 */
export function lookupLanguage(
  tag: string,
  available: readonly SupportedLanguage[],
): SupportedLanguage | null {
  let subtags = tag.toLowerCase().split('-');
  while (subtags.length > 0) {
    const range = subtags.join('-');
    const match = available.find((language) => language === range);
    if (match !== undefined) {
      return match;
    }
    subtags = subtags.slice(0, -1);
    if (subtags.length >= 2 && subtags.at(-1)?.length === 1) {
      subtags = subtags.slice(0, -1);
    }
  }
  return null;
}

/**
 * C161.2: the first candidate, in priority order, whose lookup finds an available language; the
 * catalog is chosen by that language and `Intl` formats with the candidate's full tag. With none,
 * the fallback (a version's `default-locale`), then English, then the first available language.
 */
export function negotiateLanguage(
  candidates: readonly (string | null | undefined)[],
  options: NegotiateOptions = {},
): LanguageChoice {
  const available = options.available ?? SUPPORTED_LANGUAGES;
  for (const candidate of candidates) {
    const tag = canonicalTag(candidate);
    const language = tag === null ? null : lookupLanguage(tag, available);
    if (tag !== null && language !== null) {
      return { language, locale: tag };
    }
  }
  const fallback =
    [options.fallback ?? DEFAULT_LANGUAGE, DEFAULT_LANGUAGE, ...available].find((language) =>
      available.includes(language),
    ) ?? DEFAULT_LANGUAGE;
  return { language: fallback, locale: fallback };
}

/** The public `language` parameter, and `lang`, kept as its alias (C161.2). */
export const LANGUAGE_PARAMETERS = ['language', 'lang'] as const;

/**
 * C161.2: the tags a person asked for, in priority order: the `language` parameter, then `lang`,
 * each read in the query and then in the fragment (which carries the credentials as
 * `URLSearchParams`), then the browser's `navigator.languages`. Read the fragment before the
 * session bootstrap removes it.
 */
export function requestedLanguages(
  location: { readonly search: string; readonly hash: string },
  preferred: readonly string[] = [],
): string[] {
  const sources = [
    new URLSearchParams(location.search),
    new URLSearchParams(location.hash.replace(/^#/, '')),
  ];
  const fromUrl = LANGUAGE_PARAMETERS.flatMap((name) =>
    sources.map((params) => params.get(name)?.trim() ?? ''),
  ).filter((value) => value !== '');
  return [...fromUrl, ...preferred];
}

/** The catalog language of {@link negotiateLanguage} among every built-in language. */
export function detectLanguage(
  candidates: readonly (string | null | undefined)[],
): SupportedLanguage {
  return negotiateLanguage(candidates).language;
}
