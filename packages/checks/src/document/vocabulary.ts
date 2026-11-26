/**
 * How the classifier and the extractor find lexicon phrases in a document (C60.5). A line's folded
 * tokens are first read against the lexicons' vocabulary: a token the vocabulary holds stays as
 * it is, and a word of 5 letters or more that it does not hold reads as the closest vocabulary
 * word of the same first letter and about the same length at Jaro-Winkler 0.93 or above (an OCR
 * slip such as "Kontoauszvg"). Phrases then match runs of these tokens exactly. Nothing here
 * keeps a document's text beyond the lines it was given: the memo is keyed by the lines array.
 */
import { jaroWinkler } from '../name-matching.js';
import { DOCUMENT_CLASSIFIER_CONSTANTS } from './constants.js';
import { DOCUMENT_LANGUAGES, type DocumentLexicon } from './lexicons/types.js';
import { DOCUMENT_LEXICONS, NEUTRAL_DOCUMENT_CUES } from './lexicons/index.js';
import type { DocumentLine } from './lines.js';
import { documentTokens, foldedPhrase, type DocumentToken } from './text.js';

/** Every phrase list of a lexicon, for the vocabulary. */
function phrasesOf(lexicon: DocumentLexicon): string[] {
  const { labels } = lexicon;
  return [
    ...lexicon.cues.map((cue) => cue.phrase),
    ...Object.values(labels).flatMap((list: readonly string[]) => [...list]),
    ...lexicon.identity,
    ...lexicon.functionWords,
    ...lexicon.rangeWords,
    ...lexicon.durationUnits.month,
    ...lexicon.durationUnits.year,
    ...lexicon.jointWords,
    ...lexicon.payColumns.earnings,
    ...lexicon.payColumns.deductions,
    ...lexicon.signatureWords,
  ];
}

let vocabulary: ReadonlySet<string> | undefined;
let byFirstLetter: ReadonlyMap<string, readonly string[]> | undefined;

/** Every token of every lexicon phrase. */
export function documentVocabulary(): ReadonlySet<string> {
  if (vocabulary === undefined) {
    const phrases = [
      ...DOCUMENT_LANGUAGES.flatMap((language) => phrasesOf(DOCUMENT_LEXICONS[language])),
      ...NEUTRAL_DOCUMENT_CUES.map((cue) => cue.phrase),
    ];
    const words = new Set(phrases.flatMap((phrase) => foldedPhrase(phrase)));
    vocabulary = words;
    const grouped = new Map<string, string[]>();
    for (const word of [...words].sort()) {
      if (word.length >= DOCUMENT_CLASSIFIER_CONSTANTS.fuzzyMinLength) {
        const first = word.charAt(0);
        grouped.set(first, [...(grouped.get(first) ?? []), word]);
      }
    }
    byFirstLetter = grouped;
  }
  return vocabulary;
}

/** The vocabulary word a token reads as. */
function canonicalWord(token: string, memo: Map<string, string>): string {
  const known = memo.get(token);
  if (known !== undefined) {
    return known;
  }
  const words = documentVocabulary();
  let read = token;
  if (
    !words.has(token) &&
    token.length >= DOCUMENT_CLASSIFIER_CONSTANTS.fuzzyMinLength &&
    /\p{L}/u.test(token)
  ) {
    let best: number = DOCUMENT_CLASSIFIER_CONSTANTS.fuzzySimilarity;
    for (const word of byFirstLetter?.get(token.charAt(0)) ?? []) {
      if (Math.abs(word.length - token.length) > 2) {
        continue;
      }
      const similarity = jaroWinkler(token, word);
      if (similarity >= best && (read === token || similarity > best)) {
        best = similarity;
        read = word;
      }
    }
  }
  memo.set(token, read);
  return read;
}

const canonical = new WeakMap<readonly DocumentLine[], readonly (readonly string[])[]>();

/** Each line's tokens as the vocabulary reads them, memoised for these lines only. */
export function canonicalDocumentTokens(
  lines: readonly DocumentLine[],
): readonly (readonly string[])[] {
  const known = canonical.get(lines);
  if (known !== undefined) {
    return known;
  }
  const memo = new Map<string, string>();
  const read = lines.map((line) => line.tokens.map((token) => canonicalWord(token.folded, memo)));
  canonical.set(lines, read);
  return read;
}

/** A text's tokens and how the vocabulary reads them (the OCR of a box, re-read on its own). */
export function canonicalTextTokens(text: string): {
  readonly tokens: readonly DocumentToken[];
  readonly canonical: readonly string[];
} {
  const memo = new Map<string, string>();
  const tokens = documentTokens(text);
  return { tokens, canonical: tokens.map((token) => canonicalWord(token.folded, memo)) };
}

/** A phrase to find, with what finding it means. */
export interface PhraseEntry<Value> {
  readonly tokens: readonly string[];
  readonly value: Value;
}

/** Phrases by their first token, the longest first. */
export type PhraseIndex<Value> = ReadonlyMap<string, readonly PhraseEntry<Value>[]>;

/** Indexes phrases by their first token, the longest first. */
export function phraseIndex<Value>(
  phrases: readonly { readonly phrase: string; readonly value: Value }[],
): PhraseIndex<Value> {
  const index = new Map<string, PhraseEntry<Value>[]>();
  for (const { phrase, value } of phrases) {
    const tokens = foldedPhrase(phrase);
    const [first] = tokens;
    if (first !== undefined) {
      index.set(first, [...(index.get(first) ?? []), { tokens, value }]);
    }
  }
  for (const entries of index.values()) {
    entries.sort((a, b) => b.tokens.length - a.tokens.length);
  }
  return index;
}

/** The phrases that match `tokens` from `start`, the longest first. */
export function phrasesAt<Value>(
  index: PhraseIndex<Value>,
  tokens: readonly string[],
  start: number,
): PhraseEntry<Value>[] {
  const first = tokens[start];
  const entries = first === undefined ? undefined : index.get(first);
  return (entries ?? []).filter((entry) =>
    entry.tokens.every((token, offset) => tokens[start + offset] === token),
  );
}
