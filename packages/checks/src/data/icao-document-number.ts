/**
 * The document number rules of ICAO Doc 9303 (C33), which judge every MRZ document whose issuer
 * has no national grammar here, the sandbox test issuer Utopia included.
 *
 * The number is the issuer's own, of `A`-`Z` and `0`-`9` only: fillers pad unused positions and
 * never sit inside it. TD3 passports and MRV visas have nine positions. TD1 and TD2 cards may carry
 * a longer number, its overflow continuing in the optional data field (Part 5 §4.2.4 and Part 6):
 * up to 9 + 14 characters on a TD1 (15 optional positions less the check digit) and 9 + 6 on a TD2.
 */
export type IcaoDocumentFormat = 'TD1' | 'TD2' | 'TD3' | 'MRVA' | 'MRVB';

export const ICAO_DOCUMENT_NUMBER_SOURCE = Object.freeze({
  citation:
    'ICAO Doc 9303, Eighth Edition (2021), Parts 4-7: the document number field and, for TD1 and TD2, its overflow into the optional data',
  url: 'https://www.icao.int/publications/doc-series/doc-9303',
});

const MAX_LENGTH: Readonly<Record<IcaoDocumentFormat, number>> = {
  TD1: 23,
  TD2: 15,
  TD3: 9,
  MRVA: 9,
  MRVB: 9,
};

/** Whether a document number (fillers already removed) fits the rules of its MRZ format. */
export function icaoDocumentNumberValid(number: string, format: IcaoDocumentFormat): boolean {
  return /^[A-Z0-9]+$/.test(number) && number.length <= MAX_LENGTH[format];
}
