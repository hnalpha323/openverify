/**
 * C81.2, C81.3, C81.5: the authored adverse-media lexicon, OpenVerify's own, in English, Spanish,
 * French and German: for each of core's twelve `ADVERSE_MEDIA_CATEGORIES`, the words a title uses
 * for it. A term is matched as whole folded words (C58's fold, both renderings); a single-word term
 * ending in `*` also matches a longer word it begins, for German compounds (`Geldwäsche*` matches
 * "Geldwäscheverdacht"). The GDELT query takes only the English query terms: GDELT searches its
 * machine-translated text in English. Each category carries a weight for the media score.
 */
import type { AdverseMediaCategory, ThresholdBasis } from '@openverify/core';
import { capText } from '../../matching/limits.js';
import { foldText } from '../../matching/text.js';
import { riskConstant } from '../constants.js';
import { LEXICON_TERMS } from './lexicon-terms.js';

/** The lexicon's languages (ISO 639-1). */
export const MEDIA_LEXICON_LANGUAGES = ['en', 'es', 'fr', 'de'] as const;
export type MediaLexiconLanguage = (typeof MEDIA_LEXICON_LANGUAGES)[number];

/** Each category's terms per language. */
export const ADVERSE_MEDIA_LEXICON: Readonly<
  Record<AdverseMediaCategory, Readonly<Record<MediaLexiconLanguage, readonly string[]>>>
> = Object.freeze(LEXICON_TERMS);

/** Each category's English terms for the GDELT `(a OR b)` group: letters and spaces only. */
export const MEDIA_QUERY_TERMS: Readonly<Record<AdverseMediaCategory, readonly string[]>> =
  Object.freeze({
    financial_crime: ['embezzlement', 'insider trading', 'misappropriation'],
    fraud: ['fraud', 'scam'],
    corruption: ['corruption', 'bribery'],
    money_laundering: ['money laundering'],
    terrorism: ['terrorism', 'terrorist'],
    organised_crime: ['organized crime', 'mafia'],
    narcotics: ['drug trafficking', 'narcotics'],
    violent_crime: ['murder', 'kidnapping'],
    cybercrime: ['cybercrime', 'ransomware'],
    property_crime: ['theft', 'burglary'],
    regulatory: ['fined', 'sanctioned'],
    financial_difficulty: ['bankruptcy', 'insolvency'],
  });

/** A category's weight in the media score, with its basis and source. */
export interface MediaCategoryWeight {
  readonly value: number;
  readonly basis: ThresholdBasis;
  readonly source: string;
}

function weight(value: number, source: string): MediaCategoryWeight {
  return Object.freeze({ value, basis: 'provisional', source });
}

const PREDICATE =
  "ours, C81.3: a FATF designated category of predicate offence (the FATF Recommendations' glossary)";

/** Each category's weight (ours, provisional). */
export const MEDIA_CATEGORY_WEIGHTS: Readonly<Record<AdverseMediaCategory, MediaCategoryWeight>> =
  Object.freeze({
    financial_crime: weight(1, PREDICATE),
    fraud: weight(1, PREDICATE),
    corruption: weight(1, PREDICATE),
    money_laundering: weight(
      1,
      'ours, C81.3: money laundering itself, the offence screening exists for',
    ),
    terrorism: weight(1, PREDICATE),
    organised_crime: weight(1, PREDICATE),
    narcotics: weight(1, PREDICATE),
    violent_crime: weight(0.9, `${PREDICATE}, but less often tied to a customer's funds`),
    cybercrime: weight(
      0.9,
      'ours, C81.3: fraud by other means, though a hacker is often a victim in titles',
    ),
    property_crime: weight(0.8, `${PREDICATE} (theft, robbery), usually small`),
    regulatory: weight(0.7, 'ours, C81.3: a regulator fine or ban is adverse but not a crime'),
    financial_difficulty: weight(
      0.5,
      'ours, C81.3: insolvency is adverse to a business but no wrongdoing',
    ),
  });

/** The English query terms of the given categories, in category order, each once. */
export function mediaQueryTerms(categories: readonly AdverseMediaCategory[]): string[] {
  return [...new Set(categories.flatMap((category) => MEDIA_QUERY_TERMS[category]))];
}

/**
 * The categories (of `categories`, in their order) whose terms a title holds, read with the
 * lexicon of the title's language; all four languages when the language is unknown, none for a
 * language the lexicon does not cover.
 */
export function mediaCategoriesOfTitle(
  title: string,
  language: string | null,
  categories: readonly AdverseMediaCategory[],
): AdverseMediaCategory[] {
  const languages = lexiconLanguagesOf(language);
  if (languages.length === 0) {
    return [];
  }
  const words = foldedWords(title, riskConstant('media-title-read-length'));
  return categories.filter((category) =>
    languages.some((code) => compiledTerms(category, code).some((term) => holdsTerm(words, term))),
  );
}

/** The lexicon languages a title is read in: its own, or all four when it is unknown. */
export function lexiconLanguagesOf(language: string | null): readonly MediaLexiconLanguage[] {
  if (language === null) {
    return MEDIA_LEXICON_LANGUAGES;
  }
  const base = language.toLowerCase().split('-', 1)[0] ?? '';
  return MEDIA_LEXICON_LANGUAGES.filter((code) => code === base);
}

/** A text's words in both folded renderings (C58): ä as a, and ä as ae. */
export interface FoldedWords {
  readonly simple: readonly string[];
  readonly expanded: readonly string[];
}

/** The folded words of a text's first `max` code points. */
export function foldedWords(text: string, max: number): FoldedWords {
  const folded = foldText(capText(text, max));
  const simple = words(folded.simplified);
  const expanded = words(folded.expanded);
  return { simple, expanded: expanded.length === simple.length ? expanded : simple };
}

/** Whether `needle`'s words stand together, in order, in `haystack`'s (either rendering). */
export function holdsPhrase(haystack: FoldedWords, needle: FoldedWords): boolean {
  return (
    needle.simple.length > 0 &&
    (holdsSequence(haystack.simple, needle.simple) ||
      holdsSequence(haystack.expanded, needle.expanded))
  );
}

const words = (text: string) => (text === '' ? [] : text.split(' '));

function holdsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) {
      return true;
    }
  }
  return false;
}

interface CompiledTerm extends FoldedWords {
  /** A single word that also matches the longer words it begins. */
  readonly prefix: boolean;
}

const compiled = new Map<string, readonly CompiledTerm[]>();

function compiledTerms(
  category: AdverseMediaCategory,
  language: MediaLexiconLanguage,
): readonly CompiledTerm[] {
  const key = `${category}/${language}`;
  let terms = compiled.get(key);
  if (terms === undefined) {
    terms = ADVERSE_MEDIA_LEXICON[category][language].map((term) => {
      const prefix = term.endsWith('*');
      return { ...foldedWords(prefix ? term.slice(0, -1) : term, term.length), prefix };
    });
    compiled.set(key, terms);
  }
  return terms;
}

function holdsTerm(title: FoldedWords, term: CompiledTerm): boolean {
  if (!term.prefix) {
    return holdsPhrase(title, term);
  }
  const [simple = '', expanded = ''] = [term.simple[0], term.expanded[0]];
  return (
    title.simple.some((word) => word.startsWith(simple)) ||
    title.expanded.some((word) => word.startsWith(expanded))
  );
}
