/**
 * The document's writing system and language (C60.5), recorded on the type result. The writing
 * system is the one most of the letters are in; a document mostly in another script than Latin is
 * `unknown`. The language is the covered language with the most distinct lexicon entries found
 * (class phrases, labels, identity labels and function words; language-neutral cues never count),
 * at least {@link MIN_DOCUMENT_LANGUAGE_HITS} of them; a tie goes to the first in
 * `DOCUMENT_LANGUAGES` order (a bilingual English and French page is still covered). Fewer hits
 * mean no covered language, so the document is `unknown`.
 */
import { writingSystemsOf, type WritingSystem } from '../matching/text.js';
import { DOCUMENT_LEXICONS } from './lexicons/index.js';
import {
  DOCUMENT_LANGUAGES,
  type DocumentLanguage,
  type DocumentLexicon,
} from './lexicons/types.js';
import type { DocumentLine } from './lines.js';
import { foldedPhrase } from './text.js';
import { canonicalDocumentTokens, phraseIndex, phrasesAt, type PhraseIndex } from './vocabulary.js';

/** The fewest distinct entries of one language that make it the document's (ours, provisional). */
export const MIN_DOCUMENT_LANGUAGE_HITS = 2;

export interface DocumentLanguageReading {
  /** The covered language, or `null` when none reached the minimum. */
  readonly language: DocumentLanguage | null;
  /** Distinct entries found per language. */
  readonly hits: Readonly<Record<DocumentLanguage, number>>;
  /** The writing system of most letters, or `null` without a letter. */
  readonly script: WritingSystem | null;
}

/** The entries that tell a language: its cues, labels, identity labels and function words. */
function entriesOf(lexicon: DocumentLexicon): string[] {
  return [
    ...lexicon.cues.map((cue) => cue.phrase),
    ...Object.values(lexicon.labels).flatMap((list: readonly string[]) => [...list]),
    ...lexicon.identity,
    ...lexicon.functionWords,
  ];
}

let indexes: Readonly<Record<DocumentLanguage, PhraseIndex<string>>> | undefined;

function languageIndexes(): Readonly<Record<DocumentLanguage, PhraseIndex<string>>> {
  indexes ??= Object.fromEntries(
    DOCUMENT_LANGUAGES.map((language) => [
      language,
      phraseIndex(
        entriesOf(DOCUMENT_LEXICONS[language]).map((phrase) => ({
          phrase,
          value: foldedPhrase(phrase).join(' '),
        })),
      ),
    ]),
  ) as Record<DocumentLanguage, PhraseIndex<string>>;
  return indexes;
}

const ANY_LETTER = /\p{L}/u;

/** The writing system of most letters. */
function dominantScript(lines: readonly DocumentLine[]): WritingSystem | null {
  const counts = new Map<WritingSystem, number>();
  for (const line of lines) {
    for (const character of line.text) {
      const code = character.charCodeAt(0);
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        counts.set('latin', (counts.get('latin') ?? 0) + 1);
      } else if (ANY_LETTER.test(character)) {
        for (const system of writingSystemsOf(character)) {
          counts.set(system, (counts.get(system) ?? 0) + 1);
        }
      }
    }
  }
  let best: WritingSystem | null = null;
  let most = 0;
  for (const [system, count] of counts) {
    if (count > most) {
      best = system;
      most = count;
    }
  }
  return best;
}

/** Reads the writing system and the language of a document's lines. */
export function detectDocumentLanguage(lines: readonly DocumentLine[]): DocumentLanguageReading {
  const tokens = canonicalDocumentTokens(lines);
  const found = Object.fromEntries(
    DOCUMENT_LANGUAGES.map((language) => [language, new Set<string>()]),
  ) as Record<DocumentLanguage, Set<string>>;
  const byLanguage = languageIndexes();
  for (const lineTokens of tokens) {
    for (let start = 0; start < lineTokens.length; start += 1) {
      for (const language of DOCUMENT_LANGUAGES) {
        for (const entry of phrasesAt(byLanguage[language], lineTokens, start)) {
          found[language].add(entry.value);
        }
      }
    }
  }
  const hits = Object.fromEntries(
    DOCUMENT_LANGUAGES.map((language) => [language, found[language].size]),
  ) as Record<DocumentLanguage, number>;
  let language: DocumentLanguage | null = null;
  for (const candidate of DOCUMENT_LANGUAGES) {
    if (
      hits[candidate] >= MIN_DOCUMENT_LANGUAGE_HITS &&
      (language === null || hits[candidate] > hits[language])
    ) {
      language = candidate;
    }
  }
  return { language, hits, script: dominantScript(lines) };
}
