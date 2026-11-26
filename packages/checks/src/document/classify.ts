/**
 * Document classification (C60.5): visible text first, then a lexicon and layout score per class
 * and a softmax. These constants are provisional and ours, fixed in the plan and never tuned on
 * the generated fixtures (H23); the result is uncalibrated, so the check is `beta`.
 *
 * 1. The writing system and the language are read (`detectDocumentLanguage`); a document in
 *    another script, or in no covered language, is `unknown`.
 * 2. Each class scores the weights of the language's and the language-neutral cues found (anchor
 *    3, medium 2, weak 1; a phrase counts at most 3 times), plus its layout features.
 * 3. A softmax with temperature 1.0 runs over the five classes and `other`, which scores a constant
 *    θ = 2.0, so a document with little evidence for any class is `other`.
 * 4. The top class is `unknown` when its probability is below the type check's `min-confidence`
 *    or within 0.15 of the runner-up.
 *
 * An identity document (an MRZ, or at least 3 identity labels of a covered language) is flagged,
 * so the type check can refuse it when `other` wins on it (C60.6).
 */
import { DOCUMENT_TYPES } from '@openverify/core';
import type { WritingSystem } from '../matching/text.js';
import { DOCUMENT_CLASSIFIER_CONSTANTS } from './constants.js';
import type { DocumentClass, DocumentClassification } from './inputs.js';
import { detectDocumentLanguage } from './language.js';
import {
  DOCUMENT_LAYOUT_FEATURES,
  documentLayoutFeatures,
  type DocumentLayoutFeatureId,
} from './layout.js';
import { DOCUMENT_LEXICONS, NEUTRAL_DOCUMENT_CUES } from './lexicons/index.js';
import { DOCUMENT_LANGUAGES, type DocumentCue, type DocumentLanguage } from './lexicons/types.js';
import type { DocumentLine } from './lines.js';
import { foldedPhrase } from './text.js';
import { canonicalDocumentTokens, phraseIndex, phrasesAt, type PhraseIndex } from './vocabulary.js';

export { DOCUMENT_CLASSIFIER_CONSTANTS };

/** Why the classifier answered `unknown`, when it did. */
export type DocumentUnknownReason = 'no-text' | 'script' | 'language' | 'confidence' | 'margin';

export interface DocumentClassifierResult {
  /** The class, `other`, or `unknown` (C60.5). */
  readonly classification: DocumentClassification;
  /** The class or `other` with the highest probability, before the `unknown` rule. */
  readonly top: DocumentClass | 'other' | null;
  /** The top probability (uncalibrated), `null` without text to score. */
  readonly confidence: number | null;
  /** The top probability's lead over the runner-up. */
  readonly margin: number | null;
  readonly probabilities: Readonly<Record<DocumentClass | 'other', number>> | null;
  readonly scores: Readonly<Record<DocumentClass, number>> | null;
  readonly features: readonly DocumentLayoutFeatureId[];
  readonly language: DocumentLanguage | null;
  readonly script: WritingSystem | null;
  /** An MRZ, or the identity labels of a covered language, was read (C60.6). */
  readonly identityDocument: boolean;
  readonly unknownReason: DocumentUnknownReason | null;
}

export interface DocumentClassifierOptions {
  /** The type check's `min-confidence` (C51.3). */
  readonly minConfidence: number;
}

/** A line that looks like a machine-readable zone: 28 to 44 of A-Z, 0-9 and `<`, with `<<`. */
const MRZ_LINE = /^[A-Z0-9<]{28,44}$/;

let cueIndexes: Readonly<Record<DocumentLanguage, PhraseIndex<DocumentCue>>> | undefined;
let identityIndexes: Readonly<Record<DocumentLanguage, PhraseIndex<string>>> | undefined;

/** Each language's cues with the language-neutral ones. */
function cueIndexOf(language: DocumentLanguage): PhraseIndex<DocumentCue> {
  cueIndexes ??= Object.fromEntries(
    DOCUMENT_LANGUAGES.map((candidate) => [
      candidate,
      phraseIndex(
        [...DOCUMENT_LEXICONS[candidate].cues, ...NEUTRAL_DOCUMENT_CUES].map((cue) => ({
          phrase: cue.phrase,
          value: cue,
        })),
      ),
    ]),
  ) as Record<DocumentLanguage, PhraseIndex<DocumentCue>>;
  return cueIndexes[language];
}

function identityIndexOf(language: DocumentLanguage): PhraseIndex<string> {
  identityIndexes ??= Object.fromEntries(
    DOCUMENT_LANGUAGES.map((candidate) => [
      candidate,
      phraseIndex(
        DOCUMENT_LEXICONS[candidate].identity.map((phrase) => ({
          phrase,
          value: foldedPhrase(phrase).join(' '),
        })),
      ),
    ]),
  ) as Record<DocumentLanguage, PhraseIndex<string>>;
  return identityIndexes[language];
}

/** An MRZ line, or at least 3 distinct identity labels of one covered language. */
function isIdentityDocument(
  lines: readonly DocumentLine[],
  tokens: readonly (readonly string[])[],
): boolean {
  if (
    lines.some((line) => {
      const compact = line.text.replaceAll(' ', '').toUpperCase();
      return MRZ_LINE.test(compact) && compact.includes('<<');
    })
  ) {
    return true;
  }
  return DOCUMENT_LANGUAGES.some((language) => {
    const index = identityIndexOf(language);
    const found = new Set<string>();
    for (const lineTokens of tokens) {
      for (let start = 0; start < lineTokens.length; start += 1) {
        for (const entry of phrasesAt(index, lineTokens, start)) {
          found.add(entry.value);
        }
      }
    }
    return found.size >= DOCUMENT_CLASSIFIER_CONSTANTS.identityLabels;
  });
}

/** Each class's score: its cues' weights (each counted at most 3 times) and layout features. */
function classScores(
  tokens: readonly (readonly string[])[],
  language: DocumentLanguage,
  features: readonly DocumentLayoutFeatureId[],
): Record<DocumentClass, number> {
  const counts = new Map<DocumentCue, number>();
  const index = cueIndexOf(language);
  for (const lineTokens of tokens) {
    for (let start = 0; start < lineTokens.length; start += 1) {
      for (const entry of phrasesAt(index, lineTokens, start)) {
        counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1);
      }
    }
  }
  const scores = Object.fromEntries(DOCUMENT_TYPES.map((cls) => [cls, 0])) as Record<
    DocumentClass,
    number
  >;
  const { cueWeights, maxRepeats } = DOCUMENT_CLASSIFIER_CONSTANTS;
  for (const [cue, count] of counts) {
    for (const cls of cue.classes) {
      scores[cls] += cueWeights[cue.strength] * Math.min(count, maxRepeats);
    }
  }
  for (const feature of DOCUMENT_LAYOUT_FEATURES) {
    if (features.includes(feature.id)) {
      for (const cls of feature.classes) {
        scores[cls] += feature.weight;
      }
    }
  }
  return scores;
}

/** The softmax over the classes and `other` at θ, with the largest score subtracted first. */
function softmax(
  scores: Readonly<Record<DocumentClass, number>>,
): Record<DocumentClass | 'other', number> {
  const { temperature, otherScore } = DOCUMENT_CLASSIFIER_CONSTANTS;
  const entries: [DocumentClass | 'other', number][] = [
    ...DOCUMENT_TYPES.map((cls): [DocumentClass, number] => [cls, scores[cls]]),
    ['other', otherScore],
  ];
  const largest = Math.max(...entries.map(([, score]) => score));
  const weights = entries.map(([name, score]): [DocumentClass | 'other', number] => [
    name,
    Math.exp((score - largest) / temperature),
  ]);
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  return Object.fromEntries(weights.map(([name, weight]) => [name, weight / total])) as Record<
    DocumentClass | 'other',
    number
  >;
}

/** Classifies a document from its lines. */
export function classifyDocument(
  lines: readonly DocumentLine[],
  options: DocumentClassifierOptions,
): DocumentClassifierResult {
  const reading = detectDocumentLanguage(lines);
  const tokens = canonicalDocumentTokens(lines);
  const unscored = (reason: DocumentUnknownReason): DocumentClassifierResult => ({
    classification: 'unknown',
    top: null,
    confidence: null,
    margin: null,
    probabilities: null,
    scores: null,
    features: [],
    language: reading.language,
    script: reading.script,
    identityDocument: isIdentityDocument(lines, tokens),
    unknownReason: reason,
  });
  if (reading.script === null) {
    return unscored('no-text');
  }
  if (reading.script !== 'latin') {
    return unscored('script');
  }
  if (reading.language === null) {
    return unscored('language');
  }
  const features = documentLayoutFeatures(lines, DOCUMENT_LEXICONS[reading.language]);
  const scores = classScores(tokens, reading.language, features);
  const probabilities = softmax(scores);
  const ranked = (Object.entries(probabilities) as [DocumentClass | 'other', number][]).sort(
    (a, b) => b[1] - a[1],
  );
  const [top = 'other', confidence = 0] = ranked[0] ?? [];
  const margin = confidence - (ranked[1]?.[1] ?? 0);
  const unknownReason: DocumentUnknownReason | null =
    confidence < options.minConfidence
      ? 'confidence'
      : margin < DOCUMENT_CLASSIFIER_CONSTANTS.minMargin
        ? 'margin'
        : null;
  return {
    classification: unknownReason === null ? top : 'unknown',
    top,
    confidence,
    margin,
    probabilities,
    scores,
    features,
    language: reading.language,
    script: reading.script,
    identityDocument: isIdentityDocument(lines, tokens),
    unknownReason,
  };
}
