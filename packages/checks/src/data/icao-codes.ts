/**
 * The three-letter (and one-letter) codes that ICAO Doc 9303 Part 3 §5 lets machine-readable
 * documents use besides the ISO 3166-1 alpha-3 codes (C33): as an issuing state or organisation,
 * or as a nationality. Written by OpenVerify from the facts of §5; the descriptions are our own.
 *
 * Only Germany (`D`) and Kosovo (`RKS`, written `XK` by the ISO user-assigned convention) map to
 * an alpha-2 country code. Every other entry is an organisation or a status, not a country, so a
 * document it issued has no `country` (as for the sandbox test issuer Utopia, C30.7).
 */
export type IcaoCodePart = 'A' | 'B' | 'C' | 'D' | 'E';

export interface IcaoCode {
  code: string;
  /** §5 part: A non-ISO state codes, B other ISO-reserved codes, C United Nations, D other issuing authorities, E persons without a defined nationality. */
  part: IcaoCodePart;
  description: string;
  /** The alpha-2 country code, or `null` for an organisation or a status. */
  alpha2: string | null;
}

export const ICAO_CODES_SOURCE = {
  citation: 'ICAO Doc 9303, Eighth Edition (2021), Part 3, §5 (codes for nationality and issuers)',
  url: 'https://www.icao.int/sites/default/files/publications/DocSeries/9303_p3_cons_en.pdf',
} as const;

const code = (
  value: string,
  part: IcaoCodePart,
  description: string,
  alpha2: string | null = null,
): IcaoCode => Object.freeze({ code: value, part, description, alpha2 });

export const ICAO_PART3_SECTION5_CODES: readonly IcaoCode[] = Object.freeze([
  code('D', 'A', 'Germany, written with one letter instead of DEU', 'DE'),
  code('GBD', 'A', 'British overseas territories citizen'),
  code('GBN', 'A', 'British national (overseas)'),
  code('GBO', 'A', 'British overseas citizen'),
  code('GBP', 'A', 'British protected person'),
  code('GBS', 'A', 'British subject'),
  code('RKS', 'A', 'Kosovo', 'XK'),
  code('EUE', 'B', 'European Union, for its laissez-passer'),
  code('UNO', 'C', 'United Nations Organization or one of its officials'),
  code('UNA', 'C', 'A specialized agency of the United Nations or one of its officials'),
  code('UNK', 'C', 'Resident of Kosovo holding a United Nations (UNMIK) travel document'),
  code('XBA', 'D', 'African Development Bank'),
  code('XIM', 'D', 'African Export-Import Bank'),
  code('XCC', 'D', 'Caribbean Community or one of its emissaries'),
  code('XCE', 'D', 'Council of Europe'),
  code('XCO', 'D', 'Common Market for Eastern and Southern Africa'),
  code('XEC', 'D', 'Economic Community of West African States'),
  code('XPO', 'D', 'International Criminal Police Organization'),
  code('XES', 'D', 'Organisation of Eastern Caribbean States'),
  code('XMP', 'D', 'Parliamentary Assembly of the Mediterranean'),
  code('XOM', 'D', 'Sovereign Military Order of Malta'),
  code('XDC', 'D', 'Southern African Development Community'),
  code('XXA', 'E', 'Stateless person'),
  code('XXB', 'E', 'Refugee under the 1951 Convention relating to the Status of Refugees'),
  code('XXC', 'E', 'Refugee other than under the 1951 Convention'),
  code('XXX', 'E', 'Unspecified nationality'),
]);
