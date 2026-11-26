/**
 * C78.2: the lossy romanisation of `any-ascii@0.3.3` (ISC), for every non-Latin script ICAO's
 * tables do not cover. Its tables are per character and context-free (Han as toneless pinyin,
 * abjads and Indic scripts as consonant skeletons), so its output only feeds keys and capped
 * scores (H tier).
 */
import { foldText } from '@openverify/checks';
import anyAscii from 'any-ascii';

/**
 * `any-ascii`'s romanisation of `text`, lower case, letters and digits only (`王小明` is
 * `wangxiaoming`); empty when it has none.
 */
export function lossyLatin(text: string): string {
  return foldText(anyAscii(text.normalize('NFC'))).simplified.replaceAll(' ', '');
}
