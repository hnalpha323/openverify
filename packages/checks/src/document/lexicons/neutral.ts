/**
 * Cues that read the same in every covered language (C60.5): units of metered supply and bank
 * identifiers. They count for whichever language the document is in, and never tell the language.
 */
import type { DocumentCue } from './types.js';

export const NEUTRAL_DOCUMENT_CUES: readonly DocumentCue[] = Object.freeze([
  { phrase: 'kWh', strength: 'anchor', classes: ['utility_bill'] },
  { phrase: 'MWh', strength: 'anchor', classes: ['utility_bill'] },
  { phrase: 'm³', strength: 'anchor', classes: ['utility_bill'] },
  { phrase: 'therms', strength: 'anchor', classes: ['utility_bill'] },
  { phrase: 'ccf', strength: 'medium', classes: ['utility_bill'] },
  { phrase: 'IBAN', strength: 'weak', classes: ['bank_statement', 'utility_bill'] },
  { phrase: 'BIC', strength: 'weak', classes: ['bank_statement', 'utility_bill'] },
  { phrase: 'SWIFT', strength: 'weak', classes: ['bank_statement'] },
] satisfies readonly DocumentCue[]);
