/** The document lexicons (C60.5): one per covered language, and the language-neutral cues. */
import type { DocumentLanguage, DocumentLexicon } from './types.js';
import { DE_DOCUMENT_LEXICON } from './de.js';
import { EN_DOCUMENT_LEXICON } from './en.js';
import { ES_DOCUMENT_LEXICON } from './es.js';
import { FR_DOCUMENT_LEXICON } from './fr.js';

export * from './types.js';
export { NEUTRAL_DOCUMENT_CUES } from './neutral.js';
export { DE_DOCUMENT_LEXICON, EN_DOCUMENT_LEXICON, ES_DOCUMENT_LEXICON, FR_DOCUMENT_LEXICON };

/** Every covered language's lexicon. */
export const DOCUMENT_LEXICONS: Readonly<Record<DocumentLanguage, DocumentLexicon>> = Object.freeze(
  {
    en: EN_DOCUMENT_LEXICON,
    es: ES_DOCUMENT_LEXICON,
    fr: FR_DOCUMENT_LEXICON,
    de: DE_DOCUMENT_LEXICON,
  },
);
