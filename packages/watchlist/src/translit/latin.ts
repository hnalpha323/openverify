/**
 * C78.2: the Latin form of one name token, and how far it can be trusted:
 * - `native`: a Latin token (or digits), folded as C58 folds it: the simplified rendering (ä as a)
 *   and the expanded one of ICAO 9303 §6.A (ä as ae);
 * - `icao`: a Cyrillic token through ICAO §6.B, a reliable form;
 * - `lossy`: an Arabic token through ICAO §6.C (no vowels), or any other script through
 *   `any-ascii@0.3.3` (ISC): keys and capped scores only;
 * - `none`: nothing Latin could be made of it (a script with no key at all, C78.5).
 */
import { foldText } from '@openverify/checks';
import { transliterateArabic } from './arabic.js';
import { transliterateCyrillic } from './cyrillic.js';
import { lossyLatin } from './lossy.js';
import type { TokenScript } from './scripts.js';

export type LatinReliability = 'native' | 'icao' | 'lossy' | 'none';

/** A token's Latin form in both renderings (equal unless the token is Latin), lower case. */
export interface LatinForm {
  readonly simple: string;
  readonly expanded: string;
  readonly reliability: LatinReliability;
}

/** A transliterated form, folded to plain letters and digits. */
function transliterated(latin: string, reliable: boolean): LatinForm {
  const simple = foldText(latin).simplified.replaceAll(' ', '');
  return {
    simple,
    expanded: simple,
    reliability: simple === '' ? 'none' : reliable ? 'icao' : 'lossy',
  };
}

/** A token of ASCII letters and digits only, which C58's fold only lower-cases. */
const ASCII_WORD = /^[\dA-Za-z]+$/u;

/** The Latin form of one token of the given script (see {@link tokenScript}). */
export function latinForm(token: string, script: TokenScript | null): LatinForm {
  if ((script === 'latin' || script === null) && ASCII_WORD.test(token)) {
    const lower = token.toLowerCase();
    return { simple: lower, expanded: lower, reliability: 'native' };
  }
  switch (script) {
    case null:
    case 'latin': {
      const folded = foldText(token);
      const simple = folded.simplified.replaceAll(' ', '');
      const expanded = folded.expanded.replaceAll(' ', '');
      return { simple, expanded, reliability: simple === '' ? 'none' : 'native' };
    }
    case 'cyrillic': {
      const { latin, reliable } = transliterateCyrillic(token);
      return transliterated(latin, reliable);
    }
    case 'arabic':
      return transliterated(transliterateArabic(token).latin, false);
    default:
      return transliterated(lossyLatin(token), false);
  }
}
