/**
 * The specimen markers of `id_compromised_detection` (C33). The list is frozen: a change is a
 * plan amendment.
 *
 * - Words, matched whole, case-insensitively, with accents folded: "specimen" in the languages
 *   specimens are printed in, and VOID.
 * - The phrase NOT A REAL DOCUMENT, with any spacing.
 * - The document numbers of the published ICAO Doc 9303 examples (Parts 4-7): the specimen state
 *   Utopia's passport, ID card and visa.
 *
 * TEST and SYNTHETIC are not markers. The check matches the words only in OCR text outside the
 * extracted field values, so a holder named Sample is not flagged.
 */
export const SPECIMEN_MARKER_WORDS: readonly string[] = Object.freeze([
  'SPECIMEN',
  'ESPECIMEN',
  'SAMPLE',
  'MUSTER',
  'ECHANTILLON',
  'CAMPIONE',
  'FACSIMILE',
  'MODELO',
  'VZOR',
  'WZOR',
  'NAYTE',
  'PROVE',
  'VOID',
]);

export const SPECIMEN_MARKER_PHRASES: readonly string[] = Object.freeze(['NOT A REAL DOCUMENT']);

export const SPECIMEN_DOCUMENT_NUMBERS: readonly string[] = Object.freeze([
  'L898902C3',
  'D23145890',
  'L8988901C',
]);

const WORDS: ReadonlySet<string> = new Set(SPECIMEN_MARKER_WORDS);

/** Upper case, accents folded, every run of non-alphanumerics one space. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** The markers in a text, in the order they appear, each once. */
export function specimenMarkersIn(text: string): string[] {
  const folded = fold(text);
  const found = new Set<string>();
  for (const token of folded.split(' ')) {
    if (WORDS.has(token)) {
      found.add(token);
    }
  }
  const padded = ` ${folded} `;
  return [
    ...found,
    ...SPECIMEN_MARKER_PHRASES.filter((phrase) => padded.includes(` ${phrase} `)),
  ];
}

/** Whether a document number, spaces and case aside, is one of the ICAO example numbers. */
export function isSpecimenDocumentNumber(number: string): boolean {
  return SPECIMEN_DOCUMENT_NUMBERS.includes(number.toUpperCase().replace(/[\s<-]+/g, ''));
}
