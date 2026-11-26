/**
 * C78.1: one name token in every form the matcher compares: its Latin form in C58's two
 * renderings (the expanded one is ICAO 9303 §6.A), its original-script form when it is not Latin,
 * its script, how reliable its Latin form is (C78.2), where it sits in the name and what it is.
 */
import {
  latinForm,
  normaliseOriginal,
  tokenScript,
  type LatinReliability,
  type TokenScript,
} from '../translit/index.js';

/** Where a token sits in a name, when the name says (structured fields, `FAMILY, Given`). */
export type NameTokenRole = 'given' | 'family' | 'middle' | 'patronymic';

/**
 * What a token is: a name word, a particle (`van`, `al`, `bin`), a generic business word, a
 * generational suffix, or a legal form (C78.1, C79.2).
 */
export type NameTokenType = 'word' | 'particle' | 'generic' | 'suffix' | 'legal_form';

export interface NameToken {
  /** The Latin form, simplified rendering (ä as a); for a legal form, its comparison key. */
  readonly simple: string;
  /** The Latin form, expanded rendering (ä as ae, ICAO 9303 §6.A). */
  readonly expanded: string;
  /** The original-script form ({@link normaliseOriginal}), `null` for a Latin token. */
  readonly original: string | null;
  readonly script: TokenScript | null;
  readonly reliability: LatinReliability;
  readonly role: NameTokenRole | null;
  readonly type: NameTokenType;
}

/** Format characters (ZWNJ inside Persian words, bidi marks) are dropped, never separators. */
const FORMAT_CHARACTERS = /\p{Cf}/gu;
/** C58's apostrophes, plus the Hebrew geresh and gershayim. */
const APOSTROPHES = /['`´ʼ‘’׳״]/gu;
const SEPARATORS = /[^\p{L}\p{M}\p{N}]+/u;

/**
 * The tokens of a name as written: NFC, format characters and apostrophes dropped (O'Brien is
 * one token), split on anything that is not a letter, a mark or a digit.
 */
export function splitNameText(text: string): string[] {
  return text
    .normalize('NFC')
    .replace(FORMAT_CHARACTERS, '')
    .replace(APOSTROPHES, '')
    .split(SEPARATORS)
    .filter((token) => token !== '');
}

/**
 * Owner decision 3 after 6C (`token-cache`): how many written tokens a process keeps made, the
 * cache emptied when it is full. A list's names share their tokens far more than their full names
 * (a common given or family name sits in many names), so a token is made once while it is kept.
 */
export const NAME_TOKEN_CACHE_SIZE = 100_000;

/** What {@link nameToken} did since the last {@link resetNameTokenWork}: for tests. */
export interface NameTokenWork {
  /** Tokens made (not found kept). */
  readonly made: number;
}

const tokenWork = { made: 0 };

/** The token work since the last {@link resetNameTokenWork}. */
export function nameTokenWork(): NameTokenWork {
  return { ...tokenWork };
}

/** Starts counting the token work again. */
export function resetNameTokenWork(): void {
  tokenWork.made = 0;
}

let tokenCacheOn = true;
/** The kept tokens by written form, one per role and type; {@link NAME_TOKEN_CACHE_SIZE} forms at most. */
const madeTokens = new Map<string, NameToken[]>();

/** Switches the token cache (`token-cache`, `match/shortcuts.ts`); switching it empties it. */
export function setNameTokenCache(on: boolean): void {
  if (on !== tokenCacheOn) {
    tokenCacheOn = on;
    madeTokens.clear();
  }
}

/**
 * One token in every form; `role` and `type` as the caller read them. A token is pure input, so a
 * kept one is the token; callers never change one (they spread it into a new one).
 */
export function nameToken(
  raw: string,
  role: NameTokenRole | null = null,
  type: NameTokenType = 'word',
): NameToken {
  if (!tokenCacheOn) {
    return makeToken(raw, role, type);
  }
  const kept = madeTokens.get(raw);
  const found = kept?.find((token) => token.role === role && token.type === type);
  if (found !== undefined) {
    return found;
  }
  const token = makeToken(raw, role, type);
  if (kept === undefined) {
    if (madeTokens.size >= NAME_TOKEN_CACHE_SIZE) {
      madeTokens.clear();
    }
    madeTokens.set(raw, [token]);
  } else {
    kept.push(token);
  }
  return token;
}

function makeToken(raw: string, role: NameTokenRole | null, type: NameTokenType): NameToken {
  tokenWork.made += 1;
  const script = tokenScript(raw);
  const latin = latinForm(raw, script);
  return {
    simple: latin.simple,
    expanded: latin.expanded,
    original: script === null || script === 'latin' ? null : normaliseOriginal(raw),
    script,
    reliability: latin.reliability,
    role,
    type,
  };
}

/** The text phrases are looked up by: the simplified Latin form, or the original-script form. */
export function phraseText(token: NameToken): string {
  return token.original ?? token.simple;
}
