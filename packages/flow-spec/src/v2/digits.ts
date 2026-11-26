/**
 * C161.4 (owner `flow-spec-logic`): a person on an Arabic keyboard types Arabic-Indic (U+0660 to
 * U+0669) or Extended Arabic-Indic (U+06F0 to U+06F9) digits into a code, phone, date, number or ID
 * field; both clients and the server turn them into ASCII before validating or submitting, so the
 * value means the same everywhere. Nothing else changes: other scripts' digits are not in C161.4.
 */
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const ARABIC_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/gu;

export function normalizeDigits(value: string): string {
  return value.replace(ARABIC_DIGITS, (digit) => {
    const code = digit.codePointAt(0) ?? ARABIC_INDIC_ZERO;
    const zero =
      code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - zero);
  });
}
