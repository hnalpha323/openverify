/**
 * Document text as the classifier and the extractor read it (C60.5): a line is cut into tokens of
 * letters, digits and marks, each kept with its offsets in the line and folded as the matching
 * library folds text (lower case, marks removed, ß as ss, m³ as m3). Lexicon phrases are cut and
 * folded the same way, so a phrase matches a run of tokens. Inside a word of two letters or more
 * the OCR confusions 0, 1 and 5 read as o, l and s ("B0ARD" is "board").
 */
import { MATCHING_INPUT_LIMITS, capText } from '../matching/limits.js';
import { foldedTokens } from '../matching/text.js';

/** One token of a line, with its place in the line's text. */
export interface DocumentToken {
  /** As printed. */
  readonly text: string;
  /** Folded for matching. */
  readonly folded: string;
  /** Offset of the first code unit in the line. */
  readonly start: number;
  /** Offset after the last code unit. */
  readonly end: number;
}

const TOKEN = /[\p{L}\p{N}\p{M}]+/gu;
const LETTER = /\p{L}/gu;
const OCR_DIGITS: Readonly<Record<string, string>> = { '0': 'o', '1': 'l', '5': 's' };

/** Folds one token for matching. */
export function foldDocumentToken(token: string): string {
  const folded = foldedTokens(token).join('');
  const letters = folded.match(LETTER)?.length ?? 0;
  return letters >= 2 ? folded.replace(/[015]/g, (digit) => OCR_DIGITS[digit] ?? digit) : folded;
}

/**
 * The tokens of a line (at most its first 300 code points, C58.7). `folds` keeps each token's
 * fold by its printed text: give the lines of one document one map, as their words repeat.
 */
export function documentTokens(
  text: string,
  folds: Map<string, string> = new Map<string, string>(),
): DocumentToken[] {
  const kept = capText(text, MATCHING_INPUT_LIMITS.documentLineLength);
  const tokens: DocumentToken[] = [];
  for (const match of kept.matchAll(TOKEN)) {
    let folded = folds.get(match[0]);
    if (folded === undefined) {
      folded = foldDocumentToken(match[0]);
      folds.set(match[0], folded);
    }
    if (folded !== '') {
      tokens.push({
        text: match[0],
        folded,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return tokens;
}

/** `text` without the run of `characters` it ends with (no regular expression: C58.7). */
export function trimTrailingCharacters(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text.charAt(end - 1))) {
    end -= 1;
  }
  return text.slice(0, end);
}

/** A lexicon phrase as the folded tokens it matches. */
export function foldedPhrase(phrase: string): readonly string[] {
  return documentTokens(phrase).map((token) => token.folded);
}
