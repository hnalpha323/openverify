/**
 * Driver licence number grammars of the 50 US states and the District of Columbia (C33), for
 * `id_number_format_inconsistency_detection` on AAMVA cards (the IIN names the jurisdiction).
 *
 * Written by OpenVerify as the union of the formats each jurisdiction is documented to issue,
 * from the sources below (retrieved 2026-10-21). A number is valid when it matches any of its
 * jurisdiction's formats after upper-casing and removing spaces and hyphens. The union is
 * deliberately generous: a jurisdiction that issued several formats over the years keeps all of
 * them, because a false "inconsistent number" on a genuine card is the costlier error.
 */
export const US_DL_FORMAT_SOURCES = Object.freeze([
  Object.freeze({
    citation: 'adambullmer/USDLRegex: driver licence number formats by US state, read as facts',
    url: 'https://github.com/adambullmer/USDLRegex',
  }),
  Object.freeze({
    citation: "Skyhigh Security, U.S. Driver's License Numbers (formats by state), cross-check",
    url: "https://success.skyhighsecurity.com/Skyhigh_Data_Loss_Prevention/Data_Identifiers/U.S._Driver's_License_Numbers",
  }),
]);

const formats = (...patterns: string[]): readonly RegExp[] =>
  Object.freeze(patterns.map((pattern) => new RegExp(`^(?:${pattern})$`)));

/** Per two-letter jurisdiction code, the number formats it issues (A = letter, 9 = digit). */
export const US_DL_NUMBER_FORMATS: Readonly<Record<string, readonly RegExp[]>> = Object.freeze({
  AL: formats('\\d{1,8}'),
  AK: formats('\\d{1,7}'),
  AZ: formats('[A-Z]\\d{1,8}', '[A-Z]{2}\\d{2,5}', '\\d{9}'),
  AR: formats('\\d{4,9}'),
  CA: formats('[A-Z]\\d{7}'),
  CO: formats('\\d{9}', '[A-Z]\\d{3,6}', '[A-Z]{2}\\d{2,5}'),
  CT: formats('\\d{9}'),
  DE: formats('\\d{1,7}'),
  DC: formats('\\d{7}', '\\d{9}'),
  FL: formats('[A-Z]\\d{12}'),
  GA: formats('\\d{7,9}'),
  HI: formats('[A-Z]\\d{8}', '\\d{9}'),
  ID: formats('[A-Z]{2}\\d{6}[A-Z]', '\\d{9}'),
  IL: formats('[A-Z]\\d{11,12}'),
  IN: formats('[A-Z]\\d{9}', '\\d{9,10}'),
  IA: formats('\\d{9}', '\\d{3}[A-Z]{2}\\d{4}'),
  KS: formats('[A-Z]\\d[A-Z]\\d[A-Z]', '[A-Z]\\d{8}', '\\d{9}'),
  KY: formats('[A-Z]\\d{8,9}', '\\d{9}'),
  LA: formats('\\d{1,9}'),
  ME: formats('\\d{7,8}', '\\d{7}[A-Z]'),
  MD: formats('[A-Z]\\d{12}'),
  MA: formats('[A-Z]\\d{8,9}', '[A-Z]{2}\\d{7}', '\\d{9}'),
  MI: formats('[A-Z]\\d{10}', '[A-Z]\\d{12}'),
  MN: formats('[A-Z]\\d{12}'),
  MS: formats('\\d{9}'),
  MO: formats(
    '[A-Z]\\d{5,9}',
    '[A-Z]\\d{6}R',
    '\\d{3}[A-Z]\\d{6}',
    '\\d{8}[A-Z]{2}',
    '\\d{9}[A-Z]',
    '\\d{9}',
  ),
  MT: formats('[A-Z]\\d{8}', '\\d{9}', '\\d{13,14}'),
  NE: formats('\\d{1,7}', '[A-Z]\\d{6,8}'),
  NV: formats('\\d{9,10}', '\\d{12}', 'X\\d{8}'),
  NH: formats('\\d{2}[A-Z]{3}\\d{5}', '[A-Z]{3}\\d{8}'),
  NJ: formats('[A-Z]\\d{14}'),
  NM: formats('\\d{8,9}'),
  NY: formats('[A-Z]\\d{7}', '[A-Z]\\d{18}', '\\d{8,9}', '\\d{16}', '[A-Z]{8}'),
  NC: formats('\\d{1,12}'),
  ND: formats('[A-Z]{3}\\d{6}', '\\d{9}'),
  OH: formats('[A-Z]\\d{4,8}', '[A-Z]{2}\\d{3,7}', '\\d{8}'),
  OK: formats('[A-Z]\\d{9}', '\\d{9}'),
  OR: formats('\\d{1,9}', '[AB]\\d{6}'),
  PA: formats('\\d{8}'),
  RI: formats('\\d{7,8}', '[A-Z]\\d{6}'),
  SC: formats('\\d{5,11}'),
  SD: formats('\\d{6,10}', '\\d{12}'),
  TN: formats('\\d{7,9}'),
  TX: formats('\\d{7,8}'),
  UT: formats('\\d{4,10}'),
  VT: formats('\\d{8}', '\\d{7}A'),
  VA: formats('[A-Z]\\d{8,11}', '\\d{9}'),
  // Twelve characters: one to seven letters, then letters, digits or `*` (and the newer WDL…).
  WA: formats('(?=[A-Z0-9*]{12}$)[A-Z]{1,7}[A-Z0-9*]+'),
  WV: formats('\\d{7}', '[A-Z]{1,2}\\d{5,6}'),
  WI: formats('[A-Z]\\d{13}'),
  WY: formats('\\d{9,10}'),
});

/**
 * Whether a driver licence number fits its jurisdiction's grammar; `null` when the jurisdiction
 * has none here (a territory, a Canadian province, an unknown code).
 */
export function usDriverLicenseNumberValid(jurisdiction: string, number: string): boolean | null {
  const code = jurisdiction.trim().toUpperCase();
  const grammar = Object.hasOwn(US_DL_NUMBER_FORMATS, code) ? US_DL_NUMBER_FORMATS[code] : undefined;
  if (grammar === undefined) {
    return null;
  }
  const normalized = number.toUpperCase().replace(/[\s-]+/g, '');
  return grammar.some((pattern) => pattern.test(normalized));
}
